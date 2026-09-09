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
   @property {number}  review_count
   @property {?number} average_rating
   @property {?string} last_synced_at
   @property {boolean} is_primary
───────────────────────────────────────────── */

const GENERIC_ERROR = 'Die Daten konnten nicht geladen werden.';

export function useGoogleBusinessData() {
  const [locations, setLocations] = useState([]);
  const [stats, setStats]         = useState(null);
  const [syncJobs, setSyncJobs]   = useState([]);
  const [replyCounts, setReplyCounts] = useState({ draft: 0, approved: 0, published: 0, failed: 0 });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    setError(null);

    try {
      /* Alles parallel. Die Abfragen hängen nicht voneinander ab, und
         seriell wären es vier Roundtrips statt einem. */
      const [locationsResult, reviewsResult, jobsResult, repliesResult] = await Promise.all([
        supabase
          .from('google_locations')
          .select('id, title, locality, place_id, review_count, average_rating, last_synced_at, is_primary')
          .order('is_primary', { ascending: false })
          .order('title', { ascending: true }),

        /* Nur die Felder, die in die Kennzahlen eingehen. Ein
           select('*') würde bei tausenden Bewertungen den ganzen
           Kommentartext über die Leitung ziehen, nur um zu zählen. */
        supabase
          .from('google_reviews')
          .select('star_rating, is_answered')
          .eq('status', 'active'),

        supabase
          .from('sync_jobs')
          .select('id, job_type, status, scheduled_for, finished_at, error_code, attempts, max_attempts')
          .order('created_at', { ascending: false })
          .limit(10),

        supabase
          .from('review_replies')
          .select('status')
          .is('deleted_at', null),
      ]);

      for (const result of [locationsResult, reviewsResult, jobsResult, repliesResult]) {
        if (result.error) throw result.error;
      }

      if (!mountedRef.current) return;

      const reviews = reviewsResult.data ?? [];
      const total = reviews.length;
      const sum = reviews.reduce((acc, r) => acc + (r.star_rating ?? 0), 0);

      setLocations(locationsResult.data ?? []);
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
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Sync anstossen ──
     Reiht nur einen Job ein; das Ergebnis kommt beim nächsten Laden. */
  const triggerSync = useCallback(async (locationId, force = false) => {
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
        body: JSON.stringify({ locationId, force }),
      },
    );

    if (!response.ok) throw new Error('Sync konnte nicht gestartet werden');
    return response.json();
  }, []);

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
    triggerSync,
  };
}

export default useGoogleBusinessData;
