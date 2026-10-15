-- 20261015120000_agb_fassung.sql
--
-- Die geltende Fassung der Bedingungen benennt jetzt auch die AGB.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESE MIGRATION
-- ═══════════════════════════════════════════════════════════════
--
-- 20261013140000 hat current_terms_version() mit dem Wert
-- 'datenschutz-2026-09' angelegt und im Kopf begruendet, warum:
--
--   "Im Repo existieren zwei Rechtsdokumente: /datenschutz und
--    /impressum. AGB oder Nutzungsbedingungen gibt es NICHT — weder
--    als Seite noch als Text. Deshalb heisst die Version
--    'datenschutz-2026-09' und nicht etwa 'agb-v1': Sie benennt das
--    Dokument, das tatsaechlich vorliegt."
--
-- Seit dem 15.10.2026 gibt es /agb. Der Versionswert benennt damit
-- ein Dokument weniger, als es gibt — und eine Zustimmung, die nur
-- die Datenschutzerklaerung nennt, deckt die AGB nicht ab.
--
-- Neuer Wert: 'agb-datenschutz-2026-10'. Er benennt beide Dokumente
-- und den Stand, der auf der AGB-Seite steht. Dieselbe Regel wie
-- vorher: Der Wert benennt, was es gibt, und erfindet nichts.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION NICHT TUT — UND WARUM DAS WICHTIG IST
-- ═══════════════════════════════════════════════════════════════
--
-- Sie fragt bestehende Nutzer NICHT erneut.
--
-- accept_terms() traegt die Zustimmung nur ein, solange keine
-- vorliegt; record_terms_acceptance() gibt bei einer bestehenden
-- Zustimmung den alten Zeitpunkt zurueck. Ein neuer Versionswert
-- loest damit keine erneute Abfrage aus — so war es in
-- 20261013140000 ausdruecklich angelegt:
--
--   "Ein neuer Wert loest kein erneutes Fragen aus."
--
-- Folge, im Klartext: Wer vor dem 15.10.2026 zugestimmt hat, traegt
-- weiterhin 'datenschutz-2026-09' und hat den AGB nie zugestimmt.
-- Nur neue Konten stimmen der neuen Fassung zu.
--
-- Das ist eine BEWUSSTE Begrenzung dieser Migration, keine Loesung.
-- Ob bestehende Nutzer erneut zustimmen muessen, ist eine
-- rechtliche Frage und keine technische — § 14 der AGB beschreibt
-- dafuer ein Aenderungsverfahren mit Frist und Widerspruch. Solange
-- es noch keine zahlenden Kunden gibt, ist die Menge der Betroffenen
-- ueberschaubar; mit dem ersten Kunden wird die Frage echt.
--
-- Wer sie beantworten will, braucht eine eigene Migration: einen
-- Weg, der accepted_terms_version pruefen und bei Abweichung erneut
-- fragen laesst. Diese hier tut das nicht.
--
-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Wer traegt welche Fassung?
--
--   select accepted_terms_version, count(*)
--     from public.user_profiles
--    where accepted_terms_at is not null
--    group by 1 order by 2 desc;
--
-- Wiederholbar. Laeuft im SQL Editor. Aendert keine Daten.

begin;

create or replace function public.current_terms_version()
returns text
language sql
immutable
as $$
  select 'agb-datenschutz-2026-10'::text;
$$;

comment on function public.current_terms_version() is
  'Die geltende Fassung der Bedingungen, der ein neues Konto zustimmt. Benennt die vorhandenen Dokumente (/agb und /datenschutz, Stand Oktober 2026). Ein neuer Wert loest kein erneutes Fragen aus.';

/* Rechte wie in 20261013140000 — der Client ruft sie beim Onboarding
   auf, um zu wissen, welcher Fassung er zustimmt. */
revoke all on function public.current_terms_version() from public;
grant execute on function public.current_terms_version() to anon, authenticated, service_role;

/* ═══════════════════════════════════════════════════════════════
   SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════════

   Eine Migration, die nur ausfuehrt, beweist nichts. Nach dem
   Durchlauf muss der neue Wert gelten und die Funktion fuer die
   Clientrollen aufrufbar sein. Faellt die Pruefung, rollt
   begin/commit alles zurueck. */

do $$
declare v_fassung text;
begin
  select public.current_terms_version() into v_fassung;

  if v_fassung <> 'agb-datenschutz-2026-10' then
    raise exception 'Fassung ist %, erwartet agb-datenschutz-2026-10', v_fassung;
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated', 'public.current_terms_version()', 'EXECUTE') then
    raise exception 'authenticated darf current_terms_version() nicht aufrufen';
  end if;

  if pg_catalog.has_function_privilege(
       'public', 'public.current_terms_version()', 'EXECUTE') then
    raise exception 'PUBLIC darf current_terms_version() noch aufrufen';
  end if;

  raise notice 'Fassung gesetzt: %', v_fassung;
end $$;

commit;
