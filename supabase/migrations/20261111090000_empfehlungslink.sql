-- WP10 — Empfehlungslink / „Kollege empfiehlt Kollegen"
--
-- Regel: bestehender Nutzer → persönlicher Link → neuer Nutzer meldet
-- sich darüber an → startet ein ZAHLENDES Pro-Abo (erste bezahlte
-- Rechnung) → beide bekommen einen Monatsbetrag gutgeschrieben.
-- Founding Partner zahlen ohnehin nichts: kein Credit, Referral zählt.
-- Werber in Free: Credit wartet (pending) bis zur Reaktivierung.
--
-- Drei Tabellen, kleiner Ledger statt Zähler:
--   referral_codes    ein stabiler, opaker Code je Nutzer (revokierbar)
--   referrals         Zuordnung neuer Nutzer → Werber; unique je Geworbenem
--                     (first valid wins), Status signed_up → converted | invalid
--   referral_rewards  ein Eintrag je Begünstigtem und Referral; unique
--                     (referral_id, beneficiary) → nie zwei Rewards
--
-- Konto-Löschung: FKs auf auth.users mit ON DELETE SET NULL — die
-- Billing-Historie bleibt ohne personenbezogene Daten; offene,
-- unverdiente Referrals des Geworbenen werden invalidiert (Trigger).
--
-- Stripe wird hier nicht berührt. Die Anwendung des Credits
-- (Customer Balance) macht der Webhook; diese Migration liefert die
-- Wahrheit darüber, WEM WAS zusteht.

/* ═══════════════════════════════════════════════════════════════
   1 — Tabellen
   ═══════════════════════════════════════════════════════════════ */
create table if not exists public.referral_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  code        text not null unique check (code ~ '^[A-Za-z0-9]{10}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
comment on table public.referral_codes is 'WP10: persönlicher Empfehlungscode je Nutzer. Opak, nicht aus der User-ID ableitbar, revokierbar. Gewährt nichts — identifiziert nur die Quelle.';

create table if not exists public.referrals (
  id                      uuid primary key default gen_random_uuid(),
  referrer_user_id        uuid references auth.users(id) on delete set null,
  referred_user_id        uuid unique references auth.users(id) on delete set null,
  referral_code_id        uuid references public.referral_codes(id) on delete set null,
  status                  text not null default 'signed_up' check (status in ('signed_up', 'converted', 'invalid')),
  invalid_reason          text,
  signed_up_at            timestamptz not null default now(),
  converted_at            timestamptz,
  converted_invoice_id    text unique,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint referrals_kein_selbst check (referrer_user_id is null or referred_user_id is null or referrer_user_id <> referred_user_id)
);
comment on table public.referrals is 'WP10: Zuordnung Geworbener → Werber, entsteht beim Signup (Trigger). Ein Geworbener hat höchstens eine Zuordnung (first valid wins). converted erst bei erster bezahlter Rechnung.';
create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id, status);

create table if not exists public.referral_rewards (
  id               uuid primary key default gen_random_uuid(),
  referral_id      uuid not null references public.referrals(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  beneficiary      text not null check (beneficiary in ('referrer', 'referred')),
  reward_type      text not null default 'one_free_month',
  amount_cents     integer not null check (amount_cents > 0),
  currency         text not null default 'eur',
  status           text not null default 'pending' check (status in ('pending', 'applied', 'not_applicable', 'invalid', 'failed')),
  status_reason    text,
  stripe_object_id text unique,
  created_at       timestamptz not null default now(),
  applied_at       timestamptz,
  updated_at       timestamptz not null default now(),
  unique (referral_id, beneficiary)
);
comment on table public.referral_rewards is 'WP10: Ledger — ein Monatsbetrag je Begünstigtem und Referral. pending → applied (Stripe Customer Balance) | not_applicable (Founding Partner) | invalid | failed.';
create index if not exists referral_rewards_user_idx on public.referral_rewards (user_id, status);

create or replace function public.referral_touch() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists referrals_touch on public.referrals;
create trigger referrals_touch before update on public.referrals for each row execute function public.referral_touch();
drop trigger if exists referral_rewards_touch on public.referral_rewards;
create trigger referral_rewards_touch before update on public.referral_rewards for each row execute function public.referral_touch();

/* ── Rechte: deny by default, dann gezielt ── */
alter table public.referral_codes   enable row level security;
alter table public.referrals        enable row level security;
alter table public.referral_rewards enable row level security;
revoke all on table public.referral_codes, public.referrals, public.referral_rewards from public, anon, authenticated;
grant select, insert, update, delete on table public.referral_codes, public.referrals, public.referral_rewards to service_role;

/* Eigentümer liest seinen Code, seine Referrals (als Werber oder
   Geworbener) und seine Rewards. Nur lesen — alles Schreiben über RPCs. */
grant select on table public.referral_codes, public.referrals, public.referral_rewards to authenticated;
drop policy if exists referral_codes_own on public.referral_codes;
create policy referral_codes_own on public.referral_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists referrals_own on public.referrals;
create policy referrals_own on public.referrals for select to authenticated using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());
drop policy if exists referral_rewards_own on public.referral_rewards;
create policy referral_rewards_own on public.referral_rewards for select to authenticated using (user_id = auth.uid());

/* ═══════════════════════════════════════════════════════════════
   2 — Code erzeugen / lesen / widerrufen
   ═══════════════════════════════════════════════════════════════ */

/* 10 Zeichen [A-Za-z0-9] aus 128 Bit Zufall (md5 über zwei UUIDs +
   Uhr), base64 → nur Alphanumerisches behalten. ~59 Bit Entropie,
   nicht sequenziell, nicht aus der User-ID ableitbar. */
create or replace function public.referral_code_zufall()
returns text
language plpgsql
volatile
as $$
declare v text := '';
begin
  while length(v) < 10 loop
    v := v || regexp_replace(encode(decode(md5(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text), 'hex'), 'base64'), '[^A-Za-z0-9]', '', 'g');
  end loop;
  return substr(v, 1, 10);
end;
$$;
revoke all on function public.referral_code_zufall() from public, anon, authenticated;

/*
 * Eigenen Code holen, bei Bedarf anlegen.
 *
 * Eligibility (§4): mindestens ein aktiver Google-Standort — das ist
 * die belastbare Aktivierung; ein frisch registrierter Account ohne
 * Betrieb bekommt keinen Code. Free darf empfehlen (ehemalige Kunden
 * kennen das Produkt), Pro und FP ohnehin.
 *
 * NUR service_role. Der Client erreicht das über die Edge Function
 * google-business (/referral/code), die den Nutzer aus dem JWT
 * bestimmt und p_user_id setzt. Grund: die kanonische Rechte-
 * Migration (20261014120000) laesst authenticated genau drei
 * volatile Definer-RPCs — und das bleibt so (H2.2 §5, §7).
 *
 * Rückgabe: { code, eligible, reason }.
 */
create or replace function public.ensure_referral_code(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
  v_versuch integer := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id fehlt' using errcode = '22004';
  end if;
  if not exists (select 1 from public.google_locations l where l.user_id = p_user_id and l.deleted_at is null) then
    return jsonb_build_object('code', null, 'eligible', false, 'reason', 'kein_standort');
  end if;

  select code into v_code from public.referral_codes where user_id = p_user_id and active;
  if v_code is not null then
    return jsonb_build_object('code', v_code, 'eligible', true, 'reason', null);
  end if;

  /* widerrufenen Code ersetzen oder neu anlegen; Kollision → neuer Versuch */
  loop
    v_versuch := v_versuch + 1;
    begin
      insert into public.referral_codes (user_id, code)
      values (p_user_id, public.referral_code_zufall())
      on conflict (user_id) do update set code = excluded.code, active = true, revoked_at = null
      returning code into v_code;
      exit;
    exception when unique_violation then
      if v_versuch > 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'eligible', true, 'reason', null);
end;
$$;
revoke all on function public.ensure_referral_code(uuid) from public, anon, authenticated;
grant execute on function public.ensure_referral_code(uuid) to service_role;

/* Eigenen Code widerrufen — der Link wird ungültig; der nächste
   ensure_referral_code() erzeugt einen neuen. Bestehende Referrals
   bleiben (sie hängen am Code-Datensatz, nicht am Text).
   NUR service_role (Edge Function /referral/revoke). */
create or replace function public.revoke_referral_code(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_user_id is null then raise exception 'p_user_id fehlt' using errcode = '22004'; end if;
  update public.referral_codes set active = false, revoked_at = now() where user_id = p_user_id and active;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.revoke_referral_code(uuid) from public, anon, authenticated;
grant execute on function public.revoke_referral_code(uuid) to service_role;

/*
 * Lookup für die Landingpage: sagt nur, ob der Code gültig ist.
 * Keine User-ID, kein Name, keine Mail. Mehr braucht die Seite nicht —
 * die Zuordnung passiert beim Signup serverseitig.
 *
 * NUR service_role: die Seite fragt die Edge Function
 * google-business (GET /referral/lookup?code=…, öffentlich, nur
 * ja/nein). Kein Definer-RPC für anon — Kanon 20261014130000.
 */
create or replace function public.referral_code_gueltig(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.referral_codes c
     where c.code = p_code and c.active
       and length(coalesce(p_code, '')) = 10);
$$;
revoke all on function public.referral_code_gueltig(text) from public, anon, authenticated;
grant execute on function public.referral_code_gueltig(text) to service_role;

/* ═══════════════════════════════════════════════════════════════
   3 — Zuordnung beim Signup (Trigger auf user_profiles)
   ═══════════════════════════════════════════════════════════════
   handle_new_user() bleibt unverändert; dieser Trigger läuft danach
   (AFTER INSERT) und liest denselben raw_user_meta_data.referral_code.
   Nur NEUE Profile — ein bestehender Nutzer kann keinen Werber
   nachtragen. Ungültiger Code → stille Nicht-Zuordnung, Signup läuft. */
create or replace function public.handle_new_user_referral()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
  v_c    public.referral_codes;
begin
  select u.raw_user_meta_data ->> 'referral_code' into v_code from auth.users u where u.id = new.id;
  if v_code is null or length(v_code) <> 10 then return new; end if;

  select * into v_c from public.referral_codes where code = v_code and active;
  if not found then return new; end if;
  /* Selbst-Empfehlung: der Code gehört dem neuen Nutzer selbst — kann
     bei einem neuen Profil nicht sein, wird aber hart ausgeschlossen. */
  if v_c.user_id = new.id then return new; end if;

  insert into public.referrals (referrer_user_id, referred_user_id, referral_code_id)
  values (v_c.user_id, new.id, v_c.id)
  on conflict (referred_user_id) do nothing;   -- first valid wins
  return new;
end;
$$;
drop trigger if exists on_user_profile_created_referral on public.user_profiles;
create trigger on_user_profile_created_referral
  after insert on public.user_profiles
  for each row execute function public.handle_new_user_referral();

/* ═══════════════════════════════════════════════════════════════
   4 — Conversion und Rewards (nur service_role, vom Webhook)
   ═══════════════════════════════════════════════════════════════ */

/*
 * Erste bezahlte Rechnung des Geworbenen.
 *
 * Idempotent: nur ein Referral im Status signed_up wird converted;
 * jede weitere Rechnung ändert nichts (Rückgabe converted=false).
 * Legt die beiden Rewards an — mit sofortiger Einordnung:
 *   referrer  FP                     → not_applicable
 *             sonst                  → pending  (Webhook wendet an, wenn Stripe-Kunde da)
 *   referred                         → pending
 * Rückgabe: { converted, referralId, rewards: [{id, userId, beneficiary, amountCents, status}] }
 */
create or replace function public.referral_mark_converted(
  p_referred_user_id uuid, p_invoice_id text, p_amount_cents integer, p_currency text default 'eur')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ref  public.referrals;
  v_plan text;
  v_rows jsonb;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('converted', false, 'reason', 'betrag_null');
  end if;

  select * into v_ref from public.referrals
   where referred_user_id = p_referred_user_id and status = 'signed_up'
   for update;
  if not found then
    return jsonb_build_object('converted', false, 'reason', 'kein_offenes_referral');
  end if;
  if v_ref.referrer_user_id is null then
    update public.referrals set status = 'invalid', invalid_reason = 'werber_geloescht' where id = v_ref.id;
    return jsonb_build_object('converted', false, 'reason', 'werber_geloescht');
  end if;

  update public.referrals
     set status = 'converted', converted_at = now(), converted_invoice_id = p_invoice_id
   where id = v_ref.id;

  select plan into v_plan from public.user_profiles where id = v_ref.referrer_user_id;

  insert into public.referral_rewards (referral_id, user_id, beneficiary, amount_cents, currency, status, status_reason)
  values
    (v_ref.id, v_ref.referrer_user_id, 'referrer', p_amount_cents, p_currency,
      case when v_plan = 'founding_partner' then 'not_applicable' else 'pending' end,
      case when v_plan = 'founding_partner' then 'founding_partner' else null end),
    (v_ref.id, v_ref.referred_user_id, 'referred', p_amount_cents, p_currency, 'pending', null)
  on conflict (referral_id, beneficiary) do nothing;

  select jsonb_agg(jsonb_build_object('id', r.id, 'userId', r.user_id, 'beneficiary', r.beneficiary,
                                       'amountCents', r.amount_cents, 'currency', r.currency, 'status', r.status))
    into v_rows
    from public.referral_rewards r where r.referral_id = v_ref.id;

  return jsonb_build_object('converted', true, 'referralId', v_ref.id, 'referrerUserId', v_ref.referrer_user_id, 'rewards', coalesce(v_rows, '[]'::jsonb));
end;
$$;
revoke all on function public.referral_mark_converted(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.referral_mark_converted(uuid, text, integer, text) to service_role;

/* Offene (pending) Rewards eines Nutzers mit Stripe-Kunde — was der
   Webhook anwenden soll. */
create or replace function public.referral_rewards_pending_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'userId', r.user_id, 'beneficiary', r.beneficiary,
                                                'amountCents', r.amount_cents, 'currency', r.currency) order by r.created_at), '[]'::jsonb)
    from public.referral_rewards r
   where r.user_id = p_user_id and r.status = 'pending';
$$;
revoke all on function public.referral_rewards_pending_for(uuid) from public, anon, authenticated;
grant execute on function public.referral_rewards_pending_for(uuid) to service_role;

/* Reward als angewendet / fehlgeschlagen vermerken. Nur pending → *;
   ein zweiter Aufruf ändert nichts (false). */
create or replace function public.referral_reward_set_status(p_reward_id uuid, p_status text, p_stripe_object_id text, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_status not in ('applied', 'failed', 'invalid') then
    raise exception 'ungültiger Status' using errcode = '22023';
  end if;
  update public.referral_rewards
     set status = p_status, stripe_object_id = coalesce(p_stripe_object_id, stripe_object_id),
         applied_at = case when p_status = 'applied' then now() else applied_at end,
         status_reason = p_reason
   where id = p_reward_id and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.referral_reward_set_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.referral_reward_set_status(uuid, text, text, text) to service_role;

/* Zahlen für die Einstellungen — nur Zähler und eigene Rewards, keine
   IDs anderer Nutzer. NUR service_role: die Edge Function
   (GET /referral/code) setzt p_user_id aus dem JWT. */
create or replace function public.referral_summary_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'invited',   (select count(*) from public.referrals r where r.referrer_user_id = p_user_id and r.status in ('signed_up', 'converted')),
    'converted', (select count(*) from public.referrals r where r.referrer_user_id = p_user_id and r.status = 'converted'),
    'rewards', (select coalesce(jsonb_agg(jsonb_build_object('status', w.status, 'amountCents', w.amount_cents, 'appliedAt', w.applied_at, 'createdAt', w.created_at) order by w.created_at desc), '[]'::jsonb)
                  from public.referral_rewards w where w.user_id = p_user_id),
    'referredBy', exists (select 1 from public.referrals r where r.referred_user_id = p_user_id and r.status in ('signed_up', 'converted'))
  );
$$;
revoke all on function public.referral_summary_for(uuid) from public, anon, authenticated;
grant execute on function public.referral_summary_for(uuid) to service_role;

/* ═══════════════════════════════════════════════════════════════
   5 — Löschung: Geworbener weg → offenes Referral invalid
   ═══════════════════════════════════════════════════════════════ */
create or replace function public.referral_nach_loeschung()
returns trigger
language plpgsql
as $$
begin
  if new.referred_user_id is null and old.referred_user_id is not null and new.status = 'signed_up' then
    new.status := 'invalid'; new.invalid_reason := 'geworbener_geloescht';
  end if;
  return new;
end;
$$;
drop trigger if exists referrals_nach_loeschung on public.referrals;
create trigger referrals_nach_loeschung before update of referred_user_id on public.referrals
  for each row execute function public.referral_nach_loeschung();

/* Pending Rewards ohne Nutzer (gelöscht) → invalid. */
create or replace function public.referral_reward_nach_loeschung()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is null and old.user_id is not null and new.status = 'pending' then
    new.status := 'invalid'; new.status_reason := 'nutzer_geloescht';
  end if;
  return new;
end;
$$;
drop trigger if exists referral_rewards_nach_loeschung on public.referral_rewards;
create trigger referral_rewards_nach_loeschung before update of user_id on public.referral_rewards
  for each row execute function public.referral_reward_nach_loeschung();

/* ═══════════════════════════════════════════════════════════════
   SELBSTPRÜFUNG
   ═══════════════════════════════════════════════════════════════ */
do $$
declare f text;
begin
  foreach f in array array['public.referral_codes', 'public.referrals', 'public.referral_rewards'] loop
    if not (select relrowsecurity from pg_class where oid = f::regclass) then raise exception '[wp10] % ohne RLS', f; end if;
    if pg_catalog.has_table_privilege('anon', f, 'SELECT') or pg_catalog.has_table_privilege('authenticated', f, 'INSERT')
       or pg_catalog.has_table_privilege('authenticated', f, 'UPDATE') then
      raise exception '[wp10] Client-Rollen zu viel Recht auf %', f;
    end if;
  end loop;
  foreach f in array array['public.referral_mark_converted(uuid,text,integer,text)', 'public.referral_rewards_pending_for(uuid)', 'public.referral_reward_set_status(uuid,text,text,text)', 'public.referral_code_zufall()', 'public.ensure_referral_code(uuid)', 'public.revoke_referral_code(uuid)', 'public.referral_code_gueltig(text)', 'public.referral_summary_for(uuid)'] loop
    if pg_catalog.has_function_privilege('anon', f, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[wp10] Client-Rollen dürfen % ausführen', f;
    end if;
  end loop;
  /* Kanon (20261014120000 / 20261014130000): kein neuer Definer-RPC
     fuer anon oder authenticated — weder volatil noch stabil. Alles
     laeuft ueber die Edge Function mit service_role. */
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and (p.proname like 'referral%' or p.proname in ('ensure_referral_code','revoke_referral_code'))
                and p.prosecdef
                and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'))) then
    raise exception '[wp10] Definer-RPC fuer Client-Rollen — gegen den Rechte-Kanon';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_user_profile_created_referral') then
    raise exception '[wp10] Signup-Trigger fehlt';
  end if;
  raise notice '[wp10] in Ordnung';
end $$;
