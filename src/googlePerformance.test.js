/**
 * WP5 — Google-Leistungsdaten: Parser, Zusammenfuehrung, Vergleich,
 * Mail-Block und die Verdrahtung in den Edge Functions.
 *
 * Nummern wie im Brief:
 *   T1–T5   Parser
 *   T2, T13, T15, T23  Aggregation/Vergleich (JS-Anteil; Summen testet SQL)
 *   T16–T20 Sync — Struktur in google-business/index.ts, Fehlerdeutung real
 *   T21–T25 Mail
 *
 * Reale Wirkung, wo immer moeglich: Die Funktionen laufen hier wirklich.
 * Nur die Verdrahtung in TypeScript wird am Quelltext geprueft, weil
 * Jest Deno-Module nicht laedt.
 */
import fs from 'fs';
import path from 'path';
import {
  LEISTUNGS_METRIKEN, AUFRUF_METRIKEN, KENNZAHLEN,
  datumAlsIso, parseLeistungsantwort, deutetAufDeaktivierteApi,
  vergleiche, baueGoogleWoche, googleWocheHtml, formatZahl, formatZeitraum,
  KEINE_DATEN_SATZ,
} from './utils/googlePerformance';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

/* ── Google-Antwort bauen ── */
const tag = (iso, value) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dv = { date: { year: y, month: m, day: d } };
  if (value !== undefined) dv.value = String(value);
  return dv;
};
const reihe = (dailyMetric, datedValues) => ({ dailyMetric, timeSeries: { datedValues } });
const antwort = (...reihen) => ({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: reihen }] });

describe('Metriken', () => {
  it('keine veralteten Metriken im Abruf', () => {
    expect(LEISTUNGS_METRIKEN).not.toContain('BUSINESS_CONVERSATIONS');
    expect(LEISTUNGS_METRIKEN).not.toContain('BUSINESS_FOOD_ORDERS');
    expect(LEISTUNGS_METRIKEN).toHaveLength(7);
    expect(AUFRUF_METRIKEN).toHaveLength(4);
    AUFRUF_METRIKEN.forEach((m) => expect(LEISTUNGS_METRIKEN).toContain(m));
  });

  it('Handwerkssprache in der Mail, keine API-Namen', () => {
    expect(KENNZAHLEN.map((k) => k.label)).toEqual(['Aufrufe', 'Anrufe', 'Website-Klicks', 'Routenanfragen']);
  });
});

describe('T1 — Parser liest alle relevanten Metriken', () => {
  it('alle sieben Metriken, alle Tage, Werte als Zahl', () => {
    const a = antwort(...LEISTUNGS_METRIKEN.map((m, i) => reihe(m, [tag('2026-11-01', 10 + i), tag('2026-11-02', 20 + i)])));
    const r = parseLeistungsantwort(a);
    expect(r.zeilen).toHaveLength(14);
    expect(r.unbekannt).toEqual([]);
    expect(r.ohneDaten).toEqual([]);
    const calls = r.zeilen.filter((z) => z.metric === 'CALL_CLICKS');
    expect(calls).toEqual([
      { metric: 'CALL_CLICKS', date: '2026-11-01', value: 10 },
      { metric: 'CALL_CLICKS', date: '2026-11-02', value: 20 },
    ]);
    expect(typeof r.zeilen[0].value).toBe('number');
  });

  it('Datumsobjekt → ISO, ungueltige Daten werden abgelehnt', () => {
    expect(datumAlsIso({ year: 2026, month: 1, day: 5 })).toBe('2026-01-05');
    expect(datumAlsIso({ year: 2026, month: 2, day: 31 })).toBeNull();
    expect(datumAlsIso({ year: 2026, month: 13, day: 1 })).toBeNull();
    expect(datumAlsIso(null)).toBeNull();
  });
});

describe('T3 — fehlende Werte sind nicht blind Null', () => {
  it('Tag ohne value = 0 (Googles dokumentierte Null), Tag ohne date = keine Zeile', () => {
    const r = parseLeistungsantwort(antwort(reihe('CALL_CLICKS', [
      tag('2026-11-01'),                        // value fehlt → 0
      { value: '7' },                           // date fehlt → verworfen
      tag('2026-11-03', 3),
    ])));
    expect(r.zeilen).toEqual([
      { metric: 'CALL_CLICKS', date: '2026-11-01', value: 0 },
      { metric: 'CALL_CLICKS', date: '2026-11-03', value: 3 },
    ]);
    expect(r.verworfen).toBe(1);
    /* Der 2.11. existiert nicht als Zeile — nicht als 0. */
    expect(r.zeilen.find((z) => z.date === '2026-11-02')).toBeUndefined();
  });

  it('unbrauchbare Werte (NaN, negativ) werden verworfen, nicht zu 0', () => {
    const r = parseLeistungsantwort(antwort(reihe('WEBSITE_CLICKS', [
      { date: { year: 2026, month: 11, day: 1 }, value: 'abc' },
      { date: { year: 2026, month: 11, day: 2 }, value: '-4' },
      { date: { year: 2026, month: 11, day: 3 }, value: 12 },
    ])));
    expect(r.zeilen).toEqual([{ metric: 'WEBSITE_CLICKS', date: '2026-11-03', value: 12 }]);
    expect(r.verworfen).toBe(2);
  });
});

describe('T4 — Metrik ohne Datenpunkte', () => {
  it('kein Absturz, Metrik steht in ohneDaten', () => {
    const r = parseLeistungsantwort(antwort(
      reihe('CALL_CLICKS', []),
      { dailyMetric: 'WEBSITE_CLICKS', timeSeries: {} },
      { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS' },
      reihe('BUSINESS_IMPRESSIONS_MOBILE_MAPS', [tag('2026-11-01', 5)]),
    ));
    expect(r.zeilen).toHaveLength(1);
    expect(r.ohneDaten.sort()).toEqual(['BUSINESS_DIRECTION_REQUESTS', 'CALL_CLICKS', 'WEBSITE_CLICKS']);
  });

  it('leere oder kaputte Antwort → nichts, kein Fehler', () => {
    expect(parseLeistungsantwort({}).zeilen).toEqual([]);
    expect(parseLeistungsantwort(null).zeilen).toEqual([]);
    expect(parseLeistungsantwort({ multiDailyMetricTimeSeries: 'x' }).zeilen).toEqual([]);
    expect(parseLeistungsantwort({ multiDailyMetricTimeSeries: [{}] }).zeilen).toEqual([]);
  });
});

describe('T5 — unbekannte Metrik', () => {
  it('wird gezaehlt und uebersprungen, Rest bleibt', () => {
    const r = parseLeistungsantwort(antwort(
      reihe('BUSINESS_FOOD_ORDERS', [tag('2026-11-01', 99)]),
      reihe('NEUE_METRIK_2027', [tag('2026-11-01', 1)]),
      reihe('CALL_CLICKS', [tag('2026-11-01', 2)]),
    ));
    expect(r.zeilen).toEqual([{ metric: 'CALL_CLICKS', date: '2026-11-01', value: 2 }]);
    expect(r.unbekannt.sort()).toEqual(['BUSINESS_FOOD_ORDERS', 'NEUE_METRIK_2027']);
  });
});

/* ── Vergleich ── */
describe('T13 — Vergleichsregeln ohne Infinity/NaN', () => {
  it('12 → 15 = +3 (+25 %)', () => {
    expect(vergleiche(15, 12)).toMatchObject({ delta: 3, prozent: 25, text: '+3 (+25 %)' });
  });
  it('5 → 0 = −5 (−100 %)', () => {
    expect(vergleiche(0, 5)).toMatchObject({ delta: -5, prozent: -100, text: '−5 (−100 %)' });
  });
  it('0 → 5 = +5 ohne Prozent', () => {
    const v = vergleiche(5, 0);
    expect(v).toMatchObject({ delta: 5, prozent: null, text: '+5' });
    expect(Number.isFinite(v.prozent) || v.prozent === null).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/Infinity|NaN/);
  });
  it('0 → 0 = unveraendert', () => {
    expect(vergleiche(0, 0)).toMatchObject({ delta: 0, prozent: 0, text: 'unverändert' });
  });
  it('Vorperiode unbekannt → kein Vergleich, aktuell bleibt', () => {
    expect(vergleiche(7, null)).toMatchObject({ aktuell: 7, vorher: null, delta: null, prozent: null, text: 'kein Vergleich' });
  });
  it('grosse Zahlen mit Tausenderpunkt', () => {
    expect(vergleiche(1240, 1000).text).toBe('+240 (+24 %)');
    expect(formatZahl(1240)).toBe('1.240');
    expect(formatZahl(1234567)).toBe('1.234.567');
    expect(formatZahl(NaN)).toBe('—');
  });
});

/* ── Zusammenfuehrung ── */
const summe = (n, tage = 7) => ({ summe: n, tage });
const okZusammenfassung = (aktuell, vorher) => ({
  status: 'ok',
  zeitraum: { von: '2026-10-27', bis: '2026-11-02' },
  vorzeitraum: { von: '2026-10-20', bis: '2026-10-26' },
  aktuell, vorher,
});

describe('T2 — Aufrufe = Summe der vier Impressions-Metriken', () => {
  it('Desktop/Mobile × Maps/Suche werden zusammengefuehrt', () => {
    const block = baueGoogleWoche(okZusammenfassung({
      BUSINESS_IMPRESSIONS_DESKTOP_MAPS:   summe(100),
      BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: summe(200),
      BUSINESS_IMPRESSIONS_MOBILE_MAPS:    summe(300),
      BUSINESS_IMPRESSIONS_MOBILE_SEARCH:  summe(640),
      CALL_CLICKS: summe(7), WEBSITE_CLICKS: summe(18), BUSINESS_DIRECTION_REQUESTS: summe(12),
    }, {
      BUSINESS_IMPRESSIONS_DESKTOP_MAPS:   summe(90),
      BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: summe(180),
      BUSINESS_IMPRESSIONS_MOBILE_MAPS:    summe(270),
      BUSINESS_IMPRESSIONS_MOBILE_SEARCH:  summe(560),
      CALL_CLICKS: summe(7), WEBSITE_CLICKS: summe(20), BUSINESS_DIRECTION_REQUESTS: summe(0),
    }));
    expect(block.status).toBe('ok');
    expect(block.zeitraumText).toBe('27.10.–02.11.');
    const aufrufe = block.kennzahlen.find((k) => k.key === 'aufrufe');
    expect(aufrufe).toMatchObject({ aktuell: 1240, vorher: 1100, delta: 140, prozent: 13 });
    /* nicht vier Impression-Typen einzeln */
    expect(block.kennzahlen.map((k) => k.key)).toEqual(['aufrufe', 'anrufe', 'websiteKlicks', 'routen']);
    expect(block.kennzahlen.find((k) => k.key === 'routen')).toMatchObject({ aktuell: 12, vorher: 0, prozent: null, vergleichText: '+12' });
  });
});

describe('T15 — teilweise fehlende Metriken', () => {
  it('eine Kennzahl ohne Metrik fehlt in der Liste statt 0 zu sein', () => {
    const block = baueGoogleWoche(okZusammenfassung(
      { CALL_CLICKS: summe(4), BUSINESS_IMPRESSIONS_MOBILE_SEARCH: summe(50) },
      { CALL_CLICKS: summe(2) },
    ));
    expect(block.kennzahlen.map((k) => k.key)).toEqual(['aufrufe', 'anrufe']);
    /* Aufrufe nur aus einer vorhandenen Impressions-Metrik; Vorwoche fehlt → kein Vergleich */
    expect(block.kennzahlen[0]).toMatchObject({ aktuell: 50, vorher: null, vergleichText: 'kein Vergleich' });
    expect(block.kennzahlen[1]).toMatchObject({ aktuell: 4, vorher: 2, vergleichText: '+2 (+100 %)' });
  });

  it('ok ohne eine einzige Metrik wird zu unvollstaendig', () => {
    expect(baueGoogleWoche(okZusammenfassung({}, {})).status).toBe('unvollstaendig');
  });

  it('keine_daten / unvollstaendig / fehlender Payload', () => {
    expect(baueGoogleWoche({ status: 'keine_daten' }).status).toBe('keine_daten');
    expect(baueGoogleWoche({ status: 'unvollstaendig' }).status).toBe('unvollstaendig');
    expect(baueGoogleWoche(undefined).status).toBe('keine_daten');
    expect(baueGoogleWoche(null).status).toBe('keine_daten');
  });
});

/* ── Mail ── */
describe('T21 — Mail-Block mit echten Werten', () => {
  const html = googleWocheHtml(baueGoogleWoche(okZusammenfassung(
    { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: summe(1240), CALL_CLICKS: summe(7), WEBSITE_CLICKS: summe(18), BUSINESS_DIRECTION_REQUESTS: summe(12) },
    { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: summe(1000), CALL_CLICKS: summe(7), WEBSITE_CLICKS: summe(20), BUSINESS_DIRECTION_REQUESTS: summe(0) },
  )));

  it('Ueberschrift, Zeitraum, vier Kacheln, Handwerkssprache', () => {
    expect(html).toContain('DEINE GOOGLE-WOCHE');
    expect(html).toContain('27.10.–02.11.');
    expect(html).toContain('data-google-woche="ok"');
    expect(html).toContain('>1.240<');
    expect(html).toContain('>Aufrufe<');
    expect(html).toContain('>7<');
    expect(html).toContain('>Anrufe<');
    expect(html).toContain('>18<');
    expect(html).toContain('>Website-Klicks<');
    expect(html).toContain('>12<');
    expect(html).toContain('>Routenanfragen<');
    expect(html).not.toMatch(/BUSINESS_IMPRESSIONS|CALL_CLICKS|Conversion|KPI/);
    expect((html.match(/data-kennzahl=/g) || []).length).toBe(4);
  });

  it('T23 — Vergleich zur Vorwoche korrekt dargestellt', () => {
    expect(html).toContain('+240 (+24 %)');          // Aufrufe
    expect(html).toContain('unverändert');           // Anrufe 7 → 7
    expect(html).toContain('−2 (−10 %)');            // Website 20 → 18
    expect(html).toContain('+12 &middot; Vorwoche 0'); // Routen 0 → 12, kein Prozent
    expect(html).not.toMatch(/Infinity|NaN|∞/);
  });

  it('keine Umsatz-/Auftragsversprechen', () => {
    expect(html).not.toMatch(/Kunden gebracht|Aufträge|Umsatz|€/);
  });
});

describe('T22 — ohne Daten keine Nullen', () => {
  it('keine_daten → kein Block', () => {
    expect(googleWocheHtml(baueGoogleWoche({ status: 'keine_daten' }))).toBe('');
    expect(googleWocheHtml(baueGoogleWoche(undefined))).toBe('');
  });
  it('unvollstaendig → der ehrliche Satz, keine 0', () => {
    const html = googleWocheHtml(baueGoogleWoche({ status: 'unvollstaendig' }));
    expect(html).toContain(KEINE_DATEN_SATZ);
    expect(html).toContain('data-google-woche="unvollstaendig"');
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain('data-kennzahl');
  });
  it('formatZeitraum vertraegt fehlende Werte', () => {
    expect(formatZeitraum('2026-10-27', '2026-11-02')).toBe('27.10.–02.11.');
    expect(formatZeitraum(undefined, undefined)).toBe('');
    expect(formatZeitraum('kaputt', '2026-11-02')).toBe('02.11.');
  });
});

describe('T24/T25 — Verdrahtung in send-email', () => {
  const mail = lies('../supabase/functions/send-email/index.ts');
  const weekly = mail.slice(mail.indexOf("case 'weekly_summary'"), mail.indexOf("case 'weekly_report'"));

  it('weekly_summary nutzt den Block aus googlePerformance.js — vor den Bewertungskacheln', () => {
    expect(mail).toMatch(/import \{ baueGoogleWoche, googleWocheHtml \} from '\.\.\/\.\.\/\.\.\/src\/utils\/googlePerformance\.js'/);
    expect(weekly).toMatch(/googleWocheHtml\(baueGoogleWoche\(data\.performance\)\)/);
    expect(weekly.indexOf('googleWoche +')).toBeGreaterThan(0);
    expect(weekly.indexOf('googleWoche +')).toBeLessThan(weekly.indexOf('tiles(['));
  });

  it('T24 — der uebrige Inhalt bleibt: Kacheln, Befund, Aufgaben, Profilwert, ein Knopf', () => {
    expect(weekly).toContain('tiles([');
    expect(weekly).toContain('insightBox(');
    expect(weekly).toContain('actionList(');
    expect(weekly).toContain('healthBox(');
    expect(weekly).toContain("url: `${brand.appUrl}/dashboard`");
    expect((weekly.match(/url:/g) || []).length).toBe(1);
  });

  it('T25 — keine zweite Performance-Mail: Vorlagenliste unveraendert', () => {
    expect(mail).not.toMatch(/'performance_report'|'google_week'|'weekly_performance'/);
    const vorlagen = mail.slice(mail.indexOf('type EmailTemplate'), mail.indexOf(';', mail.indexOf('type EmailTemplate')));
    expect(vorlagen).not.toMatch(/performance/i);
    const migration = lies('../supabase/migrations/20261109120000_performance_zahlen.sql');
    expect(migration).not.toMatch(/email_queue_template_check/);
    /* schedule_communications ist kopiert — mit genau den drei alten
       Vorlagen und keiner vierten. */
    const vorlagenInMigration = [...migration.matchAll(/enqueue_email\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(vorlagenInMigration).toEqual(['critical_review_alert', 'inactivity_reminder', 'weekly_summary']);
  });
});

/* ── Sync ── */
describe('T16–T20 — Sync-Verdrahtung in google-business', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  const service = gb.slice(gb.indexOf('class PerformanceSyncService'), gb.indexOf('function createSyncScheduler'));

  it('T16/T20 — eigener Jobtyp sync_insights, ein Job je Standort, kein Eingriff in sync_reviews', () => {
    expect(gb).toMatch(/sync_insights: async \(job\) => \{[\s\S]{0,200}new PerformanceSyncService\(log\)\.syncLocation\(job\.location_id\)/);
    const reviews = gb.slice(gb.indexOf('sync_reviews: async (job)'), gb.indexOf('sync_locations: async (job)'));
    expect(reviews).not.toMatch(/Performance|performance/);
    const migration = lies('../supabase/migrations/20261109120000_performance_zahlen.sql');
    expect(migration).toMatch(/'sync_insights', v_row\.user_id, v_row\.account_id, v_row\.location_id/);
  });

  it('T17 — 401 bleibt beim Transport: onTokenRejected → needs_reauth, der Service fasst die Verbindung nicht an', () => {
    expect(gb).toMatch(/if \(response\.status === 401\)[\s\S]{0,500}onTokenRejected\(connectionId\)/);
    expect(service).not.toMatch(/markConnectionUnusable|needs_reauth|recordRefreshFailure/);
  });

  it('T18 — deaktivierte API → performance_api_disabled, endgueltig, nie needs_reauth', () => {
    expect(deutetAufDeaktivierteApi('Zugriff verweigert: Business Profile Performance API has not been used in project 4711 before or it is disabled. Enable it by visiting https://console.developers.google.com/')).toBe(true);
    expect(deutetAufDeaktivierteApi('{"reason":"SERVICE_DISABLED"}')).toBe(true);
    expect(deutetAufDeaktivierteApi('accessNotConfigured')).toBe(true);
    /* echte Berechtigungsfehler bleiben, was sie sind */
    expect(deutetAufDeaktivierteApi('The caller does not have permission')).toBe(false);
    expect(deutetAufDeaktivierteApi('')).toBe(false);
    expect(deutetAufDeaktivierteApi(undefined)).toBe(false);

    expect(service).toMatch(/istApiDeaktiviert\(gbpError\) \? 'performance_api_disabled' : gbpError\.code/);
    expect(gb).toMatch(/function istApiDeaktiviert\(err: GbpError\)[\s\S]{0,120}err\.code !== 'insufficient_scope'\) return false/);
    /* Der Code ist KEIN Aufgabe-Code des Workers: Die Aufgabe-Liste
       spiegelt sich in AUFGEGEBEN_CODES des Dashboards und heisst dort
       „neu verbinden" — das waere hier der falsche Handlungsaufruf. */
    const aufgabe = [...gb.matchAll(/if \(([^)]*)\) \{\s*await this\.abandon\(/g)].map((m) => m[1]);
    expect(aufgabe.length).toBe(2);
    aufgabe.forEach((bedingung) => {
      expect(bedingung).toMatch(/'reauth_required'/);
      expect(bedingung).not.toMatch(/performance_api_disabled|insufficient_scope/);
    });
    /* und der Service macht aus dem 403 nie ein needs_reauth */
    expect(service).not.toMatch(/'needs_reauth'|'reauth_required'/);
  });

  it('T18b — das Dashboard blendet sync_insights aus der Abgleich-Karte aus', () => {
    const hook = lies('hooks/useGoogleBusinessData.js');
    expect(hook).toMatch(/setSyncJobs\(\(jobsResult\.data \?\? \[\]\)\.filter\(\(j\) => j\.job_type !== 'sync_insights'\)\)/);
  });

  it('T19 — 429/5xx laufen ueber den vorhandenen Transport-Retry, der Service wiederholt nicht selbst', () => {
    expect(gb).toMatch(/function isRetryableStatus\(status: number[\s\S]{0,200}status === 500 \|\| status === 502 \|\| status === 503 \|\| status === 504/);
    expect(service).not.toMatch(/while \(|for \(let attempt|setTimeout|sleep\(/);
    expect(service).toMatch(/createGbpClient\(location\.user_id, location\.account_id\)\s*\.fetchPerformance\(location\.location_resource_name, LEISTUNGS_METRIKEN, von, bis\)/);
  });

  it('Zeitraum und Idempotenz: 14 Tage rollierend, 90 Tage Erstlauf, Upsert auf den Primaerschluessel', () => {
    expect(gb).toMatch(/const PERFORMANCE_WINDOW_DAYS\s*=\s*14/);
    expect(gb).toMatch(/const PERFORMANCE_BACKFILL_DAYS\s*=\s*90/);
    expect(service).toMatch(/onConflict: 'location_id,metric,date', ignoreDuplicates: false/);
    expect(service).toMatch(/\(count \?\? 0\) === 0 \? 'backfill' : 'window'/);
  });

  it('Listing-ID: location_resource_name, keine Place-ID, keine UUID im Pfad', () => {
    const client = gb.slice(gb.indexOf('async fetchPerformance('), gb.indexOf('/* ── Bewertungen (v4) ── */'));
    expect(client).toMatch(/normalizeName\(locationName, 'locations'\)}:fetchMultiDailyMetricsTimeSeries/);
    expect(client).not.toMatch(/place_id|placeId/);
    expect(gb).toMatch(/GBP_PERFORMANCE_API = 'https:\/\/businessprofileperformance\.googleapis\.com\/v1'/);
    /* keine Suchbegriffe (Datenminimierung) */
    expect(gb).not.toMatch(/searchkeywords|ListSearchKeywordImpressionsMonthly/);
  });

  it('Planung im bestehenden gbp-schedule, kein neuer Cron', () => {
    expect(gb).toMatch(/rpc\('schedule_performance_syncs', \{\s*p_age: options\.insightsAge \?\? '22 hours'/);
    const migration = lies('../supabase/migrations/20261109120000_performance_zahlen.sql');
    expect(migration).not.toMatch(/cron\.schedule\(/);
  });

  it('Logs ohne Rohantwort und ohne Tokens', () => {
    expect(service).not.toMatch(/log\.(debug|warn|error)\([^)]*antwort/);
    expect(service).not.toMatch(/accessToken|refresh_token/);
  });
});
