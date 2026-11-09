/*
 * Die Produktgrenze Free / Pro, als Daten (WP7 §2).
 *
 *   Free zeigt dir den Zustand. Pro hilft dir, ihn laufend zu verbessern.
 *
 * Hier steht, WELCHE Oberflaeche zu Free gehoert — nicht, WER Free
 * ist. Das entscheidet accessTier() in subscription.js. Beide Listen
 * sind bewusst kurz: Free ist ein Rueckfallzustand, kein zweiter
 * Tarif.
 */

/** Dashboard-Pfade, die ohne Pro-Zugang benutzbar sind. */
export const FREE_PFADE = Object.freeze([
  '/dashboard',               // Uebersicht: Score, Zustand, Verbindung
  '/dashboard/google',        // Betrieb, Verbindungsstatus, Profilzustand (lesen)
  '/dashboard/einstellungen', // Abo, Konto, Loeschung
  '/dashboard/support',       // nur Founding Partner, aber kein Pro-Gate
]);

/** Liegt dieser Pfad im Free-Umfang? Query wird ignoriert. */
export function istFreiErreichbar(pfad) {
  if (typeof pfad !== 'string') return false;
  const ohneQuery = pfad.split('?')[0].replace(/\/+$/, '') || '/';
  return FREE_PFADE.includes(ohneQuery);
}

/** Statushinweis auf der Uebersicht fuer Free (WP7 §7). */
export const FREE_HINWEIS = Object.freeze({
  titel: 'Du nutzt WERKRUF Free.',
  text: 'Dein Profil und dein WERKRUF-Score bleiben im Blick. Mit Pro bekommst du wieder konkrete Aufgaben, Wochenmail, Bewertungsantworten und laufende Unterstützung.',
});

/**
 * CTA-Text: Wiedereinstieg oder erster Start — dieselbe Unterscheidung
 * wie beim Trial (hatteSchonAbo), damit niemandem ein Test versprochen
 * wird, den der Checkout nicht gibt.
 */
export function proCtaText(hatteAbo) {
  return hatteAbo ? 'Pro wieder aktivieren' : 'WERKRUF Pro starten';
}
