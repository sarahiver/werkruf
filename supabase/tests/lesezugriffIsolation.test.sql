-- Abnahme fuer die Kundenisolation auf der Leseseite (Paket H2.2).
--
--   scripts/test-db/run.sh lesezugriffIsolation
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- In Produktion gemessen am 14.10.2026: 14 SECURITY-DEFINER-Funktionen
-- mit STABLE waren fuer anon ausfuehrbar, neun weitere fuer
-- authenticated. Die meisten nehmen eine p_user_id und pruefen nicht,
-- wessen Sitzung ruft. SECURITY DEFINER umgeht RLS auch beim Lesen.
--
-- Wirkungsprobe in Produktion:
--
--   set local role anon;
--   select public.compute_health_score('0000…0000'::uuid);
--   → {"grund": "kein_standort", …}   also eine Antwort, kein Fehler
--
-- Geschlossen hat das 20261014130000_lesezugriff_eigentumspruefung.sql,
-- mit zwei Mitteln: Grant entzogen, wo kein Client ruft, und
-- Eigentumspruefung im Rumpf, wo ein Client ruft.
--
-- Dieser Test prueft beides an zwei echten Nutzern.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ZWEI NUTZER UND NICHT EINER
-- ═══════════════════════════════════════════════════════════════
--
-- Ein Test mit nur einem Nutzer kann nicht zwischen "die Pruefung
-- greift" und "es gibt sowieso nichts zu sehen" unterscheiden. Hier
-- hat A echte Daten und B echte Daten, und geprueft wird in beide
-- Richtungen:
--
--   A liest A  → muss gehen, mit echtem Ergebnis
--   A liest B  → muss scheitern oder leer bleiben
--
-- Abschnitt F dreht zusaetzlich die Richtung und beweist, dass die
-- A-liest-B-Pruefungen nicht leer gruen sind: ohne die Pruefzeile im
-- Rumpf liest A sehr wohl B.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM auth.uid() HIER ERSETZT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- In der Testdatenbank ist auth.uid() ein Stub, der null liefert
-- (scripts/test-db/sql/10-supabase-stubs.sql). Gegen diesen Stub
-- waere jede Eigentumspruefung immer gruen, ohne etwas geprueft zu
-- haben — dieselbe Falle, die in G1 dreizehn Tests bestehen liess.
--
-- Deshalb steht unten die Produktionsfassung, wortgleich wie in
-- consent.test.sql. Sie rollt mit der Transaktion zurueck.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIE ROLLE WIRKLICH GEWECHSELT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- G2.2 §29 und H2.2 §11: Wirkung messen, nicht Text pruefen. Der Test
-- liest keine Migration. Er setzt role und request.jwt.claim.sub wie
-- PostgREST es tut und ruft die Funktionen auf.
--
-- Alles laeuft in einer Transaktion und wird zurueckgerollt.

\set ON_ERROR_STOP on

begin;

/* Die Produktionsfassung von auth.uid(). Rollt mit zurueck. */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

/* Zwei Nutzer mit je einem Betrieb. */
select test.benutzer('user_a');
select test.benutzer('user_b');
select test.konto('konto_a', 'user_a');
select test.konto('konto_b', 'user_b');
select test.standort('standort_si', 'user_a', 'konto_a');
select test.standort('standort_werkruf', 'user_b', 'konto_b');

/* Vorbedingung: beide haben wirklich etwas zu sehen. Ohne diese
   Zeile koennte Abschnitt B gruen sein, weil nichts da ist. */
do $$
begin
  if (select count(*) from public.google_locations
       where user_id = test.id('user_a') and deleted_at is null) <> 1 then
    raise exception 'Testaufbau: A hat keinen Betrieb';
  end if;
  if (select count(*) from public.google_locations
       where user_id = test.id('user_b') and deleted_at is null) <> 1 then
    raise exception 'Testaufbau: B hat keinen Betrieb';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════
   A — A LIEST SEINE EIGENEN DATEN, AUF DEM ECHTEN CLIENTWEG
   ═══════════════════════════════════════════════════════

   Die Haelfte, die oft vergessen wird. Eine Haertung, die alles
   sperrt, ist kein Erfolg, sondern ein Ausfall des Dashboards.

   Aus dem Browser erreichbar sind genau zwei Funktionen; die
   uebrigen sechs haben seit der Migration kein Client-Grant mehr und
   werden nur INNERHALB dieser beiden gerufen, dort als Eigentuemer.
   Deshalb stehen hier nur die zwei — ein Aufruf der anderen sechs als
   authenticated wuerde am fehlenden Recht scheitern und nicht an der
   Eigentumspruefung. Genau das prueft Abschnitt E. */

do $$
declare
  v_a        uuid := test.id('user_a');
  v_ort_a    uuid := test.id('standort_si');
  v_ergebnis uuid;
  v_feed     jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  v_ergebnis := public.werkruf_score_location(v_a);
  v_feed     := public.events_feed(v_a);

  perform pg_catalog.set_config('role', 'none', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if v_ergebnis is distinct from v_ort_a then
    raise exception
      'A bekommt fuer sich selbst % statt des eigenen Betriebs %',
      coalesce(v_ergebnis::text, 'null'), v_ort_a;
  end if;

  if v_feed is null then
    raise exception 'A bekommt keinen eigenen Events-Feed';
  end if;

  raise notice 'A: A liest seine eigenen Daten ueber beide Client-RPCs';
end $$;

/* ═══════════════════════════════════════════════════════
   A2 — DIE SECHS INNEREN MIT EIGENER ID
   ═══════════════════════════════════════════════════════

   Der Zustand, in dem die inneren Funktionen wirklich laufen: eine
   Sitzung ist da, die Rechte sind die des Eigentuemers, weil der
   Aufruf aus einer Definer-Funktion kommt. Nachgestellt mit gesetztem
   sub und role "none".

   Hier darf nichts scheitern. Ein Ergebnis wird nicht verlangt — der
   Fixture hat keine Snapshots, null ist in Ordnung. */

do $$
declare
  v_a     uuid := test.id('user_a');
  v_ort_a uuid := test.id('standort_si');
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  perform pg_catalog.set_config('role', 'none', true);

  perform public.compute_location_health_score(v_a, v_ort_a);
  perform public.previous_location_health(v_a, v_ort_a, 1::smallint);
  perform public.read_location_impact_metric(v_a, v_ort_a, 'reviews');
  perform public.build_location_evaluation_context(v_a, v_ort_a);
  perform public.weekly_mail_events(v_a, v_ort_a, 3);
  perform public.weekly_payload_for(v_a);

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  raise notice 'A2: die sechs inneren Funktionen laufen mit eigener ID';
end $$;

/* ═══════════════════════════════════════════════════════
   B — A LIEST B NICHT
   ═══════════════════════════════════════════════════════

   Alle acht mit fremder user_id, bei gesetzter Sitzung von A.

   Gelaufen wird mit role "none", damit kein fehlendes Recht
   dazwischenkommt: sonst waere dieser Abschnitt auch dann gruen, wenn
   die Eigentumspruefung gar nicht existiert — die sechs inneren
   haetten ohnehin "permission denied" geworfen, und zwar mit
   demselben SQLSTATE 42501. Das ist der Unterschied zwischen einem
   Test, der etwas prueft, und einem, der nur gruen ist.

   Geprueft wird deshalb SQLSTATE und Meldungstext. */

do $$
declare
  v_a       uuid := test.id('user_a');
  v_b       uuid := test.id('user_b');
  v_ort_b   uuid := test.id('standort_werkruf');
  v_befunde text[] := array[]::text[];
  v_status  text;
  v_meldung text;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  perform pg_catalog.set_config('role', 'none', true);

  /* 1 — werkruf_score_location */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.werkruf_score_location(v_b);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('werkruf_score_location: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 2 — events_feed */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.events_feed(v_b);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('events_feed: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 3 — compute_location_health_score */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.compute_location_health_score(v_b, v_ort_b);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('compute_location_health_score: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 4 — previous_location_health */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.previous_location_health(v_b, v_ort_b, 1::smallint);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('previous_location_health: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 5 — read_location_impact_metric */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.read_location_impact_metric(v_b, v_ort_b, 'reviews');
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('read_location_impact_metric: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 6 — build_location_evaluation_context */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.build_location_evaluation_context(v_b, v_ort_b);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('build_location_evaluation_context: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 7 — weekly_mail_events */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.weekly_mail_events(v_b, v_ort_b, 3);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('weekly_mail_events: ' || v_status || ' / ' || v_meldung);
  end if;

  /* 8 — weekly_payload_for */
  v_status := 'kein Fehler'; v_meldung := '';
  begin perform public.weekly_payload_for(v_b);
  exception when others then v_status := sqlstate; v_meldung := sqlerrm; end;
  if v_status <> '42501' or v_meldung not like '%anderen Kontos%' then
    v_befunde := v_befunde || ('weekly_payload_for: ' || v_status || ' / ' || v_meldung);
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if pg_catalog.array_length(v_befunde, 1) is not null then
    raise exception
      E'A konnte mit fremder user_id lesen (erwartet 42501 der Eigentumspruefung):\n  %',
      pg_catalog.array_to_string(v_befunde, E'\n  ');
  end if;

  raise notice 'B: alle acht weisen die fremde user_id ab (42501, Eigentumspruefung)';
end $$;

/* ═══════════════════════════════════════════════════════
   B2 — DASSELBE AUF DEM ECHTEN CLIENTWEG
   ═══════════════════════════════════════════════════════

   B laeuft mit role "none", um das fehlende Recht auszuschliessen.
   Dieser Abschnitt nimmt die zwei Funktionen, die ein Client
   wirklich erreicht, und prueft sie unter role "authenticated" — so,
   wie es im Betrieb passiert. */

do $$
declare
  v_a       uuid := test.id('user_a');
  v_b       uuid := test.id('user_b');
  v_befunde text[] := array[]::text[];
  v_status  text;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  v_status := 'kein Fehler';
  begin perform public.werkruf_score_location(v_b);
  exception when others then v_status := sqlstate; end;
  if v_status <> '42501' then
    v_befunde := v_befunde || ('werkruf_score_location: ' || v_status);
  end if;

  v_status := 'kein Fehler';
  begin perform public.events_feed(v_b);
  exception when others then v_status := sqlstate; end;
  if v_status <> '42501' then
    v_befunde := v_befunde || ('events_feed: ' || v_status);
  end if;

  perform pg_catalog.set_config('role', 'none', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if pg_catalog.array_length(v_befunde, 1) is not null then
    raise exception
      E'Als authenticated konnte A fremde Daten lesen:\n  %',
      pg_catalog.array_to_string(v_befunde, E'\n  ');
  end if;

  raise notice 'B2: als authenticated scheitert A bei beiden Client-RPCs';
end $$;

/* ═══════════════════════════════════════════════════════
   C — OHNE SITZUNG KEIN LESEN
   ═══════════════════════════════════════════════════════

   Rolle authenticated, aber kein sub im JWT. auth.uid() ist dann
   null, und Pruefung 1 der Waechterfunktion griffe nicht. Pruefung 2
   ist genau dafuer da. */

do $$
declare
  v_a      uuid := test.id('user_a');
  v_status text := 'kein Fehler';
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  if auth.uid() is not null then
    perform pg_catalog.set_config('role', 'none', true);
    raise exception 'Vorbedingung: auth.uid() sollte null sein';
  end if;

  begin
    perform public.werkruf_score_location(v_a);
  exception when others then v_status := sqlstate;
  end;

  perform pg_catalog.set_config('role', 'none', true);

  if v_status <> '42501' then
    raise exception
      'Ohne Sitzung liest authenticated trotzdem (%), erwartet 42501', v_status;
  end if;

  raise notice 'C: Clientrolle ohne Sitzung bekommt 42501';
end $$;

/* ═══════════════════════════════════════════════════════
   D — DER SERVERPFAD BLEIBT OFFEN
   ═══════════════════════════════════════════════════════

   Die Gegenrichtung zu B. Cron und die Edge Functions arbeiten fuer
   alle Nutzer; sie haben keine Sitzung und keine Clientrolle. Wuerde
   die Haertung sie mitsperren, stuenden Wochenmail und Sync still —
   und zwar lautlos.

   Hier laeuft es mit role "none" wie im Cron. */

do $$
declare
  v_b     uuid := test.id('user_b');
  v_ort_b uuid := test.id('standort_werkruf');
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('role', 'none', true);

  if public.werkruf_score_location(v_b) is distinct from v_ort_b then
    raise exception
      'Serverpfad bekommt B-Betrieb nicht — die Haertung sperrt zu viel';
  end if;

  perform public.events_feed(v_b);
  perform public.weekly_payload_for(v_b);
  perform public.weekly_mail_events(v_b, v_ort_b, 3);

  raise notice 'D: Serverpfad (role none, keine Sitzung) liest weiterhin alles';
end $$;

/* ═══════════════════════════════════════════════════════
   E — WAS KEIN CLIENT RUFT, DARF EIN CLIENT NICHT RUFEN
   ═══════════════════════════════════════════════════════

   Der Grant-Teil der Migration, als Wirkung gemessen. Hier zaehlt
   nicht die Eigentumspruefung, sondern das fehlende Recht: erwartet
   wird ebenfalls 42501, aber als "permission denied for function".

   Der Unterschied zu B ist wichtig genug, um ihn zu nennen: in B
   greift die Funktion selbst, hier kommt der Aufruf gar nicht erst
   an. Beides ist 42501 — deshalb prueft dieser Abschnitt
   zusaetzlich den Meldungstext. */

do $$
declare
  v_a       uuid := test.id('user_a');
  v_befunde text[] := array[]::text[];
  v_meldung text;
  v_status  text;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  /* Die eigene user_id, damit ein Scheitern nicht an der
     Eigentumspruefung liegen kann. */
  v_status := 'kein Fehler';
  v_meldung := '';
  begin
    perform public.compute_health_score(v_a);
  exception when others then
    v_status := sqlstate;
    v_meldung := sqlerrm;
  end;
  if v_status <> '42501' or v_meldung not like '%permission denied%' then
    v_befunde := v_befunde
      || ('compute_health_score: ' || v_status || ' / ' || v_meldung);
  end if;

  v_status := 'kein Fehler';
  v_meldung := '';
  begin
    perform public.has_paid_access(v_a);
  exception when others then
    v_status := sqlstate;
    v_meldung := sqlerrm;
  end;
  if v_status <> '42501' or v_meldung not like '%permission denied%' then
    v_befunde := v_befunde
      || ('has_paid_access: ' || v_status || ' / ' || v_meldung);
  end if;

  v_status := 'kein Fehler';
  v_meldung := '';
  begin
    perform public.weekly_payload_for(v_a);
  exception when others then
    v_status := sqlstate;
    v_meldung := sqlerrm;
  end;
  if v_status <> '42501' or v_meldung not like '%permission denied%' then
    v_befunde := v_befunde
      || ('weekly_payload_for: ' || v_status || ' / ' || v_meldung);
  end if;

  perform pg_catalog.set_config('role', 'none', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if pg_catalog.array_length(v_befunde, 1) is not null then
    raise exception
      E'Ein Client erreicht Funktionen, die er nicht rufen darf:\n  %',
      pg_catalog.array_to_string(v_befunde, E'\n  ');
  end if;

  raise notice 'E: ohne Grant kommt der Aufruf gar nicht erst an';
end $$;

/* ═══════════════════════════════════════════════════════
   F — GEGENPROBE: PRUEFT ABSCHNITT B UEBERHAUPT ETWAS
   ═══════════════════════════════════════════════════════

   Die Pruefung der Pruefung. Hier wird werkruf_score_location durch
   eine Fassung OHNE die Eigentumspruefung ersetzt — den Zustand vor
   der Migration. Danach muss A den Betrieb von B lesen koennen.

   Kann er das nicht, prueft Abschnitt B nichts: dann liegt es an
   etwas anderem, dass A dort scheitert, und jeder gruene Lauf waere
   wertlos.

   Der Rollback am Ende der Datei nimmt die Fassung wieder mit. */

create or replace function public.werkruf_score_location(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  with aktive as (
    select id, selected_at
    from public.google_locations
    where user_id = p_user_id and deleted_at is null
  )
  select case
    when (select count(*) from aktive) = 1
      then (select id from aktive)
    else (select id from aktive where selected_at is not null
           order by selected_at desc limit 1)
  end;
$fn$;

do $$
declare
  v_a     uuid := test.id('user_a');
  v_b     uuid := test.id('user_b');
  v_ort_b uuid := test.id('standort_werkruf');
  v_sah   uuid;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  v_sah := public.werkruf_score_location(v_b);

  perform pg_catalog.set_config('role', 'none', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if v_sah is distinct from v_ort_b then
    raise exception
      E'Gegenprobe wirkungslos: ohne Eigentumspruefung sieht A fuer B\n'
      '  % statt %. Dann scheitert A in Abschnitt B aus einem anderen\n'
      '  Grund, und B prueft die Eigentumspruefung nicht.',
      coalesce(v_sah::text, 'null'), v_ort_b;
  end if;

  raise notice
    'F: Gegenprobe greift — ohne die Pruefzeile liest A den Betrieb von B';
end $$;

/* ═══════════════════════════════════════════════════════
   G — POLICY STATT LISTE
   ═══════════════════════════════════════════════════════

   Die Abschnitte A bis F pruefen acht benannte Funktionen. Eine
   neunte, die morgen offen angelegt wird, saehen sie nicht.

   Hier steht deshalb die Regel: jede SECURITY-DEFINER-Funktion mit
   STABLE in public ist fuer PUBLIC, anon und authenticated
   unerreichbar — ausser den zwei Client-RPCs. Wer die Liste
   erweitert, muss das hier tun, und das ist die Stelle, an der
   jemand hinsieht.

   Gemessen mit has_function_privilege, nicht mit aclexplode(proacl):
   proacl = null heisst "PostgreSQL-Vorgabe gilt", und die Vorgabe
   fuer Funktionen ist EXECUTE fuer PUBLIC. Eine Pruefung ueber
   aclexplode allein liefert fuer solche Funktionen null Zeilen und
   sieht aus wie "nichts offen". */

create temporary table t_lese_allowlist (sig text primary key) on commit drop;

insert into t_lese_allowlist (sig) values
  ('events_feed(p_user_id uuid, p_location_id uuid, p_limit integer, p_offset integer, p_category text, p_lifecycle text[], p_include_account boolean)'),
  ('werkruf_score_location(p_user_id uuid)');

do $$
declare
  v_fehlt text[];
begin
  select pg_catalog.array_agg(a.sig order by a.sig)
    into v_fehlt
    from t_lese_allowlist a
   where not exists (
     select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname || '('
            || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = a.sig);

  if v_fehlt is not null then
    raise exception
      E'Allowlist zeigt ins Leere:\n  %\n'
      '  Dann prueft der naechste Abschnitt eine leere Teilmenge.',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

do $$
declare
  v_befunde text[] := array[]::text[];
  v_zeile   record;
begin
  for v_zeile in
    select p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig,
           pg_catalog.has_function_privilege('public', p.oid, 'execute') as pub,
           pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anon,
           pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as auth,
           pg_catalog.has_function_privilege('service_role', p.oid, 'execute') as svc
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.provolatile = 's'
     order by 1
  loop
    if exists (select 1 from t_lese_allowlist a where a.sig = v_zeile.sig) then
      if v_zeile.pub or v_zeile.anon or not v_zeile.auth then
        v_befunde := v_befunde
          || ('Client-RPC falsch: ' || v_zeile.sig
              || ' public=' || v_zeile.pub::text
              || ' anon=' || v_zeile.anon::text
              || ' auth=' || v_zeile.auth::text);
      end if;
    elsif v_zeile.pub or v_zeile.anon or v_zeile.auth then
      v_befunde := v_befunde
        || ('fuer Clients offen: ' || v_zeile.sig
            || ' public=' || v_zeile.pub::text
            || ' anon=' || v_zeile.anon::text
            || ' auth=' || v_zeile.auth::text);
    end if;

    /* Die Gegenrichtung: zu scharf gehaertet ist auch kaputt. Ohne
       service_role stehen Wochenmail und Engine still. */
    if not v_zeile.svc then
      v_befunde := v_befunde || ('service_role gesperrt: ' || v_zeile.sig);
    end if;
  end loop;

  if pg_catalog.array_length(v_befunde, 1) is not null then
    raise exception
      E'Leseseite: Rechte stimmen nicht:\n  %',
      pg_catalog.array_to_string(v_befunde, E'\n  ');
  end if;

  raise notice
    'G: von 29 definer+stable-Funktionen sind genau die zwei Client-RPCs erreichbar';
end $$;

/* ═══════════════════════════════════════════════════════
   H — GEGENPROBE ZU G
   ═══════════════════════════════════════════════════════

   H2.2 §10 verlangt sie ausdruecklich: "grant execute ... to anon →
   Test rot." Ohne diesen Abschnitt waere G gruen, wenn die Abfrage
   einen Fehler haette und nie etwas findet. */

grant execute on function public.compute_health_score(p_user_id uuid) to anon;

do $$
declare
  v_gefunden boolean;
begin
  select exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.provolatile = 's'
       and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
       and p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
           not in (select sig from t_lese_allowlist))
    into v_gefunden;

  if not v_gefunden then
    raise exception
      E'Gegenprobe wirkungslos: anon hat EXECUTE auf compute_health_score,\n'
      '  und die Abfrage aus Abschnitt G findet nichts. Dann prueft G\n'
      '  nichts, und jeder gruene Lauf ist wertlos.';
  end if;

  raise notice 'H: Gegenprobe greift — ein Grant an anon wird von G gefunden';
end $$;

revoke execute on function public.compute_health_score(p_user_id uuid) from anon;

rollback;
