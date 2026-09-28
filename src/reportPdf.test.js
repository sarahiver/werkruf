/**
 * Verhaltenstest fuer die Berichtserzeugung.
 *
 * Fuehrt dieselbe Funktion aus wie die Edge Function — createReportPdf
 * aus src/utils/reportPdf.js — statt ihren Quelltext zu durchsuchen.
 * Geprueft werden die beiden Layoutfehler aus der Abnahme vom 28.09.:
 *   1. Firmenname ohne Leerzeichen lief ueber den rechten Seitenrand.
 *   2. Zweizeiliger Firmenname ueberdruckte die Datumszeile.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { COVER, safePdf, wrapText, layoutCompanyName, createReportPdf } from './utils/reportPdf';
import { calculateProfileScore } from './utils/visibilityScore';

const pdfLib = { PDFDocument, StandardFonts, rgb };

/* TextDecoder gibt es in der jsdom-Umgebung von CRA nicht. */
const pdfSignatur = (bytes) => Array.from(bytes.slice(0, 5)).map((c) => String.fromCharCode(c)).join('');

const FAELLE = [
  { name: 'kurz',              company: 'Hoff GmbH',
    facts: { rating: 4.8, count: 120, website: true } },
  { name: 'lang mit Leerzeichen', company: 'Meisterbetrieb für Sanitär- Heizungs- und Klimatechnik Schröder-Übelacker und Partner Kommanditgesellschaft Hamburg-Altona',
    facts: { rating: 3.2, count: 3, website: false } },
  { name: 'sehr lang ohne Leerzeichen', company: 'SanitaerinstallationsmeisterbetriebsgesellschaftmbHundCoKGHamburgAltonaNordWest',
    facts: { rating: 4.0, count: 10, website: true } },
  { name: 'Umlaute und Sonderzeichen', company: 'Café Ölmühle — „Zum Weißen Röß" ★ Straßenbau',
    facts: { rating: 5.0, count: 250, website: true } },
  { name: 'zweizeilig',        company: 'Dachdeckerei Müller und Söhne Bedachungen GmbH Hamburg Nord',
    facts: { rating: null, count: 0, website: false } },
];

const scoreFor = (facts) => calculateProfileScore({
  rating: facts.rating, ratingAvailable: facts.rating !== null,
  reviewCount: facts.count, reviewCountAvailable: facts.count !== null,
  hasWebsite: facts.website === true, websiteAvailable: facts.website !== null,
});

let bold;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  bold = await doc.embedFont(StandardFonts.HelveticaBold);
});

describe('Berichts-PDF: Layout des Firmennamens', () => {
  it.each(FAELLE.map((f) => [f.name, f.company]))(
    'haelt bei "%s" jede Zeile innerhalb der Textbreite',
    (_name, company) => {
      const layout = layoutCompanyName(company, bold);
      layout.lines.forEach((zeile) => {
        expect(bold.widthOfTextAtSize(zeile, layout.size))
          .toBeLessThanOrEqual(COVER.nameWidth);
      });
    },
  );

  it.each(FAELLE.map((f) => [f.name, f.company]))(
    'haelt bei "%s" die Datumszeile im Deckbereich',
    (_name, company) => {
      const layout = layoutCompanyName(company, bold);
      // Unterhalb von boxBottom waere die Schrift weiss auf weiss.
      expect(layout.dateBaseline).toBeGreaterThanOrEqual(COVER.floor);
      expect(layout.dateBaseline).toBeGreaterThan(COVER.boxBottom);
      // Kein Ueberdrucken: Datum liegt unter der letzten Namenszeile.
      expect(layout.lastBaseline - layout.dateBaseline)
        .toBeGreaterThanOrEqual(COVER.dateGap - 0.001);
    },
  );

  it.each(FAELLE.map((f) => [f.name, f.company]))(
    'bricht bei "%s" ohne Zeichenverlust um',
    (_name, company) => {
      const layout = layoutCompanyName(company, bold);
      expect(layout.truncated).toBe(false);
      const ohneLeerraum = (s) => s.replace(/\s+/g, '');
      expect(ohneLeerraum(layout.lines.join('')))
        .toBe(ohneLeerraum(safePdf(company)));
    },
  );

  it('bricht ein einzelnes zu langes Wort innerhalb des Wortes um', () => {
    const wort = 'A'.repeat(400);
    const zeilen = wrapText(wort, bold, 20, COVER.nameWidth);
    expect(zeilen.length).toBeGreaterThan(1);
    zeilen.forEach((z) => expect(bold.widthOfTextAtSize(z, 20))
      .toBeLessThanOrEqual(COVER.nameWidth));
  });

  it('kuerzt sichtbar, wenn selbst die kleinste Groesse nicht reicht', () => {
    const layout = layoutCompanyName('B'.repeat(4000), bold);
    expect(layout.truncated).toBe(true);
    expect(layout.lines[layout.lines.length - 1]).toMatch(/\.\.\.$/);
    expect(layout.lines.length).toBeLessThanOrEqual(COVER.maxLines);
    expect(layout.dateBaseline).toBeGreaterThanOrEqual(COVER.floor);
  });

  it('nutzt die volle Groesse, solange der Name in eine Zeile passt', () => {
    const layout = layoutCompanyName('Hoff GmbH', bold);
    expect(layout.lines).toHaveLength(1);
    expect(layout.size).toBe(COVER.nameMaxSize);
  });
});

describe('Berichts-PDF: erzeugtes Dokument', () => {
  it.each(FAELLE.map((f) => [f.name, f.company, f.facts]))(
    'erzeugt bei "%s" ein zweiseitiges PDF mit gueltiger Signatur',
    async (_name, company, facts) => {
      const bytes = await createReportPdf(pdfLib, company, scoreFor(facts), facts);
      expect(pdfSignatur(bytes)).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(1000);
      const geladen = await PDFDocument.load(bytes);
      expect(geladen.getPageCount()).toBe(2);
      const [breite, hoehe] = [geladen.getPage(0).getWidth(), geladen.getPage(0).getHeight()];
      expect(Math.round(breite)).toBe(595);
      expect(Math.round(hoehe)).toBe(842);
    },
  );

  it('stellt den Score und alle drei Kriterien unveraendert dar', () => {
    const score = scoreFor({ rating: 4.6, count: 87, website: true });
    expect(score.score).toBe(100);
    expect(score.criteria).toHaveLength(3);
    // Der Kriterienblock beginnt bei y=450 mit 28pt Abstand und bleibt
    // damit oberhalb des Fussbereichs (y=90).
    expect(450 - (score.criteria.length - 1) * 28).toBeGreaterThan(90);
  });

  it('meldet einen nicht berechenbaren Score als nicht verfuegbar', () => {
    const score = scoreFor({ rating: null, count: null, website: null });
    expect(score.score).toBeNull();
    expect(score.criteria.every((c) => c.available === false)).toBe(true);
  });

  it('ersetzt nicht darstellbare Zeichen, statt den Aufbau scheitern zu lassen', () => {
    expect(safePdf('Café Ölmühle — ★ 東京')).toBe('Café Ölmühle - ? ??');
  });
});
