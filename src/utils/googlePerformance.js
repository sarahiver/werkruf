/**
 * Google-Leistungsdaten (Business Profile Performance API) — WP5.
 *
 * Reines JavaScript ohne Importe: Deno holt es relativ aus den Edge
 * Functions, Jest direkt. Dieselbe Logik auf beiden Seiten.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER LIEGT — UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════
 *
 *   hier        Parser der Google-Antwort, Zusammenführung zu den vier
 *               Kennzahlen der Mail, Vergleichsregeln, HTML-Block.
 *   SQL         Tages-Rohdaten speichern, Summen je Zeitraum bilden,
 *               die Berichtswoche wählen (performance_summary,
 *               weekly_performance_for_mail, monthly_performance).
 *
 * Summen entstehen genau einmal, in der Datenbank. Diese Datei rechnet
 * nur noch, was aus den Summen eine Aussage macht: Aufrufe aus vier
 * Impressions-Metriken, Veränderung zur Vorperiode, Text dazu.
 *
 * ═══════════════════════════════════════════════════════════════
 * NULL IST NICHT „KEINE DATEN"
 * ═══════════════════════════════════════════════════════════════
 *
 * Googles DatedValue hat zwei Zustände, die beide wie „nichts" aussehen:
 *
 *   { date: {…} }                 Tag geliefert, Wert fehlt → 0.
 *                                 Dokumentiert: value wird bei Null
 *                                 weggelassen.
 *   Tag fehlt in datedValues      Google hat (noch) keine Daten für den
 *                                 Tag → KEINE Zeile. Nie als 0 speichern.
 *
 * Die Mail unterscheidet entsprechend: Eine Woche mit Zeilen und Wert 0
 * heißt „0 Anrufe"; eine Woche ohne Zeilen heißt „liegen noch keine
 * Daten vor".
 */

/* ─────────────────────────────────────────────
   METRIKEN
───────────────────────────────────────────── */

/** Die Metriken, die der Sync bei Google abruft. Keine veralteten. */
export const LEISTUNGS_METRIKEN = Object.freeze([
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
]);

/** Die vier Impressions-Metriken, die in der Mail zu „Aufrufe" werden. */
export const AUFRUF_METRIKEN = Object.freeze([
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
]);

/**
 * Die Kennzahlen der Mail — Reihenfolge ist Anzeigereihenfolge.
 * Handwerkssprache, keine API-Namen.
 */
export const KENNZAHLEN = Object.freeze([
  { key: 'aufrufe',       label: 'Aufrufe',        metriken: AUFRUF_METRIKEN },
  { key: 'anrufe',        label: 'Anrufe',         metriken: Object.freeze(['CALL_CLICKS']) },
  { key: 'websiteKlicks', label: 'Website-Klicks', metriken: Object.freeze(['WEBSITE_CLICKS']) },
  { key: 'routen',        label: 'Routenanfragen', metriken: Object.freeze(['BUSINESS_DIRECTION_REQUESTS']) },
]);

/* ─────────────────────────────────────────────
   PARSER
───────────────────────────────────────────── */

/** Googles Date-Objekt → 'YYYY-MM-DD'. Null bei unbrauchbarem Datum. */
export function datumAlsIso(date) {
  if (!date || typeof date !== 'object') return null;
  const { year, month, day } = date;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  /* Kalenderprüfung: 2026-02-31 fällt hier durch. */
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/**
 * FetchMultiDailyMetricsTimeSeriesResponse → Tageszeilen.
 *
 * Robust gegen alles, was Google weglassen oder dazulegen kann:
 *   - unbekannte Metriken werden gezählt und übersprungen (T5)
 *   - Metrik ohne Datenpunkte: kein Absturz, steht in ohneDaten (T4)
 *   - Tag ohne value → 0 (Googles dokumentierte Null), Tag ohne date →
 *     übersprungen (T3)
 *   - nur Metriken aus LEISTUNGS_METRIKEN landen in zeilen
 *
 * @returns {{ zeilen: Array<{metric:string,date:string,value:number}>,
 *             unbekannt: string[], ohneDaten: string[], verworfen: number }}
 */
export function parseLeistungsantwort(antwort) {
  const zeilen = [];
  const unbekannt = [];
  const ohneDaten = [];
  let verworfen = 0;
  const erlaubt = new Set(LEISTUNGS_METRIKEN);

  const multi = Array.isArray(antwort?.multiDailyMetricTimeSeries)
    ? antwort.multiDailyMetricTimeSeries : [];

  for (const gruppe of multi) {
    const reihen = Array.isArray(gruppe?.dailyMetricTimeSeries) ? gruppe.dailyMetricTimeSeries : [];
    for (const reihe of reihen) {
      const metric = typeof reihe?.dailyMetric === 'string' ? reihe.dailyMetric : '';
      if (!erlaubt.has(metric)) {
        if (metric) unbekannt.push(metric);
        continue;
      }
      const werte = Array.isArray(reihe?.timeSeries?.datedValues) ? reihe.timeSeries.datedValues : [];
      if (werte.length === 0) {
        ohneDaten.push(metric);
        continue;
      }
      for (const dv of werte) {
        const date = datumAlsIso(dv?.date);
        if (!date) { verworfen++; continue; }
        /* value fehlt = 0 (dokumentiert). value vorhanden = int64 als String. */
        let value = 0;
        if (dv.value !== undefined && dv.value !== null) {
          const n = typeof dv.value === 'number' ? dv.value : Number(String(dv.value).trim());
          if (!Number.isFinite(n) || n < 0) { verworfen++; continue; }
          value = Math.round(n);
        }
        zeilen.push({ metric, date, value });
      }
    }
  }

  return { zeilen, unbekannt, ohneDaten, verworfen };
}

/* ─────────────────────────────────────────────
   FEHLERDEUTUNG
───────────────────────────────────────────── */

/**
 * Deutet ein 403 von Google auf „Performance API im Cloud-Projekt
 * nicht aktiviert"? Google hat dafür keinen eigenen Statuscode, nur
 * den Wortlaut:
 *
 *   "Business Profile Performance API has not been used in project
 *    123 before or it is disabled. Enable it by visiting …"
 *   details[].reason = "SERVICE_DISABLED" / "accessNotConfigured"
 *
 * Ein echtes Berechtigungsproblem („The caller does not have
 * permission") passt nicht — und bleibt insufficient_scope. Beides ist
 * NIE ein OAuth-Problem: needs_reauth entsteht nur aus 401.
 */
export function deutetAufDeaktivierteApi(text) {
  if (typeof text !== 'string' || !text) return false;
  return /has not been used in project|is disabled\b|SERVICE_DISABLED|accessNotConfigured|API .{0,40}not enabled/i.test(text);
}

/* ─────────────────────────────────────────────
   VERGLEICH
───────────────────────────────────────────── */

/**
 * Veränderung zur Vorperiode — mit Regeln, die nichts vortäuschen:
 *
 *   vorher unbekannt   → kein Vergleich
 *   0 → 0              → unverändert
 *   0 → 5              → +5 (kein Prozent: aus Null gibt es keinen)
 *   5 → 0              → −5 (−100 %)
 *   12 → 15            → +3 (+25 %)
 *
 * Prozent nur, wenn die Vorperiode > 0 ist. Nie Infinity, nie NaN.
 */
export function vergleiche(aktuell, vorher) {
  const a = Number.isFinite(aktuell) ? aktuell : null;
  const v = Number.isFinite(vorher) ? vorher : null;
  if (a === null) return { aktuell: null, vorher: v, delta: null, prozent: null, text: 'keine Daten' };
  if (v === null) return { aktuell: a, vorher: null, delta: null, prozent: null, text: 'kein Vergleich' };

  const delta = a - v;
  if (delta === 0) return { aktuell: a, vorher: v, delta: 0, prozent: 0, text: 'unverändert' };

  const vorzeichen = delta > 0 ? '+' : '−';
  const absolut = `${vorzeichen}${formatZahl(Math.abs(delta))}`;

  if (v === 0) {
    /* Aus Null heraus gibt es keinen Prozentwert. */
    return { aktuell: a, vorher: v, delta, prozent: null, text: absolut };
  }

  const prozent = Math.round((delta / v) * 100);
  return {
    aktuell: a, vorher: v, delta, prozent,
    text: `${absolut} (${vorzeichen}${Math.abs(prozent)} %)`,
  };
}

/* ─────────────────────────────────────────────
   ZUSAMMENFÜHRUNG FÜR DIE MAIL
───────────────────────────────────────────── */

/** Summe über die Metriken einer Kennzahl. null, wenn keine davon vorliegt. */
function summeKennzahl(summen, metriken) {
  if (!summen || typeof summen !== 'object') return null;
  let gefunden = false;
  let summe = 0;
  for (const m of metriken) {
    const eintrag = summen[m];
    const wert = eintrag && typeof eintrag === 'object' ? eintrag.summe : eintrag;
    if (Number.isFinite(wert)) { summe += wert; gefunden = true; }
  }
  return gefunden ? summe : null;
}

/**
 * Aus der SQL-Zusammenfassung (weekly_performance_for_mail) den
 * Mail-Block berechnen.
 *
 * Eingabe:
 *   { status: 'ok' | 'unvollstaendig' | 'keine_daten',
 *     zeitraum: { von, bis }, vorzeitraum: { von, bis },
 *     aktuell: { METRIC: { summe, tage } }, vorher: { … } }
 *
 * Ausgabe:
 *   { status, zeitraumText, kennzahlen: [{ key, label, aktuell, vorher,
 *     delta, prozent, vergleichText }] }
 *
 * Eine Kennzahl, für die Google gar keine Metrik geliefert hat, fehlt
 * in der Liste — statt als 0 zu erscheinen (T15, T22). Fehlt sie nur in
 * der Vorperiode, steht „kein Vergleich".
 */
export function baueGoogleWoche(zusammenfassung) {
  const status = zusammenfassung?.status;
  if (status !== 'ok') {
    return { status: status === 'unvollstaendig' ? 'unvollstaendig' : 'keine_daten', zeitraumText: '', kennzahlen: [] };
  }

  const kennzahlen = [];
  for (const k of KENNZAHLEN) {
    const aktuell = summeKennzahl(zusammenfassung.aktuell, k.metriken);
    if (aktuell === null) continue;
    const vorher = summeKennzahl(zusammenfassung.vorher, k.metriken);
    const v = vergleiche(aktuell, vorher);
    kennzahlen.push({
      key: k.key, label: k.label,
      aktuell, vorher: v.vorher, delta: v.delta, prozent: v.prozent, vergleichText: v.text,
    });
  }

  if (kennzahlen.length === 0) {
    return { status: 'unvollstaendig', zeitraumText: '', kennzahlen: [] };
  }

  return {
    status: 'ok',
    zeitraumText: formatZeitraum(zusammenfassung.zeitraum?.von, zusammenfassung.zeitraum?.bis),
    kennzahlen,
  };
}

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

/** 1240 → „1.240". Ohne Intl, damit Deno und Node dasselbe liefern. */
export function formatZahl(n) {
  if (!Number.isFinite(n)) return '—';
  const ganz = Math.round(Math.abs(n));
  const text = String(ganz).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${text}` : text;
}

/** '2026-10-27','2026-11-02' → „27.10.–02.11." */
export function formatZeitraum(von, bis) {
  const tag = (iso) => {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  };
  const a = tag(von), b = tag(bis);
  if (a && b) return `${a}–${b}`;
  return a ?? b ?? '';
}

function esc(wert) {
  return String(wert ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const KEINE_DATEN_SATZ =
  'Für diesen Zeitraum liegen noch keine Google-Leistungsdaten vor.';

/**
 * Der Block „Deine Google-Woche" für die Wochenmail.
 *
 *   keine_daten     → '' (kein Block; die Mail läuft wie bisher)
 *   unvollstaendig  → ein ehrlicher Satz, keine Nullen
 *   ok              → Überschrift, Zeitraum, bis zu vier Kacheln
 *
 * Die Farbe der Veränderung bleibt dezent: grün bei mehr, grau sonst.
 * Rot gibt es hier nicht — weniger Aufrufe in einer Woche sind kein
 * Alarm, und die Mail soll informieren, nicht erschrecken.
 */
export function googleWocheHtml(block) {
  if (!block || block.status === 'keine_daten') return '';

  const kopf =
    `<div class="wr-muted" style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#6B7280;margin:0 0 2px;">DEINE GOOGLE-WOCHE` +
    (block.zeitraumText ? ` <span style="font-weight:normal;letter-spacing:0;">&middot; ${esc(block.zeitraumText)}</span>` : '') +
    `</div>`;

  if (block.status !== 'ok' || !Array.isArray(block.kennzahlen) || block.kennzahlen.length === 0) {
    return kopf +
      `<p class="wr-text" style="margin:0 0 18px;font-size:13px;line-height:1.55;color:#5F6875;" data-google-woche="unvollstaendig">${esc(KEINE_DATEN_SATZ)}</p>`;
  }

  const kacheln = block.kennzahlen.map((k) => {
    const farbe = k.delta !== null && k.delta > 0 ? '#1E7E34' : '#6B7280';
    return `
  <td class="wr-tile" width="50%" valign="top" style="background:#F6F7F9;border-radius:8px;padding:11px 13px;border-right:6px solid #ffffff;border-bottom:6px solid #ffffff;" data-kennzahl="${esc(k.key)}">
    <div class="wr-title" style="font-size:19px;font-weight:bold;line-height:1.1;color:#0B2545;">${esc(formatZahl(k.aktuell))}</div>
    <div class="wr-muted" style="font-size:11px;color:#6B7280;margin-top:3px;">${esc(k.label)}</div>
    <div style="font-size:11px;color:${farbe};margin-top:3px;">${esc(k.vergleichText)}${k.vorher !== null && k.vorher !== undefined ? ` &middot; Vorwoche ${esc(formatZahl(k.vorher))}` : ''}</div>
  </td>`;
  });

  /* Zwei je Zeile — vier Kacheln nebeneinander werden auf dem Handy
     unlesbar. */
  const zeilen = [];
  for (let i = 0; i < kacheln.length; i += 2) {
    zeilen.push(`<tr>${kacheln.slice(i, i + 2).join('')}${kacheln.length - i === 1 ? '<td width="50%"></td>' : ''}</tr>`);
  }

  return kopf +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;" data-google-woche="ok">${zeilen.join('')}</table>` +
    `<p class="wr-muted" style="margin:0 0 18px;font-size:11px;line-height:1.5;color:#6B7280;">Gezählt von Google: Wie oft dein Profil in Suche und Maps gezeigt wurde und wie oft jemand darüber angerufen, die Website geöffnet oder die Route angefragt hat.</p>`;
}
