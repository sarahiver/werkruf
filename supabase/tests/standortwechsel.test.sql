-- Abnahme fuer den Betriebswechsel (Paket H1, Befund aus P0 #5).
--
--   psql -f standortwechsel.test.sql
--
-- Setzt 20261013120000_standortwechsel_vereinheitlichen.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WORUM ES GEHT
-- ═══════════════════════════════════════════════════════════════
--
-- handleActionLinkPost und handleEinstieg setzten selected_at direkt,
-- ohne die bisherige Auswahl zurueckzusetzen. Bei mehreren Betrieben
-- ist das ein Verstoss gegen google_locations_one_selected_per_user —
-- und der Fehler wurde geschluckt. Der Wechsel scheiterte still, das
-- Dashboard zeigte danach den alten Betrieb.
--
-- Abschnitt 1 haelt den alten Fehler als Messung fest. Das ist der
-- wichtigste Teil dieser Datei: Ohne ihn liest sich der Rest wie eine
-- Umbaumassnahme ohne Anlass — und wer die alte Anweisung in einem
-- Jahr wieder hinschreibt, bekommt keinen Hinweis.
--
-- Danach:
--   2  der Wechsel wirkt und hinterlaesst GENAU EINE Auswahl
--   3  ohne aktives Konto wirkt er trotzdem (bewusst)
--   4  fremde und geloeschte Standorte: nein
--   5  zweiter Aufruf aendert den Zeitpunkt nicht
--   6  select_google_location verhaelt sich unveraendert
--   7  Rechte

\set ON_ERROR_STOP on

/* ═══════════════════════════════════════════════════════
   1 — DER ALTE FEHLER, GEMESSEN
   ═══════════════════════════════════════════════════════ */
begin;

do $$
declare
  v_code text;
begin
  perform test.basis();   -- zwei Standorte, standort_si ist ausgewaehlt

  assert (select count(*) from public.google_locations
           where user_id = test.id('user_a')
             and deleted_at is null and selected_at is not null) = 1,
    'Ausgangslage: genau eine Auswahl';

  /* Genau die Anweisung, die in beiden TS-Pfaden stand. */
  begin
    update public.google_locations
       set selected_at = pg_catalog.now()
     where id = test.id('standort_werkruf')
       and user_id = test.id('user_a');

    raise exception 'Das alte UPDATE lief durch — dann ist der Unique-Index weg, '
                    'und der stille Fehlschlag waere ein stiller Doppelzustand';
  exception
    when unique_violation then
      v_code := 'erwartet';
  end;

  assert v_code = 'erwartet', 'Das alte UPDATE scheitert mit 23505';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   2 — DER WECHSEL WIRKT
   ═══════════════════════════════════════════════════════ */
begin;

do $$
declare
  v_user uuid;
  v_si   uuid := test.id('standort_si');
  v_wr   uuid := test.id('standort_werkruf');
  v_erg  boolean;
begin
  perform test.basis();
  v_user := test.id('user_a');

  v_erg := public.activate_google_location(v_wr, v_user);

  assert v_erg, 'Der Wechsel meldet Erfolg';

  assert (select selected_at from public.google_locations where id = v_wr) is not null,
    'Der neue Betrieb ist ausgewaehlt';
  assert (select selected_at from public.google_locations where id = v_si) is null,
    'Der alte Betrieb ist es nicht mehr';

  /* Der Punkt, an dem es vorher scheiterte. */
  assert (select count(*) from public.google_locations
           where user_id = v_user and deleted_at is null and selected_at is not null) = 1,
    'Genau eine Auswahl, nicht zwei und nicht keine';

  /* is_primary laeuft mit — getActiveConnection und das Dashboard
     richten sich danach. */
  assert (select is_primary from public.google_locations where id = v_wr),
    'Der neue Betrieb ist auch Hauptstandort';
  assert not (select is_primary from public.google_locations where id = v_si),
    'Der alte ist es nicht mehr';

  /* Und der Score zeigt jetzt auf denselben Betrieb. */
  assert public.werkruf_score_location(v_user) = v_wr,
    'werkruf_score_location folgt dem Wechsel';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — ZWEITER AUFRUF AENDERT DEN ZEITPUNKT NICHT
   ═══════════════════════════════════════════════════════

   "Ausgewaehlt seit" soll etwas bedeuten. Ein Mail-Link, zweimal
   geklickt, darf den Zeitpunkt nicht verschieben. */
do $$
declare
  v_wr     uuid := test.id('standort_werkruf');
  v_vorher timestamptz;
begin
  select selected_at into v_vorher from public.google_locations where id = v_wr;

  assert public.activate_google_location(v_wr, test.id('user_a')),
    'Derselbe Betrieb nochmal: meldet Erfolg';

  assert (select selected_at from public.google_locations where id = v_wr) = v_vorher,
    'Der Zeitpunkt bleibt';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   3 — OHNE AKTIVES KONTO: DER UNTERSCHIED DER ZWEI EINGAENGE
   ═══════════════════════════════════════════════════════

   Der Grund, warum es zwei Eingaenge gibt und nicht einen. Haette
   man die Mail-Pfade einfach auf select_google_location umgestellt,
   waere aus einem Fehler ein zweiter geworden: Ein Kunde mit
   abgerissener Verbindung landet beim falschen Betrieb. */
begin;

do $$
declare
  v_user uuid;
  v_si   uuid := test.id('standort_si');
  v_wr   uuid := test.id('standort_werkruf');
begin
  perform test.basis();
  v_user := test.id('user_a');

  update public.google_accounts set status = 'needs_reauth'
   where id = test.id('konto_a');

  /* Dashboard-Weg: nein. Unveraendert — wer auswaehlen will, braucht
     eine stehende Verbindung. */
  assert not public.select_google_location(v_wr, v_user),
    'select_google_location verweigert ohne aktives Konto';
  assert (select selected_at from public.google_locations where id = v_wr) is null,
    'und setzt nichts';

  /* Mail-Weg: ja. Der Link zeigt auf einen bestimmten Betrieb, und
     den soll der Kunde dann auch sehen — mitsamt dem Hinweis, dass
     die Verbindung erneuert werden muss. */
  assert public.activate_google_location(v_wr, v_user),
    'activate_google_location stellt trotzdem um';
  assert (select selected_at from public.google_locations where id = v_wr) is not null,
    'und setzt den neuen Betrieb';
  assert (select selected_at from public.google_locations where id = v_si) is null,
    'und raeumt den alten ab';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   4 — FREMDE UND GELOESCHTE STANDORTE
   ═══════════════════════════════════════════════════════ */
begin;

do $$
declare
  v_a  uuid;
  v_b  uuid;
  v_si uuid := test.id('standort_si');
  v_wr uuid := test.id('standort_werkruf');
begin
  perform test.basis();
  v_a := test.id('user_a');
  v_b := test.fremder();

  /* Fremder Nutzer, fremder Standort. */
  assert not public.activate_google_location(v_si, v_b),
    'Ein anderer Nutzer kann den Standort nicht uebernehmen';
  assert (select user_id from public.google_locations where id = v_si) = v_a,
    'Der Standort gehoert weiter user_a';

  /* Und die Auswahl von user_a ist unberuehrt — ein fehlgeschlagener
     Aufruf darf nicht trotzdem zurueckgesetzt haben. Genau das waere
     passiert, wenn die Eigentumspruefung NACH dem Zuruecksetzen
     kaeme. */
  assert (select selected_at from public.google_locations where id = v_si) is not null,
    'Die bestehende Auswahl von user_a bleibt';

  /* Geloescht: nein. */
  update public.google_locations set deleted_at = pg_catalog.now() where id = v_wr;

  assert not public.activate_google_location(v_wr, v_a),
    'Ein geloeschter Standort wird nicht ausgewaehlt';
  assert (select selected_at from public.google_locations where id = v_wr) is null,
    'und bekommt kein selected_at';
  assert (select selected_at from public.google_locations where id = v_si) is not null,
    'die bestehende Auswahl bleibt auch hier';

  /* NULL als Eingabe ist kein Freifahrtschein. */
  assert not public.activate_google_location(null, v_a), 'NULL als Standort: false';
  assert not public.activate_google_location(v_si, null), 'NULL als Nutzer: false';
  assert (select selected_at from public.google_locations where id = v_si) is not null,
    'und nichts davon raeumt die Auswahl ab';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   6 — select_google_location VERHAELT SICH UNVERAENDERT
   ═══════════════════════════════════════════════════════

   Die Regressionspruefung zum Umbau: Der Rumpf delegiert jetzt, die
   Funktion ist aber dieselbe wie vorher. Sie wird aus dem Dashboard
   gerufen (google-business/index.ts, handleLocationSelect) und von
   auto_select_single_location. */
begin;

do $$
declare
  v_user uuid;
  v_si   uuid := test.id('standort_si');
  v_wr   uuid := test.id('standort_werkruf');
  v_b    uuid;
begin
  perform test.basis();
  v_user := test.id('user_a');

  /* Wechsel bei aktivem Konto: ja, und genau eine Auswahl. */
  assert public.select_google_location(v_wr, v_user), 'Wechsel bei aktivem Konto';
  assert (select count(*) from public.google_locations
           where user_id = v_user and deleted_at is null and selected_at is not null) = 1,
    'Genau eine Auswahl';
  assert (select selected_at from public.google_locations where id = v_wr) is not null,
    'der gewaehlte ist gesetzt';

  /* Fremd: nein. */
  v_b := test.fremder();
  assert not public.select_google_location(v_si, v_b), 'Fremder Nutzer: false';

  /* Geloescht: nein. */
  update public.google_locations set deleted_at = pg_catalog.now() where id = v_si;
  assert not public.select_google_location(v_si, v_user), 'Geloeschter Standort: false';

  /* Und die Automatik laeuft weiter darueber. */
  assert public.auto_select_single_location(v_user) is null,
    'Mit bestehender Auswahl tut die Automatik nichts';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   7 — RECHTE
   ═══════════════════════════════════════════════════════

   Alle drei umgehen RLS. Sie gehoeren dem Server. */
begin;

do $$
declare
  v_name text;
  v_oid  oid;
begin
  foreach v_name in array array[
    'apply_google_location_selection',
    'select_google_location',
    'activate_google_location'
  ] loop
    select p.oid into v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;

    assert v_oid is not null, format('%s existiert', v_name);

    assert pg_catalog.has_function_privilege('service_role', v_oid, 'execute'),
      format('service_role darf %s ausfuehren', v_name);
    assert not pg_catalog.has_function_privilege('anon', v_oid, 'execute'),
      format('anon darf %s NICHT ausfuehren', v_name);
    assert not pg_catalog.has_function_privilege('authenticated', v_oid, 'execute'),
      format('authenticated darf %s NICHT ausfuehren', v_name);

    assert (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid),
      format('%s laeuft als security definer', v_name);

    /* Fester, leerer search_path — sonst waere der Suchpfad des
       Aufrufers Teil der Logik. proconfig haelt ihn als
       search_path="" (mit Anfuehrungszeichen). */
    assert exists (
      select 1 from pg_catalog.pg_proc p, unnest(p.proconfig) as c
       where p.oid = v_oid and c like 'search_path=%' and c not like '%public%'
    ), format('%s hat search_path festgenagelt', v_name);
  end loop;
end $$;

rollback;
