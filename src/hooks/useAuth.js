import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   LEAD → PROFILE SYNC
   Called once on first login.
   Checks if user email exists in leads table
   and merges the data into user_profiles.
───────────────────────────────────────────── */
async function syncLeadToProfile(userId, email) {
  if (!userId || !email) return;

  try {
    // Check if profile already has a place_id (already synced)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('google_place_id, visibility_score')
      .eq('id', userId)
      .single();

    // Already has data — skip sync
    if (profile?.google_place_id) return;

    // Find most recent lead with this email
    const { data: lead } = await supabase
      .from('leads')
      .select('company_name, google_place_id, google_rating, google_review_count, visibility_score, city, industry_key')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lead) return;

    // Build update object — only set fields that have values
    const updates = {};
    if (lead.company_name)        updates.company_name        = lead.company_name;
    if (lead.google_place_id)     updates.google_place_id     = lead.google_place_id;
    if (lead.google_rating)       updates.google_rating       = lead.google_rating;
    if (lead.google_review_count) updates.google_review_count = lead.google_review_count;
    if (lead.visibility_score)    updates.visibility_score    = lead.visibility_score;
    if (lead.city)                updates.city                = lead.city;
    if (lead.industry_key)        updates.industry_key        = lead.industry_key;

    if (Object.keys(updates).length === 0) return;

    await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', userId);

    // Mark lead as converted
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('email', email)
      .eq('status', 'new');

  } catch (err) {
    // Non-blocking — silently fail
    console.warn('Lead sync skipped:', err.message);
  }
}

/* ─────────────────────────────────────────────
   useAuth
───────────────────────────────────────────── */
export function useAuth() {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Track if we've already synced this session to avoid duplicate calls
  const syncedRef = useRef(false);

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data || null);
    return data;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        // Sync lead data on initial session load
        if (!syncedRef.current) {
          syncedRef.current = true;
          await syncLeadToProfile(u.id, u.email);
        }
        await fetchProfile(u.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const u = session?.user ?? null;
        setUser(u);

        if (u) {
          // SIGNED_IN event = fresh login → trigger sync
          if (event === 'SIGNED_IN' && !syncedRef.current) {
            syncedRef.current = true;
            await syncLeadToProfile(u.id, u.email);
          }
          await fetchProfile(u.id);
        } else {
          setProfile(null);
          syncedRef.current = false;
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signInGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
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
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id);
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
