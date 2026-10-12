-- Abnahme fuer die Haerte des Testschemas (Paket G1).
--
--   scripts/test-db/run.sh schemaHaerte
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Dreizehn SQL-Tests waren monatelang gruen und erzeugten dabei Daten,
-- die Produktion nicht zulaesst: Standorte ohne Konto, Konten ohne
-- Google-Kennung. Nicht weil die Tests schlecht waren, sondern weil die
-- Testdatenbank weicher war als Produktion.
--
-- Ein Test kann das nicht bemerken. Er sieht nur, dass sein Insert
-- durchgeht.
--
-- Diese Datei dreht die Richtung: Sie versucht absichtlich, Daten
-- anzulegen, die Produktion ablehnen muss, und besteht nur, wenn die
-- Datenbank sie ablehnt. Wird das Testschema je wieder aufgeweicht,
-- faellt es hier auf — und nicht erst, wenn ein Deploy an einer
-- Pflichtspalte scheitert.
--
-- Die beiden Spalten unten sind genau die, an denen der Befund hing.

\set ON_ERROR_STOP on

begin;

select test.basis();

/* ═══════════════════════════════════════════════════════
   1 — google_locations ohne account_id
   ═══════════════════════════════════════════════════════

   Baseline Zeile 3445: account_id uuid NOT NULL */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    insert into public.google_locations
      (id, user_id, account_resource_name, location_resource_name, title)
    values ('dead0001-0000-0000-0000-000000000001',
            test.id('user_a'), 'accounts/1', 'locations/1', 'Ohne Konto');
  exception when not_null_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    '1: google_locations.account_id muss NOT NULL sein — das Testschema ist weicher als Produktion';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — google_accounts ohne provider_account_id
   ═══════════════════════════════════════════════════════

   Baseline Zeile 635: provider_account_id text NOT NULL */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    insert into public.google_accounts (id, user_id, status)
    values ('dead0002-0000-0000-0000-000000000002', test.id('user_a'), 'active');
  exception when not_null_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    '2: google_accounts.provider_account_id muss NOT NULL sein';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Standort an einem Konto, das es nicht gibt
   ═══════════════════════════════════════════════════════

   Ein Fremdschluessel, den G1 ergaenzt hat. Ohne ihn konnte ein Test
   eine Location an eine erfundene Konto-UUID haengen, und niemand
   merkte es — die Pflichtspalte war gefuellt, nur eben mit Unsinn. */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    insert into public.google_locations
      (id, user_id, account_id, account_resource_name, location_resource_name, title)
    values ('dead0003-0000-0000-0000-000000000003',
            test.id('user_a'),
            '00000000-0000-0000-0000-0000000000ff',   -- gibt es nicht
            'accounts/1', 'locations/1', 'Erfundenes Konto');
  exception when foreign_key_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    '3: account_id muss auf ein existierendes google_accounts.id zeigen';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Konto fuer einen Nutzer, den es nicht gibt
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    insert into public.google_accounts
      (id, user_id, provider, provider_account_id, status)
    values ('dead0004-0000-0000-0000-000000000004',
            '00000000-0000-0000-0000-0000000000ff',   -- gibt es nicht
            'google', 'accounts/999', 'active');
  exception when foreign_key_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    '4: google_accounts.user_id muss auf auth.users zeigen';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Die Pflichtspalten von google_reviews
   ═══════════════════════════════════════════════════════

   Fuenf davon, und drei liessen die alten Tests weg. Deshalb gibt es
   test.bewertungen(). */
do $$
declare v_abgewiesen boolean := false;
begin
  begin
    insert into public.google_reviews
      (location_id, user_id, star_rating, is_answered)
    values (test.id('standort_si'), test.id('user_a'), 1, false);
  exception when not_null_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    '5: google_reviews braucht account_id, review_resource_name und google_created_at';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — recommendation_events.id fuellt sich selbst
   ═══════════════════════════════════════════════════════

   Die Baseline hat "id bigint NOT NULL" ohne Default, weil pg_dump die
   Sequenz getrennt schreibt und dieser Teil abgeschnitten ist.
   20-baseline-luecken.sql ergaenzt eine Identity. Ohne sie scheitert
   jeder Lauf der Engine. */
do $$
declare v_event uuid; v_id bigint;
begin
  insert into public.events
    (user_id, location_id, type, category, priority, title, summary)
  values (test.id('user_a'), test.id('standort_si'),
          'profile.photos_missing', 'profile', 30, 'Haertetest', 'x')
  returning id into v_event;

  insert into public.recommendation_events (event_id, user_id, action, channel)
  values (v_event, test.id('user_a'), 'created', 'engine')
  returning id into v_id;

  assert v_id is not null, '6: recommendation_events.id vergibt sich selbst';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — ON CONFLICT findet seinen Index
   ═══════════════════════════════════════════════════════

   Diese Klauseln stehen in produktivem Code. Fehlt der Index, wirft
   nicht ein Test, sondern die Anwendung — zur Laufzeit. */
do $$
begin
  insert into public.notification_preferences (user_id)
  values (test.id('user_a')) on conflict (user_id) do nothing;

  insert into public.email_queue (to_email, template, dedupe_key, payload)
  values ('x@example.test', 'weekly_summary', 'haertetest:1', '{}'::jsonb)
  on conflict (dedupe_key) do nothing;

  insert into public.email_queue (to_email, template, dedupe_key, payload)
  values ('x@example.test', 'weekly_summary', 'haertetest:1', '{}'::jsonb)
  on conflict (dedupe_key) do nothing;

  assert (select count(*) from public.email_queue
           where dedupe_key = 'haertetest:1') = 1,
    '7: der Dedupe-Schluessel ist eindeutig';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Keine Testdatei baut Produktionstabellen nachbildend nach
   ═══════════════════════════════════════════════════════

   Gegenprobe zu Punkt 42 des Auftrags: ops_alerts_resolution.test.sql
   legte public.sync_jobs selbst an, in einer vereinfachten Fassung.
   Dieser Abschnitt prueft, dass keine Testdatei das wieder tut.

   Der Test liest dazu die Testdateien selbst — ueber pg_read_file,
   beschraenkt auf das Datenverzeichnis, geht das nicht. Also prueft er
   die Wirkung statt des Texts: existiert sync_jobs mit seinen echten
   Spalten? Eine nachgebildete Fassung haette weniger. */
do $$
declare v_spalten integer;
begin
  select count(*) into v_spalten
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sync_jobs';

  /* Die echte Tabelle aus der Baseline. Die nachgebildete hatte elf. */
  assert v_spalten > 11,
    format('8: public.sync_jobs hat %s Spalten — das sieht nach einer Nachbildung aus', v_spalten);

  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sync_jobs'
       and column_name = 'payload'),
    '8: sync_jobs.payload fehlt — die Nachbildung hatte diese Spalte nicht';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
