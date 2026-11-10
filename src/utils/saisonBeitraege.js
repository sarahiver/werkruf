/*
 * Saison-Beitraege (WP15) — Katalog, Fenster, Vorlagen, Regeln.
 *
 * Geteilt zwischen Jest, der Edge Function (Engine-Regel, Publish-Route)
 * und dem Frontend (Dialog). Alles deterministisch: kein LLM, keine
 * externe Quelle, keine Datumsmagie — `heute` wird injiziert.
 *
 * Produktidee: WERKRUF erkennt einen saisonalen Moment und bereitet
 * einen Google-Beitrag vor. Der Betrieb prueft, passt an, klickt
 * „Veroeffentlichen". Nie automatisch.
 *
 * Was NICHT drinsteht: Angebote, Rabatte, Preise, Notdienst, freie
 * Termine, Garantien, erfundene Leistungen. textErlaubtFuerBeitrag()
 * prueft die VORLAGE (unser Text); vom Nutzer editierter Text wird nur
 * auf Laenge geprueft — er kennt seinen Betrieb, wir nicht.
 */

import { ausIso, alsIso, datumPlus, tageBis, ostersonntag, deterministischeUuid } from './feiertage.js';

/* WERKRUF begrenzt Saison-Beitraege fuer eine kompakte Darstellung auf
   1.500 Zeichen. Das ist ein WERKRUF-Produktlimit, keine Google-Angabe —
   die Google-API kann zusaetzlich eigene Validierungsfehler zurueckgeben,
   die durchgereicht werden. */
export const BEITRAG_MAX_ZEICHEN = 1500;
export const BEITRAG_MIN_ZEICHEN = 20;

/* Heizungs-/SHK-Kategorien (Google gcid). Nur hier gilt die Heizsaison —
   kein Raten aus Firmennamen. Unbekannte/andere Kategorie → keine. */
export const HEIZUNGS_KATEGORIEN = Object.freeze([
  'gcid:heating_contractor', 'gcid:hvac_contractor', 'gcid:plumber', 'gcid:heating_equipment_supplier',
  'gcid:boiler_supplier', 'gcid:air_conditioning_contractor', 'gcid:furnace_repair_service',
  'gcid:heating_oil_supplier', 'gcid:gas_installation_service', 'gcid:chimney_sweep',
]);

/**
 * Der Katalog. Fenster als Monat/Tag; `ostern` ist beweglich und wird
 * aus dem Ostersonntag berechnet. `dringendAbTagen`: so viele Tage vor
 * Fensterende springt die Prioritaet von low auf medium.
 */
export const SAISONEN = Object.freeze([
  {
    key: 'weihnachten', titel: 'Weihnachtsgruß', aufgabe: 'Weihnachtsbeitrag vorbereiten',
    start: '12-01', ende: '12-23', dringendAbTagen: 7, fuer: 'alle',
    warum: 'Weihnachten steht vor der Tür. Mit einem aktuellen Beitrag kannst du deinen Kunden direkt im Google-Profil einen kurzen Weihnachtsgruß zeigen.',
  },
  {
    key: 'jahreswechsel', titel: 'Neujahrsgruß', aufgabe: 'Neujahrsbeitrag vorbereiten',
    start: '12-27', ende: '01-06', dringendAbTagen: 4, fuer: 'alle',
    warum: 'Zum Jahreswechsel kannst du deinen Kunden mit einem kurzen Beitrag direkt im Google-Profil einen Neujahrsgruß zeigen.',
  },
  {
    key: 'ostern', titel: 'Ostergruß', aufgabe: 'Osterbeitrag vorbereiten',
    beweglich: 'ostern', vorTage: 14, nachTage: 0, dringendAbTagen: 5, fuer: 'alle',
    warum: 'Ostern steht vor der Tür. Ein kurzer Beitrag hält dein Google-Profil für Kunden aktuell.',
  },
  {
    key: 'sommer', titel: 'Sommergruß', aufgabe: 'Sommerbeitrag vorbereiten',
    start: '06-15', ende: '07-15', dringendAbTagen: 7, fuer: 'alle',
    warum: 'Ein saisonaler Sommerbeitrag hält dein Google-Profil für Kunden aktuell.',
  },
  {
    key: 'heizsaison', titel: 'Start der Heizsaison', aufgabe: 'Heizsaison-Beitrag vorbereiten',
    start: '09-15', ende: '10-31', dringendAbTagen: 10, fuer: 'heizung',
    warum: 'Die Heizsaison beginnt. Jetzt passt ein aktueller Beitrag zu diesem saisonalen Thema.',
  },
]);

export const SAISON_KEYS = Object.freeze(SAISONEN.map((s) => s.key));

export function saison(key) {
  return SAISONEN.find((s) => s.key === key) ?? null;
}

/** Gilt die Saison fuer diese Google-Kategorie? `null`/unbekannt → nur „alle". */
export function saisonGiltFuer(s, primaryCategory) {
  if (!s) return false;
  if (s.fuer === 'alle') return true;
  if (s.fuer === 'heizung') return typeof primaryCategory === 'string' && HEIZUNGS_KATEGORIEN.includes(primaryCategory.toLowerCase());
  return false;
}

const md = (jahr, mmdd) => ausIso(`${jahr}-${mmdd}`);

/**
 * Fenster einer Saison fuer ein „Saisonjahr". Beim Jahreswechsel
 * (27.12.–06.01.) ist das Saisonjahr das Jahr des 27.12.; das Fenster
 * reicht ins Folgejahr. Rueckgabe { von, bis } als Datum-Objekte.
 */
export function saisonFenster(s, jahr) {
  if (s.beweglich === 'ostern') {
    const os = ostersonntag(jahr);
    return { von: datumPlus(os, -s.vorTage), bis: datumPlus(os, s.nachTage) };
  }
  const von = md(jahr, s.start);
  let bis = md(jahr, s.ende);
  if (s.ende < s.start) bis = md(jahr + 1, s.ende);   // ueber den Jahreswechsel
  return { von, bis };
}

const vergleich = (a, b) => alsIso(a).localeCompare(alsIso(b));

/**
 * Welche Saisons sind HEUTE offen fuer diesen Standort?
 * `heute` = {year, month, day}. Prueft das laufende und das Vorjahr
 * (Jahreswechsel-Fenster), liefert je Saison genau ein Saisonjahr.
 *
 * @returns Array<{ key, jahr, titel, aufgabe, warum, bisIso, tageBisEnde, dringend }>
 */
export function offeneSaisons({ heute, primaryCategory }) {
  if (!heute) return [];
  const offen = [];
  for (const s of SAISONEN) {
    if (!saisonGiltFuer(s, primaryCategory)) continue;
    for (const jahr of [heute.year - 1, heute.year]) {
      const f = saisonFenster(s, jahr);
      if (vergleich(heute, f.von) >= 0 && vergleich(heute, f.bis) <= 0) {
        const rest = tageBis(heute, f.bis);
        offen.push({
          key: s.key, jahr, titel: s.titel, aufgabe: s.aufgabe, warum: s.warum,
          vonIso: alsIso(f.von), bisIso: alsIso(f.bis), tageBisEnde: rest, dringend: rest <= s.dringendAbTagen,
        });
        break;   // ein Saisonjahr je Saison
      }
    }
  }
  return offen;
}

/** events.subject_id: stabil je (Standort, Saison, Saisonjahr). */
export function saisonSubjektId(locationId, key, jahr) {
  return deterministischeUuid(`season:${locationId}:${key}:${jahr}`);
}

/* ── Vorlagen ──
   Sachlich, freundlich, ohne Leistungsversprechen. {betrieb} ist der
   Google-Titel des Standorts. Heizsaison nur mit Heizungs-Kategorie —
   und auch dort ohne „Termin sichern" oder Preise. */
const VORLAGEN = Object.freeze({
  weihnachten: ({ betrieb }) =>
    `Wir wünschen euch eine schöne Weihnachtszeit und erholsame Feiertage.\n\nVielen Dank für das Vertrauen in diesem Jahr.\n\nEuer Team von ${betrieb}`,
  jahreswechsel: ({ betrieb }) =>
    `Ein gutes neues Jahr! Wir bedanken uns für die Zusammenarbeit im vergangenen Jahr und freuen uns auf alles, was kommt.\n\nEuer Team von ${betrieb}`,
  ostern: ({ betrieb }) =>
    `Wir wünschen euch frohe Ostern und ein paar erholsame Tage.\n\nEuer Team von ${betrieb}`,
  sommer: ({ betrieb }) =>
    `Einen schönen Sommer wünscht euch das Team von ${betrieb}.\n\nWir wünschen euch eine gute Sommerzeit.`,
  heizsaison: ({ betrieb }) =>
    `Die Heizsaison startet.\n\nJetzt ist ein guter Zeitpunkt, Heizung und Anlage überprüfen zu lassen, bevor es richtig kalt wird.\n\n${betrieb}`,
});

export function baueBeitragsVorschlag({ key, betrieb }) {
  const b = typeof betrieb === 'string' && betrieb.trim() ? betrieb.trim() : null;
  const v = VORLAGEN[key];
  if (!b || !v) return null;
  return v({ betrieb: b });
}

/* Was eine VORLAGE nie enthalten darf (Test + Gegenprobe C7). Gilt fuer
   unsere Texte, nicht fuer vom Nutzer editierte. */
export const VERBOTENE_BEITRAGSMUSTER = Object.freeze([
  /\d+\s*%|Prozent|Rabatt|Sonderpreis|Angebot|Aktion|günstig|kostenlos|gratis|Gutschein/i,   // Angebote/Preise
  /€|EUR\b|Euro\b|Preis/i,
  /Notdienst|24\s*h|rund um die Uhr/i,                                                   // Verfuegbarkeit
  /freie Termine|Termin sichern|jetzt buchen|sofort verfügbar|kurzfristig/i,
  /Garantie|garantiert/i,
  /wir sind .{0,30}\b(da|erreichbar)\b|wie gewohnt|geöffnet|Öffnungszeiten|erreichbar|Termin vereinbaren/i,   // Verfuegbarkeits-/Erreichbarkeitsbehauptungen — koennen bei Betriebsferien falsch sein
]);

/* Was WERKRUF-Texte (Aufgaben, Begruendungen, Vorlagen) nie behaupten:
   Sichtbarkeits-, Ranking- oder Nachfragewirkung. Nicht belegt, nicht versprochen. */
export const VERBOTENE_WIRKUNGSMUSTER = Object.freeze([
  /sichtbar(er|keit)?\b/i, /Ranking|Platzierung|besser gefunden|gefunden werden/i, /mehr (Anfragen|Kunden|Aufträge|Reichweite)/i,
  /Kunden suchen (jetzt|gerade)/i, /Google (bevorzugt|belohnt)/i,
]);

export function textOhneWirkungsversprechen(text) {
  return typeof text === 'string' && !VERBOTENE_WIRKUNGSMUSTER.some((re) => re.test(text));
}

export function textErlaubtFuerBeitrag(text) {
  return typeof text === 'string' && !VERBOTENE_BEITRAGSMUSTER.some((re) => re.test(text));
}

/** Nutzertext: nur Laenge und Leere — der Betrieb kennt sein Geschaeft. */
export function pruefeBeitragstext(text) {
  const t = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
  if (!t) return { ok: false, grund: 'leer' };
  const n = [...t].length;
  if (n < BEITRAG_MIN_ZEICHEN) return { ok: false, grund: 'zu_kurz', zeichen: n };
  if (n > BEITRAG_MAX_ZEICHEN) return { ok: false, grund: 'zu_lang', zeichen: n, max: BEITRAG_MAX_ZEICHEN };
  return { ok: true, text: t, zeichen: n };
}

export const BEITRAG_GRUND_TEXT = Object.freeze({
  leer: 'Der Beitrag ist leer.',
  zu_kurz: `Bitte mindestens ${BEITRAG_MIN_ZEICHEN} Zeichen.`,
  zu_lang: 'Höchstens 1.500 Zeichen pro WERKRUF-Saisonbeitrag.',
  bereits_veroeffentlicht: 'Für diese Saison ist bereits ein Beitrag veröffentlicht.',
  laeuft_bereits: 'Die Veröffentlichung läuft gerade — einen Moment.',
  keine_saison: 'Für diesen Betrieb ist gerade kein saisonaler Beitrag vorgesehen.',
  kein_zugang: 'Beiträge veröffentlichen gibt es mit WERKRUF Pro.',
});

/** Google-State → was wir dem Nutzer sagen. PROCESSING ist nicht live. */
export function statusText(googleState, lokal) {
  if (lokal === 'failed') return 'Die Veröffentlichung ist fehlgeschlagen. Du kannst es erneut versuchen.';
  if (lokal === 'rejected' || googleState === 'REJECTED') return 'Google hat den Beitrag abgelehnt. Passe den Text an und veröffentliche erneut.';
  if (googleState === 'LIVE') return 'Beitrag ist auf Google veröffentlicht.';
  if (lokal === 'published' || googleState === 'PROCESSING') return 'Beitrag wurde an Google übermittelt.';
  if (lokal === 'publishing') return 'Beitrag wird an Google übermittelt …';
  return null;
}
