/**
 * Zugriffskontrolle für Worker-Endpunkte.
 *
 * Eigenes Modul, damit sie prüfbar ist: Eine Edge Function ruft
 * Deno.serve beim Laden auf und lässt sich nicht importieren, ohne
 * einen Server zu starten. Die Prüfung selbst ist reine Logik und
 * gehört deshalb hierher.
 *
 * Keine Node-Importe, kein Deno.env — das erwartete Secret wird
 * übergeben. Damit ist das Modul in Deno, im Supabase-Edge-Runtime und
 * in Jest gleichermassen ladbar und testbar.
 */

/**
 * Vergleich mit konstanter Laufzeit.
 *
 * Ein früh abbrechender Vergleich verrät über die Dauer, wie viele
 * Zeichen stimmen — damit liesse sich das Secret zeichenweise erraten.
 *
 * Die Längenprüfung vorweg ist unvermeidbar und unschädlich: Sie
 * verrät die Länge, nicht den Inhalt.
 */
export function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const links = encoder.encode(String(a ?? ''));
  const rechts = encoder.encode(String(b ?? ''));
  if (links.length !== rechts.length) return false;
  let diff = 0;
  for (let i = 0; i < links.length; i++) diff |= links[i] ^ rechts[i];
  return diff === 0;
}

/**
 * Prüft den X-Worker-Secret-Header.
 *
 * Wirft bei Fehlschlag einen Fehler mit status 401. Die Meldung nennt
 * weder das erwartete noch das gelieferte Secret — auch nicht in
 * gekürzter Form. Ein Protokolleintrag mit den ersten Zeichen wäre
 * bereits eine Teilpreisgabe.
 */
export function pruefeWorkerSecret(request, erwartet) {
  if (!erwartet) {
    /* Kein Secret konfiguriert heisst NICHT "alle dürfen". Sonst
       stünde der Endpunkt nach einem vergessenen Secret offen. */
    throw Object.assign(new Error('Zugriffsschutz nicht konfiguriert'), { status: 500 });
  }

  const geliefert = request?.headers?.get?.('X-Worker-Secret') ?? '';
  if (!timingSafeEqual(geliefert, erwartet)) {
    throw Object.assign(new Error('Nicht berechtigt'), { status: 401 });
  }
}
