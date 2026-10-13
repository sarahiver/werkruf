-- Abnahme fuer die automatische Auswahl bei genau einem Betrieb
-- (Paket H1, P0 #5).
--
--   psql -f autoAuswahl.test.sql
--
-- Setzt 20261013110000_auto_auswahl_einzelstandort.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS HIER GEPRUEFT WIRD — UND IN BEIDE RICHTUNGEN
-- ═══════════════════════════════════════════════════════════════
--
-- Eine Automatik, die zu wenig tut, laesst den Fremdkunden haengen.
-- Eine, die zu viel tut, waehlt ihm einen Betrieb aus, den er nie
-- bestaetigt hat — und sein gedruckter QR-Code zeigt auf den
-- falschen. Deshalb steht zu jeder Zusage hier die Gegenprobe:
--
--   waehlt aus        genau ein Standort, keine Auswahl
--   waehlt NICHT aus  zwei Standorte
--                     bestehende Auswahl
--                     kein aktives Google-Konto
--                     fremder Nutzer
--                     zweiter Aufruf
--
-- Geprueft wird die WIRKUNG (selected_at, Rueckgabewert,
-- werkruf_score_location), nicht der Wortlaut der Funktion.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════
   1 — GENAU EIN STANDORT, KEINE AUSWAHL → WIRD AUSGEWAEHLT
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_user   uuid;
  v_loc    uuid;
  v_erg    uuid;
  v_zeit   timestamptz;
  v_primaer boolean;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  v_loc := test.standort('standort_si', 'user_a', 'konto_a', null, false);

  /* Ausgangslage festhalten: ohne das prueft der Test seine eigene
     Annahme nicht. */
  select selected_at into v_zeit from public.google_locations where id = v_loc;
  assert v_zeit is null, 'Ausgangslage: der Standort darf noch nicht ausgewaehlt sein';

  v_erg := public.auto_select_single_location(v_user);

  assert v_erg = v_loc,
    format('Der einzige Standort wird ausgewaehlt (erhalten: %s)', coalesce(v_erg::text, 'NULL'));

  select selected_at, is_primary into v_zeit, v_primaer
    from public.google_locations where id = v_loc;

  assert v_zeit is not null, 'selected_at ist gesetzt';
  assert v_primaer, 'is_primary ist gesetzt — select_google_location macht beides';

  /* Der eigentliche Zweck: die zwei Antworten auf "welcher Betrieb
     gilt?" stimmen jetzt ueberein. Vorher sagte SQL "dieser" und das
     Frontend "keiner". */
  assert public.werkruf_score_location(v_user) = v_loc,
    'werkruf_score_location nennt denselben Standort';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — ZWEITER AUFRUF AENDERT NICHTS
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_user  uuid := test.id('user_a');
  v_loc   uuid := test.id('standort_si');
  v_vorher timestamptz;
  v_nachher timestamptz;
  v_erg   uuid;
begin
  select selected_at into v_vorher from public.google_locations where id = v_loc;

  v_erg := public.auto_select_single_location(v_user);

  assert v_erg is null,
    'Bei bestehender Auswahl gibt die Funktion NULL zurueck, nicht die id';

  select selected_at into v_nachher from public.google_locations where id = v_loc;

  /* Kein neuer Zeitstempel: "ausgewaehlt seit" bleibt aussagekraeftig. */
  assert v_vorher = v_nachher,
    'Der Zeitpunkt der Auswahl bleibt unveraendert';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   3 — ZWEI STANDORTE: KEINE AUTOMATIK
   ═══════════════════════════════════════════════════════

   Die Gegenprobe. Hier entscheidet der Kunde, und zwar bewusst:
   ein Bewertungslink wird gedruckt. */
begin;

do $$
declare
  v_user uuid;
  v_erg  uuid;
  v_mit  integer;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  perform test.standort('standort_si',      'user_a', 'konto_a', null, false);
  perform test.standort('standort_werkruf', 'user_a', 'konto_a', null, false);

  v_erg := public.auto_select_single_location(v_user);

  assert v_erg is null, 'Bei zwei Standorten waehlt die Automatik nicht aus';

  select count(*) into v_mit
    from public.google_locations
   where user_id = v_user and deleted_at is null and selected_at is not null;

  assert v_mit = 0,
    format('Kein Standort darf ausgewaehlt sein (gefunden: %s)', v_mit);
end $$;

/* ═══════════════════════════════════════════════════════
   4 — BESTEHENDE AUSWAHL WIRD NIE UEBERSCHRIEBEN
   ═══════════════════════════════════════════════════════

   Zwei Standorte, einer bestaetigt. Selbst wenn der andere spaeter
   verschwindet und nur einer uebrig bleibt, darf die Automatik die
   Auswahl nicht verschieben. */
do $$
declare
  v_user uuid := test.id('user_a');
  v_wr   uuid := test.id('standort_werkruf');
  v_si   uuid := test.id('standort_si');
  v_erg  uuid;
  v_zeit timestamptz;
begin
  update public.google_locations
     set selected_at = now() - interval '5 days'
   where id = v_wr;

  select selected_at into v_zeit from public.google_locations where id = v_wr;

  v_erg := public.auto_select_single_location(v_user);

  assert v_erg is null, 'Mit bestehender Auswahl tut die Automatik nichts';

  assert (select selected_at from public.google_locations where id = v_wr) = v_zeit,
    'Die bestehende Auswahl bleibt unberuehrt';
  assert (select selected_at from public.google_locations where id = v_si) is null,
    'Der andere Standort wird nicht ausgewaehlt';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — EINE AUSWAHL AUF EINEM GELOESCHTEN STANDORT BLOCKIERT NICHT
   ═══════════════════════════════════════════════════════

   Der heikle Fall. Google nimmt einen Betrieb weg, uebrig bleibt
   genau einer — ohne Auswahl. Die alte Auswahl steht noch auf der
   geloeschten Zeile, ist fuer das Produkt aber unsichtbar: jede
   Abfrage und der Unique-Index filtern deleted_at is null.

   Wuerde die Automatik sie mitzaehlen, bliebe der Kunde dauerhaft
   ohne Betrieb — mit einer Auswahl, die er nirgends sieht und nicht
   aendern kann. */
do $$
declare
  v_user uuid := test.id('user_a');
  v_wr   uuid := test.id('standort_werkruf');
  v_si   uuid := test.id('standort_si');
  v_erg  uuid;
begin
  update public.google_locations set deleted_at = now() where id = v_wr;

  v_erg := public.auto_select_single_location(v_user);

  assert v_erg = v_si,
    format('Der verbliebene Standort wird ausgewaehlt (erhalten: %s)',
           coalesce(v_erg::text, 'NULL'));
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   6 — OHNE AKTIVES GOOGLE-KONTO KEINE AUSWAHL
   ═══════════════════════════════════════════════════════

   Nicht die Automatik prueft das, sondern select_google_location —
   und genau deshalb steht der Fall hier: Die Automatik darf die
   Eigentums- und Verbindungspruefung des bestehenden Wegs nicht
   umgehen. */
begin;

do $$
declare
  v_user uuid;
  v_loc  uuid;
  v_erg  uuid;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a', 'needs_reauth');
  v_loc := test.standort('standort_si', 'user_a', 'konto_a', null, false);

  v_erg := public.auto_select_single_location(v_user);

  assert v_erg is null,
    'Ohne aktives Konto waehlt die Automatik nicht aus';
  assert (select selected_at from public.google_locations where id = v_loc) is null,
    'Und setzt auch kein selected_at';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   7 — FREMDE NUTZER UND LEERE KONTEN
   ═══════════════════════════════════════════════════════ */
begin;

do $$
declare
  v_a    uuid;
  v_b    uuid;
  v_loc  uuid;
  v_erg  uuid;
begin
  v_a := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  v_loc := test.standort('standort_si', 'user_a', 'konto_a', null, false);

  v_b := test.fremder();

  /* Ein Nutzer ohne Standorte: nichts auszuwaehlen, und vor allem
     nicht der Standort eines anderen. */
  v_erg := public.auto_select_single_location(v_b);

  assert v_erg is null, 'Ohne eigene Standorte waehlt die Automatik nichts aus';
  assert (select selected_at from public.google_locations where id = v_loc) is null,
    'Der Standort des anderen Nutzers bleibt unberuehrt';

  /* Und NULL als Nutzer ist kein Freifahrtschein. */
  assert public.auto_select_single_location(null) is null,
    'Ohne Nutzer gibt die Funktion NULL zurueck';
  assert (select count(*) from public.google_locations
           where selected_at is not null) = 0,
    'Und waehlt dabei nichts aus';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   8 — RECHTE
   ═══════════════════════════════════════════════════════

   Die Funktion setzt eine Auswahl unter Umgehung von RLS. Sie gehoert
   dem Server, nicht dem Browser. */
begin;

do $$
declare
  v_oid oid;
begin
  select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'auto_select_single_location';

  assert v_oid is not null, 'auto_select_single_location existiert';

  assert pg_catalog.has_function_privilege('service_role', v_oid, 'execute'),
    'service_role darf sie ausfuehren';

  assert not pg_catalog.has_function_privilege('anon', v_oid, 'execute'),
    'anon darf sie NICHT ausfuehren';
  assert not pg_catalog.has_function_privilege('authenticated', v_oid, 'execute'),
    'authenticated darf sie NICHT ausfuehren';

  /* security definer mit festem search_path — sonst waere der
     Suchpfad des Aufrufers Teil der Logik. */
  assert (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid),
    'Die Funktion laeuft als security definer';
  /* proconfig haelt den Wert so, wie SET ihn gesehen hat: bei einem
     leeren search_path steht dort search_path="" — mit Anfuehrungs-
     zeichen. Ein Vergleich auf 'search_path=' findet das nicht (erst
     so herausgefunden, als dieser Test rot war). Geprueft wird
     deshalb der Schluessel, und dass kein Schema darin steht. */
  assert exists (
    select 1 from pg_catalog.pg_proc p, unnest(p.proconfig) as c
     where p.oid = v_oid
       and c like 'search_path=%'
       and c not like '%public%'
  ), 'search_path ist auf leer festgenagelt';
end $$;

rollback;
