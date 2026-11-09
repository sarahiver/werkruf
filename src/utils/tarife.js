/*
 * Tarife (WP13) — geteilt zwischen Jest, create-checkout-session,
 * stripe-webhook und dem Frontend.
 *
 * Zwei Abrechnungsintervalle, ein Produkt:
 *   monthly  49 € / Monat
 *   yearly  490 € / Jahr   (12 × 49 = 588; Ersparnis 98 € = 2 Monate)
 *
 * Die Stripe-Price-IDs stehen NIE hier — sie kommen aus ENV
 * (STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY). Hier steht nur, was ein
 * Intervall bedeutet und wie die hinterlegte Price auszusehen hat,
 * damit der Checkout fail-closed pruefen kann.
 */

export const TARIFE = Object.freeze({
  monthly: Object.freeze({ key: 'monthly', interval: 'month', betragCents: 4900, currency: 'eur', env: 'STRIPE_PRICE_MONTHLY', label: 'Monatlich', preisText: '49 € / Monat' }),
  yearly:  Object.freeze({ key: 'yearly',  interval: 'year',  betragCents: 49000, currency: 'eur', env: 'STRIPE_PRICE_YEARLY',  label: 'Jährlich',  preisText: '490 € / Jahr' }),
});

export const TARIF_KEYS = Object.freeze(Object.keys(TARIFE));

/** 12 × Monat − Jahr = 98 € → „2 Monate geschenkt". Exakt, kein Prozent. */
export const JAHRES_ERSPARNIS_CENTS = TARIFE.monthly.betragCents * 12 - TARIFE.yearly.betragCents;
export const JAHRES_ERSPARNIS_MONATE = Math.floor(JAHRES_ERSPARNIS_CENTS / TARIFE.monthly.betragCents);

/**
 * Client-Eingabe → Tarif. Akzeptiert das bestehende Feld `plan`
 * ('monthly' seit WP7) und als Alias `billingInterval` ('monthly' |
 * 'yearly'). Alles andere → null (der Server antwortet 400). Eine
 * Price-ID vom Client wird nie angenommen.
 */
export function tarifAusEingabe(payload) {
  const roh = payload?.plan ?? payload?.billingInterval;
  if (typeof roh !== 'string') return null;
  const key = roh.trim().toLowerCase();
  return TARIF_KEYS.includes(key) ? TARIFE[key] : null;
}

/**
 * Passt die in Stripe hinterlegte Price zum Tarif? Fail closed: jede
 * Abweichung (Betrag, Waehrung, Intervall, Typ, Live-/Testmodus) ist
 * ein Konfigurationsfehler — kein Checkout.
 */
export function pricePasstZuTarif(price, tarif, usesLiveSecret) {
  if (!price || !tarif) return false;
  return price.livemode === usesLiveSecret
    && price.currency === tarif.currency
    && price.unit_amount === tarif.betragCents
    && price.type === 'recurring'
    && price.recurring?.interval === tarif.interval
    && (price.recurring?.interval_count ?? 1) === 1;
}

/**
 * Abrechnungsintervall einer Stripe-Subscription — die Wahrheit fuer
 * user_profiles.stripe_billing_interval. Genau ein recurring Item mit
 * interval_count 1 → 'month' | 'year'; sonst null (nicht raten).
 */
export function billingIntervalAusSubscription(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const recurring = items.filter((i) => i?.price?.type === 'recurring' && (i.price.recurring?.interval_count ?? 1) === 1);
  if (recurring.length !== 1) return null;
  const iv = recurring[0].price.recurring?.interval;
  return iv === 'month' || iv === 'year' ? iv : null;
}

/** Anzeige im Settings-Billing-Block — nur echte Daten, sonst null. */
export function intervallText(interval) {
  if (interval === 'year')  return TARIFE.yearly.preisText;
  if (interval === 'month') return TARIFE.monthly.preisText;
  return null;
}
