-- Abnahme fuer die EXECUTE-Rechte der SECURITY-DEFINER-Funktionen
-- in public (Paket H2.2 B).
--
--   scripts/test-db/run.sh securityDefinerPrivileges
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- In Produktion gemessen am 14.10.2026: 46 von 82 SECURITY-DEFINER-
-- Funktionen mit VOLATILE waren fuer PUBLIC ausfuehrbar, darunter
--
--   update_user_plan(uuid, text, timestamptz)
--
-- Als anon im SQL-Editor aufgerufen lief sie durch. Sie setzt plan
-- und trial_ends_at eines beliebigen Nutzers und hat im ganzen Repo
-- keinen Aufrufer. Ein Founding Partner liess sich damit auf 'free'
-- setzen.
--
-- Geschlossen hat das 20261014120000_execute_rechte_kanonisch.sql.
-- Dieser Test haelt es geschlossen.
--
-- ═══════════════════════════════════════════════════════════════
-- POLICY STATT LISTE
-- ═══════════════════════════════════════════════════════════════
--
-- Der Test prueft nicht "sind diese 48 zu", sondern die Regel:
--
--   Jede SECURITY-DEFINER-Funktion mit VOLATILE in public ist fuer
--   PUBLIC, anon und authenticated unerreichbar — ausser den drei
--   ausdruecklich erlaubten Client-RPCs.
--
-- Der Unterschied ist der Punkt des Tests. Eine Liste waere gruen,
-- sobald die 48 zu sind, und wuerde eine 49. neue offene Funktion
-- nicht sehen. Die Policy faellt dafuer.
--
-- Die Allowlist steht in Abschnitt 0 und nur dort. Wer sie erweitert,
-- muss das im Test tun — und das ist die Stelle, an der jemand
-- hinsieht.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM has_function_privilege UND NICHT aclexplode
-- ═══════════════════════════════════════════════════════════════
--
-- Das ist der Fehler, der den Befund fast verdeckt hat. proacl = null
-- heisst nicht "keine Rechte", sondern "die PostgreSQL-Vorgabe gilt",
-- und die Vorgabe fuer Funktionen ist EXECUTE fuer PUBLIC. In der
-- ersten Messung standen genau die 46 kritischen Funktionen auf
-- proacl = null. Eine Pruefung ueber aclexplode(proacl) allein
-- liefert fuer sie null Zeilen und sieht aus wie "nichts offen".
--
-- has_function_privilege loest die Vorgabe auf und sieht auch Rechte,
-- die ueber Rollenmitgliedschaft ankommen.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT UEBER TEXTMUSTER
-- ═══════════════════════════════════════════════════════════════
--
-- G2.2 §29 und H2.2 §11: "Nicht nur Quelltext nach revoke
-- durchsuchen." Hier wird kein Migrationstext gelesen. Abschnitt A
-- bis C fragen den Rechtekatalog, D wechselt wirklich die Rolle und
-- ruft die Funktion auf, E dreht die Richtung und beweist, dass A
-- nicht leer gruen ist.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESER TEST NICHT PRUEFT
-- ═══════════════════════════════════════════════════════════════
--
-- Die 29 SECURITY-DEFINER-Funktionen mit VOLATILE = 's'. 14 davon
-- sind fuer anon ausfuehrbar und geben bei fremder user_id fremde
-- Kundendaten zurueck; in Produktion gemessen. Das ist ein eigener,
-- offener Befund: docs/h2-2-security-audit.md Abschnitt 7. Er wartet
-- auf eine Entscheidung und steht absichtlich nicht hier — ein Test,
-- der eine unentschiedene Frage mitprueft, erzwingt die Entscheidung
-- im Vorbeigehen.
--
-- Alles laeuft in einer Transaktion und wird zurueckgerollt.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════
   0 — DIE ALLOWLIST
   ═══════════════════════════════════════════════════════

   Genau die drei RPCs, die das Frontend wirklich ruft. Jeder hat
   einen belegten Aufrufer und eine Eigentumspruefung:

     accept_terms(text)          src/pages/Onboarding.js
                                 nimmt keine user_id, liest auth.uid()
     claim_own_lead()            src/hooks/useAuth.js, Signup.js
                                 nimmt keine Argumente, auth.uid()
     touch_dashboard_visit(uuid) src/hooks/useEvents.js
                                 nimmt eine user_id, vergleicht sie
                                 aber mit auth.uid()

   Soll fuer diese drei: public=false, anon=false, authenticated=true.
   Soll fuer alle anderen: public=false, anon=false,
   authenticated=false, service_role=true. */

create temporary table t_allowlist (sig text primary key) on commit drop;

insert into t_allowlist (sig) values
  ('accept_terms(p_version text)'),
  ('claim_own_lead()'),
  ('touch_dashboard_visit(p_user_id uuid)');

/* Die Allowlist muss auf echte Funktionen zeigen. Ohne diese Pruefung
   waere eine umbenannte Funktion kein Befund, sondern ein stiller
   Eintrag ins Leere — und Abschnitt B wuerde eine leere Teilmenge
   pruefen und gruen melden. */

do $$
declare
  v_fehlt text[];
begin
  select pg_catalog.array_agg(a.sig order by a.sig)
    into v_fehlt
    from t_allowlist a
   where not exists (
     select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname || '('
            || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = a.sig);

  if v_fehlt is not null then
    raise exception
      E'Allowlist zeigt auf Funktionen, die es nicht gibt:\n  %\n'
      '  Entweder wurde umbenannt, oder die Signatur ist falsch\n'
      '  geschrieben. Beides macht Abschnitt B wirkungslos.',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   A — KEINE SERVER-FUNKTION IST FUER CLIENTS ERREICHBAR
   ═══════════════════════════════════════════════════════

   Die eigentliche Policy. Faellt sie, ist entweder eine neue Funktion
   offen angelegt worden oder ein Grant ist zurueckgekommen.

   Nicht blind ergaenzen, wenn das hier faellt: erst Aufrufer und
   Wirkung pruefen (H2.2 §5), dann entscheiden, ob die Funktion auf
   die Allowlist gehoert oder in die Migration. */

do $$
declare
  v_offen text[];
begin
  select pg_catalog.array_agg(t.zeile order by t.zeile)
    into v_offen
    from (
      select p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
             || ' | public=' || pg_catalog.has_function_privilege('public', p.oid, 'execute')::text
             || ' anon='     || pg_catalog.has_function_privilege('anon', p.oid, 'execute')::text
             || ' auth='     || pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')::text
             as zeile,
             p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and p.provolatile = 'v'
         and (pg_catalog.has_function_privilege('public', p.oid, 'execute')
              or pg_catalog.has_function_privilege('anon', p.oid, 'execute')
              or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute'))
    ) as t
   where t.sig not in (select sig from t_allowlist);

  if v_offen is not null then
    raise exception
      E'SECURITY-DEFINER-Funktionen fuer Clients erreichbar:\n  %\n'
      '  Soll: public=false anon=false auth=false.\n'
      '  Siehe 20261014120000_execute_rechte_kanonisch.sql und\n'
      '  docs/h2-2-security-audit.md.',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  raise notice 'A: keine Server-Funktion fuer PUBLIC/anon/authenticated offen';
end $$;

/* ═══════════════════════════════════════════════════════
   B — DIE CLIENT-RPCs HABEN GENAU DIE ERLAUBTEN ROLLEN
   ═══════════════════════════════════════════════════════

   Die Gegenrichtung von A. authenticated muss da sein, sonst bricht
   das Dashboard; PUBLIC und anon duerfen nicht da sein, sonst gilt
   der Grant auch ohne Login. */

do $$
declare
  v_falsch text[];
begin
  select pg_catalog.array_agg(t.zeile order by t.zeile)
    into v_falsch
    from (
      select a.sig || ' | public=' || pg_catalog.has_function_privilege('public', p.oid, 'execute')::text
             || ' anon=' || pg_catalog.has_function_privilege('anon', p.oid, 'execute')::text
             || ' auth=' || pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')::text
             as zeile,
             pg_catalog.has_function_privilege('public', p.oid, 'execute') as pub,
             pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anon,
             pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as auth
        from t_allowlist a
        join pg_catalog.pg_proc p
          on p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = a.sig
        join pg_catalog.pg_namespace n
          on n.oid = p.pronamespace and n.nspname = 'public'
    ) as t
   where t.pub or t.anon or not t.auth;

  if v_falsch is not null then
    raise exception
      E'Client-RPC-Rechte stimmen nicht:\n  %\n'
      '  Soll: public=false anon=false auth=true.',
      pg_catalog.array_to_string(v_falsch, E'\n  ');
  end if;

  raise notice 'B: die drei Client-RPCs haben genau authenticated';
end $$;

/* ═══════════════════════════════════════════════════════
   C — service_role ERREICHT ALLES
   ═══════════════════════════════════════════════════════

   Ohne diese Pruefung waere der sicherste Zustand "alles zu, auch
   fuer den Server" — und damit stehen Cron und Edge Functions, ohne
   dass ein Test es merkt. Das ist die Pruefung, die eine zu scharfe
   Haertung auffaengt. */

do $$
declare
  v_zu text[];
begin
  select pg_catalog.array_agg(
           p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
           order by p.proname)
    into v_zu
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.provolatile = 'v'
     and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute');

  if v_zu is not null then
    raise exception
      E'service_role kann diese Funktionen nicht ausfuehren:\n  %\n'
      '  Cron und Edge Functions wuerden daran scheitern.',
      pg_catalog.array_to_string(v_zu, E'\n  ');
  end if;

  raise notice 'C: service_role erreicht alle SECURITY-DEFINER-Funktionen';
end $$;

/* ═══════════════════════════════════════════════════════
   D — WIRKUNG, NICHT KATALOG
   ═══════════════════════════════════════════════════════

   H2.2 §11. A bis C lesen den Rechtekatalog. Hier wird die Rolle
   wirklich gewechselt und die Funktion wirklich gerufen.

   Die Null-UUID trifft keine Zeile, und update_user_plan ist ein
   reiner UPDATE-Pfad. Selbst wenn das Recht da waere, aendert der
   Aufruf nichts — und die Transaktion wird ohnehin zurueckgerollt.

   Erwartet wird insufficient_privilege (42501). Ein Fachfehler waere
   ein Befund: er hiesse, die Funktion lief an. */

do $$
declare
  v_rolle   text;
  v_lief    boolean;
  v_befunde text[] := array[]::text[];
begin
  foreach v_rolle in array array['anon', 'authenticated'] loop
    v_lief := true;
    perform pg_catalog.set_config('role', v_rolle, true);

    begin
      perform public.update_user_plan(
        '00000000-0000-0000-0000-000000000000'::uuid, 'free');
    exception
      when insufficient_privilege then v_lief := false;
    end;

    perform pg_catalog.set_config('role', 'none', true);

    if v_lief then
      v_befunde := v_befunde
        || (v_rolle || ' konnte update_user_plan ausfuehren');
    end if;
  end loop;

  if pg_catalog.array_length(v_befunde, 1) is not null then
    raise exception
      E'Rechte greifen nicht:\n  %\n'
      '  Die Funktion setzt plan und trial_ends_at eines beliebigen\n'
      '  Nutzers und hat keinen Aufrufer im Repo.',
      pg_catalog.array_to_string(v_befunde, E'\n  ');
  end if;

  raise notice
    'D: anon und authenticated scheitern an update_user_plan mit 42501';
end $$;

/* ═══════════════════════════════════════════════════════
   E — GEGENPROBE: FINDET A UEBERHAUPT ETWAS
   ═══════════════════════════════════════════════════════

   Die Pruefung der Pruefung. H2.2 §10 verlangt sie ausdruecklich:
   "grant execute ... to anon → Test rot."

   Ohne diesen Abschnitt waere A gruen, wenn die Abfrage einen Fehler
   haette und nie etwas findet. Genau so sind in G1 dreizehn Tests
   gruen geblieben, ohne etwas zu pruefen.

   Hier wird ein Grant absichtlich gesetzt, dieselbe Abfrage wie in A
   laufen gelassen und verlangt, dass sie ihn findet. Danach wird er
   zurueckgenommen; der Rollback am Ende der Datei nimmt ihn ohnehin
   mit. */

grant execute on function
  public.update_user_plan(p_user_id uuid, p_plan text, p_trial_ends timestamp with time zone)
  to anon;

do $$
declare
  v_offen text[];
begin
  select pg_catalog.array_agg(t.sig order by t.sig)
    into v_offen
    from (
      select p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and p.provolatile = 'v'
         and (pg_catalog.has_function_privilege('public', p.oid, 'execute')
              or pg_catalog.has_function_privilege('anon', p.oid, 'execute')
              or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute'))
    ) as t
   where t.sig not in (select sig from t_allowlist);

  if v_offen is null then
    raise exception
      E'Gegenprobe wirkungslos: anon hat EXECUTE auf update_user_plan,\n'
      '  und die Abfrage aus Abschnitt A findet nichts. Dann prueft A\n'
      '  nichts, und jeder gruene Lauf dieses Tests ist wertlos.';
  end if;

  if not ('update_user_plan(p_user_id uuid, p_plan text, p_trial_ends timestamp with time zone)'
          = any (v_offen)) then
    raise exception
      E'Gegenprobe findet etwas anderes als erwartet:\n  %',
      pg_catalog.array_to_string(v_offen, E'\n  ');
  end if;

  raise notice
    'E: Gegenprobe greift — ein Grant an anon wird von A gefunden';
end $$;

revoke execute on function
  public.update_user_plan(p_user_id uuid, p_plan text, p_trial_ends timestamp with time zone)
  from anon;

/* Und danach muss A wieder gruen sein. Sonst haette die Gegenprobe
   den Zustand kaputt gelassen und der naechste Abschnitt eines
   kuenftigen Tests wuerde auf einem Scherbenhaufen pruefen. */

do $$
declare
  v_offen integer;
begin
  select count(*)
    into v_offen
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.provolatile = 'v'
     and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
     and p.proname || '('
         || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
         not in (select sig from t_allowlist);

  if v_offen <> 0 then
    raise exception
      'Nach der Gegenprobe sind % Funktionen fuer anon offen geblieben',
      v_offen;
  end if;

  raise notice 'E: Zustand nach der Gegenprobe wiederhergestellt';
end $$;

rollback;
