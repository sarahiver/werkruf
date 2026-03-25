/**
 * WERKRUF — Report E-Mail HTML Template
 *
 * Usage:
 *   import { generateReportEmail } from '../templates/reportEmail';
 *   const html = generateReportEmail({ industry, result, email });
 *
 * This can be called from a Supabase Edge Function or directly
 * via Brevo API to send the welcome + report notification email.
 */

export function generateReportEmail({ industry, result, email }) {
  const { brand, colors, pricing } = industry;
  const { name, city, score, rating, reviewCount, unanswered } = result;

  const monthlyLoss  = Math.round((unanswered || 2) * pricing.roi.avgOrderValue * 0.1);
  const scoreLabel   = score >= 70 ? 'GUT' : score >= 45 ? 'AUSBAUFÄHIG' : 'KRITISCH';
  const scoreBgColor = score >= 70 ? '#E8F5E9' : score >= 45 ? '#FFF8E1' : '#FDECEA';
  const scoreColor   = score >= 70 ? '#1E7E34' : score >= 45 ? '#D48A00' : '#D93025';
  const maxRevenue   = pricing.roi.maxMonthlyRevenue.toLocaleString('de-DE');

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${brand.name} — Dein Sichtbarkeits-Report</title>
</head>
<body style="margin:0;padding:0;background:#F2F2F2;font-family:Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${colors.primary};padding:28px 36px 24px;border-top:5px solid ${colors.accent};">
              <p style="margin:0;font-family:Arial,sans-serif;font-weight:900;font-size:22px;
                letter-spacing:2px;text-transform:uppercase;color:#ffffff;">
                ${brand.logo}
              </p>
              <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.5);
                text-transform:uppercase;letter-spacing:1px;">
                ${brand.tagline}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:36px 36px 28px;">

              <p style="margin:0 0 6px;font-size:12px;font-weight:700;
                text-transform:uppercase;letter-spacing:2px;color:${colors.accent};">
                Dein Sichtbarkeits-Report
              </p>

              <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;
                text-transform:uppercase;color:${colors.primary};line-height:1.15;">
                Moin! Dein Report für<br/>${name} ist fertig.
              </h1>

              <p style="margin:0 0 24px;font-size:15px;color:#5A6A7A;line-height:1.65;">
                Wir haben deinen Google-Auftritt analysiert. Hier ist das Wichtigste
                auf einen Blick — der vollständige Report liegt im Anhang.
              </p>

              <!-- Score Box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:${scoreBgColor};border-left:4px solid ${scoreColor};
                  margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:16px;">
                          <p style="margin:0;font-size:36px;font-weight:900;
                            color:${scoreColor};line-height:1;">${score}</p>
                          <p style="margin:2px 0 0;font-size:11px;font-weight:700;
                            text-transform:uppercase;letter-spacing:1px;color:#5A6A7A;">
                            / 100 — ${scoreLabel}
                          </p>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1A1A1A;">
                            Dein Sichtbarkeits-Score
                          </p>
                          <p style="margin:4px 0 0;font-size:13px;color:#5A6A7A;">
                            ${city ? `Standort: ${city}` : 'Google Business Profil analysiert'}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Metrics Row -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td width="33%" style="background:#F2F2F2;padding:14px;text-align:center;
                    border-right:2px solid #ffffff;">
                    <p style="margin:0;font-size:22px;font-weight:900;color:${colors.primary};">
                      ${rating > 0 ? rating.toFixed(1) : '—'}
                    </p>
                    <p style="margin:4px 0 0;font-size:11px;text-transform:uppercase;
                      letter-spacing:1px;color:#5A6A7A;">Ø Bewertung</p>
                  </td>
                  <td width="33%" style="background:#F2F2F2;padding:14px;text-align:center;
                    border-right:2px solid #ffffff;">
                    <p style="margin:0;font-size:22px;font-weight:900;color:${colors.primary};">
                      ${reviewCount}
                    </p>
                    <p style="margin:4px 0 0;font-size:11px;text-transform:uppercase;
                      letter-spacing:1px;color:#5A6A7A;">Rezensionen</p>
                  </td>
                  <td width="33%" style="background:#F2F2F2;padding:14px;text-align:center;">
                    <p style="margin:0;font-size:22px;font-weight:900;color:#D93025;">
                      ${unanswered}
                    </p>
                    <p style="margin:4px 0 0;font-size:11px;text-transform:uppercase;
                      letter-spacing:1px;color:#5A6A7A;">Ohne Antwort</p>
                  </td>
                </tr>
              </table>

              <!-- Urgency block -->
              ${unanswered > 0 ? `
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#FDECEA;border-left:4px solid #D93025;margin-bottom:24px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1A1A1A;">
                      ⚠ ${unanswered} unbeantwortete Bewertungen
                    </p>
                    <p style="margin:0;font-size:13px;color:#5A1A1A;line-height:1.5;">
                      Du verlierst schätzungsweise
                      <strong style="color:#D93025;">~${monthlyLoss.toLocaleString('de-DE')} €/Monat</strong>
                      an Umsatz, weil Kunden dein Profil sehen und zur Konkurrenz wechseln.
                    </p>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- ROI teaser -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:${colors.primary};margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;border-left:4px solid ${colors.accent};">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;
                      text-transform:uppercase;letter-spacing:1px;color:${colors.accent};">
                      Dein Potenzial
                    </p>
                    <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;line-height:1.5;">
                      Sichere dir bis zu
                      <span style="color:${colors.accent};font-size:20px;"> ${maxRevenue} €</span>
                      zusätzlichen Umsatz pro Monat — mit dem richtigen Online-Auftritt.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td align="center">
                    <a href="${process.env.REACT_APP_SITE_URL || 'https://werkruf.de'}/signup"
                      style="display:inline-block;padding:16px 36px;
                        background:${colors.accent};color:#ffffff;
                        font-size:15px;font-weight:700;text-transform:uppercase;
                        letter-spacing:1.5px;text-decoration:none;
                        border-radius:2px;">
                      ${pricing.trialDays} Tage kostenlos testen →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;color:#A0ADB8;text-align:center;line-height:1.6;">
                Danach ${pricing.monthlyPrice} ${pricing.currency} / Monat · Monatlich kündbar ·
                Keine Einrichtungsgebühr
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${colors.bgDark};padding:20px 36px;
              border-top:3px solid ${colors.accent};">
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">
                Diese E-Mail wurde an <strong style="color:rgba(255,255,255,0.6);">${email}</strong>
                gesendet, weil du einen Sichtbarkeits-Check auf ${brand.name.toLowerCase()}.de
                durchgeführt hast.<br/>
                <a href="#" style="color:rgba(255,255,255,0.3);">Abmelden</a> ·
                <a href="/datenschutz" style="color:rgba(255,255,255,0.3);">Datenschutz</a> ·
                <a href="/impressum" style="color:rgba(255,255,255,0.3);">Impressum</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
