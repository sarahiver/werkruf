import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   LEAD → PROFILE SYNC (non-blocking)
   Runs in background — never awaited in auth flow
───────────────────────────────────────────── */
async function syncLeadToProfile(userId, email) {
  if (!userId || !email) return;
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('google_place_id')
      .eq('id', userId)
      .single();

    if (profile?.google_place_id) return; // already synced

    const { data: lead } = await supabase
      .from('leads')
      .select('company_name, google_place_id, google_rating, google_review_count, visibility_score, city, industry_key')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lead) return;

    const updates = {};
    if (lead.company_name)        updates.company_name        = lead.company_name;
    if (lead.google_place_id)     updates.google_place_id     = lead.google_place_id;
    if (lead.google_rating)       updates.google_rating       = lead.google_rating;
    if (lead.google_review_count) updates.google_review_count = lead.google_review_count;
    if (lead.visibility_score)    updates.visibility_score    = lead.visibility_score;
    if (lead.city)                updates.city                = lead.city;
    if (lead.industry_key)        updates.industry_key        = lead.industry_key;

    if (Object.keys(updates).length === 0) return;

    await supabase.from('user_profiles').update(updates).eq('id', userId);
    await supabase.from('leads')
      .update({ status: 'converted' })
      .eq('email', email)
      .eq('status', 'new');

  } catch (err) {
    console.warn('Lead sync skipped:', err.message);
  }
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
    // onAuthStateChange fires reliably for ALL cases:
    // - INITIAL_SESSION (page load, OAuth redirect return)
    // - SIGNED_IN (email/password login)
    // - SIGNED_OUT
    // getSession() is only needed as a faster initial check
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const u = session?.user ?? null;

        // Resolve user immediately — this unblocks the loading state
        setUser(u);

        if (u) {
          // Fire lead sync in background — do NOT await here
          if (!syncedRef.current) {
            syncedRef.current = true;
            syncLeadToProfile(u.id, u.email); // intentionally not awaited
          }
          // Fetch profile (fast — just a single row read)
          await fetchProfile(u.id);
        } else {
          setProfile(null);
          syncedRef.current = false;
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

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
    // Use provided userId or fall back to current user state
    // Avoids calling getUser() which can cause auth lock contention
    const id = userId || (user && user !== undefined ? user.id : null);
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
  };
}
