-- 20261002140000_previous_health_fix.sql
--
-- Korrigiert previous_location_health().
--
-- DER FEHLER
--
-- 20260930160000 liest den Vorwochenwert so:
--
--   select (payload -> 'health' ->> 'score')::numeric
--     from public.weekly_snapshots ...
--
-- weekly_snapshots hat aber keine Spalte `payload`. Der Wert steht in
-- `health_score`.
--
-- Die Abfrage wirft, der exception-Zweig faengt es ab, und die
-- Funktion liefert immer null. Der Vorwochenvergleich haette nie
-- funktioniert — und die Regel health.declined nie gefeuert.
--
-- Aufgefallen ist das erst, als ein SQL-Test mit einer anderen
-- Tabellenform lief. Der exception-Zweig, der einen fehlenden
-- Snapshot abfangen sollte, hat den Fehler verdeckt: Ein stiller
-- Rueckfall auf null sieht genauso aus wie "kein Vergleichswert
-- vorhanden".
--
-- Wiederholbar. Aendert keine Daten.

begin;

create or replace function public.previous_location_health(
  p_user_id       uuid,
  p_location_id   uuid,
  p_score_version smallint default 1
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_wert numeric;
begin
  if p_location_id is null then return null; end if;
  if to_regclass('public.weekly_snapshots') is null then return null; end if;

  /* health_score, nicht payload. Die Spalte heisst seit jeher so. */
  select health_score into v_wert
    from public.weekly_snapshots
   where user_id = p_user_id
     and location_id = p_location_id
     and score_version is not distinct from p_score_version
   order by week_start desc
   limit 1;

  return v_wert;
exception when undefined_column then
  /* Fehlen location_id oder score_version — also vor 20260930160000 —
     ist kein Vergleich moeglich. Kein Trend ist besser als ein
     falscher.

     Bewusst NUR undefined_column: Ein weiter gefasstes `when others`
     haette den eigentlichen Fehler oben verdeckt, so wie es das
     monatelang getan haette. */
  return null;
end;
$$;

comment on function public.previous_location_health is
  'Vorwochenwert desselben Standorts und derselben Score-Fassung aus weekly_snapshots.health_score. NULL, wenn nicht vergleichbar.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Liefert die Funktion jetzt einen Wert?
--   select l.title,
--          public.previous_location_health(l.user_id, l.id) as vorwoche
--   from public.google_locations l where l.deleted_at is null;
--
-- Gegenprobe gegen die Rohdaten — beide muessen uebereinstimmen:
--   select s.week_start, s.location_id, s.health_score, s.score_version
--   from public.weekly_snapshots s order by s.week_start desc limit 5;
