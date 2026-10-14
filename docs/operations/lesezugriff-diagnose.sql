-- Diagnose fuer die Lesezugriffs-Haertung (H2.2).
--
-- Lesend. Aendert nichts.
--
-- Wann: wenn 20261014130000_lesezugriff_eigentumspruefung.sql mit
-- "Ruempfe nicht haertbar" oder "Rumpf weicht von der gelesenen
-- Fassung ab" abbricht.
--
-- Was die Spalten sagen:
--
--   hat_cr              CRLF im Rumpf. Entsteht, wenn eine Migration
--                       aus einer Zwischenablage in den SQL-Editor
--                       ging. Die Migration vertraegt das seit dem
--                       14.10.2026 — eine alte Fassung nicht.
--   begin_klein/gross   ob und wie der plpgsql-Block anfaengt.
--   pruefsumme          normalisiert, ohne CR und ohne Leerraum am
--                       Zeilenende. Vergleichbar mit den Sollwerten
--                       in Abschnitt 4 der Migration.
--   rumpfanfang         die ersten 120 Zeichen mit sichtbaren
--                       Umbruechen.
--
-- Supabase Dashboard → SQL Editor, ein Statement.

select
  p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as funktion,
  l.lanname                                                       as sprache,
  pg_catalog.length(p.prosrc)                                     as rumpf_zeichen,
  pg_catalog.md5(
    pg_catalog.regexp_replace(
      pg_catalog.replace(p.prosrc, pg_catalog.chr(13), ''),
      '[ \t]+$', '', 'gn'))                                        as pruefsumme,
  pg_catalog.strpos(p.prosrc, chr(13)) > 0                         as hat_cr,
  (p.prosrc ~ '(?n)^[ \t\r]*begin[ \t\r]*$')                       as begin_klein,
  (p.prosrc ~ '(?n)^[ \t\r]*BEGIN[ \t\r]*$')                       as begin_gross,
  (pg_catalog.pg_get_functiondef(p.oid) ~ E'\n[ \t]*begin[ \t]*\n') as alte_suche_trifft,
  pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.substr(p.prosrc, 1, 120), chr(13), '<CR>'), chr(10), '<LF>') as rumpfanfang
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname in ('build_location_evaluation_context', 'compute_location_health_score',
                    'events_feed', 'previous_location_health', 'read_location_impact_metric',
                    'weekly_payload_for', 'weekly_mail_events', 'werkruf_score_location')
order by 1;
