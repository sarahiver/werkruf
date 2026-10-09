-- Abnahme fuer Oeffnungszeiten im Evaluation Context (Paket F1c).
--
--   psql -v ON_ERROR_STOP=1 -f openingHours.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('konto',   '22222222-2222-2222-2222-222222222222'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into auth.users (id, email)
values ((select id from t where name='user'), 'iver@example.com')
on conflict (id) do nothing;

insert into public.google_accounts (id, user_id, status, provider_account_id, provider)
values ((select id from t where name='konto'), (select id from t where name='user'),
        'active', 'accounts/1', 'google')
on conflict (id) do nothing;

/* Hilfsmittel: die Aussage des Kontexts. */
create or replace function pg_temp.oeffnung(p_loc uuid)
returns jsonb language sql as $$
  select public.build_location_evaluation_context(
    '11111111-1111-1111-1111-111111111111', p_loc) -> 'openingHours';
$$;

/* ═══════════════════════════════════════════════════════
   1 — Zeiten vorhanden
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.google_locations
    (id, user_id, account_id, account_resource_name, location_resource_name,
     title, selected_at, last_synced_at, google_profile)
  values ((select id from t where name='si'), (select id from t where name='user'),
          (select id from t where name='konto'), 'accounts/1', 'locations/1',
          'S&I.', now(), now(),
          jsonb_build_object('regularHours', jsonb_build_object('periods',
            jsonb_build_array(
              jsonb_build_object('openDay','MONDAY','openTime',jsonb_build_object('hours',8),
                                 'closeDay','MONDAY','closeTime',jsonb_build_object('hours',17))))));

  v := pg_temp.oeffnung((select id from t where name='si'));

  assert (v ->> 'reliable')::boolean, '1: verlaesslich';
  assert (v ->> 'present')::boolean,  '1: vorhanden';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Zuverlaessig keine Zeiten
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Google lieferte nichts: Der Schluessel steht da, der Wert ist
     null. Genau so schreibt es der Mapper. */
  update public.google_locations
     set google_profile = jsonb_build_object('regularHours', null)
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));

  assert (v ->> 'reliable')::boolean,      '2: verlaesslich';
  assert not (v ->> 'present')::boolean,   '2: nicht vorhanden';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Unbekannt: nie synchronisiert
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set last_synced_at = null
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));

  /* Der wichtigste Fall: Aus fehlenden Daten darf keine Empfehlung
     entstehen. */
  assert not (v ->> 'reliable')::boolean, '3: nicht verlaesslich';

  update public.google_locations set last_synced_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Unbekannt: Altbestand ohne den Schluessel
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Eine Zeile aus der Zeit vor dem heutigen Mapper: google_profile
     existiert, kennt regularHours aber nicht. Das unterscheidet
     "Google lieferte nichts" von "wir haben nie gefragt". */
  update public.google_locations
     set google_profile = jsonb_build_object('categories', '[]'::jsonb)
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));

  assert not (v ->> 'reliable')::boolean,
    '4: ohne den Schluessel nicht verlaesslich';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Unbekannt: leeres Profil
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* google_profile ist NOT NULL mit Vorgabe {} — eine Zeile, die noch
     nie durch den Mapper lief, sieht so aus. */
  update public.google_locations set google_profile = '{}'::jsonb
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));
  assert not (v ->> 'reliable')::boolean, '5: leeres Profil nicht verlaesslich';
  assert not (v ->> 'present')::boolean,  '5: und nichts vorhanden';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Gescheiterter Abgleich
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations
     set google_profile = jsonb_build_object('regularHours', null)
   where id = (select id from t where name='si');

  insert into public.sync_jobs (id, user_id, account_id, location_id, status,
                                finished_at, job_type)
  values (gen_random_uuid(), (select id from t where name='user'),
          (select id from t where name='konto'),
          (select id from t where name='si'), 'failed', now() - interval '1 hour',
          'sync_locations');

  v := pg_temp.oeffnung((select id from t where name='si'));

  /* Veraltete Daten sind keine fehlenden Daten. */
  assert not (v ->> 'reliable')::boolean, '6: nach Fehler nicht verlaesslich';

  delete from public.sync_jobs where location_id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Leeres Perioden-Array ist nicht vorhanden
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations
     set google_profile = jsonb_build_object('regularHours',
           jsonb_build_object('periods', '[]'::jsonb))
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));

  assert (v ->> 'reliable')::boolean,    '7: verlaesslich';
  assert not (v ->> 'present')::boolean, '7: leeres Array zaehlt nicht';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Teilweise gepflegt genuegt
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Montag bis Freitag, Wochenende fehlt. Fuer F1c vorhanden —
     Qualitaetspruefung kommt spaeter. */
  update public.google_locations
     set google_profile = jsonb_build_object('regularHours',
           jsonb_build_object('periods', (
             select jsonb_agg(jsonb_build_object(
               'openDay', tag, 'openTime', jsonb_build_object('hours', 8),
               'closeDay', tag, 'closeTime', jsonb_build_object('hours', 17)))
             from unnest(array['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY']) tag)))
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));
  assert (v ->> 'present')::boolean, '8: fuenf Tage sind vorhanden';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Durchgehend geoeffnet
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Google liefert fuer 24/7 eine Periode ohne closeTime. Ein
     gueltiger Zustand. */
  update public.google_locations
     set google_profile = jsonb_build_object('regularHours',
           jsonb_build_object('periods', jsonb_build_array(
             jsonb_build_object('openDay','MONDAY','openTime','{}'::jsonb,
                                'closeDay','MONDAY'))))
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));
  assert (v ->> 'present')::boolean, '9: durchgehend ist vorhanden';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Sonderzeiten ersetzen keine regulaeren
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations
     set google_profile = jsonb_build_object(
           'regularHours', null,
           'specialHours', jsonb_build_object('specialHourPeriods',
             jsonb_build_array(jsonb_build_object('startDate', '2026-12-24'))))
   where id = (select id from t where name='si');

  v := pg_temp.oeffnung((select id from t where name='si'));

  /* Weihnachten geschlossen sagt nichts darueber, wann normalerweise
     geoeffnet ist. */
  assert not (v ->> 'present')::boolean, '10: Sonderzeiten zaehlen nicht';
  assert (v ->> 'reliable')::boolean,    '10: verlaesslich trotzdem';
end $$;

/* ═══════════════════════════════════════════════════════
   11 — Multi-Location
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  insert into public.google_locations
    (id, user_id, account_id, account_resource_name, location_resource_name,
     title, selected_at, last_synced_at, google_profile)
  values ((select id from t where name='werkruf'), (select id from t where name='user'),
          (select id from t where name='konto'), 'accounts/1', 'locations/2',
          'WERKRUF', null, now(),
          jsonb_build_object('regularHours', jsonb_build_object('periods',
            jsonb_build_array(jsonb_build_object('openDay','MONDAY')))));

  v_si := pg_temp.oeffnung((select id from t where name='si'));
  v_wr := pg_temp.oeffnung((select id from t where name='werkruf'));

  /* S&I ohne, WERKRUF mit — der Kontext trennt sauber. */
  assert not (v_si ->> 'present')::boolean, '11: S&I ohne Zeiten';
  assert (v_wr ->> 'present')::boolean,     '11: WERKRUF mit Zeiten';
end $$;

/* ═══════════════════════════════════════════════════════
   12 — Die Klasse und der Weg durch F1b
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; x jsonb;
begin
  /* Das Event, wie die Engine es anlegt. */
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(jsonb_build_object(
      'type', 'profile.opening_hours_missing', 'category', 'profile',
      'priority', 50, 'title', 'Öffnungszeiten ergänzen',
      'summary', 'Keine regulären Öffnungszeiten hinterlegt.',
      'estimatedMinutes', 3, 'actionUrl', '/dashboard/google',
      'recommendationClass', 'growth', 'inWeeklyEmail', true,
      'ruleId', 'profile.opening_hours_missing')),
    'test-f1c', (select id from t where name='si'));

  assert (v ->> 'created')::int = 1, '12: Event angelegt';

  assert (select recommendation_class from public.events
           where type = 'profile.opening_hours_missing') = 'growth',
    '12: als Wachstum eingeordnet';

  /* Ohne Sonderlogik durch die gemeinsame Auswahl. */
  assert exists (
    select 1 from public.canonical_recommendation_events(
      (select id from t where name='user'), (select id from t where name='si'))
     where type = 'profile.opening_hours_missing'),
    '12: in der kanonischen Auswahl';

  /* Und durch die Wochenauswahl — nie gezeigt heisst sofort faellig. */
  select e into x from jsonb_array_elements(
    public.top_recommendations_for_email((select id from t where name='user'), 3)) e
   where e ->> 'title' = 'Öffnungszeiten ergänzen';

  assert x is not null, '12: in der Wochenmail';
  assert (x ->> 'nie_gezeigt')::boolean, '12: noch nie gezeigt';
  assert (x ->> 'minutes')::int = 3, '12: drei Minuten';
end $$;

/* ═══════════════════════════════════════════════════════
   13 — Resolve nach Ergaenzung
   ═══════════════════════════════════════════════════════ */
do $$
begin
  /* Die Zeiten werden gepflegt, die Engine laeuft erneut — ohne
     dieses Event. resolve_stale_events schliesst es. */
  perform public.sync_events(
    (select id from t where name='user'),
    '[]'::jsonb, 'test-f1c', (select id from t where name='si'));

  assert (select lifecycle from public.events
           where type = 'profile.opening_hours_missing') <> 'new',
    '13: nicht mehr offen';

  assert not exists (
    select 1 from public.canonical_recommendation_events(
      (select id from t where name='user'), (select id from t where name='si'))
     where type = 'profile.opening_hours_missing'),
    '13: keine weitere Erinnerung';
end $$;

/* ═══════════════════════════════════════════════════════
   14 — Drei Wachstumsaufgaben fuer S&I
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  perform public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(
      jsonb_build_object('type','reviews.none_yet','category','reviews','priority',65,
        'title','Erste Bewertungen einsammeln','summary','x','estimatedMinutes',3,
        'recommendationClass','growth','inWeeklyEmail',true,'ruleId','review.none_yet'),
      jsonb_build_object('type','profile.photos_missing','category','profile','priority',60,
        'title','5 Fotos hochladen','summary','x','estimatedMinutes',5,
        'recommendationClass','growth','inWeeklyEmail',true,'ruleId','profile.photos_missing'),
      jsonb_build_object('type','profile.opening_hours_missing','category','profile','priority',50,
        'title','Öffnungszeiten ergänzen','summary','x','estimatedMinutes',3,
        'recommendationClass','growth','inWeeklyEmail',true,'ruleId','profile.opening_hours_missing')),
    'test-f1c', (select id from t where name='si'));

  select (public.weekly_counts((select id from t where name='user'),
                               (select id from t where name='si')) ->> 'open')::int
    into v_anzahl;

  /* Kein all_clear, solange echte Luecken offen sind. */
  assert v_anzahl = 3, format('14: drei offene Aufgaben (ist: %s)', v_anzahl);
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
