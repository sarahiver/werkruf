/**
 * Betriebskontext in Sidebar und Kopfzeile (WP3, 23.10.2026)
 *
 * T2 ausgewaehlter Betrieb sichtbar · T3 mehrere → „Wechseln (2 Betriebe)“
 * T4 einer → kein Wechsel-Link · T5 keiner → kein Fake-Name
 * T6 Wechsel → neue Anzeige · T7 Ort fehlt → kein undefined
 * T8 Mobile → Karte im Menue, Zeile im Kopf
 *
 * Gegenproben: erste statt ausgewaehlte Location, feste Anzahl,
 * „Wechseln“ bei einem Betrieb, „· undefined“.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockFrom = jest.fn();
jest.mock('../../supabaseClient', () => ({ __esModule: true, default: { from: (...a) => mockFrom(...a) } }));
jest.mock('../../context/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'u1' } }) }));

import BetriebsKontext, { BetriebsKopf, betriebsKontext, betriebsZeile } from './BetriebsKontext';
import { meldeBetriebswechsel, waehle } from '../../hooks/useAusgewaehlterStandort';

const SI = { id: 'si', title: 'S&I', locality: 'Hamburg', place_id: 'p1', selected_at: '2026-10-23T08:00:00Z' };
const WR = { id: 'wr', title: 'WERKRUF', locality: 'Harburg', place_id: 'p2', selected_at: null };

let liste;
beforeEach(() => {
  liste = [SI, WR];
  mockFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: liste, error: null }) }) }) }),
  }));
});

/* ── reine Funktionen ── */
describe('betriebsZeile', () => {
  it('T7 — Ort nur, wenn vorhanden; nie undefined, nie leerer Trenner', () => {
    expect(betriebsZeile({ title: 'S&I', locality: 'Hamburg' })).toBe('S&I · Hamburg');
    expect(betriebsZeile({ title: 'S&I', locality: null })).toBe('S&I');
    expect(betriebsZeile({ title: 'S&I' })).toBe('S&I');
    expect(betriebsZeile({ title: 'S&I', locality: '   ' })).toBe('S&I');
    expect(betriebsZeile({ title: undefined, locality: 'Hamburg' })).toBe('Hamburg');
    expect(betriebsZeile(null)).toBe('');
    for (const z of [betriebsZeile({ title: 'S&I', locality: undefined }), betriebsZeile({ title: 'S&I', locality: '' })]) {
      expect(z).not.toMatch(/undefined|·\s*$/);
    }
  });
});

describe('betriebsKontext', () => {
  it('T2/T3 — ausgewaehlt mit mehreren: Zeile und Wechsel-Link mit echter Anzahl', () => {
    const k = betriebsKontext({ ...waehle([SI, WR]), loading: false, fehler: false });
    expect(k).toMatchObject({ art: 'ausgewaehlt', zeile: 'S&I · Hamburg', wechseln: { anzahl: 2, label: 'Wechseln (2 Betriebe)' } });
    const k3 = betriebsKontext({ ...waehle([SI, WR, { ...WR, id: 'x' }]), loading: false, fehler: false });
    expect(k3.wechseln.label).toBe('Wechseln (3 Betriebe)');
  });
  /* ── GEGENPROBE ── */
  it('T4 — genau einer: kein Wechsel-Link', () => {
    const k = betriebsKontext({ ...waehle([SI]), loading: false, fehler: false });
    expect(k.art).toBe('ausgewaehlt');
    expect(k.wechseln).toBeNull();
  });
  it('zeigt den AUSGEWAEHLTEN, nicht den ersten', () => {
    const k = betriebsKontext({ ...waehle([WR, SI]), loading: false, fehler: false });
    expect(k.zeile).toBe('S&I · Hamburg');
  });
  it('T5 — keiner: kein Name', () => {
    expect(betriebsKontext({ ...waehle([]), loading: false, fehler: false })).toEqual({ art: 'keine' });
  });
  it('vorhanden, aber nicht gewaehlt: Aufforderung statt Vermutung', () => {
    const k = betriebsKontext({ ...waehle([WR, { ...SI, selected_at: null }]), loading: false, fehler: false });
    expect(k).toMatchObject({ art: 'ohne_auswahl', label: 'Betrieb auswählen (2 Betriebe)' });
  });
  it('ladend oder Fehler: nichts behaupten', () => {
    expect(betriebsKontext({ standort: null, grund: null, anzahl: 0, loading: true, fehler: false }).art).toBe('laedt');
    expect(betriebsKontext({ standort: null, grund: null, anzahl: 0, loading: false, fehler: true }).art).toBe('fehler');
  });
});

/* ── Komponenten ── */
const zeige = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('BetriebsKontext (Sidebar)', () => {
  it('T2/T3 — zeigt S&I · Hamburg und einen zugaenglichen Wechsel-Link', async () => {
    zeige(<BetriebsKontext />);
    const karte = await screen.findByTestId('betriebs-kontext');
    expect(karte).toHaveTextContent('S&I · Hamburg');
    const link = screen.getByRole('link', { name: 'Betrieb wechseln (2 Betriebe)' });
    expect(link).toHaveAttribute('href', '/dashboard/google');
    expect(link).toHaveTextContent('Wechseln (2 Betriebe)');
  });

  /* ── GEGENPROBE ── */
  it('T4 — bei einem Betrieb KEIN Wechsel-Link', async () => {
    liste = [SI];
    zeige(<BetriebsKontext />);
    await screen.findByText(/S&I · Hamburg/);
    expect(screen.queryByRole('link', { name: /wechseln/i })).not.toBeInTheDocument();
  });

  it('T5 — ohne Betrieb: „Noch kein Betrieb verbunden“ und der Weg zur Verbindung, kein Fake-Name', async () => {
    liste = [];
    zeige(<BetriebsKontext />);
    const karte = await screen.findByTestId('betriebs-kontext');
    expect(karte).toHaveTextContent('Noch kein Betrieb verbunden');
    expect(karte).not.toHaveTextContent(/S&I|WERKRUF ·/);
    expect(screen.getByRole('link', { name: 'Google-Profil verbinden' })).toHaveAttribute('href', '/dashboard/google');
  });

  it('T7 — ohne Ort kein „· undefined“', async () => {
    liste = [{ ...SI, locality: null }];
    zeige(<BetriebsKontext />);
    const karte = await screen.findByTestId('betriebs-kontext');
    expect(karte).toHaveTextContent('S&I');
    expect(karte.textContent).not.toMatch(/undefined|·/);
  });

  it('T6 — nach einem Wechsel zeigt die Karte den neuen Betrieb — ohne Reload', async () => {
    zeige(<><BetriebsKontext /><BetriebsKopf /></>);
    await waitFor(() => expect(screen.getByTestId('betriebs-kopf')).toHaveTextContent('S&I · Hamburg'));
    liste = [{ ...SI, selected_at: null }, { ...WR, selected_at: '2026-10-23T09:00:00Z' }];
    act(() => { meldeBetriebswechsel(); });
    await waitFor(() => expect(screen.getByTestId('betriebs-kontext')).toHaveTextContent('WERKRUF · Harburg'));
    expect(screen.getByTestId('betriebs-kopf')).toHaveTextContent('WERKRUF · Harburg');
    expect(screen.queryAllByText(/S&I · Hamburg/)).toHaveLength(0);
  });
});

describe('BetriebsKopf (Hauptbereich)', () => {
  it('zeigt dieselbe Zeile wie die Sidebar', async () => {
    zeige(<BetriebsKopf />);
    expect(await screen.findByTestId('betriebs-kopf')).toHaveTextContent('S&I · Hamburg');
  });
});
