/*
 * GA4 mit Einwilligung (Consent Mode „Basic").
 *
 * Regeln (Paket A):
 *   • Ohne ausdrueckliche Zustimmung: KEIN Request an Google — das Skript
 *     wird gar nicht erst geladen. Es gibt keinen Vorab-Ping.
 *   • Ablehnen ist genauso einfach wie Zustimmen; Widerruf jederzeit
 *     (Footer „Cookie-Einstellungen", Datenschutzerklaerung).
 *   • Gemessen wird nur auf Pfaden einer POSITIVLISTE. Alles andere —
 *     Token-Seiten, Bestaetigungs-/Magic-Link-Seiten, /admin, unbekannte
 *     Pfade — sendet nichts. Wird ein gesperrter Pfad nach dem Laden
 *     erreicht, setzt das offizielle Abschalt-Flag
 *     window['ga-disable-<ID>'] jede weitere Uebertragung aus.
 *   • An GA4 geht nie die echte URL: page_location wird aus Origin +
 *     normalisiertem Pfad gebaut, ohne Query und Fragment. Pfade mit
 *     Kennungen (/empfehlen/<code>) werden auf ihr Muster gekuerzt.
 *     Referrer nur als Origin.
 *   • Funnel-Events nur aus einem festen Katalog, Parameter nur aus einer
 *     festen Liste mit festen Werten — keine Tokens, IDs, Mails, Namen.
 *   • GA4 ergaenzt die serverseitigen Daten, ersetzt sie nicht.
 */

export const CONSENT_SCHLUESSEL = 'werkruf_consent_v1';
export const CONSENT_VERSION = 1;

/* Ereignis fuer UI-Teile (Banner, Footer-Link). */
export const CONSENT_OEFFNEN = 'werkruf:consent-oeffnen';
export const CONSENT_GEAENDERT = 'werkruf:consent-geaendert';

export function messId(roh = process.env.REACT_APP_GA4_MEASUREMENT_ID) {
  const id = typeof roh === 'string' ? roh.trim() : '';
  return /^G-[A-Z0-9]{6,14}$/.test(id) ? id : null;
}

/* ── Positivliste ──────────────────────────────────────────────── */
const FESTE_PFADE = new Set([
  '/', '/pricing', '/signup', '/login', '/forgot-password',
  '/impressum', '/datenschutz', '/agb', '/avv', '/hilfe',
  '/onboarding',
  '/dashboard', '/dashboard/google', '/dashboard/bewertungen', '/dashboard/fotos',
  '/dashboard/kunden-gewinnung', '/dashboard/einstellungen', '/dashboard/support',
]);
/* Pfade mit einer Kennung im Pfad: gemessen wird nur das Muster. */
const MUSTER = [
  [/^\/empfehlen\/[^/]+$/, '/empfehlen'],
];

/**
 * Pfad fuer GA4 — oder null, wenn auf diesem Pfad nicht gemessen wird.
 * Bewusst Positivliste: ein neuer Token-Pfad ist ohne Zutun gesperrt.
 */
export function analysePfad(pathname) {
  if (typeof pathname !== 'string') return null;
  let p = pathname.split(/[?#]/)[0];
  if (!p.startsWith('/')) return null;
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
  if (FESTE_PFADE.has(p)) return p;
  for (const [re, ziel] of MUSTER) if (re.test(p)) return ziel;
  return null;
}

/* ── Einwilligung (localStorage) ───────────────────────────────── */
function speicher() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/** @returns {'erteilt'|'abgelehnt'|null} null = noch nicht entschieden */
export function leseConsent() {
  const s = speicher();
  if (!s) return null;
  try {
    const roh = JSON.parse(s.getItem(CONSENT_SCHLUESSEL) || 'null');
    if (!roh || roh.v !== CONSENT_VERSION) return null;
    if (roh.analyse === true) return 'erteilt';
    if (roh.analyse === false) return 'abgelehnt';
  } catch { /* kaputter Eintrag = nicht entschieden */ }
  return null;
}

export function speichereConsent(erteilt, jetzt = new Date()) {
  const s = speicher();
  try { s?.setItem(CONSENT_SCHLUESSEL, JSON.stringify({ v: CONSENT_VERSION, analyse: Boolean(erteilt), am: jetzt.toISOString() })); } catch { /* privat-Modus */ }
  if (!erteilt) deaktiviere(true);
  try { window.dispatchEvent(new CustomEvent(CONSENT_GEAENDERT, { detail: { erteilt: Boolean(erteilt) } })); } catch { /* alt */ }
}

export function oeffneConsentEinstellungen() {
  try { window.dispatchEvent(new CustomEvent(CONSENT_OEFFNEN)); } catch { /* alt */ }
}

/* ── GA4 ───────────────────────────────────────────────────────── */
let geladenFuer = null;

function gtag() {
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

function seitenDaten(pfad) {
  const origin = window.location.origin;
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).origin : ''; } catch { ref = ''; }
  return { page_location: `${origin}${pfad}`, page_path: pfad, page_title: pfad, page_referrer: ref === origin ? '' : ref };
}

/** Darf JETZT auf diesem Pfad gemessen werden? */
export function messungErlaubt(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  return Boolean(messId() && leseConsent() === 'erteilt' && analysePfad(pathname));
}

/* Abschalt-Flag von Google: stoppt jede Uebertragung des geladenen Skripts. */
function deaktiviere(aus) {
  const id = messId();
  if (!id || typeof window === 'undefined') return;
  window[`ga-disable-${id}`] = Boolean(aus);
  if (aus) loescheGaCookies(id);
}

export function loescheGaCookies(id = messId()) {
  if (typeof document === 'undefined' || !id) return;
  const namen = ['_ga', `_ga_${id.replace(/^G-/, '')}`];
  const host = window.location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const n of namen) {
    for (const d of domains) {
      document.cookie = `${n}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
    }
  }
}

/**
 * Bei jedem Seitenwechsel aufrufen. Laedt GA4 nur mit Einwilligung und
 * nur auf einem erlaubten Pfad; sendet dann genau einen page_view.
 * Gibt zurueck, ob gesendet wurde (fuer Tests).
 */
export function seitenwechsel(pathname, { dokument = document } = {}) {
  const id = messId();
  const pfad = analysePfad(pathname);
  if (!id || leseConsent() !== 'erteilt' || !pfad) {
    if (geladenFuer) deaktiviere(true);
    return false;
  }
  if (geladenFuer !== id) {
    window.dataLayer = window.dataLayer || [];
    deaktiviere(false);
    gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    gtag('js', new Date());
    gtag('config', id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ...seitenDaten(pfad),
    });
    const s = dokument.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    s.id = 'werkruf-ga4';
    dokument.head.appendChild(s);
    geladenFuer = id;
  } else {
    deaktiviere(false);
  }
  const daten = seitenDaten(pfad);
  gtag('set', daten);
  gtag('event', 'page_view', daten);
  return true;
}

/* ── Funnel ────────────────────────────────────────────────────── */
/* Katalog: Ereignis → erlaubte Parameter mit erlaubten Werten. */
export const FUNNEL = {
  smartcheck_start: {},
  smartcheck_complete: {},
  signup_start: { method: ['email', 'google'] },
  signup_complete: {},
  google_connect_start: { reconnect: [true, false] },
  google_connect_success: {},
  checkout_start: { plan: ['monthly', 'yearly'] },   /* = TARIF_KEYS */
  checkout_success: {},
};

export function bereinigeParameter(name, params = {}) {
  const regeln = FUNNEL[name];
  if (!regeln) return null;
  const aus = {};
  for (const [k, erlaubt] of Object.entries(regeln)) {
    if (Object.prototype.hasOwnProperty.call(params, k) && erlaubt.includes(params[k])) aus[k] = params[k];
  }
  return aus;
}

/**
 * Funnel-Ereignis senden — nur wenn fachlich eingetreten (Aufrufer),
 * Einwilligung erteilt, GA geladen und Pfad erlaubt. Unbekannte Namen
 * und Parameter werden verworfen.
 */
export function funnelEvent(name, params = {}) {
  const p = bereinigeParameter(name, params);
  if (!p || !geladenFuer || !messungErlaubt()) return false;
  gtag('event', name, { ...p, transport_type: 'beacon' });
  return true;
}

/* nur fuer Tests */
export function _zuruecksetzen() {
  if (geladenFuer && typeof window !== 'undefined') delete window[`ga-disable-${geladenFuer}`];
  geladenFuer = null;
}
