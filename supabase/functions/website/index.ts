// supabase/functions/website/index.ts
//
// Website aus dem Google-Profil (Branch feat/website-aus-google-profil).
//
// Eigene Function, damit sie vom Branch aus deployt werden kann, ohne
// google-business oder eine andere bestehende Function anzufassen.
//
// Routen
//   POST /website/laden            Sitzung · Einstellungen + Vorschau
//   POST /website/speichern        Sitzung · Einstellungen speichern + Vorschau
//   POST /website/texte            Sitzung · KI-Vorschlag (nur Vorschlag)
//   POST /website/veroeffentlichen Sitzung · an/aus
//   GET  /website/seite            oeffentlich · {status, html} fuer api/website.js
//
// Warum die oeffentliche Seite JSON liefert und kein HTML: Supabase
// liefert text/html aus Functions als text/plain aus (Schutz gegen
// Phishing). Vercel (api/website.js) holt das JSON und antwortet mit
// text/html.
//
// Rechte: Client → diese Function → service_role. Jede Abfrage filtert
// selbst auf user_id, weil die Service Role RLS umgeht. Die oeffentliche
// Route zeigt nur veroeffentlichte Websites von Konten mit Zugang.
//
// Logs: nie Texte, Impressum-Angaben, URLs oder Tokens.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { leseAccess } from '../../../src/utils/accessGate.js';
import {
  baueModell, renderSeite, startWerte, pruefeWebsiteEingabe, pruefeImpressum, slugAus, slugGueltig,
  websiteTextSystem, websiteTextAnfrage, pruefeWebsiteTexte, gewerkAus, adresseAus, einzugsgebietAus,
  VORSCHLAEGE_PRO_TAG,
} from '../../../src/utils/website.js';

const FUNCTION_SLUG = 'website';
const MODELL = 'claude-haiku-4-5';

/* ── Fehler ── */
class WebsiteFehler extends Error {
  constructor(public code: string, public status: number, public anzeigbar = false) { super(code); }
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new WebsiteFehler('config_error', 500);
  return v;
}

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/* ── HTTP ── */
function erlaubteOrigins(): string[] {
  return (Deno.env.get('WEBSITE_ALLOWED_ORIGINS') || Deno.env.get('GBP_ALLOWED_ORIGINS') || '')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
}

/** Vorschau-Deployments auf Vercel (Branch) duerfen das Dashboard nutzen. */
function originErlaubt(origin: string): boolean {
  const o = origin.replace(/\/$/, '');
  if (erlaubteOrigins().includes(o)) return true;
  const muster = Deno.env.get('WEBSITE_PREVIEW_ORIGIN_PATTERN'); // z. B. ^https://werkruf-[a-z0-9-]+\.vercel\.app$
  if (!muster) return false;
  try { return new RegExp(muster).test(o); } catch { return false; }
}

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const passt = origin && originErlaubt(origin);
  return {
    'Access-Control-Allow-Origin': passt ? origin : (erlaubteOrigins()[0] || 'https://werkruf.com'),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request: Request, body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(request), 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}

async function leseJson<T>(request: Request): Promise<Partial<T>> {
  const text = await request.text();
  if (text.length > 50_000) throw new WebsiteFehler('zu_gross', 413);
  if (!text) return {};
  try {
    const d = JSON.parse(text);
    return d && typeof d === 'object' ? d : {};
  } catch { throw new WebsiteFehler('bad_request', 400); }
}

/* ── Zugriff ── */
async function requireUser(request: Request): Promise<{ id: string }> {
  const header = request.headers.get('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new WebsiteFehler('unauthenticated', 401);
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) throw new WebsiteFehler('unauthenticated', 401);
  return { id: data.user.id };
}

async function requireZugang(userId: string): Promise<void> {
  let r;
  try { r = await leseAccess(admin(), userId); } catch { throw new WebsiteFehler('internal_error', 500); }
  if (!r.erlaubt) throw new WebsiteFehler('kein_zugang', 402, true);
}

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>;

async function eigenerStandort(locationId: unknown, userId: string): Promise<Zeile> {
  if (typeof locationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(locationId)) throw new WebsiteFehler('bad_request', 400);
  const { data, error } = await admin().from('google_locations')
    .select('id, account_id, user_id, title, primary_phone, locality, primary_category, place_id, review_count, average_rating, google_profile')
    .eq('id', locationId).eq('user_id', userId).is('deleted_at', null).maybeSingle();
  if (error) throw new WebsiteFehler('internal_error', 500);
  if (!data) throw new WebsiteFehler('not_found', 404);
  // user_id allein ist keine Eigentuemerschaft: Verbindung muss ebenfalls dem Nutzer gehoeren.
  const { data: konto, error: kErr } = await admin().from('google_accounts').select('id')
    .eq('id', data.account_id).eq('user_id', userId).is('deleted_at', null).maybeSingle();
  if (kErr) throw new WebsiteFehler('internal_error', 500);
  if (!konto) throw new WebsiteFehler('not_found', 404);
  return data;
}

async function fotosVon(userId: string): Promise<{ id: string; url: string }[]> {
  const { data, error } = await admin().from('business_photos').select('id, cloudinary_url')
    .eq('profile_id', userId).order('created_at', { ascending: false }).limit(60);
  if (error) throw new WebsiteFehler('internal_error', 500);
  return (data ?? []).map((f: Zeile) => ({ id: f.id, url: f.cloudinary_url }));
}

async function bewertungenVon(locationId: string): Promise<Zeile[]> {
  const { data, error } = await admin().from('google_reviews')
    .select('reviewer_display_name, reviewer_is_anonymous, star_rating, comment, google_created_at')
    .eq('location_id', locationId).eq('status', 'active').not('comment', 'is', null)
    .order('google_created_at', { ascending: false }).limit(20);
  if (error) throw new WebsiteFehler('internal_error', 500);
  return data ?? [];
}

async function websiteVon(locationId: string, userId: string): Promise<Zeile | null> {
  const { data, error } = await admin().from('websites').select('*')
    .eq('location_id', locationId).eq('user_id', userId).maybeSingle();
  if (error) throw new WebsiteFehler('internal_error', 500);
  return data;
}

async function audit(userId: string, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
  try {
    await admin().from('audit_logs').insert({
      user_id: userId, actor_type: 'user', actor_id: userId, action,
      entity_type: 'website', entity_id: entityId, metadata,
    });
  } catch { console.warn(JSON.stringify({ scope: 'website', event: 'audit_fehlgeschlagen', action })); }
}

/** Freie Adresse: Wunsch aus dem Betriebsnamen, bei Kollision mit Ort, dann Zahl. */
async function freieAdresse(wunsch: string, ort: string, eigeneId: string | null): Promise<string> {
  const basis = slugAus(wunsch) || 'betrieb';
  const kandidaten = [basis, slugAus(`${basis}-${ort}`), ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${basis}-${n}`)]
    .filter((s) => s && slugGueltig(s));
  for (const s of kandidaten) {
    const { data, error } = await admin().from('websites').select('id').eq('slug', s).maybeSingle();
    if (error) throw new WebsiteFehler('internal_error', 500);
    if (!data || data.id === eigeneId) return s;
  }
  return `${basis.slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`;
}

/** Website-Zeile → Werte fuer Modell und Editor. */
function werteAus(w: Zeile | null, location: Zeile): Zeile {
  if (!w) return startWerte({ location, profil: location.google_profile || {} });
  return {
    farbe: w.farbe, slogan: w.slogan, ueber_text: w.ueber_text, leistungen: w.leistungen ?? [],
    kontakt_email: w.kontakt_email ?? '', logo_url: w.logo_url, titelbild_id: w.titelbild_id,
    fotos_aus: w.fotos_aus ?? [], bewertungen_zeigen: w.bewertungen_zeigen, impressum: w.impressum ?? {},
  };
}

async function vorschau(location: Zeile, werte: Zeile, userId: string, pfad = '/') {
  const [fotos, bewertungen] = await Promise.all([fotosVon(userId), bewertungenVon(location.id)]);
  const modell = baueModell({ location, website: werte, fotos, bewertungen });
  return { html: renderSeite(modell, pfad, { vorschau: true }).html, fotos };
}

/* ── Routen ── */

async function laden(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await requireZugang(user.id);
  const body = await leseJson<{ locationId: string; pfad: string }>(request);
  const location = await eigenerStandort(body.locationId, user.id);
  const w = await websiteVon(location.id, user.id);
  const werte = werteAus(w, location);
  const pfad = ['/', '/impressum', '/datenschutz'].includes(String(body.pfad)) ? String(body.pfad) : '/';
  const { html, fotos } = await vorschau(location, werte, user.id, pfad);
  return json(request, {
    ok: true,
    website: { werte, slug: w?.slug ?? null, status: w?.status ?? 'entwurf', veroeffentlichtAm: w?.veroeffentlicht_am ?? null, gespeichert: Boolean(w) },
    fotos,
    impressum: pruefeImpressum(werte.impressum),
    vorschau: html,
  });
}

async function speichern(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await requireZugang(user.id);
  const body = await leseJson<{ locationId: string; werte: Zeile; pfad: string }>(request);
  const location = await eigenerStandort(body.locationId, user.id);
  const fotos = await fotosVon(user.id);
  const p = pruefeWebsiteEingabe(body.werte, { userId: user.id, fotoIds: fotos.map((f) => f.id) }) as { ok: boolean; grund?: string; feld?: string; werte?: Zeile };
  if (!p.ok || !p.werte) return json(request, { ok: false, grund: p.grund, feld: p.feld }, 422);
  const v = p.werte;

  const vorhanden = await websiteVon(location.id, user.id);
  const zeile = {
    farbe: v.farbe, slogan: v.slogan, ueber_text: v.ueber_text, leistungen: v.leistungen,
    kontakt_email: v.kontakt_email || null, logo_url: v.logo_url, titelbild_id: v.titelbild_id,
    fotos_aus: v.fotos_aus, bewertungen_zeigen: v.bewertungen_zeigen, impressum: v.impressum,
    updated_at: new Date().toISOString(),
  };
  const impressum = pruefeImpressum(v.impressum);
  let w: Zeile;
  if (vorhanden) {
    // Veroeffentlicht + Impressum jetzt unvollstaendig: nicht speichern, statt eine Seite ohne Pflichtangaben auszuliefern.
    if (vorhanden.status === 'veroeffentlicht' && !impressum.ok) return json(request, { ok: false, grund: 'impressum', impressum }, 422);
    const { data, error } = await admin().from('websites').update(zeile)
      .eq('id', vorhanden.id).eq('user_id', user.id).select('*').single();
    if (error) throw new WebsiteFehler('internal_error', 500);
    w = data;
  } else {
    const slug = await freieAdresse(location.title || v.impressum?.firma || '', adresseAus(location, location.google_profile)?.ort || location.locality || '', null);
    const { data, error } = await admin().from('websites')
      .insert({ ...zeile, user_id: user.id, location_id: location.id, slug }).select('*').single();
    if (error) throw new WebsiteFehler(error.code === '23505' ? 'slug' : 'internal_error', error.code === '23505' ? 409 : 500, true);
    w = data;
  }
  const pfad = ['/', '/impressum', '/datenschutz'].includes(String(body.pfad)) ? String(body.pfad) : '/';
  const vs = await vorschau(location, werteAus(w, location), user.id, pfad);
  return json(request, { ok: true, slug: w.slug, status: w.status, impressum, vorschau: vs.html });
}

async function texte(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await requireZugang(user.id);
  const body = await leseJson<{ locationId: string; leistungen: { name: string }[] }>(request);
  const location = await eigenerStandort(body.locationId, user.id);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json(request, { ok: false, grund: 'nicht_konfiguriert' });

  const { data: limit, error: lErr } = await admin().rpc('check_rate_limit', {
    p_key: `website-texte:${user.id}`, p_limit: VORSCHLAEGE_PRO_TAG, p_window: '1 day',
  });
  if (lErr) throw new WebsiteFehler('internal_error', 500);
  if (!(limit as { allowed?: boolean })?.allowed) return json(request, { ok: false, grund: 'limit' });

  const profil = location.google_profile || {};
  const namen = (Array.isArray(body.leistungen) ? body.leistungen : [])
    .map((l) => (typeof l?.name === 'string' ? l.name.trim().slice(0, 60) : '')).filter(Boolean).slice(0, 12);
  let antwort: Response;
  try {
    antwort = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELL, max_tokens: 1800, temperature: 0.4,
        system: websiteTextSystem(),
        messages: [{ role: 'user', content: websiteTextAnfrage({
          betrieb: (location.title ?? '').trim(),
          gewerk: gewerkAus(location, profil),
          ort: adresseAus(location, profil)?.ort || location.locality || '',
          beschreibung: profil?.profile?.description || '',
          leistungen: namen.map((name) => ({ name })),
          einzugsgebiet: einzugsgebietAus(profil),
        }) }],
      }),
    });
  } catch {
    console.warn(JSON.stringify({ scope: 'website', event: 'ki_nicht_erreichbar' }));
    return json(request, { ok: false, grund: 'nicht_konfiguriert' });
  }
  if (!antwort.ok) {
    console.warn(JSON.stringify({ scope: 'website', event: 'ki_fehler', status: antwort.status }));
    return json(request, { ok: false, grund: 'nicht_konfiguriert' });
  }
  const d = await antwort.json() as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
  const roh = d.stop_reason === 'max_tokens' ? '' : (d.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const p = pruefeWebsiteTexte(roh, namen) as { ok: boolean; grund?: string };
  await audit(user.id, 'website.texte_vorgeschlagen', location.id, { ok: p.ok });
  return json(request, p.ok ? p : { ok: false, grund: 'ungeeignet' });
}

async function veroeffentlichen(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await requireZugang(user.id);
  const body = await leseJson<{ locationId: string; an: boolean }>(request);
  const location = await eigenerStandort(body.locationId, user.id);
  const w = await websiteVon(location.id, user.id);
  if (!w) return json(request, { ok: false, grund: 'nicht_gespeichert' }, 409);
  const an = body.an !== false;
  if (an) {
    const impressum = pruefeImpressum(w.impressum);
    if (!impressum.ok) return json(request, { ok: false, grund: 'impressum', impressum }, 422);
  }
  const { error } = await admin().from('websites').update({
    status: an ? 'veroeffentlicht' : 'entwurf',
    veroeffentlicht_am: an ? (w.veroeffentlicht_am ?? new Date().toISOString()) : w.veroeffentlicht_am,
    updated_at: new Date().toISOString(),
  }).eq('id', w.id).eq('user_id', user.id);
  if (error) throw new WebsiteFehler('internal_error', 500);
  await audit(user.id, an ? 'website.veroeffentlicht' : 'website.zurueckgezogen', w.id);
  return json(request, { ok: true, status: an ? 'veroeffentlicht' : 'entwurf', slug: w.slug });
}

/** Oeffentlich. Nur veroeffentlichte Websites von Konten mit Zugang. */
async function seite(request: Request, url: URL): Promise<Response> {
  const slug = url.searchParams.get('slug') || '';
  const pfad = (url.searchParams.get('pfad') || '/').slice(0, 100);
  const basis = `/seite/${slug}`;
  const nichtDa = () => json(request, { status: 404, html: null }, 200, 'public, max-age=60');
  if (!slugGueltig(slug)) return nichtDa();

  const { data: w, error } = await admin().from('websites').select('*')
    .eq('slug', slug).eq('status', 'veroeffentlicht').maybeSingle();
  if (error) throw new WebsiteFehler('internal_error', 500);
  if (!w) return nichtDa();
  const zugang = await leseAccess(admin(), w.user_id).catch(() => ({ erlaubt: false }));
  if (!zugang.erlaubt) return nichtDa();

  const { data: location, error: lErr } = await admin().from('google_locations')
    .select('id, title, primary_phone, locality, primary_category, place_id, review_count, average_rating, google_profile')
    .eq('id', w.location_id).eq('user_id', w.user_id).is('deleted_at', null).maybeSingle();
  if (lErr) throw new WebsiteFehler('internal_error', 500);
  if (!location) return nichtDa();
  const [fotos, bewertungen] = await Promise.all([fotosVon(w.user_id), bewertungenVon(location.id)]);
  const modell = baueModell({ location, website: w, fotos, bewertungen });
  if (!pruefeImpressum(modell.impressum).ok) return nichtDa();
  const kanonischBasis = `https://werkruf.com${basis}`;
  const r = renderSeite(modell, pfad, { basis, kanonischBasis });
  return json(request, { status: r.status, html: r.html }, 200, 'public, max-age=60');
}

const ROUTEN: Record<string, { method: 'GET' | 'POST'; handler: (r: Request, u: URL) => Promise<Response> }> = {
  laden: { method: 'POST', handler: laden },
  speichern: { method: 'POST', handler: speichern },
  texte: { method: 'POST', handler: texte },
  veroeffentlichen: { method: 'POST', handler: veroeffentlichen },
  seite: { method: 'GET', handler: seite },
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  const teile = url.pathname.split('/').filter(Boolean);
  const i = teile.lastIndexOf(FUNCTION_SLUG);
  const name = teile[i === -1 ? teile.length - 1 : i + 1] ?? '';
  const route = ROUTEN[name];
  if (!route) return json(request, { error: { code: 'not_found' } }, 404);
  if (request.method !== route.method) return json(request, { error: { code: 'bad_request' } }, 405);
  try {
    return await route.handler(request, url);
  } catch (err) {
    const f = err instanceof WebsiteFehler ? err : new WebsiteFehler('internal_error', 500);
    if (!(err instanceof WebsiteFehler)) console.error(JSON.stringify({ scope: 'website', route: name, event: 'unerwartet' }));
    return json(request, { error: { code: f.code, anzeigbar: f.anzeigbar } }, f.status);
  }
});
