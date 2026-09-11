// supabase/functions/cloudinary-sign-upload/index.ts
//
// Erzeugt serverseitig eine Cloudinary-Upload-Signatur. Der Client
// laedt direkt zu Cloudinary hoch, aber nur mit Parametern, die der
// Server freigegeben hat. Der API-Secret verlaesst den Server nie.
//
// Unveraendert aus dem Dashboard uebernommen am 11.09.2026.
//
// Benoetigte Secrets:
//   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sha1Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data    = encoder.encode(message);
  const hash    = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

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

    /* ── Signierte Upload-Parameter ──
       Der Ordner enthaelt die User-ID: ein Nutzer kann nicht in den
       Ordner eines anderen hochladen. */
    const apiSecret   = Deno.env.get('CLOUDINARY_API_SECRET')!;
    const apiKey      = Deno.env.get('CLOUDINARY_API_KEY')!;
    const cloudName   = Deno.env.get('CLOUDINARY_CLOUD_NAME')!;

    const timestamp   = Math.round(Date.now() / 1000);
    const folder      = `werkruf/profiles/${user.id}`;

    // Muss exakt dem entsprechen, was der Client sendet.
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}&transformation=f_auto,q_auto`;

    const signature = await sha1Hex(paramsToSign + apiSecret);

    return new Response(
      JSON.stringify({
        signature,
        timestamp,
        apiKey,
        cloudName,
        folder,
        transformation: 'f_auto,q_auto',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[cloudinary-sign-upload] Error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
