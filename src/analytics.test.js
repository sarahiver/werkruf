/**
 * Paket A — Einwilligung + GA4 (Consent Mode Basic).
 *
 *   K1–K4   ohne Einwilligung / abgelehnt / ohne Mess-ID: kein Skript, kein dataLayer-Eintrag
 *   K5–K7   mit Einwilligung: genau ein Skript, page_view nur mit bereinigter URL
 *   P1–P4   Positivliste: Token-, Magic-Link-, Admin- und unbekannte Pfade senden nie
 *   P5      gesperrter Pfad nach dem Laden → Abschalt-Flag, kein page_view
 *   W1–W2   Widerruf: Flag + Cookies geloescht, danach nichts mehr
 *   E1–E4   Funnel: fester Katalog, feste Parameterwerte, nichts ohne Einwilligung
 *   B1–B5   Banner: gleichwertige Knoepfe, nicht auf gesperrten Seiten, Footer oeffnet
 *   Q1–Q3   Quellen: kein Google Fonts, kein globales Maps-Skript, kein GTM
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  analysePfad, leseConsent, speichereConsent, seitenwechsel, funnelEvent, bereinigeParameter,
  messungErlaubt, messId, FUNNEL, CONSENT_SCHLUESSEL, oeffneConsentEinstellungen, _zuruecksetzen,
} from './utils/analytics';

const ID = 'G-TEST123456';
const WURZEL = path.resolve(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

const skripte = () => [...document.querySelectorAll('script')].filter((s) => /googletagmanager|google-analytics/.test(s.src));
const eintraege = () => (window.dataLayer || []).map((a) => Array.from(a));
const pageViews = () => eintraege().filter((a) => a[0] === 'event' && a[1] === 'page_view').map((a) => a[2]);
const alleGesendetenWerte = () => JSON.stringify(eintraege());

function gehe(pfad) { window.history.pushState({}, '', pfad); }

beforeEach(() => {
  process.env.REACT_APP_GA4_MEASUREMENT_ID = ID;
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete window.dataLayer;
  _zuruecksetzen();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  gehe('/');
});
afterAll(() => { delete process.env.REACT_APP_GA4_MEASUREMENT_ID; });

/* ───────── Positivliste ───────── */
describe('analysePfad (Positivliste)', () => {
  it('oeffentliche Seiten, Funnel und Dashboard werden gemessen — ohne Slash am Ende', () => {
    for (const p of ['/', '/pricing', '/signup', '/login', '/impressum', '/datenschutz', '/onboarding', '/dashboard', '/dashboard/google', '/dashboard/einstellungen/']) {
      expect(analysePfad(p)).toBe(p.length > 1 ? p.replace(/\/$/, '') : p);
    }
  });
  it('P1 — Token-Seiten nie (Aufgaben-Link, FP-Interesse, Praesentation, Kurzlink)', () => {
    for (const p of ['/a/abc123TOKEN', '/founding-partner/TOKEN', '/p/fp/TOKEN', '/b/CODE', '/a/', '/founding-partner']) expect(analysePfad(p)).toBeNull();
  });
  it('P2 — Bestaetigungs-/Magic-Link-/Passwort-Seiten nie', () => {
    for (const p of ['/bestaetigen', '/einstieg', '/reset-password', '/link-abgelaufen', '/success']) expect(analysePfad(p)).toBeNull();
  });
  it('P3 — /admin nie, auch nicht Unterpfade', () => {
    for (const p of ['/admin', '/admin/', '/admin/irgendwas']) expect(analysePfad(p)).toBeNull();
  });
  it('P4 — unbekannte Pfade nie (neue Token-Routen sind ohne Zutun gesperrt)', () => {
    for (const p of ['/neu/TOKEN', '/dashboard/geheim', '/x', '', null, undefined]) expect(analysePfad(p)).toBeNull();
  });
  it('Kennungen im Pfad werden auf das Muster gekuerzt; Query und Fragment fallen weg', () => {
    expect(analysePfad('/empfehlen/ABC-123')).toBe('/empfehlen');
    expect(analysePfad('/dashboard/google?gbp=confirm&gbp_token=GEHEIM&gbp_email=a@b.de')).toBe('/dashboard/google');
    expect(analysePfad('/onboarding#access_token=GEHEIM')).toBe('/onboarding');
  });
});

/* ───────── Laden nur mit Einwilligung ───────── */
describe('GA4 laden', () => {
  it('K1 — noch nicht entschieden: kein Skript, kein dataLayer', () => {
    expect(seitenwechsel('/')).toBe(false);
    expect(skripte()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });
  it('K2 — abgelehnt: kein Skript, kein dataLayer, auf keiner Seite', () => {
    speichereConsent(false);
    for (const p of ['/', '/pricing', '/dashboard']) expect(seitenwechsel(p)).toBe(false);
    expect(skripte()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });
  it('K3 — ohne (gueltige) Mess-ID: nichts, auch mit Zustimmung', () => {
    speichereConsent(true);
    for (const id of ['', 'GTM-PJZ4XRL9', 'UA-1-1', 'G-<script>']) {
      process.env.REACT_APP_GA4_MEASUREMENT_ID = id;
      expect(messId()).toBeNull();
      expect(seitenwechsel('/')).toBe(false);
    }
    expect(skripte()).toHaveLength(0);
  });
  it('K4 — kaputter oder alter Consent-Eintrag zaehlt als „nicht entschieden"', () => {
    window.localStorage.setItem(CONSENT_SCHLUESSEL, '{kaputt');
    expect(leseConsent()).toBeNull();
    window.localStorage.setItem(CONSENT_SCHLUESSEL, JSON.stringify({ v: 0, analyse: true }));
    expect(leseConsent()).toBeNull();
    expect(seitenwechsel('/')).toBe(false);
  });
  it('K5 — mit Zustimmung: genau ein Skript, Consent Basic, keine Werbesignale', () => {
    speichereConsent(true);
    expect(seitenwechsel('/')).toBe(true);
    expect(seitenwechsel('/pricing')).toBe(true);
    expect(skripte()).toHaveLength(1);
    expect(skripte()[0].src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
    const consent = eintraege().find((a) => a[0] === 'consent');
    expect(consent).toEqual(['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    const config = eintraege().find((a) => a[0] === 'config');
    expect(config[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  });
  it('K6 — page_view traegt nur Origin + bereinigten Pfad, nie Query/Token/Mail', () => {
    speichereConsent(true);
    seitenwechsel('/dashboard/google?gbp=confirm&gbp_token=GEHEIMTOKEN&gbp_email=chef@betrieb.de');
    seitenwechsel('/empfehlen/WERB-CODE-42');
    expect(pageViews()).toEqual([
      expect.objectContaining({ page_location: 'http://localhost/dashboard/google', page_path: '/dashboard/google', page_title: '/dashboard/google' }),
      expect.objectContaining({ page_location: 'http://localhost/empfehlen', page_path: '/empfehlen' }),
    ]);
    expect(alleGesendetenWerte()).not.toMatch(/GEHEIMTOKEN|chef@betrieb|WERB-CODE|gbp_/);
  });
  it('K7 — Referrer nur als Origin', () => {
    Object.defineProperty(document, 'referrer', { value: 'https://mail.example/inbox?id=geheim', configurable: true });
    speichereConsent(true);
    seitenwechsel('/');
    expect(pageViews()[0].page_referrer).toBe('https://mail.example');
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  });
  it('P5 — nach dem Laden auf gesperrten Pfad: Abschalt-Flag an, kein page_view; zurueck: Flag aus', () => {
    speichereConsent(true);
    seitenwechsel('/dashboard');
    const vorher = pageViews().length;
    for (const p of ['/admin', '/a/TOKEN', '/bestaetigen']) {
      expect(seitenwechsel(p)).toBe(false);
      expect(window[`ga-disable-${ID}`]).toBe(true);
    }
    expect(pageViews()).toHaveLength(vorher);
    expect(seitenwechsel('/dashboard')).toBe(true);
    expect(window[`ga-disable-${ID}`]).toBe(false);
  });
  it('gesperrter Pfad beim ERSTEN Aufruf (Mail-Link, Admin): GA wird gar nicht geladen', () => {
    speichereConsent(true);
    for (const p of ['/a/TOKEN', '/founding-partner/TOKEN', '/admin', '/bestaetigen']) expect(seitenwechsel(p)).toBe(false);
    expect(skripte()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });
});

/* ───────── Widerruf ───────── */
describe('Widerruf', () => {
  it('W1 — Ablehnen nach Zustimmung: Flag an, GA-Cookies geloescht, nichts mehr gesendet', () => {
    speichereConsent(true);
    seitenwechsel('/');
    document.cookie = '_ga=GA1.1.123; path=/';
    document.cookie = `_ga_${ID.slice(2)}=GS1.1; path=/`;
    speichereConsent(false);
    expect(window[`ga-disable-${ID}`]).toBe(true);
    expect(document.cookie).not.toMatch(/_ga/);
    const vorher = eintraege().length;
    expect(seitenwechsel('/pricing')).toBe(false);
    expect(funnelEvent('signup_start', { method: 'email' })).toBe(false);
    expect(eintraege()).toHaveLength(vorher);
  });
  it('W2 — Entscheidung bleibt gespeichert (Version, Zeitpunkt), aber ohne personenbezogene Daten', () => {
    speichereConsent(true, new Date('2026-11-11T10:00:00Z'));
    expect(JSON.parse(window.localStorage.getItem(CONSENT_SCHLUESSEL))).toEqual({ v: 1, analyse: true, am: '2026-11-11T10:00:00.000Z' });
  });
});

/* ───────── Funnel ───────── */
describe('Funnel-Events', () => {
  it('E1 — Katalog enthaelt mindestens die acht geforderten Ereignisse', () => {
    expect(Object.keys(FUNNEL)).toEqual(expect.arrayContaining([
      'smartcheck_start', 'smartcheck_complete', 'signup_start', 'signup_complete',
      'google_connect_start', 'google_connect_success', 'checkout_start', 'checkout_success',
    ]));
  });
  it('E2 — nur erlaubte Parameter mit erlaubten Werten; unbekannte Ereignisse verworfen', () => {
    expect(bereinigeParameter('signup_start', { method: 'email', email: 'a@b.de', user_id: 'u1' })).toEqual({ method: 'email' });
    expect(bereinigeParameter('signup_start', { method: 'a@b.de' })).toEqual({});
    expect(bereinigeParameter('checkout_start', { plan: 'monthly', session_id: 'cs_x' })).toEqual({ plan: 'monthly' });
    expect(bereinigeParameter('google_connect_start', { reconnect: true, connectionId: 'c1' })).toEqual({ reconnect: true });
    expect(bereinigeParameter('beliebig', { a: 1 })).toBeNull();
  });
  it('E3 — ohne Einwilligung oder ungeladen: kein Event', () => {
    expect(funnelEvent('signup_start', { method: 'email' })).toBe(false);
    speichereConsent(true);
    expect(funnelEvent('signup_start', { method: 'email' })).toBe(false);   // GA noch nicht geladen
    expect(window.dataLayer).toBeUndefined();
  });
  it('E4 — mit Einwilligung auf erlaubtem Pfad: Event nur mit bereinigten Parametern; auf gesperrtem Pfad nicht', () => {
    speichereConsent(true);
    gehe('/signup');
    seitenwechsel('/signup');
    expect(funnelEvent('signup_start', { method: 'google', email: 'x@y.de' })).toBe(true);
    expect(eintraege().pop()).toEqual(['event', 'signup_start', { method: 'google', transport_type: 'beacon' }]);
    gehe('/admin');
    expect(messungErlaubt()).toBe(false);
    expect(funnelEvent('checkout_success')).toBe(false);
  });
});

/* ───────── Verdrahtung der Events (fachlicher Zustand) ───────── */
describe('Events haengen am fachlichen Zustand, nicht am Seitenaufruf', () => {
  const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('signup_start nach gueltigem Formular bzw. beim Google-Klick; signup_complete nach erstem accept_terms', () => {
    const su = ohneKommentare(lies('src/pages/Signup.js'));
    expect(su.indexOf("funnelEvent('signup_start', { method: 'email' })")).toBeGreaterThan(su.indexOf('if (Object.keys(fe).length)'));
    expect(su.indexOf("funnelEvent('signup_start', { method: 'email' })")).toBeLessThan(su.indexOf('await signUpEmail('));
    const ob = ohneKommentare(lies('src/pages/Onboarding.js'));
    const rpc = ob.indexOf("supabase.rpc('accept_terms'");
    const fehler = ob.indexOf('if (error)', rpc);
    expect(ob.indexOf("funnelEvent('signup_complete')")).toBeGreaterThan(fehler);
    expect(ob.slice(ob.indexOf('if (!schonZugestimmt)'), ob.indexOf("funnelEvent('signup_complete')"))).toMatch(/accept_terms/);
  });
  it('google_connect_start erst mit authUrl, success erst nach connect/confirm', () => {
    const g = ohneKommentare(lies('src/hooks/useGoogleBusiness.js'));
    expect(g.indexOf("funnelEvent('google_connect_start'")).toBeGreaterThan(g.indexOf("if (!data?.authUrl) throw"));
    expect(g.slice(g.indexOf("callFunction('connect/confirm'"), g.indexOf("funnelEvent('google_connect_success')"))).toMatch(/confirmationRequest\.then/);
  });
  it('checkout_start erst mit Stripe-URL; checkout_success erst bei bezahltem Zugang, einmal je Session', () => {
    const c = ohneKommentare(lies('src/hooks/useCheckout.js'));
    expect(c.indexOf("funnelEvent('checkout_start'")).toBeGreaterThan(c.indexOf("if (!data?.url) throw"));
    const d = ohneKommentare(lies('src/pages/dashboard/DashboardLayout.js'));
    expect(d.slice(d.indexOf("checkoutResult === 'success' && hasPaidAccess(profile)"), d.indexOf('meldeCheckoutErfolg(searchParams'))).not.toMatch(/return/);
    expect(d).toMatch(/gemeldeteCheckouts\.has\(schluessel\)/);
  });
  it('smartcheck_* ist katalogisiert, aber nirgends verdrahtet (kein oeffentlicher SmartCheck live)', () => {
    for (const f of ['src/pages/HomePage.js', 'src/pages/Signup.js', 'src/pages/Onboarding.js']) {
      expect(lies(f)).not.toMatch(/smartcheck_(start|complete)/);
    }
  });
});

/* ───────── Banner + Footer ───────── */
describe('Einwilligungs-Hinweis', () => {
  const { MemoryRouter } = jest.requireActual('react-router-dom');
  const CookieHinweis = require('./components/CookieHinweis').default;
  const zeig = (pfad) => { gehe(pfad); return render(<MemoryRouter initialEntries={[pfad]}><CookieHinweis /></MemoryRouter>); };

  it('B1 — erscheint auf erlaubter Seite, solange nicht entschieden; beide Knoepfe gleich', () => {
    zeig('/');
    const ab = screen.getByTestId('consent-ablehnen');
    const zu = screen.getByTestId('consent-zustimmen');
    expect(ab.className).toBe(zu.className);
    expect(ab.parentElement).toBe(zu.parentElement);
    expect(screen.getByTestId('consent-hinweis')).toHaveAttribute('aria-modal', 'false');
    expect(skripte()).toHaveLength(0);
  });
  it('B2 — Ablehnen: Hinweis weg, nichts geladen; Zustimmen: GA geladen, ein page_view', () => {
    zeig('/');
    fireEvent.click(screen.getByTestId('consent-ablehnen'));
    expect(screen.queryByTestId('consent-hinweis')).toBeNull();
    expect(skripte()).toHaveLength(0);
    expect(leseConsent()).toBe('abgelehnt');
  });
  it('B3 — Zustimmen laedt GA und misst die aktuelle Seite', () => {
    zeig('/pricing');
    act(() => { fireEvent.click(screen.getByTestId('consent-zustimmen')); });
    expect(skripte()).toHaveLength(1);
    expect(pageViews().map((p) => p.page_path)).toEqual(['/pricing']);
  });
  it('B4 — erscheint nicht auf Token-, Bestaetigungs- und Admin-Seiten', () => {
    for (const p of ['/a/TOKEN', '/founding-partner/TOKEN', '/bestaetigen', '/admin']) {
      const { unmount } = zeig(p);
      expect(screen.queryByTestId('consent-hinweis')).toBeNull();
      unmount();
    }
    expect(skripte()).toHaveLength(0);
  });
  it('B5 — „Cookie-Einstellungen" oeffnet ihn nach getroffener Wahl erneut und zeigt den Stand', () => {
    speichereConsent(false);
    zeig('/');
    expect(screen.queryByTestId('consent-hinweis')).toBeNull();
    act(() => { oeffneConsentEinstellungen(); });
    expect(screen.getByTestId('consent-hinweis')).toHaveTextContent('Aktuell: abgelehnt');
    act(() => { fireEvent.click(screen.getByTestId('consent-zustimmen')); });
    expect(leseConsent()).toBe('erteilt');
    expect(skripte()).toHaveLength(1);
  });
  it('ohne Mess-ID gibt es keinen Hinweis (nichts zu entscheiden)', () => {
    process.env.REACT_APP_GA4_MEASUREMENT_ID = '';
    zeig('/');
    expect(screen.queryByTestId('consent-hinweis')).toBeNull();
  });
  it('Footer: Knopf „Cookie-Einstellungen" nur mit Mess-ID, loest das Oeffnen aus', () => {
    const footer = lies('src/components/Footer.js');
    expect(footer).toMatch(/messId\(\) && \(/);
    expect(footer).toMatch(/onClick=\{oeffneConsentEinstellungen\}/);
  });
});

/* ───────── Quellen ───────── */
describe('Keine Drittanbieter-Requests ohne Bedarf', () => {
  it('Q1 — keine Google Fonts mehr (selbst ausgeliefert)', () => {
    for (const f of ['src/components/GlobalStyle.js', 'public/index.html']) expect(lies(f)).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(lies('src/index.js')).toMatch(/import '\.\/schriften'/);
  });
  it('Q2 — Maps-Skript nicht mehr global in index.html, nur ueber den Lader', () => {
    expect(lies('public/index.html')).not.toMatch(/maps\.googleapis\.com/);
    for (const f of ['src/components/PlacesSearch.js', 'src/components/dashboard/PlacesSearch.js']) expect(lies(f)).toMatch(/ladeGoogleMaps\(\);/);
  });
  it('Q3 — kein Google Tag Manager, kein zweiter Analytics-Weg', () => {
    const quellen = ['public/index.html', 'src/App.js', 'src/utils/analytics.js'].map(lies).join('\n');
    expect(quellen).not.toMatch(/gtm\.js|GTM-/);
    expect(lies('public/index.html')).not.toMatch(/googletagmanager/);
  });
});

/* ───────── Maps-Lader ───────── */
describe('ladeGoogleMaps', () => {
  const { ladeGoogleMaps, _zuruecksetzen: mapsZurueck } = require('./utils/googleMapsLader');
  beforeEach(() => { mapsZurueck(); delete window.google; });
  const maps = () => [...document.querySelectorAll('script')].filter((s) => /maps\.googleapis\.com/.test(s.src));
  it('ohne Schluessel: nichts geladen', async () => {
    await expect(ladeGoogleMaps({ key: '' })).resolves.toBe(false);
    expect(maps()).toHaveLength(0);
  });
  it('mit Schluessel: genau ein Skript, auch bei mehreren Aufrufen', () => {
    ladeGoogleMaps({ key: 'k1' });
    ladeGoogleMaps({ key: 'k1' });
    expect(maps()).toHaveLength(1);
    expect(maps()[0].src).toContain('libraries=places');
  });
  it('Seiten ohne Betriebssuche laden nichts: kein Aufruf ausser in PlacesSearch', () => {
    const treffer = ['src/App.js', 'src/pages/HomePage.js', 'src/pages/Impressum.js', 'src/pages/Datenschutz.js', 'src/pages/Admin.js']
      .filter((f) => /ladeGoogleMaps/.test(lies(f)));
    expect(treffer).toEqual([]);
  });
});

/* ───────── Rechtstexte ───────── */
describe('Rechtstexte', () => {
  const ds = lies('src/pages/Datenschutz.js');
  const im = lies('src/pages/Impressum.js');
  it('Datenschutz nennt jeden produktiven Empfaenger', () => {
    for (const d of ['Vercel', 'Supabase', 'Google Analytics 4', 'business.manage', 'Google Maps Platform', 'Anthropic', 'Cloudinary', 'Brevo', 'Stripe']) expect(ds).toContain(d);
  });
  it('Datenschutz nennt keine Dienste, die nicht produktiv laufen (Turnstile, Google Fonts als Empfaenger, GTM)', () => {
    const text = ds.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).not.toMatch(/Turnstile|Cloudflare|Tag Manager|fonts\.googleapis/);
    expect(ds).not.toMatch(/Art\. 6 Abs\. 1 lit\. f DSGVO[^.]*Google Analytics/);
  });
  it('Analytics: Einwilligung, Widerruf, kein Laden ohne Zustimmung', () => {
    expect(ds).toMatch(/Ohne Einwilligung wird Google Analytics nicht geladen/);
    expect(ds).toMatch(/lit\. a DSGVO, § 25 Abs\. 1 TDDDG/);
    expect(ds).toMatch(/onClick=\{oeffneConsentEinstellungen\}/);
  });
  it('Impressum: DDG und MStV statt TMG/RStV, keine OS-Plattform mehr, Daten aus einer Quelle', () => {
    expect(im).toMatch(/§ 5 DDG/);
    expect(im).toMatch(/§ 18 Abs\. 2 MStV/);
    expect(im).not.toMatch(/TMG|RStV|ec\.europa\.eu\/consumers\/odr/);
    expect(im).toMatch(/from '\.\.\/config\/anbieter'/);
    expect(ds).toMatch(/from '\.\.\/config\/anbieter'/);
  });
});
