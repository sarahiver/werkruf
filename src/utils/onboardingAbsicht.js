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

/*
 * ═══════════════════════════════════════════════════════════════
 * 23.10.2026 (WP2): ZWEI SCHICHTEN STATT EINER
 * ═══════════════════════════════════════════════════════════════
 *
 * Der sessionStorage hat eine Grenze, die am E-Mail-Weg sichtbar
 * wurde: Der Bestaetigungslink oeffnet einen NEUEN Tab, und dort gibt
 * es keine Absicht. Kein Weiterleiten von /, kein Auto-Start — der
 * zweite Klick war wieder da.
 *
 * Deshalb liegt die Frage "ist dieser Nutzer noch in der Einrichtung?"
 * jetzt am Profil: user_profiles.onboarding_completed_at. NULL heisst
 * offen. Gesetzt wird sie in der Datenbank bei der ersten
 * erfolgreichen Betriebsauswahl (apply_google_location_selection) —
 * fuer jeden Tab, jeden Browser, jede Mail gleich. Bestandsprofile
 * wurden beim Einspielen pauschal als fertig markiert; ein
 * bestehender Kunde kommt so nie in den Auto-OAuth.
 *
 *   onboardingOffen(profile, …)   ← die Absicht. Aus der Datenbank.
 *
 * Der sessionStorage behaelt eine Aufgabe, die nur er erfuellen kann:
 * den Versuchszaehler. "Hoechstens ein selbst gestarteter OAuth je
 * Tab und Schritt" muss den Umweg ueber Google ueberleben und darf
 * NICHT tabuebergreifend sein (zwei Tabs sollen sich nicht gegenseitig
 * sperren oder anschieben). Fehlt der Eintrag — neuer Tab aus der
 * Mail —, zaehlt das als null Versuche: genau ein Auto-Start ist dann
 * erlaubt, danach keiner mehr.
 *
 *   absichtDarfStarten() / vermerkeVersuch()   ← der Zaehler. Tab-lokal.
 *
 * setzeOnboardingAbsicht() und hatOnboardingAbsicht() bleiben fuer den
 * CTA-Klick (frischer Zaehler) und als tab-lokale Spur; sie
 * entscheiden aber nicht mehr allein.
 */

export const ABSICHT_SCHLUESSEL = 'werkruf_onboarding_absicht';

/**
 * Die Absicht, aus der Datenbank: Ist die Einrichtung dieses Nutzers
 * noch offen?
 *
 * Dieselbe Vorsicht wie beim ZustimmungsTor: Profil null oder ladend
 * heisst "noch nicht entschieden", nicht "offen". Ein Fehler beim
 * Laden heisst auch nicht offen — ein Ausfall darf keinen OAuth
 * starten. Nur ein geladenes Profil ohne Abschlusszeitpunkt ist offen.
 */
export function onboardingOffen({ profile, profileLoading, profileError }) {
  if (profileLoading) return false;
  if (profileError) return false;
  if (!profile) return false;
  if (!('onboarding_completed_at' in profile)) return false;   // Spalte fehlt (Migration nicht da) → nie raten
  return profile.onboarding_completed_at == null;
}

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
  const wert = lies();
  /* Kein Eintrag (neuer Tab aus der Bestaetigungsmail) = noch kein
     Versuch in diesem Tab. Ob ueberhaupt eine Einrichtung laeuft,
     entscheidet onboardingOffen() — nicht dieser Zaehler. */
  if (!wert) return true;
  if (typeof wert.versuche !== 'number') return false;   // Schrott: lieber nicht
  if (typeof wert.gesetztAm === 'number' && Date.now() - wert.gesetztAm > HOECHSTALTER_MS) {
    /* Verfallener Eintrag: wie keiner. */
    return true;
  }
  return wert.versuche < MAX_VERSUCHE;
}

/**
 * Einen selbst gestarteten Versuch vermerken.
 *
 * VOR dem Start aufrufen, nicht danach. Wer danach zaehlt, zaehlt
 * nie — der Browser ist zu diesem Zeitpunkt schon bei Google.
 */
export function vermerkeVersuch() {
  const wert = lies();
  const alt = (wert && typeof wert.versuche === 'number'
               && typeof wert.gesetztAm === 'number'
               && Date.now() - wert.gesetztAm <= HOECHSTALTER_MS)
    ? wert
    : { gesetztAm: Date.now(), versuche: 0 };
  schreibe({ ...alt, versuche: alt.versuche + 1 });
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
  absichtAktiv, laeuft, beschaeftigt, verbunden, fehler, callbackFehler,
}) {
  /* Sperre 0: keine offene Einrichtung laut Profil → nie. Das ist
     der Schutz fuer Bestandskunden. Ohne Angabe (alter Aufrufer)
     gilt: nicht aktiv. */
  if (absichtAktiv !== true) return false;

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

  /* Sperre 1: freier Versuch in diesem Tab. */
  return absichtDarfStarten();
}

/** Absicht erfuellt oder hinfaellig: weg damit. */
export function loescheOnboardingAbsicht() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ABSICHT_SCHLUESSEL);
  } catch (_) { /* siehe Dateikopf */ }
}

/**
 * Wo steht die Einrichtung? Reine Funktion fuer die Verbindungsseite
 * und die Tests. Liefert genau einen Zustand:
 *
 *   'inaktiv'        keine offene Einrichtung (Bestandskunde) oder noch
 *                    nicht entscheidbar
 *   'verbinden'      Business-OAuth fehlt
 *   'warten'         verbunden, Betriebe werden noch geladen
 *   'keine_betriebe' verbunden, Google kennt keinen verwaltbaren Betrieb
 *   'auswahl'        mehrere Betriebe, noch keiner gewaehlt
 *   'fertig'         ein Betrieb ist ausgewaehlt → Dashboard
 *
 * Der Fall "genau ein Betrieb, noch nicht gewaehlt" ist bewusst
 * 'warten': Die Auswahl trifft die Datenbank (auto_select_single_location)
 * im Erstimport, nicht die Oberflaeche. Hier wird nie locations[0]
 * gewaehlt.
 */
export function onboardingSchritt({
  einrichtungOffen, loading, isConnected, locations, selectedLocationId, keineBetriebe,
}) {
  if (!einrichtungOffen) return 'inaktiv';
  if (!isConnected) return 'verbinden';
  if (loading) return 'warten';
  if (selectedLocationId) return 'fertig';
  const anzahl = Array.isArray(locations) ? locations.length : 0;
  if (anzahl === 0) return keineBetriebe ? 'keine_betriebe' : 'warten';
  if (anzahl === 1) return 'warten';
  return 'auswahl';
}
