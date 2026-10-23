/**
 * Single-Pass-Onboarding — die Verbindungsseite (WP2, 23.10.2026)
 *
 * T6  Terms da, Business fehlt → Business-OAuth automatisch, genau einmal
 * T7  oauth_denied → kein Auto-Retry, bewusster Knopf
 * T4  Bestandskunde → nie Auto-OAuth
 * T8  ein Betrieb ausgewaehlt → Profil neu laden, Dashboard
 * T9  mehrere Betriebe, keiner gewaehlt → Auswahl, KEIN locations[0]
 * T10 keine Betriebe → no_locations-Zustand mit drei Handlungen
 *
 * Die Hooks sind Attrappen; gemessen wird, was die Seite daraus
 * macht: ob connect() gerufen wird, wie oft, und wohin navigiert wird.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
jest.mock('../../hooks/useGoogleBusinessData', () => ({ useGoogleBusinessData: jest.fn() }));
jest.mock('../../hooks/useGoogleBusiness', () => ({ __esModule: true, useGoogleBusiness: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
const mockAuth = jest.fn();
jest.mock('../../context/AuthContext', () => ({ useAuthContext: () => mockAuth() }));
jest.mock('../../context/IndustryContext', () => ({ useIndustry: () => ({ brand: { name: 'WERKRUF' } }) }));
jest.mock('../../components/dashboard/GoogleBusinessConnect', () => ({ __esModule: true, default: () => <div data-testid="connect-karte" /> }));

const { useGoogleBusinessData } = require('../../hooks/useGoogleBusinessData');
const { useGoogleBusiness } = require('../../hooks/useGoogleBusiness');
const { onboardingSchritt, ABSICHT_SCHLUESSEL } = require('../../utils/onboardingAbsicht');
const DashboardGoogleBusiness = require('./DashboardGoogleBusiness').default;

const refreshProfile = jest.fn(() => Promise.resolve());
const OFFEN  = { profile: { id: 'u', onboarding_completed_at: null }, profileLoading: false, profileError: null, refreshProfile };
const FERTIG = { profile: { id: 'u', onboarding_completed_at: '2026-10-01T00:00:00Z' }, profileLoading: false, profileError: null, refreshProfile };

const connect = jest.fn();
const refresh = jest.fn();
const triggerSync = jest.fn(() => Promise.resolve({}));

const standort = (id, gewaehlt) => ({
  id, title: id, locality: 'Hamburg', selected_at: gewaehlt ? '2026-10-23T08:00:00Z' : null,
  is_primary: gewaehlt, last_synced_at: '2026-10-23T08:00:00Z', google_media: [],
});

function verbindung({ isConnected = false, loading = false, busy = false, error = null } = {}) {
  useGoogleBusiness.mockReturnValue({
    isConnected, loading, busy, error, notice: null, connect, disconnect: jest.fn(),
    activeConnection: isConnected ? { id: 'c1', status: 'active' } : null, brokenConnection: null, needsReauth: false,
  });
}
function daten({ locations = [], keineBetriebe = false, loading = false, status = 'succeeded' } = {}) {
  useGoogleBusinessData.mockReturnValue({
    locations, stats: null, replyCounts: { draft: 0, approved: 0, published: 0, failed: 0 },
    lastSyncedAt: null, latestJob: null, lastFailedJob: null, failedJobHistory: [], stalledJobs: [],
    locationImport: { status, job: status === 'never' ? null : { id: 'imp' }, keineBetriebe },
    runningJob: null, loading, refreshing: false, error: null,
    reload: jest.fn(), refresh, triggerSync, updateLocation: jest.fn(), selectLocation: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/dashboard/google');
});

/* ─────────────────────────────────────────────────────────────
   onboardingSchritt — reine Zustandsfunktion
   ───────────────────────────────────────────────────────────── */
describe('onboardingSchritt', () => {
  const basis = { einrichtungOffen: true, loading: false, isConnected: true, keineBetriebe: false };

  it('T8 — ein ausgewaehlter Betrieb heisst fertig', () => {
    expect(onboardingSchritt({ ...basis, locations: [standort('a', true)], selectedLocationId: 'a' })).toBe('fertig');
  });
  it('T9 — mehrere ohne Auswahl heisst Auswahl — nie das erste Element', () => {
    expect(onboardingSchritt({ ...basis, locations: [standort('a'), standort('b')], selectedLocationId: '' })).toBe('auswahl');
  });
  it('genau einer ohne Auswahl heisst warten — die Datenbank waehlt, nicht die Seite', () => {
    expect(onboardingSchritt({ ...basis, locations: [standort('a')], selectedLocationId: '' })).toBe('warten');
  });
  it('T10 — null Betriebe mit Ergebnis heisst keine_betriebe; ohne Ergebnis warten', () => {
    expect(onboardingSchritt({ ...basis, locations: [], selectedLocationId: '', keineBetriebe: true })).toBe('keine_betriebe');
    expect(onboardingSchritt({ ...basis, locations: [], selectedLocationId: '', keineBetriebe: false })).toBe('warten');
  });
  it('nicht verbunden heisst verbinden; nicht offen heisst inaktiv', () => {
    expect(onboardingSchritt({ ...basis, isConnected: false, locations: [], selectedLocationId: '' })).toBe('verbinden');
    expect(onboardingSchritt({ ...basis, einrichtungOffen: false, locations: [standort('a', true)], selectedLocationId: 'a' })).toBe('inaktiv');
  });
});

/* ─────────────────────────────────────────────────────────────
   Die Seite
   ───────────────────────────────────────────────────────────── */
describe('Verbindungsseite — Auto-Start', () => {
  it('T6 — startet den Business-OAuth von selbst, genau einmal, und zaehlt VORHER', async () => {
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: false });
    daten();
    const { rerender } = render(<DashboardGoogleBusiness />);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(JSON.parse(window.sessionStorage.getItem(ABSICHT_SCHLUESSEL)).versuche).toBe(1);
    /* Neu rendern (z. B. Status-Update): kein zweiter Start. */
    rerender(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  /* ── GEGENPROBE ── */
  it('T4 — startet fuer einen Bestandskunden NIE, auch nicht ohne Verbindung', async () => {
    mockAuth.mockReturnValue(FERTIG);
    verbindung({ isConnected: false });
    daten();
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(connect).not.toHaveBeenCalled();
  });

  /* ── GEGENPROBE ── */
  it('T7 — nach oauth_denied (Ruecksprung mit ?gbp=error) startet nichts von selbst', async () => {
    window.history.replaceState({}, '', '/dashboard/google?gbp=error&gbp_code=oauth_denied');
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: false, error: 'Du hast den Zugriff bei Google abgebrochen.' });
    daten();
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(connect).not.toHaveBeenCalled();
    /* Die Karte ist da — mit ihrem Knopf entscheidet der Nutzer. */
    expect(screen.getByTestId('connect-karte')).toBeInTheDocument();
  });

  it('startet nicht, solange der Verbindungsstatus noch laedt', async () => {
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: false, loading: true });
    daten();
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(connect).not.toHaveBeenCalled();
  });

  it('startet im zweiten Tab-Versuch nicht mehr (Zaehler verbraucht)', async () => {
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, JSON.stringify({ gesetztAm: Date.now(), versuche: 1 }));
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: false });
    daten();
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('Verbindungsseite — Ende der Einrichtung', () => {
  it('T8 — ein ausgewaehlter Betrieb: Profil neu laden, dann ins Dashboard (einmal)', async () => {
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: true });
    daten({ locations: [standort('a', true)] });
    const { rerender } = render(<DashboardGoogleBusiness />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    rerender(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  /* ── GEGENPROBE ── */
  it('T9 — mehrere Betriebe ohne Auswahl: KEIN Sprung, Auswahlfrage sichtbar, nichts vorgewaehlt', async () => {
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: true });
    daten({ locations: [standort('a'), standort('b')] });
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(/Welchen Betrieb möchtest du mit WERKRUF verwalten\?/)).toBeInTheDocument();
    expect(screen.queryByText('ausgewählt')).not.toBeInTheDocument();
  });

  /* ── GEGENPROBE ── */
  it('Bestandskunde mit Auswahl: kein Sprung — er wechselt hier nur den Betrieb', async () => {
    mockAuth.mockReturnValue(FERTIG);
    verbindung({ isConnected: true });
    daten({ locations: [standort('a', true)] });
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('T10 — keine Betriebe: klarer Zustand mit Konto wechseln, erneut pruefen, Hilfe — kein Sprung, kein Auto-OAuth', async () => {
    mockAuth.mockReturnValue(OFFEN);
    verbindung({ isConnected: true });
    daten({ locations: [], keineBetriebe: true });
    render(<DashboardGoogleBusiness />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByText(/Keine verwaltbaren Betriebe gefunden/)).toBeInTheDocument();
    const aktionen = screen.getByTestId('keine-betriebe-aktionen');
    expect(aktionen).toHaveTextContent(/Anderes Google-Konto verbinden/);
    expect(aktionen).toHaveTextContent(/Erneut prüfen/);
    expect(aktionen).toHaveTextContent(/Hilfe/);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();   // verbunden → kein Auto-Start
  });
});
