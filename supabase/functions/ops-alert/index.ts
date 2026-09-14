/* ═══════════════════════════════════════════════════════════════════════════
   BETRIEBSALARM

   Fragt public.ops_alerts_pending() ab und schickt eine Mail an den
   Betreiber, wenn etwas ansteht.

   ⚠️  BEWUSST EIGENSTAENDIG, NICHT ALS ROUTE IN send-email.

   Ein Alarm, der dieselbe Maschinerie nutzt, die er ueberwacht, kann
   deren Ausfall nicht melden. send-email haengt an email_queue, am
   mail-worker-Cronjob und an claim_emails — genau die Dinge, die
   kaputtgehen koennen. Deshalb hier: direkter Brevo-Aufruf, keine
   Warteschlange, kein gemeinsamer Code.

   Aus demselben Grund taucht diese Mail NICHT in ops_email_queue auf.
   Das ist kein Versehen, sondern die Bedingung dafuer, dass sie auch
   dann rausgeht, wenn die Warteschlange steht.

   ⚠️  "Verify JWT" muss AUS sein — der Aufruf kommt von pg_cron ohne
       Session. Geschuetzt ueber X-Worker-Secret, wie die Sync-Routen.

   Routen:
     POST /ops-alert           Pruefen und ggf. melden
     POST /ops-alert  {"dryRun": true}   Nur anzeigen, nichts senden
     POST /ops-alert  {"force": true}    Entprellung uebergehen

   Benoetigte Secrets:
     GBP_WORKER_SECRET
     BREVO_API_KEY
     ADMIN_EMAIL          Empfaenger, Standard hallo@werkruf.com
     SITE_URL             fuer Links in der Mail

   VORAUSSETZUNG: Migration 020_ops_alerts.sql ist eingespielt.
═══════════════════════════════════════════════════════════════════════════ */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

/* ─────────────────────────────────────────────
   TYPEN
───────────────────────────────────────────── */

type Severity = 'critical' | 'warning';

interface Alert {
  key: string;
  severity: Severity;
  title: string;
  detail: unknown;
}

/* ─────────────────────────────────────────────
   KONFIGURATION
───────────────────────────────────────────── */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  return value;
}

let cachedAdmin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedAdmin;
}

function log(level: 'debug' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    scope: 'ops-alert', level, event, ts: new Date().toISOString(), ...data,
  });
  if (level === 'debug') console.log(line); else console[level](line);
}

/* ─────────────────────────────────────────────
   ZUGRIFFSSCHUTZ
───────────────────────────────────────────── */

/** Konstante Laufzeit — ein frueh abbrechender Vergleich verraet ueber die Dauer, wie viel stimmt. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a), right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function requireWorkerSecret(request: Request): void {
  const expected = requireEnv('GBP_WORKER_SECRET');
  if (!timingSafeEqual(request.headers.get('X-Worker-Secret') ?? '', expected)) {
    throw Object.assign(new Error('Ungueltiges Worker-Secret'), { status: 401 });
  }
}

/* ─────────────────────────────────────────────
   MAIL

   Absichtlich schlicht. Das hier liest ein Betreiber um 7 Uhr auf dem
   Handy — es soll in drei Sekunden klar sein, was los ist. Keine
   Markenfarben, kein Bildaufbau, keine Fussleiste.
───────────────────────────────────────────── */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function buildAlertHtml(alerts: Alert[], siteUrl: string): string {
  const bloecke = alerts.map((a) => {
    const farbe = a.severity === 'critical' ? '#B3261E' : '#A66A00';
    const marke = a.severity === 'critical' ? 'KRITISCH' : 'HINWEIS';
    const detail = JSON.stringify(a.detail, null, 2) ?? '';

    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
<tr><td style="border-left:4px solid ${farbe};padding:12px 16px;background:#F6F7F9;">
  <div style="font-size:10px;font-weight:bold;letter-spacing:1px;color:${farbe};margin-bottom:4px;">
    ${marke} &middot; ${escapeHtml(a.key)}
  </div>
  <div style="font-size:15px;font-weight:bold;color:#1A1D21;line-height:1.4;">
    ${escapeHtml(a.title)}
  </div>
  <pre style="font-family:Menlo,Consolas,monospace;font-size:11px;color:#5F6875;
    background:#FFFFFF;border:1px solid #E8E9EC;padding:10px;margin:10px 0 0;
    white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;">${escapeHtml(detail)}</pre>
</td></tr></table>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#F4F5F7;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;padding:22px;">

  <tr><td>
    <div style="font-size:11px;letter-spacing:2px;color:#7A8290;margin-bottom:4px;">
      WERKRUF BETRIEB
    </div>
    <h1 style="margin:0 0 18px;font-size:18px;color:#0B2545;">
      ${alerts.length === 1 ? 'Ein Problem erkannt' : `${alerts.length} Probleme erkannt`}
    </h1>
    ${bloecke}
    <p style="font-size:12px;color:#7A8290;line-height:1.6;margin:18px 0 0;">
      Jede Alarmart meldet sich hoechstens einmal pro Stunde.<br>
      Zustand: <code>select * from public.ops_alert_status;</code><br>
      Stummschalten: <code>insert into public.ops_alert_mutes (alert_key, reason, muted_until) values (…);</code><br>
      <a href="${escapeHtml(siteUrl)}/dashboard" style="color:#7A8290;">Dashboard</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildAlertText(alerts: Alert[]): string {
  return alerts.map((a) =>
    `[${a.severity === 'critical' ? 'KRITISCH' : 'HINWEIS'}] ${a.key}\n` +
    `${a.title}\n\n${JSON.stringify(a.detail, null, 2)}\n`
  ).join('\n---\n\n');
}

async function sendAlertMail(alerts: Alert[]): Promise<boolean> {
  const apiKey    = requireEnv('BREVO_API_KEY');
  const empfaenger = Deno.env.get('ADMIN_EMAIL') || 'hallo@werkruf.com';
  const absender   = Deno.env.get('BREVO_SENDER_EMAIL') || 'hallo@werkruf.com';
  const siteUrl    = Deno.env.get('SITE_URL') || 'https://werkruf.com';

  const kritisch = alerts.filter((a) => a.severity === 'critical').length;
  const betreff  = kritisch > 0
    ? `[WERKRUF] ${kritisch} kritische${kritisch === 1 ? 's' : ''} Problem${kritisch === 1 ? '' : 'e'}`
    : `[WERKRUF] ${alerts.length} Hinweis${alerts.length === 1 ? '' : 'e'} aus dem Betrieb`;

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender:      { name: 'WERKRUF Betrieb', email: absender },
        to:          [{ email: empfaenger }],
        subject:     betreff,
        htmlContent: buildAlertHtml(alerts, siteUrl),
        textContent: buildAlertText(alerts),
        tags:        ['ops_alert'],
      }),
    });

    if (!res.ok) {
      log('error', 'brevo_failed', { status: res.status, body: (await res.text()).slice(0, 300) });
      return false;
    }
    return true;

  } catch (err) {
    log('error', 'brevo_error', { message: String(err) });
    return false;
  }
}

/* ─────────────────────────────────────────────
   HTTP
───────────────────────────────────────────── */

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/* ─────────────────────────────────────────────
   EINSTIEG
───────────────────────────────────────────── */

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: { code: 'bad_request', message: 'Nur POST.' } }, 405);
  }

  try {
    requireWorkerSecret(request);

    let body: Record<string, unknown> = {};
    try {
      const raw = await request.text();
      if (raw) body = JSON.parse(raw);
    } catch { /* Standardwerte */ }

    const dryRun = body.dryRun === true;
    const force  = body.force === true;

    const db = adminClient();

    /* force uebergeht die Entprellung: ops_alerts() statt
       ops_alerts_pending(). Fuer den Test nach dem Einrichten. */
    const { data, error } = force
      ? await db.rpc('ops_alerts')
      : await db.rpc('ops_alerts_pending', { p_cooldown: '1 hour' });

    if (error) {
      log('error', 'rpc_failed', { message: error.message });
      return json({ error: { code: 'internal_error', message: error.message } }, 500);
    }

    const alerts = (data ?? []) as Alert[];

    if (alerts.length === 0) {
      log('debug', 'nichts_zu_melden');
      return json({ ok: true, alerts: 0, sent: false });
    }

    if (dryRun) {
      log('debug', 'dry_run', { anzahl: alerts.length });
      return json({ ok: true, alerts: alerts.length, sent: false, dryRun: true, details: alerts });
    }

    const versandt = await sendAlertMail(alerts);

    /* Nur bei Erfolg markieren. Scheitert der Versand, bleibt der Alarm
       offen und wird beim naechsten Lauf erneut versucht — sonst waere
       genau die Meldung verloren, auf die es ankam. */
    if (versandt) {
      const keys = alerts.map((a) => a.key);
      const { error: markError } = await db.rpc('ops_alert_mark_sent', { p_keys: keys });
      if (markError) {
        log('warn', 'mark_failed', { message: markError.message, keys });
      }
    }

    log(versandt ? 'debug' : 'error', versandt ? 'gemeldet' : 'versand_gescheitert', {
      anzahl: alerts.length,
      keys:   alerts.map((a) => a.key),
    });

    return json({ ok: versandt, alerts: alerts.length, sent: versandt });

  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    log('error', 'request_failed', { status, message: String(err) });
    return json({
      error: {
        code:    status === 401 ? 'unauthenticated' : 'internal_error',
        message: status === 401 ? 'Nicht berechtigt.' : 'Es ist ein Fehler aufgetreten.',
      },
    }, status);
  }
});
