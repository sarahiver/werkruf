-- docs/operations/loeschung-probe.sql
--
-- Was genau blockiert die Kontolöschung?
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT — BITTE LESEN
-- ═══════════════════════════════════════════════════════════════
--
-- Diese Abfrage FÜHRT das Löschen aus — und macht es im selben
-- Atemzug rückgängig. Am Ende steht immer ein `raise exception`,
-- und das rollt den gesamten DO-Block zurück. PostgreSQL kennt
-- dabei kein Teilweise: Entweder die ganze Anweisung gilt, oder
-- keine Zeile davon. Weil die Anweisung garantiert mit einer
-- Ausnahme endet, gilt immer: keine Zeile.
--
-- Nach dem Lauf ist die Datenbank unverändert. Das ist keine
-- Zusicherung, sondern wie Transaktionen funktionieren.
--
-- Das Ergebnis erscheint als ROTE FEHLERMELDUNG. Das ist der
-- Normalfall und das eigentliche Ergebnis — nicht der Beleg, dass
-- etwas schiefging. Die Meldung herschicken.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESER UMWEG
-- ═══════════════════════════════════════════════════════════════
--
-- Das Supabase-Dashboard zeigt nur "Database error deleting user".
-- Dahinter steht ein konkreter PostgreSQL-Fehler mit Tabelle,
-- Bedingung und Auslöser. Genau den holt dieser Block heraus:
-- message_text, SQLSTATE, DETAIL und vor allem KONTEXT — letzterer
-- nennt die Anweisung, die tatsächlich gescheitert ist, und damit
-- den Trigger oder die Kaskadenstufe.
--
-- Am 19.10.2026 war die erste Ursache leads_status_check: Der
-- Trigger anonymise_user_on_delete() schrieb status='deleted', ein
-- Wert, den die Bedingung nicht kannte. Nach der Migration
-- 20261019120000 blieb die Meldung gleich — es liegt also noch
-- mindestens eine zweite Ursache darunter. Diese Probe nennt sie.

do $$
declare
  v_id      uuid;
  v_msg     text;
  v_detail  text;
  v_hint    text;
  v_state   text;
  v_context text;
  v_befund  text;
begin
  select id into v_id
    from auth.users
   where lower(email) = 'ivergentz@gmail.com';

  if v_id is null then
    raise exception 'PROBE: Nutzer ivergentz@gmail.com existiert nicht (mehr).';
  end if;

  begin
    delete from auth.users where id = v_id;
    v_befund := 'LOESCHEN WUERDE GELINGEN. Kein Hindernis mehr. '
             || '(Trotzdem zurueckgerollt — es ist eine Probe.)';
  exception when others then
    get stacked diagnostics
      v_msg     = message_text,
      v_detail  = pg_exception_detail,
      v_hint    = pg_exception_hint,
      v_state   = returned_sqlstate,
      v_context = pg_exception_context;

    v_befund := 'BLOCKIERT'
      || E'\n  FEHLER   : ' || coalesce(v_msg,     '-')
      || E'\n  SQLSTATE : ' || coalesce(v_state,   '-')
      || E'\n  DETAIL   : ' || coalesce(v_detail,  '-')
      || E'\n  HINWEIS  : ' || coalesce(v_hint,    '-')
      || E'\n  KONTEXT  : ' || coalesce(v_context, '-');
  end;

  /* Diese Ausnahme ist der Zweck, nicht der Unfall: Sie rollt alles
     zurueck UND transportiert den Befund nach oben, wo der Editor
     ihn anzeigt. raise notice waere hier falsch — die Notice-Ausgabe
     zeigt das Supabase-Dashboard nicht zuverlaessig an. */
  raise exception E'\n═══ BEFUND ═══\n%\n═══ NICHTS VERAENDERT ═══', v_befund;
end $$;
