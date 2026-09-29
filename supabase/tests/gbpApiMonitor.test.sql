-- Abnahme fuer das API-Monitoring (Paket 3).
--
-- Laeuft gegen einen echten Postgres, nicht gegen eine Nachbildung.
--
--   psql -f gbpApiMonitor.test.sql
--
-- Setzt voraus, dass 20260929160000_gbp_api_monitor.sql eingespielt ist
-- und die Rollen anon, authenticated, service_role existieren.
-- Bricht beim ersten fehlgeschlagenen assert ab.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════
   1 — Erster Lauf legt die Ausgangsbasis an, OHNE Alarm
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.gbp_monitor_record_success(
         'testquelle', 'schema', 'https://example.invalid/disc',
         '20260101', 'summe-a', '{"ressourcen":{},"schemata":{}}'::jsonb);

  assert v ->> 'ergebnis' = 'basis',
    'Der erste Lauf muss die Ausgangsbasis anlegen';
  assert (v ->> 'gemeldet')::boolean = false,
    'Der erste Lauf darf keine Meldung ausloesen';
  assert (select count(*) from public.gbp_api_changes where quelle = 'testquelle') = 0,
    'Der erste Lauf darf keinen Historieneintrag erzeugen';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Unveraenderte Pruefsumme meldet nichts
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.gbp_monitor_record_success(
         'testquelle', 'schema', 'https://example.invalid/disc',
         '20260101', 'summe-a', '{"ressourcen":{},"schemata":{}}'::jsonb);

  assert v ->> 'ergebnis' = 'unveraendert', 'Gleiche Pruefsumme = unveraendert';
  assert (select count(*) from public.gbp_api_changes where quelle = 'testquelle') = 0,
    'Unveraendert darf keinen Historieneintrag erzeugen';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Aenderung wird erkannt und eingetragen
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.gbp_monitor_record_success(
         'testquelle', 'schema', 'https://example.invalid/disc',
         '20260201', 'summe-b', '{"ressourcen":{"a.get":{}},"schemata":{}}'::jsonb,
         'signatur-1', 'kritisch',
         '[{"art":"methode.entfernt","pfad":"a.list"}]'::jsonb);

  assert v ->> 'ergebnis' = 'geaendert', 'Andere Pruefsumme = geaendert';
  assert (select stufe from public.gbp_api_changes where signatur = 'signatur-1') = 'kritisch',
    'Die Stufe muss uebernommen werden';
  assert (select alte_revision from public.gbp_api_changes where signatur = 'signatur-1') = '20260101',
    'Die alte Revision muss festgehalten werden';
  assert (select revision from public.gbp_api_snapshots where quelle = 'testquelle') = '20260201',
    'Der Snapshot muss fortgeschrieben werden';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Dieselbe Signatur meldet NICHT erneut
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  -- Erneuter Lauf, andere Pruefsumme, aber dieselbe Signatur.
  v := public.gbp_monitor_record_success(
         'testquelle', 'schema', 'https://example.invalid/disc',
         '20260202', 'summe-c', '{"ressourcen":{"a.get":{}},"schemata":{}}'::jsonb,
         'signatur-1', 'kritisch',
         '[{"art":"methode.entfernt","pfad":"a.list"}]'::jsonb);

  assert v ->> 'ergebnis' = 'bekannt',
    'Dieselbe Signatur darf keinen zweiten Eintrag erzeugen';
  assert (select count(*) from public.gbp_api_changes where signatur = 'signatur-1') = 1,
    'Es darf genau ein Eintrag je Signatur bestehen';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Eine NEUE Aenderung meldet wieder
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.gbp_monitor_record_success(
         'testquelle', 'schema', 'https://example.invalid/disc',
         '20260301', 'summe-d', '{"ressourcen":{},"schemata":{}}'::jsonb,
         'signatur-2', 'handlungsbedarf',
         '[{"art":"feld.neu","pfad":"Location.neuesFeld"}]'::jsonb);

  assert v ->> 'ergebnis' = 'geaendert', 'Eine neue Signatur muss wieder melden';
  assert (select count(*) from public.gbp_api_changes where quelle = 'testquelle') = 2,
    'Jetzt zwei Eintraege';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Ausfall ueberschreibt den Snapshot NICHT
   ═══════════════════════════════════════════════════════ */
do $$
declare v_zaehler integer;
begin
  v_zaehler := public.gbp_monitor_record_failure(
                 'testquelle', 'schema', 'https://example.invalid/disc', 'HTTP 503');

  assert v_zaehler = 1, 'Erster Fehlversuch zaehlt 1';
  assert (select pruefsumme from public.gbp_api_snapshots where quelle = 'testquelle') = 'summe-d',
    'Der Ausfall darf die Pruefsumme NICHT ueberschreiben';
  assert (select revision from public.gbp_api_snapshots where quelle = 'testquelle') = '20260301',
    'Der Ausfall darf die Revision NICHT ueberschreiben';
  assert (select count(*) from public.gbp_api_changes where quelle = 'testquelle') = 2,
    'Ein Ausfall darf keine Aenderung melden';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Wiederholte Ausfaelle werden als Betriebsproblem sichtbar
   ═══════════════════════════════════════════════════════ */
do $$
begin
  perform public.gbp_monitor_record_failure('testquelle', 'schema', 'https://example.invalid/disc', 'HTTP 503');
  perform public.gbp_monitor_record_failure('testquelle', 'schema', 'https://example.invalid/disc', 'HTTP 503');

  assert (select fehlversuche from public.gbp_api_snapshots where quelle = 'testquelle') = 3,
    'Drei Fehlversuche';
  assert (select count(*) from public.gbp_monitor_failures(3)) = 1,
    'Ab drei Fehlversuchen als Betriebsproblem sichtbar';
  assert (select count(*) from public.gbp_monitor_failures(4)) = 0,
    'Unterhalb der Schwelle nicht';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Ein erfolgreicher Lauf setzt den Zaehler zurueck
   ═══════════════════════════════════════════════════════ */
do $$
begin
  perform public.gbp_monitor_record_success(
    'testquelle', 'schema', 'https://example.invalid/disc',
    '20260301', 'summe-d', '{"ressourcen":{},"schemata":{}}'::jsonb);

  assert (select fehlversuche from public.gbp_api_snapshots where quelle = 'testquelle') = 0,
    'Erfolg setzt den Fehlerzaehler zurueck';
  assert (select letzter_fehler from public.gbp_api_snapshots where quelle = 'testquelle') is null,
    'Und loescht die letzte Fehlermeldung';
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Ausfall einer nie erfolgreichen Quelle bleibt sichtbar
   ═══════════════════════════════════════════════════════ */
do $$
declare v_zaehler integer;
begin
  v_zaehler := public.gbp_monitor_record_failure(
                 'nie-erreichbar', 'schema', 'https://example.invalid/x', 'HTTP 404');

  assert v_zaehler = 1, 'Auch ohne vorherigen Snapshot wird gezaehlt';
  assert (select pruefsumme from public.gbp_api_snapshots where quelle = 'nie-erreichbar') = '',
    'Der Platzhalter traegt keine erfundene Pruefsumme';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Offene Meldungen und Quittierung
   ═══════════════════════════════════════════════════════ */
do $$
declare v_offen jsonb; v_ids uuid[]; v_anzahl integer;
begin
  v_offen := public.gbp_monitor_pending();
  assert jsonb_array_length(v_offen) = 2, 'Zwei offene Meldungen';

  -- Kritisch muss vor handlungsbedarf stehen.
  assert v_offen -> 0 ->> 'stufe' = 'kritisch',
    'Kritische Meldungen stehen oben';

  select array_agg((value ->> 'id')::uuid) into v_ids
    from jsonb_array_elements(v_offen);

  v_anzahl := public.gbp_monitor_mark_reported(v_ids);
  assert v_anzahl = 2, 'Beide quittiert';
  assert jsonb_array_length(public.gbp_monitor_pending()) = 0,
    'Danach keine offenen Meldungen mehr';

  -- Erneutes Quittieren zaehlt nicht doppelt.
  assert public.gbp_monitor_mark_reported(v_ids) = 0,
    'Bereits Quittiertes wird nicht erneut gezaehlt';
end $$;

/* ═══════════════════════════════════════════════════════
   11 — Getrennte Pruefwege haben getrennte Snapshots
   ═══════════════════════════════════════════════════════ */
do $$
begin
  perform public.gbp_monitor_record_success(
    'changelog', 'changelog', 'https://developers.google.com/my-business/content/change-log',
    null, 'cl-summe-a', '[{"datum":"September 25, 2026","inhalt":"Erster Eintrag"}]'::jsonb);

  assert (select art from public.gbp_api_snapshots where quelle = 'changelog') = 'changelog',
    'Der Change-Log-Weg fuehrt einen eigenen Snapshot';
  assert (select count(*) from public.gbp_api_snapshots) = 3,
    'Drei Quellen: testquelle, nie-erreichbar, changelog';
  assert (select revision from public.gbp_api_snapshots where quelle = 'changelog') is null,
    'Das Change Log hat keine Revision — das ist zulaessig';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
