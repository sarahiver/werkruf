-- 20261020120000_historie_aufraeumen.sql
--
-- Die Überwachung hört auf, die teuerste Abfrage der Datenbank zu sein
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND
-- ═══════════════════════════════════════════════════════════════
--
-- Supabase meldete am 19.10.2026 um 17:06, das Projekt erschöpfe sein
-- Disk-IO-Budget — bei zwei Nutzerkonten. Gemessen mit
-- docs/operations/disk-io-befund.sql ergab sich am 20.10.2026:
--
--   cron.job_run_details   28 MB
--                          4.074 Seq-Scans
--                          57.527.863 gelesene Zeilen
--                          idx_scan 0
--
--   net._http_response     39 MB, nie aufgeräumt
--
-- Zum Vergleich: Alle fachlichen Tabellen zusammen liegen unter 5 MB.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE URSACHENKETTE
-- ═══════════════════════════════════════════════════════════════
--
--   ops-alert (*/15, 96 Läufe/Tag)
--     → public.ops_alerts()
--       → public.ops_cron_failures(60)
--         → where d.status = 'failed'
--           and d.start_time > now() - interval '60 minutes'
--           → kein nutzbarer Index → voller Durchlauf über 28 MB
--
-- 4.074 Scans bei 96 Läufen am Tag sind rund 42 Tage. Die Zahlen
-- passen aufeinander.
--
-- Und cron.job_run_details wächst mit JEDEM Cron-Lauf — rund 750 am
-- Tag über alle neun Jobs. Niemand räumt sie auf: weder Supabase noch
-- eine Migration dieses Projekts. run_sync_maintenance() kümmert sich
-- um sync_runs und rate_limits, um diese beiden nicht.
--
-- Je größer die Tabelle, desto teurer jeder der 96 täglichen
-- Durchläufe. Ein sich selbst verstärkender Kreis.
--
-- Die Überwachung, die Ausfälle melden soll, war damit selbst der
-- teuerste Vorgang in der Datenbank geworden. Ausgerechnet
-- ops_cron_failures, deren Kommentar lautet: "Das Signal, das beim
-- Ausfall vom 9.-11.09. als einziges vorhanden war."
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT — UND WAS NICHT
-- ═══════════════════════════════════════════════════════════════
--
-- SIE LEGT ZWEI PRUNE-FUNKTIONEN AN und einen täglichen Cron-Job,
-- der sie ruft. Nach dem Muster, das es hier schon gibt:
-- prune_sync_runs() in run_sync_maintenance().
--
-- TÄGLICH, NICHT ALLE 15 MINUTEN. Das ist der Kern der Sache: Ein
-- ungeprüfter DELETE alle 15 Minuten wäre genau das Problem, das hier
-- gelöst werden soll. Einmal am Tag genügt — ops_cron_failures
-- schaut ohnehin nur 60 Minuten zurück.
--
-- SIE LEGT KEINEN INDEX AN — und zwar nicht aus Vorsicht, sondern
-- weil es nicht geht. Ein Versuch am 20.10.2026 in Produktion:
--
--   ERROR: 42501: must be owner of table job_run_details
--
-- CREATE INDEX verlangt EIGENTUM. cron.job_run_details und
-- net._http_response gehören auf Supabase der Rolle supabase_admin.
-- Dass der Index nie in dieser Migration stand, war die richtige
-- Entscheidung: Er hätte sie abgebrochen und die Prune-Funktionen
-- gleich mit verhindert.
--
-- LÖSCHEN ist ein anderes Recht und ist erlaubt — select, delete und
-- truncate, gemessen mit docs/operations/historie-rechte.sql. Darauf
-- beruht diese Migration.
--
-- Ohne Index entscheidet allein die Zeilenzahl, was ein Durchlauf
-- kostet. Deshalb ist die einmalige Bereinigung kein Nachgedanke,
-- sondern notwendig — und ein vacuum danach erst recht: Gemessen
-- bringt ein DELETE ohne vacuum fast nichts (2.763 → 2.356 Puffer),
-- erst mit vacuum fällt es auf 596. Die leeren Seiten liest ein
-- Durchlauf sonst weiter mit.
--
-- NICHT GEMACHT, OBWOHL ES NAHELAG: cron.log_run auf off setzen.
-- Dann schriebe pg_cron nichts mehr mit — und ops_cron_failures()
-- hätte keine Datenquelle. Die Cron-Überwachung wäre lautlos blind.
--
-- SIE LÖSCHT NICHTS BESTEHENDES. Die 67 MB bleiben, bis entweder der
-- tägliche Job das erste Mal läuft oder du die einmalige Bereinigung
-- ausführst.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM SECURITY DEFINER
-- ═══════════════════════════════════════════════════════════════
--
-- Beide Tabellen gehören Erweiterungen, nicht WERKRUF. Als SECURITY
-- DEFINER laufen die Funktionen mit den Rechten ihres Eigentümers
-- (postgres) statt denen des Aufrufers. Ohne das würde der
-- tägliche Job an fehlenden Rechten scheitern — und zwar still, in
-- cron.job_run_details, wo niemand hinsieht.
--
-- search_path ist festgenagelt, wie bei jeder SECURITY-DEFINER-
-- Funktion in diesem Projekt.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — cron.job_run_details kürzen
   ═══════════════════════════════════════════════════════════════

   Sieben Tage. ops_cron_failures(60) braucht 60 Minuten; sieben Tage
   lassen Raum für eine Fehlersuche am Wochenende, ohne dass die
   Tabelle wieder in die Zehntausende läuft. */
create or replace function public.prune_cron_history(
  p_keep interval default '7 days'
) returns integer
    language plpgsql
    security definer
    set search_path to 'public', 'cron'
as $$
declare
  v_count integer;
begin
  delete from cron.job_run_details
   where start_time < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.prune_cron_history(interval) is
  'Kuerzt cron.job_run_details. Ohne das waechst die Tabelle mit jedem '
  'Cron-Lauf, und ops_cron_failures() liest sie alle 15 Minuten ganz '
  'durch — der Befund vom 20.10.2026.';

/* ═══════════════════════════════════════════════════════════════
   2 — net._http_response kürzen
   ═══════════════════════════════════════════════════════════════

   Ein Tag. Diese Tabelle ist ein Zwischenspeicher für Antworten von
   net.http_post; gelesen wird sie nur, wenn jemand einem Fehler
   nachgeht, und dann innerhalb von Minuten. Sie kostet kein Lese-IO
   (0 Seq-Scans in der Messung), aber Platz und Schreib-IO — und sie
   wächst mit jedem der rund 750 täglichen Cron-Aufrufe.

   Die Tabelle heißt mit Unterstrich, weil pg_net sie als intern
   führt. Deshalb hier die Prüfung auf Existenz: Benennt eine neue
   Fassung der Erweiterung sie um, soll der tägliche Job eine klare
   Meldung geben statt stumm zu scheitern. */
create or replace function public.prune_net_history(
  p_keep interval default '1 day'
) returns integer
    language plpgsql
    security definer
    set search_path to 'public', 'net'
as $$
declare
  v_count integer;
begin
  if to_regclass('net._http_response') is null then
    raise notice '[prune_net_history] net._http_response gibt es nicht — uebersprungen';
    return -1;
  end if;

  delete from net._http_response
   where created < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.prune_net_history(interval) is
  'Kuerzt net._http_response. 39 MB am 20.10.2026, nie aufgeraeumt. '
  'Gibt -1 zurueck, wenn die Tabelle der Erweiterung nicht existiert.';

/* ═══════════════════════════════════════════════════════════════
   3 — beides unter einem Dach
   ═══════════════════════════════════════════════════════════════

   Wie run_sync_maintenance(): ein Aufruf, ein jsonb-Ergebnis, und
   ein Fehler bringt den Cron-Job nicht zum Werfen, sondern steht im
   Rueckgabewert. Ein werfender Cron-Job schreibt seine Meldung nach
   cron.job_run_details — also genau in die Tabelle, um die es hier
   geht. */
create or replace function public.run_history_maintenance()
  returns jsonb
    language plpgsql
    security definer
    set search_path to 'public'
as $$
begin
  return jsonb_build_object(
    'prunedCronHistory', public.prune_cron_history(),
    'prunedNetHistory',  public.prune_net_history()
  );
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

comment on function public.run_history_maintenance() is
  'Taeglicher Aufraeumlauf fuer die Historientabellen der '
  'Erweiterungen. Job history-prune, 03:17 UTC.';

/* ═══════════════════════════════════════════════════════════════
   4 — Rechte
   ═══════════════════════════════════════════════════════════════

   Wie jede Funktion in diesem Projekt: niemand darf sie ausser dem
   Cron-Lauf selbst. anon und authenticated haben hier nichts zu
   suchen — eine Funktion, die aus Systemtabellen loescht, gehoert
   keinem Browser in die Hand. */
revoke all on function public.prune_cron_history(interval)    from public, anon, authenticated;
revoke all on function public.prune_net_history(interval)     from public, anon, authenticated;
revoke all on function public.run_history_maintenance()       from public, anon, authenticated;
grant execute on function public.run_history_maintenance()    to service_role;

/* ═══════════════════════════════════════════════════════════════
   5 — der tägliche Job
   ═══════════════════════════════════════════════════════════════

   03:17 UTC, nicht 03:00. Zu jeder vollen Stunde laufen bei Supabase
   die Jobs aller Projekte gleichzeitig; eine krumme Minute steht
   allein da. Und nicht zur selben Minute wie gbp-schedule (0 * * * *),
   damit nicht ein Aufraeumlauf und ein Sync-Lauf um dieselbe Tabelle
   konkurrieren.

   Kein HTTP, keine Edge Function, kein Secret — wie
   gbp-maintenance. Laeuft also auch dann, wenn die Functions nicht
   erreichbar sind. */
do $$
begin
  if exists (select 1 from cron.job where jobname = 'history-prune') then
    perform cron.unschedule('history-prune');
  end if;
  perform cron.schedule('history-prune', '17 3 * * *',
    ' select public.run_history_maintenance(); ');
  raise notice '[cron] history-prune — 17 3 * * * — run_history_maintenance()';
end $$;

/* ═══════════════════════════════════════════════════════════════
   6 — Selbstprüfung
   ═══════════════════════════════════════════════════════════════

   Eine Migration, die stillschweigend nichts tut, ist schlimmer als
   eine, die abbricht. */
do $$
declare
  v_fehlt text[] := '{}';
begin
  if to_regprocedure('public.prune_cron_history(interval)') is null then
    v_fehlt := v_fehlt || 'prune_cron_history'::text;
  end if;
  if to_regprocedure('public.prune_net_history(interval)') is null then
    v_fehlt := v_fehlt || 'prune_net_history'::text;
  end if;
  if to_regprocedure('public.run_history_maintenance()') is null then
    v_fehlt := v_fehlt || 'run_history_maintenance'::text;
  end if;
  if not exists (select 1 from cron.job where jobname = 'history-prune') then
    v_fehlt := v_fehlt || 'Cron-Job history-prune'::text;
  end if;

  if array_length(v_fehlt, 1) is not null then
    raise exception '[historie] fehlt nach der Migration: %',
      array_to_string(v_fehlt, ', ');
  end if;

  raise notice '[historie] in Ordnung — zwei Prune-Funktionen und der taegliche Job stehen';
  raise notice '[historie] NAECHSTER SCHRITT: docs/operations/historie-einmalig.sql — einmalige Bereinigung, danach vacuum';
end $$;

commit;
