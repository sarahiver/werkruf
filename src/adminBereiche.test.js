/**
 * WP16.1 — Admin-Informationsarchitektur.
 *
 *   U1–U7   Bereiche: Standard, je Bereich genau EINER sichtbar, ungueltig →
 *           Uebersicht, Deep Link/Reload, Klick (pushState), Zurueck (popstate)
 *   Lang    Regression „lange Seite": kein Bereich rendert fremde Module
 *   Lazy    Daten nur fuer den sichtbaren Bereich
 *   U8–U14  bestehende Funktionen erreichbar: Lead anlegen, CSV importieren,
 *           Kundensuche, Support-Ansicht, FP-Cockpit, Setup-Liste, Abmelden
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { BEREICHE, STANDARD_BEREICH, bereichAusSuche, sucheFuerBereich } from './utils/adminBereiche';
import Admin from './pages/Admin';

jest.mock('./context/AuthContext', () => ({ useAuthContext: jest.fn() }));
const mockNavigiere = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigiere }));
jest.mock('./supabaseClient', () => ({
  __esModule: true,
  default: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

const { useAuthContext } = require('./context/AuthContext');
const supabase = require('./supabaseClient').default;

let aufrufe; let tabellen; let abmelden;
const KUNDE = { id: '11111111-1111-1111-1111-111111111111', unternehmen: 'Musterbetrieb', email: 'chef@betrieb.test', plan: 'free', consentVorhanden: true, registriertAm: '2026-09-01T10:00:00Z', googleStatus: 'active' };
const SETUP = { id: 's1', company_name: 'Setup Betrieb', email: 'setup@betrieb.test', needs_manual_setup: true, status: 'new', industry_key: 'handwerk', created_at: '2026-10-01T10:00:00Z' };

beforeEach(() => {
  aufrufe = []; tabellen = [];
  abmelden = jest.fn(() => Promise.resolve());
  mockNavigiere.mockReset();
  useAuthContext.mockImplementation(() => ({ isAdmin: true, signOut: abmelden, loading: false }));
  supabase.from.mockImplementation((t) => {
    tabellen.push(t);
    return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [SETUP], error: null }) }) }) };
  });
  supabase.functions.invoke.mockImplementation((name, { body }) => {
    aufrufe.push(body);
    const d = {
      list_customers: { customers: [KUNDE] },
      list_support_requests: { requests: [] },
      acquisition_list: { leads: [], kpi: { leads: 3, neu: 2, interesse: 0 }, deliveryMode: 'production' },
      fp_cockpit_overview: { partner: [], kpi: {} },
    }[body.action] ?? { ok: true };
    return Promise.resolve({ data: d, error: null });
  });
});

const oeffne = async (url = '/admin') => {
  window.history.pushState({}, '', url);
  await act(async () => { render(<Admin />); });
};
const sichtbar = () => BEREICHE.map((b) => b.key).filter((k) => screen.queryByTestId(`bereich-${k}`));
const aktiv = () => within(screen.getByTestId('admin-bereiche')).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('data-bereich'));
const aktionen = () => aufrufe.map((a) => a.action);

/* ───────── Modul ───────── */
describe('adminBereiche.js', () => {
  it('sechs Bereiche in fester Reihenfolge (Paket B: + Analyse), Standard Uebersicht', () => {
    expect(BEREICHE.map((b) => b.key)).toEqual(['uebersicht', 'akquise', 'kunden', 'founding-partner', 'setup', 'analyse']);
    expect(STANDARD_BEREICH).toBe('uebersicht');
  });
  it('URL → Bereich; Unsinn → Uebersicht; andere Parameter bleiben', () => {
    expect(bereichAusSuche('?bereich=akquise')).toBe('akquise');
    expect(bereichAusSuche('?bereich=AKQUISE')).toBe('uebersicht');
    expect(bereichAusSuche('?bereich=<script>')).toBe('uebersicht');
    expect(bereichAusSuche('')).toBe('uebersicht');
    expect(bereichAusSuche(undefined)).toBe('uebersicht');
    expect(sucheFuerBereich('setup', '?x=1')).toBe('?x=1&bereich=setup');
    expect(sucheFuerBereich('uebersicht', '?bereich=setup&x=1')).toBe('?x=1');
    expect(sucheFuerBereich('uebersicht', '?bereich=setup')).toBe('');
  });
});

/* ───────── U1–U7 ───────── */
describe('Bereiche', () => {
  it('U1 — /admin oeffnet die Uebersicht, sonst nichts', async () => {
    await oeffne('/admin');
    expect(sichtbar()).toEqual(['uebersicht']);
    expect(aktiv()).toEqual(['uebersicht']);
    expect(screen.getByTestId('uebersicht-kpi')).toBeInTheDocument();
  });
  it.each(BEREICHE.map((b) => [b.key, b.label]))('U2–U5 — ?bereich=%s rendert genau diesen Bereich (Deep Link / Reload)', async (key) => {
    await oeffne(`/admin?bereich=${key}`);
    expect(sichtbar()).toEqual([key]);
    expect(aktiv()).toEqual([key]);
  });
  it('U6 — ungueltiger Bereich → Uebersicht', async () => {
    await oeffne('/admin?bereich=gibtsnicht');
    expect(sichtbar()).toEqual(['uebersicht']);
  });
  it('U7 — Klick wechselt Bereich, schreibt die URL; Zurueck stellt ihn wieder her', async () => {
    await oeffne('/admin');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Akquise' })); });
    expect(window.location.search).toBe('?bereich=akquise');
    expect(sichtbar()).toEqual(['akquise']);
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /^Setup/ })); });
    expect(sichtbar()).toEqual(['setup']);
    await act(async () => {
      window.history.pushState({}, '', '/admin?bereich=akquise');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(sichtbar()).toEqual(['akquise']);
  });
  it('Navigation ist eine echte Link-Liste (Tastatur, Mittelklick, aria-current)', async () => {
    await oeffne('/admin?bereich=kunden');
    const links = within(screen.getByTestId('admin-bereiche')).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/admin', '/admin?bereich=akquise', '/admin?bereich=kunden', '/admin?bereich=founding-partner', '/admin?bereich=setup', '/admin?bereich=analyse']);
    expect(screen.getByTestId('admin-bereiche').tagName).toBe('NAV');
  });
});

/* ───────── Regression: keine lange Seite ───────── */
describe('Keine lange Seite mehr', () => {
  it('Akquise zeigt weder Kundensuche noch FP-Cockpit noch Setup', async () => {
    await oeffne('/admin?bereich=akquise');
    expect(screen.queryByText('Kunde finden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-liste')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bereich-founding-partner')).not.toBeInTheDocument();
  });
  it('Kunden zeigt keine Akquise und kein Setup', async () => {
    await oeffne('/admin?bereich=kunden');
    expect(screen.queryByTestId('akquise-neu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-liste')).not.toBeInTheDocument();
  });
  it('Uebersicht zeigt keine Arbeitsflaechen', async () => {
    await oeffne('/admin');
    for (const t of ['akquise-neu', 'admin-kunden-suche', 'setup-liste']) expect(screen.queryByTestId(t)).not.toBeInTheDocument();
  });
});

/* ───────── Lazy ───────── */
describe('Daten je Bereich', () => {
  it('Akquise laedt nur die Akquise — keine Kundenliste, kein Cockpit, keine Setup-Leads', async () => {
    await oeffne('/admin?bereich=akquise');
    await waitFor(() => expect(aktionen()).toContain('acquisition_list'));
    expect(aktionen()).not.toContain('list_customers');
    expect(aktionen()).not.toContain('fp_cockpit_overview');
    expect(tabellen).toEqual([]);
  });
  it('Uebersicht holt Akquise-Zahlen mit limit 1, nicht die Liste; kein Cockpit', async () => {
    await oeffne('/admin');
    expect(aufrufe.find((a) => a.action === 'acquisition_list').params).toMatchObject({ limit: 1 });
    expect(aktionen()).not.toContain('fp_cockpit_overview');
    expect(aktionen()).not.toContain('analytics_overview');
    expect(screen.getByTestId('uebersicht-hinweise')).toHaveTextContent('2Akquise-Leads noch nicht angeschrieben');
  });
  it('Cockpit nur im Bereich Founding Partner; Setup nur Leads', async () => {
    await oeffne('/admin?bereich=founding-partner');
    await waitFor(() => expect(aktionen()).toContain('fp_cockpit_overview'));
    expect(aktionen()).not.toContain('list_customers');
    expect(aktionen()).not.toContain('acquisition_list');
  });
  it('Analyse laedt nur im Bereich Analyse (Google-Kontingent schonen)', async () => {
    await oeffne('/admin?bereich=analyse');
    await waitFor(() => expect(aktionen()).toContain('analytics_overview'));
    expect(aktionen()).not.toContain('list_customers');
    expect(aktionen()).not.toContain('acquisition_list');
    for (const b of ['akquise', 'kunden', 'founding-partner', 'setup']) {
      aufrufe = [];
      await oeffne(`/admin?bereich=${b}`);
      expect(aktionen()).not.toContain('analytics_overview');
    }
  });
  it('Setup laedt nur die Leads-Tabelle', async () => {
    await oeffne('/admin?bereich=setup');
    expect(tabellen).toEqual(['leads']);
    expect(aufrufe).toEqual([]);
  });
});

/* ───────── U8–U14: nichts verloren ───────── */
describe('Bestehende Funktionen erreichbar', () => {
  it('U8 — Akquise: „Lead anlegen" oeffnet die manuelle Anlage und schreibt ueber acquisition_lead_create', async () => {
    await oeffne('/admin?bereich=akquise');
    await act(async () => { fireEvent.click(screen.getByTestId('akquise-neu')); });
    const form = screen.getByTestId('akquise-neu-form');
    fireEvent.change(within(form).getByTestId('lead-company'), { target: { value: 'Neu GmbH' } });
    fireEvent.change(within(form).getByTestId('lead-email'), { target: { value: 'neu@gmbh.de' } });
    await act(async () => { fireEvent.click(screen.getByTestId('akquise-anlegen')); });
    expect(aufrufe.find((a) => a.action === 'acquisition_lead_create').params.lead).toMatchObject({ company_name: 'Neu GmbH', email: 'neu@gmbh.de' });
  });
  it('U9 — Akquise: „CSV importieren" oeffnet den Import, ohne Versand', async () => {
    await oeffne('/admin?bereich=akquise');
    await act(async () => { fireEvent.click(screen.getByTestId('akquise-import-oeffnen')); });
    expect(screen.getByTestId('akquise-import')).toBeInTheDocument();
    expect(screen.getByTestId('import-datei')).toBeInTheDocument();
  });
  it('U10 — Kunden: Kundensuche geht an den Server', async () => {
    await oeffne('/admin?bereich=kunden');
    expect(screen.getByText('Musterbetrieb')).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Suche nach/), { target: { value: 'chef' } });
      fireEvent.click(screen.getByText('Suchen'));
    });
    expect(aufrufe.filter((a) => a.action === 'list_customers').pop().params).toMatchObject({ suche: 'chef', limit: 50 });
  });
  it('U11 — Kunden: Support-Ansicht oeffnet', async () => {
    supabase.functions.invoke.mockImplementation((name, { body }) => {
      aufrufe.push(body);
      if (body.action === 'list_customers') return Promise.resolve({ data: { customers: [KUNDE] }, error: null });
      if (body.action === 'get_customer_support_state') return Promise.resolve({ data: null, error: { message: 'egal' } });
      return Promise.resolve({ data: { requests: [] }, error: null });
    });
    await oeffne('/admin?bereich=kunden');
    await act(async () => { fireEvent.click(screen.getByText('Support-Ansicht')); });
    expect(aufrufe.map((a) => a.action)).toContain('get_customer_support_state');
    expect(screen.getByTestId('admin-support-ansicht')).toBeInTheDocument();
  });
  it('U12 — Founding Partner: Cockpit sichtbar', async () => {
    await oeffne('/admin?bereich=founding-partner');
    await waitFor(() => expect(aktionen()).toContain('fp_cockpit_overview'));
    expect(screen.getByTestId('bereich-founding-partner')).toHaveTextContent('Founding Partner');
  });
  it('U13 — Setup: offene Auftraege gelistet, Zaehler in der Navigation', async () => {
    await oeffne('/admin?bereich=setup');
    expect(screen.getByTestId('setup-liste')).toHaveTextContent('Setup Betrieb');
    expect(screen.getByLabelText('1 offen')).toBeInTheDocument();
  });
  it('U14 — Abmelden bleibt in jedem Bereich', async () => {
    await oeffne('/admin?bereich=setup');
    await act(async () => { fireEvent.click(screen.getByText('Abmelden')); });
    expect(abmelden).toHaveBeenCalled();
    expect(mockNavigiere).toHaveBeenCalledWith('/');
  });
  it('Nicht-Admin: kein Bereich, kein Aufruf', async () => {
    useAuthContext.mockImplementation(() => ({ isAdmin: false, signOut: abmelden, loading: false }));
    await oeffne('/admin?bereich=akquise');
    expect(sichtbar()).toEqual([]);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
