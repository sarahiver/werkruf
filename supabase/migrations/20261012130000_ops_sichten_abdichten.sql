-- 20261012130000_ops_sichten_abdichten.sql
--
-- Schliesst die ops_-Sichten gegen anon und authenticated.
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND
-- ═══════════════════════════════════════════════════════════════
--
-- Gefunden am 12.10.2026 beim ersten Restore-Beweis gegen einen
-- echten Produktionsdump (G2.1). Nicht durch Nachdenken, sondern
-- weil der Dump erstmals OHNE --no-privileges lief und die Rechte
-- damit ueberhaupt sichtbar wurden.
--
-- Produktionszustand, abgefragt am 12.10.2026:
--
--   Sicht                   Eigentuemer  invoker  anon darf lesen
--   ─────────────────────────────────────────────────────────────
--   ops_alert_status        postgres     nein     JA
--   ops_gbp_api_monitor     postgres     nein     JA
--   ops_gbp_pending_edits   postgres     nein     JA
--   ops_stripe_events       postgres     nein     JA
--   ops_sync_failures       postgres     nein     JA
--   (19 weitere ops_-Sichten)            nein     nein
--
-- WARUM DAS EIN LOCH IST, OBWOHL RLS UEBERALL AN IST
--
-- Eine Sicht laeuft in PostgreSQL standardmaessig mit den Rechten
-- ihres EIGENTUEMERS, nicht des Aufrufers. Eigentuemer ist postgres.
-- Row Level Security der Basistabellen greift damit nicht: wer die
-- Sicht lesen darf, liest alle Zeilen aller Kunden, auch wenn die
-- Basistabelle lueckenlos geschuetzt ist.
--
-- Das Supabase-Data-API stellt das Schema public bereit, und anon ist
-- der oeffentlich ausgelieferte Schluessel. Was anon lesen darf, ist
-- oeffentlich.
--
-- Was dabei sichtbar war:
--
--   ops_gbp_pending_edits   user_id, title (Firmenname),
--                           ausstehende Aenderungen ALLER Standorte
--   ops_sync_failures       user_id, account_id, location_id,
--                           error_code ALLER Kunden
--   ops_stripe_events       Zahlungsereignisse (Definition nicht im
--                           Repo, in Produktion handgemacht)
--   ops_alert_status        Betriebszustand (dito)
--   ops_gbp_api_monitor     API-Monitoring, keine Kundendaten
--
-- WIE ES DAZU KAM
--
-- Supabase setzt auf public
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- Eine Sicht ohne eigenes revoke erbt daraus SELECT fuer anon. Im
-- Repo steht an keiner Stelle ein revoke auf eine ops_-Sicht, und
-- security_invoker kommt im ganzen Repo nicht vor — nachgesehen am
-- 12.10.2026 ueber alle Migrationen.
--
-- Die drei Sichten, die eine Migration anlegt (ops_sync_failures,
-- ops_gbp_api_monitor, ops_gbp_pending_edits), sind genau drei der
-- fuenf offenen. Die anderen 19 sind geschlossen, aber nicht durch
-- etwas im Repo — ihr Schutz ist nicht reproduzierbar.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM BEIDES, UND WELCHES DAVON HAELT
-- ═══════════════════════════════════════════════════════════════
--
-- Gemessen gegen PostgreSQL 16.15 am 12.10.2026, weil ich vorher das
-- Gegenteil behauptet hatte:
--
--   Ausgangslage: Vorgaberechte aktiv, Sicht neu angelegt
--     → anon darf lesen, invoker aus
--   nach revoke + alter view set (security_invoker = true)
--     → anon darf nicht, invoker an
--   nach create or replace view (ohne WITH-Klausel)
--     → anon darf NICHT    ← das revoke HAELT
--     → invoker AUS        ← security_invoker ist WEG
--   nach drop view + create view
--     → anon darf lesen, invoker aus   ← beides weg
--
-- Das ist umgekehrt zu meiner Annahme. Haltbar ist das revoke; die
-- fragile Haelfte ist security_invoker, weil CREATE OR REPLACE VIEW
-- die reloptions durch die angegebenen ersetzt — und ohne WITH-Klausel
-- ist das die leere Menge.
--
-- Folge fuer jede kuenftige Migration: security_invoker gehoert IN
-- die Sichtdefinition, nicht in ein nachgestelltes ALTER.
--
--   create or replace view public.ops_x with (security_invoker = true)
--     as select ...;
--
-- Dafuer gibt es ab jetzt ein Gate: scripts/check-view-security.sh
-- laeuft im sql-tests-Job und faellt, wenn eine Migration eine Sicht
-- in public ohne security_invoker anlegt.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION NICHT TUT
-- ═══════════════════════════════════════════════════════════════
--
-- Sie aendert die Vorgaberechte des Schemas public NICHT. Das waere
-- die Reparatur an der Wurzel:
--
--   alter default privileges in schema public
--     revoke all on tables from anon, authenticated;
--
-- Dann muesste aber jede kuenftige Migration ihre Rechte selbst
-- vergeben, auch fuer die Tabellen, die authenticated wirklich lesen
-- soll (user_profiles, google_locations, google_reviews, …). Das ist
-- die richtige Disziplin, aber es ist eine eigene Entscheidung mit
-- eigener Reichweite und gehoert nicht in eine Migration, die ein
-- Loch schliesst.
--
-- Sie aendert keine Sichtdefinition. Zwei der fuenf Sichten stehen
-- nicht im Repo; ihre Definition aus dem Gedaechtnis zu schreiben
-- waere genau der Fehler, den G2.1 §1 verbietet. ALTER VIEW und
-- REVOKE brauchen die Definition nicht.
--
-- Sie bricht nichts: kein Edge-Function- und kein Frontend-Code
-- fragt eine ops_-Sicht ab. Nachgesehen am 12.10.2026 ueber
-- supabase/functions und src — alle 14 Treffer auf "ops_" stehen in
-- Kommentaren. Die Betriebsabfragen laufen als postgres im
-- SQL-Editor oder als service_role, und service_role hat BYPASSRLS.
--
-- Wiederholbar.

begin;

do $$
declare
  v_sicht record;
  v_geaendert integer := 0;
  v_entzogen  integer := 0;
begin

  /* ═══════════════════════════════════════════════════════════
     1 — security_invoker fuer JEDE Sicht in public
     ═══════════════════════════════════════════════════════════

     Nicht nur fuer die fuenf offenen. Die anderen 19 sind heute
     geschlossen, aber ihr Schutz steht in keiner Migration — eine
     Sicht, die morgen per drop/create neu entsteht, ist wieder
     offen. security_invoker macht sie unabhaengig davon sicher:
     dann greift RLS der Basistabellen, auch wenn ein Recht
     zurueckkommt.

     Nur relkind 'v'. Materialisierte Sichten kennen
     security_invoker nicht; sie materialisieren als Eigentuemer und
     lassen sich so nicht absichern — fuer die hilft nur Abschnitt 2. */

  for v_sicht in
    select c.oid::regclass::text as name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n
        on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'v'
       and not coalesce(
             'security_invoker=true' = any (c.reloptions), false)
     order by 1
  loop
    execute pg_catalog.format(
      'alter view %s set (security_invoker = true)', v_sicht.name);
    v_geaendert := v_geaendert + 1;
  end loop;

  raise notice 'security_invoker gesetzt: % Sicht(en)', v_geaendert;

  /* ═══════════════════════════════════════════════════════════
     2 — Rechte entziehen, bei ops_-Sichten
     ═══════════════════════════════════════════════════════════

     Der Entzug ist die eingreifende Haelfte, deshalb nur dort, wo
     nachgewiesen niemand liest: die ops_-Reihe. Idempotent — ein
     revoke auf ein Recht, das nicht existiert, ist ein No-op.

     Hier auch 'm': ein Entzug wirkt bei materialisierten Sichten
     genauso. */

  for v_sicht in
    select c.oid::regclass::text as name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n
        on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind in ('v', 'm')
       and c.relname like 'ops\_%'
     order by 1
  loop
    execute pg_catalog.format(
      'revoke all on %s from anon, authenticated', v_sicht.name);
    v_entzogen := v_entzogen + 1;
  end loop;

  raise notice 'Rechte entzogen auf: % ops_-Sicht(en)', v_entzogen;

end $$;

/* ═══════════════════════════════════════════════════════════════
   3 — SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════════

   Eine Migration, die nur ausfuehrt, beweist nichts. Nach dem
   Durchlauf darf keine Sicht in public mehr fuer anon oder
   authenticated lesbar sein, ohne dass security_invoker greift.

   Faellt die Pruefung, rollt begin/commit alles zurueck. */

do $$
declare
  v_offen text[];
begin
  select pg_catalog.array_agg(
           c.relname || ' (' || r.rolle || ')' order by c.relname)
    into v_offen
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolle)
   where c.relkind in ('v', 'm')
     and pg_catalog.has_table_privilege(r.rolle, c.oid, 'SELECT')
     and not coalesce(
           'security_invoker=true' = any (c.reloptions), false);

  if v_offen is not null then
    raise exception
      E'Noch offen — lesbar ohne security_invoker:\n  %',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  raise notice 'Selbstpruefung: keine Sicht in public ist ungeschuetzt lesbar';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG IM DASHBOARD
-- ═══════════════════════════════════════════════════════════════
--
-- Vorher und nachher dieselbe Abfrage; nach dem Deploy muss die
-- Spalte anon_darf_lesen durchgehend false sein und invoker true:
--
--   select c.relname as sicht,
--          pg_get_userbyid(c.relowner) as eigentuemer,
--          coalesce('security_invoker=true' = any(c.reloptions), false)
--            as invoker,
--          has_table_privilege('anon', c.oid, 'SELECT') as anon_darf_lesen,
--          has_table_privilege('authenticated', c.oid, 'SELECT')
--            as auth_darf_lesen
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('v','m')
--    order by anon_darf_lesen desc, c.relname;
--
-- Und die Gegenprobe ueber das Data API, mit dem oeffentlichen
-- anon-Schluessel. Vorher kam eine Liste, nachher muss es scheitern:
--
--   curl "$SUPABASE_URL/rest/v1/ops_sync_failures?select=user_id" \
--     -H "apikey: $ANON_KEY"
