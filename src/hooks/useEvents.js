import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   useEvents

   Liest die Ergebnisse der Entscheidungs-Engine. Enthält bewusst
   KEINE Entscheidungslogik — kein Schwellwert, keine Priorität, keine
   Regel darüber, was wichtig ist.

   Vorher lag genau das in useDashboardBriefing: neun if-Zweige, die
   aus Rohzahlen Empfehlungen ableiteten. Dieselbe Logik existierte
   ein zweites Mal in der Wochenmail, in anderer Formulierung und mit
   anderen Grenzwerten. Zwei Quellen für dieselbe Frage sind auf Dauer
   zwei verschiedene Produkte.

   Jetzt: Die Engine entscheidet einmal im Worker und schreibt das
   Ergebnis nach public.events. Dieser Hook liest. Die Wochenmail
   liest. Eine spätere App liest. Keiner von ihnen rechnet.

   Preis: Das Dashboard ist so frisch wie der letzte Worker-Lauf. Wo
   das nicht reicht — der Nutzer gibt eine Antwort frei — stösst
   revaluate() eine Neubewertung an.

   @typedef {'reviews'|'profile'|'connection'|'visibility'} Category
   @typedef {Object} DecisionEvent
   @property {string}  id
   @property {string}  type
   @property {Category} category
   @property {number}  priority          0-100, von der Engine vergeben
   @property {string}  title
   @property {string}  summary
   @property {?string} reason
   @property {?string} recommended_action
   @property {?string} action_url
   @property {?string} estimated_effort
   @property {?string} impact
   @property {boolean} is_dismissable
───────────────────────────────────────────── */

const FUNCTIONS_BASE = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

async function callFunction(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');

  const response = await fetch(`${FUNCTIONS_BASE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Es hat nicht geklappt.');
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export function useEvents() {
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      /* Die RLS-Policy filtert bereits auf eigene, offene Ereignisse.
         Die Sortierung kommt aus der Engine — nicht hier neu
         erfinden, sonst weicht das Dashboard von der Mail ab. */
      const { data, error: queryError } = await supabase
        .from('events')
        .select('id, type, category, priority, title, summary, reason, ' +
                'recommended_action, action_url, estimated_effort, impact, ' +
                'is_dismissable, in_dashboard, data, created_at')
        .eq('in_dashboard', true)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;
      if (!mountedRef.current) return;
      setEvents(data ?? []);
    } catch (err) {
      console.error('[useEvents]', err);
      if (mountedRef.current) setError('Die Empfehlungen konnten nicht geladen werden.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── "Gesehen" vermerken ──
     Gebündelt und einmalig je Empfehlung. Ohne diesen Vermerk lässt
     sich später nicht unterscheiden, ob eine Empfehlung ignoriert
     oder nie angezeigt wurde — und das ist ein Unterschied zwischen
     einer schlechten Empfehlung und einem Anzeigefehler. */
  const seenRef = useRef(new Set());
  useEffect(() => {
    if (events.length === 0) return;
    const unseen = events.map((e) => e.id).filter((id) => !seenRef.current.has(id));
    if (unseen.length === 0) return;

    unseen.forEach((id) => seenRef.current.add(id));
    // Best effort: eine fehlgeschlagene Statistik darf nichts blockieren.
    callFunction('google-business/events/track', {
      eventIds: unseen, action: 'seen', channel: 'dashboard',
    }).catch(() => {});
  }, [events]);

  /* Neu bewerten. Nach einer Handlung, die die Lage ändert. */
  const revaluate = useCallback(async () => {
    setBusy(true);
    try {
      await callFunction('google-business/events/evaluate');
      await load();
    } catch (err) {
      console.error('[useEvents] evaluate', err);
      if (mountedRef.current) setError('Neubewertung fehlgeschlagen.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [load]);

  /* ── "Geöffnet" vermerken ──
     Der Nutzer folgt der Empfehlung. Zusammen mit "gesehen" ergibt
     das die Öffnungsquote — sie misst, ob der Titel trägt. */
  const open = useCallback((eventId) => {
    callFunction('google-business/events/track', {
      eventIds: [eventId], action: 'opened', channel: 'dashboard',
    }).catch(() => {});
  }, []);

  const dismiss = useCallback(async (eventId) => {
    // Sofort ausblenden, dann speichern — ein Wegklicken, das auf die
    // Datenbank wartet, fühlt sich kaputt an.
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    try {
      await callFunction('google-business/events/dismiss', { eventId });
    } catch (err) {
      console.error('[useEvents] dismiss', err);
      await load();   // zurückdrehen
    }
  }, [load]);

  /* Abgeleitete Sichten. Reines Filtern, keine Bewertung. */
  const derived = useMemo(() => {
    const critical = events.filter((e) => e.priority >= 80);
    const warning  = events.filter((e) => e.priority >= 40 && e.priority < 80);

    /* Die Top-3-Regel gehört der Engine — hier wird nur
       abgeschnitten, nicht neu sortiert. */
    return {
      critical,
      warning,
      top3: events.slice(0, 3),
      next: events[0] ?? null,
      counts: {
        total: events.length,
        critical: critical.length,
        warning: warning.length,
      },
    };
  }, [events]);

  return { events, ...derived, loading, busy, error, reload: load, revaluate, dismiss, open };
}

export default useEvents;
