/**
 * Kundendashboard nach der Produktentscheidung vom 29.09.2026:
 * kein manueller Abgleich, kein Polling fuer regulaere Jobs, ruhige
 * Statusanzeige. Der einmalige Erstimport nach dem Verbinden behaelt
 * seinen eigenen Fortschritt.
 */
import React from 'react';
import { render, act, screen } from '@testing-library/react';

/* Der Kategorie-Editor zieht ueber seinen Hook supabaseClient herein,
   und der braucht beim Laden Umgebungsvariablen. In dieser Suite geht
   es nicht um Netzzugriffe — deshalb nachgebildet, wie schon
   useGoogleBusinessData. */
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));

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
  __esModule: true, default: () => null,
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

const refresh     = jest.fn();
const reload      = jest.fn();
const triggerSync = jest.fn(() => Promise.resolve({}));

function zustand({
  locations = [standort(SI, 'S&I.', true), standort(WERKRUF, 'WERKRUF', false)],
  lastSyncedAt = '2026-09-29T09:00:00Z',
  lastFailedJob = null,
  latestJob = null,
  locationImport = { status: 'succeeded', job: null, keineBetriebe: false },
} = {}) {
  return {
    locations,
    stats: { totalReviews: 3, averageRating: 4.5, unanswered: 0, distribution: {}, newestReviewAt: null, photoCount: 0 },
    replyCounts: { draft: 0, approved: 0, published: 0, failed: 0 },
    lastSyncedAt, latestJob, lastFailedJob,
    failedJobHistory: [], stalledJobs: [], locationImport,
    loading: false, refreshing: false, error: null,
    reload, refresh, triggerSync,
    refreshJobStatus: jest.fn(), updateLocation: jest.fn(), selectLocation: jest.fn(),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  refresh.mockClear(); reload.mockClear(); triggerSync.mockClear();
  /* CRA setzt resetMocks: true — die Implementierung wird zwischen den
     Tests entfernt, nicht nur die Aufrufliste. Ohne das Neusetzen gibt
     triggerSync undefined zurueck und .catch() faellt auf die Nase. */
  triggerSync.mockImplementation(() => Promise.resolve({}));
});
afterEach(() => {
  jest.runOnlyPendingTimers(); jest.useRealTimers(); jest.clearAllMocks();
});

const vorspulen = (ms) => act(() => { jest.advanceTimersByTime(ms); });

describe('Kein manueller Abgleich im Kundendashboard', () => {
  it('zeigt keinen Knopf "Jetzt abgleichen"', () => {
    useGoogleBusinessData.mockReturnValue(zustand());
    render(<DashboardGoogleBusiness />);
    expect(screen.queryByRole('button', { name: /jetzt abgleichen/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/jetzt abgleichen/i)).not.toBeInTheDocument();
  });

  it('startet bei vorhandenen Betrieben keinen Sync', () => {
    useGoogleBusinessData.mockReturnValue(zustand());
    render(<DashboardGoogleBusiness />);
    vorspulen(60000);
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('pollt nicht, nur weil im Hintergrund ein Job laeuft', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      latestJob: { id: 'j1', status: 'running', created_at: '2026-09-29T10:00:00Z' },
    }));
    render(<DashboardGoogleBusiness />);
    vorspulen(120000);
    expect(refresh).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('Ruhige Statusanzeige', () => {
  it('nennt den letzten erfolgreichen Abgleich statt eines Spinners', () => {
    useGoogleBusinessData.mockReturnValue(zustand());
    render(<DashboardGoogleBusiness />);
    expect(screen.getByText(/automatisch aktualisiert/i)).toBeInTheDocument();
    expect(screen.getByText(/Zuletzt erfolgreich abgeglichen/i)).toBeInTheDocument();
    expect(screen.queryByText(/Abgleich läuft/i)).not.toBeInTheDocument();
  });

  it('zeigt einen laufenden Hintergrundjob nicht als Ereignis', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      latestJob: { id: 'j1', status: 'running', created_at: '2026-09-29T10:00:00Z' },
    }));
    render(<DashboardGoogleBusiness />);
    expect(screen.getByText(/automatisch aktualisiert/i)).toBeInTheDocument();
    expect(screen.queryByText(/Abgleich läuft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dauert länger als üblich/i)).not.toBeInTheDocument();
  });

  it('meldet einen weiterhin bestehenden Fehler klar', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      lastFailedJob: { id: 'j1', status: 'failed', error_code: 'oauth', attempts: 3, max_attempts: 3 },
    }));
    render(<DashboardGoogleBusiness />);
    expect(screen.getByText(/Letzter Abgleich fehlgeschlagen/i)).toBeInTheDocument();
    expect(screen.getByText(/oauth/i)).toBeInTheDocument();
  });
});

describe('Automatischer Erstimport', () => {
  it('startet den Import, wenn noch keiner gelaufen ist', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [], lastSyncedAt: null,
      locationImport: { status: 'none', job: null, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);
    expect(triggerSync).toHaveBeenCalledWith(null);
  });

  it('zeigt waehrend des Imports einen begrenzten Fortschritt und laedt nach', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [], lastSyncedAt: null,
      locationImport: { status: 'running', job: { id: 'imp' }, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);
    expect(screen.getByText(/Deine Betriebe werden geladen/i)).toBeInTheDocument();

    vorspulen(7500);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('hoert auf nachzuladen, sobald der Import ein Ergebnis hat', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [], lastSyncedAt: null,
      locationImport: { status: 'running', job: { id: 'imp' }, keineBetriebe: false },
    }));
    const { rerender } = render(<DashboardGoogleBusiness />);
    vorspulen(7500);
    const nachDrei = refresh.mock.calls.length;

    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [], lastSyncedAt: null,
      locationImport: { status: 'succeeded', job: { id: 'imp' }, keineBetriebe: true },
    }));
    rerender(<DashboardGoogleBusiness />);
    vorspulen(30000);

    expect(refresh.mock.calls.length).toBe(nachDrei);
  });

  it('behandelt null gefundene Betriebe als Ergebnis und importiert NICHT erneut', () => {
    /* Der Fehler: initialSyncRef war eine Ref und wurde bei jedem
       Seitenaufbau zurueckgesetzt — ein erfolgreicher Import mit null
       Betrieben loeste bei jedem Reload einen neuen aus. */
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [], lastSyncedAt: null,
      locationImport: { status: 'succeeded', job: { id: 'imp' }, keineBetriebe: true },
    }));
    const { unmount } = render(<DashboardGoogleBusiness />);

    expect(triggerSync).not.toHaveBeenCalled();
    expect(screen.getByText(/Keine verwaltbaren Betriebe gefunden/i)).toBeInTheDocument();

    // Reload: neuer Seitenaufbau, weiterhin kein neuer Import.
    unmount();
    render(<DashboardGoogleBusiness />);
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('wiederholt einen gescheiterten Import nicht von selbst', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [], lastSyncedAt: null,
      locationImport: { status: 'failed', job: { id: 'imp', error_code: 'oauth' }, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);
    vorspulen(60000);

    expect(triggerSync).not.toHaveBeenCalled();
    expect(screen.getByText(/konnten nicht geladen werden/i)).toBeInTheDocument();
  });
});
