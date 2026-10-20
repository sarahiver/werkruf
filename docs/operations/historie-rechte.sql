-- docs/operations/historie-rechte.sql
--
-- Was darf postgres auf den Erweiterungs-Tabellen überhaupt?
--
-- ═══════════════════════════════════════════════════════════════
-- ANLASS
-- ═══════════════════════════════════════════════════════════════
--
-- Am 20.10.2026 scheiterte docs/operations/historie-einmalig.sql an
-- der ersten Anweisung:
--
--   ERROR: 42501: must be owner of table job_run_details
--
-- CREATE INDEX verlangt Eigentum, und auf Supabase gehören die
-- Tabellen der Erweiterungen nicht postgres. Weil der Index die
-- erste Anweisung war, ist nichts weiter gelaufen — der Zustand ist
-- unverändert.
--
-- Entscheidend ist jetzt eine andere Frage: LÖSCHEN ist ein anderes
-- Recht als EIGENTUM. Darf postgres aus den beiden Tabellen löschen,
-- funktioniert der tägliche Prune-Job (Migration 20261020120000),
-- auch ohne Index — dann bleibt die Tabelle klein, und ein
-- Durchlauf über wenige hundert Zeilen kostet nichts.
--
-- Darf er es nicht, brauchen wir einen anderen Weg, und dieser
-- Befund sagt welchen.
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT
-- ═══════════════════════════════════════════════════════════════
--
-- Ausschließlich lesend. Eine einzige Anweisung. Rolle postgres.
-- Fragt nur den Systemkatalog und die Rechtefunktionen.
--
-- ═══════════════════════════════════════════════════════════════
-- SO LIEST MAN DAS ERGEBNIS
-- ═══════════════════════════════════════════════════════════════
--
--   darf_loeschen = ja   → Prune-Job reicht, kein Index nötig
--   darf_loeschen = NEIN → wir drosseln stattdessen den Aufrufer
--
-- Die Zeile "cron.log_run" zeigt, ob pg_cron das Protokoll
-- überhaupt schreiben muss. Steht dort "on" und wir dürfen die
-- Einstellung ändern, wäre das die sauberste Lösung von allen:
-- keine Zeilen, kein Aufräumen, kein Index.

select
  'Wer bin ich' as frage,
  current_user  as antwort,
  session_user  as zusatz

union all

select
  'Eigentuemer ' || n.nspname || '.' || c.relname,
  pg_get_userbyid(c.relowner),
  case when pg_get_userbyid(c.relowner) = current_user
       then 'das bin ich' else 'nicht ich' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'cron' and c.relname = 'job_run_details')
   or (n.nspname = 'net'  and c.relname = '_http_response')

union all

select
  'darf_loeschen ' || t.name,
  case
    when to_regclass(t.name) is null then 'Tabelle gibt es nicht'
    when has_table_privilege(current_user, t.name, 'DELETE') then 'ja'
    else 'NEIN'
  end,
  case
    when to_regclass(t.name) is null then '—'
    else 'select=' || (case when has_table_privilege(current_user, t.name, 'SELECT')
                            then 'ja' else 'nein' end)
      || ' | truncate=' || (case when has_table_privilege(current_user, t.name, 'TRUNCATE')
                            then 'ja' else 'nein' end)
  end
from (values ('cron.job_run_details'), ('net._http_response')) as t(name)

union all

/* Schreibt pg_cron das Protokoll ueberhaupt? Laesst sich das
   abschalten, braucht es weder Index noch Prune. */
select
  'cron.log_run',
  coalesce(current_setting('cron.log_run', true), 'nicht gesetzt'),
  'off = pg_cron schreibt nichts mehr mit'

union all

select
  'cron.log_statement',
  coalesce(current_setting('cron.log_statement', true), 'nicht gesetzt'),
  'protokolliert zusaetzlich den SQL-Text'

union all

/* Liegen die Prune-Funktionen der Migration schon? */
select
  'Migration 20261020120000',
  case when to_regprocedure('public.run_history_maintenance()') is null
       then 'NICHT angewendet' else 'angewendet' end,
  case when exists (select 1 from cron.job where jobname = 'history-prune')
       then 'Job history-prune steht' else 'Job fehlt' end

union all

select
  'Groesse ' || t.name,
  case when to_regclass(t.name) is null then '—'
       else pg_size_pretty(pg_total_relation_size(t.name)) end,
  '—'
from (values ('cron.job_run_details'), ('net._http_response')) as t(name);
