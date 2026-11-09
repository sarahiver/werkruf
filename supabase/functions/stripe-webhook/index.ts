// supabase/functions/stripe-webhook/index.ts
//
// Fassung: 2026-09-11
//
// Geaendert gegenueber der Vorfassung:
//   1. Signaturpruefung ist Pflicht. Der frueherer else-Zweig akzeptierte
//      bei fehlendem STRIPE_WEBHOOK_SECRET beliebiges ungeprueftes JSON —
//      der Endpunkt hat kein JWT und eine vorhersagbare URL. Jetzt 400.
//   2. Idempotenz ueber public.stripe_events (Migration 019). Stripe
//      wiederholt bei Timeout/5xx; ohne das liefen Handler mehrfach.
//   3. Zustaendigkeiten getrennt: checkout.session.completed schickt die
//      Mail und merkt den Kunden vor. Der Abo-Zustand (plan,
//      trial_ends_at, status) gehoert AUSSCHLIESSLICH den
//      subscription.*-Events. Vorher schrieben beide, Reihenfolge nicht
//      garantiert.
//   4. User-Aufloesung mit Fallback: Metadaten → user_profiles ueber
//      stripe_customer_id → Stripe-Customer-Metadaten. Vorher brach der
//      Handler bei fehlenden Metadaten still ab (break ohne Log).
//   5. Path B (Setup-Fee, Admin-Mail, pending_subscription_price)
//      vollstaendig entfernt — laut Uebergabe §1 gestrichen.
//   6. Toter Ternaer (isSetup ? 'trial' : 'trial') entfernt,
//      doppelte Profil-Abfrage im payment_failed-Zweig zusammengelegt.
//   7. NACHTRAG 11.09. abends: Willkommensmail wieder entfernt. Sie wird
//      bereits vom Trigger on_user_confirmed_send_welcome eingereiht,
//      sobald der Nutzer seine Adresse bestaetigt — ueber email_queue,
//      mit Dedupe-Key und Beruecksichtigung von email_opt_out. Eine
//      zweite Mail beim Checkout waere eine Dublette in anderer
//      Gestaltung. Der Checkout-Handler merkt jetzt nur noch die
//      stripe_customer_id vor.
//
// VORAUSSETZUNG: Migration 019_stripe_events.sql ist eingespielt.
//
// Deploy via Supabase Dashboard:
//   Edge Functions → stripe-webhook → Code ersetzen → Deploy
//   Verify JWT: AUS (Stripe sendet keinen Authorization-Header)
//
// Benoetigte Secrets:
//   STRIPE_SECRET_KEY        sk_test_... / sk_live_...
//   STRIPE_WEBHOOK_SECRET    whsec_...  (Stripe → Developers → Webhooks)
//   SITE_URL                 https://werkruf.com
//
// Stripe-Endpunkt:
//   https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/stripe-webhook
//
// Events:
//   checkout.session.completed
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed
//   invoice.paid               (WP10 — im Stripe-Dashboard am Endpunkt aktivieren)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
/* Dieselbe Regel wie im Frontend und in den anderen Functions. Kein
   eigenes "=== 'founding_partner'" an einer vierten Stelle: genau so
   ist die Zugangsregel vor H1 viermal entstanden. */
import { darfZahlungsmahnung } from '../../../src/utils/subscription.js';
import { istEchteConversion, subscriptionIdAus, monatsbetragAusSubscription, findeBestehendeGutschrift, fehlerKurz } from '../../../src/utils/referralBetrag.js';
import { billingIntervalAusSubscription } from '../../../src/utils/tarife.js';

/* ═════════════════════════════════════════════
   HILFSFUNKTIONEN
   ═════════════════════════════════════════════ */

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Ermittelt die Supabase-User-ID zu einem Stripe-Ereignis.
 *
 * Drei Stufen, absteigend zuverlaessig:
 *   1. Metadaten am Objekt selbst (seit 2026-09-11 auf Session UND
 *      Subscription gesetzt)
 *   2. user_profiles.stripe_customer_id — greift bei Abos, die vor der
 *      Metadaten-Korrektur angelegt wurden, und bei Aenderungen ueber das
 *      Kundenportal
 *   3. Metadaten am Stripe-Customer — letzte Rueckfalloption
 *
 * Gibt null zurueck, wenn keine Stufe greift. Der Aufrufer protokolliert
 * das dann als Fehler, statt still abzubrechen.
 */
async function resolveUserId(
  supabase: SupabaseClient,
  stripe: Stripe,
  metadata: Record<string, string> | null | undefined,
  customerId: string | null | undefined,
): Promise<string | null> {

  const fromMeta = metadata?.supabase_user_id;
  if (fromMeta) return fromMeta;

  if (!customerId) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (profile?.id) {
    console.log(`[resolve] User ueber stripe_customer_id gefunden: ${profile.id}`);
    return profile.id as string;
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      const fromCustomer = (customer as Stripe.Customer).metadata?.supabase_user_id;
      if (fromCustomer) {
        console.log(`[resolve] User ueber Customer-Metadaten gefunden: ${fromCustomer}`);
        return fromCustomer;
      }
    }
  } catch (err) {
    console.error('[resolve] Customer nicht abrufbar:', err);
  }

  return null;
}

/** Stripe-Status → WERKRUF-Plan. */
/* ─────────────────────────────────────────────
   WP10 — Empfehlungsbonus
   ─────────────────────────────────────────────
   Die Wahrheit ueber Zuordnung, Conversion und Anspruch liegt in der
   Datenbank (referrals / referral_rewards). Stripe bekommt nur die
   Wirkung: eine Gutschrift auf dem Customer Balance in Hoehe eines
   Monatsbetrags, die Stripe mit der naechsten Rechnung verrechnet.
   Billing-cycle-nativ, stapelbar, kein Coupon, kein zweiter Trial.

   Idempotenz dreifach: stripe_events (Event), unique
   (referral_id, beneficiary) im Ledger, und der Stripe-Idempotency-Key
   = Reward-ID (dieselbe Gutschrift kann bei Stripe nicht zweimal
   entstehen, selbst wenn der Statuswechsel in der DB scheitert). */

interface RewardZeile { id: string; userId: string | null; beneficiary: string; amountCents: number; currency: string; status?: string; attemptCount?: number }

/* Rewards anwenden — Stripe Customer Balance.

   Retry-Modell (WP10-Folgefix): ein Stripe-Fehler ist NICHT terminal.
   Der Reward bleibt 'pending', der Versuch wird notiert, und der
   Aufrufer macht aus `failed > 0` einen Handler-Fehler → 500 → Stripe
   stellt das Event erneut zu → derselbe Reward wird mit DEMSELBEN
   Idempotency-Key (werkruf-referral-reward-<id>) erneut versucht.

   Doppelcredit-Schutz, zweistufig:
   1. Stripe-Idempotency-Key: derselbe Key liefert dieselbe Transaktion
      zurueck (24 h) — deckt auch „Stripe ok, DB-Update scheiterte“.
   2. Darueber hinaus: vor jeder Buchung die Balance-Transaktionen des
      Kunden nach metadata.werkruf_reward_id durchsuchen. Gefunden →
      keine neue Buchung, nur DB auf applied.
   Reihenfolge immer: Stripe erfolgreich → DB applied, nie umgekehrt.

   Terminal nur fachlich: Founding Partner → invalid(founding_partner).
   Ohne Stripe-Kunden (Free ohne je ein Abo) → bleibt pending, ohne
   Versuch — das ist kein Fehler, nur „noch nicht“. */
async function wendeRewardsAn(
  supabase: SupabaseClient, stripe: Stripe, rewards: RewardZeile[], anlass: string,
): Promise<{ applied: number; skipped: number; failed: number; fehler: string[] }> {
  const zaehler = { applied: 0, skipped: 0, failed: 0, fehler: [] as string[] };
  for (const r of rewards) {
    if (r.status && r.status !== 'pending') { zaehler.skipped++; continue; }
    if (!r.userId) { zaehler.skipped++; continue; }
    const { data: profil } = await supabase
      .from('user_profiles').select('stripe_customer_id, plan').eq('id', r.userId).maybeSingle();
    if (!profil?.stripe_customer_id) { zaehler.skipped++; continue; }
    if (profil.plan === 'founding_partner') {
      await supabase.rpc('referral_reward_set_status', { p_reward_id: r.id, p_status: 'invalid', p_stripe_object_id: null, p_reason: 'founding_partner' });
      zaehler.skipped++; continue;
    }
    try {
      /* Stufe 2: schon gebucht? (Idempotency-Key ist nach 24 h weg) */
      const bisherige = await stripe.customers.listBalanceTransactions(profil.stripe_customer_id, { limit: 100 });
      const vorhanden = findeBestehendeGutschrift(bisherige.data, r.id) as Stripe.CustomerBalanceTransaction | null;
      const tx = vorhanden ?? await stripe.customers.createBalanceTransaction(
        profil.stripe_customer_id,
        { amount: -Math.abs(r.amountCents), currency: r.currency || 'eur',
          description: `WERKRUF Empfehlungsbonus — ein Monat (${r.beneficiary === 'referrer' ? 'Werber' : 'Empfohlener'})`,
          metadata: { werkruf_reward_id: r.id, anlass } },
        { idempotencyKey: `werkruf-referral-reward-${r.id}` },
      );
      /* Erst Stripe, dann DB. Scheitert die DB: Reward bleibt pending,
         naechster Versuch findet die Buchung ueber Key oder Metadata. */
      await supabase.rpc('referral_reward_versuch_notieren', { p_reward_id: r.id, p_error: null });
      const { data: ok, error: setErr } = await supabase.rpc('referral_reward_set_status', {
        p_reward_id: r.id, p_status: 'applied', p_stripe_object_id: tx.id, p_reason: null,
      });
      if (setErr) throw setErr;
      if (ok) zaehler.applied++; else zaehler.skipped++;
      await supabase.from('audit_logs').insert({
        user_id: r.userId, actor_type: 'system', action: 'referral.reward_applied',
        entity_type: 'referral_reward', entity_id: r.id,
        metadata: { amountCents: r.amountCents, currency: r.currency, beneficiary: r.beneficiary, stripeObjectId: tx.id, anlass, wiederverwendet: Boolean(vorhanden) },
      });
    } catch (err) {
      /* transient oder unbekannt: pending bleibt, Versuch notieren, Retry ueber den Aufrufer */
      zaehler.failed++;
      const kurz = fehlerKurz(err);
      zaehler.fehler.push(`${r.id}: ${kurz}`);
      await supabase.rpc('referral_reward_versuch_notieren', { p_reward_id: r.id, p_error: kurz });
      console.error(`[stripe-webhook] referral reward ${r.id} noch nicht angewendet (bleibt pending):`, kurz);
    }
  }
  return zaehler;
}

/* Regulaerer Monatsbetrag der Subscription — Source of Truth fuer den
   Reward. Nicht eindeutig → null; der Aufrufer meldet Handler-Fehler
   (Retry), konvertiert nichts und erzeugt keinen falschen Reward. */
async function monatsbetragFuer(stripe: Stripe, subId: string): Promise<{ amountCents: number; currency: string; priceId: string | null } | { grund: string }> {
  const sub = await stripe.subscriptions.retrieve(subId);
  const m = monatsbetragAusSubscription(sub);
  if (m.ok) return { amountCents: m.amountCents, currency: m.currency, priceId: m.priceId };
  /* WP13 — Jahresabo: „ein Monat kostenlos" bleibt ein Monat des
     regulaeren MONATSplans (49 €), nicht 1/12 des Jahrespreises und
     nie der Jahresbetrag. Quelle ist die hinterlegte Monats-Price
     (STRIPE_PRICE_MONTHLY) — kein Hardcode. Ohne ENV → nicht
     ermittelbar (Retry), kein falscher Reward. */
  if (m.grund === 'kein_monatspreis' && billingIntervalAusSubscription(sub) === 'year') {
    const monthlyPriceId = Deno.env.get('STRIPE_PRICE_MONTHLY');
    if (!monthlyPriceId) return { grund: 'jahresabo_ohne_monatspreis_env' };
    const monthly = await stripe.prices.retrieve(monthlyPriceId);
    const mm = monatsbetragAusSubscription({ items: { data: [{ price: monthly, quantity: 1 }] } });
    return mm.ok ? { amountCents: mm.amountCents, currency: mm.currency, priceId: mm.priceId } : { grund: `jahresabo_monatspreis_${mm.grund}` };
  }
  return { grund: m.grund };
}

function mapStatusToPlan(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':             return 'pro';
    // user_profiles_plan_check only permits free/starter/pro in the
    // production schema. Trial is represented by Stripe's authoritative
    // subscription status plus trial_ends_at, while product access is pro.
    case 'trialing':           return 'pro';
    case 'past_due':           return 'pro';      // Zugang halten, Mahnung laeuft
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired': return 'free';
    case 'incomplete':
    case 'paused':             return 'free';
    default:                   return 'free';
  }
}

/* ── Read before write, und zwar nur wegen plan ──
   ═══════════════════════════════════════════════

   Diese Funktion war vor H1 ein blindes
   .update(values).eq('id', userId). Beide Schreibpfade
   (customer.subscription.created/updated und .deleted) setzen plan
   bedingungslos — jedes customer.subscription.updated, auch eines,
   das nur cancel_at_period_end aendert, haette einen Founding
   Partner auf 'pro' oder 'free' plattgetreten.

   Das ist kein theoretischer Fall: die ersten Founding Partner
   werden bestehende Nutzer sein, und ein gekuendigtes Abo erzeugt
   noch Wochen danach Events.

   Was geschuetzt wird, ist ausschliesslich plan. Die Stripe-Felder
   werden weiter geschrieben — die Buchhaltung soll die Historie
   behalten, und der Zugang des Founding Partners haengt nicht daran
   (src/utils/subscription.js prueft founding_partner VOR dem
   Stripe-Zweig).

   Nicht in mapStatusToPlan geloest, obwohl das naeherliegt: die
   Funktion kennt den Nutzer nicht, nur den Status. Ein Guard dort
   haette einen zweiten Datenbankzugriff an einer Stelle gebraucht,
   die rein rechnet. Hier ist der Engpass, durch den jeder
   plan-Schreibvorgang laeuft. */
async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  values: Record<string, unknown>,
): Promise<void> {
  let zuSchreiben = values;

  if ('plan' in zuSchreiben) {
    const { data, error: leseFehler } = await supabase
      .from('user_profiles').select('plan').eq('id', userId).maybeSingle();

    /* Lesefehler: NICHT schreiben. Ein Webhook, der im Zweifel
       ueberschreibt, nimmt einem Founding Partner den Zugang, und
       Stripe liefert den Event ohnehin erneut. */
    if (leseFehler) throw leseFehler;

    if (data?.plan === 'founding_partner') {
      const { plan: _bleibt, ...ohnePlan } = zuSchreiben;
      console.log(JSON.stringify({
        ereignis: 'plan_nicht_ueberschrieben',
        grund: 'founding_partner',
        userId,
        wollte: zuSchreiben.plan,
      }));
      zuSchreiben = ohnePlan;
      if (Object.keys(zuSchreiben).length === 0) return;
    }
  }

  const { error } = await supabase.from('user_profiles').update(zuSchreiben).eq('id', userId);
  if (error) throw error;
}

/* ═════════════════════════════════════════════
   HANDLER
   ═════════════════════════════════════════════ */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  /* ── Signatur: Pflicht, kein Dev-Modus ──
     Dieser Endpunkt laeuft ohne JWT und hat eine vorhersagbare URL.
     Ohne Signaturpruefung koennte jeder ein gefaelschtes
     customer.subscription.updated mit fremder User-ID einliefern. */
  const signature     = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const body          = await req.text();

  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET fehlt — Anfrage abgewiesen');
    return json({ error: 'Webhook not configured' }, 500);
  }

  if (!signature) {
    console.error('[stripe-webhook] Kein stripe-signature-Header');
    return json({ error: 'Signature required' }, 400);
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signaturpruefung fehlgeschlagen:', (err as Error).message);
    return json({ error: 'Invalid signature' }, 400);
  }

  /* ── Idempotenz ──
     Stripe wiederholt bei Timeout oder 5xx. Der Primaerschluessel
     entscheidet: wer schon drin ist, wird nicht nochmal verarbeitet. */
  const { error: insertError } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (insertError) {
    // 23505 = unique_violation → bereits verarbeitet, sauberer Fall
    if (insertError.code === '23505') {
      const { data: previous, error: lookupError } = await supabase
        .from('stripe_events').select('processed_at').eq('id', event.id).maybeSingle();
      if (lookupError) return json({ error: 'Idempotency check failed' }, 500);
      if (previous?.processed_at) {
        console.log(`[stripe-webhook] Event ${event.id} bereits verarbeitet — uebersprungen`);
        return json({ received: true, duplicate: true }, 200);
      }
      // The first delivery is still running (or failed before cleanup).
      // A non-2xx response makes Stripe retry instead of losing the event.
      return json({ error: 'Event is already being processed' }, 409);
    }
    console.error('[stripe-webhook] stripe_events nicht beschreibbar:', insertError);
    return json({ error: 'Idempotency storage unavailable' }, 500);
  }

  console.log(`[stripe-webhook] Event: ${event.type} (${event.id})`);

  let handlerError: string | null = null;

  try {
    switch (event.type) {

      /* ─────────────────────────────────────────────
         CHECKOUT ABGESCHLOSSEN

         Zustaendig fuer: stripe_customer_id vormerken. Sonst nichts.

         NICHT zustaendig fuer plan, trial_ends_at, subscription_status —
         das gehoert den subscription.*-Events, deren Reihenfolge
         gegenueber diesem Event nicht garantiert ist.

         NICHT zustaendig fuer die Willkommensmail — die haengt am
         Trigger on_user_confirmed_send_welcome (siehe Nachtrag 7 oben).
      ───────────────────────────────────────────── */
      case 'checkout.session.completed': {
        const session    = event.data.object as Stripe.Checkout.Session;
        const meta       = (session.metadata || {}) as Record<string, string>;
        const customerId = session.customer as string | null;

        const userId = await resolveUserId(supabase, stripe, meta, customerId);

        if (!userId) {
          handlerError = `checkout.session.completed ohne aufloesbare User-ID (session ${session.id})`;
          console.error(`[stripe-webhook] ${handlerError}`);
          break;
        }

        if (customerId) {
          await updateProfile(supabase, userId, { stripe_customer_id: customerId });
        }

        console.log(`✓ Checkout abgeschlossen fuer User ${userId}, Plan ${meta.plan_type || '?'}`);

        /* Bewusst KEINE Mail an dieser Stelle.
           Die Willkommensmail haengt am Trigger
           on_user_confirmed_send_welcome und laeuft ueber email_queue.
           Eine zweite hier waere eine Dublette. */

        break;
      }

      /* ─────────────────────────────────────────────
         ABO ANGELEGT / GEAENDERT

         Einzige Stelle, die plan und trial_ends_at schreibt.
      ───────────────────────────────────────────── */
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const eventSub   = event.data.object as Stripe.Subscription;
        // Stripe does not guarantee delivery order. Reading the current object
        // prevents an older `created` event from restoring access after cancel.
        const sub        = await stripe.subscriptions.retrieve(eventSub.id);
        const meta       = (sub.metadata || {}) as Record<string, string>;
        const customerId = sub.customer as string | null;

        const userId = await resolveUserId(supabase, stripe, meta, customerId);

        if (!userId) {
          handlerError = `${event.type} ohne aufloesbare User-ID (sub ${sub.id}, customer ${customerId})`;
          console.error(`[stripe-webhook] ${handlerError}`);
          break;
        }

        const plan = mapStatusToPlan(sub.status);

        await updateProfile(supabase, userId, {
            plan,
            stripe_customer_id:         customerId,
            stripe_subscription_id:     sub.id,
            stripe_subscription_status: sub.status,
            trial_started_at: sub.trial_start
              ? new Date(sub.trial_start * 1000).toISOString()
              : null,
            trial_ends_at: sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : null,
            stripe_cancel_at_period_end: sub.cancel_at_period_end,
            stripe_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            /* WP13 — Spiegel des Stripe-Intervalls (month | year). Aus den
               Items, nie aus Metadaten oder vom Client. Nicht ermittelbar
               → null, nicht raten. */
            stripe_billing_interval: billingIntervalAusSubscription(sub),
          });

        console.log(`✓ ${event.type}: User ${userId} → status ${sub.status}, plan ${plan}, interval ${billingIntervalAusSubscription(sub) ?? '?'}`);

        /* WP10 — ein Werber, der in Free war und jetzt wieder ein Abo
           hat: seine wartenden Empfehlungsboni werden jetzt
           gutgeschrieben. Nur bei created; updated kommt bei jeder
           Statusaenderung und braucht das nicht. */
        if (event.type === 'customer.subscription.created') {
          const { data: offen } = await supabase.rpc('referral_rewards_pending_for', { p_user_id: userId });
          const liste = (offen ?? []) as RewardZeile[];
          if (liste.length > 0) {
            const z = await wendeRewardsAn(supabase, stripe, liste, 'subscription_created');
            console.log(`✓ referral rewards nachgeholt fuer ${userId}: ${JSON.stringify(z)}`);
            /* Plan-Update oben ist idempotent — ein Retry wiederholt nur den Reward. */
            if (z.failed > 0) handlerError = `referral rewards ausstehend (${z.fehler.join('; ')})`;
          }
        }
        break;
      }

      /* ─────────────────────────────────────────────
         RECHNUNG BEZAHLT — WP10 Conversion
         ─────────────────────────────────────────────
         Nur eine ECHTE Zahlung zaehlt: amount_paid > 0 und die Rechnung
         gehoert zu einem Abo. Ein Trial erzeugt eine 0-€-Rechnung,
         ein verrechneter Bonus ebenfalls — beides ist keine Conversion.
         checkout.session.completed zaehlt nie (dort laeuft der Trial).

         amount_paid hat genau EINE Bedeutung: > 0 → echte Conversion.
         Der Reward ist der REGULAERE Monatsbetrag der Subscription-Price
         (unit_amount) — nicht amount_paid (Promotion-Code), nicht
         total/subtotal. Nicht eindeutig → Handler-Fehler, Stripe retryt,
         nichts wird konvertiert.

         Retry-Pfad: ist die Conversion schon durch und Rewards noch
         pending (Stripe-Fehler beim ersten Mal), wendet die erneute
         Zustellung sie an — gleicher Reward, gleicher Idempotency-Key. */
      case 'invoice.paid': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
        const subId      = subscriptionIdAus(invoice);
        if (!istEchteConversion(invoice) || !customerId || !subId) {
          console.log(`[stripe-webhook] invoice.paid ohne Relevanz (customer ${customerId}, sub ${subId}, paid ${invoice.amount_paid})`);
          break;
        }
        const { data: profile } = await supabase
          .from('user_profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
        if (!profile?.id) break;

        /* Erst schauen, ob es hier ueberhaupt ein Referral gibt — sonst
           kein Stripe-Aufruf fuer jede Rechnung jedes Kunden. */
        const { data: referral } = await supabase
          .from('referrals').select('id, status, referrer_user_id')
          .eq('referred_user_id', profile.id).in('status', ['signed_up', 'converted']).maybeSingle();
        if (!referral) break;

        let referralId: string = referral.id;
        if (referral.status === 'signed_up') {
          const betrag = await monatsbetragFuer(stripe, subId);
          if ('grund' in betrag) {
            handlerError = `referral: Monatsbetrag der Subscription ${subId} nicht eindeutig (${betrag.grund})`;
            break;
          }
          const { data: ergebnis, error: convErr } = await supabase.rpc('referral_mark_converted', {
            p_referred_user_id: profile.id, p_invoice_id: invoice.id,
            p_amount_cents: betrag.amountCents, p_currency: betrag.currency,
          });
          if (convErr) { handlerError = `referral_mark_converted: ${convErr.message}`; break; }
          const conv = (ergebnis ?? {}) as { converted?: boolean; referralId?: string; referrerUserId?: string };
          if (!conv.converted) break;
          referralId = conv.referralId ?? referralId;
          await supabase.from('audit_logs').insert({
            user_id: profile.id, actor_type: 'system', action: 'referral.converted',
            entity_type: 'referral', entity_id: referralId,
            metadata: { invoiceId: invoice.id, amountPaid: invoice.amount_paid, rewardAmountCents: betrag.amountCents, currency: betrag.currency, priceId: betrag.priceId, referrerUserId: conv.referrerUserId },
          });
        }

        const { data: offen } = await supabase.rpc('referral_rewards_pending_for_referral', { p_referral_id: referralId });
        const liste = (offen ?? []) as RewardZeile[];
        if (liste.length > 0) {
          const z = await wendeRewardsAn(supabase, stripe, liste, 'invoice_paid');
          console.log(`✓ referral ${referralId}: ${JSON.stringify(z)}`);
          if (z.failed > 0) handlerError = `referral rewards ausstehend (${z.fehler.join('; ')})`;
        }
        break;
      }

      /* ─────────────────────────────────────────────
         ABO BEENDET
      ───────────────────────────────────────────── */
      case 'customer.subscription.deleted': {
        const sub        = event.data.object as Stripe.Subscription;
        const meta       = (sub.metadata || {}) as Record<string, string>;
        const customerId = sub.customer as string | null;

        const userId = await resolveUserId(supabase, stripe, meta, customerId);

        if (!userId) {
          handlerError = `subscription.deleted ohne aufloesbare User-ID (sub ${sub.id})`;
          console.error(`[stripe-webhook] ${handlerError}`);
          break;
        }

        await updateProfile(supabase, userId, {
            plan:                       'free',
            stripe_subscription_id:     sub.id,
            stripe_subscription_status: 'canceled',
            stripe_cancel_at_period_end: false,
            stripe_current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            trial_ends_at:              null,
          });

        console.log(`✓ Abo beendet fuer User ${userId}`);
        break;
      }

      /* ─────────────────────────────────────────────
         ZAHLUNG FEHLGESCHLAGEN
      ───────────────────────────────────────────── */
      case 'invoice.payment_failed': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string | null;

        // Eine Abfrage statt zwei — die Vorfassung holte dasselbe Profil
        // zweimal, einmal fuer das Update und einmal fuer die Mail.
        //
        // plan kommt mit, weil der Mailversand ihn braucht (siehe
        // unten). Nicht ueber leseAccess(): das Profil liegt hier
        // schon vor, und ein zweiter Lesezugriff auf dieselbe Zeile
        // waere Arbeit ohne Erkenntnis.
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('id, company_name, plan')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (!profile?.id) {
          handlerError = `payment_failed ohne Profil zu customer ${customerId}`;
          console.error(`[stripe-webhook] ${handlerError}`);
          break;
        }

        await updateProfile(supabase, profile.id, { stripe_subscription_status: 'past_due' });

        console.log(`⚠ Zahlung fehlgeschlagen: User ${profile.id}, customer ${customerId}`);

        /* ── Die Mail, nicht das Event (H2.2 D) ──

           Gegated wird genau hier: nach dem Schreiben der
           Stripe-Spalten, vor dem Einreihen der Mail.

           Warum nicht das Event ueberspringen? Weil der Zustand bei
           Stripe wahr bleibt, auch wenn wir nicht mahnen. Ein
           uebersprungenes Event hiesse:

             - stripe_subscription_status bleibt auf dem alten Wert
             - der Buchhaltung fehlt die Historie
             - und wenn der Founding-Partner-Status spaeter endet,
               steht in der Datenbank ein Zustand, den Stripe
               laengst widerlegt hat

           Was falsch ist, ist nicht die Verarbeitung, sondern die
           Zahlungsaufforderung: ein Founding Partner soll fuer
           WERKRUF nichts zahlen. Ihn zu mahnen, weil eine alte
           Subscription scheitert, ist die Zusage gebrochen — und
           ausgerechnet gegenueber den ersten Kunden.

           Der dedupe_key bleibt unberuehrt. Wird derselbe Event nach
           einem Planwechsel erneut geliefert, greift die Pruefung
           dann nicht mehr und die Mail geht raus; das ist richtig so,
           denn dann ist der Nutzer kein Founding Partner mehr. */
        if (!darfZahlungsmahnung(profile)) {
          console.log(JSON.stringify({
            ereignis: 'mail_nicht_eingereiht',
            vorlage: 'payment_failed',
            grund: 'founding_partner',
            userId: profile.id,
            stripeEventId: event.id,
          }));
          break;
        }

        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
          const userEmail   = authUser?.user?.email;
          if (userEmail) {
            const { error: queueError } = await supabase.rpc('enqueue_email', {
              p_template: 'payment_failed',
              p_to_email: userEmail,
              p_dedupe_key: `payment_failed:${event.id}`,
              p_user_id: profile.id,
              p_to_name: profile.company_name || null,
              p_payload: {
                companyName: profile.company_name || null,
                industryKey: 'handwerk',
                stripeEventId: event.id,
              },
            });
            if (queueError) throw queueError;
          } else {
            console.warn(`[stripe-webhook] payment_failed ohne Empfaenger: User ${profile.id}`);
          }
        } catch (emailErr) {
          // Queue-Ausfälle müssen Stripe einen Fehler liefern. Stripe versucht
          // das Event erneut; der event-basierte dedupe_key verhindert dabei
          // eine zweite Queue-Zeile.
          console.error('[stripe-webhook] Mail nicht einreihbar:', emailErr);
          throw emailErr;
        }

        break;
      }

      default:
        console.log(`[stripe-webhook] Nicht behandelt: ${event.type}`);
    }

    if (handlerError) throw new Error(handlerError);

    /* ── Verarbeitung protokollieren ── */
    const { error: finishError } = await supabase
      .from('stripe_events')
      .update({
        processed_at:  new Date().toISOString(),
        error_message: handlerError,
      })
      .eq('id', event.id);
    if (finishError) throw finishError;

    return json({ received: true }, 200);

  } catch (err) {
    const message = (err as Error).message;
    console.error('[stripe-webhook] Handler-Fehler:', err);

    // Release the claim. All business updates above are idempotent, so a
    // Stripe retry can safely complete instead of being mistaken for a
    // successfully processed duplicate.
    const { error: releaseError } = await supabase
      .from('stripe_events').delete().eq('id', event.id).is('processed_at', null);
    if (releaseError) console.error('[stripe-webhook] Event-Claim nicht freigegeben:', releaseError);

    return json({ error: message }, 500);
  }
});
