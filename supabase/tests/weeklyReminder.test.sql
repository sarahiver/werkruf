-- Abnahme fuer Erinnerungen und Rotation (Paket F1b).
--
--   psql -v ON_ERROR_STOP=1 -f weeklyReminder.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into auth.users (id, email)
values ((select id from t where name='user'), 'iver@example.com')
on conflict (id) do nothing;

insert into public.user_profiles (id, company_name, industry_key)
values ((select id from t where name='user'), 'Firma Rolf Müller', 'handwerk')
on conflict (id) do update set company_name = excluded.company_name;

insert into public.google_accounts (id, user_id, status)
values (gen_random_uuid(), (select id from t where name='user'), 'active');

insert into public.notification_preferences (user_id)
values ((select id from t where name='user')) on conflict do nothing;

insert into public.google_locations (id, user_id, title, selected_at) values
  ((select id from t where name='si'),      (select id from t where name='user'), 'S&I.',    now()),
  ((select id from t where name='werkruf'), (select id from t where name='user'), 'WERKRUF', null);

/* Hilfsmittel: die Titel der Wochenauswahl. */
create or replace function pg_temp.auswahl(p_user uuid)
returns text language sql as $$
  select string_agg(x ->> 'title', ' | ' order by ord)
  from jsonb_array_elements(public.top_recommendations_for_email(p_user, 3))
       with ordinality q(x, ord);
$$;

/* Die Lage von S&I nach F1a: zwei Wachstumsaufgaben. */
insert into public.events
  (id, user_id, location_id, type, category, priority, title, summary,
   estimated_minutes, in_dashboard, in_weekly_email, recommendation_class,
   created_at, subject_type, subject_id)
values
  ('f1b00000-0000-0000-0000-00000000000a',
   (select id from t where name='user'), (select id from t where name='si'),
   'profile.photos_missing', 'profile', 60, '5 Fotos hochladen', 'x',
   5, true, true, 'growth', now() - interval '2 days',
   'review', 'f1b0ffff-0000-0000-0000-00000000000a'),
  ('f1b00000-0000-0000-0000-00000000000b',
   (select id from t where name='user'), (select id from t where name='si'),
   'reviews.none_yet', 'reviews', 65, 'Erste Bewertungen einsammeln', 'x',
   3, true, true, 'growth', now() - interval '1 day',
   'review', 'f1b0ffff-0000-0000-0000-00000000000b');

/* ═══════════════════════════════════════════════════════
   1 — Erstversand: beide sind faellig
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  /* Noch nie gezeigt heisst sofort faellig. */
  v := pg_temp.auswahl((select id from t where name='user'));

  assert v like '%5 Fotos%',        '1: Fotos dabei';
  assert v like '%Erste Bewertungen%','1: Bewertungen dabei';

  /* Beide in Stufe 3, Fotos aelter — also zuerst. */
  assert v like '5 Fotos%', format('1: Fotos zuerst (ist: %s)', v);
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Nur Versendetes wird fortgeschrieben
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  /* Die Mail enthielt nur die Fotos. */
  v_anzahl := public.weekly_mark_sent(jsonb_build_object(
    'actions', jsonb_build_array(
      jsonb_build_object('id', 'f1b00000-0000-0000-0000-00000000000a'))));

  assert v_anzahl = 1, '2: eine Aufgabe fortgeschrieben';

  assert (select weekly_reminder_count from public.events
           where id = 'f1b00000-0000-0000-0000-00000000000a') = 1,
    '2: Fotos gezaehlt';

  /* Die zweite stand nicht in der Mail und gilt weiter als nie
     gezeigt. */
  assert (select weekly_reminder_count from public.events
           where id = 'f1b00000-0000-0000-0000-00000000000b') = 0,
    '2: Bewertungen unberuehrt';
  assert (select weekly_last_sent_at from public.events
           where id = 'f1b00000-0000-0000-0000-00000000000b') is null,
    '2: und ohne Zeitpunkt';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Die naechste Woche: Rotation
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  v := pg_temp.auswahl((select id from t where name='user'));

  /* Die Fotos sind erst in sieben Tagen wieder faellig. Uebrig bleibt
     die nie gezeigte Aufgabe — genau die Rotation, um die es geht. */
  assert v = 'Erste Bewertungen einsammeln',
    format('3: nur die nie gezeigte (ist: %s)', v);
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Zu frueh: die Faelligkeit blockiert
   ═══════════════════════════════════════════════════════ */
do $$
declare v_faellig boolean;
begin
  v_faellig := public.weekly_event_is_due(
    (select weekly_next_due_at from public.events
      where id = 'f1b00000-0000-0000-0000-00000000000a'),
    1::smallint);

  assert not v_faellig, '4: nach einem Tag noch nicht wieder faellig';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Nach sieben Tagen wieder
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  update public.events
     set weekly_last_sent_at = now() - interval '8 days',
         weekly_next_due_at  = now() - interval '1 day'
   where id = 'f1b00000-0000-0000-0000-00000000000a';

  v := pg_temp.auswahl((select id from t where name='user'));

  assert v like '%5 Fotos%', '5: die Fotos sind wieder faellig';

  /* Die nie gezeigte kommt trotzdem zuerst — gleiche Stufe. */
  assert v like 'Erste Bewertungen%',
    format('5: nie gezeigt zuerst (ist: %s)', v);
end $$;

/* ═══════════════════════════════════════════════════════
   5b — Die Stufengrenze
   ═══════════════════════════════════════════════════════ */
do $$
begin
  /*
   * Rotation gilt INNERHALB einer Stufe, nicht darueber hinweg.
   *
   * Das hat eine Kante: 59 und 60 liegen einen Punkt auseinander und
   * in verschiedenen Stufen. Eine nie gezeigte Aufgabe mit 59
   * verliert gegen eine kuerzlich gezeigte mit 60.
   *
   * Jede Einteilung hat solche Kanten — auch ein Abstandsmass wie
   * "hoechstens 10 Punkte" haette eine bei elf. Die Stufen haben den
   * Vorteil, dass sie denen entsprechen, die das Dashboard anzeigt:
   * Was dort gleich aussieht, rotiert auch gleich.
   *
   * Wer eine neue Regel knapp unter eine Grenze legt, sollte das
   * wissen.
   */
  assert public.priority_stufe(60::smallint) = 3, '5b: 60 ist wichtig';
  assert public.priority_stufe(59::smallint) = 2, '5b: 59 ist hilfreich';
  assert public.priority_stufe(80::smallint) = 4, '5b: 80 ist kritisch';
  assert public.priority_stufe(39::smallint) = 1, '5b: 39 ist wenn du Zeit hast';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Die Staffelung
   ═══════════════════════════════════════════════════════ */
do $$
declare v_1 timestamptz; v_2 timestamptz; v_3 timestamptz; v_jetzt timestamptz := now();
begin
  v_1 := public.weekly_next_due_at('growth', 60::smallint, 1::smallint, v_jetzt);
  v_2 := public.weekly_next_due_at('growth', 60::smallint, 2::smallint, v_jetzt);
  v_3 := public.weekly_next_due_at('growth', 60::smallint, 3::smallint, v_jetzt);

  /* Tag 0, 7, 21, 51 — die Abstaende werden laenger, weil eine
     dreimal ignorierte Aufgabe beim vierten Mal nicht dringender
     geworden ist. */
  assert v_1 = v_jetzt + interval '7 days',  '6: erste Erinnerung nach 7 Tagen';
  assert v_2 = v_jetzt + interval '14 days', '6: zweite nach 14';
  assert v_3 = v_jetzt + interval '30 days', '6: danach alle 30';

  /* Noch nie gezeigt: sofort. */
  assert public.weekly_next_due_at('growth', 60::smallint, 0::smallint, v_jetzt) is null,
    '6: nie gezeigt heisst sofort';

  /* Sehr niedrige Prioritaet: lange Ruhe. */
  assert public.weekly_next_due_at('growth', 29::smallint, 1::smallint, v_jetzt)
       = v_jetzt + interval '60 days',
    '6: "wenn du Zeit hast" nach 60 Tagen';

  /* Probleme kuerzer. */
  assert public.weekly_next_due_at('problem', 90::smallint, 2::smallint, v_jetzt)
       = v_jetzt + interval '14 days',
    '6: Probleme alle 14 Tage';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Prioritaet schlaegt Rotation
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  /* Ein Problem in hoeherer Stufe, schon gezeigt und wieder faellig. */
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary,
     in_dashboard, in_weekly_email, recommendation_class,
     weekly_reminder_count, weekly_last_sent_at, weekly_next_due_at,
     subject_type, subject_id)
  values ('f1b00000-0000-0000-0000-00000000000c',
          (select id from t where name='user'), (select id from t where name='si'),
          'reply.publish_failed', 'reviews', 85, 'Antwort gescheitert', 'x',
          true, true, 'problem', 1, now() - interval '20 days',
          now() - interval '6 days',
          'review', 'f1b0ffff-0000-0000-0000-00000000000c');

  v := pg_temp.auswahl((select id from t where name='user'));

  /* Stufe 4 schlaegt Stufe 3, auch gegen eine nie gezeigte Aufgabe.
     Rotation gilt innerhalb einer Stufe, nicht darueber hinweg. */
  assert v like 'Antwort gescheitert%',
    format('7: das Problem zuerst (ist: %s)', v);
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Starker Prioritaetsunterschied
   ═══════════════════════════════════════════════════════ */
do $$
declare v text;
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary,
     in_dashboard, in_weekly_email, recommendation_class,
     subject_type, subject_id)
  values ('f1b00000-0000-0000-0000-00000000000d',
          (select id from t where name='user'), (select id from t where name='si'),
          'x.klein', 'profile', 25, 'Kleinigkeit', 'x',
          true, true, 'growth',
          'review', 'f1b0ffff-0000-0000-0000-00000000000d');

  v := pg_temp.auswahl((select id from t where name='user'));

  /* Nie gezeigt, aber Stufe 1 — kommt zuletzt oder gar nicht in die
     Top drei. Rotation darf Prioritaet nicht zerstoeren. */
  assert v not like 'Kleinigkeit%', '8: die Kleinigkeit nicht zuerst';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Das Dashboard sieht die Faelligkeit nicht
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Die Fotos sind in der Mail gerade nicht faellig. */
  update public.events
     set weekly_reminder_count = 1,
         weekly_last_sent_at = now(),
         weekly_next_due_at = now() + interval '7 days'
   where id = 'f1b00000-0000-0000-0000-00000000000a';

  v := public.events_feed((select id from t where name='user'),
                          (select id from t where name='si'), 50) -> 'items';

  /* Eine offene Aufgabe bleibt im Dashboard sichtbar, auch wenn die
     Mail sie diese Woche nicht zeigt. */
  assert v::text like '%5 Fotos%',
    '9: im Dashboard weiterhin sichtbar';

  assert pg_temp.auswahl((select id from t where name='user')) not like '%5 Fotos%',
    '9: in der Mail nicht';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Die drei Zustaende
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* action_due: offen und faellig. */
  v := public.weekly_counts((select id from t where name='user'),
                            (select id from t where name='si'));
  assert (v ->> 'open')::int > 0, '10: offene Aufgaben';
  assert (v ->> 'due')::int > 0,  '10: und faellige';

  /* quiet_week: alles offen, nichts faellig. */
  update public.events
     set weekly_reminder_count = 1,
         weekly_last_sent_at = now(),
         weekly_next_due_at = now() + interval '7 days'
   where user_id = (select id from t where name='user')
     and lifecycle in ('new', 'seen', 'opened');

  v := public.weekly_counts((select id from t where name='user'),
                            (select id from t where name='si'));

  assert (v ->> 'open')::int > 0, '10: weiterhin offen';
  assert (v ->> 'due')::int = 0,  '10: aber nichts faellig';

  /* all_clear: nichts offen. */
  update public.events set lifecycle = 'completed'
   where user_id = (select id from t where name='user');

  v := public.weekly_counts((select id from t where name='user'),
                            (select id from t where name='si'));
  assert (v ->> 'open')::int = 0, '10: nichts mehr offen';
  assert (v ->> 'due')::int = 0,  '10: und nichts faellig';

  update public.events set lifecycle = 'new'
   where user_id = (select id from t where name='user');
end $$;

/* ═══════════════════════════════════════════════════════
   11 — Erledigtes bekommt keinen Zeitpunkt
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  update public.events set lifecycle = 'completed', weekly_reminder_count = 0
   where id = 'f1b00000-0000-0000-0000-00000000000d';

  v_anzahl := public.weekly_mark_sent(jsonb_build_object(
    'actions', jsonb_build_array(
      jsonb_build_object('id', 'f1b00000-0000-0000-0000-00000000000d'))));

  /* Zwischen Queue und Versand kann eine Aufgabe erledigt werden. */
  assert v_anzahl = 0, '11: nichts fortgeschrieben';
  assert (select weekly_reminder_count from public.events
           where id = 'f1b00000-0000-0000-0000-00000000000d') = 0,
    '11: der Zaehler bleibt';

  update public.events set lifecycle = 'new'
   where id = 'f1b00000-0000-0000-0000-00000000000d';
end $$;

/* ═══════════════════════════════════════════════════════
   12 — Multi-Location
   ═══════════════════════════════════════════════════════ */
do $$
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary,
     in_dashboard, in_weekly_email, recommendation_class,
     subject_type, subject_id)
  values ('f1b00000-0000-0000-0000-00000000000e',
          (select id from t where name='user'), (select id from t where name='werkruf'),
          'profile.photos_missing', 'profile', 60, 'WERKRUF Fotos', 'x',
          true, true, 'growth',
          'review', 'f1b0ffff-0000-0000-0000-00000000000e');

  perform public.weekly_mark_sent(jsonb_build_object(
    'actions', jsonb_build_array(
      jsonb_build_object('id', 'f1b00000-0000-0000-0000-00000000000b'))));

  /* Ein S&I-Versand laesst WERKRUF unberuehrt. */
  assert (select weekly_reminder_count from public.events
           where id = 'f1b00000-0000-0000-0000-00000000000e') = 0,
    '12: WERKRUF unberuehrt';
end $$;

/* ═══════════════════════════════════════════════════════
   13 — Hoechstens drei
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  update public.events
     set weekly_reminder_count = 0, weekly_last_sent_at = null,
         weekly_next_due_at = null
   where user_id = (select id from t where name='user');

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     in_dashboard, in_weekly_email, recommendation_class,
     subject_type, subject_id)
  select (select id from t where name='user'), (select id from t where name='si'),
         'viele.' || g, 'profile', 50, 'Viele ' || g, 'x',
         true, true, 'growth',
         'review', ('f1b0eeee-0000-0000-0000-00000000000' || g)::uuid
  from generate_series(1, 5) g;

  select jsonb_array_length(
    public.top_recommendations_for_email((select id from t where name='user'), 20))
    into v_anzahl;

  assert v_anzahl = 3, format('13: hoechstens drei (ist: %s)', v_anzahl);
end $$;

/* ═══════════════════════════════════════════════════════
   14 — Die Sortiermerkmale sind sichtbar
   ═══════════════════════════════════════════════════════ */
do $$
declare x jsonb;
begin
  /* F2 soll die Kandidaten spaeter ranken koennen, ohne sie neu zu
     berechnen. */
  select e into x from jsonb_array_elements(
    public.top_recommendations_for_email((select id from t where name='user'), 3)) e
   limit 1;

  assert x ? 'stufe',                 '14: Prioritaetsstufe';
  assert x ? 'nie_gezeigt',           '14: nie gezeigt';
  assert x ? 'weekly_reminder_count', '14: Zaehler';
  assert x ? 'weekly_next_due_at',    '14: naechste Faelligkeit';
  assert x ? 'ueberfaellig_tage',     '14: Ueberfaelligkeit';
  assert x ? 'recommendation_class',  '14: Klasse';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
