import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../supabaseClient';
import { isAdminUser } from '../utils/authRoles';

/* ─────────────────────────────────────────────
   LEAD → PROFILE SYNC (non-blocking)
   Runs in background — never awaited in auth flow
───────────────────────────────────────────── */
async function syncLeadToProfile() {
  const { error } = await supabase.rpc('claim_own_lead');
  if (error) throw error;
}

/* ─────────────────────────────────────────────
   useAuth
───────────────────────────────────────────── */
export function useAuth() {
  const [user,    setUser]    = useState(undefined); // undefined = not yet resolved
  const [profile, setProfile] = useState(null);
  const syncedRef = useRef(false);

  // loading = true until we know if user is logged in or not
  const loading = user === undefined;

  /*
   * Profil laden — über den regulären Supabase-Client.
   *
   * Hier stand vorher ein direkter REST-Aufruf, für den das
   * Access-Token per Schleife aus dem localStorage gesucht wurde. Der
   * Kommentar nannte als Grund "auth lock contention", und das Symptom
   * war echt: Aufrufe hingen.
   *
   * Die Ursache war aber eine andere. supabase-js hält während des
   * onAuthStateChange-Callbacks eine Sperre auf den Auth-Zustand. Wer
   * darin einen weiteren Client-Aufruf abwartet, wartet auf eine
   * Sperre, die er selbst hält. Nicht der Client war das Problem,
   * sondern der Ort des Aufrufs.
   *
   * Deshalb liegt der Aufruf jetzt in einem eigenen Effekt, der auf
   * die User-ID reagiert — ausserhalb des Callbacks, ohne Sperre,
   * ohne localStorage-Suche.
   */
  const fetchProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      // maybeSingle statt single: ein fehlendes Profil ist kein
      // Fehler, sondern der Normalfall direkt nach der Registrierung,
      // bevor der handle_new_user-Trigger durch ist.
      .maybeSingle();

    if (error) {
      console.warn('[useAuth] Profil nicht ladbar:', error.message);
      setProfile(null);
      return;
    }
    setProfile(data ?? null);
  }, []);

  /*
   * Auth-Zustand beobachten.
   *
   * Der Callback bleibt bewusst SYNCHRON. Jede await-Anweisung darin
   * hält die Auth-Sperre von supabase-js offen und blockiert alle
   * weiteren Client-Aufrufe — genau das Verhalten, das der frühere
   * localStorage-Umweg umschiffen sollte.
   *
   * Deshalb: hier nur Zustand setzen, alles Weitere in den Effekten
   * darunter.
   */
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (!session?.user) {
          setProfile(null);
          syncedRef.current = false;
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  /* Profil laden, sobald die User-ID feststeht. */
  useEffect(() => {
    if (user === undefined || user === null) return;
    fetchProfile(user.id);
  }, [user?.id, user, fetchProfile]);

  /* Lead-Daten einmalig ins Profil übernehmen. Bewusst ohne await
     im Auth-Callback und ohne den Rest zu blockieren. */
  useEffect(() => {
    if (user === undefined || user === null || syncedRef.current) return;
    syncedRef.current = true;
    syncLeadToProfile()
      .then(() => fetchProfile(user.id))
      .catch((err) => console.warn('[useAuth] Lead-Sync:', err?.message));
  }, [user?.id, user, fetchProfile]);

  /* ─────────────────────────────────────────────
     GOOGLE OAuth

     First time: shows consent screen
     Return visits: prompt: 'none' skips consent silently.
     If token is still valid → instant redirect.
     If expired → Supabase refreshes automatically.
  ───────────────────────────────────────────── */
  const signInGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        // 'select_account' only on first time / when user has multiple accounts
        // After first auth, token is stored and Supabase auto-refreshes silently
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account', // shows account picker but skips full consent
        },
      },
    });
  }, []);

  const signInEmail = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUpEmail = useCallback(async (email, password, meta = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: meta,
      },
    });
    return { data, error };
  }, []);

  const signOut = useCallback(async () => {
    syncedRef.current = false;
    setUser(null);
    setProfile(null);
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async (userId) => {
    // getUser() ist hier unnötig: der Auth-Listener hält den
    // User-Zustand ohnehin aktuell.
    const id = userId || (user ? user.id : null);
    if (id) await fetchProfile(id);
  }, [fetchProfile, user]);

  return {
    user:            user === undefined ? null : user,
    profile,
    loading,
    signInGoogle,
    signInEmail,
    signUpEmail,
    signOut,
    refreshProfile,
    isAuthenticated: !!user && user !== undefined,
    isAdmin: isAdminUser(user),
  };
}
