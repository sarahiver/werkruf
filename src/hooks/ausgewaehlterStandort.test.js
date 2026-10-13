/*
 * Welcher Standort gilt? (Paket H1, §48)
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRUEFT WIRD
 * ═══════════════════════════════════════════════════════════════
 *
 * waehle() entscheidet, welchen Betrieb WERKRUF laut Kunde verwaltet.
 * Nur eine ausdrueckliche Bestaetigung zaehlt (selected_at) — auch
 * beim einzigen Standort.
 *
 * Das ist bewusst strenger als werkruf_score_location (SQL), das bei
 * genau einem Standort diesen nimmt. Begruendung im Kopf von
 * useAusgewaehlterStandort.js. Ein QR-Code wird gedruckt und auf
 * Rechnungen geklebt; dafuer will man die Bestaetigung.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM waehle() UND NICHT DER HOOK GETESTET WIRD
 * ═══════════════════════════════════════════════════════════════
 *
 * Der Hook ist React plus Datenbankclient. Beides zu mocken wuerde
 * am Ende meinen Mock pruefen. waehle() ist die Entscheidung, und
 * die ist eine reine Funktion — absichtlich getrennt exportiert.
 *
 * Dass die SEITE den Hook benutzt und nicht mehr
 * profile.google_place_id, prueft kundenGewinnungPlaceId.test.js.
 */

/* Der Modulimport zieht den Supabase-Client mit, und der verlangt
   REACT_APP_SUPABASE_URL. Hausmuster im Repo (usePlacesAnalysis.test.js:5,
   postAuthDestination.test.js:4): den Client mocken. waehle() selbst
   braucht ihn nicht — es ist eine reine Funktion. */
jest.mock('../supabaseClient', () => ({ __esModule: true, default: { from: jest.fn() } }));

import { waehle } from './useAusgewaehlterStandort';

const A = { id: 'loc-a', place_id: 'ChIJ_aaa', title: 'Sanitaer Mueller', selected_at: null };
const B = { id: 'loc-b', place_id: 'ChIJ_bbb', title: 'Mueller Heizung', selected_at: null };
const C = { id: 'loc-c', place_id: 'ChIJ_ccc', title: 'Mueller Bad',     selected_at: null };

describe('waehle — nur ein bestaetigter Standort gilt', () => {

  it('gibt ohne Auswahl NICHTS zurueck, auch beim einzigen Standort', () => {
    /* Mein erster Entwurf gab hier den einzigen Standort zurueck —
       wie werkruf_score_location (SQL). Zwei bestehende Tests haben
       das widerlegt: googleBusinessHealthFlow.test.js:112 und
       useBetriebsname.test.js:124 schreiben die strenge Regel fest.

       Und die Annahme dahinter war falsch: ein Kunde mit einem
       Standort KANN auswaehlen — DashboardGoogleBusiness.js:355
       rendert den Knopf auch fuer den einzigen. Er haengt nicht
       fest, er muss einmal klicken.

       anzahl bleibt dabei erhalten, damit die Seite "bestaetige
       deinen Betrieb" sagen kann statt "kein Betrieb". */
    const { standort, grund, anzahl } = waehle([A]);
    expect(standort).toBeNull();
    expect(grund).toBe('ohne_auswahl');
    expect(anzahl).toBe(1);
  });

  it('gibt bei mehreren ohne Auswahl NICHTS zurueck', () => {
    const { standort, grund, anzahl } = waehle([A, B]);
    expect(standort).toBeNull();
    expect(grund).toBe('ohne_auswahl');
    expect(anzahl).toBe(2);
  });

  it('gibt bei mehreren den ausgewaehlten', () => {
    const gewaehlt = { ...B, selected_at: '2026-10-13T08:00:00Z' };
    const { standort, grund } = waehle([A, gewaehlt, C]);
    expect(standort).toBe(gewaehlt);
    expect(grund).toBe('ausgewaehlt');
  });

  it('nimmt bei mehreren Ausgewaehlten den neuesten', () => {
    /* Der Unique-Index google_locations_one_selected_per_user laesst
       das nicht zu. Die Sortierung ist die Absicherung dagegen, dass
       der Index jemals verschwindet — und SQL macht es genauso
       (order by selected_at desc limit 1). */
    const alt  = { ...A, selected_at: '2026-10-01T00:00:00Z' };
    const neu  = { ...B, selected_at: '2026-10-13T00:00:00Z' };
    expect(waehle([alt, neu]).standort).toBe(neu);
    expect(waehle([neu, alt]).standort).toBe(neu);
  });

  it('gibt ohne Standorte nichts zurueck', () => {
    const { standort, grund, anzahl } = waehle([]);
    expect(standort).toBeNull();
    expect(grund).toBe('keine');
    expect(anzahl).toBe(0);
  });

  it('vertraegt null und Unsinn statt einer Liste', () => {
    /* Fail closed: kein geratener Standort. */
    expect(waehle(null).standort).toBeNull();
    expect(waehle(undefined).standort).toBeNull();
    expect(waehle('kaputt').standort).toBeNull();
  });

  it('gibt einen bestaetigten Standort auch ohne place_id zurueck', () => {
    /* Die Auswahl und die Frage "hat er eine Google-Kennung" sind
       zwei Dinge. Ein bestaetigter Standort ohne place_id ist
       ausgewaehlt — nur der Bewertungslink geht nicht, und das muss
       die Seite unterscheiden koennen. */
    const ohne = { id: 'loc-x', place_id: null, title: 'Neu', selected_at: '2026-10-13Z' };
    const { standort, grund } = waehle([ohne]);
    expect(standort).toBe(ohne);
    expect(grund).toBe('ausgewaehlt');
    expect(standort.place_id).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════
   DIE SQL-ENTSPRECHUNG, SCHWARZ AUF WEISS
   ═══════════════════════════════════════════════════════

   Haelt die drei Zweige der SQL-Funktion als Tabelle fest. Wer die
   SQL-Regel aendert, soll hier sehen, was er mitaendern muss — und
   umgekehrt. */

describe('Unterschied zur SQL-Regel, festgehalten', () => {
  /* Bewusst anders als werkruf_score_location: dort gilt bei genau
     einem Standort dieser, hier nicht. Die Tabelle haelt beide
     Antworten nebeneinander, damit niemand den Unterschied fuer ein
     Versehen haelt und "aufraeumt". */
  const faelle = [
    { was: '1 Standort, nicht bestaetigt (SQL: loc-a)',  liste: [A],                                          erwartet: null },
    { was: '1 Standort, bestaetigt',                     liste: [{ ...A, selected_at: '2026-10-13Z' }],       erwartet: 'loc-a' },
    { was: '3 Standorte, einer bestaetigt',              liste: [A, { ...B, selected_at: '2026-10-13Z' }, C], erwartet: 'loc-b' },
    { was: '2 Standorte, keiner bestaetigt',             liste: [A, B],                                       erwartet: null },
    { was: 'keine Standorte',                            liste: [],                                           erwartet: null },
  ];

  test.each(faelle)('$was → $erwartet', ({ liste, erwartet }) => {
    expect(waehle(liste).standort?.id ?? null).toBe(erwartet);
  });
});
