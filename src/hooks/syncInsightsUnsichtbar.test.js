/**
 * WP5 — Leistungsdaten-Jobs (sync_insights) duerfen die Abgleich-Karte
 * nicht bestimmen.
 *
 * Verhalten des Hooks gegen eine nachgebildete Datenbank, wie in
 * googleBusinessLocationSwitch.test.js. Der Fall: Der juengste Job des
 * Standorts ist ein gescheiterter sync_insights (Performance API im
 * Cloud-Projekt nicht aktiviert). Vorher ein erfolgreicher
 * Bewertungs-Sync.
 *
 * Erwartung: lastFailedJob ist null, latestJob ist der Bewertungs-Sync.
 * Sonst stuende beim Kunden „Letzter Abgleich fehlgeschlagen" fuer
 * etwas, das er weder sieht noch beheben kann.
 */
import { renderHook, waitFor } from '@testing-library/react';

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

const SI = 'loc-si';

beforeEach(() => {
  state.rows = {
    google_locations: [
      { id: SI, title: 'S&I.', locality: 'Hamburg', is_primary: true,
        selected_at: '2026-11-09T08:00:00Z', last_synced_at: '2026-11-09T07:00:00Z',
        google_media: [], created_at: '2026-09-01' },
    ],
    google_reviews: [], review_replies: [],
    sync_jobs: [
      /* juengster Job: Leistungsdaten, endgueltig gescheitert */
      { id: 'j-insights', job_type: 'sync_insights', status: 'failed', location_id: SI,
        error_code: 'performance_api_disabled', attempts: 3, max_attempts: 3,
        created_at: '2026-11-09T07:30:00Z', finished_at: '2026-11-09T07:45:00Z' },
      /* davor: Bewertungen, erfolgreich */
      { id: 'j-reviews', job_type: 'sync_reviews', status: 'succeeded', location_id: SI,
        error_code: null, attempts: 1, max_attempts: 3,
        created_at: '2026-11-09T07:00:00Z', finished_at: '2026-11-09T07:00:05Z' },
    ],
  };
});

test('ein gescheiterter sync_insights bestimmt die Karte nicht', async () => {
  const { result } = renderHook(() => useGoogleBusinessData());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.syncJobs.map((j) => j.job_type)).toEqual(['sync_reviews']);
  expect(result.current.latestJob?.id).toBe('j-reviews');
  expect(result.current.lastFailedJob).toBeNull();
  expect(result.current.failedJobHistory).toEqual([]);
});

test('Gegenprobe: derselbe Fehlschlag als sync_reviews waere sichtbar', async () => {
  state.rows.sync_jobs[0].job_type = 'sync_reviews';
  const { result } = renderHook(() => useGoogleBusinessData());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.lastFailedJob?.id).toBe('j-insights');
});
