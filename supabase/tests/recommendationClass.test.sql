-- Abnahme fuer die Recommendation-Klassen (Paket F1a).
--
--   psql -v ON_ERROR_STOP=1 -f recommendationClass.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user', '11111111-1111-1111-1111-111111111111'),
  ('si',   '33333333-3333-3333-3333-333333333333');

insert into public.google_locations (id, user_id, title, selected_at)
values ((select id from t where name='si'), (select id from t where name='user'), 'S&I.', now());

/* ═══════════════════════════════════════════════════════
   1 — Die Spalte existiert und ist beschraenkt
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    insert into public.events
      (user_id, location_id, type, category, priority, title, summary,
       recommendation_class)
    values ((select id from t where name='user'), (select id from t where name='si'),
            'x.unsinn', 'profile', 30, 'x', 'x', 'erfunden');
  exception when check_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen, '1: nur problem, growth, opportunity';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Die Vorgabe ist growth
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary)
  values ('aaaa4444-0000-0000-0000-000000000001',
          (select id from t where name='user'), (select id from t where name='si'),
          'x.ohne_angabe', 'profile', 30, 'Ohne Angabe', 'x');

  select recommendation_class into v from public.events
   where id = 'aaaa4444-0000-0000-0000-000000000001';

  /* Eine Wachstumsaufgabe faelschlich als Problem zu melden waere
     Alarmismus; umgekehrt geht nur Dringlichkeit verloren. */
  assert v = 'growth', format('2: growth als Vorgabe (ist: %s)', v);
end $$;

/* ═══════════════════════════════════════════════════════
   3 — sync_events schreibt die Klasse
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(
      jsonb_build_object(
        'type', 'connection.lost', 'category', 'connection', 'priority', 95,
        'title', 'Verbindung erneuern', 'summary', 'x',
        'recommendationClass', 'problem', 'ruleId', 'connection.lost'),
      jsonb_build_object(
        'type', 'reviews.none_yet', 'category', 'reviews', 'priority', 50,
        'title', 'Erste Bewertungen einsammeln', 'summary', 'x',
        'estimatedMinutes', 3,
        'recommendationClass', 'growth', 'ruleId', 'review.none_yet')),
    'test-f1a',
    (select id from t where name='si'));

  assert (v ->> 'created')::int = 2, '3: beide angelegt';

  assert (select recommendation_class from public.events
           where type = 'connection.lost') = 'problem',
    '3: die Verbindung ist ein Problem';
  assert (select recommendation_class from public.events
           where type = 'reviews.none_yet') = 'growth',
    '3: fehlende Bewertungen sind Wachstum';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Ohne Angabe bleibt es growth
   ═══════════════════════════════════════════════════════ */
do $$
begin
  perform public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(jsonb_build_object(
      'type', 'x.keine_klasse', 'category', 'profile', 'priority', 20,
      'title', 'Ohne Klasse', 'summary', 'x', 'ruleId', 'x.keine_klasse')),
    'test-f1a', (select id from t where name='si'));

  assert (select recommendation_class from public.events
           where type = 'x.keine_klasse') = 'growth',
    '4: growth als Rueckfall';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Ein zweiter Lauf aktualisiert die Klasse
   ═══════════════════════════════════════════════════════ */
do $$
begin
  /* Aendert sich die Zuordnung in der Engine, soll sie beim naechsten
     Lauf durchschlagen — die Engine ist die Quelle. */
  perform public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(jsonb_build_object(
      'type', 'x.keine_klasse', 'category', 'profile', 'priority', 20,
      'title', 'Ohne Klasse', 'summary', 'x',
      'recommendationClass', 'problem', 'ruleId', 'x.keine_klasse')),
    'test-f1a', (select id from t where name='si'));

  assert (select recommendation_class from public.events
           where type = 'x.keine_klasse') = 'problem',
    '5: die Engine ueberschreibt';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Die gemeinsame Auswahl reicht die Klasse durch
   ═══════════════════════════════════════════════════════ */
do $$
declare v_problem integer; v_growth integer;
begin
  /* Beide Klassen frisch anlegen.

     Test 5 hat sync_events mit nur EINER Empfehlung aufgerufen —
     resolve_stale_events hat dabei alle uebrigen aufgeloest. Das ist
     richtig so, macht aber die vorherigen Zeilen unbrauchbar. */
  perform public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(
      jsonb_build_object(
        'type', 'connection.lost', 'category', 'connection', 'priority', 95,
        'title', 'Verbindung', 'summary', 'x',
        'recommendationClass', 'problem', 'ruleId', 'connection.lost'),
      jsonb_build_object(
        'type', 'reviews.none_yet', 'category', 'reviews', 'priority', 50,
        'title', 'Erste Bewertungen', 'summary', 'x',
        'recommendationClass', 'growth', 'ruleId', 'review.none_yet')),
    'test-f1a', (select id from t where name='si'));

  select count(*) filter (where recommendation_class = 'problem'),
         count(*) filter (where recommendation_class = 'growth')
    into v_problem, v_growth
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'));

  /* F1b wird darauf aufbauen: Rotation darf Wachstum verschieben,
     Probleme nicht. */
  assert v_problem >= 1, '6: Probleme sind unterscheidbar';
  assert v_growth >= 1,  '6: Wachstumsaufgaben auch';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Der Bestand wurde eingeordnet
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  /* Eine Zeile, wie sie vor der Migration entstanden waere. */
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary,
     recommendation_class)
  values ('bbbb4444-0000-0000-0000-000000000001',
          (select id from t where name='user'), (select id from t where name='si'),
          'sync.failing', 'connection', 40, 'Altbestand', 'x', 'growth');

  /* Der update-Teil der Migration nachgestellt. */
  update public.events
     set recommendation_class = 'problem'
   where recommendation_class = 'growth'
     and (type like 'connection.%' or type like 'review%negative%'
          or type like 'reply.publish_failed%' or type like 'sync.%');

  select recommendation_class into v from public.events
   where id = 'bbbb4444-0000-0000-0000-000000000001';

  assert v = 'problem', '7: Altbestand wird eingeordnet';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
