/**
 * WERKRUF — Post-Payment Welcome Email
 *
 * Usage (Supabase Edge Function / Brevo / Resend):
 *   import { generateWelcomeEmail } from '../templates/welcomeEmail';
 *   const { subject, html } = generateWelcomeEmail({ industry, user, checkout });
 *
 * industry  = full industryConfig object for the user's industry
 * user      = { email, name }
 * checkout  = { companyName, plan, setupFee, totalFirst, path }
 */

export function generateWelcomeEmail({ industry, user, checkout }) {
  const { brand, colors, pricing, comms } = industry;
  const { companyName, plan, setupFee, path } = checkout;
  const isSetup   = path === 'setup';
  const greeting  = comms.greeting;
  const expert    = comms.expertTitle;
  const firstName = user.name?.split(' ')[0] || 'du';
  const dashboardUrl = `${process.env.REACT_APP_SITE_URL || 'https://werkruf.de'}/dashboard`;

  const subject = `Willkommen bei ${brand.name} – Dein Fahrplan zur Sichtbarkeit 🚀`;

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F2F2F2;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr>
    <td style="background:${colors.primary};padding:28px 36px 22px;border-top:5px solid ${colors.accent};">
      <p style="margin:0;font-family:Arial,sans-serif;font-weight:900;font-size:22px;
        letter-spacing:3px;text-transform:uppercase;color:#ffffff;">
        ${brand.logo}
      </p>
      <p style="margin:5px 0 0;font-size:11px;color:rgba(255,255,255,0.45);
        letter-spacing:1px;text-transform:uppercase;">
        ${brand.tagline}
      </p>
    </td>
  </tr>

  <!-- HERO -->
  <tr>
    <td style="background:#ffffff;padding:36px 36px 0;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;
        letter-spacing:2px;text-transform:uppercase;color:${colors.accent};">
        ${isSetup ? 'Setup bestätigt' : 'Abo aktiviert'}
      </p>
      <h1 style="margin:0 0 16px;font-size:26px;font-weight:900;
        text-transform:uppercase;color:${colors.primary};line-height:1.15;">
        ${greeting}! Die Zahlung für<br/>${companyName} ist eingegangen.
      </h1>
      <p style="margin:0 0 24px;font-size:15px;color:#5A6A7A;line-height:1.7;">
        Wir legen jetzt los, ${firstName}. Dein ${isSetup ? 'Google Business Profil' : 'Optimierungs-Plan'} 
        wird von unserem ${expert}-Team betreut.
      </p>
    </td>
  </tr>

  <!-- VALUE CHECK -->
  <tr>
    <td style="background:#ffffff;padding:0 36px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="background:${colors.primary};border-left:4px solid ${colors.accent};">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;
              letter-spacing:1.5px;text-transform:uppercase;color:${colors.accent};">
              Dein bleibender Wert
            </p>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.85);line-height:1.65;">
              Wir bauen dein digitales Fundament.
              <strong style="color:#ffffff;">
                Dein Google-Profil gehört dir dauerhaft
              </strong>
               — auch wenn du das Abo kündigst.
              Wir sorgen dafür, dass es glänzt.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- 3 PHASES -->
  <tr>
    <td style="background:#ffffff;padding:0 36px 28px;">
      <p style="margin:0 0 18px;font-size:13px;font-weight:700;
        text-transform:uppercase;letter-spacing:1px;color:${colors.primary};">
        Dein Fahrplan — 3 Phasen
      </p>
      ${comms.phases.map(phase => `
      <table width="100%" cellpadding="0" cellspacing="0"
        style="margin-bottom:10px;background:#F8F9FA;border-radius:0;">
        <tr>
          <td style="padding:14px 16px;border-left:3px solid ${colors.accent};">
            <p style="margin:0 0 3px;font-size:12px;font-weight:700;
              color:${colors.accent};text-transform:uppercase;letter-spacing:1px;">
              Phase ${phase.num} — ${phase.title}
            </p>
            <p style="margin:0;font-size:13px;color:#5A6A7A;line-height:1.6;">
              ${phase.text}
            </p>
          </td>
        </tr>
      </table>`).join('')}
    </td>
  </tr>

  <!-- CHECKLIST -->
  <tr>
    <td style="background:#ffffff;padding:0 36px 28px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;
        text-transform:uppercase;letter-spacing:1px;color:${colors.primary};">
        Was wir von dir brauchen
      </p>
      ${comms.checklist.map(item => `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
        <tr>
          <td width="20" style="color:${colors.accent};font-size:14px;vertical-align:top;padding-top:1px;">✓</td>
          <td style="font-size:13px;color:#1A1A1A;line-height:1.5;">${item}</td>
        </tr>
      </table>`).join('')}
      <p style="margin:12px 0 0;font-size:12px;color:#A0ADB8;line-height:1.5;">
        Du kannst diese Infos direkt in deinem Dashboard hinterlegen.
      </p>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="background:#ffffff;padding:0 36px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${dashboardUrl}"
              style="display:inline-block;padding:16px 40px;
                background:${colors.accent};color:#ffffff;
                font-size:14px;font-weight:700;text-transform:uppercase;
                letter-spacing:2px;text-decoration:none;">
              Jetzt Dashboard öffnen →
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#A0ADB8;text-align:center;line-height:1.6;">
        Deinen persönlichen Sichtbarkeits-Fahrplan findest du auch direkt in deinem Dashboard.
      </p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:${colors.bgDark};padding:22px 36px;border-top:3px solid ${colors.accent};">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;
        letter-spacing:1px;color:rgba(255,255,255,0.6);">
        ${comms.emailSignature}
      </p>
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);line-height:1.6;">
        Diese E-Mail wurde an <strong style="color:rgba(255,255,255,0.5);">${user.email}</strong> gesendet.<br/>
        <a href="/datenschutz" style="color:rgba(255,255,255,0.3);">Datenschutz</a> ·
        <a href="/impressum"   style="color:rgba(255,255,255,0.3);">Impressum</a> ·
        <a href="${dashboardUrl}" style="color:rgba(255,255,255,0.3);">Dashboard</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, from: comms.emailFrom };
}

/*
 * SUPABASE EDGE FUNCTION — send-welcome-email
 * Deploy to: supabase/functions/send-welcome-email/index.ts
 *
 * import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
 * import { generateWelcomeEmail } from '../_shared/welcomeEmail.js'
 *
 * serve(async (req) => {
 *   const { industry, user, checkout } = await req.json()
 *   const { subject, html, from } = generateWelcomeEmail({ industry, user, checkout })
 *
 *   // Send via Brevo
 *   const res = await fetch('https://api.brevo.com/v3/smtp/email', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'api-key': Deno.env.get('BREVO_API_KEY'),
 *     },
 *     body: JSON.stringify({
 *       sender:  { name: 'WERKRUF', email: from },
 *       to:      [{ email: user.email, name: user.name }],
 *       subject,
 *       htmlContent: html,
 *     }),
 *   })
 *   return new Response(JSON.stringify({ ok: res.ok }), { status: 200 })
 * })
 */
