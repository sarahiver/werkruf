import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);
  if (user.app_metadata?.role !== 'admin') return json({ error: 'Forbidden' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [profiles, accounts, locations, jobs, emails, events, authUsers] = await Promise.all([
      admin.from('user_profiles').select('*').order('created_at', { ascending: false }).limit(100),
      admin.from('google_accounts').select('user_id,status,last_error_code,last_error_at,connected_at,updated_at,deleted_at').order('updated_at', { ascending: false }),
      admin.from('google_locations').select('user_id,last_synced_at,review_count,deleted_at').order('last_synced_at', { ascending: false }),
      admin.from('sync_jobs').select('user_id,status,job_type,error_code,error_message,finished_at,updated_at,attempts,max_attempts').order('updated_at', { ascending: false }).limit(1000),
      admin.from('email_queue').select('user_id,status,template,error_code,error_message,scheduled_for,sent_at,updated_at,attempts,max_attempts').order('updated_at', { ascending: false }).limit(1000),
      admin.from('events').select('user_id,lifecycle').in('lifecycle', ['new', 'seen', 'opened']).limit(5000),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const dbResults = [profiles, accounts, locations, jobs, emails, events];
    const failed = dbResults.find((result) => result.error);
    if (failed?.error) throw failed.error;
    if (authUsers.error) throw authUsers.error;

    const firstByUser = <T extends { user_id: string | null }>(rows: T[] = []) => {
      const map = new Map<string, T>();
      rows.forEach((row) => { if (row.user_id && !map.has(row.user_id)) map.set(row.user_id, row); });
      return map;
    };
    const accountByUser = firstByUser(accounts.data || []);
    const locationByUser = firstByUser((locations.data || []).filter((row) => !row.deleted_at));
    const jobByUser = firstByUser(jobs.data || []);
    const jobErrorByUser = firstByUser((jobs.data || []).filter((row) => row.error_code));
    const mailByUser = firstByUser(emails.data || []);
    const emailByUser = new Map(authUsers.data.users.map((authUser) => [authUser.id, authUser.email || null]));
    const actionCounts = new Map<string, number>();
    (events.data || []).forEach(({ user_id }) => actionCounts.set(user_id, (actionCounts.get(user_id) || 0) + 1));

    const customers = await Promise.all((profiles.data || []).map(async (profile) => {
      const account = accountByUser.get(profile.id) || null;
      const location = locationByUser.get(profile.id) || null;
      const sync = jobByUser.get(profile.id) || null;
      const syncError = jobErrorByUser.get(profile.id) || null;
      const mail = mailByUser.get(profile.id) || null;
      const { data: health } = await admin.rpc('compute_health_score', { p_user_id: profile.id });
      return {
        id: profile.id,
        companyName: profile.company_name,
        email: emailByUser.get(profile.id) || null,
        createdAt: profile.created_at,
        plan: profile.plan,
        stripeStatus: profile.stripe_subscription_status,
        trialStartedAt: profile.trial_started_at,
        trialEndsAt: profile.trial_ends_at,
        googleStatus: account?.deleted_at ? 'disconnected' : (account?.status || 'not_connected'),
        lastGoogleSyncAt: location?.last_synced_at || (sync?.status === 'succeeded' ? sync.finished_at : null),
        lastSyncError: syncError ? { code: syncError.error_code, message: syncError.error_message, at: syncError.updated_at, jobType: syncError.job_type } :
          account?.last_error_code ? { code: account.last_error_code, message: null, at: account.last_error_at, jobType: 'oauth' } : null,
        healthScore: typeof health?.score === 'number' ? health.score : null,
        reviewCount: typeof health?.reviewsTotal === 'number' ? health.reviewsTotal : (location?.review_count || 0),
        openActions: actionCounts.get(profile.id) || 0,
        lastMail: mail,
      };
    }));

    return json({ customers, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[admin-ops] load failed', error);
    return json({ error: 'Admin-Ops-Daten konnten nicht geladen werden' }, 500);
  }
});
