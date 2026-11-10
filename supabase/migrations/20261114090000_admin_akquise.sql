-- 20261114090000_admin_akquise.sql
-- WP16 — Admin Akquise + Brevo-Tracking
-- ═══════════════════════════════════════════════════════════════
-- WAS
-- ═══════════════════════════════════════════════════════════════
-- Manuelle Founding-Partner-Akquise aus dem bestehenden Admin:
--   Lead anlegen → personalisieren → Vorschau → EINE Mail bewusst
--   senden → Zustellung/Oeffnung/Klick sehen → Vertriebsstatus
--   manuell pflegen.
--
-- Datenmodell (gemessen am 10.11.2026, main c0e4537):
--   public.leads            Baseline-Tabelle (SmartCheck-Weg), wird um
--                           Akquise-Felder ERWEITERT. leads.status
--                           (new|contacted|converted|rejected|deleted)
--                           bleibt unangetastet — claim_own_lead(),
--                           SmartCheck-Dedupe und Kontoloeschung
--                           haengen daran. Der Vertriebsstatus ist ein
--                           EIGENES Feld: acquisition_status.
--   outreach_messages       ein Datensatz je bewusstem Einzelversand;
--                           Korrelation zu email_queue (email_queue_id)
--                           und Brevo (provider_message_id, Kopie aus
--                           email_queue beim Versand).
--   outreach_email_events   append-only Historie: Brevo-Ereignisse
--                           (Kopie per Trigger aus
--                           communication_delivery_events) PLUS eigene
--                           Link-Ereignisse (Praesentation, CTA).
--                           Ueberlebt das Pruning der email_queue.
--
-- Mail-Ereignis ≠ Vertriebsstatus. Kein Trigger, keine Funktion hier
-- aendert acquisition_status aus einem Brevo-Ereignis. Die einzige
-- automatische Statusaenderung ist der CTA-POST „Ja, Interesse" (der
-- Lead handelt selbst) — und auch die nur aufwaerts.
--
-- Rechte: alles service_role. Keine Client-RPCs, keine Client-Writes.
-- Der Browser spricht mit admin-ops (Admin-JWT) bzw. google-business
-- (oeffentliche Token-Routen). Rechte-Kanon (20261014120000) bleibt.
-- ═══════════════════════════════════════════════════════════════

/* ═══ 1 — leads erweitern ═══ */
alter table public.leads
  add column if not exists website                       text,
  add column if not exists google_profile_url            text,
  add column if not exists personalized_sentence         text,
  add column if not exists acquisition_status            text,
  add column if not exists acquisition_note              text,
  add column if not exists acquisition_status_changed_at timestamptz,
  add column if not exists last_outreach_at              timestamptz,
  add column if not exists updated_at                    timestamptz;

alter table public.leads drop constraint if exists leads_acquisition_status_check;
alter table public.leads add constraint leads_acquisition_status_check check (
  acquisition_status is null or acquisition_status in (
    'neu', 'vorbereitet', 'angeschrieben', 'interesse', 'kein_interesse', 'founding_partner', 'zurueckgestellt'
  ));
alter table public.leads drop constraint if exists leads_akquise_laengen_check;
alter table public.leads add constraint leads_akquise_laengen_check check (
  (website is null or length(website) <= 300)
  and (google_profile_url is null or length(google_profile_url) <= 500)
  and (personalized_sentence is null or length(personalized_sentence) <= 600)
  and (acquisition_note is null or length(acquisition_note) <= 4000));

comment on column public.leads.acquisition_status is
  'WP16 Vertriebsstatus (manuell, fachlich). NULL = nicht in der Akquise. Wird NIE aus Mail-Ereignissen gesetzt; einzige Automatik: CTA-POST → interesse (nur aufwaerts).';
comment on column public.leads.personalized_sentence is
  'WP16 Vom Admin von Hand geschriebener Satz fuer die Founding-Partner-Mail. Keine KI, kein Scraping.';

create index if not exists leads_acquisition_idx on public.leads (acquisition_status, created_at desc)
  where acquisition_status is not null;

/* ═══ 2 — outreach_messages ═══ */
create table if not exists public.outreach_messages (
  id                            uuid primary key default gen_random_uuid(),
  lead_id                       uuid not null references public.leads (id) on delete cascade,
  template                      text not null default 'founding_partner_outreach' check (template = 'founding_partner_outreach'),
  subject                       text not null check (length(subject) between 1 and 300),
  personalized_sentence_snapshot text,
  to_email_snapshot             text not null,
  delivery_mode                 text not null check (delivery_mode in ('production', 'test')),
  status                        text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  email_queue_id                uuid references public.email_queue (id) on delete set null,
  provider_message_id           text,
  error_code                    text,
  link_token_hash               text not null unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key               text not null unique check (length(idempotency_key) between 8 and 120),
  created_by                    uuid,
  created_at                    timestamptz not null default now(),
  sent_at                       timestamptz,
  failed_at                     timestamptz
);
comment on table public.outreach_messages is
  'WP16 Ein Datensatz je bewusstem Admin-Einzelversand der Founding-Partner-Mail. Wahrheit fuer Korrelation: lead_id, email_queue_id, provider_message_id, link_token_hash (SHA-256 des opaken Tokens in den Mail-Links).';

create index if not exists outreach_messages_lead_idx on public.outreach_messages (lead_id, created_at desc);
create index if not exists outreach_messages_queue_idx on public.outreach_messages (email_queue_id) where email_queue_id is not null;
/* Doppelklick/Race: je Lead hoechstens EINE Nachricht in queued. */
create unique index if not exists outreach_messages_one_queued on public.outreach_messages (lead_id) where status = 'queued';

alter table public.outreach_messages enable row level security;
revoke all on table public.outreach_messages from public, anon, authenticated;
grant select, insert, update on table public.outreach_messages to service_role;

/* ═══ 3 — outreach_email_events (append-only) ═══ */
create table if not exists public.outreach_email_events (
  id                  uuid primary key default gen_random_uuid(),
  outreach_message_id uuid not null references public.outreach_messages (id) on delete cascade,
  lead_id             uuid not null references public.leads (id) on delete cascade,
  provider            text not null check (provider in ('brevo', 'werkruf')),
  provider_message_id text,
  event_type          text not null check (event_type in (
    'sent', 'delivered', 'first_open', 'opened', 'clicked',
    'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'unsubscribed', 'error',
    'presentation_clicked', 'cta_viewed', 'cta_clicked')),
  fingerprint         text not null,
  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  constraint outreach_email_events_einmalig unique (outreach_message_id, fingerprint)
);
comment on table public.outreach_email_events is
  'WP16 Technische Historie je Outreach-Mail: Brevo (Kopie aus communication_delivery_events) und eigene Link-Ereignisse. Append-only, keine IP, kein User-Agent, keine Adresse. Aendert nie den Vertriebsstatus.';
create index if not exists outreach_email_events_lead_idx on public.outreach_email_events (lead_id, event_type);
create index if not exists outreach_email_events_msg_idx on public.outreach_email_events (outreach_message_id, occurred_at);

alter table public.outreach_email_events enable row level security;
revoke all on table public.outreach_email_events from public, anon, authenticated;
grant select, insert on table public.outreach_email_events to service_role;

/* ═══ 4 — Mailvorlage + unsubscribed im WP6-Kanon ═══ */
alter table public.email_queue drop constraint if exists email_queue_template_check;
alter table public.email_queue add constraint email_queue_template_check check (template = any (array[
  'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
  'weekly_report', 'weekly_summary', 'visibility_report',
  'critical_review_alert', 'inactivity_reminder', 'payment_failed',
  'support_reply', 'consent_reminder', 'account_deleted',
  'critical_review_free', 'profile_change_alert',
  'founding_partner_outreach'
]));

/* unsubscribed: WP6 ignorierte es (Produktmails haben keinen
   Abmeldelink). Fuer Outreach ist es ein Sperrgrund. record_delivery_event
   bleibt unveraendert — es schreibt jedes erlaubte Ereignis, der
   delivery_status wird davon nicht beruehrt (kein Zustellzustand). */
alter table public.communication_delivery_events drop constraint if exists communication_delivery_events_event_check;
alter table public.communication_delivery_events add constraint communication_delivery_events_event_check check (event in (
  'sent', 'delivered', 'opened', 'clicked',
  'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'error', 'unsubscribed'
));

/* ═══ 5 — Trigger: Queue-Zustand und Brevo-Ereignisse in die Outreach-Historie ═══ */
create or replace function public.outreach_sync_from_queue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.template <> 'founding_partner_outreach' then return new; end if;
  if new.status = 'sent' and (old.status is distinct from 'sent') then
    update public.outreach_messages
       set status = 'sent', sent_at = coalesce(new.sent_at, now()), provider_message_id = new.provider_id, error_code = null
     where email_queue_id = new.id;
    insert into public.outreach_email_events (outreach_message_id, lead_id, provider, provider_message_id, event_type, fingerprint, occurred_at)
    select m.id, m.lead_id, 'werkruf', new.provider_id, 'sent', 'queue:sent:' || new.id::text, coalesce(new.sent_at, now())
      from public.outreach_messages m where m.email_queue_id = new.id
    on conflict (outreach_message_id, fingerprint) do nothing;
  elsif new.status = 'failed' and (old.status is distinct from 'failed') then
    update public.outreach_messages
       set status = 'failed', failed_at = now(), error_code = left(new.error_code, 120)
     where email_queue_id = new.id;
    insert into public.outreach_email_events (outreach_message_id, lead_id, provider, provider_message_id, event_type, fingerprint, occurred_at)
    select m.id, m.lead_id, 'werkruf', null, 'error', 'queue:failed:' || new.id::text || ':' || coalesce(new.attempts, 0)::text, now()
      from public.outreach_messages m where m.email_queue_id = new.id
    on conflict (outreach_message_id, fingerprint) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists outreach_sync_from_queue on public.email_queue;
create trigger outreach_sync_from_queue
  after update of status on public.email_queue
  for each row when (new.template = 'founding_partner_outreach')
  execute function public.outreach_sync_from_queue();

create or replace function public.outreach_copy_delivery_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_msg public.outreach_messages; v_type text;
begin
  if new.template <> 'founding_partner_outreach' then return new; end if;
  select * into v_msg from public.outreach_messages where email_queue_id = new.email_id limit 1;
  if not found then return new; end if;
  /* Brevo 'sent' kommt bereits aus dem Queue-Trigger; 'opened' wird beim
     ersten Mal zu first_open. Alles andere 1:1. */
  if new.event = 'sent' then return new; end if;
  v_type := new.event;
  if new.event = 'opened' then
    if not exists (select 1 from public.outreach_email_events e where e.outreach_message_id = v_msg.id and e.event_type = 'first_open') then
      v_type := 'first_open';
    end if;
  end if;
  insert into public.outreach_email_events (outreach_message_id, lead_id, provider, provider_message_id, event_type, fingerprint, occurred_at)
  values (v_msg.id, v_msg.lead_id, 'brevo', new.provider_message_id, v_type,
          'brevo:' || new.event || ':' || new.provider_message_id || ':' || to_char(new.event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
          new.event_at)
  on conflict (outreach_message_id, fingerprint) do nothing;
  return new;
end;
$$;
drop trigger if exists outreach_copy_delivery_event on public.communication_delivery_events;
create trigger outreach_copy_delivery_event
  after insert on public.communication_delivery_events
  for each row when (new.template = 'founding_partner_outreach')
  execute function public.outreach_copy_delivery_event();

/* ═══ 6 — Sperre (abgeleitet, nie mutiert) ═══ */
create or replace function public.acquisition_block_reason(p_lead_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.event_type
    from public.outreach_email_events e
   where e.lead_id = p_lead_id and e.event_type in ('hard_bounce', 'blocked', 'spam', 'unsubscribed')
   order by case e.event_type when 'unsubscribed' then 0 when 'spam' then 1 when 'hard_bounce' then 2 else 3 end, e.occurred_at desc
   limit 1
$$;
revoke all on function public.acquisition_block_reason(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_block_reason(uuid) to service_role;

/* ═══ 7 — Lead anlegen / aendern / Status ═══ */
create or replace function public.acquisition_normalize_email(p text)
returns text
language sql
immutable
as $$ select lower(btrim(p)) $$;

create or replace function public.acquisition_lead_create(p_admin_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text := public.acquisition_normalize_email(p ->> 'email'); v_id uuid;
begin
  if p_admin_id is null then raise exception 'admin fehlt' using errcode = '42501'; end if;
  if coalesce(btrim(p ->> 'company_name'), '') = '' then raise exception 'company_name fehlt' using errcode = '22023'; end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'ungueltige E-Mail' using errcode = '22023';
  end if;
  insert into public.leads (company_name, contact_person, phone, trade, city, email, source, status, industry_key,
                            website, google_profile_url, personalized_sentence, acquisition_note,
                            acquisition_status, acquisition_status_changed_at, updated_at)
  values (btrim(p ->> 'company_name'), coalesce(nullif(btrim(p ->> 'contact_person'), ''), '-'),
          coalesce(nullif(btrim(p ->> 'phone'), ''), '-'), nullif(btrim(p ->> 'trade'), ''), nullif(btrim(p ->> 'city'), ''),
          v_email, 'admin_akquise', 'new', 'handwerk',
          nullif(btrim(p ->> 'website'), ''), nullif(btrim(p ->> 'google_profile_url'), ''),
          nullif(btrim(p ->> 'personalized_sentence'), ''), nullif(btrim(p ->> 'note'), ''),
          'neu', now(), now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.acquisition_lead_create(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acquisition_lead_create(uuid, jsonb) to service_role;

/* Nur fachliche Felder. Technische (IDs, Events, Zaehler, leads.status) sind nicht erreichbar. */
create or replace function public.acquisition_lead_update(p_admin_id uuid, p_lead_id uuid, p jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text; v_n integer;
begin
  if p_admin_id is null then raise exception 'admin fehlt' using errcode = '42501'; end if;
  if p ? 'email' then
    v_email := public.acquisition_normalize_email(p ->> 'email');
    if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'ungueltige E-Mail' using errcode = '22023';
    end if;
  end if;
  if p ? 'company_name' and coalesce(btrim(p ->> 'company_name'), '') = '' then
    raise exception 'company_name fehlt' using errcode = '22023';
  end if;
  update public.leads
     set company_name          = case when p ? 'company_name' then btrim(p ->> 'company_name') else company_name end,
         contact_person        = case when p ? 'contact_person' then coalesce(nullif(btrim(p ->> 'contact_person'), ''), '-') else contact_person end,
         phone                 = case when p ? 'phone' then coalesce(nullif(btrim(p ->> 'phone'), ''), '-') else phone end,
         trade                 = case when p ? 'trade' then nullif(btrim(p ->> 'trade'), '') else trade end,
         city                  = case when p ? 'city' then nullif(btrim(p ->> 'city'), '') else city end,
         email                 = case when p ? 'email' then v_email else email end,
         website               = case when p ? 'website' then nullif(btrim(p ->> 'website'), '') else website end,
         google_profile_url    = case when p ? 'google_profile_url' then nullif(btrim(p ->> 'google_profile_url'), '') else google_profile_url end,
         personalized_sentence = case when p ? 'personalized_sentence' then nullif(btrim(p ->> 'personalized_sentence'), '') else personalized_sentence end,
         acquisition_note      = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else acquisition_note end,
         acquisition_status    = coalesce(acquisition_status, 'neu'),
         updated_at            = now()
   where id = p_lead_id and status <> 'deleted';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.acquisition_lead_update(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acquisition_lead_update(uuid, uuid, jsonb) to service_role;

/* Manuell: jeder erlaubte Wert. Keine Transition verboten — der Admin
   korrigiert bewusst. Audit macht admin-ops. */
create or replace function public.acquisition_set_status(p_admin_id uuid, p_lead_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_vorher text;
begin
  if p_admin_id is null then raise exception 'admin fehlt' using errcode = '42501'; end if;
  if p_status not in ('neu', 'vorbereitet', 'angeschrieben', 'interesse', 'kein_interesse', 'founding_partner', 'zurueckgestellt') then
    raise exception 'ungueltiger Status' using errcode = '22023';
  end if;
  select acquisition_status into v_vorher from public.leads where id = p_lead_id and status <> 'deleted' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'kein_lead'); end if;
  update public.leads
     set acquisition_status = p_status, acquisition_status_changed_at = now(),
         acquisition_note = case when p_note is not null then left(p_note, 4000) else acquisition_note end,
         updated_at = now()
   where id = p_lead_id;
  return jsonb_build_object('ok', true, 'vorher', v_vorher, 'nachher', p_status);
end;
$$;
revoke all on function public.acquisition_set_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.acquisition_set_status(uuid, uuid, text, text) to service_role;

/* ═══ 8 — Versand beginnen (ein Vorgang je bewusster Aktion) ═══ */
create or replace function public.acquisition_outreach_begin(
  p_admin_id uuid, p_lead_id uuid, p_idempotency_key text, p_subject text,
  p_sentence_snapshot text, p_token_hash text, p_delivery_mode text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_lead public.leads; v_msg uuid; v_queue uuid; v_block text; v_n integer; v_existing public.outreach_messages;
begin
  if p_admin_id is null then raise exception 'admin fehlt' using errcode = '42501'; end if;

  /* Idempotenz: dieselbe bewusste Aktion (Doppelklick, Netz-Retry) → dieselbe Nachricht. */
  select * into v_existing from public.outreach_messages where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'reused', true, 'messageId', v_existing.id, 'emailQueueId', v_existing.email_queue_id, 'status', v_existing.status);
  end if;

  select * into v_lead from public.leads where id = p_lead_id and status <> 'deleted' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'kein_lead'); end if;
  if v_lead.email is null or v_lead.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'keine_email');
  end if;

  v_block := public.acquisition_block_reason(p_lead_id);
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', 'gesperrt', 'grund', v_block); end if;

  if exists (select 1 from public.outreach_messages where lead_id = p_lead_id and status = 'queued') then
    return jsonb_build_object('ok', false, 'reason', 'laeuft_bereits');
  end if;

  /* Schutz gegen UI-/Bug-Schleifen, kein Business-Limit. */
  select count(*) into v_n from public.outreach_messages where created_at > now() - interval '1 hour';
  if v_n >= 20 then return jsonb_build_object('ok', false, 'reason', 'rate_limit'); end if;

  begin
    insert into public.outreach_messages (lead_id, subject, personalized_sentence_snapshot, to_email_snapshot, delivery_mode,
                                          link_token_hash, idempotency_key, created_by)
    values (p_lead_id, p_subject, p_sentence_snapshot, v_lead.email, p_delivery_mode, p_token_hash, p_idempotency_key, p_admin_id)
    returning id into v_msg;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'laeuft_bereits');
  end;

  /* Empfaenger aus der DB-Zeile, nie aus dem Client. user_id bleibt null — Leads haben kein Konto. */
  v_queue := public.enqueue_email('founding_partner_outreach', v_lead.email, 'outreach:' || v_msg::text, null,
                                  nullif(v_lead.contact_person, '-'),
                                  p_payload || jsonb_build_object('outreachMessageId', v_msg, 'leadId', p_lead_id, 'industryKey', 'handwerk'));
  if v_queue is null then
    raise exception 'Mail nicht einreihbar' using errcode = 'P0001';
  end if;
  update public.outreach_messages set email_queue_id = v_queue where id = v_msg;

  /* Fachlich: der Admin hat angeschrieben. Nur aufwaerts aus neu/vorbereitet/NULL. */
  update public.leads
     set last_outreach_at = now(),
         acquisition_status = case when acquisition_status is null or acquisition_status in ('neu', 'vorbereitet') then 'angeschrieben' else acquisition_status end,
         acquisition_status_changed_at = case when acquisition_status is null or acquisition_status in ('neu', 'vorbereitet') then now() else acquisition_status_changed_at end,
         updated_at = now()
   where id = p_lead_id;

  return jsonb_build_object('ok', true, 'reused', false, 'messageId', v_msg, 'emailQueueId', v_queue, 'status', 'queued');
end;
$$;
revoke all on function public.acquisition_outreach_begin(uuid, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.acquisition_outreach_begin(uuid, uuid, text, text, text, text, text, jsonb) to service_role;

/* ═══ 9 — Link-Ereignisse (oeffentliche Token-Routen) ═══ */
/* presentation_clicked, cta_viewed: nur Historie. cta_clicked: Historie +
   einzige automatische Statusaenderung, idempotent, nur aufwaerts. */
create or replace function public.acquisition_link_event(p_token_hash text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_msg public.outreach_messages; v_vorher text; v_neu boolean := false; v_id uuid;
begin
  if p_kind not in ('presentation_clicked', 'cta_viewed', 'cta_clicked') then
    raise exception 'ungueltige Art' using errcode = '22023';
  end if;
  select * into v_msg from public.outreach_messages where link_token_hash = p_token_hash;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unbekannt'); end if;

  if p_kind = 'cta_clicked' then
    insert into public.outreach_email_events (outreach_message_id, lead_id, provider, event_type, fingerprint, occurred_at)
    values (v_msg.id, v_msg.lead_id, 'werkruf', 'cta_clicked', 'cta_clicked', now())
    on conflict (outreach_message_id, fingerprint) do nothing
    returning id into v_id;
    v_neu := v_id is not null;
    select acquisition_status into v_vorher from public.leads where id = v_msg.lead_id for update;
    if v_vorher is null or v_vorher in ('neu', 'vorbereitet', 'angeschrieben', 'zurueckgestellt') then
      update public.leads set acquisition_status = 'interesse', acquisition_status_changed_at = now(), updated_at = now() where id = v_msg.lead_id;
      return jsonb_build_object('ok', true, 'messageId', v_msg.id, 'neu', v_neu, 'statusVorher', v_vorher, 'statusNachher', 'interesse');
    end if;
    return jsonb_build_object('ok', true, 'messageId', v_msg.id, 'neu', v_neu, 'statusVorher', v_vorher, 'statusNachher', v_vorher);
  end if;

  /* Scanner duerfen klicken, so oft sie wollen: nur Historie, Status unberuehrt.
     Fingerprint je Minute haelt die Tabelle klein. */
  insert into public.outreach_email_events (outreach_message_id, lead_id, provider, event_type, fingerprint, occurred_at)
  values (v_msg.id, v_msg.lead_id, 'werkruf', p_kind, p_kind || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), now())
  on conflict (outreach_message_id, fingerprint) do nothing;
  return jsonb_build_object('ok', true, 'messageId', v_msg.id);
end;
$$;
revoke all on function public.acquisition_link_event(text, text) from public, anon, authenticated;
grant execute on function public.acquisition_link_event(text, text) to service_role;

/* ═══ 10 — Lesen: Uebersicht + Detail ═══ */
create or replace function public.acquisition_overview(p_status text default null, p_suche text default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_rows jsonb; v_kpi jsonb; v_q text := nullif(lower(btrim(coalesce(p_suche, ''))), '');
begin
  select coalesce(jsonb_agg(x.zeile order by x.sort desc), '[]'::jsonb) into v_rows
  from (
    select coalesce(l.last_outreach_at, l.updated_at, l.created_at) as sort,
           jsonb_build_object(
             'id', l.id, 'companyName', l.company_name, 'contactPerson', nullif(l.contact_person, '-'), 'email', l.email,
             'city', l.city, 'trade', l.trade, 'website', l.website, 'googleProfileUrl', l.google_profile_url,
             'personalizedSentence', l.personalized_sentence, 'note', l.acquisition_note,
             'acquisitionStatus', l.acquisition_status, 'leadStatus', l.status, 'source', l.source,
             'lastOutreachAt', l.last_outreach_at, 'createdAt', l.created_at,
             'blockReason', public.acquisition_block_reason(l.id),
             'lastMessage', (select jsonb_build_object('id', m.id, 'status', m.status, 'deliveryMode', m.delivery_mode, 'sentAt', m.sent_at, 'errorCode', m.error_code)
                               from public.outreach_messages m where m.lead_id = l.id order by m.created_at desc limit 1),
             'deliveredAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'delivered'),
             'firstOpenAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type in ('first_open', 'opened')),
             'presentationClickedAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'presentation_clicked'),
             'ctaClickedAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'cta_clicked')
           ) as zeile
      from public.leads l
     where l.acquisition_status is not null and l.status <> 'deleted'
       and (p_status is null or p_status = 'alle' or l.acquisition_status = p_status)
       and (v_q is null or lower(l.company_name) like '%' || v_q || '%' or lower(coalesce(l.contact_person, '')) like '%' || v_q || '%' or lower(coalesce(l.email, '')) like '%' || v_q || '%')
     order by 1 desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x;

  /* KPIs: Leads = in Akquise; angeschrieben = mind. eine gesendete Mail; zugestellt/Oeffnung =
     Leads mit mindestens einem Ereignis (nicht Anzahl Ereignisse). */
  select jsonb_build_object(
    'leads', count(*),
    'angeschrieben', count(*) filter (where exists (select 1 from public.outreach_messages m where m.lead_id = l.id and m.status = 'sent')),
    'zugestellt', count(*) filter (where exists (select 1 from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'delivered')),
    'oeffnungErkannt', count(*) filter (where exists (select 1 from public.outreach_email_events e where e.lead_id = l.id and e.event_type in ('first_open', 'opened'))),
    'interesse', count(*) filter (where l.acquisition_status = 'interesse'),
    'foundingPartner', count(*) filter (where l.acquisition_status = 'founding_partner'),
    'gesperrt', count(*) filter (where public.acquisition_block_reason(l.id) is not null))
  into v_kpi
  from public.leads l where l.acquisition_status is not null and l.status <> 'deleted';

  return jsonb_build_object('leads', v_rows, 'kpi', v_kpi);
end;
$$;
revoke all on function public.acquisition_overview(text, text, integer) from public, anon, authenticated;
grant execute on function public.acquisition_overview(text, text, integer) to service_role;

create or replace function public.acquisition_lead_detail(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_lead jsonb; v_msgs jsonb; v_events jsonb;
begin
  select jsonb_build_object(
           'id', l.id, 'companyName', l.company_name, 'contactPerson', nullif(l.contact_person, '-'), 'phone', nullif(l.phone, '-'), 'email', l.email,
           'city', l.city, 'trade', l.trade, 'website', l.website, 'googleProfileUrl', l.google_profile_url,
           'personalizedSentence', l.personalized_sentence, 'note', l.acquisition_note,
           'acquisitionStatus', l.acquisition_status, 'acquisitionStatusChangedAt', l.acquisition_status_changed_at,
           'leadStatus', l.status, 'source', l.source, 'lastOutreachAt', l.last_outreach_at, 'createdAt', l.created_at,
           'blockReason', public.acquisition_block_reason(l.id))
    into v_lead
    from public.leads l where l.id = p_lead_id and l.status <> 'deleted';
  if v_lead is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'deliveryMode', m.delivery_mode, 'subject', m.subject,
           'sentence', m.personalized_sentence_snapshot, 'createdAt', m.created_at, 'sentAt', m.sent_at, 'failedAt', m.failed_at,
           'errorCode', m.error_code, 'hasProviderId', m.provider_message_id is not null) order by m.created_at desc), '[]'::jsonb)
    into v_msgs from public.outreach_messages m where m.lead_id = p_lead_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'messageId', e.outreach_message_id, 'provider', e.provider, 'type', e.event_type,
           'at', e.occurred_at) order by e.occurred_at asc), '[]'::jsonb)
    into v_events from public.outreach_email_events e where e.lead_id = p_lead_id;

  return jsonb_build_object('lead', v_lead, 'messages', v_msgs, 'events', v_events);
end;
$$;
revoke all on function public.acquisition_lead_detail(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_lead_detail(uuid) to service_role;

/* ═══ 11 — Selbstpruefung ═══ */
do $$
declare f text; v_def text;
begin
  foreach f in array array['public.acquisition_lead_create(uuid,jsonb)', 'public.acquisition_lead_update(uuid,uuid,jsonb)',
                           'public.acquisition_set_status(uuid,uuid,text,text)',
                           'public.acquisition_outreach_begin(uuid,uuid,text,text,text,text,text,jsonb)',
                           'public.acquisition_link_event(text,text)', 'public.acquisition_overview(text,text,integer)',
                           'public.acquisition_lead_detail(uuid)', 'public.acquisition_block_reason(uuid)'] loop
    if pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') or pg_catalog.has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[wp16] % ist fuer Clients ausfuehrbar', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp16] % fehlt service_role', f;
    end if;
  end loop;
  foreach f in array array['public.outreach_messages', 'public.outreach_email_events'] loop
    if pg_catalog.has_table_privilege('authenticated', f, 'SELECT') or pg_catalog.has_table_privilege('anon', f, 'SELECT')
       or pg_catalog.has_table_privilege('authenticated', f, 'INSERT') then
      raise exception '[wp16] % ist fuer Clients erreichbar', f;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where indexname = 'outreach_messages_one_queued') then
    raise exception '[wp16] Sperre outreach_messages_one_queued fehlt';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'outreach_copy_delivery_event') then
    raise exception '[wp16] Trigger outreach_copy_delivery_event fehlt';
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'email_queue_template_check';
  if position('founding_partner_outreach' in v_def) = 0 then raise exception '[wp16] Vorlage fehlt im Constraint'; end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'communication_delivery_events_event_check';
  if position('unsubscribed' in v_def) = 0 then raise exception '[wp16] unsubscribed fehlt im Constraint'; end if;
  /* Kein Trigger/Funktion hier setzt acquisition_status aus einem Brevo-Ereignis */
  select pg_get_functiondef('public.outreach_copy_delivery_event'::regproc) into v_def;
  if position('acquisition_status' in v_def) > 0 then raise exception '[wp16] Brevo-Trigger beruehrt Vertriebsstatus'; end if;
  raise notice '[wp16] in Ordnung';
end $$;
