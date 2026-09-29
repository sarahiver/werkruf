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
  /* Seit dem 29.09.: Ein Betriebswechsel loest KEINEN Google-Abgleich
     mehr aus. Die Daten des gewaehlten Betriebs liegen bereits vor. */
  it('startet beim Wechsel ueberhaupt keinen Sync', async () => {
    const { result } = await laden();
    await act(async () => { await result.current.selectLocation(SI); });

    const syncAufrufe = global.fetch.mock.calls
      .filter(([url]) => url.endsWith('/sync/trigger'));

    expect(syncAufrufe).toHaveLength(0);
  });

  it('laedt beim Wechsel nur die vorhandenen Daten nach', async () => {
    state.rows.google_reviews = [
      { id: 'r1', location_id: SI, star_rating: 5, is_answered: true, status: 'active' },
    ];
    const { result } = await laden();
    await act(async () => { await result.current.selectLocation(SI); });

    expect(result.current.stats.totalReviews).toBe(1);
    expect(global.fetch.mock.calls.filter(([u]) => u.endsWith('/sync/trigger'))).toHaveLength(0);
  });

  it('laesst "Jetzt abgleichen" als eigene Aktion unberuehrt', async () => {
    const { result } = await laden();
    await act(async () => { await result.current.triggerSync(SI); });

    const syncAufrufe = global.fetch.mock.calls
      .filter(([url]) => url.endsWith('/sync/trigger'))
      .map(([, optionen]) => JSON.parse(optionen.body));

    expect(syncAufrufe).toHaveLength(1);
    expect(syncAufrufe[0].locationId).toBe(SI);
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

describe('Stille Hintergrundaktualisierung (Regression 29.09.)', () => {
  /* Der Fehler: reload() setzte jedes Mal loading = true. Beim Polling
     wechselte die Seite alle drei Sekunden zu Skeletons. */

  it('setzt beim stillen Nachladen kein loading', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    const { result } = await laden();
    expect(result.current.loading).toBe(false);

    let zwischenLoading = null;
    await act(async () => {
      const laeuft = result.current.refresh();
      zwischenLoading = result.current.loading;
      await laeuft;
    });

    expect(zwischenLoading).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('haelt Standorte und Kennzahlen waehrend der Aktualisierung sichtbar', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    state.rows.google_reviews = [
      { id: 'r1', location_id: SI, star_rating: 4, is_answered: true, status: 'active' },
    ];
    const { result } = await laden();
    const vorher = result.current.locations.length;

    await act(async () => { await result.current.refresh(); });

    expect(result.current.locations).toHaveLength(vorher);
    expect(result.current.stats.totalReviews).toBe(1);
  });

  it('setzt loading beim ersten Laden sehr wohl', async () => {
    const hook = renderHook(() => useGoogleBusinessData({ enabled: true }));
    expect(hook.result.current.loading).toBe(true);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  });
});

describe('Laufender Abgleich (Regression 29.09.)', () => {
  it('meldet keinen laufenden Job, wenn danach ein Erfolg kam', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j2', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
      { id: 'j1', location_id: WERKRUF, status: 'queued',    created_at: '2026-09-01T10:00:00Z' },
    ]);
    const { result } = await laden();

    expect(result.current.runningJob).toBeNull();
    expect(result.current.latestJob.id).toBe('j2');
    // Der alte offene Job bleibt fuer die Diagnose sichtbar.
    expect(result.current.stalledJobs.map((j) => j.id)).toEqual(['j1']);
  });

  it('erkennt den Abschluss eines laufenden Syncs beim naechsten Nachladen', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j1', location_id: WERKRUF, status: 'running', created_at: '2026-09-29T10:00:00Z' },
    ]);
    const { result } = await laden();
    expect(result.current.runningJob?.id).toBe('j1');

    state.rows.sync_jobs = jobs([
      { id: 'j1', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
    ]);
    await act(async () => { await result.current.refresh(); });

    expect(result.current.runningJob).toBeNull();
    expect(result.current.lastFailedJob).toBeNull();
  });

  it('beruecksichtigt nur Jobs des ausgewaehlten Betriebs', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'fremd', location_id: SI,      status: 'queued',    created_at: '2026-09-29T11:00:00Z' },
      { id: 'eigen', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
    ]);
    const { result } = await laden();

    // Der offene Job von S&I. darf WERKRUF nicht als laufend zeigen.
    expect(result.current.runningJob).toBeNull();
    expect(result.current.latestJob.id).toBe('eigen');
  });

  it('behaelt den laufenden Job ueber einen Betriebswechsel hinweg korrekt zugeordnet', async () => {
    state.rows.google_locations = standorte({ gewaehlt: SI });
    state.rows.sync_jobs = jobs([
      { id: 'si-job',  location_id: SI,      status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
      { id: 'wr-job',  location_id: WERKRUF, status: 'running',   created_at: '2026-09-29T09:00:00Z' },
    ]);
    const { result } = await laden();
    expect(result.current.runningJob).toBeNull();

    await act(async () => { await result.current.selectLocation(WERKRUF); });
    await waitFor(() => expect(result.current.runningJob?.id).toBe('wr-job'));
  });
});

describe('Leichte Statusabfrage (Regression 29.09.)', () => {
  it('fragt nur den einen Job ab und aktualisiert ihn', async () => {
    state.rows.google_locations = standorte({ gewaehlt: WERKRUF });
    state.rows.sync_jobs = jobs([
      { id: 'j1', location_id: WERKRUF, status: 'running', created_at: '2026-09-29T10:00:00Z' },
    ]);
    const { result } = await laden();
    expect(result.current.runningJob?.id).toBe('j1');

    // Der Job wird im Hintergrund fertig.
    state.rows.sync_jobs = jobs([
      { id: 'j1', location_id: WERKRUF, status: 'succeeded', created_at: '2026-09-29T10:00:00Z' },
    ]);

    let zurueck = null;
    await act(async () => { zurueck = await result.current.refreshJobStatus('j1'); });

    expect(zurueck.status).toBe('succeeded');
    expect(result.current.runningJob).toBeNull();
  });

  it('kommt mit einer unbekannten Job-Kennung zurecht', async () => {
    const { result } = await laden();
    let zurueck = 'nicht gesetzt';
    await act(async () => { zurueck = await result.current.refreshJobStatus('gibt-es-nicht'); });
    expect(zurueck).toBeNull();
  });

  it('fragt ohne Job-Kennung gar nicht erst ab', async () => {
    const { result } = await laden();
    let zurueck = 'nicht gesetzt';
    await act(async () => { zurueck = await result.current.refreshJobStatus(null); });
    expect(zurueck).toBeNull();
  });
});
