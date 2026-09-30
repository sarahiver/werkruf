-- Abnahme fuer die standortreine Decision Engine (Paket D2, SQL).
--
--   psql -f engineLocationScope.test.sql
--
-- Setzt 20260930120000, 20260930140000 und 20260930160000 voraus.

\set ON_ERROR_STOP on

begin;

create temporary table t_ids (name text primary key, id uuid) on commit drop;
insert into t_ids values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('fremder', '22222222-2222-2222-2222-222222222222'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into public.google_locations (id, user_id, title, primary_phone, website_uri, locality, primary_category, google_media, selected_at)
values
  ((select id from t_ids where name='si'), (select id from t_ids where name='user'),
   'S&I.', '+49 40 1', 'https://si.example', 'Hamburg', 'gcid:web_designer',
   (select jsonb_agg(jsonb_build_object('name','m'||g)) from generate_series(1,8) g), now()),
  ((select id from t_ids where name='werkruf'), (select id from t_ids where name='user'),
   'WERKRUF', null, null, 'Hamburg', 'gcid:plumber',
   (select jsonb_agg(jsonb_build_object('name','m'||g)) from generate_series(1,2) g), null);

insert into public.google_reviews (user_id, location_id, star_rating, is_answered)
select (select id from t_ids where name='user'), (select id from t_ids where name='si'), 5, true
from generate_series(1,4);

insert into public.google_reviews (user_id, location_id, star_rating, is_answered)
select (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'), 3, false
from generate_series(1,2);

/* ═══════════════════════════════════════════════════════
   1 — Dieselbe Regel darf fuer beide Betriebe bestehen
   ═══════════════════════════════════════════════════════ */
do $$
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values
    ((select id from t_ids where name='user'), (select id from t_ids where name='si'),
     'photos.missing', 'profile', 28, 'Ein Foto hochladen', 'S&I braucht mehr Bilder'),
    ((select id from t_ids where name='user'), (select id from t_ids where name='werkruf'),
     'photos.missing', 'profile', 28, 'Ein Foto hochladen', 'WERKRUF braucht mehr Bilder');

  assert (select count(*) from public.events where type = 'photos.missing') = 2,
    'Gleiche Regel, zwei Betriebe — beide Zeilen muessen bestehen';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Zweimal dieselbe Regel am selben Betrieb geht nicht
   ═══════════════════════════════════════════════════════ */
do $$
declare v_fehler boolean := false;
begin
  begin
    insert into public.events (user_id, location_id, type, category, priority, title, summary)
    values ((select id from t_ids where name='user'), (select id from t_ids where name='si'),
            'photos.missing', 'profile', 28, 'Doppelt', 'Doppelt');
  exception when unique_violation then
    v_fehler := true;
  end;

  assert v_fehler, 'Dieselbe Regel am selben Betrieb muss abgewiesen werden';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — S&I auswerten loest WERKRUF NICHT auf
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_werkruf text;
begin
  /* Die Engine liefert fuer S&I nur noch eine andere Regel — das alte
     photos.missing kommt nicht mehr vor und soll aufgeloest werden. */
  v_anzahl := public.resolve_stale_events(
    (select id from t_ids where name='user'),
    '[{"type":"reviews.unanswered","subjectId":null}]'::jsonb,
    (select id from t_ids where name='si'));

  assert v_anzahl = 1, 'Genau das S&I-Event wird aufgeloest';

  select lifecycle into v_werkruf from public.events
   where location_id = (select id from t_ids where name='werkruf') and type = 'photos.missing';

  /* DER KERN: Vorher lief die Schleife ueber user_id und haette das
     WERKRUF-Event mitgenommen — der Kunde verlaere offene Aufgaben
     eines Betriebs, weil ein anderer ausgewertet wurde. */
  assert v_werkruf = 'new', 'Das WERKRUF-Event bleibt offen';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Konto-Events werden getrennt behandelt
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values ((select id from t_ids where name='user'), null,
          'connection.reauth', 'connection', 90, 'Verbindung erneuern', 'Token abgelaufen');

  /* Eine Standortauswertung darf das Konto-Event nicht anfassen. */
  v_anzahl := public.resolve_stale_events(
    (select id from t_ids where name='user'), '[]'::jsonb,
    (select id from t_ids where name='werkruf'));

  assert (select lifecycle from public.events where type = 'connection.reauth') = 'new',
    'Eine Standortauswertung laesst Konto-Events unberuehrt';

  /* Umgekehrt genauso. */
  v_anzahl := public.resolve_stale_events(
    (select id from t_ids where name='user'), '[]'::jsonb, null);

  assert (select lifecycle from public.events where type = 'connection.reauth') = 'resolved',
    'Die Konto-Auswertung loest es auf';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Impact-Metriken je Standort
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si numeric; v_wr numeric;
begin
  v_si := public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'),
    'reviews.responseRate');
  v_wr := public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'),
    'reviews.responseRate');

  assert v_si = 1.0, 'S&I: alle vier beantwortet';
  assert v_wr = 0.0, 'WERKRUF: keine beantwortet';

  /* Ohne Standortbezug maesse man die Wirkung einer S&I-Empfehlung an
     WERKRUF-Daten mit: vier von sechs statt vier von vier. */
  assert v_si <> v_wr, 'Die Werte muessen sich unterscheiden';

  assert public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'),
    'profile.photoCount') = 8, 'S&I hat acht Medien';
  assert public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'),
    'profile.photoCount') = 2, 'WERKRUF hat zwei';

  assert public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'),
    'profile.completeness') = 1.0, 'S&I hat alle vier Felder';
  assert public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='werkruf'),
    'profile.completeness') = 0.5, 'WERKRUF hat zwei von vier';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Der Score der Engine entspricht D1
   ═══════════════════════════════════════════════════════ */
do $$
declare v_metrik numeric; v_d1 numeric;
begin
  v_metrik := public.read_location_impact_metric(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'),
    'health.score');
  v_d1 := (public.compute_location_health_score(
    (select id from t_ids where name='user'), (select id from t_ids where name='si')) ->> 'score')::numeric;

  assert v_metrik = v_d1, 'Die Engine rechnet keinen zweiten Score';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Mandantentrennung
   ═══════════════════════════════════════════════════════ */
do $$
begin
  assert public.read_location_impact_metric(
    (select id from t_ids where name='fremder'), (select id from t_ids where name='si'),
    'reviews.totalCount') is null,
    'Ein fremder Nutzer bekommt keine Metrik — die Funktion umgeht RLS';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Tracking uebernimmt den Standort aus dem Event
   ═══════════════════════════════════════════════════════ */
do $$
declare v_event uuid; v_loc uuid;
begin
  /* Eine Review ist subject_type = review, gehoert aber zu einem
     Betrieb. Vorher wurde location_id nur bei subject_type = location
     gesetzt. */
  insert into public.events (user_id, location_id, type, category, priority, title, summary, subject_type, subject_id)
  values ((select id from t_ids where name='user'), (select id from t_ids where name='si'),
          'reviews.negative', 'reviews', 95, 'Schlechte Bewertung', 'Antworten',
          'review', gen_random_uuid())
  returning id into v_event;

  insert into public.recommendation_events (event_id, user_id, action)
  values (v_event, (select id from t_ids where name='user'), 'created');

  select location_id into v_loc from public.recommendation_events where event_id = v_event;
  assert v_loc = (select id from t_ids where name='si'),
    'Das Tracking uebernimmt den Standort aus dem Event, nicht aus dem Subject-Typ';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Vorwochenwert nur, wenn vergleichbar
   ═══════════════════════════════════════════════════════ */
do $$
begin
  /* Snapshot ohne Standort — nicht vergleichbar. */
  insert into public.weekly_snapshots (user_id, payload)
  values ((select id from t_ids where name='user'), '{"health":{"score":55}}'::jsonb);

  assert public.previous_location_health(
    (select id from t_ids where name='user'), (select id from t_ids where name='si')) is null,
    'Ein Snapshot ohne Standort darf nicht als Vorwochenwert dienen';

  /* Mit Standort und passender Fassung. */
  insert into public.weekly_snapshots (user_id, location_id, score_version, payload)
  values ((select id from t_ids where name='user'), (select id from t_ids where name='si'),
          1, '{"health":{"score":57}}'::jsonb);

  assert public.previous_location_health(
    (select id from t_ids where name='user'), (select id from t_ids where name='si')) = 57,
    'Mit Standort und passender Fassung ist er vergleichbar';

  /* Andere Fassung — nicht vergleichbar. */
  assert public.previous_location_health(
    (select id from t_ids where name='user'), (select id from t_ids where name='si'), 2::smallint) is null,
    'Eine andere Score-Fassung misst etwas anderes';

  /* Und nicht der Snapshot des anderen Betriebs. */
  assert public.previous_location_health(
    (select id from t_ids where name='user'), (select id from t_ids where name='werkruf')) is null,
    'WERKRUF hat keinen eigenen Snapshot';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Aufwand als Zahl, nicht als Text
   ═══════════════════════════════════════════════════════ */
do $$
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary,
                             estimated_effort, estimated_minutes)
  values ((select id from t_ids where name='user'), (select id from t_ids where name='werkruf'),
          'profile.incomplete', 'profile', 20, 'Website ergaenzen', 'Fehlt',
          '2 Minuten', 2);

  assert (select estimated_minutes from public.events where type = 'profile.incomplete') = 2,
    'Der Aufwand liegt strukturiert vor — kein Regex auf "2 Minuten" fuers Wochenbudget';

  /* Summierbar, ohne Text zu zerlegen. */
  assert (select sum(estimated_minutes) from public.events
           where location_id = (select id from t_ids where name='werkruf')
             and estimated_minutes is not null) = 2,
    'Und laesst sich summieren';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
