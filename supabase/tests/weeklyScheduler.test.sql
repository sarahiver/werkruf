-- Abnahme fuer den Wochenmail-Scheduler (Paket D4, Abschluss).
--
--   psql -f weeklyScheduler.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444'),
  ('konto',   '55555555-5555-5555-5555-555555555555');

insert into auth.users (id, email)
values ((select id from t where name='user'), 'ivergentz@example.com');

insert into public.user_profiles (id, company_name, full_name, industry_key)
values ((select id from t where name='user'), 'Firma Rolf Müller', 'Iver', 'handwerk');

/* ═══════════════════════════════════════════════════════
   GRUNDGERUEST — ueber die Fixture-Schicht, nicht von Hand
   ═══════════════════════════════════════════════════════

   Dieser Test stammt aus der Zeit, in der die Testdatenbank mehrere
   Pflichtspalten nullable liess. Er war gruen, obwohl er Zeilen
   erzeugte, die Produktion nie zugelassen haette — genau die Falle,
   vor der der Kopf von setup.sh warnt.

   Betroffen: google_accounts.provider_account_id sowie
   google_locations.account_resource_name und
   .location_resource_name. Jede Spalte einzeln nachzutragen legt die
   naechste frei; die Helfer aus scripts/test-db/sql/80-fixtures.sql
   halten das Wissen an EINER Stelle und liefern dieselben Kennungen
   und Titel, die t fuehrt.

   auth.users und user_profiles legt der Test oben weiter selbst an:
   company_name und full_name sind sein Gegenstand, nicht Beiwerk. */

select test.konto('konto_a', 'user_a');
select test.standort('standort_si',      'user_a', 'konto_a', 'S&I.',    true);
select test.standort('standort_werkruf', 'user_a', 'konto_a', 'WERKRUF', false);

/* S&I: keine Bewertungen.
   WERKRUF: zehn, davon drei in der VORWOCHE — genau dem Zeitraum, den
   reviewsNew zaehlt. Laegen sie in der laufenden Woche, traefe der
   Test den nutzerweiten Pfad gar nicht und bestuende aus dem falschen
   Grund. */
/* google_reviews hat fuenf Pflichtspalten — location_id, account_id,
   user_id, review_resource_name, google_created_at. test.bewertungen()
   fuellt sie; das Alter setzt der Test danach selbst, weil der genaue
   Zeitpunkt hier der Gegenstand ist und nicht als Intervall ab jetzt
   ausgedrueckt werden kann. */
select test.bewertungen('standort_werkruf', 3, 2, true);
select test.bewertungen('standort_werkruf', 7, 5, true, interval '60 days');

update public.google_reviews
   set google_created_at = date_trunc('week', now()) - interval '4 days',
       answered_at       = date_trunc('week', now()) - interval '4 days'
 where location_id = (select id from t where name='werkruf')
   and star_rating = 2;

/* Je ein Engine-Event pro Betrieb, plus eines fuers Konto. */
insert into public.events
  (user_id, location_id, type, category, priority, title, summary,
   in_weekly_email, estimated_minutes, action_url)
values
  ((select id from t where name='user'), (select id from t where name='si'),
   'profile.photos_missing', 'profile', 29, 'Foto hochladen', 'Keine Fotos hinterlegt.',
   true, 5, '/dashboard/fotos'),
  ((select id from t where name='user'), (select id from t where name='werkruf'),
   'reviews.unanswered', 'reviews', 70, 'WERKRUF Bewertungen', 'x', true, 10, '/dashboard');

/* ═══════════════════════════════════════════════════════
   1 — engineEvents landen im Payload
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_payload jsonb;
begin
  v := public.schedule_weekly_summaries();
  assert (v ->> 'queued')::int = 1, 'Eine Mail eingereiht';

  select payload into v_payload from public.email_queue
   where template = 'weekly_summary' order by created_at desc limit 1;

  /* Genau das fehlte: Der Scheduler schrieb kein engineEvents, und die
     Mail hatte nichts zu rendern. */
  assert v_payload ? 'engineEvents', 'engineEvents ist im Payload';
  assert jsonb_array_length(v_payload -> 'engineEvents') = 1, 'Eine Aufgabe';
  assert v_payload -> 'engineEvents' -> 0 ->> 'title' = 'Foto hochladen',
    'Und zwar die der Engine';
  assert (v_payload -> 'engineEvents' -> 0 ->> 'estimatedMinutes')::int = 5,
    'Mit strukturiertem Aufwand';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Keine Daten des anderen Betriebs
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  select payload into v_payload from public.email_queue
   where template = 'weekly_summary' order by created_at desc limit 1;

  assert v_payload ->> 'locationTitle' = 'S&I.', 'Die Mail nennt den Betrieb';

  /* WERKRUF hat zehn Bewertungen, drei davon neu. S&I hat keine. */
  assert (v_payload ->> 'reviewsTotal')::int = 0, 'S&I hat keine Bewertungen';
  /* WERKRUF hat drei Bewertungen in der Vorwoche. Zaehlte der
     Scheduler ueber user_id, staende hier 3. */
  assert (v_payload ->> 'reviewsNew')::int = 0,  'Und keine neuen';
  assert v_payload ->> 'averageRating' is null,  'Und keinen Durchschnitt';

  /* Vorher zaehlte der Scheduler ueber user_id — dann staenden hier
     10 und 3, aus einem Betrieb, um den es gar nicht geht. */
  assert v_payload::text not like '%WERKRUF Bewertungen%',
    'Und keine Aufgabe des anderen Betriebs';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Antworten folgen der Bewertung
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb; v_review uuid;
begin
  select id into v_review from public.google_reviews
   where location_id = (select id from t where name='werkruf') limit 1;

  /* location_id ist in Produktion NOT NULL. Der Wert wird aus der
     Bewertung gelesen und nicht gesetzt — genau das ist die Aussage
     dieses Abschnitts: der Standortbezug einer Antwort entsteht ueber
     die Bewertung. */
  insert into public.review_replies (user_id, review_id, location_id, body, status, published_at)
  values ((select id from t where name='user'), v_review,
          (select location_id from public.google_reviews where id = v_review),
          'Danke fuer die Rueckmeldung.', 'published',
          (date_trunc('week', now()) - interval '3 days'));

  delete from public.email_queue;
  perform public.schedule_weekly_summaries();

  select payload into v_payload from public.email_queue limit 1;

  /* review_replies traegt keinen Standort — der Bezug entsteht ueber
     die Bewertung. Ohne den Join zaehlte diese Antwort in der
     S&I-Mail mit. */
  assert (v_payload ->> 'repliesPublished')::int = 0,
    'Eine WERKRUF-Antwort zaehlt nicht fuer S&I';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Snapshot traegt Standort und Score-Fassung
   ═══════════════════════════════════════════════════════ */
do $$
declare v_snap public.weekly_snapshots;
begin
  select * into v_snap from public.weekly_snapshots
   where user_id = (select id from t where name='user')
   order by week_start desc limit 1;

  assert v_snap.location_id = (select id from t where name='si'),
    'Der Snapshot gehoert zu S&I';
  assert v_snap.score_version = 1, 'Mit der Score-Fassung';
  assert v_snap.reviews_total = 0, 'Und dessen Zahlen';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Vorwochenvergleich nur gegen denselben Betrieb
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb; v_prev date := (date_trunc('week', now()) - interval '7 days')::date;
begin
  /* Ein Vorwochen-Snapshot von WERKRUF darf den S&I-Vergleich nicht
     beeinflussen — das ergaebe eine erfundene Veraenderung. */
  insert into public.weekly_snapshots
    (user_id, location_id, score_version, week_start, health_score)
  values ((select id from t where name='user'), (select id from t where name='werkruf'),
          1, v_prev, 99);

  delete from public.email_queue;
  perform public.schedule_weekly_summaries();
  select payload into v_payload from public.email_queue limit 1;

  assert v_payload ->> 'healthDelta' is null,
    'Ohne eigenen Vorwochenwert kein Delta — statt eines gegen WERKRUF';

  /* Mit eigenem Snapshot schon. */
  insert into public.weekly_snapshots
    (user_id, location_id, score_version, week_start, health_score)
  values ((select id from t where name='user'), (select id from t where name='si'),
          1, v_prev, 11)
  on conflict (user_id, week_start) do update set location_id = excluded.location_id,
    health_score = excluded.health_score;

  delete from public.email_queue;
  perform public.schedule_weekly_summaries();
  select payload into v_payload from public.email_queue limit 1;

  assert (v_payload ->> 'healthDelta')::int = (v_payload ->> 'healthScore')::int - 11,
    'Mit eigenem Vorwochenwert ein echtes Delta';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Eine andere Score-Fassung ist nicht vergleichbar
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb; v_prev date := (date_trunc('week', now()) - interval '7 days')::date;
begin
  update public.weekly_snapshots set score_version = 2
   where user_id = (select id from t where name='user') and week_start = v_prev;

  delete from public.email_queue;
  perform public.schedule_weekly_summaries();
  select payload into v_payload from public.email_queue limit 1;

  assert v_payload ->> 'healthDelta' is null,
    'Eine andere Score-Fassung misst etwas anderes — kein Delta';

  update public.weekly_snapshots set score_version = 1
   where user_id = (select id from t where name='user') and week_start = v_prev;
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Null Aufgaben ist gueltig
   ═══════════════════════════════════════════════════════ */
do $$
declare v_payload jsonb;
begin
  update public.events set lifecycle = 'resolved'
   where location_id = (select id from t where name='si');

  delete from public.email_queue;
  perform public.schedule_weekly_summaries();
  select payload into v_payload from public.email_queue limit 1;

  assert v_payload is not null, 'Die Mail geht trotzdem raus';
  assert jsonb_array_length(v_payload -> 'engineEvents') = 0, 'Mit leerer Liste';
  assert (v_payload ->> 'eventCount')::int = 0, 'Und das ist kein Fehler';

  update public.events set lifecycle = 'new'
   where location_id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Mehrere Betriebe ohne Auswahl: keine Zeile
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  update public.google_locations set selected_at = null
   where user_id = (select id from t where name='user');

  delete from public.email_queue;
  v := public.schedule_weekly_summaries();

  assert (v ->> 'queued')::int = 0, 'Keine Mail';
  assert (v ->> 'ohneStandort')::int = 1, 'Mit erkennbarem Grund';
  assert (select count(*) from public.email_queue) = 0, 'Nichts in der Warteschlange';

  update public.google_locations set selected_at = now()
   where id = (select id from t where name='si');
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Abbestellte Wochenmail
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Die Parameternamen muessen denen der echten Funktion entsprechen:
     create or replace kann sie nicht umbenennen, sonst
     "cannot change name of input parameter". Die echte Fassung heisst
     wants_notification(p_user_id uuid, p_kind text). */
  create or replace function public.wants_notification(p_user_id uuid, p_kind text)
  returns boolean language sql as $f$ select false $f$;

  delete from public.email_queue;
  v := public.schedule_weekly_summaries();

  assert (v ->> 'queued')::int = 0, 'Keine Mail';
  assert (v ->> 'abbestellt')::int = 1, 'Mit erkennbarem Grund';

  /* Der Snapshot entsteht trotzdem — die Messung laeuft weiter, auch
     wenn der Kunde keine Mail will. */
  assert (select count(*) from public.weekly_snapshots
           where user_id = (select id from t where name='user')
             and week_start = date_trunc('week', now())::date) = 1,
    'Der Snapshot wird trotzdem geschrieben';

  create or replace function public.wants_notification(p_user_id uuid, p_kind text)
  returns boolean language sql as $f$ select true $f$;
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Derselbe Lauf zweimal reiht nicht doppelt ein
   ═══════════════════════════════════════════════════════ */
do $$
begin
  delete from public.email_queue;
  perform public.schedule_weekly_summaries();
  perform public.schedule_weekly_summaries();

  assert (select count(*) from public.email_queue where template = 'weekly_summary') = 1,
    'Der Dedupe-Schluessel verhindert die zweite Zeile';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;