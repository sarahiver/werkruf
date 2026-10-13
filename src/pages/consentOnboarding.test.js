/*
 * Die Zustimmung im Onboarding (Paket H1, Consent).
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRÜFT WIRD UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Härtung liegt in SQL und wird dort gemessen
 * (supabase/tests/consent.test.sql): kein Zeitstempel vom Client,
 * keine Version vom Client, keine fremde user_id, Spalten direkt
 * nicht schreibbar.
 *
 * Diese Datei prüft die andere Hälfte — dass die Oberfläche den
 * einen vorgesehenen Weg geht und nicht daran vorbei:
 *
 *   ohne Haken kein Weiter
 *   mit Haken wird accept_terms gerufen, mit der Fassung vom Server
 *   scheitert das, bleibt der Nutzer hier
 *   wer schon zugestimmt hat, wird nicht erneut gefragt
 *   kein Rechtstext in der Seite, nur Verweise auf die Dokumente
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockRpc = jest.fn();
jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { rpc: (...a) => mockRpc(...a) },
}));

const mockProfil = jest.fn();
const mockRefresh = jest.fn();
jest.mock('../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => ({
    user: { id: 'u1', user_metadata: { full_name: 'Rolf Müller' } },
    profile: mockProfil(),
    refreshProfile: mockRefresh,
  }),
}));

jest.mock('../context/IndustryContext', () => ({
  __esModule: true,
  useIndustry: () => ({ brand: { name: 'WERKRUF', key: 'handwerk' } }),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

jest.mock('../utils/publicFunnel', () => ({
  __esModule: true,
  clearPublicFunnel: jest.fn(),
  loadPublicFunnel: jest.fn(),
  savePublicFunnel: jest.fn(),
}));

import Onboarding from './Onboarding';

const FASSUNG = 'datenschutz-2026-09';

/* Die Standardantworten: Fassung laden geht, Zustimmen geht. Ein Test,
   der etwas anderes braucht, setzt es selbst. */
function rpcStandard() {
  mockRpc.mockImplementation((name) => {
    if (name === 'current_terms_version') {
      return Promise.resolve({ data: FASSUNG, error: null });
    }
    if (name === 'accept_terms') {
      return Promise.resolve({ data: '2026-10-13T12:00:00Z', error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

const knopf = () => screen.getByRole('button', { name: /verbinden|gespeichert/i });

beforeEach(() => {
  mockRpc.mockReset();
  mockProfil.mockReset();
  mockNavigate.mockReset();
  mockRefresh.mockReset();
  rpcStandard();
  mockProfil.mockReturnValue({ accepted_terms_at: null, accepted_terms_version: null });
  mockRefresh.mockResolvedValue(undefined);
});

describe('Ohne Zustimmung geht es nicht weiter', () => {

  it('zeigt den Haken und sperrt den Knopf', async () => {
    render(<Onboarding />);

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('current_terms_version'));

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(knopf()).toBeDisabled();
  });

  it('ruft beim Klick auf den gesperrten Knopf nichts', async () => {
    render(<Onboarding />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('current_terms_version'));

    await act(async () => { fireEvent.click(knopf()); });

    expect(mockRpc).not.toHaveBeenCalledWith('accept_terms', expect.anything());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('verweist auf die Dokumente, die es gibt — und erfindet keinen Text', async () => {
    render(<Onboarding />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('current_terms_version'));

    expect(screen.getByRole('link', { name: /Datenschutzerklärung/ }))
      .toHaveAttribute('href', '/datenschutz');
    expect(screen.getByRole('link', { name: /Impressum/ }))
      .toHaveAttribute('href', '/impressum');

    /* Keine AGB: Es gibt im Repo keine. Ein Link darauf wäre ein
       Verweis auf ein Dokument, das nicht existiert. */
    expect(screen.queryByText(/AGB|Allgemeine Geschäftsbedingungen|Nutzungsbedingungen/))
      .not.toBeInTheDocument();
  });
});

describe('Mit Zustimmung', () => {

  it('speichert serverseitig und geht dann weiter', async () => {
    render(<Onboarding />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('current_terms_version'));

    fireEvent.click(screen.getByRole('checkbox'));
    expect(knopf()).toBeEnabled();

    await act(async () => { fireEvent.click(knopf()); });

    /* Die Fassung kommt vom Server, nicht aus der Seite — und sonst
       nichts: kein Zeitstempel, keine user_id. */
    expect(mockRpc).toHaveBeenCalledWith('accept_terms', { p_version: FASSUNG });
    const [, argumente] = mockRpc.mock.calls.find(([n]) => n === 'accept_terms');
    expect(Object.keys(argumente)).toEqual(['p_version']);

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/google', { replace: true });
  });

  it('bleibt hier, wenn das Speichern scheitert', async () => {
    /* Weitergehen ohne Eintrag wäre ein Nachweis, den es nicht gibt. */
    mockRpc.mockImplementation((name) => {
      if (name === 'current_terms_version') {
        return Promise.resolve({ data: FASSUNG, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '23514', message: 'kaputt' } });
    });

    render(<Onboarding />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('current_terms_version'));

    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => { fireEvent.click(knopf()); });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/nicht gespeichert/);
  });

  it('lässt ohne geladene Fassung nicht zustimmen', async () => {
    /* Fail closed: Lieber eine Meldung als ein Eintrag ohne Bezug. */
    mockRpc.mockImplementation((name) => {
      if (name === 'current_terms_version') {
        return Promise.resolve({ data: null, error: { code: '42883', message: 'weg' } });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<Onboarding />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox'));

    expect(knopf()).toBeDisabled();
    expect(mockRpc).not.toHaveBeenCalledWith('accept_terms', expect.anything());
  });
});

describe('Wer schon zugestimmt hat', () => {

  it('wird nicht erneut gefragt', async () => {
    /* Kein Re-Consent. Auch nicht, wenn die gespeicherte Fassung eine
       andere ist als die geltende — eine neue Fassung fragt nicht
       nach. */
    mockProfil.mockReturnValue({
      accepted_terms_at: '2026-10-01T08:00:00Z',
      accepted_terms_version: 'eine-aeltere-fassung',
    });

    render(<Onboarding />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(knopf()).toBeEnabled();
    /* Und es wird nicht einmal die geltende Fassung geladen. */
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('geht direkt weiter, ohne erneut zu speichern', async () => {
    mockProfil.mockReturnValue({
      accepted_terms_at: '2026-10-01T08:00:00Z',
      accepted_terms_version: FASSUNG,
    });

    render(<Onboarding />);
    await act(async () => { fireEvent.click(knopf()); });

    expect(mockRpc).not.toHaveBeenCalledWith('accept_terms', expect.anything());
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/google', { replace: true });
  });
});

describe('Die Seite baut keinen eigenen Weg', () => {
  const fs = require('fs');
  const quelle = fs.readFileSync('src/pages/Onboarding.js', 'utf8');

  it('schreibt die Spalten nicht selbst', () => {
    /* Der Client kann es ohnehin nicht (Spaltenrechte, gemessen in
       supabase/tests/entitlement.test.sql) — aber ein Versuch im Code
       wäre ein Hinweis darauf, dass jemand den Weg nicht kennt. */
    expect(quelle).not.toMatch(/accepted_terms_at:/);
    expect(quelle).not.toMatch(/from\('user_profiles'\)/);
  });

  it('schickt keinen Zeitstempel mit', () => {
    expect(quelle).not.toMatch(/p_at|new Date\(\)\.toISOString\(\)/);
  });

  it('benutzt record_terms_acceptance nicht direkt', () => {
    /* Die nimmt eine fremde user_id an und gehört dem Server. */
    expect(quelle).not.toMatch(/record_terms_acceptance/);
  });

  it('nennt die Fassung nicht als Literal', () => {
    /* Sonst stünde die geltende Fassung an zwei Stellen, und eine
       davon wäre irgendwann falsch. */
    expect(quelle).not.toMatch(/datenschutz-2026/);
    expect(quelle).toMatch(/rpc\('current_terms_version'\)/);
  });
});
