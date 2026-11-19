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

/* Unter dieser Menge (in BEIDEN Zeitraeumen) ist ein Prozentvergleich
   Zufall: 2 statt 4 Klicks waeren „50 % schlechter". Basis ist die
   Menge, aus der die Kennzahl entsteht — bei Zaehlwerten der Wert
   selbst, bei Quoten und Position die Grundgesamtheit (Sitzungen bzw.
   Impressionen). */
export const MIN_VERGLEICH = 20;

/**
 * Kennzahl mit ehrlichem Vergleich.
 *   vergleich: 'ok' | 'keine_vorperiode' | 'zu_wenig'
 *   veraenderung: % (nur bei 'ok' und nicht bei Position)
 *   differenz: absolute Differenz (Position: Plaetze, + = schlechter)
 */
export function kennzahl({ label, wert, vorher, format = 'zahl', basisJetzt = wert, basisVorher = vorher, kleinerIstBesser = false }) {
  const k = { label, wert, vorher, format };
  if (kleinerIstBesser) k.kleinerIstBesser = true;
  let vergleich = 'ok';
  if (!Number.isFinite(vorher) || vorher === 0 || !Number.isFinite(basisVorher) || basisVorher === 0) vergleich = 'keine_vorperiode';
  else if (Math.min(basisJetzt, basisVorher) < MIN_VERGLEICH) vergleich = 'zu_wenig';
  k.vergleich = vergleich;
  if (format === 'position') {
    k.veraenderung = null;
    k.differenz = vergleich === 'ok' ? Math.round((wert - vorher) * 10) / 10 : null;
  } else {
    k.veraenderung = vergleich === 'ok' ? veraenderung(wert, vorher) : null;
  }
  return k;
}

/* Tage ohne Daten liefern GA4 und Search Console gar nicht — fuer
   Verlauf und Tagestabelle jeden Tag des Zeitraums mit 0 auffuellen. */
export function fuelleTage(punkte, start, end, felder) {
  if (!start || !end) return punkte;
  const nachDatum = new Map((punkte || []).map((p) => [p.datum, p]));
  const aus = [];
  for (let d = start; d <= end; d = plusTage(d, 1)) {
    const p = nachDatum.get(d);
    aus.push(p || Object.fromEntries([['datum', d], ...felder.map((f) => [f, 0])]));
    if (aus.length > 400) break;
  }
  return aus;
}

/* GA4 runReport → Zeilen { dims[], mets[] }. Bei zwei dateRanges haengt
   GA4 die Dimension dateRange an; wir trennen danach. */
function ga4Zeilen(antwort) {
  return (antwort?.rows ?? []).map((r) => ({
    dims: (r.dimensionValues ?? []).map((d) => d.value),
    mets: (r.metricValues ?? []).map((m) => zahl(m.value)),
  }));
}

export function werteGa4Aus(a, z = null) {
  /* Summen: mit zwei Zeitraeumen kommen zwei Zeilen (date_range_0/1). */
  const summenZeilen = ga4Zeilen(a.summen);
  const nachRange = (name) => summenZeilen.find((z) => z.dims.includes(name))?.mets ?? [0, 0, 0, 0];
  const jetzt = summenZeilen.length === 1 && !summenZeilen[0].dims.length ? summenZeilen[0].mets : nachRange('date_range_0');
  const vorher = nachRange('date_range_1');
  /* Interaktionsrate: Basis sind die Sitzungen (Index 1). */
  const kpi = (i, label, format = 'zahl') => kennzahl({
    label, wert: jetzt[i], vorher: vorher[i], format,
    basisJetzt: format === 'prozent' ? jetzt[1] : jetzt[i], basisVorher: format === 'prozent' ? vorher[1] : vorher[i],
  });

  const funnelRoh = new Map(ga4Zeilen(a.funnel).map((z) => [z.dims[0], { anzahl: z.mets[0], nutzer: z.mets[1] }]));

  return {
    kpis: [
      kpi(0, 'Nutzer'),
      kpi(1, 'Sitzungen'),
      kpi(2, 'Seitenaufrufe'),
      kpi(3, 'Interaktionsrate', 'prozent'),
    ],
    verlauf: fuelleTage(ga4Zeilen(a.verlauf).map((r) => ({
      datum: `${r.dims[0].slice(0, 4)}-${r.dims[0].slice(4, 6)}-${r.dims[0].slice(6, 8)}`,
      nutzer: r.mets[0], sitzungen: r.mets[1],
    })), z?.aktuell?.start, z?.aktuell?.end, ['nutzer', 'sitzungen']),
    seiten: ga4Zeilen(a.seiten).map((z) => ({ pfad: z.dims[0], aufrufe: z.mets[0], nutzer: z.mets[1] })),
    kanaele: ga4Zeilen(a.kanaele).map((z) => ({ kanal: z.dims[0], sitzungen: z.mets[0], nutzer: z.mets[1] })),
    geraete: ga4Zeilen(a.geraete).map((z) => ({ geraet: z.dims[0], nutzer: z.mets[0] })),
    funnel: FUNNEL_SCHRITTE.map((s) => ({ ...s, anzahl: funnelRoh.get(s.event)?.anzahl ?? 0, nutzer: funnelRoh.get(s.event)?.nutzer ?? 0 })),
  };
}

export function werteGscAus(a, z = null) {
  const summe = (antwort) => {
    const r = antwort?.rows?.[0] ?? {};
    return { klicks: zahl(r.clicks), impressionen: zahl(r.impressions), ctr: zahl(r.ctr), position: zahl(r.position) };
  };
  const jetzt = summe(a.summen);
  const vorher = summe(a.summenVorher);
  /* Klickrate und Position: Basis sind die Impressionen. */
  const kpi = (k, label, format, extra = {}) => kennzahl({
    label, wert: jetzt[k], vorher: vorher[k], format,
    basisJetzt: k === 'ctr' || k === 'position' ? jetzt.impressionen : jetzt[k],
    basisVorher: k === 'ctr' || k === 'position' ? vorher.impressionen : vorher[k],
    ...extra,
  });
  const zeilen = (antwort, feld) => (antwort?.rows ?? []).map((r) => ({
    [feld]: r.keys?.[0] ?? '', klicks: zahl(r.clicks), impressionen: zahl(r.impressions), ctr: zahl(r.ctr), position: zahl(r.position),
  }));
  return {
    kpis: [
      kpi('klicks', 'Klicks', 'zahl'),
      kpi('impressionen', 'Impressionen', 'zahl'),
      kpi('ctr', 'Klickrate', 'anteil'),
      /* Position: kleiner ist besser; Vergleich in Plaetzen, nicht in %. */
      kpi('position', 'Ø Position', 'position', { kleinerIstBesser: true }),
    ],
    verlauf: fuelleTage(zeilen(a.verlauf, 'datum').map((r) => ({ datum: r.datum, klicks: r.klicks, impressionen: r.impressionen })),
      z?.gsc?.start, z?.gsc?.end, ['klicks', 'impressionen']),
    anfragen: zeilen(a.anfragen, 'anfrage'),
    seiten: seitenAnzeigen(zeilen(a.seiten, 'url')),
  };
}

/* Seiten-Spalte: nur der Pfad — ausser die Liste enthaelt mehrere
   Hosts (z. B. werkruf.com und www.werkruf.com). Dann steht der Host
   davor, sonst saehe man zweimal „/". */
export function seitenAnzeigen(zeilen) {
  const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
  const hosts = new Set(zeilen.map((r) => host(r.url)).filter(Boolean));
  return zeilen.map((r) => ({ ...r, seite: hosts.size > 1 && host(r.url) ? `${host(r.url)}${kuerzeUrl(r.url)}` : kuerzeUrl(r.url) }));
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

/* ── Bericht zum Herunterladen (PDF) ──
   Reine Aufbereitung der Antwort von analytics_overview in Abschnitte
   mit Tabellen. Das PDF (components/admin/AnalyseBerichtPDF.js) setzt
   nur noch Text — gerechnet und formuliert wird hier (Jest).
   Keine Zahl wird geschaetzt: fehlt eine Quelle, steht der Grund da. */
const zf = new Intl.NumberFormat('de-DE');
const zf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const zfv = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const deDatum = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };

export function formatiereWert(wert, format) {
  if (wert == null || Number.isNaN(wert)) return '—';
  if (format === 'prozent' || format === 'anteil') return `${zf1.format(wert * 100)} %`;
  if (format === 'position') return zf1.format(wert);
  return zf.format(Math.round(wert));
}

/* Vergleichstext — dieselbe Logik fuer Admin-Ansicht und PDF. */
export function vergleichText(k, { pfeil = true } = {}) {
  if (k.vergleich === 'keine_vorperiode') return 'kein Vergleich';
  if (k.vergleich === 'zu_wenig') return 'zu wenig Daten für Vergleich';
  if (k.format === 'position') {
    if (k.differenz == null) return 'kein Vergleich';
    if (k.differenz === 0) return 'unverändert';
    const besser = k.differenz < 0;
    return `${zfv.format(Math.abs(k.differenz))} Plätze ${besser ? 'besser' : 'schlechter'}`;
  }
  const v = k.veraenderung;
  if (v == null) return 'kein Vergleich';
  if (v === 0) return 'unverändert';
  const besser = k.kleinerIstBesser ? v < 0 : v > 0;
  /* Im PDF ohne Pfeil: die Standardschrift Helvetica hat kein ▲/▼. */
  const vz = v > 0 ? '+' : '-';
  return pfeil
    ? `${v > 0 ? '▲' : '▼'} ${zfv.format(Math.abs(v))} % ${besser ? 'besser' : 'schlechter'}`
    : `${vz}${zfv.format(Math.abs(v))} % (${besser ? 'besser' : 'schlechter'})`;
}

function quelleGrund(q) {
  if (!q) return 'Keine Daten geladen.';
  if (q.status === 'nicht_konfiguriert') return `Noch nicht eingerichtet (fehlt: ${q.fehlt.join(', ')}).`;
  if (q.status === 'fehler') return `Konnte nicht geladen werden (Code ${q.code}).`;
  return null;
}
const kpiTabelle = (kpis) => ({
  kopf: ['Kennzahl', 'Zeitraum', 'Vorperiode', 'Vergleich'],
  zeilen: kpis.map((k) => [k.label, formatiereWert(k.wert, k.format), k.vergleich === 'keine_vorperiode' ? '—' : formatiereWert(k.vorher, k.format), vergleichText(k, { pfeil: false })]),
  rechts: [1, 2],
});
const quote = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');

/**
 * @param {object} daten  Antwort von analytics_overview
 * @param {Date} [erstellt]
 * @returns {{ titel:string, untertitel:string, dateiname:string, abschnitte:Array<{titel:string, hinweis?:string, grund?:string, tabellen:Array<{titel?:string, kopf:string[], zeilen:string[][], rechts?:number[]}>}> }}
 */
export function berichtInhalt(daten, erstellt = new Date()) {
  const z = daten?.zeitraum;
  const ab = [];
  const p = daten?.produkt?.status === 'ok' ? daten.produkt.daten : null;
  ab.push({
    titel: 'Produkt-Funnel (Datenbank)',
    hinweis: 'Konten, die im Zeitraum angelegt wurden, und wie weit sie heute sind. Vollständig, unabhängig von der Cookie-Einwilligung.',
    grund: p ? undefined : quelleGrund(daten?.produkt),
    tabellen: p ? [{ kopf: ['Stufe', 'Anzahl', 'Anteil vorherige Stufe'], rechts: [1, 2],
      zeilen: p.map((s, i) => [s.label, zf.format(s.anzahl), i ? quote(s.anzahl, p[i - 1].anzahl) : '']) }] : [],
  });

  const g = daten?.ga4?.status === 'ok' ? daten.ga4.daten : null;
  ab.push({
    titel: 'Website (GA4)',
    hinweis: z ? `${deDatum(z.aktuell.start)}–${deDatum(z.aktuell.end)}, Vorperiode ${deDatum(z.vorher.start)}–${deDatum(z.vorher.end)}. Nur Besucher, die im Cookie-Banner zugestimmt haben — die echten Zahlen sind höher.` : undefined,
    grund: g ? undefined : quelleGrund(daten?.ga4),
    tabellen: g ? [
      { titel: 'Kennzahlen', ...kpiTabelle(g.kpis) },
      { titel: 'Funnel (GA4-Ereignisse)', kopf: ['Schritt', 'Anzahl', 'Nutzer', 'Anteil vorherige Stufe'], rechts: [1, 2, 3],
        zeilen: g.funnel.map((f, i) => [f.label, zf.format(f.anzahl), zf.format(f.nutzer ?? 0), i ? quote(f.anzahl, g.funnel[i - 1].anzahl) : '']) },
      { titel: 'Seiten', kopf: ['Seite', 'Aufrufe', 'Nutzer'], rechts: [1, 2], zeilen: g.seiten.map((r) => [r.pfad, zf.format(r.aufrufe), zf.format(r.nutzer)]) },
      { titel: 'Herkunft', kopf: ['Kanal', 'Sitzungen', 'Nutzer'], rechts: [1, 2], zeilen: g.kanaele.map((r) => [r.kanal, zf.format(r.sitzungen), zf.format(r.nutzer)]) },
      { titel: 'Geräte', kopf: ['Gerät', 'Nutzer'], rechts: [1], zeilen: (g.geraete || []).map((r) => [r.geraet, zf.format(r.nutzer)]) },
      { titel: 'Je Tag', kopf: ['Datum', 'Nutzer', 'Sitzungen'], rechts: [1, 2], zeilen: g.verlauf.map((r) => [deDatum(r.datum), zf.format(r.nutzer), zf.format(r.sitzungen)]) },
    ] : [],
  });

  const s = daten?.gsc?.status === 'ok' ? daten.gsc.daten : null;
  ab.push({
    titel: 'Google-Suche (Search Console)',
    hinweis: z ? `${deDatum(z.gsc.start)}–${deDatum(z.gsc.end)}, Vorperiode ${deDatum(z.gscVorher.start)}–${deDatum(z.gscVorher.end)}. Die letzten 3 Tage fehlen, weil Google sie noch unvollständig liefert.` : undefined,
    grund: s ? undefined : quelleGrund(daten?.gsc),
    tabellen: s ? [
      { titel: 'Kennzahlen', ...kpiTabelle(s.kpis) },
      { titel: 'Suchanfragen', kopf: ['Suchanfrage', 'Klicks', 'Impr.', 'Klickrate', 'Pos.'], rechts: [1, 2, 3, 4],
        zeilen: s.anfragen.map((r) => [r.anfrage, zf.format(r.klicks), zf.format(r.impressionen), formatiereWert(r.ctr, 'anteil'), zf1.format(r.position)]) },
      { titel: 'Seiten', kopf: ['Seite', 'Klicks', 'Impr.', 'Klickrate', 'Pos.'], rechts: [1, 2, 3, 4],
        zeilen: s.seiten.map((r) => [r.url || r.seite, zf.format(r.klicks), zf.format(r.impressionen), formatiereWert(r.ctr, 'anteil'), zf1.format(r.position)]) },
      { titel: 'Je Tag', kopf: ['Datum', 'Klicks', 'Impressionen'], rechts: [1, 2], zeilen: s.verlauf.map((r) => [deDatum(r.datum), zf.format(r.klicks), zf.format(r.impressionen)]) },
    ] : [],
  });

  const tage = z?.tage ?? '';
  const stand = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(erstellt);
  return {
    titel: `WERKRUF · Analyse ${tage} Tage`,
    untertitel: z ? `Website ${deDatum(z.aktuell.start)}–${deDatum(z.aktuell.end)} · Google-Suche ${deDatum(z.gsc.start)}–${deDatum(z.gsc.end)} · erstellt ${stand}` : `erstellt ${stand}`,
    dateiname: z ? `werkruf-analyse-${tage}-tage-${z.aktuell.start}_${z.aktuell.end}.pdf` : 'werkruf-analyse.pdf',
    abschnitte: ab,
  };
}
