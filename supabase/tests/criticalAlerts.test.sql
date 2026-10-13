-- Abnahme fuer standortbezogene Sofortmeldungen (Paket E1).
--
--   psql -v ON_ERROR_STOP=1 -f criticalAlerts.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    test.id('user_a')),
  ('si',      test.id('standort_si')),
  ('werkruf', test.id('standort_werkruf'));

/* Nutzer, Profil, Konto, beide Standorte, Benachrichtigungen —
   scripts/test-db/sql/80-fixtures.sql. Vorher stand das hier, ohne
   provider_account_id und account_id; beide sind in Produktion
   Pflichtspalten. */
select test.basis();

/* Operative Mails gehen seit H1 nur an berechtigte Empfaenger
   (Migration 20261013130000, zentrale Pruefung in der
   Empfaengerschleife von schedule_communications). Die Vorgabe in
   user_profiles.plan ist 'free' — ohne diese Zeile findet diese
   Abnahme keine Mail mehr, und zwar zu Recht.

   Sie steht hier und nicht im Helfer: Welchen Plan ein Testbetrieb
   hat, ist fachlich und soll im Test sichtbar sein. Ein Helfer, der
   stillschweigend 'pro' setzte, wuerde kuenftige Mail-Tests gruen
   machen, ohne dass jemand merkt, dass der Plan dafuer noetig war. */
update public.user_profiles set plan = 'pro' where id = test.id('user_a');


/* Der Registrierungsname. Steht hier und nicht im Helfer, weil dieser
   Test ihn gegen den Standorttitel abgrenzt. */
insert into public.user_profiles (id, company_name, industry_key)
values ((select id from t where name='user'),
        'Firma Rolf Müller Sanitär und Heizungstechnik', 'handwerk')
on conflict (id) do update set company_name = excluded.company_name;

/* Hilfsmittel: die Meldungen eines Standorts. */
create or replace function pg_temp.meldungen(p_user uuid)
returns table (location_id uuid, anzahl integer, ids jsonb)
language sql as $$
  select (e ->> 'locationId')::uuid, (e ->> 'count')::integer, e -> 'eventIds'
  from jsonb_array_elements(public.plan_communications(p_user) -> 'decisions') e
  where e ->> 'channel' = 'immediate_alert' and (e ->> 'send')::boolean;
$$;

/* ═══════════════════════════════════════════════════════
   A — Ein Standort, eine Bewertung
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_loc uuid; v_count integer;
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary, lifecycle,
     subject_type, subject_id)
  values ('aaaa3333-0000-0000-0000-000000000001',
          (select id from t where name='user'), (select id from t where name='si'),
          'review.negative_unanswered', 'reviews', 90,
          'Kritische Bewertung', 'Ein Stern, unbeantwortet', 'new',
          'review', 'ffff0000-0000-0000-0000-000000000001');

  select count(*) into v_anzahl from pg_temp.meldungen((select id from t where name='user'));
  assert v_anzahl = 1, 'A: eine Meldung';

  select location_id, anzahl into v_loc, v_count
    from pg_temp.meldungen((select id from t where name='user'));

  assert v_loc = (select id from t where name='si'), 'A: fuer S&I';
  assert v_count = 1, 'A: eine Bewertung';
end $$;

/* ═══════════════════════════════════════════════════════
   B — Zwei Bewertungen desselben Standorts: eine Meldung
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_count integer;
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary, lifecycle,
     subject_type, subject_id)
  values ('aaaa3333-0000-0000-0000-000000000002',
          (select id from t where name='user'), (select id from t where name='si'),
          'review.negative_unanswered', 'reviews', 90,
          'Zweite kritische Bewertung', 'x', 'new',
          'review', 'ffff0000-0000-0000-0000-000000000002');

  select count(*) into v_anzahl from pg_temp.meldungen((select id from t where name='user'));
  select anzahl into v_count from pg_temp.meldungen((select id from t where name='user'));

  /* Drei Mails waeren der schnellste Weg in den Spamfilter. */
  assert v_anzahl = 1, 'B: weiterhin eine Meldung';
  assert v_count = 2, 'B: mit beiden Bewertungen';
end $$;

/* ═══════════════════════════════════════════════════════
   C — Zwei Standorte: zwei Meldungen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_si jsonb; v_wr jsonb;
begin
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary, lifecycle,
     subject_type, subject_id)
  values ('bbbb3333-0000-0000-0000-000000000001',
          (select id from t where name='user'), (select id from t where name='werkruf'),
          'review.negative_unanswered', 'reviews', 90,
          'WERKRUF Bewertung', 'x', 'new',
          'review', 'ffff0000-0000-0000-0000-000000000003');

  select count(*) into v_anzahl from pg_temp.meldungen((select id from t where name='user'));
  assert v_anzahl = 2, 'C: zwei Meldungen, eine je Betrieb';

  select ids into v_si from pg_temp.meldungen((select id from t where name='user'))
   where location_id = (select id from t where name='si');
  select ids into v_wr from pg_temp.meldungen((select id from t where name='user'))
   where location_id = (select id from t where name='werkruf');

  /* Vorher landeten alle drei in einer Meldung. */
  assert jsonb_array_length(v_si) = 2, 'C: S&I hat zwei Bewertungen';
  assert jsonb_array_length(v_wr) = 1, 'C: WERKRUF eine';
  assert v_si::text not like '%bbbb3333%', 'C: keine WERKRUF-Bewertung bei S&I';
  assert v_wr::text not like '%aaaa3333%', 'C: keine S&I-Bewertung bei WERKRUF';
end $$;

/* ═══════════════════════════════════════════════════════
   D — Bereits gemeldete bleiben draussen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_count integer;
begin
  update public.events set delivered = '{"notification": true}'::jsonb
   where id = 'aaaa3333-0000-0000-0000-000000000001';

  select anzahl into v_count from pg_temp.meldungen((select id from t where name='user'))
   where location_id = (select id from t where name='si');

  assert v_count = 1, 'D: nur die noch ungemeldete';

  update public.events set delivered = '{}'::jsonb
   where id = 'aaaa3333-0000-0000-0000-000000000001';
end $$;

/* ═══════════════════════════════════════════════════════
   E — Bewertung ohne Standort loest nichts aus
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_vorher integer;
begin
  select count(*) into v_vorher from pg_temp.meldungen((select id from t where name='user'));

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary, lifecycle,
     subject_type, subject_id)
  values ((select id from t where name='user'), null,
          'review.negative_unanswered', 'reviews', 90, 'Ohne Standort', 'x', 'new',
          'review', 'ffff0000-0000-0000-0000-000000000004');

  select count(*) into v_anzahl from pg_temp.meldungen((select id from t where name='user'));

  /* Sie einem Betrieb zuzuschlagen waere geraten. Lieber keine Mail
     als eine, die den falschen Betrieb nennt. */
  assert v_anzahl = v_vorher, 'E: keine zusaetzliche Meldung';

  /* Auffindbar bleibt sie. */
  assert (select count(*) from public.events
           where type = 'review.negative_unanswered' and location_id is null) = 1,
    'E: das Event existiert weiterhin und ist auffindbar';
end $$;

/* ═══════════════════════════════════════════════════════
   F — Probebetrieb und erledigte Bewertungen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_vorher integer;
begin
  select count(*) into v_vorher from pg_temp.meldungen((select id from t where name='user'));

  insert into public.events
    (user_id, location_id, type, category, priority, title, summary, lifecycle,
     rule_status, subject_type, subject_id)
  values
    ((select id from t where name='user'), (select id from t where name='si'),
     'review.negative_unanswered', 'reviews', 90, 'Probebetrieb', 'x', 'new', 'candidate',
     'review', 'ffff0000-0000-0000-0000-000000000005'),
    ((select id from t where name='user'), (select id from t where name='si'),
     'review.negative_unanswered', 'reviews', 90, 'Erledigt', 'x', 'completed', null,
     'review', 'ffff0000-0000-0000-0000-000000000006'),
    ((select id from t where name='user'), (select id from t where name='si'),
     'review.negative_unanswered', 'reviews', 90, 'Weggeklickt', 'x', 'dismissed', null,
     'review', 'ffff0000-0000-0000-0000-000000000007');

  select count(*) into v_anzahl from pg_temp.meldungen((select id from t where name='user'));
  assert v_anzahl = v_vorher, 'F: unveraenderte Anzahl Meldungen';

  assert (select anzahl from pg_temp.meldungen((select id from t where name='user'))
           where location_id = (select id from t where name='si')) = 2,
    'F: und unveraenderte Anzahl Bewertungen';
end $$;

/* ═══════════════════════════════════════════════════════
   G — Abbestellt
   ═══════════════════════════════════════════════════════ */
/*
 * G1-Korrektur: Vorher ueberschrieb dieser Abschnitt
 * public.wants_notification() mit einem eigenen Rumpf. Das ging gegen
 * das echte Schema nicht mehr —
 *
 *   ERROR: cannot change name of input parameter "p_user_id"
 *
 * weil CREATE OR REPLACE Parameternamen nicht umbenennen darf und der
 * Test p_user statt p_user_id schrieb.
 *
 * Der Fehler war aber nicht der Name. Eine Produktionsfunktion im Test
 * zu ersetzen heisst, die eigene Nachbildung zu pruefen statt des
 * Deployten. Abbestellt wird jetzt so abbestellt, wie ein Kunde es tut:
 * ueber notification_preferences. Damit laeuft auch wants_notification
 * selbst mit durch den Test.
 */
do $$
declare v_anzahl integer;
begin
  update public.notification_preferences
     set negative_review = false
   where user_id = (select id from t where name='user');

  select count(*) into v_anzahl from pg_temp.meldungen((select id from t where name='user'));
  assert v_anzahl = 0, 'G: keine Meldung fuer irgendeinen Betrieb';

  update public.notification_preferences
     set negative_review = true
   where user_id = (select id from t where name='user');
end $$;

/* ═══════════════════════════════════════════════════════
   H — Zwei Mails in der Warteschlange
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_si jsonb; v_wr jsonb;
begin
  delete from public.email_queue;
  perform public.schedule_communications('immediate_alert');

  select count(*) into v_anzahl from public.email_queue
   where template = 'critical_review_alert';

  /* Vorher kollidierte der Dedupe-Schluessel: zwei Betriebe in
     derselben Stunde ergaben eine Zeile, die zweite fiel still aus. */
  assert v_anzahl = 2, format('H: zwei Mails (ist: %s)', v_anzahl);

  select payload into v_si from public.email_queue
   where template = 'critical_review_alert' and payload ->> 'companyName' = 'S&I.';
  select payload into v_wr from public.email_queue
   where template = 'critical_review_alert' and payload ->> 'companyName' = 'WERKRUF';

  assert v_si is not null, 'H: eine Mail fuer S&I';
  assert v_wr is not null, 'H: eine fuer WERKRUF';
end $$;

/* ═══════════════════════════════════════════════════════
   I — Der Betriebsname kommt aus dem Standort
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  select payload into v from public.email_queue
   where template = 'critical_review_alert' and payload ->> 'companyName' = 'S&I.';

  /* Vorher stand hier der Registrierungsname. */
  assert v ->> 'companyName' = 'S&I.', 'I: der Google-Name';
  assert v ->> 'locationTitle' = 'S&I.', 'I: getrennt verfuegbar';
  assert v ->> 'accountName' = 'Firma Rolf Müller Sanitär und Heizungstechnik',
    'I: der Registrierungsname bleibt erhalten';
  assert (v ->> 'count')::int = 2, 'I: zwei Bewertungen';
end $$;

/* ═══════════════════════════════════════════════════════
   J — Der Dedupe-Schluessel traegt den Standort
   ═══════════════════════════════════════════════════════ */
do $$
declare v_si text; v_wr text;
begin
  select dedupe_key into v_si from public.email_queue
   where template = 'critical_review_alert' and payload ->> 'companyName' = 'S&I.';
  select dedupe_key into v_wr from public.email_queue
   where template = 'critical_review_alert' and payload ->> 'companyName' = 'WERKRUF';

  assert v_si <> v_wr, 'J: verschiedene Schluessel';
  assert v_si like '%' || (select id from t where name='si')::text || '%',
    'J: mit dem Standort darin';
end $$;

/* ═══════════════════════════════════════════════════════
   K — Die Dashboard-Auswahl ist unerheblich
   ═══════════════════════════════════════════════════════ */
do $$
declare v_wr jsonb;
begin
  /* S&I ist ausgewaehlt. Eine Bewertung bei WERKRUF muss trotzdem als
     WERKRUF-Mail kommen — die Bewertung bestimmt den Standort, nicht
     die Oberflaeche. */
  assert (select selected_at from public.google_locations
           where id = (select id from t where name='si')) is not null,
    'K: S&I ist ausgewaehlt';

  select payload into v_wr from public.email_queue
   where template = 'critical_review_alert' and payload ->> 'companyName' = 'WERKRUF';

  assert v_wr is not null, 'K: die WERKRUF-Mail entsteht trotzdem';
  assert (v_wr ->> 'locationId')::uuid = (select id from t where name='werkruf'),
    'K: mit dem richtigen Standort';
end $$;

/* ═══════════════════════════════════════════════════════
   L — Fehlender Standortname
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set title = null
   where id = (select id from t where name='werkruf');

  /*
   * G1-Korrektur: eine NEUE ungemeldete Bewertung.
   *
   * Abschnitt H hat gemeldet, und schedule_communications ruft danach
   * mark_events_delivered() — dieselbe Bewertung kommt nie zweimal.
   * Dieser Abschnitt baute aber darauf, dass ein erneuter Lauf die
   * Mails von H wiederholt. Das kann nicht funktionieren und haengt
   * nicht am Schema: der Abschnitt las Zustand, den H verbraucht hatte.
   *
   * Die Erwartung bleibt unveraendert — nur die Voraussetzung wird
   * jetzt hergestellt statt vorausgesetzt.
   */
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary, lifecycle,
     subject_type, subject_id)
  values ('dddd3333-0000-0000-0000-00000000000c',
          (select id from t where name='user'), (select id from t where name='werkruf'),
          'review.negative_unanswered', 'reviews', 90,
          'WERKRUF ohne Namen', 'x', 'new',
          'review', 'ffff0000-0000-0000-0000-00000000000c');

  delete from public.email_queue;
  perform public.schedule_communications('immediate_alert');

  select payload into v from public.email_queue
   where template = 'critical_review_alert'
     and (payload ->> 'locationId')::uuid = (select id from t where name='werkruf');

  assert v ->> 'companyName' = 'Firma Rolf Müller Sanitär und Heizungstechnik',
    'L: ohne Google-Namen der Registrierungsname';
  assert v -> 'locationTitle' = 'null'::jsonb, 'L: locationTitle bleibt leer';

  update public.google_locations set title = 'WERKRUF'
   where id = (select id from t where name='werkruf');
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
