/*
 * WP17.2 — „Nachfassen fällig": Erinnerung im Admin, kein Automatismus.
 *
 * Nachfassen ist ab 5 Werktagen (Mo–Fr, Kalender Europe/Berlin, ohne
 * Feiertage) nach dem Versand der ersten Mail 1 fällig — wenn keine
 * Antwort erfasst, noch nicht nachgefasst und der Lead nicht gesperrt ist
 * (acquisition_followup_moeglich() = null, unverändert).
 *
 * Nur Anzeige: Übersicht (Filter „nachfassen_faellig", KPI
 * nachfassenFaellig, followupAb/followupFaellig je Zeile) und Detail.
 * Versand bleibt ein Klick des Admins — kein Cron, kein Auto-Versand.
 * Die Datenbank sperrt frühes Nachfassen bewusst NICHT (Admin-Entscheidung).
 *
 * Neue Migration; 20261119090000 bleibt unverändert.
 */

/* ═══ 1 — Fällig ab: 5 Werktage nach Mail 1 ═══ */
create or replace function public.acquisition_werktage_spaeter(p_tag date, p_werktage integer)
returns date
language sql
immutable
set search_path to 'public'
as $$
  select d::date
    from generate_series(p_tag + 1, p_tag + (p_werktage * 2 + 7), interval '1 day') d
   where extract(isodow from d) < 6
   order by d
   offset greatest(p_werktage, 1) - 1
   limit 1
$$;
revoke all on function public.acquisition_werktage_spaeter(date, integer) from public, anon, authenticated;
grant execute on function public.acquisition_werktage_spaeter(date, integer) to service_role;

create or replace function public.acquisition_followup_ab(p_lead_id uuid)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.acquisition_werktage_spaeter((min(m.sent_at) at time zone 'Europe/Berlin')::date, 5)
    from public.outreach_messages m
   where m.lead_id = p_lead_id and m.template = 'outreach_erstkontakt' and m.status = 'sent' and m.sent_at is not null
$$;
revoke all on function public.acquisition_followup_ab(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_followup_ab(uuid) to service_role;

create or replace function public.acquisition_followup_faellig(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.acquisition_followup_moeglich(p_lead_id) is null
     and coalesce(public.acquisition_followup_ab(p_lead_id) <= (now() at time zone 'Europe/Berlin')::date, false)
$$;
revoke all on function public.acquisition_followup_faellig(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_followup_faellig(uuid) to service_role;

/* ═══ 2 — Übersicht: + followupAb, followupFaellig, Filter, KPI ═══ */
create or replace function public.acquisition_overview(
  p_status text default null, p_suche text default null, p_limit integer default 100, p_import_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_rows jsonb; v_kpi jsonb; v_varianten jsonb; v_typen jsonb; v_q text := nullif(lower(btrim(coalesce(p_suche, ''))), '');
begin
  select coalesce(jsonb_agg(x.zeile order by x.faellig_sort asc nulls last, x.sort desc), '[]'::jsonb) into v_rows
  from (
    select coalesce(l.last_outreach_at, l.updated_at, l.created_at) as sort,
           case when p_status = 'nachfassen_faellig' then public.acquisition_followup_ab(l.id) end as faellig_sort,
           jsonb_build_object(
             'id', l.id, 'companyName', l.company_name, 'contactPerson', nullif(l.contact_person, '-'), 'email', l.email,
             'city', l.city, 'trade', l.trade, 'website', l.website, 'googleProfileUrl', l.google_profile_url,
             'personalizedSentence', l.personalized_sentence, 'googleProfileFinding', l.google_profile_finding, 'findingType', l.finding_type, 'note', l.acquisition_note,
             'subjectVariant', l.outreach_subject_variant, 'replyReceivedAt', l.reply_received_at, 'replyClassification', l.reply_classification,
             'followupSentAt', l.followup_sent_at, 'followupMoeglich', public.acquisition_followup_moeglich(l.id) is null,
             'followupAb', public.acquisition_followup_ab(l.id), 'followupFaellig', public.acquisition_followup_faellig(l.id),
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
       and (p_status is null or p_status = 'alle'
            or (p_status = 'nachfassen_faellig' and public.acquisition_followup_faellig(l.id))
            or l.acquisition_status = p_status)
       and (p_import_id is null or l.acquisition_import_id = p_import_id)
       and (v_q is null or lower(l.company_name) like '%' || v_q || '%' or lower(coalesce(l.contact_person, '')) like '%' || v_q || '%' or lower(coalesce(l.email, '')) like '%' || v_q || '%')
     order by case when p_status = 'nachfassen_faellig' then public.acquisition_followup_ab(l.id) end asc nulls last, 1 desc
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
    'nachfassenFaellig', count(*) filter (where public.acquisition_followup_faellig(l.id)),
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

  /* WP17.1: Auswertung je Befund-Typ (Typ zum Versandzeitpunkt, aus der Erstmail). */
  select coalesce(jsonb_object_agg(t.typ, t.werte), '{}'::jsonb) into v_typen from (
    select m.finding_type_snapshot as typ, jsonb_build_object(
      'angeschrieben', count(distinct m.lead_id) filter (where m.status = 'sent'),
      'zugestellt', count(distinct m.lead_id) filter (where exists (select 1 from public.outreach_email_events e where e.outreach_message_id = m.id and e.event_type = 'delivered')),
      'antworten', count(distinct m.lead_id) filter (where l.reply_received_at is not null),
      'antwortenPositiv', count(distinct m.lead_id) filter (where l.reply_classification = 'positiv')) as werte
      from public.outreach_messages m join public.leads l on l.id = m.lead_id
     where m.template = 'outreach_erstkontakt' and m.finding_type_snapshot is not null and l.status <> 'deleted'
     group by m.finding_type_snapshot) t;

  return jsonb_build_object('leads', v_rows, 'kpi', v_kpi, 'varianten', v_varianten, 'befundTypen', v_typen);
end;
$$;
revoke all on function public.acquisition_overview(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.acquisition_overview(text, text, integer, uuid) to service_role;

/* ═══ 3 — Detail: + followupAb, followupFaellig ═══ */
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
           'personalizedSentence', l.personalized_sentence, 'googleProfileFinding', l.google_profile_finding, 'findingType', l.finding_type, 'note', l.acquisition_note,
           'subjectVariant', l.outreach_subject_variant, 'replyReceivedAt', l.reply_received_at, 'replyClassification', l.reply_classification,
           'followupSentAt', l.followup_sent_at, 'followupGrund', public.acquisition_followup_moeglich(l.id),
           'followupAb', public.acquisition_followup_ab(l.id), 'followupFaellig', public.acquisition_followup_faellig(l.id),
           'acquisitionStatus', l.acquisition_status, 'acquisitionStatusChangedAt', l.acquisition_status_changed_at,
           'leadStatus', l.status, 'source', l.source, 'lastOutreachAt', l.last_outreach_at, 'createdAt', l.created_at,
           'blockReason', public.acquisition_block_reason(l.id))
    into v_lead
    from public.leads l where l.id = p_lead_id and l.status <> 'deleted';
  if v_lead is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'template', m.template, 'subjectVariant', m.subject_variant, 'parentId', m.parent_message_id,
           'status', m.status, 'deliveryMode', m.delivery_mode, 'subject', m.subject, 'finding', m.finding_snapshot,
           'findingType', m.finding_type_snapshot, 'text', m.text_snapshot,
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


/* ═══ Selbstpruefung ═══ */
do $$
declare f text;
begin
  foreach f in array array['public.acquisition_werktage_spaeter(date,integer)', 'public.acquisition_followup_ab(uuid)',
                           'public.acquisition_followup_faellig(uuid)', 'public.acquisition_overview(text,text,integer,uuid)',
                           'public.acquisition_lead_detail(uuid)'] loop
    if pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') or pg_catalog.has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[wp17.2] % ist fuer Clients ausfuehrbar', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then raise exception '[wp17.2] % fehlt service_role', f; end if;
  end loop;
  /* Do 19.11.2026 → Do 26.11.; Fr 20.11. → Fr 27.11.; Sa 21.11. → Fr 27.11. */
  if public.acquisition_werktage_spaeter('2026-11-19', 5) <> '2026-11-26'
     or public.acquisition_werktage_spaeter('2026-11-20', 5) <> '2026-11-27'
     or public.acquisition_werktage_spaeter('2026-11-21', 5) <> '2026-11-27' then
    raise exception '[wp17.2] Werktage falsch gezaehlt';
  end if;
  raise notice '[wp17.2] in Ordnung';
end $$;
