/**
 * Aufgegeben ist nicht dasselbe wie gescheitert.
 *
 * ═══════════════════════════════════════════════════════════════
 * DER BEFUND
 * ═══════════════════════════════════════════════════════════════
 *
 * Am 19.10.2026 in Produktion gemessen, nach einem Widerruf der
 * Google-Freigabe:
 *
 *   status      failed
 *   attempts    1
 *   max_attempts 3
 *   error_code  reauth_required
 *
 * Die Karte machte daraus:
 *
 *   "Letzter Abgleich fehlgeschlagen
 *    Fehler: reauth_required · Versuch 1 von 3"
 *
 * Das versprach zwei weitere Versuche. Es kam keiner. Der Worker
 * gibt bei reauth_required sofort auf — mit gutem Grund, denn ein
 * ungueltiges Token dreimal zu probieren kostet nur Quota und
 * verzoegert die einzige Nachricht, die hilft.
 *
 * Fuer einen Kunden, der allein vor dem Bildschirm sitzt, ist das
 * der Unterschied zwischen Warten und Handeln. Der Knopf, der sein
 * Problem loest, steht auf derselben Seite — er wartete nur auf eine
 * Wiederholung, die es nicht gab.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESER TEST DEN QUELLTEXT LIEST
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Zuordnung "welcher Fehlercode heisst aufgegeben" steht an zwei
 * Stellen: im Worker, der aufgibt, und in der Karte, die es anzeigt.
 * Laufen sie auseinander, entsteht genau der Zustand von heute
 * zurueck — ohne dass irgendetwas abstuerzt.
 *
 * Eine Attrappe wuerde das nicht fangen: Sie prueft, was der Test
 * ihr vorgibt, nicht was die beiden Dateien einander versprechen.
 * Deshalb werden hier beide gelesen und verglichen.
 *
 * Kommentare werden vorher entfernt. Die Dateien zitieren die
 * Codes in ihren Erklaerungen, und ein Test, der den Rohtext liest,
 * findet sie dort wieder und ist gruen, ohne etwas zu belegen.
 */
import fs from 'fs';
import path from 'path';

const wurzel = process.cwd();
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

/* Blockkommentare einzeln entfernen, dann ganze Kommentarzeilen.
   Nicht zuerst ein eigenes Muster fuer die JSX-Form: Dessen Suche
   nach dem Abschluss laeuft ueber den Kommentar hinaus und loescht
   echten Code — am 16.10.2026 genau so passiert. */
const ohneKommentare = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')
  .replace(/\{\s*\}/g, ' ');

const SEITE   = ohneKommentare(lies('src/pages/dashboard/DashboardGoogleBusiness.js'));
const WORKER  = ohneKommentare(lies('supabase/functions/google-business/index.ts'));

describe('der Worker gibt bei manchen Fehlern sofort auf', () => {
  it('ruft abandon statt finish_sync_job', () => {
    expect(WORKER).toMatch(/abandon\(/);
    expect(WORKER).toMatch(/status:\s*'failed'/);
  });

  it('tut das bei reauth_required und not_connected', () => {
    /* Der Ausdruck, der die Entscheidung traegt. Kommt ein dritter
       Code dazu, faellt es in der naechsten Pruefung auf. */
    expect(WORKER).toMatch(
      /gbpError\.code === 'reauth_required'[\s\S]{0,60}gbpError\.code === 'not_connected'/,
    );
  });
});

describe('die Karte kennt dieselben Codes', () => {
  it('fuehrt sie als eigene Liste', () => {
    expect(SEITE).toMatch(/AUFGEGEBEN_CODES\s*=\s*\[[^\]]*'reauth_required'[^\]]*\]/);
    expect(SEITE).toMatch(/AUFGEGEBEN_CODES\s*=\s*\[[^\]]*'not_connected'[^\]]*\]/);
  });

  it('fuehrt genau die Codes, die der Worker aufgibt — nicht mehr, nicht weniger', () => {
    /* Die Richtung, die leichter vergessen wird. Stuende hier ein
       Code, den der Worker regulaer wiederholt, bekaeme der Kunde
       eine Handlungsaufforderung fuer etwas, das sich von selbst
       erledigt — und wuerde unnoetig neu verbinden.
     *
     * Ein frueherer Entwurf suchte die Codes in der GANZEN
     * Worker-Datei. Das war wertlos: 'rate_limited' steht dort in
     * einer ganz anderen Bedingung (Zeile 2545, Wiederholbarkeit),
     * und der Test blieb gruen, als ich ihn probeweise in die Liste
     * schmuggelte. Gelesen wird deshalb die Bedingung, die
     * unmittelbar vor this.abandon() steht — und sonst nichts. */
    const bedingung = WORKER.match(/if\s*\(([^)]*)\)\s*\{\s*await this\.abandon\(/);
    expect(bedingung).not.toBeNull();
    const workerCodes = [...bedingung[1].matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1]).sort();

    const liste = SEITE.match(/AUFGEGEBEN_CODES\s*=\s*\[([^\]]*)\]/);
    expect(liste).not.toBeNull();
    const seitenCodes = [...liste[1].matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1]).sort();

    expect(workerCodes.length).toBeGreaterThan(0);
    expect(seitenCodes).toEqual(workerCodes);
  });
});

describe('die Anzeige verspricht keine Wiederholung mehr', () => {
  it('hat einen eigenen Zustand fuer aufgegebene Jobs', () => {
    expect(SEITE).toMatch(/istAufgegeben\s*\?\s*'reauth'/);
  });

  it('zeigt den Versuchszaehler nur im Zustand error', () => {
    /* Der Kern des Befundes: "Versuch 1 von 3" darf nur dort stehen,
       wo tatsaechlich noch Versuche folgen. */
    const zaehler = SEITE.match(/Versuch \$\{[^}]*attempts\}[^`]*/);
    expect(zaehler).not.toBeNull();
    const umgebung = SEITE.slice(
      Math.max(0, SEITE.indexOf(zaehler[0]) - 220),
      SEITE.indexOf(zaehler[0]),
    );
    expect(umgebung).toMatch(/syncState === 'error'/);
    expect(umgebung).not.toMatch(/syncState === 'reauth'[\s\S]*\?[\s\S]*$/);
  });

  it('sagt im Zustand reauth, was zu tun ist', () => {
    expect(SEITE).toMatch(/syncState === 'reauth' \?\s*'Verbindung zu Google muss erneuert werden'/);
    expect(SEITE).toMatch(/Verbinde dein Konto oben neu/);
  });

  it('faerbt den Balken rot und nicht gruen', () => {
    /* Ohne eigenen Zweig faellt reauth in den Standardfall und
       bekaeme Gruen neben dem Satz "muss erneuert werden". Die Farbe
       wuerde dem Text widersprechen, und die Farbe gewinnt. */
    expect(SEITE).toMatch(/\$state === 'reauth'\s*\?\s*'#D93025'/);
  });

  it('zeigt im Zustand reauth ein Warnzeichen', () => {
    expect(SEITE).toMatch(
      /syncState === 'error' \|\| syncState === 'reauth'[\s\S]{0,80}AlertTriangle/,
    );
  });
});
