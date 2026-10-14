-- 20261014120000_execute_rechte_kanonisch.sql
--
-- Bestehende SECURITY-DEFINER-Funktionen in public verlieren das
-- EXECUTE-Recht fuer PUBLIC, anon und authenticated.
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND, IN PRODUKTION GEMESSEN
-- ═══════════════════════════════════════════════════════════════
--
-- Gemessen am 14.10.2026 im SQL-Editor, lesend, ueber
-- has_function_privilege. Ergebnis fuer SECURITY DEFINER + VOLATILE
-- im Schema public:
--
--   gesamt                      82
--   fuer PUBLIC ausfuehrbar     46
--   nur fuer authenticated       5
--   geschlossen                 31
--
-- Wirkungsprobe, ebenfalls in Produktion:
--
--   set local role anon;
--   select public.update_user_plan('0000…0000'::uuid, 'free');
--   → ausgefuehrt, kein permission denied
--
--   set local role authenticated;  → ebenfalls ausgefuehrt
--
-- update_user_plan setzt plan und trial_ends_at eines beliebigen
-- Nutzers. user_profiles_plan_check erlaubt 'free' und 'pro'; die
-- Funktion erlaubt beide ebenfalls. Ein Founding Partner laesst sich
-- damit auf 'free' setzen und verliert seinen Zugang. Es gibt im
-- ganzen Repo keinen Aufrufer: nicht in src, nicht in
-- supabase/functions, nicht in einer Migration, nicht in cron.job.
--
-- Weitere Funktionen derselben Klasse, gelesen aus dem jeweiligen
-- Funktionsrumpf:
--
--   run_sync_maintenance()         ruft alle prune_/release_/purge_
--   prune_email_queue(interval)    loescht die Dedupe-Belege der
--                                  Mail-Queue; danach geht eine
--                                  bereits verschickte Mail erneut
--                                  raus (Kommentar in der Funktion)
--   release_stuck_emails(interval) setzt alle 'sending' auf 'queued'
--   purge_unconfirmed_accounts     loescht pending google_accounts
--                                  samt oauth_tokens
--   try_acquire_lock/release_lock  Sperre nehmen und halten stoppt
--                                  jeden gesperrten Hintergrundlauf
--   retract_reply(uuid)            zieht eine veroeffentlichte
--                                  Google-Antwort fremder Betriebe
--                                  zurueck
--   sync_events(uuid,jsonb) und
--   sync_events(uuid,jsonb,text)   zwei alte Ueberladungen ohne
--                                  Aufrufer; die gehaertete Fassung
--                                  hat vier Argumente, eine Haertung
--                                  nach Namen uebersieht die beiden
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DAS NICHT SCHON 20261012140000 ERLEDIGT HAT
-- ═══════════════════════════════════════════════════════════════
--
-- 20261012140000_deny_by_default.sql setzt die Vorgaberechte fuer
-- KUENFTIGE Objekte und sagt in ihrem Kopf ausdruecklich: "Kein
-- bestehendes Recht wird angefasst." Das war der Auftrag dort (G2.2
-- §26: sichere Vorgaben, keine flaechige Rechteaenderung).
--
-- Diese Migration ist das Gegenstueck fuer die Objekte, die schon da
-- sind. Beide zusammen ergeben: Bestand zu, Neues zu.
--
-- ═══════════════════════════════════════════════════════════════
-- KEIN MASSEN-REVOKE NACH NAMENSLISTE
-- ═══════════════════════════════════════════════════════════════
--
-- Auftrag H2.2 §7: "keine Massen-Revoke nach Namensliste ohne
-- Aufrufer-/Wirkungspruefung." Deshalb steht hier eine ausdrueckliche
-- Liste von 48 Signaturen, und fuer jede ist der Aufrufer belegt oder
-- ausdruecklich als fehlend vermerkt. Die Pruefung steht in
-- docs/h2-2-security-audit.md, Abschnitt 4, mit Fundstelle je
-- Funktion.
--
-- Entscheidend fuer die Frage, ob anon oder authenticated gebraucht
-- wird: alle Edge-Function-Aufrufe dieser Funktionen laufen ueber
-- adminClient() beziehungsweise supabaseAdmin, also mit
-- SUPABASE_SERVICE_ROLE_KEY. Geprueft in allen zwoelf Functions.
-- Fuenf legen zusaetzlich einen Client mit dem Anon-Key an; der wird
-- ausschliesslich fuer auth.getUser() benutzt, kein einziges .rpc(
-- laeuft darueber. Keine der 48 hat einen Browser-Aufrufer.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS OFFEN BLEIBT, UND ZWAR ABSICHTLICH
-- ═══════════════════════════════════════════════════════════════
--
-- Drei RPCs ruft das Frontend wirklich. Sie behalten authenticated
-- und bekommen ihn hier ausdruecklich, damit die Sollmatrix
-- vollstaendig in einer Datei steht:
--
--   accept_terms(text)            src/pages/Onboarding.js
--                                 nimmt keine user_id, liest auth.uid()
--   claim_own_lead()              src/hooks/useAuth.js, Signup.js
--                                 nimmt keine Argumente, auth.uid()
--   touch_dashboard_visit(uuid)   src/hooks/useEvents.js
--                                 nimmt eine user_id, vergleicht sie
--                                 aber mit auth.uid()
--
-- Nicht Teil dieser Migration: die 29 SECURITY-DEFINER-Funktionen mit
-- VOLATILE = 's'. 14 davon sind fuer anon ausfuehrbar und geben bei
-- fremder user_id fremde Kundendaten zurueck (in Produktion gemessen,
-- compute_health_score als anon liefert ein Ergebnis). Das ist ein
-- eigener Befund, er steht in docs/h2-2-security-audit.md Abschnitt 7
-- und wartet auf eine Entscheidung. H2.2 §3 begrenzt den Umfang auf
-- VOLATILE, und §7 verbietet Revoke ohne Wirkungspruefung — beides
-- waere hier verletzt, wenn diese Migration sie mitnaehme.
--
-- Die beiden toten sync_events-Ueberladungen werden geschlossen, nicht
-- geloescht. Loeschen waere sauberer, ist aber ein Schemaeingriff und
-- nicht freigegeben.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DABEI BRECHEN KOENNTE — UND GEMESSEN NICHT BRICHT
-- ═══════════════════════════════════════════════════════════════
--
-- Drei der 48 haengen an Triggern auf auth.users: handle_new_user
-- (on_auth_user_created), on_user_confirmed_send_welcome und
-- anonymise_user_on_delete (on_user_deleted). Wuerde PostgreSQL das
-- EXECUTE-Recht beim Feuern pruefen, wuerde diese Migration
-- Registrierung, Mailbestaetigung und Kontoloeschung brechen.
--
-- Nachgemessen am 14.10.2026 in der Testdatenbank, nicht aus der
-- Dokumentation geschlossen: Probetabelle, SECURITY-DEFINER-Trigger,
-- "revoke execute from public", dann Insert unter einer Rolle ohne
-- jedes Recht an der Funktion. Der Trigger lief und schrieb seine
-- Zeile. EXECUTE wird bei CREATE TRIGGER geprueft, nicht beim Feuern.
--
-- Zweiter Pfad: pg_cron. Der Job gbp-maintenance ruft
-- "select public.run_sync_maintenance();" und laeuft unter der Rolle,
-- die ihn eingeplant hat — postgres. Alle 82 Funktionen gehoeren
-- postgres, und ein Eigentuemer behaelt sein EXECUTE, solange es ihm
-- nicht ausdruecklich entzogen wird. Diese Migration entzieht nur
-- PUBLIC, anon und authenticated. Pruefung D unten haelt das fest.
--
-- ═══════════════════════════════════════════════════════════════
-- FAIL CLOSED
-- ═══════════════════════════════════════════════════════════════
--
-- Nach dem Setzen prueft die Migration selbst (Abschnitt 3):
--
--   1. jede der 48 Signaturen existiert ueberhaupt
--   2. jede der 48 ist danach zu und fuer service_role offen
--   3. die drei Client-RPCs haben genau authenticated + service_role
--   4. es gibt keine weitere offene SECURITY-DEFINER-VOLATILE-Funktion
--      in public, die nicht auf der Client-Liste steht
--
-- Pruefung 4 ist die wichtige: findet sie etwas, bricht die Migration
-- ab und nennt den Namen. Eine Funktion, die ich nicht gesehen habe,
-- wird also gemeldet und nicht stillschweigend offen gelassen — und
-- auch nicht blind revoked.
--
-- Wiederholbar. Aendert keine Daten, kein Schema, keine
-- Funktionsruempfe.

begin;

/* ═══════════════════════════════════════════════════════════
   0 — ROLLEN
   ═══════════════════════════════════════════════════════════

   anon, authenticated und service_role sind Supabase-Rollen. In einer
   nackten Postgres-Instanz fehlen sie, und ein revoke gegen eine
   fehlende Rolle bricht mit 42704 ab. Das waere ein roter Lauf ohne
   Befund.

   Hier wird deshalb geprueft und nicht angelegt: eine Migration, die
   sich die Rollen selbst baut, prueft nicht mehr, ob sie da sind. */

do $$
declare
  v_fehlt text[] := array[]::text[];
  v_rolle text;
begin
  foreach v_rolle in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = v_rolle) then
      v_fehlt := v_fehlt || v_rolle;
    end if;
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Rollen fehlen: %\n'
      '  Diese Migration gehoert in eine Supabase-Datenbank.',
      pg_catalog.array_to_string(v_fehlt, ', ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   1 — SERVER-ONLY: 48 SIGNATUREN SCHLIESSEN
   ═══════════════════════════════════════════════════════════

   Die Signaturen stammen aus pg_get_function_identity_arguments der
   Produktionsdatenbank (Messung vom 14.10.2026) und sind Zeichen fuer
   Zeichen mit der Testdatenbank abgeglichen: 46 von 46 identisch.

   Geprueft wird die Existenz ueber pg_proc und nicht ueber
   to_regprocedure: die Signaturen tragen Parameternamen
   ("p_worker text"), und to_regprocedure erwartet nur Typen. Mit
   Namen bricht es mit "invalid type name" ab. GRANT und REVOKE
   dagegen nehmen die Form mit Namen an.

   Fehlende Signaturen werden gesammelt und am Ende gemeldet — ein
   Tippfehler in der Liste soll nicht als "alles zu" durchgehen.

   revoke von PUBLIC ist nicht ueberfluessig: in Produktion steht bei
   allen 46 ein ausdruecklicher ACL-Eintrag mit leerem Empfaenger
   ("=X/postgres"), und das ist PUBLIC. Ein revoke nur von anon und
   authenticated wuerde daran nichts aendern, weil das Recht ueber
   PUBLIC weiter ankommt. */

do $$
declare
  v_sig    text;
  v_fehlt  text[] := array[]::text[];
  v_liste  text[] := array[
    'anonymise_user_on_delete()',
    'begin_sync_run(p_worker text, p_trigger text, p_ttl interval)',
    'check_rate_limit(p_key text, p_limit integer, p_window interval)',
    'claim_reply_for_publishing(p_reply_id uuid)',
    'claim_sync_jobs(p_worker text, p_limit integer)',
    'cleanup_expired_oauth_states()',
    'cleanup_stripe_events()',
    'complete_recommendations_for(p_user_id uuid, p_types text[], p_subject_id uuid)',
    'complete_reply_publication(p_reply_id uuid, p_published_at timestamp with time zone)',
    'enqueue_sync_job(p_job_type text, p_user_id uuid, p_account_id uuid, p_location_id uuid, p_payload jsonb, p_priority smallint, p_scheduled_for timestamp with time zone)',
    'events_mark_seen(p_user_id uuid, p_ids uuid[])',
    'fail_reply_publication(p_reply_id uuid, p_error_code text, p_error_message text, p_permanent boolean)',
    'finish_sync_job(p_job_id uuid, p_success boolean, p_result jsonb, p_error_code text, p_error_message text)',
    'finish_sync_run(p_run_id uuid, p_worker text, p_claimed integer, p_succeeded integer, p_failed integer, p_error_code text, p_error_message text, p_details jsonb)',
    'handle_new_user()',
    'mark_events_delivered(p_event_ids uuid[], p_channel text)',
    'mark_recommendations_seen(p_event_ids uuid[], p_channel text, p_user_id uuid)',
    'measure_recommendation_impact(p_after timestamp with time zone, p_limit integer)',
    'on_user_confirmed_send_welcome()',
    'ops_alert_mark_sent(p_keys text[])',
    'ops_alerts()',
    'ops_alerts_pending(p_cooldown interval)',
    'ops_cron_failures(p_minutes integer)',
    'ops_health_check()',
    'ops_http_errors(p_minutes integer)',
    'ops_placeholder_check()',
    'prune_email_queue(p_keep interval)',
    'prune_rate_limits(p_keep interval)',
    'prune_sync_jobs()',
    'prune_sync_runs(p_keep interval)',
    'purge_unconfirmed_accounts(p_max_age interval)',
    'recommendation_events_set_location()',
    'record_recommendation_action(p_event_id uuid, p_action text, p_channel text, p_user_id uuid)',
    'release_lock(p_name text, p_worker text)',
    'release_stuck_emails(p_timeout interval)',
    'release_stuck_publications(p_timeout interval)',
    'release_stuck_sync_jobs(p_timeout interval)',
    'release_stuck_sync_runs(p_timeout interval)',
    'resolve_stale_events(p_user_id uuid, p_events jsonb, p_location_id uuid)',
    'retract_reply(p_reply_id uuid)',
    'run_sync_maintenance()',
    'schedule_all_syncs(p_review_age interval, p_location_age interval, p_limit integer)',
    'schedule_review_syncs(p_min_age interval)',
    'snapshot_impact_baseline(p_event_id uuid)',
    'sync_events(p_user_id uuid, p_events jsonb)',
    'sync_events(p_user_id uuid, p_events jsonb, p_engine_version text)',
    'try_acquire_lock(p_name text, p_worker text, p_ttl interval)',
    'update_user_plan(p_user_id uuid, p_plan text, p_trial_ends timestamp with time zone)'
  ];
begin
  foreach v_sig in array v_liste loop
    if not exists (
      select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig
    ) then
      v_fehlt := v_fehlt || v_sig;
      continue;
    end if;

    execute pg_catalog.format(
      'revoke execute on function public.%s from public', v_sig);
    execute pg_catalog.format(
      'revoke execute on function public.%s from anon', v_sig);
    execute pg_catalog.format(
      'revoke execute on function public.%s from authenticated', v_sig);
    execute pg_catalog.format(
      'grant execute on function public.%s to service_role', v_sig);
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Signaturen nicht gefunden:\n  %\n'
      '  Die Liste stammt aus der Produktionsmessung vom 14.10.2026.\n'
      '  Weicht die Datenbank davon ab, zuerst neu messen:\n'
      '  docs/h2-2-security-audit.md Abschnitt 1.',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   2 — CLIENT-RPCs: AUTHENTICATED AUSDRUECKLICH SETZEN
   ═══════════════════════════════════════════════════════════

   Diese drei haben ihren Grant heute schon richtig. Er wird hier
   wiederholt, nicht weil er fehlt, sondern damit die vollstaendige
   Sollmatrix an einer Stelle steht und ein spaeterer Blick in diese
   Datei nicht den Eindruck erzeugt, es gaebe gar keine Client-RPCs.

   PUBLIC und anon werden auch hier entzogen: ein eingeloggter Nutzer
   braucht sie, ein anonymer nicht. */

do $$
declare
  v_sig   text;
  v_fehlt text[] := array[]::text[];
  v_liste text[] := array[
    'accept_terms(p_version text)',
    'claim_own_lead()',
    'touch_dashboard_visit(p_user_id uuid)'
  ];
begin
  foreach v_sig in array v_liste loop
    if not exists (
      select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig
    ) then
      v_fehlt := v_fehlt || v_sig;
      continue;
    end if;

    execute pg_catalog.format(
      'revoke execute on function public.%s from public', v_sig);
    execute pg_catalog.format(
      'revoke execute on function public.%s from anon', v_sig);
    execute pg_catalog.format(
      'grant execute on function public.%s to authenticated', v_sig);
    execute pg_catalog.format(
      'grant execute on function public.%s to service_role', v_sig);
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Client-RPC nicht gefunden:\n  %',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   3 — SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════

   Gemessen wird mit has_function_privilege und nicht mit
   aclexplode(proacl). Der Grund ist der Fehler, der diesen Befund
   fast verdeckt hat: proacl = null heisst nicht "keine Rechte",
   sondern "PostgreSQL-Vorgabe gilt", und die Vorgabe fuer Funktionen
   ist EXECUTE fuer PUBLIC. Eine Pruefung ueber aclexplode allein
   liefert fuer solche Funktionen null Zeilen und sieht damit aus wie
   "nichts offen".

   has_function_privilege loest die Vorgabe korrekt auf und sieht auch
   Rechte, die ueber Rollenmitgliedschaft ankommen. */

do $$
declare
  v_offen text[];
begin
  /* ── A: nichts darf fuer PUBLIC, anon oder authenticated offen
        sein, ausser den drei Client-RPCs ── */
  select pg_catalog.array_agg(
           p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
           || ' | public=' || pg_catalog.has_function_privilege('public', p.oid, 'execute')::text
           || ' anon='     || pg_catalog.has_function_privilege('anon', p.oid, 'execute')::text
           || ' auth='     || pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')::text
           order by p.proname)
    into v_offen
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.provolatile = 'v'
     and (pg_catalog.has_function_privilege('public', p.oid, 'execute')
          or pg_catalog.has_function_privilege('anon', p.oid, 'execute')
          or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute'))
     and p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
         not in ('accept_terms(p_version text)',
                 'claim_own_lead()',
                 'touch_dashboard_visit(p_user_id uuid)');

  if v_offen is not null then
    raise exception
      E'Noch offen nach dem Setzen:\n  %\n'
      '  Entweder fehlt die Signatur in Abschnitt 1, oder sie ist in\n'
      '  dieser Datenbank neu. Nicht blind ergaenzen: erst Aufrufer\n'
      '  und Wirkung pruefen (H2.2 §5 und §7).',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  /* ── B: die drei Client-RPCs muessen fuer authenticated offen und
        fuer PUBLIC und anon zu sein ── */
  select pg_catalog.array_agg(
           t.sig
           || ' | public=' || pg_catalog.has_function_privilege('public', t.oid, 'execute')::text
           || ' anon='     || pg_catalog.has_function_privilege('anon', t.oid, 'execute')::text
           || ' auth='     || pg_catalog.has_function_privilege('authenticated', t.oid, 'execute')::text
           order by t.sig)
    into v_offen
    from (
      select p.oid,
             p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
    ) as t
   where t.sig in ('accept_terms(p_version text)',
                   'claim_own_lead()',
                   'touch_dashboard_visit(p_user_id uuid)')
     and (pg_catalog.has_function_privilege('public', t.oid, 'execute')
          or pg_catalog.has_function_privilege('anon', t.oid, 'execute')
          or not pg_catalog.has_function_privilege('authenticated', t.oid, 'execute'));

  if v_offen is not null then
    raise exception
      E'Client-RPC-Rechte stimmen nicht:\n  %\n'
      '  Soll: public=false anon=false authenticated=true.',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  /* ── B2: und sie muessen ueberhaupt existieren. Ohne diese Zeile
        waere B gruen, wenn eine der drei umbenannt wird — die
        Teilmenge waere dann leer. ── */
  select pg_catalog.array_agg(v.sig order by v.sig)
    into v_offen
    from (values ('accept_terms(p_version text)'),
                 ('claim_own_lead()'),
                 ('touch_dashboard_visit(p_user_id uuid)')) as v(sig)
   where not exists (
     select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname || '('
            || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v.sig);

  if v_offen is not null then
    raise exception
      E'Client-RPC fehlt in der Datenbank:\n  %',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  /* ── C: service_role muss alle erreichen, sonst stehen Cron und
        Edge Functions nach dem Apply still ── */
  select pg_catalog.array_agg(
           p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
           order by p.proname)
    into v_offen
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.provolatile = 'v'
     and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute');

  if v_offen is not null then
    raise exception
      E'service_role kann diese Funktionen nicht ausfuehren:\n  %\n'
      '  Das wuerde Cron und Edge Functions brechen.',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  /* ── D: der Eigentuemer muss sein EXECUTE behalten. pg_cron laeuft
        unter der Rolle, die den Job eingeplant hat; das ist hier
        postgres, und postgres ist auch Eigentuemer aller Funktionen.
        Ginge ihm das Recht verloren, stuende gbp-maintenance still. ── */
  select pg_catalog.array_agg(
           p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
           || ' (Eigentuemer ' || pg_catalog.pg_get_userbyid(p.proowner) || ')'
           order by p.proname)
    into v_offen
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.provolatile = 'v'
     and not pg_catalog.has_function_privilege(
               pg_catalog.pg_get_userbyid(p.proowner), p.oid, 'execute');

  if v_offen is not null then
    raise exception
      E'Der Eigentuemer kann diese Funktionen nicht ausfuehren:\n  %\n'
      '  pg_cron laeuft unter dieser Rolle und wuerde stillstehen.',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;
end $$;

commit;
