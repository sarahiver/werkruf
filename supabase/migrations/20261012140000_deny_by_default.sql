-- 20261012140000_deny_by_default.sql
--
-- Neue Objekte in public stehen anon und authenticated nicht mehr offen.
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND, GEMESSEN STATT VERMUTET
-- ═══════════════════════════════════════════════════════════════
--
-- Abgefragt in Produktion am 12.10.2026 (pg_default_acl). Fuer das
-- Schema public existieren ZWEI Satz Vorgaberechte, von zwei
-- verschiedenen Rollen gesetzt:
--
--   postgres       | public | Tabellen   | anon=arwdDxtm, authenticated=arwdDxtm
--   postgres       | public | Sequenzen  | anon=rwU,      authenticated=rwU
--   postgres       | public | Funktionen | anon=X,        authenticated=X
--
--   supabase_admin | public | Tabellen   | anon=arwdDxtm, authenticated=arwdDxtm
--   supabase_admin | public | Sequenzen  | anon=rwU,      authenticated=rwU
--   supabase_admin | public | Funktionen | anon=X,        authenticated=X
--
-- Vorgaberechte haengen am ERZEUGER eines Objekts, nicht am Schema.
-- Welcher Satz greift, entscheidet also, wer "create table" sagt.
--
-- Und das ist in diesem Projekt eindeutig:
--
--   Eigentuemer der Objekte in public: postgres, 57 von 57
--   Rolle im SQL-Editor:               postgres
--   Rolle bei supabase db push:        postgres
--
-- Deshalb ist postgres die relevante Rolle, und nur fuer sie laesst
-- sich hier etwas aendern. §22 des Auftrags sagt dazu: "Nicht an
-- falscher Rolle konfigurieren und dann Sicherheit vortaeuschen."
--
-- ── Was das bedeutet, und was nicht ──
--
-- "anon=X" auf Funktionen heisst: jede neue Funktion in public ist
-- fuer den oeffentlich ausgelieferten anon-Schluessel ausfuehrbar,
-- sobald sie angelegt ist. Deshalb endet im Repo jede
-- Funktionsmigration mit
--
--   revoke all on function ... from public, anon, authenticated;
--   grant execute on function ... to service_role;
--
-- 20 der 39 Migrationen tun das. Diese Disziplin ist richtig und
-- bleibt — aber sie ist eine Verteidigung, die man je Objekt von Hand
-- bauen muss, und einmal vergessen heisst offen. Genau so sind in G2
-- die fuenf ops_-Sichten entstanden: niemand hat ihnen Rechte
-- gegeben, sie haben sie geerbt.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION AENDERT — UND WAS GANZ SICHER NICHT
-- ═══════════════════════════════════════════════════════════════
--
-- ALTER DEFAULT PRIVILEGES wirkt ausschliesslich auf Objekte, die
-- SPAETER angelegt werden. Kein bestehendes Recht wird angefasst.
--
-- Konkret: events_feed, claim_own_lead, touch_dashboard_visit,
-- werkruf_score_location und enqueue_email behalten ihre
-- EXECUTE-Rechte fuer authenticated — alle fuenf haben sie explizit
-- aus ihrer eigenen Migration und nicht aus der Vorgabe. Nachgesehen
-- am 12.10.2026. Das Dashboard laeuft nach dieser Migration genau wie
-- vorher.
--
-- Das ist auch der Auftrag: §26 verlangt sichere Vorgaben fuer
-- kuenftige Objekte und ausdruecklich KEINE flaechige
-- Rechteaenderung. Die bestehenden Befunde aus G2 bleiben getrennt.
--
-- ── Was ab hier zu tun ist ──
--
-- Eine neue Tabelle, Sequenz oder Funktion in public ist nach dieser
-- Migration fuer anon und authenticated unerreichbar. Soll ein Client
-- sie nutzen, braucht sie das in ihrer eigenen Migration:
--
--   create table public.x (...);
--   alter table public.x enable row level security;
--   create policy ... on public.x for select to authenticated using (...);
--   grant select on public.x to authenticated;
--
-- Reihenfolge und Begruendung: docs/security/database-access-model.md.
--
-- ═══════════════════════════════════════════════════════════════
-- SERVICE_ROLE BLEIBT
-- ═══════════════════════════════════════════════════════════════
--
-- service_role ist der Serverpfad — Edge Functions, Cron, Worker. Sie
-- hat BYPASSRLS und ist nie an einen Client ausgeliefert. Ihr die
-- Vorgaberechte zu nehmen hiesse, jede kuenftige Migration muesste
-- einen Grant nachziehen, den sie ohnehin immer will. Das waere
-- Buerokratie ohne Sicherheitsgewinn, und vergessene Grants wuerden
-- Serverpfade brechen statt Kunden zu schuetzen.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS OFFEN BLEIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Der supabase_admin-Satz oben. postgres ist in Supabase kein
-- Superuser und kein Mitglied von supabase_admin; "alter default
-- privileges for role supabase_admin" scheitert deshalb an den
-- Rechten. Diese Migration versucht es nicht einmal — ein Versuch,
-- der scheitert, waere ein roter Lauf; ein Versuch, der stillschweigend
-- nichts tut, waere vorgetaeuschte Sicherheit.
--
-- Praktische Reichweite des Rests: er greift nur fuer Objekte, die
-- supabase_admin anlegt. Das sind Supabase-interne, keine von
-- WERKRUF — 57 von 57 Objekten in public gehoeren postgres. Sollte
-- sich das aendern, faellt es in supabase/tests/defaultRechte.test.sql
-- auf, denn der Test prueft die Wirkung an einem neu angelegten
-- Objekt und nicht die Konfiguration einer einzelnen Rolle.
--
-- Wiederholbar.

begin;

/* ═══════════════════════════════════════════════════════════
   0 — WER FUEHRT DAS HIER AUS
   ═══════════════════════════════════════════════════════════

   ALTER DEFAULT PRIVILEGES ohne "FOR ROLE" gilt fuer current_user.
   Laeuft diese Migration unter einer anderen Rolle als der, die die
   Objekte anlegt, konfiguriert sie den falschen Satz — und danach
   stimmt die Dokumentation nicht mehr mit der Datenbank ueberein,
   ohne dass irgendwo ein Fehler steht.

   Deshalb wird hier abgebrochen, statt die falsche Rolle zu
   konfigurieren. */

do $$
declare
  v_ich        text := current_user;
  v_erzeuger   text;
  v_anzahl     integer;
begin
  select pg_catalog.pg_get_userbyid(c.relowner), count(*)
    into v_erzeuger, v_anzahl
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S')
   group by pg_catalog.pg_get_userbyid(c.relowner)
   order by count(*) desc
   limit 1;

  if v_erzeuger is null then
    raise notice 'public ist leer — Vorgaberechte werden fuer % gesetzt', v_ich;
    return;
  end if;

  if v_erzeuger <> v_ich then
    raise exception
      E'Falsche Rolle.\n'
      '  Diese Migration laeuft als "%", aber die % Objekte in public\n'
      '  gehoeren "%". ALTER DEFAULT PRIVILEGES ohne FOR ROLE gilt fuer\n'
      '  current_user und wuerde hier den falschen Satz treffen —\n'
      '  Sicherheit, die nur auf dem Papier steht.\n'
      '  Siehe Kopf dieser Datei.',
      v_ich, v_anzahl, v_erzeuger;
  end if;

  raise notice
    'Rolle stimmt: % besitzt % von % Objekten in public',
    v_ich, v_anzahl,
    (select count(*) from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v','m','S'));
end $$;

/* ═══════════════════════════════════════════════════════════
   1 — DENY BY DEFAULT
   ═══════════════════════════════════════════════════════════

   Drei Objektarten, weil alle drei betroffen sind. Die Funktionen
   sind dabei die unauffaelligste und die mit der groessten
   Reichweite: eine neue SECURITY-DEFINER-Funktion, die anon
   ausfuehren darf, umgeht jede Policy, die darunter liegt.

   "routines" deckt Funktionen und Prozeduren; "functions" waere das
   aeltere Synonym fuer dasselbe. */

alter default privileges in schema public
  revoke all on tables    from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges in schema public
  revoke all on routines  from anon, authenticated;

/* ── Funktionen brauchen eine zweite, GLOBALE Anweisung ──
   ═══════════════════════════════════════════════════════

   Die drei Zeilen oben genuegen fuer Tabellen und Sequenzen. Fuer
   Funktionen nicht, und das war nicht zu erraten. Gemessen gegen
   16.15 am 12.10.2026:

     nach "in schema public revoke all on routines
           from anon, authenticated"
       pg_default_acl:  f -> {service_role=X/postgres}
       neue Funktion:   {=X/postgres, postgres=X/..., service_role=X/...}
       anon darf:       JA

   Das "=X" ohne Namen davor ist PUBLIC. PostgreSQL vergibt EXECUTE
   auf neue Funktionen an PUBLIC als EINGEBAUTE Vorgabe; die steht
   nicht in pg_default_acl, und eine schemagebundene Zeile dort wird
   mit ihr VERSCHMOLZEN, nicht an ihre Stelle gesetzt. anon bekommt
   das Recht also nicht als anon, sondern als Mitglied von PUBLIC —
   und ein revoke an anon nimmt ihm etwas, das es nie hatte.

   Auch die dokumentierte Form half nicht, solange sie
   schemagebunden war:

     alter default privileges in schema public
       revoke execute on functions from public;
       → pg_default_acl unveraendert, neue Funktion weiter {=X/...}

   Erst ohne "in schema" greift sie:

     alter default privileges revoke execute on functions from public;
       → pg_default_acl: (global) f -> {postgres=X/postgres}
       → neue Funktion:  {postgres=X/..., service_role=X/...}
       → anon darf:      NEIN,  service_role darf: JA

   ── Reichweite, bevor man das nimmt ──

   "Global" heisst: fuer jede Funktion, die diese Rolle in JEDEM
   Schema anlegt, nicht nur in public. Nachgezaehlt ueber alle 39
   Migrationen am 12.10.2026:

     73 Funktionen in public
      1 Funktion  in pg_temp (sitzungslokal, nur fuer den Aufrufer)
      0 create extension

   Die globale Form ist fuer dieses Projekt also deckungsgleich mit
   der Absicht. Legt eine kuenftige Migration eine Funktion in einem
   anderen Schema an, verliert auch die PUBLIC-EXECUTE — das ist
   gewollt und steht in docs/security/database-access-model.md.

   service_role behaelt EXECUTE in public, weil der Supabase-Satz es
   dort explizit vergibt (service_role=X/postgres). In anderen
   Schemata muesste eine Migration es selbst vergeben. */

alter default privileges
  revoke execute on functions from public;

/* ═══════════════════════════════════════════════════════════
   1b — UND WAS DER SERVERPFAD BRAUCHT, STEHT JETZT IM REPO
   ═══════════════════════════════════════════════════════════

   service_role hatte ihre Vorgaberechte bisher aus der
   Projekteinrichtung von Supabase — nicht aus dem Repo. Das ist
   dieselbe Art von unsichtbarer Grundlage, die in G2 die fuenf
   offenen Sichten erzeugt hat: etwas gilt, weil es irgendwann
   irgendwo gesetzt wurde, und niemand kann es nachlesen.

   Gefunden beim Lauf gegen die G1-Testdatenbank am 12.10.2026: dort
   gibt es Supabases Vorgaberechte nicht (scripts/test-db/sql/
   10-supabase-stubs.sql setzt sie nicht), und die Selbstpruefung
   unten fiel mit

     service_role darf eine neue Tabelle NICHT lesen
     service_role darf eine neue Funktion NICHT ausfuehren

   Das war kein Fehler der Pruefung. Es war der Hinweis, dass die
   Testdatenbank an dieser Stelle HAERTER ist als Produktion — und
   damit genauso unbrauchbar als Abbild wie eine, die weicher ist.
   Die G1-Lehre gilt in beide Richtungen.

   Deshalb steht der Serverpfad ab hier hier und nicht in einer
   Projekteinstellung. In Produktion ist das ein No-op (die Rechte
   sind schon da), in jeder frischen Datenbank ist es die Wahrheit. */

alter default privileges in schema public
  grant all     on tables    to service_role;

alter default privileges in schema public
  grant all     on sequences to service_role;

alter default privileges in schema public
  grant execute on routines  to service_role;

/* Typen und Schemata: Supabase setzt dort keine Vorgaben fuer
   anon/authenticated (pg_default_acl hat keine Eintraege vom Typ 'T'
   oder 'n' fuer public, Stand 12.10.2026). Nichts zu entziehen —
   deshalb hier auch keine Zeile, die "der Vollstaendigkeit wegen"
   etwas tut, was nichts tut. */

/* ═══════════════════════════════════════════════════════════
   2 — SELBSTPRUEFUNG AN ECHTEN OBJEKTEN
   ═══════════════════════════════════════════════════════════

   Nicht pg_default_acl lesen, sondern drei Objekte anlegen und
   nachsehen, was die Rollen daran duerfen.

   Der Grund steht einen Abschnitt hoeher: die Konfiguration sah nach
   dem ersten Entwurf richtig aus (pg_default_acl ohne anon), und die
   neue Funktion war trotzdem offen. Eine Pruefung, die nur die
   Konfiguration liest, haette das durchgelassen und diese Migration
   mit einem gruenen Haken ausgeliefert.

   Die Probeobjekte werden am Ende dieses Blocks wieder entfernt;
   faellt die Pruefung, raeumt der Rollback auf. */

do $$
declare
  v_offen text[] := array[]::text[];
begin
  execute 'create table public.zz_deny_probe_t (id int)';
  execute 'create sequence public.zz_deny_probe_s';
  execute 'create function public.zz_deny_probe_f() returns int '
          'language sql as $f$ select 1 $f$';

  /* ── Zu sein ist Pflicht ── */
  if pg_catalog.has_table_privilege('anon', 'public.zz_deny_probe_t', 'SELECT') then
    v_offen := v_offen || 'anon darf eine neue Tabelle lesen'::text;
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.zz_deny_probe_t', 'SELECT') then
    v_offen := v_offen || 'authenticated darf eine neue Tabelle lesen'::text;
  end if;
  if pg_catalog.has_sequence_privilege('anon', 'public.zz_deny_probe_s', 'USAGE') then
    v_offen := v_offen || 'anon darf eine neue Sequenz benutzen'::text;
  end if;
  if pg_catalog.has_sequence_privilege('authenticated', 'public.zz_deny_probe_s', 'USAGE') then
    v_offen := v_offen || 'authenticated darf eine neue Sequenz benutzen'::text;
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.zz_deny_probe_f()', 'EXECUTE') then
    v_offen := v_offen || 'anon darf eine neue Funktion ausfuehren'::text;
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.zz_deny_probe_f()', 'EXECUTE') then
    v_offen := v_offen || 'authenticated darf eine neue Funktion ausfuehren'::text;
  end if;

  /* ── Erreichbar bleiben ist auch Pflicht ──

     Eine Migration, die alles zumacht, ist nicht sicher, sondern
     kaputt: ohne service_role laeuft kein Cron, keine Edge Function,
     kein Worker. */
  if not pg_catalog.has_table_privilege('service_role', 'public.zz_deny_probe_t', 'SELECT') then
    v_offen := v_offen || 'service_role darf eine neue Tabelle NICHT lesen — der Serverpfad ist zu'::text;
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.zz_deny_probe_f()', 'EXECUTE') then
    v_offen := v_offen || 'service_role darf eine neue Funktion NICHT ausfuehren — der Serverpfad ist zu'::text;
  end if;

  execute 'drop function public.zz_deny_probe_f()';
  execute 'drop sequence public.zz_deny_probe_s';
  execute 'drop table public.zz_deny_probe_t';

  if pg_catalog.array_length(v_offen, 1) > 0 then
    raise exception
      E'Deny by default greift nicht:\n  %',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  raise notice
    'Selbstpruefung an echten Objekten: neue Tabelle, Sequenz und Funktion sind fuer anon und authenticated zu, service_role kommt durch';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG IM DASHBOARD
-- ═══════════════════════════════════════════════════════════════
--
-- Der SQL-Editor zeigt NOTICE nicht an; nach dem Einspielen steht
-- dort nur "Success. No rows returned." Deshalb diese Abfrage, die
-- Zeilen zurueckgibt:
--
--   select pg_get_userbyid(d.defaclrole) as rolle,
--          d.defaclobjtype::text         as objekttyp,
--          d.defaclacl::text             as rechte
--     from pg_default_acl d
--     join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname = 'public'
--    order by rolle, objekttyp;
--
-- Erwartet: in den Zeilen mit rolle = 'postgres' kommt weder anon noch
-- authenticated vor. Die Zeilen mit rolle = 'supabase_admin' bleiben
-- unveraendert — siehe "Was offen bleibt".
--
-- Und die Gegenprobe an einem echten Objekt:
--
--   create table public.zz_probe(id int);
--   select has_table_privilege('anon','public.zz_probe','SELECT')          as anon,
--          has_table_privilege('authenticated','public.zz_probe','SELECT') as auth,
--          has_table_privilege('service_role','public.zz_probe','SELECT')  as service;
--   drop table public.zz_probe;
--
-- Erwartet: anon false, auth false, service true.
