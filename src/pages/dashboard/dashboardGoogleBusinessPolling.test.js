/**
 * Polling-Verhalten des Google-Business-Dashboards.
 *
 * Geprueft wird die Komponente mit gestellten Zeitgebern: Wie oft wird
 * nachgeladen, laeuft nur ein Zyklus, endet er bei einem endgueltigen
 * Ergebnis, und was passiert nach dem Zeitlimit.
 *
 * Der Datenhook ist gestellt — hier geht es um die Effekte in der
 * Seite, nicht um die Datenbeschaffung. Deren Verhalten prueft
 * hooks/googleBusinessLocationSwitch.test.js.
 */
import React from 'react';
import { render, act, screen } from '@testing-library/react';

jest.mock('../../hooks/useGoogleBusinessData', () => ({
  useGoogleBusinessData: jest.fn(),
}));
jest.mock('../../hooks/useGoogleBusiness', () => ({
  __esModule: true,
  useGoogleBusiness: () => ({ isConnected: true, loading: false }),
  default: () => ({ isConnected: true, loading: false }),
}));
jest.mock('../../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF' } }),
}));
jest.mock('../../components/dashboard/GoogleBusinessConnect', () => ({
  __esModule: true,
  default: () => null,
}));

const { useGoogleBusinessData } = require('../../hooks/useGoogleBusinessData');
const DashboardGoogleBusiness = require('./DashboardGoogleBusiness').default;

const WERKRUF = 'loc-werkruf';
const SI      = 'loc-si';

const standort = (id, titel, gewaehlt) => ({
  id, title: titel, locality: 'Hamburg',
  selected_at: gewaehlt ? '2026-09-29T08:00:00Z' : null,
  is_primary: gewaehlt, last_synced_at: '2026-09-29T09:00:00Z',
  google_media: [],
});

const refresh = jest.fn();
const reload  = jest.fn();
/* Standard: Der Job laeuft weiter. Einzelne Tests ueberschreiben das. */
const refreshJobStatus = jest.fn(async (id) => ({ id, status: 'running' }));

function hookZustand({ runningJob = null, gewaehlt = SI } = {}) {
  return {
    locations: [standort(SI, 'S&I.', gewaehlt === SI), standort(WERKRUF, 'WERKRUF', gewaehlt === WERKRUF)],
    stats: { totalReviews: 3, averageRating: 4.5, unanswered: 0, distribution: {}, newestReviewAt: null, photoCount: 0 },
    replyCounts: { draft: 0, approved: 0, published: 0, failed: 0 },
    lastSyncedAt: '2026-09-29T09:00:00Z',
    latestJob: runningJob, runningJob,
    lastFailedJob: null, failedJobHistory: [], stalledJobs: [],
    loading: false, refreshing: false, error: null,
    reload, refresh, refreshJobStatus,
    triggerSync: jest.fn(), updateLocation: jest.fn(), selectLocation: jest.fn(),
  };
}

const laufend = (id) => ({ id, status: 'running', attempts: 1, max_attempts: 3, created_at: '2026-09-29T10:00:00Z' });

beforeEach(() => {
  jest.useFakeTimers();
  refresh.mockClear();
  reload.mockClear();
  refreshJobStatus.mockClear();
  refreshJobStatus.mockImplementation(async (id) => ({ id, status: 'running' }));
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

const vorspulen = (ms) => act(() => { jest.advanceTimersByTime(ms); });

describe('Polling-Begrenzung', () => {
  it('laedt waehrend eines laufenden Jobs still nach', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    render(<DashboardGoogleBusiness />);

    vorspulen(9000);           // drei Intervalle à 3 s

    /* Waehrend der Job laeuft, wird NUR sein Status abgefragt — nicht
       der vollstaendige Datensatz. */
    expect(refreshJobStatus).toHaveBeenCalledTimes(3);
    expect(refreshJobStatus).toHaveBeenCalledWith('j1');
    expect(refresh).not.toHaveBeenCalled();
    // reload() wuerde Skeletons ausloesen — darf im Polling nicht vorkommen.
    expect(reload).not.toHaveBeenCalled();
  });

  it('startet keinen zweiten Zyklus, wenn sich nur das Job-Objekt erneuert', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    const { rerender } = render(<DashboardGoogleBusiness />);
    vorspulen(9000);
    const nachDrei = refreshJobStatus.mock.calls.length;

    // Neues Objekt, gleiche ID — wie nach jedem Laden.
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    rerender(<DashboardGoogleBusiness />);
    vorspulen(9000);

    // Bei zwei parallelen Zyklen waeren es sechs weitere statt drei.
    expect(refreshJobStatus.mock.calls.length - nachDrei).toBe(3);
  });

  it('hoert auf, sobald der Job abgeschlossen ist', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    const { rerender } = render(<DashboardGoogleBusiness />);
    vorspulen(9000);
    const nachDrei = refreshJobStatus.mock.calls.length;

    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: null }));
    rerender(<DashboardGoogleBusiness />);
    vorspulen(30000);

    expect(refreshJobStatus.mock.calls.length).toBe(nachDrei);
  });

  it('raeumt das Intervall beim Verlassen der Seite auf', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    const { unmount } = render(<DashboardGoogleBusiness />);
    vorspulen(6000);
    const vorher = refreshJobStatus.mock.calls.length;

    unmount();
    vorspulen(30000);

    expect(refreshJobStatus.mock.calls.length).toBe(vorher);
  });

  it('wechselt beim Betriebswechsel auf den Zyklus des neuen Jobs', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('si-job'), gewaehlt: SI }));
    const { rerender } = render(<DashboardGoogleBusiness />);
    vorspulen(6000);
    const nachZwei = refreshJobStatus.mock.calls.length;

    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('wr-job'), gewaehlt: WERKRUF }));
    rerender(<DashboardGoogleBusiness />);
    vorspulen(6000);

    // Genau zwei weitere, nicht vier — der alte Zyklus ist beendet.
    expect(refreshJobStatus.mock.calls.length - nachZwei).toBe(2);
    expect(refreshJobStatus).toHaveBeenCalledWith('wr-job');
  });
});

describe('Zeitueberschreitung', () => {
  it('zeigt nach dem Zeitlimit einen Verzoegerungszustand statt eines Dauerspinners', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    render(<DashboardGoogleBusiness />);

    expect(screen.getByText(/Abgleich läuft/i)).toBeInTheDocument();

    vorspulen(40 * 3000 + 3000);   // Zeitlimit ueberschritten

    expect(screen.queryByText(/Abgleich läuft/i)).not.toBeInTheDocument();
    expect(screen.getByText(/dauert länger als üblich/i)).toBeInTheDocument();
    expect(screen.getByText(/weiterhin eingereiht/i)).toBeInTheDocument();
  });

  it('fragt nach dem Zeitlimit nicht weiter nach', () => {
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    render(<DashboardGoogleBusiness />);

    vorspulen(40 * 3000);
    const beimLimit = refreshJobStatus.mock.calls.length;

    vorspulen(60000);
    expect(refreshJobStatus.mock.calls.length).toBe(beimLimit);
  });

  it('markiert den Job im Backend nicht als gescheitert', () => {
    const zustand = hookZustand({ runningJob: laufend('j1') });
    useGoogleBusinessData.mockReturnValue(zustand);
    render(<DashboardGoogleBusiness />);

    vorspulen(40 * 3000 + 3000);

    // Kein Sync-Aufruf, kein Schreiben — die Seite hoert nur auf zu fragen.
    expect(zustand.triggerSync).not.toHaveBeenCalled();
    expect(zustand.updateLocation).not.toHaveBeenCalled();
    /* Gezielt der Sync-Status, nicht das Wort irgendwo — die
       Antwort-Kennzahlen tragen ebenfalls die Marke "Fehlgeschlagen". */
    expect(screen.queryByText(/Letzter Abgleich fehlgeschlagen/i)).not.toBeInTheDocument();
  });
});

describe('Abschluss eines Syncs', () => {
  it('laedt nach dem Abschluss genau einmal vollstaendig nach', async () => {
    refreshJobStatus.mockImplementation(async (id) => ({ id, status: 'succeeded' }));
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    render(<DashboardGoogleBusiness />);

    await act(async () => { jest.advanceTimersByTime(3000); });

    expect(refreshJobStatus).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Danach keine weiteren Abfragen.
    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(refreshJobStatus).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('beendet das Polling auch bei einem gescheiterten Job', async () => {
    refreshJobStatus.mockImplementation(async (id) => ({ id, status: 'failed' }));
    useGoogleBusinessData.mockReturnValue(hookZustand({ runningJob: laufend('j1') }));
    render(<DashboardGoogleBusiness />);

    await act(async () => { jest.advanceTimersByTime(3000); });
    const nachEins = refreshJobStatus.mock.calls.length;

    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(refreshJobStatus.mock.calls.length).toBe(nachEins);
  });
});
