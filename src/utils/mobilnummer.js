/*
 * Mobilnummern fuer die SMS-Bewertungsanfrage (WP14).
 *
 * Geteilt zwischen Jest, Edge Function (google-business) und Frontend.
 * Die Wahrheit entsteht serverseitig — der Client nutzt dieselbe
 * Funktion nur fuer eine fruehe, freundliche Rueckmeldung.
 *
 * Scope bewusst klein: DEUTSCHE Mobilnummern. WERKRUF ist ein
 * deutsches Produkt, der Brevo-Sender „WERKRUF" ist fuer DE
 * registriert, und bei auslaendischen Nummern koennten wir Mobil-
 * von Festnetz nicht zuverlaessig unterscheiden. Nicht raten:
 * andere Laender → klarer Fehler, kein Versand (§8 „Nicht raten").
 *
 * Deutsche Mobilfunk-Vorwahlen: 015x, 016x, 017x. Die nationale
 * Rufnummer (ohne 0) hat 10 oder 11 Ziffern, z. B. 171 1234567 (10)
 * oder 1512 3456789 (11).
 */

export const MOBIL_GRUND_TEXT = Object.freeze({
  leer: 'Bitte eine Mobilnummer eingeben.',
  zeichen: 'Die Nummer darf nur Ziffern, Leerzeichen, + ( ) - / enthalten.',
  nur_deutsch: 'Aktuell können nur deutsche Mobilnummern (+49) angeschrieben werden.',
  keine_mobilnummer: 'Das ist keine deutsche Mobilnummer (015…, 016…, 017…). An Festnetz schicken wir keine SMS.',
  laenge: 'Die Nummer hat nicht die richtige Länge.',
});

/**
 * @returns {{ ok: true, e164: string, national: string } | { ok: false, grund: keyof MOBIL_GRUND_TEXT }}
 */
export function normalisiereMobilnummer(roh) {
  if (typeof roh !== 'string' || !roh.trim()) return { ok: false, grund: 'leer' };
  const s = roh.trim();
  if (/[^\d\s+()\-/.]/.test(s)) return { ok: false, grund: 'zeichen' };
  let z = s.replace(/[\s()\-/.]/g, '');
  if (!z) return { ok: false, grund: 'leer' };

  /* Laendervorwahl aufloesen: 0049… / +49… / 0… (national) */
  if (z.startsWith('00')) z = '+' + z.slice(2);
  if (z.startsWith('+')) {
    if (!z.startsWith('+49')) return { ok: false, grund: 'nur_deutsch' };
    z = z.slice(3);
    if (z.startsWith('0')) z = z.slice(1);           // „+49 0171…" kommt vor
  } else if (z.startsWith('0')) {
    z = z.slice(1);
  } else {
    return { ok: false, grund: 'keine_mobilnummer' }; // „171…" ohne 0 — nicht raten
  }
  if (!/^\d+$/.test(z)) return { ok: false, grund: 'zeichen' };

  if (!/^1[5-7]\d/.test(z)) return { ok: false, grund: 'keine_mobilnummer' };
  if (z.length < 10 || z.length > 11) return { ok: false, grund: 'laenge' };
  return { ok: true, e164: `+49${z}`, national: `0${z}` };
}

/** Anzeige „+49 171 …" — fuer die Bestaetigung im UI, nie fuer Speicherung. */
export function formatMobilnummer(e164) {
  if (typeof e164 !== 'string' || !e164.startsWith('+49')) return e164 ?? '';
  const rest = e164.slice(3);
  const vorwahl = rest.slice(0, rest.startsWith('15') && rest.length === 11 ? 4 : 3);
  return `+49 ${vorwahl} ${rest.slice(vorwahl.length)}`;
}
