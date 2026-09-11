// supabase/functions/delete-account/index.ts
//
// DSGVO Art. 17 — Recht auf Loeschung:
// 1. Stripe-Abo kuendigen
// 2. Cloudinary-Fotos loeschen
// 3. Supabase-Nutzer loeschen (kaskadiert in alle Tabellen)
//
// Unveraendert aus dem Dashboard uebernommen am 11.09.2026.
//
// Benoetigte Secrets:
//   STRIPE_SECRET_KEY
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    /* ── Auth ── */
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const results: Record<string, string> = {};

    /* ── 1. Profil laden ── */
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .single();

    /* ── 2. Stripe-Abo kuendigen ── */
    if (profile?.stripe_subscription_id) {
      try {
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
          apiVersion: '2024-06-20',
          httpClient: Stripe.createFetchHttpClient(),
        });
        await stripe.subscriptions.cancel(profile.stripe_subscription_id);
        results.stripe = 'cancelled';
      } catch (err) {
        console.error('[delete-account] Stripe cancel error:', err);
        results.stripe = 'error: ' + err.message;
      }
    }

    /* ── 3. Cloudinary-Fotos loeschen ──
       business_photos hat profile_id, NICHT user_id. */
    const { data: photos } = await supabaseAdmin
      .from('business_photos')
      .select('public_id')
      .eq('profile_id', user.id);

    if (photos?.length) {
      try {
        const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME')!;
        const apiKey    = Deno.env.get('CLOUDINARY_API_KEY')!;
        const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET')!;

        for (const photo of photos) {
          const timestamp   = Math.round(Date.now() / 1000);
          const toSign      = `public_id=${photo.public_id}&timestamp=${timestamp}${apiSecret}`;
          const encoder     = new TextEncoder();
          const data        = encoder.encode(toSign);
          const hashBuffer  = await crypto.subtle.digest('SHA-1', data);
          const signature   = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('');

          const form = new FormData();
          form.append('public_id',  photo.public_id);
          form.append('api_key',    apiKey);
          form.append('timestamp',  String(timestamp));
          form.append('signature',  signature);

          await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
            { method: 'POST', body: form }
          );
        }
        results.cloudinary = `${photos.length} photos deleted`;
      } catch (err) {
        console.error('[delete-account] Cloudinary error:', err);
        results.cloudinary = 'error: ' + err.message;
      }
    }

    /* ── 4. Nutzer loeschen (kaskadiert) ── */
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    results.account = 'deleted';

    console.log('[delete-account] Account deleted:', user.id, results);

    return new Response(
      JSON.stringify({ ok: true, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[delete-account] Fatal error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
