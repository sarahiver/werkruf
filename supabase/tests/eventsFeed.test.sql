-- Abnahme fuer den Empfehlungs-Feed (Paket D2, Leseseite).
--
--   psql -f eventsFeed.test.sql
--
-- Setzt 20260930120000 bis 20261001080000 voraus.

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('fremder', '22222222-2222-2222-2222-222222222222'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into public.google_locations (id, user_id, title, selected_at) values
  ((select id from t where name='si'),      (select id from t where name='user'), 'S&I.',    now()),
  ((select id from t where name='werkruf'), (select id from t where name='user'), 'WERKRUF', null);

/* ═══════════════════════════════════════════════════════
   1 — Nur Empfehlungen des eigenen Betriebs
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_wr jsonb;
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'reviews.unanswered', 'reviews', 80, 'Bewertung beantworten', 'S&I'),
    ((select id from t where name='user'), (select id from t where name='werkruf'),
     'photos.missing', 'profile', 30, 'Foto hochladen', 'WERKRUF');

  v_si := public.events_feed((select id from t where name='user'), (select id from t where name='si'));
  v_wr := public.events_feed((select id from t where name='user'), (select id from t where name='werkruf'));

  assert jsonb_array_length(v_si -> 'items') = 1, 'S&I sieht eine Empfehlung';
  assert v_si -> 'items' -> 0 ->> 'summary' = 'S&I', 'Und zwar die eigene';
  assert jsonb_array_length(v_wr -> 'items') = 1, 'WERKRUF ebenso';
  assert v_wr -> 'items' -> 0 ->> 'summary' = 'WERKRUF', 'Und zwar die eigene';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Konto-Empfehlungen erscheinen bei jedem Betrieb
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si jsonb; v_ohne jsonb;
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values ((select id from t where name='user'), null,
          'connection.reauth', 'connection', 95, 'Verbindung erneuern', 'Konto');

  v_si := public.events_feed((select id from t where name='user'), (select id from t where name='si'));

  /* Ein Verbindungsproblem betrifft jeden Betrieb — wuerde es nur
     unter "Konto" erscheinen, saehe es niemand. */
  assert jsonb_array_length(v_si -> 'items') = 2, 'Betrieb plus Konto';
  assert v_si -> 'items' -> 0 ->> 'scope' = 'account',
    'Die Konto-Empfehlung steht oben — hoechste Prioritaet';
  assert v_si -> 'items' -> 1 ->> 'scope' = 'location', 'Darunter die des Betriebs';

  /* Wer sie nicht will, kann sie abwaehlen. */
  v_ohne := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'),
    10, 0, null, null, false);
  assert jsonb_array_length(v_ohne -> 'items') = 1, 'Ohne includeAccount nur der Betrieb';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Sortierung: Prioritaet, dann Alter
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_alt integer; v_neu integer;
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary, created_at)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'a.neu', 'profile', 50, 'Mittlere, neu', 'x', now()),
    ((select id from t where name='user'), (select id from t where name='si'),
     'a.alt', 'profile', 50, 'Mittlere, alt', 'x', now() - interval '5 days');

  v := public.events_feed((select id from t where name='user'), (select id from t where name='si'));

  /* Nach Position suchen, nicht nach festem Index: Frueherere Tests
     haben bereits Empfehlungen angelegt, die die Indizes verschieben. */
  select ord into v_alt from jsonb_array_elements(v -> 'items')
    with ordinality q(x, ord) where x ->> 'title' = 'Mittlere, alt';
  select ord into v_neu from jsonb_array_elements(v -> 'items')
    with ordinality q(x, ord) where x ->> 'title' = 'Mittlere, neu';

  /* Bei gleicher Prioritaet zuerst das Aeltere — es wartet laenger. */
  assert v_alt < v_neu, 'Bei Gleichstand steht das Aeltere vorn';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Pagination bleibt stabil
   ═══════════════════════════════════════════════════════ */
do $$
declare v_s1 jsonb; v_s2 jsonb; v_alle text[]; v_eindeutig integer;
begin
  /* Zwoelf Empfehlungen mit IDENTISCHER Prioritaet und identischem
     Zeitstempel — genau der Fall, in dem eine Sortierung ohne dritte
     Spalte Dubletten oder Luecken erzeugt. */
  insert into public.events (user_id, location_id, type, category, priority, title, summary, created_at)
  select (select id from t where name='user'), (select id from t where name='werkruf'),
         'gleich.' || g, 'profile', 40, 'Gleich ' || g, 'x',
         '2026-10-01 10:00:00+00'::timestamptz
  from generate_series(1, 12) g;

  v_s1 := public.events_feed((select id from t where name='user'),
                             (select id from t where name='werkruf'), 5, 0, null, null, false);
  v_s2 := public.events_feed((select id from t where name='user'),
                             (select id from t where name='werkruf'), 5, 5, null, null, false);

  assert jsonb_array_length(v_s1 -> 'items') = 5, 'Seite 1: fuenf';
  assert jsonb_array_length(v_s2 -> 'items') = 5, 'Seite 2: fuenf';

  select array_agg(x) into v_alle from (
    select jsonb_array_elements(v_s1 -> 'items') ->> 'id' as x
    union all
    select jsonb_array_elements(v_s2 -> 'items') ->> 'id'
  ) q;

  select count(distinct x) into v_eindeutig from unnest(v_alle) x;

  /* Ohne "id asc" als drittes Kriterium koennte dieselbe Empfehlung
     auf beiden Seiten stehen. */
  assert v_eindeutig = 10, 'Keine Empfehlung erscheint auf zwei Seiten';

  assert (v_s1 ->> 'hasMore')::boolean = true,  'Seite 1 meldet: es gibt mehr';
  assert (v_s2 ->> 'hasMore')::boolean = true,  'Seite 2 auch — 13 insgesamt';
  assert (v_s1 -> 'total')::int = (v_s2 -> 'total')::int,
    'Die Gesamtzahl ist auf beiden Seiten dieselbe';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Was NICHT erscheint
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_vorher integer;
begin
  v := public.events_feed((select id from t where name='user'), (select id from t where name='si'));
  v_vorher := jsonb_array_length(v -> 'items');

  insert into public.events (user_id, location_id, type, category, priority, title, summary,
                             lifecycle, cooldown_until, expires_at, in_dashboard)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.erledigt', 'profile', 99, 'Erledigt', 'x', 'completed', null, null, true),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.weggeklickt', 'profile', 99, 'Weggeklickt', 'x', 'dismissed', null, null, true),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.pause', 'profile', 99, 'In Pause', 'x', 'new', now() + interval '7 days', null, true),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.abgelaufen', 'profile', 99, 'Abgelaufen', 'x', 'new', null, now() - interval '1 day', true),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.nurmail', 'profile', 99, 'Nur Mail', 'x', 'new', null, null, false);

  v := public.events_feed((select id from t where name='user'), (select id from t where name='si'));

  assert jsonb_array_length(v -> 'items') = v_vorher,
    'Erledigte, weggeklickte, pausierte, abgelaufene und Nur-Mail-Empfehlungen erscheinen nicht';

  /* Mit ausdruecklichem Filter schon — fuer eine Historienansicht. */
  v := public.events_feed((select id from t where name='user'), (select id from t where name='si'),
                          10, 0, null, array['completed'], false);
  assert jsonb_array_length(v -> 'items') = 1, 'Mit lifecycle-Filter sind sie erreichbar';
  assert v -> 'items' -> 0 ->> 'title' = 'Erledigt', 'Und zwar die richtige';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Kategoriefilter
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.events_feed((select id from t where name='user'), (select id from t where name='si'),
                          10, 0, 'reviews', null, false);

  assert jsonb_array_length(v -> 'items') = 1, 'Nur Bewertungen';
  assert v -> 'items' -> 0 ->> 'category' = 'reviews', 'Und zwar die richtige Kategorie';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Mandantentrennung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.events_feed((select id from t where name='fremder'), (select id from t where name='si'));

  assert jsonb_array_length(v -> 'items') = 0, 'Ein fremder Nutzer sieht nichts';
  assert v ->> 'error' = 'standort_nicht_gefunden', 'Mit erkennbarem Grund';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Gesehen markieren
   ═══════════════════════════════════════════════════════ */
do $$
declare v_ids uuid[]; v_anzahl integer;
begin
  select array_agg(id) into v_ids from public.events
   where location_id = (select id from t where name='si') and lifecycle = 'new';

  v_anzahl := public.events_mark_seen((select id from t where name='user'), v_ids);
  assert v_anzahl > 0, 'Offene werden markiert';

  assert (select count(*) from public.events
           where id = any(v_ids) and lifecycle = 'seen') = v_anzahl,
    'Und stehen danach auf seen';

  /* Ein zweiter Aufruf aendert nichts — new → seen gilt nur einmal. */
  assert public.events_mark_seen((select id from t where name='user'), v_ids) = 0,
    'Ein zweiter Aufruf dreht keinen Zustand zurueck';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Fremde Empfehlungen lassen sich nicht markieren
   ═══════════════════════════════════════════════════════ */
do $$
declare v_id uuid;
begin
  select id into v_id from public.events
   where location_id = (select id from t where name='werkruf') and lifecycle = 'new' limit 1;

  /* Die ID allein reicht nicht — events_mark_seen prueft user_id. */
  assert public.events_mark_seen((select id from t where name='fremder'), array[v_id]) = 0,
    'Ein fremder Nutzer kann nichts markieren, auch mit gueltiger ID';

  assert (select lifecycle from public.events where id = v_id) = 'new',
    'Der Zustand bleibt unveraendert';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Das DTO ist vollstaendig
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; e jsonb;
begin
  v := public.events_feed((select id from t where name='user'), (select id from t where name='si'));
  e := v -> 'items' -> 0;

  /* Jedes Feld einzeln — so nennt die Fehlermeldung das fehlende. */
  assert e ? 'id',                'id';
  assert e ? 'type',              'type';
  assert e ? 'category',          'category';
  assert e ? 'priority',          'priority';
  assert e ? 'title',             'title';
  assert e ? 'summary',           'summary';
  assert e ? 'recommendedAction', 'recommendedAction';
  assert e ? 'actionUrl',         'actionUrl';
  assert e ? 'estimatedMinutes',  'estimatedMinutes';
  assert e ? 'lifecycle',         'lifecycle';
  assert e ? 'locationId',        'locationId';
  assert e ? 'scope',             'scope';
  assert e ? 'isDismissable',     'isDismissable';

  /* Interna gehoeren nicht in die Antwort. */
  assert not (e ? 'user_id'),   'Keine user_id im DTO';
  assert not (e ? 'delivered'), 'Kein Zustellprotokoll im DTO';
  assert not (e ? 'confidence'), 'Keine internen Kennzahlen im DTO';

  /* Die Zaehler sind da. */
  assert v ? 'total',  'total';
  assert v ? 'open',   'open';
  assert v ? 'hasMore','hasMore';
end $$;

/* ═══════════════════════════════════════════════════════
   11 — Obergrenze fuer limit
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.events_feed((select id from t where name='user'),
                          (select id from t where name='werkruf'), 9999, 0, null, null, false);
  assert (v ->> 'limit')::int = 50, 'limit wird auf 50 gedeckelt';

  v := public.events_feed((select id from t where name='user'),
                          (select id from t where name='werkruf'), -5, -3, null, null, false);
  assert (v ->> 'limit')::int = 1,  'Negatives limit wird auf 1 gehoben';
  assert (v ->> 'offset')::int = 0, 'Negatives offset auf 0';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
