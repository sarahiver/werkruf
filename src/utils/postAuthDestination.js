import supabase from '../supabaseClient';

/** Central post-login routing decision based on the authenticated GBP status. */
export async function getPostAuthDestination(fallback = '/dashboard/google') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return '/login';
  try {
    const response = await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/status`,
      { headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      } },
    );
    if (!response.ok) return fallback;
    const payload = await response.json();
    return payload?.connected ? '/dashboard' : '/dashboard/google';
  } catch {
    // Never bounce an authenticated user to a public route on a status outage.
    return fallback;
  }
}
