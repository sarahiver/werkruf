/**
 * Welcher Firmenname im Dashboard steht.
 *
 * Anlass: Am 29.09.2026 zeigte die Übersichtsseite
 * „Firma Rolf Müller Sanitär und Heizungstechnik" aus dem
 * Registrierungsprofil, während in der Profilverwaltung „S&I." aus dem
 * Google-Profil stand. Das sah nach vermischten Betrieben aus — die
 * Daten waren sauber, die Anzeige nicht.
 */
import { renderHook, waitFor } from '@testing-library/react';

const mockAuth = { user: { id: 'u1' }, profile: { company_name: 'Firma Rolf Müller Sanitär und Heizungstechnik' } };
jest.mock('../context/AuthContext', () => ({ useAuthContext: () => mockAuth }));

const kette = { title: null, error: null };
jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            not: () => ({
              maybeSingle: () => Promise.resolve(
                kette.error
                  ? { data: null, error: kette.error }
                  : { data: kette.title === null ? null : { title: kette.title }, error: null },
              ),
            }),
          }),
        }),
      }),
    }),
  },
}));

const { useBetriebsname } = require('./useBetriebsname');

beforeEach(() => {
  kette.title = null;
  kette.error = null;
  mockAuth.user = { id: 'u1' };
  mockAuth.profile = { company_name: 'Firma Rolf Müller Sanitär und Heizungstechnik' };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('Betriebsname', () => {
  it('nimmt den Google-Namen, sobald ein Betrieb ausgewählt ist', async () => {
    kette.title = 'S&I.';
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBe('S&I.');
    expect(result.current.herkunft).toBe('google');
  });

  it('behält den Registrierungsnamen als Rechnungsnamen', async () => {
    kette.title = 'S&I.';
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    /* Er verschwindet nicht — er ist nur nicht mehr der Anzeigename.
       Für Rechnungen und Anrede bleibt er zuständig. */
    expect(result.current.rechnungsname)
      .toBe('Firma Rolf Müller Sanitär und Heizungstechnik');
  });

  it('greift ohne ausgewählten Betrieb auf den Registrierungsnamen zurück', async () => {
    kette.title = null;
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBe('Firma Rolf Müller Sanitär und Heizungstechnik');
    expect(result.current.herkunft).toBe('registrierung');
    expect(result.current.googleName).toBeNull();
  });

  it('behandelt einen leeren Google-Namen wie keinen', async () => {
    kette.title = '   ';
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.herkunft).toBe('registrierung');
  });

  it('hält die Seite bei einem Abfragefehler nicht auf', async () => {
    kette.error = { code: 'PGRST301', message: 'kaputt' };
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    /* Schlechter als der Google-Name, aber nicht falsch. */
    expect(result.current.name).toBe('Firma Rolf Müller Sanitär und Heizungstechnik');
  });

  it('kommt ohne angemeldeten Nutzer zurecht', async () => {
    mockAuth.user = null;
    mockAuth.profile = null;
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBeNull();
    expect(result.current.herkunft).toBeNull();
  });

  it('kommt ohne Registrierungsnamen zurecht', async () => {
    mockAuth.profile = {};
    kette.title = 'S&I.';
    const { result } = renderHook(() => useBetriebsname());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBe('S&I.');
    expect(result.current.rechnungsname).toBeNull();
  });
});

describe('Abfrage', () => {
  const quelle = require('fs').readFileSync('src/hooks/useBetriebsname.js', 'utf8');

  it('holt nur den AUSGEWÄHLTEN Betrieb', () => {
    /* Ohne diesen Filter stünde bei mehreren verwalteten Profilen ein
       beliebiger Name da — genau die Verwechslung, die der Hook
       beheben soll. */
    expect(quelle).toMatch(/\.not\('selected_at', 'is', null\)/);
  });

  it('begrenzt auf den angemeldeten Nutzer', () => {
    expect(quelle).toMatch(/\.eq\('user_id', user\.id\)/);
  });

  it('lässt gelöschte Standorte aus', () => {
    expect(quelle).toMatch(/\.is\('deleted_at', null\)/);
  });

  it('lädt nur den Titel, nicht den ganzen Datensatz', () => {
    /* Der Name wird auf Seiten gebraucht, die mit Google-Daten sonst
       nichts zu tun haben. */
    expect(quelle).toMatch(/\.select\('title'\)/);
  });
});
