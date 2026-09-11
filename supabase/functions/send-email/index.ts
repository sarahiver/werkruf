/* ═══════════════════════════════════════════════════════════════════════════
   E-MAIL-VERSAND

   Eigenständige Function. Arbeitet die Warteschlange aus
   email_queue ab und verschickt über Brevo.

   Getrennt von google-business, weil der Versand weder OAuth noch
   Google-Zugriff braucht — und weil google-business schon zu gross ist.

   ⚠️  "Verify JWT" muss AUS sein: der Aufruf kommt von pg_cron ohne
       Session. Geschützt über X-Worker-Secret, wie die Sync-Routen.

   Routen:
     POST /send-email/run       Warteschlange abarbeiten (Cron)
     POST /send-email/schedule  Lebenszyklus-Mails planen (Cron, täglich)
     POST /send-email/enqueue   Einzelne Mail einreihen (authentifiziert)
═══════════════════════════════════════════════════════════════════════════ */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

/* ═══════════════════════════════════════════════════════════════
   1 — TYPEN
═══════════════════════════════════════════════════════════════ */

type EmailTemplate =
  | 'welcome' | 'trial_reminder' | 'trial_ended'
  | 'connection_broken' | 'weekly_report' | 'weekly_summary' | 'visibility_report'
  | 'critical_review_alert' | 'inactivity_reminder';

interface EmailRow {
  id: string;
  user_id: string | null;
  to_email: string;
  to_name: string | null;
  template: EmailTemplate;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Empfehlung, wie sie top_recommendations_for_email() liefert. */
interface EmailAction {
  id?: string;
  title: string;
  summary?: string;
  reason?: string;
  benefit?: string;
  effort?: string;
  priority?: number;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Markenwerte je Vertikale. Spiegelt industryConfig.js. */
interface Brand {
  name: string;
  accent: string;
  primary: string;
  senderEmail: string;
  appUrl: string;
  productName: string;
}

/* ═══════════════════════════════════════════════════════════════
   2 — KONFIGURATION
═══════════════════════════════════════════════════════════════ */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/*
 * Absenderdaten und Farben je Vertikale.
 *
 * Bewusst hier dupliziert statt aus industryConfig.js importiert:
 * das ist eine Browser-Datei mit React-Abhängigkeiten, die Deno nicht
 * lädt. Die Werte ändern sich selten; ändern sie sich doch, gehören
 * beide Stellen angefasst.
 */
const BRANDS: Record<string, Brand> = {
  handwerk: {
    name: 'WERKRUF',
    accent: '#F28C28',
    primary: '#0B2545',
    senderEmail: 'hallo@werkruf.com',
    appUrl: 'https://werkruf.com',
    productName: 'WERKRUF PRO',
  },
  gastro: {
    name: 'GASTRORUF',
    accent: '#C8553D',
    primary: '#2E1F27',
    senderEmail: 'hallo@gastroruf.com',
    appUrl: 'https://gastroruf.com',
    productName: 'GASTRORUF PRO',
  },
  beauty: {
    name: 'BEAUTYRUF',
    accent: '#C08497',
    primary: '#3D2C33',
    senderEmail: 'hallo@beautyruf.com',
    appUrl: 'https://beautyruf.com',
    productName: 'BEAUTYRUF PRO',
  },
};

const brandFor = (key: unknown): Brand =>
  BRANDS[typeof key === 'string' ? key : 'handwerk'] ?? BRANDS.handwerk;

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  return value;
}

let cachedAdmin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

function log(level: 'debug' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ scope: 'send-email', level, event, ts: new Date().toISOString(), ...data });
  if (level === 'debug') console.log(line); else console[level](line);
}

/* ═══════════════════════════════════════════════════════════════
   3 — VORLAGEN

   HTML-Mail-Regeln, die anders sind als im Web:
   Tabellen statt Flexbox, Inline-Styles statt Klassen, keine
   Webfonts. Outlook ignoriert fast alles andere.
═══════════════════════════════════════════════════════════════ */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatDate = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** Gerüst um jeden Inhalt. */
function layout(brand: Brand, title: string, body: string, cta?: { label: string; url: string }): string {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
/* Dunkelmodus. Apple Mail, iOS Mail und Outlook.com werten das aus;
   Gmail ignoriert es und invertiert selbst. Deshalb bleiben die
   Inline-Styles die Grundlage — das hier überschreibt nur, wo es
   geht. Kein Layout hängt davon ab. */
@media (prefers-color-scheme: dark) {
  .wr-page   { background:#15171A !important; }
  .wr-card   { background:#1E2125 !important; }
  .wr-tile   { background:#262A2F !important; }
  .wr-title  { color:#F2F4F6 !important; }
  .wr-text   { color:#C3C8CE !important; }
  .wr-muted  { color:#8A9199 !important; }
  .wr-border { border-color:#33383E !important; }
  .wr-foot   { background:#1A1D21 !important; }
}
@media (max-width: 480px) {
  .wr-pad  { padding-left:16px !important; padding-right:16px !important; }
  .wr-tile { display:block !important; width:100% !important; margin-bottom:6px !important; }
}
</style></head>
<body class="wr-page" style="margin:0;padding:0;background:#F4F5F7;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wr-page" style="background:#F4F5F7;padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wr-card" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;">

    <tr><td style="background:${brand.primary};padding:22px 28px;">
      <span style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:1px;">${escapeHtml(brand.name)}</span>
    </td></tr>

    <tr><td style="height:3px;background:${brand.accent};font-size:0;line-height:0;">&nbsp;</td></tr>

    <tr><td class="wr-pad" style="padding:30px 28px 8px;">
      <h1 class="wr-title" style="margin:0 0 14px;font-size:20px;line-height:1.3;color:${brand.primary};">${escapeHtml(title)}</h1>
      ${body}
    </td></tr>

    ${cta ? `<tr><td class="wr-pad" style="padding:6px 28px 30px;">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${brand.accent};color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:6px;font-size:15px;font-weight:bold;">${escapeHtml(cta.label)}</a>
    </td></tr>` : '<tr><td style="height:22px;">&nbsp;</td></tr>'}

    <tr><td class="wr-foot wr-border" style="background:#FAFAFB;padding:18px 28px;border-top:1px solid #E8E9EC;">
      <p class="wr-muted" style="margin:0;font-size:12px;line-height:1.6;color:#7A8290;">
        ${escapeHtml(brand.name)} &middot;
        <a href="${brand.appUrl}/impressum" style="color:#7A8290;">Impressum</a> &middot;
        <a href="${brand.appUrl}/datenschutz" style="color:#7A8290;">Datenschutz</a><br>
        Du bekommst diese E-Mail, weil du ein Konto bei ${escapeHtml(brand.name)} hast.
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

const p = (text: string) =>
  `<p class="wr-text" style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#333A45;">${text}</p>`;

/** Reintext-Fassung. Nicht optional: ohne sie steigt die Spam-Einstufung. */
const toPlainText = (html: string) =>
  html.replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

/* ─────────────────────────────────────────────
   WIEDERVERWENDBARE BAUSTEINE

   Jeder Baustein baut eine Tabelle, keine Flexbox: Outlook rendert
   HTML-Mails über eine alte Word-Engine und kennt weder flex noch
   grid. Was hier wie ein Umweg aussieht, ist die Bedingung dafür,
   dass die Mail überall gleich ankommt.
───────────────────────────────────────────── */

/** Kennzahl-Kachel. Drei nebeneinander, auf dem Handy untereinander. */
function tiles(items: Array<{ value: string; label: string; color?: string }>): string {
  const width = Math.floor(100 / items.length);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
<tr>${items.map((item, i) => `
  <td class="wr-tile" width="${width}%" valign="top" style="background:#F6F7F9;border-radius:8px;padding:11px 13px;${i < items.length - 1 ? 'border-right:6px solid #ffffff;' : ''}">
    <div class="wr-title" style="font-size:19px;font-weight:bold;line-height:1.1;color:${item.color ?? '#0B2545'};">${escapeHtml(item.value)}</div>
    <div class="wr-muted" style="font-size:11px;color:#6B7280;margin-top:3px;">${escapeHtml(item.label)}</div>
  </td>`).join('')}
</tr></table>`;
}

/**
 * Der eine Befund. Farbig abgesetzt, aber nie rot — die Mail soll
 * informieren, nicht alarmieren. Selbst bei einer schlechten
 * Bewertung ist Bernstein die richtige Farbe: Rot im Posteingang
 * liest sich wie eine Rechnung.
 */
function insightBox(text: string, tone: 'neutral' | 'good' | 'attention' = 'neutral'): string {
  const colors = {
    neutral:   { bg: '#F6F7F9', bar: '#8A9199', fg: '#333A45' },
    good:      { bg: '#E8F5E9', bar: '#1E7E34', fg: '#1B5E20' },
    attention: { bg: '#FAEEDA', bar: '#BA7517', fg: '#633806' },
  }[tone];

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
<tr><td class="wr-tile" style="background:${colors.bg};border-left:3px solid ${colors.bar};padding:13px 15px;">
  <div style="font-size:10px;font-weight:bold;letter-spacing:1px;color:${colors.bar};margin-bottom:4px;">AUFGEFALLEN</div>
  <div style="font-size:13.5px;line-height:1.55;color:${colors.fg};">${text}</div>
</td></tr></table>`;
}

/** Eine Empfehlung: was, warum, wie lange. */
function actionRow(item: { title: string; why: string; effort: string }, isLast: boolean): string {
  return `
<tr><td class="wr-border" style="padding:11px 0;border-top:1px solid #E8E9EC;${isLast ? 'border-bottom:1px solid #E8E9EC;' : ''}">
  <div class="wr-title" style="font-size:13.5px;font-weight:bold;color:#0B2545;line-height:1.4;">${escapeHtml(item.title)}</div>
  <div class="wr-text" style="font-size:12.5px;color:#5F6875;margin-top:3px;line-height:1.5;">${escapeHtml(item.why)} &middot; ${escapeHtml(item.effort)}</div>
</td></tr>`;
}

function actionList(items: Array<{ title: string; why: string; effort: string }>): string {
  if (items.length === 0) return '';
  return `
<div class="wr-muted" style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#6B7280;margin:0 0 2px;">WAS DU TUN KANNST</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
${items.map((item, i) => actionRow(item, i === items.length - 1)).join('')}
</table>`;
}

/**
 * Profilwert mit Begründung.
 *
 * Nie eine Zahl ohne Erklärung: "72 von 100" allein verlangt Deutung
 * und erzeugt eher Unbehagen als Klarheit. Fehlt die Vorwoche, steht
 * das auch so da, statt eine Veränderung zu erfinden.
 */
function healthBox(score: number, delta: number | null, reason: string): string {
  const color = score >= 75 ? '#1E7E34' : score >= 50 ? '#A66A00' : '#B3261E';
  const change =
    delta === null ? 'erster Bericht' :
    delta > 0 ? `+${delta} zur Vorwoche` :
    delta < 0 ? `${delta} zur Vorwoche` : 'unverändert zur Vorwoche';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td class="wr-tile" style="background:#F6F7F9;border-radius:8px;padding:15px 16px;">
  <span style="font-size:23px;font-weight:bold;color:${color};">${score}</span>
  <span class="wr-muted" style="font-size:12.5px;color:#6B7280;"> von 100 &middot; ${escapeHtml(change)}</span>
  <div class="wr-text" style="font-size:12.5px;color:#5F6875;margin-top:7px;line-height:1.55;">${escapeHtml(reason)}</div>
</td></tr></table>`;
}

/* ─────────────────────────────────────────────
   WOCHENBERICHT — AUSWERTUNG

   Aus den Rohzahlen wird ein Zustand, ein Befund und höchstens drei
   Empfehlungen. Die Auswertung steht hier und nicht in der Vorlage,
   damit sie prüfbar bleibt.
───────────────────────────────────────────── */

interface WeeklyPayload {
  companyName?: string;
  industryKey?: string;
  healthScore?: number;
  healthDelta?: number | null;
  reviewsTotal?: number;
  reviewsNew?: number;
  unanswered?: number;
  /* Schlechteste neue Bewertung der Woche. Ohne die lässt sich der
     wichtigste Fall nicht erkennen — eine Ein-Stern-Bewertung ist
     etwas anderes als fünf offene Vier-Stern-Bewertungen. */
  lowestNewRating?: number | null;
  averageRating?: number | null;
  ratingDelta?: number | null;
  repliesPublished?: number;
  photoCount?: number;
  newestReviewAt?: string | null;
}

interface WeeklyAssessment {
  headline: string;
  insight: string;
  insightTone: 'neutral' | 'good' | 'attention';
  actions: Array<{ title: string; why: string; effort: string }>;
  healthReason: string;
}

function assessWeek(data: WeeklyPayload): WeeklyAssessment {
  const newReviews = data.reviewsNew ?? 0;
  const unanswered = data.unanswered ?? 0;
  const published  = data.repliesPublished ?? 0;
  const photos     = data.photoCount ?? 0;
  const delta      = data.healthDelta ?? null;

  const daysSinceReview = data.newestReviewAt
    ? Math.floor((Date.now() - new Date(data.newestReviewAt).getTime()) / 864e5)
    : null;

  /* ── Überschrift: der Zustand in einem Halbsatz ──
     Nie alarmierend. "Eine Sache wartet" statt "Achtung: offene
     Aufgaben" — im Posteingang liest sich Dringlichkeit wie eine
     Mahnung, und Mahnungen werden weggeklickt. */
  const headline =
    unanswered > 3   ? `${unanswered} Bewertungen warten auf Antwort.`
    : unanswered > 0 ? unanswered === 1 ? 'eine Sache wartet.' : `${unanswered} Sachen warten.`
    : newReviews > 0 ? 'gute Woche — alles beantwortet.'
                     : 'ruhige Woche, nichts zu tun.';

  /* ── Der eine Befund ──
     Reihenfolge nach Aussagekraft. Nur einer, nie mehrere: eine Liste
     von Beobachtungen ist keine Erkenntnis. */
  let insight: string;
  let insightTone: WeeklyAssessment['insightTone'] = 'neutral';

  const lowest = data.lowestNewRating ?? null;

  if (lowest !== null && lowest <= 2) {
    /* Der wichtigste Fall zuerst. Eine schlechte Bewertung ist der
       Grund, aus dem jemand die Mail öffnet — sie darf nicht unter
       einer allgemeinen Beobachtung verschwinden. */
    insight = `Eine Bewertung mit ${lowest} ${lowest === 1 ? 'Stern' : 'Sternen'} ist eingegangen. Eine sachliche Antwort darauf wirkt auf spätere Leser oft stärker als die Bewertung selbst.`;
    insightTone = 'attention';
  } else if (daysSinceReview !== null && daysSinceReview > 60) {
    insight = `Seit ${Math.round(daysSinceReview / 30)} Monaten ist keine neue Bewertung dazugekommen. Ein Profil ohne frische Bewertungen wirkt auf Suchende älter, als es ist.`;
    insightTone = 'attention';
  } else if (unanswered >= 3) {
    insight = `${unanswered} Bewertungen stehen ohne Antwort da. Wer dein Profil öffnet, sieht das sofort — und liest sie anders als beantwortete.`;
    insightTone = 'attention';
  } else if (newReviews >= 3) {
    insight = `${newReviews} neue Bewertungen in einer Woche — deutlich mehr als üblich.`;
    insightTone = 'good';
  } else if (unanswered > 0 && published > 0) {
    insight = `Du hast diese Woche ${published} ${published === 1 ? 'Antwort' : 'Antworten'} veröffentlicht. ${unanswered} ${unanswered === 1 ? 'steht' : 'stehen'} noch aus.`;
    insightTone = 'attention';
  } else if (unanswered > 0) {
    insight = `${unanswered === 1 ? 'Eine Bewertung wartet' : unanswered + ' Bewertungen warten'} auf eine Antwort. Der Vorschlag liegt im Dashboard bereit.`;
    insightTone = 'attention';
  } else if (unanswered === 0 && (data.reviewsTotal ?? 0) > 0) {
    insight = 'Jede Bewertung ist beantwortet. Das sieht jeder, der dein Profil öffnet — und es unterscheidet dich von den meisten.';
    insightTone = 'good';
  } else if (newReviews === 0 && (data.reviewsTotal ?? 0) === 0) {
    insight = 'Noch keine Bewertungen. Der Bewertungslink im Dashboard ist der schnellste Weg zur ersten.';
    insightTone = 'neutral';
  } else {
    insight = 'Keine Auffälligkeiten. Dein Profil läuft.';
    insightTone = 'neutral';
  }

  /* ── Höchstens drei Empfehlungen ──
     Vier wären eine Liste, und Listen werden aufgeschoben. */
  const actions: WeeklyAssessment['actions'] = [];

  if (unanswered > 0) {
    actions.push({
      title: unanswered === 1 ? 'Eine Bewertung beantworten' : `${unanswered} Bewertungen beantworten`,
      why: lowest !== null && lowest <= 2
        ? 'Die schlechte zuerst — der Vorschlag liegt bereit'
        : 'Der Vorschlag liegt bereit',
      effort: `${Math.max(2, unanswered * 2)} Min.`,
    });
  }
  if (photos < 5) {
    const needed = 5 - photos;
    actions.push({
      title: needed === 1 ? 'Ein Foto hochladen' : `${needed} Fotos hochladen`,
      why: photos === 0 ? 'Profile ohne Bilder werden seltener angeklickt' : `Du hast ${photos}, fünf wirken vollständig`,
      effort: '5 Min.',
    });
  }
  if (daysSinceReview !== null && daysSinceReview > 45) {
    actions.push({
      title: 'Kunden um eine Bewertung bitten',
      why: 'Bewertungslink oder QR-Code aus dem Dashboard',
      effort: '2 Min.',
    });
  }

  /* ── Warum der Wert sich bewegt hat ── */
  const healthReason =
    delta === null   ? 'Ab nächster Woche siehst du hier, wie sich der Wert entwickelt.'
    : delta > 0      ? published > 0
        ? `Gestiegen, weil du ${published} ${published === 1 ? 'Bewertung' : 'Bewertungen'} beantwortet hast.`
        : 'Gestiegen — dein Profil ist vollständiger als vorletzte Woche.'
    : delta < 0      ? unanswered > 0
        ? `Gesunken, weil ${unanswered} ${unanswered === 1 ? 'Bewertung' : 'Bewertungen'} unbeantwortet ${unanswered === 1 ? 'ist' : 'sind'}.`
        : 'Gesunken — die letzte Bewertung liegt länger zurück.'
    : 'Unverändert zur Vorwoche.';

  return { headline, insight, insightTone, actions: actions.slice(0, 3), healthReason };
}

function render(template: EmailTemplate, payload: Record<string, unknown>, toName: string | null): RenderedEmail {
  const brand = brandFor(payload.industryKey);
  const company = escapeHtml(payload.companyName ?? toName ?? 'dein Betrieb');
  const greeting = toName ? `Hallo ${escapeHtml(toName.split(' ')[0])},` : 'Hallo,';

  switch (template) {
    case 'welcome': {
      const title = `Willkommen bei ${brand.name}`;
      const html = layout(brand, title,
        p(greeting) +
        p(`dein Konto steht. Ein Schritt fehlt noch, dann läuft ${escapeHtml(brand.name)} für ${company}.`) +
        p('<strong>Verbinde dein Google-Profil.</strong> Das dauert zwei Minuten und ist eine einzige Berechtigung — dein Unternehmensprofil verwalten. Kein Zugriff auf E-Mails, Kontakte oder Dateien.') +
        p(`Danach prüft ${escapeHtml(brand.name)} dein Profil laufend, zeigt dir Lücken und legt zu jeder neuen Bewertung einen Antwortvorschlag bereit. Veröffentlicht wird nur, was du freigibst.`),
        { label: 'Google-Profil verbinden', url: `${brand.appUrl}/dashboard/google` },
      );
      return { subject: title, html, text: toPlainText(html) };
    }

    case 'trial_reminder': {
      const days = Number(payload.daysLeft ?? 7);
      const endsAt = formatDate(payload.trialEndsAt);
      const title = `Noch ${days} Tage Testphase`;
      const html = layout(brand, title,
        p(greeting) +
        p(`deine Testphase für ${escapeHtml(brand.productName)} läuft ${endsAt ? `am ${endsAt}` : `in ${days} Tagen`} ab.`) +
        p('Wenn du weitermachen möchtest, hinterlegst du im Dashboard eine Zahlungsmethode. Wenn nicht, passiert nichts — es wird nichts automatisch abgebucht.') +
        p('Fragen? Antworte einfach auf diese E-Mail.'),
        { label: 'Zum Dashboard', url: `${brand.appUrl}/dashboard` },
      );
      return { subject: title, html, text: toPlainText(html) };
    }

    case 'trial_ended': {
      const title = 'Deine Testphase ist abgelaufen';
      const html = layout(brand, title,
        p(greeting) +
        p(`die Testphase für ${company} ist beendet. Die Überwachung pausiert, und es kommen keine neuen Antwortvorschläge mehr.`) +
        p('<strong>Dein Google-Profil bleibt unverändert.</strong> Alles, was du in der Testphase freigegeben hast, ist weiterhin online — Antworten, Öffnungszeiten, Angaben. Es gehört deinem Google-Konto, nicht uns.') +
        p('Du kannst jederzeit weitermachen, wo du aufgehört hast.'),
        { label: 'Weitermachen', url: `${brand.appUrl}/pricing` },
      );
      return { subject: title, html, text: toPlainText(html) };
    }

    case 'connection_broken': {
      const title = 'Verbindung zu Google unterbrochen';
      const html = layout(brand, title,
        p(greeting) +
        p(`die Verbindung zwischen ${escapeHtml(brand.name)} und dem Google-Profil von ${company} ist abgerissen. Das passiert, wenn die Berechtigung im Google-Konto widerrufen oder das Passwort geändert wurde.`) +
        p('<strong>Bis zur Erneuerung läuft die Überwachung nicht weiter.</strong> Neue Bewertungen kommen nicht im Dashboard an, freigegebene Antworten werden nicht übertragen.') +
        p('Neu verbinden dauert keine Minute.'),
        { label: 'Jetzt neu verbinden', url: `${brand.appUrl}/dashboard/google` },
      );
      return { subject: title, html, text: toPlainText(html) };
    }

    case 'visibility_report': {
      /* Der Report aus dem Sichtbarkeits-Check.
         Das ist die erste Mail, die ein Interessent überhaupt von uns
         sieht — sie muss das Ergebnis zeigen, nicht Werbung. Die
         Handlungsempfehlung ergibt sich aus dem Score selbst. */
      const score = Number(payload.score ?? 0);
      const rating = payload.rating;
      const reviewCount = Number(payload.reviewCount ?? 0);
      const city = payload.city ? ` in ${escapeHtml(payload.city)}` : '';

      const verdict =
        score >= 70 ? { label: 'GUT',          color: '#1E7E34', bg: '#E8F5E9' } :
        score >= 45 ? { label: 'AUSBAUFÄHIG',  color: '#A66A00', bg: '#FFF4E0' } :
                      { label: 'KRITISCH',     color: '#B3261E', bg: '#FDECEA' };

      const finding =
        score >= 70
          ? 'Dein Profil ist gut aufgestellt. Der Abstand zu den ersten Plätzen entscheidet sich jetzt über Bewertungen und Aktualität.'
          : score >= 45
            ? 'Die Grundlagen stimmen, aber es bleibt Sichtbarkeit liegen. Meist fehlen Fotos, aktuelle Öffnungszeiten oder Antworten auf Bewertungen.'
            : 'Dein Profil wird bei Google kaum ausgespielt. Wer dich sucht, findet dich — wer deine Leistung sucht, findet andere.';

      const title = `Sichtbarkeits-Report: ${escapeHtml(payload.companyName ?? 'dein Betrieb')}`;

      const scoreBox = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${verdict.bg};border-radius:8px;margin:0 0 18px;">
<tr>
  <td style="padding:18px 20px;">
    <span style="font-size:34px;font-weight:bold;color:${verdict.color};line-height:1;">${score}</span>
    <span style="font-size:15px;color:${verdict.color};"> / 100</span>
    <div style="margin-top:6px;font-size:12px;font-weight:bold;letter-spacing:1px;color:${verdict.color};">${verdict.label}</div>
  </td>
</tr>
</table>`;

      const facts = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-top:1px solid #E8E9EC;">
  <tr>
    <td style="padding:11px 0;border-bottom:1px solid #E8E9EC;font-size:14px;color:#333A45;">Bewertung bei Google</td>
    <td style="padding:11px 0;border-bottom:1px solid #E8E9EC;font-size:14px;color:#333A45;text-align:right;font-weight:bold;">${rating ? `${escapeHtml(rating)} von 5` : 'keine'}</td>
  </tr>
  <tr>
    <td style="padding:11px 0;border-bottom:1px solid #E8E9EC;font-size:14px;color:#333A45;">Anzahl Bewertungen</td>
    <td style="padding:11px 0;border-bottom:1px solid #E8E9EC;font-size:14px;color:#333A45;text-align:right;font-weight:bold;">${reviewCount}</td>
  </tr>
</table>`;

      const html = layout(brand, title,
        p(`hier ist das Ergebnis für <strong>${company}</strong>${city}.`) +
        scoreBox +
        p(finding) +
        facts +
        p(`Der Wert setzt sich aus Bewertungen, Aktualität und Vollständigkeit deines Profils zusammen — den Punkten, nach denen Google entscheidet, wer bei einer Suche oben steht.`) +
        p(`Verbindest du dein Profil mit ${escapeHtml(brand.name)}, siehst du diese Lücken nicht nur: du schliesst sie direkt aus dem Dashboard, und zu jeder neuen Bewertung liegt ein Antwortvorschlag bereit.`),
        { label: 'Profil verbinden und Lücken schliessen', url: `${brand.appUrl}/pricing` },
      );
      return { subject: title, html, text: toPlainText(html) };
    }

    case 'critical_review_alert': {
      /* Der einzige Anlass, der nicht bis Montag wartet.
         Gebündelt: Kommen drei schlechte Bewertungen an einem Tag,
         ist das EINE Meldung. Drei Mails wären der schnellste Weg in
         den Spamfilter — und dann käme auch die wichtige nicht mehr
         an. */
      const count = Number(payload.count ?? 1);
      const title = count === 1
        ? 'Eine kritische Bewertung ist eingegangen'
        : `${count} kritische Bewertungen sind eingegangen`;

      const html = layout(brand, title,
        p(greeting) +
        p(count === 1
          ? `für ${company} ist eine Bewertung mit ein oder zwei Sternen veröffentlicht worden.`
          : `für ${company} sind ${count} Bewertungen mit ein oder zwei Sternen veröffentlicht worden.`) +
        /* Kein Ausrufezeichen, keine Frist, keine Warnung. Die Lage
           ist ernst genug — künstliche Dringlichkeit würde sie
           kleiner wirken lassen, nicht grösser. */
        p('<strong>Eine sachliche Antwort wirkt auf spätere Leser oft stärker als die Bewertung selbst.</strong> ' +
          'Wer vergleicht, achtet weniger auf die Kritik als darauf, wie ein Betrieb damit umgeht.') +
        p(`Der Antwortvorschlag liegt im Dashboard bereit. Lesen, anpassen, freigeben — veröffentlicht wird nur, was du bestätigst.`),
        { label: count === 1 ? 'Jetzt antworten' : 'Antworten ansehen',
          url: `${brand.appUrl}/dashboard/bewertungen` },
      );

      return { subject: title, html, text: toPlainText(html) };
    }

    case 'inactivity_reminder': {
      /* Nicht "du warst lange nicht da", sondern "es hat sich etwas
         angesammelt".

         Der Unterschied liegt nicht im Ton, sondern in der Bedingung:
         Ohne offene Aufgaben von Belang wird diese Mail gar nicht
         erst geplant. Sie erinnert an den Betrieb, nicht an uns. */
      const days = Math.round(Number(payload.daysAway ?? 0));
      const open = Number(payload.open ?? 0);
      const actions = Array.isArray(payload.actions)
        ? (payload.actions as EmailAction[]).slice(0, 3) : [];

      const title = open === 1
        ? 'Eine Sache wartet auf dich'
        : `${open} Sachen warten auf dich`;

      const html = layout(brand, title,
        p(greeting) +
        p(`seit deinem letzten Besuch im Dashboard sind ${days} Tage vergangen. In der Zeit hat sich Folgendes angesammelt:`) +
        actionList(actions.map((a) => ({
          title: a.title, why: a.reason ?? a.summary ?? '', effort: a.effort ?? '',
        }))) +
        (open > actions.length
          ? p(`Dazu ${open - actions.length} weitere ${open - actions.length === 1 ? 'Empfehlung' : 'Empfehlungen'} von geringerer Dringlichkeit.`)
          : '') +
        p('Nichts davon ist eilig. Es liegt bereit, wenn du Zeit hast.'),
        { label: 'Offene Aufgaben ansehen', url: `${brand.appUrl}/dashboard` },
      );

      return { subject: title, html, text: toPlainText(html) };
    }

    case 'weekly_summary': {
      /* Der Wochenbericht. Der einzige regelmässige Kontaktpunkt —
         und der einzige, der auch dann kommt, wenn nichts war. Genau
         das trägt die Gewohnheit: Wer die Mail montags erwartet,
         öffnet sie auch in der Woche, in der etwas drinsteht. */
      const data = payload as WeeklyPayload;
      const week = assessWeek(data);

      const rating = data.averageRating;
      const ratingDelta = data.ratingDelta ?? null;
      const ratingLabel =
        ratingDelta === null || Math.abs(ratingDelta) < 0.05 ? 'unverändert'
        : ratingDelta > 0 ? `+${ratingDelta.toFixed(1)}`
                          : ratingDelta.toFixed(1);

      const delta = data.healthDelta ?? null;

      /* Der Betreff sagt das Ergebnis, nicht das Thema. "Dein
         Wochenbericht" zwingt zum Öffnen, um zu erfahren, ob etwas
         ist — das ist genau die Arbeit, die wir abnehmen wollen. */
      const subject =
        (data.lowestNewRating ?? 5) <= 2
          ? `Neue ${data.lowestNewRating}-Sterne-Bewertung — Antwort liegt bereit`
          : (data.unanswered ?? 0) > 0
          ? `${data.unanswered} ${data.unanswered === 1 ? 'Bewertung wartet' : 'Bewertungen warten'} auf Antwort`
          : (data.reviewsNew ?? 0) > 0
            ? `${data.reviewsNew} neue ${data.reviewsNew === 1 ? 'Bewertung' : 'Bewertungen'} — alles beantwortet`
            : 'Ruhige Woche bei ' + (data.companyName ?? escapeHtml(brand.name));

      const body =
        `<p class="wr-text" style="margin:0 0 4px;font-size:14px;color:#5F6875;">${greeting}</p>` +
        `<p class="wr-title" style="margin:0 0 18px;font-size:17px;font-weight:bold;color:${brand.primary};line-height:1.35;">${escapeHtml(week.headline)}</p>` +

        tiles([
          { value: String(data.reviewsNew ?? 0), label: (data.reviewsNew ?? 0) === 1 ? 'neue Bewertung' : 'neue Bewertungen' },
          { value: rating ? rating.toFixed(1) : '—', label: rating ? ratingLabel : 'noch kein Wert' },
          {
            value: delta === null ? String(data.healthScore ?? 0)
                 : delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : '±0',
            label: 'Profilwert',
            color: delta === null ? undefined : delta > 0 ? '#1E7E34' : delta < 0 ? '#B3261E' : undefined,
          },
        ]) +

        insightBox(escapeHtml(week.insight), week.insightTone) +
        actionList(week.actions) +
        healthBox(data.healthScore ?? 0, delta, week.healthReason);

      const html = layout(brand, subject, body, {
        // Ein Knopf. Zwei wären eine Frage, und Fragen werden vertagt.
        label: week.actions.length > 0 ? 'Im Dashboard erledigen' : 'Dashboard öffnen',
        url: `${brand.appUrl}/dashboard`,
      });

      return { subject, html, text: toPlainText(html) };
    }

    case 'weekly_report': {
      const reviews = Number(payload.newReviews ?? 0);
      const rating = payload.averageRating;
      const title = `Deine Woche bei ${brand.name}`;
      const html = layout(brand, title,
        p(greeting) +
        p(`hier der Stand für ${company}:`) +
        p(`<strong>${reviews}</strong> neue ${reviews === 1 ? 'Bewertung' : 'Bewertungen'}` +
          (rating ? ` &middot; Durchschnitt <strong>${escapeHtml(rating)}</strong> von 5` : '')) +
        (Number(payload.unanswered ?? 0) > 0
          ? p(`<strong>${escapeHtml(payload.unanswered)}</strong> Bewertungen warten noch auf eine Antwort.`)
          : p('Alle Bewertungen sind beantwortet.')),
        { label: 'Bewertungen ansehen', url: `${brand.appUrl}/dashboard/bewertungen` },
      );
      return { subject: title, html, text: toPlainText(html) };
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   4 — VERSAND ÜBER BREVO
═══════════════════════════════════════════════════════════════ */

interface SendResult {
  ok: boolean;
  providerId?: string;
  errorCode?: string;
  errorMessage?: string;
  /** false = wiederholen sinnlos (ungültige Adresse, abgelehnt) */
  retryable: boolean;
}

async function sendViaBrevo(row: EmailRow, rendered: RenderedEmail, brand: Brand): Promise<SendResult> {
  let response: Response;

  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': requireEnv('BREVO_API_KEY'),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: brand.name, email: brand.senderEmail },
        to: [{ email: row.to_email, ...(row.to_name ? { name: row.to_name } : {}) }],
        subject: rendered.subject,
        htmlContent: rendered.html,
        textContent: rendered.text,
        // Landet in Brevos Statistik — so lässt sich pro Vorlage
        // auswerten, ohne dass wir selbst zählen müssen.
        tags: [row.template],
      }),
    });
  } catch (cause) {
    return {
      ok: false, retryable: true,
      errorCode: 'network_error',
      errorMessage: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (response.ok) {
    const body = await response.json().catch(() => ({}));
    return { ok: true, retryable: false, providerId: body?.messageId };
  }

  const detail = await response.text().catch(() => '');

  // 400 heisst bei Brevo fast immer: Adresse ungültig oder gesperrt.
  // Zwei weitere Versuche ändern daran nichts und kosten nur Quota.
  const retryable = response.status === 429 || response.status >= 500;

  return {
    ok: false, retryable,
    errorCode: `brevo_${response.status}`,
    errorMessage: detail.slice(0, 500),
  };
}

/* ═══════════════════════════════════════════════════════════════
   5 — WARTESCHLANGE ABARBEITEN
═══════════════════════════════════════════════════════════════ */

async function processQueue(options: { workerId: string; limit: number; budgetMs: number }) {
  const db = adminClient();
  const startedAt = Date.now();

  const { data, error } = await db.rpc('claim_emails', {
    p_worker: options.workerId,
    p_limit:  options.limit,
  });

  if (error) throw new Error(`Mails nicht übernehmbar: ${error.message}`);

  const rows = (data ?? []) as EmailRow[];
  let sent = 0, failed = 0;

  for (const row of rows) {
    if (Date.now() - startedAt > options.budgetMs) {
      // Rest zurück in die Schlange — der nächste Lauf nimmt ihn.
      await db.rpc('finish_email', {
        p_id: row.id, p_success: false,
        p_error_code: 'budget_exhausted', p_error_message: 'Zeitbudget erschöpft',
      });
      failed++;
      continue;
    }

    try {
      const brand = brandFor(row.payload.industryKey);
      const rendered = render(row.template, row.payload, row.to_name);
      const result = await sendViaBrevo(row, rendered, brand);

      if (result.ok) {
        await db.rpc('finish_email', {
          p_id: row.id, p_success: true, p_provider_id: result.providerId ?? null,
        });
        sent++;
        log('debug', 'email_sent', { template: row.template, id: row.id });
      } else {
        // Endgültige Fehler nicht wiederholen: attempts hochsetzen,
        // damit finish_email direkt auf 'failed' geht.
        if (!result.retryable) {
          await db.from('email_queue')
            .update({ attempts: row.max_attempts })
            .eq('id', row.id);
        }
        await db.rpc('finish_email', {
          p_id: row.id, p_success: false,
          p_error_code: result.errorCode ?? null,
          p_error_message: result.errorMessage ?? null,
        });
        failed++;
        log('warn', 'email_failed', {
          template: row.template, id: row.id,
          code: result.errorCode, retryable: result.retryable,
        });
      }
    } catch (err) {
      await db.rpc('finish_email', {
        p_id: row.id, p_success: false,
        p_error_code: 'render_error',
        p_error_message: err instanceof Error ? err.message : String(err),
      });
      failed++;
      log('error', 'email_error', { id: row.id, message: String(err) });
    }
  }

  log('debug', 'queue_run', {
    workerId: options.workerId, claimed: rows.length, sent, failed,
    elapsedMs: Date.now() - startedAt,
  });

  return { claimed: rows.length, sent, failed };
}

/* ═══════════════════════════════════════════════════════════════
   6 — HTTP
═══════════════════════════════════════════════════════════════ */

function corsHeaders(): Record<string, string> {
  const allowed = (Deno.env.get('GBP_ALLOWED_ORIGINS') ?? '')
    .split(',').map((o: string) => o.trim().replace(/\/$/, '')).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed[0] ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Konstante Laufzeit — ein früh abbrechender Vergleich verrät über die Dauer, wie viel stimmt. */
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
    throw Object.assign(new Error('Ungültiges Worker-Secret'), { status: 401 });
  }
}

async function requireUser(request: Request): Promise<{ id: string; email: string | null }> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Nicht eingeloggt'), { status: 401 });
  }
  const { data, error } = await adminClient().auth.getUser(header.slice(7).trim());
  if (error || !data?.user) {
    throw Object.assign(new Error('Session ungültig'), { status: 401 });
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/* ═══════════════════════════════════════════════════════════════
   7 — EINSTIEG
═══════════════════════════════════════════════════════════════ */

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: { code: 'bad_request', message: 'Nur POST.' } }, 405);
  }

  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const slugIndex = segments.lastIndexOf('send-email');
  const route = segments[slugIndex + 1] ?? 'run';

  try {
    let body: Record<string, unknown> = {};
    try {
      const raw = await request.text();
      if (raw) body = JSON.parse(raw);
    } catch { /* Standardwerte */ }

    switch (route) {
      case 'run': {
        requireWorkerSecret(request);
        const workerId = `mail-${crypto.randomUUID().slice(0, 8)}`;
        const summary = await processQueue({
          workerId,
          limit:    Math.min(Math.max(Number(body.limit ?? 20), 1), 50),
          budgetMs: Math.min(Number(body.budgetMs ?? 40_000), 60_000),
        });
        return jsonResponse({ workerId, ...summary });
      }

      case 'schedule': {
        requireWorkerSecret(request);
        const { data, error } = await adminClient().rpc('schedule_lifecycle_emails');
        if (error) throw new Error(error.message);
        return jsonResponse(data ?? {});
      }

      /* Montags. Legt je Nutzer einen Wochenstand an und reiht die
         Mail ein — der Vergleich zur Vorwoche entsteht dabei. */
      case 'weekly': {
        requireWorkerSecret(request);
        const { data, error } = await adminClient().rpc('schedule_weekly_summaries');
        if (error) throw new Error(error.message);
        return jsonResponse(data ?? {});
      }

      /* Die Kommunikationsschicht. Entscheidet je Nutzer, ob, wann
         und über welchen Kanal — und reiht ein, was gesendet werden
         soll.

         Body: { channel?: 'all' | 'immediate_alert' | 'weekly_email'
                          | 'inactivity_reminder' }

         Mit Kanal aufgerufen für die häufigen Läufe (Sofortmeldungen
         alle 15 Minuten), ohne für den Montagslauf. */
      case 'plan': {
        requireWorkerSecret(request);
        const channel = typeof body.channel === 'string' ? body.channel : 'all';
        const { data, error } = await adminClient()
          .rpc('schedule_communications', { p_channel: channel });
        if (error) throw new Error(error.message);
        return jsonResponse({ channel, ...(data as Record<string, unknown> ?? {}) });
      }

      /* Nachvollziehbarkeit: Was würde dieser Nutzer bekommen, und
         warum nicht? Die Frage, die im Betrieb tatsächlich gestellt
         wird. */
      case 'explain': {
        requireWorkerSecret(request);
        const userId = typeof body.userId === 'string' ? body.userId : null;
        if (!userId) {
          return jsonResponse({
            error: { code: 'bad_request', message: 'userId fehlt.' },
          }, 400);
        }
        const { data, error } = await adminClient()
          .rpc('plan_communications', { p_user_id: userId });
        if (error) throw new Error(error.message);
        return jsonResponse(data ?? {});
      }

      /* Vom Frontend aufgerufen, z.B. nach der Registrierung.
         Die Adresse kommt aus der SESSION, nicht aus dem Body —
         sonst liesse sich der Versand an beliebige Empfänger
         auslösen und die Domain als Spam-Schleuder missbrauchen. */
      case 'enqueue': {
        const user = await requireUser(request);
        const template = String(body.template ?? '');

        if (template !== 'welcome') {
          return jsonResponse(
            { error: { code: 'bad_request', message: 'Vorlage nicht erlaubt.' } }, 400,
          );
        }
        if (!user.email) {
          return jsonResponse(
            { error: { code: 'bad_request', message: 'Kein E-Mail-Adresse in der Session.' } }, 400,
          );
        }

        const { data, error } = await adminClient().rpc('enqueue_email', {
          p_template:   'welcome',
          p_to_email:   user.email,
          p_dedupe_key: `welcome:${user.id}`,
          p_user_id:    user.id,
          p_to_name:    typeof body.name === 'string' ? body.name.slice(0, 120) : null,
          p_payload:    { industryKey: body.industryKey ?? 'handwerk', companyName: body.companyName ?? null },
        });

        if (error) throw new Error(error.message);
        // null = war schon eingereiht. Für den Aufrufer dasselbe Ergebnis.
        return jsonResponse({ queued: true, id: data ?? null, duplicate: data === null });
      }

      default:
        return jsonResponse({ error: { code: 'not_found', message: 'Unbekannte Route.' } }, 404);
    }
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    log('error', 'request_failed', {
      route, status, message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse({
      error: {
        code: status === 401 ? 'unauthenticated' : 'internal_error',
        message: status === 401 ? 'Nicht berechtigt.' : 'Es ist ein Fehler aufgetreten.',
      },
    }, status);
  }
});
