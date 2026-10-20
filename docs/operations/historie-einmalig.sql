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
-- 1 — KEIN INDEX. WARUM NICHT.
-- ═══════════════════════════════════════════════════════════════
--
-- Hier stand bis zum 20.10.2026
--
--   create index if not exists job_run_details_start_time_idx
--     on cron.job_run_details (start_time desc);
--
-- Das scheiterte in Produktion:
--
--   ERROR: 42501: must be owner of table job_run_details
--
-- CREATE INDEX verlangt EIGENTUM. Auf Supabase gehoeren
-- cron.job_run_details und net._http_response der Rolle
-- supabase_admin, nicht postgres. Gemessen mit
-- docs/operations/historie-rechte.sql.
--
-- Loeschen ist ein anderes Recht und IST erlaubt — select, delete und
-- sogar truncate. Darauf beruht alles Weitere: Ohne Index muss die
-- Tabelle klein bleiben, damit ein Durchlauf nichts kostet. Genau das
-- leistet der taegliche Prune-Job aus Migration 20261020120000.
--
-- NICHT GEMACHT, OBWOHL ES NAHELAG: cron.log_run auf off setzen.
-- Dann schriebe pg_cron gar nichts mehr mit — und
-- public.ops_cron_failures() haette keine Datenquelle mehr. Die
-- Ueberwachung der Cronjobs waere lautlos blind. Ihr Kommentar nennt
-- sie "das Signal, das beim Ausfall vom 9.-11.09. als einziges
-- vorhanden war". Die Einstellung steht auf on und bleibt dort.


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
-- WORAUF ES ANKOMMT: die Spalte "zeilen".
--
-- Ohne Index entscheidet allein die Zeilenzahl, was ein Durchlauf
-- kostet — und ops_cron_failures() laeuft 96 Mal am Tag.
--
-- Rund 750 Cron-Laeufe am Tag mal sieben Tage Aufbewahrung ergeben
-- etwa 5.000 Zeilen. Bleibt es dabei, ist die Sache erledigt.
--
-- Steht dort deutlich mehr, oder ist die Tabelle trotz weniger Zeilen
-- noch gross, hat jede Zeile mehr Inhalt als erwartet (return_message
-- nimmt ganze HTTP-Antworten auf). Dann ist die naechste Stellschraube
-- die Aufbewahrungsdauer:
--
--   select public.prune_cron_history('2 days');
--
-- und bei Bedarf dauerhaft, indem der Job mit kuerzerer Frist laeuft.
-- Erst messen, dann drehen — die Zahl unten sagt, ob es noetig ist.
--
-- ───────────────────────────────────────────────────────────────
-- DANACH NOCH VACUUM — UND ZWAR ZWINGEND
-- ───────────────────────────────────────────────────────────────
--
-- Der DELETE allein bringt fast nichts. Gemessen am 20.10.2026 an
-- einer nachgebauten Tabelle, mit derselben Abfrage wie
-- ops_cron_failures(60):
--
--   40.000 Zeilen, 18 MB                   2.763 Puffer
--   nach Prune, 10.079 Zeilen, ohne vacuum 2.356 Puffer
--   nach Prune UND vacuum                    596 Puffer
--
-- Der mittlere Wert ist der Punkt. Ein DELETE gibt den Platz nur zur
-- Wiederverwendung frei; die leeren Seiten bleiben stehen, und ein
-- Durchlauf ohne Index liest sie alle mit. Erst vacuum nimmt sie aus
-- dem Weg.
--
-- Deshalb als ZWEITEN DURCHGANG, allein in einem leeren Fenster:
--
--   vacuum (analyze, verbose) cron.job_run_details;
--
-- Allein, weil vacuum nicht innerhalb einer Transaktion laeuft.
-- Meldet der Editor "VACUUM cannot run inside a transaction block",
-- steht noch etwas anderes mit im Fenster.
--
-- Fuer net._http_response lohnt es sich ebenfalls, ist dort aber
-- weniger dringend: Die Tabelle wird nicht gelesen (null Seq-Scans in
-- 42 Tagen) und kostet nur Platz.
--
--   vacuum (analyze) net._http_response;
--
-- Danach diese Nachmessung noch einmal laufen lassen. Die Groesse
-- sollte dann deutlich gefallen sein.

select
  'cron.job_run_details' as tabelle,
  pg_size_pretty(pg_total_relation_size('cron.job_run_details')) as groesse,
  (select count(*) from cron.job_run_details)                    as zeilen,
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
  '—';
