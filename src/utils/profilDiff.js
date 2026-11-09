/*
 * Profil-Diff (WP8) — der Waechter.
 *
 * Geteilt zwischen Jest und supabase/functions/google-business.
 *
 * Google fuehrt fuer jeden Standort zwei Sichten:
 *
 *   Merchant View   was der Inhaber hinterlegt hat     (locations.get)
 *   Consumer View   was Google oeffentlich zeigt       (:getGoogleUpdated)
 *
 * Unterscheiden sie sich, hat entweder Google etwas uebernommen
 * (Nutzervorschlag, eigene Korrektur) oder eine eigene Aenderung ist
 * noch nicht live (pendingMask). Hier steht, WIE verglichen wird und
 * WAS daraus wird — nicht, wo es gespeichert wird.
 *
 * Grundsaetze:
 *   - Keine rohen Objekte vergleichen. Jedes Feld hat eine
 *     Normalisierung; Google aendert Reihenfolgen, formatiert Nummern,
 *     laesst leere Felder weg.
 *   - Keine Herkunft behaupten, die wir nicht kennen. Ohne
 *     Lifecycle-Information aus der Extended-API ist ein Diff ein
 *     Diff — "oeffentlich sichtbar unterscheidet sich von hinterlegt".
 *   - Prioritaet fachlich: Was Kunden am Anruf, am Besuch oder am
 *     Finden hindert, ist kritisch.
 */

import {
  zeitfensterGeaendert, sonderzeitenGeaendert,
} from './gbpHours.js';

/* ─────────────────────────────────────────────
   BEOBACHTETE FELDER
   ───────────────────────────────────────────── */

/**
 * Welche Felder der Waechter beobachtet, mit Prioritaet und Etikett.
 *
 *   kritisch  Betrieb nicht erreichbar / nicht auffindbar / falsch
 *             zugeordnet: Sofortmeldung
 *   mittel    Kunden kommen zur falschen Zeit oder finden den Betrieb
 *             unter einer Nebenkategorie nicht: Montagsmail
 *   info      nur im Dashboard
 *
 * `patch` sagt, ob Uebernehmen/Wiederherstellen ueber location/update
 * moeglich ist (Feld ist im Feldmodell schreibbar). title ist bei
 * Google heikel (Neuverifizierung) und im Feldmodell gesperrt — der
 * Diff wird gezeigt, die Korrektur passiert bei Google.
 */
export const DIFF_FELDER = Object.freeze({
  'openInfo':                     { prio: 'kritisch', label: 'Geöffnet / geschlossen', patch: true,  updateMask: 'openInfo' },
  'phoneNumbers.primaryPhone':    { prio: 'kritisch', label: 'Telefonnummer',          patch: true,  updateMask: 'phoneNumbers' },
  'websiteUri':                   { prio: 'kritisch', label: 'Website',                patch: true,  updateMask: 'websiteUri' },
  'storefrontAddress':            { prio: 'kritisch', label: 'Adresse',                patch: true,  updateMask: 'storefrontAddress' },
  /* Kategorien: im Diff liegt nur der Anzeigename, Google braucht zum
     Schreiben die stabile ID. Kein Raten, kein Suchen — der Diff wird
     gezeigt, geaendert wird bei Google bzw. im Kategorien-Editor. */
  'categories.primaryCategory':   { prio: 'kritisch', label: 'Hauptkategorie',         patch: false, updateMask: null },
  'title':                        { prio: 'kritisch', label: 'Unternehmensname',       patch: false, updateMask: null },
  'regularHours':                 { prio: 'mittel',   label: 'Öffnungszeiten',         patch: true,  updateMask: 'regularHours' },
  'specialHours':                 { prio: 'mittel',   label: 'Sonderöffnungszeiten',   patch: true,  updateMask: 'specialHours' },
  'categories.additionalCategories': { prio: 'mittel', label: 'Weitere Kategorien',    patch: false, updateMask: null },
  'serviceArea':                  { prio: 'info',     label: 'Einzugsgebiet',          patch: false, updateMask: null },
  'attributes':                   { prio: 'info',     label: 'Merkmale',               patch: false, updateMask: null },
});

export const FELD_PFADE = Object.freeze(Object.keys(DIFF_FELDER));

/** Prioritaet → Engine-Prioritaetsstufe */
export const PRIO_STUFE = Object.freeze({ kritisch: 'critical', mittel: 'medium', info: 'low' });

/* ─────────────────────────────────────────────
   NORMALISIERUNG
   ───────────────────────────────────────────── */

/**
 * Telefon: nur Ziffern, fuehrende 00 → +, nationale 0 bei DE → +49.
 * "040 123456", "+49 40 123456", "0049-40-123456", "(040) 12 34 56"
 * ergeben denselben Schluessel. Ohne Laendervorwahl wird DE
 * angenommen — WERKRUF ist ein deutsches Produkt; Google liefert in
 * der Regel ohnehin E.164.
 */
export function normalisiereTelefon(wert, land = '49') {
  if (typeof wert !== 'string') return null;
  let z = wert.replace(/[^\d+]/g, '');
  if (!z) return null;
  if (z.startsWith('00')) z = '+' + z.slice(2);
  if (z.startsWith('+')) return '+' + z.slice(1).replace(/\D/g, '');
  if (z.startsWith('0')) return `+${land}${z.slice(1)}`;
  return `+${land}${z}`;
}

/**
 * URL: Schema und www. weg, Host klein, Pfad ohne Schluss-Slash,
 * Query bleibt (Tracking-Parameter sind eine echte Aenderung).
 */
export function normalisiereUrl(wert) {
  if (typeof wert !== 'string') return null;
  let u = wert.trim();
  if (!u) return null;
  u = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const frag = u.indexOf('#'); if (frag >= 0) u = u.slice(0, frag);
  const q = u.indexOf('?');
  let host = q >= 0 ? u.slice(0, q) : u;
  const query = q >= 0 ? u.slice(q) : '';
  const slash = host.indexOf('/');
  const hostTeil = (slash >= 0 ? host.slice(0, slash) : host).toLowerCase();
  let pfad = slash >= 0 ? host.slice(slash) : '';
  pfad = pfad.replace(/\/+$/, '');
  return `${hostTeil}${pfad}${query}` || null;
}

/** Kategorie: die stabile Google-ID ("categories/gcid:plumber"), nie das Label. */
export function normalisiereKategorie(k) {
  if (!k || typeof k !== 'object') return null;
  const name = typeof k.name === 'string' ? k.name.trim() : '';
  return name || null;
}

export function normalisiereKategorien(liste) {
  if (!Array.isArray(liste)) return [];
  return liste.map(normalisiereKategorie).filter(Boolean).sort();
}

/** Adresse: Zeilen getrimmt, leere weg, PLZ/Ort/Land getrimmt; Reihenfolge der Zeilen bleibt (sie ist Bedeutung). */
export function normalisiereAdresse(a) {
  if (!a || typeof a !== 'object') return null;
  const zeilen = (Array.isArray(a.addressLines) ? a.addressLines : [])
    .map((z) => (typeof z === 'string' ? z.trim().replace(/\s+/g, ' ') : ''))
    .filter(Boolean);
  const t = (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null);
  const n = {
    zeilen,
    plz: t(a.postalCode),
    ort: t(a.locality),
    land: t(a.regionCode)?.toUpperCase() ?? null,
    region: t(a.administrativeArea),
  };
  if (!n.zeilen.length && !n.plz && !n.ort) return null;
  return n;
}

/** openInfo: nur der Status zaehlt. OPEN_FOR_BUSINESS_UNSPECIFIED gilt als unbekannt (null). */
export function normalisiereOpenInfo(o) {
  if (!o || typeof o !== 'object') return null;
  const s = typeof o.status === 'string' ? o.status : null;
  if (!s || s === 'OPEN_FOR_BUSINESS_UNSPECIFIED') return null;
  return s;
}

export const GESCHLOSSEN = Object.freeze(['CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY']);

/** Attribute: Liste → sortierte Paare attributeId → Werteliste. */
export function normalisiereAttribute(liste) {
  if (!Array.isArray(liste)) return [];
  return liste
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const id = typeof a.name === 'string' ? a.name.replace(/^.*\/attributes\//, '') : null;
      if (!id) return null;
      const werte = Array.isArray(a.values) ? a.values.map((v) => String(v)).sort()
        : Array.isArray(a.repeatedEnumValue?.setValues) ? [...a.repeatedEnumValue.setValues].sort()
        : a.uriValues ? a.uriValues.map((u) => normalisiereUrl(u?.uri)).filter(Boolean).sort()
        : [];
      return { id, werte };
    })
    .filter(Boolean)
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function gleich(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Liest einen Feldpfad aus einer Location und normalisiert ihn.
 * Rueckgabe: { norm, roh } — norm fuer den Vergleich, roh fuer die Anzeige.
 */
export function leseFeld(location, pfad) {
  const l = location ?? {};
  switch (pfad) {
    case 'openInfo':                       return { norm: normalisiereOpenInfo(l.openInfo), roh: l.openInfo?.status ?? null };
    case 'phoneNumbers.primaryPhone':      return { norm: normalisiereTelefon(l.phoneNumbers?.primaryPhone), roh: l.phoneNumbers?.primaryPhone ?? null };
    case 'websiteUri':                     return { norm: normalisiereUrl(l.websiteUri), roh: l.websiteUri ?? null };
    case 'storefrontAddress':              return { norm: normalisiereAdresse(l.storefrontAddress), roh: l.storefrontAddress ?? null };
    case 'categories.primaryCategory':     return { norm: normalisiereKategorie(l.categories?.primaryCategory), roh: l.categories?.primaryCategory?.displayName ?? l.categories?.primaryCategory?.name ?? null };
    case 'categories.additionalCategories': return { norm: normalisiereKategorien(l.categories?.additionalCategories), roh: (l.categories?.additionalCategories ?? []).map((k) => k?.displayName ?? k?.name).filter(Boolean) };
    case 'title':                          return { norm: typeof l.title === 'string' ? l.title.trim().replace(/\s+/g, ' ') || null : null, roh: l.title ?? null };
    case 'regularHours':                   return { norm: l.regularHours?.periods ?? null, roh: l.regularHours ?? null };
    case 'specialHours':                   return { norm: l.specialHours?.specialHourPeriods ?? null, roh: l.specialHours ?? null };
    case 'serviceArea':                    return { norm: l.serviceArea ? JSON.stringify(sortiertTief(l.serviceArea)) : null, roh: l.serviceArea ?? null };
    case 'attributes':                     return { norm: normalisiereAttribute(l.attributes), roh: null };
    default:                               return { norm: null, roh: null };
  }
}

/** Tiefe Sortierung von Objektschluesseln und primitiven Arrays — fuer Felder ohne eigene Semantik (serviceArea). */
export function sortiertTief(x) {
  if (Array.isArray(x)) {
    const inner = x.map(sortiertTief);
    return inner.every((v) => v === null || typeof v !== 'object') ? [...inner].sort() : inner;
  }
  if (x && typeof x === 'object') {
    return Object.keys(x).sort().reduce((o, k) => { if (x[k] !== undefined && x[k] !== null && x[k] !== '') o[k] = sortiertTief(x[k]); return o; }, {});
  }
  return x;
}

/** Feldweiser Vergleich — true, wenn gleich. */
export function feldGleich(pfad, merchantNorm, consumerNorm) {
  if (pfad === 'regularHours')  return !zeitfensterGeaendert(merchantNorm ?? [], consumerNorm ?? []);
  if (pfad === 'specialHours')  return !sonderzeitenGeaendert(merchantNorm ?? [], consumerNorm ?? []);
  return gleich(merchantNorm, consumerNorm);
}

/* ─────────────────────────────────────────────
   DIFF
   ───────────────────────────────────────────── */

/**
 * Welche Feldpfade eine Google-Maske nennt. "phoneNumbers" deckt
 * "phoneNumbers.primaryPhone" ab, "categories" beide Kategoriepfade.
 */
export function maskeTrifft(maske, pfad) {
  if (!maske) return false;
  const teile = String(maske).split(',').map((s) => s.trim()).filter(Boolean);
  return teile.some((m) => pfad === m || pfad.startsWith(m + '.') || m.startsWith(pfad + '.'));
}

/** Nennt die Maske den Pfad selbst oder ein Kind davon (nicht nur ein Elternfeld)? */
export function maskeTrifftGenau(maske, pfad) {
  if (!maske) return false;
  const teile = String(maske).split(',').map((s) => s.trim()).filter(Boolean);
  return teile.some((m) => pfad === m || m.startsWith(pfad + '.'));
}

/**
 * Herkunft / Status eines Diffs.
 *
 *   pending             eigene Aenderung noch nicht live (pendingMask)
 *   updated_by_google   Extended-API: EDIT_LIFECYCLE_STAGE_UPDATED_BY_GOOGLE
 *   rejected            Extended-API: EDIT_LIFECYCLE_STAGE_REJECTED
 *   unknown             nur diffMask bekannt — neutral formulieren
 *
 * `extended` ist optional (v1alpha); ohne sie gibt es nur pending/unknown.
 */
export function bestimmeHerkunft({ pfad, pendingMask, extended }) {
  const ext = extended?.[pfad] ?? extended?.[pfad.split('.')[0]];
  const stage = typeof ext?.lifecycleStage === 'string' ? ext.lifecycleStage : null;
  if (stage === 'EDIT_LIFECYCLE_STAGE_REJECTED') {
    return { origin: 'rejected', lifecycleStage: stage, googleEditAt: ext?.editTime ?? null, rejectionReason: ext?.rejectionReason ?? null };
  }
  if (maskeTrifft(pendingMask, pfad) || stage === 'EDIT_LIFECYCLE_STAGE_PENDING') {
    return { origin: 'pending', lifecycleStage: stage ?? 'PENDING_MASK', googleEditAt: ext?.editTime ?? null, rejectionReason: null };
  }
  if (stage === 'EDIT_LIFECYCLE_STAGE_UPDATED_BY_GOOGLE') {
    return { origin: 'updated_by_google', lifecycleStage: stage, googleEditAt: ext?.editTime ?? null, rejectionReason: null };
  }
  return { origin: 'unknown', lifecycleStage: stage, googleEditAt: ext?.editTime ?? null, rejectionReason: null };
}

/**
 * Berechnet die offenen Differenzen zwischen Merchant- und Consumer-Sicht.
 *
 * @param {object} eingabe
 * @param {object} eingabe.merchant    locations.get (Inhaberstand), inkl. attributes
 * @param {object|null} eingabe.consumer  getGoogleUpdated().location — null, wenn Google keine Aenderungen meldet
 * @param {string|null} eingabe.diffMask
 * @param {string|null} eingabe.pendingMask
 * @param {object|null} eingabe.extended  optional: { [pfad]: { lifecycleStage, editTime, rejectionReason } }
 * @returns {Array<{fieldPath, prio, label, merchantValue, consumerValue, origin, lifecycleStage, googleEditAt, rejectionReason, changeType}>}
 */
export function berechneDiffs({ merchant, consumer, diffMask, pendingMask, extended }) {
  const diffs = [];
  if (!merchant) return diffs;
  /* Ohne Consumer-Sicht liefert Google "keine Aenderungen" — ausser
     pendingMask nennt etwas: dann ist die eigene Aenderung unterwegs
     und der Consumer-Wert ist der alte, also der aktuelle Merchant-
     Wert aus Sicht der Oeffentlichkeit. Wir melden pending ohne Werte. */
  for (const pfad of FELD_PFADE) {
    const m = leseFeld(merchant, pfad);
    const c = consumer ? leseFeld(consumer, pfad) : null;
    const inPending = maskeTrifft(pendingMask, pfad);
    const inDiff = maskeTrifft(diffMask, pfad);

    let unterschied = false;
    if (c) {
      /* Google liefert in getGoogleUpdated nur die geaenderten Felder
         vollstaendig; ein fehlendes Feld in der Consumer-Sicht heisst
         "wie Merchant", nicht "leer". Deshalb nur vergleichen, wenn
         die Maske das Feld nennt ODER der Consumer-Wert vorhanden ist. */
      const consumerHatWert = c.norm !== null && !(Array.isArray(c.norm) && c.norm.length === 0);
      /* Nennt die Maske nur das Elternfeld (z. B. "categories") und
         fehlt der Unterwert in der Consumer-Sicht, ist das kein Beleg
         fuer "leer" — nur fuer "ein anderes Kind hat sich geaendert". */
      if (maskeTrifftGenau(diffMask, pfad) || consumerHatWert) unterschied = !feldGleich(pfad, m.norm, c.norm);
    }
    if (!unterschied && !inPending) continue;
    if (!unterschied && inPending && !inDiff) {
      /* reine Pending-Meldung: eigene Aenderung in Pruefung */
      const herkunft = bestimmeHerkunft({ pfad, pendingMask, extended });
      diffs.push({
        fieldPath: pfad, prio: DIFF_FELDER[pfad].prio, label: DIFF_FELDER[pfad].label,
        merchantValue: m.roh, consumerValue: null,
        ...herkunft, changeType: 'pending',
      });
      continue;
    }
    const herkunft = bestimmeHerkunft({ pfad, pendingMask, extended });
    const geschlossen = pfad === 'openInfo' && GESCHLOSSEN.includes(c?.norm) && !GESCHLOSSEN.includes(m.norm);
    diffs.push({
      fieldPath: pfad, prio: geschlossen ? 'kritisch' : DIFF_FELDER[pfad].prio, label: DIFF_FELDER[pfad].label,
      merchantValue: m.roh, consumerValue: c?.roh ?? null,
      ...herkunft,
      changeType: geschlossen ? 'closed_by_google' : herkunft.origin === 'pending' ? 'pending' : herkunft.origin === 'rejected' ? 'rejected' : 'changed',
    });
  }
  return diffs;
}

/** Stabiler Fingerabdruck eines Diff-Zustands: aendert sich der Consumer-Wert, ist es ein neuer Diff. */
export function diffFingerabdruck(d) {
  return JSON.stringify([d.fieldPath, sortiertTief(d.consumerValue ?? null), d.changeType]);
}

/* ─────────────────────────────────────────────
   ANZEIGE
   ───────────────────────────────────────────── */

export function formatWert(pfad, wert) {
  if (wert === null || wert === undefined) return '—';
  switch (pfad) {
    case 'openInfo':
      return { OPEN: 'geöffnet', CLOSED_TEMPORARILY: 'vorübergehend geschlossen', CLOSED_PERMANENTLY: 'dauerhaft geschlossen' }[wert] ?? String(wert);
    case 'storefrontAddress': {
      const a = wert;
      return [...(a.addressLines ?? []), [a.postalCode, a.locality].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—';
    }
    case 'categories.additionalCategories':
      return Array.isArray(wert) && wert.length ? wert.join(', ') : '—';
    case 'regularHours':
      return Array.isArray(wert?.periods) ? `${wert.periods.length} Zeitfenster` : '—';
    case 'specialHours':
      return Array.isArray(wert?.specialHourPeriods) ? `${wert.specialHourPeriods.length} Sondertage` : '—';
    default:
      return typeof wert === 'string' ? wert : JSON.stringify(wert);
  }
}

/**
 * Ehrliche Ueberschrift je Herkunft (§3). Nie "Google hat geaendert",
 * wenn wir es nicht wissen.
 */
export function diffUeberschrift(d) {
  const label = d.label ?? DIFF_FELDER[d.fieldPath]?.label ?? d.fieldPath;
  switch (d.changeType) {
    case 'closed_by_google':  return 'Google zeigt deinen Betrieb aktuell als geschlossen.';
    case 'pending':           return `${label}: Deine Änderung wird von Google noch geprüft.`;
    case 'rejected':          return `${label}: Google hat deine Änderung nicht übernommen.`;
    default:
      return d.origin === 'updated_by_google'
        ? `Google hat deine ${label} aktualisiert.`
        : `Google zeigt eine andere ${label}.`;
  }
}

/** Ablehnungsgruende der Extended-API, verstaendlich — kein Enum, kein erfundener Grund. */
export const ABLEHNUNGSGRUENDE = Object.freeze({
  REJECTION_REASON_UNSPECIFIED: null,
  POLICY_VIOLATION: 'Die Angabe verstößt laut Google gegen die Richtlinien für Unternehmensprofile.',
  INVALID_DATA: 'Google hält die Angabe für ungültig.',
  DUPLICATE: 'Google sieht darin ein Duplikat.',
  INSUFFICIENT_EVIDENCE: 'Google konnte die Angabe nicht bestätigen.',
});

export function ablehnungsText(grund) {
  if (!grund) return null;
  return ABLEHNUNGSGRUENDE[grund] ?? null;
}
