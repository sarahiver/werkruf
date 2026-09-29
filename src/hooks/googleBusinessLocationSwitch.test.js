/**
 * Regressionstests zu den vier Ursachen vom 29.09.2026.
 *
 * Geprueft wird das Verhalten des Hooks useGoogleBusinessData gegen
 * eine nachgebildete Datenbank — kein Quelltext-Grep. Der Fall, auf den
 * es ankommt: EIN Google-Konto verwaltet ZWEI Betriebe.
 */
import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('../supabaseClient', () => {
  const state = { rows: {}, session: { access_token: 'token' } };
  const bauer = (tabelle) => {
    const abfrage = {
      _table: tabelle, _filters: {},
      select() { return abfrage; },
      eq(spalte, wert) { abfrage._filters[spalte] = wert; return abfrage; },
      in() { return abfrage; },
      is() { return abfrage; },
      order() { return abfrage; },
      limit() { return abfrage; },
      then(aufloesen) {
        let daten = state.rows[tabelle] ?? [];
        Object.entries(abfrage._filters).forEach(([spalte, wert]) => {
          daten = daten.filter((z) => z[spalte] === wert);
        });
        return Promise.resolve({ data: daten, error: null }).then(aufloesen);
      },
    };
    return abfrage;
  };
  const client = {
    from: (tabelle) => bauer(tabelle),
    auth: { getSession: () => Promise.resolve({ data: { session: state.session } }) },
  };
  return { __esModule: true, default: client, __state: state };
});

const { __state: state } = require('../supabaseClient');
const { useGoogleBusinessData } = require('./useGoogleBusinessData');

const WERKRUF = 'loc-werkruf';
const SI      = 'loc-si';

function standorte({ gewaehlt = null } = {}) {
  return [
    { id: WERKRUF, title: 'WERKRUF', locality: 'Hamburg', is_primary: true,
      selected_at: gewaehlt === WERKRUF ? '2026-09-29T08:00:00Z' : null,
      last_synced_at: '2026-09-29T09:00:00Z', google_media: [], created_at: '2026-09-01' },
    { id: SI, title: 'S&I.', locality: 'Hamburg', is_primary: false,
      selected_at: gewaehlt === SI ? '2026-09-29T08:00:00Z' : null,
      last_synced_at: '2026-08-01T09:00:00Z', google_media: [], created_at: '2026-09-02' },
  ];
}

/** Absteigend nach created_at — so liefert es die Abfrage im Hook. */
const jobs = (liste) => liste.map((j) => ({ job_type: 'sync_reviews', ...j }));

/**
 * Bildet die korrigierte select_google_location nach: erst alle
 * zuruecksetzen, dann genau eine setzen. Damit prueft der Test, ob das
 * Frontend mit dem Ergebnis richtig umgeht — die SQL-Korrektur selbst
 * laesst sich hier nicht pruefen, dafuer braucht es die Datenbank.
 */
function serverWaehltAus(locationId) {
  state.rows.google_locations = state.rows.google_locations.map((l) => ({
    ...l,
    selected_at: l.id === locationId ? '2026-09-29T12:00:00Z' : null,
    is_primary:  l.id === locationId,
  }));
}

const fetchMitAuswahl = () => jest.fn((url, optionen) => {
  if (url.endsWith('/location/select')) {
    serverWaehltAus(JSON.parse(optionen.body).locationId);
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

beforeEach(() => {
  state.rows = {
    google_locations: standorte(),
    sync_jobs: [], google_reviews: [], review_replies: [],
  };
  global.fetch = fetchMitAuswahl();
  process.env.REACT_APP_SUPABASE_URL = 'https://projekt.supabase.co';
});

afterEach(() => jest.clearAllMocks());

const laden = async () => {
  const hook = renderHook(() => useGoogleBusinessData({ enabled: true }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe('Betriebswechsel', () => {
  it('erkennt die serverseitig gespeicherte Auswahl nach einem Reload', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    const { result } = await laden();
    const gewaehlt = result.current.locations.find((l) => l.selected_at);
    expect(gewaehlt.id).toBe(SI);
  });

  it('schickt den Wechsel an location/select', async () => {
    const { result } = await laden();
    await act(async () => { await result.current.selectLocation(SI); });
    const aufrufe = global.fetch.mock.calls.map(([url]) => url);
    expect(aufrufe.some((u) => u.endsWith('/google-business/location/select'))).toBe(true);
  });

  it('speichert die Auswahl nicht zusaetzlich im Browser', async () => {
    const { result } = await laden();
    await act(async () => { await result.current.selectLocation(SI); });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.getItem('werkruf_selected_location')).toBeNull();
  });
});

describe('Betriebsspezifische Synchronisierung', () => {
  it('reiht nach dem Wechsel genau einen Sync fuer diesen Betrieb ein', async () => {
    const { result } = await laden();
    await act(async () => { await result.current.selectLocation(SI); });

    const syncAufrufe = global.fetch.mock.calls
      .filter(([url]) => url.endsWith('/sync/trigger'))
      .map(([, optionen]) => JSON.parse(optionen.body));

    expect(syncAufrufe).toHaveLength(1);
    expect(syncAufrufe[0].locationId).toBe(SI);
  });

  it('startet keinen Standortimport ueber alle Betriebe', async () => {
    const { result } = await laden();
    await act(async () => { await result.current.selectLocation(SI); });

    const syncAufrufe = global.fetch.mock.calls
      .filter(([url]) => url.endsWith('/sync/trigger'))
      .map(([, optionen]) => JSON.parse(optionen.body));

    // Ein Aufruf ohne locationId waere der vollstaendige Standortimport.
    expect(syncAufrufe.every((k) => Boolean(k.locationId))).toBe(true);
  });

  it('verschluckt einen fehlgeschlagenen Sync-Start nicht', async () => {
    const { result } = await laden();
    global.fetch = jest.fn((url) => Promise.resolve(
      url.endsWith('/sync/trigger')
        ? { ok: false, json: () => Promise.resolve({}) }
        : { ok: true, json: () => Promise.resolve({}) },
    ));

    await expect(
      act(async () => { await result.current.selectLocation(SI); }),
    ).rejects.toThrow(/Abgleich konnte aber nicht gestartet werden/i);
  });

  it('haelt die Auswahl fest, wenn nur der Abgleich scheitert', async () => {
    const { result } = await laden();
    global.fetch = jest.fn((url) => Promise.resolve(
      url.endsWith('/sync/trigger')
        ? { ok: false, json: () => Promise.resolve({}) }
        : { ok: true, json: () => Promise.resolve({}) },
    ));

    let fehler = null;
    await act(async () => {
      try { await result.current.selectLocation(SI); } catch (e) { fehler = e; }
    });
    expect(fehler?.selectionPersisted).toBe(true);
  });
});

describe('Sync-Status', () => {
  it('zeigt keinen Fehler, wenn nach dem Fehlschlag ein Erfolg kam', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j2', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
      { id: 'j1', location_id: WERKRUF, status: 'failed',    created_at: '2026-09-01T10:00:00Z' },
    ]);
    const { result } = await laden();

    expect(result.current.lastFailedJob).toBeNull();
    expect(result.current.latestJob.id).toBe('j2');
    // Für die Historie bleibt der alte Fehlschlag abrufbar.
    expect(result.current.failedJobHistory).toHaveLength(1);
  });

  it('meldet einen Fehler, wenn der juengste Job gescheitert ist', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j2', location_id: WERKRUF, status: 'failed',    created_at: '2026-09-29T10:00:00Z' },
      { id: 'j1', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-01T10:00:00Z' },
    ]);
    const { result } = await laden();
    expect(result.current.lastFailedJob?.id).toBe('j2');
  });

  it('erkennt einen laufenden Abgleich', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j3', location_id: WERKRUF, status: 'queued', created_at: '2026-09-29T11:00:00Z' },
      { id: 'j2', location_id: WERKRUF, status: 'failed', created_at: '2026-09-01T10:00:00Z' },
    ]);
    const { result } = await laden();
    expect(result.current.runningJob?.id).toBe('j3');
  });

  it('nimmt den Abgleichzeitpunkt des ausgewaehlten Betriebs, nicht den aeltesten', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    const { result } = await laden();
    // S&I. ist deutlich aelter — das darf den Stand von WERKRUF nicht verfaelschen.
    expect(result.current.lastSyncedAt).toBe('2026-09-29T09:00:00Z');
  });
});

describe('Daten des ausgewaehlten Betriebs', () => {
  it('beruecksichtigt nur Bewertungen des gewaehlten Betriebs', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    state.rows.google_reviews = [
      { id: 'r1', location_id: SI,      star_rating: 5, is_answered: true,  status: 'active' },
      { id: 'r2', location_id: WERKRUF, star_rating: 1, is_answered: false, status: 'active' },
    ];
    const { result } = await laden();
    expect(result.current.stats.totalReviews).toBe(1);
    expect(result.current.stats.averageRating).toBe(5);
  });

  it('kommt mit einem erfolgreichen Sync ohne Bewertungen zurecht', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j1', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
    ]);
    state.rows.google_reviews = [];
    const { result } = await laden();

    expect(result.current.lastFailedJob).toBeNull();
    expect(result.current.stats.totalReviews).toBe(0);
    expect(result.current.stats.averageRating).toBeNull();
  });
});

describe('Wechsel zwischen zwei Betrieben (Regression 29.09.)', () => {
  /* Der Fehler: select_google_location setzte alte und neue Auswahl in
     einer UPDATE-Anweisung. Je nach Zeilenreihenfolge waren kurzzeitig
     beide gesetzt — Unique-Verstoss 23505, und der Wechsel scheiterte
     mit "Der Betrieb konnte nicht ausgewaehlt werden". */

  const gewaehlt = (result) =>
    result.current.locations.filter((l) => l.selected_at).map((l) => l.id);

  it('wechselt S&I. → WERKRUF → S&I. mit jeweils genau einer Auswahl', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    const { result } = await laden();
    expect(gewaehlt(result)).toEqual([SI]);

    await act(async () => { await result.current.selectLocation(WERKRUF); });
    await waitFor(() => expect(gewaehlt(result)).toEqual([WERKRUF]));

    await act(async () => { await result.current.selectLocation(SI); });
    await waitFor(() => expect(gewaehlt(result)).toEqual([SI]));
  });

  it('haelt die Auswahl nach einem Reload', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    const erst = await laden();
    await act(async () => { await erst.result.current.selectLocation(WERKRUF); });
    await waitFor(() => expect(gewaehlt(erst.result)).toEqual([WERKRUF]));

    /* Neuer Hook-Aufbau entspricht einem Seitenneuladen: gelesen wird
       ausschliesslich selected_at aus der Datenbank. */
    const nachReload = await laden();
    expect(gewaehlt(nachReload.result)).toEqual([WERKRUF]);
  });

  it('zeigt die Meldung der Edge Function statt eines pauschalen Textes', async () => {
    const { result } = await laden();
    global.fetch = jest.fn((url) => Promise.resolve(
      url.endsWith('/location/select')
        ? { ok: false, status: 500, json: () => Promise.resolve({
            error: { code: 'internal_error', message: 'Standortauswahl nicht speicherbar', retryable: true },
          }) }
        : { ok: true, json: () => Promise.resolve({}) },
    ));

    let fehler = null;
    await act(async () => {
      try { await result.current.selectLocation(WERKRUF); } catch (e) { fehler = e; }
    });

    expect(fehler.message).toBe('Standortauswahl nicht speicherbar');
    expect(fehler.code).toBe('internal_error');
  });

  it('protokolliert keine Kennungen, nur Code und Status', async () => {
    const { result } = await laden();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn((url) => Promise.resolve(
      url.endsWith('/location/select')
        ? { ok: false, status: 409, json: () => Promise.resolve({ error: { code: 'conflict', message: 'Konflikt' } }) }
        : { ok: true, json: () => Promise.resolve({}) },
    ));

    await act(async () => {
      try { await result.current.selectLocation(WERKRUF); } catch (_) { /* erwartet */ }
    });

    const ausgabe = JSON.stringify(log.mock.calls);
    expect(ausgabe).toContain('conflict');
    expect(ausgabe).not.toContain(WERKRUF);
    expect(ausgabe).not.toContain('token');
    log.mockRestore();
  });
});
