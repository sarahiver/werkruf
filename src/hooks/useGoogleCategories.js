import React from 'react';
import supabase from '../supabaseClient';

/**
 * Kategoriesuche und Kategorie-Metadaten.
 *
 * Alle Google-Aufrufe laufen über die Edge Function — im Browser gibt
 * es kein Google-Token.
 *
 * Zwei getrennte Dinge:
 *
 *   useKategorieSuche     Suche nach Anzeigenamen, mit Entprellung.
 *                         Ohne Eingabe wird nichts geladen: Google hat
 *                         mehrere tausend Kategorien, eine
 *                         Auswahlliste wäre unbrauchbar.
 *
 *   useKategorieMetadaten serviceTypes und moreHoursTypes zur
 *                         Hauptkategorie. Sie bestimmen, was in
 *                         anderen Bereichen überhaupt auswählbar ist.
 */

const BASIS = () => `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business`;

async function hole(pfad) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');

  const antwort = await fetch(`${BASIS()}${pfad}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
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
   SUCHE
───────────────────────────────────────────── */

export function useKategorieSuche(locationId, { entprellungMs = 350 } = {}) {
  const [begriff, setBegriff] = React.useState('');
  const [treffer, setTreffer] = React.useState([]);
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(null);
  const [weitereSeite, setWeitereSeite] = React.useState(null);

  /* Jede Suche bekommt eine Nummer. Trifft eine ältere Antwort später
     ein als eine neuere, wird sie verworfen — sonst überschreibt das
     Ergebnis zu „klemp" das zu „klempner". */
  const laufNr = React.useRef(0);

  React.useEffect(() => {
    const gesucht = begriff.trim();

    if (gesucht.length < 2) {
      setTreffer([]); setWeitereSeite(null); setFehler(null); setLaeuft(false);
      return undefined;
    }

    setLaeuft(true);
    const meineNr = ++laufNr.current;

    const wecker = setTimeout(async () => {
      try {
        const nutzlast = await hole(
          `/categories/search?q=${encodeURIComponent(gesucht)}`
          + (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''));

        if (meineNr !== laufNr.current) return;   // überholt
        setTreffer(nutzlast.categories ?? []);
        setWeitereSeite(nutzlast.nextPageToken ?? null);
        setFehler(null);
      } catch (err) {
        if (meineNr !== laufNr.current) return;
        setFehler(err.message);
        setTreffer([]);
      } finally {
        if (meineNr === laufNr.current) setLaeuft(false);
      }
    }, entprellungMs);

    return () => clearTimeout(wecker);
  }, [begriff, locationId, entprellungMs]);

  /** Nächste Seite nachladen — Google liefert seitenweise. */
  const mehrLaden = React.useCallback(async () => {
    if (!weitereSeite) return;
    setLaeuft(true);
    try {
      const nutzlast = await hole(
        `/categories/search?q=${encodeURIComponent(begriff.trim())}`
        + `&pageToken=${encodeURIComponent(weitereSeite)}`
        + (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''));

      setTreffer((bisher) => [...bisher, ...(nutzlast.categories ?? [])]);
      setWeitereSeite(nutzlast.nextPageToken ?? null);
    } catch (err) {
      setFehler(err.message);
    } finally {
      setLaeuft(false);
    }
  }, [begriff, weitereSeite, locationId]);

  return {
    begriff, setBegriff, treffer, laeuft, fehler,
    hatWeitere: Boolean(weitereSeite), mehrLaden,
    zuKurz: begriff.trim().length > 0 && begriff.trim().length < 2,
  };
}

/* ─────────────────────────────────────────────
   METADATEN
───────────────────────────────────────────── */

/**
 * serviceTypes und moreHoursTypes zur angegebenen Kategorie.
 *
 * Unterscheidet drei Zustände, und das ist der Kern:
 *
 *   laeuft = true        wird geladen
 *   abrufErfolgreich     Google hat geantwortet. Leere Listen heissen
 *                        dann tatsächlich: für diese Kategorie gibt es
 *                        nichts.
 *   abrufErfolgreich     Der Abruf ist gescheitert. Leere Listen sind
 *     = false            KEIN Befund — die Oberfläche darf nicht
 *                        „keine Optionen verfügbar" behaupten.
 */
export function useKategorieMetadaten(categoryName, locationId) {
  const [daten, setDaten] = React.useState(null);
  const [laeuft, setLaeuft] = React.useState(false);

  React.useEffect(() => {
    if (!categoryName) { setDaten(null); return undefined; }

    let abgebrochen = false;
    setLaeuft(true);

    (async () => {
      try {
        const nutzlast = await hole(
          `/categories/metadata?name=${encodeURIComponent(categoryName)}`
          + (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''));
        if (!abgebrochen) setDaten(nutzlast);
      } catch (err) {
        if (!abgebrochen) {
          setDaten({ abrufErfolgreich: false, fehler: err.message });
        }
      } finally {
        if (!abgebrochen) setLaeuft(false);
      }
    })();

    return () => { abgebrochen = true; };
  }, [categoryName, locationId]);

  return {
    metadaten: daten,
    laeuft,
    /* Nur wenn Google geantwortet hat, ist eine leere Liste ein
       Befund. Sonst bleibt der Zustand unbekannt. */
    moreHoursTypes: daten?.abrufErfolgreich === false ? null : (daten?.moreHoursTypes ?? null),
    serviceTypes: daten?.abrufErfolgreich === false ? null : (daten?.serviceTypes ?? null),
    abrufGescheitert: daten?.abrufErfolgreich === false,
  };
}

/* ─────────────────────────────────────────────
   VERGLEICH

   categories nimmt Google nur als Ganzes. Der Vergleich muss deshalb
   auf dem gesamten Objekt arbeiten — und die Reihenfolge der
   Zusatzkategorien ignorieren, weil sie keine Bedeutung trägt.
───────────────────────────────────────────── */

const alsSchluessel = (k) => (typeof k === 'string' ? k : k?.name ?? '');

export function kategorienGeaendert(alt, neu) {
  if (alsSchluessel(alt?.primaryCategory) !== alsSchluessel(neu?.primaryCategory)) return true;

  const a = (alt?.additionalCategories ?? []).map(alsSchluessel).sort();
  const b = (neu?.additionalCategories ?? []).map(alsSchluessel).sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

/**
 * Baut das vollständige categories-Objekt.
 *
 * Google erlaubt keine unabhängige Änderung von Haupt- und
 * Zusatzkategorien — das Schema sagt: „Clients are prohibited from
 * individually updating the primary or additional categories using the
 * update mask."
 *
 * Deshalb wird immer beides gesendet. Ein Wechsel der Hauptkategorie
 * darf die Zusatzkategorien nicht mitnehmen.
 */
export function baueKategorien({ hauptkategorie, zusatzkategorien }) {
  const objekt = {};
  if (hauptkategorie) objekt.primaryCategory = hauptkategorie;
  objekt.additionalCategories = zusatzkategorien ?? [];
  return objekt;
}

export default useKategorieSuche;
