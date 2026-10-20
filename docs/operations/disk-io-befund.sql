-- docs/operations/disk-io-befund.sql
--
-- Wohin geht das Disk-IO-Budget?
--
-- ═══════════════════════════════════════════════════════════════
-- ANLASS
-- ═══════════════════════════════════════════════════════════════
--
-- Supabase meldete am 19.10.2026 um 17:06, das Projekt erschoepfe
-- sein Disk-IO-Budget. Zu diesem Zeitpunkt hatte WERKRUF zwei
-- Nutzerkonten und wenige hundert fachliche Zeilen. Ein Projekt
-- dieser Groesse schafft das nicht durch Kundenverkehr.
--
-- Neun Cron-Jobs laufen im Hintergrund (20261012120000_cron_kanonisch):
--
--   gbp-worker        */5     288 Laeufe/Tag
--   mail-worker       */10    144
--   comm-alerts       */15     96
--   ops-alert         */15     96
--   gbp-maintenance   */15     96
--   gbp-schedule      0 * * *   24
--   gbp-api-monitor   2 ×/Tag    2
--   engine-daily, mail-schedule  je 1
--   comm-weekly                  1/Woche
--                              ──────
--                        rund 750 Laeufe/Tag
--
-- Jeder Lauf hinterlaesst mindestens eine Zeile in
-- cron.job_run_details. Jeder Lauf, der eine Edge Function ruft,
-- hinterlaesst zusaetzlich eine Antwort in net._http_response.
--
-- Beide Tabellen raeumt niemand auf. Weder Supabase noch eine
-- Migration dieses Projekts. run_sync_maintenance() kuemmert sich um
-- rate_limits und sync_runs — um diese beiden nicht.
--
-- Das ist die Vermutung. Diese Abfrage prueft sie, statt sie zu
-- glauben.
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT
-- ═══════════════════════════════════════════════════════════════
--
-- Ausschliesslich lesend. Kein insert, update, delete, alter, drop.
-- Eine einzige Anweisung. Rolle postgres.
-- Alles hineinkopieren, einmal Run.
--
-- ═══════════════════════════════════════════════════════════════
-- SO LIEST MAN DAS ERGEBNIS
-- ═══════════════════════════════════════════════════════════════
--
--   A GROESSE     Die zwanzig groessten Tabellen, mit Schema.
--                 Steht oben etwas aus cron oder net, ist die
--                 Vermutung bestaetigt.
--   B WACHSTUM    Zeilen und tote Zeilen in den Verdaechtigen.
--                 Viele tote Zeilen heissen: Autovacuum kommt nicht
--                 hinterher, und jeder Lesezugriff zahlt dafuer.
--   C ZUGRIFFE    Welche Tabelle wie oft sequenziell gelesen wird.
--                 Ein Seq-Scan auf einer grossen Tabelle ist der
--                 teuerste IO, den es gibt.
--
-- Die Tabellen in cron und net gehoeren nicht WERKRUF. Diese
-- Abfrage aendert deshalb nichts an ihnen — sie misst nur.

with verdaechtig as (
  select unnest(array[
    'cron.job_run_details',
    'net._http_response',
    'net.http_request_queue',
    'public.sync_runs',
    'public.sync_jobs',
    'public.audit_logs',
    'public.events',
    'public.email_queue',
    'public.recommendation_events',
    'public.gbp_api_snapshots'
  ]) as name
),

/* ── A — die zwanzig groessten Tabellen ─────────────────────── */
groesse as (
  select
    1 as nr,
    'A GROESSE'::text as bereich,
    (n.nspname || '.' || c.relname)::text as gegenstand,
    (pg_size_pretty(pg_total_relation_size(c.oid))
      || '  (davon Indizes ' || pg_size_pretty(pg_indexes_size(c.oid)) || ')')::text as wert,
    pg_total_relation_size(c.oid) as sortierung
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  order by pg_total_relation_size(c.oid) desc
  limit 20
),

/* ── B — Zeilen und Leichen in den Verdaechtigen ────────────── */
wachstum as (
  select
    2 as nr,
    'B WACHSTUM'::text as bereich,
    v.name::text as gegenstand,
    (case
       when to_regclass(v.name) is null then 'Tabelle existiert nicht'
       else coalesce((
         select 'lebend ' || s.n_live_tup::text
             || ' | tot ' || s.n_dead_tup::text
             || ' | letztes Autovacuum ' || coalesce(to_char(s.last_autovacuum, 'YYYY-MM-DD HH24:MI'), 'nie')
             || ' | letztes Autoanalyze ' || coalesce(to_char(s.last_autoanalyze, 'YYYY-MM-DD HH24:MI'), 'nie')
           from pg_stat_all_tables s
          where s.relid = to_regclass(v.name)
       ), 'keine Statistik')
     end)::text as wert,
    0::bigint as sortierung
  from verdaechtig v
),

/* ── C — wer wird sequenziell durchsucht ────────────────────── */
zugriffe as (
  select
    3 as nr,
    'C ZUGRIFFE'::text as bereich,
    (s.schemaname || '.' || s.relname)::text as gegenstand,
    ('seq_scan ' || s.seq_scan::text
      || ' | dabei gelesene Zeilen ' || s.seq_tup_read::text
      || ' | idx_scan ' || coalesce(s.idx_scan, 0)::text
      || ' | insert ' || s.n_tup_ins::text
      || ' | update ' || s.n_tup_upd::text
      || ' | delete ' || s.n_tup_del::text)::text as wert,
    s.seq_tup_read as sortierung
  from pg_stat_all_tables s
  where s.schemaname not in ('pg_catalog', 'information_schema')
    and s.seq_tup_read > 0
  order by s.seq_tup_read desc
  limit 15
)

select bereich, gegenstand, wert
from (
  select * from groesse
  union all select * from wachstum
  union all select * from zugriffe
) s
order by nr, sortierung desc, gegenstand;
