import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   useGoogleBusinessData

   Überblicksdaten für das Google-Business-Dashboard.

   Liest DIREKT aus Postgres, nicht über eine Edge Function. Das geht,
   seit Tokens und Kontodaten getrennte Tabellen sind: google_locations,
   google_reviews, review_replies und sync_jobs haben eine
   SELECT-Policy für den Eigentümer, oauth_tokens hat gar keine. Der
   Umweg über eine Function würde nur Latenz kosten, ohne etwas zu
   schützen.

   @typedef {Object} GbLocation
   @property {string}  id
   @property {?string} title
   @property {?string} locality
   @property {?string} primary_phone
   @property {?string} website_uri
   @property {?string} primary_category
   @property {number}  review_count
   @property {?number} average_rating
   @property {?string} last_synced_at
   @property {boolean} is_primary
───────────────────────────────────────────── */

const GENERIC_ERROR = 'Die Daten konnten nicht geladen werden.';

export function useGoogleBusinessData({ enabled = true } = {}) {
  const [locations, setLocations] = useState([]);
  const [stats, setStats]         = useState(null);
  const [syncJobs, setSyncJobs]   = useState([]);
  const [replyCounts, setReplyCounts] = useState({ draft: 0, approved: 0, published: 0, failed: 0 });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!enabled) {
      if (mountedRef.current) {
        setLocations([]);
        setStats(null);
        setSyncJobs([]);
        setReplyCounts({ draft: 0, approved: 0, published: 0, failed: 0 });
        setError(null);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError(null);

    try {
      /* Zuerst die autorisierten Standorte laden. Erst die persistierte
         Auswahl bestimmt danach den Scope aller Kennzahlen. */
      let locationsQuery = await supabase
        .from('google_locations')
        .select('id, title, locality, primary_phone, website_uri, primary_category, place_id, review_count, average_rating, last_synced_at, is_primary, selected_at, created_at, google_profile, google_updated, google_diff_mask, google_media')
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      // Rolling deployments can briefly run before optional profile columns
      // exist. Keep the authorised location picker usable instead of failing
      // the whole dashboard with a PostgREST 400.
      if (locationsQuery.error?.code === '42703' || locationsQuery.error?.code === 'PGRST204') {
        locationsQuery = await supabase
          .from('google_locations')
          .select('id, title, locality, primary_phone, website_uri, primary_category, place_id, review_count, average_rating, last_synced_at, is_primary, created_at')
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true });
      }

      const locationsResult = await Promise.resolve(locationsQuery);
      if (locationsResult.error) throw locationsResult.error;

      const loadedLocations = locationsResult.data ?? [];
      const selectedLocation = loadedLocations.find((location) => location.selected_at) ?? null;

      /* Reviews, replies and the canonical score must never aggregate two
         different businesses. Until the customer has made an explicit
         selection, deliberately return no business metrics. */
      const reviewsQuery = supabase
        .from('google_reviews')
        .select('star_rating, is_answered')
        .eq('status', 'active');
      const jobsQuery = supabase
        .from('sync_jobs')
        .select('id, job_type, status, scheduled_for, finished_at, error_code, attempts, max_attempts, location_id')
        .order('created_at', { ascending: false })
        .limit(10);
      const repliesQuery = supabase
        .from('review_replies')
        .select('status')
        .is('deleted_at', null);
      const newestQuery = supabase
        .from('google_reviews')
        .select('google_created_at')
        .eq('status', 'active')
        .order('google_created_at', { ascending: false })
        .limit(1);

      const [reviewsResult, jobsResult, repliesResult, newestResult] = selectedLocation
        ? await Promise.all([
            reviewsQuery.eq('location_id', selectedLocation.id),
            jobsQuery.eq('location_id', selectedLocation.id),
            repliesQuery.eq('location_id', selectedLocation.id),
            newestQuery.eq('location_id', selectedLocation.id),
          ])
        : [
            { data: [], error: null },
            // Location-import jobs have no location_id and are safe to show.
            await jobsQuery.is('location_id', null),
            { data: [], error: null },
            { data: [], error: null },
          ];

      for (const result of [locationsResult, reviewsResult, jobsResult, repliesResult]) {
        if (result.error) throw result.error;
      }
      /* newestResult bewusst ohne Abbruch: fehlt es, fällt nur ein Faktor
         des Gesundheitswerts weg. Der Rest der Seite bleibt nutzbar. */

      if (!mountedRef.current) return;

      const reviews = reviewsResult.data ?? [];
      const total = reviews.length;
      const sum = reviews.reduce((acc, r) => acc + (r.star_rating ?? 0), 0);

      setLocations(loadedLocations);
      setSyncJobs(jobsResult.data ?? []);

      setStats({
        totalReviews: total,
        // Auf eine Nachkommastelle, wie Google es auch anzeigt.
        averageRating: total > 0 ? Number((sum / total).toFixed(1)) : null,
        unanswered: reviews.filter((r) => !r.is_answered).length,
        // Verteilung für den Balken: {5: 12, 4: 3, …}
        distribution: [5, 4, 3, 2, 1].reduce((acc, star) => {
          acc[star] = reviews.filter((r) => r.star_rating === star).length;
          return acc;
        }, {}),
        newestReviewAt: newestResult?.data?.[0]?.google_created_at ?? null,
        photoCount: Array.isArray(selectedLocation?.google_media)
          ? selectedLocation.google_media.length : 0,
      });

      const counts = { draft: 0, approved: 0, published: 0, failed: 0 };
      for (const row of repliesResult.data ?? []) {
        // 'publishing' zählt als offen — es ist unterwegs, aber noch
        // nicht sichtbar.
        const key = row.status === 'publishing' ? 'approved' : row.status;
        if (key in counts) counts[key] += 1;
      }
      setReplyCounts(counts);

    } catch (err) {
      console.error('[useGoogleBusinessData]', err);
      if (mountedRef.current) setError(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  /* ── Sync anstossen ──
     Reiht nur einen Job ein; das Ergebnis kommt beim nächsten Laden.
     locationId = null löst den Standort-Sync aus statt des
     Bewertungs-Syncs — der Fall beim allerersten Abgleich. */
  const triggerSync = useCallback(async (locationId = null, force = false) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Keine aktive Session');

    const response = await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/sync/trigger`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...(locationId ? { locationId } : {}), force }),
      },
    );

    if (!response.ok) throw new Error('Sync konnte nicht gestartet werden');
    return response.json();
  }, []);

  const updateLocation = useCallback(async (locationId, changes) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Keine aktive Session');
    const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/location/update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, changes }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || 'Google konnte die Änderung nicht übernehmen.');
    await load();
    return payload;
  }, [load]);

  const selectLocation = useCallback(async (locationId) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Keine aktive Session');
    const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/location/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId }),
    });
    if (!response.ok) throw new Error('Der Betrieb konnte nicht ausgewählt werden.');
    await triggerSync(locationId).catch(() => null);
    await load();
  }, [load, triggerSync]);

  /* Zuletzt erfolgreich synchronisiert — über alle Standorte der
     ÄLTESTE Zeitpunkt, nicht der neueste. Sonst sähe alles frisch aus,
     solange ein einziger Standort läuft. */
  const lastSyncedAt = locations.length > 0
    ? locations.reduce((oldest, l) => {
        if (!l.last_synced_at) return null;
        if (oldest === null) return null;
        return !oldest || l.last_synced_at < oldest ? l.last_synced_at : oldest;
      }, locations[0].last_synced_at)
    : null;

  const runningJob = syncJobs.find((j) => j.status === 'running' || j.status === 'queued') ?? null;
  const lastFailedJob = syncJobs.find((j) => j.status === 'failed') ?? null;

  return {
    locations, stats, syncJobs, replyCounts,
    lastSyncedAt, runningJob, lastFailedJob,
    loading, error,
    reload: load,
    triggerSync, updateLocation, selectLocation,
  };
}

export default useGoogleBusinessData;
