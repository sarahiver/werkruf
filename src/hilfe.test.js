/**
 * Hilfe-Center + Changelog (12.11.2026).
 *
 *   R   Routing: jede Seite lädt, genau eine H1, nicht leer, Kernbegriffe
 *   S   SEO: eigener Titel/Description/Canonical, Sitemap, robots, kein noindex
 *   W   Feature-Truth: Aussagen gegen die Implementierung
 *   G1–G7  Gegenproben-Raster (verbotene Aussagen, kaputte Links)
 *   L   Landing-/Footer-Verweise, Analytics-Positivliste
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { getIndustryConfig } from './config/industryConfig';

jest.mock('./context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('./context/IndustryContext', () => ({ useIndustry: jest.fn() }));

const { useAuthContext } = require('./context/AuthContext');
const { useIndustry } = require('./context/IndustryContext');
const Hilfe = require('./pages/Hilfe').default;
const { HILFE_START_META } = require('./pages/Hilfe');
const HilfeArtikel = require('./pages/HilfeArtikel').default;
const { seitenTitel } = require('./pages/HilfeArtikel');
const Changelog = require('./pages/Changelog').default;
const { CHANGELOG_META } = require('./pages/Changelog');
const { HILFE_ARTIKEL, HILFE_SLUGS, HILFE_ABLAUF, HILFE_GRUPPEN, artikel } = require('./config/hilfe');
const { CHANGELOG } = require('./config/changelog');
const { analysePfad } = require('./utils/analytics');
const { HEALTH_WEIGHTS, calculateHealthScoreInputs } = require('./utils/healthScore');
const { EINWILLIGUNG_HINWEIS } = require('./utils/smsBewertung');
const { TARIFE } = require('./utils/tarife');

const lies = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const HW = getIndustryConfig('handwerk');

const PFLICHT_SLUGS = [
  'erste-schritte', 'google-profil-verbinden', 'google-rechte', 'bewertungen',
  'antwortvorschlaege', 'mehr-bewertungen', 'fotos-und-profildaten', 'wochenmail',
  'health-score', 'preise-und-kuendigung', 'datenschutz-google',
];

beforeEach(() => {
  useIndustry.mockReturnValue(HW);
  useAuthContext.mockReturnValue({ isAuthenticated: false });
  document.title = 'Start';
});
afterEach(cleanup);

const zeige = (pfad) => render(
  <MemoryRouter initialEntries={[pfad]}>
    <Routes>
      <Route path="/hilfe" element={<Hilfe />} />
      <Route path="/hilfe/:slug" element={<HilfeArtikel />} />
      <Route path="/changelog" element={<Changelog />} />
    </Routes>
  </MemoryRouter>,
);

/* ── Text-Sammlung fuer Raster-Pruefungen ─────────────────────── */
const alle = (a) => [
  a.titel, a.seoTitel, a.beschreibung, a.einleitung,
  ...a.abschnitte.flatMap((ab) => [ab.titel, ...(ab.schritte ?? []), ...(ab.liste ?? []), ...(ab.absaetze ?? [])]),
  ...(a.macht ?? []), ...(a.machtNicht ?? []),
];
/* „positiv" = alles ausser den ausdruecklichen Verneinungen in machtNicht */
const positiv = (a) => alle({ ...a, machtNicht: [] });
const POSITIV_TEXT = [
  ...HILFE_ARTIKEL.flatMap(positiv),
  ...HILFE_ABLAUF.flatMap((s) => [s.titel, s.text]),
  ...CHANGELOG.flatMap((m) => m.eintraege.flatMap((e) => [e.titel, e.text])),
].join('\n');
const GESAMT_TEXT = `${POSITIV_TEXT}\n${HILFE_ARTIKEL.flatMap((a) => a.machtNicht ?? []).join('\n')}`;

/* ── Routing ───────────────────────────────────────────────────── */
describe('Routing', () => {
  it('R1 — alle geforderten Detailseiten existieren', () => {
    expect([...HILFE_SLUGS].sort()).toEqual([...PFLICHT_SLUGS].sort());
  });

  it('R2 — /hilfe: H1, Subline, vier verlinkte Schritte, alle Gruppen', () => {
    zeige('/hilfe');
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('So funktioniert WERKRUF');
    expect(document.body.textContent).toMatch('Von der Anmeldung bis zur ersten Empfehlung: Hier findest du die wichtigsten Schritte und Funktionen kurz erklärt.');
    expect(HILFE_ABLAUF.map((s) => s.titel)).toEqual([
      'Konto erstellen', 'Google-Unternehmensprofil verbinden', 'WERKRUF prüft deinen Auftritt',
      'Du bekommst konkrete Hinweise und Antwortvorschläge',
    ]);
    for (const s of HILFE_ABLAUF) {
      const links = screen.getAllByRole('link', { name: new RegExp(s.titel) });
      expect(links.some((l) => l.getAttribute('href') === `/hilfe/${s.slug}` && l.closest('ol'))).toBe(true);
    }
    expect(HILFE_GRUPPEN.map((g) => g.titel)).toEqual([
      'Erste Schritte', 'Google & Verbindung', 'Bewertungen', 'Profil & Sichtbarkeit',
      'WERKRUF im Alltag', 'Konto & Preise', 'Datenschutz',
    ]);
    for (const g of HILFE_GRUPPEN) expect(screen.getAllByText(g.titel).length).toBeGreaterThan(0);
    /* Kontakt bleibt */
    expect(screen.getAllByText('info@werkruf.com').length).toBeGreaterThan(0);
  });

  it.each(PFLICHT_SLUGS)('R3 — /hilfe/%s lädt, eine H1, Inhalt, Navigation mit aktiver Seite', (slug) => {
    zeige(`/hilfe/${slug}`);
    const a = artikel(slug);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(a.titel);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent.length).toBeGreaterThan(800);
    const aktiv = document.querySelectorAll(`nav a.active[href="/hilfe/${slug}"]`);
    expect(aktiv.length).toBeGreaterThan(0);
    /* keine ungefuellten Platzhalter */
    expect(document.body.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('R4 — /changelog: H1, Monatsabschnitt, Kategorien', () => {
    zeige('/changelog');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getAllByText('Neu').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Verbessert').length).toBeGreaterThan(0);
  });

  it('R5 — unbekannter Slug → 404', () => {
    zeige('/hilfe/gibt-es-nicht');
    expect(screen.getByText(/existiert nicht/)).toBeInTheDocument();
  });

  it('R6 — Routen in App.js eingetragen (mit Layout)', () => {
    const app = lies('src/App.js');
    expect(app).toMatch(/<Route path="\/hilfe\/:slug" element={<HilfeArtikel Layout={PublicLayout} \/>} \/>/);
    expect(app).toMatch(/<Route path="\/changelog" element={\s*<PublicLayout><Changelog \/><\/PublicLayout>/);
  });

  it('R7 — Kernbegriffe je Seite', () => {
    const kern = {
      'erste-schritte': [/Bestätigungsmail/, /Mit Google anmelden/, /Nutzungsbedingungen/],
      'google-profil-verbinden': [/Verbindung erneuern/, /Betrieb aus/],
      'google-rechte': [/business\.manage/, /Behält WERKRUF die Kontrolle über mein Profil\?/],
      'bewertungen': [/1- oder 2-Sterne/, /Antwortquote/],
      'antwortvorschlaege': [/Antwort vorschlagen/, /Freigeben/],
      'mehr-bewertungen': [/Bewertungslink/, /QR-Code/, /SMS/, /Pro/],
      'fotos-und-profildaten': [/Öffnungszeiten/, /Profil-Wächter/, /Feiertag/],
      'wochenmail': [/Montag/, /ruhigen Wochen/, /Sofortmeldungen/],
      'health-score': [/Antwortquote/, /kein Google-Ranking/],
      'preise-und-kuendigung': [/Testphase/, /Kündigen/, /kostenlosen Modus/],
      'datenschutz-google': [/Datenschutzerklärung/, /Impressum/],
    };
    for (const [slug, muster] of Object.entries(kern)) {
      zeige(`/hilfe/${slug}`);
      for (const m of muster) expect([slug, document.body.textContent]).toEqual([slug, expect.stringMatching(m)]);
      cleanup();
    }
  });
});

/* ── SEO ───────────────────────────────────────────────────────── */
describe('SEO', () => {
  it('S1 — eigener Titel, Description und Canonical je Seite; alle verschieden', () => {
    const titel = new Set();
    const beschr = new Set();
    for (const slug of HILFE_SLUGS) {
      zeige(`/hilfe/${slug}`);
      expect(document.title).toBe(seitenTitel(artikel(slug)));
      const d = document.head.querySelector('meta[name="description"]').getAttribute('content');
      expect(d.length).toBeGreaterThan(70);
      expect(d.length).toBeLessThan(200);
      expect(d).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(`https://werkruf.com/hilfe/${slug}`);
      titel.add(document.title);
      beschr.add(d);
      cleanup();
    }
    zeige('/hilfe'); titel.add(document.title); expect(document.title).toBe(HILFE_START_META.titel); cleanup();
    zeige('/changelog'); titel.add(document.title); expect(document.title).toBe(CHANGELOG_META.titel);
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe('https://werkruf.com/changelog');
    cleanup();
    expect(titel.size).toBe(HILFE_SLUGS.length + 2);
    expect(beschr.size).toBe(HILFE_SLUGS.length);
  });

  it('S2 — beim Verlassen wird der vorherige Titel wiederhergestellt', () => {
    document.title = 'WERKRUF — Start';
    zeige('/hilfe/google-rechte');
    cleanup();
    expect(document.title).toBe('WERKRUF — Start');
  });

  it('S3 — Sitemap enthält alle Hilfeseiten und /changelog; /preise → /pricing korrigiert', () => {
    const sitemap = lies('public/sitemap.xml');
    for (const slug of HILFE_SLUGS) expect(sitemap).toContain(`<loc>https://werkruf.com/hilfe/${slug}</loc>`);
    expect(sitemap).toContain('<loc>https://werkruf.com/hilfe</loc>');
    expect(sitemap).toContain('<loc>https://werkruf.com/changelog</loc>');
    expect(sitemap).toContain('<loc>https://werkruf.com/pricing</loc>');
    expect(sitemap).not.toContain('/preise<');
  });
});

/* ── Feature-Truth ─────────────────────────────────────────────── */
describe('Feature-Truth', () => {
  const text = (slug) => alle(artikel(slug)).join('\n');

  it('W1 — SMS: Hinweistext wörtlich aus der Implementierung, manueller Versand', () => {
    expect(text('mehr-bewertungen')).toContain(EINWILLIGUNG_HINWEIS);
    expect(lies('src/components/dashboard/SmsBewertungsanfrage.js')).toMatch(/EINWILLIGUNG_HINWEIS/);
    expect(text('mehr-bewertungen')).toMatch(/jede Anfrage löst du selbst aus/);
  });

  it('W2 — QR-Code und Pro-Gate existieren im Dashboard', () => {
    const seite = lies('src/pages/dashboard/DashboardKundenGewinnung.js');
    expect(seite).toMatch(/QRCodeSVG/);
    expect(seite).toMatch(/<ProGate feature="Mehr Bewertungen">/);
    expect(text('mehr-bewertungen')).toMatch(/Teil von Pro/);
  });

  it('W3 — Antwortvorschläge: Knopf „Antwort vorschlagen", Freigabe-Endpunkt, Hinweis bei heiklen Bewertungen', () => {
    const ui = lies('src/pages/dashboard/DashboardBewertungen.js');
    expect(ui).toMatch(/Antwort vorschlagen/);
    expect(ui).toMatch(/requiresHumanReview/);
    expect(lies('supabase/functions/generate-review-reply/index.ts')).toMatch(/reviewerName/);
    expect(lies('supabase/functions/google-business/index.ts')).toMatch(/replies\/approve|'approve'/);
    expect(text('antwortvorschlaege')).toMatch(/Erst wenn du auf „Freigeben" klickst/);
  });

  it('W4 — kritische Meldung: eigene Mail für 1–2 Sterne, auch im Free-Modus', () => {
    const mail = lies('supabase/functions/send-email/index.ts');
    expect(mail).toMatch(/critical_review_alert/);
    expect(mail).toMatch(/critical_review_free/);
    expect(text('bewertungen')).toMatch(/1- oder 2-Sterne-Bewertung wartet WERKRUF nicht bis Montag/);
  });

  it('W5 — Wochenmail: montags, auch ohne Aufgaben („Alles geprüft")', () => {
    expect(lies('src/utils/wochenstatus.js')).toMatch(/ok_no_actions/);
    expect(lies('supabase/migrations/20261005200000_weekly_location_context.sql')).toMatch(/extract\(isodow from p_now\) = 1/);
    expect(text('wochenmail')).toMatch(/Die Wochenmail kommt jeden Montag\. Gibt es nichts zu tun, steht das drin/);
  });

  it('W6 — Google-Verbindung: angefragte Scopes = dokumentierte Scopes', () => {
    const gb = lies('supabase/functions/google-business/index.ts');
    expect(gb).toMatch(/const GBP_SCOPE = 'https:\/\/www\.googleapis\.com\/auth\/business\.manage';/);
    expect(gb).toMatch(/const REQUESTED_SCOPES = \[GBP_SCOPE, 'openid', 'email'\];/);
    const rechte = text('google-rechte');
    const dokumentiert = [...rechte.matchAll(/technisch: ([a-z., ]+)\)/g)].flatMap((m) => m[1].split(/,\s*/));
    expect(dokumentiert.sort()).toEqual(['business.manage', 'email', 'openid']);
    /* Trennen widerruft bei Google und loescht die Tokens */
    expect(gb).toMatch(/GOOGLE_REVOKE_ENDPOINT/);
    expect(gb).toMatch(/\.from\(TOKENS\)\.delete\(\)/);
  });

  it('W7 — Health Score: Gewichte im Text = HEALTH_WEIGHTS, kein Ranking', () => {
    const t = text('health-score');
    const LABEL = { responseRate: 'Antwortquote', rating: 'Bewertung', recency: 'Aktualität', completeness: 'Profilangaben', photos: 'Fotos' };
    expect(Object.keys(HEALTH_WEIGHTS).sort()).toEqual(Object.keys(LABEL).sort());
    for (const [k, w] of Object.entries(HEALTH_WEIGHTS)) expect(t).toContain(`${LABEL[k]} — bis ${w} Punkte`);
    /* Verhalten der dokumentierten Schwellen */
    const tag = 864e5;
    const jetzt = Date.UTC(2026, 10, 12);
    const r = (newest, rating, photoCount) => calculateHealthScoreInputs({
      stats: { totalReviews: 1, unanswered: 0, averageRating: rating, newestReviewAt: new Date(jetzt - newest * tag).toISOString(), photoCount },
      location: { primary_phone: 'x', website_uri: 'x', locality: 'x', primary_category: 'x' }, now: jetzt,
    }).points;
    expect(r(30, 3, 5)).toMatchObject({ rating: 0, recency: HEALTH_WEIGHTS.recency, photos: HEALTH_WEIGHTS.photos, completeness: HEALTH_WEIGHTS.completeness });
    expect(r(181, 5, 4)).toMatchObject({ rating: HEALTH_WEIGHTS.rating, recency: 0 });
    expect(r(181, 5, 4).photos).toBeLessThan(HEALTH_WEIGHTS.photos);
    expect(t).toMatch(/3 Sternen \(0 Punkte\) bis 5 Sterne/);
    expect(t).toMatch(/bis 30 Tage voll[^)]*nach 180 Tagen keine Punkte/);
    expect(t).toMatch(/ab 5 Fotos voll/);
    expect(t).toMatch(/kein Google-Ranking/);
  });

  it('W8 — Preise aus tarife.js, nicht hart im Text', () => {
    zeige('/hilfe/preise-und-kuendigung');
    const body = document.body.textContent;
    expect(body).toContain(`${TARIFE.monthly.betragCents / 100} € pro Monat`);
    expect(body).toContain(`${TARIFE.yearly.betragCents / 100} € pro Jahr`);
    expect(body).toContain('98 €');
    expect(JSON.stringify(artikel('preise-und-kuendigung'))).not.toMatch(/49 €|490 €|98 €/);
  });

  it('W9 — Kündigung: Free-Modus statt Löschung (alte falsche FAQ-Antwort korrigiert)', () => {
    expect(lies('docs/operations/free-downgrade.md')).toMatch(/Kündigung: nichts geht verloren/);
    const hilfe = lies('src/pages/Hilfe.js');
    expect(hilfe).not.toMatch(/Dein Konto und die dazugehörigen Daten werden gelöscht/);
    expect(hilfe).toMatch(/Dein Konto wechselt in den kostenlosen Modus/);
  });

  it('W10 — Unternehmensname nicht über WERKRUF änderbar (so dokumentiert)', () => {
    expect(lies('src/utils/profilDiff.js')).toMatch(/'title':\s+\{ prio: 'kritisch', label: 'Unternehmensname',\s+patch: false/);
    expect(text('fotos-und-profildaten')).toMatch(/Den Unternehmensnamen änderst du weiterhin bei Google selbst/);
  });
});

/* ── Gegenproben-Raster ────────────────────────────────────────── */
describe('Gegenproben-Raster', () => {
  it('G1 — kein automatischer Bewertungsversand behauptet', () => {
    expect(POSITIV_TEXT).not.toMatch(/(verschickt|sendet|schickt|versendet)\s+(WERKRUF\s+)?(die\s+)?(Anfragen?\s+|SMS\s+|Bewertungsanfragen?\s+)?automatisch/i);
    expect(POSITIV_TEXT).not.toMatch(/automatisch(e|er|en)?\s+(Bewertungs)?(anfrage|versand|SMS)/i);
  });
  it('G2 — keine automatische Veröffentlichung von Antworten behauptet', () => {
    /* Satzweise: „veröffentlich…" + „automatisch" ohne Verneinung im selben Satz */
    const saetze = POSITIV_TEXT.split(/[.\n;—]/);
    const treffer = saetze.filter((x) => /veröffentlich/i.test(x) && /automatisch|von selbst|selbstständig/i.test(x) && !/\b(nicht|nichts|nie|kein|keine)\b/i.test(x));
    expect(treffer).toEqual([]);
  });
  it('G3 — keine Ranking- oder Ergebnisgarantie', () => {
    expect(GESAMT_TEXT).not.toMatch(/(garantiert|garantieren|verspricht|versprechen)\s+(dir\s+)?(mehr|bessere|eine bessere|Platz|ein|das|Top|Sichtbarkeit|Ranking)/i);
    expect(GESAMT_TEXT).not.toMatch(/Platz\s*1|ganz oben bei Google|besser ranken|Ranking verbessert/i);
  });
  it('G4 — Wochenmail nicht „nur bei Aufgaben"', () => {
    expect(GESAMT_TEXT).not.toMatch(/nur,?\s+(dann|wenn|bei|falls)[^.\n]{0,40}(etwas zu tun|was zu tun|Aufgaben?)/i);
    expect(GESAMT_TEXT).not.toMatch(/(nur|ausschließlich) bei (offenen )?Aufgaben/i);
  });
  it('G5 — keine nicht existierende Google-Berechtigung', () => {
    expect(POSITIV_TEXT).not.toMatch(/\b(gmail|business\.readonly|calendar\.|contacts\.|drive\.|userinfo\.profile)/i);
    const technisch = [...POSITIV_TEXT.matchAll(/technisch: ([a-z., ]+)\)/g)].flatMap((m) => m[1].split(/,\s*/));
    for (const s of technisch) expect(['business.manage', 'openid', 'email']).toContain(s);
  });
  it('G6 — kein noindex für Hilfe/Changelog', () => {
    for (const f of ['public/index.html', 'src/hooks/useSeitenMeta.js', 'src/pages/Hilfe.js', 'src/pages/HilfeArtikel.js', 'src/pages/Changelog.js', 'src/components/hilfe/HilfeBausteine.js']) {
      expect([f, lies(f)]).toEqual([f, expect.not.stringMatching(/noindex/i)]);
    }
    const robots = lies('public/robots.txt');
    expect(robots).not.toMatch(/Disallow:\s*\/(hilfe|changelog)/);
    zeige('/hilfe/wochenmail');
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });
  it('G7 — jeder interne Hilfe-Link zeigt auf eine existierende Seite', () => {
    const app = lies('src/App.js');
    const routen = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
    const ziele = [
      ...[...JSON.stringify(HILFE_ARTIKEL).matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]),
      ...HILFE_ARTIKEL.flatMap((a) => (a.verwandt ?? []).map((s) => `/hilfe/${s}`)),
      ...HILFE_ABLAUF.map((s) => `/hilfe/${s.slug}`),
      ...CHANGELOG.flatMap((m) => m.eintraege.filter((e) => e.hilfe).map((e) => `/hilfe/${e.hilfe}`)),
      '/hilfe/erste-schritte', '/hilfe/google-rechte', // Landing
    ];
    expect(ziele.length).toBeGreaterThan(20);
    for (const z of ziele) {
      const ok = z.startsWith('/hilfe/') ? HILFE_SLUGS.includes(z.slice(7)) : routen.has(z);
      expect([z, ok]).toEqual([z, true]);
    }
  });
});

/* ── Landing, Footer, Analytics ────────────────────────────────── */
describe('Verweise', () => {
  it('L1 — Landing: zwei dezente Links, nur Handwerk', () => {
    const es = lies('src/components/ExampleScore.js');
    expect(es).toMatch(/key === 'handwerk' && \(\s*<DetailLink to="\/hilfe\/erste-schritte">\s*So funktioniert WERKRUF im Detail/);
    const f = lies('src/components/Features.js');
    expect(f).toMatch(/key === 'handwerk' && \(\s*<RechteLink to="\/hilfe\/google-rechte">Welche Google-Rechte braucht WERKRUF\?/);
  });
  it('L2 — Footer: Hilfe und Changelog bei WERKRUF', () => {
    expect(HW.copy.footer.links).toEqual(expect.arrayContaining([
      { label: 'Hilfe', href: '/hilfe' }, { label: 'Changelog', href: '/changelog' },
    ]));
    expect(getIndustryConfig('gastro').copy.footer.links.map((l) => l.label)).not.toContain('Changelog');
  });
  it('L3 — Analytics-Positivliste kennt die neuen öffentlichen Pfade', () => {
    for (const slug of HILFE_SLUGS) expect(analysePfad(`/hilfe/${slug}`)).toBe(`/hilfe/${slug}`);
    expect(analysePfad('/changelog')).toBe('/changelog');
    expect(analysePfad('/hilfe/unbekannt')).toBeNull();
  });
});
