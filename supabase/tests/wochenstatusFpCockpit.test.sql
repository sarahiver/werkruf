-- WP6 — Wochenstatus und Founding-Partner-Cockpit: Datenbankseite.
--
--   scripts/test-db/run.sh wochenstatusFpCockpit
--
-- Nummern wie im Brief:
--   T1–T4   weekly_happened / weekly_check_facts (Rohfakten der Mail)
--   T13     Payload von schedule_communications traegt happened + check
--   T16/T17 fp_cockpit_overview: nur FPs, Betriebe getrennt (Detail)
--   T18     Oeffnungsrate = Opens / zugestellte Mails, nicht / gesendete
--   T20/T21 Draft zaehlt nicht, nur published; Aufgaben nur completed
--   T23     Zahlungsbereitschaft nur fuer FPs, nur erlaubte Werte
--   T27–T31 record_delivery_event: delivered, open (einmal/mehrfach),
--           hard_bounce, unbekannte Message-ID, Idempotenz
--   Rechte  anon/authenticated kommen an nichts davon heran
--   FK      Loeschung des Nutzers raeumt Ereignisse und Feedback weg
--
-- Jeder Abschnitt in einer eigenen Transaktion mit rollback.

\set ON_ERROR_STOP on

/* ═══════════════════════════════════════════════════════
   T1–T4 — weekly_happened und weekly_check_facts
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
insert into test.bezeichner (name, id) values
  ('standort_fremd', '77777777-7777-7777-7777-777777777777')
on conflict (name) do nothing;
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);

do $$
declare
  v_user   uuid := test.id('user_a');
  v_si     uuid := test.id('standort_si');
  v_wr     uuid := test.id('standort_werkruf');
  v_fremd  uuid := test.id('standort_fremd');
  v_rev    uuid;
  v        jsonb;
begin
  /* Bewertungen: 2 neue (eine 1★), 1 alte; eine unbeantwortet */
  perform test.bewertungen('standort_si', 1, 5, true,  '2 days');
  perform test.bewertungen('standort_si', 1, 1, false, '1 day');
  perform test.bewertungen('standort_si', 1, 4, true,  '20 days');
  /* Der zweite Betrieb hat auch Neues — darf nicht in S&I landen */
  perform test.bewertungen('standort_werkruf', 3, 5, false, '1 day');
  perform test.bewertungen('standort_fremd', 2, 2, false, '1 day');

  /* Antworten: eine published diese Woche, eine draft, eine alte published */
  select id into v_rev from public.google_reviews where location_id = v_si limit 1;
  insert into public.review_replies (review_id, location_id, user_id, body, status, published_at)
  values (v_rev, v_si, v_user, 'Danke!', 'published', now() - interval '1 day'),
         (v_rev, v_si, v_user, 'Entwurf', 'draft', now() - interval '1 day'),
         (v_rev, v_si, v_user, 'Alt', 'published', now() - interval '30 days');

  /* Aufgaben: completed fuer S&I, completed fuer WERKRUF, resolved fuer S&I, Konto-Aufgabe */
  insert into public.events (user_id, location_id, type, category, priority, title, summary, lifecycle, completed_at, resolved_at)
  values (v_user, v_si, 'x.a', 'profile', 20, 'A', 'x', 'completed', now() - interval '1 day', null),
         (v_user, v_wr, 'x.b', 'profile', 20, 'B', 'x', 'completed', now() - interval '1 day', null),
         (v_user, v_si, 'x.c', 'profile', 20, 'C', 'x', 'resolved',  null, now() - interval '1 day'),
         (v_user, null, 'x.d', 'profile', 20, 'D', 'x', 'completed', now() - interval '1 day', null),
         (v_user, v_si, 'x.e', 'profile', 20, 'E', 'x', 'completed', now() - interval '12 days', null);

  v := public.weekly_happened(v_user, v_si);

  assert (v ->> 'reviewsNew')::int = 2,       format('T1: reviewsNew 2 erwartet: %s', v);
  assert (v ->> 'negativeNew')::int = 1,      format('T1: negativeNew 1 erwartet: %s', v);
  assert (v ->> 'lowestNewRating')::int = 1,  format('T1: lowestNewRating 1 erwartet: %s', v);
  assert (v ->> 'unansweredTotal')::int = 1,  format('T1: unansweredTotal 1 erwartet: %s', v);
  assert (v ->> 'repliesPublished')::int = 1, format('T20: nur published, nur diese Woche: %s', v);
  assert (v ->> 'tasksCompleted')::int = 2,   format('T21: completed S&I + Konto = 2, nicht resolved, nicht WERKRUF, nicht alt: %s', v);
  assert (v ->> 'newestReviewAt') is not null, 'T1: newestReviewAt fehlt';

  /* Fremder Nutzer mit dem Standort von user_a: nichts */
  v := public.weekly_happened(test.id('user_b'), v_si);
  assert (v ->> 'reviewsNew')::int = 0 and (v ->> 'repliesPublished')::int = 0,
    format('T1: fremder Nutzer sieht Zahlen von user_a: %s', v);

  /* Ohne Betrieb: nur Konto-Aufgaben */
  v := public.weekly_happened(v_user, null);
  assert (v ->> 'reviewsNew')::int = 0 and (v ->> 'tasksCompleted')::int = 1,
    format('T1: ohne Betrieb nur Konto-Aufgaben: %s', v);

  /* T2–T4: check-Fakten */
  update public.google_locations set last_synced_at = now() - interval '5 hours' where id = v_si;
  v := public.weekly_check_facts(v_user, v_si);
  assert v ->> 'connectionStatus' = 'active', format('T2: active erwartet: %s', v);
  assert (v ->> 'syncAgeHours')::numeric between 4.9 and 5.1, format('T2: syncAgeHours ~5: %s', v);
  assert v ? 'openCount' and v ? 'dueCount' and v ? 'checkedAt', 'T2: Schluessel fehlen';

  /* C1 — Verbindung kaputt → connectionStatus sagt es, egal wie frisch der Sync */
  update public.google_accounts set status = 'needs_reauth' where id = test.id('konto_a');
  v := public.weekly_check_facts(v_user, v_si);
  assert v ->> 'connectionStatus' = 'needs_reauth', format('C1/T3: needs_reauth erwartet: %s', v);

  /* T4 — nie synchronisiert */
  update public.google_accounts set status = 'active' where id = test.id('konto_a');
  update public.google_locations set last_synced_at = null where id = v_si;
  v := public.weekly_check_facts(v_user, v_si);
  assert v ->> 'lastSyncedAt' is null and v ->> 'syncAgeHours' is null, format('T4: ohne Sync null: %s', v);

  /* Fremder Nutzer mit fremdem Betrieb: eigener Kontostatus, nie der von user_a */
  update public.google_accounts set status = 'needs_reauth' where id = test.id('konto_a');
  v := public.weekly_check_facts(test.id('user_b'), v_si);
  assert v ->> 'connectionStatus' = 'active' and v ->> 'lastSyncedAt' is null,
    format('T3: fremder Nutzer sieht Konto/Sync von user_a: %s', v);
  /* Nutzer ohne Konto: none */
  v := public.weekly_check_facts('00000000-0000-0000-0000-00000000dead', v_si);
  assert v ->> 'connectionStatus' = 'none', format('T3: ohne Konto → none: %s', v);
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T13 — Payload von schedule_communications
   ═══════════════════════════════════════════════════════ */
begin;
do $$
declare
  v_def text := pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure);
begin
  assert position('public.weekly_happened(' in v_def) > 0, 'T13: weekly_happened wird nicht gerufen';
  assert position('public.weekly_check_facts(' in v_def) > 0, 'T13: weekly_check_facts wird nicht gerufen';
  foreach v_def in array array['''happened''', '''check''', '''reviewsNew''', '''lowestNewRating''', '''newestReviewAt''', '''repliesPublished''', '''performance''']
  loop
    assert position(v_def in pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure)) > 0,
      format('T13: Payload-Schluessel %s fehlt', v_def);
  end loop;
  /* WP5 bleibt: keine vierte Vorlage */
  assert position('performance_report' in pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure)) = 0,
    'T13: neue Mailvorlage ist nicht Teil von WP6';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T27–T31 — record_delivery_event
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_user uuid := test.id('user_a');
  v_mail uuid;
  v_mail2 uuid;
  v_mid  text := '<202611090700.1@smtp-relay.mailin.fr>';
  v_mid2 text := '<202611090700.2@smtp-relay.mailin.fr>';
  v      jsonb;
  m      public.email_queue;
  v_n    integer;
begin
  v_mail := public.enqueue_email('weekly_summary', 'a@example.test', 'wk-1', v_user, 'A', '{}'::jsonb);
  update public.email_queue set status = 'sent', sent_at = now(), provider_id = v_mid where id = v_mail;
  v_mail2 := public.enqueue_email('weekly_summary', 'a@example.test', 'wk-2', v_user, 'A', '{}'::jsonb);
  update public.email_queue set status = 'sent', sent_at = now(), provider_id = v_mid2 where id = v_mail2;

  /* T30 — unbekannte Message-ID: gemeldet, nichts gespeichert */
  v := public.record_delivery_event('<gibtsnicht@x>', 'delivered', now());
  assert v ->> 'result' = 'unknown_message', format('T30: %s', v);
  assert (select count(*) from public.communication_delivery_events) = 0, 'T30: Ereignis trotz unbekannter ID gespeichert';
  v := public.record_delivery_event(null, 'delivered', now());
  assert v ->> 'result' = 'unknown_message', 'T30: null-ID';

  /* T27 — delivered */
  v := public.record_delivery_event(v_mid, 'delivered', '2026-11-09 07:01+00');
  assert v ->> 'result' = 'recorded' and (v ->> 'emailId')::uuid = v_mail, format('T27: %s', v);
  select * into m from public.email_queue where id = v_mail;
  assert m.delivery_status = 'delivered' and m.delivered_at = '2026-11-09 07:01+00', 'T27: delivered nicht gesetzt';
  assert m.first_opened_at is null and m.open_count = 0, 'T27: delivered zaehlt nicht als Open';

  /* T31 — exakt dasselbe Ereignis nochmal: duplicate, keine zweite Zeile */
  v := public.record_delivery_event(v_mid, 'delivered', '2026-11-09 07:01+00');
  assert v ->> 'result' = 'duplicate', format('T31: %s', v);
  assert (select count(*) from public.communication_delivery_events where email_id = v_mail) = 1, 'T31: Duplikat gespeichert';

  /* T28 — erstes Open */
  v := public.record_delivery_event(v_mid, 'opened', '2026-11-09 08:00+00');
  assert v ->> 'result' = 'recorded', format('T28: %s', v);
  select * into m from public.email_queue where id = v_mail;
  assert m.first_opened_at = '2026-11-09 08:00+00' and m.last_opened_at = '2026-11-09 08:00+00' and m.open_count = 1,
    format('T28: first/last/count nach erstem Open falsch: %s %s %s', m.first_opened_at, m.last_opened_at, m.open_count);

  /* C4 — zweites Open: first bleibt, last wandert, count 2 — die Mail bleibt EINE Mail */
  v := public.record_delivery_event(v_mid, 'opened', '2026-11-09 09:30+00');
  select * into m from public.email_queue where id = v_mail;
  assert m.first_opened_at = '2026-11-09 08:00+00', 'C4: first_opened_at wurde ueberschrieben';
  assert m.last_opened_at = '2026-11-09 09:30+00', 'C4: last_opened_at nicht fortgeschrieben';
  assert m.open_count = 2, format('C4: open_count 2 erwartet: %s', m.open_count);
  assert m.delivery_status = 'delivered', 'C4: Open hat den Zustellstatus veraendert';
  /* Dasselbe zweite Open nochmal (Brevo-Retry): count bleibt 2 */
  v := public.record_delivery_event(v_mid, 'opened', '2026-11-09 09:30+00');
  assert v ->> 'result' = 'duplicate', 'C4: Retry nicht als Duplikat erkannt';
  select open_count into v_n from public.email_queue where id = v_mail;
  assert v_n = 2, format('C4: Retry hat open_count erhoeht: %s', v_n);
  /* Open mit aelterem Zeitstempel (Reihenfolge vertauscht): first wandert nach vorn, last bleibt */
  perform public.record_delivery_event(v_mid, 'opened', '2026-11-09 07:30+00');
  select * into m from public.email_queue where id = v_mail;
  assert m.first_opened_at = '2026-11-09 07:30+00' and m.last_opened_at = '2026-11-09 09:30+00', 'C4: Reihenfolge der Opens falsch verarbeitet';

  /* T29 — Hard Bounce auf der zweiten Mail: nicht zugestellt */
  v := public.record_delivery_event(v_mid2, 'hard_bounce', '2026-11-09 07:02+00');
  select * into m from public.email_queue where id = v_mail2;
  assert m.delivery_status = 'hard_bounce' and m.delivered_at is null, 'T29: Hard Bounce als zugestellt gefuehrt';

  /* Ereignisse tragen nur das Noetige */
  assert (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'communication_delivery_events'
             and column_name in ('ip', 'ip_address', 'user_agent', 'email', 'to_email', 'body', 'payload')) = 0,
    'Datenschutz: communication_delivery_events hat Spalten fuer IP/User-Agent/Adresse/Inhalt';

  /* Kontrolle: jedes Ereignis gehoert zur richtigen Mail und Vorlage */
  assert (select bool_and(template = 'weekly_summary' and user_id = v_user) from public.communication_delivery_events),
    'Ereignis falsch zugeordnet';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T16/T17/T18/T23 + C2..C8 — Cockpit
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
insert into test.bezeichner (name, id) values
  ('standort_fremd', '77777777-7777-7777-7777-777777777777')
on conflict (name) do nothing;
select test.standort('standort_fremd', 'user_b', 'konto_b', 'Fremdbetrieb', true);

do $$
declare
  v_a    uuid := test.id('user_a');
  v_b    uuid := test.id('user_b');
  v_si   uuid := test.id('standort_si');
  v_wr   uuid := test.id('standort_werkruf');
  v_rev  uuid;
  v_m    uuid;
  v      jsonb;
  z      jsonb;
  v_loc  jsonb;
  i      integer;
  v_ok   boolean;
begin
  /* Nur user_a ist FP; user_b ist Kunde mit eigenen Daten */
  perform public.set_founding_partner(v_a, 'Test');

  /* 4 Montagsmails: 3 zugestellt (2 davon geoeffnet), 1 nur gesendet ohne Zustellereignis */
  for i in 1..4 loop
    v_m := public.enqueue_email('weekly_summary', 'a@example.test', 'wk-' || i, v_a, 'A', '{}'::jsonb);
    update public.email_queue set status = 'sent', sent_at = now() - (i || ' days')::interval,
           created_at = now() - (i || ' days')::interval, provider_id = '<m' || i || '@b>' where id = v_m;
    if i <= 3 then perform public.record_delivery_event('<m' || i || '@b>', 'delivered', now() - (i || ' days')::interval); end if;
    if i <= 2 then perform public.record_delivery_event('<m' || i || '@b>', 'opened',    now() - (i || ' days')::interval + interval '1 hour'); end if;
  end loop;
  /* Alte Mail ausserhalb 28 Tage: zugestellt+geoeffnet, darf nicht zaehlen */
  v_m := public.enqueue_email('weekly_summary', 'a@example.test', 'wk-alt', v_a, 'A', '{}'::jsonb);
  update public.email_queue set status = 'sent', created_at = now() - interval '40 days', provider_id = '<alt@b>' where id = v_m;
  perform public.record_delivery_event('<alt@b>', 'delivered', now() - interval '40 days');
  perform public.record_delivery_event('<alt@b>', 'opened',    now() - interval '40 days');

  /* Bewertungen: S&I 2, WERKRUF 1, Fremd 5 */
  perform test.bewertungen('standort_si', 2, 5, true, '3 days');
  perform test.bewertungen('standort_werkruf', 1, 5, true, '3 days');
  perform test.bewertungen('standort_fremd', 5, 5, true, '3 days');

  /* Antworten: S&I 1 published + 1 draft; WERKRUF 1 published */
  select id into v_rev from public.google_reviews where location_id = v_si limit 1;
  insert into public.review_replies (review_id, location_id, user_id, body, status, published_at)
  /* Der Draft traegt absichtlich ein published_at (zurueckgezogene
     Antwort): nur der Status darf entscheiden, nicht der Zeitstempel. */
  values (v_rev, v_si, v_a, 'x', 'published', now() - interval '2 days'),
         (v_rev, v_si, v_a, 'x', 'draft', now() - interval '2 days'),
         (v_rev, v_si, v_a, 'x', 'approved', now() - interval '2 days'),
         (v_rev, v_si, v_a, 'x', 'failed', now() - interval '2 days');
  select id into v_rev from public.google_reviews where location_id = v_wr limit 1;
  insert into public.review_replies (review_id, location_id, user_id, body, status, published_at)
  values (v_rev, v_wr, v_a, 'x', 'published', now() - interval '2 days');

  /* Aufgaben: S&I 2 completed (eine vor 20 Tagen), WERKRUF 1, Konto 1; resolved zaehlt nicht */
  insert into public.events (user_id, location_id, type, category, priority, title, summary, lifecycle, completed_at, resolved_at)
  values (v_a, v_si, 'x.1', 'profile', 20, 'A', 'x', 'completed', now() - interval '1 day', null),
         (v_a, v_si, 'x.2', 'profile', 20, 'B', 'x', 'completed', now() - interval '20 days', null),
         (v_a, v_wr, 'x.3', 'profile', 20, 'C', 'x', 'completed', now() - interval '2 days', null),
         (v_a, null, 'x.4', 'profile', 20, 'D', 'x', 'completed', now() - interval '2 days', null),
         (v_a, v_si, 'x.5', 'profile', 20, 'E', 'x', 'resolved',  null, now() - interval '1 day'),
         (v_b, null, 'x.6', 'profile', 20, 'F', 'x', 'completed', now() - interval '1 day', null);

  /* Action-Links: 1 konsumiert, 1 nur gescannt (last_used_at ohne consumed_at) */
  insert into public.action_tokens (token_hash, user_id, location_id, purpose, target_path, expires_at, consumed_at, last_used_at, use_count)
  values ('h1', v_a, v_si, 'event.open', '/x', now() + interval '1 day', now() - interval '1 day', now() - interval '1 day', 1),
         ('h2', v_a, v_si, 'event.open', '/x', now() + interval '1 day', null, now() - interval '1 day', 3);

  v := public.fp_cockpit_overview();

  /* T16/C7 — nur FPs */
  assert jsonb_array_length(v -> 'partners') = 1, format('T16: genau ein FP erwartet: %s', v -> 'partners');
  z := v -> 'partners' -> 0;
  assert (z ->> 'userId')::uuid = v_a, 'T16: falscher Partner';
  assert (v -> 'kpis' ->> 'foundingPartners')::int = 1, 'T16: KPI foundingPartners';

  /* T18/C3 — Oeffnungsrate = 2 / 3 zugestellte (nicht / 4 gesendete, nicht mit der alten) */
  assert (v -> 'kpis' ->> 'weeklyDelivered28d')::int = 3, format('T18: 3 zugestellt erwartet: %s', v -> 'kpis');
  assert (v -> 'kpis' ->> 'weeklyOpened28d')::int = 2,    format('T18: 2 geoeffnet erwartet: %s', v -> 'kpis');
  assert (v -> 'kpis' ->> 'openRate28d')::numeric = 0.667, format('C3: 0.667 erwartet: %s', v -> 'kpis' ->> 'openRate28d');
  assert (v -> 'kpis' ->> 'deliveryTrackingActive')::boolean, 'T18: Tracking aktiv erwartet';
  assert (v -> 'kpis' ->> 'reviewLinkMeasurable')::boolean = false, 'T16: Bewertungslink darf nicht als messbar gelten';
  assert (z ->> 'weeklyDelivered28d')::int = 3 and (z ->> 'weeklyOpened28d')::int = 2, 'T18: je Partner';
  assert (z -> 'lastWeeklyMail' ->> 'openCount')::int = 1, 'T18: letzte Mail: 1 Open';

  /* C6 — Draft/approved zaehlen nicht */
  assert (z ->> 'repliesPublished30d')::int = 2, format('C6: 2 published (S&I + WERKRUF), kein draft/approved: %s', z ->> 'repliesPublished30d');
  assert (z ->> 'repliesPublished7d')::int = 2, 'C6: 7 Tage';

  /* Aufgaben konto-weit, nur completed */
  assert (z ->> 'tasksCompleted7d')::int = 3,  format('T21: 3 completed in 7 Tagen: %s', z ->> 'tasksCompleted7d');
  assert (z ->> 'tasksCompleted30d')::int = 4, format('T21: 4 completed in 30 Tagen: %s', z ->> 'tasksCompleted30d');
  assert (z ->> 'activeWeeks4')::int between 1 and 2, format('T21: activeWeeks4 1..2: %s', z ->> 'activeWeeks4');
  assert (v -> 'kpis' ->> 'activeLast7d')::int = 1, 'T21: activeLast7d zaehlt user_b (kein FP) mit';

  /* Action-Links: nur bewusst konsumierte */
  assert (z ->> 'actionLinks30d')::int = 1, format('Action-Links: nur consumed zaehlt: %s', z ->> 'actionLinks30d');

  /* Bewertungen: nur user_a, alle Betriebe */
  assert (z ->> 'newReviews30d')::int = 3, format('Bewertungen 3 erwartet: %s', z ->> 'newReviews30d');
  assert (v -> 'kpis' ->> 'newReviews30d')::int = 3, 'KPI Bewertungen zaehlt Fremde mit';
  assert (z ->> 'locationCount')::int = 2, 'locationCount';
  assert z ->> 'email' = 'a@example.test' or z ? 'email', 'E-Mail-Schluessel';
  assert z -> 'feedback' is null or z ->> 'feedback' is null, 'Feedback vor Setzen nicht leer';

  /* T17 — Detail trennt Betriebe */
  v := public.fp_cockpit_detail(v_a);
  assert jsonb_array_length(v -> 'locations') = 2, format('T17: 2 Betriebe erwartet: %s', v -> 'locations');
  select l into v_loc from jsonb_array_elements(v -> 'locations') l where (l ->> 'locationId')::uuid = v_si;
  assert (v_loc ->> 'tasksCompleted30d')::int = 2, format('T17: S&I 2 completed: %s', v_loc);
  assert (v_loc ->> 'repliesPublished30d')::int = 1, format('T17: S&I 1 published: %s', v_loc);
  assert (v_loc ->> 'newReviews30d')::int = 2, format('T17: S&I 2 Bewertungen: %s', v_loc);
  assert (v_loc ->> 'actionLinks30d')::int = 1, format('T17: S&I 1 Action-Link: %s', v_loc);
  assert (v_loc ->> 'selected')::boolean, 'T17: S&I gewaehlt';
  select l into v_loc from jsonb_array_elements(v -> 'locations') l where (l ->> 'locationId')::uuid = v_wr;
  assert (v_loc ->> 'tasksCompleted30d')::int = 1 and (v_loc ->> 'repliesPublished30d')::int = 1 and (v_loc ->> 'newReviews30d')::int = 1,
    format('T17: WERKRUF getrennt: %s', v_loc);
  assert (v ->> 'accountTasksCompleted30d')::int = 1, 'T17: Konto-Aufgabe';
  assert jsonb_array_length(v -> 'weeklyMails') = 4, format('T17: letzte 4 Mails: %s', jsonb_array_length(v -> 'weeklyMails'));

  /* Detail eines Nicht-FP: nichts */
  v := public.fp_cockpit_detail(v_b);
  assert v is null or v = 'null'::jsonb or v -> 'userId' is null, format('C7: Detail fuer Nicht-FP liefert Daten: %s', v);

  /* T23 — Zahlungsbereitschaft */
  perform public.set_founding_partner_feedback(v_a, 'ja', ' zahlt gern ', null);
  v := public.fp_cockpit_overview();
  assert (v -> 'kpis' ->> 'yesTo49')::int = 1, 'T23: yesTo49';
  assert v -> 'partners' -> 0 -> 'feedback' ->> 'paymentIntent' = 'ja', 'T23: Feedback in der Zeile';
  perform public.set_founding_partner_feedback(v_a, 'eher_nein', null, null);
  v := public.fp_cockpit_overview();
  assert (v -> 'kpis' ->> 'yesTo49')::int = 0, 'T23: Aenderung nicht uebernommen';
  assert (select count(*) from public.founding_partner_feedback where user_id = v_a) = 1, 'T23: zweite Zeile statt Update';

  v_ok := false;
  begin
    perform public.set_founding_partner_feedback(v_a, 'vielleicht', null, null);
  exception when others then v_ok := true;
  end;
  assert v_ok, 'T23: ungueltiger Wert angenommen';

  v_ok := false;
  begin
    perform public.set_founding_partner_feedback(v_b, 'ja', null, null);
  exception when invalid_parameter_value then v_ok := true;
  end;
  assert v_ok, 'C7/T23: Feedback fuer Nicht-FP angenommen';
  assert (select count(*) from public.founding_partner_feedback where user_id = v_b) = 0, 'C7: Zeile fuer Nicht-FP';

  /* Ohne Zustellereignisse: Rate null, Tracking inaktiv */
  delete from public.communication_delivery_events;
  update public.email_queue set delivery_status = null, first_opened_at = null, last_opened_at = null, open_count = 0, delivered_at = null;
  v := public.fp_cockpit_overview();
  assert (v -> 'kpis' ->> 'deliveryTrackingActive')::boolean = false, 'ohne Ereignisse: Tracking aktiv behauptet';
  assert v -> 'kpis' ->> 'openRate28d' is null, 'ohne Zustellung: Rate statt null';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Rechte — C5: ein normaler Nutzer kommt an nichts heran
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_zu boolean;
  f    text;
begin
  foreach f in array array[
    'public.weekly_happened(uuid, uuid, timestamptz)',
    'public.weekly_check_facts(uuid, uuid, timestamptz)',
    'public.record_delivery_event(text, text, timestamptz)',
    'public.set_founding_partner_feedback(uuid, text, text, uuid)',
    'public.fp_cockpit_overview(timestamptz)',
    'public.fp_cockpit_detail(uuid, timestamptz)']
  loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('C5: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('C5: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('service_role darf %s nicht', f);
  end loop;
  foreach f in array array['public.communication_delivery_events', 'public.founding_partner_feedback']
  loop
    assert not pg_catalog.has_table_privilege('authenticated', f, 'SELECT'), format('C5: authenticated liest %s', f);
    assert not pg_catalog.has_table_privilege('anon', f, 'SELECT'), format('C5: anon liest %s', f);
    assert (select relrowsecurity from pg_class where oid = f::regclass), format('%s ohne RLS', f);
  end loop;

  /* Wirkung: als authenticated (eigene uid) ruft das Cockpit → Fehler */
  perform set_config('request.jwt.claim.sub', test.id('user_a')::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', test.id('user_a'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_zu := false;
  begin
    perform public.fp_cockpit_overview();
  exception when insufficient_privilege then v_zu := true;
  end;
  assert v_zu, 'C5: authenticated konnte fp_cockpit_overview ausfuehren';
  v_zu := false;
  begin
    perform public.set_founding_partner_feedback(test.id('user_a'), 'ja', null, null);
  exception when insufficient_privilege then v_zu := true;
  end;
  assert v_zu, 'C8: Kunde konnte seinen 49-€-Status selbst setzen';
  v_zu := false;
  begin
    perform count(*) from public.founding_partner_feedback;
  exception when insufficient_privilege then v_zu := true;
  end;
  assert v_zu, 'C8: Kunde liest founding_partner_feedback';
  v_zu := false;
  begin
    perform count(*) from public.communication_delivery_events;
  exception when insufficient_privilege then v_zu := true;
  end;
  assert v_zu, 'C5: Kunde liest communication_delivery_events';
  reset role;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   FK — Nutzer loeschen raeumt auf
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_a uuid := test.id('user_a');
  v_m uuid;
begin
  perform public.set_founding_partner(v_a, 'Test');
  perform public.set_founding_partner_feedback(v_a, 'ja', null, null);
  v_m := public.enqueue_email('weekly_summary', 'a@example.test', 'wk-1', v_a, 'A', '{}'::jsonb);
  update public.email_queue set provider_id = '<x@b>' where id = v_m;
  perform public.record_delivery_event('<x@b>', 'delivered', now());
  assert (select count(*) from public.communication_delivery_events) = 1;

  delete from auth.users where id = v_a;

  assert (select count(*) from public.communication_delivery_events) = 0, 'FK: Ereignisse ueberleben den Nutzer';
  assert (select count(*) from public.founding_partner_feedback where user_id = v_a) = 0, 'FK: Feedback ueberlebt den Nutzer';
end $$;
rollback;

select '[wp6] wochenstatusFpCockpit: alle Abschnitte bestanden' as ergebnis;
