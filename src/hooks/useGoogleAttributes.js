import React from 'react';
import supabase from '../supabaseClient';

/**
 * Attribute eines Standorts.
 *
 * Zwei Dinge kommen zusammen:
 *
 *   attributeMetadata  Was Google für DIESEN Standort anbietet —
 *                      abgefragt mit `parent`, nicht mit Kategorie und
 *                      Region. So bestimmt Google selbst, was gilt.
 *
 *   gesetzt            Was aktuell hinterlegt ist.
 *
 * Das Schema sagt ausdrücklich: „Available attributes are determined by
 * Google and may be added and removed without API changes." Eine
 * gepflegte Liste wäre also von vornherein falsch.
 */

const BASIS = () => `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business`;

async function ruf(pfad, optionen = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');

  const antwort = await fetch(`${BASIS()}${pfad}`, {
    ...optionen,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      ...(optionen.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  const nutzlast = await antwort.json().catch(() => null);
  if (!antwort.ok) {
    throw Object.assign(
      new Error(nutzlast?.error?.message || 'Google konnte nicht abgefragt werden.'),
      { code: nutzlast?.error?.code ?? `http_${antwort.status}` },
    );
  }
  return nutzlast;
}

/* ─────────────────────────────────────────────
   DATENTYPEN

   Googles AttributeMetadata trägt `valueType`. Welche Werte es gibt,
   bestimmt Google — deshalb wird hier NICHT nach dem Namen geraten,
   sondern nur nach diesem Feld unterschieden.
───────────────────────────────────────────── */

export const WERTTYP = Object.freeze({
  BOOL: 'BOOL',
  ENUM: 'ENUM',
  URL: 'URL',
  REPEATED_ENUM: 'REPEATED_ENUM',
});

/**
 * Kennen wir diesen Typ?
 *
 * Unbekannte Typen werden NICHT ignoriert und nicht geraten. Sie
 * werden schreibgeschützt angezeigt und protokolliert — Google kann
 * jederzeit neue einführen, und eine Oberfläche, die daran zerbricht
 * oder sie verschluckt, ist schlechter als eine, die sie benennt.
 */
export function istBekannterTyp(valueType) {
  return Object.values(WERTTYP).includes(valueType);
}

/** Der aktuell gesetzte Wert eines Attributs, unabhängig vom Typ. */
export function wertVon(attribut) {
  if (!attribut) return null;
  if (Array.isArray(attribut.values) && attribut.values.length > 0) return attribut.values[0];
  if (Array.isArray(attribut.repeatedEnumValue?.setValues)) return attribut.repeatedEnumValue.setValues;
  if (Array.isArray(attribut.uriValues) && attribut.uriValues.length > 0) {
    return attribut.uriValues[0]?.uri ?? null;
  }
  return null;
}

/**
 * Baut ein Attribut im von Google erwarteten Format.
 *
 * Je Typ ein anderes Feld — das ist keine Kür: Ein BOOL in `values`
 * und ein REPEATED_ENUM in `repeatedEnumValue.setValues` sind nicht
 * austauschbar.
 */
export function baueAttribut(metadaten, wert) {
  const basis = { name: metadaten.parent ?? metadaten.name };

  switch (metadaten.valueType) {
    case WERTTYP.BOOL:
      return { ...basis, values: [Boolean(wert)] };
    case WERTTYP.ENUM:
      return { ...basis, values: wert === null || wert === undefined ? [] : [wert] };
    case WERTTYP.URL:
      return { ...basis, uriValues: wert ? [{ uri: String(wert) }] : [] };
    case WERTTYP.REPEATED_ENUM:
      return { ...basis, repeatedEnumValue: { setValues: Array.isArray(wert) ? wert : [] } };
    default:
      return null;   // unbekannter Typ wird nicht geschrieben
  }
}

/** Gleichheit zweier Attributwerte, unempfindlich gegen Reihenfolge. */
export function wertGleich(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = [...(a ?? [])].sort();
    const y = [...(b ?? [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  /* null, undefined und '' meinen hier dasselbe: nicht gesetzt. */
  const leer = (v) => v === null || v === undefined || v === '';
  if (leer(a) && leer(b)) return true;
  return a === b;
}

/* ─────────────────────────────────────────────
   HOOK
───────────────────────────────────────────── */

export function useGoogleAttributes(locationId) {
  const [metadaten, setMetadaten] = React.useState([]);
  const [gesetzt, setGesetzt] = React.useState([]);
  const [vollstaendig, setVollstaendig] = React.useState(true);
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(null);

  const laden = React.useCallback(async () => {
    if (!locationId) { setMetadaten([]); setGesetzt([]); return; }
    setLaeuft(true); setFehler(null);
    try {
      const nutzlast = await ruf(
        `/attributes/available?locationId=${encodeURIComponent(locationId)}`);
      setMetadaten(nutzlast.attributeMetadata ?? []);
      setGesetzt(nutzlast.gesetzt ?? []);
      setVollstaendig(nutzlast.vollstaendig !== false);
    } catch (err) {
      setFehler(err.message);
      setMetadaten([]);
    } finally {
      setLaeuft(false);
    }
  }, [locationId]);

  React.useEffect(() => { laden(); }, [laden]);

  const speichern = React.useCallback(async (attribute) => {
    const nutzlast = await ruf('/attributes/update', {
      method: 'POST',
      body: JSON.stringify({ locationId, attributes: attribute }),
    });
    setGesetzt(nutzlast.attributes ?? []);
    return nutzlast;
  }, [locationId]);

  return { metadaten, gesetzt, vollstaendig, laeuft, fehler, laden, speichern };
}

/* ─────────────────────────────────────────────
   GRUPPIERUNG

   Google liefert `groupDisplayName`, soweit vorhanden. Wo nicht, wird
   keine Gruppe erfunden.
───────────────────────────────────────────── */

export function nachGruppen(metadaten) {
  const gruppen = new Map();
  for (const m of metadaten ?? []) {
    const name = m?.groupDisplayName || 'Weitere Eigenschaften';
    if (!gruppen.has(name)) gruppen.set(name, []);
    gruppen.get(name).push(m);
  }
  return [...gruppen.entries()].map(([name, eintraege]) => ({ name, eintraege }));
}

export default useGoogleAttributes;
