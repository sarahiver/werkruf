/**
 * Die Onboarding-Absicht.
 *
 * ═══════════════════════════════════════════════════════════════
 * WOZU
 * ═══════════════════════════════════════════════════════════════
 *
 * Zwischen "Testphase starten" und dem fertig eingerichteten Konto
 * liegen zwei Umwege ueber Google. Dabei verlaesst der Browser die
 * Anwendung vollstaendig; React-Zustand ueberlebt das nicht.
 *
 * Die Absicht ist der Faden, der das zusammenhaelt. Sie beantwortet
 * genau eine Frage:
 *
 *   Ist dieser angemeldete Nutzer gerade mitten in der Einrichtung?
 *
 * Daraus folgen zwei Verhalten, die es ohne sie nicht gaebe:
 *
 *   1. Landet der Rueckweg von Google auf einer oeffentlichen Seite,
 *      wird der Nutzer weitergeschickt statt dort stehengelassen.
 *   2. Auf der Verbindungsseite startet der Business-OAuth von
 *      selbst, statt einen zweiten Klick zu verlangen.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM NICHT EINFACH "IST ANGEMELDET"
 * ═══════════════════════════════════════════════════════════════
 *
 * Weil das jeden Login eines bestehenden Kunden in einen
 * OAuth-Durchlauf verwandeln wuerde. Wer sich morgens anmeldet, um
 * seine Bewertungen zu lesen, hat keine Einrichtungsabsicht — und
 * bekommt deshalb auch keinen Google-Dialog vorgesetzt.
 *
 * Die Absicht entsteht ausschliesslich durch eine bewusste Handlung:
 * den Klick auf "Testphase starten".
 *
 * ═══════════════════════════════════════════════════════════════
 * DREI LEITPLANKEN
 * ═══════════════════════════════════════════════════════════════
 *
 * SIE WIRD GELOESCHT, SOBALD SIE ERFUELLT IST.
 *   Nicht irgendwann, nicht beim naechsten Start: in dem Moment, in
 *   dem die Google-Verbindung steht. Eine Absicht, die liegen
 *   bleibt, wuerde beim naechsten Besuch erneut einen OAuth
 *   ausloesen.
 *
 * SIE STARTET HOECHSTENS EINEN VERSUCH.
 *   `versuche` zaehlt mit und wird VOR dem Start erhoeht, nicht
 *   danach. Kommt der Nutzer ohne Verbindung zurueck — abgelehnt,
 *   abgebrochen, Fehler bei Google — ist der Zaehler verbraucht und
 *   nichts startet erneut. Das ist der Schutz gegen die Schleife, in
 *   der eine Seite einen OAuth startet, der auf dieselbe Seite
 *   zurueckfaellt, die wieder startet.
 *
 * SIE VERFAELLT.
 *   sessionStorage stirbt zwar mit dem Tab, aber ein Tab kann tagelang
 *   offen liegen. Eine Absicht von heute Morgen soll heute Abend
 *   keinen Dialog mehr oeffnen.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM sessionStorage
 * ═══════════════════════════════════════════════════════════════
 *
 * Sie muss einen vollstaendigen Seitenwechsel zu Google und zurueck
 * ueberstehen — React-Zustand und Speicher im Modul tun das nicht.
 *
 * sessionStorage und nicht localStorage, weil die Absicht zu EINEM
 * Einrichtungsvorgang gehoert, nicht zum Geraet. Ein zweiter Tab
 * soll nicht mitgerissen werden.
 *
 * Jeder Zugriff ist abgesichert: Im privaten Modus, bei blockierten
 * Seitendaten und in der Vorschau wirft schon das Lesen. Faellt der
 * Speicher aus, gibt es keine Absicht — dann greift der alte Weg mit
 * einem Klick mehr. Unbequem, aber nie kaputt.
 */

export const ABSICHT_SCHLUESSEL = 'werkruf_onboarding_absicht';

/** Mehr als ein selbst gestarteter OAuth je Absicht ist eine Schleife. */
const MAX_VERSUCHE = 1;

/** Nach dieser Zeit ist die Absicht kalt. */
const HOECHSTALTER_MS = 30 * 60 * 1000;

function lies() {
  if (typeof window === 'undefined') return null;
  try {
    const roh = window.sessionStorage.getItem(ABSICHT_SCHLUESSEL);
    if (!roh) return null;
    const wert = JSON.parse(roh);
    if (!wert || typeof wert !== 'object') return null;
    return wert;
  } catch (_) {
    return null;
  }
}

function schreibe(wert) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, JSON.stringify(wert));
  } catch (_) { /* Speicher nicht verfuegbar — siehe Dateikopf. */ }
}

/**
 * Merken, dass eine Einrichtung begonnen hat.
 *
 * Setzt den Versuchszaehler zurueck: Wer erneut auf "Testphase
 * starten" klickt, meint es ernst und bekommt einen frischen Versuch.
 */
export function setzeOnboardingAbsicht() {
  schreibe({ gesetztAm: Date.now(), versuche: 0 });
}

/** Liegt eine gueltige, nicht verfallene Absicht vor? */
export function hatOnboardingAbsicht() {
  const wert = lies();
  if (!wert) return false;
  if (typeof wert.gesetztAm !== 'number') return false;
  if (Date.now() - wert.gesetztAm > HOECHSTALTER_MS) {
    loescheOnboardingAbsicht();
    return false;
  }
  return true;
}

/**
 * Darf jetzt ein OAuth von selbst starten?
 *
 * Nur mit gueltiger Absicht UND freiem Versuch. Beides zusammen,
 * nicht eines davon.
 */
export function absichtDarfStarten() {
  if (!hatOnboardingAbsicht()) return false;
  const wert = lies();
  return (wert?.versuche ?? 0) < MAX_VERSUCHE;
}

/**
 * Einen selbst gestarteten Versuch vermerken.
 *
 * VOR dem Start aufrufen, nicht danach. Wer danach zaehlt, zaehlt
 * nie — der Browser ist zu diesem Zeitpunkt schon bei Google.
 */
export function vermerkeVersuch() {
  const wert = lies();
  if (!wert) return;
  schreibe({ ...wert, versuche: (wert.versuche ?? 0) + 1 });
}

/**
 * Darf die Verbindungsseite den Business-OAuth von selbst starten?
 *
 * Die Entscheidung steht hier und nicht im Effekt der Seite, weil sie
 * aus vier unabhaengigen Sperren besteht und jede davon einen Fall
 * abdeckt, der schon einmal schiefgegangen ist. Als Funktion laesst
 * sie sich einzeln pruefen; im Effekt verstreut nicht.
 *
 * @param laeuft       Verbindungsstatus wird noch geladen
 * @param beschaeftigt Es laeuft bereits ein Verbindungsvorgang
 * @param verbunden    Google ist schon verbunden
 * @param fehler       Ein Fehler steht auf der Karte
 * @param callbackFehler Der Ruecksprung trug ?gbp=error
 */
export function darfAutoStarten({
  laeuft, beschaeftigt, verbunden, fehler, callbackFehler,
}) {
  /* Sperre 3 zuerst: Nach oauth_denied hat der Nutzer bei Google
     ausdruecklich Nein gesagt. Ihm denselben Dialog erneut
     vorzusetzen, waere Noetigung — und eine Schleife. */
  if (callbackFehler) return false;
  if (fehler) return false;

  /* Sperre 4: Solange nicht feststeht, ob schon eine Verbindung
     besteht, waere ein Start geraten. */
  if (laeuft || beschaeftigt) return false;

  /* Nichts zu tun. */
  if (verbunden) return false;

  /* Sperren 1 und 2: gueltige Absicht und freier Versuch. */
  return absichtDarfStarten();
}

/** Absicht erfuellt oder hinfaellig: weg damit. */
export function loescheOnboardingAbsicht() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ABSICHT_SCHLUESSEL);
  } catch (_) { /* siehe Dateikopf */ }
}
