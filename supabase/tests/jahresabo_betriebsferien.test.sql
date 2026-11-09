-- WP13 — Jahresabo + Betriebsferien: Datenbankseite.
--
--   scripts/test-db/run.sh jahresabo_betriebsferien
--
--   Billing   stripe_billing_interval nur month|year
--   T16–T20   account_pause_set: Pro ja, FP ja, Free nein, from>until,
--             > 56 Tage, rueckwirkend; Constraint haelt auch direkt
--   T21–T24   plan_communications: Pause → weekly + inactivity ruhen,
--             immediate_alert (kritische Bewertung, kritische
--             Profilaenderung) bleibt
--   T27/T28   zeitbasiertes Ende, manuelles Ende
--   Multi     zwei Standorte eines Accounts: Pause gilt fuer beide,
--             Nachbar-Account unberuehrt
--   Rechte    nur service_role

\set ON_ERROR_STOP on

create or replace function pg_temp.entscheidung(p_user uuid, p_now timestamptz, p_channel text)
returns jsonb language sql stable as $$
  select d from jsonb_array_elements(public.plan_communications(p_user, p_now) -> 'decisions') d
   where d ->> 'channel' = p_channel
   order by (d ->> 'send')::boolean desc nulls last limit 1
$$;

/* Montag 07:00 Berlin als Auswertungszeitpunkt — die Wochenmail
   sendet nur montags, sonst waere die Pause nicht beobachtbar. */
create or replace function pg_temp.montag() returns timestamptz language sql stable as $$
  select (date_trunc('week', (now() at time zone 'Europe/Berlin')::date::timestamp) + interval '7 days 7 hours') at time zone 'Europe/Berlin'
$$;

/* ═══════════════════════════════════════════════════════
   Billing-Intervall
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a');
begin
  update public.user_profiles set stripe_billing_interval = 'year' where id = v_a;
  update public.user_profiles set stripe_billing_interval = 'month' where id = v_a;
  update public.user_profiles set stripe_billing_interval = null where id = v_a;
  begin
    update public.user_profiles set stripe_billing_interval = 'quarter' where id = v_a;
    raise exception 'Billing: ungueltiges Intervall gespeichert';
  exception when check_violation then null;
  end;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T16–T20 — Pause setzen
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
do $$
declare
  v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); r jsonb;
  v_heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  /* T16 — Pro */
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  r := public.account_pause_set(v_a, v_heute + 10, v_heute + 24);
  assert (r ->> 'ok')::boolean, format('T16: Pro konnte nicht pausieren: %s', r);
  assert (select pause_from from public.user_profiles where id = v_a) = v_heute + 10, 'T16: pause_from';
  assert (r ->> 'paused')::boolean = false, 'T16: geplante Pause gilt noch nicht als aktiv';

  /* T17 — FP */
  perform public.set_founding_partner(v_b, 'Test');
  r := public.account_pause_set(v_b, v_heute, v_heute + 7);
  assert (r ->> 'ok')::boolean and (r ->> 'paused')::boolean, format('T17: FP: %s', r);

  /* T18 — Free */
  update public.user_profiles set plan = 'free', stripe_subscription_status = 'canceled', pause_from = null, pause_until = null where id = v_a;
  r := public.account_pause_set(v_a, v_heute, v_heute + 7);
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'kein_pro', format('T18: Free konnte pausieren: %s', r);
  assert (select pause_from from public.user_profiles where id = v_a) is null, 'T18: Free-Pause gespeichert';

  /* T19/T20 — Grenzen */
  update public.user_profiles set plan = 'pro', stripe_subscription_status = 'active' where id = v_a;
  r := public.account_pause_set(v_a, v_heute + 5, v_heute + 4);
  assert r ->> 'reason' = 'bis_vor_von', format('T19: %s', r);
  r := public.account_pause_set(v_a, v_heute, v_heute + 57);
  assert r ->> 'reason' = 'zu_lang' and (r ->> 'maxTage')::int = 56, format('T20: %s', r);
  r := public.account_pause_set(v_a, v_heute, v_heute + 56);
  assert (r ->> 'ok')::boolean, format('T20: 56 Tage muessen gehen: %s', r);
  r := public.account_pause_set(v_a, v_heute - 1, v_heute + 3);
  assert r ->> 'reason' = 'rueckwirkend', format('rueckwirkend: %s', r);
  r := public.account_pause_set(v_a, null, v_heute + 3);
  assert r ->> 'reason' = 'datum_fehlt', format('datum_fehlt: %s', r);

  /* Constraint haelt auch gegen direkte Schreibzugriffe (C7: kein offenes Ende) */
  begin
    update public.user_profiles set pause_from = v_heute, pause_until = null where id = v_a;
    raise exception 'C7: Pause ohne Ende gespeichert';
  exception when check_violation then null;
  end;
  begin
    update public.user_profiles set pause_from = v_heute, pause_until = v_heute + 90 where id = v_a;
    raise exception 'C7: 90 Tage gespeichert';
  exception when check_violation then null;
  end;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T21–T24 — Mail-Gates
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si');
  v_mo timestamptz := pg_temp.montag();
  v_heute date := (now() at time zone 'Europe/Berlin')::date;
  d jsonb; v_plan jsonb;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  insert into public.notification_preferences (user_id, last_dashboard_visit_at, inactivity_days)
  values (v_a, v_mo - interval '20 days', 10)
  on conflict (user_id) do update set last_dashboard_visit_at = excluded.last_dashboard_visit_at, inactivity_days = 10;
  delete from public.events where user_id = v_a;
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary, estimated_minutes,
     in_dashboard, in_weekly_email, as_notification, lifecycle, created_at, subject_type, subject_id)
  values
    (v_a, v_si, 'review.negative_unanswered', 'reviews', 95, 'Schlechte Bewertung', 'x', 10, true, true, true, 'new', v_mo - interval '1 hour', 'review', gen_random_uuid()),
    (v_a, v_si, 'profile.external_change', 'profile', 85, 'Telefon geaendert', 'x', 5, true, true, true, 'new', v_mo - interval '1 hour', 'profile_diff', gen_random_uuid()),
    (v_a, v_si, 'photos.few', 'profile', 60, 'Fotos', 'x', 15, true, true, false, 'new', v_mo - interval '3 days', 'location', gen_random_uuid());

  /* Vorbedingung: ohne Pause will alles senden */
  assert (pg_temp.entscheidung(v_a, v_mo, 'weekly_email') ->> 'send')::boolean, 'Vorbedingung: Wochenmail wuerde gehen';
  assert (pg_temp.entscheidung(v_a, v_mo, 'inactivity_reminder') ->> 'send')::boolean, format('Vorbedingung: Abwesenheit wuerde gehen: %s', pg_temp.entscheidung(v_a, v_mo, 'inactivity_reminder'));
  assert (select count(*) from jsonb_array_elements(public.plan_communications(v_a, v_mo) -> 'decisions') x
           where x ->> 'channel' = 'immediate_alert' and (x ->> 'send')::boolean) = 2, 'Vorbedingung: zwei Sofortalarme';
  assert (public.plan_communications(v_a, v_mo) ->> 'paused')::boolean = false, 'Vorbedingung: nicht pausiert';

  /* Pause aktiv */
  perform public.account_pause_set(v_a, v_heute, v_heute + 14);
  assert public.is_account_paused(v_a, v_mo) or public.is_account_paused(v_a), 'Pause nicht aktiv';
  v_plan := public.plan_communications(v_a, v_mo);
  assert (v_plan ->> 'paused')::boolean, 'plan_communications meldet paused nicht';

  /* T21 — weekly ruht */
  d := pg_temp.entscheidung(v_a, v_mo, 'weekly_email');
  assert (d ->> 'send')::boolean = false and d ->> 'reason' like 'Betriebsferien%', format('T21: %s', d);
  /* T22 — Abwesenheitsmail (normale Engine-Aufgaben) ruht */
  d := pg_temp.entscheidung(v_a, v_mo, 'inactivity_reminder');
  assert (d ->> 'send')::boolean = false and d ->> 'reason' like 'Betriebsferien%', format('T22: %s', d);
  /* T24 — Kritisches kommt durch: beide Sofortalarme (Bewertung + Profilaenderung) */
  assert (select count(*) from jsonb_array_elements(v_plan -> 'decisions') x
           where x ->> 'channel' = 'immediate_alert' and (x ->> 'send')::boolean) = 2, format('T24: critical unterdrueckt: %s', v_plan);
  /* T30 — Events unveraendert (Pause ist kein Datenzustand) */
  assert (select count(*) from public.events where user_id = v_a and lifecycle = 'new') = 3, 'T30: Events veraendert';

  /* T23 — Holiday-Hours-Erinnerung reist mit der Wochenmail (WP9) → ruht ebenfalls */
  assert not exists (select 1 from pg_proc where proname like '%holiday%mail%' or proname like '%feiertag%mail%'), 'T23: separater Feiertags-Mailpfad existiert — Gate pruefen';

  /* T28 — manuell beendet → sofort wieder normal */
  assert public.account_pause_end(v_a), 'T28: pause_end false';
  assert not public.is_account_paused(v_a, v_mo), 'T28: noch pausiert';
  assert (pg_temp.entscheidung(v_a, v_mo, 'weekly_email') ->> 'send')::boolean, 'T28: Wochenmail bleibt aus';
  assert not public.account_pause_end(v_a), 'T28: zweites Ende true';

  /* T27 — zeitbasiert: Pause in der Vergangenheit → nicht pausiert (direkt gesetzt, der Server verbietet rueckwirkend) */
  update public.user_profiles set pause_from = v_heute - 20, pause_until = v_heute - 6 where id = v_a;
  assert not public.is_account_paused(v_a), 'T27: abgelaufene Pause gilt noch';
  assert (pg_temp.entscheidung(v_a, v_mo, 'weekly_email') ->> 'send')::boolean, 'T27: Wochenmail nach Pause aus';
  /* Grenze inklusiv: letzter Tag pausiert, Folgetag nicht */
  update public.user_profiles set pause_from = v_heute - 3, pause_until = v_heute where id = v_a;
  assert public.is_account_paused(v_a, now()), 'T27: letzter Tag nicht pausiert';
  assert not public.is_account_paused(v_a, now() + interval '1 day'), 'T27: Folgetag pausiert';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Multi-Location + Nachbar
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
do $$
declare
  v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b');
  v_mo timestamptz := pg_temp.montag(); v_heute date := (now() at time zone 'Europe/Berlin')::date;
  v_zwei uuid;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_x', stripe_subscription_status = 'active' where id in (v_a, v_b);
  v_zwei := test.standort('standort_werkruf', 'user_a', 'konto_a', 'Zweiter Betrieb', false);
  perform public.account_pause_set(v_a, v_heute, v_heute + 7);

  /* Pause gilt Account-weit — unabhaengig vom gewaehlten Standort */
  assert (pg_temp.entscheidung(v_a, v_mo, 'weekly_email') ->> 'send')::boolean = false, 'Multi: Standort 1';
  update public.google_locations set selected_at = case when id = v_zwei then now() else null end where user_id = v_a;
  assert (pg_temp.entscheidung(v_a, v_mo, 'weekly_email') ->> 'send')::boolean = false, 'Multi: Standort 2 nicht pausiert';
  /* Nachbar-Account unberuehrt */
  assert not public.is_account_paused(v_b), 'Multi: Nachbar pausiert';
  assert (public.plan_communications(v_b, v_mo) ->> 'paused')::boolean = false, 'Multi: Nachbar paused=true';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Rechte
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare f text; v_a uuid := test.id('user_a'); v_ok boolean;
begin
  foreach f in array array['public.is_account_paused(uuid,timestamptz)', 'public.account_pause_set(uuid,date,date)', 'public.account_pause_end(uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  set local role authenticated;
  v_ok := false;
  begin perform public.account_pause_set(v_a, current_date, current_date + 3); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'Rechte: authenticated konnte Pause setzen';
  reset role;
end $$;
rollback;

select '[wp13] jahresabo_betriebsferien: alle Abschnitte bestanden' as ergebnis;
