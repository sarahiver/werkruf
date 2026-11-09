/**
 * WP10-Folgefix — Referral-Monatsbetrag und Reward-Retry.
 *
 *   T1–T5   Betrag = regulaerer Monatsbetrag der Subscription-Price,
 *           nicht amount_paid; Waehrung aus der Price; unklar → kein Reward
 *   T6–T9   Retry: Stripe-Fehler nicht terminal, gleicher Key, Wieder-
 *           verwendung ueber Metadata, applied nie erneut
 *   T10/T11 FP und Free unveraendert
 *   T12–T15 Conversion bleibt richtig
 *
 * Die Webhook-Wirkung wird am Quelltext gemessen (Deno-Funktion), die
 * Datenbankseite in supabase/tests/referral_reward_retry.test.sql.
 */
import fs from 'fs';
import path from 'path';
import {
  istEchteConversion, subscriptionIdAus, monatsbetragAusSubscription, findeBestehendeGutschrift, fehlerKurz,
} from './utils/referralBetrag';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const W = lies('../supabase/functions/stripe-webhook/index.ts');
const paidAnfang = W.indexOf("case 'invoice.paid'");
const PAID = W.slice(paidAnfang, W.indexOf("case '", paidAnfang + 1));
const WENDE = W.slice(W.indexOf('async function wendeRewardsAn'), W.indexOf('async function monatsbetragFuer'));

const price = (over = {}) => ({ id: 'price_pro', type: 'recurring', unit_amount: 4900, currency: 'eur', recurring: { interval: 'month', interval_count: 1 }, ...over });
const sub = (items) => ({ id: 'sub_1', items: { data: items } });
const invoice = (over = {}) => ({ id: 'in_1', customer: 'cus_1', subscription: 'sub_1', amount_paid: 4900, currency: 'eur', ...over });

describe('T1–T5 — Monatsbetrag aus der Subscription-Price', () => {
  it('T1 — Price 4900, amount_paid 4900 → Reward 4900', () => {
    expect(monatsbetragAusSubscription(sub([{ price: price(), quantity: 1 }]))).toEqual({ ok: true, amountCents: 4900, currency: 'eur', priceId: 'price_pro' });
  });
  it('T2 — Rabattfall: amount_paid 2450 → Conversion ja, Reward trotzdem 4900 (Betrag haengt nicht an der Rechnung)', () => {
    const inv = invoice({ amount_paid: 2450 });
    expect(istEchteConversion(inv)).toBe(true);
    expect(monatsbetragAusSubscription(sub([{ price: price(), quantity: 1 }])).amountCents).toBe(4900);
    /* und der Webhook nimmt den Betrag aus der Subscription, nicht aus der Rechnung */
    expect(PAID).toMatch(/const betrag = await monatsbetragFuer\(stripe, subId\);/);
    expect(PAID).toMatch(/p_amount_cents: betrag\.amountCents, p_currency: betrag\.currency/);
    expect(PAID).not.toMatch(/p_amount_cents: (bezahlt|invoice\.amount_paid|invoice\.total|invoice\.subtotal)/);
  });
  it('T3/T13 — amount_paid 0 (Trial-Rechnung) → keine Conversion', () => {
    expect(istEchteConversion(invoice({ amount_paid: 0 }))).toBe(false);
    expect(istEchteConversion(invoice({ amount_paid: -100 }))).toBe(false);
    expect(istEchteConversion(invoice({ subscription: null }))).toBe(false);
    expect(istEchteConversion(invoice({ customer: null }))).toBe(false);
    expect(PAID).toMatch(/if \(!istEchteConversion\(invoice\) \|\| !customerId \|\| !subId\) \{/);
  });
  it('T4 — Price nicht eindeutig → kein Reward, Handler-Fehler (Stripe retryt), keine Conversion', () => {
    expect(monatsbetragAusSubscription(sub([]))).toEqual({ ok: false, grund: 'kein_monatspreis' });
    expect(monatsbetragAusSubscription(sub([{ price: price(), quantity: 1 }, { price: price({ id: 'price_2' }), quantity: 1 }]))).toEqual({ ok: false, grund: 'mehrere_monatspreise' });
    expect(monatsbetragAusSubscription(sub([{ price: price({ recurring: { interval: 'year', interval_count: 1 } }), quantity: 1 }]))).toEqual({ ok: false, grund: 'kein_monatspreis' });
    expect(monatsbetragAusSubscription(sub([{ price: price({ recurring: { interval: 'month', interval_count: 3 } }), quantity: 1 }]))).toEqual({ ok: false, grund: 'kein_monatspreis' });
    expect(monatsbetragAusSubscription(sub([{ price: price({ type: 'one_time', recurring: null }), quantity: 1 }]))).toEqual({ ok: false, grund: 'kein_monatspreis' });
    expect(monatsbetragAusSubscription(sub([{ price: price({ unit_amount: 0 }), quantity: 1 }]))).toEqual({ ok: false, grund: 'kein_monatspreis' });
    expect(monatsbetragAusSubscription(sub([{ price: price(), quantity: 2 }]))).toEqual({ ok: false, grund: 'menge_ungleich_eins' });
    expect(monatsbetragAusSubscription(sub([{ price: price({ currency: '' }), quantity: 1 }]))).toEqual({ ok: false, grund: 'keine_waehrung' });
    expect(monatsbetragAusSubscription(null)).toEqual({ ok: false, grund: 'kein_monatspreis' });
    /* Webhook: unklar → handlerError + break VOR referral_mark_converted; keine 4900-Heuristik, kein amount_paid-Fallback */
    const vorConv = PAID.slice(0, PAID.indexOf("rpc('referral_mark_converted'"));
    expect(vorConv).toMatch(/if \('grund' in betrag\) \{\s*handlerError = `referral: Monatsbetrag der Subscription \$\{subId\} nicht eindeutig \(\$\{betrag\.grund\}\)`;\s*break;/);
    expect(PAID).not.toMatch(/4900|amount_paid \?\? /);
    expect(lies('utils/referralBetrag.js')).not.toMatch(/4900/);
  });
  it('T5 — Waehrung aus der Price (klein geschrieben), nicht pauschal eur', () => {
    expect(monatsbetragAusSubscription(sub([{ price: price({ currency: 'CHF' }), quantity: 1 }])).currency).toBe('chf');
    expect(PAID).not.toMatch(/p_currency: (invoice\.currency|'eur')/);
  });
  it('Subscription-ID aus String oder Objekt', () => {
    expect(subscriptionIdAus({ subscription: 'sub_x' })).toBe('sub_x');
    expect(subscriptionIdAus({ subscription: { id: 'sub_y' } })).toBe('sub_y');
    expect(subscriptionIdAus({ subscription: null })).toBeNull();
  });
  it('Kein Stripe-Aufruf ohne Referral: erst referrals pruefen, dann Subscription laden', () => {
    const iRef = PAID.indexOf(".from('referrals')");
    const iSub = PAID.indexOf('monatsbetragFuer(stripe, subId)');
    expect(iRef).toBeGreaterThan(-1);
    expect(iSub).toBeGreaterThan(iRef);
    expect(PAID).toMatch(/if \(!referral\) break;/);
    expect(PAID).toMatch(/\.in\('status', \['signed_up', 'converted'\]\)/);
  });
});

describe('T6–T9 — Retry ohne Doppelcredit', () => {
  it('T6 — Stripe-Fehler: Reward bleibt pending, Versuch notiert, Handler-Fehler → Stripe retryt', () => {
    const fang = WENDE.slice(WENDE.indexOf('} catch (err) {'));
    expect(fang).toMatch(/rpc\('referral_reward_versuch_notieren', \{ p_reward_id: r\.id, p_error: kurz \}\)/);
    expect(fang).not.toMatch(/p_status: 'failed'/);
    expect(WENDE).not.toMatch(/'failed'/);
    expect(PAID).toMatch(/if \(z\.failed > 0\) handlerError = `referral rewards ausstehend/);
    /* handlerError → throw → Claim in stripe_events freigegeben → 500 */
    expect(W).toMatch(/if \(handlerError\) throw new Error\(handlerError\);/);
    expect(W).toMatch(/\.from\('stripe_events'\)\.delete\(\)\.eq\('id', event\.id\)\.is\('processed_at', null\)/);
  });
  it('T7 — erneute Zustellung nach Conversion wendet pending Rewards an (gleicher Reward)', () => {
    expect(PAID).toMatch(/rpc\('referral_rewards_pending_for_referral', \{ p_referral_id: referralId \}\)/);
    /* laeuft auch, wenn referral.status bereits 'converted' ist: ausserhalb des if (signed_up) */
    const nachIf = PAID.slice(PAID.lastIndexOf("referral_rewards_pending_for_referral"));
    expect(PAID.indexOf("if (referral.status === 'signed_up') {")).toBeLessThan(PAID.indexOf("referral_rewards_pending_for_referral"));
    expect(nachIf).toMatch(/wendeRewardsAn\(supabase, stripe, liste, 'invoice_paid'\)/);
    /* unbedingt: der Aufruf haengt an keiner Status-Bedingung */
    expect(PAID).toMatch(/\n\s*const \{ data: offen \} = await supabase\.rpc\('referral_rewards_pending_for_referral'/);
    expect(PAID).not.toMatch(/referral\.status === 'signed_up'\s*\?/);
    expect(PAID.match(/referral\.status === 'signed_up'/g)).toHaveLength(1);
  });
  it('T8/C3 — Idempotency-Key = Reward-ID; Stripe ok + DB scheitert → naechster Versuch findet die Buchung (Key oder Metadata)', () => {
    expect(WENDE).toMatch(/idempotencyKey: `werkruf-referral-reward-\$\{r\.id\}`/);
    expect(WENDE).not.toMatch(/idempotencyKey: `[^`]*(Date\.now|attempt|random|event\.id)/);
    /* Reihenfolge: Stripe → DB, nie umgekehrt */
    const iStripe = WENDE.indexOf('createBalanceTransaction(');
    const iDb = WENDE.indexOf("p_status: 'applied'");
    expect(iStripe).toBeGreaterThan(-1);
    expect(iDb).toBeGreaterThan(iStripe);
    /* DB-Fehler wird geworfen → catch → pending bleibt (kein applied ohne DB) */
    expect(WENDE).toMatch(/if \(setErr\) throw setErr;/);
    /* Stufe 2: bestehende Gutschrift ueber Metadata wiederverwenden statt neu buchen */
    expect(WENDE).toMatch(/listBalanceTransactions\(profil\.stripe_customer_id, \{ limit: 100 \}\)/);
    expect(WENDE).toMatch(/const tx = vorhanden \?\? await stripe\.customers\.createBalanceTransaction\(/);
    expect(WENDE).toMatch(/metadata: \{ werkruf_reward_id: r\.id, anlass \}/);
    const txs = [{ id: 'cbtxn_alt', amount: -4900, metadata: { werkruf_reward_id: 'rw-1' } }, { id: 'cbtxn_x', amount: -4900, metadata: {} }];
    expect(findeBestehendeGutschrift(txs, 'rw-1')?.id).toBe('cbtxn_alt');
    expect(findeBestehendeGutschrift(txs, 'rw-2')).toBeNull();
    expect(findeBestehendeGutschrift([{ id: 'cbtxn_pos', amount: 4900, metadata: { werkruf_reward_id: 'rw-1' } }], 'rw-1')).toBeNull();
    expect(findeBestehendeGutschrift(null, 'rw-1')).toBeNull();
  });
  it('T9 — applied nie erneut: nur pending wird angefasst', () => {
    expect(WENDE).toMatch(/if \(r\.status && r\.status !== 'pending'\) \{ zaehler\.skipped\+\+; continue; \}/);
    const mig = lies('../supabase/migrations/20261111120000_referral_reward_retry.sql');
    expect(mig).toMatch(/where r\.referral_id = p_referral_id and r\.status = 'pending'/);
    expect(mig).toMatch(/where id = p_reward_id and status = 'pending'/);
  });
  it('Fehlertext kurz, mit Stripe-Typ', () => {
    expect(fehlerKurz({ type: 'StripeConnectionError', message: 'timeout' })).toBe('StripeConnectionError: timeout');
    expect(fehlerKurz('x'.repeat(400)).length).toBe(300);
    expect(fehlerKurz(null)).toBe('unbekannter Fehler');
  });
});

describe('T10/T11 — FP und Free unveraendert', () => {
  it('T10 — Founding Partner: invalid(founding_partner), kein Stripe-Aufruf', () => {
    const fp = WENDE.slice(WENDE.indexOf("if (profil.plan === 'founding_partner') {"), WENDE.indexOf('try {'));
    expect(fp).toMatch(/p_status: 'invalid'[^}]*p_reason: 'founding_partner'/);
    expect(fp).toMatch(/continue;/);
    expect(fp).not.toMatch(/stripe\./);
    const mig = lies('../supabase/migrations/20261111090000_empfehlungslink.sql');
    expect(mig).toMatch(/case when v_plan = 'founding_partner' then 'not_applicable' else 'pending' end/);
  });
  it('T11 — Free-Werber ohne Stripe-Kunden: pending bleibt, kein Versuch; Nachholung bei subscription.created mit Retry', () => {
    expect(WENDE).toMatch(/if \(!profil\?\.stripe_customer_id\) \{ zaehler\.skipped\+\+; continue; \}/);
    const created = W.slice(W.indexOf("case 'customer.subscription.created'"), W.indexOf("case 'invoice.paid'"));
    expect(created).toMatch(/rpc\('referral_rewards_pending_for', \{ p_user_id: userId \}\)/);
    expect(created).toMatch(/if \(z\.failed > 0\) handlerError = `referral rewards ausstehend/);
  });
});

describe('T12–T15 — Conversion bleibt richtig', () => {
  it('T12 — checkout.session.completed konvertiert nicht', () => {
    const checkout = W.slice(W.indexOf("case 'checkout.session.completed'"), W.indexOf("case 'customer.subscription.created'"));
    expect(checkout).not.toMatch(/referral/);
  });
  it('T14/T15 — Conversion genau einmal, zweite Rechnung keine neuen Rewards (SQL-Regel + Webhook-Pfad)', () => {
    const mig = lies('../supabase/migrations/20261111090000_empfehlungslink.sql');
    expect(mig).toMatch(/where referred_user_id = p_referred_user_id and status = 'signed_up'/);
    expect(mig).toMatch(/unique \(referral_id, beneficiary\)/);
    /* Webhook: referral_mark_converted nur im signed_up-Zweig */
    const idx = PAID.indexOf("rpc('referral_mark_converted'");
    expect(PAID.lastIndexOf("if (referral.status === 'signed_up') {", idx)).toBeGreaterThan(-1);
    expect(PAID).toMatch(/if \(!conv\.converted\) break;/);
  });
  it('invoice.paid aendert nie den Plan', () => {
    expect(PAID).not.toMatch(/updateProfile|mapStatusToPlan/);
  });
});
