import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   useGoogleBusiness

   Client-Seite der Google-Business-Profile-Anbindung.
   Redet ausschliesslich mit unserer Edge Function — niemals direkt
   mit Google, niemals mit den Token-Tabellen.

   Die bestehende Supabase-Session (useAuth) wird nur gelesen; der
   Login-Flow bleibt unangetastet.

   Warum fetch statt supabase.functions.invoke:
   Alle fünf Routen liegen in EINER Function und werden über Unterpfade
   angesprochen (…/google-business/connect). invoke() ist auf einen
   Function-Namen ohne Pfad ausgelegt — direktes fetch ist hier
   eindeutiger und macht den Authorization-Header sichtbar.

   @typedef {'active'|'needs_reauth'|'revoked'|'disconnected'} ConnectionStatus
   @typedef {Object} PublicConnection
   @property {string}  id
   @property {?string} googleAccountEmail
   @property {ConnectionStatus} status
   @property {string[]} grantedScopes
   @property {string}  connectedAt
   @property {?string} lastRefreshedAt
   @property {boolean} needsAction
───────────────────────────────────────────── */

const FUNCTION_BASE = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business`;

/* Fehlercodes → Texte. Alles, was hier nicht steht, bekommt die
   generische Meldung — damit interne Codes nicht im Dashboard landen. */
const ERROR_MESSAGES = {
  oauth_denied:
    'Du hast den Zugriff bei Google abgebrochen. Ohne Freigabe können wir dein Profil nicht verwalten.',
  insufficient_scope:
    'Es wurden nicht alle Berechtigungen erteilt. Bitte beim Verbinden alle Häkchen gesetzt lassen.',
  missing_refresh_token:
    'Google hat keinen dauerhaften Zugriff erteilt. Bitte noch einmal verbinden und die Freigabe bestätigen.',
  state_expired: 'Der Vorgang hat zu lange gedauert. Bitte noch einmal starten.',
  invalid_state: 'Die Verbindung konnte nicht bestätigt werden. Bitte noch einmal starten.',
  reauth_required: 'Die Verbindung zu Google ist abgelaufen. Bitte neu verbinden.',
  not_connected: 'Es ist noch kein Google-Konto verbunden.',
  rate_limited: 'Google drosselt gerade die Anfragen. Bitte in ein paar Minuten erneut versuchen.',
};

const GENERIC_ERROR = 'Es hat nicht geklappt. Bitte später noch einmal versuchen.';

export function messageForCode(code) {
  return ERROR_MESSAGES[code] || GENERIC_ERROR;
}

/** Ruft eine Route der Function auf und hängt die aktuelle Session an. */
async function callFunction(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');

  const response = await fetch(`${FUNCTION_BASE}/${path}`, {
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
    const error = new Error(payload?.error?.message || GENERIC_ERROR);
    error.code = payload?.error?.code || 'internal_error';
    throw error;
  }

  return payload;
}

export function useGoogleBusiness() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [notice, setNotice]   = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  /* ── Status laden ── */
  const loadStatus = useCallback(async () => {
    try {
      const data = await callFunction('status');
      if (!mountedRef.current) return;
      setConnections(data?.connections || []);
      setError(null);
    } catch (err) {
      console.error('[useGoogleBusiness] Status:', err);
      if (mountedRef.current) setError(messageForCode(err.code));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  /* ── Rückkehr vom Callback auswerten ──
     Der Callback redirectet auf …/dashboard?gbp=connected|error.
     Parameter danach sofort aus der URL räumen, damit ein Reload nicht
     dieselbe Meldung erneut zeigt. */
  useEffect(() => {
    const result = searchParams.get('gbp');
    if (!result) return;

    if (result === 'connected') {
      const email = searchParams.get('gbp_email');
      setNotice(email ? `Google-Konto ${email} verbunden.` : 'Google-Konto verbunden.');
      setError(null);
      loadStatus();
    } else if (result === 'error') {
      setError(messageForCode(searchParams.get('gbp_code')));
      setNotice(null);
    }

    const next = new URLSearchParams(searchParams);
    ['gbp', 'gbp_code', 'gbp_email'].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loadStatus]);

  /* ── Verbinden / neu verbinden ──
     connectionId gesetzt = Reconnect: Google zeigt direkt das richtige
     Konto statt des Kontowählers. */
  const connect = useCallback(async (connectionId = null) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const data = await callFunction('connect', {
        method: 'POST',
        body: {
          returnTo: `${window.location.origin}${window.location.pathname}`,
          ...(connectionId ? { connectionId } : {}),
        },
      });

      if (!data?.authUrl) throw new Error('Keine Autorisierungs-URL erhalten');

      // Volle Navigation, kein Popup: Google blockiert seinen
      // Einwilligungsdialog in eingebetteten Kontexten.
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('[useGoogleBusiness] Connect:', err);
      if (mountedRef.current) {
        setError(messageForCode(err.code));
        setBusy(false);
      }
    }
    // Bei Erfolg kein setBusy(false) — die Seite wird verlassen.
  }, []);

  /* ── Trennen ── */
  const disconnect = useCallback(async (connectionId) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const data = await callFunction('disconnect', {
        method: 'POST',
        body: { connectionId },
      });

      setNotice(
        data?.revokedAtGoogle
          ? 'Verbindung getrennt und Zugriff bei Google widerrufen.'
          : 'Verbindung getrennt. Prüfe die Freigabe ggf. noch in deinem Google-Konto.',
      );
      await loadStatus();
    } catch (err) {
      console.error('[useGoogleBusiness] Disconnect:', err);
      if (mountedRef.current) setError(messageForCode(err.code));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [loadStatus]);

  const activeConnection = connections.find((c) => c.status === 'active') || null;
  const brokenConnection = connections.find((c) => c.needsAction) || null;

  return {
    connections,
    activeConnection,
    brokenConnection,
    isConnected: !!activeConnection,
    needsReauth: !activeConnection && !!brokenConnection,
    loading,
    busy,
    error,
    notice,
    connect,
    disconnect,
    reload: loadStatus,
    dismissNotice: () => setNotice(null),
  };
}

export default useGoogleBusiness;
