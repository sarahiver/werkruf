/*
 * Akquise (WP16) — Vertriebsstatus, Founding-Partner-Mail, Ereignisse.
 *
 * Geteilt zwischen Jest, admin-ops (Vorschau), send-email (Rendern)
 * und dem Admin-Frontend. Reines JavaScript ohne Importe.
 *
 * Zwei getrennte Welten, absichtlich:
 *   Vertriebsstatus  manuell, fachlich (AKQUISE_STATUS)
 *   Mail-Ereignisse  technisch, append-only (EREIGNIS_TEXT)
 * Nichts hier leitet das eine aus dem anderen ab.
 */

export const AKQUISE_STATUS = Object.freeze([
  'neu', 'vorbereitet', 'angeschrieben', 'interesse', 'kein_interesse', 'founding_partner', 'zurueckgestellt',
]);

export const AKQUISE_STATUS_TEXT = Object.freeze({
  neu: 'Neu',
  vorbereitet: 'Vorbereitet',
  angeschrieben: 'Angeschrieben',
  interesse: 'Interesse',
  kein_interesse: 'Kein Interesse',
  founding_partner: 'Founding Partner',
  zurueckgestellt: 'Zurückgestellt',
});

/* Mail-Ereignisse → Wortlaut im Admin. „Öffnung erkannt", nie „gelesen":
   ein Open ist ein geladenes Pixel (Apple Mail, Scanner, Proxys). */
export const EREIGNIS_TEXT = Object.freeze({
  sent: 'Gesendet',
  delivered: 'Zugestellt',
  first_open: 'Öffnung erkannt',
  opened: 'Weitere Öffnung erkannt',
  clicked: 'Link geklickt',
  presentation_clicked: 'Präsentation geklickt',
  cta_viewed: 'Interessensseite aufgerufen',
  cta_clicked: 'Interesse bestätigt',
  soft_bounce: 'Soft Bounce (vorübergehend nicht zustellbar)',
  hard_bounce: 'Hard Bounce (Adresse ungültig)',
  blocked: 'Von Brevo blockiert',
  spam: 'Als Spam gemeldet',
  unsubscribed: 'Abgemeldet',
  error: 'Versandfehler',
});

/* Diese Ereignisse sperren den Lead fuer weiteren Versand (serverseitig
   abgeleitet aus der Historie, nie als Status gespeichert). */
export const SPERR_EREIGNISSE = Object.freeze(['hard_bounce', 'blocked', 'spam', 'unsubscribed']);

export const SPERR_TEXT = Object.freeze({
  hard_bounce: 'Lead ist für weiteren Mailversand gesperrt: Hard Bounce.',
  blocked: 'Lead ist für weiteren Mailversand gesperrt: von Brevo blockiert.',
  spam: 'Lead ist für weiteren Mailversand gesperrt: Spam-Meldung.',
  unsubscribed: 'Lead ist für weiteren Mailversand gesperrt: abgemeldet.',
});

export const VERSAND_GRUND_TEXT = Object.freeze({
  gesperrt: 'Lead ist für weiteren Mailversand gesperrt.',
  laeuft_bereits: 'Für diesen Lead ist bereits ein Versand in Arbeit.',
  rate_limit: 'Schutzlimit erreicht: höchstens 20 Akquise-Mails pro Stunde.',
  kein_lead: 'Lead nicht gefunden.',
  keine_email: 'Der Lead hat keine gültige E-Mail-Adresse.',
});

/* ── E-Mail ── */
export const EMAIL_MUSTER = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalisiereEmail(roh) {
  if (typeof roh !== 'string') return null;
  const t = roh.trim().toLowerCase();
  return EMAIL_MUSTER.test(t) && t.length <= 254 ? t : null;
}

/* ── Lead-Eingabe (Admin) — Pflicht: company_name, email ── */
export const LEAD_FELDER = Object.freeze(['company_name', 'contact_person', 'phone', 'trade', 'city', 'email', 'website', 'google_profile_url', 'personalized_sentence', 'note']);
const LAENGEN = Object.freeze({ company_name: 200, contact_person: 120, phone: 40, trade: 80, city: 120, website: 300, google_profile_url: 500, personalized_sentence: 600, note: 4000 });

/**
 * Prueft und reduziert Lead-Daten. `neu` = alle Pflichtfelder noetig;
 * sonst nur die mitgeschickten. Unbekannte Schluessel fallen weg.
 * @returns {{ok:true, werte:object}|{ok:false, fehler:string}}
 */
export function pruefeLeadEingabe(roh, { neu = true } = {}) {
  if (!roh || typeof roh !== 'object') return { ok: false, fehler: 'Keine Daten' };
  const werte = {};
  for (const f of LEAD_FELDER) {
    if (!Object.prototype.hasOwnProperty.call(roh, f)) continue;
    const v = roh[f];
    if (v === null || v === undefined) { werte[f] = null; continue; }
    if (typeof v !== 'string') return { ok: false, fehler: `${f} muss Text sein` };
    const t = v.trim();
    if (f === 'email') {
      const e = normalisiereEmail(t);
      if (!e) return { ok: false, fehler: 'E-Mail ist ungültig' };
      werte.email = e;
      continue;
    }
    if (t.length > LAENGEN[f]) return { ok: false, fehler: `${f} ist zu lang (max. ${LAENGEN[f]})` };
    if ((f === 'website' || f === 'google_profile_url') && t && !/^https?:\/\/\S+$/i.test(t)) return { ok: false, fehler: `${f} muss mit http(s):// beginnen` };
    werte[f] = t || null;
  }
  if (neu) {
    if (!werte.company_name) return { ok: false, fehler: 'Betrieb (company_name) fehlt' };
    if (!werte.email) return { ok: false, fehler: 'E-Mail fehlt' };
  } else if (Object.prototype.hasOwnProperty.call(werte, 'company_name') && !werte.company_name) {
    return { ok: false, fehler: 'Betrieb (company_name) darf nicht leer sein' };
  }
  return { ok: true, werte };
}

/* ── Die Founding-Partner-Mail (Produktvorgabe, nicht umformulieren) ── */
export const FP_MAIL_BETREFF = (betrieb) => `Darf ich ${betrieb} als WERKRUF Founding Partner einladen?`;

export function fpAnrede(contactPerson) {
  const n = typeof contactPerson === 'string' ? contactPerson.trim() : '';
  return n && n !== '-' ? n : 'zusammen';
}

/**
 * Absaetze der Mail als Daten — Text und HTML werden daraus gebaut,
 * damit beide garantiert denselben Inhalt haben. Der personalisierte
 * Satz ist ein eigener Absatz; fehlt er, faellt der Absatz weg.
 */
export function fpMailAbsaetze({ contactPerson, personalizedSentence }) {
  const satz = typeof personalizedSentence === 'string' ? personalizedSentence.trim() : '';
  return [
    `Hallo ${fpAnrede(contactPerson)},`,
    'stell dir vor: In unter 5 Minuten pro Woche das Google-Profil so pflegen, dass automatisch die lukrativeren Aufträge bei dir landen?',
    'Genau dafür gibt es WERKRUF.',
    'Viele Betriebe leisten top Arbeit, aber auf Google sieht man es nicht – unbeantwortete Bewertungen, veraltete Öffnungszeiten oder fehlende Bilder kosten jeden Monat echte Wunschkunden. WERKRUF übernimmt die Überwachung deines Google-Unternehmensprofils und schickt dir jeden Montag eine kurze Mail. Du liest vorformulierte Antworten oder Aufgaben kurz gegen, gibst frei – fertig. Kein Einloggen in komplexe Tools, keine Daueraufgabe.',
    ...(satz ? [satz] : []),
    'Warum ich dir schreibe: Ich suche aktuell 10 ausgewählte Handwerksbetriebe als Founding Partner, die WERKRUF im Alltag nutzen und mir kurz Rückmeldung geben, was hilft und was nervt.',
    'Als Founding Partner nutzt du WERKRUF dauerhaft 100 % kostenlos.',
    { text: 'In der Kurz-Präsentation siehst du auf 1 Blick, wie einfach das funktioniert:', link: 'presentation', linkText: 'Kurz-Präsentation ansehen' },
    { text: 'Klingt das grundsätzlich interessant? Eine kurze Antwort mit „Ja, Interesse“ reicht – die Einrichtung dauert knapp 10 Minuten.', link: 'cta', linkText: 'Ja, Interesse' },
    'Beste Grüße\nIver Bohnes',
  ];
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Rendert die Mail. Links kommen vom Server (opaque Token), nie aus
 * Lead-Feldern. Alles aus Lead-Feldern wird escaped — Plaintext und
 * HTML tragen denselben Inhalt.
 * @returns {{subject:string, text:string, html:string}}
 */
export function renderFpMail({ companyName, contactPerson, personalizedSentence, presentationUrl, ctaUrl }) {
  const betrieb = typeof companyName === 'string' && companyName.trim() ? companyName.trim() : 'euren Betrieb';
  const links = { presentation: presentationUrl, cta: ctaUrl };
  const absaetze = fpMailAbsaetze({ contactPerson, personalizedSentence });

  const text = absaetze.map((a) => {
    if (typeof a === 'string') return a;
    const url = links[a.link];
    return url ? `${a.text}\n${url}` : a.text;
  }).join('\n\n');

  const html = absaetze.map((a) => {
    if (typeof a === 'string') return `<p>${escapeHtml(a).replace(/\n/g, '<br>')}</p>`;
    const url = links[a.link];
    const t = `<p>${escapeHtml(a.text)}</p>`;
    if (!url) return t;
    if (a.link === 'cta') {
      return `${t}<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#0B2545;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(a.linkText)}</a></p>`;
    }
    return `${t}<p><a href="${escapeHtml(url)}">${escapeHtml(a.linkText)}</a></p>`;
  }).join('');

  return {
    subject: FP_MAIL_BETREFF(betrieb),
    text,
    html: `<!doctype html><html lang="de"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:620px;margin:0 auto;padding:24px">${html}</body></html>`,
  };
}

/* ── Token fuer Links: opaque, nicht erratbar, keine PII ── */
export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{32,64}$/;
export function istGueltigerToken(t) {
  return typeof t === 'string' && TOKEN_MUSTER.test(t);
}

/* ── KPI-Definitionen (Doku + UI, dieselbe Quelle) ── */
export const KPI_DEFINITION = Object.freeze({
  leads: 'Leads in der Akquise (acquisition_status gesetzt, nicht gelöscht)',
  angeschrieben: 'Leads mit mindestens einer gesendeten Mail',
  zugestellt: 'Leads mit mindestens einem delivered-Ereignis',
  oeffnungErkannt: 'Leads mit mindestens einem Open-Ereignis — nicht Anzahl Opens, kein Lesebeweis',
  interesse: 'Leads mit Vertriebsstatus interesse',
  foundingPartner: 'Leads mit Vertriebsstatus founding_partner',
});
