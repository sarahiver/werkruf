/**
 * ZustimmungsTor — ohne Zustimmung kein Dashboard
 *
 * 22.10.2026: Ein Konto mit "Zustimmung: fehlt" war im Dashboard. Die
 * Weiche nach dem Login war nie ein Tor. Dieses hier ist eines.
 *
 * Die tragende Gegenprobe ist die Rennbedingung: Profil noch nicht
 * geladen darf NICHT als "keine Zustimmung" gelesen werden.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ZustimmungsTor, { zustimmungErforderlich } from './ZustimmungsTor';

const mockAuth = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => mockAuth(),
}));

const zeige = (auth, pfad = '/dashboard/fotos') => {
  mockAuth.mockReturnValue(auth);
  render(
    <MemoryRouter initialEntries={[pfad]}>
      <Routes>
        <Route path="/onboarding" element={<div data-testid="onboarding" />} />
        <Route path="/dashboard/*" element={<ZustimmungsTor><div data-testid="dashboard" /></ZustimmungsTor>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('zustimmungErforderlich', () => {
  it('verlangt die Zustimmung nur, wenn das Profil geladen ist und sie fehlt', () => {
    expect(zustimmungErforderlich({ profile: { accepted_terms_at: null }, profileLoading: false, profileError: null })).toBe(true);
    expect(zustimmungErforderlich({ profile: { accepted_terms_at: '2026-10-01T00:00:00Z' }, profileLoading: false, profileError: null })).toBe(false);
  });

  /* ── GEGENPROBE ── */
  it('laesst durch, solange nichts entschieden ist: ladend, Fehler, keine Zeile', () => {
    expect(zustimmungErforderlich({ profile: null, profileLoading: true,  profileError: null })).toBe(false);
    expect(zustimmungErforderlich({ profile: { accepted_terms_at: null }, profileLoading: true, profileError: null })).toBe(false);
    expect(zustimmungErforderlich({ profile: null, profileLoading: false, profileError: 'kaputt' })).toBe(false);
    expect(zustimmungErforderlich({ profile: null, profileLoading: false, profileError: null })).toBe(false);
  });

  it('prueft nur das Fehlen, nie die Fassung', () => {
    expect(zustimmungErforderlich({
      profile: { accepted_terms_at: '2026-01-01T00:00:00Z', accepted_terms_version: 'uralt' },
      profileLoading: false, profileError: null,
    })).toBe(false);
  });
});

describe('ZustimmungsTor', () => {
  it('schickt ohne Zustimmung nach /onboarding — kein Dashboard-Inhalt', () => {
    zeige({ profile: { id: 'u', accepted_terms_at: null }, profileLoading: false, profileError: null });
    expect(screen.getByTestId('onboarding')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('zeigt mit Zustimmung das Dashboard', () => {
    zeige({ profile: { id: 'u', accepted_terms_at: '2026-10-01T00:00:00Z' }, profileLoading: false, profileError: null });
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  /* ── GEGENPROBE ── */
  it('wirft beim ersten Rendern (Profil null, noch nicht geladen) NICHT hinaus', () => {
    zeige({ profile: null, profileLoading: false, profileError: null });
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument();
  });

  it('laesst bei nicht lesbarem Profil durch — ein Ausfall ist kein Produktzustand', () => {
    zeige({ profile: null, profileLoading: false, profileError: 'Dein Profil konnte nicht geladen werden.' });
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});

describe('App — das Tor steht an der Route', () => {
  it('umschliesst DashboardLayout innerhalb von ProtectedRoute', () => {
    const fs = require('fs');
    const quelle = fs.readFileSync(require.resolve('../../App.js'), 'utf8');
    expect(quelle).toMatch(/<ProtectedRoute>\s*<ZustimmungsTor>\s*<DashboardLayout \/>\s*<\/ZustimmungsTor>\s*<\/ProtectedRoute>/);
  });
});
