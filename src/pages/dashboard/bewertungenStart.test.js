/**
 * Bewertungsseite — Startzustand, Deep-Link, verlinkte Bewertung (WP4)
 *
 * T1 Standard: ausgewaehlter Betrieb + unbeantwortet + neueste
 * T2 „Alle Betriebe“ bleibt waehlbar
 * T3 Query ueberschreibt Defaults
 * T4 fremder Betrieb in der Adresse wird ignoriert
 * T5 ?review=R → Bewertung sichtbar, markiert, angescrollt
 * T6 Review fehlt → Hinweis, kein Crash
 * T7 Review bereits beantwortet → echter Zustand
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* ── Supabase-Attrappe: zeichnet jede Abfrage auf google_reviews auf ── */
const aufrufe = [];
let reviewsAntwort;          // Liste fuer die Seitenabfrage
let einzelAntwort;           // Zeile fuer .eq('id', …).maybeSingle()

function mockKette(tabelle) {
  const q = { tabelle, filter: [], orders: [], _single: false };
  const proxy = new Proxy(q, {
    get(ziel, name) {
      if (name === 'then') {
        aufrufe.push(ziel);
        let ergebnis;
        if (tabelle === 'google_reviews') {
          ergebnis = ziel._single
            ? { data: einzelAntwort, error: null }
            : { data: reviewsAntwort, error: null, count: reviewsAntwort.length };
        } else if (tabelle === 'review_replies') {
          ergebnis = { data: [], error: null };
        } else if (tabelle === 'google_locations') {
          ergebnis = { data: mockOrte, error: null };
        } else ergebnis = { data: [], error: null };
        return (res) => Promise.resolve(ergebnis).then(res);
      }
      if (name === 'maybeSingle') return () => { ziel._single = true; return proxy; };
      return (...args) => { ziel.filter.push([String(name), ...args]); return proxy; };
    },
  });
  return proxy;
}
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: {
    from: (t) => mockKette(t),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('../../context/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'u1' }, profile: { plan: 'pro' } }) }));
jest.mock('../../context/IndustryContext', () => ({ useIndustry: () => ({ brand: { name: 'WERKRUF' } }) }));
jest.mock('../../hooks/useBetriebsname', () => ({ useBetriebsname: () => ({ name: 'S&I' }) }));
jest.mock('../../hooks/useGoogleBusinessData', () => ({
  useGoogleBusinessData: () => ({ locations: mockOrte, loading: false }),
}));
jest.mock('../../hooks/useAusgewaehlterStandort', () => ({
  useAusgewaehlterStandort: () => ({ standort: { id: 'loc-si', title: 'S&I' }, grund: 'ausgewaehlt', anzahl: 2, loading: false, fehler: false }),
}));

const mockOrte = [
  { id: 'loc-si', title: 'S&I', locality: 'Hamburg', selected_at: '2026-10-23T08:00:00Z' },
  { id: 'loc-wr', title: 'WERKRUF', locality: 'Harburg', selected_at: null },
];
const bewertung = (id, u = {}) => ({
  id, location_id: 'loc-si', star_rating: 2, comment: `Kommentar ${id}`, reviewer_display_name: `Kunde ${id}`,
  google_created_at: '2026-10-20T10:00:00Z', is_answered: false, answered_at: null, status: 'active', ...u,
});

import DashboardBewertungen, { leiteStartfilterAb } from './DashboardBewertungen';

const zeige = (url = '/dashboard/bewertungen') => render(<MemoryRouter initialEntries={[url]}><DashboardBewertungen /></MemoryRouter>);
const seitenAbfrage = () => aufrufe.find((a) => a.tabelle === 'google_reviews' && !a._single);
const hatFilter = (a, name, ...args) => a.filter.some((f) => f[0] === name && args.every((x, i) => f[i + 1] === x));

beforeEach(() => {
  aufrufe.length = 0;
  reviewsAntwort = [bewertung('r1'), bewertung('r2')];
  einzelAntwort = null;
  Element.prototype.scrollIntoView = jest.fn();
});

/* ── reine Funktion ── */
describe('leiteStartfilterAb', () => {
  const eigene = ['loc-si', 'loc-wr'];
  const p = (s) => new URLSearchParams(s);
  it('T1 — ohne Parameter: ausgewaehlter Betrieb, offen, neueste', () => {
    expect(leiteStartfilterAb({ params: p(''), eigeneLocationIds: eigene, ausgewaehlteId: 'loc-si' }))
      .toEqual({ locationId: 'loc-si', answered: 'open', sort: 'newest', reviewId: null, betriebIgnoriert: false });
  });
  it('T3 — Query ueberschreibt: eigener Betrieb B, status=alle', () => {
    expect(leiteStartfilterAb({ params: p('betrieb=loc-wr&status=alle'), eigeneLocationIds: eigene, ausgewaehlteId: 'loc-si' }))
      .toMatchObject({ locationId: 'loc-wr', answered: 'all' });
    expect(leiteStartfilterAb({ params: p('betrieb=alle'), eigeneLocationIds: eigene, ausgewaehlteId: 'loc-si' }).locationId).toBe('all');
  });
  /* ── GEGENPROBE ── */
  it('T4 — fremder Betrieb wird NICHT uebernommen', () => {
    const r = leiteStartfilterAb({ params: p('betrieb=loc-fremd&status=offen'), eigeneLocationIds: eigene, ausgewaehlteId: 'loc-si' });
    expect(r.locationId).toBe('loc-si');
    expect(r.betriebIgnoriert).toBe(true);
  });
  it('nimmt nur UUID-foermige review-IDs an', () => {
    expect(leiteStartfilterAb({ params: p('review=<script>'), eigeneLocationIds: eigene, ausgewaehlteId: 'loc-si' }).reviewId).toBeNull();
    expect(leiteStartfilterAb({ params: p('review=11111111-2222-4333-8444-555555555555'), eigeneLocationIds: eigene, ausgewaehlteId: 'loc-si' }).reviewId)
      .toBe('11111111-2222-4333-8444-555555555555');
  });
  it('ohne Auswahl und ohne Parameter: alle Betriebe (nichts raten)', () => {
    expect(leiteStartfilterAb({ params: p(''), eigeneLocationIds: eigene, ausgewaehlteId: null }).locationId).toBe('all');
  });
});

/* ── Seite ── */
describe('Bewertungsseite', () => {
  it('T1 — fragt standardmaessig den ausgewaehlten Betrieb und nur Unbeantwortete ab, neueste zuerst', async () => {
    zeige();
    await screen.findByText('Kommentar r1');
    const a = seitenAbfrage();
    expect(hatFilter(a, 'eq', 'location_id', 'loc-si')).toBe(true);
    expect(hatFilter(a, 'eq', 'is_answered', false)).toBe(true);
    expect(a.filter.some((f) => f[0] === 'order' && f[1] === 'google_created_at' && f[2]?.ascending === false)).toBe(true);
    expect(screen.getByTestId('filter-zeile')).toHaveTextContent(/S&I · Unbeantwortet · Neueste zuerst/);
  });

  it('T2 — „Alle Betriebe“ bleibt waehlbar und schaltet die Abfrage um', async () => {
    zeige();
    await screen.findByText('Kommentar r1');
    const select = screen.getByDisplayValue('S&I');
    expect(within(select).getByRole('option', { name: 'Alle Betriebe' })).toBeInTheDocument();
    aufrufe.length = 0;
    fireEvent.change(select, { target: { value: 'all' } });
    await waitFor(() => expect(seitenAbfrage()).toBeTruthy());
    expect(hatFilter(seitenAbfrage(), 'eq', 'location_id', 'loc-si')).toBe(false);
  });

  /* ── GEGENPROBE ── */
  it('T4 — fremde betrieb-ID in der Adresse landet nicht in der Abfrage', async () => {
    zeige('/dashboard/bewertungen?betrieb=loc-fremd');
    await screen.findByText('Kommentar r1');
    const a = seitenAbfrage();
    expect(hatFilter(a, 'eq', 'location_id', 'loc-fremd')).toBe(false);
    expect(hatFilter(a, 'eq', 'location_id', 'loc-si')).toBe(true);
    expect(screen.getByText(/gehört nicht zu deinem Konto/)).toBeInTheDocument();
  });

  it('T5 — ?review=R ausserhalb der Seite: gezielt geladen, oben angeheftet, markiert, angescrollt', async () => {
    const R = '11111111-2222-4333-8444-555555555555';
    einzelAntwort = bewertung(R, { comment: 'Die verlinkte' });
    zeige(`/dashboard/bewertungen?review=${R}`);
    const karte = await screen.findByTestId('verlinkte-bewertung');
    expect(karte).toHaveTextContent('Die verlinkte');
    expect(karte).toHaveTextContent(/Verlinkte Bewertung/);
    /* genau eine gezielte Abfrage, kein Blaettern */
    const einzel = aufrufe.filter((a) => a.tabelle === 'google_reviews' && a._single);
    expect(einzel).toHaveLength(1);
    expect(hatFilter(einzel[0], 'eq', 'id', R)).toBe(true);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    /* Die Liste dahinter ist unveraendert da */
    expect(screen.getByText('Kommentar r1')).toBeInTheDocument();
  });

  it('T5b — ?review=R auf der Seite: markiert, nicht doppelt', async () => {
    const R = '11111111-2222-4333-8444-555555555555';
    reviewsAntwort = [bewertung(R, { comment: 'Steht schon da' }), bewertung('r2')];
    zeige(`/dashboard/bewertungen?review=${R}`);
    const karte = await screen.findByTestId('verlinkte-bewertung');
    expect(karte).toHaveTextContent('Steht schon da');
    expect(screen.getAllByText('Steht schon da')).toHaveLength(1);
    expect(aufrufe.filter((a) => a.tabelle === 'google_reviews' && a._single)).toHaveLength(0);
  });

  /* ── GEGENPROBE ── */
  it('T6 — Review fehlt: Hinweis, normale Liste, kein Crash, kein Nachladen in Schleife', async () => {
    einzelAntwort = null;
    zeige('/dashboard/bewertungen?review=11111111-2222-4333-8444-555555555555');
    expect(await screen.findByTestId('verlinkt-fehlt')).toHaveTextContent(/nicht gefunden oder ist bereits erledigt/);
    expect(screen.getByText('Kommentar r1')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(aufrufe.filter((a) => a.tabelle === 'google_reviews' && a._single)).toHaveLength(1);
  });

  it('T7 — Review bereits beantwortet: wird gezeigt, mit echtem Zustand, kein „offen“ erzwungen', async () => {
    const R = '11111111-2222-4333-8444-555555555555';
    einzelAntwort = bewertung(R, { comment: 'Schon erledigt', is_answered: true, answered_at: '2026-10-22T10:00:00Z' });
    zeige(`/dashboard/bewertungen?review=${R}`);
    const karte = await screen.findByTestId('verlinkte-bewertung');
    expect(karte).toHaveTextContent(/bereits beantwortet/);
    /* Der Filter bleibt „unbeantwortet“ — der Link ist Navigation, keine Wahrheit */
    expect(hatFilter(seitenAbfrage(), 'eq', 'is_answered', false)).toBe(true);
  });
});
