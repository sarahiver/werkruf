-- SQL-Abnahme fuer sync_failure_resolved / ops_sync_failures.
--
-- Laeuft gegen das echte Schema aus Baseline und Migrationen:
--
--   scripts/test-db/run.sh ops_alerts_resolution
--
-- Spielt die Szenarien durch und prueft jede Erwartung mit assert.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ───────────────────────────────────────────────────────────────
-- WAS SICH IN G1 GEAENDERT HAT
-- ───────────────────────────────────────────────────────────────
--
-- Vorher legte dieser Test public.sync_jobs selbst an — eine
-- vereinfachte Fassung mit elf Spalten, waehrend die echte Tabelle
-- mehr hat. Und er zog die zu pruefende Funktion als Textausschnitt
-- aus der Migration nach:
--
--   \ir migrations_fragment_sync_failure_resolved.sql
--
-- Damit prueften die asserts eine Kopie, nicht das Deployte. Weicht die
-- Migration eines Tages ab, bliebe dieser Test gruen. Dieselbe
-- Fehlerklasse wie eine Typpruefung auf einer Kopie der index.ts.
--
-- Beides ist weg. Tabelle und Funktion kommen jetzt aus Baseline und
-- Migration, der Test fuegt nur noch Zeilen ein.

\set ON_ERROR_STOP on

begin;

/* Nutzer und Standorte, damit die Kennungen unten auf echte Zeilen
   zeigen — scripts/test-db/sql/80-fixtures.sql. */
select test.basis();
select test.fremder();

/* ── Feste Kennungen ──
   Dieselben Werte wie in test.bezeichner; psql-Variablen koennen
   test.id() nicht aufrufen. Die Kontokennungen sind frei gewaehlt:
   sync_jobs.account_id traegt keinen Fremdschluessel. */
\set kunde_a  '11111111-1111-1111-1111-111111111111'
\set kunde_b  '22222222-2222-2222-2222-222222222222'
\set konto_a1 '55555555-5555-5555-5555-555555555555'
\set konto_a2 'aaaaaaa2-0000-0000-0000-000000000002'
\set konto_b1 '66666666-6666-6666-6666-666666666666'
\set loc_wr   '44444444-4444-4444-4444-444444444444'
\set loc_si   '33333333-3333-3333-3333-333333333333'

/* ═══════════════════════════════════════════════════════
   SZENARIO 1 — Der reale Fall
   Standortimport scheitert dreimal, danach ein Erfolg.
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (id, user_id, account_id, location_id, job_type, status, attempts, max_attempts, error_code, created_at)
values
  ('10000000-0000-0000-0000-000000000001', :'kunde_a', :'konto_a1', null, 'sync_locations', 'failed', 3, 3, '23505', now() - interval '3 days'),
  ('10000000-0000-0000-0000-000000000002', :'kunde_a', :'konto_a1', null, 'sync_locations', 'failed', 3, 3, '23505', now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000003', :'kunde_a', :'konto_a1', null, 'sync_locations', 'failed', 3, 3, '23505', now() - interval '1 day');

do $$
begin
  assert (select count(*) from public.ops_sync_failures where not behoben) = 3,
    'Vor dem Erfolg muessen alle drei Fehler offen sein';
end $$;

-- Die Korrektur wirkt: ein erfolgreicher Standortimport
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', :'konto_a1', null, 'sync_locations', 'succeeded', 1, now() - interval '2 hours');

do $$
begin
  assert (select count(*) from public.ops_sync_failures where not behoben) = 0,
    'Nach dem erfolgreichen Import darf kein Fehler mehr offen sein';
  assert (select count(*) from public.ops_sync_failures) = 3,
    'Historische Jobs muessen erhalten bleiben';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 2 — Neuer Fehler nach dem Erfolg meldet wieder
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (id, user_id, account_id, location_id, job_type, status, attempts, max_attempts, error_code, created_at)
values ('10000000-0000-0000-0000-000000000009', :'kunde_a', :'konto_a1', null, 'sync_locations', 'failed', 3, 3, 'rate_limited', now() - interval '10 minutes');

do $$
begin
  assert (select count(*) from public.ops_sync_failures where not behoben) = 1,
    'Ein Fehler NACH dem Erfolg muss wieder als offen gelten';
  assert (select id from public.ops_sync_failures where not behoben)
         = '10000000-0000-0000-0000-000000000009',
    'Und zwar genau der neue';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 3 — Ein Bewertungs-Sync behebt keinen Standortimport
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', :'konto_a1', :'loc_wr', 'sync_reviews', 'succeeded', 1, now());

do $$
begin
  assert (select count(*) from public.ops_sync_failures where not behoben) = 1,
    'Ein erfolgreicher Bewertungs-Sync darf einen Standortimport-Fehler nicht verdecken';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 4 — Ein anderes Konto desselben Kunden behebt nichts
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', :'konto_a2', null, 'sync_locations', 'succeeded', 1, now());

do $$
begin
  assert (select count(*) from public.ops_sync_failures where not behoben) = 1,
    'Ein Erfolg auf einem ANDEREN Google-Konto darf nichts beheben';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 5 — Mandantentrennung
   Kunde B scheitert; ein Erfolg von Kunde A darf das nicht beheben.
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (id, user_id, account_id, location_id, job_type, status, attempts, max_attempts, error_code, created_at)
values ('20000000-0000-0000-0000-000000000001', :'kunde_b', :'konto_b1', null, 'sync_locations', 'failed', 3, 3, 'oauth', now() - interval '1 hour');

insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', :'konto_a1', null, 'sync_locations', 'succeeded', 1, now());

do $$
begin
  assert (select behoben from public.ops_sync_failures
           where id = '20000000-0000-0000-0000-000000000001') = false,
    'Der Erfolg eines anderen Kunden darf NIEMALS beheben';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 6 — Standortbezogene Jobs: location_id zaehlt
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (id, user_id, account_id, location_id, job_type, status, attempts, max_attempts, error_code, created_at)
values ('30000000-0000-0000-0000-000000000001', :'kunde_a', :'konto_a1', :'loc_si', 'sync_reviews', 'failed', 3, 3, 'api', now() - interval '30 minutes');

-- Erfolg fuer einen ANDEREN Standort
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', :'konto_a1', :'loc_wr', 'sync_reviews', 'succeeded', 1, now());

do $$
begin
  assert (select behoben from public.ops_sync_failures
           where id = '30000000-0000-0000-0000-000000000001') = false,
    'Ein Erfolg fuer einen anderen Standort darf nicht beheben';
end $$;

-- Jetzt der passende Standort
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', :'konto_a1', :'loc_si', 'sync_reviews', 'succeeded', 1, now());

do $$
begin
  assert (select behoben from public.ops_sync_failures
           where id = '30000000-0000-0000-0000-000000000001') = true,
    'Ein Erfolg fuer DENSELBEN Standort muss beheben';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 7 — Ein frueherer Erfolg behebt nichts
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_b', :'konto_b1', null, 'sync_locations', 'succeeded', 1, now() - interval '5 hours');

do $$
begin
  assert (select behoben from public.ops_sync_failures
           where id = '20000000-0000-0000-0000-000000000001') = false,
    'Ein Erfolg VOR dem Fehler darf nichts beheben';
end $$;

/* ═══════════════════════════════════════════════════════
   SZENARIO 8 — Mandantentrennung ISOLIERT

   Szenario 5 trennt nicht wirklich: Dort unterscheiden sich auch die
   account_id, und schon die Pruefung darauf verhindert das Beheben.
   Faellt die user_id-Pruefung weg, faellt es dort nicht auf.

   Hier haben BEIDE Kunden account_id = null und denselben job_type.
   Dann ist die user_id die einzige verbleibende Grenze.
   ═══════════════════════════════════════════════════════ */
insert into public.sync_jobs (id, user_id, account_id, location_id, job_type, status, attempts, max_attempts, error_code, created_at)
values ('40000000-0000-0000-0000-000000000001', :'kunde_b', null, null, 'sync_locations', 'failed', 3, 3, 'oauth', now() - interval '20 minutes');

-- Erfolg von Kunde A, ebenfalls ohne account_id
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_a', null, null, 'sync_locations', 'succeeded', 1, now());

do $$
begin
  assert (select behoben from public.ops_sync_failures
           where id = '40000000-0000-0000-0000-000000000001') = false,
    'MANDANTENGRENZE: Der Erfolg von Kunde A darf den Fehler von Kunde B nicht beheben, auch wenn beide account_id null haben';
end $$;

-- Und der eigene Erfolg behebt sehr wohl
insert into public.sync_jobs (user_id, account_id, location_id, job_type, status, attempts, created_at)
values (:'kunde_b', null, null, 'sync_locations', 'succeeded', 1, now());

do $$
begin
  assert (select behoben from public.ops_sync_failures
           where id = '40000000-0000-0000-0000-000000000001') = true,
    'Der eigene spaetere Erfolg muss beheben';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
