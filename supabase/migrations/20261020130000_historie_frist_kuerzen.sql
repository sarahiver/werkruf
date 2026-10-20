-- 20261020130000_historie_frist_kuerzen.sql
--
-- Aufbewahrung der Cron-Historie von sieben auf zwei Tage
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NACHGESCHOBEN
-- ═══════════════════════════════════════════════════════════════
--
-- 20261020120000 legte prune_cron_history() mit sieben Tagen an. Das
-- war zu lang, und das stellte sich erst nach der Messung heraus.
--
-- Der Reihe nach, alles am 20.10.2026 in Produktion gemessen:
--
--   1. Der Prune traf genau: 5.237 Zeilen blieben stehen, bei rund
--      750 Cron-Laeufen am Tag und sieben Tagen Frist.
--
--   2. Die Datei blieb trotzdem 28 MB gross. vacuum lief nachweislich
--      (last_vacuum 11:45 UTC, n_dead_tup 0) und hat alles freigegeben
--      — abschneiden konnte es nichts. Es gibt Platz nur dann ans
--      Dateisystem zurueck, wenn die leeren Seiten AM ENDE liegen.
--      Protokollzeilen werden chronologisch angehaengt, die aeltesten
--      stehen also vorn. Genau die loescht der Prune.
--
--   3. Damit blieben 3.523 Seiten fuer 5.237 Zeilen: 1,5 Zeilen je
--      Seite. Ein sequenzieller Durchlauf liest SEITEN, nicht Zeilen —
--      ops_cron_failures() las also weiter die vollen 28 MB, 96 Mal am
--      Tag.
--
-- Das Zurücksetzen der Datei lief über truncate (Eigentum fehlt für
-- vacuum full, Löschrecht und truncate sind vorhanden). Diese
-- Migration sorgt dafür, dass sie nicht wieder dahin wächst.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ZWEI TAGE
-- ═══════════════════════════════════════════════════════════════
--
-- Hochgerechnet aus der Messung: 28 MB in rund 42 Tagen bei 750
-- Läufen täglich sind etwa 930 Byte je Zeile, also rund 8 Zeilen je
-- 8-KB-Seite.
--
--   7 Tage   5.250 Zeilen ≈ 660 Seiten ≈ 5,0 MB  →  96 × 5,0 = 500 MB/Tag
--   2 Tage   1.500 Zeilen ≈ 190 Seiten ≈ 1,5 MB  →  96 × 1,5 = 144 MB/Tag
--
-- Zwei Tage reichen fachlich: ops_cron_failures(60) schaut 60 Minuten
-- zurück, und für eine Fehlersuche am selben oder am Vortag bleibt
-- genug stehen.
--
-- Kürzer wäre möglich, aber dann wird die Historie zum Glücksspiel:
-- Wer montags früh einen Fehlschlag vom Wochenende sucht, findet mit
-- einem Tag Frist nichts mehr.
--
-- ═══════════════════════════════════════════════════════════════
-- WIRKUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Ändert einen Vorgabewert. Keine Tabelle, kein Fremdschlüssel, kein
-- Trigger, keine Zeile. Der Cron-Job history-prune bleibt unverändert
-- — er ruft run_history_maintenance() ohne Argument und bekommt den
-- neuen Wert dadurch automatisch.
--
-- net._http_response bleibt bei einem Tag. Diese Tabelle wird nicht
-- gelesen (null Seq-Scans in 42 Tagen) und kostet nur Platz.

begin;

/* Nur der Vorgabewert ändert sich. Rumpf wortgleich zu
   20261020120000 — wer die Funktion dort gelesen hat, liest hier
   dasselbe. */
create or replace function public.prune_cron_history(
  p_keep interval default '2 days'
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
  'Kuerzt cron.job_run_details auf zwei Tage. Sieben Tage waren zu '
  'lang: 5.237 Zeilen lagen in 3.523 Seiten, und ein Seq-Scan liest '
  'Seiten. Gemessen am 20.10.2026.';

/* ═══════════════════════════════════════════════════════════════
   Selbstprüfung
   ═══════════════════════════════════════════════════════════════

   Eine Migration, die stillschweigend nichts tut, ist schlimmer als
   eine, die abbricht. Geprüft wird der Vorgabewert selbst, nicht nur
   die Existenz der Funktion — genau der ist ja das Einzige, was sich
   hier ändert. */
do $$
declare
  v_args text;
begin
  select pg_get_function_arguments(p.oid) into v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'prune_cron_history';

  if v_args is null then
    raise exception '[frist] prune_cron_history gibt es nicht';
  end if;

  if position('2 days' in v_args) = 0 then
    raise exception '[frist] Vorgabewert ist nicht zwei Tage: %', v_args;
  end if;

  raise notice '[frist] in Ordnung — %', v_args;
end $$;

commit;
