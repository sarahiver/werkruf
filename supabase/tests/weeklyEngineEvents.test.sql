-- Abnahme fuer die Wochenmail aus Engine-Events (Paket D4).
--
--   psql -f weeklyEngineEvents.test.sql

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

/* ═══════════════════════════════════════════════════════
   1 — Nur Aufgaben des eigenen Betriebs
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     in_weekly_email, in_dashboard, estimated_minutes, action_url)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'profile.photos_missing', 'profile', 29, 'Foto hochladen', 'Keine Fotos',
     true, true, 5, '/dashboard/fotos'),
    ((select id from t where name='user'), (select id from t where name='werkruf'),
     'profile.photos_missing', 'profile', 29, 'WERKRUF Foto', 'Keine Fotos',
     true, true, 5, '/dashboard/fotos');

  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));

  assert jsonb_array_length(v) = 1, 'Nur eine Aufgabe';
  assert v -> 0 ->> 'title' = 'Foto hochladen', 'Und zwar die von S&I';

  /* Eine Mail, die Aufgaben beider Betriebe mischt, waere schlechter
     als keine: Der Kunde wuesste nicht, welcher gemeint ist. */
  assert v::text not like '%WERKRUF Foto%', 'Nie die des anderen Betriebs';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Konto-Ereignisse erscheinen mit
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary, in_weekly_email)
  values ((select id from t where name='user'), null,
          'connection.lost', 'connection', 95, 'Verbindung erneuern', 'Token weg', true);

  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));

  assert jsonb_array_length(v) = 2, 'Betrieb plus Konto';
  assert v -> 0 ->> 'scope' = 'account', 'Das Konto zuerst — hoechste Prioritaet';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Nur was fuer die Mail freigegeben ist
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_vorher integer;
begin
  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));
  v_vorher := jsonb_array_length(v);

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     in_weekly_email, in_dashboard)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'nur.dashboard', 'profile', 99, 'Nur im Dashboard', 'x', false, true);

  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));

  assert jsonb_array_length(v) = v_vorher,
    'Eine Dashboard-Empfehlung erscheint nicht ploetzlich per Mail';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Erledigte und weggeklickte erscheinen nicht
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_vorher integer;
begin
  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));
  v_vorher := jsonb_array_length(v);

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     in_weekly_email, lifecycle)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.fertig', 'profile', 99, 'Erledigt', 'x', true, 'completed'),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.weg', 'profile', 99, 'Weggeklickt', 'x', true, 'dismissed');

  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));

  assert jsonb_array_length(v) = v_vorher, 'Beide erscheinen nicht';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Hoechstens drei
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary, in_weekly_email)
  select (select id from t where name='user'), (select id from t where name='si'),
         'viele.' || g, 'profile', 50 + g, 'Aufgabe ' || g, 'x', true
  from generate_series(1, 5) g;

  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'));

  assert jsonb_array_length(v) = 3, 'Hoechstens drei — nicht alles zeigen';

  /* Die Reihenfolge kommt aus der Engine. */
  assert (v -> 0 ->> 'priority')::int >= (v -> 1 ->> 'priority')::int,
    'Absteigend nach Prioritaet';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Aufwand als Zahl
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_foto jsonb;
begin
  v := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'), 20);

  select x into v_foto from jsonb_array_elements(v) x
   where x ->> 'type' = 'profile.photos_missing';

  assert (v_foto ->> 'estimatedMinutes')::int = 5,
    'Der Aufwand liegt strukturiert vor — nicht aus "5 Minuten" geparst';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Payload fuer die Mail
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.weekly_payload_for((select id from t where name='user'));

  assert (v ->> 'skip')::boolean = false, 'Mail wird versendet';
  assert v ->> 'locationTitle' = 'S&I.', 'Der Betrieb wird benannt';
  assert jsonb_array_length(v -> 'engineEvents') = 3, 'Hoechstens drei Aufgaben';
  assert v ? 'healthScore', 'Der kanonische Score ist dabei';
  assert v ? 'scoreVersion', 'Mit seiner Fassung';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Mehrere Betriebe ohne Auswahl: keine Mail
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set selected_at = null
   where user_id = (select id from t where name='user');

  v := public.weekly_payload_for((select id from t where name='user'));

  /* Keine Mail ist besser als eine mit gemischten Empfehlungen: Der
     Kunde wuesste nicht, welcher Betrieb gemeint ist, und wuerde
     womoeglich am falschen arbeiten. */
  assert (v ->> 'skip')::boolean = true, 'Keine Mail';
  assert v ->> 'grund' = 'mehrere_ohne_auswahl', 'Mit erkennbarem Grund';
  assert v -> 'engineEvents' is null, 'Und ohne gemischte Aufgaben';

  update public.google_locations set selected_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Keine Aufgaben ist ein gueltiges Ergebnis
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.events set lifecycle = 'resolved'
   where user_id = (select id from t where name='user');

  v := public.weekly_payload_for((select id from t where name='user'));

  assert (v ->> 'skip')::boolean = false, 'Die Mail geht trotzdem raus';
  assert jsonb_array_length(v -> 'engineEvents') = 0, 'Mit null Aufgaben';
  assert (v ->> 'eventCount')::int = 0, 'Und das ist kein Fehler';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Dashboard und Mail stimmen ueberein
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash jsonb; v_mail jsonb;
begin
  update public.events set lifecycle = 'new'
   where user_id = (select id from t where name='user')
     and type = 'profile.photos_missing'
     and location_id = (select id from t where name='si');

  v_dash := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'), 3) -> 'items';
  v_mail := public.weekly_mail_events(
    (select id from t where name='user'), (select id from t where name='si'), 3);

  /* Dieselbe Empfehlung, derselbe Titel, derselbe Aufwand — nur die
     Darstellung unterscheidet sich. */
  assert v_dash -> 0 ->> 'id' = v_mail -> 0 ->> 'id',
    'Dieselbe Empfehlung an erster Stelle';
  assert v_dash -> 0 ->> 'title' = v_mail -> 0 ->> 'title',
    'Derselbe Titel';
  assert v_dash -> 0 ->> 'estimatedMinutes' = v_mail -> 0 ->> 'estimatedMinutes',
    'Derselbe Aufwand';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
