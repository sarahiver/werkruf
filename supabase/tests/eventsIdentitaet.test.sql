-- Abnahme fuer die Identitaet offener Empfehlungen.
--
--   psql -v ON_ERROR_STOP=1 -f eventsIdentitaet.test.sql
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Am 14.10.2026 scheiterten openingHours und recommendationClass in CI
-- mit demselben Bild, waehrend beide lokal gruen waren:
--
--   ERROR: duplicate key value violates unique constraint
--          "events_identitaet_ohne_subject_idx"
--   Key (user_id, location_id, type)=(…, …, connection.lost)
--          already exists.
--   PL/pgSQL function public.sync_events(uuid,jsonb,text,uuid) line 62
--
-- Zeile 62 ist der INSERT-Zweig. sync_events sucht vorher, ob die
-- Empfehlung in diesem Umfang schon offen ist, und aktualisiert sie
-- dann. Landet es trotzdem im INSERT und faellt dort ueber den Index,
-- dann widersprechen sich zwei Dinge, die uebereinstimmen muessen:
--
--   die SUCHE in sync_events       lifecycle in ('new','seen','opened')
--   das PRAEDIKAT des Index        muss dieselbe Menge sein
--
-- Deckt der Index MEHR ab — etwa auch 'resolved' —, dann blockiert eine
-- laengst aufgeloeste Zeile die neue, und die Suche findet sie nicht,
-- weil sie nur offene Zeilen ansieht. Genau dieses Bild.
--
-- Deckt er WENIGER ab, entstehen Dubletten: der Bestand vom 30.09.,
-- einundzwanzig identische "Verbindung pruefen" in zwei Tagen.
--
-- ═══════════════════════════════════════════════════════════════
-- WIE GEPRUEFT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- Nicht ueber den Text der Indexdefinition (G2.2 §29: Security und
-- Verhalten nicht ueber Textmuster definieren). Geprueft wird die
-- Wirkung: eine Zeile anlegen, aufloesen, dieselbe Identitaet erneut
-- anlegen. Geht das durch, stimmen Suche und Index ueberein.
--
-- Die Definitionen werden zusaetzlich als NOTICE ausgegeben. Sie sind
-- kein Pruefmittel, sondern Beweismaterial: faellt dieser Test auf
-- einem anderen Server als dem eigenen, steht im Protokoll, womit man
-- es zu tun hat.

\set ON_ERROR_STOP on

begin;

select test.basis();

/* ═══════════════════════════════════════════════════════
   0 — Beweismaterial ins Protokoll
   ═══════════════════════════════════════════════════════ */
do $$
declare r record;
begin
  raise notice '[eventsIdentitaet] %', pg_catalog.version();

  for r in
    select c.relname, pg_catalog.pg_get_indexdef(i.indexrelid) as def
      from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indexrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'events_identitaet%'
     order by c.relname
  loop
    raise notice '[eventsIdentitaet] %', r.def;
  end loop;
end $$;

/* ═══════════════════════════════════════════════════════
   1 — Die vier Indizes gibt es
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  select pg_catalog.count(*) into v_anzahl
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'events_identitaet%';

  assert v_anzahl = 4,
    pg_catalog.format('1: vier Identitaets-Indizes erwartet (sind: %s)', v_anzahl);
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Eine OFFENE Zeile blockiert die zweite
   ═══════════════════════════════════════════════════════

   Das ist die Haelfte, die Dubletten verhindert. Ohne sie legte jeder
   Engine-Lauf eine neue Zeile an. */
do $$
declare v_abgewiesen boolean := false;
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values (test.id('user_a'), test.id('standort_si'),
          'probe.identitaet', 'profile', 30, 'Erste', 'x');

  begin
    insert into public.events (user_id, location_id, type, category, priority, title, summary)
    values (test.id('user_a'), test.id('standort_si'),
            'probe.identitaet', 'profile', 30, 'Zweite', 'x');
  exception when unique_violation then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    '2: eine zweite OFFENE Zeile derselben Identitaet muss abgewiesen werden';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Eine AUFGELOESTE Zeile blockiert NICHT
   ═══════════════════════════════════════════════════════

   Das ist die Haelfte, an der CI am 14.10.2026 scheiterte. Dasselbe
   Problem kann im Maerz und im Juni auftreten; die Historie bleibt
   erhalten, und die neue Zeile muss trotzdem entstehen duerfen. */
do $$
declare v_fehler text;
begin
  update public.events set lifecycle = 'resolved', resolved_at = pg_catalog.now()
   where type = 'probe.identitaet';

  begin
    insert into public.events (user_id, location_id, type, category, priority, title, summary)
    values (test.id('user_a'), test.id('standort_si'),
            'probe.identitaet', 'profile', 30, 'Nach dem Aufloesen', 'x');
  exception when unique_violation then
    v_fehler := pg_catalog.format(
      'Der Index deckt mehr ab als die Suche in sync_events. '
      'Eine aufgeloeste Zeile blockiert die neue, und sync_events '
      'findet sie nicht, weil es nur offene Zeilen ansieht. '
      'Indexdefinition siehe NOTICE in Abschnitt 0.');
  end;

  assert v_fehler is null, '3: ' || v_fehler;

  assert (select pg_catalog.count(*) from public.events
           where type = 'probe.identitaet') = 2,
    '3: die aufgeloeste Zeile bleibt als Historie erhalten';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Dasselbe ueber sync_events, nicht von Hand
   ═══════════════════════════════════════════════════════

   Abschnitt 3 prueft den Index. Dieser hier prueft, dass sync_events
   die offene Zeile wirklich FINDET und aktualisiert, statt sie neu
   anzulegen — der Pfad, auf dem die beiden Tests gescheitert sind. */
do $$
declare v jsonb;
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values (test.id('user_a'), test.id('standort_si'),
          'probe.upsert', 'connection', 95, 'Bestand', 'x');

  v := public.sync_events(
    test.id('user_a'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type', 'probe.upsert', 'category', 'connection', 'priority', 95,
      'title', 'Neu', 'summary', 'x', 'ruleId', 'probe.upsert')),
    'test-identitaet',
    test.id('standort_si'));

  assert (v ->> 'updated')::int = 1,
    pg_catalog.format('4: die offene Zeile wird aktualisiert (updated: %s)',
                      v ->> 'updated');
  assert (v ->> 'created')::int = 0,
    pg_catalog.format('4: und nicht neu angelegt (created: %s)', v ->> 'created');

  assert (select title from public.events where type = 'probe.upsert') = 'Neu',
    '4: mit dem neuen Titel';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Und nach dem Aufloesen legt sync_events neu an
   ═══════════════════════════════════════════════════════

   Die Kette, auf die sich openingHours und recommendationClass
   verlassen: auswerten, aufloesen, erneut auswerten. */
do $$
declare v jsonb;
begin
  update public.events set lifecycle = 'resolved', resolved_at = pg_catalog.now()
   where type = 'probe.upsert';

  v := public.sync_events(
    test.id('user_a'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type', 'probe.upsert', 'category', 'connection', 'priority', 95,
      'title', 'Wieder da', 'summary', 'x', 'ruleId', 'probe.upsert')),
    'test-identitaet',
    test.id('standort_si'));

  assert (v ->> 'created')::int = 1,
    pg_catalog.format('5: nach dem Aufloesen entsteht eine neue Zeile (created: %s)',
                      v ->> 'created');

  assert (select pg_catalog.count(*) from public.events
           where type = 'probe.upsert') = 2,
    '5: und die alte bleibt als Historie stehen';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
