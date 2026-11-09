/*
 * Referral-Reward: Betrag und Wiederverwendung (WP10-Folgefix).
 *
 * Geteilt zwischen Jest und der Edge Function stripe-webhook. Reine
 * Funktionen ueber Stripe-foermige Objekte — kein Netz, kein Secret.
 *
 * Produktversprechen: „ein Monat WERKRUF Pro kostenlos“. Der Reward ist
 * deshalb der REGULAERE Monatsbetrag der Subscription-Price — nicht
 * invoice.amount_paid (Promotion-Code → halber Betrag), nicht total/subtotal
 * (Proration, Steuer). amount_paid sagt nur noch: > 0 → echte Conversion.
 */

/** Conversion-Kriterium: bezahlte Abo-Rechnung eines Kunden. */
export function istEchteConversion(invoice) {
  const bezahlt = Number(invoice?.amount_paid ?? 0);
  const subId = subscriptionIdAus(invoice);
  const customer = typeof invoice?.customer === 'string' ? invoice.customer : invoice?.customer?.id ?? null;
  return Boolean(customer && subId && Number.isFinite(bezahlt) && bezahlt > 0);
}

export function subscriptionIdAus(invoice) {
  const s = invoice?.subscription;
  if (typeof s === 'string') return s || null;
  return s?.id ?? null;
}

/**
 * Regulaerer Monatsbetrag aus der Subscription.
 *
 * Eindeutig heisst: genau EIN Item mit recurring/month/interval_count 1,
 * quantity 1, unit_amount > 0, Waehrung vorhanden. Alles andere ist
 * „nicht ermittelbar“ — kein Fallback auf amount_paid, keine feste Cent-
 * Heuristik. Der Aufrufer macht daraus einen Handler-Fehler (Retry).
 *
 * @returns {{ ok: true, amountCents: number, currency: string, priceId: string|null }
 *        | { ok: false, grund: string }}
 */
export function monatsbetragAusSubscription(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const monatlich = items.filter((i) => {
    const p = i?.price;
    return p && p.type === 'recurring'
      && p.recurring?.interval === 'month'
      && (p.recurring?.interval_count ?? 1) === 1
      && Number.isInteger(p.unit_amount) && p.unit_amount > 0;
  });
  if (monatlich.length === 0) return { ok: false, grund: 'kein_monatspreis' };
  if (monatlich.length > 1) return { ok: false, grund: 'mehrere_monatspreise' };
  const [item] = monatlich;
  if ((item.quantity ?? 1) !== 1) return { ok: false, grund: 'menge_ungleich_eins' };
  const currency = typeof item.price.currency === 'string' ? item.price.currency.toLowerCase() : '';
  if (!currency) return { ok: false, grund: 'keine_waehrung' };
  return { ok: true, amountCents: item.price.unit_amount, currency, priceId: item.price.id ?? null };
}

/**
 * Doppelcredit-Schutz jenseits des Stripe-Idempotency-Keys (24 h):
 * eine bereits gebuchte Gutschrift fuer diesen Reward wiederfinden.
 * Erkannt an metadata.werkruf_reward_id — das schreiben wir bei jeder
 * Buchung. Rueckgabe: die Transaktion oder null.
 */
export function findeBestehendeGutschrift(balanceTransactions, rewardId) {
  const liste = Array.isArray(balanceTransactions) ? balanceTransactions : [];
  return liste.find((t) => t?.metadata?.werkruf_reward_id === rewardId && Number(t.amount) < 0) ?? null;
}

/** Fehlertext fuer last_error — kurz, ohne Secrets (Stripe-Fehler tragen keine). */
export function fehlerKurz(err) {
  const m = err?.message ?? (typeof err === 'string' ? err : 'unbekannter Fehler');
  const typ = err?.type ? `${err.type}: ` : '';
  return `${typ}${m}`.slice(0, 300);
}
