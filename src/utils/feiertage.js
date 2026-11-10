/*
 * Feiertage (WP9) — die eine Quelle.
 *
 * Geteilt zwischen Jest und supabase/functions/google-business.
 * Reines JavaScript, keine Importe, keine externe API: deutsche
 * gesetzliche Feiertage sind deterministisch berechenbar — feste
 * Daten plus bewegliche aus dem Ostersonntag (Gauss/Butcher).
 *
 * Was hier NICHT steht: Schulferien, Adventssonntage, verkaufsoffene
 * Sonntage, Stadtfeste, Branchenkalender. Nur gesetzliche Feiertage,
 * weil nur fuer die ein Betrieb bei Google eine bewusste
 * Sonderoeffnungszeit hinterlegen sollte.
 *
 * Regionen: ISO-3166-2-Kuerzel der 16 Laender. 'ALL' = bundesweit.
 */

export const LAENDER = Object.freeze({
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg',
  HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz',
  SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
});

export const LAND_CODES = Object.freeze(Object.keys(LAENDER));

/* ─────────────────────────────────────────────
   REGION AUS DER GOOGLE-ADRESSE
   ───────────────────────────────────────────── */

const LAND_ALIAS = (() => {
  const m = new Map();
  const add = (code, ...namen) => namen.forEach((n) => m.set(norm(n), code));
  add('BW', 'Baden-Württemberg', 'Baden-Wuerttemberg', 'Baden Württemberg', 'BW');
  add('BY', 'Bayern', 'Bavaria', 'BY');
  add('BE', 'Berlin', 'BE');
  add('BB', 'Brandenburg', 'BB');
  add('HB', 'Bremen', 'Freie Hansestadt Bremen', 'HB');
  add('HH', 'Hamburg', 'Freie und Hansestadt Hamburg', 'HH');
  add('HE', 'Hessen', 'Hesse', 'HE');
  add('MV', 'Mecklenburg-Vorpommern', 'Mecklenburg Vorpommern', 'Mecklenburg-Western Pomerania', 'MV');
  add('NI', 'Niedersachsen', 'Lower Saxony', 'NI', 'NDS');
  add('NW', 'Nordrhein-Westfalen', 'Nordrhein Westfalen', 'North Rhine-Westphalia', 'NW', 'NRW');
  add('RP', 'Rheinland-Pfalz', 'Rheinland Pfalz', 'Rhineland-Palatinate', 'RP', 'RLP');
  add('SL', 'Saarland', 'SL');
  add('SN', 'Sachsen', 'Saxony', 'SN');
  add('ST', 'Sachsen-Anhalt', 'Sachsen Anhalt', 'Saxony-Anhalt', 'ST', 'LSA');
  add('SH', 'Schleswig-Holstein', 'Schleswig Holstein', 'SH');
  add('TH', 'Thüringen', 'Thueringen', 'Thuringia', 'TH');
  return m;
})();

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[\s_]+/g, '-');
}

/**
 * Bundesland aus einer Google-storefrontAddress.
 *
 * Quelle ist ausschliesslich administrativeArea (plus regionCode DE).
 * Kein Raten aus Ort oder PLZ, kein Firmenname. Ohne sichere Zuordnung
 * → { code: null, confidence: 'unknown' } → nur bundesweite Feiertage.
 *
 * @returns {{ code: string|null, confidence: 'known'|'unknown', quelle: string|null }}
 */
export function bundeslandAusAdresse(adresse) {
  const a = adresse ?? {};
  const land = String(a.regionCode ?? 'DE').toUpperCase();
  if (land !== 'DE') return { code: null, confidence: 'unknown', quelle: 'nicht_de' };
  const area = typeof a.administrativeArea === 'string' ? a.administrativeArea : '';
  if (!area.trim()) return { code: null, confidence: 'unknown', quelle: null };
  const code = LAND_ALIAS.get(norm(area)) ?? null;
  return code
    ? { code, confidence: 'known', quelle: 'administrativeArea' }
    : { code: null, confidence: 'unknown', quelle: 'administrativeArea_unbekannt' };
}

/* ─────────────────────────────────────────────
   DATUM
   ───────────────────────────────────────────── */

/** Ostersonntag (gregorianisch) — Anonymous/Meeus-Algorithmus. */
export function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return { year: jahr, month: monat, day: tag };
}

export function datumPlus(d, tage) {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + tage));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function alsIso(d) {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function ausIso(text) {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!t) return null;
  const [, y, m, d] = t.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { year: y, month: m, day: d };
}

/** Tage von a bis b (b − a), kalendarisch. */
export function tageBis(a, b) {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

/** Wochentag als Google-Enum. */
export function wochentag(d) {
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
}

/* ─────────────────────────────────────────────
   DIE REGION-MATRIX
   ─────────────────────────────────────────────
   Quelle: Feiertagsgesetze der Laender, Stand 2026.

   Bewusst NICHT aufgenommen (teilregional oder konfessionsabhaengig,
   aus Standortdaten nicht sicher bestimmbar — WP9 §28, kein Raten):
     - Fronleichnam in Sachsen und Thueringen (nur einzelne Gemeinden)
     - Augsburger Friedensfest (nur Stadt Augsburg)
     - Mariae Himmelfahrt in Bayern (nur ueberwiegend katholische
       Gemeinden; im Saarland dagegen landesweit → SL aufgenommen)
   Diese Tage erzeugen keine Aufgabe. Ein Betrieb, der dort schliesst,
   kann die Sonderzeit wie jede andere im Editor hinterlegen.
*/
const FEST = Object.freeze([
  { id: 'neujahr',              name: 'Neujahr',                    monat: 1,  tag: 1,  regions: ['ALL'] },
  { id: 'heilige_drei_koenige', name: 'Heilige Drei Könige',        monat: 1,  tag: 6,  regions: ['BW', 'BY', 'ST'] },
  { id: 'frauentag',            name: 'Internationaler Frauentag',  monat: 3,  tag: 8,  regions: ['BE', 'MV'] },
  { id: 'tag_der_arbeit',       name: 'Tag der Arbeit',             monat: 5,  tag: 1,  regions: ['ALL'] },
  { id: 'mariae_himmelfahrt',   name: 'Mariä Himmelfahrt',          monat: 8,  tag: 15, regions: ['SL'] },
  { id: 'weltkindertag',        name: 'Weltkindertag',              monat: 9,  tag: 20, regions: ['TH'] },
  { id: 'tag_der_einheit',      name: 'Tag der Deutschen Einheit',  monat: 10, tag: 3,  regions: ['ALL'] },
  { id: 'reformationstag',      name: 'Reformationstag',            monat: 10, tag: 31, regions: ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'] },
  { id: 'allerheiligen',        name: 'Allerheiligen',              monat: 11, tag: 1,  regions: ['BW', 'BY', 'NW', 'RP', 'SL'] },
  { id: 'erster_weihnachtstag', name: '1. Weihnachtstag',           monat: 12, tag: 25, regions: ['ALL'] },
  { id: 'zweiter_weihnachtstag', name: '2. Weihnachtstag',          monat: 12, tag: 26, regions: ['ALL'] },
]);

/* Bewegliche: Abstand zum Ostersonntag in Tagen. */
const BEWEGLICH = Object.freeze([
  { id: 'karfreitag',            name: 'Karfreitag',          offset: -2,  regions: ['ALL'] },
  { id: 'ostermontag',           name: 'Ostermontag',         offset: 1,   regions: ['ALL'] },
  { id: 'christi_himmelfahrt',   name: 'Christi Himmelfahrt', offset: 39,  regions: ['ALL'] },
  { id: 'pfingstmontag',         name: 'Pfingstmontag',       offset: 50,  regions: ['ALL'] },
  { id: 'fronleichnam',          name: 'Fronleichnam',        offset: 60,  regions: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'] },
]);

/* Buss- und Bettag: Mittwoch vor dem 23. November (nur Sachsen). */
function bussUndBettag(jahr) {
  let d = { year: jahr, month: 11, day: 22 };
  while (wochentag(d) !== 'WEDNESDAY') d = datumPlus(d, -1);
  return d;
}

/**
 * Alle gesetzlichen Feiertage eines Jahres (ohne Regionsfilter).
 * @returns {Array<{ id, name, date: {year,month,day}, iso: string, regions: string[], nationwide: boolean }>}
 */
export function feiertageImJahr(jahr) {
  const liste = [];
  for (const f of FEST) {
    const date = { year: jahr, month: f.monat, day: f.tag };
    liste.push({ id: f.id, name: f.name, date, iso: alsIso(date), regions: f.regions, nationwide: f.regions.includes('ALL') });
  }
  const ostern = ostersonntag(jahr);
  for (const b of BEWEGLICH) {
    const date = datumPlus(ostern, b.offset);
    liste.push({ id: b.id, name: b.name, date, iso: alsIso(date), regions: b.regions, nationwide: b.regions.includes('ALL') });
  }
  const bb = bussUndBettag(jahr);
  liste.push({ id: 'buss_und_bettag', name: 'Buß- und Bettag', date: bb, iso: alsIso(bb), regions: ['SN'], nationwide: false });
  return liste.sort((a, b) => a.iso.localeCompare(b.iso));
}

/** Gilt der Feiertag fuer dieses Bundesland? Ohne Bundesland nur bundesweite. */
export function giltFuer(feiertag, landCode) {
  if (feiertag.nationwide) return true;
  if (!landCode) return false;
  return feiertag.regions.includes(landCode);
}

/**
 * Feiertage im Fenster [von, bis] fuer ein Bundesland (oder null →
 * bundesweit). Ueber den Jahreswechsel hinweg: beide Jahre werden
 * erzeugt, wenn das Fenster sie beruehrt.
 */
export function feiertageImFenster({ von, bis, landCode }) {
  const jahre = new Set([von.year, bis.year]);
  const alle = [...jahre].flatMap((j) => feiertageImJahr(j));
  const vonIso = alsIso(von), bisIso = alsIso(bis);
  return alle
    .filter((f) => f.iso >= vonIso && f.iso <= bisIso)
    .filter((f) => giltFuer(f, landCode));
}

/** Ein bestimmter Feiertag nach ISO-Datum (fuer Server-Validierung). */
export function feiertagAm(iso, landCode) {
  const d = ausIso(iso);
  if (!d) return null;
  return feiertageImJahr(d.year).find((f) => f.iso === iso && giltFuer(f, landCode)) ?? null;
}

/* ─────────────────────────────────────────────
   SONDERZEITEN
   ───────────────────────────────────────────── */

export const FENSTER_TAGE = 14;
export const DRINGEND_AB_TAGEN = 7;

/**
 * Liegt fuer dieses Datum ein bewusster specialHours-Eintrag vor?
 * Geschlossen, abweichende Zeiten oder ausdrueckliche Regelzeiten —
 * alles zaehlt (§10). Mehrtaegige Zeitraeume (startDate..endDate)
 * decken das Datum ab, wenn es dazwischen liegt.
 */
export function hatSonderzeitFuer(specialHourPeriods, iso) {
  if (!Array.isArray(specialHourPeriods)) return false;
  return specialHourPeriods.some((p) => {
    const s = p?.startDate; if (!s?.year) return false;
    const start = alsIso({ year: s.year, month: s.month ?? 1, day: s.day ?? 1 });
    const e = p?.endDate;
    const ende = e?.year ? alsIso({ year: e.year, month: e.month ?? 1, day: e.day ?? 1 }) : start;
    return start <= iso && iso <= ende;
  });
}

/**
 * Anstehende Feiertage ohne Sonderzeit fuer EINEN Standort (§7/§8).
 *
 * @param {object} e
 * @param {{year,month,day}} e.heute
 * @param {object|null} e.adresse        storefrontAddress
 * @param {Array} e.specialHourPeriods
 * @returns {Array<{ id, name, iso, date, tageBis, dringend, landCode, regionConfidence }>}
 */
export function offeneFeiertage({ heute, adresse, specialHourPeriods }) {
  const { code, confidence } = bundeslandAusAdresse(adresse);
  const bis = datumPlus(heute, FENSTER_TAGE);
  return feiertageImFenster({ von: heute, bis, landCode: code })
    .filter((f) => !hatSonderzeitFuer(specialHourPeriods, f.iso))
    .map((f) => {
      const rest = tageBis(heute, f.date);
      return { id: f.id, name: f.name, iso: f.iso, date: f.date, tageBis: rest, dringend: rest <= DRINGEND_AB_TAGEN, landCode: code, regionConfidence: confidence };
    });
}

/**
 * Den specialHours-Eintrag fuer eine Entscheidung bauen (§19–§21).
 *
 *   geschlossen  → { startDate, closed: true }
 *   regulaer     → die Fenster des Wochentags aus regularHours als
 *                  Sondereintraege; ohne Fenster → geschlossen
 *   andere       → vom Nutzer gelieferte Fenster [{openTime, closeTime}]
 *
 * Liefert die NEUE Liste specialHourPeriods: alle bisherigen Eintraege
 * anderer Tage bleiben, Eintraege desselben Tages werden ersetzt.
 */
export function baueSonderzeit({ datum, modus, regularPeriods, bisherige, fenster }) {
  const iso = alsIso(datum);
  const ohneTag = (Array.isArray(bisherige) ? bisherige : []).filter((p) => {
    const s = p?.startDate; if (!s?.year) return true;
    return alsIso({ year: s.year, month: s.month ?? 1, day: s.day ?? 1 }) !== iso;
  });
  let neue;
  if (modus === 'geschlossen') {
    neue = [{ startDate: datum, closed: true }];
  } else if (modus === 'regulaer') {
    const tag = wochentag(datum);
    const regel = (Array.isArray(regularPeriods) ? regularPeriods : [])
      .filter((p) => p?.openDay === tag)
      .map((p) => ({ startDate: datum, openTime: p.openTime ?? { hours: 0 }, closeTime: p.closeTime ?? { hours: 0 } }));
    neue = regel.length ? regel : [{ startDate: datum, closed: true }];
  } else if (modus === 'andere') {
    neue = (Array.isArray(fenster) ? fenster : [])
      .map((f) => ({ startDate: datum, openTime: f.openTime, closeTime: f.closeTime }));
    if (!neue.length) return null;
  } else {
    return null;
  }
  return [...ohneTag, ...neue];
}

export const MODI = Object.freeze(['geschlossen', 'regulaer', 'andere']);

/* ─────────────────────────────────────────────
   STABILE SUBJEKT-ID
   ─────────────────────────────────────────────
   events.subject_id ist uuid. Ein Feiertag hat keine Google-ID, also
   wird eine deterministische aus (locationId, iso) abgeleitet: vier
   FNV-1a-32-Laeufe mit verschiedenen Startwerten → 128 Bit, als UUID
   formatiert (Version 8 = "custom", Variante RFC 4122). Dieselbe
   Eingabe ergibt immer dieselbe ID — in Deno wie in Jest, ohne
   crypto.subtle (Regeln sind synchron) und ohne BigInt (CRA-ESLint). */
function fnv1a32(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    /* h * 16777619 ohne 64-Bit: in zwei Teilen multiplizieren */
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

export function feiertagSubjektId(locationId, iso) {
  return deterministischeUuid(`holiday:${locationId}:${iso}`);
}

/**
 * Deterministische UUID (v8) aus beliebigem Text — vier FNV-1a-32-Hashes
 * mit verschiedenen Seeds. Fuer events.subject_id (uuid): gleicher Text,
 * gleiche ID, ueber Tage und Laeufe stabil. Auch von WP15 (Saison-
 * Beitraege) genutzt.
 */
export function deterministischeUuid(text) {
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x7f4a7c15]
    .map((seed) => fnv1a32(text, seed).toString(16).padStart(8, '0')).join('');
  /* Version 8, Variante 10xx */
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
