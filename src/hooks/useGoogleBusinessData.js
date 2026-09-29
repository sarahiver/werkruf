import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../supabaseClient';

/* Nur fuer den Fall, dass die Antwort keinen lesbaren Text enthaelt —
   etwa bei einem Netzwerkabbruch oder einer Antwort ohne JSON. */
const FALLBACK_SELECT_ERROR = 'Der Betrieb konnte nicht ausgewählt werden. Bitte versuche es in einem Moment erneut.';

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
  /* loading  = erstes Laden, die Seite hat noch nichts anzuzeigen
     refreshing = stille Hintergrundaktualisierung waehrend eines
                  laufenden Abgleichs; die Oberflaeche bleibt stehen

     Vorher setzte jedes reload() loading auf true. Beim Polling
     wechselte die gesamte Seite dadurch alle drei Sekunden zu
     Skeletons — Standortkarten wurden neu aufgebaut, offene Formulare
     verloren ihren Inhalt. */
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
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
    if (silent) setRefreshing(true); else setLoading(true);
    /* Beim stillen Nachladen die bestehende Fehlermeldung stehen
       lassen — sie verschwindet erst, wenn der Abruf gelingt. */
    if (!silent) setError(null);

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
      setError(null);

    } catch (err) {
      console.error('[useGoogleBusinessData]', err);
      if (mountedRef.current) setError(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  /* Stille Aktualisierung fuer das Polling. Eigene Referenz, damit sie
     als Effekt-Abhaengigkeit stabil bleibt und kein Intervall neu
     startet. */
  const refresh = useCallback(() => load({ silent: true }), [load]);

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

  /* ── Nur den Status EINES Jobs nachladen ──
     Waehrend eines laufenden Abgleichs braucht die Seite nicht alle
     Unternehmensdaten, sondern nur die Frage "ist er fertig?". Vorher
     lud jeder Polling-Durchlauf Standorte, Bewertungen, Jobs, Antworten
     und die neueste Rezension — fuenf Abfragen alle drei Sekunden.

     Gibt den Job zurueck, damit der Aufrufer selbst entscheiden kann,
     wann der vollstaendige Abruf faellig ist. */
  const refreshJobStatus = useCallback(async (jobId) => {
    if (!jobId) return null;
    const { data, error: abfrageFehler } = await supabase
      .from('sync_jobs')
      .select('id, status, attempts, max_attempts, error_code, error_message, job_type, location_id, created_at, finished_at')
      .eq('id', jobId)
      .limit(1);

    if (abfrageFehler) {
      console.error('[useGoogleBusinessData] refreshJobStatus', { code: abfrageFehler.code });
      return null;
    }

    const job = data?.[0] ?? null;
    if (job && mountedRef.current) {
      setSyncJobs((vorher) => vorher.map((j) => (j.id === job.id ? { ...j, ...job } : j)));
    }
    return job;
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
    if (!response.ok) {
      /* Die Edge Function antwortet strukturiert:
           { error: { code, message, retryable } }
         Der Text darin ist bereits fuer Nutzer geschrieben — ihn
         wegzuwerfen und pauschal "konnte nicht ausgewaehlt werden" zu
         zeigen, nimmt genau die Auskunft weg, die weiterhilft. */
      const payload = await response.json().catch(() => null);
      const code = payload?.error?.code ?? `http_${response.status}`;

      /* Nur Fehlercode und Statuscode ins Protokoll — keine Tokens,
         keine E-Mail, keine Standort- oder Nutzerkennung. */
      console.error('[useGoogleBusinessData] location/select', { code, status: response.status });

      throw Object.assign(
        new Error(payload?.error?.message || FALLBACK_SELECT_ERROR),
        { code },
      );
    }

    /* KEIN automatischer Google-Abgleich mehr.
       Ein Betriebswechsel zeigt vorhandene Daten — Kennzahlen,
       Bewertungen, Aufgaben und den letzten Sync-Status liegen bereits
       in der Datenbank. Der frueher hier angestossene triggerSync
       erzeugte bei jedem Hin- und Herwechseln einen neuen Job, kostete
       Google-Quota und liess das Dashboard in ein Polling laufen, fuer
       das es keinen Anlass gab. "Jetzt abgleichen" bleibt als eigene
       Aktion bestehen. */
    await load();
  }, [load]);

  /* Zuletzt erfolgreich synchronisiert.

     Ist ein Betrieb ausgewählt, zählt ausschließlich dessen Zeitpunkt.
     Vorher wurde über ALLE Standorte der älteste genommen — bei zwei
     Betrieben zeigte das Dashboard dann den Stand des jeweils anderen.

     Ohne Auswahl bleibt es beim ältesten: Sonst sähe alles frisch aus,
     solange ein einziger Standort aktuell ist. */
  const auswahl = locations.find((l) => l.selected_at) ?? null;

  const lastSyncedAt = auswahl
    ? auswahl.last_synced_at ?? null
    : locations.length > 0
      ? locations.reduce((oldest, l) => {
          if (!l.last_synced_at) return null;
          if (oldest === null) return null;
          return !oldest || l.last_synced_at < oldest ? l.last_synced_at : oldest;
        }, locations[0].last_synced_at)
      : null;

  /* Jobs liegen absteigend nach created_at vor und sind bei getroffener
     Auswahl bereits auf deren location_id gefiltert (siehe oben).
     syncJobs[0] ist damit der jüngste Job dieses Betriebs. */
  const latestJob = syncJobs[0] ?? null;

  /* NUR der juengste Job bestimmt "laeuft gerade".

     Vorher stand hier find(queued|running) ueber die ganze Liste. Ein
     alter Job, der nie zu Ende lief — etwa weil der Worker damals
     stand —, blieb dadurch fuer immer "queued" und liess das Dashboard
     dauerhaft "Abgleich laeuft" melden, obwohl danach laengst ein
     erfolgreicher Lauf war.

     syncJobs ist absteigend nach created_at sortiert und bei
     getroffener Auswahl bereits auf deren location_id gefiltert. */
  const runningJob = (latestJob?.status === 'running' || latestJob?.status === 'queued')
    ? latestJob
    : null;

  /* ── Zustand des einmaligen Erstimports ──
     Nach dem Verbinden autorisiert OAuth ein Konto, aber noch keinen
     Betrieb. Der Standortimport holt sie nach.

     Der Zustand wird aus den Jobs abgeleitet, NICHT aus einer Ref im
     Bauteil: Eine Ref wird bei jedem Seitenaufbau zurueckgesetzt, und
     ein erfolgreicher Import, der null Betriebe fand, loeste dadurch
     bei jedem Reload einen neuen aus.

     'none'      noch nie ein Standortimport
     'running'   eingereiht oder laeuft
     'succeeded' durchgelaufen — auch dann, wenn Google null Betriebe
                 zurueckgab. Das ist ein Ergebnis, kein fehlender Lauf.
     'failed'    endgueltig gescheitert */
  const importJobs = syncJobs.filter((j) => j.job_type === 'sync_locations');
  const letzterImport = importJobs[0] ?? null;

  const locationImport = {
    job: letzterImport,
    status: !letzterImport ? 'none'
      : (letzterImport.status === 'queued' || letzterImport.status === 'running') ? 'running'
      : letzterImport.status === 'succeeded' ? 'succeeded'
      : 'failed',
    /* Erfolgreich gelaufen, aber Google kennt keine verwaltbaren
       Betriebe. Eigener Zustand, kein Anlass fuer einen neuen Versuch. */
    keineBetriebe: letzterImport?.status === 'succeeded' && locations.length === 0,
  };

  /* Aeltere offene Jobs bleiben fuer die Diagnose sichtbar, ohne den
     Zustand zu bestimmen. Ein dauerhaft wachsender Wert hier heisst:
     Jobs werden eingereiht, aber nicht abgearbeitet. */
  const stalledJobs = syncJobs
    .slice(1)
    .filter((j) => j.status === 'running' || j.status === 'queued');

  /* NUR wenn der jüngste Job gescheitert ist, beschreibt das den
     aktuellen Zustand.

     Vorher stand hier find(status === 'failed') über die ganze Liste:
     Ein Fehlschlag von vor drei Wochen verdrängte damit jeden späteren
     Erfolg, und das Dashboard meldete dauerhaft einen Fehler, den es
     nicht mehr gab. */
  const lastFailedJob = latestJob?.status === 'failed' ? latestJob : null;

  /* Für die Betriebshistorie: alle Fehlschläge bleiben abrufbar, ohne
     die aktuelle Anzeige zu verfälschen. */
  const failedJobHistory = syncJobs.filter((j) => j.status === 'failed');

  return {
    locations, stats, syncJobs, replyCounts,
    lastSyncedAt, latestJob, runningJob, lastFailedJob, failedJobHistory, stalledJobs,
    locationImport,
    loading, refreshing, error,
    reload: load,
    refresh,
    triggerSync, refreshJobStatus, updateLocation, selectLocation,
  };
}

export default useGoogleBusinessData;
