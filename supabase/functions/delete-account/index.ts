// supabase/functions/delete-account/index.ts
//
// Konto loeschen — sofort und endgueltig.
//
// ═══════════════════════════════════════════════════════════════
// WAS HIER PASSIERT, IN DIESER REIHENFOLGE
// ═══════════════════════════════════════════════════════════════
//
//   0. Wer ruft? Token serverseitig pruefen.
//   1. Stripe-Abo kuendigen — idempotent, Fehler bricht ab.
//   2. Google-Berechtigung widerrufen (ueber google-business/disconnect).
//   3. Cloudinary-Kopien der Fotos loeschen.
//   4. auth.admin.deleteUser — die Datenbank kaskadiert und
//      anonymisiert (20261019130000). Scheitert DAS, steht ein
//      Stoerfall in account_deletion_incidents, und der Nutzer
//      bekommt KEIN "geloescht" zu sehen.
//   5. Abschiedsmail einreihen — NACH dem Loeschen, damit sie nur
//      sagt, was wirklich passiert ist. email_queue hat keinen
//      Fremdschluessel auf den Nutzer; die Zeile braucht ihn nicht.
//
// ═══════════════════════════════════════════════════════════════
// WARUM STRIPE ZUERST UND WARUM EIN STRIPE-FEHLER ABBRICHT
// ═══════════════════════════════════════════════════════════════
//
// Nach deleteUser ist die Customer-ID aus der Datenbank verschwunden.
// Stripe muss also davor dran. Daraus folgt das Restrisiko, dass das
// Abo gekuendigt ist und die Loeschung danach doch scheitert — genau
// der Zustand vom 19.10., als die Append-only-Trigger die Kaskade
// blockierten. Zwei Dinge halten es klein: Die Datenbankseite ist
// seitdem mit Gegenproben gemessen (kontoloeschung*.test.sql), und
// wenn es trotzdem passiert, entsteht ein Stoerfall mit Stripe-Bezug
// statt einer Logzeile.
//
// Bricht Stripe ab (Netz, Schluessel, unbekanntes Abo), passiert
// NICHTS weiter: keine Mail, kein Revoke, keine Fotos, kein Delete.
// Der Nutzer sieht eine klare Meldung und kann es spaeter erneut
// versuchen. Ein bereits gekuendigtes Abo (Status canceled) zaehlt
// als Erfolg — sonst scheitert jeder zweite Versuch an seinem ersten.
//
// ═══════════════════════════════════════════════════════════════
// WAS NICHT PASSIERT
// ═══════════════════════════════════════════════════════════════
//
// Keine Erstattung des bezahlten Restzeitraums (Produktentscheidung
// vom 22.10.2026, Legal Review separat). Keine Aenderung am Google-
// Unternehmensprofil — widerrufen wird nur WERKRUFs Berechtigung.
// Kein Token, kein Secret in Logs oder Stoerfaellen.
//
// Benoetigte Secrets:
//   STRIPE_SECRET_KEY
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (Weitergabe an google-business)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Stage = 'stripe' | 'database' | 'google' | 'cloudinary' | 'mail';

interface Profil {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  company_name: string | null;
  full_name: string | null;
  industry_key: string | null;
}

function antwort(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function umgebung(name: string): string {
  const wert = Deno.env.get(name);
  if (!wert) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return wert;
}

/* Fehlermeldungen koennen Tokens oder Header enthalten (Stripe
   wiederholt z. B. den Request). Kurz halten, nichts anhaengen. */
function kurz(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_***').slice(0, 500);
}

function fehlerCode(err: unknown): string | null {
  const e = err as { code?: unknown; type?: unknown; statusCode?: unknown } | null;
  if (e && typeof e.code === 'string') return e.code;
  if (e && typeof e.type === 'string') return e.type;
  if (e && typeof e.statusCode === 'number') return `http_${e.statusCode}`;
  return null;
}

/* ── Stoerfall festhalten ──
   Scheitert selbst das, bleibt wenigstens console.error — aber das
   ist der einzige Fall, in dem ein Log die letzte Instanz ist. */
async function stoerfall(
  admin: SupabaseClient,
  eintrag: {
    userId: string; email: string | null; stage: Stage; err: unknown;
    profil: Profil | null; stripeCancelled: boolean; context?: Record<string, unknown>;
  },
): Promise<string | null> {
  const zeile = {
    user_id:                eintrag.userId,
    email:                  eintrag.email,
    stage:                  eintrag.stage,
    error_code:             fehlerCode(eintrag.err),
    error_message:          kurz(eintrag.err),
    stripe_customer_id:     eintrag.profil?.stripe_customer_id ?? null,
    stripe_subscription_id: eintrag.profil?.stripe_subscription_id ?? null,
    stripe_cancelled:       eintrag.stripeCancelled,
    context:                eintrag.context ?? {},
  };
  const { data, error } = await admin
    .from('account_deletion_incidents').insert(zeile).select('id').single();
  if (error) {
    console.error(JSON.stringify({ scope: 'delete-account', event: 'incident_write_failed',
      stage: eintrag.stage, userId: eintrag.userId, code: error.code }));
    return null;
  }
  console.error(JSON.stringify({ scope: 'delete-account', event: 'incident',
    stage: eintrag.stage, userId: eintrag.userId, incidentId: data.id }));
  return data.id as string;
}

/* ── 1. Stripe — idempotent ── */
async function stripeKuendigen(subscriptionId: string): Promise<'cancelled' | 'already_cancelled'> {
  const stripe = new Stripe(umgebung('STRIPE_SECRET_KEY'), {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
  const abo = await stripe.subscriptions.retrieve(subscriptionId);
  if (abo.status === 'canceled') return 'already_cancelled';
  await stripe.subscriptions.cancel(subscriptionId);
  return 'cancelled';
}

/* ── 2. Google-Berechtigung widerrufen ──
   Nicht selbst entschluesseln und widerrufen: google-business kann
   das schon, mit Eigentumspruefung, Schluesselrotation und
   markConnectionUnusable. Hier nur aufrufen — mit dem Token des
   Nutzers, damit die Eigentumspruefung dort greift. */
async function googleWiderrufen(authHeader: string): Promise<{ versucht: number; widerrufen: number }> {
  const basis = `${umgebung('SUPABASE_URL')}/functions/v1/google-business`;
  const headers = { Authorization: authHeader, apikey: umgebung('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' };

  const status = await fetch(`${basis}/status`, { headers });
  if (!status.ok) throw new Error(`google-business/status antwortete ${status.status}`);
  const { connections } = await status.json() as { connections?: Array<{ id: string; status: string }> };
  const kandidaten = (connections ?? []).filter((c) => c.status !== 'disconnected');

  let widerrufen = 0;
  for (const c of kandidaten) {
    const r = await fetch(`${basis}/disconnect`, {
      method: 'POST', headers, body: JSON.stringify({ connectionId: c.id }),
    });
    if (r.ok) {
      const j = await r.json() as { revokedAtGoogle?: boolean };
      if (j.revokedAtGoogle) widerrufen += 1;
    }
  }
  return { versucht: kandidaten.length, widerrufen };
}

/* ── 3. Cloudinary ── */
async function cloudinaryLoeschen(admin: SupabaseClient, userId: string): Promise<number> {
  const { data: photos } = await admin
    .from('business_photos').select('public_id').eq('profile_id', userId);
  if (!photos?.length) return 0;

  const cloudName = umgebung('CLOUDINARY_CLOUD_NAME');
  const apiKey    = umgebung('CLOUDINARY_API_KEY');
  const apiSecret = umgebung('CLOUDINARY_API_SECRET');
  let geloescht = 0;

  for (const photo of photos) {
    const timestamp  = Math.round(Date.now() / 1000);
    const toSign     = `public_id=${photo.public_id}&timestamp=${timestamp}${apiSecret}`;
    const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign));
    const signature  = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const form = new FormData();
    form.append('public_id', photo.public_id);
    form.append('api_key',   apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: 'POST', body: form });
    if (r.ok) geloescht += 1;
  }
  return geloescht;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return antwort({ error: 'Methode nicht erlaubt' }, 405);

  try {
    /* ── 0. Auth ──
       Dasselbe Muster wie admin-ops seit 22.10.: Token serverseitig
       mit dem Service-Role-Client pruefen. Der Anon-Client mit
       weitergereichtem Header scheiterte an ES256-Tokens. */
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return antwort({ error: 'Nicht angemeldet' }, 401);
    const token = authHeader.slice(7).trim();

    const admin = createClient(umgebung('SUPABASE_URL'), umgebung('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth?.user) {
      console.warn(JSON.stringify({ scope: 'delete-account', event: 'auth_abgelehnt', code: authError?.code ?? null }));
      return antwort({ error: 'Nicht angemeldet' }, 401);
    }
    const user = auth.user;
    const email = user.email ?? null;

    const { data: profil } = await admin
      .from('user_profiles')
      .select('stripe_customer_id, stripe_subscription_id, company_name, full_name, industry_key')
      .eq('id', user.id)
      .maybeSingle<Profil>();

    const results: Record<string, unknown> = {};
    let stripeCancelled = false;

    /* ── 1. Stripe ── */
    if (profil?.stripe_subscription_id) {
      try {
        results.stripe = await stripeKuendigen(profil.stripe_subscription_id);
        stripeCancelled = true;
      } catch (err) {
        const incidentId = await stoerfall(admin, {
          userId: user.id, email, stage: 'stripe', err, profil, stripeCancelled: false,
        });
        return antwort({
          error: 'Dein Abo konnte bei unserem Zahlungsdienst nicht gekündigt werden. Dein Konto wurde NICHT gelöscht und nichts verändert. Bitte versuche es in ein paar Minuten erneut; wir sind informiert.',
          code: 'stripe_failed', incidentId, deleted: false,
        }, 502);
      }
    } else {
      results.stripe = 'no_subscription';
    }

    /* ── 2. Google ── nicht blockierend, aber nicht still */
    try {
      results.google = await googleWiderrufen(authHeader);
    } catch (err) {
      results.google = 'failed';
      await stoerfall(admin, { userId: user.id, email, stage: 'google', err, profil, stripeCancelled });
    }

    /* ── 3. Cloudinary ── nicht blockierend */
    try {
      results.cloudinary = await cloudinaryLoeschen(admin, user.id);
    } catch (err) {
      results.cloudinary = 'failed';
      await stoerfall(admin, { userId: user.id, email, stage: 'cloudinary', err, profil, stripeCancelled });
    }

    /* ── 4. Datenbank ── */
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      const incidentId = await stoerfall(admin, {
        userId: user.id, email, stage: 'database', err: deleteError, profil, stripeCancelled,
        context: { results },
      });
      return antwort({
        error: stripeCancelled
          ? 'Dein Abo wurde gekündigt, aber das Konto konnte nicht gelöscht werden. Wir sind informiert und melden uns bei dir — du musst nichts weiter tun.'
          : 'Das Konto konnte nicht gelöscht werden. Wir sind informiert und melden uns bei dir.',
        code: 'delete_failed', incidentId, deleted: false,
      }, 500);
    }
    results.account = 'deleted';

    /* ── 5. Abschiedsmail einreihen — nach dem Loeschen ──
       user_id null: den Nutzer gibt es nicht mehr. Scheitert das
       Einreihen, ist das Konto trotzdem weg — die Mail ist
       Hoeflichkeit, die Loeschung das Recht des Nutzers. Der
       Stoerfall sorgt dafuer, dass jemand es sieht. */
    if (email) {
      const { data: mailId, error: mailError } = await admin.rpc('enqueue_email', {
        p_template:    'account_deleted',
        p_to_email:    email,
        p_dedupe_key:  `account_deleted:${user.id}`,
        p_user_id:     null,
        p_to_name:     profil?.full_name ?? profil?.company_name ?? null,
        p_payload:     {
          companyName: profil?.company_name ?? null,
          industryKey: profil?.industry_key ?? 'handwerk',
          stripeCancelled,
          deletedAt: new Date().toISOString(),
        },
      });
      results.mail = mailError ? 'failed' : (mailId ? 'queued' : 'duplicate');
      if (mailError) {
        await stoerfall(admin, { userId: user.id, email, stage: 'mail', err: mailError, profil, stripeCancelled });
      }
    } else {
      results.mail = 'no_email';
    }


    console.log(JSON.stringify({ scope: 'delete-account', event: 'deleted', userId: user.id, results }));
    return antwort({ ok: true, deleted: true, results });

  } catch (err) {
    console.error(JSON.stringify({ scope: 'delete-account', event: 'fatal', message: kurz(err) }));
    return antwort({ error: 'Unerwarteter Fehler. Das Konto wurde nicht gelöscht.', deleted: false }, 500);
  }
});
