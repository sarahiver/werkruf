// supabase/functions/send-welcome-email/index.ts
//
// Triggered by: Supabase Database Webhook on auth.users INSERT
// Setup: Supabase → Database → Webhooks → New Webhook
//   Table: users (schema: auth)
//   Event: INSERT
//   URL: https://[project].supabase.co/functions/v1/send-welcome-email
//
// Required Secrets:
//   BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, SITE_URL

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface EmailPayload {
  to:      { email: string; name?: string };
  subject: string;
  html:    string;
  from?:   { email: string; name: string };
  replyTo?: string;
}

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  if (!apiKey) {
    console.error('[sendEmail] BREVO_API_KEY not set');
    return false;
  }

  const from = payload.from || {
    email: Deno.env.get('BREVO_SENDER_EMAIL') || 'hallo@werkruf.com',
    name:  Deno.env.get('BREVO_SENDER_NAME')  || 'WERKRUF',
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key':      apiKey,
      },
      body: JSON.stringify({
        sender:      from,
        to:          [{ email: payload.to.email, name: payload.to.name || payload.to.email }],
        subject:     payload.subject,
        htmlContent: payload.html,
        replyTo:     payload.replyTo ? { email: payload.replyTo } : undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[sendEmail] Brevo error:', res.status, err);
      return false;
    }

    console.log('[sendEmail] Sent to:', payload.to.email, '|', payload.subject);
    return true;

  } catch (err) {
    console.error('[sendEmail] Fetch error:', err);
    return false;
  }
}

// ─────────────────────────────────────────────
// HTML EMAIL BUILDER
// ─────────────────────────────────────────────
function buildEmailHtml({
  greeting,
  headline,
  body,
  ctaText,
  ctaUrl,
  footerNote,
  primaryColor  = '#002C51',
  accentColor   = '#FF8C00',
  signature     = 'Dein WERKRUF-Team',
  senderEmail   = 'hallo@werkruf.com',
}: {
  greeting:     string;
  headline:     string;
  body:         string;
  ctaText?:     string;
  ctaUrl?:      string;
  footerNote?:  string;
  primaryColor?: string;
  accentColor?:  string;
  signature?:   string;
  senderEmail?: string;
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

  <!-- HEADER -->
  <tr><td style="background:${primaryColor};padding:24px 36px;border-top:5px solid ${accentColor};">
    <p style="margin:0;font-weight:900;font-size:20px;letter-spacing:3px;
      text-transform:uppercase;color:#ffffff;">WERKRUF</p>
  </td></tr>

  <!-- BODY -->
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

  <!-- FOOTER -->
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


const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = await req.json();
    const user    = payload.record; // auth.users record

    if (!user?.email) {
      return new Response('No email', { status: 200 });
    }

    const siteUrl    = Deno.env.get('SITE_URL') || 'https://werkruf.com';
    const firstName  = user.raw_user_meta_data?.full_name?.split(' ')[0] || 'du';

    const html = buildEmailHtml({
      greeting:  'Moin!',
      headline:  `Willkommen bei WERKRUF,\n${firstName}`,
      body: `
        <p>Dein Zugang ist bereit. Ab jetzt kannst du deinen Google Business Score prüfen,
        dein Profil verknüpfen und siehst sofort, was dich Kunden kostet.</p>
        <p><strong>Was als nächstes passiert:</strong></p>
        <ol style="padding-left:20px;color:#5A6A7A;">
          <li style="margin-bottom:8px;">Verknüpfe deinen Google Business Eintrag im Dashboard</li>
          <li style="margin-bottom:8px;">Wir analysieren deinen Sichtbarkeits-Score</li>
          <li style="margin-bottom:8px;">Du siehst genau, was wir verbessern können</li>
        </ol>
      `,
      ctaText:    'Jetzt Dashboard öffnen',
      ctaUrl:     `${siteUrl}/dashboard`,
      footerNote: '30 Tage kostenlos testen — kein Risiko, jederzeit kündbar.',
      signature:  'Dein WERKRUF-Team',
      senderEmail:'hallo@werkruf.com',
    });

    await sendEmail({
      to:      { email: user.email, name: firstName },
      subject: 'Willkommen bei WERKRUF – Dein Zugang ist bereit 🚀',
      html,
    });

    // Mark welcome email as sent in user_profiles
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    await supabase.from('user_profiles').update({
      last_notification_step: 'welcome',
      last_email_sent_at:     new Date().toISOString(),
    }).eq('id', user.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[send-welcome-email] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
