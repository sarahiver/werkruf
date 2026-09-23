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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

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

async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('user_profiles').update(values).eq('id', userId);
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
          });

        console.log(`✓ ${event.type}: User ${userId} → status ${sub.status}, plan ${plan}`);
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
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('id, company_name')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (!profile?.id) {
          handlerError = `payment_failed ohne Profil zu customer ${customerId}`;
          console.error(`[stripe-webhook] ${handlerError}`);
          break;
        }

        await updateProfile(supabase, profile.id, { stripe_subscription_status: 'past_due' });

        console.log(`⚠ Zahlung fehlgeschlagen: User ${profile.id}, customer ${customerId}`);

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
