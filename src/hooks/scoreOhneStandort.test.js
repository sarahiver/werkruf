/**
 * Der WERKRUF Score ohne Betrieb (Paket H1, P0 #5).
 *
 * ═══════════════════════════════════════════════════════════════
 * DER BEFUND
 * ═══════════════════════════════════════════════════════════════
 *
 * useHealthScore kannte drei Lagen: ein Standort, mehrere mit
 * Auswahl, mehrere ohne. Die vierte — KEIN Standort — fiel durch:
 *
 *   location = null                 (kein Standort auswaehlbar)
 *   die Sperre greift nicht         (sie verlangt alle.length > 1)
 *   fuenf leere Faktoren            → 0 von 100
 *   level 'weak'                    → "Dein Profil laesst Anfragen
 *                                      liegen"
 *
 * Also stand auf dem Dashboard eines Betriebs, der WERKRUF gerade
 * verbunden hatte: 0/100 und ein Vorwurf. Genau der Zustand, den ein
 * Fremdkunde am ersten Tag sieht.
 *
 * Die SQL-Seite macht es laengst richtig
 * (compute_location_health_score: score null, grund
 * 'kein_standort'). Dieser Test haelt die JS-Seite daran fest.
 *
 * ═══════════════════════════════════════════════════════════════
 * IN BEIDE RICHTUNGEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Zu wenig: der alte Fehler, 0 von 100 fuer ein leeres Konto.
 * Zu viel:  wenn die neue Sperre auch dann greift, wo es sehr wohl
 *           einen Standort gibt — dann verschwindet der Score fuer
 *           alle. Deshalb stehen beide Faelle hier.
 */
import { renderHook } from '@testing-library/react';

import { useHealthScore } from './useHealthScore';

const standort = (id, gewaehlt = false) => ({
  id, title: id.toUpperCase(),
  selected_at: gewaehlt ? '2026-10-13T08:00:00Z' : null,
  primary_phone: '+49 40 1',
  website_uri: 'https://x.example',
  locality: 'Hamburg',
  primary_category: 'gcid:plumber',
  google_media: [],
});

/* Genau die Werte, die useGoogleBusinessData ohne Standort liefert:
   der Zweig ohne ausgewaehlten Betrieb setzt leere Listen, und daraus
   entsteht dieses stats-Objekt. Kein erfundener Vorspann — das ist
   die Lage, in der der Fehler auftrat. */
const statsOhneBetrieb = {
  totalReviews: 0, averageRating: null, unanswered: 0,
  distribution: {}, newestReviewAt: null, photoCount: 0,
};

const rechne = (props) => renderHook(() => useHealthScore({
  stats: statsOhneBetrieb, replyCounts: {}, loading: false, ...props,
})).result.current;

describe('Kein Standort', () => {

  it('gibt keinen Score statt einer 0', () => {
    const e = rechne({ locations: [] });

    expect(e.score).toBeNull();
    /* Ausdruecklich auch nicht 0 — das war der Fehler. */
    expect(e.score).not.toBe(0);
  });

  it('nennt den Zustand eigens, nicht als „kein Betrieb ausgewählt"', () => {
    /* Zwei verschiedene Lagen: "waehle einen aus" ist falsch, wenn es
       keinen gibt, aus dem man waehlen koennte. */
    const e = rechne({ locations: [] });

    expect(e.level).toBe('keine_betriebe');
    expect(e.level).not.toBe('kein_standort');
  });

  it('macht dem Kunden keinen Vorwurf', () => {
    const e = rechne({ locations: [] });

    expect(e.headline).not.toMatch(/liegen|Anfragen|schlecht/i);
    expect(e.summary).toMatch(/Google/);
  });

  it('nennt keinen Betrieb, auf den sich nichts bezieht', () => {
    const e = rechne({ locations: [] });

    expect(e.locationId).toBeNull();
    expect(e.locationTitle).toBeNull();
  });

  it('zeigt keine Faktoren mit null Punkten', () => {
    /* Fuenf Zeilen mit 0 von x sind die 0 in Einzelteilen. */
    const e = rechne({ locations: [] });

    expect(e.factors).toEqual([]);
  });

  it('vertraegt null und undefined als Liste', () => {
    expect(rechne({ locations: null }).level).toBe('keine_betriebe');
    expect(rechne({ locations: undefined }).level).toBe('keine_betriebe');
  });
});

describe('Die Sperre greift nicht zu weit', () => {

  it('rechnet bei genau einem Standort weiter', () => {
    /* Gegenprobe. Nach der automatischen Auswahl (Migration
       20261013110000) ist das der Normalfall jedes neuen Kunden —
       haette die neue Sperre hier zugeschlagen, waere der Score fuer
       alle verschwunden. */
    const e = rechne({
      locations: [standort('a', true)],
      stats: { ...statsOhneBetrieb, totalReviews: 4, averageRating: 5, photoCount: 5,
               newestReviewAt: new Date().toISOString() },
    });

    expect(e.level).not.toBe('keine_betriebe');
    expect(e.score).toBeGreaterThan(0);
    expect(e.locationId).toBe('a');
  });

  it('rechnet auch bei einem unbestaetigten Standort weiter', () => {
    /* Die Score-Regel nimmt bei genau einem Standort diesen, auch
       ohne selected_at — wie werkruf_score_location. Das bleibt so;
       hier wird nur geprueft, dass die neue Sperre das nicht
       mitgenommen hat. */
    const e = rechne({ locations: [standort('a', false)] });

    expect(e.level).not.toBe('keine_betriebe');
    expect(e.locationId).toBe('a');
  });

  it('bleibt bei mehreren ohne Auswahl beim bisherigen Zustand', () => {
    const e = rechne({ locations: [standort('a'), standort('b')] });

    expect(e.score).toBeNull();
    expect(e.level).toBe('kein_standort');
    expect(e.summary).toMatch(/Wähle einen Betrieb/);
  });

  it('unterscheidet Laden von „kein Betrieb"', () => {
    /* Waehrend die Daten unterwegs sind, ist beides unbekannt. Ein
       aufblitzendes "Noch kein Betrieb verbunden" waere eine Diagnose
       ueber einen Zustand, den wir noch nicht kennen. */
    const e = rechne({ locations: [], loading: true });

    expect(e.level).toBe('loading');
  });
});
