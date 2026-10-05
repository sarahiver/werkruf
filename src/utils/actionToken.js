/**
 * Action-Tokens für Mail-Links.
 *
 * Reines JavaScript ohne Importe — Deno holt es relativ, Jest direkt.
 * Dieselbe Logik auf beiden Seiten; der Hash darf sich nicht zwischen
 * Erzeugen und Prüfen unterscheiden.
 *
 * ⚠️  DER KLARTEXT EXISTIERT GENAU EINMAL.
 *
 * `erzeugeToken()` gibt ihn zurück. Von dort geht er direkt in die
 * E-Mail. Er gehört nicht in ein Protokoll, nicht in einen
 * SQL-Rückgabewert und nicht in eine Fehlermeldung — gespeichert wird
 * nur der Hash.
 */

/* ─────────────────────────────────────────────
   ERZEUGEN
───────────────────────────────────────────── */

/*
 * 32 Byte Zufall.
 *
 * 256 Bit. Bei einer Milliarde Versuchen pro Sekunde über das Alter
 * des Universums bleibt die Trefferwahrscheinlichkeit
 * verschwindend — es gibt nichts zu erraten.
 *
 * Deshalb ist SHA-256 beim Speichern richtig und bcrypt falsch: Ein
 * langsamer Hash schützt gegen schwache Geheimnisse. Hier gibt es
 * keine.
 */
const TOKEN_BYTES = 32;

/** Base64url: URL-sicher ohne +, / und =. */
function alsBase64Url(bytes) {
  let binaer = '';
  for (const b of bytes) binaer += String.fromCharCode(b);
  return btoa(binaer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Erzeugt einen neuen Token.
 *
 * @returns {Promise<{ klartext: string, hash: string }>}
 *          `klartext` gehört in die Mail, `hash` in die Datenbank.
 */
export async function erzeugeToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  const klartext = alsBase64Url(bytes);
  return { klartext, hash: await hashe(klartext) };
}

/**
 * SHA-256 als Hex.
 *
 * Muss auf beiden Seiten identisch sein — beim Erzeugen und beim
 * Nachschlagen. Eine abweichende Kodierung macht jeden Token
 * ungültig, und der Fehler sähe aus wie „Token nicht gefunden".
 */
export async function hashe(klartext) {
  const daten = new TextEncoder().encode(String(klartext ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', daten);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ─────────────────────────────────────────────
   PRÜFEN
───────────────────────────────────────────── */

/**
 * Sieht das überhaupt wie ein Token aus?
 *
 * Eine Vorprüfung, keine Sicherheitsmaßnahme. Sie spart einen
 * Datenbankzugriff bei offensichtlichem Unsinn — die eigentliche
 * Prüfung macht `resolve_action_token`.
 */
export function sichtPlausibelAus(klartext) {
  if (typeof klartext !== 'string') return false;
  /* 32 Byte base64url ergeben 43 Zeichen. */
  return /^[A-Za-z0-9_-]{40,50}$/.test(klartext);
}

/*
 * Grund → was der Besucher sieht.
 *
 * Nach aussen gibt es EINE Antwort für alle Fehlerfälle. „Abgelaufen"
 * verrät, dass der Token existierte; „gehört anderem Nutzer" verrät
 * mehr. Der genaue Grund steht im Protokoll.
 *
 * Die Einladung zum Einloggen ist kein Trost, sondern der Ausweg: Im
 * Dashboard liegt dieselbe Aufgabe.
 */
export const BESUCHER_MELDUNG =
  'Dieser Link ist nicht mehr gültig. Melde dich im Dashboard an — '
  + 'deine Aufgaben liegen dort bereit.';

/**
 * Was antwortet die Function bei einem ungültigen Token?
 *
 * Immer dasselbe, immer 200. Ein 404 unterschiede erkennbar zwischen
 * „gab es nie" und „gibt es nicht mehr"; ein 403 verriete, dass er
 * jemand anderem gehört.
 */
export function abweisung(grund) {
  return {
    status: 200,
    body: {
      valid: false,
      message: BESUCHER_MELDUNG,
      /* Für das Protokoll, nicht für die Anzeige. Die Oberfläche
         zeigt ausschliesslich `message`. */
      reason: grund ?? 'invalid',
    },
  };
}

/* ─────────────────────────────────────────────
   ZIELE
───────────────────────────────────────────── */

/**
 * Darf ein Link hierhin führen?
 *
 * Dieselbe Regel wie `action_token_ziel_ok` in SQL. Doppelt geprüft,
 * weil beide Seiten unabhängig falsch sein können — und weil ein
 * offener Redirect unter der Domain von WERKRUF besonders
 * glaubwürdig aussieht.
 *
 * `//host` ist der Fall, den man übersieht: Er beginnt mit `/` und
 * führt trotzdem zu einer fremden Domain.
 */
export function zielErlaubt(pfad) {
  if (typeof pfad !== 'string' || pfad.length === 0) return false;
  if (!pfad.startsWith('/')) return false;
  if (pfad.startsWith('//')) return false;
  if (pfad.includes('://')) return false;
  if (pfad.includes('\\')) return false;

  const klein = pfad.toLowerCase();
  if (klein.includes('javascript:') || klein.includes('data:')) return false;

  return pfad === '/dashboard' || pfad.startsWith('/dashboard/');
}

/* ─────────────────────────────────────────────
   ZWECKE
───────────────────────────────────────────── */

/**
 * Wofür ein Token gelten kann.
 *
 * Eine feste Liste, keine freie Zeichenkette: Ein Token fürs Öffnen
 * einer Empfehlung soll nicht für etwas anderes taugen, und ein
 * Tippfehler soll nicht stillschweigend einen neuen Zweck erfinden.
 */
export const ZWECKE = Object.freeze({
  /* Mail → eine bestimmte Empfehlung im Dashboard. */
  EVENT_OEFFNEN: 'event.open',
  /* Mail → Dashboard allgemein. */
  DASHBOARD: 'dashboard.open',
});

export function zweckErlaubt(zweck) {
  return Object.values(ZWECKE).includes(zweck);
}

/* ─────────────────────────────────────────────
   LAUFZEIT
───────────────────────────────────────────── */

/*
 * Sieben Tage.
 *
 * Die Wochenmail kommt montags; bis zur nächsten ist der Link gültig.
 * Länger wäre ein Link, der in einem alten Postfach weiterlebt;
 * kürzer träfe jeden, der seine Mail erst am Wochenende liest.
 */
export const LAUFZEIT_TAGE = 7;

export function laufzeitIntervall(tage = LAUFZEIT_TAGE) {
  const n = Number(tage);
  if (!Number.isFinite(n) || n <= 0) return `${LAUFZEIT_TAGE} days`;
  /* Obergrenze: Ein Token, der Monate gilt, ist kein Token mehr. */
  return `${Math.min(Math.round(n), 30)} days`;
}

export default { erzeugeToken, hashe, zielErlaubt, ZWECKE };
