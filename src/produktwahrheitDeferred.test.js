/**
 * Produktwahrheit fuer zurueckgestellte Pakete (WP11 Mitbewerber, WP12
 * Fragen & Antworten) — docs/operations/roadmap-deferred.md.
 *
 * Kein sichtbarer Produkttext darf etwas versprechen, das es nicht
 * gibt. Kommentare und Roadmap-Notizen duerfen das Thema nennen —
 * deshalb werden hier String-Literale und JSX-Text geprueft, nicht
 * Kommentare.
 */
import fs from 'fs';
import path from 'path';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
/* Kommentare entfernen (Block und Zeile), damit Roadmap-Notizen nicht zaehlen. */
const ohneKommentare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SICHTBARE_QUELLEN = [
  'components/PricingCard.js',
  'components/dashboard/ProGate.js',
  'components/SmartCheck.js',
  'config/industryConfig.js',
  'pages/Pricing.js',
  'pages/HomePage.js',
  'utils/wochenstatus.js',
  'templates/reportEmail.js',
];

describe('WP11 deferred — kein Wettbewerber-Feature versprochen', () => {
  it('PricingCard: „Wettbewerber-Monitoring" ist raus, kein Ersatzclaim', () => {
    const src = ohneKommentare(lies('components/PricingCard.js'));
    expect(src).not.toMatch(/Wettbewerber|Mitbewerber|Konkurrenz-?(Analyse|Check|Monitoring)/i);
    expect(src).not.toMatch(/Markt-?(Analyse|Beobachtung)|Benchmark/i);
  });
  it('SmartCheck: kein Schein-Schritt „Wettbewerb prüfen", keine „Wettbewerber-Analyse" im Report-Versprechen', () => {
    const src = ohneKommentare(lies('components/SmartCheck.js'));
    expect(src).not.toMatch(/Wettbewerb/i);
    expect(src).not.toMatch(/Mitbewerber/i);
  });
  it('Keine sichtbare Quelle verspricht Wettbewerber-Monitoring/-Analyse/-Check', () => {
    for (const q of SICHTBARE_QUELLEN) {
      const src = ohneKommentare(lies(q));
      expect(src).not.toMatch(/Wettbewerber-?\s?(Monitoring|Analyse|Check|Vergleich)/i);
      expect(src).not.toMatch(/Mitbewerber-?\s?(Monitoring|Analyse|Check|Vergleich)/i);
    }
  });
});

describe('WP12 deferred — Fragen & Antworten nicht versprochen', () => {
  it('Wochenmail nennt Fragen & Antworten als nicht geprueft; kein Pruefpunkt dazu', () => {
    const w = lies('utils/wochenstatus.js');
    const geprueft = w.slice(w.indexOf('export const GEPRUEFT'), w.indexOf(']);', w.indexOf('export const GEPRUEFT')));
    expect(geprueft).not.toMatch(/Fragen/);
  });
  it('Kein sichtbarer Produkttext verspricht Q&A-Ueberwachung oder -Antworten', () => {
    for (const q of SICHTBARE_QUELLEN) {
      const src = ohneKommentare(lies(q));
      expect(src).not.toMatch(/Fragen\s*&\s*Antworten|Fragen und Antworten|Q&A/);
    }
  });
  it('Keine Q&A-Endpunkte im Code (API seit 2025-11-03 abgeschaltet)', () => {
    const gb = lies('../supabase/functions/google-business/index.ts');
    expect(gb).not.toMatch(/mybusinessqanda\.googleapis\.com|\/questions\b|questions\.answers/);
  });
});

describe('Dokumentation', () => {
  it('roadmap-deferred.md fuehrt WP11 und WP12 mit Grund und Wiederaufnahme-Bedingung', () => {
    const d = lies('../docs/operations/roadmap-deferred.md');
    expect(d).toMatch(/## WP11 Mitbewerber-Ereignisse — deferred/);
    expect(d).toMatch(/## WP12 Fragen & Antworten — deferred/);
    expect(d).toMatch(/discontinued on November 3,\s*2025/);
    expect(d).toMatch(/Wieder aufnehmen, wenn:/);
    expect(d).not.toMatch(/Scraping-Lösung bauen|HTML parsen und/);
  });
});
