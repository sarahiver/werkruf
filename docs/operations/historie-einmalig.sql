-- docs/operations/historie-einmalig.sql
--
-- Index anlegen und die aufgelaufene Historie einmalig bereinigen
--
-- ═══════════════════════════════════════════════════════════════
-- ACHTUNG — DIESES SKRIPT SCHREIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Anders als alles andere in diesem Verzeichnis. Es legt einen Index
-- an und loescht Zeilen aus zwei Tabellen, die Erweiterungen gehoeren:
--
--   cron.job_run_details   Laufprotokoll von pg_cron
--   net._http_response     Antwortspeicher von pg_net
--
-- BEIDE GEHOEREN NICHT WERKRUF. Keine fachliche Zeile wird angefasst:
-- kein Nutzer, kein Betrieb, keine Bewertung, keine Mail, kein Event.
--
-- Es ist auch nicht rueckgaengig zu machen. Was hier geloescht wird,
-- ist Protokoll — alte Cron-Laeufe und alte HTTP-Antworten. Niemand
-- liest sie: ops_cron_failures() schaut 60 Minuten zurueck,
-- net._http_response hatte in 42 Tagen null Seq-Scans.
--
-- Einmal ausfuehren. Danach haelt der taegliche Job history-prune
-- (Migration 20261020120000) den Zustand.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT IN DER MIGRATION
-- ═══════════════════════════════════════════════════════════════
--
-- Ein CREATE INDEX auf einer Tabelle der Erweiterung kann an
-- fehlenden Rechten scheitern. In einer Migration haette das die
-- ganze Migration abgebrochen — und auch die Prune-Funktionen waeren
-- nicht gelandet. Hier siehst du das Ergebnis sofort und kannst
-- entscheiden.
--
-- ═══════════════════════════════════════════════════════════════
-- SO AUSFUEHREN
-- ═══════════════════════════════════════════════════════════════
--
-- Supabase SQL Editor, Rolle postgres, ALLES hineinkopieren, einmal
-- Run. Der Editor zeigt nur das Ergebnis der LETZTEN Anweisung —
-- deshalb steht am Ende die Nachmessung. Sie ist dein Beleg.
--
-- Scheitert eine Anweisung in der Mitte, sind die vorherigen bereits
-- festgeschrieben. Das ist hier unkritisch: Jeder Schritt ist fuer
-- sich sinnvoll, und keiner haengt am naechsten.
--
-- Voraussetzung: Migration 20261020120000_historie_aufraeumen.sql ist
-- angewendet. Ohne sie fehlen die Prune-Funktionen, und die Historie
-- laeuft in sieben Tagen wieder voll.


-- ═══════════════════════════════════════════════════════════════
-- 1 — DER INDEX
-- ═══════════════════════════════════════════════════════════════
--
-- Das Kernstueck. ops_cron_failures(60) filtert auf
--
--   where d.status = 'failed'
--     and d.start_time > now() - interval '60 minutes'
--
-- und las dafuer bisher die ganze Tabelle: 4.074 Seq-Scans,
-- 57.527.863 Zeilen, idx_scan 0.
--
-- Der Index steht auf start_time, nicht auf status. Grund: status ist
-- in fast allen Zeilen 'succeeded' — ein Index darauf trennt kaum
-- etwas. start_time trennt scharf, weil die Abfrage eine Stunde aus
-- Wochen herausschneidet. Postgres liest dann nur diese Stunde und
-- prueft status an den wenigen gefundenen Zeilen.
--
-- Wirkt sofort und unabhaengig davon, wie gross die Tabelle ist.

create index if not exists job_run_details_start_time_idx
  on cron.job_run_details (start_time desc);


-- ═══════════════════════════════════════════════════════════════
-- 2 — DIE AUFGELAUFENE HISTORIE
-- ═══════════════════════════════════════════════════════════════
--
-- Dieselben Fristen wie im taeglichen Job: sieben Tage fuer die
-- Cron-Laeufe, ein Tag fuer die HTTP-Antworten. Ueber die
-- Prune-Funktionen der Migration, damit es hier und dort dieselbe
-- Regel ist und nicht zwei, die auseinanderlaufen koennen.

select public.prune_cron_history() as geloeschte_cron_laeufe;

select public.prune_net_history()  as geloeschte_http_antworten;


-- ═══════════════════════════════════════════════════════════════
-- 3 — NACHMESSUNG
-- ═══════════════════════════════════════════════════════════════
--
-- SO IST ES RICHTIG:
--
--   beide Tabellen deutlich unter 1 MB
--   index_vorhanden = ja
--   job_vorhanden    = ja
--
-- Die Dateigroesse schrumpft nicht sofort auf den Zielwert: Ein
-- DELETE gibt den Platz zur Wiederverwendung frei, aber erst
-- Autovacuum raeumt ihn auf. Entscheidend ist ohnehin nicht die
-- Groesse, sondern dass der Index benutzt wird — danach liest
-- ops_cron_failures nur noch die letzte Stunde, egal wie gross die
-- Tabelle ist.
--
-- Soll die Datei auch physisch schrumpfen, geht das mit
--
--   vacuum (analyze, verbose) cron.job_run_details;
--
-- Das muss ALLEIN laufen, in einem eigenen Fenster: vacuum laeuft
-- nicht innerhalb einer Transaktion. Noetig ist es nicht.

select
  'cron.job_run_details' as tabelle,
  pg_size_pretty(pg_total_relation_size('cron.job_run_details')) as groesse,
  (select count(*) from cron.job_run_details)                    as zeilen,
  case when exists (
    select 1 from pg_indexes
     where schemaname = 'cron'
       and tablename  = 'job_run_details'
       and indexdef ilike '%start_time%'
  ) then 'ja' else 'NEIN' end as index_vorhanden,
  case when exists (
    select 1 from cron.job where jobname = 'history-prune'
  ) then 'ja' else 'NEIN' end as job_vorhanden

union all

select
  'net._http_response',
  case when to_regclass('net._http_response') is null then '—'
       else pg_size_pretty(pg_total_relation_size('net._http_response')) end,
  case when to_regclass('net._http_response') is null then 0
       else (select count(*) from net._http_response) end,
  '—',
  '—';
