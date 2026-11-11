/*
 * Google Maps JavaScript API (Places) — nur bei Bedarf laden.
 *
 * Vorher stand das Skript in public/index.html und lud auf JEDER Seite
 * (auch Impressum, Datenschutz, Admin): bei jedem Seitenaufruf ging die
 * IP-Adresse des Besuchers an Google, obwohl die Betriebssuche nur an
 * einer Stelle gebraucht wird. Jetzt laedt es erst, wenn eine
 * Betriebssuche angezeigt wird (PlacesSearch).
 *
 * Einmal je Seitenleben: ein zweiter Aufruf gibt dasselbe Versprechen
 * zurueck. Ohne Schluessel (REACT_APP_GOOGLE_PLACES_API_KEY) wird nichts
 * geladen — die Suche faellt dann wie bisher auf die Eingabe von Hand
 * zurueck (Timeout in waitForGoogle).
 */

const SKRIPT_ID = 'werkruf-google-maps';
let laden = null;

export function googleMapsUrl(key) {
  return `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&language=de&region=DE&loading=async`;
}

export function ladeGoogleMaps({ key = process.env.REACT_APP_GOOGLE_PLACES_API_KEY, dokument = typeof document !== 'undefined' ? document : null } = {}) {
  if (laden) return laden;
  if (!dokument || !key) return Promise.resolve(false);
  if (typeof window !== 'undefined' && window.google?.maps?.places) return Promise.resolve(true);
  laden = new Promise((ok) => {
    if (dokument.getElementById(SKRIPT_ID)) { ok(true); return; }
    const s = dokument.createElement('script');
    s.id = SKRIPT_ID;
    s.src = googleMapsUrl(key);
    s.async = true;
    s.defer = true;
    s.onload = () => ok(true);
    s.onerror = () => { laden = null; ok(false); };
    dokument.head.appendChild(s);
  });
  return laden;
}

/* nur fuer Tests */
export function _zuruecksetzen() { laden = null; }
