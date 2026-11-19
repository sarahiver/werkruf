/*
 * Website aus dem Google-Profil.
 *
 * Geteilt zwischen Dashboard (Jest, Vorschau), Edge Function `website`
 * (Deno) und Tests. Keine Netzwerkaufrufe hier — nur Regeln, Texte und
 * die Vorlage, die aus einem Modell eine HTML-Seite macht.
 *
 * Grundsaetze:
 *  - EINE Vorlage. Der Betrieb waehlt Farbe, Logo, Titelbild, welche
 *    Leistungen und Fotos erscheinen, und prueft die Texte. Layout,
 *    Seitenaufbau, Schriften und SEO-Technik legt WERKRUF fest.
 *  - Stammdaten (Name, Telefon, Adresse, Oeffnungszeiten, Bewertungen,
 *    Fotos) kommen bei jedem Aufruf frisch aus WERKRUF — die Seite
 *    aktualisiert sich mit dem Google-Profil.
 *  - Keine Cookies, kein Tracking, keine externen Schriften, keine
 *    eingebettete Karte. Darum kann die Datenschutzerklaerung fest sein.
 *  - Texte schlaegt die KI vor; veroeffentlicht wird nur, was der
 *    Betrieb gesehen und gespeichert hat.
 */
import { bildUrlErlaubt, verbotenerInhalt } from './fotoBeitrag.js';

/* ── Farben ──
   Sechs Vorgaben. Jede ist auf weissem Grund lesbar (Text auf Primaer
   ist weiss, Kontrast >= 4.5:1). Keine freie Farbwahl: Eine freie Farbe
   heisst unlesbare Knoepfe. Auch die Akzentfarbe traegt weisse
   Schrift (Anruf-Knopf) und liegt deshalb bei >= 4.5:1 — geprueft in
   website.test.js. */
export const WEBSITE_FARBEN = Object.freeze({
  marine:    { label: 'Marine',     primaer: '#0B3557', akzent: '#C2410C' },
  waldgruen: { label: 'Waldgrün',   primaer: '#1F4D3A', akzent: '#A16207' },
  ziegel:    { label: 'Ziegelrot',  primaer: '#8E2A1E', akzent: '#2F3E4C' },
  anthrazit: { label: 'Anthrazit',  primaer: '#2B2F33', akzent: '#B93E0E' },
  petrol:    { label: 'Petrol',     primaer: '#0E5160', akzent: '#B45309' },
  holz:      { label: 'Holz',       primaer: '#5A3A22', akzent: '#3F7D58' },
});
export const STANDARD_FARBE = 'marine';

export const GRENZEN = Object.freeze({
  slogan: 140,
  ueber: 1200,
  leistungName: 60,
  leistungText: 500,
  leistungen: 12,
  email: 120,
  impressumFeld: 160,
  bewertungen: 6,
  fotos: 12,
});

/* ── Slug ── werkruf.com/seite/<slug> */
const UMLAUTE = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };
export function slugAus(text) {
  const s = String(text || '')
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTE[c])
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, '-und-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : '';
}
const SLUG_RESERVIERT = new Set(['beispiel', 'admin', 'api', 'dashboard', 'werkruf', 'hilfe', 'login', 'impressum', 'datenschutz', 'seite', 'test']);
export function slugGueltig(s) {
  return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(s) && !/--/.test(s) && !SLUG_RESERVIERT.has(s);
}

/* ── Hilfen ── */
const sauber = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const absatz = (v, max) => (typeof v === 'string'
  ? v.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
export const emailGueltig = (e) => typeof e === 'string' && e.length <= GRENZEN.email && EMAIL_RE.test(e.trim());

/** Cloudinary-Bild aus dem eigenen Upload-Ordner des Nutzers. */
export function eigenesBild(url, userId) {
  if (!bildUrlErlaubt(url) || !userId) return false;
  try { return new URL(url).pathname.includes(`/werkruf/profiles/${userId}/`); } catch { return false; }
}

export function bildGroesse(url, breite) {
  if (!bildUrlErlaubt(url)) return null;
  return String(url).replace('/image/upload/', `/image/upload/w_${breite},c_limit,f_auto,q_auto/`);
}

/* ── Impressum ──
   Pflichtangaben nach § 5 DDG fuer einen Handwerksbetrieb. Formular statt
   Upload: Pflichtfelder lassen sich pruefen, eine Datei nicht. Die
   Angaben macht der Betrieb; WERKRUF setzt sie nur in die Vorlage. */
export const RECHTSFORMEN = Object.freeze({
  einzelunternehmen: { label: 'Einzelunternehmen', register: false, vertretung: false },
  ek:                { label: 'e. K.',               register: true,  vertretung: false },
  gbr:               { label: 'GbR',                  register: false, vertretung: true },
  gmbh:              { label: 'GmbH',                 register: true,  vertretung: true },
  ug:                { label: 'UG (haftungsbeschränkt)', register: true, vertretung: true },
  gmbh_co_kg:        { label: 'GmbH & Co. KG',        register: true,  vertretung: true },
  ohg:               { label: 'OHG',                  register: true,  vertretung: true },
  kg:                { label: 'KG',                   register: true,  vertretung: true },
});

export const IMPRESSUM_FELDER = Object.freeze([
  { key: 'firma',             label: 'Name des Betriebs (wie im Register / Gewerbe)' },
  { key: 'rechtsform',        label: 'Rechtsform' },
  { key: 'inhaber',           label: 'Inhaber/in (Vor- und Nachname)' },
  { key: 'vertreten_durch',   label: 'Vertreten durch (Geschäftsführer/in bzw. Gesellschafter/innen)' },
  { key: 'strasse',           label: 'Straße und Hausnummer' },
  { key: 'plz',               label: 'PLZ' },
  { key: 'ort',               label: 'Ort' },
  { key: 'telefon',           label: 'Telefon' },
  { key: 'email',             label: 'E-Mail' },
  { key: 'registergericht',   label: 'Registergericht (z. B. Amtsgericht Hamburg)' },
  { key: 'registernummer',    label: 'Registernummer (z. B. HRB 12345)' },
  { key: 'ustid',             label: 'USt-IdNr. (falls vorhanden)' },
  { key: 'kammer',            label: 'Zuständige Kammer (z. B. Handwerkskammer Hamburg)' },
  { key: 'berufsbezeichnung', label: 'Berufsbezeichnung (z. B. Elektrotechnikermeister, verliehen in Deutschland)' },
]);

export function pruefeImpressum(eingabe) {
  const e = eingabe && typeof eingabe === 'object' ? eingabe : {};
  const w = {};
  for (const f of IMPRESSUM_FELDER) w[f.key] = sauber(e[f.key], GRENZEN.impressumFeld);
  if (!RECHTSFORMEN[w.rechtsform]) w.rechtsform = '';
  w.ustid = w.ustid.replace(/\s+/g, '').toUpperCase();

  const fehlend = [];
  const pflicht = ['firma', 'rechtsform', 'strasse', 'plz', 'ort', 'telefon', 'email', 'kammer'];
  for (const k of pflicht) if (!w[k]) fehlend.push(k);
  const rf = RECHTSFORMEN[w.rechtsform];
  if (rf && !rf.vertretung && !w.inhaber) fehlend.push('inhaber');
  if (rf?.vertretung && !w.vertreten_durch) fehlend.push('vertreten_durch');
  if (rf?.register) {
    if (!w.registergericht) fehlend.push('registergericht');
    if (!w.registernummer) fehlend.push('registernummer');
  }
  const fehler = [];
  if (w.email && !emailGueltig(w.email)) fehler.push('email');
  if (w.plz && !/^\d{5}$/.test(w.plz)) fehler.push('plz');
  if (w.ustid && !/^DE\d{9}$/.test(w.ustid)) fehler.push('ustid');
  if (w.telefon && (w.telefon.replace(/\D/g, '').length < 6)) fehler.push('telefon');
  return { ok: fehlend.length === 0 && fehler.length === 0, fehlend, fehler, werte: w };
}

/* ── Eingaben aus dem Editor ──
   Der Client schickt nur diese Felder. Bilder als IDs bzw. nur aus dem
   eigenen Ordner; Texte gekuerzt und auf verbotene Inhalte geprueft. */
export function pruefeWebsiteEingabe(eingabe, { userId, fotoIds = [] } = {}) {
  const e = eingabe && typeof eingabe === 'object' ? eingabe : {};
  const w = {};
  w.farbe = WEBSITE_FARBEN[e.farbe] ? e.farbe : STANDARD_FARBE;
  w.stil = WEBSITE_STILE[e.stil] ? e.stil : STANDARD_STIL;
  w.slogan = sauber(e.slogan, GRENZEN.slogan);
  w.ueber_text = absatz(e.ueber_text, GRENZEN.ueber);
  w.kontakt_email = sauber(e.kontakt_email, GRENZEN.email);
  if (w.kontakt_email && !emailGueltig(w.kontakt_email)) return { ok: false, grund: 'email', feld: 'kontakt_email' };

  w.logo_url = typeof e.logo_url === 'string' && e.logo_url ? e.logo_url : null;
  if (w.logo_url && !eigenesBild(w.logo_url, userId)) return { ok: false, grund: 'bild', feld: 'logo_url' };

  const ids = new Set(fotoIds);
  w.titelbild_id = typeof e.titelbild_id === 'string' && ids.has(e.titelbild_id) ? e.titelbild_id : null;
  w.fotos_aus = Array.isArray(e.fotos_aus) ? [...new Set(e.fotos_aus.filter((id) => ids.has(id)))] : [];
  w.bewertungen_zeigen = e.bewertungen_zeigen !== false;

  const roh = Array.isArray(e.leistungen) ? e.leistungen : [];
  w.leistungen = roh.slice(0, GRENZEN.leistungen)
    .map((l) => ({ name: sauber(l?.name, GRENZEN.leistungName), text: absatz(l?.text, GRENZEN.leistungText) }))
    .filter((l) => l.name);

  for (const [feld, t] of [['slogan', w.slogan], ['ueber_text', w.ueber_text], ...w.leistungen.map((l, i) => [`leistungen.${i}`, `${l.name} ${l.text}`])]) {
    const v = verbotenerInhalt(t);
    if (v) return { ok: false, grund: v, feld };
  }
  w.impressum = pruefeImpressum(e.impressum).werte;
  return { ok: true, werte: w };
}

export const WEBSITE_GRUND_TEXT = Object.freeze({
  email: 'Die E-Mail-Adresse sieht nicht gültig aus.',
  bild: 'Dieses Bild stammt nicht aus deinen Uploads.',
  link: 'Bitte keine Links im Text — die Seite verlinkt Telefon und E-Mail selbst.',
  telefon: 'Bitte keine Telefonnummern im Text — die Nummer steht automatisch im Kontaktbereich.',
  preis: 'Bitte keine Preise oder Rabatte im Text.',
  hashtag: 'Bitte keine Hashtags.',
  emoji: 'Bitte keine Emojis.',
  versprechen: 'Bitte keine Garantie- oder „der Beste"-Versprechen.',
  impressum: 'Das Impressum ist noch nicht vollständig.',
  slug: 'Diese Adresse ist nicht möglich oder schon vergeben.',
  kein_zugang: 'Die Website gibt es mit WERKRUF Pro.',
  limit: 'Heute sind keine weiteren Vorschläge möglich. Du kannst die Texte selbst schreiben.',
  nicht_konfiguriert: 'Vorschläge sind gerade nicht verfügbar. Du kannst die Texte selbst schreiben.',
  ungeeignet: 'Der Vorschlag passte nicht zu unseren Regeln. Schreib die Texte selbst oder versuch es noch einmal.',
});

/* ── Daten aus dem Google-Profil ── */
export function leistungenAusProfil(profil) {
  const items = Array.isArray(profil?.serviceItems) ? profil.serviceItems : [];
  const namen = [];
  for (const it of items) {
    const ff = it?.freeFormServiceItem;
    const name = sauber(ff?.label?.displayName, GRENZEN.leistungName);
    if (name && !namen.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      namen.push({ name, text: absatz(ff?.label?.description, GRENZEN.leistungText) });
    }
  }
  return namen.slice(0, GRENZEN.leistungen);
}

export function gewerkAus(location, profil) {
  const anzeige = profil?.categories?.primaryCategory?.displayName;
  if (typeof anzeige === 'string' && anzeige.trim()) return anzeige.trim();
  const roh = String(location?.primary_category || '').replace(/^gcid:/, '').replace(/_/g, ' ').trim();
  return roh ? roh.charAt(0).toUpperCase() + roh.slice(1) : '';
}

const TAGE = [
  ['MONDAY', 'Montag'], ['TUESDAY', 'Dienstag'], ['WEDNESDAY', 'Mittwoch'], ['THURSDAY', 'Donnerstag'],
  ['FRIDAY', 'Freitag'], ['SATURDAY', 'Samstag'], ['SUNDAY', 'Sonntag'],
];
const uhr = (t) => {
  if (!t || typeof t !== 'object') return '00:00';
  const h = Number.isInteger(t.hours) ? t.hours : 0;
  const m = Number.isInteger(t.minutes) ? t.minutes : 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
export function oeffnungszeitenAus(profil) {
  const perioden = Array.isArray(profil?.regularHours?.periods) ? profil.regularHours.periods : [];
  if (perioden.length === 0) return [];
  return TAGE.map(([key, name]) => {
    const z = perioden.filter((p) => p?.openDay === key)
      .sort((a, b) => uhr(a.openTime).localeCompare(uhr(b.openTime)))
      .map((p) => (uhr(p.openTime) === '00:00' && (uhr(p.closeTime) === '24:00' || uhr(p.closeTime) === '00:00') ? 'durchgehend' : `${uhr(p.openTime)}–${uhr(p.closeTime) === '24:00' ? '24:00' : uhr(p.closeTime)}`));
    return { tag: name, zeiten: z.length ? z.join(', ') : 'geschlossen' };
  });
}

export function adresseAus(location, profil) {
  const a = profil?.storefrontAddress;
  if (a && Array.isArray(a.addressLines) && a.addressLines.length && a.locality) {
    return { strasse: a.addressLines.join(', '), plz: a.postalCode || '', ort: a.locality };
  }
  return null;
}

export function einzugsgebietAus(profil) {
  const orte = profil?.serviceArea?.places?.placeInfos;
  return Array.isArray(orte) ? orte.map((p) => sauber(p?.placeName, 80)).filter(Boolean).slice(0, 12) : [];
}

/** „Anna M." — Vorname plus Initial, nie der volle Name. */
export function kurzName(name, anonym) {
  if (anonym) return 'Google-Nutzer';
  const teile = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return 'Google-Nutzer';
  return teile.length === 1 ? teile[0] : `${teile[0]} ${teile[teile.length - 1].charAt(0)}.`;
}

/* ── Startwerte ──
   Was ein Betrieb ohne eigene Eingaben sieht: alles aus dem Profil. */
export function startWerte({ location, profil }) {
  const adr = adresseAus(location, profil);
  return {
    farbe: STANDARD_FARBE,
    stil: STANDARD_STIL,
    slogan: '',
    ueber_text: absatz(profil?.profile?.description, GRENZEN.ueber),
    leistungen: leistungenAusProfil(profil),
    kontakt_email: '',
    logo_url: null,
    titelbild_id: null,
    fotos_aus: [],
    bewertungen_zeigen: true,
    impressum: {
      firma: sauber(location?.title, GRENZEN.impressumFeld),
      telefon: sauber(location?.primary_phone, GRENZEN.impressumFeld),
      ...(adr ? { strasse: adr.strasse, plz: adr.plz, ort: adr.ort } : {}),
    },
  };
}

/**
 * Oeffentliches Modell — nur, was auf der Seite stehen darf.
 * fotos: [{id, url}] aus business_photos; bewertungen aus google_reviews.
 */
export function baueModell({ location, website, fotos = [], bewertungen = [] }) {
  const profil = location?.google_profile || {};
  const w = website || {};
  const farbe = WEBSITE_FARBEN[w.farbe] || WEBSITE_FARBEN[STANDARD_FARBE];
  const name = sauber(location?.title, 120) || sauber(w.impressum?.firma, 120) || 'Unser Betrieb';
  const adr = adresseAus(location, profil);
  const aus = new Set(Array.isArray(w.fotos_aus) ? w.fotos_aus : []);
  const sichtbar = fotos.filter((f) => f && bildUrlErlaubt(f.url) && !aus.has(f.id));
  const titel = fotos.find((f) => f && f.id === w.titelbild_id && bildUrlErlaubt(f.url)) || sichtbar[0] || null;
  const rating = Number(location?.average_rating);
  const anzahl = Number(location?.review_count) || 0;
  return {
    name,
    stil: WEBSITE_STILE[w.stil] ? w.stil : STANDARD_STIL,
    gewerk: gewerkAus(location, profil),
    ort: adr?.ort || sauber(location?.locality, 80),
    adresse: adr,
    telefon: sauber(location?.primary_phone, 40),
    email: emailGueltig(w.kontakt_email) ? w.kontakt_email.trim() : (emailGueltig(w.impressum?.email) ? w.impressum.email.trim() : ''),
    farbe,
    logo: w.logo_url && bildUrlErlaubt(w.logo_url) ? w.logo_url : null,
    titelbild: titel ? titel.url : null,
    slogan: sauber(w.slogan, GRENZEN.slogan),
    ueber: absatz(w.ueber_text, GRENZEN.ueber),
    leistungen: (Array.isArray(w.leistungen) ? w.leistungen : []).slice(0, GRENZEN.leistungen)
      .map((l) => ({ name: sauber(l?.name, GRENZEN.leistungName), text: absatz(l?.text, GRENZEN.leistungText) }))
      .filter((l) => l.name),
    fotos: sichtbar.filter((f) => !titel || f.id !== titel.id).slice(0, GRENZEN.fotos).map((f) => f.url),
    oeffnungszeiten: oeffnungszeitenAus(profil),
    perioden: Array.isArray(profil?.regularHours?.periods) ? profil.regularHours.periods : [],
    einzugsgebiet: einzugsgebietAus(profil),
    bewertung: w.bewertungen_zeigen !== false && anzahl > 0 && rating > 0 ? {
      schnitt: Math.round(rating * 10) / 10,
      anzahl,
      liste: bewertungen
        .filter((b) => b && typeof b.comment === 'string' && b.comment.trim())
        .slice(0, GRENZEN.bewertungen)
        .map((b) => ({ name: kurzName(b.reviewer_display_name, b.reviewer_is_anonymous), sterne: Math.max(1, Math.min(5, Number(b.star_rating) || 0)), text: absatz(b.comment, 600) })),
    } : null,
    mapsLink: location?.place_id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(location.place_id)}` : null,
    impressum: pruefeImpressum(w.impressum).werte,
  };
}

/* ═══════════════════ VORLAGE ═══════════════════
 *
 * Eine Struktur, drei Stile. Die einpraegsame Stelle ist das
 * „Firmenschild" im Kopf: eine Tafel, die das Arbeitsfoto ueberlappt
 * und traegt, was ein Anrufer wissen will — wer, was, wo, wie gut
 * bewertet, ob heute offen, und die Nummer. Alles andere bleibt ruhig.
 *
 * Schriften liegen selbst gehostet unter /fonts/website/ (OFL, siehe
 * LIZENZ.txt) — keine Verbindung zu Google Fonts.
 */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const absaetze = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const telLink = (t) => `tel:${String(t).replace(/[^\d+]/g, '')}`;
const sterne = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const komma = (z) => String(z).replace('.', ',');

/** Bild-URL in der gewuenschten Groesse. Cloudinary: zuschneiden, aufhellen, komprimieren. */
export function bildQuelle(url, breite, hoehe = null) {
  if (typeof url === 'string' && /^\/beispiel\/[a-z0-9-]+\.(jpg|webp|png)$/.test(url)) return url;
  if (!bildUrlErlaubt(url)) return null;
  const t = hoehe
    ? `w_${breite},h_${hoehe},c_fill,g_auto,e_improve,f_auto,q_auto`
    : `w_${breite},c_limit,e_improve,f_auto,q_auto`;
  return String(url).replace('/image/upload/', `/image/upload/${t}/`);
}

/* ── Gewerk-Symbol ── einfache Linien-Icons, eigene Zeichnung. */
const ICONS = {
  elektro: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wasser: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  heizung: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-7.5z"/><path d="M6 21h12"/>',
  dach: '<path d="M3 12 12 4l9 8"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>',
  maler: '<rect x="3" y="3" width="14" height="6" rx="1"/><path d="M17 6h3v5h-8v3"/><path d="M11 14h2v7h-2z"/>',
  holz: '<path d="M4 20 14 10"/><path d="m13 5 6 6-3 3-6-6z"/><path d="M3 21l2-2"/>',
  garten: '<path d="M5 19c0-8 6-14 15-14-1 9-7 14-15 14z"/><path d="M5 19 13 11"/>',
  fliesen: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18M3 12h18"/>',
  werkzeug: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
};
export function gewerkSymbol(gewerk) {
  const g = String(gewerk || '').toLowerCase();
  const key = /elektr/.test(g) ? 'elektro'
    : /heiz|kamin|ofen/.test(g) ? 'heizung'
      : /sanit|klempn|install|bad|wasser/.test(g) ? 'wasser'
        : /dach|zimmer(er|ei)|spengler/.test(g) ? 'dach'
          : /maler|lackier|tapez|stuck/.test(g) ? 'maler'
            : /tischl|schrein|holz|parkett|boden/.test(g) ? 'holz'
              : /garten|landschaft|baum/.test(g) ? 'garten'
                : /fliese|platten/.test(g) ? 'fliesen' : 'werkzeug';
  return `<svg class="symbol" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
}

/* ── Heute geoeffnet? ── aus den Perioden des Google-Profils, Berliner Zeit. */
const TAG_SCHLUESSEL = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
function berlinJetzt(jetzt) {
  const teile = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(jetzt).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(teile.weekday);
  return { tag: TAG_SCHLUESSEL[idx], minute: Number(teile.hour) * 60 + Number(teile.minute), index: idx };
}
const zuMin = (t) => (Number.isInteger(t?.hours) ? t.hours : 0) * 60 + (Number.isInteger(t?.minutes) ? t.minutes : 0);
const alsUhr = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export function heuteStatus(perioden, jetzt = new Date()) {
  if (!Array.isArray(perioden) || perioden.length === 0) return null;
  const { tag, minute } = berlinJetzt(jetzt);
  const heute = perioden.filter((p) => p?.openDay === tag)
    .map((p) => ({ von: zuMin(p.openTime), bis: p.closeDay === tag ? (zuMin(p.closeTime) || 1440) : 1440 }))
    .sort((a, b) => a.von - b.von);
  const jetztOffen = heute.find((z) => minute >= z.von && minute < z.bis);
  if (jetztOffen) return { offen: true, text: jetztOffen.bis >= 1440 ? 'Jetzt geöffnet' : `Jetzt geöffnet bis ${alsUhr(jetztOffen.bis)}` };
  const spaeter = heute.find((z) => z.von > minute);
  if (spaeter) return { offen: false, text: `Heute ab ${alsUhr(spaeter.von)} geöffnet` };
  return { offen: false, text: 'Heute geschlossen' };
}

/* ── Stile ── gleiche Struktur, eigene Schrift, Kanten und Gewichtung. */
export const WEBSITE_STILE = Object.freeze({
  meister: { label: 'Meister', beschreibung: 'Ruhig und solide, Serifenschrift' },
  modern: { label: 'Modern', beschreibung: 'Viel Luft, große Fotos, weiche Ecken' },
  kraeftig: { label: 'Kräftig', beschreibung: 'Großbuchstaben, harte Kanten, starke Kontraste' },
});
export const STANDARD_STIL = 'meister';

const SCHRIFTEN = {
  meister: [['Bitter', 600, 'bitter-latin-600'], ['Bitter', 700, 'bitter-latin-700'], ['Source Sans 3', 400, 'source-sans-3-latin-400'], ['Source Sans 3', 600, 'source-sans-3-latin-600']],
  modern: [['Archivo', 400, 'archivo-latin-400'], ['Archivo', 600, 'archivo-latin-600'], ['Archivo', 700, 'archivo-latin-700']],
  kraeftig: [['Barlow Condensed', 700, 'barlow-condensed-latin-700'], ['Barlow Condensed', 800, 'barlow-condensed-latin-800'], ['Barlow', 400, 'barlow-latin-400'], ['Barlow', 600, 'barlow-latin-600']],
};

function css(m, stil, assets) {
  const f = m.farbe;
  const fonts = SCHRIFTEN[stil].map(([fam, w, datei]) => `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:swap;src:url("${assets}/fonts/website/${datei}-normal.woff2") format("woff2")}`).join('');
  const t = {
    meister: { display: '"Bitter",Georgia,serif', body: '"Source Sans 3",system-ui,sans-serif', dw: 700, r: '4px', rGross: '6px', upper: 'none', track: '-.01em', h1: 'clamp(2.1rem,5.4vw,3.4rem)', schild: '6px' },
    modern: { display: '"Archivo",system-ui,sans-serif', body: '"Archivo",system-ui,sans-serif', dw: 700, r: '999px', rGross: '22px', upper: 'none', track: '-.03em', h1: 'clamp(2.3rem,6.4vw,4.2rem)', schild: '22px' },
    kraeftig: { display: '"Barlow Condensed","Arial Narrow",sans-serif', body: '"Barlow",system-ui,sans-serif', dw: 800, r: '0', rGross: '0', upper: 'uppercase', track: '.005em', h1: 'clamp(2.6rem,8vw,5rem)', schild: '0' },
  }[stil];
  return `${fonts}
:root{--p:${f.primaer};--a:${f.akzent};--ink:#17212B;--m:#56616B;--rule:#D8DDE1;--stone:#F1F3F4;--paper:#FFFFFF;--r:${t.r};--rg:${t.rGross};--display:${t.display};--body:${t.body}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--paper);color:var(--ink);font:400 1.0625rem/1.62 var(--body)}
img{max-width:100%;display:block}a{color:var(--p);text-underline-offset:3px}
a:focus-visible,.k:focus-visible{outline:3px solid var(--a);outline-offset:3px}
.w{max-width:1120px;margin:0 auto;padding:0 20px}
h1,h2,h3{font-family:var(--display);font-weight:${t.dw};letter-spacing:${t.track};text-transform:${t.upper};line-height:1.08;margin:0;color:var(--ink)}
h2{font-size:clamp(1.7rem,3.6vw,2.5rem);margin-bottom:28px;max-width:26ch}
h3{font-size:1.2rem;line-height:1.25}
p{margin:0 0 1em;max-width:68ch}
section{padding:clamp(56px,9vw,104px) 0}
.kopf{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.96);border-bottom:1px solid var(--rule)}
.kopf .w{display:flex;align-items:center;gap:16px;min-height:66px}
.marke{display:flex;align-items:center;gap:10px;min-width:0;margin-right:auto;text-decoration:none;color:var(--ink);font:${t.dw} 1.15rem/1 var(--display);text-transform:${t.upper};letter-spacing:${t.track}}
.marke img{height:42px;width:auto;max-width:170px;object-fit:contain}.marke span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kopf nav a{color:var(--ink);text-decoration:none;font-weight:600;font-size:.97rem;margin-left:22px}
.kopf nav a:hover{color:var(--p)}
.k{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 26px;border-radius:var(--r);background:var(--a);color:#fff;font:600 1.05rem/1 var(--body);text-decoration:none;border:2px solid var(--a)}
.k.leise{background:transparent;color:var(--ink);border-color:var(--rule)}
.k.klein{min-height:42px;padding:0 16px;font-size:.95rem}
.k svg{width:18px;height:18px}
/* Hero mit Firmenschild */
.hero{position:relative;background:var(--paper)}
.hero-bild{height:clamp(300px,62vh,640px);margin:0;overflow:hidden}
.hero-bild img{width:100%;height:100%;object-fit:cover}
.hero .w{position:relative}
.schild{position:relative;margin-top:-170px;background:var(--paper);border-radius:var(--rg);padding:clamp(24px,4vw,44px);max-width:640px;box-shadow:0 24px 60px -24px rgba(10,20,30,.45)}
.hero.ohne-bild .schild{margin-top:0;top:0;transform:translateY(56px)}
.hero.ohne-bild{padding-top:72px}
.gewerk{display:flex;align-items:center;gap:10px;color:var(--p);font-weight:600;margin:0 0 14px}
.symbol{flex:none;color:var(--a)}
h1{font-size:${t.h1};margin-bottom:16px}
.slogan{font-size:1.15rem;color:var(--m);margin-bottom:22px}
.fakten{display:flex;flex-wrap:wrap;gap:8px 22px;margin:0 0 26px;padding:0;list-style:none;font-size:.98rem}
.fakten li{display:flex;align-items:center;gap:8px}
.stern{color:var(--a);letter-spacing:1px}
.punkt{width:9px;height:9px;border-radius:50%;background:#9AA4AD;flex:none}.punkt.offen{background:#2E8B57}
.knoepfe{display:flex;flex-wrap:wrap;gap:12px}
.nach-hero{height:16px}
/* Leistungen */
.leistungen{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 56px;margin:0;padding:0;list-style:none}
.leistungen li{padding:24px 0 22px;border-top:2px solid var(--rule)}
.leistungen li:first-child,.leistungen li:nth-child(2){border-top-color:var(--p)}
.leistungen h3{margin-bottom:8px}.leistungen p{color:var(--m);margin:0}
/* Ablauf */
.ablauf{background:var(--stone)}
.schritte{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px;margin:0;padding:0;list-style:none;counter-reset:s}
.schritte li{counter-increment:s}
.schritte li::before{content:counter(s);display:block;font:${t.dw} 3.2rem/1 var(--display);color:var(--a);margin-bottom:14px}
.schritte p{color:var(--m);margin:6px 0 0}
/* Ueber uns */
.ueber{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:clamp(28px,5vw,72px);align-items:center}
.ueber img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--rg)}
.ueber.ohne-bild{grid-template-columns:minmax(0,1fr)}
/* Galerie */
.galerie{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(150px,17vw);gap:10px}
.galerie a{display:block;overflow:hidden;border-radius:var(--rg)}
.galerie.mosaik a:first-child{grid-column:span 2;grid-row:span 2}
.galerie:not(.mosaik){grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));grid-auto-rows:220px}
.galerie img{width:100%;height:100%;object-fit:cover}
/* Bewertungen */
.bewertungen{background:var(--stone)}
.schnitt{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:30px}
.schnitt b{font:${t.dw} 3.4rem/1 var(--display);color:var(--ink)}
.zitat{margin:0 0 32px;padding:0 0 0 24px;border-left:4px solid var(--a);max-width:820px}
.zitat p{font:${stil === 'kraeftig' ? '600' : '400'} clamp(1.25rem,2.4vw,1.6rem)/1.4 var(--display);text-transform:none;letter-spacing:0;color:var(--ink);margin:10px 0 12px}
.stimmen{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:28px;margin:0;padding:0;list-style:none}
.stimmen p{margin:6px 0 8px}
.wer{font-weight:600;color:var(--m);font-size:.95rem}
.hinweis{font-size:.86rem;color:var(--m);margin:34px 0 0}
/* Kontakt */
.kontakt{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:clamp(28px,5vw,72px)}
.nummer{display:inline-block;font:${t.dw} clamp(2rem,5vw,3.1rem)/1.05 var(--display);color:var(--ink);text-decoration:none;margin:4px 0 18px;letter-spacing:${t.track}}
.nummer:hover{color:var(--p)}
.kontakt dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 18px}
.kontakt dt{color:var(--m)}.kontakt dd{margin:0}
.zeiten{width:100%;border-collapse:collapse}
.zeiten td{padding:9px 0;border-bottom:1px solid var(--rule)}.zeiten td:last-child{text-align:right}
.zeiten tr.heute td{font-weight:600;color:var(--p)}
.orte{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0;padding:0;list-style:none}
.orte li{border:1px solid var(--rule);border-radius:var(--r);padding:4px 12px;font-size:.92rem}
footer{background:var(--ink);color:#C9D1D8;padding:34px 0;font-size:.92rem}
footer .w{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between}footer a{color:#fff}
.recht{padding:56px 0 72px}.recht h1{font-size:clamp(2rem,4vw,2.8rem);margin-bottom:28px}.recht h2{font-size:1.25rem;margin:30px 0 8px;max-width:none}
.anruf{display:none}
${stil === 'kraeftig' ? `.hero{background:var(--p)}.schild{border-top:10px solid var(--a)}.leistungen li{border-top-width:4px}.zitat{border-left-width:8px}.ablauf{background:var(--ink)}.ablauf h2,.ablauf h3{color:#fff}.ablauf p{color:#C9D1D8}` : ''}
${stil === 'modern' ? `.hero{background:var(--paper)}.hero-bild{margin:0 auto;max-width:1400px;border-radius:0 0 var(--rg) var(--rg)}.leistungen li{border-top-width:1px}.leistungen li:first-child,.leistungen li:nth-child(2){border-top-color:var(--rule)}.ablauf,.bewertungen{background:#F4F6F5}` : ''}
@media(max-width:820px){.kopf nav{display:none}.kopf .k{display:none}
.schild{margin-top:-64px;box-shadow:0 16px 40px -20px rgba(10,20,30,.45)}
.hero.ohne-bild .schild{transform:none}.hero.ohne-bild{padding:28px 0 0}.nach-hero{height:8px}
.leistungen,.schritte,.ueber,.kontakt{grid-template-columns:minmax(0,1fr)}.leistungen{gap:0}.schritte{gap:28px}
.galerie{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:42vw}
.anruf{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:6;box-shadow:0 10px 26px rgba(0,0,0,.28)}body{padding-bottom:80px}}
@media(prefers-reduced-motion:no-preference){.schild{animation:hoch .5s ease-out both}@keyframes hoch{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}}`;
}

const TEL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>';

function rahmen(m, { titel, beschreibung, kanonisch, basis, inhalt, jsonLd, robots, stil, assets }) {
  const start = basis || '/';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titel)}</title><meta name="description" content="${esc(beschreibung)}">${kanonisch ? `<link rel="canonical" href="${esc(kanonisch)}">` : ''}
${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}<meta property="og:title" content="${esc(titel)}"><meta property="og:description" content="${esc(beschreibung)}">${m.titelbild && bildQuelle(m.titelbild, 1200, 630) ? `<meta property="og:image" content="${esc(bildQuelle(m.titelbild, 1200, 630))}">` : ''}
<meta name="theme-color" content="${esc(m.farbe.primaer)}"><style>${css(m, stil, assets)}</style>${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}</head><body>
${m.beispiel ? '<div style="background:#FFE9A8;color:#3A2E00;text-align:center;font:600 .9rem/1.4 system-ui,sans-serif;padding:8px 16px">Beispiel-Website von WERKRUF. Dieser Betrieb ist erfunden.</div>' : ''}<header class="kopf"><div class="w"><a class="marke" href="${esc(start)}">${m.logo ? `<img src="${esc(bildQuelle(m.logo, 340))}" alt="${esc(m.name)}">` : `<span>${esc(m.name)}</span>`}</a>
<nav aria-label="Seite"><a href="${esc(start)}#leistungen">Leistungen</a>${m.fotos.length ? `<a href="${esc(start)}#arbeiten">Arbeiten</a>` : ''}${m.bewertung ? `<a href="${esc(start)}#bewertungen">Bewertungen</a>` : ''}<a href="${esc(start)}#kontakt">Kontakt</a></nav>
${m.telefon ? `<a class="k klein" href="${esc(telLink(m.telefon))}">${TEL_ICON}${esc(m.telefon)}</a>` : ''}</div></header>
${inhalt}
<footer><div class="w"><span>${esc(m.name)}${m.adresse ? `, ${esc(m.adresse.ort)}` : ''}</span><span><a href="${esc(basis)}/impressum">Impressum</a> &nbsp; <a href="${esc(basis)}/datenschutz">Datenschutz</a></span></div></footer>
${m.telefon ? `<a class="k anruf" href="${esc(telLink(m.telefon))}">${TEL_ICON}Jetzt anrufen</a>` : ''}
</body></html>`;
}

function startseite(m, jetzt) {
  const zusatz = [m.gewerk, m.ort ? `in ${m.ort}` : ''].filter(Boolean).join(' ');
  const heute = heuteStatus(m.perioden, jetzt);
  const fakten = [];
  if (m.bewertung) fakten.push(`<li><span class="stern" aria-hidden="true">★</span><span><strong>${esc(komma(m.bewertung.schnitt))}</strong> aus ${esc(m.bewertung.anzahl)} Google-Bewertungen</span></li>`);
  if (heute) fakten.push(`<li><span class="punkt${heute.offen ? ' offen' : ''}" aria-hidden="true"></span>${esc(heute.text)}</li>`);
  if (m.einzugsgebiet.length) fakten.push(`<li>Im Einsatz in ${esc(m.einzugsgebiet.slice(0, 3).join(', '))}${m.einzugsgebiet.length > 3 ? ' und Umgebung' : ''}</li>`);

  const hero = `<section class="hero${m.titelbild ? '' : ' ohne-bild'}" aria-label="${esc(m.name)}" style="padding:0">
${m.titelbild ? `<figure class="hero-bild"><img src="${esc(bildQuelle(m.titelbild, 1800, 1000))}" alt="Arbeit von ${esc(m.name)}" fetchpriority="high"></figure>` : ''}
<div class="w"><div class="schild">
${zusatz ? `<p class="gewerk">${gewerkSymbol(m.gewerk)}<span>${esc(zusatz)}</span></p>` : ''}
<h1>${esc(m.name)}</h1>
${m.slogan ? `<p class="slogan">${esc(m.slogan)}</p>` : ''}
${fakten.length ? `<ul class="fakten">${fakten.join('')}</ul>` : ''}
<div class="knoepfe">${m.telefon ? `<a class="k" href="${esc(telLink(m.telefon))}">${TEL_ICON}${esc(m.telefon)}</a>` : ''}${m.email ? `<a class="k leise" href="mailto:${esc(m.email)}">E-Mail schreiben</a>` : ''}</div>
</div></div></section><div class="nach-hero"></div>`;

  const teile = [hero];
  if (m.leistungen.length) {
    teile.push(`<section id="leistungen"><div class="w"><h2>Was wir für Sie erledigen</h2><ul class="leistungen">${m.leistungen.map((l) => `<li><h3>${esc(l.name)}</h3>${l.text ? `<p>${esc(l.text)}</p>` : ''}</li>`).join('')}</ul></div></section>`);
  }
  teile.push(`<section class="ablauf"><div class="w"><h2>So kommen wir zusammen</h2><ol class="schritte">
<li><h3>Sie melden sich</h3><p>Per Telefon${m.email ? ' oder E-Mail' : ''}. Schildern Sie kurz, worum es geht.</p></li>
<li><h3>Wir besprechen den Auftrag</h3><p>Wir klären mit Ihnen, was zu tun ist, und stimmen das weitere Vorgehen ab.</p></li>
<li><h3>Wir führen ihn aus</h3><p>Fragen unterwegs beantworten wir Ihnen direkt.</p></li></ol></div></section>`);
  const ueberBild = m.fotos[0] || null;
  if (m.ueber) {
    teile.push(`<section id="ueber"><div class="w ueber${ueberBild ? '' : ' ohne-bild'}"><div><h2>Über ${esc(m.name)}</h2>${absaetze(m.ueber)}</div>${ueberBild ? `<img src="${esc(bildQuelle(ueberBild, 900, 1125))}" alt="Aus der Arbeit von ${esc(m.name)}" loading="lazy">` : ''}</div></section>`);
  }
  const alle = m.ueber && ueberBild ? m.fotos.slice(1) : m.fotos;
  /* Mosaik (erstes Bild 2×2) nur mit 5 oder 9 Bildern — dann gehen die
     Reihen bei 4 und bei 2 Spalten auf, ohne einzelnes Bild am Ende. */
  const n = alle.length >= 9 ? 9 : alle.length >= 5 ? 5 : alle.length;
  const galerie = alle.slice(0, n);
  const mosaik = n === 5 || n === 9;
  if (galerie.length) {
    teile.push(`<section id="arbeiten"><div class="w"><h2>Aus unserer Arbeit</h2><div class="galerie${mosaik ? ' mosaik' : ''}">${galerie.map((u, i) => `<a href="${esc(bildQuelle(u, 2000))}" target="_blank" rel="noopener"><img src="${esc(bildQuelle(u, i === 0 && mosaik ? 1100 : 600, i === 0 && mosaik ? 1100 : 600))}" alt="Arbeit von ${esc(m.name)}, Bild ${i + 1}" loading="lazy"></a>`).join('')}</div></div></section>`);
  }
  if (m.bewertung) {
    const b = m.bewertung;
    const [erste, ...rest] = b.liste;
    teile.push(`<section class="bewertungen" id="bewertungen"><div class="w"><h2>Das sagen unsere Kunden</h2>
<div class="schnitt"><b>${esc(komma(b.schnitt))}</b><span><span class="stern" aria-label="${esc(komma(b.schnitt))} von 5 Sternen">${sterne(Math.round(b.schnitt))}</span><br>aus ${esc(b.anzahl)} Bewertungen bei Google</span></div>
${erste ? `<figure class="zitat"><span class="stern" aria-label="${erste.sterne} von 5 Sternen">${sterne(erste.sterne)}</span><blockquote style="margin:0"><p>${esc(erste.text)}</p></blockquote><figcaption class="wer">${esc(erste.name)}</figcaption></figure>` : ''}
${rest.length ? `<ul class="stimmen">${rest.map((r) => `<li><span class="stern" aria-label="${r.sterne} von 5 Sternen">${sterne(r.sterne)}</span><p>${esc(r.text)}</p><span class="wer">${esc(r.name)}</span></li>`).join('')}</ul>` : ''}
<p class="hinweis">Die neuesten Bewertungen mit Text aus unserem Google-Unternehmensprofil, ungefiltert. Wir prüfen nicht selbst, ob sie von Kunden stammen; dafür gelten die Richtlinien von Google.${m.mapsLink ? ` <a href="${esc(m.mapsLink)}" rel="noopener">Alle Bewertungen bei Google ansehen</a>` : ''}</p></div></section>`);
  }
  const { index } = berlinJetzt(jetzt);
  const heuteName = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][index];
  const links = [];
  if (m.telefon) links.push(`<a class="nummer" href="${esc(telLink(m.telefon))}">${esc(m.telefon)}</a>`);
  const dl = [];
  if (m.email) dl.push(`<dt>E-Mail</dt><dd><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></dd>`);
  if (m.adresse) dl.push(`<dt>Adresse</dt><dd>${esc(m.adresse.strasse)}<br>${esc(m.adresse.plz)} ${esc(m.adresse.ort)}${m.mapsLink ? `<br><a href="${esc(m.mapsLink)}" rel="noopener">Route bei Google Maps</a>` : ''}</dd>`);
  const orte = m.einzugsgebiet.length ? `<p style="margin:26px 0 0;color:var(--m)">Wir sind für Sie da in</p><ul class="orte">${m.einzugsgebiet.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '';
  const zeiten = m.oeffnungszeiten.length ? `<div><h3 style="margin-bottom:10px">Öffnungszeiten</h3><table class="zeiten">${m.oeffnungszeiten.map((z) => `<tr${z.tag === heuteName ? ' class="heute"' : ''}><td>${esc(z.tag)}${z.tag === heuteName ? ' (heute)' : ''}</td><td>${esc(z.zeiten)}</td></tr>`).join('')}</table></div>` : '<div></div>';
  teile.push(`<section id="kontakt"><div class="w"><h2>Rufen Sie uns an</h2><div class="kontakt"><div>${links.join('')}${dl.length ? `<dl>${dl.join('')}</dl>` : ''}${orte}</div>${zeiten}</div></div></section>`);
  return teile.join('\n');
}

function impressumSeite(m) {
  const i = m.impressum;
  const rf = RECHTSFORMEN[i.rechtsform];
  const z = [];
  z.push(`<h2>Angaben gemäß § 5 DDG</h2><p>${esc(i.firma)}${rf && i.rechtsform !== 'einzelunternehmen' && !i.firma.includes(rf.label) ? ` ${esc(rf.label)}` : ''}<br>${esc(i.strasse)}<br>${esc(i.plz)} ${esc(i.ort)}</p>`);
  if (rf?.vertretung && i.vertreten_durch) z.push(`<p>Vertreten durch: ${esc(i.vertreten_durch)}</p>`);
  else if (i.inhaber) z.push(`<p>Inhaber/in: ${esc(i.inhaber)}</p>`);
  z.push(`<h2>Kontakt</h2><p>Telefon: ${esc(i.telefon)}<br>E-Mail: <a href="mailto:${esc(i.email)}">${esc(i.email)}</a></p>`);
  if (i.registergericht || i.registernummer) z.push(`<h2>Registereintrag</h2><p>${esc(i.registergericht)}<br>${esc(i.registernummer)}</p>`);
  if (i.ustid) z.push(`<h2>Umsatzsteuer-ID</h2><p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: ${esc(i.ustid)}</p>`);
  if (i.kammer || i.berufsbezeichnung) {
    z.push(`<h2>Berufsrechtliche Angaben</h2><p>${i.kammer ? `Zuständige Kammer: ${esc(i.kammer)}<br>` : ''}${i.berufsbezeichnung ? `Berufsbezeichnung: ${esc(i.berufsbezeichnung)}<br>Berufsrechtliche Regelungen: Handwerksordnung (HwO), einsehbar unter <a href="https://www.gesetze-im-internet.de/hwo/" rel="noopener">gesetze-im-internet.de/hwo</a>` : ''}</p>`);
  }
  z.push('<h2>Verbraucherstreitbeilegung</h2><p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>');
  return `<main class="recht"><div class="w"><h1>Impressum</h1>${z.join('\n')}</div></main>`;
}

function datenschutzSeite(m) {
  const i = m.impressum;
  return `<main class="recht"><div class="w"><h1>Datenschutzerklärung</h1>
<h2>1. Verantwortlich</h2><p>${esc(i.firma)}, ${esc(i.strasse)}, ${esc(i.plz)} ${esc(i.ort)}, Telefon ${esc(i.telefon)}, E-Mail <a href="mailto:${esc(i.email)}">${esc(i.email)}</a>.</p>
<h2>2. Keine Cookies, kein Tracking</h2><p>Diese Website setzt keine Cookies und verwendet keine Analyse- oder Werbedienste. Schriften werden von dieser Website selbst geladen, nicht von Drittanbietern; Karten werden nicht eingebettet.</p>
<h2>3. Bereitstellung der Website</h2><p>Die Website wird von WERKRUF (Iver Bohnes, Hamburg) als Auftragsverarbeiter bereitgestellt und über die Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, USA, ausgeliefert. Beim Aufruf verarbeitet Vercel technisch notwendige Daten (IP-Adresse, Zeitpunkt, aufgerufene Seite, Browser-Angaben), um die Seite auszuliefern und vor Missbrauch zu schützen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren Betrieb). Vercel ist nach dem EU-US Data Privacy Framework zertifiziert.</p>
<h2>4. Bilder</h2><p>Fotos und Logo werden von der Cloudinary Ltd., 111 W Evelyn Ave, Sunnyvale, CA 94086, USA, ausgeliefert. Dabei wird Ihre IP-Adresse an Cloudinary übertragen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (schnelle, zuverlässige Bildauslieferung).</p>
<h2>5. Kontakt per Telefon oder E-Mail</h2><p>Wenn Sie uns anrufen oder schreiben, verarbeiten wir Ihre Angaben, um Ihre Anfrage zu bearbeiten (Art. 6 Abs. 1 lit. b DSGVO bei Anfragen zu einem Auftrag, sonst lit. f). Wir löschen die Daten, wenn sie nicht mehr benötigt werden und keine Aufbewahrungspflicht besteht.</p>
<h2>6. Google-Bewertungen</h2><p>Auf dieser Seite zeigen wir Bewertungen aus unserem Google-Unternehmensprofil mit Vorname und abgekürztem Nachnamen der Verfassenden. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Darstellung öffentlich abgegebener Bewertungen). Beim Aufruf dieser Seite wird keine Verbindung zu Google hergestellt.</p>
<h2>7. Ihre Rechte</h2><p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO) sowie das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren.</p>
</div></main>`;
}

/**
 * Seite rendern. pfad: '/', '/impressum', '/datenschutz'.
 * basis: Pfadpraefix ('' fuer eigene Domain, '/seite/<slug>' sonst).
 * assets: Herkunft der Schriften ('' = dieselbe Domain).
 * jetzt: fuer „heute geoeffnet" (Tests setzen es fest).
 */
export function renderSeite(m, pfad = '/', { basis = '', kanonischBasis = '', vorschau = false, assets = '', jetzt = new Date() } = {}) {
  const p = String(pfad || '/').replace(/\/+$/, '') || '/';
  const stil = WEBSITE_STILE[m.stil] ? m.stil : STANDARD_STIL;
  const kanon = (x) => (kanonischBasis ? `${kanonischBasis}${x === '/' ? '/' : x}` : '');
  const robots = vorschau || m.beispiel ? 'noindex,nofollow' : '';
  const beschreibung = [m.gewerk && m.ort ? `${m.gewerk} in ${m.ort}` : m.gewerk, m.slogan, m.telefon ? `Telefon ${m.telefon}` : ''].filter(Boolean).join('. ').slice(0, 160) || m.name;
  const gemeinsam = { basis, stil, assets };
  if (p === '/') {
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: m.name,
      ...(m.telefon ? { telephone: m.telefon } : {}), ...(m.email ? { email: m.email } : {}),
      ...(m.adresse ? { address: { '@type': 'PostalAddress', streetAddress: m.adresse.strasse, postalCode: m.adresse.plz, addressLocality: m.adresse.ort, addressCountry: 'DE' } } : {}),
      ...(m.titelbild && bildQuelle(m.titelbild, 1200) ? { image: bildQuelle(m.titelbild, 1200) } : {}),
      ...(m.einzugsgebiet.length ? { areaServed: m.einzugsgebiet } : {}),
      ...(kanonischBasis ? { url: kanon('/') } : {}),
    };
    const titel = m.gewerk && m.ort ? `${m.name} – ${m.gewerk} in ${m.ort}` : m.name;
    return { status: 200, html: rahmen(m, { ...gemeinsam, titel, beschreibung, kanonisch: kanon('/'), inhalt: startseite(m, jetzt), jsonLd, robots }) };
  }
  if (p === '/impressum') return { status: 200, html: rahmen(m, { ...gemeinsam, titel: `Impressum – ${m.name}`, beschreibung: `Impressum von ${m.name}`, kanonisch: kanon('/impressum'), inhalt: impressumSeite(m), robots: robots || 'noindex' }) };
  if (p === '/datenschutz') return { status: 200, html: rahmen(m, { ...gemeinsam, titel: `Datenschutz – ${m.name}`, beschreibung: `Datenschutzerklärung von ${m.name}`, kanonisch: kanon('/datenschutz'), inhalt: datenschutzSeite(m), robots: robots || 'noindex' }) };
  return { status: 404, html: rahmen(m, { ...gemeinsam, titel: `Seite nicht gefunden – ${m.name}`, beschreibung: m.name, robots: 'noindex', inhalt: `<main class="recht"><div class="w"><h1>Seite nicht gefunden</h1><p><a href="${esc(basis || '/')}">Zur Startseite</a></p></div></main>` }) };
}

/* ═══════════════════ BEISPIEL-BETRIEB ═══════════════════
   werkruf.com/seite/beispiel — fuer Tests, Vorschau und Vertrieb.
   Ein erfundener Betrieb; Fotos liegen unter /beispiel/ im Repo. */
export const BEISPIEL_FOTOS = ['/beispiel/1.jpg', '/beispiel/2.jpg', '/beispiel/3.jpg', '/beispiel/4.jpg', '/beispiel/5.jpg', '/beispiel/6.jpg', '/beispiel/7.jpg', '/beispiel/8.jpg'];
export function beispielModell({ stil = STANDARD_STIL, farbe = STANDARD_FARBE } = {}) {
  const tage = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
  const perioden = tage.map((d) => ({ openDay: d, openTime: { hours: 7, minutes: 30 }, closeDay: d, closeTime: { hours: 16, minutes: 30 } }));
  return {
    name: 'Elektro Krause', gewerk: 'Elektriker', ort: 'Hamburg', beispiel: true,
    stil: WEBSITE_STILE[stil] ? stil : STANDARD_STIL,
    farbe: WEBSITE_FARBEN[farbe] || WEBSITE_FARBEN[STANDARD_FARBE],
    adresse: { strasse: 'Musterstraße 12', plz: '22305', ort: 'Hamburg' },
    telefon: '040 123 456 78', email: 'info@elektro-krause.example',
    logo: null, titelbild: BEISPIEL_FOTOS[0],
    slogan: 'Elektroarbeiten in Hamburg-Nord – vom Sicherungskasten bis zur Wallbox.',
    ueber: 'Wir sind ein inhabergeführter Elektrobetrieb in Barmbek. Bei uns haben Sie vom ersten Anruf bis zur Abnahme denselben Ansprechpartner.\n\nWir arbeiten in Wohnungen, Einfamilienhäusern und kleinen Gewerbeobjekten – im Neubau wie im Altbau.',
    leistungen: [
      { name: 'Elektroinstallation', text: 'Neubau, Sanierung und Erweiterung – geplant und ausgeführt aus einer Hand.' },
      { name: 'E-Check', text: 'Wir prüfen Ihre Anlage und dokumentieren das Ergebnis für Versicherung und Vermieter.' },
      { name: 'Wallbox', text: 'Beratung, Anmeldung beim Netzbetreiber und Montage Ihrer Ladestation.' },
      { name: 'Altbausanierung', text: 'Neue Leitungen und Unterverteilungen, abgestimmt mit den anderen Gewerken.' },
      { name: 'Beleuchtung', text: 'Innen und außen, mit Planung der Lichtpunkte und Schalter.' },
      { name: 'Störungsdienst', text: 'Wenn der Strom weg ist, suchen wir die Ursache und beheben sie.' },
    ],
    fotos: BEISPIEL_FOTOS.slice(1),
    perioden,
    oeffnungszeiten: oeffnungszeitenAus({ regularHours: { periods: perioden } }),
    einzugsgebiet: ['Hamburg', 'Norderstedt', 'Ahrensburg', 'Reinbek'],
    bewertung: {
      schnitt: 4.8, anzahl: 37,
      liste: [
        { name: 'Sandra P.', sterne: 5, text: 'Wallbox an einem Vormittag montiert, alles erklärt und hinterher sauber gemacht. Die Anmeldung beim Netzbetreiber hat der Betrieb gleich mit erledigt.' },
        { name: 'Thomas W.', sterne: 5, text: 'Schnell einen Termin bekommen, freundlich und ordentlich gearbeitet.' },
        { name: 'Mehmet Y.', sterne: 4, text: 'Gute Arbeit. Der Termin musste einmal verschoben werden, wurde aber rechtzeitig angekündigt.' },
      ],
    },
    mapsLink: null,
    impressum: pruefeImpressum({ firma: 'Elektro Krause (Beispiel)', rechtsform: 'einzelunternehmen', inhaber: 'Jens Krause', strasse: 'Musterstraße 12', plz: '22305', ort: 'Hamburg', telefon: '040 123 456 78', email: 'info@elektro-krause.example', kammer: 'Handwerkskammer Hamburg' }).werte,
  };
}

/* ═══════════════════ KI-TEXTVORSCHLAG ═══════════════════ */

export const VORSCHLAEGE_PRO_TAG = 10;

export function websiteTextSystem() {
  return [
    'Du schreibst die Texte für die Website eines deutschen Handwerksbetriebs.',
    'Regeln:',
    '- Verwende nur die Fakten aus der Anfrage. Erfinde nichts: keine Jahreszahlen, Gründungsjahre, Mitarbeiterzahlen, Meistertitel, Zertifikate, Marken, Preise, Garantien, Kundennamen oder Orte, die nicht genannt sind.',
    '- Keine Superlative („der beste“), keine Rabatte, keine Versprechen, keine Telefonnummern, keine Links, keine Emojis, keine Hashtags.',
    '- Sachlich und freundlich, wie ein Meister, der seinen Betrieb vorstellt. „Wir“-Form, Leser werden gesiezt.',
    '- slogan: ein kurzer Satz, höchstens 100 Zeichen.',
    '- ueber: 2 bis 4 Sätze über den Betrieb, höchstens 600 Zeichen.',
    '- leistungen: für jede genannte Leistung 1 bis 2 Sätze, was der Betrieb dabei für Kunden tut, höchstens 300 Zeichen. Nur die genannten Leistungen, gleiche Namen, gleiche Reihenfolge.',
    '- Antworte ausschließlich mit JSON: {"slogan":"…","ueber":"…","leistungen":[{"name":"…","text":"…"}]}',
  ].join('\n');
}

export function websiteTextAnfrage({ betrieb, gewerk, ort, beschreibung, leistungen, einzugsgebiet }) {
  const z = [`Betrieb: ${String(betrieb || 'unbekannt').slice(0, 120)}`];
  if (gewerk) z.push(`Gewerk laut Google-Profil: ${String(gewerk).slice(0, 120)}`);
  if (ort) z.push(`Ort: ${String(ort).slice(0, 80)}`);
  if (einzugsgebiet?.length) z.push(`Einzugsgebiet: ${einzugsgebiet.slice(0, 12).join(', ')}`);
  if (beschreibung) z.push(`Beschreibung aus dem Google-Profil: ${String(beschreibung).slice(0, 750)}`);
  z.push(`Leistungen: ${(leistungen || []).map((l) => l.name).join(' | ') || 'keine genannt — dann leere Liste'}`);
  return z.join('\n');
}

/** Antwort des Modells pruefen: gueltiges JSON, Laengen, keine verbotenen Inhalte, keine fremden Leistungen. */
export function pruefeWebsiteTexte(roh, leistungsNamen = []) {
  let d;
  try {
    const t = String(roh || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    d = JSON.parse(t);
  } catch { return { ok: false, grund: 'ungeeignet' }; }
  if (!d || typeof d !== 'object') return { ok: false, grund: 'ungeeignet' };
  const slogan = sauber(d.slogan, GRENZEN.slogan);
  const ueber = absatz(d.ueber, GRENZEN.ueber);
  const erlaubt = new Map(leistungsNamen.map((n) => [String(n).toLowerCase(), n]));
  const leistungen = (Array.isArray(d.leistungen) ? d.leistungen : [])
    .map((l) => ({ name: erlaubt.get(String(l?.name || '').trim().toLowerCase()), text: absatz(l?.text, GRENZEN.leistungText) }))
    .filter((l) => l.name && l.text);
  for (const t of [slogan, ueber, ...leistungen.map((l) => l.text)]) {
    if (verbotenerInhalt(t)) return { ok: false, grund: 'ungeeignet' };
  }
  if (!slogan && !ueber && leistungen.length === 0) return { ok: false, grund: 'ungeeignet' };
  return { ok: true, slogan, ueber, leistungen };
}
