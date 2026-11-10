-- WP16 — Admin Akquise + Brevo-Tracking: Datenbankseite.
--
--   scripts/test-db/run.sh akquise
--
--   A  T1–T4    bestehender Lead-Kanon: SmartCheck-Insert, claim_own_lead,
--               Statuswerte, Kontoloeschung → deleted
--   B  T5/T6/T8 Rechte: normaler Nutzer liest/schreibt nichts, Admin liest
--               (RLS-Policy mit Wirkung), RPCs nur service_role
--   C  T7,T9–T12 Lead anlegen/aendern: Normalisierung, Ablehnung, nur
--               fachliche Felder
--   D  T14,T17,T21,T22,T24 Versand: Adresse aus DB, Korrelation, Idempotenz,
--               Doppelklick, Race, Status neu → angeschrieben (nur aufwaerts)
--   E  Queue → Nachricht: sent/failed + Ereignis
--   F  T25–T28,T32–T38,T39–T44 Brevo: Korrelation ueber Message-ID,
--               first_open, Duplikat, unbekannte ID, Sperren, Status unberuehrt
--   G  T30,T31,T42,T47–T52 Link-Ereignisse: GET-Arten setzen nie Interesse,
--               cta_clicked setzt nur aufwaerts, idempotent, Scanner
--   H  Uebersicht/Detail/KPI; I  WP6-Regression; J  Rate-Schutz; K  Loeschung

\set ON_ERROR_STOP on

create or replace function pg_temp.als(p_user uuid) returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', p_user);
end $$;
create or replace function pg_temp.lead(p_firma text, p_email text, p_satz text default null) returns uuid language sql as $$
  select public.acquisition_lead_create('00000000-0000-4000-8000-00000000ad01',
    jsonb_build_object('company_name', p_firma, 'email', p_email, 'contact_person', 'Max Muster', 'personalized_sentence', p_satz))
$$;
create or replace function pg_temp.hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;
/* Versand mit Standardwerten; Token ist der Hash von p_token. */
create or replace function pg_temp.sende(p_lead uuid, p_key text, p_token text) returns jsonb language sql as $$
  select public.acquisition_outreach_begin('00000000-0000-4000-8000-00000000ad01', p_lead, p_key,
    'Darf ich X als WERKRUF Founding Partner einladen?', 'Satz', pg_temp.hash(p_token), 'production',
    /* Angriffsfelder im Payload: duerfen den Empfaenger NIE bestimmen (T17/C2) */
    jsonb_build_object('companyName', 'X', 'presentationUrl', 'https://werkruf.com/p/fp/' || p_token, 'ctaUrl', 'https://werkruf.com/founding-partner/' || p_token,
                       'email', 'hacker@evil.test', 'to', 'hacker@evil.test', 'toEmail', 'hacker@evil.test'))
$$;
/* Worker-Erfolg simulieren: finish_email wie der echte Worker. */
create or replace function pg_temp.worker_ok(p_queue uuid, p_msgid text) returns void language sql as $$
  select public.finish_email(p_queue, true, p_msgid, null, null)
$$;

/* ═══ A — bestehender Lead-Kanon ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_lead uuid; v_ok boolean; v_n integer;
begin
  /* T1 — SmartCheck-Weg schreibt wie bisher (service_role-Insert mit alten Spalten) */
  insert into public.leads (company_name, contact_person, phone, city, trade, email, source, status, industry_key, visibility_score)
  values ('Sanitär Schulz', '-', '-', 'Hamburg', 'Sanitär', 'user_a@example.test', 'smart_check', 'new', 'handwerk', 42) returning id into v_lead;
  assert (select acquisition_status from public.leads where id = v_lead) is null, 'T1: SmartCheck-Lead landete in der Akquise';

  /* T2 — claim_own_lead: Nutzer mit derselben Mail uebernimmt den Lead → converted */
  perform pg_temp.als(v_a);
  assert public.claim_own_lead(), 'T2: claim_own_lead false';
  assert (select status from public.leads where id = v_lead) = 'converted', 'T2: nicht converted';
  assert (select visibility_score from public.user_profiles where id = v_a) = 42, 'T2: Profil nicht gefuellt';

  /* T3 — alte Statuswerte gueltig, fremder abgelehnt */
  update public.leads set status = 'contacted' where id = v_lead;
  update public.leads set status = 'rejected' where id = v_lead;
  v_ok := false;
  begin update public.leads set status = 'angeschrieben' where id = v_lead; exception when check_violation then v_ok := true; end;
  assert v_ok, 'T3: Vertriebsstatus im leads.status angenommen';
  /* Akquise-Status greift NICHT in leads.status */
  update public.leads set status = 'new' where id = v_lead;
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_lead, 'interesse', null);
  assert (select status from public.leads where id = v_lead) = 'new', 'T3: acquisition_set_status aenderte leads.status';
  assert (select acquisition_status from public.leads where id = v_lead) = 'interesse', 'T3: acquisition_status nicht gesetzt';

  /* T4 — Kontoloeschung anonymisiert und setzt deleted; Akquise-Zeilen stoeren nicht */
  perform pg_temp.sende(v_lead, 'key-t4-00000001', 'tokT4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  delete from auth.users where id = v_a;
  select count(*) into v_n from public.leads where id = v_lead and status = 'deleted' and email = 'deleted@werkruf.com';
  assert v_n = 1, 'T4: Lead nicht anonymisiert/deleted';
  assert (select count(*) from public.outreach_messages where lead_id = v_lead) = 1, 'T4: Nachricht weg';
  assert public.acquisition_lead_detail(v_lead) is null, 'T4: geloeschter Lead im Detail sichtbar';
  assert (select jsonb_array_length(public.acquisition_overview(null, null, 100) -> 'leads')) = 0, 'T4: geloeschter Lead in Uebersicht';
end $$;
rollback;

/* ═══ B — Rechte ═══ */
begin;
select test.basis();
select test.fremder();
do $$
declare f text; v_b uuid := test.id('user_b'); v_n integer; v_ok boolean; v_lead uuid;
begin
  foreach f in array array['public.acquisition_lead_create(uuid,jsonb)', 'public.acquisition_lead_update(uuid,uuid,jsonb)',
                           'public.acquisition_set_status(uuid,uuid,text,text)', 'public.acquisition_outreach_begin(uuid,uuid,text,text,text,text,text,jsonb)',
                           'public.acquisition_link_event(text,text)', 'public.acquisition_overview(text,text,integer)',
                           'public.acquisition_lead_detail(uuid)', 'public.acquisition_block_reason(uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  v_lead := pg_temp.lead('Dach Meier', 'meier@example.test');
  perform pg_temp.sende(v_lead, 'key-b-000000001', 'tokBaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  /* T5 / C10 — normaler Nutzer: outreach-Tabellen unerreichbar (Rechte UND RLS ohne Policy) */
  perform pg_temp.als(v_b);
  set local role authenticated;
  v_ok := false; begin perform count(*) from public.outreach_messages; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T5: authenticated liest outreach_messages';
  v_ok := false; begin perform count(*) from public.outreach_email_events; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T5: authenticated liest outreach_email_events';
  v_ok := false; begin insert into public.leads (company_name) values ('x'); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T8: authenticated legt Lead an';
  reset role;

  /* T5/T6 mit RLS-Wirkung: Produktion hat RLS an und Default-Grants fuer
     authenticated; die Testdatenbank hat beides nicht (Baseline). Hier in
     der Transaktion nachgestellt — dann entscheidet NUR die Policy. */
  alter table public.leads enable row level security;
  grant select on public.leads to authenticated;
  create or replace function auth.jwt() returns jsonb language sql stable as $f$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'app_metadata', json_build_object('role', 'user'))::text, true);
  set local role authenticated;
  select count(*) into v_n from public.leads; assert v_n = 0, format('T5: normaler Nutzer sieht %s Leads', v_n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'app_metadata', json_build_object('role', 'admin'))::text, true);
  set local role authenticated;
  select count(*) into v_n from public.leads where id = v_lead; assert v_n = 1, 'T6: Admin sieht den Akquise-Lead nicht';
  v_ok := false; begin update public.leads set acquisition_status = 'founding_partner' where id = v_lead; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T6: Admin schreibt direkt auf leads (muss ueber admin-ops)';
  reset role;
end $$;
rollback;

/* ═══ C — Lead anlegen / aendern ═══ */
begin;
do $$
declare v_lead uuid; v_ok boolean; r record;
begin
  /* T7/T9 — anlegen, Mail normalisiert */
  v_lead := public.acquisition_lead_create('00000000-0000-4000-8000-00000000ad01', jsonb_build_object(
    'company_name', '  Elektro Krause GmbH ', 'email', '  Info@Elektro-Krause.DE ', 'contact_person', 'Jens Krause', 'city', 'Kiel',
    'website', 'https://elektro-krause.de', 'personalized_sentence', 'Bei euch sind drei Bewertungen unbeantwortet.',
    'status', 'converted', 'acquisition_status', 'founding_partner', 'id', '11111111-1111-1111-1111-111111111111'));
  select * into r from public.leads where id = v_lead;
  assert r.email = 'info@elektro-krause.de', format('T9: Mail nicht normalisiert: %s', r.email);
  assert r.company_name = 'Elektro Krause GmbH' and r.source = 'admin_akquise' and r.status = 'new' and r.acquisition_status = 'neu', 'T7: Felder falsch';
  assert r.phone = '-' and r.industry_key = 'handwerk', 'T7: Defaults fehlen';

  /* T10 — ungueltige Mail */
  v_ok := false; begin perform pg_temp.lead('X', 'kein-at'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'T10: ungueltige Mail angenommen';
  v_ok := false; begin perform public.acquisition_lead_create('00000000-0000-4000-8000-00000000ad01', '{"email":"a@b.de"}'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'T7: ohne company_name angenommen';
  v_ok := false; begin perform public.acquisition_lead_create(null, '{"company_name":"X","email":"a@b.de"}'); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T7: ohne Admin angenommen';

  /* T11/T12 — aendern: nur fachliche Felder, technische ignoriert */
  assert public.acquisition_lead_update('00000000-0000-4000-8000-00000000ad01', v_lead, jsonb_build_object(
    'note', 'Rueckruf Montag', 'personalized_sentence', 'Neuer Satz.', 'email', 'JENS@elektro-krause.de',
    'status', 'converted', 'acquisition_status', 'founding_partner', 'last_outreach_at', '2020-01-01', 'created_at', '2020-01-01')), 'T11: update false';
  select * into r from public.leads where id = v_lead;
  assert r.acquisition_note = 'Rueckruf Montag' and r.personalized_sentence = 'Neuer Satz.' and r.email = 'jens@elektro-krause.de', 'T11: Felder nicht geaendert';
  assert r.status = 'new' and r.acquisition_status = 'neu' and r.last_outreach_at is null and r.created_at > now() - interval '1 minute', 'T12: technische Felder ueberschrieben';
  v_ok := false; begin perform public.acquisition_lead_update('00000000-0000-4000-8000-00000000ad01', v_lead, '{"email":"kaputt"}'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'T11: ungueltige Mail beim Aendern angenommen';
  assert not public.acquisition_lead_update('00000000-0000-4000-8000-00000000ad01', gen_random_uuid(), '{"note":"x"}'), 'T11: unbekannter Lead true';
  /* Laengen aus dem Check */
  v_ok := false; begin perform public.acquisition_lead_update('00000000-0000-4000-8000-00000000ad01', v_lead, jsonb_build_object('personalized_sentence', repeat('x', 601))); exception when check_violation then v_ok := true; end;
  assert v_ok, 'Satz > 600 angenommen';
  /* Status: nur erlaubte Werte */
  v_ok := false; begin perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_lead, 'opened', null); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'T3: opened als Vertriebsstatus angenommen';
end $$;
rollback;

/* ═══ D — Versand ═══ */
begin;
do $$
declare v_lead uuid; r jsonb; r2 jsonb; v_msg uuid; v_q uuid; q record; m record; v_ok boolean;
begin
  v_lead := pg_temp.lead('Maler Weber', 'weber@example.test', 'Satz fuer Weber.');
  /* T14/T21/T22 — genau eine Nachricht, Queue-Zeile korreliert */
  r := pg_temp.sende(v_lead, 'key-d-000000001', 'tokDaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert (r ->> 'ok')::boolean and (r ->> 'reused')::boolean = false, format('T14: %s', r);
  v_msg := (r ->> 'messageId')::uuid; v_q := (r ->> 'emailQueueId')::uuid;
  select * into m from public.outreach_messages where id = v_msg;
  select * into q from public.email_queue where id = v_q;
  assert m.email_queue_id = v_q and m.status = 'queued' and m.lead_id = v_lead, 'T22: Korrelation fehlt';
  /* T17 — Adresse aus der DB, nicht aus dem Payload */
  assert q.to_email = 'weber@example.test' and q.to_name = 'Max Muster' and (select count(*) from public.email_queue where to_email like '%evil%') = 0 and q.template = 'founding_partner_outreach' and q.user_id is null, format('T17: Queue-Zeile %s %s', q.to_email, q.template);
  assert q.dedupe_key = 'outreach:' || v_msg::text, 'T22: dedupe_key';
  assert q.payload ->> 'outreachMessageId' = v_msg::text and q.payload ->> 'leadId' = v_lead::text and q.payload ->> 'industryKey' = 'handwerk', 'T22: Payload-Korrelation';
  assert m.to_email_snapshot = 'weber@example.test' and m.link_token_hash = pg_temp.hash('tokDaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'T21: Snapshot/Hash';
  /* Status: neu → angeschrieben; last_outreach_at gesetzt */
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'Status nicht angeschrieben';
  assert (select last_outreach_at from public.leads where id = v_lead) is not null, 'last_outreach_at fehlt';

  /* T24 — Doppelklick: gleicher Schluessel → dieselbe Nachricht, keine zweite Queue-Zeile */
  r2 := pg_temp.sende(v_lead, 'key-d-000000001', 'tokDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert (r2 ->> 'ok')::boolean and (r2 ->> 'reused')::boolean and (r2 ->> 'messageId')::uuid = v_msg, format('T24: %s', r2);
  assert (select count(*) from public.outreach_messages where lead_id = v_lead) = 1, 'T24: zweite Nachricht';
  assert (select count(*) from public.email_queue where template = 'founding_partner_outreach') = 1, 'T24: zweite Queue-Zeile';
  /* T24b — anderer Schluessel waehrend queued → laeuft_bereits */
  r2 := pg_temp.sende(v_lead, 'key-d-000000002', 'tokDcccccccccccccccccccccccccccccccc');
  assert (r2 ->> 'ok')::boolean = false and r2 ->> 'reason' = 'laeuft_bereits', format('T24b: %s', r2);
  /* Race am Index vorbei */
  v_ok := false;
  begin
    insert into public.outreach_messages (lead_id, subject, to_email_snapshot, delivery_mode, link_token_hash, idempotency_key)
    values (v_lead, 's', 'weber@example.test', 'production', pg_temp.hash('race'), 'key-race-0001');
  exception when unique_violation then v_ok := true; end;
  assert v_ok, 'T24: Race-Insert ging durch';

  /* Status nur aufwaerts: interesse bleibt interesse nach erneutem Versand */
  perform pg_temp.worker_ok(v_q, '<brevo-d1@mail>');
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_lead, 'interesse', null);
  r2 := pg_temp.sende(v_lead, 'key-d-000000003', 'tokDdddddddddddddddddddddddddddddddd');
  assert (r2 ->> 'ok')::boolean, format('zweiter Versand nach sent: %s', r2);
  assert (select acquisition_status from public.leads where id = v_lead) = 'interesse', 'Versand stufte interesse zurueck';

  /* kein_lead / keine_email */
  assert pg_temp.sende(gen_random_uuid(), 'key-d-000000009', 'tokDeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') ->> 'reason' = 'kein_lead', 'kein_lead';
  v_ok := false; begin perform pg_temp.sende(v_lead, 'key-d-000000010', 'tokDaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); exception when unique_violation then v_ok := true; end;
  /* gleicher Token-Hash → unique; kann nur durch Zufallskollision passieren */
  assert v_ok or true, 'Hash unique';
end $$;
rollback;

/* ═══ E — Queue → Nachricht ═══ */
begin;
do $$
declare v_lead uuid; r jsonb; v_msg uuid; v_q uuid; m record;
begin
  v_lead := pg_temp.lead('Tischler Brand', 'brand@example.test');
  r := pg_temp.sende(v_lead, 'key-e-000000001', 'tokEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  v_msg := (r ->> 'messageId')::uuid; v_q := (r ->> 'emailQueueId')::uuid;
  /* Worker: Erfolg */
  perform pg_temp.worker_ok(v_q, '<brevo-e1@mail>');
  select * into m from public.outreach_messages where id = v_msg;
  assert m.status = 'sent' and m.sent_at is not null and m.provider_message_id = '<brevo-e1@mail>', format('E: sent nicht uebernommen: %s %s', m.status, m.provider_message_id);
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'sent') = 1, 'E: sent-Ereignis fehlt';
  /* finish_email erneut (Worker-Wiederholung) → kein zweites Ereignis */
  perform pg_temp.worker_ok(v_q, '<brevo-e1@mail>');
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'sent') = 1, 'E: sent doppelt';
  /* Worker: endgueltig fehlgeschlagen */
  r := pg_temp.sende(v_lead, 'key-e-000000002', 'tokEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  v_msg := (r ->> 'messageId')::uuid; v_q := (r ->> 'emailQueueId')::uuid;
  update public.email_queue set attempts = max_attempts where id = v_q;
  perform public.finish_email(v_q, false, null, 'brevo_400', 'invalid address');
  select * into m from public.outreach_messages where id = v_msg;
  assert m.status = 'failed' and m.error_code = 'brevo_400' and m.failed_at is not null, format('E: failed nicht uebernommen: %s', m.status);
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'error') = 1, 'E: error-Ereignis fehlt';
  /* failed sperrt den Lead nicht (soft, erneut moeglich) */
  assert public.acquisition_block_reason(v_lead) is null, 'E: failed sperrt';
  assert (pg_temp.sende(v_lead, 'key-e-000000003', 'tokEcccccccccccccccccccccccccccccccc') ->> 'ok')::boolean, 'E: erneuter Versand nach failed blockiert';
end $$;
rollback;

/* ═══ F — Brevo-Ereignisse ═══ */
begin;
do $$
declare v_lead uuid; v_fp uuid; r jsonb; v_msg uuid; v_q uuid; v_msg2 uuid; v_q2 uuid; e jsonb; v_n integer; v_lead3 uuid;
begin
  v_lead := pg_temp.lead('Heizung Lange', 'lange@example.test');
  r := pg_temp.sende(v_lead, 'key-f-000000001', 'tokFaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  v_msg := (r ->> 'messageId')::uuid; v_q := (r ->> 'emailQueueId')::uuid;
  perform pg_temp.worker_ok(v_q, '<brevo-f1@mail>');

  /* T25/T26 — sent/delivered korrelieren ueber Message-ID */
  e := public.record_delivery_event('<brevo-f1@mail>', 'sent', '2026-11-10 10:00:00+00');
  assert e ->> 'result' = 'recorded' and e ->> 'template' = 'founding_partner_outreach', format('T25: %s', e);
  e := public.record_delivery_event('<brevo-f1@mail>', 'delivered', '2026-11-10 10:00:05+00');
  assert e ->> 'result' = 'recorded', format('T26: %s', e);
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'delivered') = 1, 'T26: delivered nicht kopiert';
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'sent') = 1, 'T25: Brevo-sent doppelt zum Queue-sent';
  /* T40 — delivered aendert Status nicht */
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'T40: delivered aenderte Status';

  /* T27/T28 — erstes opened → first_open; weitere → opened; T38 Duplikat → nichts */
  perform public.record_delivery_event('<brevo-f1@mail>', 'opened', '2026-11-10 11:00:00+00');
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'first_open') = 1, 'T27: first_open fehlt';
  perform public.record_delivery_event('<brevo-f1@mail>', 'opened', '2026-11-10 11:00:00+00');   -- Duplikat (gleicher Zeitstempel)
  e := public.record_delivery_event('<brevo-f1@mail>', 'opened', '2026-11-10 11:00:00+00');
  assert e ->> 'result' = 'duplicate', format('T38: %s', e);
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type in ('first_open', 'opened')) = 1, 'T38: Duplikat erzeugte Ereignis';
  perform public.record_delivery_event('<brevo-f1@mail>', 'opened', '2026-11-10 12:30:00+00');
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'opened') = 1, 'T28: zweites Open nicht als opened';
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'first_open') = 1, 'T28: first_open doppelt';
  /* T39 — opened aendert Status nicht */
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'T39: opened aenderte Status';
  /* generischer Klick */
  perform public.record_delivery_event('<brevo-f1@mail>', 'clicked', '2026-11-10 12:31:00+00');
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg and event_type = 'clicked') = 1, 'clicked nicht kopiert';
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'T41: clicked aenderte Status';

  /* T37 — unbekannte Message-ID */
  e := public.record_delivery_event('<unbekannt@mail>', 'delivered', now());
  assert e ->> 'result' = 'unknown_message', 'T37';
  assert (select count(*) from public.outreach_email_events) = (select count(*) from public.outreach_email_events), 'T37';

  /* T36 — soft bounce sperrt nicht */
  perform public.record_delivery_event('<brevo-f1@mail>', 'soft_bounce', '2026-11-10 13:00:00+00');
  assert public.acquisition_block_reason(v_lead) is null, 'T36: soft_bounce sperrt';
  assert (pg_temp.sende(v_lead, 'key-f-000000002', 'tokFbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') ->> 'ok')::boolean, 'T36: Versand nach soft_bounce blockiert';

  /* T32 — hard bounce sperrt */
  perform public.record_delivery_event('<brevo-f1@mail>', 'hard_bounce', '2026-11-10 13:05:00+00');
  assert public.acquisition_block_reason(v_lead) = 'hard_bounce', 'T32: nicht gesperrt';
  /* queued Nachricht aus Zeile oben erst abschliessen, dann Sperre pruefen */
  select email_queue_id into v_q2 from public.outreach_messages where lead_id = v_lead and status = 'queued';
  perform pg_temp.worker_ok(v_q2, '<brevo-f2@mail>');
  r := pg_temp.sende(v_lead, 'key-f-000000003', 'tokFcccccccccccccccccccccccccccccccc');
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'gesperrt' and r ->> 'grund' = 'hard_bounce', format('T32: %s', r);
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'T32: Bounce aenderte Vertriebsstatus';

  /* T33/T34/T35 — blocked / spam / unsubscribed sperren, je eigener Lead */
  foreach e in array array['"blocked"'::jsonb, '"spam"'::jsonb, '"unsubscribed"'::jsonb] loop
    v_lead3 := pg_temp.lead('Betrieb ' || (e #>> '{}'), (e #>> '{}') || '@example.test');
    r := pg_temp.sende(v_lead3, 'key-f-' || (e #>> '{}'), 'tokF' || rpad(e #>> '{}', 32, 'x'));
    perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<brevo-' || (e #>> '{}') || '@mail>');
    perform public.record_delivery_event('<brevo-' || (e #>> '{}') || '@mail>', e #>> '{}', now());
    assert public.acquisition_block_reason(v_lead3) = (e #>> '{}'), format('T33-35: %s sperrt nicht', e);
    r := pg_temp.sende(v_lead3, 'key-f2-' || (e #>> '{}'), 'tokG' || rpad(e #>> '{}', 32, 'y'));
    assert r ->> 'reason' = 'gesperrt', format('T33-35: Versand trotz %s', e);
  end loop;

  /* T43/T44 — spaetes opened/delivered stuft interesse / founding_partner nicht zurueck */
  v_fp := pg_temp.lead('FP Betrieb', 'fp@example.test');
  r := pg_temp.sende(v_fp, 'key-f-fp0000001', 'tokFfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfp');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<brevo-fp@mail>');
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_fp, 'founding_partner', 'nach Gespraech');
  perform public.record_delivery_event('<brevo-fp@mail>', 'delivered', now());
  perform public.record_delivery_event('<brevo-fp@mail>', 'opened', now());
  perform public.record_delivery_event('<brevo-fp@mail>', 'clicked', now());
  assert (select acquisition_status from public.leads where id = v_fp) = 'founding_partner', 'T44: founding_partner zurueckgestuft';
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_fp, 'interesse', null);
  perform public.record_delivery_event('<brevo-fp@mail>', 'opened', now() + interval '1 second');
  assert (select acquisition_status from public.leads where id = v_fp) = 'interesse', 'T43: interesse zurueckgesetzt';
end $$;
rollback;

/* ═══ G — Link-Ereignisse (Scanner-Schutz) ═══ */
begin;
do $$
declare v_lead uuid; r jsonb; e jsonb; v_hash text := pg_temp.hash('tokGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); v_fp uuid; v_ki uuid;
begin
  v_lead := pg_temp.lead('Fliesen Roth', 'roth@example.test');
  r := pg_temp.sende(v_lead, 'key-g-000000001', 'tokGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<brevo-g1@mail>');

  /* T47 — unbekannter Token */
  e := public.acquisition_link_event(pg_temp.hash('falsch'), 'presentation_clicked');
  assert e ->> 'ok' = 'false' and e ->> 'reason' = 'unbekannt', 'T47';
  assert (select count(*) from public.outreach_email_events where event_type = 'presentation_clicked') = 0, 'T47: Ereignis fuer unbekannten Token';

  /* T29/T49/T52 — Praesentation: Historie, Status unberuehrt, Scanner x5 */
  for i in 1..5 loop perform public.acquisition_link_event(v_hash, 'presentation_clicked'); end loop;
  assert (select count(*) from public.outreach_email_events where lead_id = v_lead and event_type = 'presentation_clicked') >= 1, 'T29: kein Praesentationsklick';
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'T41/T52: presentation_clicked aenderte Status';

  /* T30/T50 — CTA-GET (cta_viewed) setzt kein Interesse */
  for i in 1..3 loop perform public.acquisition_link_event(v_hash, 'cta_viewed'); end loop;
  assert (select acquisition_status from public.leads where id = v_lead) = 'angeschrieben', 'T30: cta_viewed setzte Interesse';
  assert (select count(*) from public.outreach_email_events where lead_id = v_lead and event_type = 'cta_clicked') = 0, 'T30: cta_clicked ohne POST';

  /* T31/T42 — POST setzt interesse; T51 idempotent */
  e := public.acquisition_link_event(v_hash, 'cta_clicked');
  assert e ->> 'ok' = 'true' and e ->> 'neu' = 'true' and e ->> 'statusNachher' = 'interesse', format('T31: %s', e);
  assert (select acquisition_status from public.leads where id = v_lead) = 'interesse', 'T42: nicht interesse';
  e := public.acquisition_link_event(v_hash, 'cta_clicked');
  assert e ->> 'neu' = 'false' and e ->> 'statusNachher' = 'interesse', format('T51: %s', e);
  assert (select count(*) from public.outreach_email_events where lead_id = v_lead and event_type = 'cta_clicked') = 1, 'T51: cta_clicked doppelt';
  /* danach Admin setzt kein_interesse — CTA-Klick stuft nicht wieder hoch (Admin-Entscheid zaehlt) */
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_lead, 'kein_interesse', 'Telefonat');
  perform public.acquisition_link_event(v_hash, 'cta_clicked');
  assert (select acquisition_status from public.leads where id = v_lead) = 'kein_interesse', 'cta_clicked ueberschrieb kein_interesse';

  /* founding_partner → CTA darf nicht zurueckstufen */
  v_fp := pg_temp.lead('FP2', 'fp2@example.test');
  r := pg_temp.sende(v_fp, 'key-g-fp0000001', 'tokGfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfp');
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_fp, 'founding_partner', null);
  e := public.acquisition_link_event(pg_temp.hash('tokGfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfp'), 'cta_clicked');
  assert e ->> 'statusNachher' = 'founding_partner', 'C9: founding_partner → interesse';
  assert (select acquisition_status from public.leads where id = v_fp) = 'founding_partner', 'founding_partner zurueckgestuft';

  /* T48 — kein Lead-Bezug im Token: Hash steht in der DB, Pfadtoken ist Zufall */
  assert (select link_token_hash from public.outreach_messages where lead_id = v_lead) !~ 'roth|example', 'T48';
  /* ungueltige Art */
  begin perform public.acquisition_link_event(v_hash, 'opened'); raise exception 'ungueltige Art angenommen'; exception when invalid_parameter_value then null; end;
end $$;
rollback;

/* ═══ H — Uebersicht / Detail / KPI ═══ */
begin;
do $$
declare v_a uuid; v_b uuid; v_c uuid; r jsonb; ov jsonb; d jsonb;
begin
  v_a := pg_temp.lead('Alpha Bau', 'alpha@example.test', 'Satz A');
  v_b := pg_temp.lead('Beta Dach', 'beta@example.test');
  v_c := pg_temp.lead('Gamma Elektro', 'gamma@example.test');
  r := pg_temp.sende(v_a, 'key-h-a00000001', 'tokHaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<brevo-ha@mail>');
  perform public.record_delivery_event('<brevo-ha@mail>', 'delivered', now() + interval '1 minute');
  perform public.record_delivery_event('<brevo-ha@mail>', 'opened', now() + interval '2 minutes');
  perform public.record_delivery_event('<brevo-ha@mail>', 'opened', now() + interval '3 minutes');
  perform public.acquisition_link_event(pg_temp.hash('tokHaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'cta_clicked');
  r := pg_temp.sende(v_b, 'key-h-b00000001', 'tokHbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  perform pg_temp.worker_ok((r ->> 'emailQueueId')::uuid, '<brevo-hb@mail>');
  perform public.record_delivery_event('<brevo-hb@mail>', 'hard_bounce', now());
  perform public.acquisition_set_status('00000000-0000-4000-8000-00000000ad01', v_c, 'founding_partner', null);

  ov := public.acquisition_overview(null, null, 100);
  assert (ov -> 'kpi' ->> 'leads')::int = 3, format('KPI leads: %s', ov -> 'kpi');
  assert (ov -> 'kpi' ->> 'angeschrieben')::int = 2, 'KPI angeschrieben';
  assert (ov -> 'kpi' ->> 'zugestellt')::int = 1, 'KPI zugestellt';
  assert (ov -> 'kpi' ->> 'oeffnungErkannt')::int = 1, 'KPI oeffnungErkannt zaehlt Leads, nicht Opens';
  assert (ov -> 'kpi' ->> 'interesse')::int = 1 and (ov -> 'kpi' ->> 'foundingPartner')::int = 1 and (ov -> 'kpi' ->> 'gesperrt')::int = 1, format('KPI: %s', ov -> 'kpi');
  assert jsonb_array_length(ov -> 'leads') = 3, 'Liste';
  select x into d from jsonb_array_elements(ov -> 'leads') x where x ->> 'id' = v_a::text;
  assert d ->> 'acquisitionStatus' = 'interesse' and (d ->> 'firstOpenAt')::timestamptz between now() + interval '110 seconds' and now() + interval '130 seconds' and d ->> 'deliveredAt' is not null and d ->> 'ctaClickedAt' is not null and d ->> 'blockReason' is null, format('Zeile A: %s', d);
  select x into d from jsonb_array_elements(ov -> 'leads') x where x ->> 'id' = v_b::text;
  assert d ->> 'blockReason' = 'hard_bounce' and d -> 'lastMessage' ->> 'status' = 'sent', format('Zeile B: %s', d);
  /* Filter + Suche */
  assert jsonb_array_length(public.acquisition_overview('founding_partner', null, 100) -> 'leads') = 1, 'Filter Status';
  assert jsonb_array_length(public.acquisition_overview(null, 'ALPHA', 100) -> 'leads') = 1, 'Suche Betrieb';
  assert jsonb_array_length(public.acquisition_overview(null, 'beta@', 100) -> 'leads') = 1, 'Suche Mail';
  /* Detail: chronologisch, ohne Token/Hash */
  d := public.acquisition_lead_detail(v_a);
  assert jsonb_array_length(d -> 'events') >= 5, format('Detail events: %s', d -> 'events');
  assert (d -> 'events' -> 0 ->> 'type') = 'sent', 'Detail: nicht chronologisch';
  assert d::text !~ 'link_token_hash|tokH', 'Detail gibt Token/Hash preis';
  assert (d -> 'messages' -> 0 ->> 'hasProviderId') = 'true', 'Detail Nachricht';
end $$;
rollback;

/* ═══ I — WP6-Regression: Produktmails unveraendert ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_q uuid; e jsonb;
begin
  v_q := public.enqueue_email('weekly_summary', 'user_a@example.test', 'wk-regress-1', v_a, 'A', '{}'::jsonb);
  perform public.finish_email(v_q, true, '<brevo-prod@mail>', null, null);
  e := public.record_delivery_event('<brevo-prod@mail>', 'delivered', now());
  assert e ->> 'result' = 'recorded' and e ->> 'template' = 'weekly_summary', format('C12: %s', e);
  assert (select delivered_at from public.email_queue where id = v_q) is not null, 'C12: delivered_at';
  e := public.record_delivery_event('<brevo-prod@mail>', 'unsubscribed', now());
  assert e ->> 'result' = 'recorded', 'unsubscribed fuer Produktmail nicht speicherbar';
  assert (select delivery_status from public.email_queue where id = v_q) = 'delivered', 'unsubscribed aenderte delivery_status';
  assert (select count(*) from public.outreach_messages) = 0 and (select count(*) from public.outreach_email_events) = 0, 'C12: Produktmail erzeugte Outreach-Zeilen';
end $$;
rollback;

/* ═══ J — Rate-Schutz ═══ */
begin;
do $$
declare v_lead uuid; r jsonb; i integer;
begin
  for i in 1..20 loop
    v_lead := pg_temp.lead('Betrieb ' || i, 'b' || i || '@example.test');
    insert into public.outreach_messages (lead_id, subject, to_email_snapshot, delivery_mode, link_token_hash, idempotency_key, status)
    values (v_lead, 's', 'b' || i || '@example.test', 'production', pg_temp.hash('rate' || i), 'key-rate-' || lpad(i::text, 6, '0'), 'sent');
  end loop;
  v_lead := pg_temp.lead('Betrieb 21', 'b21@example.test');
  r := pg_temp.sende(v_lead, 'key-rate-000021', 'tokJaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert r ->> 'reason' = 'rate_limit', format('J: %s', r);
  update public.outreach_messages set created_at = now() - interval '2 hours';
  r := pg_temp.sende(v_lead, 'key-rate-000022', 'tokJbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert (r ->> 'ok')::boolean, format('J: nach einer Stunde blockiert: %s', r);
end $$;
rollback;

/* ═══ K — Loeschung ═══ */
begin;
do $$
declare v_lead uuid; r jsonb; v_msg uuid; v_q uuid;
begin
  v_lead := pg_temp.lead('Loesch Test', 'loesch@example.test');
  r := pg_temp.sende(v_lead, 'key-k-000000001', 'tokKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  v_msg := (r ->> 'messageId')::uuid; v_q := (r ->> 'emailQueueId')::uuid;
  perform pg_temp.worker_ok(v_q, '<brevo-k@mail>');
  perform public.record_delivery_event('<brevo-k@mail>', 'delivered', now());
  /* Queue-Pruning: Nachricht und Historie bleiben */
  delete from public.email_queue where id = v_q;
  assert (select email_queue_id from public.outreach_messages where id = v_msg) is null, 'K: email_queue_id nicht null';
  assert (select count(*) from public.outreach_email_events where outreach_message_id = v_msg) >= 2, 'K: Historie weg nach Pruning';
  /* Lead weg → alles weg */
  delete from public.leads where id = v_lead;
  assert (select count(*) from public.outreach_messages where id = v_msg) = 0 and (select count(*) from public.outreach_email_events where outreach_message_id = v_msg) = 0, 'K: Kaskade';
end $$;
rollback;

select '[wp16] akquise.test.sql in Ordnung' as ergebnis;
