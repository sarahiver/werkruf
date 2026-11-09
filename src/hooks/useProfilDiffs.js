import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

/*
 * WP8 — offene Profil-Differenzen eines Standorts.
 *
 * Lesen: direkt aus google_profile_diffs (RLS: nur eigene Zeilen).
 * Schreiben: NUR ueber die Edge Function location/diff-apply — der
 * Client schickt diffId und aktion, nie Feld oder Wert.
 */
export function useProfilDiffs(locationId, { enabled = true } = {}) {
  const [diffs, setDiffs] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled && locationId));
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled || !locationId) { setDiffs([]); setLoading(false); return; }
    /* Ohne Client (Tests, die den Supabase-Client stubben): leer, kein
       Fehler. Die Seite funktioniert, der Waechter zeigt nichts. */
    if (!supabase || typeof supabase.from !== 'function') { setDiffs([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from('google_profile_diffs')
      .select('id, field_path, prio, label, change_type, origin, merchant_value, consumer_value, first_seen_at, last_seen_at, rejection_reason, lifecycle_stage')
      .eq('location_id', locationId)
      .is('resolved_at', null)
      .order('first_seen_at', { ascending: false });
    if (err) { setError(err.message); setDiffs([]); }
    else setDiffs(data ?? []);
    setLoading(false);
  }, [enabled, locationId]);

  useEffect(() => { load(); }, [load]);

  const anwenden = useCallback(async (diffId, aktion) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Keine aktive Session');
    const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/location/diff-apply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ diffId, aktion }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message || 'Die Änderung konnte nicht übernommen werden.'),
        { code: payload?.error?.code ?? `http_${response.status}` },
      );
    }
    await load();
    return payload;
  }, [load]);

  return { diffs, loading, error, reload: load, anwenden };
}

export default useProfilDiffs;
