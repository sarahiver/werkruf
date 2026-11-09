/*
 * Checkout-Regeln (WP7) — geteilt zwischen Jest und
 * supabase/functions/create-checkout-session.
 *
 * Zwei Entscheidungen, die vorher niemand traf:
 *
 *   1. Bekommt dieser Checkout einen Gratis-Test?
 *      Vor WP7: immer 30 Tage, auch nach Kuendigung. Cancel/Rejoin
 *      ergab beliebig viele kostenlose Monate.
 *
 *   2. Wohin nach dem Bezahlen?
 *      Vor WP7: immer /dashboard. Wer aus einer kritischen Bewertung
 *      kam, landete auf der Uebersicht und musste die Bewertung
 *      wieder suchen.
 */

export const TRIAL_TAGE = 30;

/**
 * Trial nur beim ersten Abo.
 *
 * Die Wahrheit ist Stripe: hatte der Customer schon einmal eine
 * Subscription (egal welcher Status, auch canceled oder
 * incomplete_expired), ist das kein erster Start mehr. Das Profil
 * (hatteSchonAbo) ist die zweite Quelle — es kann hinterherhinken,
 * schliesst aber die Luecke, falls der Customer bei Stripe neu
 * angelegt wurde, waehrend das Profil noch den alten kennt.
 *
 * Ohne Customer-ID (noch nie bei Stripe): erster Start → Trial.
 *
 * @param {object} eingabe
 * @param {boolean} eingabe.stripeHatteSubscriptions  Stripe: subscriptions.list(customer, status=all).length > 0
 * @param {boolean} eingabe.profilHatteAbo            hatteSchonAbo(profile)
 * @returns {{ trialTage: number, grund: string }}
 */
export function entscheideTrial({ stripeHatteSubscriptions, profilHatteAbo }) {
  if (stripeHatteSubscriptions) return { trialTage: 0, grund: 'stripe_historie' };
  if (profilHatteAbo)           return { trialTage: 0, grund: 'profil_historie' };
  return { trialTage: TRIAL_TAGE, grund: 'erster_start' };
}

/**
 * Rueckkehrpfad nach dem Checkout.
 *
 * Nur interne Dashboard-Pfade; alles andere faellt auf /dashboard.
 * Dieselben Regeln wie action_token_ziel_ok in SQL: fuehrender Slash,
 * kein Protokoll, kein //, kein Backslash, kein javascript:/data:,
 * nur /dashboard oder /dashboard/… Laenge begrenzt, damit niemand
 * eine URL als Datentraeger missbraucht.
 *
 * @param {unknown} pfad
 * @returns {string} sicherer Pfad
 */
export function sichererRueckkehrpfad(pfad) {
  const standard = '/dashboard';
  if (typeof pfad !== 'string') return standard;
  const p = pfad.trim();
  if (p.length === 0 || p.length > 512) return standard;
  if (!p.startsWith('/')) return standard;
  if (p.includes('//')) return standard;
  if (p.includes('://') || p.includes('\\')) return standard;
  const klein = p.toLowerCase();
  /* Schema-Praefixe, die ein Browser ausfuehren oder einbetten wuerde.
     Zusammengesetzt, weil ESLint (no-script-url) das Literal selbst
     als Script-URL liest. */
  if (/(?:java|vb)script:|data:/.test(klein)) return standard;
  if (/[\s<>"'`]/.test(p)) return standard;
  if (p !== '/dashboard' && !p.startsWith('/dashboard/')) return standard;
  return p;
}

/**
 * Baut success_url/cancel_url. Der Rueckkehrpfad wird als eigener
 * Query-Parameter mitgegeben — nicht als Ziel selbst —, damit das
 * Dashboard erst die Freischaltung abwarten und dann weiterleiten
 * kann (Stripe-Webhook braucht Sekunden).
 */
export function baueCheckoutUrls(siteUrl, rueckkehrpfad) {
  const sicher = sichererRueckkehrpfad(rueckkehrpfad);
  const zurueck = sicher === '/dashboard' ? '' : `&zurueck=${encodeURIComponent(sicher)}`;
  return {
    successUrl: `${siteUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}${zurueck}`,
    cancelUrl:  `${siteUrl}${sicher}?checkout=cancelled`,
  };
}
