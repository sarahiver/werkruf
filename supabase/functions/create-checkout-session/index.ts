// supabase/functions/create-checkout-session/index.ts
//
// Fassung: 2026-09-11
//
// Geaendert gegenueber der Vorfassung:
//   1. subscription_data.metadata wird gesetzt. Ohne das erhaelt die
//      Subscription KEINE Metadaten (Stripe reicht Session-Metadaten nicht
//      durch), und alle Subscription-Handler im Webhook brechen ab.
//      Folge waere: gekuendigte Kunden behalten dauerhaft Zugang.
//   2. Trial-Periode explizit gesetzt statt auf die Price-Konfiguration zu
//      vertrauen. Vorher konnte sofort abgebucht werden, waehrend Frontend
//      und Mail "30 Tage kostenlos" versprechen.
//   3. Path B (Setup-Fee) vollstaendig entfernt — laut Uebergabe §1
//      ersatzlos gestrichen. STRIPE_PRICE_SETUP_FEE wird nicht mehr gelesen.
//   4. Plan-Validierung: ungueltiger plan-Wert gibt 400 statt eine Session
//      mit falschem Preis.
//
// Deploy via Supabase Dashboard:
//   Edge Functions → create-checkout-session → Code ersetzen → Deploy
//
// Benoetigte Secrets:
//   STRIPE_SECRET_KEY        sk_test_... oder sk_live_...
//   STRIPE_PRICE_MONTHLY     price_...
//   SITE_URL                 https://werkruf.com

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { entscheideTrial, baueCheckoutUrls, TRIAL_TAGE } from '../../../src/utils/checkoutRegeln.js';
import { hatteSchonAbo } from '../../../src/utils/subscription.js';

/* ─────────────────────────────────────────────
   KONFIGURATION
───────────────────────────────────────────── */

// Testphase in Tagen — NUR beim ersten Abo (WP7 §10).
//
// Vor WP7 stand hier eine Konstante, die jeder Checkout bekam. Ein
// Kunde, der kuendigte und neu abschloss, bekam erneut 30 Tage gratis;
// beliebig oft. Jetzt entscheidet entscheideTrial() aus
// src/utils/checkoutRegeln.js: Stripe-Historie des Customers zuerst,
// Profil als zweite Quelle. Wiedereinstieg → 0 Tage, 49 €/Monat ab
// sofort. Die Zahl selbst (TRIAL_TAGE) steht in der geteilten Datei,
// damit Frontend-Texte und Function dieselbe nennen.
//
// WICHTIG: Falls am Stripe-Price bereits eine Trial konfiguriert ist,
// ueberschreibt trial_period_days sie; bei 0 Tagen wird der Parameter
// gar nicht gesetzt — dann gilt, was am Price steht. Deshalb darf am
// Price KEIN Trial konfiguriert sein (siehe Doku).

type PlanKey = 'monthly';
const VALID_PLANS: PlanKey[] = ['monthly'];

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/* ─────────────────────────────────────────────
   HANDLER
───────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    /* ── Auth: Supabase-JWT pruefen ── */
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    /* ── Eingabe ── */
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Ungueltiger Request-Body' }, 400);
    }

    const plan        = String(payload.plan ?? '') as PlanKey;
    const companyName = typeof payload.companyName === 'string' ? payload.companyName : '';
    const industryKey = typeof payload.industryKey === 'string' ? payload.industryKey : 'handwerk';
    /* Wohin nach dem Bezahlen — validiert in baueCheckoutUrls, nie
       roh uebernommen (WP7 §19: kein Open Redirect). */
    const returnPath  = typeof payload.returnPath === 'string' ? payload.returnPath : '';

    // path wird noch vom Frontend mitgeschickt, aber ignoriert.
    // Path B ist gestrichen — es gibt nur noch einen Weg.

    if (!VALID_PLANS.includes(plan)) {
      return json({ error: `Ungueltiger Plan: ${plan}` }, 400);
    }

    /* ── Preis aufloesen ── */
    const PRICES: Record<PlanKey, string | undefined> = {
      monthly:   Deno.env.get('STRIPE_PRICE_MONTHLY'),
    };

    const priceId = PRICES[plan];
    if (!priceId) {
      console.error(`[checkout] Kein Price hinterlegt fuer Plan "${plan}"`);
      return json({ error: 'Preis nicht konfiguriert' }, 500);
    }

    const siteUrl = Deno.env.get('SITE_URL');
    if (!siteUrl) return json({ error: 'Checkout ist nicht konfiguriert' }, 500);

    /* ── Stripe ── */
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    /* Fail closed when test/live secrets or the configured product do not
       match. This never creates products; it only validates the existing
       monthly price before a customer can enter Checkout. */
    const configuredPrice = await stripe.prices.retrieve(priceId);
    const usesLiveSecret = Deno.env.get('STRIPE_SECRET_KEY')?.startsWith('sk_live_') ?? false;
    if (configuredPrice.livemode !== usesLiveSecret ||
        configuredPrice.currency !== 'eur' ||
        configuredPrice.unit_amount !== 4900 ||
        configuredPrice.type !== 'recurring' ||
        configuredPrice.recurring?.interval !== 'month') {
      console.error('[checkout] STRIPE_PRICE_MONTHLY passt nicht zu 49 EUR/Monat oder zum Stripe-Modus');
      return json({ error: 'Preis ist nicht korrekt konfiguriert' }, 500);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    /* ── Stripe-Kunde holen oder anlegen ── */
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id, company_name, stripe_subscription_status, stripe_subscription_id, trial_ends_at')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !profile) {
      console.error('[checkout] Profil nicht ladbar:', profileError);
      return json({ error: 'Profil konnte nicht geladen werden' }, 500);
    }

    // Wer bereits ein laufendes Abo hat, soll kein zweites abschliessen.
    const aktiveZustaende = ['active', 'trialing', 'past_due'];
    if (profile?.stripe_subscription_status &&
        aktiveZustaende.includes(profile.stripe_subscription_status)) {
      return json({
        error: 'Es existiert bereits ein aktives Abo. Aenderungen ueber das Kundenportal.',
      }, 409);
    }

    let customerId = profile?.stripe_customer_id as string | undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name:  companyName || profile?.company_name || '',
        metadata: {
          supabase_user_id: user.id,
          industry_key:     industryKey,
          company_name:     companyName || '',
        },
      });
      customerId = customer.id;

      const { error: saveCustomerError } = await supabaseAdmin
        .from('user_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
      if (saveCustomerError) throw saveCustomerError;
    }

    /* ── Trial: nur beim ersten Abo (WP7 §10) ──
       Stripe ist die Wahrheit: irgendeine Subscription in der Historie
       dieses Customers — egal ob canceled, incomplete_expired oder
       noch laufend — heisst: kein erster Start. status: 'all' liefert
       auch beendete. limit 1 reicht, es geht um Existenz. */
    let stripeHatteSubscriptions = false;
    if (profile?.stripe_customer_id) {
      const bisherige = await stripe.subscriptions.list({
        customer: customerId, status: 'all', limit: 1,
      });
      stripeHatteSubscriptions = bisherige.data.length > 0;
    }
    const trial = entscheideTrial({
      stripeHatteSubscriptions,
      profilHatteAbo: hatteSchonAbo(profile),
    });

    const urls = baueCheckoutUrls(siteUrl, returnPath);

    /* ── Gemeinsame Metadaten ──
       Dieselben Werte auf Session UND Subscription. Stripe kopiert
       Session-Metadaten nicht auf die Subscription; der Webhook liest
       aber bei subscription.* ausschliesslich die Subscription-Metadaten. */
    const sharedMetadata: Record<string, string> = {
      supabase_user_id: user.id,
      plan_type:        plan,
      industry_key:     industryKey,
      company_name:     companyName || '',
      trial_grund:      trial.grund,
    };

    /* ── Checkout-Session ── */
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer:    customerId,
      client_reference_id: user.id,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: urls.successUrl,
      cancel_url:  urls.cancelUrl,
      metadata:    sharedMetadata,
      subscription_data: {
        metadata: sharedMetadata,
        ...(trial.trialTage > 0 ? { trial_period_days: trial.trialTage } : {}),
      },
      allow_promotion_codes: true,
      // Stripe vergibt die Idempotenz normalerweise selbst; ein wiederholter
      // Klick auf "Jetzt buchen" erzeugt sonst mehrere offene Sessions.
      // Harmlos (nur eine wird bezahlt), aber unuebersichtlich im Dashboard.
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log(`[checkout] Session ${session.id} fuer User ${user.id}, Plan ${plan}, Trial ${trial.trialTage}d (${trial.grund})`);

    /* trialTage geht mit zurueck, damit die Oberflaeche nichts
       verspricht, was Stripe gleich nicht einloest. */
    return json({ url: session.url, sessionId: session.id, trialTage: trial.trialTage, trialMax: TRIAL_TAGE }, 200);

  } catch (err) {
    console.error('[checkout] Fehler:', err);
    return json({ error: 'Checkout konnte nicht gestartet werden' }, 500);
  }
});
