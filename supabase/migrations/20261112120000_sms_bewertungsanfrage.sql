/* ═══════════════════════════════════════════════════════════════
   WP14 — SMS-Bewertungsanfrage
   ═══════════════════════════════════════════════════════════════

   Ein Betrieb schickt nach echtem Kundenkontakt manuell EINE
   Bewertungsanfrage per SMS. Kein CRM, keine Listen, keine Serien.

   Datenminimierung: die Telefonnummer wird NICHT gespeichert — nur
   ein HMAC-Hash (phone_hash) fuer Dedupe und Missbrauchsschutz. Der
   Vorname wird nicht gespeichert. Es bleibt eine technische
   Versandhistorie: wer (user), welcher Betrieb (location), wann,
   Status, Provider-Message-ID, Segmente, Fehlercode.

   Regeln (service_role-Funktionen, Client → Edge Function):
     Rate-Limit   max 5 Versuche / 10 Minuten, max 30 / Tag je Account
                  (Versuche inkl. fehlgeschlagener — Missbrauch zaehlt)
     Dedupe       gleicher Account + gleicher phone_hash innerhalb 24 h
                  mit Status queued/sent/delivered → blockiert.
                  ACCOUNT-weit, nicht je Standort: ein Kunde ist eine
                  Person; zwei Anfragen von zwei Betrieben desselben
                  Inhabers am selben Tag sind genau der Doppelkontakt,
                  den die Regel verhindern soll (§21/T24).
                  failed zaehlt NICHT → erneuter Versuch erlaubt (T25).
     Lifecycle    queued → sent → delivered | failed  (nur vorwaerts)

   Loeschung: user_id → auth.users ON DELETE CASCADE (WP1: keine
   Waisen, keine Nummer). location_id → google_locations ON DELETE
   SET NULL (Standort weg, Historie bleibt ohne Betriebsbezug).

   Kein neuer Client-RPC (Kanon 20261014120000/130000). RLS: eigene
   Zeilen lesbar (Zaehler im UI), keine Client-Writes.

   Idempotent. Keine bestehende Migration geaendert.
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.review_sms_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  location_id         uuid references public.google_locations(id) on delete set null,
  phone_hash          text not null check (phone_hash ~ '^[a-f0-9]{64}$'),
  provider            text not null default 'brevo',
  provider_message_id text unique,
  status              text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed')),
  segment_count       integer check (segment_count is null or segment_count between 1 and 10),
  error_code          text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  failed_at           timestamptz
);
comment on table  public.review_sms_requests is 'WP14 — technische Versandhistorie der SMS-Bewertungsanfragen. Keine Telefonnummer, kein Name.';
comment on column public.review_sms_requests.phone_hash is 'HMAC-SHA256 der E.164-Nummer (Pepper serverseitig). Nur fuer Dedupe/Rate-Limit.';

create index if not exists review_sms_requests_user_created_idx on public.review_sms_requests (user_id, created_at desc);
create index if not exists review_sms_requests_user_phone_idx   on public.review_sms_requests (user_id, phone_hash, created_at desc);

alter table public.review_sms_requests enable row level security;
revoke all on table public.review_sms_requests from public, anon, authenticated;
grant select on table public.review_sms_requests to authenticated;
drop policy if exists review_sms_requests_own on public.review_sms_requests;
create policy review_sms_requests_own on public.review_sms_requests for select to authenticated using (user_id = auth.uid());
grant all on table public.review_sms_requests to service_role;

/* ── Pruefung: Zugang, Rate-Limit, Dedupe ── */
create or replace function public.review_sms_pruefen(p_user_id uuid, p_phone_hash text, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_kurz integer; v_tag integer; v_doppelt boolean;
begin
  if p_user_id is null or p_phone_hash is null then
    raise exception 'Parameter fehlen' using errcode = '22004';
  end if;
  if not public.has_paid_access(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'kein_zugang');
  end if;
  select count(*) into v_kurz from public.review_sms_requests
   where user_id = p_user_id and created_at >= p_now - interval '10 minutes';
  select count(*) into v_tag from public.review_sms_requests
   where user_id = p_user_id and created_at >= p_now - interval '24 hours';
  select exists (
    select 1 from public.review_sms_requests
     where user_id = p_user_id and phone_hash = p_phone_hash
       and status in ('queued', 'sent', 'delivered')
       and created_at >= p_now - interval '24 hours') into v_doppelt;
  if v_doppelt then
    return jsonb_build_object('ok', false, 'reason', 'doppelt');
  end if;
  if v_kurz >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'limit_kurz', 'kurz', v_kurz, 'tag', v_tag);
  end if;
  if v_tag >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'limit_tag', 'kurz', v_kurz, 'tag', v_tag);
  end if;
  return jsonb_build_object('ok', true, 'kurz', v_kurz, 'tag', v_tag);
end;
$$;
revoke all on function public.review_sms_pruefen(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.review_sms_pruefen(uuid, text, timestamptz) to service_role;

/* ── Anlegen (queued) — der Versuch zaehlt ab hier fuers Rate-Limit ── */
create or replace function public.review_sms_anlegen(p_user_id uuid, p_location_id uuid, p_phone_hash text, p_segment_count integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.google_locations l where l.id = p_location_id and l.user_id = p_user_id and l.deleted_at is null) then
    raise exception 'Standort gehoert nicht zum Nutzer' using errcode = '42501';
  end if;
  insert into public.review_sms_requests (user_id, location_id, phone_hash, segment_count)
  values (p_user_id, p_location_id, p_phone_hash, p_segment_count)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.review_sms_anlegen(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.review_sms_anlegen(uuid, uuid, text, integer) to service_role;

/* ── Status nach Provider-Antwort ── */
create or replace function public.review_sms_status_setzen(p_id uuid, p_status text, p_provider_message_id text default null, p_error_code text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'ungueltiger Status' using errcode = '22023';
  end if;
  update public.review_sms_requests
     set status = p_status,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         error_code = case when p_status = 'failed' then left(p_error_code, 120) else null end,
         sent_at   = case when p_status = 'sent'   then now() else sent_at end,
         failed_at = case when p_status = 'failed' then now() else failed_at end
   where id = p_id and status = 'queued';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.review_sms_status_setzen(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_sms_status_setzen(uuid, text, text, text) to service_role;

/* ── Delivery-Webhook: nur bekannte Message-ID, nur vorwaerts, idempotent ── */
create or replace function public.review_sms_delivery(p_provider_message_id text, p_event text, p_error_code text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer := 0; v_status text;
begin
  if p_provider_message_id is null or p_event is null then
    return jsonb_build_object('known', false, 'changed', false);
  end if;
  select status into v_status from public.review_sms_requests where provider_message_id = p_provider_message_id;
  if v_status is null then
    return jsonb_build_object('known', false, 'changed', false);
  end if;
  if p_event = 'delivered' and v_status in ('queued', 'sent') then
    update public.review_sms_requests set status = 'delivered', delivered_at = now(), error_code = null
     where provider_message_id = p_provider_message_id;
    get diagnostics v_n = row_count;
  elsif p_event = 'failed' and v_status in ('queued', 'sent') then
    update public.review_sms_requests set status = 'failed', failed_at = now(), error_code = left(p_error_code, 120)
     where provider_message_id = p_provider_message_id;
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('known', true, 'changed', v_n = 1, 'status', (select status from public.review_sms_requests where provider_message_id = p_provider_message_id));
end;
$$;
revoke all on function public.review_sms_delivery(text, text, text) from public, anon, authenticated;
grant execute on function public.review_sms_delivery(text, text, text) to service_role;

/* ── Selbstpruefung ── */
do $$
declare f text;
begin
  foreach f in array array['public.review_sms_pruefen(uuid,text,timestamptz)', 'public.review_sms_anlegen(uuid,uuid,text,integer)',
                           'public.review_sms_status_setzen(uuid,text,text,text)', 'public.review_sms_delivery(text,text,text)'] loop
    if pg_catalog.has_function_privilege('anon', f, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[wp14] Client-Rollen duerfen % ausfuehren', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp14] service_role darf % nicht', f;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('anon', 'public.review_sms_requests', 'SELECT') then
    raise exception '[wp14] anon liest review_sms_requests';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.review_sms_requests', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.review_sms_requests', 'UPDATE') then
    raise exception '[wp14] authenticated schreibt review_sms_requests';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'review_sms_requests' and c.relrowsecurity) then
    raise exception '[wp14] RLS aus';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'review_sms_requests'
              and column_name in ('phone', 'phone_number', 'telefon', 'recipient_name', 'name')) then
    raise exception '[wp14] Klartext-Spalte in review_sms_requests';
  end if;
  raise notice '[wp14] in Ordnung';
end $$;
