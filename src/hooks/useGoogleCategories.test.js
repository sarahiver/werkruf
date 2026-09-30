/**
 * Kategoriesuche, Metadaten und Vergleich.
 *
 * Die reinen Funktionen werden direkt ausgeführt, die Hooks gegen eine
 * nachgebildete Antwort der Edge Function.
 */
import { renderHook, act, waitFor } from '@testing-library/react';

const antworten = { search: null, metadata: null, fehler: null };

jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) } },
}));

const {
  useKategorieSuche, useKategorieMetadaten,
  kategorienGeaendert, baueKategorien,
} = require('./useGoogleCategories');

const aufrufe = [];

beforeEach(() => {
  aufrufe.length = 0;
  antworten.search = { categories: [] };
  antworten.metadata = null;
  antworten.fehler = null;

  global.fetch = jest.fn((url) => {
    aufrufe.push(String(url));
    if (antworten.fehler) {
      return Promise.resolve({
        ok: false, json: () => Promise.resolve({ error: { message: antworten.fehler } }),
      });
    }
    const nutzlast = String(url).includes('/categories/metadata')
      ? antworten.metadata : antworten.search;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(nutzlast) });
  });
  jest.useFakeTimers();
});

afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

const tippen = (ergebnis, text) => act(() => { ergebnis.current.setBegriff(text); });
const vorspulen = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

describe('Kategoriesuche', () => {
  it('sucht nicht ohne Eingabe', async () => {
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    await vorspulen(1000);

    /* Google hat mehrere tausend Kategorien — eine Auswahlliste beim
       Seitenaufbau wäre unbrauchbar. */
    expect(aufrufe).toHaveLength(0);
    expect(result.current.treffer).toEqual([]);
  });

  it('sucht nicht bei einem einzigen Zeichen', async () => {
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    tippen(result, 'k');
    await vorspulen(1000);

    expect(aufrufe).toHaveLength(0);
    expect(result.current.zuKurz).toBe(true);
  });

  it('wartet die Entprellung ab', async () => {
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    tippen(result, 'klemp');

    await vorspulen(200);
    expect(aufrufe).toHaveLength(0);

    await vorspulen(200);
    expect(aufrufe).toHaveLength(1);
  });

  it('sucht bei schneller Eingabe nur einmal', async () => {
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    tippen(result, 'k');
    await vorspulen(100);
    tippen(result, 'kl');
    await vorspulen(100);
    tippen(result, 'klempner');
    await vorspulen(400);

    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]).toMatch(/q=klempner/);
  });

  it('liefert die lokalisierten Anzeigenamen', async () => {
    antworten.search = {
      categories: [
        { name: 'gcid:plumber', displayName: 'Klempner' },
        { name: 'gcid:heating_contractor', displayName: 'Heizungsbauer' },
      ],
    };
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    tippen(result, 'klemp');
    await vorspulen(400);

    await waitFor(() => expect(result.current.treffer).toHaveLength(2));
    expect(result.current.treffer[0].displayName).toBe('Klempner');
    /* Gespeichert wird die stabile ID, nicht der Anzeigename. */
    expect(result.current.treffer[0].name).toBe('gcid:plumber');
  });

  it('gibt den Standort mit, damit Google Sprache und Region kennt', async () => {
    const { result } = renderHook(() => useKategorieSuche('loc-abc'));
    tippen(result, 'klemp');
    await vorspulen(400);

    expect(aufrufe[0]).toMatch(/locationId=loc-abc/);
  });

  it('meldet einen Fehler, statt eine leere Liste zu zeigen', async () => {
    antworten.fehler = 'Google nicht erreichbar';
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    tippen(result, 'klemp');
    await vorspulen(400);

    await waitFor(() => expect(result.current.fehler).toBe('Google nicht erreichbar'));
  });

  it('lädt die nächste Seite nach', async () => {
    antworten.search = {
      categories: [{ name: 'gcid:a', displayName: 'A' }],
      nextPageToken: 'seite2',
    };
    const { result } = renderHook(() => useKategorieSuche('loc-1'));
    tippen(result, 'klemp');
    await vorspulen(400);

    await waitFor(() => expect(result.current.hatWeitere).toBe(true));

    antworten.search = { categories: [{ name: 'gcid:b', displayName: 'B' }] };
    await act(async () => { await result.current.mehrLaden(); });

    expect(result.current.treffer).toHaveLength(2);
    expect(aufrufe[1]).toMatch(/pageToken=seite2/);
  });
});

describe('Kategorie-Metadaten', () => {
  it('unterscheidet „keine Typen" von „Abruf gescheitert"', async () => {
    /* Der Kern: Beides sähe sonst gleich aus, meint aber
       Verschiedenes. */
    antworten.metadata = { abrufErfolgreich: true, moreHoursTypes: [], serviceTypes: [] };
    const leer = renderHook(() => useKategorieMetadaten('gcid:plumber', 'loc-1'));
    await waitFor(() => expect(leer.result.current.laeuft).toBe(false));

    expect(leer.result.current.moreHoursTypes).toEqual([]);
    expect(leer.result.current.abrufGescheitert).toBe(false);

    antworten.metadata = { abrufErfolgreich: false, fehler: 'HTTP 503' };
    const kaputt = renderHook(() => useKategorieMetadaten('gcid:roofer', 'loc-1'));
    await waitFor(() => expect(kaputt.result.current.laeuft).toBe(false));

    /* null, nicht [] — die Oberfläche darf nicht „keine Optionen"
       behaupten. */
    expect(kaputt.result.current.moreHoursTypes).toBeNull();
    expect(kaputt.result.current.abrufGescheitert).toBe(true);
  });

  it('lädt nichts ohne Kategorie', async () => {
    renderHook(() => useKategorieMetadaten(null, 'loc-1'));
    await vorspulen(500);
    expect(aufrufe).toHaveLength(0);
  });

  it('lädt bei einem Kategoriewechsel neu', async () => {
    antworten.metadata = { abrufErfolgreich: true, moreHoursTypes: [] };
    const { rerender } = renderHook(
      ({ kat }) => useKategorieMetadaten(kat, 'loc-1'),
      { initialProps: { kat: 'gcid:plumber' } });

    await waitFor(() => expect(aufrufe).toHaveLength(1));

    rerender({ kat: 'gcid:electrician' });
    await waitFor(() => expect(aufrufe).toHaveLength(2));
    expect(aufrufe[1]).toMatch(/gcid%3Aelectrician/);
  });

  it('trennt Standorte — kein Vermischen zwischen Betrieben', async () => {
    antworten.metadata = { abrufErfolgreich: true, moreHoursTypes: [{ hoursTypeId: 'PICKUP' }] };
    const { rerender } = renderHook(
      ({ loc }) => useKategorieMetadaten('gcid:plumber', loc),
      { initialProps: { loc: 'loc-werkruf' } });

    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0]).toMatch(/locationId=loc-werkruf/);

    rerender({ loc: 'loc-si' });
    await waitFor(() => expect(aufrufe).toHaveLength(2));
    expect(aufrufe[1]).toMatch(/locationId=loc-si/);
  });
});

describe('Vergleich und Aufbereitung', () => {
  const K = (name, anzeige) => ({ name, displayName: anzeige });

  it('erkennt keine Änderung bei gleichem Stand', () => {
    const a = { primaryCategory: K('gcid:plumber'), additionalCategories: [K('gcid:heating')] };
    expect(kategorienGeaendert(a, {
      primaryCategory: K('gcid:plumber'), additionalCategories: [K('gcid:heating')],
    })).toBe(false);
  });

  it('ignoriert die Reihenfolge der Zusatzkategorien', () => {
    /* Sie trägt keine Bedeutung — sonst meldete jedes Laden eine
       Änderung. */
    const a = { primaryCategory: K('gcid:p'), additionalCategories: [K('gcid:a'), K('gcid:b')] };
    const b = { primaryCategory: K('gcid:p'), additionalCategories: [K('gcid:b'), K('gcid:a')] };
    expect(kategorienGeaendert(a, b)).toBe(false);
  });

  it('erkennt einen Wechsel der Hauptkategorie', () => {
    expect(kategorienGeaendert(
      { primaryCategory: K('gcid:plumber') },
      { primaryCategory: K('gcid:electrician') },
    )).toBe(true);
  });

  it('erkennt eine hinzugefügte Zusatzkategorie', () => {
    expect(kategorienGeaendert(
      { primaryCategory: K('gcid:p'), additionalCategories: [] },
      { primaryCategory: K('gcid:p'), additionalCategories: [K('gcid:a')] },
    )).toBe(true);
  });

  it('erkennt eine entfernte Zusatzkategorie', () => {
    expect(kategorienGeaendert(
      { primaryCategory: K('gcid:p'), additionalCategories: [K('gcid:a')] },
      { primaryCategory: K('gcid:p'), additionalCategories: [] },
    )).toBe(true);
  });

  it('baut immer das VOLLSTÄNDIGE Objekt', () => {
    /* Google verbietet die getrennte Änderung: „Clients are prohibited
       from individually updating the primary or additional categories
       using the update mask." */
    const objekt = baueKategorien({
      hauptkategorie: K('gcid:electrician', 'Elektriker'),
      zusatzkategorien: [K('gcid:a'), K('gcid:b')],
    });
    expect(objekt).toHaveProperty('primaryCategory');
    expect(objekt).toHaveProperty('additionalCategories');
    expect(objekt.additionalCategories).toHaveLength(2);
  });

  it('nimmt bei einem Hauptkategoriewechsel die Zusatzkategorien mit', () => {
    /* Der wichtigste Fall: Ein Wechsel der Hauptkategorie darf die
       Zusatzkategorien nicht löschen. */
    const objekt = baueKategorien({
      hauptkategorie: K('gcid:neu'),
      zusatzkategorien: [K('gcid:bestand1'), K('gcid:bestand2')],
    });
    expect(objekt.primaryCategory.name).toBe('gcid:neu');
    expect(objekt.additionalCategories.map((k) => k.name))
      .toEqual(['gcid:bestand1', 'gcid:bestand2']);
  });

  it('sendet eine leere Liste, wenn alle Zusatzkategorien entfernt wurden', () => {
    /* Bewusstes Entfernen muss möglich sein — sonst liessen sie sich
       nie loswerden. */
    expect(baueKategorien({ hauptkategorie: K('gcid:p'), zusatzkategorien: [] }))
      .toEqual({ primaryCategory: K('gcid:p'), additionalCategories: [] });
  });
});
