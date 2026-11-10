/*
 * Admin-Bereiche (WP16.1).
 *
 * /admin war eine lange Seite, auf der jedes neue Modul unten anwuchs.
 * Jetzt: fuenf Arbeitsbereiche, immer nur einer sichtbar, adressierbar
 * ueber ?bereich= (Reload und Deep Links funktionieren).
 *
 * Bewusst ohne React-Router-Hooks: Admin.js ist eine einzige Route, und
 * die bestehenden Tests mocken react-router-dom nur mit useNavigate. Der
 * Bereich steht in window.location.search; Wechsel per history.pushState,
 * Zurueck/Vor per popstate.
 */

export const BEREICHE = Object.freeze([
  { key: 'uebersicht', label: 'Übersicht' },
  { key: 'akquise', label: 'Akquise' },
  { key: 'kunden', label: 'Kunden' },
  { key: 'founding-partner', label: 'Founding Partner' },
  { key: 'setup', label: 'Setup' },
]);

export const STANDARD_BEREICH = 'uebersicht';

/** ?bereich=… → gueltiger Schluessel; alles andere → Uebersicht. */
export function bereichAusSuche(search) {
  let wert = null;
  try { wert = new URLSearchParams(search ?? '').get('bereich'); } catch { wert = null; }
  return BEREICHE.some((b) => b.key === wert) ? wert : STANDARD_BEREICH;
}

/** Suchteil fuer einen Bereich; andere Parameter bleiben erhalten. */
export function sucheFuerBereich(bereich, search = '') {
  const p = new URLSearchParams(search ?? '');
  if (bereich === STANDARD_BEREICH) p.delete('bereich'); else p.set('bereich', bereich);
  const s = p.toString();
  return s ? `?${s}` : '';
}
