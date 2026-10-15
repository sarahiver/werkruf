-- 20261012110000_cron_kanonisch.sql
--
-- Die zehn produktiven Cron-Jobs, reproduzierbar aus dem Repo.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM
-- ═══════════════════════════════════════════════════════════════
--
-- Von den zehn Jobs, die WERKRUF betreiben, stand bisher einer im
-- Repo: engine-daily. Die anderen neun existierten nur in Produktion,
-- von Hand im SQL-Editor angelegt.
--
-- Ein Restore konnte deshalb Schema und Daten vollstaendig
-- wiederherstellen und ein Produkt erzeugen, das nichts mehr tut —
-- und das faellt erst eine Woche spaeter auf, wenn keine Wochenmail
-- kommt.
--
-- ═══════════════════════════════════════════════════════════════
-- WOHER DIESE DEFINITIONEN KOMMEN
-- ═══════════════════════════════════════════════════════════════
--
-- Aus cron.job, ausgelesen am 12.10.2026. Nicht aus Erinnerung, nicht
-- aus frueheren Berichten. Zeitplaene, Pfade, Bodies und Timeouts sind
-- uebernommen, nicht gewaehlt:
--
--   jobname           schedule        Ziel
--   ───────────────────────────────────────────────────────────────
--   engine-daily      30 4 * * *      google-business/events/evaluate-all
--   gbp-schedule      0 * * * *       google-business/sync/schedule
--   gbp-worker        */5 * * * *     google-business/sync/run
--   gbp-maintenance   */15 * * * *    run_sync_maintenance()  (kein HTTP)
--   gbp-api-monitor   30 5,6 * * *    gbp-api-monitor
--   comm-alerts       */15 * * * *    send-email/plan {"channel":"immediate_alert"}
--   comm-weekly       0 7 * * 1       send-email/plan {"channel":"all"}
--   mail-schedule     0 8 * * *       send-email/schedule
--   mail-worker       */10 * * * *    send-email/run
--   ops-alert         */15 * * * *    ops-alert
--
-- Die Serverzeitzone ist UTC (geprueft am 12.10.2026). Alle
-- Zeitplaene sind daher UTC-Zeiten.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE MONTAGSREIHENFOLGE
-- ═══════════════════════════════════════════════════════════════
--
--   04:30 UTC  engine-daily    bewertet neu, schreibt events
--   07:00 UTC  comm-weekly     plant daraus die Wochenmail
--   alle 10min mail-worker     arbeitet die Queue ab
--
-- Die Engine VOR dem Planer, mit zweieinhalb Stunden Abstand. Liefe
-- es umgekehrt, laese die Montagsmail den Stand vom letzten Abgleich,
-- der Tage zurueckliegen kann. Diese Reihenfolge darf eine
-- Versionierung nicht veraendern — hier ist sie unveraendert.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION ANFASST UND WAS NICHT
-- ═══════════════════════════════════════════════════════════════
--
-- Sie kanonisiert die zehn Jobs unten: vorhandene Definition gezielt
-- entfernen, genau eine neue anlegen. Idempotent — ein zweiter Lauf
-- erzeugt keinen zweiten Job.
--
-- Sie loescht NICHT pauschal alle Jobs und sie fasst keine fremden
-- oder Supabase-eigenen Jobs an. Eine Ausnahme, bewusst: einen Job
-- unter anderem Namen, dessen Befehl denselben Endpunkt MIT demselben
-- Body aufruft wie ein kanonischer Job, entfernt sie — das ist eine
-- funktionale Dublette, und zwei davon wuerden sich gegenseitig die
-- Arbeit wegnehmen. Jede solche Entfernung wird als NOTICE genannt,
-- nie still.
--
-- Keine JobIDs. Sie unterscheiden sich zwischen Produktion und jedem
-- Restore.
--
-- Kein Secret im Befehlstext. Alle neun HTTP-Jobs holen es zur
-- Laufzeit aus vault.decrypted_secrets, wie in Produktion.

begin;

/* ═══════════════════════════════════════════════════════════════
   0 — VORAUSSETZUNGEN
   ═══════════════════════════════════════════════════════════════

   Fail-closed. Diese Migration legt Jobs an, die auf Dinge zeigen;
   fehlt eines davon, scheitert der Job spaeter still in
   cron.job_run_details, wo niemand hinsieht. Besser hier, laut.

   gbp_monitor_ist_laufzeit ist der Grund, aus dem diese Pruefung
   existiert: die Funktion steht in Produktion und wurde dort von
   Hand angelegt — im Repo gab es sie nie. Eine aus dem Repo
   aufgebaute Datenbank haette den Job und nicht die Funktion.
   Sie wird in 20261012110000_fehlende_objekte.sql versioniert, die
   nach Dateinamen VOR dieser laeuft. */
do $$
/* Die ::text-Casts unten sind nicht Zierde. Ohne sie waehlt
   PostgreSQL fuer text[] || 'literal' die Variante anyarray ||
   anyarray und versucht, die Zeichenkette als Array-Literal zu
   lesen — "malformed array literal". Der Fehlerfall haette dann
   eine unverstaendliche Meldung statt der gemeinten gegeben.
   Gefunden von der Gegenprobe, nicht beim Schreiben. */
declare v_fehlt text[] := array[]::text[];
begin
  if pg_catalog.to_regclass('cron.job') is null then
    raise exception 'pg_cron ist nicht installiert — diese Migration gehoert in eine Supabase-Datenbank';
  end if;

  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    v_fehlt := v_fehlt || 'vault.decrypted_secrets (Extension supabase_vault)'::text;
  end if;

  if not exists (select 1 from pg_catalog.pg_proc p
                   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'net' and p.proname = 'http_post') then
    v_fehlt := v_fehlt || 'net.http_post (Extension pg_net)'::text;
  end if;

  if not exists (select 1 from pg_catalog.pg_proc p
                   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'run_sync_maintenance') then
    v_fehlt := v_fehlt || 'public.run_sync_maintenance() — Job gbp-maintenance'::text;
  end if;

  /* run_sync_maintenance() ruft prune_rate_limits(), und das loescht
     aus public.rate_limits. Fehlt die Tabelle, wirft gbp-maintenance
     alle fuenfzehn Minuten — in cron.job_run_details, wo niemand
     hinsieht.

     sync_locks dasselbe: try_acquire_lock() und release_lock()
     arbeiten darauf, und daran haengen die Sync-Worker.

     Beide Tabellen standen bis 20261012110000 nur in Produktion. */
  if pg_catalog.to_regclass('public.rate_limits') is null then
    v_fehlt := v_fehlt ||
      'public.rate_limits — ueber run_sync_maintenance() von gbp-maintenance gebraucht'::text;
  end if;

  if pg_catalog.to_regclass('public.sync_locks') is null then
    v_fehlt := v_fehlt ||
      'public.sync_locks — von try_acquire_lock() und release_lock() gebraucht'::text;
  end if;

  if not exists (select 1 from pg_catalog.pg_proc p
                   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'gbp_monitor_ist_laufzeit') then
    v_fehlt := v_fehlt ||
      ('public.gbp_monitor_ist_laufzeit(integer, text) — Job gbp-api-monitor; '
       || 'siehe 20261012110000_fehlende_objekte.sql')::text;
  end if;

  if pg_catalog.array_length(v_fehlt, 1) > 0 then
    raise exception E'Voraussetzungen fehlen:\n  %',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════════
   1 — DER PROJEKTVERWEIS AN EINER STELLE
   ═══════════════════════════════════════════════════════════════

   Zehnmal dieselbe URL im Text waere zehn Stellen, die bei einem
   Restore in ein anderes Projekt auseinanderlaufen koennen.

   Nach einem Restore in ein NEUES Supabase-Projekt muss dieser Wert
   angepasst werden, bevor die Migration laeuft — oder die Jobs
   zeigen auf das alte, verlorene Projekt. Das Runbook sagt es an
   derselben Stelle. */
create or replace function pg_temp.werkruf_functions_basis()
returns text
language sql
immutable
as $$ select 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1' $$;

/* ═══════════════════════════════════════════════════════════════
   2 — DIE KANONISCHEN DEFINITIONEN
   ═══════════════════════════════════════════════════════════════ */

do $$
declare
  v_basis    text := pg_temp.werkruf_functions_basis();
  v_job      record;
  v_befehl   text;
  v_dublette record;

  /* Die Vorlage fuer die neun HTTP-Jobs. Wortgleich mit dem, was in
     Produktion steht — nur die Einrueckung ist einheitlich. */
  c_vorlage  text :=
$v$
  select net.http_post(
    url     := %L,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 /* Das Secret steht im Vault, nicht im Befehlstext. */
                 'X-Worker-Secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'gbp_worker_secret')
               ),
    body    := %L::jsonb,
    timeout_milliseconds := %s
  );
$v$;
begin

  for v_job in
    select * from (values
      -- jobname,           schedule,        pfad,                                      body,                            timeout
      ('engine-daily',      '30 4 * * *',    'google-business/events/evaluate-all',     '{}',                            180000),
      ('gbp-schedule',      '0 * * * *',     'google-business/sync/schedule',           '{}',                             20000),
      ('gbp-worker',        '*/5 * * * *',   'google-business/sync/run',                '{"limit": 8}',                   60000),
      ('comm-alerts',       '*/15 * * * *',  'send-email/plan',                         '{"channel": "immediate_alert"}', 50000),
      ('comm-weekly',       '0 7 * * 1',     'send-email/plan',                         '{"channel": "all"}',             60000),
      ('mail-schedule',     '0 8 * * *',     'send-email/schedule',                     '{}',                             30000),
      ('mail-worker',       '*/10 * * * *',  'send-email/run',                          '{"limit": 20}',                  50000),
      ('ops-alert',         '*/15 * * * *',  'ops-alert',                               '{}',                             20000)
    ) as j(jobname, schedule, pfad, body, timeout)
  loop
    v_befehl := pg_catalog.format(c_vorlage,
                  v_basis || '/' || v_job.pfad, v_job.body, v_job.timeout);

    /* ── Funktionale Dubletten ──
       Ein Job unter anderem Namen, der denselben Endpunkt mit
       demselben Body aufruft. Zwei davon nehmen sich gegenseitig die
       Arbeit weg: der erste holt die Zeilen, der zweite findet
       nichts. Genannt, nicht still entfernt. */
    for v_dublette in
      select jobname from cron.job
       where jobname <> v_job.jobname
         and command like '%' || v_basis || '/' || v_job.pfad || '%'
         and command like '%' || v_job.body || '%'
    loop
      raise notice '[cron] funktionale Dublette entfernt: % (gleicher Endpunkt und Body wie %)',
        v_dublette.jobname, v_job.jobname;
      perform cron.unschedule(v_dublette.jobname);
    end loop;

    if exists (select 1 from cron.job where jobname = v_job.jobname) then
      perform cron.unschedule(v_job.jobname);
    end if;

    perform cron.schedule(v_job.jobname, v_job.schedule, v_befehl);
    raise notice '[cron] % — % — %', v_job.jobname, v_job.schedule, v_job.pfad;
  end loop;

  /* ─────────────────────────────────────────────────────────────
     gbp-maintenance — der einzige Job ohne HTTP
     ─────────────────────────────────────────────────────────────
     Ruft direkt eine SQL-Funktion. Kein net.http_post, kein Secret,
     keine Edge Function — und laeuft deshalb auch dann, wenn die
     Functions nicht erreichbar sind. */
  if exists (select 1 from cron.job where jobname = 'gbp-maintenance') then
    perform cron.unschedule('gbp-maintenance');
  end if;
  perform cron.schedule('gbp-maintenance', '*/15 * * * *',
    ' select public.run_sync_maintenance(); ');
  raise notice '[cron] gbp-maintenance — */15 * * * * — run_sync_maintenance()';

  /* ─────────────────────────────────────────────────────────────
     gbp-api-monitor — mit Laufzeitfenster
     ─────────────────────────────────────────────────────────────
     Zweimal taeglich eingeplant (05:30 und 06:30 UTC), aber nur
     ausgefuehrt, wenn gbp_monitor_ist_laufzeit(7, 'Europe/Berlin')
     zustimmt. Der zweite Termin ist der Nachholversuch, falls der
     erste in eine Umstellung der Sommerzeit fiel: 7 Uhr Berlin ist
     im Winter 06:00 UTC und im Sommer 05:00 UTC.

     Deshalb steht hier ein case-when und nicht einfach ein anderer
     Zeitplan — die Entscheidung braucht die Zeitzonenrechnung, die
     cron nicht kann. */
  if exists (select 1 from cron.job where jobname = 'gbp-api-monitor') then
    perform cron.unschedule('gbp-api-monitor');
  end if;
  perform cron.schedule('gbp-api-monitor', '30 5,6 * * *', pg_catalog.format(
$v$
  select
    case when public.gbp_monitor_ist_laufzeit(7, 'Europe/Berlin') then
      net.http_post(
        url     := %L,
        headers := jsonb_build_object(
                     'Content-Type',    'application/json',
                     'X-Worker-Secret', (select decrypted_secret
                                           from vault.decrypted_secrets
                                          where name = 'gbp_worker_secret')),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000)
    end;
$v$, v_basis || '/gbp-api-monitor'));
  raise notice '[cron] gbp-api-monitor — 30 5,6 * * * — gbp-api-monitor';
end $$;

/* ═══════════════════════════════════════════════════════════════
   3 — SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════════

   Genau zehn kanonische Jobs, jeder genau einmal, jeder aktiv. Ein
   zweiter Lauf dieser Migration muss dasselbe Ergebnis liefern —
   deshalb steht die Pruefung in der Migration und nicht daneben. */
do $$
declare
  v_soll text[] := array[
    'comm-alerts', 'comm-weekly', 'engine-daily', 'gbp-api-monitor',
    'gbp-maintenance', 'gbp-schedule', 'gbp-worker', 'mail-schedule',
    'mail-worker', 'ops-alert'];
  v_name  text;
  v_anzahl integer;
  v_fehlt text[] := array[]::text[];
begin
  foreach v_name in array v_soll
  loop
    select count(*) into v_anzahl from cron.job where jobname = v_name;
    if v_anzahl = 0 then
      v_fehlt := v_fehlt || ('fehlt: ' || v_name);
    elsif v_anzahl > 1 then
      v_fehlt := v_fehlt || pg_catalog.format('%s existiert %s mal', v_name, v_anzahl);
    elsif not (select active from cron.job where jobname = v_name) then
      /* Kein Fehler: restore.sh legt die Jobs absichtlich still.
         Aber sichtbar, damit niemand glaubt, der Betrieb laufe. */
      raise notice '[cron] % ist INAKTIV', v_name;
    end if;
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) > 0 then
    raise exception E'Cron-Kanonisierung unvollstaendig:\n  %',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;

  raise notice '[cron] 10 kanonische Jobs, je genau einer';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Was steht jetzt da?
--   select jobname, schedule, active,
--          substring(command from 'functions/v1/[^'' ]*') as ziel
--   from cron.job order by jobname;
--
-- Montagsreihenfolge (Serverzeitzone pruefen, erwartet UTC):
--   select current_setting('TimeZone');
--   select jobname, schedule from cron.job
--    where jobname in ('engine-daily', 'comm-weekly') order by schedule;
--   → 0 7 * * 1 (comm-weekly) muss NACH 30 4 * * * (engine-daily) liegen.
--
-- Nach einem Restore in ein NEUES Projekt zuerst
-- pg_temp.werkruf_functions_basis() in dieser Datei anpassen, sonst
-- zeigen alle Jobs auf das alte Projekt.
