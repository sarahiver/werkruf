/* ═══════════════════════════════════════════════════════════════════════════
   GOOGLE-API-MONITORING

   Prueft taeglich, ob Google an den von WERKRUF verwendeten
   Business-Profile-APIs etwas geaendert hat.

   ZWEI GETRENNTE PRUEFWEGE

     Schema     Discovery-Dokumente aller acht APIs. Verglichen wird die
                Pruefsumme der normalisierten Struktur.

                revision wird mitgespeichert, aber NICHT als alleiniger
                Grund verwendet, den Strukturvergleich zu ueberspringen.
                Google My Business v4 traegt dauerhaft revision "0" —
                wer sich darauf verliesse, wuerde dort nie etwas
                erkennen.

     Change Log Das offizielle Change Log als eigenstaendige Quelle mit
                eigenem Alarmschluessel. Notwendig, weil fuer v4 nur
                eine statische Discovery-Datei existiert, deren
                Pruefsumme Aenderungen an der DATEI erkennt, nicht an
                der API.

   ⚠️  EINGESCHRAENKTE UEBERWACHUNG BEI v4
   Statische Datei plus Change Log ergaenzen einander, garantieren aber
   KEINE vollstaendige Erkennung. Siehe docs/GBP-API-MONITOR.md.

   ⚠️  "Verify JWT" muss AUS sein — der Aufruf kommt von pg_cron ohne
       Session. Geschuetzt ueber X-Worker-Secret.

   Diese Function veraendert keine Kundendaten und ruft keine
   Google-API im Namen des Projekts auf. Sie liest ausschliesslich
   oeffentliche, unauthentifizierte Dokumente.

   Routen:
     POST /gbp-api-monitor                   Pruefen und ggf. melden
     POST /gbp-api-monitor {"dryRun": true}  Nur anzeigen, nichts speichern
     POST /gbp-api-monitor {"quelle": "..."} Nur eine Quelle

   Secrets:
     GBP_WORKER_SECRET, BREVO_API_KEY, ADMIN_EMAIL,
     EMAIL_DELIVERY_MODE, EMAIL_TEST_RECIPIENT

   VORAUSSETZUNG: 20260929160000_gbp_api_monitor.sql ist eingespielt.
═══════════════════════════════════════════════════════════════════════════ */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { QUELLEN, normalisiere, pruefsumme } from '../../../scripts/gbp-api-schema.mjs';
import {
  STUFEN, WERKRUF_HOSTS, vergleicheSchema, stufeEin, hoechsteStufe,
  zerlegeChangeLog, vergleicheChangeLog, stufeChangeLogEin, signatur,
} from '../../../scripts/gbp-api-diff.mjs';
import { pruefeWorkerSecret } from '../../../scripts/gbp-worker-auth.mjs';

/* ─────────────────────────────────────────────
   KONFIGURATION
───────────────────────────────────────────── */

const CHANGELOG_QUELLE = {
  id:    'changelog',
  titel: 'Google Business Profile Change Log',
  url:   'https://developers.google.com/my-business/content/change-log',
  doku:  'https://developers.google.com/my-business/content/change-log',
};

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
  const line = JSON.stringify({ scope: 'gbp-api-monitor', level, event, ts: new Date().toISOString(), ...data });
  if (level === 'debug') console.log(line); else console[level](line);
}

/* ─────────────────────────────────────────────
   ZUGRIFFSSCHUTZ
───────────────────────────────────────────── */

/*
 * Die Pruefung liegt in scripts/gbp-worker-auth.mjs — dort ist sie
 * testbar. Eine Edge Function ruft Deno.serve beim Laden auf und
 * laesst sich nicht importieren, ohne einen Server zu starten.
 *
 * Deno.env.get statt requireEnv: requireEnv wuerde bei fehlendem
 * Secret einen 500 mit dem VARIABLENNAMEN werfen. pruefeWorkerSecret
 * wirft stattdessen "Zugriffsschutz nicht konfiguriert" — ohne
 * Konfigurationsdetails nach aussen zu geben.
 */
function requireWorkerSecret(request: Request): void {
  pruefeWorkerSecret(request, Deno.env.get('GBP_WORKER_SECRET'));
}

/* ─────────────────────────────────────────────
   ABRUF
───────────────────────────────────────────── */

async function hole(url: string, alsText = false): Promise<
  { ok: true; inhalt: unknown } | { ok: false; fehler: string }
> {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), 25000);
  try {
    const antwort = await fetch(url, {
      signal: abbruch.signal,
      headers: {
        Accept: alsText ? 'text/html,application/xhtml+xml' : 'application/json',
        /* Ohne erkennbaren Absender liefert developers.google.com
           gelegentlich eine andere Fassung der Seite aus — beim ersten
           Abnahmelauf fand die Auswertung deshalb einmal 20 Eintraege
           und Sekunden spaeter keinen einzigen. */
        'User-Agent': 'WERKRUF-API-Monitor/1.0 (+https://werkruf.com; Betriebsueberwachung)',
        'Accept-Language': 'en',
      },
    });
    if (!antwort.ok) return { ok: false, fehler: `HTTP ${antwort.status}` };
    return { ok: true, inhalt: alsText ? await antwort.text() : await antwort.json() };
  } catch (err) {
    return { ok: false, fehler: String((err as Error)?.message ?? err) };
  } finally {
    clearTimeout(wecker);
  }
}

/* ─────────────────────────────────────────────
   PRUEFWEG 1 — SCHEMA
───────────────────────────────────────────── */

interface Befund {
  quelle: string;
  art: 'schema' | 'changelog';
  ergebnis: string;
  stufe?: string;
  anzahl?: number;
  fehler?: string;
  fehlversuche?: number;
}

async function pruefeSchema(db: SupabaseClient, quelle: typeof QUELLEN[number], dryRun: boolean): Promise<Befund> {
  const antwort = await hole(quelle.url);

  /* Ein Ausfall ist keine API-Aenderung. Der Snapshot bleibt
     unangetastet; nur der Fehlerzaehler steigt. */
  if (!antwort.ok) {
    let zaehler = 0;
    if (!dryRun) {
      const { data } = await db.rpc('gbp_monitor_record_failure', {
        p_quelle: quelle.id, p_art: 'schema',
        p_quell_url: quelle.url, p_fehler: antwort.fehler,
      });
      zaehler = (data as number) ?? 0;
    }
    log('warn', 'quelle_nicht_erreichbar', { quelle: quelle.id, fehler: antwort.fehler, fehlversuche: zaehler });
    return { quelle: quelle.id, art: 'schema', ergebnis: 'ausfall', fehler: antwort.fehler, fehlversuche: zaehler };
  }

  const norm = normalisiere(antwort.inhalt);
  const summe = await pruefsumme(norm);

  const { data: vorher } = await db
    .from('gbp_api_snapshots')
    .select('pruefsumme, inhalt, revision')
    .eq('quelle', quelle.id)
    .maybeSingle();

  /* Der Strukturvergleich laeuft IMMER, wenn ein Vorstand existiert —
     unabhaengig davon, ob sich revision geaendert hat. */
  const unterschiede = vorher?.inhalt
    ? vergleicheSchema(vorher.inhalt, norm)
    : [];

  const host = (() => {
    try { return new URL((antwort.inhalt as Record<string, string>).rootUrl ?? '').host; }
    catch { return null; }
  })();
  const apiGenutzt = host ? WERKRUF_HOSTS.includes(host) : false;

  const eingestuft = unterschiede.map((u) => ({ ...u, ...stufeEin(u, { apiGenutzt }) }));
  const stufe = eingestuft.length > 0 ? hoechsteStufe(eingestuft) : STUFEN.INFORMATION;
  const sig = await signatur(quelle.id, unterschiede);

  if (dryRun) {
    return {
      quelle: quelle.id, art: 'schema',
      ergebnis: vorher ? (unterschiede.length ? 'geaendert' : 'unveraendert') : 'basis',
      stufe, anzahl: unterschiede.length,
    };
  }

  const { data, error } = await db.rpc('gbp_monitor_record_success', {
    p_quelle: quelle.id, p_art: 'schema', p_quell_url: quelle.url,
    p_revision: norm.revision, p_pruefsumme: summe, p_inhalt: norm,
    p_signatur: sig, p_stufe: stufe, p_unterschiede: eingestuft,
  });

  if (error) {
    log('error', 'speichern_gescheitert', { quelle: quelle.id, code: error.code });
    return { quelle: quelle.id, art: 'schema', ergebnis: 'fehler', fehler: error.message };
  }

  const ergebnis = (data as Record<string, unknown>)?.ergebnis as string;
  log('debug', 'schema_geprueft', { quelle: quelle.id, ergebnis, anzahl: unterschiede.length });
  return { quelle: quelle.id, art: 'schema', ergebnis, stufe, anzahl: unterschiede.length };
}

/* ─────────────────────────────────────────────
   PRUEFWEG 2 — CHANGE LOG
───────────────────────────────────────────── */

async function pruefeChangeLog(db: SupabaseClient, dryRun: boolean): Promise<Befund> {
  const antwort = await hole(CHANGELOG_QUELLE.url, true);

  if (!antwort.ok) {
    let zaehler = 0;
    if (!dryRun) {
      const { data } = await db.rpc('gbp_monitor_record_failure', {
        p_quelle: CHANGELOG_QUELLE.id, p_art: 'changelog',
        p_quell_url: CHANGELOG_QUELLE.url, p_fehler: antwort.fehler,
      });
      zaehler = (data as number) ?? 0;
    }
    return { quelle: CHANGELOG_QUELLE.id, art: 'changelog', ergebnis: 'ausfall', fehler: antwort.fehler, fehlversuche: zaehler };
  }

  /* HTML zu Text — die Auswertung arbeitet bewusst auf dem Textinhalt,
     nicht auf dem HTML-Baum. Klassennamen und Layout aendert Google
     regelmaessig; jede solche Aenderung waere sonst ein Fehlalarm. */
  const text = String(antwort.inhalt)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(h[1-6]|p|li|tr|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  const eintraege = zerlegeChangeLog(text);

  const { data: bisher } = await db
    .from('gbp_api_snapshots')
    .select('inhalt')
    .eq('quelle', CHANGELOG_QUELLE.id)
    .maybeSingle();

  const bisherigeAnzahl = Array.isArray(bisher?.inhalt) ? bisher.inhalt.length : 0;

  /*
   * Zwei Faelle gelten als AUSFALL, nicht als Aenderung:
   *
   *   1. Gar keine Eintraege — die Auswertung greift nicht mehr.
   *   2. Ein Einbruch auf weniger als die Haelfte des bekannten
   *      Umfangs. Google entfernt keine halbe Historie; das ist immer
   *      ein Auswertungs- oder Auslieferungsproblem.
   *
   * Ohne (2) haette ein einzelner missglueckter Abruf gemeldet, dass
   * zehn Change-Log-Abschnitte verschwunden sind — und der Schnappschuss
   * waere mit dem Bruchstueck ueberschrieben worden.
   */
  const einbruch = bisherigeAnzahl >= 4 && eintraege.length < bisherigeAnzahl / 2;

  if (eintraege.length === 0 || einbruch) {
    let zaehler = 0;
    if (!dryRun) {
      const { data } = await db.rpc('gbp_monitor_record_failure', {
        p_quelle: CHANGELOG_QUELLE.id, p_art: 'changelog',
        p_quell_url: CHANGELOG_QUELLE.url,
        p_fehler: eintraege.length === 0
          ? `Keine Eintraege gefunden (${text.length} Zeichen geladen) — Seitenaufbau vermutlich geaendert`
          : `Nur ${eintraege.length} statt bisher ${bisherigeAnzahl} Eintraege (${text.length} Zeichen) — unvollstaendige Auslieferung`,
      });
      zaehler = (data as number) ?? 0;
    }
    log('warn', 'changelog_unlesbar', {
      gefunden: eintraege.length, bisher: bisherigeAnzahl,
      zeichen: text.length, fehlversuche: zaehler,
    });
    return { quelle: CHANGELOG_QUELLE.id, art: 'changelog', ergebnis: 'ausfall',
             fehler: `${eintraege.length} statt ${bisherigeAnzahl} Eintraege`,
             fehlversuche: zaehler };
  }

  const summe = await pruefsumme(eintraege);
  const vorher = bisher;   /* oben bereits geladen */

  const unterschiede = vorher?.inhalt
    ? vergleicheChangeLog(vorher.inhalt as { datum: string; inhalt: string }[], eintraege)
    : [];

  const eingestuft = unterschiede.map((u) => ({ ...u, ...stufeChangeLogEin(u) }));
  const stufe = eingestuft.length > 0 ? hoechsteStufe(eingestuft) : STUFEN.INFORMATION;
  const sig = await signatur(CHANGELOG_QUELLE.id, unterschiede);

  if (dryRun) {
    return { quelle: CHANGELOG_QUELLE.id, art: 'changelog',
             ergebnis: vorher ? (unterschiede.length ? 'geaendert' : 'unveraendert') : 'basis',
             stufe, anzahl: unterschiede.length };
  }

  const { data, error } = await db.rpc('gbp_monitor_record_success', {
    p_quelle: CHANGELOG_QUELLE.id, p_art: 'changelog', p_quell_url: CHANGELOG_QUELLE.url,
    p_revision: null, p_pruefsumme: summe, p_inhalt: eintraege,
    p_signatur: sig, p_stufe: stufe, p_unterschiede: eingestuft,
  });

  if (error) {
    return { quelle: CHANGELOG_QUELLE.id, art: 'changelog', ergebnis: 'fehler', fehler: error.message };
  }

  return { quelle: CHANGELOG_QUELLE.id, art: 'changelog',
           ergebnis: (data as Record<string, unknown>)?.ergebnis as string,
           stufe, anzahl: unterschiede.length };
}

/* ─────────────────────────────────────────────
   BETRIEBSALARM

   Direkter Brevo-Aufruf, wie bei ops-alert: Ein Alarm, der die
   Warteschlange nutzt, kann deren Ausfall nicht melden.
───────────────────────────────────────────── */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STUFENFARBE: Record<string, string> = {
  kritisch: '#B3261E', handlungsbedarf: '#A66A00', information: '#5F6875',
};

const STUFENTEXT: Record<string, string> = {
  kritisch: 'KRITISCH', handlungsbedarf: 'HANDLUNGSBEDARF', information: 'INFORMATION',
};

/** Welche WERKRUF-Komponente koennte betroffen sein? */
function betroffeneKomponente(quelle: string): string {
  switch (quelle) {
    case 'businessinformation':
      return 'google-business/index.ts — Standort-Sync, Profil-Editor, sanitizeLocationPatch';
    case 'accountmanagement':
      return 'google-business/index.ts — Kontenabruf beim Erstimport';
    case 'mybusiness-v4':
      return 'google-business/index.ts — Bewertungs-Sync, Antwortveroeffentlichung, Medien';
    case 'changelog':
      return 'Unbestimmt — der Change-Log-Eintrag nennt die betroffene API im Text';
    default:
      return 'Keine — diese API wird von WERKRUF derzeit nicht aufgerufen';
  }
}

function baueMail(meldungen: Record<string, unknown>[]): { betreff: string; html: string; text: string } {
  const kritisch = meldungen.filter((m) => m.stufe === 'kritisch').length;

  const betreff = kritisch > 0
    ? '[WERKRUF BETRIEB] Google Business API geändert – Codeprüfung erforderlich'
    : '[WERKRUF BETRIEB] Google Business API: Änderungen erkannt';

  const bloecke = meldungen.map((m) => {
    const stufe = String(m.stufe);
    const farbe = STUFENFARBE[stufe] ?? '#5F6875';
    const unterschiede = (m.unterschiede as Record<string, unknown>[]) ?? [];

    const zeilen = unterschiede.slice(0, 25).map((u) => `
      <tr>
        <td style="padding:4px 8px;border-top:1px solid #E8E9EC;font-family:Menlo,monospace;font-size:11px;">${escapeHtml(u.art)}</td>
        <td style="padding:4px 8px;border-top:1px solid #E8E9EC;font-family:Menlo,monospace;font-size:11px;">${escapeHtml(u.pfad)}</td>
        <td style="padding:4px 8px;border-top:1px solid #E8E9EC;font-size:11px;color:#5F6875;">${escapeHtml(u.alt ?? '—')} → ${escapeHtml(u.neu ?? '—')}</td>
      </tr>`).join('');

    const weitere = unterschiede.length > 25
      ? `<p style="font-size:11px;color:#7A8290;margin:6px 0 0;">… und ${unterschiede.length - 25} weitere. Vollständig in <code>gbp_api_changes</code>.</p>`
      : '';

    const begruendungen = [...new Set(unterschiede.map((u) => String(u.begruendung ?? '')).filter(Boolean))];

    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
<tr><td style="border-left:4px solid ${farbe};padding:14px 16px;background:#F6F7F9;">
  <div style="font-size:10px;font-weight:bold;letter-spacing:1px;color:${farbe};margin-bottom:6px;">
    ${STUFENTEXT[stufe] ?? stufe} &middot; ${escapeHtml(m.quelle)} &middot; ${escapeHtml(m.art)}
  </div>
  <div style="font-size:15px;font-weight:bold;color:#1A1D21;margin-bottom:8px;">
    ${unterschiede.length} Unterschied(e) erkannt
  </div>
  <p style="font-size:12px;color:#5F6875;margin:0 0 4px;">
    <strong>Revision:</strong> ${escapeHtml(m.alte_revision ?? '—')} → ${escapeHtml(m.neue_revision ?? '—')}<br>
    <strong>Erkannt am:</strong> ${escapeHtml(String(m.erkannt_am ?? '').slice(0, 19).replace('T', ' '))} UTC<br>
    <strong>Möglicherweise betroffen:</strong> ${escapeHtml(betroffeneKomponente(String(m.quelle)))}
  </p>
  ${begruendungen.length ? `<p style="font-size:12px;color:#5F6875;margin:8px 0 0;"><strong>Einstufung:</strong> ${begruendungen.map(escapeHtml).join(' ')}</p>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 0;background:#fff;">
    <tr>
      <th align="left" style="padding:4px 8px;font-size:10px;color:#7A8290;">ART</th>
      <th align="left" style="padding:4px 8px;font-size:10px;color:#7A8290;">PFAD</th>
      <th align="left" style="padding:4px 8px;font-size:10px;color:#7A8290;">ALT → NEU</th>
    </tr>
    ${zeilen}
  </table>
  ${weitere}
</td></tr></table>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#F4F5F7;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#fff;padding:24px;">
<tr><td>
  <div style="font-size:11px;letter-spacing:2px;color:#7A8290;margin-bottom:4px;">WERKRUF BETRIEB</div>
  <h1 style="margin:0 0 18px;font-size:19px;color:#0B2545;">Google Business API — Änderungen erkannt</h1>
  ${bloecke}
  <p style="font-size:12px;color:#7A8290;line-height:1.6;margin:20px 0 0;border-top:1px solid #E8E9EC;padding-top:14px;">
    Offizielle Quellen:<br>
    <a href="https://developers.google.com/my-business/content/change-log" style="color:#7A8290;">Change Log</a> ·
    <a href="https://developers.google.com/my-business/content/sunset-dates" style="color:#7A8290;">Sunset-Termine</a> ·
    <a href="https://developers.google.com/my-business/ref_overview" style="color:#7A8290;">Referenz</a><br><br>
    <strong>Nächste Schritte:</strong> Die vollständigen Unterschiede stehen in
    <code>public.gbp_api_changes</code>. Gegenprüfen mit
    <code>node scripts/google-api-inventory.mjs</code> und
    <code>docs/google-api-inventory.md</code> abgleichen.<br><br>
    Das Monitoring ändert nichts am Code. Ob und wann WERKRUF angepasst wird, entscheidest du.
  </p>
</td></tr></table></td></tr></table></body></html>`;

  const text = meldungen.map((m) => {
    const u = (m.unterschiede as Record<string, unknown>[]) ?? [];
    return `[${STUFENTEXT[String(m.stufe)] ?? m.stufe}] ${m.quelle} (${m.art})\n`
      + `${u.length} Unterschied(e), Revision ${m.alte_revision ?? '—'} → ${m.neue_revision ?? '—'}\n`
      + `Möglicherweise betroffen: ${betroffeneKomponente(String(m.quelle))}\n\n`
      + u.slice(0, 25).map((d) => `  ${d.art}  ${d.pfad}  ${d.alt ?? '—'} → ${d.neu ?? '—'}`).join('\n');
  }).join('\n\n---\n\n');

  return { betreff, html, text };
}

/**
 * Empfaenger.
 *
 * Bei EMAIL_DELIVERY_MODE=test geht die Mail an EMAIL_TEST_RECIPIENT,
 * nicht an die Betriebsadresse — wie bei allen anderen Mailwegen auch.
 */
function empfaenger(): string {
  const modus = (Deno.env.get('EMAIL_DELIVERY_MODE') ?? 'production').toLowerCase();
  if (modus === 'test') return requireEnv('EMAIL_TEST_RECIPIENT');
  if (modus !== 'production') throw new Error('EMAIL_DELIVERY_MODE muss production oder test sein');
  return Deno.env.get('ADMIN_EMAIL') || 'hallo@werkruf.com';
}

async function sendeAlarm(meldungen: Record<string, unknown>[]): Promise<boolean> {
  const { betreff, html, text } = baueMail(meldungen);
  const ziel = empfaenger();

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': requireEnv('BREVO_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'WERKRUF BETRIEB', email: Deno.env.get('BREVO_SENDER_EMAIL') || 'hallo@werkruf.com' },
        to: [{ email: ziel }],
        subject: betreff, htmlContent: html, textContent: text,
        tags: ['gbp_api_monitor'],
      }),
    });
    if (!res.ok) {
      log('error', 'brevo_failed', { status: res.status });
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
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') {
    return json({ error: { code: 'bad_request', message: 'Nur POST.' } }, 405);
  }

  try {
    requireWorkerSecret(request);

    let body: Record<string, unknown> = {};
    try {
      const roh = await request.text();
      if (roh) body = JSON.parse(roh);
    } catch { /* Standardwerte */ }

    const dryRun = body.dryRun === true;
    const nurQuelle = typeof body.quelle === 'string' ? body.quelle : null;
    const db = adminClient();

    const befunde: Befund[] = [];

    /* ── Pruefweg 1: Schema ── */
    for (const quelle of QUELLEN) {
      if (nurQuelle && quelle.id !== nurQuelle) continue;
      befunde.push(await pruefeSchema(db, quelle, dryRun));
    }

    /* ── Pruefweg 2: Change Log ── */
    if (!nurQuelle || nurQuelle === CHANGELOG_QUELLE.id) {
      befunde.push(await pruefeChangeLog(db, dryRun));
    }

    if (dryRun) {
      return json({ ok: true, dryRun: true, befunde });
    }

    /* ── Melden ── */
    const { data: offen, error: offenError } = await db.rpc('gbp_monitor_pending');
    if (offenError) {
      log('error', 'pending_failed', { code: offenError.code });
      return json({ error: { code: 'internal_error', message: offenError.message } }, 500);
    }

    const meldungen = (offen ?? []) as Record<string, unknown>[];
    let gemeldet = false;

    if (meldungen.length > 0) {
      gemeldet = await sendeAlarm(meldungen);
      if (gemeldet) {
        const ids = meldungen.map((m) => m.id as string);
        const { error } = await db.rpc('gbp_monitor_mark_reported', { p_ids: ids });
        if (error) log('warn', 'mark_failed', { code: error.code });
      }
    }

    const ausfaelle = befunde.filter((b) => b.ergebnis === 'ausfall');
    log(ausfaelle.length > 0 ? 'warn' : 'debug', 'lauf_beendet', {
      quellen: befunde.length, ausfaelle: ausfaelle.length,
      meldungen: meldungen.length, gemeldet,
    });

    return json({
      ok: true,
      quellen: befunde.length,
      ausfaelle: ausfaelle.length,
      meldungen: meldungen.length,
      gemeldet,
      befunde,
    });

  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    log('error', 'request_failed', { status, message: String(err) });
    return json({
      error: {
        code: status === 401 ? 'unauthenticated' : 'internal_error',
        message: status === 401 ? 'Nicht berechtigt.' : 'Es ist ein Fehler aufgetreten.',
      },
    }, status);
  }
});
