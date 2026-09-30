-- Abnahme fuer den standortbezogenen WERKRUF Score (Paket D1).
--
--   psql -f locationHealthScore.test.sql
--
-- Setzt 20260930120000_location_health_score.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.

\set ON_ERROR_STOP on

begin;

/* ── Ausgangslage: ein Nutzer, zwei Betriebe ── */
create temporary table t_ids (name text primary key, id uuid) on commit drop;

insert into t_ids values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('fremder', '22222222-2222-2222-2222-222222222222'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into public.google_locations (id, user_id, title, primary_phone, website_uri, locality, primary_category, selected_at, created_at)
values
  ((select id from t_ids where name='si'),
   (select id from t_ids where name='user'),
   'S&I.', '+49 40 1', 'https://si.example', 'Hamburg', 'gcid:web_designer',
   now(), now() - interval '10 days'),
  ((select id from t_ids where name='werkruf'),
   (select id from t_ids where name='user'),
   'WERKRUF', null, null, 'Hamburg', 'gcid:plumber',
   null, now() - interval '20 days');

/* S&I: vier Bewertungen, alle beantwortet, Schnitt 5,0 */
insert into public.google_reviews (user_id, location_id, star_rating, is_answered, google_created_at)
select (select id from t_ids where name='user'), (select id from t_ids where name='si'),
       5, true, now() - interval '3 days'
from generate_series(1, 4);

/* WERKRUF: zwei Bewertungen, keine beantwortet, Schnitt 3,0 */
insert into public.google_reviews (user_id, location_id, star_rating, is_answered, google_created_at)
select (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'),
       3, false, now() - interval '200 days'
from generate_series(1, 2);

/* ═══════════════════════════════════════════════════════
   1 — Zwei Betriebe, zwei verschiedene Werte
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  v_si := public.compute_location_health_score(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'));
  v_wr := public.compute_location_health_score(
    (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'));

  /* Der Kern: Vorher zaehlte compute_health_score ALLE Bewertungen des
     Nutzers und nahm die Profilfelder vom aeltesten Standort — ein
     Wert, der zu keinem von beiden gehoerte. */
  assert (v_si -> 'reviewsTotal')::int = 4, 'S&I hat vier Bewertungen';
  assert (v_wr -> 'reviewsTotal')::int = 2, 'WERKRUF hat zwei';
  assert (v_si -> 'score')::int <> (v_wr -> 'score')::int,
    'Zwei Betriebe mit verschiedenen Daten duerfen nicht denselben Score haben';

  assert v_si ->> 'locationTitle' = 'S&I.', 'Der Betrieb wird benannt';
  assert v_wr ->> 'locationTitle' = 'WERKRUF', 'Und beim anderen der andere';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Die Faktoren stimmen je Standort
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.compute_location_health_score(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'));

  assert (v -> 'factors' -> 'responseRate')::int = 30,
    'Alle vier beantwortet → volle 30 Punkte';
  assert (v -> 'factors' -> 'rating')::int = 25,
    'Schnitt 5,0 → volle 25 Punkte';
  assert (v -> 'factors' -> 'recency')::int = 20,
    'Drei Tage alt → volle 20 Punkte';
  assert (v -> 'factors' -> 'completeness')::int = 15,
    'Alle vier Felder gefuellt → volle 15 Punkte';

  v := public.compute_location_health_score(
    (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'));

  assert (v -> 'factors' -> 'responseRate')::int = 0, 'Keine beantwortet → 0';
  assert (v -> 'factors' -> 'rating')::int = 0, 'Schnitt 3,0 → 0';
  assert (v -> 'factors' -> 'recency')::int = 0, '200 Tage → 0';
  assert (v -> 'factors' -> 'completeness')::int = 8,
    'Zwei von vier Feldern → 8 Punkte (gerundet)';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Die Standortwahl folgt selected_at
   ═══════════════════════════════════════════════════════ */
do $$
declare v_gewaehlt uuid; v jsonb;
begin
  v_gewaehlt := public.werkruf_score_location((select id from t_ids where name='user'));
  assert v_gewaehlt = (select id from t_ids where name='si'),
    'Bei mehreren Standorten zaehlt selected_at';

  v := public.compute_health_score((select id from t_ids where name='user'));
  assert v ->> 'locationTitle' = 'S&I.',
    'Die kanonische Funktion nimmt denselben Standort';
  assert (v -> 'reviewsTotal')::int = 4,
    'Und damit auch dessen Bewertungen — nicht alle sechs';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Auswahl wechseln wechselt den Score
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set selected_at = null
   where id = (select id from t_ids where name='si');
  update public.google_locations set selected_at = now()
   where id = (select id from t_ids where name='werkruf');

  v := public.compute_health_score((select id from t_ids where name='user'));
  assert v ->> 'locationTitle' = 'WERKRUF', 'Nach dem Wechsel der andere Betrieb';
  assert (v -> 'reviewsTotal')::int = 2, 'Und dessen Bewertungen';

  /* zurueck */
  update public.google_locations set selected_at = null
   where id = (select id from t_ids where name='werkruf');
  update public.google_locations set selected_at = now()
   where id = (select id from t_ids where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Mehrere Standorte ohne Auswahl: kein Score
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set selected_at = null
   where user_id = (select id from t_ids where name='user');

  assert public.werkruf_score_location((select id from t_ids where name='user')) is null,
    'Ohne Auswahl kein Standort';

  v := public.compute_health_score((select id from t_ids where name='user'));
  assert v -> 'score' = 'null'::jsonb, 'Und damit kein Score';
  assert v ->> 'grund' = 'kein_standort', 'Mit erkennbarem Grund';

  /* Eine 0 waere falsch — sie saehe aus wie ein schlechter Betrieb. */
  assert (v ->> 'score') is distinct from '0', 'Kein Score ist nicht dasselbe wie 0';

  update public.google_locations set selected_at = now()
   where id = (select id from t_ids where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Genau ein Standort braucht keine Auswahl
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set deleted_at = now()
   where id = (select id from t_ids where name='werkruf');
  update public.google_locations set selected_at = null
   where id = (select id from t_ids where name='si');

  assert public.werkruf_score_location((select id from t_ids where name='user'))
         = (select id from t_ids where name='si'),
    'Ein einziger Standort zaehlt auch ohne Auswahl';

  v := public.compute_health_score((select id from t_ids where name='user'));
  assert (v -> 'score')::int > 0, 'Und liefert einen Wert';

  update public.google_locations set deleted_at = null
   where id = (select id from t_ids where name='werkruf');
  update public.google_locations set selected_at = now()
   where id = (select id from t_ids where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Mandantentrennung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Ein fremder Nutzer darf den Standort nicht auswerten — die
     Funktion laeuft als security definer und umgeht RLS. */
  v := public.compute_location_health_score(
    (select id from t_ids where name='fremder'), (select id from t_ids where name='si'));

  assert v -> 'score' = 'null'::jsonb, 'Fremder Standort liefert keinen Score';
  assert v ->> 'grund' = 'standort_nicht_gefunden', 'Mit erkennbarem Grund';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Score-Fassung wird mitgeliefert
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.compute_health_score((select id from t_ids where name='user'));
  assert (v -> 'scoreVersion')::int = 1,
    'Die Fassung der Formel muss mitkommen — sonst liessen sich spaetere Werte nicht einordnen';

  /* Die Gewichte summieren sich auf 100. */
  assert (v -> 'factors' -> 'responseRate')::int
       + (v -> 'factors' -> 'rating')::int
       + (v -> 'factors' -> 'recency')::int
       + (v -> 'factors' -> 'completeness')::int
       + (v -> 'factors' -> 'photos')::int
       = (v -> 'score')::int,
    'Die Faktoren muessen den Score ergeben';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
