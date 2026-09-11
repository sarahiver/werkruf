// supabase/functions/check-trial-emails/index.ts
//
// Called by: pg_cron daily at 08:00 UTC
// Also callable manually for testing
//
// Required Secrets:
//   BREVO_API_KEY, BREVO_SENDER_EMAIL, SITE_URL, ADMIN_EMAIL

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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const siteUrl   = Deno.env.get('SITE_URL') || 'https://werkruf.com';
  const now       = new Date();
  const results   = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Fetch all users with active trials
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, trial_ends_at, last_notification_step, last_email_sent_at, company_name, path_type, email_opt_out')
      .in('plan', ['trial', 'free'])
      .not('trial_ends_at', 'is', null)
      .eq('email_opt_out', false);

    if (error) throw error;
    if (!profiles?.length) {
      console.log('[check-trial-emails] No profiles to process');
      return new Response(JSON.stringify({ ok: true, ...results }), { status: 200 });
    }

    for (const profile of profiles) {
      try {
        const trialEnd  = new Date(profile.trial_ends_at);
        const daysLeft  = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const isSetup   = profile.path_type === 'setup';
        const lastStep  = profile.last_notification_step;

        // Determine which email to send
        let emailStep: string | null = null;

        if (daysLeft === 7 && isSetup && lastStep !== 'path_b_day7') {
          emailStep = 'path_b_day7';
        } else if (daysLeft === 5 && lastStep !== 'trial_day25' && lastStep !== 'trial_day28' && lastStep !== 'trial_day30') {
          emailStep = 'trial_day25';
        } else if (daysLeft === 2 && lastStep !== 'trial_day28' && lastStep !== 'trial_day30') {
          emailStep = 'trial_day28';
        } else if (daysLeft <= 0 && lastStep !== 'trial_day30') {
          emailStep = 'trial_day30';
        }

        if (!emailStep) { results.skipped++; continue; }

        // Get user email from auth
        const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
        const userEmail  = authUser?.user?.email;
        const companyName = profile.company_name || 'dein Betrieb';

        if (!userEmail) { results.skipped++; continue; }

        // Build and send email
        const emailContent = getEmailContent(emailStep, { companyName, daysLeft, siteUrl, isSetup });
        if (!emailContent) { results.skipped++; continue; }

        const sent = await sendEmail({
          to:      { email: userEmail, name: companyName },
          subject: emailContent.subject,
          html:    buildEmailHtml(emailContent.template),
        });

        if (sent) {
          // Update notification step
          await supabase.from('user_profiles').update({
            last_notification_step: emailStep,
            last_email_sent_at:     new Date().toISOString(),
          }).eq('id', profile.id);

          console.log(`[check-trial-emails] Sent ${emailStep} to ${userEmail}`);
          results.sent++;
        } else {
          results.errors++;
        }

      } catch (profileErr) {
        console.error('[check-trial-emails] Profile error:', profile.id, profileErr);
        results.errors++;
      }
    }

    console.log('[check-trial-emails] Done:', results);
    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[check-trial-emails] Fatal error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/* ─────────────────────────────────────────────
   EMAIL CONTENT BUILDER
───────────────────────────────────────────── */
function getEmailContent(step: string, ctx: {
  companyName: string;
  daysLeft:    number;
  siteUrl:     string;
  isSetup:     boolean;
}) {
  const { companyName, daysLeft, siteUrl, isSetup } = ctx;

  switch (step) {

    case 'path_b_day7':
      return {
        subject: `📬 Postkarten-Check: Ist der Brief für ${companyName} da?`,
        template: {
          greeting:  'Kurze Frage',
          headline:  'Ist die Google-Postkarte angekommen?',
          body: `
            <p>Wir haben vor einer Woche dein Google Business Profil für
            <strong>${companyName}</strong> angelegt.</p>
            <p>Google schickt dir in diesen Tagen eine Postkarte mit einem
            Verifizierungs-Code. Sobald du ihn hast, antworte einfach auf
            diese Mail — wir erledigen den Rest.</p>
            <p style="background:#FFF8E1;border-left:3px solid #FF8C00;padding:12px 16px;margin:16px 0;">
              <strong>Noch keine Postkarte?</strong> Das ist normal — manchmal dauert es
              bis zu 14 Tage. Ruf uns an: +49 176 66631237
            </p>
          `,
          ctaText:   'Dashboard öffnen',
          ctaUrl:    `${siteUrl}/dashboard`,
          signature: 'Dein WERKRUF-Team',
        },
      };

    case 'trial_day25':
      return {
        subject: `⏳ Noch 5 Tage – was passiert danach mit ${companyName}?`,
        template: {
          greeting:  'Nur noch 5 Tage!',
          headline:  'Dein Test läuft in 5 Tagen ab.',
          body: `
            <p>Dein kostenloser Test für <strong>${companyName}</strong> endet in
            <strong>5 Tagen</strong>.</p>
            <p><strong>Was passiert danach?</strong></p>
            <ul style="padding-left:20px;color:#5A6A7A;">
              <li style="margin-bottom:8px;">Dein Google Business Profil bleibt natürlich erhalten</li>
              <li style="margin-bottom:8px;">Die automatische Optimierung wird pausiert</li>
              <li style="margin-bottom:8px;">Bewertungs-Monitoring wird deaktiviert</li>
            </ul>
            <p>Um alles zu behalten, sichere jetzt dein Abo für nur <strong>49€/Monat</strong>.</p>
          `,
          ctaText:    'Abo jetzt sichern',
          ctaUrl:     `${siteUrl}/dashboard/einstellungen`,
          footerNote: 'Monatlich kündbar — kein Jahresvertrag.',
          signature:  'Dein WERKRUF-Team',
        },
      };

    case 'trial_day28':
      return {
        subject: `🔔 Letzter Moment – Abo für ${companyName} sichern`,
        template: {
          greeting:  'Nur noch 2 Tage!',
          headline:  'Dein Test endet in 2 Tagen.',
          body: `
            <p>Das war der letzte Moment: In <strong>2 Tagen</strong> endet dein
            kostenloser Test für <strong>${companyName}</strong>.</p>
            <p>Bisher haben wir:</p>
            <ul style="padding-left:20px;color:#5A6A7A;">
              <li style="margin-bottom:8px;">Dein Profil analysiert und optimiert</li>
              <li style="margin-bottom:8px;">Deine Sichtbarkeit überwacht</li>
              <li style="margin-bottom:8px;">Deinen Score berechnet</li>
            </ul>
            <p>All das weiterlaufen lassen — für nur <strong>49€/Monat</strong>.</p>
          `,
          ctaText:    'Jetzt Abo aktivieren',
          ctaUrl:     `${siteUrl}/dashboard/einstellungen`,
          footerNote: 'Fragen? Ruf uns an: +49 176 66631237',
          signature:  'Dein WERKRUF-Team',
        },
      };

    case 'trial_day30':
      return {
        subject: `Dein WERKRUF-Test für ${companyName} ist beendet`,
        template: {
          greeting:  'Dein Test ist abgelaufen.',
          headline:  'Was jetzt?',
          body: `
            <p>Dein kostenloser Test für <strong>${companyName}</strong> ist heute abgelaufen.</p>
            <p>Du kannst jederzeit wieder einsteigen — alles was wir optimiert haben,
            bleibt erhalten. Du startest dort weiter wo du aufgehört hast.</p>
            <p><strong>49€/Monat · monatlich kündbar · sofort aktiv</strong></p>
          `,
          ctaText:    'Jetzt wieder einsteigen',
          ctaUrl:     `${siteUrl}/dashboard/einstellungen`,
          footerNote: 'Dein Google Business Profil gehört dir — das bleibt so.',
          signature:  'Dein WERKRUF-Team',
        },
      };

    default:
      return null;
  }
}
