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
//   BREVO_API_KEY
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
   MAILVERSAND
   ═════════════════════════════════════════════ */

interface EmailPayload {
  to:       { email: string; name?: string };
  subject:  string;
  html:     string;
  from?:    { email: string; name: string };
  replyTo?: string;
}

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  if (!apiKey) {
    console.error('[sendEmail] BREVO_API_KEY nicht gesetzt');
    return false;
  }

  const from = payload.from || {
    email: Deno.env.get('BREVO_SENDER_EMAIL') || 'hallo@werkruf.com',
    name:  Deno.env.get('BREVO_SENDER_NAME')  || 'WERKRUF',
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender:      from,
        to:          [{ email: payload.to.email, name: payload.to.name || payload.to.email }],
        subject:     payload.subject,
        htmlContent: payload.html,
        replyTo:     payload.replyTo ? { email: payload.replyTo } : undefined,
      }),
    });

    if (!res.ok) {
      console.error('[sendEmail] Brevo-Fehler:', res.status, await res.text());
      return false;
    }

    console.log('[sendEmail] Gesendet an:', payload.to.email, '|', payload.subject);
    return true;

  } catch (err) {
    console.error('[sendEmail] Fetch-Fehler:', err);
    return false;
  }
}

function buildEmailHtml({
  greeting,
  headline,
  body,
  ctaText,
  ctaUrl,
  footerNote,
  primaryColor = '#002C51',
  accentColor  = '#FF8C00',
  signature    = 'Dein WERKRUF-Team',
  senderEmail  = 'hallo@werkruf.com',
}: {
  greeting:      string;
  headline:      string;
  body:          string;
  ctaText?:      string;
  ctaUrl?:       string;
  footerNote?:   string;
  primaryColor?: string;
  accentColor?:  string;
  signature?:    string;
  senderEmail?:  string;
}): string {
  const cta = ctaText && ctaUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr><td align="center">
        <a href="${ctaUrl}"
          style="display:inline-block;padding:14px 36px;
            background:${accentColor};color:#ffffff;
            font-size:14px;font-weight:700;text-transform:uppercase;
            letter-spacing:2px;text-decoration:none;">
          ${ctaText} →
        </a>
      </td></tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:${primaryColor};padding:24px 36px;border-top:5px solid ${accentColor};">
    <p style="margin:0;font-weight:900;font-size:20px;letter-spacing:3px;
      text-transform:uppercase;color:#ffffff;">WERKRUF</p>
  </td></tr>

  <tr><td style="background:#ffffff;padding:36px 36px 28px;">
    <p style="margin:0 0 16px;font-size:14px;color:${accentColor};
      font-weight:700;letter-spacing:2px;text-transform:uppercase;">
      ${greeting}
    </p>
    <h1 style="margin:0 0 20px;font-size:24px;font-weight:900;
      text-transform:uppercase;color:${primaryColor};line-height:1.2;">
      ${headline}
    </h1>
    <div style="font-size:15px;color:#5A6A7A;line-height:1.7;">
      ${body}
    </div>
    ${cta}
    ${footerNote ? `<p style="font-size:12px;color:#A0ADB8;margin-top:20px;">${footerNote}</p>` : ''}
  </td></tr>

  <tr><td style="background:${primaryColor};padding:20px 36px;border-top:3px solid ${accentColor};">
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:rgba(255,255,255,0.6);">
      ${signature}
    </p>
    <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);">
      <a href="https://werkruf.com/datenschutz" style="color:rgba(255,255,255,0.3);">Datenschutz</a> ·
      <a href="https://werkruf.com/impressum" style="color:rgba(255,255,255,0.3);">Impressum</a> ·
      <a href="mailto:${senderEmail}" style="color:rgba(255,255,255,0.3);">${senderEmail}</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

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
    case 'trialing':           return 'trial';
    case 'past_due':           return 'pro';      // Zugang halten, Mahnung laeuft
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired': return 'free';
    case 'incomplete':
    case 'paused':             return 'free';
    default:                   return 'free';
  }
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
      console.log(`[stripe-webhook] Event ${event.id} bereits verarbeitet — uebersprungen`);
      return json({ received: true, duplicate: true }, 200);
    }
    // Andere Fehler (z. B. Tabelle fehlt): laut protokollieren, aber
    // weiterverarbeiten. Ein fehlender Idempotenzschutz ist schlechter
    // als gar keine Verarbeitung.
    console.error('[stripe-webhook] stripe_events nicht beschreibbar:', insertError);
  }

  console.log(`[stripe-webhook] Event: ${event.type} (${event.id})`);

  let handlerError: string | null = null;

  try {
    switch (event.type) {

      /* ─────────────────────────────────────────────
         CHECKOUT ABGESCHLOSSEN

         Zustaendig fuer: Willkommensmail, stripe_customer_id.
         NICHT zustaendig fuer: plan, trial_ends_at, subscription_status —
         das gehoert den subscription.*-Events, deren Reihenfolge
         gegenueber diesem Event nicht garantiert ist.
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
          await supabase
            .from('user_profiles')
            .update({ stripe_customer_id: customerId })
            .eq('id', userId);
        }

        console.log(`✓ Checkout abgeschlossen fuer User ${userId}, Plan ${meta.plan_type || '?'}`);

        /* ── Willkommensmail ──
           Mailfehler duerfen den Webhook nicht scheitern lassen —
           sonst wiederholt Stripe und der Kunde bekommt sie mehrfach. */
        try {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('company_name')
            .eq('id', userId)
            .maybeSingle();

          const { data: authUser } = await supabase.auth.admin.getUserById(userId);
          const userEmail   = authUser?.user?.email;
          const companyName = meta.company_name || profile?.company_name || 'dein Betrieb';
          const siteUrl     = Deno.env.get('SITE_URL') || 'https://werkruf.com';

          if (userEmail) {
            const html = buildEmailHtml({
              greeting: 'Willkommen bei WERKRUF',
              headline: 'Dein Zugang ist freigeschaltet.',
              body: `
                <p>Ab jetzt behalten wir das Google-Profil von
                <strong>${companyName}</strong> im Blick.</p>
                <p><strong>Der naechste Schritt:</strong> Verbinde dein
                Google-Unternehmensprofil im Dashboard. Danach siehst du deinen
                Profilwert und die ersten konkreten Empfehlungen.</p>
                <p style="background:#E8F5E9;border-left:3px solid #1E7E34;padding:12px 16px;margin:16px 0;">
                  Veroeffentlicht wird nur, was du freigibst. WERKRUF schlaegt vor —
                  du entscheidest.
                </p>
              `,
              ctaText:    'Google-Profil verbinden',
              ctaUrl:     `${siteUrl}/dashboard`,
              footerNote: 'Fragen? Antworte einfach auf diese Mail.',
            });

            await sendEmail({
              to:      { email: userEmail, name: companyName },
              subject: `Willkommen bei WERKRUF — "${companyName}" ist eingerichtet`,
              html,
            });

            await supabase.from('user_profiles').update({
              last_notification_step: 'checkout_completed',
              last_email_sent_at:     new Date().toISOString(),
            }).eq('id', userId);
          }
        } catch (emailErr) {
          console.error('[stripe-webhook] Mailfehler (nicht kritisch):', emailErr);
        }

        break;
      }

      /* ─────────────────────────────────────────────
         ABO ANGELEGT / GEAENDERT

         Einzige Stelle, die plan und trial_ends_at schreibt.
      ───────────────────────────────────────────── */
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription;
        const meta       = (sub.metadata || {}) as Record<string, string>;
        const customerId = sub.customer as string | null;

        const userId = await resolveUserId(supabase, stripe, meta, customerId);

        if (!userId) {
          handlerError = `${event.type} ohne aufloesbare User-ID (sub ${sub.id}, customer ${customerId})`;
          console.error(`[stripe-webhook] ${handlerError}`);
          break;
        }

        const plan = mapStatusToPlan(sub.status);

        await supabase
          .from('user_profiles')
          .update({
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
          })
          .eq('id', userId);

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

        await supabase
          .from('user_profiles')
          .update({
            plan:                       'free',
            stripe_subscription_status: 'canceled',
            trial_ends_at:              null,
          })
          .eq('id', userId);

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

        await supabase
          .from('user_profiles')
          .update({ stripe_subscription_status: 'past_due' })
          .eq('id', profile.id);

        console.log(`⚠ Zahlung fehlgeschlagen: User ${profile.id}, customer ${customerId}`);

        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
          const userEmail   = authUser?.user?.email;
          const companyName = profile.company_name || 'dein Betrieb';
          const siteUrl     = Deno.env.get('SITE_URL') || 'https://werkruf.com';

          if (userEmail) {
            const html = buildEmailHtml({
              greeting: 'Wichtige Mitteilung',
              headline: 'Zahlung fehlgeschlagen — Aktion noetig.',
              body: `
                <p>Die Abbuchung fuer dein WERKRUF-Abo (<strong>${companyName}</strong>)
                ist fehlgeschlagen.</p>
                <p>Bitte aktualisiere deine Zahlungsmethode, damit dein Zugang
                bestehen bleibt.</p>
                <p style="background:#FDECEA;border-left:3px solid #D93025;padding:12px 16px;margin:16px 0;">
                  Wir versuchen es in den naechsten Tagen erneut.
                  Danach wird der Zugang eingeschraenkt.
                </p>
              `,
              ctaText:    'Zahlungsmethode aktualisieren',
              ctaUrl:     `${siteUrl}/dashboard/einstellungen`,
              footerNote: 'Fragen? Antworte auf diese Mail.',
            });

            await sendEmail({
              to:      { email: userEmail, name: companyName },
              subject: 'Zahlung fehlgeschlagen — bitte Zahlungsmethode aktualisieren',
              html,
            });

            await supabase.from('user_profiles').update({
              last_notification_step: 'payment_failed',
              last_email_sent_at:     new Date().toISOString(),
            }).eq('id', profile.id);
          }
        } catch (emailErr) {
          console.error('[stripe-webhook] Mailfehler (nicht kritisch):', emailErr);
        }

        break;
      }

      default:
        console.log(`[stripe-webhook] Nicht behandelt: ${event.type}`);
    }

    /* ── Verarbeitung protokollieren ── */
    await supabase
      .from('stripe_events')
      .update({
        processed_at:  new Date().toISOString(),
        error_message: handlerError,
      })
      .eq('id', event.id);

    return json({ received: true }, 200);

  } catch (err) {
    const message = (err as Error).message;
    console.error('[stripe-webhook] Handler-Fehler:', err);

    await supabase
      .from('stripe_events')
      .update({ error_message: message })
      .eq('id', event.id);

    // 500 loest einen Stripe-Retry aus. Der Idempotenz-Eintrag bleibt
    // ohne processed_at stehen — sichtbar in ops_stripe_events. Der Retry
    // wird allerdings am Primaerschluessel abgewiesen; bei echten Fehlern
    // also manuell nacharbeiten und die Zeile loeschen.
    return json({ error: message }, 500);
  }
});
