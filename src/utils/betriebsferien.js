/*
 * Betriebsferien-Pause (WP13) — geteilt zwischen Jest, der Edge
 * Function google-business und dem Frontend.
 *
 * Pause ist ein KOMMUNIKATIONSzustand: Wochenmail und Abwesenheits-
 * erinnerung ruhen; kritische Sofortmeldungen, Google-Sync, Engine,
 * Dashboard und die Stripe-Abrechnung laufen weiter. Die Wahrheit
 * liegt serverseitig in user_profiles.pause_from/pause_until und
 * is_account_paused(); hier stehen nur dieselben Regeln fuer
 * Validierung und Anzeige, damit Client und Server dasselbe sagen.
 *
 * Datumswerte sind Kalendertage (YYYY-MM-DD) in Europe/Berlin — ein
 * Betrieb hat vom 20.12. bis 05.01. Ferien, nicht ab 23:00 UTC.
 */

export const PAUSE_MAX_TAGE = 56;   // 8 Wochen — Begruendung in der Migration 20261112090000
export const PAUSE_ZEITZONE = 'Europe/Berlin';

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Kalendertag in Europe/Berlin als YYYY-MM-DD. */
export function heuteBerlin(jetzt = new Date()) {
  const teile = new Intl.DateTimeFormat('en-CA', { timeZone: PAUSE_ZEITZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(jetzt);
  const w = Object.fromEntries(teile.filter((t) => t.type !== 'literal').map((t) => [t.type, t.value]));
  return `${w.year}-${w.month}-${w.day}`;
}

export function istDatumForm(s) {
  if (typeof s !== 'string' || !DATUM_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Ganze Tage zwischen zwei YYYY-MM-DD (b − a). */
export function tageZwischen(a, b) {
  return Math.round((Date.UTC(...teile(b)) - Date.UTC(...teile(a))) / 86400000);
}
const teile = (s) => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d]; };

/**
 * Validierung eines Pausenzeitraums — dieselben vier Regeln wie
 * account_pause_set() in SQL. Rueckgabe { ok: true } oder
 * { ok: false, grund }.
 */
export function pruefePause({ von, bis }, heute = heuteBerlin()) {
  if (!istDatumForm(von) || !istDatumForm(bis)) return { ok: false, grund: 'datum_fehlt' };
  if (von < heute) return { ok: false, grund: 'rueckwirkend' };
  if (bis < von) return { ok: false, grund: 'bis_vor_von' };
  if (tageZwischen(von, bis) > PAUSE_MAX_TAGE) return { ok: false, grund: 'zu_lang', maxTage: PAUSE_MAX_TAGE };
  return { ok: true };
}

/** Ist das Konto JETZT pausiert? Zeitbasiert — kein Cron, kein Flag. */
export function istPausiert(profil, heute = heuteBerlin()) {
  const von = profil?.pause_from, bis = profil?.pause_until;
  if (!istDatumForm(von) || !istDatumForm(bis)) return false;
  return von <= heute && heute <= bis;
}

/** Pause eingetragen, aber noch nicht begonnen? (fuer die Settings-Anzeige) */
export function istPauseGeplant(profil, heute = heuteBerlin()) {
  const von = profil?.pause_from, bis = profil?.pause_until;
  if (!istDatumForm(von) || !istDatumForm(bis)) return false;
  return von > heute && bis >= von;
}

export const PAUSE_GRUND_TEXT = Object.freeze({
  datum_fehlt: 'Bitte Von- und Bis-Datum angeben.',
  rueckwirkend: 'Die Pause kann nicht in der Vergangenheit beginnen.',
  bis_vor_von: 'Das Ende muss nach dem Anfang liegen.',
  zu_lang: `Höchstens ${PAUSE_MAX_TAGE} Tage am Stück — danach gern eine neue Pause eintragen.`,
  kein_pro: 'Betriebsferien-Pause gibt es mit WERKRUF Pro.',
});

export function formatDatumDe(s) {
  if (!istDatumForm(s)) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

/* Produktcopy — bewusst ohne Billing-Pause-Vokabular: nicht „Abo
   pausieren", nicht „Zahlung pausieren", nicht „keine Kosten". */
export const PAUSE_TEXTE = Object.freeze({
  titel: 'Betriebsferien',
  erklaerung: 'Du kannst WERKRUF während deiner Betriebsferien pausieren. Google wird weiter überwacht. Normale Aufgaben und Wochenmails ruhen.',
  kritisch: 'Wirklich kritische Hinweise bekommst du weiterhin.',
  billing: 'Dein Abo und die Abrechnung laufen dabei normal weiter.',
  knopf: 'WERKRUF pausieren',
  beenden: 'Pause beenden',
  banner: (bis) => `WERKRUF ist bis ${formatDatumDe(bis)} pausiert.`,
  bannerZeile2: 'Normale Aufgaben und Wochenmails ruhen. Kritische Hinweise bleiben aktiv.',
  aktiv: (von, bis) => `WERKRUF ist vom ${formatDatumDe(von)} bis ${formatDatumDe(bis)} pausiert.`,
  geplant: (von, bis) => `Pause eingetragen: ${formatDatumDe(von)} bis ${formatDatumDe(bis)}.`,
});
