import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   useReviews

   Bewertungsliste mit Blättern, Suche und Filtern — serverseitig.
   Alles clientseitig zu filtern hiesse, bei einem Betrieb mit 2.000
   Bewertungen jedes Mal 2.000 Zeilen zu laden, um zwölf anzuzeigen.

   Enthält ausserdem die Aktionen des Antwort-Ablaufs: erzeugen,
   bearbeiten, bestätigen. Veröffentlicht wird serverseitig über einen
   Job — der Hook reiht nur ein.
───────────────────────────────────────────── */

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 350;
const GENERIC_ERROR = 'Die Bewertungen konnten nicht geladen werden.';

const FUNCTIONS_BASE = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

async function callFunction(path, { method = 'POST', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');

  const response = await fetch(`${FUNCTIONS_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Es hat nicht geklappt.');
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export function useReviews(initialFilters = {}) {
  const [reviews, setReviews] = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [search, setSearch]           = useState('');
  const [debouncedSearch, setDebounced] = useState('');
  const [rating, setRating]           = useState(initialFilters.rating ?? 'all');
  const [answered, setAnswered]       = useState(initialFilters.answered ?? 'all');
  const [locationId, setLocationId]   = useState(initialFilters.locationId ?? 'all');
  const [sort, setSort]               = useState('newest');

  // Antwort-Entwürfe je Bewertung, aus review_replies geladen.
  const [replies, setReplies]   = useState({});
  const [busy, setBusy]         = useState({});
  const [actionError, setActionError] = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /* Tippen entprellen — sonst eine Abfrage pro Anschlag. */
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  /* Filterwechsel bringt zurück auf Seite 1 — sonst landet man auf
     einer Seite, die es im neuen Ergebnis nicht mehr gibt. */
  useEffect(() => { setPage(0); }, [debouncedSearch, rating, answered, locationId, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('google_reviews')
        // count: 'exact' liefert die Gesamtzahl für die Blätterleiste
        // im selben Roundtrip.
        .select(
          'id, location_id, star_rating, comment, reviewer_display_name, ' +
          'google_created_at, is_answered, answered_at, status',
          { count: 'exact' },
        )
        .eq('status', 'active');

      if (rating !== 'all')     query = query.eq('star_rating', Number(rating));
      if (locationId !== 'all') query = query.eq('location_id', locationId);
      if (answered === 'open')  query = query.eq('is_answered', false);
      if (answered === 'done')  query = query.eq('is_answered', true);

      if (debouncedSearch) {
        // Volltext über Kommentar und Name. Sonderzeichen entschärfen,
        // damit Komma und Klammer den PostgREST-Filter nicht zerlegen.
        const term = debouncedSearch.replace(/[,()*]/g, ' ').trim();
        if (term) {
          query = query.or(`comment.ilike.%${term}%,reviewer_display_name.ilike.%${term}%`);
        }
      }

      const ascending = sort === 'oldest';
      query = sort === 'rating_low' || sort === 'rating_high'
        ? query.order('star_rating', { ascending: sort === 'rating_low' })
               .order('google_created_at', { ascending: false })
        : query.order('google_created_at', { ascending });

      const from = page * PAGE_SIZE;
      const { data, error: queryError, count } = await query.range(from, from + PAGE_SIZE - 1);

      if (queryError) throw queryError;
      if (!mountedRef.current) return;

      setReviews(data ?? []);
      setTotal(count ?? 0);

      /* Antworten zu den sichtbaren Bewertungen nachladen — nur zu
         diesen zwölf, nicht zu allen. */
      const ids = (data ?? []).map((r) => r.id);
      if (ids.length > 0) {
        const { data: replyRows } = await supabase
          .from('review_replies')
          .select('id, review_id, body, source, status, published_at, error_code, created_at')
          .in('review_id', ids)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (mountedRef.current) {
          const byReview = {};
          for (const row of replyRows ?? []) {
            // Neueste zuerst sortiert — die erste ist die aktuelle.
            if (!byReview[row.review_id]) byReview[row.review_id] = row;
          }
          setReplies(byReview);
        }
      } else {
        setReplies({});
      }

    } catch (err) {
      console.error('[useReviews]', err);
      if (mountedRef.current) setError(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [page, rating, answered, locationId, sort, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const setBusyFor = (id, value) =>
    setBusy((prev) => ({ ...prev, [id]: value }));

  /* ── KI-Entwurf erzeugen ── */
  const generateReply = useCallback(async (review, facts) => {
    setBusyFor(review.id, 'generating');
    setActionError(null);

    try {
      const data = await callFunction('generate-review-reply', {
        body: {
          reviewId:     review.id,
          reviewText:   review.comment,
          reviewerName: review.reviewer_display_name,
          rating:       review.star_rating,
          companyName:  facts.companyName,
          industry:     facts.industry,
          contactEmail: facts.contactEmail,
          contactPhone: facts.contactPhone,
        },
      });

      if (mountedRef.current && data.replyId) {
        setReplies((prev) => ({
          ...prev,
          [review.id]: {
            id: data.replyId, review_id: review.id, body: data.reply,
            source: 'ai', status: 'draft', published_at: null,
            requiresHumanReview: data.requiresHumanReview,
            detectedIssues: data.detectedIssues,
          },
        }));
      }
      return data;
    } catch (err) {
      if (mountedRef.current) setActionError(err.message);
      throw err;
    } finally {
      if (mountedRef.current) setBusyFor(review.id, null);
    }
  }, []);

  /* ── Entwurf bearbeiten ── */
  const saveDraft = useCallback(async (reviewId, replyId, body) => {
    setBusyFor(reviewId, 'saving');
    setActionError(null);

    try {
      await callFunction('google-business/replies/update', { body: { replyId, body } });
      if (mountedRef.current) {
        setReplies((prev) => ({
          ...prev,
          [reviewId]: { ...prev[reviewId], body, source: 'human' },
        }));
      }
    } catch (err) {
      if (mountedRef.current) setActionError(err.message);
      throw err;
    } finally {
      if (mountedRef.current) setBusyFor(reviewId, null);
    }
  }, []);

  /* ── Bestätigen und veröffentlichen ──
     Der Job läuft im Hintergrund; der Status wechselt erst beim
     nächsten Laden auf 'published'. */
  const approveReply = useCallback(async (reviewId, replyId) => {
    setBusyFor(reviewId, 'publishing');
    setActionError(null);

    try {
      const data = await callFunction('google-business/replies/approve', { body: { replyId } });
      if (mountedRef.current) {
        setReplies((prev) => ({
          ...prev,
          [reviewId]: { ...prev[reviewId], status: 'approved' },
        }));
      }
      return data;
    } catch (err) {
      if (mountedRef.current) setActionError(err.message);
      throw err;
    } finally {
      if (mountedRef.current) setBusyFor(reviewId, null);
    }
  }, []);

  const hasFilters = useMemo(
    () => Boolean(debouncedSearch) || rating !== 'all' || answered !== 'all' || locationId !== 'all',
    [debouncedSearch, rating, answered, locationId],
  );

  const resetFilters = useCallback(() => {
    setSearch(''); setRating('all'); setAnswered('all'); setLocationId('all'); setSort('newest');
  }, []);

  return {
    reviews, replies, total, page, pageSize: PAGE_SIZE,
    loading, error, busy, actionError,
    search, setSearch,
    rating, setRating,
    answered, setAnswered,
    locationId, setLocationId,
    sort, setSort,
    hasFilters, resetFilters,
    setPage, reload: load,
    generateReply, saveDraft, approveReply,
    dismissActionError: () => setActionError(null),
  };
}

export default useReviews;
