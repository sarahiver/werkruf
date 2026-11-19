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
   heisst unlesbare Knoepfe. */
export const WEBSITE_FARBEN = Object.freeze({
  marine:    { label: 'Marine',     primaer: '#0B3557', akzent: '#E07B00' },
  waldgruen: { label: 'Waldgrün',   primaer: '#1F4D3A', akzent: '#C98A1B' },
  ziegel:    { label: 'Ziegelrot',  primaer: '#8E2A1E', akzent: '#2F3E4C' },
  anthrazit: { label: 'Anthrazit',  primaer: '#2B2F33', akzent: '#D9480F' },
  petrol:    { label: 'Petrol',     primaer: '#0E5160', akzent: '#E0A100' },
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
const SLUG_RESERVIERT = new Set(['admin', 'api', 'dashboard', 'werkruf', 'hilfe', 'login', 'impressum', 'datenschutz', 'seite', 'test']);
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

/* ═══════════════════ VORLAGE ═══════════════════ */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const absaetze = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const telLink = (t) => `tel:${String(t).replace(/[^\d+]/g, '')}`;
const sterne = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

function css(f) {
  return `:root{--p:${f.primaer};--a:${f.akzent};--t:#1d232a;--m:#5b6670;--b:#e4e7eb;--bg:#f6f7f8}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--t);line-height:1.6;background:#fff}
img{max-width:100%;display:block}a{color:var(--p)}
.w{max-width:1080px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--b)}
header .w{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.marke{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--p);text-decoration:none;min-width:0}
.marke img{height:40px;width:auto;max-width:160px;object-fit:contain}.marke span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
nav a{margin-left:18px;text-decoration:none;color:var(--t);font-weight:600;font-size:.95rem}
.k{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 20px;border-radius:999px;background:var(--a);color:#fff;font-weight:700;text-decoration:none;border:0}
.k.zwei{background:#fff;color:var(--p);border:2px solid #fff}
.hero{position:relative;color:#fff;background:var(--p)}
.hero .bild{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.35}
.hero .w{position:relative;padding:72px 20px 64px}
.hero h1{font-size:clamp(1.8rem,5vw,3rem);line-height:1.15;margin:0 0 12px;max-width:760px}
.hero p{font-size:1.15rem;margin:0 0 24px;max-width:640px;opacity:.95}
.knoepfe{display:flex;flex-wrap:wrap;gap:12px}
section{padding:56px 0}section.grau{background:var(--bg)}
h2{color:var(--p);font-size:1.6rem;margin:0 0 20px}
.raster{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.karte{background:#fff;border:1px solid var(--b);border-radius:12px;padding:20px}
.karte h3{margin:0 0 8px;font-size:1.1rem}.karte p{margin:0;color:var(--m)}
.fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.fotos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px}
.schnitt{font-size:1.2rem;font-weight:700;margin:0 0 16px}.schnitt b{color:var(--a)}
.stern{color:var(--a);letter-spacing:2px}.bew .wer{font-weight:700;color:var(--t);margin:6px 0 0}
.hinweis{font-size:.85rem;color:var(--m);margin-top:14px}
.kontakt{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}
table{border-collapse:collapse}td{padding:3px 16px 3px 0;vertical-align:top}
footer{background:var(--p);color:#fff;padding:28px 0;font-size:.9rem}footer a{color:#fff}
footer .w{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between}
.recht{padding:40px 0}.recht h1{color:var(--p)}.recht h2{font-size:1.2rem;margin-top:28px}
.anruf{display:none}
@media(max-width:700px){nav{display:none}.hero .w{padding:48px 20px 44px}section{padding:40px 0}
.anruf{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:6;box-shadow:0 6px 20px rgba(0,0,0,.25)}body{padding-bottom:76px}}`;
}

function rahmen(m, { titel, beschreibung, kanonisch, basis, inhalt, jsonLd, robots }) {
  const start = basis || '/';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titel)}</title><meta name="description" content="${esc(beschreibung)}">${kanonisch ? `<link rel="canonical" href="${esc(kanonisch)}">` : ''}
${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}<meta property="og:title" content="${esc(titel)}"><meta property="og:description" content="${esc(beschreibung)}">${m.titelbild ? `<meta property="og:image" content="${esc(bildGroesse(m.titelbild, 1200))}">` : ''}
<meta name="theme-color" content="${esc(m.farbe.primaer)}"><style>${css(m.farbe)}</style>${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}</head><body>
<header><div class="w"><a class="marke" href="${esc(start)}">${m.logo ? `<img src="${esc(bildGroesse(m.logo, 320))}" alt="${esc(m.name)}">` : ''}<span>${esc(m.name)}</span></a>
<nav><a href="${esc(start)}#leistungen">Leistungen</a>${m.bewertung ? `<a href="${esc(start)}#bewertungen">Bewertungen</a>` : ''}<a href="${esc(start)}#kontakt">Kontakt</a></nav></div></header>
${inhalt}
<footer><div class="w"><span>© ${esc(m.name)}</span><span><a href="${esc(basis)}/impressum">Impressum</a> · <a href="${esc(basis)}/datenschutz">Datenschutz</a></span></div></footer>
${m.telefon ? `<a class="k anruf" href="${esc(telLink(m.telefon))}">Jetzt anrufen</a>` : ''}
</body></html>`;
}

function startseite(m, basis) {
  const unterzeile = m.slogan || [m.gewerk, m.ort ? `in ${m.ort}` : ''].filter(Boolean).join(' ');
  const h1 = m.gewerk && m.ort ? `${m.name} – ${m.gewerk} in ${m.ort}` : m.name;
  const teile = [];
  teile.push(`<div class="hero">${m.titelbild ? `<div class="bild" style="background-image:url('${esc(bildGroesse(m.titelbild, 1600))}')"></div>` : ''}<div class="w">
<h1>${esc(h1)}</h1>${unterzeile && unterzeile !== h1 ? `<p>${esc(unterzeile)}</p>` : ''}
<div class="knoepfe">${m.telefon ? `<a class="k" href="${esc(telLink(m.telefon))}">Anrufen: ${esc(m.telefon)}</a>` : ''}${m.email ? `<a class="k zwei" href="mailto:${esc(m.email)}">E-Mail schreiben</a>` : ''}</div></div></div>`);
  if (m.leistungen.length) {
    teile.push(`<section id="leistungen"><div class="w"><h2>Unsere Leistungen</h2><div class="raster">${m.leistungen.map((l) => `<div class="karte"><h3>${esc(l.name)}</h3>${l.text ? `<p>${esc(l.text)}</p>` : ''}</div>`).join('')}</div></div></section>`);
  }
  if (m.ueber) teile.push(`<section class="grau" id="ueber"><div class="w"><h2>Über uns</h2>${absaetze(m.ueber)}</div></section>`);
  if (m.fotos.length) {
    teile.push(`<section id="referenzen"><div class="w"><h2>Aus unserer Arbeit</h2><div class="fotos">${m.fotos.map((u, i) => `<img src="${esc(bildGroesse(u, 800))}" alt="Arbeit von ${esc(m.name)}, Bild ${i + 1}" loading="lazy">`).join('')}</div></div></section>`);
  }
  if (m.bewertung) {
    const b = m.bewertung;
    teile.push(`<section class="grau" id="bewertungen"><div class="w"><h2>Das sagen unsere Kunden</h2>
<p class="schnitt"><b>${esc(String(b.schnitt).replace('.', ','))}</b> von 5 Sternen · ${esc(b.anzahl)} Bewertungen bei Google</p>
${b.liste.length ? `<div class="raster">${b.liste.map((r) => `<div class="karte bew"><div class="stern" aria-label="${r.sterne} von 5 Sternen">${sterne(r.sterne)}</div><p>${esc(r.text)}</p><p class="wer">${esc(r.name)}</p></div>`).join('')}</div>` : ''}
<p class="hinweis">Die neuesten Bewertungen mit Text aus unserem Google-Unternehmensprofil, ungefiltert. Wir prüfen nicht selbst, ob sie von Kunden stammen; dafür gelten die Richtlinien von Google.${m.mapsLink ? ` <a href="${esc(m.mapsLink)}" rel="noopener">Alle Bewertungen bei Google ansehen</a>` : ''}</p></div></section>`);
  }
  const kontakt = [];
  if (m.adresse) kontakt.push(`<p><strong>${esc(m.name)}</strong><br>${esc(m.adresse.strasse)}<br>${esc(m.adresse.plz)} ${esc(m.adresse.ort)}${m.mapsLink ? `<br><a href="${esc(m.mapsLink)}" rel="noopener">Route bei Google Maps</a>` : ''}</p>`);
  if (m.telefon) kontakt.push(`<p>Telefon: <a href="${esc(telLink(m.telefon))}">${esc(m.telefon)}</a></p>`);
  if (m.email) kontakt.push(`<p>E-Mail: <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></p>`);
  if (m.einzugsgebiet.length) kontakt.push(`<p>Wir sind für Sie da in: ${esc(m.einzugsgebiet.join(', '))}</p>`);
  const zeiten = m.oeffnungszeiten.length ? `<div><h3>Öffnungszeiten</h3><table>${m.oeffnungszeiten.map((z) => `<tr><td>${esc(z.tag)}</td><td>${esc(z.zeiten)}</td></tr>`).join('')}</table></div>` : '';
  teile.push(`<section id="kontakt"><div class="w"><h2>Kontakt</h2><div class="kontakt"><div>${kontakt.join('')}</div>${zeiten}</div></div></section>`);
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
<h2>2. Keine Cookies, kein Tracking</h2><p>Diese Website setzt keine Cookies, verwendet keine Analyse- oder Werbedienste und lädt keine Schriften oder Karten von Drittanbietern.</p>
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
 * Liefert immer HTML; status 404 fuer unbekannte Pfade.
 */
export function renderSeite(m, pfad = '/', { basis = '', kanonischBasis = '', vorschau = false } = {}) {
  const p = String(pfad || '/').replace(/\/+$/, '') || '/';
  const kanon = (x) => (kanonischBasis ? `${kanonischBasis}${x === '/' ? '/' : x}` : '');
  const robots = vorschau ? 'noindex,nofollow' : '';
  const beschreibung = [m.gewerk && m.ort ? `${m.gewerk} in ${m.ort}` : m.gewerk, m.slogan, m.telefon ? `Telefon ${m.telefon}` : ''].filter(Boolean).join(' · ').slice(0, 160) || m.name;
  if (p === '/') {
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: m.name,
      ...(m.telefon ? { telephone: m.telefon } : {}), ...(m.email ? { email: m.email } : {}),
      ...(m.adresse ? { address: { '@type': 'PostalAddress', streetAddress: m.adresse.strasse, postalCode: m.adresse.plz, addressLocality: m.adresse.ort, addressCountry: 'DE' } } : {}),
      ...(m.titelbild ? { image: bildGroesse(m.titelbild, 1200) } : {}),
      ...(m.einzugsgebiet.length ? { areaServed: m.einzugsgebiet } : {}),
      ...(kanonischBasis ? { url: kanon('/') } : {}),
    };
    const titel = m.gewerk && m.ort ? `${m.name} – ${m.gewerk} in ${m.ort}` : m.name;
    return { status: 200, html: rahmen(m, { titel, beschreibung, kanonisch: kanon('/'), basis, inhalt: startseite(m, basis), jsonLd, robots }) };
  }
  if (p === '/impressum') return { status: 200, html: rahmen(m, { titel: `Impressum – ${m.name}`, beschreibung: `Impressum von ${m.name}`, kanonisch: kanon('/impressum'), basis, inhalt: impressumSeite(m), robots: robots || 'noindex' }) };
  if (p === '/datenschutz') return { status: 200, html: rahmen(m, { titel: `Datenschutz – ${m.name}`, beschreibung: `Datenschutzerklärung von ${m.name}`, kanonisch: kanon('/datenschutz'), basis, inhalt: datenschutzSeite(m), robots: robots || 'noindex' }) };
  return { status: 404, html: rahmen(m, { titel: `Seite nicht gefunden – ${m.name}`, beschreibung: m.name, basis, robots: 'noindex', inhalt: `<main class="recht"><div class="w"><h1>Seite nicht gefunden</h1><p><a href="${esc(basis || '/')}">Zur Startseite</a></p></div></main>` }) };
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
