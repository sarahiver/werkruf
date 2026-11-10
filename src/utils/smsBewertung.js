/*
 * SMS-Bewertungsanfrage (WP14) — Vorlage, Segmentzaehlung, Regeln.
 *
 * Geteilt zwischen Jest, Edge Function und Frontend. Der Text ist
 * NICHT frei editierbar: feste, neutrale Vorlage, in die nur Vorname,
 * Betrieb und der kurze WERKRUF-Link eingesetzt werden. Kein Incentive,
 * keine Sternevorgabe, kein Review-Gating in beide Richtungen — jeder
 * Kunde bekommt denselben Weg.
 */

export const SMS_SENDER = 'WERKRUF';          // alphanumerisch, <= 11 Zeichen (Brevo)
export const SMS_TAG = 'review_request';

export const RATE_LIMIT = Object.freeze({ kurzFenster: 5, kurzMinuten: 10, tag: 30, dedupeStunden: 24 });

export const VERSAND_GRUND_TEXT = Object.freeze({
  kein_zugang: 'Bewertungsanfragen per SMS gibt es mit WERKRUF Pro.',
  kein_link: 'Für diesen Betrieb ist noch kein Bewertungslink verfügbar.',
  doppelt: 'An diese Nummer ging heute schon eine Bewertungsanfrage. Eine zweite am selben Tag schicken wir nicht.',
  limit_kurz: `Kurz warten: höchstens ${RATE_LIMIT.kurzFenster} SMS in ${RATE_LIMIT.kurzMinuten} Minuten.`,
  limit_tag: `Für heute ist das Tageslimit von ${RATE_LIMIT.tag} SMS erreicht.`,
  nicht_konfiguriert: 'SMS-Versand ist noch nicht eingerichtet.',
  provider: 'Die SMS konnte nicht gesendet werden. Du kannst es gleich noch einmal versuchen.',
  name_fehlt: 'Bitte den Vornamen eingeben.',
});

export const EINWILLIGUNG_HINWEIS =
  'Bitte nur an Kundinnen und Kunden senden, die tatsächlich bei dir waren und bei denen du die Nummer für diesen Kontakt verwenden darfst.';

/** Vorname: 1–40 Zeichen, Buchstaben/Leerzeichen/Bindestrich/Apostroph/Punkt. */
export function bereinigeVorname(roh) {
  if (typeof roh !== 'string') return null;
  const s = roh.trim().replace(/\s+/g, ' ');
  if (!s || s.length > 40) return null;
  if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(s)) return null;
  return s;
}

export const SHORTLINK_BASIS = 'https://werkruf.com/b/';
const SHORT_CODE_RE = /^[A-Za-z0-9]{7}$/;

export function istShortCodeForm(code) {
  return typeof code === 'string' && SHORT_CODE_RE.test(code);
}

/** werkruf.com/b/<code> — der Link, der in der SMS steht (WP14.2). */
export function kurzerBewertungsLink(code) {
  return istShortCodeForm(code) ? `${SHORTLINK_BASIS}${code}` : null;
}

/**
 * Die Vorlage. Drei Platzhalter, alle vom Server befuellt: Vorname
 * (geprueft), Betriebsname (google_locations.title) und der KURZE
 * WERKRUF-Link (review_short_links.code → /b/<code> → Redirect auf den
 * kanonischen Google-Link).
 *
 * Neutral (WP14.2): keine Zufriedenheitsbedingung. „Wenn du zufrieden
 * warst" selektierte implizit zufriedene Kunden — das ist positives
 * Gating, und WP14 verspricht: gleicher Weg fuer alle.
 */
export function baueBewertungsSms({ vorname, betrieb, code }) {
  const link = kurzerBewertungsLink(code);
  if (!link) return null;
  const name = bereinigeVorname(vorname);
  if (!name) return null;
  const b = typeof betrieb === 'string' && betrieb.trim() ? betrieb.trim() : null;
  if (!b) return null;
  return `Hallo ${name}, danke für deinen Auftrag bei ${b}. Teile gern deine Erfahrung bei Google: ${link}`;
}

/* ── Segmente ──
   GSM-7-Grundzeichensatz (inkl. ä ö ü Ä Ö Ü ß é …) und die Erweiterung
   (zaehlt doppelt: ^ { } \ [ ~ ] | €). Alles andere → UCS-2.
   Grenzen: GSM-7 160 / 153 je Teil, UCS-2 70 / 67 je Teil. */
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

export function smsSegmente(text) {
  if (typeof text !== 'string') return { encoding: 'GSM-7', zeichen: 0, segmente: 0 };
  let gsm = true, einheiten = 0;
  for (const ch of text) {
    if (GSM7.includes(ch)) einheiten += 1;
    else if (GSM7_EXT.includes(ch)) einheiten += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    const segmente = einheiten === 0 ? 0 : einheiten <= 160 ? 1 : Math.ceil(einheiten / 153);
    return { encoding: 'GSM-7', zeichen: einheiten, segmente };
  }
  const n = [...text].reduce((a, ch) => a + (ch.codePointAt(0) > 0xFFFF ? 2 : 1), 0);
  return { encoding: 'UCS-2', zeichen: n, segmente: n === 0 ? 0 : n <= 70 ? 1 : Math.ceil(n / 67) };
}

/* ── Regeln, die ein Text NIE verletzen darf (Test + Gegenprobe) ── */
export const VERBOTENE_MUSTER = Object.freeze([
  /5\s*Sterne|fünf Sterne|f\u00fcnf Sterne|bei 5 Sternen/i,       // Sternevorgabe
  /unzufrieden|nicht zufrieden/i,                                   // negatives Gating
  /wenn (du|Sie|ihr) (zufrieden|gl\u00fccklich|glücklich|begeistert)/i, // positives Gating (WP14.2)
  /wenn alles (gepasst|gut|in Ordnung|geklappt)/i,
  /wenn (du|Sie|ihr) uns (weiter)?empfehlen/i,
  /positive Bewertung|gute Bewertung|positive Rezension|gute Rezension/i,
  /Gutschein|Rabatt|Verlosung|gewinn|Prämie|Pr\u00e4mie|Bonus|geschenkt|Gegenleistung/i, // Incentive
  /antworte (erst|zuerst|lieber) uns|melde dich (erst|zuerst) bei uns/i,
]);

export function textErlaubt(text) {
  return typeof text === 'string' && !VERBOTENE_MUSTER.some((re) => re.test(text));
}
