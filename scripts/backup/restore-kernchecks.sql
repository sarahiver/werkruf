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

-- ═══════════════════════════════════════════════════════════════
-- ZWEI VERDIKTE, NICHT EINS
-- ═══════════════════════════════════════════════════════════════
--
-- Der erste Lauf gegen einen echten Produktionsdump hat gezeigt, dass
-- diese Datei zwei voellig verschiedene Dinge in einen Topf warf:
--
--   v_restore_defekt   Der Restore hat etwas verloren. Das ist ein
--                      Fehler DIESES Verfahrens. → Exception, rot.
--
--   v_prod_befund      Der Restore hat etwas treu uebernommen, was
--                      schon in Produktion falsch ist. Das ist KEIN
--                      Restore-Fehler. → WARNING, sichtbar, aber der
--                      Restore-Beweis bleibt gueltig.
--
-- Beides rot zu melden hiesse: der Restore-Beweis haengt daran, dass
-- jemand erst Produktion repariert. Beides gruen zu melden hiesse: ein
-- Sicherheitsloch verschwindet im Protokoll. Deshalb getrennt.
--
-- DIE VORBEDINGUNG DIESER TRENNUNG
--
-- Sie beruht auf einem Schluss: ist RLS nach dem Restore aus, war es
-- im Dump aus — also in Produktion. Der Schluss gilt nur, solange
-- pg_restore an keiner RLS- oder Policy-Anweisung gescheitert ist.
-- Diese Datei kann das nicht sehen; restore.sh sieht es, prueft es
-- vor dem Aufruf im Restore-Protokoll und erklaert die Einordnung
-- fuer den Lauf fuer nicht belastbar, wenn dort Fehler stehen. Wer
-- diese Datei einzeln aufruft, hat diese Pruefung nicht.

\set ON_ERROR_STOP on

do $$
declare
  v_restore_defekt text[] := array[]::text[];
  v_prod_befund    text[] := array[]::text[];
  v_hinweis        text[] := array[]::text[];
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
      v_restore_defekt := v_restore_defekt || ('Tabelle fehlt: ' || v_name);
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
      v_restore_defekt := v_restore_defekt || ('Funktion fehlt: public.' || v_name);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     3 — ERREICHBARKEIT STATT RLS-FLAGGE
     ═══════════════════════════════════════════════════════════

     Diese Pruefung brauchte vier Anlaeufe. Die ersten drei habe ich
     an einer leeren Testdatenbank fuer richtig gehalten; der vierte
     Fehlschlag kam vom ersten Lauf gegen einen echten
     Produktionsdump und hat 120 Verletzungen gemeldet, von denen
     115 falsch waren. Alle vier Fehlschlaege haben dieselbe Ursache:
     ich habe eine Erwartung gepruefT statt einer Wirkung.

     Erster Entwurf: eine Liste von Tabellen, bei denen ich RLS und
     Policies erwartete. Vier Verletzungen, alle falsch — email_queue
     hat kein RLS, weil es anon und authenticated ueberhaupt nichts
     erlaubt, und action_tokens hat RLS ohne Policy, was fuer eine
     Tabelle, die nur service_role anfasst, genau richtig ist: es
     verweigert alles.

     Zweiter Entwurf: "wer authenticated etwas erlaubt, braucht RLS
     und mindestens eine Policy". Die Gegenprobe hat ihn widerlegt —
     nach dem Loeschen von user_profiles_owner_read blieben zwei
     Policies, der Test blieb gruen, und Kunden konnten ihre eigenen
     Daten nicht mehr lesen.

     Dritter Entwurf: zusaetzlich "eine Policy, deren USING auf
     uid() Bezug nimmt". Auch widerlegt — die uebrig gebliebene
     UPDATE-Policy erfuellte die Bedingung, waehrend die
     SELECT-Policy fehlte.

     Vierter Entwurf, je Recht: er verlangte fuer JEDES Recht eine
     uid()-Policy. Gegen Produktion meldete er unter anderem

       public.leads: anon darf DELETE, aber keine auf uid()
       beschraenkte Policy deckt das ab

     Das ist falsch, und zwar auf die gefaehrlichste Art: es klingt
     wie ein Befund. RLS ist auf leads AN und es gibt keine Policy
     fuer anon — das VERWEIGERT alles. Ein Recht ohne Policy ist bei
     aktivem RLS kein Loch, sondern ein geschlossener Deckel. Ich
     habe eine Erwartung ("hier muss eine Kundenpolicy stehen") an
     Tabellen gestellt, die nur die Service Role anfasst.

     Und er meldete

       public.ops_sync_failures erlaubt anon SELECT, hat aber KEIN RLS

     Das ist eine SICHT. Sichten tragen kein relrowsecurity, niemals.
     Der Join ging ohne relkind-Filter auf pg_class, also wurden
     Sichten als Tabellen ohne RLS behandelt. Ausgerechnet dort, wo
     das echte Loch sitzt — siehe 3b.

     ───────────────────────────────────────────────────────────
     WAS JETZT GEPRUEFT WIRD: ERREICHBARKEIT
     ───────────────────────────────────────────────────────────

     Nicht "steht die Flagge richtig", sondern "kommt jemand an die
     Zeilen". Fuer jedes Recht, das anon oder authenticated auf einem
     Objekt in public hat, gilt genau einer von vier Zustaenden:

       RLS aus              → ungefiltert erreichbar          ROT
       RLS an, keine Policy → verweigert                      ok (Hinweis)
       RLS an, Policy ohne  → ungefiltert erreichbar          ROT
         Bedingung (true)
       RLS an, Policy mit   → zeilenweise beschraenkt         ok
         Bedingung

     Kein uid()-Zwang mehr. Eine Policy, die nach user_id, nach einer
     Hilfsfunktion oder nach einem Setting filtert, ist zeilenweise
     beschraenkt — ob sie dabei auf uid() verweist, ist eine Frage
     fuer Menschen, nicht fuer ein Gate. Die stellt sie als Hinweis.

     Was ROT faellt, ist nur noch das, was wirklich erreichbar ist:
     fehlendes RLS und Policies ohne Bedingung.

     has_table_privilege statt information_schema: das sieht auch
     Rechte, die ueber PUBLIC oder Rollenmitgliedschaft ankommen,
     und es laesst sich nicht per relname-Join an der falschen
     Tabelle festmachen. */

  for v_zeile in
    select c.oid, c.relname as tabelle, c.relkind,
           c.relrowsecurity as rls, r.rolle, p.recht
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n
        on n.oid = c.relnamespace and n.nspname = 'public'
     cross join (values ('anon'), ('authenticated')) as r(rolle)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
            as p(recht)
     where c.relkind in ('r', 'p')
       and pg_catalog.has_table_privilege(r.rolle, c.oid, p.recht)
     order by c.relname, r.rolle, p.recht
  loop
    /* Zustand 1: RLS aus. Jede Zeile der Tabelle ist lesbar bzw.
       schreibbar, ohne jede Einschraenkung. Das Supabase-Data-API
       stellt public bereit; anon ist der oeffentlich ausgelieferte
       Schluessel. */
    if not v_zeile.rls then
      v_prod_befund := v_prod_befund || pg_catalog.format(
        'public.%s: %s hat %s und die Tabelle hat KEIN RLS — ungefiltert erreichbar',
        v_zeile.tabelle, v_zeile.rolle, v_zeile.recht);
      continue;
    end if;

    /* Zustand 3: eine Policy deckt dieses Recht ab, hat aber keine
       Bedingung. qual IS NULL bei INSERT ist normal (dort steht
       with_check); 'true' in beiden ist ein offenes Tor. */
    if exists (
      select 1 from pg_catalog.pg_policies pol
       where pol.schemaname = 'public'
         and pol.tablename = v_zeile.tabelle
         and pol.permissive = 'PERMISSIVE'
         and v_zeile.rolle = any (pol.roles)
         and (pol.cmd = 'ALL' or pol.cmd = v_zeile.recht)
         and coalesce(pg_catalog.btrim(pol.qual), 'true') = 'true'
         and coalesce(pg_catalog.btrim(pol.with_check), 'true') = 'true'
    ) then
      v_prod_befund := v_prod_befund || pg_catalog.format(
        'public.%s: %s hat %s und eine Policy ohne Bedingung deckt es ab — ungefiltert erreichbar',
        v_zeile.tabelle, v_zeile.rolle, v_zeile.recht);
      continue;
    end if;

    /* Zustand 2: verweigert. Kein Fehler — aber festhalten. Ein
       gewaehrtes Recht, das nur RLS zurueckhaelt, wird beim naechsten
       versehentlich permissiven Policy-Entwurf zum Loch. */
    if not exists (
      select 1 from pg_catalog.pg_policies pol
       where pol.schemaname = 'public'
         and pol.tablename = v_zeile.tabelle
         and v_zeile.rolle = any (pol.roles)
         and (pol.cmd = 'ALL' or pol.cmd = v_zeile.recht)
    ) then
      v_hinweis := v_hinweis || pg_catalog.format(
        'public.%s: %s hat %s, RLS verweigert es (keine Policy)',
        v_zeile.tabelle, v_zeile.rolle, v_zeile.recht);
      continue;
    end if;

    /* Zustand 4 mit Beiklang: beschraenkt, aber nicht ueber uid(). */
    if not exists (
      select 1 from pg_catalog.pg_policies pol
       where pol.schemaname = 'public'
         and pol.tablename = v_zeile.tabelle
         and v_zeile.rolle = any (pol.roles)
         and (pol.cmd = 'ALL' or pol.cmd = v_zeile.recht)
         and (coalesce(pol.qual, '') || coalesce(pol.with_check, ''))
             like '%uid()%'
    ) then
      v_hinweis := v_hinweis || pg_catalog.format(
        'public.%s: %s %s ist beschraenkt, aber nicht ueber uid() — nachsehen',
        v_zeile.tabelle, v_zeile.rolle, v_zeile.recht);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     3b — SICHTEN: DIE STELLE, DIE DER ALTE CHECK UEBERSPRANG
     ═══════════════════════════════════════════════════════════

     Eine Sicht in PostgreSQL laeuft standardmaessig mit den Rechten
     ihres EIGENTUEMERS, nicht des Aufrufers. Die ops_*-Sichten
     gehoeren postgres. Row Level Security der Basistabellen greift
     damit nicht: wer die Sicht lesen darf, liest alle Zeilen aller
     Kunden, auch wenn die Basistabelle lueckenlos per RLS geschuetzt
     ist.

     Der Ausweg ist eine Zeile:

       alter view public.<name> set (security_invoker = true);

     Dann laeuft die Sicht als Aufrufer und RLS greift wieder.

     Im Repo steht security_invoker an keiner Stelle — nachgesehen am
     12.10.2026 ueber alle Migrationen. Und revoke steht bei keiner
     der drei Sicht-Migrationen. Supabase setzt auf public
     ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
     authenticated, service_role; eine Sicht ohne eigenes revoke
     erbt daraus SELECT fuer anon.

     Diese Pruefung liest den Zustand, sie erwartet ihn nicht: ob
     security_invoker gesetzt ist, steht in pg_class.reloptions. Fuer
     die acht Sichten, die in Produktion existieren und nicht im Repo
     (G2.1-Inventurdiff), ist das der einzige belastbare Weg. */

  for v_zeile in
    select c.relname as sicht, r.rolle,
           coalesce(
             'security_invoker=true' = any (c.reloptions), false
           ) as invoker
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n
        on n.oid = c.relnamespace and n.nspname = 'public'
     cross join (values ('anon'), ('authenticated')) as r(rolle)
     where c.relkind in ('v', 'm')
       and pg_catalog.has_table_privilege(r.rolle, c.oid, 'SELECT')
     order by c.relname, r.rolle
  loop
    if not v_zeile.invoker then
      v_prod_befund := v_prod_befund || pg_catalog.format(
        'public.%s (Sicht): %s darf lesen, security_invoker ist nicht gesetzt — RLS der Basistabellen greift nicht',
        v_zeile.sicht, v_zeile.rolle);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     3c — DIE ANDERE VERLUSTRICHTUNG: KANN DER KUNDE NOCH LESEN
     ═══════════════════════════════════════════════════════════

     3 und 3b finden zu viel Zugang. Diese Pruefung findet zu wenig —
     das war die Gegenprobe, an der Entwurf 2 und 3 gescheitert sind:
     user_profiles_owner_read loeschen, und der Kunde sieht sein
     eigenes Profil nicht mehr, waehrend alle Flaggen richtig stehen.

     Ohne Quelldatenbank laesst sich das nicht aus Flaggen ableiten.
     Was sich ableiten laesst, ohne eine Liste zu erfinden:

       Wenn das Schema fuer authenticated auf einer Tabelle
       UEBERHAUPT eine Policy schreibt, ist authenticated dort
       vorgesehen. Hat authenticated dann SELECT, muss auch eine
       Policy SELECT abdecken.

     Eine Tabelle, die nur die Service Role anfasst, hat gar keine
     Policy fuer authenticated und faellt heraus. leads, audit_logs,
     stripe_events, die ganze ops_*-Reihe: alle uebersprungen, ohne
     dass ihre Namen hier stehen.

     Die Gegenprobe greift: nach dem Loeschen von
     user_profiles_owner_read bleibt die UPDATE-Policy fuer
     authenticated stehen, die Tabelle gilt also als vorgesehen,
     SELECT ist gewaehrt und von keiner Policy abgedeckt → rot.

     Das ist ein echter Restore-Defekt, kein Produktionsbefund: eine
     Policy, die in Produktion existiert und nach dem Restore fehlt. */

  for v_zeile in
    select c.relname as tabelle
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n
        on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind in ('r', 'p')
       and c.relrowsecurity
       and pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
       and exists (
         select 1 from pg_catalog.pg_policies pol
          where pol.schemaname = 'public' and pol.tablename = c.relname
            and 'authenticated' = any (pol.roles)
       )
       and not exists (
         select 1 from pg_catalog.pg_policies pol
          where pol.schemaname = 'public' and pol.tablename = c.relname
            and 'authenticated' = any (pol.roles)
            and (pol.cmd = 'ALL' or pol.cmd = 'SELECT')
       )
     order by c.relname
  loop
    v_restore_defekt := v_restore_defekt || pg_catalog.format(
      'public.%s: authenticated hat SELECT und Policies, aber keine deckt SELECT ab — Lesepolicy fehlt',
      v_zeile.tabelle);
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
    v_restore_defekt := v_restore_defekt ||
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
      v_restore_defekt := v_restore_defekt || pg_catalog.format(
        'NOT NULL fehlt: %s.%s', v_zeile.tabelle, v_zeile.spalte);
    end if;
  end loop;

  /* ═══════════════════════════════════════════════════════════
     6 — recommendation_events.id FUELLT SICH SELBST
     ═══════════════════════════════════════════════════════════

     Die Spalte ist bigint NOT NULL; ihre Sequenz schreibt pg_dump
     getrennt. Genau dieser Teil fehlte im alten Dump. Ohne ihn
     scheitert jeder Engine-Lauf.

     ───────────────────────────────────────────────────────────
     WARUM HIER to_regclass STATT ::regclass STEHT
     ───────────────────────────────────────────────────────────

     Der erste Entwurf war

       if to_regclass('public.recommendation_events') is not null
          and not exists (select 1 from pg_attribute
                           where attrelid = 'public.recommendation_events'::regclass ...)

     Der Schutz links von AND schuetzt nicht. PL/pgSQL macht aus dem
     ganzen IF einen einzigen SELECT; der Literal-Cast ::regclass
     wird beim PLANEN aufgeloest, nicht beim Auswerten. Fehlt die
     Tabelle, wirft die Zeile

       ERROR: relation "public.recommendation_events" does not exist

     und zwar genau dann, wenn diese Pruefung gebraucht wird: im
     Katastrophenfall, wenn der Restore die Tabelle verloren hat.
     Statt "Tabelle fehlt" bekommt man einen Planungsfehler, und die
     Kernchecks brechen ab, bevor Abschnitt 7 ueberhaupt laeuft.

     Gefunden am 12.10.2026 beim Testen dieser Datei gegen eine
     Datenbank, in der die Tabelle fehlte. Abschnitt 5 hat dieselbe
     Form, aber dort steht der Schutz in einer EIGENEN Anweisung mit
     continue — deshalb traegt er dort.

     to_regclass gibt NULL statt zu werfen. Der Vergleich attrelid =
     NULL findet nichts, und dann greift die Pruefung links. */

  if pg_catalog.to_regclass('public.recommendation_events') is not null
     and not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = pg_catalog.to_regclass('public.recommendation_events')
       and a.attname = 'id' and (a.attidentity <> '' or a.atthasdef)
  ) then
    v_restore_defekt := v_restore_defekt ||
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
     ERGEBNIS — IN DIESER REIHENFOLGE
     ═══════════════════════════════════════════════════════════

     Hinweise zuerst, Produktionsbefunde danach, Restore-Defekt
     zuletzt. Grund: die Exception beendet den Block. Stuende sie
     vorne, saehe man bei einem Restore-Defekt die Befunde nicht
     mehr — und genau die braucht man, um zu entscheiden, ob der
     Defekt vom Restore kommt oder schon im Dump steckte. */

  if pg_catalog.array_length(v_hinweis, 1) > 0 then
    raise notice E'% Hinweise (kein Fehler):\n  %',
      pg_catalog.array_length(v_hinweis, 1),
      pg_catalog.array_to_string(v_hinweis, E'\n  ');
  end if;

  /* WARNING, nicht EXCEPTION.
     ──────────────────────────
     Was hier steht, hat der Restore nicht verursacht — er hat es
     getreu uebernommen. Der Restore-Beweis ist damit gueltig; die
     Produktion ist es nicht. Der Workflow greift den Marker auf und
     stellt ihn in die Zusammenfassung, damit nichts davon im
     Protokoll verschwindet.

     Nicht still reparieren (G2 §39): Befund melden, Wirkung
     einschaetzen, kleinstmoeglichen Fix vorschlagen, entscheiden
     laesst der Mensch. */
  if pg_catalog.array_length(v_prod_befund, 1) > 0 then
    raise warning E'PRODUKTIONSBEFUND — % Eintraege, vom Dump getreu uebernommen:\n  %',
      pg_catalog.array_length(v_prod_befund, 1),
      pg_catalog.array_to_string(v_prod_befund, E'\n  ');
  end if;

  if pg_catalog.array_length(v_restore_defekt, 1) > 0 then
    raise exception E'Restore unvollstaendig:\n  %',
      pg_catalog.array_to_string(v_restore_defekt, E'\n  ');
  end if;

  raise notice 'Kernchecks: kein Restore-Defekt';
end $$;
