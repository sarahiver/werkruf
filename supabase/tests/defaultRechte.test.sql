-- Abnahme fuer die Default-Rechte neuer Objekte in public (Paket G2.2).
--
--   scripts/test-db/run.sh defaultRechte
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- G2 hat beim ersten Restore-Beweis gegen einen echten
-- Produktionsdump gefunden, dass fuenf ops_-Sichten fuer anon lesbar
-- waren — Kundendaten aller Kunden, ueber das oeffentliche Data API.
-- Niemand hatte das vergeben. Supabase setzt auf public
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- und jedes neue Objekt erbt daraus CRUD fuer anon und authenticated.
-- RLS hat die Tabellen gerettet; die Sichten tragen kein RLS.
--
-- Dieser Test dreht die Richtung: er legt neue Objekte an und besteht
-- nur, wenn sie zu sind. Fuehrt eine kuenftige Migration breite
-- Default-Rechte wieder ein, faellt es hier auf — und nicht erst im
-- naechsten Sicherheitsaudit.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT UEBER TEXTMUSTER
-- ═══════════════════════════════════════════════════════════════
--
-- Die RLS-Pruefung in G2 hat vier Anlaeufe gebraucht, und drei davon
-- scheiterten daran, dass sie eine Erwartung an den Policy-Text
-- stellte ("muss uid() enthalten") statt die Wirkung zu messen. Gegen
-- Produktion meldete der vierte Entwurf 115 Falschmeldungen.
--
-- Hier wird deshalb nichts gelesen, sondern versucht: als anon, als
-- authenticated, mit echtem Rollenwechsel.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM auth.uid() HIER NICHT VORKOMMT
-- ═══════════════════════════════════════════════════════════════
--
-- In der Testdatenbank ist auth.uid() ein Stub:
--
--   create or replace function auth.uid() returns uuid
--   language sql stable as $$ select null::uuid $$;
--
-- (scripts/test-db/sql/10-supabase-stubs.sql, Zeile 70)
--
-- Eine Policy "using (user_id = auth.uid())" waere hier immer leer,
-- und jeder Test darauf waere gruen, ohne etwas geprueft zu haben —
-- genau die Falle, die in G1 dreizehn Tests bestehen liess.
--
-- Die Pruefungen D und E stellen ihre Isolation deshalb selbst her,
-- ueber eine eigene Einstellung. Geprueft wird damit das MUSTER
-- (RLS + Policy + gezielter Grant wirkt), nicht die Produktionspolicy
-- — die prueft scripts/backup/restore-isolation.sql gegen einen
-- echten Dump mit echtem auth.uid().
--
-- Alles laeuft in einer Transaktion und wird zurueckgerollt.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════
   0 — VORBEDINGUNG DES TESTAUFBAUS
   ═══════════════════════════════════════════════════════

   Die Pruefungen D und E lesen als authenticated gegen public. Ohne
   usage auf dem Schema scheitert das mit

     ERROR: permission denied for schema public

   und das sieht nach einem Befund aus, obwohl es eine Luecke im
   Testaufbau ist. In Produktion haben alle drei Client-Rollen usage
   auf public (abgefragt am 12.10.2026); in der Testdatenbank steht
   das seit G2.2 in 10-supabase-stubs.sql.

   Hier wird es geprueft und nicht gesetzt: ein Test, der sich seine
   Vorbedingung selbst herstellt, prueft nicht mehr, ob die Umgebung
   stimmt. */

do $$
begin
  if not pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception
      E'Testaufbau unvollstaendig: authenticated hat kein USAGE auf public.\n'
      '  In Produktion hat es das. Ergaenzt wird es in\n'
      '  scripts/test-db/sql/10-supabase-stubs.sql.';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   A — KONFIGURATION: KEIN DEFAULT-ACL FUER DIE CLIENT-ROLLEN
   ═══════════════════════════════════════════════════════

   Die direkte Pruefung der Ursache. pg_default_acl haelt, was
   ALTER DEFAULT PRIVILEGES gesetzt hat. Steht dort ein Eintrag fuer
   anon oder authenticated auf public, erbt jedes kuenftige Objekt
   davon — unabhaengig davon, was irgendeine Migration spaeter
   einzeln revoked.

   Diese Pruefung faellt genau dann, wenn eine Migration die breiten
   Default-Rechte wieder einfuehrt. Das ist der Auftrag aus §28. */

do $$
declare
  v_treffer text[];
begin
  select array_agg(
           coalesce(pg_catalog.pg_get_userbyid(d.defaclrole), '?')
           || ' | typ ' || d.defaclobjtype::text
           || ' | ' || d.defaclacl::text)
    into v_treffer
    from pg_catalog.pg_default_acl d
    join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public'
     and (d.defaclacl::text like '%anon=%'
          or d.defaclacl::text like '%authenticated=%');

  if v_treffer is not null then
    raise exception
      E'Default-Rechte fuer anon/authenticated auf public gesetzt:\n  %\n'
      '  Jedes neue Objekt in public erbt diese Rechte. Deny by default\n'
      '  ist damit ausgehebelt. Siehe docs/security/database-access-model.md.',
      pg_catalog.array_to_string(v_treffer, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   B — NEUE TABELLE OHNE EXPLIZITEN GRANT IST ZU
   ═══════════════════════════════════════════════════════

   §27 A. Nicht die Konfiguration, sondern das Ergebnis: ein Objekt
   anlegen und nachsehen, was die Client-Rollen daran duerfen.

   has_table_privilege statt information_schema: es sieht auch
   Rechte, die ueber PUBLIC oder Rollenmitgliedschaft ankommen. Genau
   die hatte die erste Fassung der G2-Kernchecks uebersehen. */

create table public.g22_probe_server_only (
  id   bigint generated always as identity primary key,
  wert text
);

create sequence public.g22_probe_sequenz;

create function public.g22_probe_funktion() returns integer
  language sql immutable as $fn$ select 1 $fn$;

do $$
declare
  v_offen text[] := array[]::text[];
  v_zeile record;
begin
  /* ── Tabelle ── */
  for v_zeile in
    select r.rolle, p.recht
      from (values ('anon'), ('authenticated')) as r(rolle)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
            as p(recht)
     where pg_catalog.has_table_privilege(
             r.rolle, 'public.g22_probe_server_only', p.recht)
  loop
    v_offen := v_offen
      || ('Tabelle: ' || v_zeile.rolle || ' darf ' || v_zeile.recht);
  end loop;

  /* ── Sequenz ──
     anon mit USAGE auf einer Sequenz kann nextval aufrufen und damit
     fremde Schluesselraeume verbrauchen. */
  for v_zeile in
    select r.rolle, p.recht
      from (values ('anon'), ('authenticated')) as r(rolle)
     cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(recht)
     where pg_catalog.has_sequence_privilege(
             r.rolle, 'public.g22_probe_sequenz', p.recht)
  loop
    v_offen := v_offen
      || ('Sequenz: ' || v_zeile.rolle || ' darf ' || v_zeile.recht);
  end loop;

  /* ── Funktion ──
     Die unauffaelligste und folgenreichste der drei. PostgreSQL
     vergibt EXECUTE auf neue Funktionen an PUBLIC als eingebaute
     Vorgabe, und eine schemagebundene Vorgaberechte-Zeile hebt das
     NICHT auf — gemessen am 12.10.2026, siehe
     20261012140000_deny_by_default.sql. Eine neue
     SECURITY-DEFINER-Funktion, die anon ausfuehren darf, umgeht
     jede Policy, die darunter liegt.

     Faellt diese Pruefung, fehlt in der Migration die GLOBALE Zeile
     "alter default privileges revoke execute on functions from
     public" — die schemagebundene allein genuegt nicht. */
  for v_zeile in
    select r.rolle
      from (values ('anon'), ('authenticated')) as r(rolle)
     where pg_catalog.has_function_privilege(
             r.rolle, 'public.g22_probe_funktion()', 'EXECUTE')
  loop
    v_offen := v_offen
      || ('Funktion: ' || v_zeile.rolle || ' darf EXECUTE');
  end loop;

  if pg_catalog.array_length(v_offen, 1) > 0 then
    raise exception
      E'Neue Objekte sind nicht zu:\n  %\n'
      '  Ein Objekt ohne expliziten Grant darf fuer anon und\n'
      '  authenticated kein Recht tragen.\n'
      '  Siehe docs/security/database-access-model.md.',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;
end $$;

/* ── Und die Gegenrichtung: der Serverpfad muss offen sein ──

   Eine Konfiguration, die alles zumacht, ist nicht sicher, sondern
   kaputt: ohne service_role laeuft kein Cron, keine Edge Function,
   kein Worker. Diese Pruefung hat beim Lauf gegen die G1-Testdatenbank
   am 12.10.2026 gegriffen und gezeigt, dass service_role ihre
   Vorgaberechte bis dahin nur aus der Supabase-Projekteinrichtung
   hatte und nicht aus dem Repo. */

do $$
declare
  v_zu text[] := array[]::text[];
begin
  if not pg_catalog.has_table_privilege(
           'service_role', 'public.g22_probe_server_only', 'SELECT') then
    v_zu := v_zu || 'service_role darf eine neue Tabelle nicht lesen'::text;
  end if;
  if not pg_catalog.has_function_privilege(
           'service_role', 'public.g22_probe_funktion()', 'EXECUTE') then
    v_zu := v_zu || 'service_role darf eine neue Funktion nicht ausfuehren'::text;
  end if;

  if pg_catalog.array_length(v_zu, 1) > 0 then
    raise exception
      E'Der Serverpfad ist zu:\n  %\n'
      '  Deny by default gilt fuer anon und authenticated, nicht fuer\n'
      '  service_role. Siehe 20261012140000_deny_by_default.sql, 1b.',
      pg_catalog.array_to_string(v_zu, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   C — NEUE INTERNE SICHT IST ZU
   ═══════════════════════════════════════════════════════

   §27 C. Die Objektart, an der G2 das Loch gefunden hat. Eine Sicht
   traegt kein RLS; ist sie lesbar, ist sie offen. */

create view public.g22_probe_ops_sicht as
  select id, wert from public.g22_probe_server_only;

do $$
begin
  if pg_catalog.has_table_privilege('anon', 'public.g22_probe_ops_sicht', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.g22_probe_ops_sicht', 'SELECT')
  then
    raise exception
      'Neue interne Sicht ist fuer anon oder authenticated lesbar — eine Sicht traegt kein RLS, das ist ein offener Tisch';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   D — BEWUSST CLIENTFAEHIGE TABELLE: NUR DAS ERWARTETE
   ═══════════════════════════════════════════════════════

   §27 B und §23: Tabelle → RLS an → Policy → gezielter Grant. Danach
   darf genau das gehen, was vorgesehen ist, und nichts daneben.

   Die Isolation laeuft ueber werkruf.test_mandant statt auth.uid(),
   siehe Kopf dieser Datei. */

create table public.g22_probe_client (
  id       bigint generated always as identity primary key,
  mandant  text not null,
  inhalt   text
);

alter table public.g22_probe_client enable row level security;

create policy g22_eigene_lesen on public.g22_probe_client
  for select to authenticated
  using (mandant = pg_catalog.current_setting('werkruf.test_mandant', true));

/* Nur SELECT. Kein INSERT, kein UPDATE, kein DELETE — genau so, wie
   user_profiles es in Produktion haelt, damit ein Kunde sich nicht
   selbst Pro schenken kann (Migration 20260928160000). */
grant select on public.g22_probe_client to authenticated;

insert into public.g22_probe_client (mandant, inhalt) values
  ('a', 'gehoert A'), ('a', 'gehoert A auch'), ('b', 'gehoert B');

do $$
declare
  v_eigene   integer;
  v_fremde   integer;
  v_gesamt   integer;
  v_schrieb  boolean := true;
begin
  select count(*) into v_gesamt from public.g22_probe_client;
  if v_gesamt <> 3 then
    raise exception 'Testaufbau kaputt: % statt 3 Zeilen', v_gesamt;
  end if;

  perform pg_catalog.set_config('werkruf.test_mandant', 'a', true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  select count(*) into v_eigene
    from public.g22_probe_client where mandant = 'a';
  select count(*) into v_fremde
    from public.g22_probe_client where mandant = 'b';

  if v_eigene <> 2 then
    raise exception
      'Mandant A sieht % statt 2 eigene Zeilen — Policy oder Grant fehlt', v_eigene;
  end if;
  if v_fremde <> 0 then
    raise exception
      'Mandant A sieht % Zeilen von B — die Policy trennt nicht', v_fremde;
  end if;

  /* Schreiben muss am fehlenden Recht scheitern, nicht an der Policy.
     Beides waere hier richtig; wichtig ist, dass es scheitert. */
  begin
    insert into public.g22_probe_client (mandant, inhalt) values ('a', 'geschmuggelt');
    v_schrieb := true;
  exception
    when insufficient_privilege then v_schrieb := false;
  end;

  if v_schrieb then
    raise exception
      'authenticated konnte in g22_probe_client schreiben — ohne INSERT-Grant darf das nicht gehen';
  end if;

  perform pg_catalog.set_config('role', 'none', true);
  raise notice 'D: Muster traegt — A sieht 2 eigene, 0 fremde, kann nicht schreiben';
end $$;

/* ═══════════════════════════════════════════════════════
   E — SICHT MIT UND OHNE security_invoker
   ═══════════════════════════════════════════════════════

   §27 D und §21. Diese Pruefung behauptet nicht, dass
   security_invoker wirkt — sie zeigt es, indem sie dieselbe Sicht
   zweimal anlegt und den Unterschied messbar macht.

   Das ist der Kern des G2-Befunds in zwei Zeilen SQL: ohne
   security_invoker laeuft die Sicht mit den Rechten ihres
   Eigentuemers und das RLS der Basistabelle greift nicht. */

create view public.g22_probe_sicht_invoker
  with (security_invoker = true) as
  select id, mandant, inhalt from public.g22_probe_client;

create view public.g22_probe_sicht_definer as
  select id, mandant, inhalt from public.g22_probe_client;

grant select on public.g22_probe_sicht_invoker  to authenticated;
grant select on public.g22_probe_sicht_definer  to authenticated;

do $$
declare
  v_invoker integer;
  v_definer integer;
begin
  perform pg_catalog.set_config('werkruf.test_mandant', 'a', true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  select count(*) into v_invoker from public.g22_probe_sicht_invoker;
  select count(*) into v_definer from public.g22_probe_sicht_definer;

  perform pg_catalog.set_config('role', 'none', true);

  /* Mit security_invoker greift das RLS der Basistabelle: nur die
     zwei Zeilen von Mandant A. */
  if v_invoker <> 2 then
    raise exception
      'Sicht MIT security_invoker zeigt % statt 2 Zeilen — das RLS der Basistabelle greift nicht wie erwartet',
      v_invoker;
  end if;

  /* Ohne security_invoker sieht die Sicht alle drei. Faellt diese
     Pruefung, hat PostgreSQL sein Verhalten geaendert oder die Sicht
     ist doch im Invoker-Modus — dann ist die Begruendung fuer den
     ganzen Abschnitt zu pruefen, statt sie weiter zu glauben. */
  if v_definer <> 3 then
    raise exception
      'Sicht OHNE security_invoker zeigt % statt 3 Zeilen — die Annahme hinter dem G2-Befund stimmt nicht mehr und muss neu geprueft werden',
      v_definer;
  end if;

  raise notice
    'E: security_invoker wirkt — mit: % Zeilen (RLS greift), ohne: % Zeilen (RLS umgangen)',
    v_invoker, v_definer;
end $$;

rollback;
