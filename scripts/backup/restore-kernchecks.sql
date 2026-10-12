-- restore-kernchecks.sql
--
-- Steht nach dem Restore wirklich WERKRUF da?
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT NUR DER FINGERABDRUCK
-- ═══════════════════════════════════════════════════════════════
--
-- Der Fingerabdruck vergleicht zwei Datenbanken. Diese Datei prueft
-- EINE — gegen eine Erwartung, die im Repo steht. Beides ist noetig:
--
--   Fingerabdruck   fand heraus, was sich zwischen Quelle und
--                   Restore unterscheidet
--   Kernchecks      finden heraus, ob der Restore fachlich taugt,
--                   auch wenn es keine Quelle zum Vergleichen gibt
--
-- Der zweite Fall ist der echte Katastrophenfall: die Produktion ist
-- weg, es gibt nichts zu vergleichen, und die Frage ist, ob das, was
-- dasteht, arbeitsfaehig ist.
--
-- Jede Verletzung wirft. ON_ERROR_STOP macht daraus Exit <> 0.

\set ON_ERROR_STOP on

do $$
declare
  v_fehlt text[] := array[]::text[];
  v_name  text;
  v_zeile record;
begin

  /* ═══════════════════════════════════════════════════════════
     1 — TABELLEN, OHNE DIE NICHTS GEHT
     ═══════════════════════════════════════════════════════════ */

  foreach v_name in array array[
    'public.user_profiles', 'public.google_accounts', 'public.google_locations',
    'public.google_reviews', 'public.events', 'public.recommendation_events',
    'public.email_queue', 'public.action_tokens', 'public.action_auth_states',
    'public.notification_preferences', 'public.sync_jobs', 'public.sync_runs',
    'public.review_replies', 'public.business_photos', 'public.oauth_tokens',
    'public.weekly_snapshots', 'public.ops_alert_log',
    /* Die Anmeldungen. Fehlt diese Zeile, ist der Restore nutzlos,
       auch wenn alles andere steht. */
    'auth.users'
  ]
  loop
    if pg_catalog.to_regclass(v_name) is null then
      v_fehlt := v_fehlt || ('Tabelle fehlt: ' || v_name);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     2 — FUNKTIONEN DER KERNPFADE
     ═══════════════════════════════════════════════════════════

     Reihenfolge wie der produktive Pfad:

       Sync    → Engine    → Events → Dashboard
                                    → Wochenmail → Queue → Worker
                                    → Action-Link → Auth */

  foreach v_name in array array[
    -- Bewertung und Kontext
    'build_location_evaluation_context', 'compute_health_score',
    'werkruf_score_location', 'sync_events',
    -- Auswahl
    'canonical_recommendation_events', 'event_ist_fachlich_offen',
    'event_ist_offen', 'rule_freigegeben', 'priority_stufe',
    -- Darstellung
    'events_feed', 'top_recommendations_for_email',
    -- Kommunikation
    'plan_communications', 'schedule_communications', 'enqueue_email',
    'finish_email', 'weekly_mark_sent', 'weekly_event_is_due',
    'weekly_next_due_at', 'weekly_counts', 'wants_notification',
    'mark_events_delivered', 'completed_this_week',
    -- Action-Links und Anmeldung
    'resolve_action_token', 'consume_action_token',
    'create_action_auth_state', 'consume_action_auth_state',
    -- Sync und Betrieb
    --
    -- Der erste Entwurf nannte hier log_recommendation_event. Die
    -- Funktion gibt es nicht — in keiner Migration, in keinem
    -- Schema. Ich hatte den Namen aus meiner eigenen G1-Dokumentation
    -- uebernommen, und der stand dort falsch
    -- (docs/testing/baseline-luecken.md, inzwischen korrigiert).
    -- Was wirklich ohne id in recommendation_events einfuegt, ist
    -- record_recommendation_action().
    'enqueue_sync_job', 'sync_failure_resolved',
    'record_recommendation_action', 'resolve_stale_events'
  ]
  loop
    if not exists (
      select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    ) then
      v_fehlt := v_fehlt || ('Funktion fehlt: public.' || v_name);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     3 — ROW LEVEL SECURITY, JE RECHT STATT JE TABELLE
     ═══════════════════════════════════════════════════════════

     Diese Pruefung brauchte drei Anlaeufe, und alle drei Fehlschlaege
     sagen etwas darueber, wie leicht man sich hier selbst betruegt.

     Erster Entwurf: eine Liste von Tabellen, bei denen ich RLS und
     Policies erwartete. Sie meldete vier Verletzungen, und alle vier
     waren falsch — email_queue hat kein RLS, weil es anon und
     authenticated ueberhaupt nichts erlaubt, und action_tokens hat
     RLS ohne Policy, was fuer eine Tabelle, die nur service_role
     anfasst, genau richtig ist: es verweigert alles. Dieselbe Falle
     wie in G1, wo ich email_queue.user_id als NOT NULL erwartete.

     Zweiter Entwurf: die Invariante "wer authenticated etwas
     erlaubt, braucht RLS und mindestens eine Policy". Die Gegenprobe
     hat ihn widerlegt — nach dem Loeschen von
     user_profiles_owner_read blieben zwei Policies, der Test blieb
     gruen, und Kunden konnten ihre eigenen Daten nicht mehr lesen.

     Dritter Entwurf: zusaetzlich "eine Policy, deren USING auf
     uid() Bezug nimmt". Auch widerlegt — die uebrig gebliebene
     UPDATE-Policy erfuellte die Bedingung, waehrend die
     SELECT-Policy fehlte.

     Was wirklich gilt, und was hier geprueft wird:

       Fuer JEDES Recht, das anon oder authenticated auf einer
       Tabelle hat, muss es eine Policy geben, die dieses Recht
       abdeckt UND auf uid() Bezug nimmt.

     Keine Liste, keine Erwartung — abgeleitet aus den Rechten, die
     im Schema stehen. Deckt beide Verlustrichtungen ab: eine
     verlorene Policy und ein verlorenes revoke. */

  for v_zeile in
    select g.table_name as tabelle,
           g.grantee    as rolle,
           g.privilege_type as recht,
           c.relrowsecurity as rls
      from information_schema.role_table_grants g
      join pg_catalog.pg_class c on c.relname = g.table_name
      join pg_catalog.pg_namespace n
        on n.oid = c.relnamespace and n.nspname = 'public'
     where g.table_schema = 'public'
       and g.grantee in ('anon', 'authenticated', 'PUBLIC')
       and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  loop
    if not v_zeile.rls then
      v_fehlt := v_fehlt || pg_catalog.format(
        'public.%s erlaubt %s %s, hat aber KEIN RLS',
        v_zeile.tabelle, v_zeile.rolle, v_zeile.recht);
      continue;
    end if;

    /* cmd = 'ALL' deckt jedes Recht ab, sonst muss es passen.
       Bei INSERT steht die Bedingung in with_check, nicht in qual —
       deshalb beide. */
    if not exists (
      select 1 from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename = v_zeile.tabelle
         and v_zeile.rolle = any (p.roles)
         and (p.cmd = 'ALL' or p.cmd = v_zeile.recht)
         and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%uid()%'
    ) then
      v_fehlt := v_fehlt || pg_catalog.format(
        'public.%s: %s darf %s, aber keine auf uid() beschraenkte Policy deckt das ab',
        v_zeile.tabelle, v_zeile.rolle, v_zeile.recht);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     4 — DIE RECHTE, DIE G1 ALS BEFUND HATTE
     ═══════════════════════════════════════════════════════════

     user_profiles.plan entscheidet ueber den Produktzugang. Darf der
     Kunde die Spalte selbst schreiben, kann er sich Pro schenken.
     Migration 20260928160000 nimmt authenticated das Schreibrecht;
     ein Restore ohne Rechte wuerde es zurueckgeben. */

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'user_profiles'
       and grantee = 'authenticated'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fehlt := v_fehlt ||
      'authenticated darf public.user_profiles schreiben — plan waere selbst setzbar';
  end if;

  /* ═══════════════════════════════════════════════════════════
     5 — DIE PFLICHTSPALTEN AUS G1
     ═══════════════════════════════════════════════════════════ */

  for v_zeile in
    select * from (values
      ('google_locations', 'account_id'),
      ('google_accounts',  'provider_account_id'),
      ('action_tokens',    'token_hash'),
      ('email_queue',      'dedupe_key')
    ) as s(tabelle, spalte)
  loop
    if pg_catalog.to_regclass('public.' || v_zeile.tabelle) is null then
      continue;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = ('public.' || v_zeile.tabelle)::regclass
         and a.attname = v_zeile.spalte and a.attnotnull
    ) then
      v_fehlt := v_fehlt || pg_catalog.format(
        'NOT NULL fehlt: %s.%s', v_zeile.tabelle, v_zeile.spalte);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     6 — recommendation_events.id FUELLT SICH SELBST
     ═══════════════════════════════════════════════════════════

     Die Spalte ist bigint NOT NULL; ihre Sequenz schreibt pg_dump
     getrennt. Genau dieser Teil fehlte im alten Dump. Ohne ihn
     scheitert jeder Engine-Lauf. */

  if pg_catalog.to_regclass('public.recommendation_events') is not null
     and not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.recommendation_events'::regclass
       and a.attname = 'id' and (a.attidentity <> '' or a.atthasdef)
  ) then
    v_fehlt := v_fehlt ||
      'recommendation_events.id hat weder Identity noch Default';
  end if;

  /* ═══════════════════════════════════════════════════════════
     7 — DER G1-BEFUND: TABELLEN HINTER FUNKTIONEN
     ═══════════════════════════════════════════════════════════

     Zwei Baseline-Funktionen greifen auf public.rate_limits und
     public.sync_locks zu. In der Baseline kamen die Tabellen nicht
     vor. Weil pg_dump mit check_function_bodies = false laedt, fiel
     das nie auf.

     Hier KEIN Fehler, sondern ein Hinweis: ob die Tabellen in
     Produktion existieren, entscheidet, ob der alte Dump noch
     unvollstaendiger war als gedacht oder ob diese Funktionen
     produktiv werfen. Der Restore soll das zeigen, nicht kaschieren. */

  if pg_catalog.to_regclass('public.rate_limits') is null then
    raise notice '[BEFUND] public.rate_limits existiert im Restore nicht — check_rate_limit() und prune_rate_limits() wuerden werfen';
  end if;
  if pg_catalog.to_regclass('public.sync_locks') is null then
    raise notice '[BEFUND] public.sync_locks existiert im Restore nicht — die Sperrenbereinigung wuerde werfen';
  end if;

  /* ═══════════════════════════════════════════════════════════
     ERGEBNIS
     ═══════════════════════════════════════════════════════════ */

  if pg_catalog.array_length(v_fehlt, 1) > 0 then
    raise exception E'Restore unvollstaendig:\n  %',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;
