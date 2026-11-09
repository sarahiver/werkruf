/*
 * Empfehlungslink (WP10) — Client-Seite.
 *
 * Der Link /empfehlen/<code> traegt nur die Quelle. Hier wird die
 * Absicht 30 Tage lang gemerkt und beim Signup als
 * raw_user_meta_data.referral_code mitgegeben. Die WAHRHEIT entsteht
 * serverseitig: der Trigger handle_new_user_referral prueft den Code
 * und legt die Zuordnung an — oder eben nicht. Was hier steht, kann
 * ein Nutzer manipulieren; es gewaehrt nichts.
 *
 * Warum kein httpOnly-Cookie: WERKRUF ist eine SPA ohne eigenen
 * HTTP-Server vor dem Frontend; die Edge Functions laufen auf einer
 * anderen Domain. Ein Cookie dort erreichte die Seite nicht.
 */

export const CODE_RE = /^[A-Za-z0-9]{10}$/;
export const INTENT_KEY = 'werkruf.referral';
export const INTENT_TAGE = 30;

export function istCodeForm(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

export function empfehlungsUrl(code, origin = (typeof window !== 'undefined' ? window.location.origin : 'https://werkruf.com')) {
  return `${origin}/empfehlen/${code}`;
}

/** Absicht merken — nur bei gueltiger Form; ein vorhandener Eintrag bleibt (first wins auch hier). */
export function merkeEmpfehlung(code, jetzt = Date.now()) {
  if (!istCodeForm(code)) return false;
  try {
    const alt = leseEmpfehlung(jetzt);
    if (alt) return false;
    window.localStorage.setItem(INTENT_KEY, JSON.stringify({ code, bis: jetzt + INTENT_TAGE * 86400000 }));
    return true;
  } catch { return false; }
}

export function leseEmpfehlung(jetzt = Date.now()) {
  try {
    const roh = window.localStorage.getItem(INTENT_KEY);
    if (!roh) return null;
    const d = JSON.parse(roh);
    if (!istCodeForm(d?.code) || !Number.isFinite(d?.bis) || d.bis < jetzt) {
      window.localStorage.removeItem(INTENT_KEY);
      return null;
    }
    return d.code;
  } catch { return null; }
}

export function vergissEmpfehlung() {
  try { window.localStorage.removeItem(INTENT_KEY); } catch { /* egal */ }
}

export const EMPFEHLUNG_HINWEIS = Object.freeze({
  titel: 'Du wurdest von einem WERKRUF-Nutzer eingeladen.',
  text: 'Wenn du WERKRUF Pro nutzt, bekommt ihr beide einen Monat kostenlos.',
});

export const WEITEREMPFEHLEN = Object.freeze({
  titel: 'WERKRUF weiterempfehlen',
  text: 'Kennst du einen Betrieb, für den WERKRUF hilfreich wäre? Schick ihm deinen persönlichen Link. Wenn er WERKRUF Pro nutzt, bekommt ihr beide einen Monat kostenlos.',
  fp: 'Du bist Founding Partner und nutzt WERKRUF ohnehin kostenlos. Dein Kollege erhält trotzdem seinen Empfehlungsbonus.',
  nichtBerechtigt: 'Deinen persönlichen Link bekommst du, sobald ein Google-Betrieb verbunden ist.',
});

/** Zahlen fuer die Einstellungen — nur, was wirklich passiert ist. */
export function empfehlungsZahlen(summary) {
  const s = summary ?? {};
  const rewards = Array.isArray(s.rewards) ? s.rewards : [];
  const verdient = rewards.filter((r) => r.status === 'applied' || r.status === 'pending').length;
  const wartend  = rewards.filter((r) => r.status === 'pending').length;
  return {
    eingeladen: Number(s.invited ?? 0),
    nutzenPro: Number(s.converted ?? 0),
    gratisMonate: verdient,
    wartend,
  };
}
