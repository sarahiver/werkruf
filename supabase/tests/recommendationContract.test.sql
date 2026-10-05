-- Abnahme fuer die gemeinsame Recommendation-Auswahl (Paket E2).
--
--   psql -v ON_ERROR_STOP=1 -f recommendationContract.test.sql
--
-- Der wichtigste Test dieser Datei ist der letzte: Dashboard und Mail
-- muessen fuer Events mit beiden Kanalflags dieselbe Grundmenge in
-- derselben Reihenfolge liefern. Laeuft eine Seite kuenftig weg,
-- schlaegt er an.

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into public.google_locations (id, user_id, title, selected_at) values
  ((select id from t where name='si'),      (select id from t where name='user'), 'S&I.',    now()),
  ((select id from t where name='werkruf'), (select id from t where name='user'), 'WERKRUF', null);

/* Die Lage aus deinem Abschnitt 24: A, B lokal; C fremd; D Konto;
   E Probebetrieb; F pausiert; G abgelaufen. */
insert into public.events
  (id, user_id, location_id, type, category, priority, title, summary,
   estimated_minutes, in_dashboard, in_weekly_email, rule_status,
   cooldown_until, expires_at, created_at, subject_type, subject_id)
values
  ('a0000000-0000-0000-0000-00000000000a',
   (select id from t where name='user'), (select id from t where name='si'),
   'x.a', 'profile', 50, 'A wartet laenger', 'x', 30, true, true, null,
   null, null, now() - interval '3 days', 'review', 'f0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000b',
   (select id from t where name='user'), (select id from t where name='si'),
   'x.b', 'profile', 50, 'B ist schneller', 'x', 5, true, true, null,
   null, null, now(), 'review', 'f0000000-0000-0000-0000-00000000000b'),
  ('c0000000-0000-0000-0000-00000000000c',
   (select id from t where name='user'), (select id from t where name='werkruf'),
   'x.c', 'profile', 95, 'C fremder Betrieb', 'x', 5, true, true, null,
   null, null, now(), 'review', 'f0000000-0000-0000-0000-00000000000c'),
  ('d0000000-0000-0000-0000-00000000000d',
   (select id from t where name='user'), null,
   'x.d', 'connection', 70, 'D Konto', 'x', 2, true, true, null,
   null, null, now(), 'review', 'f0000000-0000-0000-0000-00000000000d'),
  ('e0000000-0000-0000-0000-00000000000e',
   (select id from t where name='user'), (select id from t where name='si'),
   'x.e', 'profile', 99, 'E Probebetrieb', 'x', 1, true, true, 'candidate',
   null, null, now(), 'review', 'f0000000-0000-0000-0000-00000000000e'),
  ('f0000000-0000-0000-0000-00000000000f',
   (select id from t where name='user'), (select id from t where name='si'),
   'x.f', 'profile', 99, 'F pausiert', 'x', 1, true, true, null,
   now() + interval '7 days', null, now(), 'review', 'f0000000-0000-0000-0000-00000000000f'),
  ('90000000-0000-0000-0000-000000000009',
   (select id from t where name='user'), (select id from t where name='si'),
   'x.g', 'profile', 99, 'G abgelaufen', 'x', 1, true, true, null,
   null, now() - interval '1 day', now(), 'review', 'f0000000-0000-0000-0000-000000000009');

/* ═══════════════════════════════════════════════════════
   1 — Die gemeinsame Auswahl
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  select string_agg(title, ' | ' order by priority desc, created_at asc, id asc)
    into v
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'));

  /* D (70) vor A und B (je 50); A vor B, weil aelter.
     C gehoert WERKRUF, E ist Probebetrieb, F pausiert, G abgelaufen. */
  assert v = 'D Konto | A wartet laenger | B ist schneller',
    format('1: erwartet D|A|B, ist: %s', v);
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Was die Basis ausschliesst
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  select string_agg(title, ', ') into v
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'));

  assert v not like '%C fremder%',    '2: kein fremder Betrieb';
  assert v not like '%E Probebetrieb%','2: kein Probebetrieb';
  assert v not like '%F pausiert%',   '2: nichts Pausiertes';
  assert v not like '%G abgelaufen%', '2: nichts Abgelaufenes';
  assert v like '%D Konto%',          '2: Konto-Ereignisse bleiben';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Konto-Ereignisse abwaehlbar
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  select string_agg(title, ', ') into v
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'), false);

  assert v not like '%D Konto%', '3: ohne Konto-Ereignisse';
  assert v like '%A wartet%',    '3: Betriebsereignisse bleiben';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — DER CONTRACT-TEST
   ═══════════════════════════════════════════════════════

   Dashboard und Mail muessen fuer Events mit BEIDEN Kanalflags
   dieselbe Grundmenge in derselben Reihenfolge liefern.

   Dieser Test ist der Grund fuer das ganze Paket: Laeuft eine Seite
   kuenftig weg — ein Filter nur hier, eine Sortierspalte nur dort —
   schlaegt er an. */
do $$
declare v_dash text; v_mail text; v_basis text;
begin
  select string_agg(x ->> 'id', ' | ' order by ord) into v_dash
    from jsonb_array_elements(
      public.events_feed((select id from t where name='user'),
                         (select id from t where name='si'), 50) -> 'items'
    ) with ordinality q(x, ord);

  select string_agg(x ->> 'id', ' | ' order by ord) into v_mail
    from jsonb_array_elements(
      public.top_recommendations_for_email((select id from t where name='user'), 50)
    ) with ordinality q(x, ord);

  select string_agg(id::text, ' | ' order by priority desc, created_at asc, id asc)
    into v_basis
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'))
   where in_dashboard and in_weekly_email;

  assert v_dash = v_basis,
    format('4: Dashboard weicht ab.%s  Basis: %s%s  Dashboard: %s',
           E'\n', v_basis, E'\n', v_dash);
  assert v_mail = v_basis,
    format('4: Mail weicht ab.%s  Basis: %s%s  Mail: %s',
           E'\n', v_basis, E'\n', v_mail);
  assert v_dash = v_mail, '4: Dashboard und Mail stimmen ueberein';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Kanalunterschiede bleiben gewollt
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash text; v_mail text;
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_dashboard, in_weekly_email, subject_type, subject_id)
  values
    ('11110000-0000-0000-0000-000000000001',
     (select id from t where name='user'), (select id from t where name='si'),
     'x.nurdash', 'profile', 60, 'Nur Dashboard', 'x', 1, true, false,
     'review', 'f1110000-0000-0000-0000-000000000001'),
    ('22220000-0000-0000-0000-000000000002',
     (select id from t where name='user'), (select id from t where name='si'),
     'x.nurmail', 'profile', 61, 'Nur Mail', 'x', 1, false, true,
     'review', 'f2220000-0000-0000-0000-000000000002');

  select string_agg(x ->> 'title', ', ') into v_dash
    from jsonb_array_elements(
      public.events_feed((select id from t where name='user'),
                         (select id from t where name='si'), 50) -> 'items') x;

  select string_agg(x ->> 'title', ', ') into v_mail
    from jsonb_array_elements(
      public.top_recommendations_for_email((select id from t where name='user'), 50)) x;

  /* Das ist kein Drift, sondern Kanalentscheidung. */
  assert v_dash like '%Nur Dashboard%',     '5: Dashboard-Event im Dashboard';
  assert v_dash not like '%Nur Mail%',      '5: nicht das Mail-Event';
  assert v_mail like '%Nur Mail%',          '5: Mail-Event in der Mail';
  assert v_mail not like '%Nur Dashboard%', '5: nicht das Dashboard-Event';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Das Weekly-Limit
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash integer; v_mail integer;
begin
  select jsonb_array_length(
    public.events_feed((select id from t where name='user'),
                       (select id from t where name='si'), 50) -> 'items')
    into v_dash;

  select jsonb_array_length(
    public.top_recommendations_for_email((select id from t where name='user'), 50))
    into v_mail;

  /* Das Limit gehoert in den Mail-Teil, nicht in die gemeinsame
     Basis — sonst bekaeme das Dashboard auch nur drei. */
  assert v_dash > 3, format('6: Dashboard zeigt alle (%s)', v_dash);
  assert v_mail = 3, format('6: Mail hoechstens drei (%s)', v_mail);
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Stabil bei gleicher Prioritaet UND gleichem Zeitstempel
   ═══════════════════════════════════════════════════════ */
do $$
declare v_erste text; v_zweite text;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     in_dashboard, in_weekly_email, created_at, subject_type, subject_id)
  select (select id from t where name='user'), (select id from t where name='si'),
         'gleich.' || g, 'profile', 45, 'Gleich ' || g, 'x',
         true, true, '2026-10-05 12:00:00+00'::timestamptz,
         'review', ('f9990000-0000-0000-0000-00000000000' || g)::uuid
  from generate_series(1, 5) g;

  select string_agg(id::text, '|' order by priority desc, created_at asc, id asc)
    into v_erste
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'));

  select string_agg(id::text, '|' order by priority desc, created_at asc, id asc)
    into v_zweite
    from public.canonical_recommendation_events(
           (select id from t where name='user'), (select id from t where name='si'));

  /* Ohne id als drittes Kriterium waere die Reihenfolge nicht
     definiert. */
  assert v_erste = v_zweite, '7: zweimal dieselbe Reihenfolge';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Der Lebenszyklus-Filter fuer die Historie
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     lifecycle, in_dashboard, subject_type, subject_id)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'x.fertig', 'profile', 30, 'Erledigt', 'x', 'completed', true,
          'review', 'f8880000-0000-0000-0000-000000000001');

  v := public.events_feed((select id from t where name='user'),
                          (select id from t where name='si'), 10, 0, null,
                          array['completed']);

  /* Die Historienansicht umgeht die gemeinsame Basis — Standort,
     Freigabe und Kanal gelten dabei weiter. */
  assert jsonb_array_length(v -> 'items') = 1, '8: die erledigte Empfehlung';
  assert v -> 'items' -> 0 ->> 'title' = 'Erledigt', '8: und zwar die richtige';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Der kompatible Wrapper
   ═══════════════════════════════════════════════════════ */
do $$
begin
  /* event_ist_offen bleibt, mit unveraenderter Signatur. */
  assert public.event_ist_offen('new', true, null, null),
    '9: offen und im Dashboard';
  assert not public.event_ist_offen('new', false, null, null),
    '9: nicht im Dashboard';
  assert not public.event_ist_offen('completed', true, null, null),
    '9: erledigt';

  /* Der neue Helfer kennt keinen Kanal. */
  assert public.event_ist_fachlich_offen('new', null, null),
    '9: fachlich offen';
  assert not public.event_ist_fachlich_offen('new', now() + interval '1 day', null),
    '9: pausiert';
  assert not public.event_ist_fachlich_offen('new', null, now() - interval '1 hour'),
    '9: abgelaufen';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Die Sortierung steht in events_feed ZWEIMAL
   ═══════════════════════════════════════════════════════

   Einmal in der Seitenauswahl (welche Zeilen kommen auf die Seite)
   und einmal in der Aggregation (in welcher Reihenfolge sie
   erscheinen).

   Nur die zweite bestimmt die Ausgabe, wenn alles auf eine Seite
   passt. Die erste faellt erst bei Pagination auf — und dann als
   fehlende oder doppelte Empfehlung.

   Dieser Test prueft die erste. */
do $$
declare v_s1 text; v_s2 text; v_alle text;
begin
  select string_agg(x ->> 'id', '|' order by ord) into v_s1
    from jsonb_array_elements(
      public.events_feed((select id from t where name='user'),
                         (select id from t where name='si'), 3, 0) -> 'items'
    ) with ordinality q(x, ord);

  select string_agg(x ->> 'id', '|' order by ord) into v_s2
    from jsonb_array_elements(
      public.events_feed((select id from t where name='user'),
                         (select id from t where name='si'), 3, 3) -> 'items'
    ) with ordinality q(x, ord);

  select string_agg(x ->> 'id', '|' order by ord) into v_alle
    from jsonb_array_elements(
      public.events_feed((select id from t where name='user'),
                         (select id from t where name='si'), 6, 0) -> 'items'
    ) with ordinality q(x, ord);

  /* Zwei Seiten zu drei muessen dieselbe Folge ergeben wie eine
     Seite zu sechs. Sortieren Seitenauswahl und Aggregation
     unterschiedlich, stimmt das nicht mehr. */
  assert v_s1 || '|' || v_s2 = v_alle,
    format('10: Pagination weicht ab.%s  Seiten: %s%s  Gesamt:  %s',
           E'\n', v_s1 || '|' || v_s2, E'\n', v_alle);
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
