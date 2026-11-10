/*
 * Token-Seiten im Frontend (WP16-Fix1).
 *
 * Seit das Supabase-Gateway HTML von Edge Functions auf *.supabase.co
 * als text/plain ausliefert, rendert das Frontend die Seiten zu
 * Mail-Links (/a/:token) und zur Founding-Partner-Einladung
 * (/founding-partner/:token). Die Function liefert nur noch JSON
 * (Auskunft) und Redirects (Fortsetzung).
 *
 * Regeln, die hier zentral stehen:
 *   - Token kommt aus der URL und bleibt dort. Kein localStorage, kein
 *     Log, kein Analytics, keine Fehlermeldung mit Token.
 *   - GET zeigt nur an. Die Mutation ist ein <form method="POST">
 *     direkt an die Function — Scanner folgen Links, sie schicken keine
 *     Formulare ab.
 *   - Fehler sind neutral: „Dieser Link ist nicht mehr gültig." fuer
 *     unbekannt/abgelaufen/widerrufen/fremd gleichermassen.
 *     Netzwerkfehler sind davon getrennt.
 */

export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{16,128}$/;

export function istTokenForm(t) {
  return typeof t === 'string' && TOKEN_MUSTER.test(t);
}

export const FUNCTIONS_BASE = `${process.env.REACT_APP_SUPABASE_URL ?? ''}/functions/v1/google-business`;

export const TEXT = Object.freeze({
  ungueltig: 'Dieser Link ist nicht mehr gültig.',
  ungueltigHinweis: 'Melde dich im Dashboard an — deine Aufgaben liegen dort bereit.',
  netz: 'Die Seite konnte gerade nicht geladen werden. Bitte versuche es erneut.',
  erledigt: 'Diese Aufgabe ist inzwischen erledigt.',
  erledigtHinweis: 'Im Dashboard siehst du, was als Nächstes ansteht.',
});

/**
 * Holt die JSON-Auskunft zu einem Token. Liefert
 *   { zustand: 'ok', daten }        gueltig
 *   { zustand: 'ungueltig' }        Server sagt valid:false (oder 404)
 *   { zustand: 'netz' }             Transport-/Serverfehler — NICHT als ungueltig darstellen
 */
export async function ladeTokenAuskunft(pfad, fetchImpl = fetch) {
  let antwort;
  try {
    antwort = await fetchImpl(pfad, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    return { zustand: 'netz' };
  }
  if (antwort.status === 404) return { zustand: 'ungueltig' };
  if (!antwort.ok) return { zustand: 'netz' };
  let daten;
  try { daten = await antwort.json(); } catch { return { zustand: 'netz' }; }
  if (!daten || daten.valid !== true) return { zustand: 'ungueltig' };
  return { zustand: 'ok', daten };
}

/** Meta-Tags fuer Token-Seiten: nicht indexieren, keinen Referrer senden. */
export function setzeTokenSeitenMeta(dokument = document) {
  const setze = (name, content) => {
    let el = dokument.querySelector(`meta[name="${name}"]`);
    if (!el) { el = dokument.createElement('meta'); el.setAttribute('name', name); dokument.head.appendChild(el); }
    const vorher = el.getAttribute('content');
    el.setAttribute('content', content);
    return () => { if (vorher === null) el.remove(); else el.setAttribute('content', vorher); };
  };
  const r1 = setze('robots', 'noindex,nofollow');
  const r2 = setze('referrer', 'no-referrer');
  return () => { r1(); r2(); };
}
