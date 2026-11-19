/*
 * Akquise (WP16) — Vertriebsstatus, Founding-Partner-Mail, Ereignisse.
 *
 * Geteilt zwischen Jest, admin-ops (Vorschau), send-email (Rendern)
 * und dem Admin-Frontend. Reines JavaScript; einziger Import sind die
 * Anbieterangaben (Telefon in der Signatur), ebenfalls ohne Abhaengigkeiten.
 *
 * Zwei getrennte Welten, absichtlich:
 *   Vertriebsstatus  manuell, fachlich (AKQUISE_STATUS)
 *   Mail-Ereignisse  technisch, append-only (EREIGNIS_TEXT)
 * Nichts hier leitet das eine aus dem anderen ab.
 */

import { ANBIETER } from '../config/anbieter.js';

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
  /* WP17: Mail 1 verspricht „Nein" → keine weitere Nachricht. */
  antwort_negativ: 'Lead ist für weiteren Mailversand gesperrt: hat mit „Nein" bzw. ablehnend geantwortet.',
});

export const VERSAND_GRUND_TEXT = Object.freeze({
  gesperrt: 'Lead ist für weiteren Mailversand gesperrt.',
  laeuft_bereits: 'Für diesen Lead ist bereits ein Versand in Arbeit.',
  rate_limit: 'Schutzlimit erreicht: höchstens 20 Akquise-Mails pro Stunde.',
  kein_lead: 'Lead nicht gefunden.',
  keine_email: 'Der Lead hat keine gültige E-Mail-Adresse.',
  befund_fehlt: 'Kein Google-Befund hinterlegt. Ohne recherchierten Befund wird nicht gesendet — bitte erst unter „Google-Befund" eintragen und speichern.',
  befund_typ_fehlt: 'Kein Befund-Typ gewählt. Der Typ bestimmt, wie die Mail weitergeht — bitte unter „Befund-Typ" auswählen und speichern.',
  variante_fehlt: 'Betreff-Variante konnte nicht vergeben werden (Befund fehlt?).',
  bereits_angeschrieben: 'Dieser Lead hat bereits eine Akquise-Mail bekommen. Eine zweite Erstmail geht nicht raus — höchstens einmal „Nachfassen".',
  nachfass_nicht_moeglich: 'Nachfassen ist für diesen Lead nicht möglich.',
});

/* Warum „Nachfassen" (noch) nicht geht — dieselben Codes wie
   acquisition_followup_moeglich() in der Datenbank. */
export const NACHFASS_GRUND_TEXT = Object.freeze({
  kein_lead: 'Lead nicht gefunden.',
  gesperrt: 'Lead ist für weiteren Mailversand gesperrt.',
  antwort_erfasst: 'Es ist bereits eine Antwort erfasst.',
  bereits_nachgefasst: 'Es wurde bereits nachgefasst — nur einmal möglich.',
  keine_erstmail: 'Erst nach versendeter Erstmail (neue Vorlage) möglich.',
});

/* WP17.2 — Wann Nachfassen fällig ist. Die Datenbank rechnet das Datum
   (acquisition_followup_ab: 5 Werktage Mo–Fr nach Mail 1, Kalender
   Europe/Berlin, ohne Feiertage); hier nur Konstante + Anzeige.
   Nur Erinnerung — gesendet wird ausschließlich per Klick. */
export const NACHFASS_WARTE_WERKTAGE = 5;
export const FILTER_NACHFASSEN_FAELLIG = 'nachfassen_faellig';

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** '2026-11-26' → 'Do, 26.11.' (reines Datum, keine Zeitzonen-Verschiebung). */
export function fmtFaelligAb(datum) {
  const m = typeof datum === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(datum) : null;
  if (!m) return null;
  const tag = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${WOCHENTAGE[tag]}, ${m[3]}.${m[2]}.`;
}

/* ── E-Mail ── */
export const EMAIL_MUSTER = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalisiereEmail(roh) {
  if (typeof roh !== 'string') return null;
  const t = roh.trim().toLowerCase();
  return EMAIL_MUSTER.test(t) && t.length <= 254 ? t : null;
}

/* ── Lead-Eingabe (Admin) — Pflicht: company_name, email ── */
export const LEAD_FELDER = Object.freeze(['company_name', 'contact_person', 'phone', 'trade', 'city', 'email', 'website', 'google_profile_url', 'personalized_sentence', 'google_profile_finding', 'finding_type', 'note']);
const LAENGEN = Object.freeze({ company_name: 200, contact_person: 120, phone: 40, trade: 80, city: 120, website: 300, google_profile_url: 500, personalized_sentence: 600, google_profile_finding: 600, note: 4000 });

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
    if (f === 'finding_type') {
      /* WP17.1: Schluessel, Nummer 1–5 oder Bezeichnung → Schluessel */
      if (!t) { werte.finding_type = null; continue; }
      const typ = normalisiereBefundTyp(t);
      if (!typ) return { ok: false, fehler: `Befund-Typ unbekannt: ${t.slice(0, 40)} (erlaubt: 1–5 oder ${BEFUND_TYP_SCHLUESSEL.join(', ')})` };
      werte.finding_type = typ;
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

/* ── Die Founding-Partner-Mail (WP16) ──
   Seit WP17 (18.11.2026) nicht mehr fuer neue Erstkontakte. Bleibt, damit
   bereits eingereihte Mails dieser Vorlage noch korrekt rausgehen und die
   Historie lesbar bleibt. */
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
  /* Positionierung 12.11.2026 (nach Reddit-Validierung): Empfehlung
     zuerst, der persoenliche Befund direkt danach, das Produkt knapp
     und nur mit dem, was es wirklich tut (Wochenmail kommt jeden
     Montag — auch in ruhigen Wochen, dann mit „Alles geprueft").
     Gestrichen: „automatisch lukrativere Auftraege", „Ueberwachung",
     Zeitversprechen. */
  return [
    `Hallo ${fpAnrede(contactPerson)},`,
    'viele Handwerksbetriebe leben vor allem von Empfehlungen. Wer einen Betrieb empfohlen bekommt, schaut aber häufig trotzdem kurz bei Google – und dort sollte der Auftritt zum guten Ruf passen.',
    ...(satz ? [satz] : []),
    'Genau dafür habe ich WERKRUF gebaut: Es behält deine Bewertungen und dein Google-Unternehmensprofil im Blick und bereitet Antworten vor, die du nur noch freigibst. Bei einer schlechten Bewertung meldet es sich sofort, sonst kommt montags eine kurze Mail mit dem, was konkret zu tun ist.',
    'Ich suche gerade 10 Handwerksbetriebe als Founding Partner, die WERKRUF im Alltag nutzen und mir ehrlich sagen, was hilft und was nervt.',
    'Dafür bleibt WERKRUF für euch dauerhaft kostenlos.',
    { text: 'Wie das aussieht, zeigt die Kurz-Präsentation:', link: 'presentation', linkText: 'Kurz-Präsentation ansehen' },
    { text: 'Wenn das grundsätzlich interessant klingt:', link: 'cta', linkText: 'Ja, Interesse' },
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

/* ═══════════════════════════════════════════════════════════════
   WP17 — Outreach „Antwort zuerst" (18.11.2026)
   WP17.1 (19.11.2026): Du-Form, „Moin", fuenf Befund-Typen.

   Mail 1: ein echter, vorher von Hand recherchierter Google-Befund,
   danach je Typ eine Bruecke und EIN Satz, was WERKRUF dabei macht
   (Werkzeug, keine Agentur-Leistung). Einladung: kostenlos nutzen gegen
   ehrliches Feedback. Einzige Handlung: per Mail antworten. Kein Link,
   kein Button.

   Jede Werkzeug-Aussage hat ihr Gegenstueck im Code (Feature-Truth,
   src/akquiseAntwortZuerst.test.js):
     taeglich pruefen   engine 04:30 (docs/operations), wochenstatus.js
     Antwortvorschlag   DashboardBewertungen „Antwort vorschlagen" (Knopfdruck, Freigabe)
     sofort melden      critical_review_alert (1–2 Sterne)
     Link/QR/SMS        DashboardKundenGewinnung, SmsBewertungsanfrage
     direkt eintragen   Profilbearbeitung → locations.patch
   ═══════════════════════════════════════════════════════════════ */

export const BETREFF_VARIANTEN = Object.freeze(['A', 'B']);

/* Reihenfolge = Anzeige im Admin. Schluessel = leads.finding_type. */
export const BEFUND_TYPEN = Object.freeze({
  starkes_profil: Object.freeze({
    nr: 1,
    label: 'Starkes Profil',
    hinweis: 'Viele gute Bewertungen, aber woanders sichtbare Lücken. Nur wählen, wenn du wirklich eine Lücke gesehen hast.',
    beispiel: '80 Bewertungen mit 5,0 Sternen – richtig stark.',
    bruecke: 'Wer dich empfohlen bekommt, schaut danach aber auch auf den Rest: Öffnungszeiten, Fotos, aktuelle Angaben. Da ist mir noch das eine oder andere aufgefallen.',
    werkzeug: 'WERKRUF prüft dein Profil täglich und sagt dir, was als Nächstes dran ist: Öffnungszeiten, Fotos, Angaben.',
    betreffA: 'Deine Google-Bewertungen',
  }),
  unbeantwortet: Object.freeze({
    nr: 2,
    label: 'Unbeantwortete Bewertungen',
    hinweis: 'Mehrere Bewertungen ohne Antwort des Betriebs.',
    beispiel: 'Auf die letzten fünf Bewertungen gibt es keine Antwort.',
    bruecke: 'Genau das lesen die Leute, die dich empfohlen bekommen und vorher kurz nachschauen. Eine kurze Antwort zeigt ihnen, dass sich jemand kümmert.',
    werkzeug: 'WERKRUF schreibt dir zu jeder Bewertung auf Knopfdruck einen Antwortvorschlag. Du prüfst, änderst und gibst frei.',
    betreffA: 'Deine Google-Bewertungen',
  }),
  kritisch_offen: Object.freeze({
    nr: 3,
    label: 'Kritische Bewertung ohne Antwort',
    hinweis: 'Eine 1- bis 3-Sterne-Bewertung ohne Antwort.',
    beispiel: 'Auf die 2-Sterne-Bewertung vom September gibt es noch keine Antwort.',
    bruecke: 'Gerade kritische Bewertungen ohne Antwort fallen Lesern auf. Eine ruhige, sachliche Antwort nimmt viel davon raus.',
    werkzeug: 'WERKRUF meldet dir schlechte Bewertungen sofort und schreibt dir auf Knopfdruck einen sachlichen Antwortvorschlag, den du freigibst.',
    betreffA: 'Deine Google-Bewertungen',
  }),
  wenige_bewertungen: Object.freeze({
    nr: 4,
    label: 'Wenige oder alte Bewertungen',
    hinweis: 'Wenige Bewertungen oder die letzte liegt lange zurück.',
    beispiel: 'Du hast 7 Bewertungen, die letzte ist von März.',
    bruecke: 'Wer dich nicht kennt, sieht zuerst Zahl und Datum – und denkt schnell, es sei wenig los, obwohl das Gegenteil stimmt.',
    werkzeug: 'Mit WERKRUF bittest du zufriedene Kunden per Link, QR-Code oder SMS um eine Bewertung, in ein paar Sekunden.',
    betreffA: 'Deine Google-Bewertungen',
  }),
  profil_luecke: Object.freeze({
    nr: 5,
    label: 'Lücken im Profil',
    hinweis: 'Öffnungszeiten, Website, Fotos oder Kategorie fehlen oder sind veraltet.',
    beispiel: 'Es sind keine Öffnungszeiten hinterlegt.',
    bruecke: 'Solche Lücken fallen genau den Leuten auf, die dich empfohlen bekommen und vorher kurz nachschauen.',
    werkzeug: 'WERKRUF prüft dein Profil täglich, zeigt dir Lücken wie diese, und du trägst sie gleich dort ein – die Änderung geht direkt an Google.',
    betreffA: 'Dein Google-Profil',
  }),
});
export const BEFUND_TYP_SCHLUESSEL = Object.freeze(Object.keys(BEFUND_TYPEN));

/** CSV/Formular: Schluessel, Nummer 1–5 oder Bezeichnung → Schluessel; sonst null. */
export function normalisiereBefundTyp(wert) {
  if (wert === null || wert === undefined) return null;
  const roh = String(wert).trim().toLowerCase();
  if (!roh) return null;
  for (const [k, t] of Object.entries(BEFUND_TYPEN)) {
    if (roh === k || roh === String(t.nr) || roh === t.label.toLowerCase()) return k;
  }
  return null;
}

/** Betreff je Variante (und bei A je Befund-Typ). Die Variante wird einmal vergeben (DB) und nie geaendert. */
export function betreffFuerVariante(variante, findingType) {
  if (variante === 'B') return 'Kurze Frage zu deinem Google-Profil';
  if (variante === 'A') {
    const t = BEFUND_TYPEN[findingType];
    if (!t) throw new Error('Unbekannter Befund-Typ');
    return t.betreffA;
  }
  throw new Error('Unbekannte Betreff-Variante');
}

/**
 * „Moin Alexander," — Du-Form, nur der Vorname. Steht „Herr"/„Frau"
 * davor (passt nicht zum Du) oder fehlt der Name: neutral „Moin,".
 */
export function anredeMoin(contactPerson) {
  const n = typeof contactPerson === 'string' ? contactPerson.trim() : '';
  if (!n || n === '-') return 'Moin,';
  const vorname = n.split(/\s+/)[0];
  if (/^(herr|frau|hr\.?|fr\.?|dr\.?|familie)$/i.test(vorname)) return 'Moin,';
  return `Moin ${vorname},`;
}

export const ABSENDER_NAME = 'Iver Bohnes';

/** Befund: von Hand recherchiert, gespeichert; nie erzeugt. Leer → kein Versand. */
export function befundGueltig(befund) {
  return typeof befund === 'string' && befund.trim().length >= 10 && befund.trim().length <= 600;
}

const EINLADUNG = 'Ich suche gerade zehn Betriebe, die es kostenlos nutzen und mir ehrlich sagen, was noch fehlt. Hast du Lust? Ein kurzes „Ja“ reicht, dann schicke ich dir alles Weitere.';
const signatur = (telefon) => ['Beste Grüße aus Hamburg', 'Iver Bohnes', `WERKRUF${telefon ? ` · ${telefon}` : ''}`].join('\n');
const ABMELDUNG = 'Falls du keine weitere Nachricht willst, antworte einfach mit „Nein“.';

/**
 * Mail 1 als Absaetze (Text und HTML werden daraus gebaut).
 * @param {{contactPerson?:any, finding:any, findingType:any, telefon?:string|null}} p
 */
export function erstkontaktAbsaetze({ contactPerson, finding, findingType, telefon = ANBIETER.telefon }) {
  if (!befundGueltig(finding)) throw new Error('Google-Befund fehlt');
  const typ = BEFUND_TYPEN[findingType];
  if (!typ) throw new Error('Befund-Typ fehlt');
  return [
    anredeMoin(contactPerson),
    `ich bin gerade über dein Google-Profil gestolpert. Dabei ist mir aufgefallen: ${finding.trim()}`,
    typ.bruecke,
    `Ich bin Iver aus Hamburg und baue gerade WERKRUF, ein kleines Werkzeug für Handwerksbetriebe. ${typ.werkzeug}`,
    EINLADUNG,
    signatur(telefon),
    ABMELDUNG,
  ];
}

export function nachfassAbsaetze({ contactPerson }) {
  return [
    anredeMoin(contactPerson),
    'kurz nachgehakt: Hast du Lust, WERKRUF kostenlos auszuprobieren? Ein „Ja“ reicht.',
    'Beste Grüße\nIver',
  ];
}

/* Wie eine normale persoenliche Mail: kein Layout, keine Farben, keine
   Links. Das minimale HTML existiert nur, weil Brevo die Oeffnung ueber
   ein Pixel im HTML erkennt (Open-Tracking bleibt). */
function persoenlichesHtml(absaetze, zitat) {
  const p = absaetze.map((a) => `<p style="margin:0 0 14px">${escapeHtml(a).replace(/\n/g, '<br>')}</p>`).join('');
  const z = zitat
    ? `<div style="margin-top:18px;color:#555">${escapeHtml(zitat.kopf)}</div><blockquote style="margin:6px 0 0;padding:0 0 0 10px;border-left:2px solid #ccc;color:#555">${zitat.absaetze.map((a) => `<p style="margin:0 0 12px">${escapeHtml(a).replace(/\n/g, '<br>')}</p>`).join('')}</blockquote>`
    : '';
  return `<!doctype html><html lang="de"><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:0;padding:12px">${p}${z}</body></html>`;
}

/**
 * Rendert Mail 1. Betreff aus der gespeicherten Variante (A je Befund-Typ).
 * companyName wird nicht mehr gebraucht (Betreff B ohne Betriebsnamen),
 * bleibt aber als Parameter fuer bestehende Aufrufer erlaubt.
 * @param {{companyName?:any, contactPerson?:any, finding:any, findingType:any, variante:any, telefon?:string|null}} p
 * @returns {{subject:string, text:string, html:string, senderName:string}}
 */
export function renderErstkontakt({ contactPerson, finding, findingType, variante, telefon }) {
  const subject = betreffFuerVariante(variante, findingType);
  const absaetze = erstkontaktAbsaetze({ contactPerson, finding, findingType, ...(telefon !== undefined ? { telefon } : {}) });
  return { subject, text: absaetze.join('\n\n'), html: persoenlichesHtml(absaetze), senderName: ABSENDER_NAME };
}

/** dd.mm.yyyy in Europe/Berlin */
export function datumDe(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/**
 * Nachfass-Mail: gleicher Betreff wie Mail 1, darunter die Erstmail als
 * Zitat (der beim Versand gespeicherte Text). Echte Thread-Header
 * (In-Reply-To/References) setzt Brevo nicht.
 * @param {{contactPerson?:any, subject:any, originalText?:any, originalSentAt?:string}} p
 */
export function renderNachfass({ contactPerson, subject, originalText, originalSentAt }) {
  if (typeof subject !== 'string' || !subject.trim()) throw new Error('Betreff der Erstmail fehlt');
  const absaetze = nachfassAbsaetze({ contactPerson });
  const datum = originalSentAt ? datumDe(originalSentAt) : '';
  const kopf = `${datum ? `Am ${datum} schrieb` : 'Ursprüngliche Nachricht von'} Iver Bohnes:`;
  const original = typeof originalText === 'string' ? originalText.trim() : '';
  const zitatText = original ? `\n\n${kopf}\n${original.split('\n').map((z) => `> ${z}`).join('\n')}` : '';
  return {
    subject: subject.trim(),
    text: absaetze.join('\n\n') + zitatText,
    html: persoenlichesHtml(absaetze, original ? { kopf, absaetze: original.split('\n\n') } : null),
    senderName: ABSENDER_NAME,
  };
}

/* Antwort erfassen — dieselben Werte wie leads.reply_classification. */
export const ANTWORT_KLASSEN = Object.freeze(['positiv', 'negativ', 'sonstige']);
export const ANTWORT_TEXT = Object.freeze({
  positiv: 'Positiv / „Ja"',
  negativ: 'Negativ / kein Interesse',
  sonstige: 'Sonstige Antwort',
});
export const ANTWORT_WIRKUNG = Object.freeze({
  positiv: 'Antwort erhalten + Interesse.',
  negativ: 'Antwort erhalten, kein Interesse. Der Lead wird für weitere Mails gesperrt (er hat „Nein" gesagt).',
  sonstige: 'Antwort erhalten. Status bleibt, wie er ist (z. B. Rückfrage „Wer bist du?").',
});

/*
 * Vorlage fuer die persoenliche Antwort auf ein „Ja". Wird NIE automatisch
 * erzeugt oder versendet. Kein „ueberwacht …/meldet sich nur, wenn …"
 * (Wochenmail kommt jeden Montag; „Ueberwachung" seit #67 raus).
 * Founding Partner setzt Iver nach der Registrierung unter Kunden.
 */
export const ANTWORT_VORLAGE_POSITIV = [
  'Moin {Vorname},',
  'super, freut mich!',
  'Kurz zum Ablauf: Du bist einer von zehn Founding Partnern. Damit nutzt du WERKRUF dauerhaft kostenlos, und ich frage dich ab und zu, was fehlt oder nervt.',
  'Anmelden kannst du dich hier: https://werkruf.com/signup – danach verbindest du dein Google-Profil, und ich schalte dich als Founding Partner frei.',
  'Wenn du magst, richten wir es auch zusammen am Telefon ein. Das dauert ungefähr 15 Minuten.',
  'Beste Grüße aus Hamburg\nIver',
].join('\n\n');

/** Quoten fuer den Funnel. null = nicht berechenbar (Nenner 0). */
export function akquiseQuoten(kpi = {}) {
  const q = (z, n) => (Number(n) > 0 ? Math.round((Number(z) / Number(n)) * 1000) / 10 : null);
  return {
    zustellRate: q(kpi.zugestellt, kpi.angeschrieben),
    oeffnungsRate: q(kpi.oeffnungErkannt, kpi.zugestellt),
    antwortRate: q(kpi.antworten, kpi.zugestellt),
    positivRate: q(kpi.interesse, kpi.zugestellt),
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
  oeffnungErkannt: 'Leads mit mindestens einem Open-Ereignis — nicht Anzahl Opens, kein Lesebeweis. Keine erkannte Öffnung heißt nicht „nicht gelesen" (Bilder blockiert, Datenschutz-Proxys).',
  antworten: 'Leads mit erfasster Antwort (positiv, negativ oder sonstige) — von Hand erfasst, WERKRUF liest das Postfach nicht',
  antwortenPositiv: 'Leads mit Antwort „positiv"',
  interesse: 'Leads mit Vertriebsstatus interesse',
  foundingPartner: 'Leads mit Vertriebsstatus founding_partner',
  nachfassenFaellig: 'Mail 1 vor mindestens 5 Werktagen gesendet, keine Antwort erfasst, noch nicht nachgefasst, nicht gesperrt — nur Erinnerung, gesendet wird per Klick',
});
