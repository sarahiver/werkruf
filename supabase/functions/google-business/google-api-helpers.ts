import {
  schreibbarePfade, unterpfadErlaubt, nurGanzeObjekte,
} from '../../../src/utils/gbpFieldModel.js';

export const LOCATION_READ_MASK = [
  'name', 'title', 'phoneNumbers', 'websiteUri', 'storefrontAddress',
  'categories', 'regularHours', 'specialHours', 'moreHours', 'serviceArea',
  'profile', 'serviceItems', 'metadata',
].join(',');

/*
 * Die Erlaubnislisten stammen aus dem gemeinsamen Feldmodell in
 * src/utils/gbpFieldModel.js — derselben Datei, aus der auch die
 * Oberflaeche ihre Felder bezieht.
 *
 * Warum nicht zwei getrennte Listen: Am 29.09. stand
 * phoneNumbers.primaryPhone als erlaubter Unterpfad im Server,
 * waehrend das Discovery-Dokument ausdruecklich sagt, dass Google
 * Telefonnummern nur als Ganzes annimmt. Eine zweite Liste laeuft
 * auseinander; eine gemeinsame kann es nicht.
 *
 * Das Modell steuert die Oberflaeche. VERBINDLICH ist diese Datei:
 * sanitizeLocationPatch verwirft alles, was nicht im Modell steht,
 * unabhaengig davon, was der Aufrufer schickt.
 */
export const EDITABLE_LOCATION_FIELDS = new Set(
  schreibbarePfade().filter((p) => !p.includes('.')),
);

export const EDITABLE_LOCATION_SUBFIELDS = new Set(unterpfadErlaubt());

/**
 * Felder, die Google NUR als Ganzes akzeptiert.
 *
 * Belegt aus dem Discovery-Dokument vom 27.09.2026:
 *
 *   PhoneNumbers: "During updates, both fields must be set. Clients may
 *   not update just the primary or additional phone numbers using the
 *   update mask."
 *
 *   Categories: "During updates, both fields must be set. Clients are
 *   prohibited from individually updating the primary or additional
 *   categories using the update mask."
 *
 * Wer hier einen Unterpfad schickt, bekommt von Google einen Fehler —
 * oder schlimmer, das Feld wird stillschweigend geleert.
 */
export const WHOLE_OBJECT_ONLY_FIELDS = new Set(nurGanzeObjekte());

/** Setzt einen Wert unter einem Punktpfad, ohne Geschwisterfelder anzufassen. */
function setzeTiefenwert(ziel: Record<string, unknown>, pfad: string, wert: unknown): void {
  const teile = pfad.split('.');
  let knoten = ziel;
  for (let i = 0; i < teile.length - 1; i++) {
    const schluessel = teile[i];
    if (typeof knoten[schluessel] !== 'object' || knoten[schluessel] === null) {
      knoten[schluessel] = {};
    }
    knoten = knoten[schluessel] as Record<string, unknown>;
  }
  knoten[teile[teile.length - 1]] = wert;
}

/**
 * Wehrt Massenzuweisungen ab und leitet die kleinstmoegliche
 * Google-updateMask ab.
 *
 * Akzeptiert sowohl Top-Level-Felder ("websiteUri") als auch
 * Punktpfade ("profile.description"). Punktpfade sind vorzuziehen,
 * weil sie nur das benannte Unterfeld ersetzen.
 *
 * Alles, was weder in EDITABLE_LOCATION_FIELDS noch in
 * EDITABLE_LOCATION_SUBFIELDS steht, wird verworfen — nicht
 * uebernommen und nicht in die Maske aufgenommen.
 */
export function sanitizeLocationPatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  const maskenfelder: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;

    /* Unterpfad eines Feldes, das Google nur ganz akzeptiert — wird
       verworfen, nicht stillschweigend zum Oberfeld erweitert. Sonst
       schickte der Aufrufer ein unvollstaendiges Objekt und loeschte
       damit die uebrigen Unterfelder. */
    const oberfeld = key.includes('.') ? key.split('.')[0] : null;
    if (oberfeld && WHOLE_OBJECT_ONLY_FIELDS.has(oberfeld)) continue;

    if (EDITABLE_LOCATION_SUBFIELDS.has(key)) {
      setzeTiefenwert(patch, key, value);
      maskenfelder.push(key);
      continue;
    }

    if (EDITABLE_LOCATION_FIELDS.has(key)) {
      patch[key] = value;
      maskenfelder.push(key);
    }
  }

  return { patch, updateMask: maskenfelder.sort().join(',') };
}
