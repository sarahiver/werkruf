import supabase from '../supabaseClient';
import { getPostAuthDestination } from './postAuthDestination';

jest.mock('../supabaseClient', () => ({
  auth: { getSession: jest.fn() },
  from: jest.fn(),
}));

const SITZUNG = { access_token: 'session-token', user: { id: 'u1' } };

/* Die Profilabfrage. `profil` ist die Zeile, die maybeSingle liefert —
   null heisst: keine Zeile. */
function profilAbfrage(profil, fehler = null) {
  const kette = {
    select: jest.fn(() => kette),
    eq: jest.fn(() => kette),
    maybeSingle: jest.fn(() => Promise.resolve({ data: profil, error: fehler })),
  };
  supabase.from.mockReturnValue(kette);
  return kette;
}

const ZUGESTIMMT = { accepted_terms_at: '2026-10-13T10:00:00Z' };

describe('post-auth routing', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    /* Vorgabe: Zustimmung liegt vor. Die Faelle ohne Zustimmung
       setzen es selbst — so steht in jedem Test, woran er haengt. */
    profilAbfrage(ZUGESTIMMT);
  });
  afterEach(() => jest.resetAllMocks());

  it('keeps an active connection in the dashboard', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: SITZUNG } });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });
    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer session-token');
  });

  it('sends a user without a connection to the connection step', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: SITZUNG } });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: false }) });
    await expect(getPostAuthDestination()).resolves.toBe('/dashboard/google');
  });

  it('waits for a session and never falls through to the landing page', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(getPostAuthDestination()).resolves.toBe('/login');
    expect(fetch).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════
   DIE ZUSTIMMUNGSWEICHE (H1, Consent)
   ═══════════════════════════════════════════════════════

   Der Haken steht in /onboarding. Wer dort abbrach und sich spaeter
   neu anmeldete, kam ohne Eintrag ins Produkt — diese Weiche schliesst
   das. Einmalig gilt sie auch fuer bestehende Konten, denn keines hat
   heute einen Eintrag.

   Die drei Faelle, auf die es ankommt, stehen hier nebeneinander:
   ohne Zustimmung, mit Zustimmung, mit ALTER Zustimmung. */

describe('Zustimmung entscheidet, bevor die Verbindung zaehlt', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    supabase.auth.getSession.mockResolvedValue({ data: { session: SITZUNG } });
  });
  afterEach(() => jest.resetAllMocks());

  it('schickt einen Nutzer ohne Zustimmung ins Onboarding', async () => {
    profilAbfrage({ accepted_terms_at: null });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });

    await expect(getPostAuthDestination()).resolves.toBe('/onboarding');

    /* Und fragt den Verbindungsstatus gar nicht erst ab: Die
       Zustimmung kommt vor der Benutzung. */
    expect(fetch).not.toHaveBeenCalled();
  });

  it('schickt ein bestehendes Konto ohne Zustimmung einmalig ins Onboarding', async () => {
    /* Genau der Altbestand: verbunden, benutzt das Produkt, hat aber
       nie zugestimmt, weil es den Haken damals nicht gab. */
    profilAbfrage({ accepted_terms_at: null });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });

    await expect(getPostAuthDestination()).resolves.toBe('/onboarding');
  });

  it('laesst einen Nutzer MIT Zustimmung zum bisherigen Ziel', async () => {
    profilAbfrage(ZUGESTIMMT);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });

    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
  });

  it('laesst eine ALTE Zustimmung ebenfalls zum bisherigen Ziel', async () => {
    /* Der wichtigste Fall dieser Datei. Eine abweichende Fassung
       fuehrt NICHT ins Onboarding — sonst waere aus der Weiche eine
       Re-Consent-Architektur geworden, und jede Textaenderung wuerde
       alle Nutzer erneut durchschleusen. */
    profilAbfrage({
      accepted_terms_at: '2024-01-01T00:00:00Z',
      accepted_terms_version: 'eine-sehr-alte-fassung',
    });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });

    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
  });

  it('liest die Fassung nicht einmal', async () => {
    /* Die Zusage, nicht nur das Verhalten: Was nicht abgefragt wird,
       kann auch nicht versehentlich verglichen werden. */
    const kette = profilAbfrage(ZUGESTIMMT);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });

    await getPostAuthDestination();

    expect(kette.select).toHaveBeenCalledWith('accepted_terms_at');
    expect(kette.select).not.toHaveBeenCalledWith(
      expect.stringContaining('accepted_terms_version'));
  });

  it('fragt nur das eigene Profil', async () => {
    const kette = profilAbfrage(ZUGESTIMMT);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });

    await getPostAuthDestination();

    expect(supabase.from).toHaveBeenCalledWith('user_profiles');
    expect(kette.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('behandelt ein noch fehlendes Profil wie fehlende Zustimmung', async () => {
    /* Direkt nach der Registrierung ist die Zeile womoeglich noch
       nicht da. Dann gibt es auch keine Zustimmung. */
    profilAbfrage(null);

    await expect(getPostAuthDestination()).resolves.toBe('/onboarding');
  });
});

describe('Ein Ausfall sperrt niemanden aus', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    supabase.auth.getSession.mockResolvedValue({ data: { session: SITZUNG } });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });
  });
  afterEach(() => jest.resetAllMocks());

  it('leitet bei einem Lesefehler nicht ins Onboarding', async () => {
    /* Wer wegen eines Datenbankfehlers im Onboarding landet, kann dort
       auch nicht zustimmen — dieselbe Datenbank — und steckt fest. */
    profilAbfrage(null, { code: '42501', message: 'permission denied' });

    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
  });

  it('vertraegt eine werfende Abfrage', async () => {
    supabase.from.mockImplementation(() => { throw new Error('Netzwerk weg'); });

    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
  });

  it('entscheidet ohne Nutzerkennung nicht', async () => {
    /* Keine Entscheidung ist besser als eine geratene. */
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 't' } },
    });

    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
