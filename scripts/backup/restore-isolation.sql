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

do $$
begin
  if (select count(*) from pruefnutzer) < 2 then
    raise exception
      E'Weniger als zwei Nutzer mit Standorten im Restore.\n'
      '  Die Kundentrennung laesst sich mit einem Nutzer nicht pruefen.\n'
      '  Das ist kein Fehler des Restores, aber auch kein Beweis.';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   2 — ALS NUTZER A LESEN
   ═══════════════════════════════════════════════════════════ */
do $$
declare
  v_a uuid := (select id from pruefnutzer where rolle = 'a');
  v_b uuid := (select id from pruefnutzer where rolle = 'b');
  v_eigene integer;
  v_fremde integer;
begin
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
end $$;

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
  v_b uuid := (select id from pruefnutzer where rolle = 'b');
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
