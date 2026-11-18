-- 20261118090000_akquise_antwort_zuerst.sql
-- WP17 — Founding-Partner-Outreach: Antwort zuerst
-- ═══════════════════════════════════════════════════════════════
-- WARUM
-- ═══════════════════════════════════════════════════════════════
-- 158 angeschrieben, 136 zugestellt, 50 Oeffnungen erkannt, 0 Interesse.
-- Die alte Mail (founding_partner_outreach) erklaert Produkt und
-- verlangt eine Entscheidung. Neu: Mail 1 verkauft nichts, sie fragt
-- nur nach einer Antwort — mit einem echten, vorher recherchierten
-- Google-Befund.
--
-- WAS (rueckwaertskompatibel; bestehende Leads/Status/Nachrichten
-- bleiben unveraendert, die alte Vorlage bleibt zustellbar)
--   leads                   + google_profile_finding (Pflicht fuer Mail 1)
--                           + outreach_subject_variant (A|B, einmal vergeben)
--                           + reply_received_at, reply_classification
--                           + followup_sent_at
--   outreach_messages       + Vorlagen outreach_erstkontakt / outreach_nachfass,
--                             subject_variant, finding_snapshot,
--                             parent_message_id (Nachfass → Erstmail);
--                             link_token_hash optional (neue Mails ohne Links)
--   acquisition_block_reason  + negative Antwort sperrt weiteren Versand
--                             (Mail 1 verspricht: „Nein" → keine weitere Nachricht)
--   acquisition_assign_subject_variant  A/B 50:50, stabil
--   acquisition_followup_moeglich       Regel fuer „Nachfassen"
--   acquisition_outreach_send           Mail 1 / Nachfass, Sperren in der DB
--   acquisition_record_reply            Antwort erfassen (≠ Interesse)
--   lead_create/_update, import_rows, overview, lead_detail: + neue Felder
--
-- Threading: Brevo erlaubt keine Standard-Header (In-Reply-To/References,
-- „Standard email headers are not supported", Brevo-API-Doku). Die
-- Nachfass-Mail traegt deshalb denselben Betreff und zitiert die Erstmail;
-- die Brevo-Message-ID beider Mails steht in outreach_messages.
--
-- Rechte: wie WP16 — alles service_role, nichts fuer anon/authenticated.
-- ═══════════════════════════════════════════════════════════════

/* ═══ 1 — leads erweitern ═══ */
alter table public.leads
  add column if not exists google_profile_finding   text,
  add column if not exists outreach_subject_variant text,
  add column if not exists reply_received_at        timestamptz,
  add column if not exists reply_classification     text,
  add column if not exists followup_sent_at         timestamptz;

alter table public.leads drop constraint if exists leads_akquise_antwort_check;
alter table public.leads add constraint leads_akquise_antwort_check check (
  (google_profile_finding is null or length(google_profile_finding) <= 600)
  and (outreach_subject_variant is null or outreach_subject_variant in ('A', 'B'))
  and (reply_classification is null or reply_classification in ('positiv', 'negativ', 'sonstige'))
  /* Klassifikation nur zusammen mit dem Zeitpunkt */
  and ((reply_classification is null) = (reply_received_at is null)));

comment on column public.leads.google_profile_finding is
  'WP17 Von Hand recherchierter Google-Befund (ein Satz) fuer Mail 1. Wird beim Versand nie erzeugt oder veraendert. Ohne Befund kein Versand.';
comment on column public.leads.outreach_subject_variant is
  'WP17 Betreff-Variante A/B fuer Mail 1. Einmal beim Versand vergeben, danach unveraenderlich.';
comment on column public.leads.reply_classification is
  'WP17 Manuell erfasste Antwort (positiv|negativ|sonstige). Antwort ≠ Interesse; negativ sperrt weiteren Versand.';

/* ═══ 2 — outreach_messages: neue Vorlagen ═══ */
alter table public.outreach_messages drop constraint if exists outreach_messages_template_check;
alter table public.outreach_messages add constraint outreach_messages_template_check check (
  template in ('founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass'));
alter table public.outreach_messages
  add column if not exists subject_variant   text,
  add column if not exists finding_snapshot  text,
  add column if not exists parent_message_id uuid references public.outreach_messages (id) on delete set null;
/* Neue Mails haben keine Token-Links. Die alte Vorlage behaelt ihren Hash. */
alter table public.outreach_messages alter column link_token_hash drop not null;
alter table public.outreach_messages drop constraint if exists outreach_messages_wp17_check;
alter table public.outreach_messages add constraint outreach_messages_wp17_check check (
  (subject_variant is null or subject_variant in ('A', 'B'))
  and (template <> 'founding_partner_outreach' or link_token_hash is not null)
  and (template <> 'outreach_erstkontakt' or (subject_variant is not null and finding_snapshot is not null and parent_message_id is null))
  and (template <> 'outreach_nachfass' or parent_message_id is not null));
/* Hoechstens EIN Nachfass je Erstmail — auch bei Race/Doppelklick. */
create unique index if not exists outreach_messages_ein_nachfass on public.outreach_messages (parent_message_id)
  where template = 'outreach_nachfass';

/* ═══ 3 — Mailvorlagen im Queue-Kanon ═══ */
alter table public.email_queue drop constraint if exists email_queue_template_check;
alter table public.email_queue add constraint email_queue_template_check check (template = any (array[
  'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
  'weekly_report', 'weekly_summary', 'visibility_report',
  'critical_review_alert', 'inactivity_reminder', 'payment_failed',
  'support_reply', 'consent_reminder', 'account_deleted',
  'critical_review_free', 'profile_change_alert',
  'founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass'
]));

/* ═══ 4 — Trigger: Queue-Zustand und Brevo-Ereignisse fuer alle Akquise-Vorlagen ═══ */
create or replace function public.outreach_sync_from_queue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.template not in ('founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass') then return new; end if;
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
  for each row when (new.template in ('founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass'))
  execute function public.outreach_sync_from_queue();

create or replace function public.outreach_copy_delivery_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_msg public.outreach_messages; v_type text;
begin
  if new.template not in ('founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass') then return new; end if;
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
  for each row when (new.template in ('founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass'))
  execute function public.outreach_copy_delivery_event();

/* ═══ 5 — Sperre: + negative Antwort ═══
   Mail-Ereignisse zuerst (wie WP16), dann die erfasste Antwort „negativ".
   Abgeleitet, nie als Status gespeichert. */
create or replace function public.acquisition_block_reason(p_lead_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select e.event_type
       from public.outreach_email_events e
      where e.lead_id = p_lead_id and e.event_type in ('hard_bounce', 'blocked', 'spam', 'unsubscribed')
      order by case e.event_type when 'unsubscribed' then 0 when 'spam' then 1 when 'hard_bounce' then 2 else 3 end, e.occurred_at desc
      limit 1),
    (select 'antwort_negativ' from public.leads l where l.id = p_lead_id and l.reply_classification = 'negativ'))
$$;
revoke all on function public.acquisition_block_reason(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_block_reason(uuid) to service_role;

/* ═══ 6 — Betreff-Variante A/B ═══
   Einmal vergeben, nie geaendert. 50:50 als Wechsel: die seltenere
   Variante kommt dran (bei Gleichstand A). Nur fuer versandbereite Leads
   (Befund vorhanden) — sonst NULL. Serialisiert gegen gleichzeitige Klicks. */
create or replace function public.acquisition_assign_subject_variant(p_lead_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_lead public.leads; v_a integer; v_b integer; v_neu text;
begin
  perform pg_advisory_xact_lock(hashtext('wp17:betreff_variante'));
  select * into v_lead from public.leads where id = p_lead_id and status <> 'deleted' for update;
  if not found then return null; end if;
  if v_lead.outreach_subject_variant is not null then return v_lead.outreach_subject_variant; end if;
  if coalesce(btrim(v_lead.google_profile_finding), '') = '' then return null; end if;
  select count(*) filter (where outreach_subject_variant = 'A'), count(*) filter (where outreach_subject_variant = 'B')
    into v_a, v_b from public.leads where outreach_subject_variant is not null;
  v_neu := case when v_a <= v_b then 'A' else 'B' end;
  update public.leads set outreach_subject_variant = v_neu, updated_at = now() where id = p_lead_id;
  return v_neu;
end;
$$;
revoke all on function public.acquisition_assign_subject_variant(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_assign_subject_variant(uuid) to service_role;

/* Variante wird erst zugewiesen; einmal gesetzt, bleibt sie. */
create or replace function public.acquisition_subject_variant_fest()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.outreach_subject_variant is not null and new.outreach_subject_variant is distinct from old.outreach_subject_variant then
    raise exception 'Betreff-Variante ist bereits vergeben' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists acquisition_subject_variant_fest on public.leads;
create trigger acquisition_subject_variant_fest
  before update of outreach_subject_variant on public.leads
  for each row execute function public.acquisition_subject_variant_fest();

/* ═══ 7 — Darf nachgefasst werden? NULL = ja, sonst der Grund ═══ */
create or replace function public.acquisition_followup_moeglich(p_lead_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when l.id is null then 'kein_lead'
    when public.acquisition_block_reason(l.id) is not null then 'gesperrt'
    when l.reply_received_at is not null then 'antwort_erfasst'
    when l.followup_sent_at is not null
      or exists (select 1 from public.outreach_messages m where m.lead_id = l.id and m.template = 'outreach_nachfass' and m.status in ('queued', 'sent'))
      then 'bereits_nachgefasst'
    when not exists (select 1 from public.outreach_messages m where m.lead_id = l.id and m.template = 'outreach_erstkontakt' and m.status = 'sent')
      then 'keine_erstmail'
    else null end
  from (select 1) eins
  left join public.leads l on l.id = p_lead_id and l.status <> 'deleted'
$$;
revoke all on function public.acquisition_followup_moeglich(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_followup_moeglich(uuid) to service_role;

/* ═══ 8 — Lead anlegen / aendern: + google_profile_finding ═══ */
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
                            website, google_profile_url, personalized_sentence, google_profile_finding, acquisition_note,
                            acquisition_status, acquisition_status_changed_at, updated_at)
  values (btrim(p ->> 'company_name'), coalesce(nullif(btrim(p ->> 'contact_person'), ''), '-'),
          coalesce(nullif(btrim(p ->> 'phone'), ''), '-'), nullif(btrim(p ->> 'trade'), ''), nullif(btrim(p ->> 'city'), ''),
          v_email, 'admin_akquise', 'new', 'handwerk',
          nullif(btrim(p ->> 'website'), ''), nullif(btrim(p ->> 'google_profile_url'), ''),
          nullif(btrim(p ->> 'personalized_sentence'), ''), nullif(btrim(p ->> 'google_profile_finding'), ''), nullif(btrim(p ->> 'note'), ''),
          'neu', now(), now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.acquisition_lead_create(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acquisition_lead_create(uuid, jsonb) to service_role;

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
         google_profile_finding = case when p ? 'google_profile_finding' then nullif(btrim(p ->> 'google_profile_finding'), '') else google_profile_finding end,
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

/* ═══ 9 — Import: + google_profile_finding (optional; ohne bleibt der Lead nicht versandbereit) ═══ */
create or replace function public.acquisition_import_rows(
  p_mode text, p_channel text, p_source text, p_external_import_id text, p_rows jsonb, p_created_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch       public.acquisition_imports;
  v_batch_id    uuid;
  r             jsonb;
  w             jsonb;
  v_i           integer;
  v_email       text;
  v_company     text;
  v_web         text;
  v_google      text;
  v_quelle      text;
  v_treffer     uuid;
  v_ergebnis    text;
  v_grund       text;
  v_lead        uuid;
  v_gesehen     text[] := '{}';
  v_zeilen      jsonb := '[]'::jsonb;
  n_new int := 0; n_dup int := 0; n_dup_imp int := 0; n_poss int := 0; n_inv int := 0; n_rows int := 0;
begin
  if p_mode not in ('preview', 'commit') then raise exception 'ungueltiger Modus' using errcode = '22023'; end if;
  if p_channel not in ('csv', 'inbox') then raise exception 'ungueltiger Kanal' using errcode = '22023'; end if;
  if p_source is null or p_source !~ '^[a-z0-9_-]{2,40}$' then raise exception 'ungueltige Quelle' using errcode = '22023'; end if;
  if p_external_import_id is null or length(p_external_import_id) not between 4 and 120 then
    raise exception 'ungueltige Import-ID' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows fehlt' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'hoechstens 1000 Zeilen je Import' using errcode = '22023'; end if;

  if p_mode = 'commit' then
    /* Importe nacheinander: sonst saehen zwei gleichzeitige Dateien mit
       derselben Mail beide „new". */
    perform pg_advisory_xact_lock(hashtext('wp16.1:acquisition_import'));
    insert into public.acquisition_imports (channel, source, external_import_id, created_by)
    values (p_channel, p_source, p_external_import_id, p_created_by)
    on conflict (channel, source, external_import_id) do nothing
    returning id into v_batch_id;
    if v_batch_id is null then
      /* Derselbe Import noch einmal (Doppelklick, Wiederholung der Inbox):
         gespeichertes Ergebnis, nichts angelegt. */
      select * into v_batch from public.acquisition_imports
       where channel = p_channel and source = p_source and external_import_id = p_external_import_id;
      return jsonb_build_object(
        'ok', true, 'mode', 'commit', 'reused', true, 'importId', v_batch.id,
        'counts', jsonb_build_object('rows', v_batch.row_count, 'new', v_batch.new_count, 'duplicate', v_batch.duplicate_count,
          'duplicateInImport', v_batch.duplicate_in_import_count, 'possibleDuplicate', v_batch.possible_duplicate_count,
          'invalid', v_batch.invalid_count),
        'rows', '[]'::jsonb);
    end if;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n_rows := n_rows + 1;
    v_i := coalesce((r ->> 'i')::integer, n_rows);
    w := r -> 'werte';
    v_ergebnis := null; v_grund := null; v_treffer := null; v_lead := null;
    v_email := lower(btrim(coalesce(w ->> 'email', '')));
    v_company := btrim(coalesce(w ->> 'company_name', ''));
    v_quelle := nullif(left(btrim(coalesce(r ->> 'quelle', '')), 60), '');

    if r ->> 'fehler' is not null or w is null or jsonb_typeof(w) <> 'object' then
      v_ergebnis := 'invalid'; v_grund := left(coalesce(r ->> 'fehler', 'Zeile unlesbar'), 200);
    elsif v_company = '' then
      v_ergebnis := 'invalid'; v_grund := 'Betrieb (company_name) fehlt';
    elsif v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_ergebnis := 'invalid'; v_grund := 'E-Mail ist ungültig';
    elsif v_email = any (v_gesehen) then
      v_ergebnis := 'duplicate_in_import'; v_grund := 'Gleiche E-Mail weiter oben in dieser Datei';
    else
      v_gesehen := array_append(v_gesehen, v_email);
      select l.id into v_treffer from public.leads l
       where lower(btrim(l.email)) = v_email and l.status <> 'deleted'
       order by l.created_at limit 1;
      if v_treffer is not null then
        v_ergebnis := 'duplicate'; v_grund := 'E-Mail existiert bereits';
      else
        v_web := public.acquisition_website_key(w ->> 'website');
        v_google := public.acquisition_google_key(w ->> 'google_profile_url');
        if v_web is not null then
          select l.id into v_treffer from public.leads l
           where l.status <> 'deleted' and l.website is not null and public.acquisition_website_key(l.website) = v_web
           order by l.created_at limit 1;
          if v_treffer is not null then v_ergebnis := 'possible_duplicate'; v_grund := 'Gleiche Website wie ein bestehender Lead'; end if;
        end if;
        if v_ergebnis is null and v_google is not null then
          select l.id into v_treffer from public.leads l
           where l.status <> 'deleted' and l.google_profile_url is not null and public.acquisition_google_key(l.google_profile_url) = v_google
           order by l.created_at limit 1;
          if v_treffer is not null then v_ergebnis := 'possible_duplicate'; v_grund := 'Gleiches Google-Profil wie ein bestehender Lead'; end if;
        end if;
        if v_ergebnis is null then v_ergebnis := 'new'; end if;
      end if;
    end if;

    if v_ergebnis = 'new' and p_mode = 'commit' then
      insert into public.leads (company_name, contact_person, phone, trade, city, email, source, status, industry_key,
                                website, google_profile_url, personalized_sentence, google_profile_finding, acquisition_note,
                                acquisition_status, acquisition_status_changed_at, updated_at,
                                acquisition_import_id, acquisition_source)
      values (v_company, coalesce(nullif(btrim(w ->> 'contact_person'), ''), '-'), coalesce(nullif(btrim(w ->> 'phone'), ''), '-'),
              nullif(btrim(w ->> 'trade'), ''), nullif(btrim(w ->> 'city'), ''), v_email,
              case when p_channel = 'csv' then 'akquise_import' else 'akquise_inbox' end, 'new', 'handwerk',
              nullif(btrim(w ->> 'website'), ''), nullif(btrim(w ->> 'google_profile_url'), ''),
              nullif(btrim(w ->> 'personalized_sentence'), ''), nullif(btrim(w ->> 'google_profile_finding'), ''), nullif(btrim(w ->> 'note'), ''),
              'neu', now(), now(), v_batch_id, coalesce(v_quelle, p_source))
      returning id into v_lead;
    end if;

    case v_ergebnis
      when 'new' then n_new := n_new + 1;
      when 'duplicate' then n_dup := n_dup + 1;
      when 'duplicate_in_import' then n_dup_imp := n_dup_imp + 1;
      when 'possible_duplicate' then n_poss := n_poss + 1;
      else n_inv := n_inv + 1;
    end case;

    v_zeilen := v_zeilen || jsonb_build_object(
      'i', v_i, 'status', v_ergebnis, 'grund', v_grund,
      'leadId', coalesce(v_lead, case when v_ergebnis in ('duplicate', 'possible_duplicate') then v_treffer end),
      'companyName', nullif(v_company, ''), 'email', nullif(v_email, ''));
  end loop;

  if p_mode = 'commit' then
    update public.acquisition_imports
       set row_count = n_rows, new_count = n_new, duplicate_count = n_dup, duplicate_in_import_count = n_dup_imp,
           possible_duplicate_count = n_poss, invalid_count = n_inv, committed_at = now()
     where id = v_batch_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'mode', p_mode, 'reused', false, 'importId', v_batch_id,
    'counts', jsonb_build_object('rows', n_rows, 'new', n_new, 'duplicate', n_dup, 'duplicateInImport', n_dup_imp,
                                 'possibleDuplicate', n_poss, 'invalid', n_inv),
    'rows', v_zeilen);
end;
$$;
revoke all on function public.acquisition_import_rows(text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.acquisition_import_rows(text, text, text, text, jsonb, uuid) to service_role;

/* ═══ 10 — Uebersicht: Antworten, Nachfass, A/B ═══ */
create or replace function public.acquisition_overview(
  p_status text default null, p_suche text default null, p_limit integer default 100, p_import_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_rows jsonb; v_kpi jsonb; v_varianten jsonb; v_q text := nullif(lower(btrim(coalesce(p_suche, ''))), '');
begin
  select coalesce(jsonb_agg(x.zeile order by x.sort desc), '[]'::jsonb) into v_rows
  from (
    select coalesce(l.last_outreach_at, l.updated_at, l.created_at) as sort,
           jsonb_build_object(
             'id', l.id, 'companyName', l.company_name, 'contactPerson', nullif(l.contact_person, '-'), 'email', l.email,
             'city', l.city, 'trade', l.trade, 'website', l.website, 'googleProfileUrl', l.google_profile_url,
             'personalizedSentence', l.personalized_sentence, 'googleProfileFinding', l.google_profile_finding, 'note', l.acquisition_note,
             'subjectVariant', l.outreach_subject_variant, 'replyReceivedAt', l.reply_received_at, 'replyClassification', l.reply_classification,
             'followupSentAt', l.followup_sent_at, 'followupMoeglich', public.acquisition_followup_moeglich(l.id) is null,
             'acquisitionStatus', l.acquisition_status, 'leadStatus', l.status, 'source', l.source,
             'acquisitionSource', l.acquisition_source, 'importId', l.acquisition_import_id,
             'lastOutreachAt', l.last_outreach_at, 'createdAt', l.created_at,
             'blockReason', public.acquisition_block_reason(l.id),
             'lastMessage', (select jsonb_build_object('id', m.id, 'template', m.template, 'status', m.status, 'deliveryMode', m.delivery_mode, 'sentAt', m.sent_at, 'errorCode', m.error_code)
                               from public.outreach_messages m where m.lead_id = l.id order by m.created_at desc limit 1),
             'deliveredAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'delivered'),
             'firstOpenAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type in ('first_open', 'opened')),
             'presentationClickedAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'presentation_clicked'),
             'ctaClickedAt', (select min(e.occurred_at) from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'cta_clicked')
           ) as zeile
      from public.leads l
     where l.acquisition_status is not null and l.status <> 'deleted'
       and (p_status is null or p_status = 'alle' or l.acquisition_status = p_status)
       and (p_import_id is null or l.acquisition_import_id = p_import_id)
       and (v_q is null or lower(l.company_name) like '%' || v_q || '%' or lower(coalesce(l.contact_person, '')) like '%' || v_q || '%' or lower(coalesce(l.email, '')) like '%' || v_q || '%')
     order by 1 desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x;

  select jsonb_build_object(
    'leads', count(*),
    'neu', count(*) filter (where l.acquisition_status = 'neu'),
    'angeschrieben', count(*) filter (where exists (select 1 from public.outreach_messages m where m.lead_id = l.id and m.status = 'sent')),
    'zugestellt', count(*) filter (where exists (select 1 from public.outreach_email_events e where e.lead_id = l.id and e.event_type = 'delivered')),
    'oeffnungErkannt', count(*) filter (where exists (select 1 from public.outreach_email_events e where e.lead_id = l.id and e.event_type in ('first_open', 'opened'))),
    'antworten', count(*) filter (where l.reply_received_at is not null),
    'antwortenPositiv', count(*) filter (where l.reply_classification = 'positiv'),
    'antwortenNegativ', count(*) filter (where l.reply_classification = 'negativ'),
    'antwortenSonstige', count(*) filter (where l.reply_classification = 'sonstige'),
    'nachgefasst', count(*) filter (where l.followup_sent_at is not null),
    'interesse', count(*) filter (where l.acquisition_status = 'interesse'),
    'foundingPartner', count(*) filter (where l.acquisition_status = 'founding_partner'),
    'gesperrt', count(*) filter (where public.acquisition_block_reason(l.id) is not null))
  into v_kpi
  from public.leads l where l.acquisition_status is not null and l.status <> 'deleted';

  /* A/B-Test: nur Leads mit vergebener Betreff-Variante (neue Erstkontakte). */
  select coalesce(jsonb_object_agg(v.variante, v.werte), '{}'::jsonb) into v_varianten from (
    select l.outreach_subject_variant as variante, jsonb_build_object(
      'leads', count(*),
      'angeschrieben', count(*) filter (where exists (select 1 from public.outreach_messages m where m.lead_id = l.id and m.template = 'outreach_erstkontakt' and m.status = 'sent')),
      'zugestellt', count(*) filter (where exists (select 1 from public.outreach_email_events e join public.outreach_messages m on m.id = e.outreach_message_id
                                                    where e.lead_id = l.id and e.event_type = 'delivered' and m.template = 'outreach_erstkontakt')),
      'oeffnungErkannt', count(*) filter (where exists (select 1 from public.outreach_email_events e join public.outreach_messages m on m.id = e.outreach_message_id
                                                    where e.lead_id = l.id and e.event_type in ('first_open', 'opened') and m.template = 'outreach_erstkontakt')),
      'antworten', count(*) filter (where l.reply_received_at is not null),
      'antwortenPositiv', count(*) filter (where l.reply_classification = 'positiv'),
      'interesse', count(*) filter (where l.acquisition_status = 'interesse')) as werte
      from public.leads l
     where l.acquisition_status is not null and l.status <> 'deleted' and l.outreach_subject_variant is not null
     group by l.outreach_subject_variant) v;

  return jsonb_build_object('leads', v_rows, 'kpi', v_kpi, 'varianten', v_varianten);
end;
$$;
revoke all on function public.acquisition_overview(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.acquisition_overview(text, text, integer, uuid) to service_role;

/* ═══ 11 — Detail ═══ */
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
           'personalizedSentence', l.personalized_sentence, 'googleProfileFinding', l.google_profile_finding, 'note', l.acquisition_note,
           'subjectVariant', l.outreach_subject_variant, 'replyReceivedAt', l.reply_received_at, 'replyClassification', l.reply_classification,
           'followupSentAt', l.followup_sent_at, 'followupGrund', public.acquisition_followup_moeglich(l.id),
           'acquisitionStatus', l.acquisition_status, 'acquisitionStatusChangedAt', l.acquisition_status_changed_at,
           'leadStatus', l.status, 'source', l.source, 'lastOutreachAt', l.last_outreach_at, 'createdAt', l.created_at,
           'blockReason', public.acquisition_block_reason(l.id))
    into v_lead
    from public.leads l where l.id = p_lead_id and l.status <> 'deleted';
  if v_lead is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'template', m.template, 'subjectVariant', m.subject_variant, 'parentId', m.parent_message_id,
           'status', m.status, 'deliveryMode', m.delivery_mode, 'subject', m.subject, 'finding', m.finding_snapshot,
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

/* ═══ 12 — Versand: Mail 1 (Erstkontakt) und Nachfass ═══
   Ein Vorgang je bewusster Admin-Aktion. Alle fachlichen Sperren hier,
   nicht im Browser:
     Mail 1   Befund Pflicht, Variante vergeben, noch nie angeschrieben
     Nachfass acquisition_followup_moeglich() = NULL; Betreff und Befund
              kommen aus der Erstmail, nicht vom Aufrufer
   Empfaenger immer aus der DB-Zeile. */
create or replace function public.acquisition_outreach_send(
  p_admin_id uuid, p_lead_id uuid, p_idempotency_key text, p_template text,
  p_subject text, p_delivery_mode text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead public.leads; v_existing public.outreach_messages; v_parent public.outreach_messages;
  v_block text; v_grund text; v_n integer; v_msg uuid; v_queue uuid;
  v_subject text; v_variante text; v_befund text; v_parent_id uuid;
begin
  if p_admin_id is null then raise exception 'admin fehlt' using errcode = '42501'; end if;
  if p_template not in ('outreach_erstkontakt', 'outreach_nachfass') then
    raise exception 'ungueltige Vorlage' using errcode = '22023';
  end if;
  if p_delivery_mode not in ('production', 'test') then raise exception 'ungueltiger Modus' using errcode = '22023'; end if;

  /* Idempotenz: Doppelklick/Netz-Retry → dieselbe Nachricht. */
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

  if p_template = 'outreach_erstkontakt' then
    v_befund := nullif(btrim(coalesce(v_lead.google_profile_finding, '')), '');
    if v_befund is null then return jsonb_build_object('ok', false, 'reason', 'befund_fehlt'); end if;
    if v_lead.outreach_subject_variant is null then return jsonb_build_object('ok', false, 'reason', 'variante_fehlt'); end if;
    /* Wer schon eine Akquise-Mail bekommen hat (auch die alte FP-Mail),
       bekommt keine zweite Erstmail. */
    if exists (select 1 from public.outreach_messages where lead_id = p_lead_id and status = 'sent') then
      return jsonb_build_object('ok', false, 'reason', 'bereits_angeschrieben');
    end if;
    v_variante := v_lead.outreach_subject_variant;
    v_subject := p_subject;
    if coalesce(btrim(v_subject), '') = '' then raise exception 'Betreff fehlt' using errcode = '22023'; end if;
  else
    v_grund := public.acquisition_followup_moeglich(p_lead_id);
    if v_grund is not null then return jsonb_build_object('ok', false, 'reason', 'nachfass_nicht_moeglich', 'grund', v_grund); end if;
    select * into v_parent from public.outreach_messages
     where lead_id = p_lead_id and template = 'outreach_erstkontakt' and status = 'sent'
     order by created_at desc limit 1;
    v_parent_id := v_parent.id; v_subject := v_parent.subject; v_variante := v_parent.subject_variant; v_befund := v_parent.finding_snapshot;
  end if;

  /* Schutz gegen UI-/Bug-Schleifen (wie WP16), gemeinsam fuer alle Akquise-Mails. */
  select count(*) into v_n from public.outreach_messages where created_at > now() - interval '1 hour';
  if v_n >= 20 then return jsonb_build_object('ok', false, 'reason', 'rate_limit'); end if;

  begin
    insert into public.outreach_messages (lead_id, template, subject, subject_variant, finding_snapshot, parent_message_id,
                                          to_email_snapshot, delivery_mode, idempotency_key, created_by)
    values (p_lead_id, p_template, v_subject, v_variante, v_befund, v_parent_id,
            v_lead.email, p_delivery_mode, p_idempotency_key, p_admin_id)
    returning id into v_msg;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'laeuft_bereits');
  end;

  v_queue := public.enqueue_email(p_template, v_lead.email, 'outreach:' || v_msg::text, null,
                                  nullif(v_lead.contact_person, '-'),
                                  coalesce(p_payload, '{}'::jsonb)
                                  || jsonb_build_object('subject', v_subject, 'outreachMessageId', v_msg, 'leadId', p_lead_id, 'industryKey', 'handwerk'));
  if v_queue is null then raise exception 'Mail nicht einreihbar' using errcode = 'P0001'; end if;
  update public.outreach_messages set email_queue_id = v_queue where id = v_msg;

  if p_template = 'outreach_erstkontakt' then
    update public.leads
       set last_outreach_at = now(),
           acquisition_status = case when acquisition_status is null or acquisition_status in ('neu', 'vorbereitet') then 'angeschrieben' else acquisition_status end,
           acquisition_status_changed_at = case when acquisition_status is null or acquisition_status in ('neu', 'vorbereitet') then now() else acquisition_status_changed_at end,
           updated_at = now()
     where id = p_lead_id;
  else
    update public.leads set followup_sent_at = now(), last_outreach_at = now(), updated_at = now() where id = p_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'reused', false, 'messageId', v_msg, 'emailQueueId', v_queue, 'status', 'queued',
                            'subject', v_subject, 'subjectVariant', v_variante);
end;
$$;
revoke all on function public.acquisition_outreach_send(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.acquisition_outreach_send(uuid, uuid, text, text, text, text, jsonb) to service_role;

/* ═══ 13 — Antwort erfassen ═══
   Antwort ≠ Interesse:
     positiv   → Antwort + Interesse (nur aufwaerts; Founding Partner bleibt)
     negativ   → Antwort + kein Interesse (aus offenen Zustaenden) + Versandsperre
     sonstige  → nur Antwort, Status unveraendert
   Der erste Antwortzeitpunkt bleibt; die Klassifikation darf korrigiert werden. */
create or replace function public.acquisition_record_reply(p_admin_id uuid, p_lead_id uuid, p_klasse text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_vorher text; v_nachher text;
begin
  if p_admin_id is null then raise exception 'admin fehlt' using errcode = '42501'; end if;
  if p_klasse not in ('positiv', 'negativ', 'sonstige') then raise exception 'ungueltige Klassifikation' using errcode = '22023'; end if;
  select acquisition_status into v_vorher from public.leads where id = p_lead_id and status <> 'deleted' and acquisition_status is not null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'kein_lead'); end if;
  v_nachher := v_vorher;
  if p_klasse = 'positiv' and v_vorher in ('neu', 'vorbereitet', 'angeschrieben', 'zurueckgestellt', 'kein_interesse') then
    v_nachher := 'interesse';
  elsif p_klasse = 'negativ' and v_vorher in ('neu', 'vorbereitet', 'angeschrieben', 'zurueckgestellt') then
    v_nachher := 'kein_interesse';
  end if;
  update public.leads
     set reply_received_at = coalesce(reply_received_at, now()),
         reply_classification = p_klasse,
         acquisition_status = v_nachher,
         acquisition_status_changed_at = case when v_nachher is distinct from v_vorher then now() else acquisition_status_changed_at end,
         updated_at = now()
   where id = p_lead_id;
  return jsonb_build_object('ok', true, 'klasse', p_klasse, 'vorher', v_vorher, 'nachher', v_nachher);
end;
$$;
revoke all on function public.acquisition_record_reply(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.acquisition_record_reply(uuid, uuid, text) to service_role;

/* ═══ 14 — Selbstpruefung ═══ */
do $$
declare f text; v_def text;
begin
  foreach f in array array['public.acquisition_outreach_send(uuid,uuid,text,text,text,text,jsonb)',
                           'public.acquisition_record_reply(uuid,uuid,text)',
                           'public.acquisition_assign_subject_variant(uuid)', 'public.acquisition_followup_moeglich(uuid)',
                           'public.acquisition_block_reason(uuid)', 'public.acquisition_overview(text,text,integer,uuid)',
                           'public.acquisition_lead_detail(uuid)', 'public.acquisition_lead_create(uuid,jsonb)',
                           'public.acquisition_lead_update(uuid,uuid,jsonb)',
                           'public.acquisition_import_rows(text,text,text,text,jsonb,uuid)'] loop
    if pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') or pg_catalog.has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[wp17] % ist fuer Clients ausfuehrbar', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp17] % fehlt service_role', f;
    end if;
  end loop;
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'email_queue_template_check';
  if position('outreach_erstkontakt' in v_def) = 0 or position('outreach_nachfass' in v_def) = 0
     or position('founding_partner_outreach' in v_def) = 0 then
    raise exception '[wp17] Vorlagen fehlen im Queue-Constraint';
  end if;
  foreach f in array array['outreach_sync_from_queue', 'outreach_copy_delivery_event'] loop
    select pg_get_triggerdef(oid) into v_def from pg_trigger where tgname = f;
    if v_def is null or position('outreach_erstkontakt' in v_def) = 0 or position('outreach_nachfass' in v_def) = 0 then
      raise exception '[wp17] Trigger % erfasst die neuen Vorlagen nicht', f;
    end if;
  end loop;
  /* Mail-Ereignisse aendern weiterhin keinen Vertriebsstatus */
  select pg_get_functiondef('public.outreach_copy_delivery_event'::regproc) into v_def;
  if position('acquisition_status' in v_def) > 0 then raise exception '[wp17] Brevo-Trigger beruehrt Vertriebsstatus'; end if;
  /* Importpfad: sendet nichts, setzt keinen Status ausser neu (wie WP16.1) */
  select pg_get_functiondef('public.acquisition_import_rows(text,text,text,text,jsonb,uuid)'::regprocedure) into v_def;
  if position('enqueue_email' in v_def) > 0 or position('outreach_messages' in v_def) > 0
     or position('''interesse''' in v_def) > 0 or position('update public.leads' in v_def) > 0 then
    raise exception '[wp17] Importpfad sendet, setzt Status oder ueberschreibt Leads';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'outreach_messages_ein_nachfass') then
    raise exception '[wp17] Sperre outreach_messages_ein_nachfass fehlt';
  end if;
  raise notice '[wp17] in Ordnung';
end $$;
