-- Abnahme fuer den produktiven Kommunikationspfad (Paket D4.6).
--
--   psql -v ON_ERROR_STOP=1 -f communicationPath.test.sql
--
-- Prueft den Weg, den der Cron tatsaechlich geht:
--   comm-weekly → send-email/plan → schedule_communications
--     → plan_communications / top_recommendations_for_email
--     → email_queue

\set ON_ERROR_STOP on

begin;

/*
 * Montag herstellen.
 *
 * plan_communications verschickt die Wochenmail nur montags, und
 * schedule_communications ruft es ohne Zeitpunkt auf. An jedem anderen
 * Tag entstuende keine Queue-Zeile — und Test I uebersprang das still.
 *
 * Diese Huelle ruft den echten Planer mit einem Montagszeitpunkt auf
 * und gilt nur bis zum rollback am Dateiende.
 */
do $$
begin
  execute replace(
    pg_get_functiondef('public.plan_communications(uuid,timestamptz)'::regprocedure),
    'FUNCTION public.plan_communications(', 'FUNCTION public.plan_communications_echt(');
end $$;

create or replace function public.plan_communications(
  p_user_id uuid, p_now timestamptz default now()
)
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select public.plan_communications_echt(
    p_user_id, date_trunc('week', p_now) + interval '7 hours');
$$;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

/* schedule_communications laeuft ueber google_accounts join
   auth.users — ohne beides findet es niemanden, und Test I uebersprang
   still. */
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

/* ═══════════════════════════════════════════════════════
   A — Standorttrennung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_effort, estimated_minutes, action_url, in_weekly_email, in_dashboard)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'profile.photos_missing', 'profile', 29, '5 Fotos hochladen', 'Keine Fotos hinterlegt.',
     '5 Minuten', 5, '/dashboard/fotos', true, true),
    ((select id from t where name='user'), (select id from t where name='werkruf'),
     'profile.photos_missing', 'profile', 29, 'WERKRUF Fotos', 'Keine Fotos hinterlegt.',
     '5 Minuten', 5, '/dashboard/fotos', true, true);

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  assert jsonb_array_length(v) = 1, 'A: genau eine Aufgabe';
  assert v -> 0 ->> 'title' = '5 Fotos hochladen', 'A: die von S&I';
  assert v::text not like '%WERKRUF Fotos%', 'A: nie die des anderen Betriebs';
end $$;

/* ═══════════════════════════════════════════════════════
   B — Konto-Ereignisse bleiben erhalten
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, in_dashboard)
  values ((select id from t where name='user'), null,
          'connection.lost', 'connection', 95, 'Verbindung erneuern', 'x', 2, true, true);

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  assert jsonb_array_length(v) = 2, 'B: Betrieb plus Konto';
  assert v -> 0 ->> 'scope' = 'account', 'B: Konto zuerst';
end $$;

/* ═══════════════════════════════════════════════════════
   C — Aufwand aus estimated_minutes
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; x jsonb;
begin
  update public.events
     set estimated_effort = 'unter 1 Stunde', estimated_minutes = 45
   where title = '5 Fotos hochladen';

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);
  select e into x from jsonb_array_elements(v) e where e ->> 'title' = '5 Fotos hochladen';

  /* Der Regex zoege aus "unter 1 Stunde" die 1. */
  assert (x ->> 'minutes')::int = 45, 'C: 45 Minuten, nicht 1';

  update public.events
     set estimated_effort = '5 Minuten', estimated_minutes = 5
   where title = '5 Fotos hochladen';
end $$;

/* ═══════════════════════════════════════════════════════
   D + E — Probebetrieb erreicht weder Dashboard noch Mail
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash jsonb; v_mail jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, in_dashboard, rule_status)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'x.probe', 'profile', 99, 'Probebetrieb', 'x', 1, true, true, 'candidate');

  v_dash := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'), 10) -> 'items';
  v_mail := public.top_recommendations_for_email((select id from t where name='user'), 3);

  /* Vorher erschien die Regel im Dashboard, aber nicht in der Mail —
     dieselbe Regel, zwei Antworten. */
  assert v_dash::text not like '%Probebetrieb%', 'D: nicht im Dashboard';
  assert v_mail::text not like '%Probebetrieb%', 'E: nicht in der Mail';
end $$;

/* ═══════════════════════════════════════════════════════
   F — Kanalunterschiede bleiben erlaubt
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash jsonb; v_mail jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, in_dashboard)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.nurdash', 'profile', 70, 'Nur Dashboard', 'x', 1, false, true),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.nurmail', 'profile', 71, 'Nur Mail', 'x', 1, true, false);

  v_dash := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'), 10) -> 'items';
  v_mail := public.top_recommendations_for_email((select id from t where name='user'), 10);

  assert v_dash::text like '%Nur Dashboard%', 'F: Dashboard-Event im Dashboard';
  assert v_mail::text not like '%Nur Dashboard%', 'F: nicht in der Mail';
  assert v_mail::text like '%Nur Mail%', 'F: Mail-Event in der Mail';
  assert v_dash::text not like '%Nur Mail%', 'F: nicht im Dashboard';
end $$;

/* ═══════════════════════════════════════════════════════
   G — Erledigtes standortrein
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     lifecycle, completed_at)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.f1', 'profile', 20, 'S&I erledigt', 'x', 'completed', now() - interval '2 days'),
    ((select id from t where name='user'), (select id from t where name='werkruf'),
     'x.f2', 'profile', 20, 'WERKRUF erledigt', 'x', 'completed', now() - interval '2 days');

  v := public.completed_this_week((select id from t where name='user'));

  assert v::text like '%S&I erledigt%', 'G: eigenes erledigtes Event';
  assert v::text not like '%WERKRUF erledigt%',
    'G: ein erledigtes WERKRUF-Event beeinflusst S&I nicht';
end $$;

/* ═══════════════════════════════════════════════════════
   H — Harte Obergrenze
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email)
  select (select id from t where name='user'), (select id from t where name='si'),
         'viele.' || g, 'profile', 40 + g, 'Aufgabe ' || g, 'x', 1, true
  from generate_series(1, 10) g;

  /* p_limit ist ein Vorschlag, kein Versprechen. */
  assert jsonb_array_length(
    public.top_recommendations_for_email((select id from t where name='user'), 20)) = 3,
    'H: hoechstens drei, auch bei p_limit = 20';
  assert jsonb_array_length(
    public.top_recommendations_for_email((select id from t where name='user'), 2)) = 2,
    'H: weniger ist moeglich';
end $$;

/* ═══════════════════════════════════════════════════════
   I — Der echte Queue-Pfad
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_payload jsonb;
begin
  delete from public.email_queue;

  /* Der Weg, den der Cron geht. Nicht schedule_weekly_summaries. */
  v := public.schedule_communications('all');

  select payload into v_payload from public.email_queue
   where template = 'weekly_summary' limit 1;

  /* Keine Huelle mehr: Die Montagshuelle oben sorgt dafuer, dass eine
     Zeile entsteht. Vorher uebersprang dieser Block an sechs von
     sieben Tagen still. */
  assert v_payload is not null, 'I: eine Queue-Zeile entsteht';
  assert v_payload ? 'actions', 'I: das Payload traegt actions';
  assert jsonb_array_length(v_payload -> 'actions') <= 3, 'I: hoechstens drei';
  assert v_payload::text not like '%WERKRUF Fotos%',
    'I: keine Empfehlung des anderen Betriebs';
end $$;

/* ═══════════════════════════════════════════════════════
   K — Kein produktiver Aufrufer der Altlast
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  select count(*) into v_anzahl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     /* Nur echte Funktionen: pg_get_functiondef wirft bei
        Aggregat- und Fensterfunktionen. */
     and p.prokind = 'f'
     and p.proname <> 'schedule_weekly_summaries'
     and pg_get_functiondef(p.oid) like '%schedule_weekly_summaries%';

  assert v_anzahl = 0,
    'K: keine Funktion ruft schedule_weekly_summaries auf';

  /* Und sie ist als Altlast gekennzeichnet. */
  if to_regprocedure('public.schedule_weekly_summaries()') is not null then
    assert obj_description('public.schedule_weekly_summaries()'::regprocedure, 'pg_proc')
           like 'ALTLAST%',
      'K: als Altlast gekennzeichnet';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   L — Smoke-Test S&I
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; x jsonb;
begin
  /* Die Lage von S&I: Score 15, keine Bewertungen, keine Fotos,
     eine Empfehlung. */
  delete from public.events
   where user_id = (select id from t where name='user')
     and title <> '5 Fotos hochladen';

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);

  assert jsonb_array_length(v) = 1, 'L: genau eine Aufgabe';
  x := v -> 0;
  assert x ->> 'title' = '5 Fotos hochladen', 'L: der richtige Titel';
  assert (x ->> 'minutes')::int = 5, 'L: fuenf Minuten';
  assert (x ->> 'location_id')::uuid = (select id from t where name='si'),
    'L: gebunden an S&I';
  assert x ->> 'scope' = 'location', 'L: betriebsbezogen';
end $$;

/* ═══════════════════════════════════════════════════════
   M — Dashboard und Mail stimmen ueberein
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash jsonb; v_mail jsonb;
begin
  v_dash := public.events_feed(
    (select id from t where name='user'), (select id from t where name='si'), 3) -> 'items';
  v_mail := public.top_recommendations_for_email((select id from t where name='user'), 3);

  /* Unterschiede duerfen nur aus den Kanalflags kommen — hier traegt
     das Event beide. */
  assert v_dash -> 0 ->> 'id' = v_mail -> 0 ->> 'id', 'M: dieselbe Empfehlung';
  assert v_dash -> 0 ->> 'title' = v_mail -> 0 ->> 'title', 'M: derselbe Titel';
  assert (v_dash -> 0 ->> 'estimatedMinutes')::int = (v_mail -> 0 ->> 'minutes')::int,
    'M: derselbe Aufwand';
end $$;

/* ═══════════════════════════════════════════════════════
   N — Gleiche Prioritaet: dieselbe Reihenfolge
   ═══════════════════════════════════════════════════════ */
do $$
declare v_dash text; v_mail text;
begin
  delete from public.events where user_id = (select id from t where name='user');

  /* Der Fall, in dem die Kanaele auseinanderliefen: gleiche
     Prioritaet, unterschiedlicher Aufwand.

     Bis zum 05.10. sortierte die Mail nach minutes vor created_at und
     zeigte B zuerst — "schnell zuerst" als zweite Rangfolge, die
     niemand beschlossen hat. */
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, in_dashboard, created_at)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'n.a', 'profile', 50, 'A wartet laenger', 'x', 30, true, true,
     now() - interval '3 days'),
    ((select id from t where name='user'), (select id from t where name='si'),
     'n.b', 'profile', 50, 'B ist schneller', 'x', 5, true, true, now());

  select string_agg(x ->> 'title', ' | ' order by ord) into v_dash
    from jsonb_array_elements(
      public.events_feed((select id from t where name='user'),
                         (select id from t where name='si'), 3) -> 'items'
    ) with ordinality q(x, ord);

  select string_agg(x ->> 'title', ' | ' order by ord) into v_mail
    from jsonb_array_elements(
      public.top_recommendations_for_email((select id from t where name='user'), 3)
    ) with ordinality q(x, ord);

  assert v_dash = v_mail,
    format('N: gleiche Reihenfolge. Dashboard: %s / Mail: %s', v_dash, v_mail);
  assert v_dash like 'A wartet laenger%',
    'N: was laenger wartet, kommt zuerst — nicht was schneller geht';
end $$;

/* ═══════════════════════════════════════════════════════
   O — Der Aufwand bleibt sichtbar
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; x jsonb;
begin
  v := public.top_recommendations_for_email((select id from t where name='user'), 3);
  select e into x from jsonb_array_elements(v) e where e ->> 'title' = 'B ist schneller';

  /* Aus dem ORDER BY entfernt, im Ergebnis geblieben. */
  assert (x ->> 'minutes')::int = 5, 'O: minutes weiterhin im Ergebnis';
end $$;

/* ═══════════════════════════════════════════════════════
   P — Altbestand ohne estimated_minutes
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; x jsonb;
begin
  update public.events
     set estimated_minutes = null, estimated_effort = '12 Minuten'
   where title = 'B ist schneller';

  v := public.top_recommendations_for_email((select id from t where name='user'), 3);
  select e into x from jsonb_array_elements(v) e where e ->> 'title' = 'B ist schneller';

  assert (x ->> 'minutes')::int = 12,
    'P: ohne Zahl greift der Rueckfall auf den Text';
  assert x ->> 'effort' = '12 Minuten', 'P: der Text bleibt fuer die Anzeige';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
