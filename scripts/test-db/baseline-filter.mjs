#!/usr/bin/env node
/**
 * Macht production-baseline-2026-09-22.sql ladbar — ohne sie zu ändern.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN FILTER BRAUCHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Drei Dinge stehen zwischen der Baseline und einer lokalen Datenbank:
 *
 *   1. Die Datei ist abgeschnitten. Sie endet mitten in
 *      CREATE VIEW public.ops_reply_pipeline, bei "min(created_at) F".
 *      Ein psql mit ON_ERROR_STOP bricht daran ab.
 *
 *   2. SET transaction_timeout gibt es erst ab PostgreSQL 17.
 *      Produktion läuft auf 17.6, lokal steht 16 zur Verfügung.
 *
 *   3. \restrict ist ein psql-Metabefehl neuerer Versionen und hat
 *      ohne das zugehörige \unrestrict — das abgeschnitten ist —
 *      ohnehin keinen Sinn.
 *
 * Der Filter entfernt nichts aus dem Repo: er liest die Baseline und
 * schreibt eine ladbare Fassung nach stdout. Die Originaldatei bleibt
 * unberührt (Auftrag Punkt 37).
 *
 * ═══════════════════════════════════════════════════════════════
 * DIE WICHTIGE EIGENSCHAFT: DER FILTER SCHWEIGT NICHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Ein Filter, der stillschweigend abschneidet, wäre genau der Fehler,
 * den G1 behebt — eine Testdatenbank, die weniger enthält als
 * Produktion, ohne dass es jemand merkt.
 *
 * Deshalb:
 *
 *   Der abgeschnittene Rest wird mit einer bekannten Signatur
 *   verglichen. Stimmt sie, gibt es eine Warnung auf stderr und es
 *   geht weiter. Stimmt sie nicht, bricht der Filter ab.
 *
 * Folge: Wird die Baseline eines Tages durch einen vollständigen Dump
 * ersetzt, passiert eines von zwei Dingen — entweder ist nichts mehr
 * abgeschnitten und der Filter reicht die Datei unverändert durch, oder
 * sie ist anders abgeschnitten und das Setup wird rot. Beides ist
 * richtig. Was nicht passieren kann, ist ein neuer, unbemerkter Verlust.
 *
 * Aufruf:
 *   node scripts/test-db/baseline-filter.mjs <datei> > /tmp/ladbar.sql
 */

import { readFileSync } from 'node:fs';

/* Der eine bekannte Verlust, Stand 2026-10-09. */
const BEKANNTE_LUECKE = {
  objekt: 'CREATE VIEW public.ops_reply_pipeline',
  endetMit: 'min(created_at) F',
  zeichen: 217,
};

/* Zeilen, die lokal nicht gelten. Nur Präambel von pg_dump — kein Schema. */
const UEBERSPRINGEN = [
  { praefix: 'SET transaction_timeout', grund: 'erst ab PostgreSQL 17' },
  { praefix: '\\restrict', grund: 'psql-Metabefehl, Gegenstück abgeschnitten' },
  { praefix: '\\unrestrict', grund: 'psql-Metabefehl' },
];

const datei = process.argv[2];
if (!datei) {
  process.stderr.write('Aufruf: baseline-filter.mjs <baseline.sql>\n');
  process.exit(2);
}

const inhalt = readFileSync(datei, 'utf8');

/* ── Abgeschnittenen Rest bestimmen ──
 *
 * Nicht über lastIndexOf(';'): pg_dump schreibt vor jedem Objekt einen
 * Kommentarblock, und der enthält selbst Semikolons —
 *
 *   -- Name: ops_reply_pipeline; Type: VIEW; Schema: public; Owner: -
 *
 * Gesucht ist deshalb die letzte Zeile, die ein Statement abschließt:
 * pg_dump beendet jedes mit einem Semikolon als letztem Zeichen der
 * Zeile. Kommentarzeilen und Leerraum danach zählen nicht als Verlust.
 */
const alleZeilen = inhalt.split('\n');
let letzteStatementZeile = -1;
for (let i = alleZeilen.length - 1; i >= 0; i -= 1) {
  const z = alleZeilen[i].trimEnd();
  if (z.endsWith(';') && !z.trimStart().startsWith('--')) {
    letzteStatementZeile = i;
    break;
  }
}
if (letzteStatementZeile === -1) {
  process.stderr.write('FEHLER: Kein abgeschlossenes Statement gefunden.\n');
  process.exit(1);
}

const restZeilen = alleZeilen.slice(letzteStatementZeile + 1);
const restOhneKommentare = restZeilen
  .filter((z) => z.trim() !== '' && !z.trim().startsWith('--'))
  .join('\n')
  .trim();

let vollstaendig = inhalt;

if (restOhneKommentare !== '') {
  /* Es ist wirklich etwas abgeschnitten. Ist es das Bekannte? */
  const passtObjekt = restOhneKommentare.startsWith(BEKANNTE_LUECKE.objekt);
  const passtEnde = restOhneKommentare.endsWith(BEKANNTE_LUECKE.endetMit);

  if (!passtObjekt || !passtEnde) {
    process.stderr.write(
      '\nFEHLER: Die Baseline ist anders abgeschnitten als bekannt.\n\n' +
        `  erwartet:  ${BEKANNTE_LUECKE.objekt} … ${BEKANNTE_LUECKE.endetMit}\n` +
        `  gefunden:  ${restOhneKommentare.slice(0, 70)} … ` +
        `${restOhneKommentare.slice(-24)}\n\n` +
        'Das Setup bricht hier ab, statt stillschweigend weniger zu laden\n' +
        'als Produktion hat. Prüfe die Baseline und, wenn der Verlust neu\n' +
        'und gewollt ist, BEKANNTE_LUECKE in dieser Datei.\n\n',
    );
    process.exit(1);
  }

  process.stderr.write(
    '\nWARNUNG: Die Baseline ist abgeschnitten — bekannter Verlust.\n' +
      `  ${BEKANNTE_LUECKE.objekt} fehlt (${restOhneKommentare.length} Zeichen).\n` +
      '  Mit ihr fehlt alles, was pg_dump danach schreibt: Schlüssel,\n' +
      '  Indizes, Trigger, Policies, Sequenzen.\n' +
      '  Teilweise ergänzt in sql/20-baseline-luecken.sql, offen in\n' +
      '  docs/testing/baseline-luecken.md.\n\n',
  );

  vollstaendig = alleZeilen.slice(0, letzteStatementZeile + 1).join('\n');
}

/* ── Präambelzeilen ersetzen, nicht löschen ──
   Als Kommentar bleiben sie sichtbar: wer die geladene Fassung liest,
   sieht, was übersprungen wurde und warum. */
const zeilen = vollstaendig.split('\n').map((zeile) => {
  const treffer = UEBERSPRINGEN.find((u) => zeile.startsWith(u.praefix));
  return treffer ? `-- [testaufbau: ${treffer.grund}] ${zeile}` : zeile;
});

process.stdout.write(`${zeilen.join('\n')}\n`);
