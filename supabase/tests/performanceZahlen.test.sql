-- WP5 — Google-Leistungsdaten: Speicherung, Isolation, Aggregation,
-- Planung, Rechte, Loeschung.
--
--   scripts/test-db/run.sh performanceZahlen
--
-- Nummern wie im Brief: T6–T10 Speicherung, T11/T12/T14 Aggregation,
-- dazu Planung (schedule_performance_syncs), Payload
-- (schedule_communications), Rechte und FK-Verhalten.
--
-- Jeder Abschnitt in einer eigenen Transaktion mit rollback — die
-- Datenbank ist danach, wie sie war.

\set ON_ERROR_STOP on

/* ═══════════════════════════════════════════════════════
   T6/T7/T8 — erster Sync, identischer Sync, Korrektur
   ═══════════════════════════════════════════════════════
   Der Worker schreibt per Upsert auf (location_id, metric, date).
   Hier derselbe Upsert in SQL — die Garantie liegt in der Tabelle,
   nicht im Worker. */
begin;
select test.basis();

do $$
declare
  v_loc  uuid := test.id('standort_si');
  v_user uuid := test.id('user_a');
  v_n    integer;
  v_wert bigint;
  v_upd  timestamptz;
begin
  /* T6: erster Sync legt Tageswerte an */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  values (v_loc, v_user, 'CALL_CLICKS', '2026-11-01', 3),
         (v_loc, v_user, 'CALL_CLICKS', '2026-11-02', 0),
         (v_loc, v_user, 'WEBSITE_CLICKS', '2026-11-01', 8)
  on conflict (location_id, metric, date) do update
    set value = excluded.value, fetched_at = excluded.fetched_at;

  select count(*) into v_n from public.google_performance_daily where location_id = v_loc;
  assert v_n = 3, format('T6: 3 Zeilen erwartet, %s vorhanden', v_n);

  /* T7: zweiter identischer Sync erzeugt keine Duplikate */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  values (v_loc, v_user, 'CALL_CLICKS', '2026-11-01', 3),
         (v_loc, v_user, 'CALL_CLICKS', '2026-11-02', 0),
         (v_loc, v_user, 'WEBSITE_CLICKS', '2026-11-01', 8)
  on conflict (location_id, metric, date) do update
    set value = excluded.value, fetched_at = excluded.fetched_at;

  select count(*) into v_n from public.google_performance_daily where location_id = v_loc;
  assert v_n = 3, format('T7: nach zweitem Sync 3 Zeilen erwartet, %s vorhanden', v_n);

  select count(*) into v_n
    from (select location_id, metric, date from public.google_performance_daily
           group by 1, 2, 3 having count(*) > 1) d;
  assert v_n = 0, 'T7: Duplikate je (location, metric, date)';

  /* T8: Google korrigiert einen Tageswert → Upsert aktualisiert */
  select updated_at into v_upd from public.google_performance_daily
   where location_id = v_loc and metric = 'CALL_CLICKS' and date = '2026-11-01';
  perform pg_sleep(0.01);

  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  values (v_loc, v_user, 'CALL_CLICKS', '2026-11-01', 5)
  on conflict (location_id, metric, date) do update
    set value = excluded.value, fetched_at = excluded.fetched_at;

  select value into v_wert from public.google_performance_daily
   where location_id = v_loc and metric = 'CALL_CLICKS' and date = '2026-11-01';
  assert v_wert = 5, format('T8: korrigierter Wert 5 erwartet, %s gespeichert', v_wert);

  assert (select updated_at from public.google_performance_daily
           where location_id = v_loc and metric = 'CALL_CLICKS' and date = '2026-11-01') > v_upd,
    'T8: updated_at wurde beim Upsert nicht fortgeschrieben';

  select count(*) into v_n from public.google_performance_daily where location_id = v_loc;
  assert v_n = 3, 'T8: Korrektur hat eine Zeile hinzugefuegt statt zu aktualisieren';

  /* Ohne Upsert-Klausel weist der Primaerschluessel die Dublette ab —
     das ist die Grundlage, auf der der Worker steht. */
  begin
    insert into public.google_performance_daily (location_id, user_id, metric, date, value)
    values (v_loc, v_user, 'CALL_CLICKS', '2026-11-01', 99);
    raise exception 'T7: zweite Zeile fuer denselben Tag wurde angenommen';
  exception when unique_violation then null;
  end;

  /* Veraltete Metriken und negative Werte lehnt die Tabelle ab. */
  begin
    insert into public.google_performance_daily (location_id, user_id, metric, date, value)
    values (v_loc, v_user, 'BUSINESS_CONVERSATIONS', '2026-11-01', 1);
    raise exception 'veraltete Metrik BUSINESS_CONVERSATIONS wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    insert into public.google_performance_daily (location_id, user_id, metric, date, value)
    values (v_loc, v_user, 'CALL_CLICKS', '2026-11-09', -1);
    raise exception 'negativer Wert wurde angenommen';
  exception when check_violation then null;
  end;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T9/T10 — Isolation: zwei Standorte, zwei Nutzer
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
/* Zusaetzliche Bezeichner fuer diesen Test (Transaktion wird zurueckgerollt) */
insert into test.bezeichner (name, id) values
  ('standort_fremd',  '77777777-7777-7777-7777-777777777777'),
  ('konto_kaputt',    '88888888-8888-8888-8888-888888888888'),
  ('standort_kaputt', '99999999-9999-9999-9999-999999999999')
on conflict (name) do nothing;
select test.fremder();
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);

do $$
declare
  v_si    uuid := test.id('standort_si');
  v_wr    uuid := test.id('standort_werkruf');
  v_fremd uuid := test.id('standort_fremd');
  v_s     jsonb;
begin
  insert into public.google_performance_daily (location_id, user_id, metric, date, value) values
    (v_si,    test.id('user_a'), 'CALL_CLICKS', '2026-11-01', 10),
    (v_wr,    test.id('user_a'), 'CALL_CLICKS', '2026-11-01', 20),
    (v_fremd, test.id('user_b'), 'CALL_CLICKS', '2026-11-01', 30);

  /* T9: zwei Standorte desselben Nutzers bleiben getrennt */
  v_s := public.performance_summary(v_si, '2026-11-01', '2026-11-01');
  assert (v_s -> 'CALL_CLICKS' ->> 'summe')::bigint = 10,
    format('T9: Standort S&I: 10 erwartet, %s', v_s);
  v_s := public.performance_summary(v_wr, '2026-11-01', '2026-11-01');
  assert (v_s -> 'CALL_CLICKS' ->> 'summe')::bigint = 20,
    format('T9: Standort WERKRUF: 20 erwartet, %s', v_s);

  /* T10: fremder Nutzer taucht nirgends auf */
  v_s := public.performance_summary(v_fremd, '2026-11-01', '2026-11-01');
  assert (v_s -> 'CALL_CLICKS' ->> 'summe')::bigint = 30,
    format('T10: Fremdstandort: 30 erwartet, %s', v_s);
  assert (select count(*) from public.google_performance_daily
           where user_id = test.id('user_a')) = 2,
    'T10: Zeilen des fremden Nutzers unter user_a sichtbar';

  /* Standort und Nutzer muessen zusammenpassen: Die Tabelle traegt
     user_id redundant, damit der Loesch-Sweep und RLS-Policies (spaeter)
     ohne Join auskommen. Der Worker schreibt location.user_id. */
  assert not exists (
    select 1 from public.google_performance_daily d
      join public.google_locations l on l.id = d.location_id
     where l.user_id <> d.user_id),
    'Zeile mit user_id, die nicht zum Standort gehoert';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Rechte — deny by default, Serverpfad offen
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
insert into public.google_performance_daily (location_id, user_id, metric, date, value)
values (test.id('standort_si'), test.id('user_a'), 'CALL_CLICKS', '2026-11-01', 10);

do $$
declare
  v_n integer;
  v_zu boolean := false;
begin
  assert (select relrowsecurity from pg_catalog.pg_class
           where oid = 'public.google_performance_daily'::regclass),
    'RLS nicht aktiv';

  /* Client-Rollen: kein einziges Recht an der Tabelle (§27 A) */
  assert not pg_catalog.has_table_privilege('anon', 'public.google_performance_daily', 'SELECT'),
    'anon darf lesen';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.google_performance_daily', 'SELECT'),
    'authenticated darf lesen';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.google_performance_daily', 'INSERT'),
    'authenticated darf schreiben';

  /* Wirkung, nicht Konfiguration: als authenticated lesen schlaegt fehl */
  set local role authenticated;
  begin
    select count(*) into v_n from public.google_performance_daily;
    v_zu := false;
  exception when insufficient_privilege then
    v_zu := true;
  end;
  reset role;
  assert v_zu, 'authenticated konnte google_performance_daily lesen';

  /* Serverpfad */
  assert pg_catalog.has_table_privilege('service_role', 'public.google_performance_daily', 'INSERT'),
    'service_role kann nicht schreiben — der Worker liefe leer';
  assert pg_catalog.has_table_privilege('service_role', 'public.google_performance_daily', 'SELECT'),
    'service_role kann nicht lesen';

  /* Funktionen: nur service_role */
  assert not pg_catalog.has_function_privilege('authenticated',
    'public.weekly_performance_for_mail(uuid, timestamptz)', 'EXECUTE'),
    'authenticated darf weekly_performance_for_mail ausfuehren';
  assert not pg_catalog.has_function_privilege('anon',
    'public.schedule_performance_syncs(interval, integer)', 'EXECUTE'),
    'anon darf schedule_performance_syncs ausfuehren';
  assert pg_catalog.has_function_privilege('service_role',
    'public.schedule_performance_syncs(interval, integer)', 'EXECUTE'),
    'service_role darf schedule_performance_syncs nicht ausfuehren';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T11/T12 — Wochenwerte und Vorwochenvergleich
   ═══════════════════════════════════════════════════════
   Fester Bezugszeitpunkt: Montag, 9.11.2026 08:00 Berlin.
   Berichtswoche = 2.–8.11., Vorwoche = 26.10.–1.11. */
begin;
select test.basis();

do $$
declare
  v_loc  uuid := test.id('standort_si');
  v_user uuid := test.id('user_a');
  v_now  timestamptz := '2026-11-09 08:00:00 Europe/Berlin';
  v_r    jsonb;
begin
  /* 2.–8.11.: CALL_CLICKS 1..7 (Summe 28), WEBSITE_CLICKS je 2 (14),
     vier Impressions-Metriken je 10 (je 70).
     26.10.–1.11.: CALL_CLICKS je 2 (14), WEBSITE_CLICKS je 3 (21),
     Impressions je 8 (je 56). */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, extract(day from d)::int - 1
    from generate_series('2026-11-02'::date, '2026-11-08'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'WEBSITE_CLICKS', d, 2
    from generate_series('2026-11-02'::date, '2026-11-08'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, m, d, 10
    from generate_series('2026-11-02'::date, '2026-11-08'::date, '1 day') d
   cross join unnest(array['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
                           'BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH']) m;

  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, 2
    from generate_series('2026-10-26'::date, '2026-11-01'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'WEBSITE_CLICKS', d, 3
    from generate_series('2026-10-26'::date, '2026-11-01'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, m, d, 8
    from generate_series('2026-10-26'::date, '2026-11-01'::date, '1 day') d
   cross join unnest(array['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
                           'BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH']) m;

  /* Stoerdaten: der andere Standort desselben Nutzers in derselben Woche */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select test.id('standort_werkruf'), v_user, 'CALL_CLICKS', d, 100
    from generate_series('2026-11-02'::date, '2026-11-08'::date, '1 day') d;

  v_r := public.weekly_performance_for_mail(v_loc, v_now);

  assert v_r ->> 'status' = 'ok', format('T11: status ok erwartet, %s', v_r);
  assert v_r -> 'zeitraum' ->> 'von' = '2026-11-02' and v_r -> 'zeitraum' ->> 'bis' = '2026-11-08',
    format('T11: Berichtswoche 2.–8.11. erwartet, %s', v_r -> 'zeitraum');
  assert v_r -> 'vorzeitraum' ->> 'von' = '2026-10-26' and v_r -> 'vorzeitraum' ->> 'bis' = '2026-11-01',
    format('T12: Vorwoche 26.10.–1.11. erwartet, %s', v_r -> 'vorzeitraum');

  /* T11: Wochenwerte */
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'summe')::bigint = 28,
    format('T11: Anrufe 28 erwartet, %s', v_r -> 'aktuell' -> 'CALL_CLICKS');
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'tage')::int = 7, 'T11: 7 Tage erwartet';
  assert (v_r -> 'aktuell' -> 'WEBSITE_CLICKS' ->> 'summe')::bigint = 14, 'T11: Website-Klicks 14 erwartet';
  assert (v_r -> 'aktuell' -> 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH' ->> 'summe')::bigint = 70,
    'T11: Impressions mobile search 70 erwartet';
  assert (v_r -> 'aktuell' -> 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS' ->> 'summe')::bigint = 70,
    'T11: Impressions desktop maps 70 erwartet';
  /* Metrik ohne Zeilen fehlt — nicht 0 */
  assert not (v_r -> 'aktuell') ? 'BUSINESS_DIRECTION_REQUESTS',
    'T11: Routenanfragen ohne Daten erscheinen als Schluessel';

  /* T12: Vorwoche */
  assert (v_r -> 'vorher' -> 'CALL_CLICKS' ->> 'summe')::bigint = 14,
    format('T12: Vorwoche Anrufe 14 erwartet, %s', v_r -> 'vorher' -> 'CALL_CLICKS');
  assert (v_r -> 'vorher' -> 'WEBSITE_CLICKS' ->> 'summe')::bigint = 21, 'T12: Vorwoche Website 21 erwartet';
  assert (v_r -> 'vorher' -> 'BUSINESS_IMPRESSIONS_MOBILE_MAPS' ->> 'summe')::bigint = 56,
    'T12: Vorwoche Impressions 56 erwartet';

  /* Der andere Standort hat nichts beigetragen */
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'summe')::bigint <> 728,
    'T11: Werte des anderen Standorts eingerechnet';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Berichtswoche: unvollstaendig → Woche davor; sonst ehrlich
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();

do $$
declare
  v_loc  uuid := test.id('standort_si');
  v_user uuid := test.id('user_a');
  v_now  timestamptz := '2026-11-09 08:00:00 Europe/Berlin';
  v_r    jsonb;
begin
  /* Kein einziger Wert → keine_daten */
  v_r := public.weekly_performance_for_mail(v_loc, v_now);
  assert v_r ->> 'status' = 'keine_daten', format('ohne Zeilen: keine_daten erwartet, %s', v_r);
  assert public.weekly_performance_for_mail(null, v_now) ->> 'status' = 'keine_daten',
    'null-Standort: keine_daten erwartet';

  /* Letzte Woche nur Mo–Do (Google haengt), Woche davor komplett
     → Berichtswoche ist die Woche davor. */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, 1
    from generate_series('2026-11-02'::date, '2026-11-05'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, 2
    from generate_series('2026-10-26'::date, '2026-11-01'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, 3
    from generate_series('2026-10-19'::date, '2026-10-25'::date, '1 day') d;

  v_r := public.weekly_performance_for_mail(v_loc, v_now);
  assert v_r ->> 'status' = 'ok', format('Rueckfall: ok erwartet, %s', v_r);
  assert v_r -> 'zeitraum' ->> 'von' = '2026-10-26',
    format('Rueckfall auf die Woche davor erwartet, %s', v_r -> 'zeitraum');
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'summe')::bigint = 14, 'Rueckfall: Summe 14 erwartet';
  assert (v_r -> 'vorher' -> 'CALL_CLICKS' ->> 'summe')::bigint = 21, 'Rueckfall: Vorwoche 21 erwartet';

  /* Beide Wochen unvollstaendig → unvollstaendig, keine Summen */
  delete from public.google_performance_daily where location_id = v_loc and date = '2026-10-29';
  v_r := public.weekly_performance_for_mail(v_loc, v_now);
  assert v_r ->> 'status' = 'unvollstaendig', format('unvollstaendig erwartet, %s', v_r);
  assert not (v_r ? 'aktuell'), 'unvollstaendig darf keine Summen tragen';

  /* Ein Tag mit Wert 0 zaehlt als Tag mit Daten (Googles Null). */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  values (v_loc, v_user, 'CALL_CLICKS', '2026-10-29', 0);
  v_r := public.weekly_performance_for_mail(v_loc, v_now);
  assert v_r ->> 'status' = 'ok', 'Tag mit Wert 0 zaehlt nicht als Tag mit Daten';
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'summe')::bigint = 12, 'Summe mit Null-Tag: 12 erwartet';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T14 — Kalendermonat
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();

do $$
declare
  v_loc  uuid := test.id('standort_si');
  v_user uuid := test.id('user_a');
  v_r    jsonb;
begin
  /* Oktober 2026 komplett (31 Tage, je 2), September komplett (30 Tage, je 1),
     1. November 5 — darf nicht in den Oktober fallen. */
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, 2
    from generate_series('2026-10-01'::date, '2026-10-31'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  select v_loc, v_user, 'CALL_CLICKS', d, 1
    from generate_series('2026-09-01'::date, '2026-09-30'::date, '1 day') d;
  insert into public.google_performance_daily (location_id, user_id, metric, date, value)
  values (v_loc, v_user, 'CALL_CLICKS', '2026-11-01', 5);

  v_r := public.monthly_performance(v_loc, '2026-10-15');
  assert v_r ->> 'status' = 'ok', format('T14: ok erwartet, %s', v_r);
  assert v_r -> 'zeitraum' ->> 'von' = '2026-10-01' and v_r -> 'zeitraum' ->> 'bis' = '2026-10-31',
    format('T14: Oktober erwartet, %s', v_r -> 'zeitraum');
  assert (v_r ->> 'tage')::int = 31 and (v_r ->> 'kalendertage')::int = 31, 'T14: 31 Tage erwartet';
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'summe')::bigint = 62,
    format('T14: Oktober-Summe 62 erwartet, %s', v_r -> 'aktuell');
  assert (v_r -> 'vorher' -> 'CALL_CLICKS' ->> 'summe')::bigint = 30,
    format('T14: September-Summe 30 erwartet, %s', v_r -> 'vorher');
  assert v_r -> 'vorzeitraum' ->> 'von' = '2026-09-01' and v_r -> 'vorzeitraum' ->> 'bis' = '2026-09-30',
    'T14: Vormonat September erwartet';

  /* Angebrochener Monat ist unvollstaendig, nicht 0 oder falsch */
  v_r := public.monthly_performance(v_loc, '2026-11-20');
  assert v_r ->> 'status' = 'unvollstaendig', format('T14: November unvollstaendig erwartet, %s', v_r);
  assert (v_r ->> 'tage')::int = 1 and (v_r ->> 'kalendertage')::int = 30, 'T14: 1 von 30 Tagen';
  assert (v_r -> 'aktuell' -> 'CALL_CLICKS' ->> 'summe')::bigint = 5, 'T14: November-Summe 5';

  /* Monat ohne Daten */
  v_r := public.monthly_performance(v_loc, '2026-08-01');
  assert v_r ->> 'status' = 'keine_daten', 'T14: August keine_daten erwartet';
  assert not (v_r ? 'aktuell'), 'T14: keine_daten darf keine Summen tragen';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Planung — schedule_performance_syncs
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
/* Zusaetzliche Bezeichner fuer diesen Test (Transaktion wird zurueckgerollt) */
insert into test.bezeichner (name, id) values
  ('standort_fremd',  '77777777-7777-7777-7777-777777777777'),
  ('konto_kaputt',    '88888888-8888-8888-8888-888888888888'),
  ('standort_kaputt', '99999999-9999-9999-9999-999999999999')
on conflict (name) do nothing;
select test.fremder();
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);
/* Ein Standort mit kaputter Verbindung darf nicht geplant werden */
select test.konto('konto_kaputt', 'user_b', 'revoked');
select test.standort('standort_kaputt', 'user_b', 'konto_kaputt', 'Kaputt', false);

do $$
declare
  v_r jsonb;
  v_n integer;
begin
  v_r := public.schedule_performance_syncs();
  assert (v_r ->> 'insightJobs')::int = 3,
    format('3 Jobs erwartet (si, werkruf, fremd), %s', v_r);

  select count(*) into v_n from public.sync_jobs where job_type = 'sync_insights';
  assert v_n = 3, format('3 sync_insights-Jobs erwartet, %s', v_n);

  assert not exists (select 1 from public.sync_jobs
                      where job_type = 'sync_insights' and location_id = test.id('standort_kaputt')),
    'Standort mit revoked-Konto wurde geplant';

  /* Jeder Job traegt Nutzer, Konto und Standort passend zueinander */
  assert not exists (
    select 1 from public.sync_jobs j join public.google_locations l on l.id = j.location_id
     where j.job_type = 'sync_insights' and (j.user_id <> l.user_id or j.account_id <> l.account_id)),
    'Job mit falschem Nutzer/Konto';

  /* Zweiter Lauf: Dedupe gegen queued */
  v_r := public.schedule_performance_syncs();
  assert (v_r ->> 'insightJobs')::int = 0, format('zweiter Lauf: 0 erwartet, %s', v_r);
  select count(*) into v_n from public.sync_jobs where job_type = 'sync_insights';
  assert v_n = 3, 'zweiter Lauf hat Jobs verdoppelt';

  /* Frisch synchronisierter Standort wird nicht erneut geplant,
     alter schon */
  delete from public.sync_jobs where job_type = 'sync_insights';
  update public.google_locations set performance_synced_at = now() - interval '1 hour'
   where id = test.id('standort_si');
  update public.google_locations set performance_synced_at = now() - interval '2 days'
   where id = test.id('standort_werkruf');
  v_r := public.schedule_performance_syncs();
  assert (v_r ->> 'insightJobs')::int = 2, format('2 erwartet (werkruf alt, fremd nie), %s', v_r);
  assert not exists (select 1 from public.sync_jobs
                      where job_type = 'sync_insights' and location_id = test.id('standort_si')),
    'frisch synchronisierter Standort erneut geplant';

  /* Prioritaet hinter Bewertungen */
  assert (select min(priority) from public.sync_jobs where job_type = 'sync_insights') > 100,
    'sync_insights laeuft vor den Bewertungen';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Payload — schedule_communications traegt performance
   ═══════════════════════════════════════════════════════
   Kein Lauf von schedule_communications hier (der haengt an
   Plan-Entscheidungen und Zeit); geprueft wird die Funktion selbst
   und die Payload-Funktion, die sie ruft. */
begin;
do $$
declare
  v_def text := pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure);
begin
  assert position('''performance''' in v_def) > 0, 'Payload-Schluessel performance fehlt';
  assert position('public.weekly_performance_for_mail(' in v_def) > 0,
    'schedule_communications ruft weekly_performance_for_mail nicht';
  /* Der Schluessel haengt im weekly_summary-Payload, nicht in der Sofortmail */
  assert position('weekly_performance_for_mail' in v_def) > position('''weekly_summary''' in v_def),
    'performance steht vor dem weekly_summary-Payload';
  assert position('weekly_performance_for_mail' in v_def) < position('''inactivity_reminder''' in v_def),
    'performance steht hinter dem weekly_summary-Payload';
  /* Die drei alten Vorlagen, keine vierte */
  assert position('''critical_review_alert''' in v_def) > 0
     and position('''inactivity_reminder''' in v_def) > 0, 'alte Vorlagen fehlen';
  assert position('performance_report' in v_def) = 0, 'eine neue Mailvorlage ist nicht Teil von WP5';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Loeschung — FK-Verhalten
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
/* Zusaetzliche Bezeichner fuer diesen Test (Transaktion wird zurueckgerollt) */
insert into test.bezeichner (name, id) values
  ('standort_fremd',  '77777777-7777-7777-7777-777777777777'),
  ('konto_kaputt',    '88888888-8888-8888-8888-888888888888'),
  ('standort_kaputt', '99999999-9999-9999-9999-999999999999')
on conflict (name) do nothing;
select test.fremder();
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);

do $$
declare v_n integer;
begin
  insert into public.google_performance_daily (location_id, user_id, metric, date, value) values
    (test.id('standort_si'),      test.id('user_a'), 'CALL_CLICKS', '2026-11-01', 1),
    (test.id('standort_werkruf'), test.id('user_a'), 'CALL_CLICKS', '2026-11-01', 1),
    (test.id('standort_fremd'),   test.id('user_b'), 'CALL_CLICKS', '2026-11-01', 1);

  /* Standort geloescht → seine Werte weg, Rest bleibt */
  delete from public.google_locations where id = test.id('standort_werkruf');
  select count(*) into v_n from public.google_performance_daily;
  assert v_n = 2, format('nach Standortloeschung 2 Zeilen erwartet, %s', v_n);

  /* Nutzer geloescht (auth.users, wie delete-account) → alles weg,
     Fremder unberuehrt */
  delete from auth.users where id = test.id('user_a');
  select count(*) into v_n from public.google_performance_daily where user_id = test.id('user_a');
  assert v_n = 0, format('nach Nutzerloeschung noch %s Zeilen', v_n);
  select count(*) into v_n from public.google_performance_daily where user_id = test.id('user_b');
  assert v_n = 1, 'Fremde Zeile bei Loeschung mitgerissen';
end $$;
rollback;
