-- Abnahme fuer sync_events mit Standortbezug (Paket D2, Schreibseite).
--
--   psql -f syncEventsLocation.test.sql
--
-- Setzt 20260930160000 und 20261001100000 voraus.

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

/* Hilfsmittel: eine Empfehlung im Engine-Format. */
create or replace function pg_temp.empfehlung(p_type text, p_minuten int default 5)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'type', p_type, 'category', 'profile', 'priority', 40,
    'title', 'Titel ' || p_type, 'summary', 'Zusammenfassung',
    'recommendedAction', 'Tun', 'actionUrl', '/dashboard',
    'estimatedEffort', p_minuten || ' Minuten',
    'estimatedMinutes', p_minuten,
    'ruleId', p_type, 'subjectId', null);
$$;

/* ═══════════════════════════════════════════════════════
   1 — location_id wird geschrieben
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('profile.photos_missing', 5)),
    'test-1',
    (select id from t where name='si'));

  assert (v ->> 'created')::int = 1, 'Eine Empfehlung angelegt';
  assert v ->> 'scope' = 'location', 'Umfang: Betrieb';

  assert (select location_id from public.events where type = 'profile.photos_missing')
       = (select id from t where name='si'),
    'Die Empfehlung traegt den Betrieb — vorher blieb location_id null';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — estimated_minutes als Zahl
   ═══════════════════════════════════════════════════════ */
do $$
begin
  assert (select estimated_minutes from public.events where type = 'profile.photos_missing') = 5,
    'Der Aufwand liegt als Zahl vor — kein Regex auf "5 Minuten" fuers Wochenbudget';
  assert (select estimated_effort from public.events where type = 'profile.photos_missing') = '5 Minuten',
    'Der Text bleibt fuer die Anzeige erhalten';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Dieselbe Regel bei zwei Betrieben
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('profile.photos_missing', 5)),
    'test-1',
    (select id from t where name='werkruf'));

  assert (v ->> 'created')::int = 1,
    'Dieselbe Regel entsteht beim zweiten Betrieb NEU, nicht als Aktualisierung';

  assert (select count(*) from public.events
           where type = 'profile.photos_missing' and lifecycle = 'new') = 2,
    'Beide Betriebe haben ihre eigene Empfehlung';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Zweiter Lauf aktualisiert, legt nicht neu an
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('profile.photos_missing', 8)),
    'test-1',
    (select id from t where name='si'));

  assert (v ->> 'created')::int = 0, 'Nichts Neues';
  assert (v ->> 'updated')::int = 1, 'Sondern aktualisiert';

  /* Genau das ging vorher nicht: Ohne eindeutige Zuordnung legte jeder
     Lauf eine neue Zeile an — 21 Stueck in zwei Tagen. */
  assert (select count(*) from public.events
           where type = 'profile.photos_missing'
             and location_id = (select id from t where name='si')) = 1,
    'Weiterhin genau eine Zeile je Betrieb';

  assert (select estimated_minutes from public.events
           where type = 'profile.photos_missing'
             and location_id = (select id from t where name='si')) = 8,
    'Mit aktualisiertem Aufwand';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Auswertung eines Betriebs loest den anderen NICHT auf
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* S&I liefert nur noch eine andere Regel. */
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('reviews.unanswered', 3)),
    'test-1',
    (select id from t where name='si'));

  assert (v ->> 'resolved')::int = 1, 'Die alte S&I-Empfehlung wird aufgeloest';

  assert (select lifecycle from public.events
           where type = 'profile.photos_missing'
             and location_id = (select id from t where name='werkruf')) = 'new',
    'Die WERKRUF-Empfehlung bleibt offen — sie wurde nicht ausgewertet';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Konto und Betrieb sind getrennte Umfaenge
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('connection.lost', 2)),
    'test-1',
    null);

  assert (v ->> 'scope') = 'account', 'Umfang: Konto';
  assert (select location_id from public.events where type = 'connection.lost') is null,
    'Eine Verbindungsempfehlung gehoert zum Konto, nicht zu einem Betrieb';

  /* Die Betriebsempfehlungen bleiben unberuehrt. */
  assert (select lifecycle from public.events
           where type = 'profile.photos_missing'
             and location_id = (select id from t where name='werkruf')) = 'new',
    'Die Kontoauswertung laesst Betriebsempfehlungen stehen';

  /* Und umgekehrt. */
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('reviews.unanswered', 3)),
    'test-1',
    (select id from t where name='si'));

  assert (select lifecycle from public.events where type = 'connection.lost') = 'new',
    'Die Betriebsauswertung laesst Konto-Empfehlungen stehen';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Die alte Signatur bedeutet Konto
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'),
    jsonb_build_array(pg_temp.empfehlung('connection.lost', 2)),
    'test-1');

  assert v ->> 'scope' = 'account',
    'Die dreistellige Fassung wertet den Kontoumfang aus — nicht "alle"';
  assert (v ->> 'created')::int = 0 and (v ->> 'updated')::int = 1,
    'Und trifft dieselbe Zeile wie der ausdrueckliche Kontoaufruf';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Fremder Standort wird abgewiesen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    perform public.sync_events(
      (select id from t where name='fremder'),
      jsonb_build_array(pg_temp.empfehlung('profile.photos_missing', 5)),
      'test-1',
      (select id from t where name='si'));
  exception when insufficient_privilege then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    'Ein fremder Nutzer kann keine Empfehlung an einen fremden Betrieb schreiben';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Leere Liste loest alles im Umfang auf
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.sync_events(
    (select id from t where name='user'), '[]'::jsonb, 'test-1',
    (select id from t where name='werkruf'));

  assert (v ->> 'resolved')::int >= 1, 'Ohne Befund wird aufgeloest';
  assert (select lifecycle from public.events
           where type = 'profile.photos_missing'
             and location_id = (select id from t where name='werkruf')) = 'resolved',
    'Die WERKRUF-Empfehlung ist jetzt erledigt';

  assert (select lifecycle from public.events where type = 'connection.lost') = 'new',
    'Das Konto bleibt davon unberuehrt';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
