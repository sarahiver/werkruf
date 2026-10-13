-- ═══════════════════════════════════════════════════════════════
-- H1 — Zustimmung erfassen: der Weg aus dem Browser
-- ═══════════════════════════════════════════════════════════════
--
-- AUSGANGSLAGE
--
-- 20261013090000 hat die Spalten angelegt und den Schreibweg
-- gebaut:
--
--   user_profiles.accepted_terms_version
--   user_profiles.accepted_terms_at
--   record_terms_acceptance(p_user_id, p_version)   -- nur service_role
--
-- Was fehlte: der Browser kann record_terms_acceptance nicht
-- aufrufen, und das ist Absicht — die Funktion nimmt eine fremde
-- user_id an. Damit gab es die Spalten, aber keine Zustimmung, die je
-- darin landet.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS "MANIPULATIONSSICHER" HIER BEDEUTET
-- ═══════════════════════════════════════════════════════════════
--
-- Vier Dinge darf der Browser nicht koennen, und keines davon kann
-- er:
--
--   1 Den Zeitpunkt bestimmen.
--     now() setzt record_terms_acceptance. Der Client schickt keinen
--     Zeitstempel und kann keinen schicken.
--
--   2 Die Version bestimmen.
--     Gespeichert wird current_terms_version() — der Serverwert. Was
--     der Client mitschickt, dient nur dem Abgleich: Hat er eine
--     andere Fassung gesehen als die geltende, wird abgelehnt statt
--     etwas Falsches festgehalten.
--
--   3 Die Spalten direkt schreiben.
--     20260928160000 vergibt Schreibrechte auf user_profiles als
--     Spaltenliste; eine neue Spalte ist damit nicht schreibbar. Eine
--     Whitelist waechst nicht mit — geprueft in
--     supabase/tests/entitlement.test.sql.
--
--   4 Fuer jemand anderen zustimmen.
--     accept_terms() nimmt keine user_id. Es gilt auth.uid(), und das
--     kommt aus dem JWT, das Supabase geprueft hat.
--
-- Was der Browser koennen MUSS: sagen, dass der Haken gesetzt wurde.
-- Dieser eine Klick ist clientseitig, weil er im Browser passiert —
-- daran ist nichts zu haerten.
--
-- ═══════════════════════════════════════════════════════════════
-- KEINE RE-CONSENT-ARCHITEKTUR
-- ═══════════════════════════════════════════════════════════════
--
-- Die Version aendert sich hier nicht von selbst, und ein neuer Wert
-- loest NICHTS aus: kein erneutes Fragen, keine Sperre, keine
-- Migration bestehender Zeilen. Wer schon zugestimmt hat, behaelt
-- seinen Eintrag mit der Version, die damals galt.
--
-- Eine zweite Zustimmung mit derselben Version ist ein Nullschritt
-- (record_terms_acceptance gibt den bestehenden Zeitpunkt zurueck).
-- Damit ist der Eintrag auch gegen den eigenen Nutzer stabil: Er kann
-- sein Zustimmungsdatum nicht durch erneutes Klicken verschieben.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE VERSION BENENNT, WAS ES GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Im Repo existieren zwei Rechtsdokumente: /datenschutz ("Stand:
-- September 2026") und /impressum. AGB oder Nutzungsbedingungen gibt
-- es NICHT — weder als Seite noch als Text.
--
-- Deshalb heisst die Version 'datenschutz-2026-09' und nicht etwa
-- 'agb-v1': Sie benennt das Dokument, das tatsaechlich vorliegt, und
-- den Stand, der darin steht. Hier wird kein Rechtstext erfunden und
-- keine Zustimmung zu etwas festgehalten, das nicht geschrieben ist.
--
-- Kommen Nutzungsbedingungen dazu, ist das eine eigene Entscheidung:
-- neuer Dokumenttext, neuer Versionswert, und dann die Frage, ob
-- bestehende Nutzer erneut zustimmen sollen. Diese Migration
-- beantwortet sie nicht.
--
-- Wiederholbar. Laeuft im SQL Editor. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — DIE GELTENDE FASSUNG
   ═══════════════════════════════════════════════════════════════

   Eine Funktion und keine Tabelle: Es gibt genau einen geltenden
   Wert, und er aendert sich nur mit einer Migration. Eine Tabelle
   waere der Anfang einer Versionsverwaltung — also genau das, was
   hier nicht gebaut werden soll. */

create or replace function public.current_terms_version()
returns text
language sql
immutable
as $$
  select 'datenschutz-2026-09'::text;
$$;

comment on function public.current_terms_version() is
  'Die geltende Fassung der Bedingungen, der ein neues Konto zustimmt. Benennt das vorhandene Dokument (/datenschutz, Stand September 2026). Ein neuer Wert loest kein erneutes Fragen aus.';

revoke all on function public.current_terms_version() from public;
grant execute on function public.current_terms_version() to anon, authenticated, service_role;

/* ═══════════════════════════════════════════════════════════════
   2 — ZUSTIMMEN: DER EINE WEG AUS DEM BROWSER
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.accept_terms(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_soll text := public.current_terms_version();
begin
  /* Ohne Sitzung keine Zustimmung. Nicht "stillschweigend nichts
     tun": Der Aufrufer soll den Unterschied zwischen "abgelehnt" und
     "nicht angemeldet" sehen. */
  if v_user is null then
    raise exception 'Keine Sitzung — Zustimmung nicht zuordenbar'
      using errcode = 'insufficient_privilege';
  end if;

  /* Der Abgleich, nicht die Quelle: Gespeichert wird v_soll. Weicht
     ab, was der Browser gesehen hat, wird nichts festgehalten — ein
     Nachweis ueber eine Fassung, die dem Nutzer nie angezeigt wurde,
     waere keiner. */
  if p_version is distinct from v_soll then
    raise exception 'Veraltete Fassung im Browser (gesehen: %, geltend: %)',
      coalesce(p_version, 'keine'), v_soll
      using errcode = 'check_violation';
  end if;

  /* Zeitpunkt und gespeicherte Version kommen von hier, nicht vom
     Aufrufer. record_terms_acceptance ist der bestehende Weg
     (20261013090000) — keine zweite Schreibstelle. */
  return public.record_terms_acceptance(v_user, v_soll);
end;
$$;

comment on function public.accept_terms(text) is
  'Haelt die Zustimmung des angemeldeten Nutzers fest. Zeitpunkt und gespeicherte Version bestimmt der Server; p_version dient nur dem Abgleich mit der im Browser angezeigten Fassung. Zweiter Aufruf ist ein Nullschritt.';

revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated, service_role;

/* ── Selbstpruefung ──
   Rechte und Signaturen. Keine Datenaenderung: Die Wirkung prueft
   supabase/tests/consent.test.sql an angelegten Profilen, die
   zurueckgerollt werden. */
do $$
declare
  v_oid oid;
begin
  select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_terms';

  if v_oid is null then
    raise exception 'accept_terms fehlt nach der Migration';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'authenticated darf accept_terms nicht aufrufen — dann kann niemand zustimmen';
  end if;

  if pg_catalog.has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'anon darf accept_terms aufrufen — eine Zustimmung ohne Sitzung';
  end if;

  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid) then
    raise exception 'accept_terms laeuft nicht als security definer';
  end if;

  /* Und die Spalten bleiben fuer den Client gesperrt. Das ist die
     Annahme, auf der die ganze Haertung ruht — sie wird gemessen,
     nicht geglaubt. */
  if pg_catalog.has_column_privilege(
       'authenticated', 'public.user_profiles', 'accepted_terms_at', 'update')
     or pg_catalog.has_column_privilege(
       'authenticated', 'public.user_profiles', 'accepted_terms_version', 'update') then
    raise exception 'authenticated darf die Zustimmungsspalten direkt schreiben';
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG IN PRODUKTION
-- ═══════════════════════════════════════════════════════════════
--
-- 1 — Die geltende Fassung:
--
--   select public.current_terms_version();
--
-- 2 — Wer hat zugestimmt? (lesend)
--
--   select accepted_terms_version, count(*), min(accepted_terms_at)
--     from public.user_profiles
--    group by accepted_terms_version order by 2 desc;
--
--   Erwartet direkt nach dem Einspielen: eine Zeile mit NULL —
--   bestehende Konten haben keinen Eintrag, und es wird keiner
--   nachgetragen.
--
-- 3 — Gegenprobe zur Haertung, als angemeldeter Nutzer im SQL Editor
--     NICHT moeglich; dafuer die Rechte lesen:
--
--   select has_column_privilege('authenticated', 'public.user_profiles',
--                               'accepted_terms_at', 'update');
--
--   Erwartet: false.
