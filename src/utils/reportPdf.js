/**
 * Erzeugung des oeffentlichen Google-Profil-Berichts.
 *
 * Bewusst hier und nicht in der Edge Function: Produktivcode und Tests
 * sollen dieselbe Funktion ausfuehren. Die Function importiert diese
 * Datei relativ (wie bereits visibilityScore.js), Jest importiert sie
 * direkt. Deshalb reines JavaScript ohne eigene Importe — pdf-lib wird
 * hereingereicht, weil Deno es ueber npm: und Node ueber node_modules
 * aufloest.
 *
 * Die Layoutberechnung nutzt die tatsaechlichen Schriftmetriken
 * (font.widthOfTextAtSize). Feste Zeichengrenzen waeren keine
 * Layoutberechnung, sondern eine Wette auf durchschnittliche
 * Zeichenbreiten — und genau daran sind die beiden Fehler entstanden,
 * die diese Fassung behebt:
 *
 *   1. Ein Firmenname ohne Leerzeichen lief ueber den rechten
 *      Seitenrand. pdf-lib bricht bei maxWidth nur an Wortgrenzen; ein
 *      einzelnes langes Wort wird nicht umbrochen.
 *   2. Ein zweizeiliger Firmenname ueberdruckte die Datumszeile, weil
 *      diese auf einer festen Hoehe stand.
 */

/* ─────────────────────────────────────────────
   DARSTELLBARE ZEICHEN

   Die eingebetteten Standardschriften koennen WinAnsi. Alles darueber
   hinaus wird ersetzt, statt den Aufbau scheitern zu lassen.
───────────────────────────────────────────── */
export const safePdf = (value) => String(value ?? '')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/* ─────────────────────────────────────────────
   MASSE DES DECKBEREICHS
───────────────────────────────────────────── */
export const COVER = {
  pageWidth:   595.28,
  pageHeight:  841.89,
  marginLeft:  42,
  /** Navy-Kasten: y 660 bis 842. Darunter ist der Hintergrund weiss. */
  boxBottom:   660,
  /** Unterkante fuer die Datumszeile — mit Luft fuer die Unterlaenge. */
  floor:       672,
  /** Grundlinie der ersten Namenszeile. */
  nameTop:     716,
  nameWidth:   510,
  nameMaxSize: 20,
  nameMinSize: 11,
  /** Zeilenabstand als Vielfaches der Schriftgroesse. */
  lineFactor:  1.18,
  maxLines:    3,
  dateSize:    9,
  /** Abstand zwischen letzter Namenszeile und Datum. */
  dateGap:     15,
};

/* ─────────────────────────────────────────────
   UMBRUCH

   Bricht an Wortgrenzen und, wo noetig, INNERHALB eines Wortes. Ohne
   den zweiten Fall laeuft ein Firmenname ohne Leerzeichen aus der
   Seite — pdf-lib bricht dort nicht um.

   Kein Trennstrich: ein eingefuegtes Zeichen wuerde den Firmennamen
   veraendern. Fuegt man die Zeilen ohne Leerraum zusammen, entsteht
   wieder die Vorlage; genau das prueft der Test.
───────────────────────────────────────────── */
export function wrapText(text, font, size, maxWidth) {
  const passt = (s) => font.widthOfTextAtSize(s, size) <= maxWidth;

  /** Ein Wort, das allein zu breit ist, zeichenweise zerlegen. */
  const wortBrechen = (wort) => {
    const teile = [];
    let akt = '';
    for (const zeichen of wort) {
      if (akt && !passt(akt + zeichen)) { teile.push(akt); akt = zeichen; }
      else akt += zeichen;
    }
    if (akt) teile.push(akt);
    return teile;
  };

  const zeilen = [];
  let akt = '';

  for (const wort of String(text).split(/\s+/).filter(Boolean)) {
    const probe = akt ? `${akt} ${wort}` : wort;

    if (passt(probe)) { akt = probe; continue; }

    if (akt) { zeilen.push(akt); akt = ''; }

    if (passt(wort)) { akt = wort; continue; }

    const teile = wortBrechen(wort);
    zeilen.push(...teile.slice(0, -1));
    akt = teile[teile.length - 1] ?? '';
  }

  if (akt) zeilen.push(akt);
  return zeilen.length ? zeilen : [''];
}

/* ─────────────────────────────────────────────
   LAYOUT DES FIRMENNAMENS

   Sucht die groesste Schriftgroesse, bei der der vollstaendige Name in
   hoechstens maxLines Zeilen passt UND die Datumszeile oberhalb der
   Unterkante des Deckbereichs bleibt.

   Erst wenn selbst die kleinste Groesse nicht reicht, wird gekuerzt —
   sichtbar mit "..." statt stillschweigend.
───────────────────────────────────────────── */
export function layoutCompanyName(text, font, optionen = {}) {
  const o = { ...COVER, ...optionen };
  const sauber = safePdf(text).trim();

  for (let size = o.nameMaxSize; size >= o.nameMinSize; size -= 1) {
    const zeilen = wrapText(sauber, font, size, o.nameWidth);
    if (zeilen.length > o.maxLines) continue;

    const zeilenhoehe   = size * o.lineFactor;
    const letzteGrund   = o.nameTop - (zeilen.length - 1) * zeilenhoehe;
    const datumGrund    = letzteGrund - o.dateGap;

    if (datumGrund >= o.floor) {
      return {
        lines: zeilen, size, lineHeight: zeilenhoehe,
        firstBaseline: o.nameTop, lastBaseline: letzteGrund,
        dateBaseline: datumGrund, truncated: false,
      };
    }
  }

  /* Rueckfallebene: kleinste Groesse, auf maxLines gekuerzt. */
  const size        = o.nameMinSize;
  const alle        = wrapText(sauber, font, size, o.nameWidth);
  const zeilen      = alle.slice(0, o.maxLines);
  const gekuerzt    = alle.length > o.maxLines;
  if (gekuerzt) {
    const letzte = zeilen[zeilen.length - 1];
    let kurz = letzte;
    while (kurz && font.widthOfTextAtSize(`${kurz}...`, size) > o.nameWidth) {
      kurz = kurz.slice(0, -1);
    }
    zeilen[zeilen.length - 1] = `${kurz}...`;
  }

  const zeilenhoehe = size * o.lineFactor;
  const letzteGrund = o.nameTop - (zeilen.length - 1) * zeilenhoehe;
  return {
    lines: zeilen, size, lineHeight: zeilenhoehe,
    firstBaseline: o.nameTop, lastBaseline: letzteGrund,
    dateBaseline: Math.max(letzteGrund - o.dateGap, o.floor),
    truncated: gekuerzt,
  };
}

/* ─────────────────────────────────────────────
   BERICHT

   Inhalte, Reihenfolge und Wortlaut unveraendert gegenueber der
   Vorfassung. Geaendert ist ausschliesslich die Platzierung von
   Firmenname und Datum im Deckbereich.
───────────────────────────────────────────── */
export async function createReportPdf(pdfLib, company, score, facts) {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;

  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(.043, .145, .271), orange = rgb(.949, .549, .157), gray = rgb(.35, .4, .46);

  const page = doc.addPage([COVER.pageWidth, COVER.pageHeight]);
  page.drawRectangle({ x: 0, y: 660, width: 595.28, height: 182, color: navy });
  page.drawRectangle({ x: 0, y: 836, width: 595.28, height: 6, color: orange });
  page.drawText('WERKRUF', { x: 42, y: 790, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText('OEFFENTLICHER GOOGLE-PROFIL-BERICHT', { x: 42, y: 744, size: 11, font: bold, color: orange });

  /* Firmenname und Datum dynamisch — siehe layoutCompanyName. */
  const layout = layoutCompanyName(company, bold);
  layout.lines.forEach((zeile, i) => page.drawText(zeile, {
    x: 42, y: layout.firstBaseline - i * layout.lineHeight,
    size: layout.size, font: bold, color: rgb(1, 1, 1),
  }));
  page.drawText(`Erstellt am ${new Date().toLocaleDateString('de-DE')}`, {
    x: 42, y: layout.dateBaseline, size: COVER.dateSize, font, color: rgb(.8, .84, .88),
  });

  page.drawText('Umfang des Checks', { x: 42, y: 620, size: 13, font: bold, color: navy });
  const available = [
    `Bewertung: ${facts.rating ?? 'nicht verfuegbar'}`,
    `Rezensionen: ${facts.count ?? 'nicht verfuegbar'}`,
    `Website: ${facts.website === null ? 'nicht verfuegbar' : facts.website ? 'verknuepft' : 'nicht verknuepft'}`,
  ];
  available.forEach((v, i) => page.drawText(safePdf(v), { x: 54, y: 590 - i * 24, size: 10, font, color: gray }));

  page.drawText(score.score === null ? 'Score: nicht verfuegbar' : `Vorlaeufiger Profil-Score: ${score.score} / 100`,
    { x: 42, y: 490, size: 18, font: bold, color: navy });

  let y = 450;
  score.criteria.forEach((c) => {
    page.drawText(safePdf(`${c.label} (${c.weight}%): ${c.available ? `${c.points}/${c.weight}` : 'nicht verfuegbar'} - ${c.detail}`),
      { x: 42, y, size: 9, font, color: gray, maxWidth: 510 });
    y -= 28;
  });

  page.drawText('Eigene WERKRUF-Auswertung; kein Google-Ranking und keine Messung der Sichtbarkeit.',
    { x: 42, y: 90, size: 8, font, color: gray, maxWidth: 510 });
  page.drawText('Quelle der geprueften Profildaten: Google Maps / Places API.',
    { x: 42, y: 70, size: 8, font, color: gray });

  const page2 = doc.addPage([COVER.pageWidth, COVER.pageHeight]);
  page2.drawRectangle({ x: 0, y: 836, width: 595.28, height: 6, color: orange });
  page2.drawText('Konkrete naechste Schritte', { x: 42, y: 780, size: 20, font: bold, color: navy });

  const actions = [];
  if (facts.website === false) actions.push('Eine verlässliche Website im Unternehmensprofil verknuepfen.');
  if (facts.count !== null && facts.count < 5) actions.push('Zufriedene Kundschaft ohne Anreiz um ehrliches Feedback bitten.');
  if (facts.rating !== null && facts.rating < 4) actions.push('Feedback aus niedrigen Bewertungen pruefen und sachlich reagieren.');
  actions.push('Profilangaben regelmaessig auf Aktualitaet kontrollieren.');
  actions.slice(0, 3).forEach((a, i) => {
    page2.drawText(`${i + 1}.`, { x: 42, y: 720 - i * 80, size: 16, font: bold, color: orange });
    page2.drawText(safePdf(a), { x: 75, y: 722 - i * 80, size: 11, font, color: navy, maxWidth: 460 });
  });

  page2.drawText('Erst nach einer autorisierten Google-Business-Verbindung kann WERKRUF unter anderem',
    { x: 42, y: 420, size: 10, font: bold, color: navy });
  page2.drawText('verwaltete Standorte, Rezensionstexte, Antworten und weitere nicht oeffentliche Betriebsdaten pruefen.',
    { x: 42, y: 400, size: 9, font, color: gray, maxWidth: 510 });
  page2.drawText('Die oeffentliche Places-Auswahl ist kein Nachweis der Verwaltungsberechtigung.',
    { x: 42, y: 365, size: 9, font, color: gray });

  return doc.save();
}
