-- SmartCheck-Leads: der Browser darf nicht direkt schreiben (Paket H1).
--
--   scripts/test-db/run.sh smartcheckLead
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESER TEST IN SQL STEHT UND NICHT IN JEST
-- ═══════════════════════════════════════════════════════════════
--
-- src/components/smartCheckLead.test.js prueft, was der Besucher
-- sieht. Es kann nicht pruefen, ob die Datenbank einen direkten
-- Schreibversuch wirklich abweist — dort ist der Client gemockt, und
-- ein Mock bestaetigt, was man ihm sagt.
--
-- Diese Datei prueft die Wirkung: sie versucht als anon und als
-- authenticated in public.leads zu schreiben und besteht nur, wenn
-- beides scheitert.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DAS MEHR IST ALS EINE DOPPELUNG DES G2.2-TESTS
-- ═══════════════════════════════════════════════════════════════
--
-- defaultRechte.test.sql prueft NEUE Objekte: deny by default greift
-- fuer alles, was ab jetzt entsteht. public.leads ist aber alt — sie
-- stammt aus der Baseline und traegt die Rechte, die sie damals
-- bekommen hat. Fuer eine bestehende Tabelle sagt der G2.2-Test
-- nichts.
--
-- Und genau hier kam der Fix her: der naheliegende Weg waere gewesen,
-- anon ein INSERT zu geben. Dieser Test ist die Bremse dagegen. Wer
-- ihn gruen bekommen will, indem er ein Grant hinzufuegt, macht ihn
-- rot.
--
-- Alles laeuft in einer Transaktion und wird zurueckgerollt.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════
   1 — DER BROWSERWEG MUSS SCHEITERN
   ═══════════════════════════════════════════════════════

   Zwei Rollen, zwei Gruende, derselbe Ausgang:

     anon            der oeffentliche Schluessel im Browser-Bundle
     authenticated   ein angemeldeter Kunde, der das Formular
                     ebenfalls erreichen kann

   Geprueft wird der AUSGANG, nicht der Mechanismus. Ein fehlender
   Grant wirft insufficient_privilege, eine fehlende Policy bei
   aktivem RLS wirft eine Policy-Verletzung — beides ist richtig, und
   welcher von beiden greift, haengt davon ab, ob Supabase seine
   Vorgaberechte gesetzt hat. Ein Test, der auf einen bestimmten
   Fehlercode besteht, wuerde in der Testdatenbank und in Produktion
   verschieden ausgehen. */

do $$
declare
  v_rolle       text;
  v_durchgelassen text[] := array[]::text[];
  v_mechanismus text;
begin
  foreach v_rolle in array array['anon', 'authenticated']
  loop
    perform pg_catalog.set_config('role', v_rolle, true);

    begin
      insert into public.leads (company_name, contact_person, phone, email, source, status)
      values ('Direktschreiber GmbH', '-', '-', 'direkt@beispiel.de', 'smart_check', 'new');

      /* Kein Fehler? Dann ist der Weg offen. */
      v_durchgelassen := v_durchgelassen || v_rolle::text;
    exception
      when insufficient_privilege then
        v_mechanismus := 'kein Grant';
      when others then
        /* Policy-Verletzung bei aktivem RLS kommt als
           sqlstate 42501 oder als check_violation zurueck,
           je nach PostgreSQL-Version und Art der Policy. Beides ist
           ein abgewiesener Schreibversuch. Was NICHT abgefangen wird,
           ist ein Fehler, der nichts mit Rechten zu tun hat — etwa
           eine fehlende Spalte. Der soll durchschlagen, denn dann
           prueft dieser Test nicht mehr, was er behauptet. */
        if sqlstate not in ('42501', '23514') then
          perform pg_catalog.set_config('role', 'none', true);
          raise;
        end if;
        v_mechanismus := 'RLS ohne Policy (sqlstate ' || sqlstate || ')';
    end;

    perform pg_catalog.set_config('role', 'none', true);
    raise notice '%: abgewiesen — %', v_rolle, coalesce(v_mechanismus, 'durchgelassen!');
  end loop;

  if pg_catalog.array_length(v_durchgelassen, 1) > 0 then
    raise exception
      E'Direkter Schreibzugriff auf public.leads ist offen fuer: %\n'
      '  Der SmartCheck-Lead laeuft ueber die Edge Function\n'
      '  smartcheck-lead (Service Role, Validierung, Rate-Limit).\n'
      '  Ein Grant fuer anon oder authenticated macht diesen Weg\n'
      '  ueberfluessig und das oeffentliche Formular zum Spam-Tor —\n'
      '  der anon-Schluessel liegt im Browser-Bundle.\n'
      '  Siehe supabase/functions/smartcheck-lead/index.ts.',
      pg_catalog.array_to_string(v_durchgelassen, ', ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   2 — DER SERVERWEG MUSS FUNKTIONIEREN
   ═══════════════════════════════════════════════════════

   Eine Prüfung, die nur zumacht, beweist das Falsche: wenn auch
   service_role nicht schreiben kann, ist der Lead-Funnel tot und der
   Test trotzdem gruen.

   Zusaetzlich wird hier belegt, dass die Spalten existieren, in die
   die Function schreibt. Der Kommentar in
   src/hooks/usePlacesAnalysis.js nennt ein "run once in Supabase SQL
   Editor" fuer industry_key, google_place_id, google_rating,
   google_review_count und visibility_score — eine Spalte, die nur
   von Hand angelegt wurde und in keiner Migration steht, fehlt in
   jeder frischen Datenbank. Dann scheitert die Function, nicht der
   Test. Also hier. */

do $$
declare
  v_id uuid;
begin
  perform pg_catalog.set_config('role', 'service_role', true);

  insert into public.leads (
    company_name, contact_person, phone, city, trade, email,
    source, status, industry_key,
    google_place_id, visibility_score, google_rating, google_review_count
  ) values (
    'Muster Sanitaer GmbH', '-', '-', 'Hamburg', null, 'kunde@beispiel.de',
    'smart_check', 'new', 'handwerk',
    'ChIJ_test_place_id_1234567890', 42, 3.4, 12
  )
  returning id into v_id;

  perform pg_catalog.set_config('role', 'none', true);

  if v_id is null then
    raise exception 'service_role konnte keinen Lead schreiben — der Serverweg ist zu';
  end if;

  raise notice 'service_role: Lead geschrieben, alle Spalten vorhanden';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — DIE BREMSE, AUF DIE SICH DIE FUNCTION STUETZT
   ═══════════════════════════════════════════════════════

   smartcheck-lead ruft check_rate_limit(p_key, p_limit, p_window) —
   denselben Mechanismus, den google-business und
   generate-review-reply benutzen. §7 des Auftrags: vorhandenen
   Mechanismus wiederverwenden, kein neuer.

   Wenn diese Funktion fehlt, antwortet die Function mit
   rate_limit_unavailable und laesst NICHTS durch (fail closed). Der
   Lead-Funnel waere dann dicht, ohne dass jemand es merkt — deshalb
   wird die Existenz hier geprueft und nicht angenommen.

   Hinweis zur Abhaengigkeit: die Tabelle public.rate_limits kommt
   aus 20261012110000_fehlende_objekte.sql. Liegt die Migration nicht
   im Repo, faellt dieser Abschnitt — und das ist die richtige
   Meldung, nicht ein uebersprungener Test. */

do $$
declare
  v_ergebnis jsonb;
begin
  if pg_catalog.to_regprocedure('public.check_rate_limit(text,integer,interval)') is null then
    raise exception
      E'public.check_rate_limit(text,integer,interval) fehlt.\n'
      '  smartcheck-lead stuetzt sich darauf und laesst ohne die\n'
      '  Funktion nichts durch. Die Tabelle public.rate_limits kommt\n'
      '  aus 20261012110000_fehlende_objekte.sql.';
  end if;

  perform pg_catalog.set_config('role', 'service_role', true);
  select public.check_rate_limit('smartcheck_test:' || pg_catalog.gen_random_uuid()::text, 2, '01:00:00')
    into v_ergebnis;
  perform pg_catalog.set_config('role', 'none', true);

  if v_ergebnis is null or (v_ergebnis ->> 'allowed') is distinct from 'true' then
    raise exception
      'check_rate_limit liess den ersten Aufruf nicht durch: % — dann waere jeder Lead blockiert',
      coalesce(v_ergebnis::text, 'null');
  end if;

  raise notice 'check_rate_limit vorhanden und laesst den ersten Aufruf durch';
end $$;

rollback;
