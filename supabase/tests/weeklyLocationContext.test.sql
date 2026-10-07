-- Abnahme fuer den Standortkontext der Wochenmail (Paket D4.8).
--
--   psql -v ON_ERROR_STOP=1 -f weeklyLocationContext.test.sql

\set ON_ERROR_STOP on

begin;

/* Den echten Planer sichern, bevor er fuer die Queue-Tests
   ueberschrieben wird. */
do $$
begin
  execute replace(
    pg_get_functiondef('public.plan_communications(uuid,timestamptz)'::regprocedure),
    'FUNCTION public.plan_communications(', 'FUNCTION public.plan_communications_echt(');
end $$;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into auth.users (id, email)
values ((select id from t where name='user'), 'iver@example.com')
on conflict (id) do nothing;

/* Der Registrierungsname — nicht der Name des Betriebs. */
insert into public.user_profiles (id, company_name, industry_key)
values ((select id from t where name='user'),
        'Firma Rolf Müller Sanitär und Heizungstechnik', 'handwerk')
on conflict (id) do update set company_name = excluded.company_name;

insert into public.google_accounts (id, user_id, status)
values (gen_random_uuid(), (select id from t where name='user'), 'active');

insert into public.google_locations (id, user_id, title, selected_at) values
  ((select id from t where name='si'),      (select id from t where name='user'), 'S&I.',    now()),
  ((select id from t where name='werkruf'), (select id from t where name='user'), 'WERKRUF', null);

insert into public.notification_preferences (user_id)
values ((select id from t where name='user')) on conflict do nothing;

/* ═══════════════════════════════════════════════════════
   A — openCount zaehlt nur den eigenen Betrieb
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; d jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, in_dashboard)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'profile.photos_missing', 'profile', 29, '5 Fotos hochladen',
     'Keine Fotos hinterlegt.', 5, true, true),
    ((select id from t where name='user'), (select id from t where name='werkruf'),
     'profile.photos_missing', 'profile', 29, 'WERKRUF Fotos', 'x', 5, true, true);

  v := public.plan_communications((select id from t where name='user'),
                                  date_trunc('week', now()) + interval '7 hours');

  select e into d from jsonb_array_elements(v -> 'decisions') e
   where e ->> 'channel' = 'weekly_email';

  /* Die Mail sagte "2 offene Empfehlungen" und zeigte eine — die
     zweite gehoerte WERKRUF. */
  assert (d ->> 'openRecommendations')::int = 1,
    format('A: eine, nicht zwei (ist: %s)', d ->> 'openRecommendations');
  assert (d ->> 'locationId')::uuid = (select id from t where name='si'),
    'A: und der Standort steht dabei';
end $$;

/* ═══════════════════════════════════════════════════════
   B — Konto-Ereignisse zaehlen mit
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; d jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email)
  values ((select id from t where name='user'), null,
          'connection.lost', 'connection', 95, 'Verbindung erneuern', 'x', 2, true);

  v := public.plan_communications((select id from t where name='user'),
                                  date_trunc('week', now()) + interval '7 hours');
  select e into d from jsonb_array_elements(v -> 'decisions') e
   where e ->> 'channel' = 'weekly_email';

  /* Eine verlorene Verbindung betrifft jeden Betrieb. */
  assert (d ->> 'openRecommendations')::int = 2, 'B: Betrieb plus Konto';
end $$;

/* ═══════════════════════════════════════════════════════
   C + D + E — Probebetrieb, Pause, Ablauf zaehlen nicht
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; d jsonb;
        v_jetzt timestamptz := date_trunc('week', now()) + interval '7 hours';
begin
  /*
   * Die Zeitpunkte relativ zu v_jetzt, nicht zu now().
   *
   * Der Test uebergibt Montag 07:00 als Auswertungszeitpunkt, setzte
   * das Ablaufdatum aber auf `now() - 1 Tag`. An einem Mittwoch ist
   * das Dienstag — gegenueber Montag noch nicht abgelaufen, und die
   * Zusicherung schlug fehl.
   *
   * Der Test bestand montags und ab Dienstag nicht mehr. Genau die
   * Art Fehler, die man einmal im Jahr sucht.
   */
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_weekly_email, rule_status, cooldown_until, expires_at)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.probe', 'profile', 99, 'Probebetrieb', 'x', 1, true, 'candidate', null, null),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.pause', 'profile', 99, 'In Pause', 'x', 1, true, null, v_jetzt + interval '7 days', null),
    ((select id from t where name='user'), (select id from t where name='si'),
     'x.alt', 'profile', 99, 'Abgelaufen', 'x', 1, true, null, null, v_jetzt - interval '1 day');

  v := public.plan_communications((select id from t where name='user'), v_jetzt);
  select e into d from jsonb_array_elements(v -> 'decisions') e
   where e ->> 'channel' = 'weekly_email';

  assert (d ->> 'openRecommendations')::int = 2,
    format('C/D/E: unveraendert zwei (ist: %s)', d ->> 'openRecommendations');
end $$;

/*
 * Montag herstellen.
 *
 * plan_communications verschickt die Wochenmail nur montags, und
 * schedule_communications ruft es ohne Zeitpunkt auf — es gilt
 * now(). An jedem anderen Tag entsteht keine Queue-Zeile, und die
 * folgenden Tests haetten nichts zu pruefen.
 *
 * Deshalb hier eine Huelle, die den echten Planer mit einem
 * Montagszeitpunkt aufruft. Sie gilt nur bis zum rollback am
 * Dateiende.
 *
 * Der Test lief bis zum 07.10. nur montags durch — genau die Art
 * Fehler, die man einmal im Jahr sucht.
 */
create or replace function public.plan_communications(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.plan_communications_echt(
    p_user_id,
    /* Montag dieser Woche, 07:00 — der Zeitpunkt, zu dem comm-weekly
       tatsaechlich laeuft. */
    date_trunc('week', p_now) + interval '7 hours');
$$;

/* ═══════════════════════════════════════════════════════
   F + G — Der Name kommt aus dem Standort
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  delete from public.email_queue;
  perform public.schedule_communications('all');

  select payload into v_payload from public.email_queue
   where template = 'weekly_summary' limit 1;

  assert v_payload is not null, 'F: eine Mail wurde eingereiht';

  /* Vorher stand hier der Registrierungsname. */
  assert v_payload ->> 'companyName' = 'S&I.',
    format('F: der Google-Name (ist: %s)', v_payload ->> 'companyName');
  assert v_payload ->> 'locationTitle' = 'S&I.', 'F: getrennt verfuegbar';
  assert v_payload ->> 'accountName' = 'Firma Rolf Müller Sanitär und Heizungstechnik',
    'F: der Registrierungsname bleibt erhalten, nur nicht als Betriebsname';

  assert v_payload::text not like '%WERKRUF%',
    'G: der andere Betrieb kommt nirgends vor';
end $$;

/* ═══════════════════════════════════════════════════════
   H — Rueckfall ohne Google-Namen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  update public.google_locations set title = null
   where id = (select id from t where name='si');

  delete from public.email_queue;
  perform public.schedule_communications('all');
  select payload into v_payload from public.email_queue limit 1;

  assert v_payload ->> 'companyName' = 'Firma Rolf Müller Sanitär und Heizungstechnik',
    'H: ohne Google-Namen der Registrierungsname';
  assert v_payload -> 'locationTitle' = 'null'::jsonb,
    'H: locationTitle bleibt leer — die Vorlage kann den Unterschied erkennen';

  update public.google_locations set title = 'S&I.'
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   J + K — Score und Bewertungen standortrein
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  /* WERKRUF bekommt zehn Bewertungen. S&I hat keine. */
  insert into public.google_reviews (user_id, location_id, star_rating, is_answered)
  select (select id from t where name='user'), (select id from t where name='werkruf'),
         5, true from generate_series(1, 10);

  delete from public.email_queue;
  perform public.schedule_communications('all');
  select payload into v_payload from public.email_queue limit 1;

  assert (v_payload ->> 'reviewsTotal')::int = 0,
    format('K: S&I hat keine Bewertungen (ist: %s)', v_payload ->> 'reviewsTotal');
  assert v_payload ->> 'averageRating' is null, 'K: und keinen Durchschnitt';
  assert v_payload ? 'healthScore', 'J: der Score ist dabei';
end $$;

/* ═══════════════════════════════════════════════════════
   L — Erledigtes standortrein
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary,
     lifecycle, completed_at)
  values ((select id from t where name='user'), (select id from t where name='werkruf'),
          'x.fertig', 'profile', 20, 'WERKRUF erledigt', 'x', 'completed',
          now() - interval '2 days');

  delete from public.email_queue;
  perform public.schedule_communications('all');
  select payload into v_payload from public.email_queue limit 1;

  assert v_payload::text not like '%WERKRUF erledigt%',
    'L: ein erledigtes WERKRUF-Event erscheint nicht in der S&I-Mail';
end $$;

/* ═══════════════════════════════════════════════════════
   M — Aufgaben, Zahl und Name gehoeren zusammen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  select payload into v_payload from public.email_queue limit 1;

  assert jsonb_array_length(v_payload -> 'actions') = 2,
    'M: Betriebsaufgabe plus Konto-Ereignis';
  assert v_payload ->> 'companyName' = 'S&I.', 'M: derselbe Betrieb';

  /* Die Zahl oben und die Liste unten muessen zusammenpassen —
     sonst sagt die Mail etwas anderes, als sie zeigt. */
  assert (v_payload ->> 'openCount')::int = jsonb_array_length(v_payload -> 'actions'),
    format('M: openCount = %s, Aufgaben = %s',
           v_payload ->> 'openCount', jsonb_array_length(v_payload -> 'actions'));
end $$;

/* ═══════════════════════════════════════════════════════
   N — Die Abwesenheits-Erinnerung bleibt nutzerweit
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; d jsonb;
begin
  /* Sie sagt "es hat sich etwas angesammelt" — ueber alle Betriebe
     gemeint, nicht ueber einen. Bewusst unveraendert. */
  v := public.plan_communications((select id from t where name='user'));
  select e into d from jsonb_array_elements(v -> 'decisions') e
   where e ->> 'channel' = 'inactivity_reminder';

  assert d is not null, 'N: der Kanal existiert weiterhin';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
