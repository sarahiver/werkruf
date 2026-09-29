/**
 * Tests für die Vergleichs- und Einstufungslogik des API-Monitorings.
 *
 * Führt die echten Funktionen aus scripts/gbp-api-diff.mjs aus —
 * dieselben, die die Edge Function verwendet.
 */
import {
  STUFEN, vergleicheSchema, stufeEin, hoechsteStufe,
  zerlegeChangeLog, vergleicheChangeLog, stufeChangeLogEin, signatur, htmlZuText,
} from '../../scripts/gbp-api-diff.mjs';

/* crypto.subtle gibt es in Deno und im Supabase-Runtime von Haus aus,
   in der jsdom-Umgebung von CRA nicht. Node liefert dieselbe
   WebCrypto-Implementierung — damit prueft der Test denselben
   Algorithmus, den die Function verwendet. */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // eslint-disable-next-line global-require
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
  /* jsdom bringt TextEncoder ebenfalls nicht mit. */
  if (typeof globalThis.TextEncoder === 'undefined') {
    // eslint-disable-next-line global-require
    const { TextEncoder, TextDecoder } = require('util');
    Object.assign(globalThis, { TextEncoder, TextDecoder });
  }
});

/* Kleinster gültiger normalisierter Stand. */
const leer = { ressourcen: {}, schemata: {} };

const mitMethode = (name, def = {}) => ({
  ressourcen: { [name]: { httpMethod: 'GET', path: 'v1/x', parameters: {}, deprecated: false, ...def } },
  schemata: {},
});

const mitFeld = (schema, feld, def = {}) => ({
  ressourcen: {},
  schemata: { [schema]: { [feld]: { type: 'string', readOnly: false, deprecated: false, enum: null, ...def } } },
});

describe('Schema-Vergleich', () => {
  it('erkennt ein neues Feld', () => {
    const u = vergleicheSchema(leer, mitFeld('Location', 'neuesFeld'));
    expect(u).toEqual([
      expect.objectContaining({ art: 'schema.neu', pfad: 'Location' }),
    ]);
  });

  it('erkennt ein entferntes Feld', () => {
    const u = vergleicheSchema(
      mitFeld('Location', 'altesFeld'),
      { ressourcen: {}, schemata: { Location: {} } },
    );
    expect(u).toContainEqual(expect.objectContaining({ art: 'feld.entfernt', pfad: 'Location.altesFeld' }));
  });

  it('erkennt einen geänderten Datentyp', () => {
    const u = vergleicheSchema(
      mitFeld('Location', 'zahl', { type: 'string' }),
      mitFeld('Location', 'zahl', { type: 'integer' }),
    );
    expect(u).toContainEqual(expect.objectContaining({
      art: 'feld.typ_geaendert', pfad: 'Location.zahl', alt: 'string', neu: 'integer',
    }));
  });

  it('erkennt eine Abkündigung', () => {
    const u = vergleicheSchema(
      mitFeld('Location', 'altfeld'),
      mitFeld('Location', 'altfeld', { deprecated: true }),
    );
    expect(u).toContainEqual(expect.objectContaining({ art: 'feld.veraltet', pfad: 'Location.altfeld' }));
  });

  it('erkennt, wenn ein schreibbares Feld nur noch lesbar ist', () => {
    const u = vergleicheSchema(
      mitFeld('Location', 'titel'),
      mitFeld('Location', 'titel', { readOnly: true }),
    );
    expect(u).toContainEqual(expect.objectContaining({ art: 'feld.jetzt_nur_lesbar' }));
  });

  it('erkennt neue und entfernte Enum-Werte getrennt', () => {
    const u = vergleicheSchema(
      mitFeld('OpenInfo', 'status', { enum: ['OPEN', 'CLOSED'] }),
      mitFeld('OpenInfo', 'status', { enum: ['OPEN', 'PAUSED'] }),
    );
    expect(u).toContainEqual(expect.objectContaining({ art: 'enum.entfernt', alt: ['CLOSED'] }));
    expect(u).toContainEqual(expect.objectContaining({ art: 'enum.neu', neu: ['PAUSED'] }));
  });

  it('erkennt eine entfernte Methode', () => {
    const u = vergleicheSchema(mitMethode('locations.get'), leer);
    expect(u).toContainEqual(expect.objectContaining({ art: 'methode.entfernt', pfad: 'locations.get' }));
  });

  it('erkennt ein geändertes HTTP-Verb', () => {
    const u = vergleicheSchema(
      mitMethode('locations.patch', { httpMethod: 'PATCH' }),
      mitMethode('locations.patch', { httpMethod: 'PUT' }),
    );
    expect(u).toContainEqual(expect.objectContaining({
      art: 'methode.http_geaendert', alt: 'PATCH', neu: 'PUT',
    }));
  });

  it('unterscheidet neue Pflicht- von neuen Wahlparametern', () => {
    const vorher = mitMethode('locations.get', { parameters: {} });
    const pflicht = mitMethode('locations.get', { parameters: { readMask: { type: 'string', required: true } } });
    const wahl    = mitMethode('locations.get', { parameters: { filter: { type: 'string', required: false } } });

    expect(vergleicheSchema(vorher, pflicht)).toContainEqual(
      expect.objectContaining({ art: 'parameter.neu_pflicht' }));
    expect(vergleicheSchema(vorher, wahl)).toContainEqual(
      expect.objectContaining({ art: 'parameter.neu' }));
  });

  it('erkennt, wenn ein Wahlparameter zur Pflicht wird', () => {
    const u = vergleicheSchema(
      mitMethode('locations.get', { parameters: { readMask: { type: 'string', required: false } } }),
      mitMethode('locations.get', { parameters: { readMask: { type: 'string', required: true } } }),
    );
    expect(u).toContainEqual(expect.objectContaining({ art: 'parameter.jetzt_pflicht' }));
  });

  it('meldet bei unverändertem Stand nichts', () => {
    const stand = mitFeld('Location', 'titel');
    expect(vergleicheSchema(stand, stand)).toEqual([]);
  });
});

describe('Einstufung', () => {
  it('stuft eine brechende Änderung in genutzter API als kritisch ein', () => {
    const e = stufeEin({ art: 'feld.entfernt', pfad: 'Location.titel' }, { apiGenutzt: true });
    expect(e.stufe).toBe(STUFEN.KRITISCH);
    expect(e.begruendung).toMatch(/produktiv/i);
  });

  it('stuft dieselbe Änderung in ungenutzter API niedriger ein', () => {
    const e = stufeEin({ art: 'feld.entfernt', pfad: 'X.y' }, { apiGenutzt: false });
    expect(e.stufe).toBe(STUFEN.HANDLUNGSBEDARF);
    expect(e.begruendung).toMatch(/nicht auf/i);
  });

  it('stuft eine Abkündigung in genutzter API als kritisch ein', () => {
    expect(stufeEin({ art: 'methode.veraltet', pfad: 'a.b' }, { apiGenutzt: true }).stufe)
      .toBe(STUFEN.KRITISCH);
  });

  it('stuft ein neues Feld in genutzter API als Handlungsbedarf ein', () => {
    expect(stufeEin({ art: 'feld.neu', pfad: 'Location.neu' }, { apiGenutzt: true }).stufe)
      .toBe(STUFEN.HANDLUNGSBEDARF);
  });

  it('stuft ein neues Feld in ungenutzter API als Information ein', () => {
    expect(stufeEin({ art: 'feld.neu', pfad: 'X.y' }, { apiGenutzt: false }).stufe)
      .toBe(STUFEN.INFORMATION);
  });

  it('nimmt die höchste Stufe einer Liste', () => {
    expect(hoechsteStufe([
      { stufe: STUFEN.INFORMATION }, { stufe: STUFEN.KRITISCH }, { stufe: STUFEN.HANDLUNGSBEDARF },
    ])).toBe(STUFEN.KRITISCH);
    expect(hoechsteStufe([{ stufe: STUFEN.INFORMATION }])).toBe(STUFEN.INFORMATION);
  });
});

describe('Change-Log-Auswertung', () => {
  /*
   * Die Vorlage ist HTML, nicht Markdown — und sie geht durch
   * htmlZuText, also denselben Weg wie in der Edge Function.
   *
   * Warum das wichtig ist: Ein früherer Test schrieb die Vorlage in
   * Markdown und der Zerleger verlangte Rauten (`## v4.9`). Aus HTML
   * umgewandelter Text hat keine. Der Test war grün, und auf der echten
   * Seite fand die Auswertung trotzdem keine einzige
   * Versionsüberschrift — sechs von über zwanzig Abschnitten.
   *
   * Seitdem liegt die Umwandlung im geteilten Modul, und der Test
   * beginnt bei HTML.
   */
  const HTML = `
<html><head><title>Change Log</title></head><body>
<nav><ul><li><a href="/x">Guides</a></li></ul></nav>
<h1>Change Log</h1>
<h2 id="v4.9">v4.9</h2>
<h3>New Features</h3>
<p><strong>2026-07-24</strong></p>
<p><code>review_reply_url</code>: The reviewReplyUrl can now be retrieved.</p>
<p><strong>2026-04-01</strong></p>
<p><code>Review Reply State</code>: ReviewReplyState can now be retrieved.</p>
<h3>Behavioral Changes</h3>
<p>v4.x Accounts Deprecation</p>
<p>accounts and accounts.admins are now deprecated in the Google My Business API.</p>
<h2 id="v4.8">v4.8</h2>
<h3>New Features</h3>
<p>Lodging Amenities</p>
<h2 id="v3.3">v3.3</h2>
<h3>New features</h3>
<p>Structured Menus</p>
<p>Except as otherwise noted, the content of this page is licensed under CC BY 4.0.</p>
<p>Last updated 2026-08-28 UTC.</p>
<footer><p>Google Developers</p></footer>
</body></html>`;

  const zerlege = (html) => zerlegeChangeLog(htmlZuText(html));

  it('findet Versionsüberschriften in aus HTML gewonnenem Text', () => {
    /* Genau das schlug auf der echten Seite fehl. */
    const schluessel = zerlege(HTML).map((x) => x.datum);
    expect(schluessel).toEqual(expect.arrayContaining(['v4.9', 'v4.8', 'v3.3']));
  });

  it('erfasst Versionen, Unterabschnitte und Datumsangaben zusammen', () => {
    const e = zerlege(HTML);
    expect(e.map((x) => x.datum)).toEqual(expect.arrayContaining([
      'v4.9', 'v4.8', 'v3.3', '2026-07-24', '2026-04-01', 'Behavioral Changes',
    ]));
    expect(e.length).toBeGreaterThanOrEqual(8);
  });

  it('erfasst den Abschnitt mit den Abkündigungen', () => {
    const abk = zerlege(HTML).find((x) => x.datum === 'Behavioral Changes');
    expect(abk).toBeDefined();
    expect(abk.inhalt).toMatch(/deprecated/i);
  });

  it('lässt Navigation, Fußzeile und Lizenzhinweis draußen', () => {
    const alles = zerlege(HTML).map((x) => x.inhalt).join('\n');
    expect(alles).not.toMatch(/Last updated/);
    expect(alles).not.toMatch(/licensed under/);
    expect(alles).not.toMatch(/Guides/);
    expect(alles).not.toMatch(/Google Developers/);
  });

  it('verlangt das Datum nicht allein auf einer Zeile', () => {
    const e = zerlege('<h2>v9.0</h2><h3>New Features</h3><p><b>2026-09-25</b> Etwas ist neu.</p>');
    expect(e.map((x) => x.datum)).toContain('2026-09-25');
  });

  it('kommt auch mit Markdown-Rauten zurecht', () => {
    /* Falls Google die Seite je anders ausliefert. */
    const e = zerlegeChangeLog('## v9.0\n\n### New Features\n\n2026-09-25\n\nEtwas Neues.\n');
    expect(e.map((x) => x.datum)).toEqual(expect.arrayContaining(['v9.0', '2026-09-25']));
  });

  it('hält eine Versionsnummer im Fließtext nicht für eine Überschrift', () => {
    const e = zerlegeChangeLog('Irgendein Satz über v4.9 mitten im Text ohne Gliederung.');
    expect(e.map((x) => x.datum)).not.toContain('v4.9');
  });

  it('erkennt einen neuen Abschnitt', () => {
    const alt = zerlege(HTML);
    const neu = zerlege(HTML.replace('<h2 id="v4.9">v4.9</h2>',
      '<h2 id="v5.0">v5.0</h2><h3>New Features</h3><p>Ganz neu.</p><h2 id="v4.9">v4.9</h2>'));
    expect(vergleicheChangeLog(alt, neu)).toContainEqual(
      expect.objectContaining({ art: 'changelog.neuer_eintrag', pfad: 'v5.0' }));
  });

  it('erkennt einen nachträglich geänderten Abschnitt', () => {
    const alt = zerlege(HTML);
    const neu = zerlege(HTML.replace('Lodging Amenities', 'Lodging Amenities erweitert'));
    expect(vergleicheChangeLog(alt, neu)).toContainEqual(
      expect.objectContaining({ art: 'changelog.eintrag_geaendert' }));
  });

  it('meldet bei unveränderter Seite nichts', () => {
    const e = zerlege(HTML);
    expect(vergleicheChangeLog(e, e)).toEqual([]);
  });

  it('meldet eine reine Layout- und Datumsänderung der Fußzeile nicht', () => {
    const alt = zerlege(HTML);
    const neu = zerlege(HTML
      .replace('Last updated 2026-08-28 UTC.', 'Last updated 2026-10-15 UTC.')
      .replace('<nav><ul><li><a href="/x">Guides</a></li></ul></nav>', '<nav><p>Andere Navigation</p></nav>'));
    expect(vergleicheChangeLog(alt, neu)).toEqual([]);
  });

  it('liefert bei unlesbarer Seite keine erfundenen Einträge', () => {
    expect(zerlege('<html><body><p>nichts Gegliedertes</p></body></html>')).toEqual([]);
    expect(zerlegeChangeLog('')).toEqual([]);
    expect(zerlegeChangeLog(null)).toEqual([]);
    expect(htmlZuText(null)).toBe('');
  });

  it('macht aus wiederkehrenden Überschriften eindeutige Schlüssel', () => {
    const e = zerlege(HTML);
    expect(new Set(e.map((x) => x.datum)).size).toBe(e.length);
  });

  it('stuft einen Eintrag mit Abschaltungswort als kritisch ein', () => {
    expect(stufeChangeLogEin({
      art: 'changelog.neuer_eintrag', pfad: 'X',
      neu: 'The questions and answers endpoints will be removed on November 3.',
    }).stufe).toBe(STUFEN.KRITISCH);
  });

  it('stuft einen gewöhnlichen Eintrag zurückhaltend ein', () => {
    expect(stufeChangeLogEin({
      art: 'changelog.neuer_eintrag', pfad: 'X', neu: 'Added a new optional field.',
    }).stufe).toBe(STUFEN.HANDLUNGSBEDARF);
  });
});

describe('Signatur', () => {
  it('ist für dieselben Unterschiede gleich', async () => {
    const u = [{ art: 'feld.neu', pfad: 'A.b' }];
    expect(await signatur('q', u)).toBe(await signatur('q', u));
  });

  it('ignoriert die Reihenfolge', async () => {
    const a = [{ art: 'feld.neu', pfad: 'A.b' }, { art: 'feld.neu', pfad: 'A.c' }];
    const b = [{ art: 'feld.neu', pfad: 'A.c' }, { art: 'feld.neu', pfad: 'A.b' }];
    expect(await signatur('q', a)).toBe(await signatur('q', b));
  });

  it('unterscheidet verschiedene Unterschiede', async () => {
    expect(await signatur('q', [{ art: 'feld.neu', pfad: 'A.b' }]))
      .not.toBe(await signatur('q', [{ art: 'feld.entfernt', pfad: 'A.b' }]));
  });

  it('unterscheidet verschiedene Quellen', async () => {
    const u = [{ art: 'feld.neu', pfad: 'A.b' }];
    expect(await signatur('q1', u)).not.toBe(await signatur('q2', u));
  });

  it('ändert sich nicht durch abweichende Werte bei gleichem Pfad', async () => {
    /* Absicht: Ein Wert, der sich bei jedem Lauf minimal unterscheidet,
       soll nicht dieselbe Änderung erneut melden. */
    expect(await signatur('q', [{ art: 'feld.typ_geaendert', pfad: 'A.b', alt: 'x', neu: 'y' }]))
      .toBe(await signatur('q', [{ art: 'feld.typ_geaendert', pfad: 'A.b', alt: 'p', neu: 'q' }]));
  });
});
