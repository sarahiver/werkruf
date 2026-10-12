-- restore-isolation.sql
--
-- Trennt der Restore die Kunden wirklich?
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DAS NICHT DURCH POLICY-NAMEN ERSETZBAR IST
-- ═══════════════════════════════════════════════════════════════
--
-- restore-kernchecks.sql prueft, dass fuer jedes Recht eine auf
-- uid() beschraenkte Policy existiert. Das ist die strukturelle
-- Aussage, und sie hat drei Anlaeufe gebraucht, bis sie stimmte.
--
-- Die fachliche Aussage ist eine andere: sieht Nutzer A wirklich nur
-- seine Zeilen? Diese Datei beantwortet sie, indem sie es versucht —
-- als authenticated, mit dem JWT-Anspruch eines bestimmten Nutzers.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS PASSIERT, WENN auth.uid() EIN STUB IST
-- ═══════════════════════════════════════════════════════════════
--
-- Dann bricht diese Datei ab, mit Begruendung.
--
-- Der lokale Testaufbau (G1) hat ein auth.uid(), das immer null
-- liefert, weil es lokal keinen JWT gibt. Gegen diesen Stub saehen
-- alle Abfragen unten null Zeilen — und der Test waere gruen, ohne
-- irgendetwas geprueft zu haben. Genau diese Art von falschem Gruen
-- hat in G1 dreizehn Tests monatelang bestehen lassen.
--
-- Deshalb: erst pruefen, ob auth.uid() echt ist. Wenn nicht, wirft
-- die Datei. Sie kann damit nur gegen einen echten Restore gruen
-- werden.
--
-- ═══════════════════════════════════════════════════════════════
-- AUFRUF
-- ═══════════════════════════════════════════════════════════════
--
--   psql -d <restore-db> -v ON_ERROR_STOP=1 \
--        -f scripts/backup/restore-isolation.sql
--
-- Liest nur. Rollt am Ende zurueck.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════════
   0 — IST auth.uid() ECHT?
   ═══════════════════════════════════════════════════════════

   Das echte auth.uid() von Supabase liest den JWT aus den
   Sitzungseinstellungen und enthaelt deshalb "request.jwt" in
   seinem Rumpf. Der Stub aus dem Testaufbau tut das nicht — er
   gibt null zurueck. */
do $$
declare v_rumpf text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into v_rumpf
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'auth' and p.proname = 'uid'
   limit 1;

  if v_rumpf is null then
    raise exception 'auth.uid() existiert nicht — der Restore ist unvollstaendig';
  end if;

  if v_rumpf not like '%request.jwt%' then
    raise exception
      E'auth.uid() ist ein Stub, nicht die echte Supabase-Funktion.\n'
      '  Dieser Test kann hier nichts beweisen und wird deshalb nicht\n'
      '  stillschweigend uebersprungen. Er gehoert an einen Restore\n'
      '  eines echten Produktionsdumps.';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   1 — ZWEI NUTZER AUS DEM BESTAND SUCHEN
   ═══════════════════════════════════════════════════════════

   Keine angelegt: der Restore soll geprueft werden, nicht
   veraendert. Gebraucht werden zwei Nutzer, die beide mindestens
   einen Standort haben — sonst sagt der Vergleich nichts. */
create temporary table pruefnutzer (rolle text primary key, id uuid) on commit drop;

insert into pruefnutzer (rolle, id)
select 'a', l.user_id
  from public.google_locations l
 where l.deleted_at is null
 group by l.user_id
 having count(*) > 0
 order by l.user_id
 limit 1;

insert into pruefnutzer (rolle, id)
select 'b', l.user_id
  from public.google_locations l
 where l.deleted_at is null
   and l.user_id <> (select id from pruefnutzer where rolle = 'a')
 group by l.user_id
 order by l.user_id
 limit 1;

/* ═══════════════════════════════════════════════════════════
   1b — WENN ES NUR EINEN NUTZER GIBT
   ═══════════════════════════════════════════════════════════

   Der Lauf vom 12.10.2026 endete hier:

     ERROR: Weniger als zwei Nutzer mit Standorten im Restore.
     [NICHT GEPRUEFT] zu wenige Nutzer im Restore.

   Das war richtig — und nutzlos. Mit einem Kunden in Produktion
   waere die Kundentrennung bis zum zweiten Kunden nie geprueft, und
   der zweite Kunde ist genau der Moment, in dem sie stimmen MUSS.

   ───────────────────────────────────────────────────────────
   WARUM HIER KEIN ZWEITER NUTZER ANGELEGT WIRD
   ───────────────────────────────────────────────────────────

   Der naheliegende Weg waere, einen zweiten Nutzer samt Konto und
   Standort einzufuegen — die Datei laeuft in begin/rollback, es
   bliebe nichts zurueck. Dafuer muesste sie aber die Spaltenformen
   von auth.users, user_profiles, google_accounts und
   google_locations kennen: NOT NULL ohne Default,
   Fremdschluesselketten, Unique-Indizes. Genau dieses Raten hat in
   diesem Projekt bereits einen erfundenen sync_locks ohne
   locked_by produziert, der jede Sperre geworfen haette.

   ───────────────────────────────────────────────────────────
   WAS STATTDESSEN GEPRUEFT WIRD
   ───────────────────────────────────────────────────────────

   Die Eigenschaft, um die es geht, ist: eine Sitzung sieht nur die
   Zeilen, die ihrer uid() gehoeren. Dafuer braucht man keinen
   zweiten bestueckten Nutzer, sondern einen zweiten uid() —
   und eine zufaellige uuid ist einer.

     A  echte uid des vorhandenen Nutzers  → sieht N Standorte, N > 0
     X  zufaellige uid, kein Datensatz     → sieht 0 Standorte,
                                             obwohl N > 0 existieren

   Sieht X null, waehrend die Tabelle nicht leer ist, dann koennen
   fremde Zeilen nicht gelesen werden. Das ist die Trennung.

   Nicht der Null-gegen-Null-Fehler: dass die Tabelle Zeilen hat,
   wird VOR dem Rollenwechsel als Superuser gezaehlt, und dass A
   sie sieht, steht in Abschnitt 2. Verweigert der Restore alles,
   faellt das dort auf.

   Schwaecher als zwei echte Nutzer ist das in einem Punkt: eine
   Policy, die nicht nach uid() sondern nach Kontozugehoerigkeit
   entscheidet, wuerde so nicht auffallen. Deshalb bleibt der
   Zwei-Nutzer-Weg der bevorzugte und laeuft automatisch, sobald es
   den zweiten Kunden gibt. Welcher Weg gelaufen ist, steht in der
   Ausgabe — ein Beweis, der nicht sagt, was er bewiesen hat, ist
   keiner. */

create temporary table pruefmodus (modus text) on commit drop;

do $$
declare
  v_nutzer integer := (select count(*) from pruefnutzer);
begin
  if v_nutzer >= 2 then
    insert into pruefmodus values ('zwei-nutzer');
    raise notice 'Modus: zwei echte Nutzer';
    return;
  end if;

  if v_nutzer = 1 then
    /* X bekommt eine zufaellige uid. Die Kollisionswahrscheinlichkeit
       mit einem echten Nutzer ist die einer uuid4 — und selbst dann
       waere der Test nur zu streng, nicht zu lasch. */
    insert into pruefnutzer (rolle, id)
    values ('x', pg_catalog.gen_random_uuid());
    insert into pruefmodus values ('ein-nutzer-plus-fremde-uid');
    raise notice
      'Modus: ein echter Nutzer, Gegenprobe mit fremder uid (kein zweiter Kunde vorhanden)';
    return;
  end if;

  raise exception
    E'Kein Nutzer mit Standorten im Restore.\n'
    '  Die Kundentrennung laesst sich ohne einen einzigen Datensatz\n'
    '  nicht pruefen. Das ist kein Fehler des Restores, aber auch\n'
    '  kein Beweis.';
end $$;

/* ═══════════════════════════════════════════════════════════
   2 — ALS NUTZER A LESEN
   ═══════════════════════════════════════════════════════════ */
do $$
declare
  v_a uuid := (select id from pruefnutzer where rolle = 'a');
  /* rolle 'b' im Zwei-Nutzer-Modus, 'x' sonst. Die Abfragen unten
     sind in beiden Faellen dieselben: "sieht A Zeilen, die dieser
     uid gehoeren". */
  v_b uuid := (select id from pruefnutzer
                where rolle in ('b', 'x') order by rolle limit 1);
  v_modus text := (select modus from pruefmodus);
  v_eigene integer;
  v_fremde integer;
  v_gesamt integer;
  v_betroffen integer;
begin
  /* Vor dem Rollenwechsel, als Superuser: hat die Tabelle ueberhaupt
     Zeilen? Ohne diese Zahl ist "X sieht 0" kein Befund, sondern
     eine leere Tabelle — der Null-gegen-Null-Fehler. */
  select count(*) into v_gesamt
    from public.google_locations where deleted_at is null;

  if v_gesamt = 0 then
    raise exception
      'Keine Standorte im Restore — die Trennung ist an leeren Tabellen nicht pruefbar';
  end if;

  /* Die Sitzung wird zu Nutzer A. set local gilt bis zum rollback. */
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  /* Vorbedingung: sieht A ueberhaupt etwas? Ein Restore, der alles
     verweigert, waere sicher und unbenutzbar — und ein Test, der
     null gegen null vergleicht, beweist nichts. */
  select count(*) into v_eigene
    from public.google_locations where user_id = v_a;

  if v_eigene = 0 then
    raise exception
      'Nutzer A sieht seine eigenen Standorte nicht — Policy oder Recht fehlt';
  end if;

  /* Der Kern: Standorte von B duerfen nicht sichtbar sein. */
  select count(*) into v_fremde
    from public.google_locations where user_id = v_b;

  if v_fremde <> 0 then
    raise exception
      'KUNDENTRENNUNG VERLETZT: Nutzer A sieht % Standorte von Nutzer B', v_fremde;
  end if;

  /* Dasselbe fuer die Tabellen, in denen Kundeninhalte liegen. */
  if (select count(*) from public.google_reviews where user_id = v_b) <> 0 then
    raise exception 'KUNDENTRENNUNG VERLETZT: fremde Bewertungen sichtbar';
  end if;
  if (select count(*) from public.events where user_id = v_b) <> 0 then
    raise exception 'KUNDENTRENNUNG VERLETZT: fremde Empfehlungen sichtbar';
  end if;
  if (select count(*) from public.user_profiles where id = v_b) <> 0 then
    raise exception 'KUNDENTRENNUNG VERLETZT: fremdes Profil sichtbar';
  end if;

  raise notice 'Lesen: A sieht % eigene Standorte und 0 fremde', v_eigene;

  /* ── Die Gegenrichtung, und im Ein-Nutzer-Modus die eigentliche
        Pruefung ──

     Oben wurde gefragt: sieht A die Zeilen von B. Im
     Ein-Nutzer-Modus hat B keine Zeilen, und die Antwort waere
     trivial null — der Null-gegen-Null-Fehler.

     Deshalb hier umgekehrt: die Sitzung wird zu B (bzw. X) und muss
     NULL der % Standorte sehen, die nachweislich existieren. Das
     gilt in beiden Modi und ist im Ein-Nutzer-Modus der Beweis. */
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_b::text, 'role', 'authenticated')::text,
    true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  select count(*) into v_fremde
    from public.google_locations where user_id = v_a;

  if v_fremde <> 0 then
    raise exception
      'KUNDENTRENNUNG VERLETZT: fremde Sitzung sieht % Standorte von A', v_fremde;
  end if;

  if (select count(*) from public.google_reviews where user_id = v_a) <> 0 then
    raise exception 'KUNDENTRENNUNG VERLETZT: fremde Sitzung sieht Bewertungen von A';
  end if;
  if (select count(*) from public.user_profiles where id = v_a) <> 0 then
    raise exception 'KUNDENTRENNUNG VERLETZT: fremde Sitzung sieht das Profil von A';
  end if;

  /* ── Schreiben aus der fremden Sitzung: OHNE where ──
     ───────────────────────────────────────────────────

     Der erste Entwurf schrieb hier

       update public.google_locations set title = '…' where user_id = v_a;

     und die Gegenprobe hat ihn widerlegt: eine UPDATE-Policy auf
     "using (true)" zu setzen wurde NICHT erkannt.

     Der Grund steckt in PostgreSQL. Ein UPDATE mit where-Bedingung
     muss die Zeilen lesen, um sie zu finden — und dabei greifen
     zusaetzlich die SELECT-Policies. Solange SELECT korrekt auf
     uid() beschraenkt ist, findet die fremde Sitzung die Zeilen von
     A nicht und das UPDATE trifft null Zeilen. Die intakte
     SELECT-Policy verdeckt die kaputte UPDATE-Policy.

     Ohne where-Bedingung liest das UPDATE keine Spalte. Dann
     entscheidet allein die UPDATE-Policy, welche Zeilen es trifft —
     und genau so wuerde das Loch auch ausgenutzt. Die fremde Sitzung
     besitzt keine Zeile, also ist JEDE getroffene Zeile eine
     Verletzung.

     Unqualifiziert zu schreiben ist hier gefahrlos: die Datei laeuft
     in begin/rollback, und das Ziel ist eine Wegwerfkopie.

     ── Und was dabei gezaehlt wird ──

     Der zweite Entwurf zaehlte die getroffenen Zeilen und warf bei
     mehr als null. Die Gegenprobe im Zwei-Nutzer-Modus hat ihn
     widerlegt: B besitzt eine eigene Zeile und darf sie aendern. Der
     Test meldete eine Verletzung, wo keine war — dieselbe Klasse wie
     die 115 Falschmeldungen in den Kernchecks, eine Erwartung statt
     einer Wirkung.

     Gezaehlt wird deshalb nicht, wie viel die fremde Sitzung
     getroffen hat, sondern ob eine Zeile von A darunter war. Das ist
     in beiden Modi dieselbe Frage und die einzige, die zaehlt. */
  update public.google_locations set title = 'K9_UEBERNOMMEN';

  /* Zum Nachsehen zurueck auf den Superuser: als authenticated waere
     die Antwort selbst durch die Policy gefiltert, und ein Test, der
     sein Ergebnis durch das zu pruefende Sieb liest, prueft nichts. */
  perform pg_catalog.set_config('role', 'none', true);

  select count(*) into v_betroffen
    from public.google_locations
   where user_id = v_a and title = 'K9_UEBERNOMMEN';

  if v_betroffen <> 0 then
    raise exception
      'KUNDENTRENNUNG VERLETZT: fremde Sitzung hat % Standorte von A geaendert',
      v_betroffen;
  end if;

  /* Dasselbe fuer DELETE. Ob authenticated das Recht ueberhaupt hat,
     entscheidet der Dump; hat es keins, scheitert die Anweisung mit
     insufficient_privilege — auch das ist in Ordnung und wird
     abgefangen. Was nicht in Ordnung ist: dass Zeilen von A
     verschwinden. */
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_b::text, 'role', 'authenticated')::text,
    true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  begin
    delete from public.google_locations;
  exception
    when insufficient_privilege then
      null;  /* kein DELETE-Recht — richtig so */
  end;

  perform pg_catalog.set_config('role', 'none', true);

  select count(*) into v_betroffen
    from public.google_locations where user_id = v_a and deleted_at is null;

  if v_betroffen <> v_eigene then
    raise exception
      'KUNDENTRENNUNG VERLETZT: fremde Sitzung hat Standorte von A geloescht (% von % uebrig)',
      v_betroffen, v_eigene;
  end if;

  raise notice
    'Gegenprobe (%): fremde Sitzung sieht 0 von % vorhandenen Standorten und kann keinen aendern',
    v_modus, v_gesamt;
end $$;

/* ── Rolle zuruecksetzen, bevor die naechste Pruefung liest ──
   ═══════════════════════════════════════════════════════════

   Abschnitt 2 endet als authenticated. Der declare-Teil des
   naechsten Blocks liest aber pruefnutzer — eine temporaere Tabelle,
   die postgres gehoert. Als authenticated scheitert das mit

     ERROR: permission denied for table pruefnutzer

   Dieser Fehler steckte seit dem ersten Entwurf in der Datei und ist
   nie aufgefallen, weil Abschnitt 3 nie erreicht wurde: lokal warf
   die Stub-Pruefung, in Produktion die Zwei-Nutzer-Bedingung. Der
   Schreibtest — der, der prueft, ob ein Kunde sich selbst Pro
   schenken kann — ist also noch nie gelaufen.

   Gefunden am 12.10.2026, als der Ein-Nutzer-Modus Abschnitt 3
   erstmals erreichte. */
reset role;

/* ═══════════════════════════════════════════════════════════
   3 — ALS NUTZER A SCHREIBEN VERSUCHEN
   ═══════════════════════════════════════════════════════════

   Lesen getrennt zu haben genuegt nicht. Ein Restore, der das
   revoke auf user_profiles verliert, gaebe dem Kunden
   Schreibrechte auf seine eigene plan-Spalte zurueck — und damit
   Pro-Zugang zum Nulltarif. */
do $$
declare
  v_a uuid := (select id from pruefnutzer where rolle = 'a');
  v_b uuid := (select id from pruefnutzer where rolle in ('b', 'x')
                order by rolle limit 1);
  v_abgewiesen boolean;
begin
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  /* Eigener Plan: muss scheitern, weil authenticated kein
     UPDATE-Recht auf user_profiles hat (Migration 20260928160000). */
  v_abgewiesen := false;
  begin
    update public.user_profiles set plan = 'pro' where id = v_a;
    /* Kein Fehler? Dann hat die Zeile entweder nicht getroffen oder
       das Recht ist zurueck. Beides pruefen. */
    if found then
      raise exception 'SCHREIBRECHT ZURUECK: Kunde konnte seinen eigenen plan setzen';
    end if;
  exception
    when insufficient_privilege then v_abgewiesen := true;
    when others then raise;
  end;

  if not v_abgewiesen then
    raise exception
      'authenticated darf public.user_profiles schreiben — plan waere selbst setzbar';
  end if;

  /* Fremde Standortdaten aendern: muss ins Leere laufen. */
  update public.google_locations set title = 'uebernommen' where user_id = v_b;
  if found then
    raise exception 'KUNDENTRENNUNG VERLETZT: fremder Standort aenderbar';
  end if;

  raise notice 'Schreiben: eigener plan abgewiesen, fremder Standort unerreichbar';
end $$;

rollback;
