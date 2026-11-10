/* ═══════════════════════════════════════════════════════════════
   WP14.2 — Kurzer Bewertungslink  werkruf.com/b/<code>
   ═══════════════════════════════════════════════════════════════

   Zweck: SMS-Laenge. Der Google-Link (~80 Zeichen) drueckt viele
   Bewertungsanfragen ins zweite GSM-7-Segment. Ein kurzer, opaker
   WERKRUF-Link (7 Zeichen) haelt typische Nachrichten in einem.

   Modell: EIN aktiver, stabiler Code je Standort — nicht je SMS.
   Gespeichert wird nur location_id; der Google-Link entsteht beim
   Redirect aus google_locations.place_id ueber denselben Generator
   wie Client und SMS (bewertungsLink). Keine URL vom Client.

   Code: 7 Zeichen [A-Za-z0-9] (62^7 ≈ 3,5·10^12), zufaellig, nicht
   sequenziell, nicht aus IDs ableitbar; unique.

   Kein Klick-Tracking: der Redirect liest nur (kein Write pro Klick).

   Loeschung: location_id → google_locations ON DELETE CASCADE — ohne
   Standort hat der Link keinen Wert. Der Lookup liefert zusaetzlich
   nur, wenn deleted_at null und place_id vorhanden ist.

   Fachlich getrennt von WP10 (referral_codes): aehnlicher Generator,
   eigene Tabelle, eigene Route (/b statt /empfehlen).

   Kein Client-RPC (Kanon). Idempotent.
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.review_short_links (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.google_locations(id) on delete cascade,
  code        text not null unique check (code ~ '^[A-Za-z0-9]{7}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
comment on table public.review_short_links is 'WP14.2 — kurzer Bewertungslink je Standort (werkruf.com/b/<code>). Nur location_id, kein URL-Speicher, kein Tracking.';

create unique index if not exists review_short_links_one_active_per_location
  on public.review_short_links (location_id) where active;

alter table public.review_short_links enable row level security;
revoke all on table public.review_short_links from public, anon, authenticated;
grant all on table public.review_short_links to service_role;

create or replace function public.review_short_code_zufall()
returns text
language plpgsql
volatile
as $$
declare v text := '';
begin
  while length(v) < 7 loop
    v := v || regexp_replace(encode(decode(md5(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text), 'hex'), 'base64'), '[^A-Za-z0-9]', '', 'g');
  end loop;
  return substr(v, 1, 7);
end;
$$;
revoke all on function public.review_short_code_zufall() from public, anon, authenticated;
grant execute on function public.review_short_code_zufall() to service_role;

/* Aktiven Code des Standorts holen, bei Bedarf anlegen — NUR fuer einen
   Standort, der dem Nutzer gehoert (der Aufrufer ist die Edge Function
   nach requireUser/requirePaidAccess/loadOwnLocation; hier wird der
   Besitz trotzdem erneut geprueft). */
create or replace function public.ensure_review_short_link(p_user_id uuid, p_location_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_code text; v_versuch integer := 0;
begin
  if not exists (select 1 from public.google_locations l where l.id = p_location_id and l.user_id = p_user_id and l.deleted_at is null) then
    raise exception 'Standort gehoert nicht zum Nutzer' using errcode = '42501';
  end if;
  select code into v_code from public.review_short_links where location_id = p_location_id and active;
  if v_code is not null then return v_code; end if;
  loop
    v_versuch := v_versuch + 1;
    begin
      insert into public.review_short_links (location_id, code) values (p_location_id, public.review_short_code_zufall())
      returning code into v_code;
      exit;
    exception when unique_violation then
      /* Code-Kollision → neuer Versuch; ein Rennen um denselben Standort → vorhandenen lesen */
      select code into v_code from public.review_short_links where location_id = p_location_id and active;
      if v_code is not null then exit; end if;
      if v_versuch > 5 then raise; end if;
    end;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.ensure_review_short_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_review_short_link(uuid, uuid) to service_role;

/* Oeffentlicher Lookup fuer den Redirect: nur die place_id des aktiven,
   nicht geloeschten Standorts — oder null. Keine IDs, kein Name. */
create or replace function public.review_short_link_place_id(p_code text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.place_id
    from public.review_short_links s
    join public.google_locations l on l.id = s.location_id
   where s.code = p_code and s.active and l.deleted_at is null and l.place_id is not null
   limit 1;
$$;
revoke all on function public.review_short_link_place_id(text) from public, anon, authenticated;
grant execute on function public.review_short_link_place_id(text) to service_role;

/* ── Selbstpruefung ── */
do $$
declare f text;
begin
  foreach f in array array['public.review_short_code_zufall()', 'public.ensure_review_short_link(uuid,uuid)', 'public.review_short_link_place_id(text)'] loop
    if pg_catalog.has_function_privilege('anon', f, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[wp14.2] Client-Rollen duerfen % ausfuehren', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp14.2] service_role darf % nicht', f;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('anon', 'public.review_short_links', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.review_short_links', 'SELECT') then
    raise exception '[wp14.2] Client-Rollen lesen review_short_links';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'review_short_links' and column_name in ('url', 'review_url', 'place_id')) then
    raise exception '[wp14.2] review_short_links speichert URL/place_id — Generator muss Source of Truth bleiben';
  end if;
  raise notice '[wp14.2] in Ordnung';
end $$;
