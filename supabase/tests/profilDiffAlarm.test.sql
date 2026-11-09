-- WP8 — Profil-Diff-Alarm: Datenbankseite.
--
--   scripts/test-db/run.sh profilDiffAlarm
--
--   T7–T10   Lifecycle: neu → gleich → aufgeloest → anders (idempotent)
--   T11/T12  Standorte und Nutzer getrennt
--   T21      wieder gleich → resolved
--   T22–T25  Kanal 1b: kritisch → Sofortmeldung (profile_change_alert),
--            mittel → nicht; derselbe Diff → keine zweite Mail;
--            resolved → keine offene Aufgabe (Kontext leer)
--   Rechte   RLS, authenticated liest nur Eigenes, kann nicht schreiben,
--            RPCs nur service_role
--   FK       Standort-/Nutzerloeschung raeumt auf
--   Patch    resolve_profile_diff nur eigener, offener Diff
--   Kontext  build_location_evaluation_context traegt profileDiffs
--   Weekly   weekly_happened traegt profileChanges

\set ON_ERROR_STOP on

create or replace function pg_temp.d(p_pfad text, p_prio text, p_typ text, p_merchant jsonb, p_consumer jsonb, p_origin text default 'unknown')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'fieldPath', p_pfad, 'prio', p_prio, 'label', p_pfad, 'changeType', p_typ, 'origin', p_origin,
    'merchantValue', p_merchant, 'consumerValue', p_consumer,
    'fingerprint', p_pfad || '|' || coalesce(p_consumer::text, 'null') || '|' || p_typ);
$$;

/* ═══════════════════════════════════════════════════════
   T7–T10, T21 — Lifecycle
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_user uuid := test.id('user_a');
  v_loc  uuid := test.id('standort_si');
  v_r    jsonb;
  v_id1  uuid;
  v_id2  uuid;
  v_n    integer;
begin
  /* Montag: Telefon weicht ab → neu */
  v_r := public.upsert_profile_diffs(v_user, v_loc, jsonb_build_array(
           pg_temp.d('phoneNumbers.primaryPhone', 'kritisch', 'changed', '"040 123"', '"040 999"')));
  assert (v_r ->> 'new')::int = 1 and (v_r ->> 'same')::int = 0, format('T7: %s', v_r);
  select id into v_id1 from public.google_profile_diffs where location_id = v_loc and resolved_at is null;
  assert v_id1 is not null, 'T7: keine offene Zeile';

  /* Dienstag: gleicher Zustand → same, keine zweite Zeile, gleiche ID */
  v_r := public.upsert_profile_diffs(v_user, v_loc, jsonb_build_array(
           pg_temp.d('phoneNumbers.primaryPhone', 'kritisch', 'changed', '"040 123"', '"040 999"')));
  assert (v_r ->> 'new')::int = 0 and (v_r ->> 'same')::int = 1, format('T8: %s', v_r);
  select count(*) into v_n from public.google_profile_diffs where location_id = v_loc;
  assert v_n = 1, format('T8: %s Zeilen statt 1', v_n);
  assert (select id from public.google_profile_diffs where location_id = v_loc and resolved_at is null) = v_id1, 'T8: neue ID';
  assert (select last_seen_at > first_seen_at from public.google_profile_diffs where id = v_id1), 'T8: last_seen_at nicht fortgeschrieben';

  /* Mittwoch: Consumer wieder gleich → Sync liefert nichts → resolved */
  v_r := public.upsert_profile_diffs(v_user, v_loc, '[]'::jsonb);
  assert (v_r ->> 'resolved')::int = 1, format('T9/T21: %s', v_r);
  assert (select resolved_at is not null and resolved_by = 'sync' from public.google_profile_diffs where id = v_id1), 'T9: nicht als sync aufgeloest';
  assert (select count(*) from public.google_profile_diffs where location_id = v_loc and resolved_at is null) = 0, 'T9: noch offen';

  /* Donnerstag: neuer anderer Wert → neue Zeile */
  v_r := public.upsert_profile_diffs(v_user, v_loc, jsonb_build_array(
           pg_temp.d('phoneNumbers.primaryPhone', 'kritisch', 'changed', '"040 123"', '"040 888"')));
  assert (v_r ->> 'new')::int = 1, format('T10: %s', v_r);
  select id into v_id2 from public.google_profile_diffs where location_id = v_loc and resolved_at is null;
  assert v_id2 <> v_id1, 'T10: alte Zeile wiederverwendet';
  select count(*) into v_n from public.google_profile_diffs where location_id = v_loc;
  assert v_n = 2, format('T10: %s Zeilen statt 2 (Historie)', v_n);

  /* Freitag: Wert aendert sich, waehrend offen → alter geschlossen (changed), neuer offen */
  v_r := public.upsert_profile_diffs(v_user, v_loc, jsonb_build_array(
           pg_temp.d('phoneNumbers.primaryPhone', 'kritisch', 'changed', '"040 123"', '"040 777"')));
  assert (v_r ->> 'changed')::int = 1 and (v_r ->> 'new')::int = 1, format('Aenderung eines offenen Diffs: %s', v_r);
  assert (select resolved_by from public.google_profile_diffs where id = v_id2) = 'sync', 'alter Diff nicht geschlossen';
  assert (select count(*) from public.google_profile_diffs where location_id = v_loc and resolved_at is null) = 1, 'mehr als ein offener je Feld';

  /* Unique: zwei offene je (Standort, Feld) sind physisch unmoeglich */
  begin
    insert into public.google_profile_diffs (user_id, location_id, field_path, prio, label, change_type, origin, fingerprint)
    values (v_user, v_loc, 'phoneNumbers.primaryPhone', 'kritisch', 'x', 'changed', 'unknown', 'y');
    raise exception 'Unique-Index greift nicht';
  exception when unique_violation then null;
  end;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T11/T12 — Trennung
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
insert into test.bezeichner (name, id) values ('standort_fremd', '77777777-7777-7777-7777-777777777777') on conflict (name) do nothing;
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);
do $$
declare
  v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b');
  v_si uuid := test.id('standort_si'); v_wr uuid := test.id('standort_werkruf'); v_fr uuid := test.id('standort_fremd');
  v_ok boolean;
begin
  perform public.upsert_profile_diffs(v_a, v_si, jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"a.de"', '"b.de"')));
  perform public.upsert_profile_diffs(v_a, v_wr, jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"a.de"', '"c.de"')));
  perform public.upsert_profile_diffs(v_b, v_fr, jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"x.de"', '"y.de"')));
  /* T11: Aufloesung an S&I beruehrt WERKRUF nicht */
  perform public.upsert_profile_diffs(v_a, v_si, '[]'::jsonb);
  assert (select count(*) from public.google_profile_diffs where location_id = v_si and resolved_at is null) = 0, 'T11: S&I nicht aufgeloest';
  assert (select count(*) from public.google_profile_diffs where location_id = v_wr and resolved_at is null) = 1, 'T11: WERKRUF mit aufgeloest';
  /* T12: fremder Nutzer unberuehrt */
  assert (select count(*) from public.google_profile_diffs where user_id = v_b and resolved_at is null) = 1, 'T12: Fremder beruehrt';
  /* T29: user_a kann nicht fuer den fremden Standort schreiben */
  v_ok := false;
  begin
    perform public.upsert_profile_diffs(v_a, v_fr, '[]'::jsonb);
  exception when insufficient_privilege then v_ok := true;
  end;
  assert v_ok, 'T29: Schreiben auf fremden Standort moeglich';
  /* Kontext traegt nur die eigenen des Standorts */
  assert jsonb_array_length(public.build_location_evaluation_context(v_a, v_wr) -> 'profileDiffs') = 1, 'Kontext WERKRUF';
  assert jsonb_array_length(public.build_location_evaluation_context(v_a, v_si) -> 'profileDiffs') = 0, 'Kontext S&I (T25: resolved → keine offene Aufgabe)';
  assert (public.build_location_evaluation_context(v_a, v_wr) -> 'profileDiffs' -> 0 ->> 'fieldPath') = 'websiteUri', 'Kontext Inhalt';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T22–T24 — Kanal 1b
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
create or replace function pg_temp.event(p_user uuid, p_loc uuid, p_type text, p_prio integer, p_subject uuid)
returns void language plpgsql as $$
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary, estimated_minutes,
     in_dashboard, in_weekly_email, as_notification, lifecycle, created_at, subject_type, subject_id)
  values (p_user, p_loc, p_type, 'profile', p_prio, 'T', 'x', 2, true, true, p_prio >= 80, 'new', now(), 'profile_diff', p_subject);
end $$;
do $$
declare
  v_user uuid := test.id('user_a'); v_loc uuid := test.id('standort_si');
  v_diff uuid; v_erg jsonb; m public.email_queue;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_t', stripe_subscription_status = 'active' where id = v_user;
  delete from public.events where user_id = v_user; delete from public.email_queue where user_id = v_user;

  /* T22 — kritischer Diff + Event (wie die Engine es schriebe) → Sofortmeldung */
  perform public.upsert_profile_diffs(v_user, v_loc, jsonb_build_array(
    pg_temp.d('phoneNumbers.primaryPhone', 'kritisch', 'changed', '"040 123"', '"040 999"')));
  select id into v_diff from public.google_profile_diffs where location_id = v_loc and resolved_at is null;
  perform pg_temp.event(v_user, v_loc, 'profile.external_change', 90, v_diff);

  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 1, format('T22: %s', v_erg);
  select * into m from public.email_queue where user_id = v_user and template = 'profile_change_alert';
  assert found, 'T22: Vorlage profile_change_alert fehlt';
  assert jsonb_array_length(m.payload -> 'diffs') = 1, format('T22: Payload ohne Diffs: %s', m.payload);
  assert m.payload -> 'diffs' -> 0 ->> 'fieldPath' = 'phoneNumbers.primaryPhone', 'T22: falscher Diff im Payload';
  assert (m.payload ->> 'locationId')::uuid = v_loc, 'T22: Standort fehlt';
  assert not exists (select 1 from public.email_queue where user_id = v_user and template = 'critical_review_alert'), 'T22: Bewertungsvorlage statt Profilvorlage';
  assert (select delivered ? 'notification' from public.events where subject_id = v_diff), 'T22: Vermerk fehlt';

  /* T24 — zweiter Lauf: nichts */
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 0, format('T24: zweite Meldung: %s', v_erg);
  assert (select count(*) from public.email_queue where user_id = v_user and template = 'profile_change_alert') = 1, 'T24: zweite Zeile';

  /* T23 — mittlerer Diff (Oeffnungszeiten, prio 45) → keine Sofortmeldung */
  delete from public.events where user_id = v_user; delete from public.email_queue where user_id = v_user;
  perform public.upsert_profile_diffs(v_user, v_loc, jsonb_build_array(
    pg_temp.d('regularHours', 'mittel', 'changed', '{"periods":[]}', '{"periods":[{"openDay":"MONDAY"}]}')));
  select id into v_diff from public.google_profile_diffs where location_id = v_loc and resolved_at is null;
  perform pg_temp.event(v_user, v_loc, 'profile.external_change', 45, v_diff);
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 0, format('T23: mittlerer Diff alarmiert sofort: %s', v_erg);

  /* Pending/Rejected-Events → nie Sofortmeldung, auch mit hoher Prioritaet */
  delete from public.events where user_id = v_user;
  perform pg_temp.event(v_user, v_loc, 'profile.edit_pending', 95, v_diff);
  perform pg_temp.event(v_user, v_loc, 'profile.edit_rejected', 95, gen_random_uuid());
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 0, format('pending/rejected alarmiert: %s', v_erg);

  /* closed_by_google → Sofortmeldung */
  delete from public.events where user_id = v_user; delete from public.email_queue where user_id = v_user;
  perform pg_temp.event(v_user, v_loc, 'profile.closed_by_google', 95, v_diff);
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 1, format('closed_by_google: %s', v_erg);

  /* WP7 bleibt: Free bekommt keine Profilmeldung (Pro-Mail), wohl aber Review-Free */
  delete from public.events where user_id = v_user; delete from public.email_queue where user_id = v_user;
  update public.user_profiles set plan = 'free', stripe_subscription_status = 'canceled' where id = v_user;
  perform pg_temp.event(v_user, v_loc, 'profile.external_change', 90, v_diff);
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 0 and (v_erg ->> 'freeAlerts')::int = 0, format('Free bekam Profilmeldung: %s', v_erg);

  /* T26 — Wochen-Fakten tragen die Profilaenderungen */
  assert jsonb_array_length(public.weekly_happened(v_user, v_loc) -> 'profileChanges') >= 1, 'T26: weekly_happened ohne profileChanges';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Patch — resolve_profile_diff
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_loc uuid := test.id('standort_si'); v_diff uuid; v_ok boolean;
begin
  perform public.upsert_profile_diffs(v_a, v_loc, jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"a.de"', '"b.de"')));
  select id into v_diff from public.google_profile_diffs where location_id = v_loc and resolved_at is null;
  /* T34: fremder Nutzer kann nicht aufloesen */
  assert public.resolve_profile_diff(v_diff, v_b, 'accepted') = false, 'T34: Fremder loest auf';
  assert (select resolved_at is null from public.google_profile_diffs where id = v_diff), 'T34: aufgeloest';
  /* ungueltiger Grund */
  v_ok := false;
  begin perform public.resolve_profile_diff(v_diff, v_a, 'sync'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'Grund sync von aussen erlaubt';
  /* T31 eigener → ok, zweites Mal → false */
  assert public.resolve_profile_diff(v_diff, v_a, 'accepted') = true, 'T31: eigener Diff nicht aufloesbar';
  assert (select resolved_by from public.google_profile_diffs where id = v_diff) = 'accepted', 'T31: Grund';
  assert public.resolve_profile_diff(v_diff, v_a, 'restored') = false, 'bereits aufgeloester erneut aufgeloest';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Rechte und RLS
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
insert into test.bezeichner (name, id) values ('standort_fremd', '77777777-7777-7777-7777-777777777777') on conflict (name) do nothing;
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_n integer; v_ok boolean; f text;
begin
  perform public.upsert_profile_diffs(v_a, test.id('standort_si'), jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"a"', '"b"')));
  perform public.upsert_profile_diffs(v_b, test.id('standort_fremd'), jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"x"', '"y"')));

  assert (select relrowsecurity from pg_class where oid = 'public.google_profile_diffs'::regclass), 'RLS aus';
  foreach f in array array['public.upsert_profile_diffs(uuid,uuid,jsonb,text)', 'public.resolve_profile_diff(uuid,uuid,text)', 'public.profile_diffs_for_mail(jsonb)']
  loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('service_role darf %s nicht', f);
  end loop;
  assert not pg_catalog.has_table_privilege('anon', 'public.google_profile_diffs', 'SELECT'), 'anon liest';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.google_profile_diffs', 'INSERT'), 'authenticated schreibt';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.google_profile_diffs', 'UPDATE'), 'authenticated aendert';

  /* Wirkung: als user_a nur eigene Zeilen (T28).
     Der auth.uid()-Stub der Testdatenbank liefert null; fuer die
     positive Probe wird er in DIESER Transaktion auf user_a gesetzt
     (rollback am Ende). Vorher: mit uid null sieht authenticated
     nichts — deny by default. */
  set local role authenticated;
  select count(*) into v_n from public.google_profile_diffs;
  assert v_n = 0, format('T28: ohne uid sieht authenticated %s Zeilen', v_n);
  reset role;
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', v_a);
  set local role authenticated;
  select count(*) into v_n from public.google_profile_diffs;
  assert v_n = 1, format('T28: authenticated sieht %s Zeilen statt 1', v_n);
  select count(*) into v_n from public.google_profile_diffs where user_id = v_b;
  assert v_n = 0, 'T28: fremde Zeile sichtbar';
  v_ok := false;
  begin
    update public.google_profile_diffs set resolved_at = now();
  exception when insufficient_privilege then v_ok := true;
  end;
  assert v_ok, 'authenticated konnte UPDATE ausfuehren';
  v_ok := false;
  begin
    perform public.upsert_profile_diffs(v_a, test.id('standort_si'), '[]'::jsonb);
  exception when insufficient_privilege then v_ok := true;
  end;
  assert v_ok, 'C6/C9: authenticated konnte upsert_profile_diffs ausfuehren';
  reset role;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   FK — Loeschung
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a');
begin
  perform public.upsert_profile_diffs(v_a, test.id('standort_si'), jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"a"', '"b"')));
  perform public.upsert_profile_diffs(v_a, test.id('standort_werkruf'), jsonb_build_array(pg_temp.d('websiteUri', 'kritisch', 'changed', '"a"', '"c"')));
  delete from public.google_locations where id = test.id('standort_si');
  assert (select count(*) from public.google_profile_diffs where location_id = test.id('standort_si')) = 0, 'Standortloeschung laesst Diffs stehen';
  assert (select count(*) from public.google_profile_diffs where user_id = v_a) = 1, 'anderer Standort mitgeloescht';
  delete from auth.users where id = v_a;
  assert (select count(*) from public.google_profile_diffs where user_id = v_a) = 0, 'Nutzerloeschung laesst Diffs stehen';
end $$;
rollback;

select '[wp8] profilDiffAlarm: alle Abschnitte bestanden' as ergebnis;
