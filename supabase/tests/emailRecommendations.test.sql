-- Abnahme fuer die Empfehlungen der Wochenmail (Paket D4, Korrektur).
--
--   psql -f emailRecommendations.test.sql
--
-- Setzt 20261005160000 voraus.

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

/* Die Lage vom 05.10.: beide Betriebe haben dieselbe Foto-Empfehlung. */
insert into public.events
  (user_id, location_id, type, category, priority, title, summary,
   estimated_effort, estimated_minutes, action_url, in_weekly_email)
values
  ((select id from t where name='si'), (select id from t where name='si'),
   'profile.photos_missing', 'profile', 29, 'S&I Fotos', 'Keine Fotos hinterlegt.',
   '5 Minuten', 5, '/dashboard/fotos', true),
  ((select id from t where name='user'), (select id from t where name='werkruf'),
   'profile.photos_missing', 'profile', 29, 'WERKRUF Fotos', 'Keine Fotos hinterlegt.',
   '5 Minuten', 5, '/dashboard/fotos', true);

update public.events set user_id = (select id from t where name='user')
 where title = 'S&I Fotos';

/* ═══════════════════════════════════════════════════════
   1 — Nur ein Betrieb in der Mail
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  /* Die Mail vom 05.10. enthielt ZWEI Eintraege "5 Fotos hochladen" —
     einen je Betrieb. Der Kunde konnte nicht erkennen, welcher
     gemeint war. */
  assert jsonb_array_length(v) = 1, 'Genau eine Aufgabe, nicht zwei';
  assert v -> 0 ->> 'title' = 'S&I Fotos', 'Die des ausgewaehlten Betriebs';
  assert v::text not like '%WERKRUF Fotos%', 'Nie die des anderen';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Der Aufwand kommt aus der Zahl
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Ein Text, aus dem der Regex etwas Falsches zieht. */
  update public.events
     set estimated_effort = 'unter 1 Stunde', estimated_minutes = 45
   where title = 'S&I Fotos';

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  assert (v -> 0 ->> 'minutes')::int = 45,
    'Der Aufwand kommt aus estimated_minutes — der Regex zoege aus "unter 1 Stunde" die 1';

  update public.events
     set estimated_effort = '5 Minuten', estimated_minutes = 5
   where title = 'S&I Fotos';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Rueckfall fuer Altbestand
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Events von vor Paket D2 haben keine Zahl. */
  update public.events set estimated_minutes = null where title = 'S&I Fotos';

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  assert (v -> 0 ->> 'minutes')::int = 5,
    'Ohne Zahl greift der Regex als Rueckfall';

  update public.events set estimated_minutes = 5 where title = 'S&I Fotos';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Konto-Ereignisse erscheinen mit
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email)
  values ((select id from t where name='user'), null,
          'connection.lost', 'connection', 95, 'Verbindung erneuern', 'x', 2, true);

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  /* Eine verlorene Verbindung betrifft jeden Betrieb. */
  assert jsonb_array_length(v) = 2, 'Betrieb plus Konto';
  assert v -> 0 ->> 'scope' = 'account', 'Das Konto zuerst — hoechste Prioritaet';
  assert v -> 1 ->> 'scope' = 'location', 'Darunter der Betrieb';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Ohne Auswahl nur Konto-Ereignisse
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set selected_at = null
   where user_id = (select id from t where name='user');

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  /* Keine gemischten Aufgaben. Der Kunde wuesste nicht, welcher
     Betrieb gemeint ist. */
  assert jsonb_array_length(v) = 1, 'Nur das Konto-Ereignis';
  assert v -> 0 ->> 'scope' = 'account', 'Und zwar das Konto';
  assert v::text not like '%Fotos%', 'Keine Betriebsaufgaben';

  update public.google_locations set selected_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Pausiertes und Abgelaufenes erscheint nicht
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_vorher integer;
begin
  v := public.top_recommendations_for_email((select id from t where name='user'), 10);
  v_vorher := jsonb_array_length(v);

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, cooldown_until)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'x.pause', 'profile', 99, 'In Pause', 'x', 1, true, now() + interval '7 days');

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, expires_at)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'x.alt', 'profile', 99, 'Abgelaufen', 'x', 1, true, now() - interval '1 day');

  v := public.top_recommendations_for_email((select id from t where name='user'), 10);

  assert jsonb_array_length(v) = v_vorher,
    'In der Mail so wenig wie im Dashboard';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Probebetrieb bleibt ausgeschlossen
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_vorher integer;
begin
  v := public.top_recommendations_for_email((select id from t where name='user'), 10);
  v_vorher := jsonb_array_length(v);

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, rule_status)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'x.probe', 'profile', 99, 'Probebetrieb', 'x', 1, true, 'candidate');

  v := public.top_recommendations_for_email((select id from t where name='user'), 10);

  assert jsonb_array_length(v) = v_vorher,
    'rule_status = candidate bleibt ausgeschlossen — das war schon so';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Dashboard und Mail zeigen dasselbe
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash jsonb; v_mail jsonb;
begin
  /* Die Probebetrieb-Zeile aus Test 7 vorher entfernen.

     Sie deckt eine echte Abweichung auf: events_feed filtert
     rule_status = 'candidate' NICHT, top_recommendations_for_email
     schon. Eine Regel im Probebetrieb erscheint also im Dashboard,
     aber nicht in der Mail.

     Das ist moeglicherweise gewollt — eine neue Regel erst im
     Dashboard zeigen, bevor sie an Kunden geht. Entschieden habe ich
     das nicht; der Filter in events_feed fehlt, seit ich sie in
     Paket D2 gebaut habe — und seit 20261005180000 behoben ist.
     Das delete bleibt, damit der Test unabhaengig von der
     Reihenfolge laeuft. */
  delete from public.events where rule_status = 'candidate';

  v_dash := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'), 3) -> 'items';
  v_mail := public.top_recommendations_for_email((select id from t where name='user'), 3);

  assert v_dash -> 0 ->> 'id' = v_mail -> 0 ->> 'id',
    'Dieselbe Empfehlung an erster Stelle';
  assert v_dash -> 0 ->> 'title' = v_mail -> 0 ->> 'title', 'Derselbe Titel';
end $$;

/* ═══════════════════════════════════════════════════════
   8b — Probebetrieb erreicht beide Kanaele nicht
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash jsonb; v_mail jsonb;
begin
  /* Diese Zusicherung stand bis zum 05.10. umgekehrt: Das Dashboard
     ZEIGTE Regeln im Probebetrieb, die Mail nicht. Die Abweichung
     stammte aus Paket D2, wo events_feed ohne rule_status-Filter
     entstand.

     Seit 20261005180000 gilt dieselbe Freigabe fuer beide Kanaele. */
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, in_dashboard, rule_status)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'x.probe2', 'profile', 99, 'Probebetrieb', 'x', 1, true, true, 'candidate');

  v_dash := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'), 5) -> 'items';
  v_mail := public.top_recommendations_for_email((select id from t where name='user'), 5);

  assert v_dash::text not like '%Probebetrieb%',
    'Das Dashboard zeigt den Probebetrieb nicht mehr';
  assert v_mail::text not like '%Probebetrieb%',
    'Die Mail auch nicht — dieselbe Freigabe fuer beide';

  delete from public.events where rule_status = 'candidate';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
