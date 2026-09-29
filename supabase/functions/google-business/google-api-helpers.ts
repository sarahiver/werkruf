export const LOCATION_READ_MASK = [
  'name', 'title', 'phoneNumbers', 'websiteUri', 'storefrontAddress',
  'categories', 'regularHours', 'specialHours', 'moreHours', 'serviceArea',
  'profile', 'serviceItems', 'metadata',
].join(',');

export const EDITABLE_LOCATION_FIELDS = new Set([
  'phoneNumbers', 'websiteUri', 'regularHours', 'specialHours', 'moreHours',
  'serviceArea', 'profile', 'serviceItems', 'categories',
]);

/**
 * Unterfelder, die einzeln geschrieben werden duerfen.
 *
 * Warum das noetig ist: Google ersetzt bei updateMask=profile das
 * GESAMTE profile-Objekt durch das, was im Patch steht. Wer nur die
 * Beschreibung aendert und profile: { description } schickt, loescht
 * damit jedes andere Unterfeld, das Google dort fuehrt. Dasselbe gilt
 * fuer phoneNumbers: updateMask=phoneNumbers mit nur primaryPhone
 * entfernt die additionalPhones.
 *
 * Mit updateMask=profile.description bleibt der Rest unangetastet.
 */
export const EDITABLE_LOCATION_SUBFIELDS = new Set([
  'phoneNumbers.primaryPhone',
  'phoneNumbers.additionalPhones',
  'profile.description',
  'serviceArea.businessType',
  'serviceArea.places',
]);

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
