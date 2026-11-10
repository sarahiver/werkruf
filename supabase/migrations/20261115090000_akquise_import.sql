-- 20261115090000_akquise_import.sql
-- WP16.1 — Lead-Import (CSV + externe Lead-Inbox)
-- ═══════════════════════════════════════════════════════════════
-- EIN Importpfad fuer zwei Eingaenge:
--   CSV        Admin laedt eine Datei hoch → Vorschau → Bestaetigung
--   Inbox      Server-zu-Server (Secret) → direkt commit
--
--   Edge Function (admin-ops) bereitet jede Zeile mit dem bestehenden
--   Lead-Kanon auf (pruefeLeadEingabe, src/utils/akquiseImport.js) und
--   uebergibt sie hier. Diese Funktion entscheidet verbindlich:
--
--     new                  wird bei commit angelegt (acquisition_status neu)
--     duplicate            gleiche normalisierte Mail existiert → nie angelegt
--     duplicate_in_import  gleiche Mail weiter oben in DIESEM Import
--     possible_duplicate   gleicher Website-Host oder gleiche Google-Profil-URL
--                          → NICHT automatisch angelegt (Admin prueft)
--     invalid              Pflichtfelder/Format → nie angelegt
--
-- INSERT NEW ONLY. Bestehende Leads werden nie veraendert (kein Upsert).
-- Kein Mailversand, kein Status ausser 'neu', kein Founding Partner.
--
-- Idempotenz: acquisition_imports ist unique je (channel, source,
-- external_import_id). Ein zweiter commit mit derselben Import-ID liefert
-- das gespeicherte Ergebnis (reused) und legt nichts an. Gleichzeitige
-- Importe laufen ueber pg_advisory_xact_lock nacheinander, damit zwei
-- Dateien mit derselben Mail nicht beide „new" sehen.
--
-- Preview schreibt NICHTS — nicht einmal den Batch.
-- ═══════════════════════════════════════════════════════════════

/* ═══ 1 — Batch ═══ */
create table if not exists public.acquisition_imports (
  id                        uuid primary key default gen_random_uuid(),
  channel                   text not null check (channel in ('csv', 'inbox')),
  source                    text not null check (source ~ '^[a-z0-9_-]{2,40}$'),
  external_import_id        text not null check (length(external_import_id) between 4 and 120),
  row_count                 integer not null default 0,
  new_count                 integer not null default 0,
  duplicate_count           integer not null default 0,
  duplicate_in_import_count integer not null default 0,
  possible_duplicate_count  integer not null default 0,
  invalid_count             integer not null default 0,
  created_by                uuid,
  created_at                timestamptz not null default now(),
  committed_at              timestamptz,
  constraint acquisition_imports_einmalig unique (channel, source, external_import_id)
);
comment on table public.acquisition_imports is
  'WP16.1 Ein Datensatz je bestaetigtem Lead-Import (CSV oder Inbox). Nur Zaehler, keine Datei, keine Zeileninhalte. Unique je Quelle + Import-ID = Idempotenz.';

alter table public.acquisition_imports enable row level security;
revoke all on table public.acquisition_imports from public, anon, authenticated;
grant select, insert, update on table public.acquisition_imports to service_role;

/* ═══ 2 — leads: Herkunft des Imports ═══ */
alter table public.leads
  add column if not exists acquisition_import_id uuid references public.acquisition_imports (id) on delete set null,
  add column if not exists acquisition_source    text;
alter table public.leads drop constraint if exists leads_acquisition_source_check;
alter table public.leads add constraint leads_acquisition_source_check
  check (acquisition_source is null or length(acquisition_source) <= 60);
create index if not exists leads_acquisition_import_idx on public.leads (acquisition_import_id) where acquisition_import_id is not null;

comment on column public.leads.acquisition_source is
  'WP16.1 Freitext-Herkunft aus der Importzeile (z. B. chatgpt_recherche, messe). Rein informativ.';

/* ═══ 3 — Normalisierung fuer Dedupe ═══ */
/* Host einer Website: ohne Schema, ohne www., ohne Port/Pfad, klein.
   Fuer geteilte Plattformen (Facebook, Google …) zaehlt der Host allein
   nichts — dort gilt die volle URL (Host + Pfad), sonst waere jeder
   zweite Facebook-Lead eine „moegliche Dublette". */
create or replace function public.acquisition_website_key(p text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare v text; v_host text; v_pfad text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  v := lower(btrim(p));
  v := regexp_replace(v, '^[a-z]+://', '');
  v := regexp_replace(v, '[?#].*$', '');
  v := regexp_replace(v, '/+$', '');
  v_host := split_part(v, '/', 1);
  v_host := regexp_replace(v_host, ':[0-9]+$', '');
  v_host := regexp_replace(v_host, '^www\.', '');
  if v_host = '' then return null; end if;
  if v_host in ('facebook.com', 'm.facebook.com', 'instagram.com', 'google.com', 'maps.google.com', 'g.page',
                'goo.gl', 'maps.app.goo.gl', 'business.site', 'linktr.ee', 'wixsite.com', 'jimdo.com',
                'jimdofree.com', 'gelbeseiten.de', 'myhammer.de', 'xing.com', 'linkedin.com', 'site.google.com') then
    v_pfad := nullif(substr(v, length(split_part(v, '/', 1)) + 1), '');
    return 'url:' || v_host || coalesce(v_pfad, '');
  end if;
  return 'host:' || v_host;
end;
$$;

/* Google-Profil-URL: klein, ohne Schema, ohne www., ohne Schraegstrich
   am Ende. Query bleibt (cid=… identifiziert den Betrieb). */
create or replace function public.acquisition_google_key(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when p is null or btrim(p) = '' then null
              else regexp_replace(regexp_replace(regexp_replace(lower(btrim(p)), '^[a-z]+://', ''), '^www\.', ''), '/+$', '') end
$$;

revoke all on function public.acquisition_website_key(text) from public, anon, authenticated;
revoke all on function public.acquisition_google_key(text) from public, anon, authenticated;
grant execute on function public.acquisition_website_key(text) to service_role;
grant execute on function public.acquisition_google_key(text) to service_role;

/* ═══ 4 — Der Importpfad ═══
   p_rows: [{ "i": <Zeilennummer>, "werte": {company_name, email, …} | null,
              "quelle": <Herkunft je Zeile> | null, "fehler": <Grund> | null }]
   Die Werte kommen bereits durch pruefeLeadEingabe (Edge Function);
   hier wird Pflicht + Mailform erneut geprueft (zweite Verteidigung). */
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
                                website, google_profile_url, personalized_sentence, acquisition_note,
                                acquisition_status, acquisition_status_changed_at, updated_at,
                                acquisition_import_id, acquisition_source)
      values (v_company, coalesce(nullif(btrim(w ->> 'contact_person'), ''), '-'), coalesce(nullif(btrim(w ->> 'phone'), ''), '-'),
              nullif(btrim(w ->> 'trade'), ''), nullif(btrim(w ->> 'city'), ''), v_email,
              case when p_channel = 'csv' then 'akquise_import' else 'akquise_inbox' end, 'new', 'handwerk',
              nullif(btrim(w ->> 'website'), ''), nullif(btrim(w ->> 'google_profile_url'), ''),
              nullif(btrim(w ->> 'personalized_sentence'), ''), nullif(btrim(w ->> 'note'), ''),
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

/* ═══ 5 — Uebersicht: Filter je Import, KPI „neu" ═══
   Gleiche Funktion wie WP16 (20261114090000), plus p_import_id und
   kpi.neu. Die alte Signatur entfaellt, damit Aufrufe eindeutig bleiben. */
drop function if exists public.acquisition_overview(text, text, integer);
create or replace function public.acquisition_overview(
  p_status text default null, p_suche text default null, p_limit integer default 100, p_import_id uuid default null)
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
             'acquisitionSource', l.acquisition_source, 'importId', l.acquisition_import_id,
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
    'interesse', count(*) filter (where l.acquisition_status = 'interesse'),
    'foundingPartner', count(*) filter (where l.acquisition_status = 'founding_partner'),
    'gesperrt', count(*) filter (where public.acquisition_block_reason(l.id) is not null))
  into v_kpi
  from public.leads l where l.acquisition_status is not null and l.status <> 'deleted';

  return jsonb_build_object('leads', v_rows, 'kpi', v_kpi);
end;
$$;
revoke all on function public.acquisition_overview(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.acquisition_overview(text, text, integer, uuid) to service_role;

/* ═══ 6 — Selbstpruefung ═══ */
do $$
declare f text; v_def text;
begin
  foreach f in array array['public.acquisition_import_rows(text,text,text,text,jsonb,uuid)',
                           'public.acquisition_overview(text,text,integer,uuid)',
                           'public.acquisition_website_key(text)', 'public.acquisition_google_key(text)'] loop
    if pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') or pg_catalog.has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[wp16.1] % ist fuer Clients ausfuehrbar', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp16.1] % fehlt service_role', f;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('authenticated', 'public.acquisition_imports', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.acquisition_imports', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.acquisition_imports', 'INSERT') then
    raise exception '[wp16.1] acquisition_imports ist fuer Clients erreichbar';
  end if;
  if exists (select 1 from pg_proc where proname = 'acquisition_overview' and pronargs = 3 and pronamespace = 'public'::regnamespace) then
    raise exception '[wp16.1] alte acquisition_overview(3) existiert noch';
  end if;
  /* Der Importpfad sendet nichts und setzt keinen Status ausser 'neu' */
  select pg_get_functiondef('public.acquisition_import_rows(text,text,text,text,jsonb,uuid)'::regprocedure) into v_def;
  if position('enqueue_email' in v_def) > 0 or position('outreach_messages' in v_def) > 0
     or position('''interesse''' in v_def) > 0 or position('''founding_partner''' in v_def) > 0
     or position('on conflict (email)' in v_def) > 0 or position('update public.leads' in v_def) > 0 then
    raise exception '[wp16.1] Importpfad sendet, setzt Status oder ueberschreibt Leads';
  end if;
  raise notice '[wp16.1] in Ordnung';
end $$;
