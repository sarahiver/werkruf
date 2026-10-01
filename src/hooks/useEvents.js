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

/*
 * Drei Aufgaben, nicht mehr.
 *
 * Mehr liest niemand, und eine Liste von zwoelf Empfehlungen ist keine
 * Hilfe, sondern eine zweite Aufgabe.
 */
const MAX_AUFGABEN = 3;

export function useEvents() {
  const [feedZustand, setFeedZustand] = useState({
    locationResolved: true, locationId: null, open: 0,
  });
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      /*
       * Über den Feed, nicht direkt über die Tabelle.
       *
       * Die frühere Abfrage las alle Events des Nutzers — bei zwei
       * Betrieben also die von S&I UND WERKRUF nebeneinander. Die
       * RLS-Policy trennt nach Nutzer, nicht nach Betrieb.
       *
       * events_feed wählt den Standort serverseitig nach derselben
       * Regel wie der WERKRUF Score, liefert Konto-Empfehlungen mit und
       * sortiert wie die Engine. Die Reihenfolge hier erneut
       * herzustellen hiesse, dass Dashboard und Wochenmail
       * auseinanderlaufen können.
       */
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setEvents([]); return; }

      const { data: standort } = await supabase.rpc('werkruf_score_location', {
        p_user_id: user.id,
      });

      const { data, error: queryError } = await supabase.rpc('events_feed', {
        p_user_id: user.id,
        p_location_id: standort ?? null,
        p_limit: MAX_AUFGABEN,
      });

      if (queryError) throw queryError;
      if (!mountedRef.current) return;

      const feed = data ?? {};
      setEvents(Array.isArray(feed.items) ? feed.items : []);
      setFeedZustand({
        /* Bei mehreren Betrieben ohne Auswahl ist das false — dann
           zeigt das Dashboard die Auswahl, keine Aufgaben. */
        locationResolved: Boolean(standort),
        locationId: standort ?? null,
        open: feed.open ?? 0,
      });
    } catch (err) {
      console.error('[useEvents]', err);
      if (mountedRef.current) setError('Die Empfehlungen konnten nicht geladen werden.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Dashboard-Besuch vermerken ──
     Grundlage der Abwesenheits-Erinnerung. Ohne diesen Zeitstempel
     liesse sie sich nicht an Abwesenheit knüpfen — und wäre dann
     genau die Bettelmail, die wir nicht schreiben wollen.

     Einmal je Sitzung, best effort. */
  const visitRef = useRef(false);
  useEffect(() => {
    if (visitRef.current) return;
    visitRef.current = true;
    /*
     * Kein .catch() direkt am rpc-Aufruf.
     *
     * supabase.rpc gibt einen PostgrestFilterBuilder zurueck, kein
     * Promise. Er hat .then(), aber kein .catch() — der Aufruf wirft
     * "pt.default.rpc(...).catch is not a function" und reisst das
     * gesamte Rendern mit.
     *
     * Der Fehler lag hier schon laenger; er fiel nicht auf, weil
     * useEvents auf der Startseite nicht eingebunden war. Seit D3
     * laeuft er bei jedem Dashboard-Aufruf.
     *
     * Promise.resolve() macht aus dem Thenable ein echtes Promise.
     */
    Promise.resolve(supabase.rpc('touch_dashboard_visit', {})).catch(() => {});
  }, []);

  /* ── "Gesehen" vermerken ──
     Gebündelt und einmalig je Empfehlung. Ohne diesen Vermerk lässt
     sich später nicht unterscheiden, ob eine Empfehlung ignoriert
     oder nie angezeigt wurde — und das ist ein Unterschied zwischen
     einer schlechten Empfehlung und einem Anzeigefehler. */
  /*
   * Gesehen melden — aber erst, wenn die Karte wirklich sichtbar war.
   *
   * Bis zum 01.10.2026 geschah das hier in einem useEffect auf
   * `events`: Alle geladenen Empfehlungen galten sofort als gesehen,
   * auch die dritte unterhalb des Falzes, die nie jemand zu Gesicht
   * bekam.
   *
   * Die Kennzahl maß damit, wie oft das Dashboard geöffnet wurde —
   * nicht, was jemand gelesen hat. Und bei der Frage, ob eine
   * Empfehlung ignoriert wurde oder nie ankam, ist das der ganze
   * Unterschied.
   *
   * Wann gemeldet wird, entscheidet jetzt die Anzeige über
   * useSichtbarkeit. Hier steht nur noch das Versenden.
   */
  const gemeldet = useRef(new Set());

  const melde = useCallback((ids) => {
    const liste = (Array.isArray(ids) ? ids : [ids])
      .filter((id) => id && !gemeldet.current.has(id));
    if (liste.length === 0) return;

    liste.forEach((id) => gemeldet.current.add(id));

    /* Best effort: Eine fehlgeschlagene Statistik darf die Anzeige
       nicht stören. */
    callFunction('google-business/events/track', {
      eventIds: liste, action: 'seen', channel: 'dashboard',
    }).catch(() => {});
  }, []);

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

  return {
    events, ...derived, loading, busy, error,
    reload: load, revaluate, dismiss, open,
    /* Von der Anzeige aufzurufen, wenn Karten sichtbar wurden. */
    melde,
    /* Standortzustand aus dem Feed — damit das Dashboard keine eigene
       Standortlogik braucht. */
    ...feedZustand,
  };
}

export default useEvents;
