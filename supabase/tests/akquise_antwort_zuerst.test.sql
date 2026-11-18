-- WP17 — Outreach „Antwort zuerst": Datenbankseite (mit Wirkung).
--
--   scripts/test-db/run.sh akquise_antwort
--
--   A  Befund Pflicht (S1), Versand mit Befund (S2), Empfaenger aus der DB
--   B  Betreff-Variante: 50:50 (S3), stabil (S4), Trigger verbietet Aenderung
--   C  Keine zweite Erstmail (auch nach alter FP-Mail)
--   D  Nachfassen: nur nach Mail 1 (S6), nur einmal (S7), nicht nach Antwort,
--      Betreff aus der Erstmail, Unique-Sperre gegen Race
--   E  Antwort erfassen: positiv (S8), negativ (S9) + Sperre, sonstige (S10)
--   F  Funnel: Antworten (S11), Antwort ≠ Interesse (S12), A/B-Zaehlung
--   G  Brevo-Ereignisse der neuen Vorlagen landen in der Historie, aendern
--      keinen Status
--   H  Import mit Befund (S13), ohne (S14); Bestandsleads unveraendert (S15)
--   I  Rechte: nur service_role

\set ON_ERROR_STOP on

create or replace function pg_temp.lead(p_firma text, p_email text, p_befund text default null) returns uuid language sql as $$
  select public.acquisition_lead_create('00000000-0000-4000-8000-00000000ad01',
    jsonb_build_object('company_name', p_firma, 'email', p_email, 'contact_person', 'Max Muster', 'google_profile_finding', p_befund))
$$;
/* Mail 1 wie admin-ops: erst Variante vergeben, dann senden. Payload mit
   Angriffsfeldern — duerfen den Empfaenger nie bestimmen. */
create or replace function pg_temp.mail1(p_lead uuid, p_key text) returns jsonb language plpgsql as $$
declare v text;
begin
  v := public.acquisition_assign_subject_variant(p_lead);
  return public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', p_lead, p_key, 'outreach_erstkontakt',
    case v when 'A' then 'Ihre Google-Bewertungen' else 'Kurze Frage zu X bei Google' end, 'production',
    jsonb_build_object('companyName', 'X', 'finding', 'egal', 'variante', v, 'email', 'hacker@evil.test', 'to', 'hacker@evil.test'));
end $$;
create or replace function pg_temp.nachfass(p_lead uuid, p_key text) returns jsonb language sql as $$
  select public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', p_lead, p_key, 'outreach_nachfass',
    'IGNORIERT', 'production', jsonb_build_object('originalText', 'x'))
$$;
create or replace function pg_temp.antwort(p_lead uuid, p_klasse text) returns jsonb language sql as $$
  select public.acquisition_record_reply('00000000-0000-4000-8000-00000000ad01', p_lead, p_klasse)
$$;
create or replace function pg_temp.worker_ok(p_queue uuid, p_msgid text) returns void language sql as $$
  select public.finish_email(p_queue, true, p_msgid, null, null)
$$;
create or replace function pg_temp.kpi() returns jsonb language sql as $$
  select public.acquisition_overview(null, null, 500, null) -> 'kpi'
$$;
create or replace function pg_temp.befund() returns text language sql immutable as $$
  select 'Elektro Mack hat 23 gute Bewertungen, auf die letzten fuenf gibt es keine Antwort.'::text
$$;

/* ═══ A — Befund ist Pflicht ═══ */
begin;
select test.basis();
do $$
declare v_ohne uuid; v_mit uuid; r jsonb; v_q public.email_queue;
begin
  /* S1 — ohne Befund: keine Variante, kein Versand, nichts eingereiht */
  v_ohne := pg_temp.lead('Ohne Befund KG', 'ohne@example.test');
  assert public.acquisition_assign_subject_variant(v_ohne) is null, 'S1: Variante ohne Befund vergeben';
  r := public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', v_ohne, 'key-a-0000000001', 'outreach_erstkontakt',
                                        'Ihre Google-Bewertungen', 'production', '{}'::jsonb);
  assert r ->> 'reason' = 'befund_fehlt', format('S1: %s', r);
  /* Befund nur aus Leerzeichen zaehlt nicht */
  update public.leads set google_profile_finding = '   ' where id = v_ohne;
  r := public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', v_ohne, 'key-a-0000000002', 'outreach_erstkontakt',
                                        'Ihre Google-Bewertungen', 'production', '{}'::jsonb);
  assert r ->> 'reason' = 'befund_fehlt', format('S1b: %s', r);
  assert (select count(*) from public.outreach_messages where lead_id = v_ohne) = 0, 'S1: Nachricht angelegt';
  assert (select count(*) from public.email_queue where to_email = 'ohne@example.test') = 0, 'S1: Mail eingereiht';
  assert (select acquisition_status from public.leads where id = v_ohne) = 'neu', 'S1: Status veraendert';

  /* S2 — mit Befund: eingereiht, Vorlage outreach_erstkontakt, Empfaenger aus der DB, Status angeschrieben */
  v_mit := pg_temp.lead('Elektro Mack', 'mack@example.test', pg_temp.befund());
  r := pg_temp.mail1(v_mit, 'key-a-0000000003');
  assert (r ->> 'ok')::boolean and r ->> 'subjectVariant' in ('A', 'B'), format('S2: %s', r);
  select * into v_q from public.email_queue where id = (r ->> 'emailQueueId')::uuid;
  assert v_q.template = 'outreach_erstkontakt' and v_q.to_email = 'mack@example.test', format('S2: Queue %s/%s', v_q.template, v_q.to_email);
  assert v_q.payload ->> 'subject' = (r ->> 'subject'), 'S2: Betreff fehlt im Payload';
  assert (select finding_snapshot from public.outreach_messages where id = (r ->> 'messageId')::uuid) = pg_temp.befund(), 'S2: Befund-Snapshot';
  assert (select link_token_hash from public.outreach_messages where id = (r ->> 'messageId')::uuid) is null, 'S2: neue Mail hat Token';
  assert (select acquisition_status from public.leads where id = v_mit) = 'angeschrieben', 'S2: Status nicht angeschrieben';
  /* Idempotenz: derselbe Schluessel → dieselbe Nachricht */
  assert (pg_temp.mail1(v_mit, 'key-a-0000000003') ->> 'reused')::boolean, 'S2: Idempotenz';
  assert (select count(*) from public.outreach_messages where lead_id = v_mit) = 1, 'S2: doppelt';
end $$;
rollback;

/* ═══ B — Betreff-Variante ═══ */
begin;
select test.basis();
do $$
declare v uuid; i integer; v_var text; n_a integer; n_b integer; v_ok boolean;
begin
  /* S3 — 50:50: zehn versandbereite Leads → je fuenf */
  for i in 1..10 loop
    v := pg_temp.lead(format('Betrieb %s', i), format('b%s@example.test', i), pg_temp.befund());
    perform pg_temp.mail1(v, format('key-b-%s', lpad(i::text, 10, '0')));
  end loop;
  select count(*) filter (where outreach_subject_variant = 'A'), count(*) filter (where outreach_subject_variant = 'B') into n_a, n_b from public.leads;
  assert n_a = 5 and n_b = 5, format('S3: A=%s B=%s', n_a, n_b);
  /* Betreff je Nachricht passt zur Variante */
  assert not exists (select 1 from public.outreach_messages m join public.leads l on l.id = m.lead_id
                      where m.subject_variant is distinct from l.outreach_subject_variant), 'S3: Variante Nachricht ≠ Lead';

  /* S4 — stabil: erneutes Zuweisen liefert dieselbe Variante; direkte Aenderung scheitert */
  select id, outreach_subject_variant into v, v_var from public.leads where company_name = 'Betrieb 1';
  for i in 1..5 loop assert public.acquisition_assign_subject_variant(v) = v_var, 'S4: Variante gewechselt'; end loop;
  v_ok := false;
  begin update public.leads set outreach_subject_variant = case v_var when 'A' then 'B' else 'A' end where id = v;
  exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'S4: Variante liess sich aendern';
  /* Stammdaten aendern beruehrt die Variante nicht */
  perform public.acquisition_lead_update('00000000-0000-4000-8000-00000000ad01', v, '{"company_name": "Umbenannt GmbH"}'::jsonb);
  assert (select outreach_subject_variant from public.leads where id = v) = v_var, 'S4: Update aenderte Variante';
end $$;
rollback;

/* ═══ C — keine zweite Erstmail ═══ */
begin;
select test.basis();
do $$
declare v uuid; r jsonb; v_alt uuid;
begin
  v := pg_temp.lead('Zweimal GmbH', 'zweimal@example.test', pg_temp.befund());
  r := pg_temp.mail1(v, 'key-c-0000000001');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<c1@mail>');
  r := pg_temp.mail1(v, 'key-c-0000000002');
  assert r ->> 'reason' = 'bereits_angeschrieben', format('C: %s', r);

  /* Lead mit alter FP-Mail (WP16) bekommt keine neue Erstmail */
  v_alt := pg_temp.lead('Alt GmbH', 'alt@example.test', pg_temp.befund());
  r := public.acquisition_outreach_begin('00000000-0000-4000-8000-00000000ad01', v_alt, 'key-c-0000000003',
         'Darf ich Alt GmbH als WERKRUF Founding Partner einladen?', 'Satz', encode(sha256('tokCalt'::bytea), 'hex'), 'production',
         '{"companyName":"Alt GmbH"}'::jsonb);
  assert (r ->> 'ok')::boolean, format('C: alte Mail %s', r);
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<c-alt@mail>');
  assert (select template from public.outreach_messages where lead_id = v_alt) = 'founding_partner_outreach', 'C: Default-Vorlage der alten Funktion';
  r := pg_temp.mail1(v_alt, 'key-c-0000000004');
  assert r ->> 'reason' = 'bereits_angeschrieben', format('C: alt %s', r);
  /* … und kein Nachfassen mit der neuen Vorlage */
  assert public.acquisition_followup_moeglich(v_alt) = 'keine_erstmail', 'C: Nachfassen nach alter Mail';
end $$;
rollback;

/* ═══ D — Nachfassen ═══ */
begin;
select test.basis();
do $$
declare v uuid; r jsonb; v_erst uuid; v_q uuid; v_n uuid; v_ok boolean;
begin
  v := pg_temp.lead('Nachfass GmbH', 'nachfass@example.test', pg_temp.befund());

  /* S6 — vor Mail 1: nicht moeglich */
  assert public.acquisition_followup_moeglich(v) = 'keine_erstmail', 'S6: vor Mail 1';
  r := pg_temp.nachfass(v, 'key-d-0000000001');
  assert r ->> 'reason' = 'nachfass_nicht_moeglich' and r ->> 'grund' = 'keine_erstmail', format('S6: %s', r);

  /* Mail 1 eingereiht, aber noch nicht gesendet: weiterhin nicht moeglich */
  r := pg_temp.mail1(v, 'key-d-0000000002');
  v_erst := (r ->> 'messageId')::uuid; v_q := (r ->> 'emailQueueId')::uuid;
  assert public.acquisition_followup_moeglich(v) = 'keine_erstmail', 'S6: Mail 1 nur eingereiht';

  /* gesendet → moeglich */
  perform pg_temp.worker_ok(v_q, '<d1@mail>');
  assert public.acquisition_followup_moeglich(v) is null, format('S6: nach Versand %s', public.acquisition_followup_moeglich(v));
  r := pg_temp.nachfass(v, 'key-d-0000000003');
  assert (r ->> 'ok')::boolean, format('S6: Nachfass %s', r);
  v_n := (r ->> 'messageId')::uuid;
  /* Betreff und Variante aus der Erstmail, nicht vom Aufrufer ('IGNORIERT') */
  assert (select subject from public.outreach_messages where id = v_n) = (select subject from public.outreach_messages where id = v_erst), 'D: Betreff nicht aus Erstmail';
  assert (select parent_message_id from public.outreach_messages where id = v_n) = v_erst, 'D: parent';
  assert (select template from public.email_queue where id = (r ->> 'emailQueueId')::uuid) = 'outreach_nachfass', 'D: Vorlage';
  assert (select payload ->> 'subject' from public.email_queue where id = (r ->> 'emailQueueId')::uuid) <> 'IGNORIERT', 'D: Betreff vom Aufrufer';
  assert (select followup_sent_at from public.leads where id = v) is not null, 'D: followup_sent_at';
  assert (select acquisition_status from public.leads where id = v) = 'angeschrieben', 'D: Status durch Nachfass veraendert';

  /* S7 — nur einmal: auch nach Versand, auch mit neuem Schluessel */
  assert public.acquisition_followup_moeglich(v) = 'bereits_nachgefasst', 'S7: zweites Mal moeglich';
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<d2@mail>');
  r := pg_temp.nachfass(v, 'key-d-0000000004');
  assert r ->> 'reason' = 'nachfass_nicht_moeglich' and r ->> 'grund' = 'bereits_nachgefasst', format('S7: %s', r);
  assert (select count(*) from public.outreach_messages where lead_id = v and template = 'outreach_nachfass') = 1, 'S7: zwei Nachfass-Mails';
  /* Unique-Sperre greift auch am Regelwerk vorbei (Race) */
  v_ok := false;
  begin
    insert into public.outreach_messages (lead_id, template, subject, parent_message_id, to_email_snapshot, delivery_mode, idempotency_key)
    values (v, 'outreach_nachfass', 'x', v_erst, 'nachfass@example.test', 'production', 'key-d-race-00001');
  exception when unique_violation then v_ok := true; end;
  assert v_ok, 'S7: Unique-Sperre fehlt';
end $$;
rollback;

/* Nachfassen nach erfasster Antwort: nicht moeglich */
begin;
select test.basis();
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.lead('Antwortet GmbH', 'antwortet@example.test', pg_temp.befund());
  r := pg_temp.mail1(v, 'key-d2-000000001');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<d3@mail>');
  perform pg_temp.antwort(v, 'sonstige');
  assert public.acquisition_followup_moeglich(v) = 'antwort_erfasst', 'D: nach Antwort';
  r := pg_temp.nachfass(v, 'key-d2-000000002');
  assert r ->> 'grund' = 'antwort_erfasst', format('D: %s', r);
end $$;
rollback;

/* ═══ E — Antwort erfassen ═══ */
begin;
select test.basis();
do $$
declare v_pos uuid; v_neg uuid; v_son uuid; v_fp uuid; r jsonb; v_zeit timestamptz; v_ok boolean;
begin
  v_pos := pg_temp.lead('Positiv GmbH', 'pos@example.test', pg_temp.befund());
  v_neg := pg_temp.lead('Negativ GmbH', 'neg@example.test', pg_temp.befund());
  v_son := pg_temp.lead('Sonstig GmbH', 'son@example.test', pg_temp.befund());
  perform pg_temp.worker_ok((pg_temp.mail1(v_pos, 'key-e-0000000001') ->> 'emailQueueId')::uuid, '<e1@mail>');
  perform pg_temp.worker_ok((pg_temp.mail1(v_neg, 'key-e-0000000002') ->> 'emailQueueId')::uuid, '<e2@mail>');
  perform pg_temp.worker_ok((pg_temp.mail1(v_son, 'key-e-0000000003') ->> 'emailQueueId')::uuid, '<e3@mail>');

  /* S8 — positiv: Antwort + Interesse */
  r := pg_temp.antwort(v_pos, 'positiv');
  assert r ->> 'vorher' = 'angeschrieben' and r ->> 'nachher' = 'interesse', format('S8: %s', r);
  assert (select reply_received_at is not null and reply_classification = 'positiv' and acquisition_status = 'interesse' from public.leads where id = v_pos), 'S8';
  assert public.acquisition_block_reason(v_pos) is null, 'S8: positiv sperrt';

  /* S9 — negativ: Antwort + kein Interesse + Versandsperre (Mail 1 verspricht es) */
  r := pg_temp.antwort(v_neg, 'negativ');
  assert r ->> 'nachher' = 'kein_interesse', format('S9: %s', r);
  assert public.acquisition_block_reason(v_neg) = 'antwort_negativ', 'S9: keine Sperre';
  r := pg_temp.nachfass(v_neg, 'key-e-0000000004');
  assert r ->> 'reason' in ('gesperrt', 'nachfass_nicht_moeglich'), format('S9: Nachfass nach Nein %s', r);
  assert (select count(*) from public.outreach_messages where lead_id = v_neg) = 1, 'S9: nach Nein noch gesendet';

  /* S10 — sonstige: Antwort, Status bleibt */
  r := pg_temp.antwort(v_son, 'sonstige');
  assert r ->> 'vorher' = 'angeschrieben' and r ->> 'nachher' = 'angeschrieben', format('S10: %s', r);
  assert (select reply_classification from public.leads where id = v_son) = 'sonstige', 'S10';

  /* Korrektur: erster Zeitpunkt bleibt, Klassifikation wechselt; sonstige→positiv setzt Interesse */
  select reply_received_at into v_zeit from public.leads where id = v_son;
  perform pg_sleep(0.01);
  r := pg_temp.antwort(v_son, 'positiv');
  assert (select reply_received_at from public.leads where id = v_son) = v_zeit, 'E: Zeitpunkt ueberschrieben';
  assert (select acquisition_status from public.leads where id = v_son) = 'interesse', 'E: Korrektur';

  /* Founding Partner wird durch eine Antwort nie herabgestuft */
  v_fp := pg_temp.lead('FP GmbH', 'fp@example.test', pg_temp.befund());
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_fp, 'founding_partner');
  r := pg_temp.antwort(v_fp, 'negativ');
  assert (select acquisition_status from public.leads where id = v_fp) = 'founding_partner', 'E: FP herabgestuft';

  /* ungueltige Klasse, unbekannter Lead */
  v_ok := false; begin perform pg_temp.antwort(v_pos, 'vielleicht'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'E: ungueltige Klasse angenommen';
  assert pg_temp.antwort(gen_random_uuid(), 'positiv') ->> 'reason' = 'kein_lead', 'E: unbekannter Lead';
  /* Konsistenz: Klassifikation nie ohne Zeitpunkt */
  v_ok := false; begin update public.leads set reply_received_at = null where id = v_pos; exception when check_violation then v_ok := true; end;
  assert v_ok, 'E: Klassifikation ohne Zeitpunkt moeglich';
end $$;
rollback;

/* ═══ F — Funnel ═══ */
begin;
select test.basis();
do $$
declare v1 uuid; v2 uuid; v3 uuid; v4 uuid; k jsonb; ab jsonb; r jsonb;
begin
  v1 := pg_temp.lead('F1', 'f1@example.test', pg_temp.befund());
  v2 := pg_temp.lead('F2', 'f2@example.test', pg_temp.befund());
  v3 := pg_temp.lead('F3', 'f3@example.test', pg_temp.befund());
  v4 := pg_temp.lead('F4', 'f4@example.test', pg_temp.befund());
  perform pg_temp.worker_ok((pg_temp.mail1(v1, 'key-f-0000000001') ->> 'emailQueueId')::uuid, '<f1@mail>');
  perform pg_temp.worker_ok((pg_temp.mail1(v2, 'key-f-0000000002') ->> 'emailQueueId')::uuid, '<f2@mail>');
  perform pg_temp.worker_ok((pg_temp.mail1(v3, 'key-f-0000000003') ->> 'emailQueueId')::uuid, '<f3@mail>');
  perform public.record_delivery_event('<f1@mail>', 'delivered', now());
  perform public.record_delivery_event('<f2@mail>', 'delivered', now());
  perform public.record_delivery_event('<f3@mail>', 'delivered', now());
  perform public.record_delivery_event('<f1@mail>', 'opened', now());
  perform pg_temp.antwort(v1, 'positiv');
  perform pg_temp.antwort(v2, 'negativ');
  perform pg_temp.antwort(v3, 'sonstige');

  /* S11 — Antworten zaehlen jede erfasste Antwort, getrennt nach Klasse */
  k := pg_temp.kpi();
  assert (k ->> 'leads')::int = 4 and (k ->> 'angeschrieben')::int = 3 and (k ->> 'zugestellt')::int = 3 and (k ->> 'oeffnungErkannt')::int = 1, format('S11: %s', k);
  assert (k ->> 'antworten')::int = 3 and (k ->> 'antwortenPositiv')::int = 1 and (k ->> 'antwortenNegativ')::int = 1 and (k ->> 'antwortenSonstige')::int = 1, format('S11: %s', k);

  /* S12 — Antwort ≠ Interesse: drei Antworten, ein Interesse */
  assert (k ->> 'interesse')::int = 1, format('S12: %s', k);
  /* Interesse ohne Antwort (manuell gesetzt) zaehlt nicht als Antwort */
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v4, 'interesse');
  k := pg_temp.kpi();
  assert (k ->> 'interesse')::int = 2 and (k ->> 'antworten')::int = 3, format('S12b: %s', k);

  /* A/B je Variante: Summe = Gesamt */
  ab := public.acquisition_overview(null, null, 500, null) -> 'varianten';
  assert coalesce((ab -> 'A' ->> 'angeschrieben')::int, 0) + coalesce((ab -> 'B' ->> 'angeschrieben')::int, 0) = 3, format('F: A/B %s', ab);
  assert coalesce((ab -> 'A' ->> 'antworten')::int, 0) + coalesce((ab -> 'B' ->> 'antworten')::int, 0) = 3, format('F: A/B Antworten %s', ab);
  assert coalesce((ab -> 'A' ->> 'zugestellt')::int, 0) + coalesce((ab -> 'B' ->> 'zugestellt')::int, 0) = 3, format('F: A/B zugestellt %s', ab);

  /* Zeile und Detail tragen die neuen Felder */
  r := (select x from jsonb_array_elements(public.acquisition_overview(null, null, 500, null) -> 'leads') x where x ->> 'id' = v1::text);
  assert r ->> 'replyClassification' = 'positiv' and r ->> 'googleProfileFinding' = pg_temp.befund() and r ->> 'subjectVariant' in ('A', 'B'), format('F: Zeile %s', r);
  r := public.acquisition_lead_detail(v1);
  assert r -> 'lead' ->> 'followupGrund' = 'antwort_erfasst', format('F: Detail %s', r -> 'lead');
  assert r -> 'messages' -> 0 ->> 'template' = 'outreach_erstkontakt' and r -> 'messages' -> 0 ->> 'finding' = pg_temp.befund(), 'F: Detail-Nachricht';
end $$;
rollback;

/* ═══ G — Brevo-Ereignisse fuer die neuen Vorlagen ═══ */
begin;
select test.basis();
do $$
declare v uuid; r jsonb; e jsonb;
begin
  v := pg_temp.lead('Brevo GmbH', 'brevo@example.test', pg_temp.befund());
  r := pg_temp.mail1(v, 'key-g-0000000001');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<g1@mail>');
  assert (select status from public.outreach_messages where id = (r ->> 'messageId')::uuid) = 'sent', 'G: Queue-Trigger';
  assert (select provider_message_id from public.outreach_messages where id = (r ->> 'messageId')::uuid) = '<g1@mail>', 'G: Message-ID';
  e := public.record_delivery_event('<g1@mail>', 'delivered', now());
  assert e ->> 'template' = 'outreach_erstkontakt', format('G: %s', e);
  perform public.record_delivery_event('<g1@mail>', 'opened', now());
  assert (select count(*) from public.outreach_email_events where lead_id = v and event_type in ('delivered', 'first_open')) = 2, 'G: Ereignisse fehlen';
  assert (select acquisition_status from public.leads where id = v) = 'angeschrieben', 'G: Ereignis aenderte Status';
  /* Nachfass: ebenfalls korreliert */
  r := pg_temp.nachfass(v, 'key-g-0000000002');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<g2@mail>');
  e := public.record_delivery_event('<g2@mail>', 'delivered', now());
  assert e ->> 'template' = 'outreach_nachfass', format('G: Nachfass %s', e);
  assert (select count(*) from public.outreach_email_events where outreach_message_id = (r ->> 'messageId')::uuid and event_type = 'delivered') = 1, 'G: Nachfass-Ereignis';
  /* Hard Bounce sperrt wie bisher */
  perform public.record_delivery_event('<g2@mail>', 'hard_bounce', now());
  assert public.acquisition_block_reason(v) = 'hard_bounce', 'G: Sperre';
end $$;
rollback;

/* ═══ H — Import und Bestand ═══ */
begin;
select test.basis();
do $$
declare r jsonb; v_neu uuid; v_ohne uuid; v_alt uuid; v_vorher jsonb;
begin
  /* S15 — Bestandslead (vor WP17 angelegt, alte Felder) bleibt unveraendert nutzbar */
  insert into public.leads (company_name, contact_person, phone, email, source, status, industry_key, personalized_sentence, acquisition_status, acquisition_status_changed_at)
  values ('Bestand GmbH', '-', '-', 'bestand@example.test', 'admin_akquise', 'new', 'handwerk', 'Alter Satz.', 'angeschrieben', now()) returning id into v_alt;
  select to_jsonb(l) - 'updated_at' into v_vorher from public.leads l where id = v_alt;
  assert (select x ->> 'personalizedSentence' from jsonb_array_elements(public.acquisition_overview(null, null, 500, null) -> 'leads') x where x ->> 'id' = v_alt::text) = 'Alter Satz.', 'S15: Uebersicht';
  assert (select x ->> 'replyReceivedAt' from jsonb_array_elements(public.acquisition_overview(null, null, 500, null) -> 'leads') x where x ->> 'id' = v_alt::text) is null, 'S15: Antwort erfunden';
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_alt, 'zurueckgestellt');
  assert (select acquisition_status from public.leads where id = v_alt) = 'zurueckgestellt', 'S15: Status';
  assert (select personalized_sentence from public.leads where id = v_alt) = 'Alter Satz.', 'S15: Satz verloren';

  /* S13 — Import mit Befund */
  r := public.acquisition_import_rows('commit', 'csv', 'csv', 'imp-wp17-000001', jsonb_build_array(
         jsonb_build_object('i', 2, 'werte', jsonb_build_object('company_name', 'Import Mit', 'email', 'mit@example.test', 'google_profile_finding', pg_temp.befund())),
         jsonb_build_object('i', 3, 'werte', jsonb_build_object('company_name', 'Import Ohne', 'email', 'ohne-imp@example.test'))), null);
  assert (r -> 'counts' ->> 'new')::int = 2, format('S13: %s', r);
  select id into v_neu from public.leads where email = 'mit@example.test';
  select id into v_ohne from public.leads where email = 'ohne-imp@example.test';
  assert (select google_profile_finding from public.leads where id = v_neu) = pg_temp.befund(), 'S13: Befund nicht importiert';
  assert (pg_temp.mail1(v_neu, 'key-h-0000000001') ->> 'ok')::boolean, 'S13: importierter Lead nicht versandbereit';

  /* S14 — Import ohne Befund: angelegt, aber nicht versandbereit */
  assert (select google_profile_finding from public.leads where id = v_ohne) is null, 'S14: Befund erfunden';
  assert (select acquisition_status from public.leads where id = v_ohne) = 'neu', 'S14: Status';
  assert pg_temp.mail1(v_ohne, 'key-h-0000000002') ->> 'reason' = 'befund_fehlt', 'S14: ohne Befund versendet';
  /* Import legt nie Antworten, Varianten oder Nachfass an */
  assert (select reply_received_at is null and outreach_subject_variant is null and followup_sent_at is null from public.leads where id = v_ohne), 'S14: Felder gesetzt';
end $$;
rollback;

/* ═══ I — Rechte ═══ */
begin;
do $$
declare f text;
begin
  foreach f in array array['public.acquisition_outreach_send(uuid,uuid,text,text,text,text,jsonb)', 'public.acquisition_record_reply(uuid,uuid,text)',
                           'public.acquisition_assign_subject_variant(uuid)', 'public.acquisition_followup_moeglich(uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('I: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('I: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('I: service_role darf %s nicht', f);
  end loop;
end $$;
rollback;
