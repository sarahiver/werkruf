/**
 * Paket B — Analyse im Admin (GA4 + Search Console + Produkt-Funnel).
 *
 *   Z1–Z3  Zeitraeume: volle Tage bis gestern, Vorperiode gleich lang; GSC endet vor 3 Tagen
 *   A1–A4  Anfragen: nur Lesen, Funnel-Filter, keine personenbezogenen Dimensionen
 *   W1–W5  Auswertung GA4/GSC: zwei Zeitraeume, Veraenderung, Position umgekehrt, URL gekuerzt
 *   P1–P3  Produkt-Funnel aus Datenbankzeilen (Kohorte), bezahlt = hasPaidAccess
 *   K1–K3  Konfiguration: nur Secret-NAMEN, Service Account geprueft
 *   S1–S4  Server: Admin-Allowlist, nur lesende Scopes, Fehler ohne Rohdaten, Quellen unabhaengig
 *   U1–U6  Oberflaeche: Bereich, Zeitraum, Zustaende je Quelle, Funnel, Tabellen
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import {
  zeitraeume, ga4Anfragen, gscAnfragen, werteGa4Aus, werteGscAus, produktFunnel, veraenderung,
  fehlendeKonfiguration, leseServiceAccount, kuerzeUrl, pruefeZeitraum, FUNNEL_SCHRITTE, GOOGLE_SCOPES, berlinMitternachtUtc,
} from './utils/analyseBericht';
import { ADMIN_AKTIONEN, pruefeAnfrage } from './utils/adminOps';
import Analyse from './components/admin/Analyse';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ADMIN = { id: '00000000-0000-4000-8000-00000000ad01', app_metadata: { role: 'admin' } };

/* ───────── Zeitraeume ───────── */
describe('Zeitraeume', () => {
  it('Z1 — 28 Tage: volle Tage bis gestern, Vorperiode direkt davor, gleich lang', () => {
    expect(zeitraeume(28, '2026-11-12')).toMatchObject({
      aktuell: { start: '2026-10-15', end: '2026-11-11' },
      vorher: { start: '2026-09-17', end: '2026-10-14' },
    });
  });
  it('Z2 — GSC endet vor 3 Tagen, gleiche Laenge, Vorperiode davor', () => {
    const z = zeitraeume(7, '2026-11-12');
    expect(z.gsc).toEqual({ start: '2026-11-03', end: '2026-11-09' });
    expect(z.gscVorher).toEqual({ start: '2026-10-27', end: '2026-11-02' });
  });
  it('Z3 — nur 7/28/90; Berliner Mitternacht korrekt (Sommer/Winter)', () => {
    expect([7, 28, 90, '28'].map(pruefeZeitraum)).toEqual([7, 28, 90, 28]);
    expect([1, 30, 365, 'x', null].map(pruefeZeitraum)).toEqual([null, null, null, null, null]);
    expect(berlinMitternachtUtc('2026-11-12')).toBe('2026-11-11T23:00:00.000Z');
    expect(berlinMitternachtUtc('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
  });
});

/* ───────── Anfragen ───────── */
describe('Anfragen an Google', () => {
  const z = zeitraeume(28, '2026-11-12');
  it('A1 — GA4-Summen mit zwei Zeitraeumen, Funnel nur ueber die eigenen Ereignisse', () => {
    const a = ga4Anfragen(z);
    expect(a.summen.dateRanges).toEqual([{ startDate: '2026-10-15', endDate: '2026-11-11' }, { startDate: '2026-09-17', endDate: '2026-10-14' }]);
    expect(a.funnel.dimensionFilter.filter.inListFilter.values).toEqual(FUNNEL_SCHRITTE.map((s) => s.event));
  });
  it('A2 — kein smartcheck_* im Funnel (kein oeffentlicher SmartCheck live)', () => {
    expect(FUNNEL_SCHRITTE.map((s) => s.event).join()).not.toMatch(/smartcheck/);
  });
  it('A3 — keine personen- oder geraetebezogenen Dimensionen (Stadt, Nutzer-ID, Client-ID)', () => {
    const dims = JSON.stringify(ga4Anfragen(z));
    expect(dims).not.toMatch(/"city"|userId|clientId|"region"|landingPagePlusQueryString/);
  });
  it('A4 — GSC: endgueltige Daten, Fenster vor 3 Tagen, je 10 Anfragen/Seiten', () => {
    const g = gscAnfragen(z);
    expect(g.summen).toMatchObject({ dataState: 'final', startDate: z.gsc.start, endDate: z.gsc.end });
    expect(g.anfragen).toMatchObject({ dimensions: ['query'], rowLimit: 10 });
    expect(g.seiten).toMatchObject({ dimensions: ['page'], rowLimit: 10 });
  });
  it('Scopes nur lesend', () => {
    expect(GOOGLE_SCOPES.split(' ')).toEqual(['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly']);
  });
});

/* ───────── Auswertung ───────── */
const met = (...v) => v.map((x) => ({ value: String(x) }));
const GA4_ROH = {
  summen: { rows: [
    { dimensionValues: [{ value: 'date_range_0' }], metricValues: met(120, 150, 400, 0.62) },
    { dimensionValues: [{ value: 'date_range_1' }], metricValues: met(100, 160, 0, 0.5) },
  ] },
  verlauf: { rows: [
    { dimensionValues: [{ value: '20261110' }], metricValues: met(5, 6) },
    { dimensionValues: [{ value: '20261111' }], metricValues: met(7, 9) },
  ] },
  seiten: { rows: [{ dimensionValues: [{ value: '/pricing' }], metricValues: met(40, 30) }] },
  kanaele: { rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: met(80, 70) }] },
  geraete: { rows: [{ dimensionValues: [{ value: 'mobile' }], metricValues: met(90) }] },
  funnel: { rows: [
    { dimensionValues: [{ value: 'signup_start' }], metricValues: met(12, 10) },
    { dimensionValues: [{ value: 'checkout_success' }], metricValues: met(1, 1) },
  ] },
};
describe('Auswertung', () => {
  it('W1 — GA4-KPIs je Zeitraum, Veraenderung in %, Vorperiode 0 → kein Vergleich', () => {
    const r = werteGa4Aus(GA4_ROH);
    expect(r.kpis).toEqual([
      { label: 'Nutzer', wert: 120, vorher: 100, veraenderung: 20, format: 'zahl' },
      { label: 'Sitzungen', wert: 150, vorher: 160, veraenderung: -6.2, format: 'zahl' },
      { label: 'Seitenaufrufe', wert: 400, vorher: 0, veraenderung: null, format: 'zahl' },
      { label: 'Interaktionsrate', wert: 0.62, vorher: 0.5, veraenderung: 24, format: 'prozent' },
    ]);
  });
  it('W2 — Verlauf als ISO-Datum, Funnel in fester Reihenfolge, fehlende Schritte = 0', () => {
    const r = werteGa4Aus(GA4_ROH);
    expect(r.verlauf).toEqual([{ datum: '2026-11-10', nutzer: 5, sitzungen: 6 }, { datum: '2026-11-11', nutzer: 7, sitzungen: 9 }]);
    expect(r.funnel.map((f) => [f.event, f.anzahl])).toEqual([
      ['signup_start', 12], ['signup_complete', 0], ['google_connect_start', 0], ['google_connect_success', 0], ['checkout_start', 0], ['checkout_success', 1],
    ]);
  });
  it('W3 — leere/fehlende Antworten ergeben Nullen, keinen Absturz', () => {
    const r = werteGa4Aus({});
    expect(r.kpis.map((k) => k.wert)).toEqual([0, 0, 0, 0]);
    expect(r.verlauf).toEqual([]);
    expect(werteGscAus({}).kpis.map((k) => k.wert)).toEqual([0, 0, 0, 0]);
  });
  it('W4 — GSC: Klicks/Impressionen/CTR/Position, Position als „kleiner ist besser"', () => {
    const r = werteGscAus({
      summen: { rows: [{ clicks: 30, impressions: 1000, ctr: 0.03, position: 8.2 }] },
      summenVorher: { rows: [{ clicks: 20, impressions: 800, ctr: 0.025, position: 10 }] },
      anfragen: { rows: [{ keys: ['google profil handwerker'], clicks: 4, impressions: 50, ctr: 0.08, position: 6.1 }] },
      seiten: { rows: [{ keys: ['https://werkruf.com/pricing?x=1'], clicks: 3, impressions: 40, ctr: 0.075, position: 7 }] },
      verlauf: { rows: [{ keys: ['2026-11-01'], clicks: 2, impressions: 30 }] },
    });
    expect(r.kpis[0]).toMatchObject({ label: 'Klicks', wert: 30, veraenderung: 50 });
    expect(r.kpis[3]).toMatchObject({ label: 'Ø Position', wert: 8.2, veraenderung: -18, kleinerIstBesser: true });
    expect(r.anfragen[0].anfrage).toBe('google profil handwerker');
    expect(r.seiten[0].seite).toBe('/pricing');
    expect(r.verlauf).toEqual([{ datum: '2026-11-01', klicks: 2, impressionen: 30 }]);
  });
  it('W5 — veraenderung/kuerzeUrl Randfaelle', () => {
    expect(veraenderung(5, 0)).toBeNull();
    expect(veraenderung(0, 5)).toBe(-100);
    expect(kuerzeUrl('kaputt')).toBe('kaputt');
  });
});

/* ───────── Produkt-Funnel ───────── */
describe('Produkt-Funnel (Datenbank)', () => {
  const jetzt = new Date('2026-11-12T10:00:00Z');
  const profile = [
    { id: 'a', accepted_terms_at: '2026-11-01', plan: 'founding_partner' },
    { id: 'b', accepted_terms_at: '2026-11-02', plan: 'free', stripe_subscription_id: 'sub', stripe_subscription_status: 'active' },
    { id: 'c', accepted_terms_at: null, plan: 'free' },
    { id: 'd', accepted_terms_at: '2026-11-03', plan: 'free', stripe_subscription_id: 'sub2', stripe_subscription_status: 'canceled' },
  ];
  it('P1 — Kohorte: angelegt → Bedingungen → Google → bezahlt', () => {
    expect(produktFunnel(profile, new Set(['a', 'd', 'fremd']), jetzt).map((s) => [s.schritt, s.anzahl])).toEqual([
      ['registriert', 4], ['bedingungen', 3], ['google', 2], ['bezahlt', 2],
    ]);
  });
  it('P2 — bezahlt folgt hasPaidAccess (gekuendigtes Abo zaehlt nicht)', () => {
    expect(produktFunnel([profile[3]], new Set(), jetzt)[3].anzahl).toBe(0);
  });
  it('P3 — leere Kohorte', () => {
    expect(produktFunnel(null, new Set(), jetzt).map((s) => s.anzahl)).toEqual([0, 0, 0, 0]);
  });
});

/* ───────── Konfiguration ───────── */
describe('Konfiguration', () => {
  const SA = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' });
  it('K1 — nennt fehlende Secrets nur mit Namen', () => {
    expect(fehlendeKonfiguration({})).toEqual(['GA4_PROPERTY_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GSC_SITE_URL']);
    expect(fehlendeKonfiguration({ GA4_PROPERTY_ID: 'G-JEZZR2NLJ6', GOOGLE_SERVICE_ACCOUNT_JSON: SA, GSC_SITE_URL: 'sc-domain:werkruf.com' })).toEqual(['GA4_PROPERTY_ID']);
    expect(fehlendeKonfiguration({ GA4_PROPERTY_ID: '512345678', GOOGLE_SERVICE_ACCOUNT_JSON: SA, GSC_SITE_URL: 'sc-domain:werkruf.com' })).toEqual([]);
  });
  it('K2 — Service Account: nur gueltige Schluesseldatei', () => {
    expect(leseServiceAccount(SA)).toEqual({ clientEmail: 'sa@p.iam.gserviceaccount.com', privateKey: expect.stringContaining('PRIVATE KEY') });
    expect(leseServiceAccount('{kaputt')).toBeNull();
    expect(leseServiceAccount(JSON.stringify({ client_email: 'x' }))).toBeNull();
  });
  it('K3 — Mess-ID (G-…) wird als Property-ID abgelehnt (haeufige Verwechslung)', () => {
    expect(fehlendeKonfiguration({ GA4_PROPERTY_ID: 'G-JEZZR2NLJ6' })).toContain('GA4_PROPERTY_ID');
  });
});

/* ───────── Server ───────── */
describe('admin-ops', () => {
  it('S1 — analytics_overview: nur Admin, lesend, Zeitraum geprueft', () => {
    expect(ADMIN_AKTIONEN.analytics_overview).toEqual({ schreibt: false, parameter: ['zeitraum'] });
    expect(pruefeAnfrage({ authUser: { id: 'u', app_metadata: {} }, aktion: 'analytics_overview', parameter: { zeitraum: 28 } })).toMatchObject({ erlaubt: false, status: 403 });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'analytics_overview', parameter: { zeitraum: 90 } })).toMatchObject({ erlaubt: true, parameter: { zeitraum: 90 } });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'analytics_overview', parameter: {} })).toMatchObject({ erlaubt: true, parameter: { zeitraum: 28 } });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'analytics_overview', parameter: { zeitraum: 365 } }).erlaubt).toBe(false);
  });
  const a = ohneKommentare(lies('supabase/functions/admin-ops/analyse.ts'));
  it('S2 — nur GET-artige Lesezugriffe: runReport, searchAnalytics/query, select', () => {
    const roh = lies('supabase/functions/admin-ops/analyse.ts');
    expect([...new Set(roh.match(/https:\/\/[a-z0-9.]+\.googleapis\.com[^`'"\s]*/g))].sort()).toEqual([
      'https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport',
      'https://oauth2.googleapis.com/token',
      'https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query',
    ]);
    expect(a).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  });
  it('S3 — Fehler gehen nur als Code raus, nie Rohantwort, Schluessel oder Token', () => {
    expect(a).toMatch(/status: 'fehler', code: fehlerCode\(err\)/);
    expect(a).not.toMatch(/log\([^)]*(privateKey|private_key|access_token|token\b)/);
    expect(a).not.toMatch(/await r\.text\(\)/);
  });
  it('S4 — Quellen unabhaengig (Promise.all ueber drei try/catch-Bloecke), Cache nur bei Erfolg', () => {
    expect(a).toMatch(/Promise\.all\(\[ga4\(\), gsc\(\), produkt\(\)\]\)/);
    expect((a.match(/catch \(err\)/g) || []).length).toBe(3);
    expect(a).toMatch(/if \(g\.status !== 'fehler' && s\.status !== 'fehler' && pf\.status !== 'fehler'\) cache\.set/);
  });
  it('Admin-Fall ruft die Analyse nur ueber die Allowlist', () => {
    expect(lies('supabase/functions/admin-ops/index.ts')).toMatch(/case 'analytics_overview':\s*\n\s*return json\(await analyseUebersicht\(admin, parameter/);
  });
});

/* ───────── Oberflaeche ───────── */
const ANTWORT = {
  zeitraum: zeitraeume(28, '2026-11-12'),
  produkt: { status: 'ok', daten: produktFunnel([{ id: 'a', accepted_terms_at: 'x', plan: 'founding_partner' }, { id: 'b' }], new Set(['a'])) },
  ga4: { status: 'ok', daten: werteGa4Aus(GA4_ROH) },
  gsc: { status: 'nicht_konfiguriert', fehlt: ['GSC_SITE_URL'] },
};
describe('Analyse (UI)', () => {
  let ops;
  beforeEach(() => { ops = jest.fn(() => Promise.resolve(ANTWORT)); });
  const zeig = async () => { await act(async () => { render(<Analyse rufeAdminOps={ops} />); }); };

  it('U1 — laedt einmal mit 28 Tagen', async () => {
    await zeig();
    expect(ops).toHaveBeenCalledTimes(1);
    expect(ops).toHaveBeenCalledWith('analytics_overview', { zeitraum: 28 });
    expect(screen.getByTestId('analyse-zeitraum-28')).toHaveAttribute('aria-pressed', 'true');
  });
  it('U2 — Zeitraum wechseln laedt neu', async () => {
    await zeig();
    await act(async () => { fireEvent.click(screen.getByTestId('analyse-zeitraum-90')); });
    expect(ops).toHaveBeenLastCalledWith('analytics_overview', { zeitraum: 90 });
  });
  it('U3 — Produkt-Funnel mit Quoten', async () => {
    await zeig();
    const f = screen.getByTestId('analyse-produkt-funnel');
    expect(f).toHaveTextContent('Konto angelegt2');
    expect(f).toHaveTextContent('Bedingungen akzeptiert1 · 50 %');
  });
  it('U4 — GA4: KPIs mit Richtung in Worten, Verlauf, Seiten, Herkunft', async () => {
    await zeig();
    const kpis = screen.getAllByTestId('analyse-kpi');
    expect(kpis[0]).toHaveTextContent('120Nutzer▲ 20 % besser');
    expect(kpis[2]).toHaveTextContent('kein Vergleich');
    expect(screen.getByTestId('analyse-ga4-verlauf').querySelector('svg')).toHaveAttribute('aria-label', 'Nutzer je Tag');
    expect(screen.getByTestId('analyse-ga4-seiten')).toHaveTextContent('/pricing');
    expect(screen.getByTestId('analyse-ga4-kanaele')).toHaveTextContent('Organic Search');
  });
  it('U5 — nicht eingerichtete Quelle zeigt den fehlenden Secret-Namen, keine Fantasiezahlen', async () => {
    await zeig();
    expect(screen.getByTestId('analyse-gsc-nicht-eingerichtet')).toHaveTextContent('GSC_SITE_URL');
    expect(screen.queryByTestId('analyse-gsc-anfragen')).toBeNull();
  });
  it('U6 — Fehler einer Quelle mit Code; Gesamtfehler als Meldung', async () => {
    ops.mockImplementation(() => Promise.resolve({ ...ANTWORT, ga4: { status: 'fehler', code: 'ga4_403' } }));
    await zeig();
    expect(screen.getByTestId('analyse-ga4-fehler')).toHaveTextContent('ga4_403');
    expect(screen.getByTestId('analyse-produkt-funnel')).toBeInTheDocument();
    ops.mockImplementation(() => Promise.reject(new Error('Aktion fehlgeschlagen (500, x)')));
    await act(async () => { fireEvent.click(screen.getByText('Aktualisieren')); });
    await waitFor(() => expect(screen.getByTestId('analyse-fehler')).toHaveTextContent('Aktion fehlgeschlagen'));
  });
  it('Analyse ist nicht im GA-Tracking (Admin bleibt ausgeschlossen)', () => {
    const { analysePfad } = require('./utils/analytics');
    expect(analysePfad('/admin')).toBeNull();
  });
});
