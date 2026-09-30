/**
 * Foto-Upload: zu welchem Betrieb?
 *
 * Anlass: Die Abfrage lautete order('is_primary').limit(1) — ohne
 * Filter auf den Nutzer und ohne Berücksichtigung der Auswahl. Wer
 * WERKRUF ausgewählt hatte, lud damit Fotos zu S&I hoch. Ein Foto beim
 * falschen Betrieb ist öffentlich sichtbar und muss von Hand wieder
 * entfernt werden.
 */
const zustand = { user: { id: 'u1' }, standorte: [], fehler: null };

jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: zustand.user } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => Promise.resolve(
            zustand.fehler
              ? { data: null, error: { message: zustand.fehler } }
              : { data: zustand.standorte, error: null },
          ),
        }),
      }),
    }),
  },
}));

const { bestimmeZielstandort } = require('./DashboardFotos');

const standort = (id, titel, gewaehlt) => ({
  id, title: titel, selected_at: gewaehlt ? '2026-09-30T08:00:00Z' : null,
});

beforeEach(() => {
  zustand.user = { id: 'u1' };
  zustand.standorte = [];
  zustand.fehler = null;
});

describe('Zielstandort für Foto-Uploads', () => {
  it('nimmt bei genau einem Standort diesen — ohne Auswahl', () => {
    zustand.standorte = [standort('a', 'S&I.', false)];
    return expect(bestimmeZielstandort()).resolves.toMatchObject({ id: 'a' });
  });

  it('nimmt bei mehreren den AUSGEWÄHLTEN', async () => {
    zustand.standorte = [standort('si', 'S&I.', false), standort('wr', 'WERKRUF', true)];
    await expect(bestimmeZielstandort()).resolves.toMatchObject({ id: 'wr', title: 'WERKRUF' });
  });

  it('folgt einem Wechsel der Auswahl', async () => {
    zustand.standorte = [standort('si', 'S&I.', true), standort('wr', 'WERKRUF', false)];
    await expect(bestimmeZielstandort()).resolves.toMatchObject({ id: 'si' });

    zustand.standorte = [standort('si', 'S&I.', false), standort('wr', 'WERKRUF', true)];
    await expect(bestimmeZielstandort()).resolves.toMatchObject({ id: 'wr' });
  });

  it('liefert bei mehreren ohne Auswahl NICHTS', async () => {
    /* Kein stiller Rückfall auf is_primary oder den ersten der Liste. */
    zustand.standorte = [standort('si', 'S&I.', false), standort('wr', 'WERKRUF', false)];
    await expect(bestimmeZielstandort()).resolves.toBeNull();
  });

  it('liefert ohne Standorte nichts', async () => {
    await expect(bestimmeZielstandort()).resolves.toBeNull();
  });

  it('liefert ohne angemeldeten Nutzer nichts', async () => {
    zustand.user = null;
    zustand.standorte = [standort('a', 'S&I.', false)];
    await expect(bestimmeZielstandort()).resolves.toBeNull();
  });

  it('liefert bei einem Abfragefehler nichts, statt zu raten', async () => {
    zustand.fehler = 'kaputt';
    await expect(bestimmeZielstandort()).resolves.toBeNull();
  });
});

describe('Quelltext des Uploads', () => {
  const quelle = require('fs').readFileSync('src/pages/dashboard/DashboardFotos.js', 'utf8');

  it('wählt den Standort nicht mehr über is_primary', () => {
    /* Geprüft wird die VERWENDUNG, nicht das Wort — in der Erläuterung
       kommt es vor, im Code nicht. */
    const ohneKommentare = quelle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(ohneKommentare).not.toMatch(/order\('is_primary'/);
  });

  it('filtert die Abfrage auf den angemeldeten Nutzer', () => {
    /* Vorher verliess sich die Abfrage allein auf RLS. */
    expect(quelle).toMatch(/\.eq\('user_id', user\.id\)/);
  });

  it('bricht ohne Zielstandort ab, statt zu veröffentlichen', () => {
    expect(quelle).toMatch(/if \(!location\) \{/);
    expect(quelle).toMatch(/Es ist kein Betrieb ausgewählt/);
  });

  it('sendet die konkrete locationId an Google', () => {
    expect(quelle).toMatch(/locationId: location\.id/);
  });
});
