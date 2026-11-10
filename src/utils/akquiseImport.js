/*
 * Lead-Import (WP16.1) — CSV lesen und Zeilen aufbereiten.
 *
 * Geteilt zwischen Browser (Admin: Datei lesen, Vorschau anzeigen),
 * admin-ops (Deno: CSV-Import UND externe Lead-Inbox) und Jest.
 *
 * EIN Pfad fuer beide Eingaenge:
 *   Zeilen → bereiteImportVor() (bestehender Lead-Kanon pruefeLeadEingabe)
 *          → SQL acquisition_import_rows() (Dedupe, verbindlich)
 *
 * Der Browser parst die Datei nur, damit er Header-Fehler sofort zeigen
 * kann. Was angelegt wird, entscheidet der Server: admin-ops ruft
 * bereiteImportVor() selbst noch einmal auf, der Browser kann nichts
 * „vorvalidiert" einschmuggeln.
 */

import { pruefeLeadEingabe } from './akquise.js';

/* Spalten, die in Lead-Felder gehen (Reihenfolge = Vorlage). */
export const IMPORT_SPALTEN = Object.freeze([
  'company_name', 'contact_person', 'email', 'phone', 'trade', 'city', 'website',
  'google_profile_url', 'personalized_sentence', 'note', 'source',
]);
/* Workflow-Spalten einer externen Liste: werden gelesen und ignoriert,
   nie in Lead-Felder uebernommen. */
export const IGNORIERTE_SPALTEN = Object.freeze(['import_status', 'imported_at', 'werkruf_lead_id']);
export const PFLICHT_SPALTEN = Object.freeze(['company_name', 'email']);
export const CSV_VORLAGE_KOPF = [...IMPORT_SPALTEN, ...IGNORIERTE_SPALTEN].join(',');

export const MAX_ZEILEN = 1000;
export const MAX_DATEI_BYTES = 2 * 1024 * 1024;
const MAX_QUELLE = 60;

export const IMPORT_STATUS = Object.freeze(['new', 'duplicate', 'duplicate_in_import', 'possible_duplicate', 'invalid']);
export const IMPORT_STATUS_TEXT = Object.freeze({
  new: 'Neu',
  duplicate: 'Dublette',
  duplicate_in_import: 'Doppelt in der Datei',
  possible_duplicate: 'Prüfen',
  invalid: 'Fehler',
});

/* ── Trennzeichen erkennen: nur in der Kopfzeile, nur ausserhalb von Quotes. ── */
export function erkenneTrennzeichen(text) {
  let inQuote = false; let komma = 0; let semikolon = 0;
  for (let k = 0; k < text.length; k += 1) {
    const c = text[k];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && (c === '\n' || c === '\r')) break;
    if (!inQuote && c === ',') komma += 1;
    if (!inQuote && c === ';') semikolon += 1;
  }
  return semikolon > komma ? ';' : ',';
}

/**
 * RFC-4180-Parser: BOM, CRLF/LF/CR, Quotes, "" als Quote, Trennzeichen
 * und Zeilenumbrueche in Quotes, leere Zellen. Kein split(',').
 * @returns {string[][]} Zeilen mit Zellen (Rohtext)
 */
export function parseCsv(roh, trennzeichen) {
  let text = typeof roh === 'string' ? roh : '';
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const t = trennzeichen || erkenneTrennzeichen(text);
  const zeilen = [];
  let zeile = []; let zelle = ''; let inQuote = false; let k = 0;
  while (k < text.length) {
    const c = text[k];
    if (inQuote) {
      if (c === '"') {
        if (text[k + 1] === '"') { zelle += '"'; k += 2; continue; }
        inQuote = false; k += 1; continue;
      }
      zelle += c; k += 1; continue;
    }
    if (c === '"' && zelle === '') { inQuote = true; k += 1; continue; }
    if (c === t) { zeile.push(zelle); zelle = ''; k += 1; continue; }
    if (c === '\r' || c === '\n') {
      zeile.push(zelle); zeilen.push(zeile); zeile = []; zelle = '';
      if (c === '\r' && text[k + 1] === '\n') k += 1;
      k += 1; continue;
    }
    zelle += c; k += 1;
  }
  if (zelle !== '' || zeile.length > 0) { zeile.push(zelle); zeilen.push(zeile); }
  return zeilen;
}

const normKopf = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_');

/**
 * CSV-Text → Rohzeilen als Objekte (nur bekannte Spalten).
 * Zeilennummer i = Zeile in der Datei (Kopf = 1), damit der Admin sie findet.
 * @returns {{ok:true, zeilen:Array<{i:number, roh:object}>, unbekannteSpalten:string[], trennzeichen:string}
 *          |{ok:false, fehler:string}}
 */
export function csvZuZeilen(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, fehler: 'Die Datei ist leer.' };
  const trennzeichen = erkenneTrennzeichen(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  const alle = parseCsv(text, trennzeichen);
  if (alle.length === 0) return { ok: false, fehler: 'Die Datei ist leer.' };
  const kopf = alle[0].map(normKopf);
  const fehlend = PFLICHT_SPALTEN.filter((p) => !kopf.includes(p));
  if (fehlend.length) {
    return { ok: false, fehler: `Pflichtspalten fehlen: ${fehlend.join(', ')}. Erwartet wird die Kopfzeile: ${CSV_VORLAGE_KOPF}` };
  }
  const doppelt = kopf.filter((h, idx) => h && kopf.indexOf(h) !== idx);
  if (doppelt.length) return { ok: false, fehler: `Spalte mehrfach vorhanden: ${[...new Set(doppelt)].join(', ')}` };
  const unbekannteSpalten = kopf.filter((h) => h && !IMPORT_SPALTEN.includes(h) && !IGNORIERTE_SPALTEN.includes(h));

  const zeilen = [];
  for (let z = 1; z < alle.length; z += 1) {
    const zellen = alle[z];
    if (zellen.every((c) => String(c).trim() === '')) continue;   // Leerzeile
    const roh = {};
    kopf.forEach((h, idx) => { if (IMPORT_SPALTEN.includes(h)) roh[h] = zellen[idx] ?? ''; });
    zeilen.push({ i: z + 1, roh });
  }
  if (zeilen.length === 0) return { ok: false, fehler: 'Die Datei enthält keine Datenzeilen.' };
  if (zeilen.length > MAX_ZEILEN) return { ok: false, fehler: `Höchstens ${MAX_ZEILEN} Zeilen je Import (Datei: ${zeilen.length}).` };
  return { ok: true, zeilen, unbekannteSpalten, trennzeichen };
}

/**
 * Rohzeilen → aufbereitete Zeilen fuer acquisition_import_rows.
 * Nutzt den bestehenden Lead-Kanon (pruefeLeadEingabe, Pflichtfelder,
 * Mail-Normalisierung, Laengen, http(s)-URLs). Leere Zellen = nicht gesetzt.
 * @param {Array<{i:number, roh:object}>} zeilen
 * @returns {Array<{i:number, werte:object|null, quelle:string|null, fehler:string|null}>}
 */
export function bereiteImportVor(zeilen) {
  if (!Array.isArray(zeilen)) return [];
  return zeilen.slice(0, MAX_ZEILEN).map((z, idx) => {
    const i = Number.isInteger(z?.i) && z.i > 0 ? z.i : idx + 1;
    const roh = z && typeof z.roh === 'object' && z.roh !== null ? z.roh : (z && typeof z === 'object' ? z : {});
    const eingabe = {};
    for (const f of ['company_name', 'contact_person', 'email', 'phone', 'trade', 'city', 'website', 'google_profile_url', 'personalized_sentence', 'note']) {
      const v = roh[f];
      if (v === undefined || v === null) continue;
      const s = String(v).trim();
      if (s !== '') eingabe[f] = s;
    }
    const quelleRoh = roh.source === undefined || roh.source === null ? '' : String(roh.source).trim();
    if (quelleRoh.length > MAX_QUELLE) return { i, werte: null, quelle: null, fehler: `source ist zu lang (max. ${MAX_QUELLE})` };
    const p = pruefeLeadEingabe(eingabe, { neu: true });
    if (!p.ok) return { i, werte: null, quelle: quelleRoh || null, fehler: p.fehler };
    return { i, werte: p.werte, quelle: quelleRoh || null, fehler: null };
  });
}

/** Vorschau-Zeilen nach Reiter gruppieren (UI). */
export const IMPORT_REITER = Object.freeze([
  { key: 'alle', label: 'Alle', status: null },
  { key: 'neu', label: 'Neu', status: ['new'] },
  { key: 'dubletten', label: 'Dubletten', status: ['duplicate', 'duplicate_in_import'] },
  { key: 'pruefen', label: 'Prüfen', status: ['possible_duplicate'] },
  { key: 'fehler', label: 'Fehler', status: ['invalid'] },
]);

export function zeilenFuerReiter(zeilen, reiterKey) {
  const r = IMPORT_REITER.find((x) => x.key === reiterKey);
  if (!r || !r.status) return zeilen || [];
  return (zeilen || []).filter((z) => r.status.includes(z.status));
}

/** Standard-Reiter: das erste Problem (Fehler → Prüfen → Dubletten), sonst Neu. */
export function standardReiter(counts) {
  if (!counts) return 'neu';
  if (counts.invalid > 0) return 'fehler';
  if (counts.possibleDuplicate > 0) return 'pruefen';
  if ((counts.duplicate ?? 0) + (counts.duplicateInImport ?? 0) > 0) return 'dubletten';
  return 'neu';
}

/** Neue, nicht erratbare Import-ID (Idempotenz-Schluessel). */
export function neueImportId(zufall = (n) => { const b = new Uint8Array(n); (typeof window !== "undefined" ? window.crypto : crypto).getRandomValues(b); return b; }) {
  return `csv-${[...zufall(16)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/* ── Externe Lead-Inbox: Zugang per Secret (Function acquisition-inbox) ──
   Geteilt, damit Jest die Entscheidung mit Wirkung prueft und die
   Function genau diese Funktion nutzt (ueber akquiseInbox.js). Vergleich zeitkonstant (Laenge geht mit ein,
   bricht aber nicht frueh ab). Kein Secret konfiguriert → 503, die Inbox
   ist dann aus — nie „offen". */
function zeitkonstantGleich(a, b) {
  /* UTF-16-Codeeinheiten statt TextEncoder: laeuft gleich in Browser, Deno und Jest. */
  const sa = String(a); const sb = String(b);
  let diff = sa.length ^ sb.length;
  for (let k = 0; k < Math.max(sa.length, sb.length); k += 1) diff |= (sa.charCodeAt(k) || 0) ^ (sb.charCodeAt(k) || 0);
  return diff === 0;
}

/**
 * @param {string|null|undefined} geliefert  Header X-Werkruf-Import-Secret
 * @param {string|null|undefined} erwartet   ACQUISITION_IMPORT_SECRET
 * @returns {{ok:true}|{ok:false, status:503|401, fehler:string}}
 */
export function pruefeInboxZugang(geliefert, erwartet) {
  if (typeof erwartet !== 'string' || erwartet.length < 16) return { ok: false, status: 503, fehler: 'Inbox nicht konfiguriert' };
  if (typeof geliefert !== 'string' || geliefert === '' || !zeitkonstantGleich(geliefert, erwartet)) {
    return { ok: false, status: 401, fehler: 'Nicht berechtigt' };
  }
  return { ok: true };
}
