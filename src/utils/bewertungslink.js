/*
 * Google-Bewertungslink (WP14) — der EINE Generator.
 *
 * Bis WP14 stand die URL nur im Client (DashboardKundenGewinnung).
 * Jetzt bauen Client (Link, QR) und Edge Function (SMS) den Link aus
 * derselben Funktion. Quelle ist ausschliesslich die place_id des
 * Standorts aus google_locations — keine URL vom Client, kein
 * Rueckfall auf andere Betriebe.
 */

/* Google Place IDs: Base64-aehnlich, meist ChIJ…/EiJ…/GhIJ…, 20–200 Zeichen. */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,255}$/;

export function istPlaceIdForm(placeId) {
  return typeof placeId === 'string' && PLACE_ID_RE.test(placeId);
}

/** Kanonischer Bewertungslink oder null, wenn keine gueltige place_id. */
export function bewertungsLink(placeId) {
  if (!istPlaceIdForm(placeId)) return null;
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}
