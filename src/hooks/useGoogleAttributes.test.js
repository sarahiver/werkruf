/**
 * Attribute: Datentypen, Wertvergleich und Aufbereitung.
 *
 * Die reinen Funktionen werden direkt ausgeführt.
 */
import {
  WERTTYP, istBekannterTyp, wertVon, baueAttribut, wertGleich, nachGruppen,
} from './useGoogleAttributes';

jest.mock('../supabaseClient', () => ({ __esModule: true, default: {} }));

describe('Datentypen', () => {
  it('kennt die dokumentierten Typen', () => {
    ['BOOL', 'ENUM', 'URL', 'REPEATED_ENUM']
      .forEach((t) => expect(istBekannterTyp(t)).toBe(true));
  });

  it('erkennt einen unbekannten Typ als solchen', () => {
    /* Google kann jederzeit neue einführen. Raten wäre falsch. */
    expect(istBekannterTyp('GANZ_NEUER_TYP')).toBe(false);
    expect(istBekannterTyp(undefined)).toBe(false);
    expect(istBekannterTyp(null)).toBe(false);
  });

  it('leitet den Typ NICHT aus dem Namen ab', () => {
    /* Ein Attribut namens „has_wifi" ist nicht zwingend BOOL — das
       sagt allein valueType. */
    expect(istBekannterTyp('has_wifi')).toBe(false);
  });
});

describe('Werte lesen', () => {
  it('liest einen Ja/Nein-Wert', () => {
    expect(wertVon({ name: 'a', values: [true] })).toBe(true);
    expect(wertVon({ name: 'a', values: [false] })).toBe(false);
  });

  it('liest einen Auswahlwert', () => {
    expect(wertVon({ name: 'a', values: ['WHEELCHAIR'] })).toBe('WHEELCHAIR');
  });

  it('liest eine Mehrfachauswahl', () => {
    expect(wertVon({ name: 'a', repeatedEnumValue: { setValues: ['X', 'Y'] } }))
      .toEqual(['X', 'Y']);
  });

  it('liest eine URL', () => {
    expect(wertVon({ name: 'a', uriValues: [{ uri: 'https://x.example' }] }))
      .toBe('https://x.example');
  });

  it('kommt mit leeren Attributen zurecht', () => {
    expect(wertVon({ name: 'a' })).toBeNull();
    expect(wertVon(null)).toBeNull();
  });
});

describe('Werte schreiben', () => {
  const meta = (valueType) => ({ parent: 'attributes/has_wifi', valueType });

  it('schreibt Ja/Nein in values', () => {
    expect(baueAttribut(meta(WERTTYP.BOOL), true))
      .toEqual({ name: 'attributes/has_wifi', values: [true] });
    expect(baueAttribut(meta(WERTTYP.BOOL), false))
      .toEqual({ name: 'attributes/has_wifi', values: [false] });
  });

  it('schreibt eine Auswahl in values', () => {
    expect(baueAttribut(meta(WERTTYP.ENUM), 'WHEELCHAIR').values).toEqual(['WHEELCHAIR']);
  });

  it('schreibt eine geleerte Auswahl als leere Liste', () => {
    /* Entfernen muss möglich sein. */
    expect(baueAttribut(meta(WERTTYP.ENUM), null).values).toEqual([]);
  });

  it('schreibt eine URL in uriValues', () => {
    expect(baueAttribut(meta(WERTTYP.URL), 'https://x.example').uriValues)
      .toEqual([{ uri: 'https://x.example' }]);
    expect(baueAttribut(meta(WERTTYP.URL), '').uriValues).toEqual([]);
  });

  it('schreibt eine Mehrfachauswahl in repeatedEnumValue', () => {
    /* Je Typ ein anderes Feld — das ist keine Kür: values und
       repeatedEnumValue sind nicht austauschbar. */
    expect(baueAttribut(meta(WERTTYP.REPEATED_ENUM), ['A', 'B']).repeatedEnumValue)
      .toEqual({ setValues: ['A', 'B'] });
  });

  it('schreibt einen unbekannten Typ gar nicht', () => {
    expect(baueAttribut(meta('GANZ_NEU'), 'irgendwas')).toBeNull();
  });
});

describe('Wertvergleich', () => {
  it('erkennt Gleichheit bei einfachen Werten', () => {
    expect(wertGleich(true, true)).toBe(true);
    expect(wertGleich('A', 'A')).toBe(true);
    expect(wertGleich(true, false)).toBe(false);
  });

  it('behandelt null, undefined und leer als dasselbe', () => {
    /* Sonst meldete jedes Laden eine Änderung an nicht gesetzten
       Attributen. */
    expect(wertGleich(null, undefined)).toBe(true);
    expect(wertGleich('', null)).toBe(true);
    expect(wertGleich(null, 'A')).toBe(false);
  });

  it('ignoriert die Reihenfolge bei Mehrfachauswahl', () => {
    expect(wertGleich(['A', 'B'], ['B', 'A'])).toBe(true);
    expect(wertGleich(['A'], ['A', 'B'])).toBe(false);
  });

  it('unterscheidet false von nicht gesetzt', () => {
    /* „Nein" ist eine Aussage, „keine Angabe" nicht. */
    expect(wertGleich(false, null)).toBe(false);
  });
});

describe('Gruppierung', () => {
  it('nutzt Googles Gruppennamen', () => {
    const gruppen = nachGruppen([
      { name: 'a', groupDisplayName: 'Barrierefreiheit' },
      { name: 'b', groupDisplayName: 'Barrierefreiheit' },
      { name: 'c', groupDisplayName: 'Angebote' },
    ]);
    expect(gruppen.map((g) => g.name)).toEqual(['Barrierefreiheit', 'Angebote']);
    expect(gruppen[0].eintraege).toHaveLength(2);
  });

  it('erfindet keine Gruppe, sondern sammelt ohne Namen zusammen', () => {
    const gruppen = nachGruppen([{ name: 'a' }, { name: 'b' }]);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0].name).toBe('Weitere Eigenschaften');
  });

  it('kommt mit leerer Eingabe zurecht', () => {
    expect(nachGruppen([])).toEqual([]);
    expect(nachGruppen(null)).toEqual([]);
  });
});
