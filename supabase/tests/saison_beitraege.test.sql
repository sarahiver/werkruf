-- WP15 — Saison-Beitraege: Datenbankseite.
--
--   scripts/test-db/run.sh saison_beitraege
--
--   T23       Free → kein_zugang (seasonal_post_begin), Pro/FP → ok
--   T19       fremder Standort → 42501; Event eines anderen Standorts → 42501
--   T36–T39   Sperre: publishing blockt (laeuft_bereits), published blockt
--             (bereits_veroeffentlicht), Race → unique_violation → laeuft_bereits,
--             failed/rejected sperren NICHT; naechstes Saisonjahr frei
--   finish    nur aus publishing; REJECTED → rejected + error_code; state_update
--   Kontext   build_location_evaluation_context.seasonalPosts nur publishing/published
--   Engine    sync_events: ein Event je Subjekt; record_recommendation_action completed
--   Rechte    RPCs service_role only; authenticated liest nur Eigenes, schreibt nicht
--   Loeschung Nutzer weg → Zeilen weg; Standort weg → Zeilen weg; Event weg → null

\set ON_ERROR_STOP on

create or replace function pg_temp.als(p_user uuid) returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', p_user);
end $$;

/* ═══ T23 / T19 — Zugang und Besitz ═══ */
begin;
select test.basis();
select test.fremder();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_si uuid := test.id('standort_si'); v_wr uuid := test.id('standort_werkruf');
        v_fremd uuid := gen_random_uuid(); r jsonb; v_ok boolean; v_ev uuid;
begin
  insert into public.google_locations (id, user_id, account_id, account_resource_name, location_resource_name, title, selected_at)
  values (v_fremd, v_b, test.id('konto_b'), 'accounts/fremd', 'locations/fremd', 'Fremder Betrieb', now());

  /* T23 — Free */
  update public.user_profiles set plan = 'free', stripe_subscription_status = 'canceled', stripe_subscription_id = 'sub_alt' where id = v_a;
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'kein_zugang', format('T23: Free durfte: %s', r);
  assert (select count(*) from public.seasonal_posts) = 0, 'T23: Zeile trotz Free';
  /* Pro */
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('T23: Pro abgelehnt: %s', r);
  /* FP */
  perform public.set_founding_partner(v_b, 'Test');
  r := public.seasonal_post_begin(v_b, v_fremd, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('T23: FP abgelehnt: %s', r);

  /* T19 — fremder Standort */
  v_ok := false;
  begin perform public.seasonal_post_begin(v_a, v_fremd, 'sommer', 2026, null, 'Einen schönen Sommer wünscht das Team.'); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T19: fremder Standort angenommen';
  assert (select count(*) from public.seasonal_posts where user_id = v_a) = 1, 'T19: Zeile trotzdem da';

  /* T19b — Event gehoert zu anderem Standort desselben Nutzers → 42501 */
  insert into public.events (user_id, location_id, type, category, priority, title, summary, subject_id)
  values (v_a, v_wr, 'content.seasonal_post', 'visibility', 29, 'Sommerbeitrag', 'x', gen_random_uuid()) returning id into v_ev;
  v_ok := false;
  begin perform public.seasonal_post_begin(v_a, v_si, 'sommer', 2026, v_ev, 'Einen schönen Sommer wünscht das Team.'); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T19b: Event eines anderen Standorts angenommen';
  /* Event eines anderen Nutzers → 42501 */
  insert into public.events (user_id, location_id, type, category, priority, title, summary, subject_id)
  values (v_b, v_fremd, 'content.seasonal_post', 'visibility', 29, 'Sommerbeitrag', 'x', gen_random_uuid()) returning id into v_ev;
  v_ok := false;
  begin perform public.seasonal_post_begin(v_a, v_si, 'sommer', 2026, v_ev, 'Einen schönen Sommer wünscht das Team.'); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T19c: Event eines anderen Nutzers angenommen';

  /* Formpruefung: Key, Jahr, Text */
  v_ok := false; begin perform public.seasonal_post_begin(v_a, v_si, 'Rabatt Woche!', 2026, null, 'Text lang genug für den Check.'); exception when check_violation then v_ok := true; end;
  assert v_ok, 'ungueltiger season_key angenommen';
  v_ok := false; begin perform public.seasonal_post_begin(v_a, v_si, 'sommer', 1999, null, 'Text lang genug für den Check.'); exception when check_violation then v_ok := true; end;
  assert v_ok, 'ungueltiges Jahr angenommen';
  v_ok := false; begin perform public.seasonal_post_begin(v_a, v_si, 'sommer', 2026, null, repeat('x', 1501)); exception when check_violation then v_ok := true; end;
  assert v_ok, '1501 Zeichen angenommen';
  v_ok := false; begin perform public.seasonal_post_begin(v_a, v_si, 'sommer', 2026, null, ''); exception when check_violation then v_ok := true; end;
  assert v_ok, 'leerer Text angenommen';
end $$;
rollback;

/* ═══ T36–T39 — Sperre und Lebenszyklus ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si'); r jsonb; v_id1 uuid; v_id2 uuid; v_ok boolean; rec record;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;

  /* T36 — begin → publishing */
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('T36: %s', r); v_id1 := (r ->> 'id')::uuid;
  assert (select status from public.seasonal_posts where id = v_id1) = 'publishing', 'T36: Status nicht publishing';

  /* T39 — zweiter Klick waehrend publishing → laeuft_bereits, keine zweite Zeile */
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'laeuft_bereits', format('T39: %s', r);
  assert (select count(*) from public.seasonal_posts where user_id = v_a) = 1, 'T39: zweite Zeile';

  /* Race: der Index selbst haelt — direkter Insert an der Funktion vorbei */
  v_ok := false;
  begin
    insert into public.seasonal_posts (user_id, location_id, season_key, season_year, summary_snapshot, status)
    values (v_a, v_si, 'weihnachten', 2026, 'Frohe Weihnachten wünscht das Team.', 'publishing');
  exception when unique_violation then v_ok := true; end;
  assert v_ok, 'Race: Unique-Index greift nicht';

  /* finish → published (PROCESSING) */
  assert public.seasonal_post_finish(v_id1, 'published', 'accounts/1/locations/2/localPosts/3', 'PROCESSING', null), 'finish published false';
  select * into rec from public.seasonal_posts where id = v_id1;
  assert rec.status = 'published' and rec.google_state = 'PROCESSING' and rec.published_at is not null and rec.error_code is null, format('finish: %s %s', rec.status, rec.google_state);
  /* finish zweimal → false, nichts geaendert */
  assert not public.seasonal_post_finish(v_id1, 'failed', null, null, 'x'), 'finish aus published moeglich';
  assert (select status from public.seasonal_posts where id = v_id1) = 'published', 'finish hat published ueberschrieben';

  /* T37 — published blockt */
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'bereits_veroeffentlicht', format('T37: %s', r);

  /* naechstes Saisonjahr frei; andere Saison frei */
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2027, null, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('2027 blockiert: %s', r);
  r := public.seasonal_post_begin(v_a, v_si, 'jahreswechsel', 2026, null, 'Ein gutes neues Jahr wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('andere Saison blockiert: %s', r); v_id2 := (r ->> 'id')::uuid;

  /* T38 — failed sperrt nicht */
  assert public.seasonal_post_finish(v_id2, 'failed', null, null, 'google_api_error'), 'finish failed false';
  select * into rec from public.seasonal_posts where id = v_id2;
  assert rec.status = 'failed' and rec.error_code = 'google_api_error' and rec.failed_at is not null and rec.published_at is null, 'failed-Zeile falsch';
  r := public.seasonal_post_begin(v_a, v_si, 'jahreswechsel', 2026, null, 'Ein gutes neues Jahr wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('T38: failed sperrt: %s', r); v_id2 := (r ->> 'id')::uuid;
  /* REJECTED sperrt nicht */
  assert public.seasonal_post_finish(v_id2, 'rejected', 'accounts/1/locations/2/localPosts/9', 'REJECTED', 'google_rejected'), 'finish rejected false';
  assert (select status from public.seasonal_posts where id = v_id2) = 'rejected', 'rejected nicht gesetzt';
  r := public.seasonal_post_begin(v_a, v_si, 'jahreswechsel', 2026, null, 'Ein gutes neues Jahr wünscht das Team — zweiter Versuch.');
  assert (r ->> 'ok')::boolean, format('T38: rejected sperrt: %s', r);
  assert (select count(*) from public.seasonal_posts where user_id = v_a and season_key = 'jahreswechsel') = 3, 'Historie fehlt';

  /* ungueltiger Zielstatus */
  v_ok := false; begin perform public.seasonal_post_finish(v_id1, 'live', null, null, null); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'finish akzeptiert fremden Status';

  /* state_update: published → REJECTED nachgetragen */
  assert public.seasonal_post_state_update(v_id1, 'LIVE'), 'state_update LIVE false';
  assert (select google_state from public.seasonal_posts where id = v_id1) = 'LIVE' and (select status from public.seasonal_posts where id = v_id1) = 'published', 'LIVE nicht gesetzt';
  assert public.seasonal_post_state_update(v_id1, 'REJECTED'), 'state_update REJECTED false';
  assert (select status from public.seasonal_posts where id = v_id1) = 'rejected', 'REJECTED → rejected fehlt';
  assert not public.seasonal_post_state_update(v_id1, 'LIVE'), 'state_update aus rejected moeglich';
end $$;
rollback;

/* ═══ Kontext + Engine ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si'); v_wr uuid := test.id('standort_werkruf');
        v_subj uuid := 'a1b2c3d4-0000-8000-8000-000000000015'; r jsonb; ctx jsonb; v_ev jsonb; v_n integer; v_id1 uuid; v_id2 uuid; v_post uuid;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  ctx := public.build_location_evaluation_context(v_a, v_si);
  assert ctx ? 'seasonalPosts' and jsonb_typeof(ctx -> 'seasonalPosts') = 'array' and jsonb_array_length(ctx -> 'seasonalPosts') = 0, format('Kontext leer: %s', ctx -> 'seasonalPosts');

  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.'); v_post := (r ->> 'id')::uuid;
  ctx := public.build_location_evaluation_context(v_a, v_si);
  assert ctx -> 'seasonalPosts' @> '[{"seasonKey":"weihnachten","seasonYear":2026,"status":"publishing"}]', format('publishing fehlt: %s', ctx -> 'seasonalPosts');
  perform public.seasonal_post_finish(v_post, 'published', 'accounts/1/locations/2/localPosts/3', 'PROCESSING', null);
  ctx := public.build_location_evaluation_context(v_a, v_si);
  assert ctx -> 'seasonalPosts' @> '[{"seasonKey":"weihnachten","seasonYear":2026,"status":"published","googleState":"PROCESSING"}]', format('published fehlt: %s', ctx -> 'seasonalPosts');
  /* anderer Standort desselben Nutzers sieht ihn nicht */
  assert jsonb_array_length(public.build_location_evaluation_context(v_a, v_wr) -> 'seasonalPosts') = 0, 'Kontext mischt Standorte';
  /* failed/rejected tauchen nicht auf */
  r := public.seasonal_post_begin(v_a, v_si, 'sommer', 2026, null, 'Einen schönen Sommer wünscht das Team.');
  perform public.seasonal_post_finish((r ->> 'id')::uuid, 'failed', null, null, 'google_api_error');
  r := public.seasonal_post_begin(v_a, v_si, 'sommer', 2026, null, 'Einen schönen Sommer wünscht das Team.');
  perform public.seasonal_post_finish((r ->> 'id')::uuid, 'rejected', null, 'REJECTED', 'google_rejected');
  ctx := public.build_location_evaluation_context(v_a, v_si);
  assert jsonb_array_length(ctx -> 'seasonalPosts') = 1, format('failed/rejected im Kontext: %s', ctx -> 'seasonalPosts');

  /* Engine: genau ein Event je Subjekt, zweiter Lauf verdoppelt nicht */
  v_ev := jsonb_build_array(jsonb_build_object(
    'type', 'content.seasonal_post', 'category', 'visibility', 'priority', 29,
    'title', 'Weihnachtsbeitrag vorbereiten', 'summary', 'x', 'reason', 'x', 'expectedBenefit', 'x',
    'estimatedMinutes', 3, 'actionUrl', '/dashboard/google?season=weihnachten&year=2026',
    'inDashboard', true, 'inWeeklyEmail', true, 'asNotification', false,
    'subjectType', 'season', 'subjectId', v_subj, 'recommendationClass', 'growth',
    'ruleVersion', '1.0', 'ruleStatus', 'active', 'confidence', 1.0,
    'explanation', jsonb_build_object('sourceFacts', jsonb_build_array('seasons.open'), 'triggeredRule', 'content.seasonal_post', 'reason', 'x', 'expectedOutcome', 'x')));
  perform public.sync_events(v_a, v_ev, '1.0', v_si);
  select count(*), (array_agg(id))[1] into v_n, v_id1 from public.events where user_id = v_a and type = 'content.seasonal_post' and lifecycle in ('new','seen','opened');
  assert v_n = 1, format('Engine: %s Events', v_n);
  perform public.sync_events(v_a, v_ev, '1.0', v_si);
  select count(*), (array_agg(id))[1] into v_n, v_id2 from public.events where user_id = v_a and type = 'content.seasonal_post' and lifecycle in ('new','seen','opened');
  assert v_n = 1 and v_id2 = v_id1, 'Engine: zweites Event';
  assert (select recommendation_class from public.events where id = v_id1) = 'growth', 'Klasse nicht growth';

  /* Veroeffentlichung mit Event: begin akzeptiert, completed schliesst */
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2027, v_id1, 'Frohe Weihnachten wünscht das Team.');
  assert (r ->> 'ok')::boolean, format('begin mit Event: %s', r);
  assert (select engine_event_id from public.seasonal_posts where id = (r ->> 'id')::uuid) = v_id1, 'engine_event_id fehlt';
  perform public.record_recommendation_action(v_id1, 'completed', 'dashboard', v_a);
  assert (select lifecycle from public.events where id = v_id1) = 'completed', 'Event nicht completed';
  /* Regel liefert nichts mehr → resolve_stale laesst completed in Ruhe, kein neues Event */
  perform public.sync_events(v_a, '[]'::jsonb, '1.0', v_si);
  assert (select count(*) from public.events where user_id = v_a and type = 'content.seasonal_post' and lifecycle in ('new','seen','opened')) = 0, 'offenes Event nach Abschluss';
end $$;
rollback;

/* ═══ Rechte ═══ */
begin;
select test.basis();
select test.fremder();
do $$
declare f text; v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_si uuid := test.id('standort_si'); v_n integer; v_ok boolean;
begin
  foreach f in array array['public.seasonal_post_begin(uuid,uuid,text,integer,uuid,text)', 'public.seasonal_post_finish(uuid,text,text,text,text)',
                           'public.seasonal_post_state_update(uuid,text)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  for f in select 'INSERT' union all select 'UPDATE' union all select 'DELETE' loop
    assert not pg_catalog.has_table_privilege('authenticated', 'public.seasonal_posts', f), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_table_privilege('anon', 'public.seasonal_posts', f), format('Rechte: anon darf %s', f);
  end loop;
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  perform public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  perform pg_temp.als(v_b);
  set local role authenticated;
  select count(*) into v_n from public.seasonal_posts; assert v_n = 0, format('RLS: Fremder sieht %s', v_n);
  v_ok := false;
  begin insert into public.seasonal_posts (user_id, location_id, season_key, season_year, summary_snapshot) values (v_b, v_si, 'sommer', 2026, 'Einen schönen Sommer wünscht das Team.'); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'RLS: authenticated konnte einfuegen';
  reset role;
  perform pg_temp.als(v_a);
  set local role authenticated;
  select count(*) into v_n from public.seasonal_posts; assert v_n = 1, 'RLS: Eigentuemer sieht Eigenes nicht';
  v_ok := false;
  begin update public.seasonal_posts set status = 'published'; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'RLS: Eigentuemer konnte Status setzen';
  reset role;
end $$;
rollback;

/* ═══ Loeschung ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si'); v_wr uuid := test.id('standort_werkruf'); r jsonb; v_ev uuid; v_p uuid;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  insert into public.events (user_id, location_id, type, category, priority, title, summary, subject_id)
  values (v_a, v_si, 'content.seasonal_post', 'visibility', 29, 'Weihnachtsbeitrag', 'x', gen_random_uuid()) returning id into v_ev;
  r := public.seasonal_post_begin(v_a, v_si, 'weihnachten', 2026, v_ev, 'Frohe Weihnachten wünscht das Team.'); v_p := (r ->> 'id')::uuid;
  perform public.seasonal_post_begin(v_a, v_wr, 'weihnachten', 2026, null, 'Frohe Weihnachten wünscht das Team.');
  /* Event weg → engine_event_id null, Zeile bleibt */
  delete from public.events where id = v_ev;
  assert (select engine_event_id from public.seasonal_posts where id = v_p) is null and (select count(*) from public.seasonal_posts where id = v_p) = 1, 'Event-Loeschung';
  /* Standort weg → seine Zeilen weg, andere bleiben */
  delete from public.google_locations where id = v_wr;
  assert (select count(*) from public.seasonal_posts where user_id = v_a) = 1, 'Standort-Loeschung';
  /* Nutzer weg → alles weg */
  delete from auth.users where id = v_a;
  assert (select count(*) from public.seasonal_posts where user_id = v_a) = 0, 'Nutzer-Loeschung';
end $$;
rollback;

select '[wp15] saison_beitraege.test.sql in Ordnung' as ergebnis;
