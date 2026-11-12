/*
 * Analyse im Admin (Paket B) — GA4 + Search Console + Produkt-Funnel.
 *
 * Reines JavaScript: Zeitraeume, Anfragen an die Google-APIs (nur die
 * Koerper, kein fetch), Auswertung der Antworten, Produkt-Funnel aus
 * Datenbankzeilen. admin-ops importiert diese Datei (wie adminOps.js)
 * und holt nur die Daten. Jest prueft hier die Rechnung.
 *
 * Muster wie sarahiver/si-superadmin api/analytics.js:
 *   • GA4: N VOLLE Tage bis gestern, Vorperiode gleich lang davor.
 *   • GSC: Google liefert die letzten ~3 Tage unvollstaendig; das
 *     Fenster endet vor 3 Tagen, gleiche Laenge N, Vorperiode davor.
 *
 * Datenschutz: Es wird nichts personenbezogenes angezeigt. GA4 liefert
 * Aggregate; GSC Suchbegriffe und Seiten; der Produkt-Funnel nur Zahlen.
 */

import { hasPaidAccess } from './subscription.js';

export const ZEITRAEUME = [7, 28, 90];
export const STANDARD_ZEITRAUM = 28;

/* Reihenfolge = Funnel. smartcheck_* fehlt bewusst: kein oeffentlicher
   SmartCheck live (Paket A), die Zahl waere immer 0 und wuerde luegen. */
export const FUNNEL_SCHRITTE = [
  { event: 'signup_start', label: 'Registrierung begonnen' },
  { event: 'signup_complete', label: 'Registrierung abgeschlossen' },
  { event: 'google_connect_start', label: 'Google-Verbindung begonnen' },
  { event: 'google_connect_success', label: 'Google verbunden' },
  { event: 'checkout_start', label: 'Bezahlung begonnen' },
  { event: 'checkout_success', label: 'Bezahlt' },
];

/* ── Datum (Europe/Berlin = Zeitzone der GA4-Property) ── */
export function berlinHeute(jetzt = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(jetzt);
}
export function plusTage(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/* Berliner Mitternacht als UTC-Zeitstempel (fuer created_at-Filter). */
export function berlinMitternachtUtc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const schaetzung = Date.UTC(y, m - 1, d);
  const stunde = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(schaetzung)));
  return new Date(schaetzung - stunde * 3600000).toISOString();
}

export function pruefeZeitraum(roh) {
  const n = Number(roh);
  return ZEITRAEUME.includes(n) ? n : null;
}

export function zeitraeume(n, heute = berlinHeute()) {
  const aktuell = { start: plusTage(heute, -n), end: plusTage(heute, -1) };
  const vorher = { start: plusTage(heute, -2 * n), end: plusTage(heute, -n - 1) };
  const gscEnde = plusTage(heute, -3);
  const gsc = { start: plusTage(gscEnde, -(n - 1)), end: gscEnde };
  const gscVorher = { start: plusTage(gsc.start, -n), end: plusTage(gsc.start, -1) };
  return { tage: n, aktuell, vorher, gsc, gscVorher };
}

/* ── GA4 Data API: Anfragekoerper ── */
const range = (r) => ({ startDate: r.start, endDate: r.end });

export function ga4Anfragen(z) {
  return {
    summen: {
      dateRanges: [range(z.aktuell), range(z.vorher)],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'engagementRate' }],
    },
    verlauf: {
      dateRanges: [range(z.aktuell)],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 400,
    },
    seiten: {
      dateRanges: [range(z.aktuell)],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    },
    kanaele: {
      dateRanges: [range(z.aktuell)],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8,
    },
    geraete: {
      dateRanges: [range(z.aktuell)],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 5,
    },
    funnel: {
      dateRanges: [range(z.aktuell)],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: FUNNEL_SCHRITTE.map((s) => s.event) } } },
      limit: 20,
    },
  };
}

/* ── GSC Search Analytics: Anfragekoerper ── */
export function gscAnfragen(z) {
  const basis = { type: 'web', dataState: 'final' };
  return {
    summen: { ...basis, startDate: z.gsc.start, endDate: z.gsc.end },
    summenVorher: { ...basis, startDate: z.gscVorher.start, endDate: z.gscVorher.end },
    verlauf: { ...basis, startDate: z.gsc.start, endDate: z.gsc.end, dimensions: ['date'], rowLimit: 400 },
    anfragen: { ...basis, startDate: z.gsc.start, endDate: z.gsc.end, dimensions: ['query'], rowLimit: 10 },
    seiten: { ...basis, startDate: z.gsc.start, endDate: z.gsc.end, dimensions: ['page'], rowLimit: 10 },
  };
}

/* ── Auswertung ── */
const zahl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* Veraenderung in Prozent; null, wenn die Vorperiode 0 ist (keine
   „+∞ %"). */
export function veraenderung(jetzt, vorher) {
  if (!Number.isFinite(jetzt) || !Number.isFinite(vorher) || vorher === 0) return null;
  return Math.round(((jetzt - vorher) / vorher) * 1000) / 10;
}

/* GA4 runReport → Zeilen { dims[], mets[] }. Bei zwei dateRanges haengt
   GA4 die Dimension dateRange an; wir trennen danach. */
function ga4Zeilen(antwort) {
  return (antwort?.rows ?? []).map((r) => ({
    dims: (r.dimensionValues ?? []).map((d) => d.value),
    mets: (r.metricValues ?? []).map((m) => zahl(m.value)),
  }));
}

export function werteGa4Aus(a) {
  /* Summen: mit zwei Zeitraeumen kommen zwei Zeilen (date_range_0/1). */
  const summenZeilen = ga4Zeilen(a.summen);
  const nachRange = (name) => summenZeilen.find((z) => z.dims.includes(name))?.mets ?? [0, 0, 0, 0];
  const jetzt = summenZeilen.length === 1 && !summenZeilen[0].dims.length ? summenZeilen[0].mets : nachRange('date_range_0');
  const vorher = nachRange('date_range_1');
  const kpi = (i, label, format = 'zahl') => ({ label, wert: jetzt[i], vorher: vorher[i], veraenderung: veraenderung(jetzt[i], vorher[i]), format });

  const funnelRoh = new Map(ga4Zeilen(a.funnel).map((z) => [z.dims[0], { anzahl: z.mets[0], nutzer: z.mets[1] }]));

  return {
    kpis: [
      kpi(0, 'Nutzer'),
      kpi(1, 'Sitzungen'),
      kpi(2, 'Seitenaufrufe'),
      kpi(3, 'Interaktionsrate', 'prozent'),
    ],
    verlauf: ga4Zeilen(a.verlauf).map((z) => ({
      datum: `${z.dims[0].slice(0, 4)}-${z.dims[0].slice(4, 6)}-${z.dims[0].slice(6, 8)}`,
      nutzer: z.mets[0], sitzungen: z.mets[1],
    })),
    seiten: ga4Zeilen(a.seiten).map((z) => ({ pfad: z.dims[0], aufrufe: z.mets[0], nutzer: z.mets[1] })),
    kanaele: ga4Zeilen(a.kanaele).map((z) => ({ kanal: z.dims[0], sitzungen: z.mets[0], nutzer: z.mets[1] })),
    geraete: ga4Zeilen(a.geraete).map((z) => ({ geraet: z.dims[0], nutzer: z.mets[0] })),
    funnel: FUNNEL_SCHRITTE.map((s) => ({ ...s, anzahl: funnelRoh.get(s.event)?.anzahl ?? 0, nutzer: funnelRoh.get(s.event)?.nutzer ?? 0 })),
  };
}

export function werteGscAus(a) {
  const summe = (antwort) => {
    const r = antwort?.rows?.[0] ?? {};
    return { klicks: zahl(r.clicks), impressionen: zahl(r.impressions), ctr: zahl(r.ctr), position: zahl(r.position) };
  };
  const jetzt = summe(a.summen);
  const vorher = summe(a.summenVorher);
  const kpi = (k, label, format) => ({ label, wert: jetzt[k], vorher: vorher[k], veraenderung: veraenderung(jetzt[k], vorher[k]), format });
  const zeilen = (antwort, feld) => (antwort?.rows ?? []).map((r) => ({
    [feld]: r.keys?.[0] ?? '', klicks: zahl(r.clicks), impressionen: zahl(r.impressions), ctr: zahl(r.ctr), position: zahl(r.position),
  }));
  return {
    kpis: [
      kpi('klicks', 'Klicks', 'zahl'),
      kpi('impressionen', 'Impressionen', 'zahl'),
      kpi('ctr', 'Klickrate', 'anteil'),
      /* Position: kleiner ist besser — die UI wertet die Richtung um. */
      { ...kpi('position', 'Ø Position', 'position'), kleinerIstBesser: true },
    ],
    verlauf: zeilen(a.verlauf, 'datum').map((z) => ({ datum: z.datum, klicks: z.klicks, impressionen: z.impressionen })),
    anfragen: zeilen(a.anfragen, 'anfrage'),
    seiten: zeilen(a.seiten, 'seite').map((z) => ({ ...z, seite: kuerzeUrl(z.seite) })),
  };
}

export function kuerzeUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname || '/';
  } catch {
    return String(url ?? '');
  }
}

/**
 * Produkt-Funnel aus der eigenen Datenbank — vollstaendig, unabhaengig
 * von der GA-Einwilligung. Kohorte: Konten, die im Zeitraum angelegt
 * wurden; je Stufe, wie viele davon sie HEUTE erreicht haben.
 *
 * @param {Array<{id:string, accepted_terms_at?:string|null, plan?:string, stripe_subscription_id?:string|null, stripe_subscription_status?:string|null, trial_ends_at?:string|null}>} profile
 * @param {Set<string>} verbundene  user_ids mit aktiver Google-Verbindung
 */
export function produktFunnel(profile, verbundene, jetzt = new Date()) {
  const liste = Array.isArray(profile) ? profile : [];
  const zaehle = (fn) => liste.filter(fn).length;
  return [
    { schritt: 'registriert', label: 'Konto angelegt', anzahl: liste.length },
    { schritt: 'bedingungen', label: 'Bedingungen akzeptiert', anzahl: zaehle((p) => Boolean(p.accepted_terms_at)) },
    { schritt: 'google', label: 'Google verbunden', anzahl: zaehle((p) => verbundene.has(p.id)) },
    { schritt: 'bezahlt', label: 'Bezahlter Zugang', anzahl: zaehle((p) => hasPaidAccess(p, jetzt)) },
  ];
}

/* Welche Secrets fehlen — Namen, nie Werte. */
export function fehlendeKonfiguration(env) {
  const fehlt = [];
  if (!env.GA4_PROPERTY_ID || !/^\d{5,15}$/.test(String(env.GA4_PROPERTY_ID).trim())) fehlt.push('GA4_PROPERTY_ID');
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) fehlt.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!env.GSC_SITE_URL) fehlt.push('GSC_SITE_URL');
  return fehlt;
}

/* Service-Account-JSON lesen, ohne den Schluessel je auszugeben. */
export function leseServiceAccount(json) {
  try {
    const sa = JSON.parse(json);
    if (typeof sa?.client_email === 'string' && typeof sa?.private_key === 'string' && sa.private_key.includes('PRIVATE KEY')) {
      return { clientEmail: sa.client_email, privateKey: sa.private_key };
    }
  } catch { /* unten */ }
  return null;
}

export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly';
