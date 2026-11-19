-- WP17.2 — „Nachfassen fällig": nur Anzeige, mit Wirkung geprüft.
--
--   scripts/test-db/run.sh akquise_nachfassen
--
--   F1  Werktage: Do→Do, Fr→Fr, Sa/So→Fr, über Monatswechsel
--   F2  fällig ab = 5 Werktage nach Mail 1 (Datum Europe/Berlin)
--   F3  vor Ablauf nicht fällig, danach fällig (Liste, Filter, KPI)
--   F4  nicht fällig nach Antwort, nach Nachfassen, bei Sperre, ohne Mail 1
--   F5  Filter zeigt nur Fällige, älteste zuerst; KPI = Anzahl
--   F6  Anzeige versendet nichts und ändert keinen Status
--   F7  Rechte: nur service_role

\set ON_ERROR_STOP on

create or replace function pg_temp.lead(p_firma text, p_email text) returns uuid language sql as $$
  select public.acquisition_lead_create('00000000-0000-4000-8000-00000000ad01',
    jsonb_build_object('company_name', p_firma, 'email', p_email, 'contact_person', 'Max Muster',
                       'google_profile_finding', 'Du hast 7 Bewertungen.', 'finding_type', 'wenige_bewertungen'))
$$;
/* Mail 1 senden und als gesendet abschliessen; sent_at danach gezielt setzen. */
create or replace function pg_temp.gesendet(p_lead uuid, p_key text, p_sent timestamptz) returns uuid language plpgsql as $$
declare v text; r jsonb;
begin
  v := public.acquisition_assign_subject_variant(p_lead);
  r := public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', p_lead, p_key, 'outreach_erstkontakt',
         'Deine Google-Bewertungen', 'production', jsonb_build_object('variante', v, 'text', 'Moin Max'));
  perform public.finish_email((r ->> 'emailQueueId')::uuid, true, '<' || p_key || '@mail>', null, null);
  update public.outreach_messages set sent_at = p_sent where id = (r ->> 'messageId')::uuid;
  update public.leads set last_outreach_at = p_sent where id = p_lead;
  return (r ->> 'messageId')::uuid;
end $$;
create or replace function pg_temp.zeile(p_lead uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.acquisition_overview(null, null, 500, null) -> 'leads') x where x ->> 'id' = p_lead::text
$$;
create or replace function pg_temp.heute() returns date language sql as $$ select (now() at time zone 'Europe/Berlin')::date $$;

/* ═══ F1 — Werktage ═══ */
do $$
begin
  assert public.acquisition_werktage_spaeter('2026-11-19', 5) = '2026-11-26', 'F1: Do';
  assert public.acquisition_werktage_spaeter('2026-11-20', 5) = '2026-11-27', 'F1: Fr';
  assert public.acquisition_werktage_spaeter('2026-11-21', 5) = '2026-11-27', 'F1: Sa';
  assert public.acquisition_werktage_spaeter('2026-11-22', 5) = '2026-11-27', 'F1: So';
  assert public.acquisition_werktage_spaeter('2026-11-23', 5) = '2026-11-30', 'F1: Mo';
  assert public.acquisition_werktage_spaeter('2026-11-27', 5) = '2026-12-04', 'F1: Monatswechsel';
  assert public.acquisition_werktage_spaeter('2026-11-19', 1) = '2026-11-20', 'F1: 1 Werktag';
end $$;

/* ═══ F2–F6 ═══ */
begin;
select test.basis();
do $$
declare v_alt uuid; v_frisch uuid; v_antwort uuid; v_nach uuid; v_gesperrt uuid; v_ohne uuid; v_aelter uuid;
        z jsonb; liste jsonb; n_queue int; n_status text;
begin
  v_alt := pg_temp.lead('Alt GmbH', 'alt@example.test');
  v_aelter := pg_temp.lead('Noch Aelter GmbH', 'aelter@example.test');
  v_frisch := pg_temp.lead('Frisch GmbH', 'frisch@example.test');
  v_antwort := pg_temp.lead('Antwort GmbH', 'antwort@example.test');
  v_nach := pg_temp.lead('Nachgefasst GmbH', 'nach@example.test');
  v_gesperrt := pg_temp.lead('Gesperrt GmbH', 'gesperrt@example.test');
  v_ohne := pg_temp.lead('Ohne Mail GmbH', 'ohne@example.test');

  perform pg_temp.gesendet(v_alt, 'key-f-0000000001', now() - interval '10 days');
  perform pg_temp.gesendet(v_aelter, 'key-f-0000000002', now() - interval '20 days');
  perform pg_temp.gesendet(v_frisch, 'key-f-0000000003', now());
  perform pg_temp.gesendet(v_antwort, 'key-f-0000000004', now() - interval '10 days');
  perform pg_temp.gesendet(v_nach, 'key-f-0000000005', now() - interval '10 days');
  perform pg_temp.gesendet(v_gesperrt, 'key-f-0000000006', now() - interval '10 days');
  perform public.acquisition_record_reply('00000000-0000-4000-8000-00000000ad01', v_antwort, 'sonstige');
  perform public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', v_nach, 'key-f-0000000007', 'outreach_nachfass',
                                           'x', 'production', '{}'::jsonb);
  perform public.acquisition_record_reply('00000000-0000-4000-8000-00000000ad01', v_gesperrt, 'negativ');

  /* F2 — Datum */
  z := pg_temp.zeile(v_frisch);
  assert (z ->> 'followupAb')::date = public.acquisition_werktage_spaeter(pg_temp.heute(), 5), format('F2: %s', z ->> 'followupAb');
  assert (z ->> 'followupAb')::date > pg_temp.heute(), 'F2: liegt nicht in der Zukunft';
  /* F3 — frisch nicht fällig, alt fällig */
  assert (z ->> 'followupFaellig')::boolean = false, 'F3: frisch faellig';
  assert (z ->> 'followupMoeglich')::boolean = true, 'F3: frisch nicht moeglich (darf, nur noch nicht faellig)';
  assert (pg_temp.zeile(v_alt) ->> 'followupFaellig')::boolean, 'F3: alt nicht faellig';
  /* F4 */
  assert (pg_temp.zeile(v_antwort) ->> 'followupFaellig')::boolean = false, 'F4: nach Antwort faellig';
  assert (pg_temp.zeile(v_nach) ->> 'followupFaellig')::boolean = false, 'F4: nach Nachfassen faellig';
  assert (pg_temp.zeile(v_gesperrt) ->> 'followupFaellig')::boolean = false, 'F4: gesperrt faellig';
  assert (pg_temp.zeile(v_ohne) ->> 'followupFaellig')::boolean = false, 'F4: ohne Mail 1 faellig';
  assert pg_temp.zeile(v_ohne) -> 'followupAb' = 'null'::jsonb, 'F4: ohne Mail 1 hat Datum';
  /* Detail liefert dasselbe */
  assert (public.acquisition_lead_detail(v_alt) -> 'lead' ->> 'followupFaellig')::boolean, 'F4: Detail alt';
  assert (public.acquisition_lead_detail(v_frisch) -> 'lead' ->> 'followupAb')::date = (z ->> 'followupAb')::date, 'F4: Detail Datum';

  /* F5 — Filter + KPI */
  liste := public.acquisition_overview('nachfassen_faellig', null, 500, null);
  assert jsonb_array_length(liste -> 'leads') = 2, format('F5: %s Zeilen', jsonb_array_length(liste -> 'leads'));
  assert liste -> 'leads' -> 0 ->> 'id' = v_aelter::text and liste -> 'leads' -> 1 ->> 'id' = v_alt::text, 'F5: Reihenfolge';
  assert (liste -> 'kpi' ->> 'nachfassenFaellig')::int = 2, format('F5: KPI %s', liste -> 'kpi' ->> 'nachfassenFaellig');
  /* andere Filter unverändert */
  assert jsonb_array_length(public.acquisition_overview('neu', null, 500, null) -> 'leads') = 1, 'F5: Statusfilter neu';

  /* F6 — Anzeige ist folgenlos */
  select count(*) into n_queue from public.email_queue;
  select acquisition_status into n_status from public.leads where id = v_alt;
  perform public.acquisition_overview('nachfassen_faellig', null, 500, null);
  perform public.acquisition_lead_detail(v_alt);
  assert (select count(*) from public.email_queue) = n_queue, 'F6: Mail eingereiht';
  assert (select acquisition_status from public.leads where id = v_alt) = n_status, 'F6: Status geaendert';
end $$;
rollback;

/* ═══ F7 — Rechte ═══ */
do $$
declare f text;
begin
  foreach f in array array['public.acquisition_werktage_spaeter(date,integer)', 'public.acquisition_followup_ab(uuid)',
                           'public.acquisition_followup_faellig(uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('F7: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('F7: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('F7: service_role darf %s nicht', f);
  end loop;
end $$;
