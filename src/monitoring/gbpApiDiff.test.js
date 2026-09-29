/**
 * Tests für die Vergleichs- und Einstufungslogik des API-Monitorings.
 *
 * Führt die echten Funktionen aus scripts/gbp-api-diff.mjs aus —
 * dieselben, die die Edge Function verwendet.
 */
import {
  STUFEN, vergleicheSchema, stufeEin, hoechsteStufe,
  zerlegeChangeLog, vergleicheChangeLog, stufeChangeLogEin, signatur,
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
  /* Aufbau der echten Seite: Gliederung nach VERSIONEN, darin
     Unterabschnitte, und nur bei den neuesten einzelne Datumsangaben.
     Ein erster Entwurf suchte nur nach Datumszeilen und fand deshalb
     sechs von über zwanzig Abschnitten — alles Ältere, samt der
     Abkündigungen unter "Behavioral Changes", blieb unsichtbar. */
  const seite = `
Change Log
Stay organized with collections Save and categorize content based on your preferences.

## v4.9

### New Features

2026-07-24

review_reply_url: The reviewReplyUrl can now be retrieved.

2026-04-01

Review Reply State: ReviewReplyState can now be retrieved.

### Behavioral Changes

v4.x Accounts Deprecation
accounts and accounts.admins are now deprecated in the Google My Business API.

## v4.8

### New Features

Lodging Amenities
Retrieval and update of Lodging Amenities.

## v3.3

### New features

Structured Menus
You can now add, update, or delete multiple menus.

Except as otherwise noted, the content of this page is licensed under CC BY 4.0.
Last updated 2026-08-28 UTC.
`;

  it('erfasst Versionen, Unterabschnitte und Datumsangaben', () => {
    const e = zerlegeChangeLog(seite);
    const schluessel = e.map((x) => x.datum);

    expect(schluessel).toEqual(expect.arrayContaining([
      'v4.9', 'v4.8', 'v3.3', '2026-07-24', '2026-04-01', 'Behavioral Changes',
    ]));
    expect(e.length).toBeGreaterThanOrEqual(8);
  });

  it('erfasst den Abschnitt mit den Abkündigungen', () => {
    const e = zerlegeChangeLog(seite);
    const abk = e.find((x) => x.datum === 'Behavioral Changes');
    expect(abk).toBeDefined();
    expect(abk.inhalt).toMatch(/deprecated/i);
  });

  it('schneidet Fußzeile und Navigation ab', () => {
    const alles = zerlegeChangeLog(seite).map((x) => x.inhalt).join('\n');
    expect(alles).not.toMatch(/Last updated/);
    expect(alles).not.toMatch(/Stay organized/);
    expect(alles).not.toMatch(/licensed under/);
  });

  it('verlangt das Datum NICHT allein auf einer Zeile', () => {
    /* Genau daran scheiterte der erste Entwurf im Abnahmelauf. */
    const e = zerlegeChangeLog('## v9.0\n\n### New Features\n\n**2026-09-25** Etwas ist neu.\n');
    expect(e.map((x) => x.datum)).toContain('2026-09-25');
  });

  it('erkennt einen neuen Eintrag', () => {
    const alt = zerlegeChangeLog(seite);
    const neu = zerlegeChangeLog(seite.replace('## v4.9', '## v5.0\n\n### New Features\n\nGanz neu.\n\n## v4.9'));
    expect(vergleicheChangeLog(alt, neu)).toContainEqual(
      expect.objectContaining({ art: 'changelog.neuer_eintrag', pfad: 'v5.0' }));
  });

  it('erkennt einen nachträglich geänderten Eintrag', () => {
    const alt = zerlegeChangeLog(seite);
    const neu = zerlegeChangeLog(seite.replace('Lodging Amenities', 'Lodging Amenities erweitert'));
    expect(vergleicheChangeLog(alt, neu)).toContainEqual(
      expect.objectContaining({ art: 'changelog.eintrag_geaendert' }));
  });

  it('meldet bei unveränderter Seite nichts', () => {
    const e = zerlegeChangeLog(seite);
    expect(vergleicheChangeLog(e, e)).toEqual([]);
  });

  it('meldet eine reine Layoutänderung nicht', () => {
    const alt = zerlegeChangeLog(seite);
    const neu = zerlegeChangeLog(seite
      .replace('Last updated 2026-08-28 UTC.', 'Last updated 2026-10-15 UTC.')
      .replace('Stay organized with collections Save and categorize content based on your preferences.', 'Andere Navigation'));
    expect(vergleicheChangeLog(alt, neu)).toEqual([]);
  });

  it('liefert bei unlesbarer Seite keine erfundenen Einträge', () => {
    expect(zerlegeChangeLog('<html>nichts Gegliedertes</html>')).toEqual([]);
    expect(zerlegeChangeLog('')).toEqual([]);
    expect(zerlegeChangeLog(null)).toEqual([]);
  });

  it('macht aus wiederkehrenden Überschriften eindeutige Schlüssel', () => {
    /* "New Features" steht unter jeder Version. Ohne Nummerierung
       überschrieben sich die Abschnitte gegenseitig. */
    const e = zerlegeChangeLog(seite);
    expect(new Set(e.map((x) => x.datum)).size).toBe(e.length);
  });

  it('stuft einen Eintrag mit Abschaltungswort als kritisch ein', () => {
    const e = stufeChangeLogEin({
      art: 'changelog.neuer_eintrag', pfad: 'X',
      neu: 'The questions and answers endpoints will be removed on November 3.',
    });
    expect(e.stufe).toBe(STUFEN.KRITISCH);
  });

  it('stuft einen gewöhnlichen Eintrag zurückhaltend ein', () => {
    const e = stufeChangeLogEin({
      art: 'changelog.neuer_eintrag', pfad: 'X', neu: 'Added a new optional field.',
    });
    expect(e.stufe).toBe(STUFEN.HANDLUNGSBEDARF);
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
