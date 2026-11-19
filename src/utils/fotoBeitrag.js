/*
 * Foto → Google-Beitrag (Vorschlag zum Freigeben) und „Per WhatsApp teilen".
 *
 * Geteilt zwischen Dashboard (Jest) und google-business (Deno). Keine
 * Netzwerkaufrufe hier — nur Regeln, Texte und Pruefungen.
 *
 * Grundsatz wie bei Saison-Beitraegen und Antwortvorschlaegen:
 * WERKRUF schlaegt vor, der Betrieb prueft, aendert und gibt frei.
 * Es wird nie etwas automatisch veroeffentlicht.
 */
import { BEITRAG_MAX_ZEICHEN, pruefeBeitragstext } from './saisonBeitraege.js';

export { BEITRAG_MAX_ZEICHEN };

export const NOTIZ_MAX_ZEICHEN = 200;
/* Ziel fuer den Vorschlag — kurz genug fuer die Vorschau bei Google. */
export const VORSCHLAG_MAX_ZEICHEN = 700;
/* KI-Vorschlaege je Konto und Tag (Kosten- und Missbrauchsbremse). */
export const VORSCHLAEGE_PRO_TAG = 20;
/* Das Modell antwortet genau damit, wenn auf dem Foto keine Arbeit erkennbar ist. */
export const UNKLAR = 'UNKLAR';

/* Nur Fotos, die ueber WERKRUF hochgeladen wurden (eigene Cloudinary-Ablage). */
export function bildUrlErlaubt(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' && /\/image\/upload\//.test(u.pathname);
  } catch {
    return false;
  }
}

/* Fuer Modell und Google: begrenzte Groesse, JPEG. Cloudinary rechnet um. */
export function bildFuerBeitrag(url) {
  if (!bildUrlErlaubt(url)) return null;
  return String(url).replace('/image/upload/', '/image/upload/w_1600,h_1600,c_limit,f_jpg,q_auto/');
}

export function pruefeNotiz(notiz) {
  const t = typeof notiz === 'string' ? notiz.replace(/\s+/g, ' ').trim() : '';
  if ([...t].length > NOTIZ_MAX_ZEICHEN) return { ok: false, grund: 'notiz_zu_lang' };
  return { ok: true, text: t };
}

/**
 * Anweisung an das Modell. Abgeschlossene Faktenliste: Betriebsname,
 * Gewerk/Kategorie, Notiz des Betriebs, das Foto. Alles andere ist
 * verboten — sonst erfindet jedes Modell Orte, Marken und Garantien.
 */
export function fotoBeitragSystem() {
  return [
    'Du schreibst einen kurzen Beitrag für das Google-Unternehmensprofil eines deutschen Handwerksbetriebs.',
    'Der Beitrag beschreibt eine erledigte Arbeit, die auf dem Foto zu sehen ist.',
    'Regeln:',
    '- Beschreibe nur, was auf dem Foto klar erkennbar ist oder in der Notiz des Betriebs steht. Erfinde nichts: keine Orte, Straßen, Marken, Kundennamen, Preise, Zeiträume, Garantien, Zertifikate oder Mengen.',
    '- Beschreibe keine Personen, Gesichter, Kennzeichen oder Hausnummern, auch wenn sie zu sehen sind.',
    '- Keine Superlative („der beste“), keine Rabatte, keine Versprechen, keine Telefonnummern, keine Links, keine Hashtags, keine Emojis.',
    '- Sachlich und freundlich, wie ein Meister, der kurz von seiner Arbeit erzählt. Erste Person Plural („wir“). Leser werden gesiezt, höchstens im letzten Satz (z. B. „Sprechen Sie uns gern an.“).',
    `- 2 bis 4 Sätze, höchstens ${VORSCHLAG_MAX_ZEICHEN} Zeichen.`,
    `- Ist auf dem Foto keine handwerkliche Arbeit erkennbar, antworte genau mit: ${UNKLAR}`,
    '- Gib nur den Beitragstext aus, ohne Überschrift, ohne Anführungszeichen, ohne Erklärung.',
  ].join('\n');
}

export function fotoBeitragAnfrage({ betrieb, gewerk, notiz }) {
  const zeilen = [`Betrieb: ${String(betrieb || 'unbekannt').slice(0, 120)}`];
  if (gewerk) zeilen.push(`Gewerk/Kategorie laut Google-Profil: ${String(gewerk).slice(0, 120)}`);
  zeilen.push(notiz ? `Notiz des Betriebs zum Foto: ${notiz}` : 'Keine Notiz — nur das Foto.');
  zeilen.push('Schreib den Beitrag.');
  return zeilen.join('\n');
}

const VERBOTEN = [
  { muster: /https?:\/\/|www\.|\.de\b|\.com\b/i, grund: 'link' },
  { muster: /(\+?\d[\d\s/()-]{6,}\d)/, grund: 'telefon' },
  { muster: /€|\beuro\b|\brabatt\b|\bprozent\b|%/i, grund: 'preis' },
  { muster: /#\w/, grund: 'hashtag' },
  { muster: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, grund: 'emoji' },
  { muster: /\bgarantie|\bgarantiert|\bder beste\b|\bdie beste\b|\bdas beste\b|\bnummer 1\b/i, grund: 'versprechen' },
];

/** Erster Verstoss gegen die Textregeln (Link, Telefon, Preis, Hashtag,
    Emoji, Versprechen) oder null. Geteilt mit der Website (website.js). */
export function verbotenerInhalt(text) {
  const t = String(text || '');
  for (const v of VERBOTEN) if (v.muster.test(t)) return v.grund;
  return null;
}

/**
 * Antwort des Modells pruefen. Liefert den bereinigten Vorschlag oder
 * einen Grund — dann bekommt der Nutzer keinen Text, sondern die
 * Bitte, selbst zu schreiben. Ein fragwuerdiger Vorschlag wird nie
 * „repariert".
 */
export function pruefeKiVorschlag(roh) {
  let t = typeof roh === 'string' ? roh.trim() : '';
  t = t.replace(/^["„“”']+|["„“”']+$/g, '').trim();
  if (!t) return { ok: false, grund: 'leer' };
  if (t.toUpperCase() === UNKLAR || t.toUpperCase().startsWith(`${UNKLAR}`)) return { ok: false, grund: 'unklar' };
  if ([...t].length > VORSCHLAG_MAX_ZEICHEN + 100) return { ok: false, grund: 'zu_lang' };
  const v = verbotenerInhalt(t);
  if (v) return { ok: false, grund: v };
  const p = pruefeBeitragstext(t);
  if (!p.ok) return { ok: false, grund: p.grund };
  return { ok: true, text: p.text };
}

export const FOTO_BEITRAG_TEXT = Object.freeze({
  unklar: 'Auf dem Foto ist keine Arbeit klar erkennbar. Schreib den Beitrag selbst oder nimm ein anderes Foto.',
  ungeeignet: 'Der Vorschlag passte nicht zu unseren Regeln (z. B. Preis, Link oder Versprechen). Schreib den Text selbst oder versuch es noch einmal.',
  notiz_zu_lang: `Die Notiz darf höchstens ${NOTIZ_MAX_ZEICHEN} Zeichen haben.`,
  limit: `Heute sind keine weiteren Vorschläge möglich (höchstens ${VORSCHLAEGE_PRO_TAG} am Tag). Du kannst den Text selbst schreiben.`,
  nicht_konfiguriert: 'Vorschläge sind gerade nicht verfügbar. Du kannst den Text selbst schreiben.',
  foto_fehlt: 'Dieses Foto wurde nicht gefunden.',
  bereits: 'Dieser Beitrag wurde bereits veröffentlicht.',
});

/* ── Per WhatsApp teilen ──
   Kein WhatsApp-Business-Konto, keine API, nichts geht ueber WERKRUF:
   Der Link oeffnet WhatsApp (App oder Web) mit vorbereitetem Text, der
   Betrieb waehlt den Kontakt und schickt selbst ab. */
export function whatsappBewertungsText({ betrieb, link }) {
  const name = String(betrieb || '').trim();
  return [
    'Guten Tag,',
    '',
    'vielen Dank für Ihren Auftrag! Wenn Sie zufrieden waren, freuen wir uns sehr über eine kurze Bewertung bei Google:',
    String(link || '').trim(),
    '',
    name ? `Viele Grüße\n${name}` : 'Viele Grüße',
  ].join('\n');
}

export function whatsappLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(String(text || ''))}`;
}
