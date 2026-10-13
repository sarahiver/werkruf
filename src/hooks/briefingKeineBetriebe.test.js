/**
 * Der Zustand des Dashboards ohne Betrieb (Paket H1, P0 #5).
 *
 * ═══════════════════════════════════════════════════════════════
 * DER BEFUND
 * ═══════════════════════════════════════════════════════════════
 *
 * useDashboardBriefing kannte fuenf Zustaende: loading, error, setup
 * (nicht verbunden), critical, warning — und sonst ok. Ein verbundenes
 * Konto ohne einen einzigen Betrieb fiel in den ok-Zweig:
 *
 *   "Alles im Griff — WERKRUF meldet sich, wenn sich etwas aendert."
 *
 * Gesagt ueber ein leeres Konto. Es wird sich nichts aendern.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DER ZUSTAND NICHT NUR AUS DER ENGINE KOMMT
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Engine hat seit H1 eine eigene Regel dafuer
 * (account.no_locations). Sie reicht hier aber nicht aus: Nach dem
 * Verbinden laeuft zuerst nur der Standort-Sync, und evaluateUser
 * haengt am Bewertungs-Sync — der ohne Betrieb nie laeuft. Bis zum
 * taeglichen Lauf gibt die Engine also keine Aufgabe her.
 *
 * Der Kunde sieht das Dashboard aber in der Minute danach. Deshalb
 * zwei Quellen fuer denselben Zustand, und deshalb dieser Test: er
 * haelt fest, dass der Hook es OHNE Engine-Ereignis erkennt.
 */
import { renderHook } from '@testing-library/react';

jest.mock('../supabaseClient', () => ({ __esModule: true, default: { from: jest.fn() } }));

jest.mock('../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => ({ profile: { plan: 'pro' }, user: { id: 'u1' } }),
}));

const mockVerbindung = jest.fn();
jest.mock('./useGoogleBusiness', () => ({
  __esModule: true,
  useGoogleBusiness: () => mockVerbindung(),
}));

const mockDaten = jest.fn();
jest.mock('./useGoogleBusinessData', () => ({
  __esModule: true,
  useGoogleBusinessData: () => mockDaten(),
}));

const mockEvents = jest.fn();
jest.mock('./useEvents', () => ({
  __esModule: true,
  useEvents: () => mockEvents(),
}));

const { useDashboardBriefing } = require('./useDashboardBriefing');

const STANDORT = {
  id: 'loc-a', title: 'Sanitaer Mueller', selected_at: '2026-10-13T08:00:00Z',
  primary_phone: '+49 40 1', website_uri: 'https://x.example',
  locality: 'Hamburg', primary_category: 'gcid:plumber', google_media: [],
};

const STATS_LEER = {
  totalReviews: 0, averageRating: null, unanswered: 0,
  distribution: {}, newestReviewAt: null, photoCount: 0,
};

/* Die Lage zusammensetzen: verbunden ja/nein, welche Standorte,
   welche Engine-Aufgaben. Alles andere sind Vorgabewerte, damit im
   Test nur dasteht, worum es geht. */
function lage({ verbunden = true, standorte = [], aufgaben = [], laedt = false,
                 importStatus = 'succeeded' } = {}) {
  mockVerbindung.mockReturnValue({
    isConnected: verbunden, brokenConnection: null, loading: false,
  });
  mockDaten.mockReturnValue({
    locations: standorte,
    stats: verbunden ? STATS_LEER : null,
    replyCounts: { draft: 0, approved: 0, published: 0, failed: 0 },
    lastSyncedAt: new Date().toISOString(),
    runningJob: null,
    /* Dieselbe Form wie useGoogleBusinessData sie liefert
       (useGoogleBusinessData.js:368). */
    locationImport: {
      job: importStatus === 'none' ? null : { id: 'imp' },
      status: importStatus,
      keineBetriebe: importStatus === 'succeeded' && standorte.length === 0,
    },
    loading: laedt, error: null,
    reload: jest.fn(), triggerSync: jest.fn(),
  });
  mockEvents.mockReturnValue({
    events: aufgaben,
    loading: false, error: null,
    /* Ohne Standort loest werkruf_score_location nichts auf. */
    locationResolved: standorte.length > 0,
    reload: jest.fn(), melde: jest.fn(), open: jest.fn(), dismiss: jest.fn(),
  });

  return renderHook(() => useDashboardBriefing()).result.current;
}

beforeEach(() => {
  mockVerbindung.mockReset();
  mockDaten.mockReset();
  mockEvents.mockReset();
});

describe('Verbunden, aber kein Betrieb', () => {

  it('sagt nicht „Alles im Griff"', () => {
    const b = lage({ verbunden: true, standorte: [] });

    expect(b.status.headline).not.toMatch(/Alles im Griff/);
    expect(b.status.level).toBe('keine_betriebe');
  });

  it('meldet den Zustand als eigenes Merkmal', () => {
    /* Damit die Oberflaeche ihn weiterreichen kann, ohne
       locations.length selbst zu deuten. */
    expect(lage({ standorte: [] }).ohneBetrieb).toBe('keine_gefunden');
  });

  it('nennt keinen Grund, den Google nicht liefert', () => {
    /* §32. Die API gibt eine leere Liste zurueck. */
    const b = lage({ standorte: [] });

    expect(b.status.detail).toMatch(/Verbindung zu Google steht/);
    expect(b.status.detail).not.toMatch(/weil|Google sagt|laut Google/i);
  });

  it('steht vor den Engine-Zustaenden', () => {
    /* Auch wenn die Engine ihre eigene kritische Aufgabe dazu
       geliefert hat, beschreibt die Statusleiste den Zustand — nicht
       "Eine Sache braucht dich", was ueber die Ursache nichts sagt.
       Die Aufgabe selbst steht darunter in der Liste. */
    const b = lage({
      standorte: [],
      aufgaben: [{ id: 'k1', type: 'account.no_locations', priority: 95 }],
    });

    expect(b.status.level).toBe('keine_betriebe');
    /* Die Aufgabe bleibt erhalten, sie wird nur nicht zum Zustand. */
    expect(b.actions).toHaveLength(1);
  });

  it('unterscheidet den laufenden Import von einem leeren Ergebnis', () => {
    /* Die Minute nach dem Verbinden. "Google hat nichts geliefert"
       waere da eine Diagnose ueber einen Lauf, der noch unterwegs
       ist — und dieselbe Unterscheidung trifft /dashboard/google
       schon. */
    const laufend = lage({ standorte: [], importStatus: 'running' });

    expect(laufend.ohneBetrieb).toBe('laedt');
    expect(laufend.status.level).toBe('keine_betriebe');
    expect(laufend.status.headline).toMatch(/werden geladen/);
    expect(laufend.status.detail).not.toMatch(/kein Unternehmensprofil/);
  });

  it('behandelt einen noch nicht gelaufenen Import wie einen laufenden', () => {
    /* Zwischen Verbinden und dem ersten Job liegt ein Augenblick, in
       dem es noch keinen Lauf gibt. Unbekannt ist nicht "nichts
       gefunden". */
    expect(lage({ standorte: [], importStatus: 'none' }).ohneBetrieb).toBe('laedt');
  });

  it('nennt einen gescheiterten Import als solchen', () => {
    const kaputt = lage({ standorte: [], importStatus: 'failed' });

    expect(kaputt.ohneBetrieb).toBe('fehler');
    expect(kaputt.status.headline).toMatch(/nicht geladen werden/);
    /* Keine Aufforderung: WERKRUF wiederholt es selbst. */
    expect(kaputt.status.detail).toMatch(/erneut/);
  });

  it('verlangt keine Betriebsauswahl', () => {
    /* "Welchen Betrieb meinst du?" hat ohne Betrieb keine Antwort. */
    expect(lage({ standorte: [] }).standortAuswahlNoetig).toBe(false);
  });

  it('gibt keinen Score aus', () => {
    const b = lage({ standorte: [] });

    expect(b.healthScore.score).toBeNull();
    expect(b.healthScore.level).toBe('keine_betriebe');
  });
});

describe('Die Gegenproben', () => {

  it('bleibt bei „noch nicht eingerichtet", wenn gar nichts verbunden ist', () => {
    /* Ohne Verbindung ist "kein Betrieb" die Folge, keine eigene
       Aussage — und connection.missing sagt es ohnehin. */
    const b = lage({ verbunden: false, standorte: [] });

    expect(b.status.level).toBe('setup');
    expect(b.ohneBetrieb).toBeNull();
  });

  it('meldet den Zustand nicht, solange die Daten laden', () => {
    /* Ein aufblitzendes "kein Betrieb" waere eine Diagnose ueber
       etwas, das wir noch nicht wissen. */
    const b = lage({ standorte: [], laedt: true });

    expect(b.ohneBetrieb).toBeNull();
    expect(b.status.level).toBe('loading');
  });

  it('meldet den Zustand nicht bei einem Betrieb', () => {
    const b = lage({ standorte: [STANDORT] });

    expect(b.ohneBetrieb).toBeNull();
    expect(b.status.level).not.toBe('keine_betriebe');
  });

  it('laesst die Engine-Dringlichkeit bei vorhandenem Betrieb unberuehrt', () => {
    const b = lage({
      standorte: [STANDORT],
      aufgaben: [{ id: 'e1', type: 'review.negative_unanswered', priority: 95 }],
    });

    expect(b.status.level).toBe('critical');
  });
});
