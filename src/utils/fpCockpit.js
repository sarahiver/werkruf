/**
 * Founding-Partner-Cockpit — Darstellungsregeln (WP6).
 *
 * Die Zahlen kommen aus fp_cockpit_overview() / fp_cockpit_detail()
 * (Datenbank). Hier steht nur, wie daraus Text wird — und zwar so,
 * dass nichts behauptet wird, was nicht gemessen ist:
 *
 *   „Öffnung erkannt", nie „gelesen"  (Pixel, Apple Mail Privacy)
 *   „neue Bewertungen", nie „QR-Bewertungen" (Link führt direkt zu Google)
 *   „letzte Anmeldung", nie „letzter Besuch" (Sitzungen laufen lange)
 *   Öffnungsrate nur aus zugestellten Mails; ohne Zustellereignisse „—"
 */

export const ZAHLUNGSBEREITSCHAFT = Object.freeze([
  { wert: 'unbekannt', label: 'unbekannt' },
  { wert: 'ja',        label: 'Ja' },
  { wert: 'eher_ja',   label: 'eher ja' },
  { wert: 'eher_nein', label: 'eher nein' },
  { wert: 'nein',      label: 'Nein' },
]);

export function labelZahlungsbereitschaft(wert) {
  return ZAHLUNGSBEREITSCHAFT.find((z) => z.wert === wert)?.label ?? 'unbekannt';
}

/** 0.667 → „67 %"; null → „—". */
export function formatProzent(anteil) {
  if (anteil === null || anteil === undefined || !Number.isFinite(Number(anteil))) return '—';
  return `${Math.round(Number(anteil) * 100)} %`;
}

/**
 * Öffnungsrate der letzten 28 Tage.
 * Ohne Zustellereignisse (Webhook nicht konfiguriert) gibt es keine
 * Rate — und der Text sagt warum, statt 0 % zu zeigen.
 */
export function oeffnungsrateText(kpis) {
  const k = kpis ?? {};
  if (!k.deliveryTrackingActive) return { wert: '—', hinweis: 'Brevo-Webhook noch nicht aktiv — keine Zustelldaten' };
  const zugestellt = Number(k.weeklyDelivered28d ?? 0);
  if (zugestellt === 0) return { wert: '—', hinweis: 'noch keine zugestellte Montagsmail in 28 Tagen' };
  return {
    wert: formatProzent(k.openRate28d),
    hinweis: `${k.weeklyOpened28d ?? 0} von ${zugestellt} zugestellten Montagsmails mit Öffnung (technisch erkannt, kein Lesebeweis)`,
  };
}

/** „3/4 Wochen aktiv" */
export function aktiveWochenText(anzahl) {
  const n = Number.isFinite(Number(anzahl)) ? Math.max(0, Math.min(4, Number(anzahl))) : 0;
  return `${n}/4 Wochen`;
}

/** Zustand der letzten Montagsmail in einem Wort plus Erklärung. */
export function zustellungText(mail) {
  if (!mail) return { wert: 'keine', ton: 'neutral' };
  if (mail.status === 'failed') return { wert: 'fehlgeschlagen', ton: 'rot' };
  if (mail.status === 'queued' || mail.status === 'sending') return { wert: 'wartet', ton: 'neutral' };
  switch (mail.deliveryStatus) {
    case 'delivered':   return { wert: 'zugestellt', ton: 'gruen' };
    case 'hard_bounce': return { wert: 'Hard Bounce', ton: 'rot' };
    case 'soft_bounce': return { wert: 'Soft Bounce', ton: 'gelb' };
    case 'blocked':     return { wert: 'blockiert', ton: 'rot' };
    case 'spam':        return { wert: 'Spam gemeldet', ton: 'rot' };
    case 'error':       return { wert: 'Fehler', ton: 'rot' };
    default:            return { wert: 'gesendet', ton: 'neutral', hinweis: 'Zustellung nicht bestätigt' };
  }
}

/** Öffnung: „erkannt (2×, zuletzt 09.11.)" / „keine erkannt" */
export function oeffnungText(mail, formatDatum = (d) => d) {
  if (!mail || !mail.firstOpenedAt) return 'keine Öffnung erkannt';
  const anzahl = Number(mail.openCount ?? 1);
  const zuletzt = mail.lastOpenedAt ? formatDatum(mail.lastOpenedAt) : formatDatum(mail.firstOpenedAt);
  return `Öffnung erkannt${anzahl > 1 ? ` (${anzahl}×)` : ''}, zuletzt ${zuletzt}`;
}

/** Zusammenfassung der KPI-Kacheln oben im Cockpit. */
export function kpiKacheln(kpis) {
  const k = kpis ?? {};
  const rate = oeffnungsrateText(k);
  return [
    { key: 'fp',       wert: String(k.foundingPartners ?? 0), label: 'Founding Partner' },
    { key: 'deliv',    wert: k.deliveryTrackingActive ? String(k.weeklyDelivered28d ?? 0) : '—',
      label: 'Montagsmails zugestellt (28 Tage)', hinweis: k.deliveryTrackingActive ? null : 'Webhook nicht aktiv' },
    { key: 'open',     wert: rate.wert, label: 'Öffnungsrate (28 Tage)', hinweis: rate.hinweis },
    { key: 'aktiv',    wert: String(k.activeLast7d ?? 0), label: '≥ 1 erledigte Aufgabe (7 Tage)' },
    { key: 'reviews',  wert: String(k.newReviews30d ?? 0), label: 'neue Google-Bewertungen (30 Tage, alle Quellen)',
      hinweis: 'Bewertungslink-Aufrufe sind nicht messbar — der Link führt direkt zu Google' },
    { key: 'ja',       wert: String(k.yesTo49 ?? 0), label: 'Ja zu 49 €' },
  ];
}
