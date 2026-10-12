-- 90-fingerprint.sql
--
-- Ist das Schema so hart wie Produktion?
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM AM ENDE DES SETUPS UND NICHT IM TEST
-- ═══════════════════════════════════════════════════════════════
--
-- Der Fehler, den G1 behebt, war nicht ein falscher Test. Es war eine
-- falsche Datenbank: account_id war nullable, und dreizehn Tests waren
-- deshalb gruen. Ein Test kann das nicht bemerken — er sieht nur, dass
-- sein Insert durchgeht.
--
-- Diese Datei prueft daher die Datenbank selbst, einmal, bevor
-- irgendein Test laeuft. Sie ist der Grund, aus dem "alle SQL-Tests
-- gruen" wieder etwas bedeutet.
--
-- WAS SIE PRUEFT
--
--   1. die beiden Pflichtspalten aus dem Befund
--   2. Pflichtspalten der tragenden Tabellen
--   3. Eindeutigkeit, auf die ON CONFLICT angewiesen ist
--   4. die Fremdschluessel, die G1 ergaenzt hat
--   5. die zentralen Funktionen des Empfehlungspfads
--   6. dass die Fixtures Daten erzeugen, die das Schema akzeptiert
--
-- WAS SIE NICHT IST
--
-- Kein Schema-Diff gegen Produktion. Dafuer braeuchte es einen
-- vollstaendigen Dump — den gibt es nicht, siehe
-- docs/testing/baseline-luecken.md. Dieser Fingerprint prueft die
-- Eigenschaften, von denen Tests abhaengen, nicht das ganze Schema.
--
-- Jede Verletzung wirft. Das Setup endet dann mit Exit-Code ungleich 0.

do $$
declare
  v_fehlt text[] := array[]::text[];
  v_zeile record;
  v_funktion text;
begin

  /* ═══════════════════════════════════════════════════════════
     1 + 2 — PFLICHTSPALTEN
     ═══════════════════════════════════════════════════════════

     Die ersten zwei Zeilen sind der Befund, der G1 ausgeloest hat.
     Waere eine davon nullable, waere die ganze Uebung sinnlos.

     Die Liste ist aus der Baseline abgelesen, nicht gewaehlt. Beim
     ersten Lauf stand hier email_queue.user_id — aus der Annahme, eine
     Mail gehoere immer zu einem Nutzer. Die Baseline sagt
     "user_id uuid", also nullable: die Tabelle traegt auch Mails ohne
     Konto, etwa aus dem oeffentlichen Funnel. Die Annahme war falsch,
     und der Fingerprint haette eine Haerte behauptet, die Produktion
     nicht hat. Hier gehoert nur hin, was in der Baseline steht. */

  for v_zeile in
    select * from (values
      ('google_locations', 'account_id'),          -- Befund 1
      ('google_accounts',  'provider_account_id'), -- Befund 2
      ('google_locations', 'user_id'),
      ('google_locations', 'account_resource_name'),
      ('google_locations', 'location_resource_name'),
      ('google_accounts',  'user_id'),
      ('events',           'user_id'),
      ('events',           'type'),
      ('events',           'title'),
      ('email_queue',      'to_email'),
      ('email_queue',      'template'),
      ('email_queue',      'dedupe_key'),
      ('action_tokens',    'user_id'),
      ('action_tokens',    'token_hash'),
      ('action_tokens',    'expires_at')
    ) as s(tabelle, spalte)
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = ('public.' || v_zeile.tabelle)::regclass
         and a.attname  = v_zeile.spalte
         and a.attnotnull
         and a.attnum > 0
         and not a.attisdropped
    ) then
      v_fehlt := v_fehlt || pg_catalog.format(
        'NOT NULL fehlt oder Spalte unbekannt: %s.%s',
        v_zeile.tabelle, v_zeile.spalte);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     2b — recommendation_events.id FUELLT SICH SELBST
     ═══════════════════════════════════════════════════════════

     Die Baseline definiert "id bigint NOT NULL" ohne Default, weil
     pg_dump die Sequenz getrennt schreibt und dieser Teil fehlt.
     20-baseline-luecken.sql ergaenzt eine Identity.

     Diese Pruefung steht hier, weil der erste Entwurf dort nicht
     griff und der Fehler dann in openingHours.test.sql auftauchte —
     als "null value in column id", zwanzig Aufrufe entfernt von der
     Ursache. Eine Setupluecke soll im Setup auffallen. */

  if not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.recommendation_events'::regclass
       and a.attname = 'id'
       and (a.attidentity <> '' or a.atthasdef)
  ) then
    v_fehlt := v_fehlt ||
      'recommendation_events.id hat weder Identity noch Default';
  end if;

  /* ═══════════════════════════════════════════════════════════
     3 — EINDEUTIGKEIT
     ═══════════════════════════════════════════════════════════

     Ohne diese Indizes scheitert kein Test — es scheitert
     produktiver Code, der ON CONFLICT verwendet. Und zwar erst zur
     Laufzeit. */

  for v_zeile in
    select * from (values
      ('email_queue',              'email_queue_dedupe_key_idx'),
      ('notification_preferences', 'notification_preferences_user_idx'),
      ('ops_alert_log',            'ops_alert_log_key_idx'),
      ('weekly_snapshots',         'weekly_snapshots_user_week_idx'),
      ('sync_jobs',                'sync_jobs_reply_aktiv_idx'),
      ('sync_jobs',                'sync_jobs_location_aktiv_idx')
    ) as s(tabelle, index_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.relname = v_zeile.index_name
         and n.nspname = 'public'
         and c.relkind = 'i'
    ) then
      v_fehlt := v_fehlt || pg_catalog.format(
        'Unique-Index fehlt: %s auf %s', v_zeile.index_name, v_zeile.tabelle);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     4 — FREMDSCHLUESSEL
     ═══════════════════════════════════════════════════════════

     Damit ein Test, der eine Location an ein Konto haengt, das es
     nicht gibt, auch wirklich scheitert. */

  for v_zeile in
    select * from (values
      ('google_locations', 'google_locations_account_id_fkey'),
      ('google_locations', 'google_locations_user_id_fkey'),
      ('google_accounts',  'google_accounts_user_id_fkey')
    ) as s(tabelle, constraint_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
       where conname  = v_zeile.constraint_name
         and conrelid = ('public.' || v_zeile.tabelle)::regclass
         and contype  = 'f'
    ) then
      v_fehlt := v_fehlt || pg_catalog.format(
        'Fremdschluessel fehlt: %s', v_zeile.constraint_name);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     5 — FUNKTIONEN DES EMPFEHLUNGSPFADS
     ═══════════════════════════════════════════════════════════

     Fehlt eine, ist eine Migration nicht durchgelaufen — und der
     Test, der sie braucht, wuerde mit "function does not exist"
     scheitern, was nach einem Testfehler aussieht statt nach einem
     Setupfehler. */

  foreach v_funktion in array array[
    'canonical_recommendation_events',
    'events_feed',
    'top_recommendations_for_email',
    'plan_communications',
    'schedule_communications',
    'build_location_evaluation_context',
    'werkruf_score_location',
    'weekly_event_is_due',
    'weekly_next_due_at',
    'weekly_counts',
    'priority_stufe',
    'resolve_action_token',
    'consume_action_token',
    'consume_action_auth_state',
    'finish_email'
  ]
  loop
    if not exists (
      select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_funktion
    ) then
      v_fehlt := v_fehlt || pg_catalog.format(
        'Funktion fehlt: public.%s', v_funktion);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     ERGEBNIS
     ═══════════════════════════════════════════════════════════ */

  if pg_catalog.array_length(v_fehlt, 1) > 0 then
    raise exception E'Testschema weicht von Produktion ab:\n  %',
      pg_catalog.array_to_string(v_fehlt, E'\n  ')
      using hint = 'Siehe docs/testing/sql-test-db.md.';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════════
   6 — DIE FIXTURES GEGEN DAS HARTE SCHEMA
   ═══════════════════════════════════════════════════════════════

   Ein Fingerprint, der nur Katalogtabellen liest, prueft nicht, ob
   die Fixtures benutzbar sind. Also einmal wirklich anlegen — und
   wieder zuruecknehmen. */

begin;

do $$
begin
  perform test.basis();
  perform test.fremder();

  if not exists (
    select 1 from public.google_locations
     where id = test.id('standort_si') and account_id = test.id('konto_a')
  ) then
    raise exception 'test.basis() haengt S&I. nicht an konto_a';
  end if;

  if (select count(*) from public.google_locations
       where user_id = test.id('user_a') and selected_at is not null) <> 1 then
    raise exception 'test.basis() hat nicht genau einen gewaehlten Standort';
  end if;
end $$;

rollback;
