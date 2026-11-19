/*
 * Akquise: Stundenlimit für Mail 1 / Nachfassen entfernt (19.11.2026, auf
 * Wunsch des Admins).
 *
 * Bisher lehnte acquisition_outreach_send() ab 20 Akquise-Nachrichten pro
 * Stunde mit reason 'rate_limit' ab. Jeder Versand bleibt eine bewusste
 * Einzelaktion (Vorschau → Bestätigung, Idempotenz-Schlüssel, „läuft
 * bereits"-Sperre je Lead); die Funktion ist sonst unverändert
 * (Stand 20261119090000). Der alte FP-Pfad acquisition_outreach_begin()
 * bleibt unangetastet.
 */

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
  v_subject text; v_variante text; v_befund text; v_parent_id uuid; v_typ text; v_text text;
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
    if v_lead.finding_type is null then return jsonb_build_object('ok', false, 'reason', 'befund_typ_fehlt'); end if;
    if v_lead.outreach_subject_variant is null then return jsonb_build_object('ok', false, 'reason', 'variante_fehlt'); end if;
    /* Wer schon eine Akquise-Mail bekommen hat (auch die alte FP-Mail),
       bekommt keine zweite Erstmail. */
    if exists (select 1 from public.outreach_messages where lead_id = p_lead_id and status = 'sent') then
      return jsonb_build_object('ok', false, 'reason', 'bereits_angeschrieben');
    end if;
    v_variante := v_lead.outreach_subject_variant;
    v_typ := v_lead.finding_type;
    /* Exakter Text von Mail 1 (fuer das Zitat in der Nachfass-Mail) */
    v_text := left(nullif(btrim(coalesce(p_payload ->> 'text', '')), ''), 6000);
    v_subject := p_subject;
    if coalesce(btrim(v_subject), '') = '' then raise exception 'Betreff fehlt' using errcode = '22023'; end if;
  else
    v_grund := public.acquisition_followup_moeglich(p_lead_id);
    if v_grund is not null then return jsonb_build_object('ok', false, 'reason', 'nachfass_nicht_moeglich', 'grund', v_grund); end if;
    select * into v_parent from public.outreach_messages
     where lead_id = p_lead_id and template = 'outreach_erstkontakt' and status = 'sent'
     order by created_at desc limit 1;
    v_parent_id := v_parent.id; v_subject := v_parent.subject; v_variante := v_parent.subject_variant; v_befund := v_parent.finding_snapshot;
    v_typ := v_parent.finding_type_snapshot;
  end if;


  begin
    insert into public.outreach_messages (lead_id, template, subject, subject_variant, finding_snapshot, finding_type_snapshot, text_snapshot, parent_message_id,
                                          to_email_snapshot, delivery_mode, idempotency_key, created_by)
    values (p_lead_id, p_template, v_subject, v_variante, v_befund, v_typ, v_text, v_parent_id,
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

/* ═══ Selbstpruefung ═══ */
do $$
declare v_def text; f text := 'public.acquisition_outreach_send(uuid,uuid,text,text,text,text,jsonb)';
begin
  if pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') or pg_catalog.has_function_privilege('anon', f, 'EXECUTE') then
    raise exception '[akquise-limit] % ist fuer Clients ausfuehrbar', f;
  end if;
  if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then raise exception '[akquise-limit] % fehlt service_role', f; end if;
  select pg_get_functiondef(f::regprocedure) into v_def;
  if position('rate_limit' in v_def) > 0 then raise exception '[akquise-limit] Stundenlimit noch aktiv'; end if;
  if position('befund_typ_fehlt' in v_def) = 0 or position('laeuft_bereits' in v_def) = 0 or position('idempotency_key' in v_def) = 0 then
    raise exception '[akquise-limit] Schutzpruefungen fehlen';
  end if;
  raise notice '[akquise-limit] in Ordnung';
end $$;
