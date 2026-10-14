-- Abnahme fuer den standortbezogenen Evaluation Context (Paket D2).
--
--   psql -f locationEvaluationContext.test.sql
--
-- Setzt 20260930120000, 140000, 160000 und 180000 voraus.

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('fremder', '22222222-2222-2222-2222-222222222222'),
  ('konto',   '55555555-5555-5555-5555-555555555555'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

/* ═══════════════════════════════════════════════════════
   GRUNDGERUEST — ueber die Fixture-Schicht, nicht von Hand
   ═══════════════════════════════════════════════════════

   Dieser Test stammt aus der Zeit, in der die Testdatenbank mehrere
   Pflichtspalten nullable liess. Er war gruen, obwohl er Zeilen
   erzeugte, die Produktion nie zugelassen haette — genau die Falle,
   vor der der Kopf von setup.sh warnt.

   Betroffen: provider_account_id, der Fremdschluessel auf auth.users
   sowie account_resource_name und location_resource_name. Jede Spalte
   einzeln nachzutragen legt die naechste frei; die Helfer aus
   scripts/test-db/sql/80-fixtures.sql halten das Wissen an EINER
   Stelle und liefern dieselben Kennungen, die t fuehrt.

   Die fachlichen Felder setzt der Test danach selbst — sie sind sein
   Gegenstand. */

select test.benutzer('user_a');
select test.konto('konto_a', 'user_a');
select test.standort('standort_si',      'user_a', 'konto_a', 'S&I.',    true);
select test.standort('standort_werkruf', 'user_a', 'konto_a', 'WERKRUF', false);

/* provider_email setzt der Helfer nicht. Abschnitt 7 prueft nur den
   status; die Mail bleibt trotzdem stehen, damit der Test weiter
   beschreibt, was er nachstellt. */
update public.google_accounts set provider_email = 'ivergentz@gmail.com'
 where id = (select id from t where name='konto');

update public.google_locations set
  primary_phone    = '+49 40 1',
  website_uri      = 'https://si.example',
  locality         = 'Hamburg',
  primary_category = 'gcid:web_designer',
  google_media     = (select jsonb_agg(jsonb_build_object('name','m'||g))
                        from generate_series(1,8) g)
 where id = (select id from t where name='si');

update public.google_locations set
  primary_phone    = null,
  website_uri      = null,
  locality         = 'Hamburg',
  primary_category = 'gcid:plumber',
  google_media     = (select jsonb_agg(jsonb_build_object('name','m'||g))
                        from generate_series(1,2) g)
 where id = (select id from t where name='werkruf');

/* S&I: vier Bewertungen, alle beantwortet, 5 Sterne */
/* google_reviews hat fuenf Pflichtspalten — location_id, account_id,
   user_id, review_resource_name, google_created_at. test.bewertungen()
   fuellt sie und liest Nutzer und Konto aus dem Standort. */
select test.bewertungen('standort_si', 4, 5, true, interval '3 days');

/* WERKRUF: zwei unbeantwortete Ein-Stern-Bewertungen */
select test.bewertungen('standort_werkruf', 2, 1, false, interval '2 days');

/* Der Name steht nicht in den Zusicherungen, beschreibt aber, was der
   Test nachstellt: eine unzufriedene Kundschaft bei WERKRUF. */
update public.google_reviews set reviewer_display_name = 'Unzufrieden'
 where location_id = (select id from t where name='werkruf');

/* ═══════════════════════════════════════════════════════
   1 — Bewertungen gehoeren zum richtigen Betrieb
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  v_si := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));
  v_wr := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='werkruf'));

  /* Vorher: where user_id = p_user_id — sechs Bewertungen fuer beide. */
  assert (v_si -> 'reviews' -> 'total')::int = 4, 'S&I hat vier';
  assert (v_wr -> 'reviews' -> 'total')::int = 2, 'WERKRUF hat zwei';

  assert (v_si -> 'reviews' -> 'unanswered')::int = 0, 'S&I: alle beantwortet';
  assert (v_wr -> 'reviews' -> 'unanswered')::int = 2, 'WERKRUF: keine';

  assert (v_si -> 'reviews' ->> 'averageRating')::numeric = 5.0, 'S&I: 5,0';
  assert (v_wr -> 'reviews' ->> 'averageRating')::numeric = 1.0, 'WERKRUF: 1,0';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Schlechte Bewertungen nur des eigenen Betriebs
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  v_si := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));
  v_wr := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='werkruf'));

  assert jsonb_array_length(v_si -> 'lowRatedOpen') = 0,
    'S&I hat keine offenen schlechten Bewertungen';
  assert jsonb_array_length(v_wr -> 'lowRatedOpen') = 2,
    'WERKRUF hat zwei';

  /* Sonst entstuende fuer S&I eine Empfehlung "schlechte Bewertung
     beantworten" zu einer Bewertung, die WERKRUF gehoert. */
  assert (v_wr -> 'lowRatedOpen' -> 0 ->> 'locationId')::uuid
       = (select id from t where name='werkruf'),
    'Und sie gehoeren nachweislich zu WERKRUF';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Fotos und Score je Betrieb
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  v_si := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));
  v_wr := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='werkruf'));

  assert (v_si -> 'photoCount')::int = 8, 'S&I: acht Medien';
  assert (v_wr -> 'photoCount')::int = 2, 'WERKRUF: zwei';

  /* Der Score stammt aus D1 — die Engine rechnet keinen zweiten. */
  assert (v_si -> 'health' -> 'score')::int
       = (public.compute_location_health_score(
            (select id from t where name='user'), (select id from t where name='si')) ->> 'score')::int,
    'Der Score im Kontext ist der kanonische';

  assert (v_si -> 'health' -> 'score')::int <> (v_wr -> 'health' -> 'score')::int,
    'Und er unterscheidet sich zwischen den Betrieben';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Antworten folgen der Bewertung, nicht dem Nutzer
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb; v_review uuid;
begin
  select id into v_review from public.google_reviews
   where location_id = (select id from t where name='werkruf') limit 1;

  /* location_id ist in Produktion NOT NULL. Der Wert wird aus der
     Bewertung gelesen und nicht gesetzt — genau das ist die Aussage
     dieses Abschnitts: der Standortbezug einer Antwort entsteht ueber
     die Bewertung, nicht ueber den Nutzer. */
  insert into public.review_replies (user_id, review_id, location_id, body, status)
  values ((select id from t where name='user'), v_review,
          (select location_id from public.google_reviews where id = v_review),
          'Danke fuer die Rueckmeldung.', 'draft');

  v_si := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));
  v_wr := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='werkruf'));

  /* review_replies haengt am Nutzer — der Standortbezug entsteht ueber
     die Bewertung. Ohne den Join saehe S&I einen Entwurf, den es nie
     gab. */
  assert (v_si -> 'replies' -> 'draft')::int = 0, 'S&I hat keinen Entwurf';
  assert (v_wr -> 'replies' -> 'draft')::int = 1, 'WERKRUF hat einen';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Sync-Zustand je Betrieb
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  /* job_type ist NOT NULL und per Check auf die bekannten Arten
     begrenzt. Welche es ist, prueft dieser Abschnitt nicht — er prueft
     den Fehlerzustand je Betrieb. */
  insert into public.sync_jobs (user_id, location_id, job_type, status, finished_at)
  values ((select id from t where name='user'), (select id from t where name='werkruf'),
          'sync_reviews', 'failed', now() - interval '1 hour');

  v_si := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));
  v_wr := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='werkruf'));

  assert (v_si ->> 'syncFailed')::boolean = false,
    'Ein Fehler bei WERKRUF darf S&I nicht betreffen';
  assert (v_wr ->> 'syncFailed')::boolean = true, 'WERKRUF schon';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Die kanonische Funktion folgt der D1-Logik
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.build_evaluation_context((select id from t where name='user'));

  assert (v ->> 'locationResolved')::boolean = true, 'Standort aufgeloest';
  assert v -> 'location' ->> 'title' = 'S&I.', 'Der ausgewaehlte Betrieb';
  assert (v -> 'reviews' -> 'total')::int = 4, 'Mit dessen Bewertungen';

  /* Auswahl wechseln. */
  update public.google_locations set selected_at = null
   where id = (select id from t where name='si');
  update public.google_locations set selected_at = now()
   where id = (select id from t where name='werkruf');

  v := public.build_evaluation_context((select id from t where name='user'));
  assert v -> 'location' ->> 'title' = 'WERKRUF', 'Nach dem Wechsel der andere';
  assert (v -> 'reviews' -> 'total')::int = 2, 'Mit dessen Bewertungen';

  update public.google_locations set selected_at = null
   where id = (select id from t where name='werkruf');
  update public.google_locations set selected_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Ohne Auswahl: keine standortbezogenen Fakten
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set selected_at = null
   where user_id = (select id from t where name='user');

  v := public.build_evaluation_context((select id from t where name='user'));

  assert (v ->> 'locationResolved')::boolean = false, 'Kein Standort aufgeloest';
  assert (v ->> 'multipleLocations')::boolean = true,
    'Aber es gibt mehrere — daraus kann die Engine "Betrieb auswaehlen" ableiten';

  /* Keine 0-Werte als Ersatz. Eine 0 bei Bewertungen saehe aus wie ein
     Betrieb ohne Kundschaft. */
  assert v -> 'reviews' is null, 'Keine erfundenen Bewertungszahlen';
  assert v -> 'photoCount' is null, 'Keine erfundene Fotozahl';
  assert v -> 'health' is null, 'Kein geratener Score';

  /* Der Kontozustand bleibt — Verbindungsregeln muessen weiter
     funktionieren. */
  assert v -> 'connection' ->> 'status' = 'active',
    'Der Kontozustand steht trotzdem zur Verfuegung';

  update public.google_locations set selected_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Ein einziger Betrieb braucht keine Auswahl
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set deleted_at = now()
   where id = (select id from t where name='werkruf');
  update public.google_locations set selected_at = null
   where id = (select id from t where name='si');

  v := public.build_evaluation_context((select id from t where name='user'));

  assert (v ->> 'locationResolved')::boolean = true, 'Ein Betrieb zaehlt ohne Auswahl';
  assert (v ->> 'multipleLocations')::boolean = false, 'Und es gibt keine Auswahl zu treffen';

  update public.google_locations set deleted_at = null
   where id = (select id from t where name='werkruf');
  update public.google_locations set selected_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Mandantentrennung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.build_location_evaluation_context(
    (select id from t where name='fremder'), (select id from t where name='si'));

  assert (v ->> 'locationResolved')::boolean = false,
    'Ein fremder Nutzer bekommt keinen Kontext';
  assert v ->> 'reason' = 'standort_nicht_gefunden', 'Mit erkennbarem Grund';
  assert v -> 'reviews' is null, 'Und keine Daten';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Vorwochenwert nur, wenn vergleichbar
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));

  assert v -> 'previousHealth' = 'null'::jsonb,
    'Ohne passenden Snapshot kein Vergleichswert — health.declined feuert nicht';

  insert into public.weekly_snapshots (user_id, location_id, score_version, week_start, health_score)
  values ((select id from t where name='user'), (select id from t where name='si'),
          1, current_date - 7, 57);

  v := public.build_location_evaluation_context(
    (select id from t where name='user'), (select id from t where name='si'));

  assert (v ->> 'previousHealth')::numeric = 57, 'Mit passendem Snapshot schon';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;