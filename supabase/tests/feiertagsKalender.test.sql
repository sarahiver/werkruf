-- WP9 — Feiertags-Kalender: Datenbankseite.
--
--   scripts/test-db/run.sh feiertagsKalender
--
-- Die Feiertagslogik liegt im JS (src/utils/feiertage.js, Jest).
-- Hier: der Engine-Kontext liefert die Rohdaten je Standort, getrennt
-- und nur fuer Eigentuemer; die Event-Identitaet traegt den Lifecycle
-- (T21–T24) wie fuer jede andere Regel.

\set ON_ERROR_STOP on

begin;
select test.basis();
select test.fremder();
insert into test.bezeichner (name, id) values ('standort_fremd', '77777777-7777-7777-7777-777777777777') on conflict (name) do nothing;
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);
do $$
declare
  v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b');
  v_si uuid := test.id('standort_si'); v_wr uuid := test.id('standort_werkruf');
  v_ctx jsonb; v_ok boolean;
begin
  /* Hamburg-Standort mit Zeiten, Bayern-Standort ohne Sonderzeiten, nie synchronisiert */
  update public.google_locations set last_synced_at = now(),
    google_profile = jsonb_build_object(
      'storefrontAddress', jsonb_build_object('addressLines', jsonb_build_array('Große Freiheit 82'), 'locality', 'Hamburg', 'administrativeArea', 'Hamburg', 'regionCode', 'DE'),
      'regularHours', jsonb_build_object('periods', jsonb_build_array(jsonb_build_object('openDay', 'FRIDAY', 'openTime', jsonb_build_object('hours', 8), 'closeDay', 'FRIDAY', 'closeTime', jsonb_build_object('hours', 17)))),
      'specialHours', jsonb_build_object('specialHourPeriods', jsonb_build_array(jsonb_build_object('startDate', jsonb_build_object('year', 2026, 'month', 12, 'day', 25), 'closed', true))))
   where id = v_si;
  update public.google_locations set last_synced_at = null,
    google_profile = jsonb_build_object(
      'storefrontAddress', jsonb_build_object('administrativeArea', 'Bayern', 'regionCode', 'DE'))
   where id = v_wr;

  v_ctx := public.build_location_evaluation_context(v_a, v_si);
  assert v_ctx ? 'hours', format('Kontext ohne hours: %s', v_ctx);
  assert (v_ctx -> 'hours' ->> 'reliable')::boolean, 'S&I: reliable erwartet';
  assert v_ctx -> 'hours' -> 'storefrontAddress' ->> 'administrativeArea' = 'Hamburg', 'S&I: Bundesland fehlt';
  assert jsonb_array_length(v_ctx -> 'hours' -> 'regularPeriods') = 1, 'S&I: regularPeriods';
  assert jsonb_array_length(v_ctx -> 'hours' -> 'specialHourPeriods') = 1, 'S&I: specialHourPeriods';
  assert v_ctx -> 'hours' -> 'specialHourPeriods' -> 0 -> 'startDate' ->> 'day' = '25', 'S&I: Sonderzeit-Datum';
  /* WP8 bleibt */
  assert v_ctx ? 'profileDiffs', 'WP8 profileDiffs verloren';

  /* T19 — keine Vermischung: Bayern-Standort hat eigene Daten, nicht reliable (nie synchronisiert, keine regularHours) */
  v_ctx := public.build_location_evaluation_context(v_a, v_wr);
  assert (v_ctx -> 'hours' ->> 'reliable')::boolean = false, 'WERKRUF: reliable obwohl nie synchronisiert';
  assert v_ctx -> 'hours' -> 'storefrontAddress' ->> 'administrativeArea' = 'Bayern', 'WERKRUF: Bundesland';
  assert jsonb_array_length(v_ctx -> 'hours' -> 'specialHourPeriods') = 0, 'WERKRUF: Sonderzeiten von S&I uebernommen';

  /* Fremder Nutzer bekommt den Kontext des fremden Standorts nicht:
     locationResolved false, kein hours-Block (bestehender Vertrag) */
  v_ctx := public.build_location_evaluation_context(v_b, v_si);
  assert (v_ctx ->> 'locationResolved')::boolean = false, format('fremder Standort aufgeloest: %s', v_ctx);
  assert not (v_ctx ? 'hours'), 'fremder Nutzer sieht hours des fremden Standorts';
  v_ok := true;

  /* Rechte: Kontextbauer nicht fuer anon */
  assert not pg_catalog.has_function_privilege('anon', 'public.build_location_evaluation_context(uuid,uuid)', 'EXECUTE'), 'anon darf Kontext bauen';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T21–T24 — Lifecycle ueber die Engine-Identitaet
   (sync_events + resolve_stale_events, wie fuer jede Regel)
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si');
  v_subj uuid := 'a1b2c3d4-0000-8000-8000-000000000001';
  v_ev jsonb; v_n integer; v_id1 uuid; v_id2 uuid;
begin
  v_ev := jsonb_build_array(jsonb_build_object(
    'type', 'profile.holiday_hours_missing', 'category', 'profile', 'priority', 45,
    'title', 'Weihnachten vorbereiten', 'summary', 'x', 'reason', 'x', 'expectedBenefit', 'x',
    'estimatedMinutes', 2, 'actionUrl', '/dashboard/google?holiday=2026-12-25',
    'inDashboard', true, 'inWeeklyEmail', true, 'asNotification', false,
    'subjectType', 'holiday', 'subjectId', v_subj, 'recommendationClass', 'problem',
    'ruleVersion', '1.0', 'ruleStatus', 'active', 'confidence', 1.0,
    'explanation', jsonb_build_object('sourceFacts', jsonb_build_array('holidays.open'), 'triggeredRule', 'profile.holiday_hours_missing', 'reason', 'x', 'expectedOutcome', 'x')));

  /* T21 — erster Lauf: genau ein Event */
  perform public.sync_events(v_a, v_ev, '1.0', v_si);
  select count(*), (array_agg(id))[1] into v_n, v_id1 from public.events where user_id = v_a and type = 'profile.holiday_hours_missing' and lifecycle in ('new','seen','opened');
  assert v_n = 1, format('T21: %s Events', v_n);

  /* T22 — naechster Lauf, gleiches Subjekt: kein zweites */
  perform public.sync_events(v_a, v_ev, '1.0', v_si);
  select count(*), (array_agg(id))[1] into v_n, v_id2 from public.events where user_id = v_a and type = 'profile.holiday_hours_missing' and lifecycle in ('new','seen','opened');
  assert v_n = 1 and v_id2 = v_id1, format('T22/C4: %s Events, gleiche ID %s', v_n, v_id2 = v_id1);

  /* T25 — Prioritaet steigt (high) → dasselbe Event wird aktualisiert, nicht verdoppelt */
  perform public.sync_events(v_a, jsonb_set(v_ev, '{0,priority}', '70'), '1.0', v_si);
  select count(*) into v_n from public.events where user_id = v_a and type = 'profile.holiday_hours_missing' and lifecycle in ('new','seen','opened');
  assert v_n = 1, 'T25: Prioritaetswechsel erzeugte zweites Event';
  assert (select priority from public.events where id = v_id1) = 70, 'T25: Prioritaet nicht aktualisiert';

  /* T23/T24 — Regel liefert nichts mehr (Sonderzeit gesetzt oder Feiertag vorbei) → stale */
  perform public.sync_events(v_a, '[]'::jsonb, '1.0', v_si);
  perform public.resolve_stale_events(v_a, '[]'::jsonb, v_si);
  select count(*) into v_n from public.events where user_id = v_a and type = 'profile.holiday_hours_missing' and lifecycle in ('new','seen','opened');
  assert v_n = 0, format('T23/T24: Event bleibt offen (%s)', v_n);
  assert (select lifecycle from public.events where id = v_id1) in ('resolved', 'expired', 'superseded'), format('T23: Lifecycle %s', (select lifecycle from public.events where id = v_id1));
end $$;
rollback;

select '[wp9] feiertagsKalender: alle Abschnitte bestanden' as ergebnis;
