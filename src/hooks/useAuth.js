import { useState, useEffect, useCallback } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   useAuth — Single source of truth for auth state

   Returns:
     user          Supabase user object | null
     profile       user_profiles row | null
     loading       true while session is being resolved
     signInGoogle  () => void
     signInEmail   (email, password) => { error }
     signUpEmail   (email, password, meta) => { error }
     signOut       () => void
     refreshProfile () => void
───────────────────────────────────────────── */
export function useAuth() {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data || null);
  }, []);

  useEffect(() => {
    // Resolve initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      fetchProfile(u?.id).finally(() => setLoading(false));
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const u = session?.user ?? null;
        setUser(u);
        await fetchProfile(u?.id);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  /* ── Google OAuth ── */
  const signInGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }, []);

  /* ── Email/Password Sign In ── */
  const signInEmail = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  /* ── Email/Password Sign Up ── */
  const signUpEmail = useCallback(async (email, password, meta = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: meta, // stored in raw_user_meta_data
      },
    });
    return { data, error };
  }, []);

  /* ── Sign Out ── */
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  /* ── Force-refresh profile (after onboarding update) ── */
  const refreshProfile = useCallback(() => {
    if (user?.id) fetchProfile(user.id);
  }, [user, fetchProfile]);

  return {
    user,
    profile,
    loading,
    signInGoogle,
    signInEmail,
    signUpEmail,
    signOut,
    refreshProfile,
    isAuthenticated: !!user,
  };
}
