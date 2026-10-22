/**
 * Fotoseite — Google-Medien anzeigen und löschen
 *
 * ═══════════════════════════════════════════════════════════════
 * ANLASS
 * ═══════════════════════════════════════════════════════════════
 *
 * Bis zum 22.10.2026 zeigte die Seite nur Uploads über WERKRUF, mit
 * einem Abzeichen, das nie seinen Zustand änderte. Was bei Google
 * stand, sah niemand; der Löschknopf löschte nur die WERKRUF-Zeile.
 *
 * ═══════════════════════════════════════════════════════════════
 * DIE TRAGENDEN PRÜFUNGEN SIND DIE GEGENPROBEN
 * ═══════════════════════════════════════════════════════════════
 *
 *   • Ein Klick auf den Papierkorb löscht NICHTS. Erst die
 *     Bestätigung. Ein Löschen bei Google ist endgültig.
 *   • Abbrechen löscht nichts.
 *   • Ohne ausgewählten Betrieb gibt es weder Liste noch Löschknopf.
 *   • Der Request trägt genau locationId und mediaName — und nichts,
 *     was der Server als Umgehung der Eigentumsprüfung lesen könnte.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockFrom = jest.fn();
const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: {
    from: (...a) => mockFrom(...a),
    auth: { getUser: (...a) => mockGetUser(...a), getSession: (...a) => mockGetSession(...a) },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => ({ user: { id: 'u1' } }),
}));
jest.mock('../../components/dashboard/ProGate', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

import DashboardFotos, { medienAnzeige, kategorieLabel, istHeikel } from './DashboardFotos';

const STANDORT = { id: 'loc-1', title: 'Sanitär Müller', selected_at: '2026-10-20T10:00:00Z' };
const MEDIEN = [
  { name: 'accounts/1/locations/2/media/aaa', mediaFormat: 'PHOTO', locationAssociation: { category: 'COVER' },
    googleUrl: 'https://lh3.example/aaa', thumbnailUrl: 'https://lh3.example/aaa=s300', createTime: '2026-10-01T00:00:00Z' },
  { name: 'accounts/1/locations/2/media/bbb', mediaFormat: 'PHOTO', locationAssociation: { category: 'ADDITIONAL' },
    googleUrl: 'https://lh3.example/bbb', createTime: '2026-10-02T00:00:00Z' },
];

let fetchMock;
function standorte(liste) {
  mockFrom.mockImplementation((tabelle) => {
    if (tabelle === 'google_locations') {
      return { select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: liste, error: null }) }) }) };
    }
    /* business_photos */
    return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
             delete: () => ({ eq: () => Promise.resolve({ error: null }) }) };
  });
}

beforeEach(() => {
  mockFrom.mockReset(); mockGetUser.mockReset(); mockGetSession.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  fetchMock = jest.fn(async (url) => {
    if (String(url).includes('/media/list'))   return { ok: true, json: async () => ({ media: MEDIEN }) };
    if (String(url).includes('/media/delete')) return { ok: true, json: async () => ({ media: [MEDIEN[1]], deleted: MEDIEN[0].name }) };
    return { ok: false, json: async () => ({ error: { code: 'not_found' } }) };
  });
  global.fetch = fetchMock;
  process.env.REACT_APP_SUPABASE_URL = 'https://projekt.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon';
});

/* ─────────────────────────────────────────────────────────────
   TEIL 1 — reine Helfer
   ───────────────────────────────────────────────────────────── */

describe('medienAnzeige', () => {
  it('reduziert ein MediaItem auf das, was die Seite braucht', () => {
    const a = medienAnzeige(MEDIEN[0]);
    expect(a).toMatchObject({ name: MEDIEN[0].name, kategorie: 'COVER', label: 'Titelbild', heikel: true });
    expect(a.bild).toBe('https://lh3.example/aaa=s300');   // Thumbnail vor Vollbild
    const b = medienAnzeige(MEDIEN[1]);
    expect(b.bild).toBe('https://lh3.example/bbb');        // ohne Thumbnail: Vollbild
    expect(b.heikel).toBe(false);
  });

  it('verwirft Unbrauchbares statt zu raten', () => {
    expect(medienAnzeige(null)).toBeNull();
    expect(medienAnzeige({})).toBeNull();
    expect(medienAnzeige({ googleUrl: 'x' })).toBeNull();  // ohne name nicht löschbar → nicht anzeigen
  });

  it('kennt die Kategorien und lässt Unbekanntes sichtbar', () => {
    expect(kategorieLabel('PROFILE')).toBe('Profilbild');
    expect(kategorieLabel('EXTERIOR')).toBe('EXTERIOR');
    expect(kategorieLabel(null)).toBe('Foto');
    expect(istHeikel('LOGO')).toBe(true);
    expect(istHeikel('ADDITIONAL')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 2 — die Seite
   ───────────────────────────────────────────────────────────── */

describe('Fotoseite — Google-Medien', () => {
  it('zeigt die Fotos des ausgewählten Betriebs mit Kategorie', async () => {
    standorte([STANDORT]);
    render(<DashboardFotos />);
    const galerie = await screen.findByTestId('google-galerie');
    expect(within(galerie).getAllByRole('img')).toHaveLength(2);
    expect(within(galerie).getByText('Titelbild')).toBeInTheDocument();
    expect(within(galerie).getByText('Weiteres Foto')).toBeInTheDocument();

    const listAufruf = fetchMock.mock.calls.find(([u]) => String(u).includes('/media/list'));
    expect(String(listAufruf[0])).toContain('locationId=loc-1');
  });

  it('zeigt ohne ausgewählten Betrieb weder Liste noch Löschknöpfe — und ruft Google nicht', async () => {
    /* Zwei Betriebe, keine Auswahl: bestimmeZielstandort() liefert
       null, mit Absicht. */
    standorte([{ ...STANDORT, selected_at: null }, { id: 'loc-2', title: 'Zweiter', selected_at: null }]);
    render(<DashboardFotos />);
    expect(await screen.findByTestId('google-kein-standort')).toBeInTheDocument();
    expect(screen.queryByTestId('google-galerie')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/media/'))).toBe(false);
  });

  /* ── GEGENPROBE ── */
  it('löscht NICHT beim ersten Klick — erst nach Bestätigung', async () => {
    standorte([STANDORT]);
    render(<DashboardFotos />);
    await screen.findByTestId('google-galerie');

    fireEvent.click(screen.getByRole('button', { name: /Titelbild bei Google löschen/ }));

    /* Bestätigung sichtbar, Google noch nicht berührt. */
    const dialog = await screen.findByRole('dialog', { name: /Löschen bestätigen/ });
    expect(dialog).toHaveTextContent(/endgültig/);
    /* Heikle Kategorie: eigene Warnung. */
    expect(dialog).toHaveTextContent(/Titelbild/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/media/delete'))).toBe(false);
  });

  it('löscht nach Bestätigung mit genau locationId und mediaName und zeigt den neuen Stand', async () => {
    standorte([STANDORT]);
    render(<DashboardFotos />);
    await screen.findByTestId('google-galerie');

    fireEvent.click(screen.getByRole('button', { name: /Titelbild bei Google löschen/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ja, bei Google löschen/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/media/delete'))).toBe(true));

    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/media/delete'));
    expect(String(url)).toMatch(/\/google-business\/media\/delete$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ locationId: 'loc-1', mediaName: MEDIEN[0].name });
    expect(init.headers.Authorization).toBe('Bearer tok');

    /* Der Server liefert die neue Liste; die Seite zeigt sie, nicht
       eine lokale Vermutung. */
    await waitFor(() => {
      const galerie = screen.getByTestId('google-galerie');
      expect(within(galerie).getAllByRole('img')).toHaveLength(1);
      expect(within(galerie).queryByText('Titelbild')).not.toBeInTheDocument();
    });
  });

  /* ── GEGENPROBE ── */
  it('löscht nichts bei Abbrechen', async () => {
    standorte([STANDORT]);
    render(<DashboardFotos />);
    await screen.findByTestId('google-galerie');

    fireEvent.click(screen.getByRole('button', { name: /Weiteres Foto bei Google löschen/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Abbrechen/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/media/delete'))).toBe(false);
    expect(within(screen.getByTestId('google-galerie')).getAllByRole('img')).toHaveLength(2);
  });

  it('sagt bei einem Fehler, dass nichts gelöscht wurde — und lässt das Foto stehen', async () => {
    standorte([STANDORT]);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/media/list'))   return { ok: true, json: async () => ({ media: MEDIEN }) };
      if (String(url).includes('/media/delete')) return { ok: false, json: async () => ({ error: { code: 'upstream_error' } }) };
      return { ok: false, json: async () => ({}) };
    });
    render(<DashboardFotos />);
    await screen.findByTestId('google-galerie');

    fireEvent.click(screen.getByRole('button', { name: /Titelbild bei Google löschen/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ja, bei Google löschen/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/unverändert/);
    expect(within(screen.getByTestId('google-galerie')).getAllByRole('img')).toHaveLength(2);
  });

  it('erklärt die Rückweisung des Servers, wenn das Foto nicht zum Betrieb gehört', async () => {
    standorte([STANDORT]);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/media/list'))   return { ok: true, json: async () => ({ media: MEDIEN }) };
      if (String(url).includes('/media/delete')) return { ok: false, json: async () => ({ error: { code: 'bad_request' } }) };
      return { ok: false, json: async () => ({}) };
    });
    render(<DashboardFotos />);
    await screen.findByTestId('google-galerie');
    fireEvent.click(screen.getByRole('button', { name: /Titelbild bei Google löschen/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ja, bei Google löschen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/gehört nicht zum ausgewählten Betrieb/);
  });
});
