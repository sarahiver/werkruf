/* ═══════════════════════════════════════════════════════════════════════════
   GOOGLE BUSINESS PROFILE — OAUTH-INTEGRATION
   Einzeldatei-Fassung für den Supabase-Dashboard-Editor.

   Eine Function, fünf Routen:
     POST /functions/v1/google-business/connect      → Autorisierungs-URL
     GET  /functions/v1/google-business/callback     → Rückkehr von Google
     GET  /functions/v1/google-business/status       → Verbindungszustand
     POST /functions/v1/google-business/disconnect   → Trennen + Widerruf
     GET  /functions/v1/google-business/accounts     → Konten & Standorte

   ⚠️  "Verify JWT" MUSS für diese Function AUS sein.
       Grund: Google redirectet den Browser auf /callback, ohne
       Authorization-Header. Die Plattformprüfung würde das mit 401
       abweisen, bevor unser Code läuft.

       Das ist KEIN Sicherheitsverlust: requireUser() prüft das
       Bearer-Token auf allen anderen Routen selbst gegen Supabase Auth.
       Der Callback braucht keinen Header — sein Schutz ist der state:
       256 Bit Zufall, serverseitig gespeichert, single-use, 10 Min gültig.

   ⚠️  Der Dashboard-Editor kennt keine Versionierung. Diese Datei im
       Repo pflegen, das Dashboard ist nur die Ablage.
═══════════════════════════════════════════════════════════════════════════ */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

/* ═══════════════════════════════════════════════════════════════
   1 — TYPEN
═══════════════════════════════════════════════════════════════ */

export type ConnectionStatus =
  | 'pending'   // Tokens da, aber noch nicht vom eingeloggten Nutzer bestätigt
  | 'active' | 'needs_reauth' | 'revoked' | 'disconnected';

/** Zeile aus oauth_tokens — enthält die verschlüsselten Tokens. */
interface TokenRow {
  id: string;
  account_id: string;
  user_id: string;
  refresh_token_encrypted: string | null;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  encryption_key_id: string | null;
  granted_scopes: string[];
  last_refreshed_at: string | null;
  refresh_failure_count: number;
  last_error_code: string | null;
  last_error_at: string | null;
}

/** Zeile aus google_accounts — bewusst OHNE Tokens. */
interface AccountRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  provider_email: string | null;
  granted_scopes: string[];
  status: ConnectionStatus;
  last_refreshed_at: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
  refresh_failure_count: number;
  connected_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Konto samt Tokens. PostgREST liefert die eingebettete Relation als
 * Array oder Objekt, je nach Kardinalität — normalizeTokens() glättet
 * das zu einem einzelnen Wert oder null.
 */
interface ConnectionRow extends AccountRow {
  tokens: TokenRow | null;
}

interface OAuthStateRow {
  nonce: string;
  user_id: string;
  code_verifier: string;
  return_to: string;
  connection_id: string | null;
  created_at: string;
  expires_at: string;
}

interface PublicConnection {
  id: string;
  googleAccountEmail: string | null;
  status: ConnectionStatus;
  grantedScopes: string[];
  connectedAt: string;
  lastRefreshedAt: string | null;
  needsAction: boolean;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
  refresh_token?: string;
  id_token?: string;
}

interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  aud: string;
  iss: string;
  exp: number;
}

interface AccessTokenResult {
  accessToken: string;
  expiresAt: string;
  connectionId: string;
  refreshed: boolean;
}

interface GbpAccount {
  name: string;
  accountName?: string;
  type?: string;
  verificationState?: string;
}

interface GbpLocation {
  name: string;
  title?: string;
  storefrontAddress?: Record<string, unknown>;
  phoneNumbers?: { primaryPhone?: string };
  websiteUri?: string;
  categories?: { primaryCategory?: { displayName?: string } };
  metadata?: { placeId?: string };
}

/* ── Reviews (Legacy-v4-API, siehe Abschnitt 10) ── */

interface GbpReviewer {
  displayName?: string;
  profilePhotoUrl?: string;
  isAnonymous?: boolean;
}

type GbpStarRating = 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';

interface GbpReviewReply {
  comment: string;
  updateTime?: string;
}

interface GbpReview {
  /** "accounts/{a}/locations/{l}/reviews/{r}" */
  name: string;
  reviewId?: string;
  reviewer?: GbpReviewer;
  starRating?: GbpStarRating;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: GbpReviewReply;
}

interface GbpReviewsResponse {
  reviews?: GbpReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

interface GbpAccountsResponse {
  accounts?: GbpAccount[];
  nextPageToken?: string;
}

interface GbpLocationsResponse {
  locations?: GbpLocation[];
  nextPageToken?: string;
}

/** Felder, die updateLocation() schreiben darf. */
interface GbpLocationPatch {
  title?: string;
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  websiteUri?: string;
  regularHours?: unknown;
  profile?: { description?: string };
  categories?: unknown;
  storefrontAddress?: unknown;
}

/* ═══════════════════════════════════════════════════════════════
   2 — FEHLER
═══════════════════════════════════════════════════════════════ */

type GbpErrorCode =
  | 'config_error' | 'encryption_error' | 'unauthenticated'
  | 'invalid_state' | 'state_expired' | 'oauth_denied'
  | 'exchange_failed' | 'missing_refresh_token' | 'insufficient_scope'
  | 'not_connected' | 'reauth_required'
  | 'refresh_failed' | 'google_api_error' | 'rate_limited'
  | 'bad_request' | 'not_found' | 'internal_error';

const DEFAULT_STATUS: Record<GbpErrorCode, number> = {
  config_error: 500, encryption_error: 500, unauthenticated: 401,
  invalid_state: 400, state_expired: 400, oauth_denied: 400,
  exchange_failed: 502, missing_refresh_token: 400, insufficient_scope: 403,
  not_connected: 404, reauth_required: 409,
  refresh_failed: 502, google_api_error: 502, rate_limited: 429,
  bad_request: 400, not_found: 404, internal_error: 500,
};

/* Nur diese Texte gehen nach aussen. Google- und Postgres-Meldungen
   bleiben im Log — sie verraten sonst interne Struktur. */
const SAFE_MESSAGES: Partial<Record<GbpErrorCode, string>> = {
  unauthenticated: 'Nicht eingeloggt.',
  oauth_denied: 'Du hast den Zugriff bei Google abgelehnt.',
  invalid_state: 'Die Verbindung konnte nicht bestätigt werden. Bitte erneut starten.',
  state_expired: 'Der Vorgang hat zu lange gedauert. Bitte erneut starten.',
  missing_refresh_token:
    'Google hat kein dauerhaftes Zugriffsrecht erteilt. Bitte erneut verbinden und die Freigabe bestätigen.',
  insufficient_scope:
    'Die nötigen Berechtigungen wurden nicht erteilt. Bitte beim Verbinden alle Häkchen setzen.',
  not_connected: 'Es ist noch kein Google-Konto verbunden.',
  reauth_required: 'Die Verbindung zu Google ist abgelaufen. Bitte neu verbinden.',
  rate_limited: 'Google drosselt gerade die Anfragen. Bitte in ein paar Minuten erneut versuchen.',
};

const GENERIC_MESSAGE = 'Es ist ein Fehler aufgetreten. Bitte später erneut versuchen.';

class GbpError extends Error {
  readonly code: GbpErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(
    code: GbpErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'GbpError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.retryable = options.retryable ?? (this.status >= 500 || this.status === 429);
    this.context = options.context;
  }

  toPublic() {
    return {
      error: {
        code: this.code,
        message: SAFE_MESSAGES[this.code] ?? GENERIC_MESSAGE,
        retryable: this.retryable,
      },
    };
  }
}

function toGbpError(err: unknown): GbpError {
  if (err instanceof GbpError) return err;
  return new GbpError('internal_error', err instanceof Error ? err.message : String(err), { cause: err });
}

/** Strukturiertes Logging. Niemals Tokens oder Klartext-Secrets loggen. */
function logError(scope: string, err: unknown, extra: Record<string, unknown> = {}): void {
  const gbp = err instanceof GbpError ? err : null;
  console.error(JSON.stringify({
    scope,
    ...extra,
    ...(gbp?.context ?? {}),
    code: gbp?.code ?? 'internal_error',
    status: gbp?.status,
    message: err instanceof Error ? err.message : String(err),
    // Ursache mitschreiben. Postgres- und Supabase-Fehler sind
    // schlichte Objekte, keine Error-Instanzen — eine Prüfung auf
    // "instanceof Error" verschluckt sie stillschweigend, und dann
    // steht im Log nur noch der eigene Sammeltext.
    cause: describeCause(gbp?.cause ?? (err as { cause?: unknown })?.cause),
  }));
}

/** Fehlerursache in etwas Loggbares überführen — ohne Geheimnisse. */
function describeCause(cause: unknown): Record<string, unknown> | string | undefined {
  if (!cause) return undefined;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object') {
    const value = cause as Record<string, unknown>;
    return {
      message: value.message,
      // PostgREST liefert genau diese vier Felder.
      code:    value.code,
      details: value.details,
      hint:    value.hint,
    };
  }
  return String(cause);
}

/* ═══════════════════════════════════════════════════════════════
   3 — KONFIGURATION
═══════════════════════════════════════════════════════════════ */

/* business.manage ist der einzige Scope, den die Business-Profile-APIs
   kennen — feiner lässt sich das bei Google nicht schneiden.
   openid + email dazu, damit wir wissen, WELCHES Konto verbunden ist
   (Anzeige im Dashboard, login_hint beim Reconnect, Dedup über sub). */
const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const REQUIRED_SCOPES = [GBP_SCOPE];
const REQUESTED_SCOPES = [GBP_SCOPE, 'openid', 'email'];

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GBP_ACCOUNT_MGMT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const GBP_BUSINESS_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';

/** Access-Token gilt als abgelaufen, wenn es in unter 2 Minuten verfällt. */
const ACCESS_TOKEN_SKEW_SECONDS = 120;
const STATE_TTL_SECONDS = 600;
const MAX_REFRESH_FAILURES = 5;

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new GbpError('config_error', `Fehlende Umgebungsvariable: ${name}`, { context: { missingEnv: name } });
  }
  return value;
}

/**
 * EIGENER OAuth-Client — nicht der aus dem Supabase-Google-Login.
 * Sonst sähe jeder Nutzer beim blossen Einloggen einen
 * Business-Profil-Einwilligungsdialog, und die Refresh-Tokens lägen
 * in Supabases Auth-Schema statt in unserer verschlüsselten Tabelle.
 */
function getOAuthConfig() {
  return {
    clientId: requireEnv('GBP_GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GBP_GOOGLE_CLIENT_SECRET'),
    redirectUri: requireEnv('GBP_REDIRECT_URI'),
  };
}

/** Doppelt genutzt: CORS-Allowlist und Schutz gegen Open Redirect. */
function getAllowedOrigins(): string[] {
  return requireEnv('GBP_ALLOWED_ORIGINS')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
}

function resolveReturnTo(candidate: string | null): string {
  const allowed = getAllowedOrigins();
  const fallback = `${allowed[0]}/dashboard`;
  if (!candidate) return fallback;

  let url: URL;
  try { url = new URL(candidate); } catch { return fallback; }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return fallback;
  if (!allowed.includes(url.origin.replace(/\/$/, ''))) return fallback;

  // Query und Fragment verwerfen — wir hängen selbst Parameter an.
  return `${url.origin}${url.pathname}`;
}

/* ═══════════════════════════════════════════════════════════════
   4 — VERSCHLÜSSELUNG (AES-256-GCM)

   Warum zusätzlich zur RLS? Weil ein DB-Dump oder ein geleakter
   Service-Role-Key sonst direkt Vollzugriff auf die Google-Konten
   aller Kunden bedeutet. Der Schlüssel liegt in den Function-Secrets,
   nicht in der DB — beides muss also fallen.

   Format: v1.<keyId>.<iv_b64url>.<ciphertext_b64url>
           AES-GCM hängt den Auth-Tag an den Ciphertext an.

   AAD = user_id: bindet den Ciphertext an genau eine Zeile. Ein
   zwischen Zeilen kopiertes Token lässt sich nicht entschlüsseln.
═══════════════════════════════════════════════════════════════ */

const FORMAT_VERSION = 'v1';
const IV_LENGTH = 12;
const keyCache = new Map<string, CryptoKey>();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Base64-Dekodierung mit verständlicher Meldung statt roher atob-Ausnahme. */
function decodeKeyMaterial(encoded: string, keyId: string): Uint8Array {
  try {
    return fromBase64(encoded);
  } catch (cause) {
    throw new GbpError(
      'config_error',
      `Schlüssel ${keyId} ist kein gültiges Base64 — erlaubt sind nur A-Z a-z 0-9 + / =`,
      { cause, context: { keyId } },
    );
  }
}

function parseKeyring(): Map<string, string> {
  const raw = requireEnv('GBP_ENCRYPTION_KEYS');
  const ring = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) {
      throw new GbpError('config_error', 'GBP_ENCRYPTION_KEYS erwartet "keyId:base64Key"');
    }
    ring.set(trimmed.slice(0, sep).trim(), trimmed.slice(sep + 1).trim());
  }
  if (ring.size === 0) throw new GbpError('config_error', 'GBP_ENCRYPTION_KEYS ist leer');
  return ring;
}

function getCurrentKeyId(): string {
  return requireEnv('GBP_ENCRYPTION_KEY_ID');
}

async function importKey(keyId: string): Promise<CryptoKey> {
  const cached = keyCache.get(keyId);
  if (cached) return cached;

  const encoded = parseKeyring().get(keyId);
  if (!encoded) {
    throw new GbpError('encryption_error', `Unbekannte Schlüssel-ID: ${keyId}`, { context: { keyId } });
  }

  const rawKey = decodeKeyMaterial(encoded, keyId);
  if (rawKey.length !== 32) {
    throw new GbpError('config_error', `Schlüssel ${keyId} ist ${rawKey.length} Byte, AES-256 braucht 32`);
  }

  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyCache.set(keyId, key);
  return key;
}

async function encryptToken(plaintext: string, aad: string): Promise<string> {
  if (!plaintext) throw new GbpError('encryption_error', 'Leerer Klartext');

  const keyId = getCurrentKeyId();
  const key = await importKey(keyId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  ));

  return [FORMAT_VERSION, keyId, toBase64Url(iv), toBase64Url(ciphertext)].join('.');
}

async function decryptToken(payload: string, aad: string): Promise<string> {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new GbpError('encryption_error', 'Ungültiges Ciphertext-Format');
  }

  const [, keyId, ivPart, ctPart] = parts;
  const key = await importKey(keyId);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(ivPart), additionalData: new TextEncoder().encode(aad) },
      key,
      fromBase64Url(ctPart),
    );
    return new TextDecoder().decode(plaintext);
  } catch (cause) {
    // Kein Detail nach aussen — sonst wird das hier zum Orakel.
    throw new GbpError('encryption_error', 'Entschlüsselung fehlgeschlagen', { cause, context: { keyId } });
  }
}

function needsKeyRotation(payload: string | null): boolean {
  if (!payload) return false;
  const parts = payload.split('.');
  if (parts.length !== 4) return false;
  try { return parts[1] !== getCurrentKeyId(); } catch { return false; }
}

function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/**
 * PKCE (S256). Google verlangt es für vertrauliche Clients nicht — es
 * schützt hier trotzdem: Der Authorization Code läuft über den Browser
 * des Users und ist ohne den Verifier, der die Function nie verlässt,
 * wertlos.
 */
async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

/**
 * Das id_token kam über unsere eigene TLS-Verbindung direkt vom
 * Google-Token-Endpoint (OIDC Core 3.1.3.7 — Signaturprüfung hier
 * entbehrlich). Wir prüfen zusätzlich aud gegen unsere Client-ID.
 */
function decodeIdTokenPayload<T>(idToken: string): T {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GbpError('exchange_failed', 'Ungültiges id_token-Format');
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as T;
  } catch (cause) {
    throw new GbpError('exchange_failed', 'id_token nicht lesbar', { cause });
  }
}

/* ═══════════════════════════════════════════════════════════════
   5 — SUPABASE + AUTH
═══════════════════════════════════════════════════════════════ */

let cachedAdmin: SupabaseClient | null = null;

/** Service Role. Umgeht RLS. Einziger Weg an die Token-Tabellen. */
function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'werkruf-gbp-oauth' } },
  });
  return cachedAdmin;
}

interface AuthenticatedUser { id: string; email: string | null; }

/**
 * Liest den eingeloggten User aus dem Authorization-Header.
 *
 * Da "Verify JWT" für diese Function aus ist, ist DAS hier die
 * eigentliche Zugriffskontrolle — auf jeder Route ausser /callback.
 * Es wird kein eigener Login gebaut: die bestehende Supabase-Session
 * wird nur validiert.
 */
async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new GbpError('unauthenticated', 'Kein Bearer-Token');
  }

  const token = header.slice(7).trim();
  if (!token) throw new GbpError('unauthenticated', 'Leeres Bearer-Token');

  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data?.user) {
    throw new GbpError('unauthenticated', 'Session ungültig oder abgelaufen', { cause: error });
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/* ═══════════════════════════════════════════════════════════════
   6 — HTTP-HELFER
═══════════════════════════════════════════════════════════════ */

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = getAllowedOrigins();
  const match = origin && allowed.includes(origin.replace(/\/$/, '')) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': match,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',   // Antworten enthalten Kontodaten
    },
  });
}

/** Callback antwortet nicht mit JSON, sondern schickt den Browser zurück. */
function redirectWithResult(
  returnTo: string,
  result: {
    status: 'connected' | 'confirm' | 'error';
    code?: string; email?: string | null; token?: string;
  },
): Response {
  const url = new URL(returnTo);
  url.searchParams.set('gbp', result.status);
  if (result.code)  url.searchParams.set('gbp_code', result.code);
  if (result.email) url.searchParams.set('gbp_email', result.email);
  if (result.token) url.searchParams.set('gbp_token', result.token);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), 'Cache-Control': 'no-store' },
  });
}

/* ═══════════════════════════════════════════════════════════════
   7 — GOOGLE OAUTH
═══════════════════════════════════════════════════════════════ */

function buildAuthorizationUrl(opts: { state: string; codeChallenge: string; loginHint?: string | null }): string {
  const { clientId, redirectUri } = getOAuthConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: REQUESTED_SCOPES.join(' '),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',

    // Voraussetzung für ein Refresh-Token.
    access_type: 'offline',

    // Erzwingt die Einwilligung bei JEDEM Durchlauf. Ohne das liefert
    // Google beim zweiten Verbinden desselben Kontos KEIN refresh_token
    // mehr — der Reconnect würde still kaputtgehen.
    prompt: 'consent',

    include_granted_scopes: 'true',
  });

  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

async function readTokenError(response: Response): Promise<{ error: string; error_description?: string }> {
  try {
    return await response.json();
  } catch {
    return { error: 'unknown_error', error_description: `HTTP ${response.status}` };
  }
}

/**
 * invalid_grant = "dieses Refresh-Token ist endgültig tot".
 * Gründe: User hat widerrufen, Passwort geändert, 6 Monate ungenutzt,
 * oder App noch im Testing-Modus (dann nach 7 Tagen).
 * Wiederholen bringt nichts.
 */
function isPermanentGrantFailure(error: string): boolean {
  return error === 'invalid_grant' || error === 'invalid_client' || error === 'unauthorized_client';
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await readTokenError(response);
    throw new GbpError('exchange_failed', `Token-Tausch fehlgeschlagen: ${body.error}`, {
      context: { googleError: body.error, description: body.error_description },
    });
  }

  return await response.json();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponentiell mit Jitter — verhindert Thundering Herd nach einem Google-Ausfall. */
const backoffMs = (attempt: number) => 2 ** (attempt - 1) * 300 + Math.floor(Math.random() * 200);

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ tokens: GoogleTokenResponse; rotatedRefreshToken: string | null }> {
  const { clientId, clientSecret } = getOAuthConfig();
  const MAX_ATTEMPTS = 3;
  let lastTransient: GbpError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;

    try {
      response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
    } catch (cause) {
      lastTransient = new GbpError('refresh_failed', 'Google nicht erreichbar', { cause });
      if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      const tokens: GoogleTokenResponse = await response.json();
      return { tokens, rotatedRefreshToken: tokens.refresh_token ?? null };
    }

    const body = await readTokenError(response);

    if (isPermanentGrantFailure(body.error)) {
      throw new GbpError('reauth_required', `Refresh-Token ungültig: ${body.error}`, {
        context: { googleError: body.error },
      });
    }

    if (response.status === 429 || response.status >= 500) {
      lastTransient = new GbpError(
        response.status === 429 ? 'rate_limited' : 'refresh_failed',
        `Google antwortete mit ${response.status}`,
        { context: { googleError: body.error } },
      );
      if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt));
      continue;
    }

    throw new GbpError('refresh_failed', `Refresh fehlgeschlagen: ${body.error}`, {
      context: { googleError: body.error, status: response.status },
    });
  }

  throw lastTransient ?? new GbpError('refresh_failed', 'Refresh nach mehreren Versuchen fehlgeschlagen');
}

/**
 * Widerruf bei Google. Gibt bewusst nur einen Bool zurück: schlägt der
 * Widerruf fehl (Token war schon tot), löschen wir trotzdem lokal —
 * sonst hinge der User in einem Zustand fest, den er nicht auflösen kann.
 */
async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   8 — REPOSITORY
═══════════════════════════════════════════════════════════════ */

/** Liest die Schlüssel-ID aus dem Ciphertext-Präfix (v1.<keyId>.…). */
function currentKeyIdOf(ciphertext: string): string | null {
  const parts = ciphertext.split('.');
  return parts.length === 4 ? parts[1] : null;
}

/**
 * Schreibt ins Prüfprotokoll. Bewusst "best effort": ein fehlgeschlagener
 * Log-Eintrag darf nie den fachlichen Vorgang scheitern lassen. Die
 * Tabelle ist append-only, UPDATE und DELETE sind per Trigger gesperrt.
 */
async function writeAuditLog(entry: {
  userId?: string | null;
  actorType?: 'user' | 'system' | 'admin';
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await adminClient().from('audit_logs').insert({
      user_id: entry.userId ?? null,
      actor_type: entry.actorType ?? 'user',
      actor_id: entry.userId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.warn(JSON.stringify({ scope: 'writeAuditLog', action: entry.action, message: String(err) }));
  }
}

const ACCOUNTS = 'google_accounts';
const TOKENS   = 'oauth_tokens';
const STATES = 'google_oauth_states';

async function createOAuthState(input: {
  userId: string; codeVerifier: string; returnTo: string; connectionId?: string | null;
}): Promise<string> {
  const nonce = randomToken(32);
  const { error } = await adminClient().from(STATES).insert({
    nonce,
    user_id: input.userId,
    code_verifier: input.codeVerifier,
    return_to: input.returnTo,
    connection_id: input.connectionId ?? null,
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  });

  if (error) throw new GbpError('internal_error', 'OAuth-State nicht gespeichert', { cause: error });
  return nonce;
}

/**
 * Holt den State und löscht ihn im selben Zug — single use.
 * Gelöscht wird VOR der Ablaufprüfung, damit ein abgefangener State
 * auch dann verbraucht ist, wenn er zu alt war.
 */
async function consumeOAuthState(nonce: string): Promise<OAuthStateRow> {
  const { data, error } = await adminClient()
    .from(STATES).delete().eq('nonce', nonce).select('*').maybeSingle();

  if (error) throw new GbpError('internal_error', 'OAuth-State nicht lesbar', { cause: error });
  if (!data) throw new GbpError('invalid_state', 'Unbekannter oder bereits verwendeter State');

  const row = data as OAuthStateRow;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new GbpError('state_expired', 'OAuth-State abgelaufen');
  }
  return row;
}

async function cleanupExpiredStates(): Promise<void> {
  const { error } = await adminClient().rpc('cleanup_expired_oauth_states');
  if (error) console.warn(JSON.stringify({ scope: 'cleanupStates', message: error.message }));
}

/**
 * PostgREST gibt eingebettete Relationen je nach Kardinalität als
 * Objekt oder als Array zurück. Hier ist es 1:1, aber darauf zu
 * vertrauen wäre fahrlässig — also glätten.
 */
function normalizeTokens(row: Record<string, unknown>): ConnectionRow {
  const raw = row.tokens;
  const tokens = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
  return { ...row, tokens } as ConnectionRow;
}

async function listConnections(userId: string): Promise<ConnectionRow[]> {
  const { data, error } = await adminClient()
    .from(ACCOUNTS).select('*, tokens:oauth_tokens(*)')
    .eq('user_id', userId)
    .neq('status', 'disconnected')
    .is('deleted_at', null)
    .order('connected_at', { ascending: true });

  if (error) throw new GbpError('internal_error', 'Verbindungen nicht ladbar', { cause: error });
  return (data ?? []).map(normalizeTokens);
}

async function getConnection(userId: string, connectionId: string): Promise<ConnectionRow> {
  const { data, error } = await adminClient()
    .from(ACCOUNTS).select('*, tokens:oauth_tokens(*)')
    // user_id mitfiltern: Service Role umgeht RLS, die Zugriffsprüfung
    // muss hier im Code passieren.
    .eq('user_id', userId).eq('id', connectionId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new GbpError('internal_error', 'Verbindung nicht ladbar', { cause: error });
  if (!data) throw new GbpError('not_connected', 'Verbindung nicht gefunden');
  return normalizeTokens(data);
}

/**
 * Heute: die älteste aktive Verbindung. Sobald es mehrere Standorte
 * gibt, wird hier auf google_business_locations.is_primary umgestellt —
 * der Rest des Codes bleibt unverändert.
 */
async function getActiveConnection(userId: string): Promise<ConnectionRow> {
  const connections = await listConnections(userId);

  const active = connections.find((c) => c.status === 'active');
  if (active) return active;

  const broken = connections.find((c) => c.status === 'needs_reauth' || c.status === 'revoked');
  if (broken) {
    throw new GbpError('reauth_required', 'Verbindung muss erneuert werden', {
      context: { connectionId: broken.id },
    });
  }

  throw new GbpError('not_connected', 'Kein Google-Konto verbunden');
}

/**
 * Legt die Verbindung an oder erneuert sie.
 * Genau das ist "Reconnect": derselbe User + dasselbe Google-Konto
 * treffen auf den Unique-Constraint und aktualisieren die vorhandene
 * Zeile. Die Verbindungs-ID bleibt stabil, verknüpfte Standorte
 * überleben den Vorgang.
 */
async function upsertConnection(input: {
  userId: string;
  googleAccountId: string;
  googleAccountEmail: string | null;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  grantedScopes: string[];
  confirmationToken: string;
}): Promise<ConnectionRow> {
  const [refreshEncrypted, accessEncrypted] = await Promise.all([
    encryptToken(input.refreshToken, input.userId),
    encryptToken(input.accessToken, input.userId),
  ]);

  // Schritt 1: Konto anlegen oder erneuern.
  const { data: account, error: accountError } = await adminClient().from(ACCOUNTS).upsert({
    user_id: input.userId,
    provider: 'google',
    provider_account_id: input.googleAccountId,
    provider_email: input.googleAccountEmail,
    granted_scopes: input.grantedScopes,
    // NICHT 'active'. Der Callback läuft ohne Session und kann nicht
    // belegen, dass derselbe Mensch den Flow abschliesst, der ihn
    // gestartet hat. Scharf schaltet erst /connect/confirm mit
    // gültiger Session — siehe Migration 007.
    status: 'pending',
    confirmation_token: input.confirmationToken,
    confirmation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    last_refreshed_at: new Date().toISOString(),
    last_error_code: null,
    last_error_at: null,
    refresh_failure_count: 0,
    deleted_at: null,
  }, { onConflict: 'user_id,provider,provider_account_id' }).select('*').single();

  if (accountError || !account) {
    throw new GbpError('internal_error', 'Konto nicht speicherbar', { cause: accountError });
  }

  // Schritt 2: Tokens in die eigene Tabelle.
  // Kein Transaktionsblock möglich (PostgREST kennt keine mehrstufigen
  // Transaktionen). Reihenfolge ist deshalb Absicht: bricht Schritt 2 ab,
  // steht ein Konto ohne Token da — der Token-Service erkennt das und
  // setzt es auf needs_reauth. Andersherum hinge ein Token ohne Konto.
  const { error: tokenError } = await adminClient().from(TOKENS).upsert({
    account_id: account.id,
    user_id: input.userId,
    provider: 'google',
    refresh_token_encrypted: refreshEncrypted,
    access_token_encrypted: accessEncrypted,
    access_token_expires_at: input.accessTokenExpiresAt.toISOString(),
    encryption_key_id: currentKeyIdOf(refreshEncrypted),
    granted_scopes: input.grantedScopes,
    last_refreshed_at: new Date().toISOString(),
    refresh_failure_count: 0,
    last_error_code: null,
    last_error_at: null,
  }, { onConflict: 'account_id' });

  if (tokenError) {
    throw new GbpError('internal_error', 'Token nicht speicherbar', { cause: tokenError });
  }

  await writeAuditLog({
    userId: input.userId,
    action: 'oauth.pending',
    entityType: 'google_account',
    entityId: account.id,
    metadata: { provider_email: input.googleAccountEmail, scopes: input.grantedScopes },
  });

  return { ...(account as AccountRow), tokens: null };
}

async function storeRefreshedToken(input: {
  connectionId: string;
  userId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  rotatedRefreshToken?: string | null;
  reencryptedRefreshToken?: string | null;
}): Promise<void> {
  const accessEncrypted = await encryptToken(input.accessToken, input.userId);

  const patch: Record<string, unknown> = {
    access_token_encrypted: accessEncrypted,
    access_token_expires_at: input.accessTokenExpiresAt.toISOString(),
    last_refreshed_at: new Date().toISOString(),
    refresh_failure_count: 0,
    last_error_code: null,
    last_error_at: null,
    encryption_key_id: currentKeyIdOf(accessEncrypted),
  };

  if (input.rotatedRefreshToken) {
    patch.refresh_token_encrypted = await encryptToken(input.rotatedRefreshToken, input.userId);
  } else if (input.reencryptedRefreshToken) {
    patch.refresh_token_encrypted = input.reencryptedRefreshToken;
  }

  const { error: tokenError } = await adminClient().from(TOKENS)
    .update(patch)
    .eq('account_id', input.connectionId)
    .eq('user_id', input.userId);

  if (tokenError) {
    throw new GbpError('internal_error', 'Token nicht speicherbar', { cause: tokenError });
  }

  // Kontostatus mitziehen — ein erfolgreicher Refresh heilt eine
  // Verbindung, die wegen vorübergehender Fehler angeschlagen war.
  await adminClient().from(ACCOUNTS).update({
    status: 'active',
    last_refreshed_at: new Date().toISOString(),
    refresh_failure_count: 0,
    last_error_code: null,
    last_error_at: null,
  }).eq('id', input.connectionId).eq('user_id', input.userId);
}

/**
 * Markiert eine Verbindung als unbrauchbar und LÖSCHT die Tokens.
 * Das Löschen ist Absicht: ein Token, das Google nicht mehr akzeptiert,
 * ist wertlos, im Leak-Fall aber trotzdem eine Information.
 */
async function markConnectionUnusable(
  connectionId: string,
  status: 'needs_reauth' | 'revoked' | 'disconnected',
  errorCode: string,
): Promise<void> {
  // Zeile in oauth_tokens komplett entfernen, nicht nur leeren.
  // Kein Soft-Delete: ein Token, das Google nicht mehr akzeptiert, ist
  // wertlos, im Leak-Fall aber trotzdem eine Information.
  const { error: tokenError } = await adminClient()
    .from(TOKENS).delete().eq('account_id', connectionId);

  if (tokenError) {
    console.error(JSON.stringify({ scope: 'markConnectionUnusable.tokens', connectionId, message: tokenError.message }));
  }

  const patch: Record<string, unknown> = {
    status,
    last_error_code: errorCode,
    last_error_at: new Date().toISOString(),
  };
  // Vom User getrennt = auch fachlich weg. Widerruf durch Google
  // dagegen bleibt sichtbar, damit das Dashboard "neu verbinden"
  // anbieten kann.
  if (status === 'disconnected') patch.deleted_at = new Date().toISOString();

  const { error } = await adminClient().from(ACCOUNTS).update(patch).eq('id', connectionId);

  if (error) {
    console.error(JSON.stringify({ scope: 'markConnectionUnusable', connectionId, message: error.message }));
  }

  await writeAuditLog({
    action: status === 'disconnected' ? 'oauth.disconnected' : 'oauth.invalidated',
    entityType: 'google_account',
    entityId: connectionId,
    metadata: { status, errorCode },
  });
}

async function recordRefreshFailure(connection: ConnectionRow, errorCode: string): Promise<void> {
  const next = connection.refresh_failure_count + 1;
  const stamp = new Date().toISOString();

  const [accountResult, tokenResult] = await Promise.all([
    adminClient().from(ACCOUNTS).update({
      refresh_failure_count: next, last_error_code: errorCode, last_error_at: stamp,
    }).eq('id', connection.id),
    adminClient().from(TOKENS).update({
      refresh_failure_count: next, last_error_code: errorCode, last_error_at: stamp,
    }).eq('account_id', connection.id),
  ]);

  for (const result of [accountResult, tokenResult]) {
    if (result.error) {
      console.error(JSON.stringify({ scope: 'recordRefreshFailure', connectionId: connection.id, message: result.error.message }));
    }
  }
}

/** Filtert alles Geheime heraus, bevor es zum Client geht. */
function toPublicConnection(row: ConnectionRow): PublicConnection {
  return {
    id: row.id,
    googleAccountEmail: row.provider_email,
    status: row.status,
    grantedScopes: row.granted_scopes,
    connectedAt: row.connected_at,
    lastRefreshedAt: row.last_refreshed_at,
    needsAction: row.status === 'needs_reauth' || row.status === 'revoked',
  };
}

/* ═══════════════════════════════════════════════════════════════
   9 — TOKEN-SERVICE

   Einziger Weg an ein gültiges Access-Token. Kein Aufrufer
   entschlüsselt selbst.
═══════════════════════════════════════════════════════════════ */

/* Zwei gleichzeitige Requests desselben Users würden sonst zwei
   Refreshes auslösen. Der Cache greift pro Isolate; bei mehreren
   Instanzen kann es weiterhin zu Doppel-Refreshes kommen. Das ist
   bewusst in Kauf genommen — Google rotiert bei Web-Server-Clients
   keine Refresh-Tokens, es kostet nur Quota. */
const inFlight = new Map<string, Promise<AccessTokenResult>>();

function isStillValid(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() > ACCESS_TOKEN_SKEW_SECONDS * 1000;
}

async function readCachedToken(connection: ConnectionRow): Promise<AccessTokenResult | null> {
  const tokens = connection.tokens;
  if (!tokens?.access_token_encrypted) return null;
  if (!isStillValid(tokens.access_token_expires_at)) return null;

  try {
    return {
      accessToken: await decryptToken(tokens.access_token_encrypted, connection.user_id),
      expiresAt: tokens.access_token_expires_at!,
      connectionId: connection.id,
      refreshed: false,
    };
  } catch (err) {
    // Refresh-Token liegt separat — lieber neu holen als scheitern.
    logError('tokenService.cacheDecrypt', err, { connectionId: connection.id });
    return null;
  }
}

async function performRefresh(connection: ConnectionRow): Promise<AccessTokenResult> {
  const stored = connection.tokens;
  if (!stored?.refresh_token_encrypted) {
    await markConnectionUnusable(connection.id, 'needs_reauth', 'missing_refresh_token');
    throw new GbpError('reauth_required', 'Kein Refresh-Token hinterlegt', {
      context: { connectionId: connection.id },
    });
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptToken(stored.refresh_token_encrypted, connection.user_id);
  } catch (err) {
    // Nicht entschlüsselbar = Schlüssel weg oder Daten manipuliert.
    // Die Verbindung ist tot, egal was Google sagen würde.
    await markConnectionUnusable(connection.id, 'needs_reauth', 'encryption_error');
    logError('tokenService.decryptRefreshToken', err, { connectionId: connection.id });
    throw new GbpError('reauth_required', 'Refresh-Token nicht lesbar', { cause: err });
  }

  try {
    const { tokens, rotatedRefreshToken } = await refreshAccessToken(refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Bei Schlüsselrotation das Refresh-Token gleich mit umschlüsseln.
    let reencrypted: string | null = null;
    if (!rotatedRefreshToken && needsKeyRotation(stored.refresh_token_encrypted)) {
      reencrypted = await encryptToken(refreshToken, connection.user_id);
    }

    await storeRefreshedToken({
      connectionId: connection.id,
      userId: connection.user_id,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      rotatedRefreshToken,
      reencryptedRefreshToken: reencrypted,
    });

    return {
      accessToken: tokens.access_token,
      expiresAt: expiresAt.toISOString(),
      connectionId: connection.id,
      refreshed: true,
    };
  } catch (err) {
    // Endgültig widerrufen → stilllegen, Tokens löschen.
    if (err instanceof GbpError && err.code === 'reauth_required') {
      await markConnectionUnusable(connection.id, 'revoked', 'invalid_grant');
      logError('tokenService.revoked', err, { connectionId: connection.id });
      throw err;
    }

    // Vorübergehend → zählen. Erst nach mehreren Fehlversuchen gilt die
    // Verbindung als kaputt, damit ein Google-Ausfall nicht alle Kunden
    // auf "neu verbinden" setzt.
    await recordRefreshFailure(connection, err instanceof GbpError ? err.code : 'refresh_failed');

    if (connection.refresh_failure_count + 1 >= MAX_REFRESH_FAILURES) {
      await markConnectionUnusable(connection.id, 'needs_reauth', 'refresh_failed');
      throw new GbpError('reauth_required', 'Refresh dauerhaft fehlgeschlagen', { cause: err });
    }

    throw err;
  }
}

async function getAccessTokenForConnection(
  connection: ConnectionRow,
  options: { forceRefresh?: boolean } = {},
): Promise<AccessTokenResult> {
  if (connection.status !== 'active') {
    throw new GbpError('reauth_required', `Verbindung im Status ${connection.status}`, {
      context: { connectionId: connection.id, status: connection.status },
    });
  }

  // forceRefresh überspringt den Cache. Nötig, wenn Google ein Token
  // ablehnt, das laut Ablaufdatum noch gültig wäre.
  const cached = options.forceRefresh ? null : await readCachedToken(connection);
  if (cached) return cached;

  // Bei forceRefresh keinen laufenden Refresh mitbenutzen — der könnte
  // genau das Token liefern, das Google gerade abgelehnt hat.
  const pending = options.forceRefresh ? null : inFlight.get(connection.id);
  if (pending) return pending;

  const task = performRefresh(connection).finally(() => inFlight.delete(connection.id));
  inFlight.set(connection.id, task);
  return task;
}

async function getAccessToken(
  userId: string,
  connectionId?: string,
  options: { forceRefresh?: boolean } = {},
): Promise<AccessTokenResult> {
  const connection = connectionId
    ? await getConnection(userId, connectionId)
    : await getActiveConnection(userId);
  return getAccessTokenForConnection(connection, options);
}

/* ═══════════════════════════════════════════════════════════════
   10 — GBP API-CLIENT

   Aufbau in drei Schichten, von innen nach aussen:

     TokenProvider  — Schnittstelle, liefert ein gültiges Token.
                      Der Client weiss nicht, dass dahinter Supabase
                      steckt; für Tests reicht eine Funktion, die einen
                      String zurückgibt.
     Transport      — HTTP, Wiederholungen, Backoff, Fehlerübersetzung.
                      Kennt keine Fachlichkeit, nur Requests.
     GbpApiClient   — Fachmethoden. Bauen URLs und Bodies, delegieren
                      alles Übrige nach unten.

   HINWEIS ZU DEN ENDPUNKTEN
   Google hat die Business-Profile-API aufgeteilt, aber NICHT vollständig:
   Konten und Standortdaten liegen auf den neuen v1-Diensten, Bewertungen
   und Antworten hängen weiterhin an der alten v4-API unter
   mybusiness.googleapis.com. Das ist kein Versehen hier — es gibt bis
   heute keinen v1-Ersatz dafür.

   HINWEIS ZUR QUOTA
   Die APIs brauchen neben dem Aktivieren in der Cloud Console einen
   bewilligten Quota-Antrag. Ohne den liefert jeder Aufruf 403.
═══════════════════════════════════════════════════════════════ */

/** Legacy-v4-Basis. Nur für Reviews und Antworten. */
const GBP_LEGACY_API = 'https://mybusiness.googleapis.com/v4';

/* ─────────────────────────────────────────────
   RETRY-PARAMETER
───────────────────────────────────────────── */
const RETRY_MAX_ATTEMPTS = 4;
const RETRY_BASE_MS      = 500;
const RETRY_CAP_MS       = 8_000;

/* Gesamtbudget pro Aufruf. Edge Functions haben ein Wall-Clock-Limit;
   ohne Deckel würde ein hartnäckiges 503 den ganzen Request auffressen
   und der Nutzer bekäme gar keine Antwort statt einer Fehlermeldung. */
const RETRY_MAX_ELAPSED_MS = 20_000;

/* ─────────────────────────────────────────────
   SCHNITTSTELLEN
───────────────────────────────────────────── */
interface TokenProvider {
  /** Gültiges Access-Token. forceRefresh umgeht den Cache. */
  getToken(options?: { forceRefresh?: boolean }): Promise<AccessTokenResult>;
  /** Wird gerufen, wenn Google das Token endgültig ablehnt. */
  onTokenRejected(connectionId: string): Promise<void>;
}

interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

/** Strukturiertes JSON-Log. Enthält NIE Tokens oder Bodies. */
function createLogger(scope: string): Logger {
  const emit = (level: string, event: string, data: Record<string, unknown> = {}) =>
    console[level === 'debug' ? 'log' : level as 'warn' | 'error'](
      JSON.stringify({ scope, level, event, ts: new Date().toISOString(), ...data }),
    );
  return {
    debug: (event, data) => emit('debug', event, data),
    warn:  (event, data) => emit('warn',  event, data),
    error: (event, data) => emit('error', event, data),
  };
}

/* ─────────────────────────────────────────────
   FEHLERKLASSIFIKATION
───────────────────────────────────────────── */
interface GoogleApiErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: unknown[] };
}

/**
 * Google meldet erschöpfte Quota je nach Dienst als 429 ODER als 403
 * mit status RESOURCE_EXHAUSTED. Wer nur auf den Statuscode schaut,
 * hält den zweiten Fall für ein Berechtigungsproblem und wiederholt
 * nie — obwohl genau das hier richtig wäre.
 */
function isQuotaError(status: number, body: GoogleApiErrorBody): boolean {
  if (status === 429) return true;
  return status === 403 &&
    (body.error?.status === 'RESOURCE_EXHAUSTED' ||
     /quota|rate limit/i.test(body.error?.message ?? ''));
}

function isRetryableStatus(status: number, body: GoogleApiErrorBody): boolean {
  if (isQuotaError(status, body)) return true;
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/** Exponentiell mit vollem Jitter, gedeckelt. */
function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RETRY_CAP_MS);
    }
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      return Math.min(Math.max(asDate - Date.now(), 0), RETRY_CAP_MS);
    }
  }
  const ceiling = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
  // Voller Jitter statt fester Verdopplung: sonst laufen alle Kunden,
  // die denselben 503 gesehen haben, im Gleichtakt wieder los.
  return Math.random() * ceiling;
}

/* ─────────────────────────────────────────────
   TRANSPORT
───────────────────────────────────────────── */
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Für Logs — die rohe URL kann Ressourcennamen enthalten. */
  operation: string;
}

class GbpTransport {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly log: Logger,
  ) {}

  async request<T>(baseUrl: string, path: string, options: RequestOptions): Promise<T> {
    const url = buildUrl(baseUrl, path, options.query);
    const startedAt = Date.now();

    let attempt = 0;
    let forceRefresh = false;
    let lastError: GbpError | null = null;

    while (attempt < RETRY_MAX_ATTEMPTS) {
      attempt++;

      if (Date.now() - startedAt > RETRY_MAX_ELAPSED_MS) {
        this.log.warn('budget_exhausted', { operation: options.operation, attempt });
        break;
      }

      const { accessToken, connectionId } = await this.tokens.getToken({ forceRefresh });
      forceRefresh = false;

      let response: Response;
      const requestStartedAt = Date.now();

      try {
        response = await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
      } catch (cause) {
        // Netzwerkfehler: kein Response-Objekt, also auch kein Retry-After.
        lastError = new GbpError('google_api_error', 'Google nicht erreichbar', {
          cause, retryable: true, context: { operation: options.operation },
        });
        this.log.warn('network_error', { operation: options.operation, attempt });
        await sleep(retryDelayMs(attempt, null));
        continue;
      }

      const durationMs = Date.now() - requestStartedAt;

      if (response.ok) {
        this.log.debug('request_ok', {
          operation: options.operation, status: response.status, attempt, durationMs, connectionId,
        });
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const body = await readJsonSafe<GoogleApiErrorBody>(response);
      const detail = body.error?.message ?? body.error?.status ?? `HTTP ${response.status}`;

      this.log.warn('request_failed', {
        operation: options.operation,
        status: response.status,
        googleStatus: body.error?.status,
        attempt, durationMs, connectionId,
        detail,
      });

      /* ── 401 ──
         Das Token war beim Absenden gültig, Google lehnt es trotzdem ab:
         entweder ein Widerruf mitten in der Laufzeit oder ein Cache, der
         nicht mehr stimmt. Einmal erzwungen erneuern und wiederholen.
         Erst wenn das ebenfalls scheitert, gilt die Verbindung als tot —
         sonst würde ein einzelner Ausrutscher alle Kunden ausloggen. */
      if (response.status === 401) {
        if (attempt < RETRY_MAX_ATTEMPTS && !forceRefresh) {
          forceRefresh = true;
          this.log.warn('token_rejected_retrying', { operation: options.operation, connectionId });
          continue;
        }
        await this.tokens.onTokenRejected(connectionId);
        throw new GbpError('reauth_required', 'Google hat das Access-Token abgelehnt', {
          context: { operation: options.operation, connectionId },
        });
      }

      if (isRetryableStatus(response.status, body)) {
        const quota = isQuotaError(response.status, body);
        lastError = new GbpError(
          quota ? 'rate_limited' : 'google_api_error',
          quota ? 'Google-Quota erschöpft' : `Google API ${response.status}: ${detail}`,
          { retryable: true, context: { operation: options.operation, status: response.status, detail } },
        );

        if (attempt >= RETRY_MAX_ATTEMPTS) break;
        await sleep(retryDelayMs(attempt, response.headers.get('Retry-After')));
        continue;
      }

      /* ── Endgültig ── */
      if (response.status === 403) {
        throw new GbpError('insufficient_scope', `Zugriff verweigert: ${detail}`, {
          context: { operation: options.operation, detail },
        });
      }
      if (response.status === 404) {
        throw new GbpError('not_found', `Nicht gefunden: ${detail}`, {
          context: { operation: options.operation, detail },
        });
      }
      throw new GbpError('google_api_error', `Google API ${response.status}: ${detail}`, {
        retryable: false,
        context: { operation: options.operation, status: response.status, detail },
      });
    }

    this.log.error('retries_exhausted', {
      operation: options.operation, attempts: attempt, elapsedMs: Date.now() - startedAt,
    });
    throw lastError ?? new GbpError('google_api_error', 'Aufruf nach mehreren Versuchen fehlgeschlagen');
  }
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${baseUrl}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readJsonSafe<T>(response: Response): Promise<T> {
  try { return (await response.json()) as T; } catch { return {} as T; }
}

/* ─────────────────────────────────────────────
   FACHCLIENT
───────────────────────────────────────────── */

/** Obergrenze für automatische Seitenverkettung. */
const MAX_PAGES = 20;

class GbpApiClient {
  constructor(
    private readonly transport: GbpTransport,
    private readonly log: Logger,
  ) {}

  /* ── Konten ── */

  async getAccounts(): Promise<GbpAccount[]> {
    return this.collect<GbpAccount, GbpAccountsResponse>(
      (pageToken) => this.transport.request<GbpAccountsResponse>(
        GBP_ACCOUNT_MGMT_API, 'accounts',
        { operation: 'getAccounts', query: { pageSize: 100, pageToken } },
      ),
      (page) => page.accounts ?? [],
    );
  }

  /* ── Standorte ── */

  /**
   * @param accountName "accounts/123"
   * @param readMask    Google verlangt eine explizite Feldmaske; ohne
   *                    sie antwortet die API mit 400. Der Standard deckt
   *                    ab, was wir in google_locations speichern.
   */
  async getLocations(accountName: string, options: { readMask?: string } = {}): Promise<GbpLocation[]> {
    const readMask = options.readMask ?? [
      'name', 'title', 'storefrontAddress', 'phoneNumbers',
      'websiteUri', 'categories', 'metadata', 'profile', 'regularHours',
    ].join(',');

    return this.collect<GbpLocation, GbpLocationsResponse>(
      (pageToken) => this.transport.request<GbpLocationsResponse>(
        GBP_BUSINESS_INFO_API, `${normalizeName(accountName, 'accounts')}/locations`,
        { operation: 'getLocations', query: { readMask, pageSize: 100, pageToken } },
      ),
      (page) => page.locations ?? [],
    );
  }

  /**
   * Teilaktualisierung eines Standorts.
   *
   * updateMask ist Pflicht und muss exakt die Felder nennen, die
   * gesetzt werden. Fehlt ein Feld in der Maske, ignoriert Google es
   * stillschweigend; steht eines drin, das im Body fehlt, wird es
   * GELÖSCHT. Deshalb leiten wir die Maske aus dem Patch ab, statt sie
   * den Aufrufer schreiben zu lassen.
   */
  async updateLocation(
    locationName: string,
    patch: GbpLocationPatch,
    options: { updateMask?: string } = {},
  ): Promise<GbpLocation> {
    const fields = Object.keys(patch).filter((key) => patch[key as keyof GbpLocationPatch] !== undefined);
    if (fields.length === 0) {
      throw new GbpError('bad_request', 'updateLocation ohne Änderungen aufgerufen');
    }

    const updateMask = options.updateMask ?? fields.join(',');
    this.log.debug('update_location', { locationName, updateMask });

    return this.transport.request<GbpLocation>(
      GBP_BUSINESS_INFO_API, normalizeName(locationName, 'locations'),
      { operation: 'updateLocation', method: 'PATCH', query: { updateMask }, body: patch },
    );
  }

  /* ── Bewertungen (v4) ── */

  /**
   * Bewertungen eines Standorts.
   *
   * Die v4-API verlangt den vollen Pfad accounts/…/locations/…, während
   * die v1-Standort-API nur "locations/123" zurückgibt. Deshalb braucht
   * diese Methode beide Namen.
   *
   * @param since Nur Bewertungen ab diesem Zeitpunkt. Google kennt
   *              keinen Filter dafür, also brechen wir die Seitenkette
   *              ab, sobald ältere Einträge kommen — die Antwort ist
   *              nach updateTime absteigend sortiert.
   */
  async getReviews(
    accountName: string,
    locationName: string,
    options: { since?: Date; maxPages?: number } = {},
  ): Promise<{ reviews: GbpReview[]; averageRating?: number; totalReviewCount?: number }> {
    const parent = `${normalizeName(accountName, 'accounts')}/${normalizeName(locationName, 'locations')}`;
    const sinceMs = options.since?.getTime();

    const reviews: GbpReview[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    let averageRating: number | undefined;
    let totalReviewCount: number | undefined;

    do {
      const page = await this.transport.request<GbpReviewsResponse>(
        GBP_LEGACY_API, `${parent}/reviews`,
        { operation: 'getReviews', query: { pageSize: 50, pageToken, orderBy: 'updateTime desc' } },
      );

      averageRating ??= page.averageRating;
      totalReviewCount ??= page.totalReviewCount;

      const batch = page.reviews ?? [];
      if (sinceMs !== undefined) {
        const fresh = batch.filter((r) => Date.parse(r.updateTime ?? r.createTime ?? '') >= sinceMs);
        reviews.push(...fresh);
        if (fresh.length < batch.length) break;   // ab hier nur noch Älteres
      } else {
        reviews.push(...batch);
      }

      pageToken = page.nextPageToken;
      pages++;
    } while (pageToken && pages < (options.maxPages ?? MAX_PAGES));

    this.log.debug('reviews_fetched', { parent, count: reviews.length, pages });
    return { reviews, averageRating, totalReviewCount };
  }

  /**
   * Antwortet auf eine Bewertung.
   *
   * PUT, nicht POST: Google erlaubt genau eine Antwort pro Bewertung,
   * ein zweiter Aufruf überschreibt die erste. Das ist auch der Grund
   * für den Partial-Unique-Index auf review_replies.
   *
   * @param reviewName "accounts/{a}/locations/{l}/reviews/{r}"
   */
  async replyToReview(reviewName: string, comment: string): Promise<GbpReviewReply> {
    const trimmed = comment.trim();
    if (!trimmed) {
      throw new GbpError('bad_request', 'Antwort ohne Text');
    }
    // Googles Limit für Antworttexte.
    if (trimmed.length > 4096) {
      throw new GbpError('bad_request', 'Antwort länger als 4096 Zeichen');
    }

    this.log.debug('reply_to_review', { reviewName, length: trimmed.length });

    return this.transport.request<GbpReviewReply>(
      GBP_LEGACY_API, `${reviewName.replace(/^\//, '')}/reply`,
      { operation: 'replyToReview', method: 'PUT', body: { comment: trimmed } },
    );
  }

  /** Löscht eine veröffentlichte Antwort. */
  async deleteReviewReply(reviewName: string): Promise<void> {
    await this.transport.request<void>(
      GBP_LEGACY_API, `${reviewName.replace(/^\//, '')}/reply`,
      { operation: 'deleteReviewReply', method: 'DELETE' },
    );
  }

  /* ── Seitenverkettung ── */
  private async collect<TItem, TPage extends { nextPageToken?: string }>(
    fetchPage: (pageToken?: string) => Promise<TPage>,
    extract: (page: TPage) => TItem[],
  ): Promise<TItem[]> {
    const items: TItem[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const page = await fetchPage(pageToken);
      items.push(...extract(page));
      pageToken = page.nextPageToken;
      pages++;
    } while (pageToken && pages < MAX_PAGES);

    return items;
  }
}

/** "accounts/123" oder "123" → "accounts/123" */
function normalizeName(name: string, prefix: 'accounts' | 'locations'): string {
  const clean = name.replace(/^\//, '');
  return clean.startsWith(`${prefix}/`) ? clean : `${prefix}/${clean}`;
}

/* ─────────────────────────────────────────────
   KOMPOSITION

   Einzige Stelle, an der der Client etwas über Supabase erfährt.
   Der TokenProvider kapselt das; für einen Test genügt ein Objekt
   mit denselben zwei Methoden.
───────────────────────────────────────────── */
function createGbpClient(userId: string, connectionId?: string): GbpApiClient {
  const log = createLogger('gbp-api');

  const tokens: TokenProvider = {
    getToken: (options) => getAccessToken(userId, connectionId, options),
    onTokenRejected: async (id) => {
      await markConnectionUnusable(id, 'needs_reauth', 'unauthorized');
      await writeAuditLog({
        userId, action: 'oauth.invalidated',
        entityType: 'google_account', entityId: id,
        metadata: { reason: 'google_rejected_access_token' },
      });
    },
  };

  return new GbpApiClient(new GbpTransport(tokens, log), log);
}

/* ═══════════════════════════════════════════════════════════════
   10b — REVIEW-SYNCHRONISATION

   Drei Bausteine, klar getrennt:

     ReviewRepository   — kennt nur die Datenbank. Kein Google, keine
                          Fachlogik.
     ReviewSyncService  — kennt beides und entscheidet, was neu ist,
                          was sich geändert hat und was verschwunden ist.
     SyncScheduler      — kennt weder Google noch Reviews. Übernimmt
                          Jobs, führt sie aus, meldet Ergebnisse zurück.

   Der Scheduler ist bewusst nicht auf Reviews zugeschnitten: er
   verteilt an registrierte Handler. Ein späterer Standort- oder
   Insights-Sync kommt als weiterer Eintrag in HANDLERS dazu, ohne
   dass hier etwas anderes angefasst wird.
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────
   TYPEN
───────────────────────────────────────────── */

interface ReviewRow {
  id: string;
  location_id: string;
  account_id: string;
  user_id: string;
  review_resource_name: string;
  star_rating: number;
  comment: string | null;
  google_created_at: string;
  google_updated_at: string | null;
  status: 'active' | 'deleted_upstream';
  is_answered: boolean;
  answered_at: string | null;
  first_seen_at: string;
  last_synced_at: string;
}

/**
 * Ausschnitt aus google_reviews, wie ihn der Abgleich braucht.
 * Eigener Typ statt Pick<> im Rückgabewert — dreimal wiederholt war
 * die Pick-Liste unlesbar und beim Ändern fehleranfällig.
 */
type ExistingReview = Pick<
  ReviewRow,
  'id' | 'google_updated_at' | 'star_rating' | 'comment' | 'is_answered' | 'status'
>;

type ExistingReviewRow = ExistingReview & { review_resource_name: string };

interface LocationRow {
  id: string;
  account_id: string;
  user_id: string;
  account_resource_name: string;
  location_resource_name: string;
  title: string | null;
  review_count: number;
  average_rating: number | null;
  last_synced_at: string | null;
  deleted_at: string | null;
}

/** Ergebnis eines Sync-Laufs. Landet in sync_jobs.result. */
interface SyncResult {
  locationId: string;
  mode: 'full' | 'incremental';
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  markedDeleted: number;
  skipped: number;
  averageRating?: number;
  totalReviewCount?: number;
  durationMs: number;
}

type SyncJobType =
  | 'sync_locations' | 'sync_reviews' | 'sync_insights'
  | 'publish_reply' | 'update_profile' | 'refresh_token';

interface SyncJobRow {
  id: string;
  user_id: string | null;
  account_id: string | null;
  location_id: string | null;
  job_type: SyncJobType;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
}

/* ─────────────────────────────────────────────
   HILFSFUNKTIONEN
───────────────────────────────────────────── */

/** Googles Wortform in die Zahl, die in der Spalte steht. */
const STAR_RATINGS: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

/**
 * Wie weit zurück ein inkrementeller Lauf schaut.
 *
 * Nicht exakt bis last_synced_at, sondern etwas davor: Googles
 * updateTime und unsere Uhr laufen nicht synchron, und die v4-API
 * liefert Änderungen gelegentlich verzögert. Ohne Überlappung fällt
 * genau der Randfall durchs Raster.
 */
const INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000;   // 1 Stunde

/** Ab dieser Lücke lohnt sich kein inkrementeller Lauf mehr. */
const FULL_SYNC_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/* ─────────────────────────────────────────────
   REPOSITORY
───────────────────────────────────────────── */

class ReviewRepository {
  constructor(private readonly db = adminClient()) {}

  async getLocation(locationId: string): Promise<LocationRow> {
    const { data, error } = await this.db
      .from('google_locations').select('*')
      .eq('id', locationId).is('deleted_at', null).maybeSingle();

    if (error) throw new GbpError('internal_error', 'Standort nicht ladbar', { cause: error });
    if (!data) throw new GbpError('not_found', 'Standort nicht gefunden', { context: { locationId } });
    return data as LocationRow;
  }

  /**
   * Bestehende Bewertungen eines Standorts, indiziert nach
   * Ressourcennamen. Nur die Felder, die für den Vergleich nötig sind —
   * bei Standorten mit tausenden Bewertungen macht das den Unterschied.
   */
  async getExistingByResourceName(locationId: string): Promise<Map<string, ExistingReview>> {
    const index = new Map<string, ExistingReview>();
    const PAGE = 1000;
    let from = 0;

    // Seitenweise: PostgREST deckelt Antworten, ein blindes select('*')
    // liefert bei grossen Standorten stillschweigend zu wenig Zeilen.
    for (;;) {
      const { data, error } = await this.db
        .from('google_reviews')
        .select('id, review_resource_name, google_updated_at, star_rating, comment, is_answered, status')
        .eq('location_id', locationId)
        .range(from, from + PAGE - 1);

      if (error) throw new GbpError('internal_error', 'Bewertungen nicht ladbar', { cause: error });
      if (!data || data.length === 0) break;

      for (const row of data as ExistingReviewRow[]) {
        index.set(row.review_resource_name, row);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }

    return index;
  }

  /**
   * Legt neue Bewertungen an bzw. aktualisiert geänderte.
   *
   * Der Unique-Index (location_id, review_resource_name) macht
   * Dubletten unmöglich — nicht als Konvention, sondern als Garantie
   * der Datenbank. Selbst wenn zwei Läufe gleichzeitig starten,
   * entsteht keine zweite Zeile.
   *
   * first_seen_at wird bewusst NICHT mitgeschickt: beim Upsert einer
   * bestehenden Zeile würde der Wert sonst überschrieben und die
   * Information, wann wir die Bewertung zuerst gesehen haben, wäre weg.
   */
  async upsertReviews(rows: Array<Omit<ReviewRow, 'id' | 'first_seen_at'>>): Promise<void> {
    if (rows.length === 0) return;

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.db
        .from('google_reviews')
        .upsert(rows.slice(i, i + CHUNK), {
          onConflict: 'location_id,review_resource_name',
          ignoreDuplicates: false,
        });

      if (error) {
        throw new GbpError('internal_error', 'Bewertungen nicht speicherbar', {
          cause: error, context: { chunkStart: i, chunkSize: CHUNK },
        });
      }
    }
  }

  /** Bewertungen, die bei Google nicht mehr auftauchen. */
  async markDeletedUpstream(locationId: string, reviewIds: string[]): Promise<number> {
    if (reviewIds.length === 0) return 0;

    const { error, count } = await this.db
      .from('google_reviews')
      .update({ status: 'deleted_upstream', last_synced_at: new Date().toISOString() },
              { count: 'exact' })
      .eq('location_id', locationId)
      .in('id', reviewIds);

    if (error) throw new GbpError('internal_error', 'Status nicht setzbar', { cause: error });
    return count ?? reviewIds.length;
  }

  /**
   * Sync-Zeitstempel und Kennzahlen am Standort fortschreiben.
   * Erst NACH dem erfolgreichen Schreiben der Bewertungen aufrufen —
   * sonst überspringt der nächste inkrementelle Lauf genau die Daten,
   * die gerade nicht ankamen.
   */
  async markLocationSynced(
    locationId: string,
    stats: { averageRating?: number; totalReviewCount?: number },
  ): Promise<void> {
    const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
    if (stats.averageRating !== undefined)    patch.average_rating = stats.averageRating;
    if (stats.totalReviewCount !== undefined) patch.review_count   = stats.totalReviewCount;

    const { error } = await this.db
      .from('google_locations').update(patch).eq('id', locationId);

    if (error) throw new GbpError('internal_error', 'Standort nicht aktualisierbar', { cause: error });
  }
}

/* ─────────────────────────────────────────────
   SYNC-SERVICE
───────────────────────────────────────────── */

class ReviewSyncService {
  constructor(
    private readonly repo: ReviewRepository,
    private readonly log: Logger,
  ) {}

  async syncLocation(
    locationId: string,
    options: { force?: boolean } = {},
  ): Promise<SyncResult> {
    const startedAt = Date.now();
    const location = await this.repo.getLocation(locationId);

    const lastSynced = location.last_synced_at ? Date.parse(location.last_synced_at) : null;
    const mode: SyncResult['mode'] =
      options.force || lastSynced === null || Date.now() - lastSynced > FULL_SYNC_AFTER_MS
        ? 'full'
        : 'incremental';

    const since = mode === 'incremental' && lastSynced !== null
      ? new Date(lastSynced - INCREMENTAL_OVERLAP_MS)
      : undefined;

    this.log.debug('sync_start', { locationId, mode, since: since?.toISOString() });

    const client = createGbpClient(location.user_id, location.account_id);
    const { reviews, averageRating, totalReviewCount } = await client.getReviews(
      location.account_resource_name,
      location.location_resource_name,
      { since },
    );

    const existing = await this.repo.getExistingByResourceName(locationId);

    const toWrite: Array<Omit<ReviewRow, 'id' | 'first_seen_at'>> = [];
    const seen = new Set<string>();
    const now = new Date().toISOString();
    let created = 0, updated = 0, unchanged = 0, skipped = 0;

    for (const review of reviews) {
      const rating = STAR_RATINGS[review.starRating ?? ''];
      if (!rating) {
        // STAR_RATING_UNSPECIFIED — die Spalte hat einen CHECK auf 1..5.
        skipped++;
        this.log.warn('review_skipped', { reason: 'unrated', name: review.name });
        continue;
      }

      seen.add(review.name);
      const prior = existing.get(review.name);

      const googleUpdatedAt = review.updateTime ?? review.createTime ?? now;
      const isAnswered = !!review.reviewReply?.comment;
      const comment = review.comment ?? null;

      if (prior) {
        // Nur schreiben, wenn sich tatsächlich etwas geändert hat.
        // Ohne diesen Vergleich würde jeder Lauf jede Zeile anfassen —
        // bei tausend Kunden sinnlose Schreiblast und ein updated_at,
        // das nichts mehr aussagt.
        // is_answered nur setzen, nie zurücknehmen: eine gerade
        // veröffentlichte Antwort taucht bei Google mit Verzögerung
        // auf. Würde der Sync sie auf "unbeantwortet" zurückdrehen,
        // stünde die Bewertung wieder in der Arbeitsliste und jemand
        // würde ein zweites Mal antworten.
        const nextAnswered = prior.is_answered || isAnswered;

        const changed =
          prior.google_updated_at !== googleUpdatedAt ||
          prior.star_rating !== rating ||
          prior.comment !== comment ||
          prior.is_answered !== nextAnswered ||
          prior.status !== 'active';

        if (!changed) { unchanged++; continue; }
        updated++;
      } else {
        created++;
      }

      toWrite.push({
        location_id: locationId,
        account_id: location.account_id,
        user_id: location.user_id,
        review_resource_name: review.name,
        star_rating: rating,
        comment,
        google_created_at: review.createTime ?? googleUpdatedAt,
        google_updated_at: googleUpdatedAt,
        status: 'active',
        is_answered: prior ? (prior.is_answered || isAnswered) : isAnswered,
        answered_at: isAnswered ? (review.reviewReply?.updateTime ?? now) : null,
        last_synced_at: now,
      });
    }

    await this.repo.upsertReviews(toWrite);

    /* Verschwundene Bewertungen erkennen.
       Nur beim vollen Lauf: inkrementell haben wir bewusst nur einen
       Ausschnitt geholt, alles Nichtgesehene wäre ein Fehlschluss. */
    let markedDeleted = 0;
    if (mode === 'full') {
      const vanished = [...existing.entries()]
        .filter(([name, row]) => !seen.has(name) && row.status === 'active')
        .map(([, row]) => row.id);
      markedDeleted = await this.repo.markDeletedUpstream(locationId, vanished);
    }

    await this.repo.markLocationSynced(locationId, { averageRating, totalReviewCount });

    const result: SyncResult = {
      locationId, mode,
      fetched: reviews.length,
      created, updated, unchanged, markedDeleted, skipped,
      averageRating, totalReviewCount,
      durationMs: Date.now() - startedAt,
    };

    this.log.debug('sync_done', { ...result });

    await writeAuditLog({
      userId: location.user_id,
      actorType: 'system',
      action: 'reviews.synced',
      entityType: 'google_location',
      entityId: locationId,
      metadata: { ...result },
    });

    return result;
  }
}

/* ─────────────────────────────────────────────
   VERÖFFENTLICHUNG VON ANTWORTEN

   Ablauf über die Statuskette in review_replies:

     draft      Entwurf der KI, vom Nutzer bearbeitbar
     approved   Nutzer hat bestätigt → Job wird eingereiht
     publishing Worker hat übernommen (atomar, siehe RPC)
     published  bei Google sichtbar
     failed     endgültig gescheitert, Nutzer muss ran

   Der Übergang approved → publishing ist der einzige Punkt, an dem
   Nebenläufigkeit weh tut: Google überschreibt eine bestehende
   Antwort kommentarlos, und zwei Zeilen auf 'published' verhindert
   der Partial-Unique-Index. Deshalb übernimmt ein bedingtes UPDATE
   in der Datenbank, nicht der Code.
───────────────────────────────────────────── */

interface ReplyRow {
  id: string;
  review_id: string;
  location_id: string;
  user_id: string;
  body: string;
  source: 'ai' | 'human' | 'template';
  model: string | null;
  status: 'draft' | 'approved' | 'publishing' | 'published' | 'failed';
  published_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface PublishOutcome {
  replyId: string;
  reviewId: string;
  published: boolean;
  publishedAt?: string;
  skippedReason?: 'not_approved' | 'already_published';
  error?: { code: string; permanent: boolean };
}

class ReplyPublisher {
  constructor(
    private readonly log: Logger,
    private readonly db = adminClient(),
  ) {}

  async publish(replyId: string): Promise<PublishOutcome> {
    /* ── 1. Übernehmen ──
       Bedingtes UPDATE approved → publishing. Gibt es keine Zeile
       zurück, war ein anderer Worker schneller oder der Nutzer hat
       den Entwurf inzwischen geändert. Beides kein Fehler. */
    const { data: claimed, error: claimError } = await this.db
      .rpc('claim_reply_for_publishing', { p_reply_id: replyId });

    if (claimError) {
      throw new GbpError('internal_error', 'Antwort nicht übernehmbar', { cause: claimError });
    }
    if (!claimed) {
      this.log.warn('publish_skipped', { replyId, reason: 'not_approved' });
      return { replyId, reviewId: '', published: false, skippedReason: 'not_approved' };
    }

    const reply = claimed as ReplyRow;

    try {
      /* ── 2. Kontext laden ──
         Die v4-API braucht den vollen Ressourcennamen der Bewertung;
         der steht in google_reviews. */
      const context = await this.loadContext(reply);

      /* ── 3. Bei Google veröffentlichen ── */
      const client = createGbpClient(reply.user_id, context.accountId);
      const googleReply = await client.replyToReview(context.reviewResourceName, reply.body);

      /* ── 4. Googles Antwort übernehmen ──
         updateTime ist der Zeitpunkt, den Google gesetzt hat — nicht
         unsere Uhr. Bei einer späteren Synchronisation vergleichen wir
         genau dagegen; nähmen wir hier now(), würde der nächste Lauf
         die Bewertung fälschlich als geändert werten. */
      const publishedAt = googleReply.updateTime ?? new Date().toISOString();

      const { error: completeError } = await this.db
        .rpc('complete_reply_publication', { p_reply_id: reply.id, p_published_at: publishedAt });

      if (completeError) {
        // Bei Google veröffentlicht, lokal nicht vermerkt. Der
        // Review-Sync korrigiert das beim nächsten Lauf, weil er
        // reviewReply sieht und is_answered setzt.
        this.log.error('publish_recorded_failed', {
          replyId: reply.id, message: completeError.message,
        });
        throw new GbpError('internal_error', 'Veröffentlichung nicht vermerkbar', {
          cause: completeError,
        });
      }

      /* Zuordnung statt Vermutung.
         Die empfohlene Handlung ist in unserem Produkt passiert —
         also lässt sich die Empfehlung nachweislich als erledigt
         verbuchen, statt es aus ihrem späteren Verschwinden zu
         schliessen. Genau diese Unterscheidung macht die Auswertung
         später aussagekräftig. */
      try {
        await this.db.rpc('complete_recommendations_for', {
          p_user_id: reply.user_id,
          p_types: ['review.negative_unanswered', 'reviews.negative_batch', 'reviews.unanswered'],
          p_subject_id: reply.review_id,
        });
        // Sammelempfehlungen ohne Bezug zur einzelnen Bewertung:
        // nur schliessen, wenn nichts mehr offen ist — das erledigt
        // der nächste Engine-Lauf.
      } catch (err) {
        logError('publish.attribute', err, { replyId: reply.id });
      }

      await writeAuditLog({
        userId: reply.user_id,
        action: 'reply.published',
        entityType: 'review_reply',
        entityId: reply.id,
        metadata: {
          reviewId: reply.review_id,
          source: reply.source,
          model: reply.model,
          characterCount: reply.body.length,
          publishedAt,
        },
      });

      this.log.debug('publish_ok', { replyId: reply.id, reviewId: reply.review_id });
      return { replyId: reply.id, reviewId: reply.review_id, published: true, publishedAt };

    } catch (err) {
      const gbpError = toGbpError(err);

      /* ── 5. Fehler einordnen ──
         Wiederholbar sind nur Quota und Serverfehler. Alles andere —
         abgelaufene Verbindung, gelöschte Bewertung, abgelehnter Text —
         wird durch Wiederholen nicht besser und landet sofort auf
         'failed', damit der Nutzer es im Dashboard sieht. */
      const permanent = !(
        gbpError.code === 'rate_limited' ||
        (gbpError.code === 'google_api_error' && gbpError.retryable)
      );

      await this.db.rpc('fail_reply_publication', {
        p_reply_id: reply.id,
        p_error_code: gbpError.code,
        p_error_message: gbpError.message,
        p_permanent: permanent,
      });

      await writeAuditLog({
        userId: reply.user_id,
        actorType: 'system',
        action: 'reply.publish_failed',
        entityType: 'review_reply',
        entityId: reply.id,
        metadata: { code: gbpError.code, permanent, reviewId: reply.review_id },
      });

      this.log.error('publish_failed', {
        replyId: reply.id, code: gbpError.code, permanent,
      });

      // Weiterwerfen, damit der Scheduler den Job entsprechend
      // abschliesst und gegebenenfalls wiederholt.
      throw gbpError;
    }
  }

  /** Zieht eine veröffentlichte Antwort bei Google zurück. */
  async retract(replyId: string, userId: string): Promise<void> {
    const { data, error } = await this.db
      .from('review_replies').select('*')
      .eq('id', replyId).eq('user_id', userId)
      .eq('status', 'published').is('deleted_at', null).maybeSingle();

    if (error) throw new GbpError('internal_error', 'Antwort nicht ladbar', { cause: error });
    if (!data) throw new GbpError('not_found', 'Keine veröffentlichte Antwort gefunden');

    const reply = data as ReplyRow;
    const context = await this.loadContext(reply);

    const client = createGbpClient(reply.user_id, context.accountId);
    await client.deleteReviewReply(context.reviewResourceName);

    const { error: retractError } = await this.db.rpc('retract_reply', { p_reply_id: reply.id });
    if (retractError) {
      throw new GbpError('internal_error', 'Rückzug nicht vermerkbar', { cause: retractError });
    }

    await writeAuditLog({
      userId, action: 'reply.retracted',
      entityType: 'review_reply', entityId: reply.id,
      metadata: { reviewId: reply.review_id },
    });
  }

  /**
   * Bewertung und Standort zur Antwort. Liefert den Ressourcennamen
   * im Format, das die v4-API erwartet.
   */
  private async loadContext(reply: ReplyRow): Promise<{
    reviewResourceName: string; accountId: string;
  }> {
    const { data, error } = await this.db
      .from('google_reviews')
      .select('review_resource_name, account_id, status')
      .eq('id', reply.review_id).maybeSingle();

    if (error) throw new GbpError('internal_error', 'Bewertung nicht ladbar', { cause: error });
    if (!data) throw new GbpError('not_found', 'Bewertung nicht gefunden');

    const review = data as { review_resource_name: string; account_id: string; status: string };

    // Auf eine bei Google gelöschte Bewertung kann nicht geantwortet
    // werden. Ohne diese Prüfung liefe der Aufruf in ein 404 und würde
    // sinnlos wiederholt.
    if (review.status !== 'active') {
      throw new GbpError('not_found', 'Bewertung existiert bei Google nicht mehr', {
        context: { reviewId: reply.review_id, status: review.status },
      });
    }

    return {
      reviewResourceName: review.review_resource_name,
      accountId: review.account_id,
    };
  }
}

/* ─────────────────────────────────────────────
   STANDORT-SYNCHRONISATION

   Der Anfang der Kette. Ohne diesen Schritt bleibt google_locations
   leer, und der Review-Sync hat nichts, worauf er laufen könnte.

   Holt für ein Konto alle Google-Business-Konten samt Standorten und
   schreibt sie fort. Ein Google-Login kann mehrere Konten verwalten
   (eigenes plus Standortgruppen), deshalb die doppelte Schleife.
───────────────────────────────────────────── */

interface LocationSyncResult {
  accountId: string;
  googleAccounts: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  markedDeleted: number;
  durationMs: number;
}

class LocationSyncService {
  constructor(
    private readonly log: Logger,
    private readonly db = adminClient(),
  ) {}

  async syncAccount(accountId: string, userId: string): Promise<LocationSyncResult> {
    const startedAt = Date.now();
    const client = createGbpClient(userId, accountId);

    const googleAccounts = await client.getAccounts();

    /* Bestehende Standorte einlesen, um Neues von Geändertem zu
       trennen und Verschwundenes zu erkennen. */
    const { data: existingRows, error: existingError } = await this.db
      .from('google_locations')
      .select('id, location_resource_name, title, locality, postal_code, primary_phone, website_uri, place_id, deleted_at')
      .eq('account_id', accountId);

    if (existingError) {
      throw new GbpError('internal_error', 'Standorte nicht ladbar', { cause: existingError });
    }

    const existing = new Map<string, Record<string, unknown>>();
    for (const row of existingRows ?? []) {
      existing.set((row as { location_resource_name: string }).location_resource_name, row);
    }

    const seen = new Set<string>();
    const toWrite: Array<Record<string, unknown>> = [];
    let created = 0, updated = 0, unchanged = 0, fetched = 0;
    const now = new Date().toISOString();

    for (const googleAccount of googleAccounts) {
      // Sequenziell über die Konten: die Business-Profile-APIs sind
      // eng quotiert und quittieren Bursts mit 429.
      const locations = await client.getLocations(googleAccount.name);
      fetched += locations.length;

      for (const location of locations) {
        seen.add(location.name);
        const prior = existing.get(location.name);

        const address = location.storefrontAddress as {
          addressLines?: string[]; locality?: string;
          postalCode?: string; regionCode?: string;
        } | undefined;

        const fields = {
          title:            location.title ?? null,
          address:          address?.addressLines?.join(', ') ?? null,
          locality:         address?.locality ?? null,
          postal_code:      address?.postalCode ?? null,
          region_code:      address?.regionCode ?? null,
          primary_phone:    location.phoneNumbers?.primaryPhone ?? null,
          website_uri:      location.websiteUri ?? null,
          place_id:         location.metadata?.placeId ?? null,
        };

        if (prior) {
          // Nur schreiben, wenn sich etwas geändert hat. Sonst würde
          // jeder Lauf jede Zeile anfassen und updated_at entwerten.
          const changed = (Object.keys(fields) as Array<keyof typeof fields>).some(
            (key) => prior[key] !== fields[key],
          ) || prior.deleted_at !== null;

          if (!changed) { unchanged++; continue; }
          updated++;
        } else {
          created++;
        }

        toWrite.push({
          account_id: accountId,
          user_id: userId,
          account_resource_name:  googleAccount.name,
          location_resource_name: location.name,
          ...fields,
          // Ein zuvor als gelöscht markierter Standort, der wieder
          // auftaucht, wird reaktiviert.
          deleted_at: null,
          // last_synced_at, NICHT synced_at: die Spalte synced_at
          // stammt aus Migration 001 und wird von niemandem gelesen.
          // schedule_all_syncs() und der Review-Sync richten sich nach
          // last_synced_at — schriebe der Standort-Sync die falsche
          // Spalte, blieben die Standorte für den Planer für immer
          // "noch nie synchronisiert".
          last_synced_at: now,
        });
      }
    }

    if (toWrite.length > 0) {
      const { error } = await this.db
        .from('google_locations')
        .upsert(toWrite, { onConflict: 'account_id,location_resource_name' });

      if (error) {
        throw new GbpError('internal_error', 'Standorte nicht speicherbar', { cause: error });
      }
    }

    /* Verschwundene Standorte weich löschen.
       Kein hartes DELETE: daran hängen Bewertungen und Antworten, und
       ein Standort verschwindet auch mal vorübergehend, wenn Google
       ihn zur Prüfung aussetzt. */
    const vanished = [...existing.entries()]
      .filter(([name, row]) => !seen.has(name) && row.deleted_at === null)
      .map(([, row]) => row.id as string);

    let markedDeleted = 0;
    if (vanished.length > 0) {
      const { error } = await this.db
        .from('google_locations')
        .update({ deleted_at: now })
        .in('id', vanished);

      if (error) {
        this.log.error('mark_deleted_failed', { accountId, message: error.message });
      } else {
        markedDeleted = vanished.length;
      }
    }

    /* Genau einen Hauptstandort sicherstellen — das Dashboard und
       getActiveConnection() richten sich danach. */
    await this.ensurePrimary(userId);

    const result: LocationSyncResult = {
      accountId,
      googleAccounts: googleAccounts.length,
      fetched, created, updated, unchanged, markedDeleted,
      durationMs: Date.now() - startedAt,
    };

    this.log.debug('location_sync_done', { ...result });

    await writeAuditLog({
      userId, actorType: 'system',
      action: 'locations.synced',
      entityType: 'google_account', entityId: accountId,
      metadata: { ...result },
    });

    return result;
  }

  /** Setzt den ältesten aktiven Standort als Haupt, falls keiner gesetzt ist. */
  private async ensurePrimary(userId: string): Promise<void> {
    const { data: primary } = await this.db
      .from('google_locations').select('id')
      .eq('user_id', userId).eq('is_primary', true)
      .is('deleted_at', null).maybeSingle();

    if (primary) return;

    const { data: candidate } = await this.db
      .from('google_locations').select('id')
      .eq('user_id', userId).is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1).maybeSingle();

    if (candidate) {
      await this.db.from('google_locations')
        .update({ is_primary: true })
        .eq('id', (candidate as { id: string }).id);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   INTELLIGENCE ENGINE

   Fünf Schichten, jede mit einer Aufgabe:

     1  FAKTEN         objektive Zahlen, keine Deutung
     2  BEOBACHTUNGEN  was ist passiert
     3  EMPFEHLUNGEN   was ist zu tun
     4  PRIORISIERUNG  was zuerst
     5  KOMMUNIKATION  über welchen Kanal

   Der Regelkatalog (§ 6) ist das Herz. Regeln sind Daten, keine
   if-Zweige: Struktur im Code, Zahlen in der Datenbank. Wer in einem
   Jahr feststellt, dass 80 Prozent Antwortquote zu niedrig sind,
   ändert eine Tabellenzeile — kein Deployment, keine zehn Stellen.

   WARUM NICHT YAML
   Eine externe Regeldatei bräuchte einen Parser und würde die
   Typprüfung kosten. Solange nur Entwickler Regeln schreiben, ist ein
   typisiertes Array die bessere Datei. Die Zahlen, die tatsächlich
   getunt werden, liegen ohnehin in engine_thresholds.

   KI KOMMT HIER NICHT VOR
   Jede Regel ist deterministisch: gleiche Fakten, gleiches Ergebnis.
   KI verarbeitet Freitext — Bewertungstexte zusammenfassen,
   Antwortentwürfe schreiben — und läuft getrennt in
   generate-review-reply. Eine Empfehlung, deren Zustandekommen von
   einem Modell abhängt, liesse sich nicht erklären.
═══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────
   § 1  MODELLE
───────────────────────────────────────────── */

/** Woher die Fakten stammen. Nur diese Schicht kennt die Quelle. */
type DataSource = 'google_business' | 'search_console' | 'manual';

type ActionCategory = 'reviews' | 'profile' | 'connection' | 'visibility';

/**
 * Fünf Stufen statt einer Zahl — für Menschen.
 * Die Sortierung passiert über `weight`, weil fünf Stufen bei
 * zwanzig Empfehlungen keine Reihenfolge ergeben.
 */
type Priority = 'critical' | 'high' | 'medium' | 'low' | 'later';

/**
 * Fassung der Engine.
 *
 * Bei jeder Änderung an Regeln, Gewichtung oder Schwellen-Auswertung
 * hochzählen. Ohne sie lässt sich nach einer Anpassung nicht sagen,
 * ob eine Verbesserung von der Änderung kam oder vom Zufall — die
 * Auswertung vergleicht dann Äpfel mit Birnen.
 *
 * Format: Datum.Nummer. Lesbar, sortierbar, ohne Werkzeug pflegbar.
 */
const ENGINE_VERSION = '2026-09-10.2';

/**
 * Änderungsverzeichnis.
 *
 * Steht doppelt: hier und in der Tabelle engine_versions. Das ist
 * Absicht — hier lesbar beim Programmieren, dort verknüpfbar mit den
 * Empfehlungen, die eine Fassung erzeugt hat. Wer eine Fassung
 * hinzufügt, ergänzt beide; die Prüfung beim Start meldet, wenn eine
 * fehlt.
 */
const ENGINE_CHANGELOG: Array<{ version: string; changes: string[] }> = [
  {
    version: '2026-09-10.2',
    changes: [
      'Regel-Lebenszyklus: active, candidate, deprecated, retired',
      'Regelfassung auf jedem Ereignis',
      'Wirkungsmessung je Regel',
      'Regel-Dokumentation im Katalog',
    ],
  },
  {
    version: '2026-09-10.1',
    changes: [
      'Erste regelbasierte Fassung',
      'Schwellwerte nach engine_thresholds',
      'Sicherheitswert und Herleitung je Empfehlung',
    ],
  },
];

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 90, high: 70, medium: 45, low: 25, later: 10,
};

/**
 * Wie sicher die Engine ist.
 *
 *   1.00  reine Tatsache — "diese Bewertung hat keine Antwort"
 *   0.85  Ableitung aus vollständigen Daten
 *   0.70  Ableitung mit Annahme (Erfahrungswert statt Messung)
 *   0.50  Untergrenze; darunter wird nicht empfohlen
 *
 * Eine unsichere Empfehlung ist schlimmer als keine: Sie kostet das
 * Vertrauen, das man für die sicheren braucht.
 */
type Confidence = number;

/** Was das Konto können muss, damit die Empfehlung ausführbar ist. */
type Capability = 'reviews.reply' | 'profile.write' | 'photos.write' | 'none';

/** Objektive Zahlen. Keine Deutung, keine Schwellwerte. */
interface Facts {
  source: DataSource;
  userId: string;
  observedAt: string;

  connection: {
    exists: boolean;
    status: string | null;
    lastErrorCode: string | null;
  };

  reviews: {
    total: number;
    unanswered: number;
    averageRating: number | null;
    responseRate: number | null;      // 0..1, null wenn keine Bewertungen
    newestAt: string | null;
    daysSinceNewest: number | null;
    last7d: number;
    last30d: number;
    /** Offene mit niedriger Bewertung, einzeln. */
    negativeOpen: Array<{
      id: string; rating: number; createdAt: string;
      reviewer: string | null; ageHours: number;
    }>;
  };

  replies: { draft: number; approved: number; published: number; failed: number };

  profile: {
    locationCount: number;
    /** Je Standort: welche Pflichtangaben fehlen. */
    incomplete: Array<{ id: string; title: string | null; missing: string[] }>;
    completeness: number;             // 0..1 über alle Standorte
    photoCount: number;
  };

  health: { score: number; previous: number | null; factors: Record<string, number> };

  operations: { syncFailedRecently: boolean; lastSyncedAt: string | null };
}

/** Was passiert ist. Ohne Handlungsaufforderung. */
interface Insight {
  ruleId: string;
  category: ActionCategory;
  text: string;
  confidence: Confidence;
  facts: string[];                    // welche Faktenfelder es stützen
}

/** Was zu tun ist. */
interface Recommendation {
  ruleId: string;
  source: DataSource;
  type: string;
  category: ActionCategory;

  priority: Priority;
  /** Feinsortierung innerhalb einer Stufe. */
  weight: number;
  confidence: Confidence;

  title: string;
  summary: string;
  reason: string;
  expectedBenefit: string;
  estimatedEffort: string;
  estimatedMinutes: number;

  actionUrl: string;
  capability: Capability;
  isDismissable: boolean;

  subjectType?: string;
  subjectId?: string | null;
  data?: Record<string, unknown>;
  expiresAt?: string;

  /* Fassung und Status der Regel. Machen alte Empfehlungen
     nachvollziehbar, auch wenn die Regel sich seither geändert hat. */
  ruleVersion: string;
  ruleStatus: RuleStatus;
  /** Objektive Kennzahl für die Wirkungsmessung. */
  impactMetric?: string;

  /** Herleitung. Wird im Frontend angezeigt. */
  explanation: {
    sourceFacts: string[];
    triggeredRule: string;
    reason: string;
    expectedOutcome: string;
  };

  channels: { dashboard: boolean; weeklyEmail: boolean; notification: boolean };
}

/** Stellschrauben aus engine_thresholds. */
type Thresholds = Record<string, number>;

/* ─────────────────────────────────────────────
   § 2  REGELMODELL

   Eine Regel beschreibt sich selbst. Wer wissen will, warum eine
   Empfehlung erscheint, liest genau einen Eintrag — nicht neun
   if-Zweige über drei Dateien.
───────────────────────────────────────────── */

interface RuleContext {
  facts: Facts;
  /** Schwellwerte. Immer über t(), nie als Literal im Code. */
  t: (key: string) => number;
}

/**
 * Regeln, die sich auf ein einzelnes Objekt beziehen (eine Bewertung,
 * einen Standort), liefern hier die Objekte. Für jedes entsteht eine
 * eigene Empfehlung.
 */
interface RuleSubject {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Lebenszyklus einer Regel.
 *
 *   active      läuft und wird angezeigt
 *   candidate   läuft, wird NICHT angezeigt — Probebetrieb
 *   deprecated  läuft noch, soll ersetzt werden
 *   retired     läuft nicht mehr
 *
 * 'candidate' ist der wichtigste Zustand: Eine neue Regel erzeugt
 * Ereignisse, die niemand sieht. Nach zwei Wochen zeigt
 * ops_candidate_rules, wie viele es gewesen wären — bevor ein Kunde
 * eine unausgereifte Empfehlung bekommt.
 *
 * 'retired' statt Löschen, weil alte Ereignisse auf ihre Regel
 * verweisen. Ohne sie wäre die Herleitung weg — und damit die
 * Erklärbarkeit, die Bedingung für das ganze Regelwerk war.
 */
type RuleStatus = 'active' | 'candidate' | 'deprecated' | 'retired';

/**
 * Dokumentation einer Regel. Nur für Entwickler — erscheint nie beim
 * Kunden.
 *
 * Der Grund für dieses Feld: In zwei Jahren steht jemand vor einer
 * Regel und fragt, warum sie so ist. `purpose` und `rationale`
 * beantworten das; ein Kommentar im Code würde beim Umbau verloren
 * gehen.
 */
interface RuleMeta {
  title: string;
  /** Was die Regel erkennt. */
  purpose: string;
  /** Warum das für einen Handwerksbetrieb zählt. */
  rationale: string;
  createdAt: string;
  author: string;
  /** Bei inhaltlicher Änderung hochzählen, nicht bei Textkorrekturen. */
  version: string;
  /** Regeln, die dieselbe Sache anders zuschneiden. */
  related?: string[];
  /** Was diese Regel ersetzt hat. Nur bei deprecated/retired. */
  supersedes?: string[];
}

interface Rule {
  id: string;
  source: DataSource;
  category: ActionCategory;
  /** Was das Konto können muss. Fehlt es, wird nicht empfohlen. */
  capability: Capability;

  status: RuleStatus;
  meta: RuleMeta;

  /**
   * Objektive Kennzahl, die diese Empfehlung bewegen soll.
   *
   * Wird bei Erledigung festgehalten und nach einer Woche erneut
   * gelesen. Der Rahmen behauptet KEINE Ursache — er zeigt nur, wie
   * sich die Zahl entwickelt hat.
   */
  impactMetric?: string;

  /** Kurz, für Logs und die Herleitung im Frontend. */
  describes: string;

  /** Trifft die Regel zu? Rein, deterministisch, ohne Seiteneffekt. */
  when: (ctx: RuleContext) => boolean;

  /** Bezugsobjekte. Fehlt die Funktion, gilt die Regel für den Nutzer. */
  subjects?: (ctx: RuleContext) => RuleSubject[];

  /** Was passiert ist. Erscheint als Beobachtung. */
  insight: (ctx: RuleContext, subject?: RuleSubject) => string;

  /** Was zu tun ist. Fehlt es, entsteht nur eine Beobachtung. */
  recommend?: (ctx: RuleContext, subject?: RuleSubject) => {
    type: string;
    title: string;
    summary: string;
    reason: string;
    expectedBenefit: string;
    estimatedMinutes: number;
    actionUrl: string;
    priority: Priority;
    confidence: Confidence;
    isDismissable?: boolean;
    expiresAt?: string;
    /** Welche Faktenfelder die Regel gelesen hat. */
    sourceFacts: string[];
  };
}

/* ─────────────────────────────────────────────
   § 3  SCHICHT 1 — FAKTEN

   Die einzige Stelle, die weiss, woher die Daten kommen. Kommt
   Search Console dazu, entsteht hier ein zweiter Übersetzer — die
   Regeln darunter merken davon nichts.

   Keine Deutung: `responseRate: 0.62` ist eine Tatsache,
   `responseRateIsLow: true` wäre schon eine Regel.
───────────────────────────────────────────── */

/**
 * Der Rohkontext aus build_evaluation_context().
 *
 * Bewusst getrennt von Facts: Das hier ist die Form, in der Postgres
 * liefert. Facts ist die Form, mit der Regeln arbeiten. Kommt eine
 * zweite Quelle dazu, bekommt sie ihren eigenen Rohtyp und ihren
 * eigenen Übersetzer — Facts bleibt.
 */
interface EvaluationContext {
  userId: string;
  now: string;
  connection: {
    status: string; providerEmail: string | null;
    lastErrorAt: string | null; lastErrorCode: string | null;
  } | null;
  locations: Array<{
    id: string; title: string | null; locality: string | null;
    phone: string | null; website: string | null; category: string | null;
    lastSyncedAt: string | null; reviewCount: number; averageRating: number | null;
  }>;
  reviews: {
    total: number; unanswered: number; averageRating: number | null;
    newestAt: string | null; last7d: number; last30d: number;
  } | null;
  lowRatedOpen: Array<{
    id: string; rating: number; createdAt: string;
    reviewer: string | null; locationId: string;
  }>;
  replies: { draft: number; approved: number; published: number; failed: number } | null;
  photoCount: number;
  health: { score: number; factors: Record<string, number> };
  previousHealth: number | null;
  syncFailed: boolean;
}

const hoursBetween = (from: string, to: string) =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 36e5);

const daysSince = (from: string | null, now: string) =>
  from === null ? null : Math.floor((new Date(now).getTime() - new Date(from).getTime()) / 864e5);

/** Übersetzt den Rohkontext aus Postgres in Fakten. */
function buildFacts(ctx: EvaluationContext): Facts {
  const now = ctx.now;
  const reviews = ctx.reviews;
  const total = reviews?.total ?? 0;
  const unanswered = reviews?.unanswered ?? 0;

  const incomplete = ctx.locations.flatMap((location) => {
    const missing = [
      !location.phone    && 'Telefonnummer',
      !location.website  && 'Website',
      !location.locality && 'Adresse',
      !location.category && 'Kategorie',
    ].filter(Boolean) as string[];
    return missing.length > 0
      ? [{ id: location.id, title: location.title, missing }]
      : [];
  });

  const fieldsTotal   = ctx.locations.length * 4;
  const fieldsMissing = incomplete.reduce((sum, l) => sum + l.missing.length, 0);

  return {
    source: 'google_business',
    userId: ctx.userId,
    observedAt: now,

    connection: {
      exists: !!ctx.connection,
      status: ctx.connection?.status ?? null,
      lastErrorCode: ctx.connection?.lastErrorCode ?? null,
    },

    reviews: {
      total,
      unanswered,
      averageRating: reviews?.averageRating ?? null,
      responseRate: total > 0 ? (total - unanswered) / total : null,
      newestAt: reviews?.newestAt ?? null,
      daysSinceNewest: daysSince(reviews?.newestAt ?? null, now),
      last7d: reviews?.last7d ?? 0,
      last30d: reviews?.last30d ?? 0,
      negativeOpen: ctx.lowRatedOpen.map((r) => ({
        id: r.id, rating: r.rating, createdAt: r.createdAt,
        reviewer: r.reviewer, ageHours: hoursBetween(r.createdAt, now),
      })),
    },

    replies: ctx.replies ?? { draft: 0, approved: 0, published: 0, failed: 0 },

    profile: {
      locationCount: ctx.locations.length,
      incomplete,
      completeness: fieldsTotal > 0 ? (fieldsTotal - fieldsMissing) / fieldsTotal : 0,
      photoCount: ctx.photoCount,
    },

    health: {
      score: ctx.health?.score ?? 0,
      previous: ctx.previousHealth,
      factors: ctx.health?.factors ?? {},
    },

    operations: {
      syncFailedRecently: ctx.syncFailed,
      lastSyncedAt: ctx.locations[0]?.lastSyncedAt ?? null,
    },
  };
}

/* ─────────────────────────────────────────────
   § 4  REGELKATALOG

   Jede Regel steht für sich und lässt sich einzeln testen: Fakten
   rein, Ergebnis raus.

   Alle Zahlen kommen über t() aus engine_thresholds. Ein Literal in
   einer Bedingung ist ein Fehler — es wäre genau die Stelle, die man
   in einem Jahr nicht mehr findet.
───────────────────────────────────────────── */

const RULES: Rule[] = [

  /* ── Verbindung ── */
  {
    id: 'connection.missing',
    status: 'active',
    meta: {
      title: 'Verbindung fehlt',
      purpose: 'Erkennt, dass noch kein Google-Konto verknüpft ist.',
      rationale: 'Ohne Verbindung ist das Produkt wirkungslos. Die wichtigste Empfehlung überhaupt.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    /* Verbinden hebt keine einzelne Kennzahl — es macht alle erst
       messbar. Der Profilwert ist die einzige, die das abbildet. */
    impactMetric: 'health.score',
    source: 'google_business',
    category: 'connection',
    capability: 'none',
    describes: 'Kein Google-Konto verbunden',
    when: ({ facts }) => !facts.connection.exists,
    insight: () => 'Es ist noch kein Google-Profil verbunden.',
    recommend: () => ({
      type: 'connection.missing',
      title: 'Google-Profil verbinden',
      summary: 'Ohne Verbindung sieht WERKRUF dein Profil nicht.',
      reason: 'Ohne Verbindung gibt es keine Bewertungen, keine Meldungen und keine Vorschläge.',
      expectedBenefit: 'Danach läuft die Überwachung ohne dein Zutun',
      estimatedMinutes: 2,
      actionUrl: '/dashboard/google',
      priority: 'critical',
      // Tatsache, keine Ableitung.
      confidence: 1.0,
      isDismissable: false,
      sourceFacts: ['connection.exists'],
    }),
  },

  {
    id: 'connection.lost',
    status: 'active',
    meta: {
      title: 'Verbindung abgerissen',
      purpose: 'Erkennt widerrufene oder abgelaufene Berechtigungen.',
      rationale: 'Ein Ausfall des bezahlten Dienstes. Der Betrieb merkt es sonst erst Wochen später.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'health.score',
    source: 'google_business',
    category: 'connection',
    capability: 'none',
    describes: 'Verbindung widerrufen oder abgelaufen',
    when: ({ facts }) =>
      facts.connection.exists &&
      (facts.connection.status === 'needs_reauth' || facts.connection.status === 'revoked'),
    insight: () => 'Die Verbindung zu Google ist abgerissen.',
    recommend: () => ({
      type: 'connection.lost',
      title: 'Verbindung erneuern',
      summary: 'Seitdem kommen keine neuen Bewertungen an.',
      reason: 'Freigegebene Antworten werden nicht übertragen, und neue Bewertungen erscheinen nicht im Dashboard.',
      expectedBenefit: 'Überwachung und Veröffentlichung laufen wieder',
      estimatedMinutes: 1,
      actionUrl: '/dashboard/google',
      priority: 'critical',
      confidence: 1.0,
      isDismissable: false,
      sourceFacts: ['connection.status'],
    }),
  },

  /* ── Schlechte Bewertungen, einzeln ──
     Der Bezug zur konkreten Bewertung IST die Information.
     "Drei schlechte Bewertungen" sagt weniger als "Frau Meier,
     ein Stern, gestern". Gebündelt wird erst ab der Schwelle. ── */
  {
    id: 'review.negative_unanswered',
    status: 'active',
    meta: {
      title: 'Schlechte Bewertung ohne Antwort',
      purpose: 'Findet offene Bewertungen mit niedriger Sternzahl, einzeln.',
      rationale: 'Der Bezug zur konkreten Bewertung ist die Information. Unbeantwortete Kritik wirkt stärker als beantwortete.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'reviews.unansweredCount',
    source: 'google_business',
    category: 'reviews',
    capability: 'reviews.reply',
    describes: 'Schlechte Bewertung ohne Antwort',
    when: ({ facts, t }) =>
      facts.reviews.negativeOpen.length > 0 &&
      facts.reviews.negativeOpen.length < t('review.negative_batch_from'),
    subjects: ({ facts, t }) => facts.reviews.negativeOpen
      .filter((r) => r.rating <= t('review.negative_max_stars'))
      .map((r) => ({
        id: r.id,
        type: 'review',
        data: { rating: r.rating, ageHours: r.ageHours, reviewer: r.reviewer },
      })),
    insight: (_, subject) =>
      `Eine Bewertung mit ${subject?.data.rating} ${subject?.data.rating === 1 ? 'Stern' : 'Sternen'} wartet auf eine Antwort.`,
    recommend: ({ t }, subject) => {
      const ageHours = Number(subject?.data.ageHours ?? 0);
      const urgent = ageHours >= t('review.negative_urgent_hours');
      const reviewer = subject?.data.reviewer as string | null;

      return {
        type: 'review.negative_unanswered',
        title: `${subject?.data.rating}-Sterne-Bewertung beantworten`,
        summary: reviewer
          ? `Von ${reviewer}, vor ${Math.round(ageHours / 24) || 'weniger als einem'} ${ageHours < 24 ? 'Tag' : 'Tagen'}.`
          : `Eingegangen vor ${Math.round(ageHours / 24) || 'weniger als einem'} ${ageHours < 24 ? 'Tag' : 'Tagen'}.`,
        reason: urgent
          ? `Die Bewertung steht seit über ${Math.round(t('review.negative_urgent_hours') / 24)} ${t('review.negative_urgent_hours') >= 48 ? 'Tagen' : 'Stunden'} unbeantwortet.`
          : 'Sie ist neu und noch unbeantwortet.',
        expectedBenefit: 'Interessenten sehen, dass der Betrieb auf Kritik eingeht',
        estimatedMinutes: 2,
        actionUrl: '/dashboard/bewertungen',
        /* Frisch heisst dringend: eine Bewertung von gestern kann man
           noch einfangen, eine von vor drei Monaten hat ihren Schaden
           angerichtet. */
        priority: urgent ? 'critical' : 'high',
        confidence: 1.0,
        sourceFacts: ['reviews.negativeOpen'],
      };
    },
  },

  /* ── Dieselben, gebündelt ──
     Sich gegenseitig ausschliessend zur Regel darüber: Die
     Bedingungen sind komplementär, deshalb kann keine Bewertung
     zweimal auftauchen. Entdopplung an der Quelle statt hinterher. ── */
  {
    id: 'review.negative_batch',
    status: 'active',
    meta: {
      title: 'Mehrere schlechte Bewertungen',
      purpose: 'Bündelt offene schlechte Bewertungen ab einer Schwelle.',
      rationale: 'Drei einzelne sind drei Handlungen, sieben sind eine Liste — und Listen werden aufgeschoben.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'reviews.unansweredCount',
    source: 'google_business',
    category: 'reviews',
    capability: 'reviews.reply',
    describes: 'Mehrere schlechte Bewertungen ohne Antwort',
    when: ({ facts, t }) =>
      facts.reviews.negativeOpen.length >= t('review.negative_batch_from'),
    insight: ({ facts }) =>
      `${facts.reviews.negativeOpen.length} schlechte Bewertungen stehen ohne Antwort da.`,
    recommend: ({ facts }) => ({
      type: 'reviews.negative_batch',
      title: `${facts.reviews.negativeOpen.length} schlechte Bewertungen beantworten`,
      summary: 'Alle mit niedriger Sternzahl und ohne Antwort.',
      reason: 'Unbeantwortete Kritik wirkt auf Leser stärker als beantwortete.',
      expectedBenefit: 'Zu jeder liegt ein Vorschlag bereit',
      estimatedMinutes: facts.reviews.negativeOpen.length * 2,
      actionUrl: '/dashboard/bewertungen',
      priority: 'critical',
      confidence: 1.0,
      sourceFacts: ['reviews.negativeOpen'],
    }),
  },

  /* ── Antwortquote ──
     Zieht ab, was oben schon einzeln gemeldet ist. ── */
  {
    id: 'review.response_rate_low',
    status: 'active',
    meta: {
      title: 'Antwortquote unter Zielwert',
      purpose: 'Vergleicht die Antwortquote mit dem konfigurierten Ziel.',
      rationale: 'Die Quote ist das Einzige, was der Betrieb vollständig selbst in der Hand hat — und was ein Suchender direkt sieht.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'reviews.responseRate',
    source: 'google_business',
    category: 'reviews',
    capability: 'reviews.reply',
    describes: 'Antwortquote unter Zielwert',
    when: ({ facts, t }) =>
      facts.reviews.responseRate !== null &&
      facts.reviews.responseRate < t('review.response_rate_target') &&
      facts.reviews.unanswered > facts.reviews.negativeOpen.length,
    insight: ({ facts }) => {
      const pct = Math.round((facts.reviews.responseRate ?? 0) * 100);
      return `Von ${facts.reviews.total} Bewertungen sind ${pct} Prozent beantwortet.`;
    },
    recommend: ({ facts, t }) => {
      const remaining = facts.reviews.unanswered - facts.reviews.negativeOpen.length;
      const many = remaining >= t('review.unanswered_many');
      return {
        type: 'reviews.unanswered',
        title: remaining === 1
          ? 'Eine Bewertung beantworten'
          : `${remaining} Bewertungen beantworten`,
        summary: `Antwortquote bei ${Math.round((facts.reviews.responseRate ?? 0) * 100)} Prozent.`,
        reason: `Der Zielwert liegt bei ${Math.round(t('review.response_rate_target') * 100)} Prozent. Wer das Profil öffnet, sieht unbeantwortete Bewertungen sofort.`,
        expectedBenefit: 'Vorschläge liegen bereit, du gibst nur frei',
        estimatedMinutes: Math.max(2, remaining * 2),
        actionUrl: '/dashboard/bewertungen',
        priority: many ? 'high' : 'medium',
        confidence: 1.0,
        sourceFacts: ['reviews.responseRate', 'reviews.unanswered'],
      };
    },
  },

  {
    id: 'reply.publish_failed',
    status: 'active',
    meta: {
      title: 'Veröffentlichung gescheitert',
      purpose: 'Findet Antworten, die nicht an Google übertragen wurden.',
      rationale: 'Der Text ist geschrieben und unsichtbar. Behebbar mit einem Klick.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'reviews.unansweredCount',
    source: 'google_business',
    category: 'reviews',
    capability: 'reviews.reply',
    describes: 'Antwort konnte nicht veröffentlicht werden',
    when: ({ facts }) => facts.replies.failed > 0,
    insight: ({ facts }) =>
      `${facts.replies.failed} ${facts.replies.failed === 1 ? 'Antwort wurde' : 'Antworten wurden'} nicht an Google übertragen.`,
    recommend: ({ facts }) => ({
      type: 'replies.publish_failed',
      title: facts.replies.failed === 1
        ? 'Veröffentlichung erneut versuchen'
        : `${facts.replies.failed} Veröffentlichungen erneut versuchen`,
      summary: 'Der Text ist gespeichert, aber öffentlich nicht sichtbar.',
      reason: 'Die Übertragung an Google ist gescheitert. Ein zweiter Versuch genügt meistens.',
      expectedBenefit: 'Die Antwort wird öffentlich sichtbar',
      estimatedMinutes: 1,
      actionUrl: '/dashboard/bewertungen',
      priority: 'high',
      confidence: 1.0,
      sourceFacts: ['replies.failed'],
    }),
  },

  {
    id: 'reply.drafts_waiting',
    status: 'active',
    meta: {
      title: 'Entwürfe warten',
      purpose: 'Zählt Antwortentwürfe ohne Freigabe.',
      rationale: 'Bequemlichkeit, nicht Dringlichkeit. Steht bewusst niedrig.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'reviews.responseRate',
    source: 'google_business',
    category: 'reviews',
    capability: 'reviews.reply',
    describes: 'Entwürfe warten auf Freigabe',
    when: ({ facts }) => facts.replies.draft > 0,
    insight: ({ facts }) =>
      `${facts.replies.draft} ${facts.replies.draft === 1 ? 'Entwurf liegt' : 'Entwürfe liegen'} bereit.`,
    recommend: ({ facts }) => ({
      type: 'replies.drafts_waiting',
      title: facts.replies.draft === 1 ? 'Entwurf durchsehen' : `${facts.replies.draft} Entwürfe durchsehen`,
      summary: 'Geschrieben, aber noch nicht freigegeben.',
      reason: 'Veröffentlicht wird nichts ohne deine Freigabe.',
      expectedBenefit: 'Lesen, anpassen, freigeben',
      estimatedMinutes: facts.replies.draft,
      actionUrl: '/dashboard/bewertungen',
      priority: 'low',
      confidence: 1.0,
      sourceFacts: ['replies.draft'],
    }),
  },

  /* ── Bewertungsflaute ──
     Sicherheit unter 1: Die Aussage "wirkt aufgegeben" ist ein
     Erfahrungswert, keine gemessene Tatsache. Genau dafür gibt es
     das Feld. ── */
  {
    id: 'review.drought',
    status: 'active',
    meta: {
      title: 'Lange keine Bewertung',
      purpose: 'Erkennt, wenn seit langem keine Bewertung dazugekommen ist.',
      rationale: 'Ein Profil ohne frische Bewertungen wirkt älter, als es ist. Erfahrungswert, deshalb Sicherheit unter 1.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    /* Um Bewertungen bitten erhöht die ANZAHL, nicht den Schnitt.
       Wer den Durchschnitt als Kennzahl nähme, würde eine Regel
       schlecht aussehen lassen, die genau das tut, was sie soll. */
    impactMetric: 'reviews.totalCount',
    source: 'google_business',
    category: 'reviews',
    capability: 'none',
    describes: 'Lange keine neue Bewertung',
    when: ({ facts, t }) =>
      facts.reviews.daysSinceNewest !== null &&
      facts.reviews.daysSinceNewest >= t('review.drought_days'),
    insight: ({ facts }) =>
      `Seit ${facts.reviews.daysSinceNewest} Tagen ist keine neue Bewertung dazugekommen.`,
    recommend: ({ facts }) => ({
      type: 'reviews.drought',
      title: 'Kunden um eine Bewertung bitten',
      summary: `Die letzte kam vor ${Math.round((facts.reviews.daysSinceNewest ?? 0) / 30)} Monaten.`,
      reason: 'Ein Profil ohne frische Bewertungen wirkt auf Suchende älter, als es ist.',
      expectedBenefit: 'Bewertungslink und QR-Code liegen im Dashboard bereit',
      estimatedMinutes: 2,
      actionUrl: '/dashboard/kunden-gewinnung',
      priority: 'medium',
      confidence: 0.7,
      sourceFacts: ['reviews.daysSinceNewest'],
    }),
  },

  /* ── Profil ── */
  {
    id: 'profile.incomplete',
    status: 'active',
    meta: {
      title: 'Pflichtangaben fehlen',
      purpose: 'Prüft je Standort auf Telefon, Website, Adresse und Kategorie.',
      rationale: 'Google spielt unvollständige Profile seltener aus. Wirkt dauerhaft, ist nie dringend.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'profile.completeness',
    source: 'google_business',
    category: 'profile',
    capability: 'profile.write',
    describes: 'Pflichtangaben fehlen',
    when: ({ facts, t }) =>
      facts.profile.completeness < t('profile.completeness_target') &&
      facts.profile.incomplete.length > 0,
    subjects: ({ facts }) => facts.profile.incomplete.map((location) => ({
      id: location.id,
      type: 'location',
      data: { missing: location.missing, title: location.title },
    })),
    insight: (_, subject) =>
      `Am Standort fehlen: ${(subject?.data.missing as string[]).join(', ')}.`,
    recommend: (_, subject) => {
      const missing = subject?.data.missing as string[];
      return {
        type: 'profile.incomplete',
        title: 'Profilangaben ergänzen',
        summary: `Es fehlt: ${missing.join(', ')}.`,
        reason: 'Google spielt unvollständige Profile seltener aus, und wer sie öffnet, findet nicht, was er sucht.',
        expectedBenefit: 'Jede ergänzte Angabe zählt dauerhaft',
        estimatedMinutes: missing.length * 2,
        actionUrl: '/dashboard/google',
        priority: 'medium',
        confidence: 1.0,
        sourceFacts: ['profile.incomplete'],
      };
    },
  },

  {
    id: 'profile.photos_missing',
    status: 'active',
    meta: {
      title: 'Zu wenige Fotos',
      purpose: 'Vergleicht die Fotoanzahl mit dem Zielwert.',
      rationale: 'Profile ohne Bilder werden seltener angeklickt. Google nennt keine Zahl — fünf ist Erfahrung.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'profile.photoCount',
    source: 'google_business',
    category: 'profile',
    capability: 'photos.write',
    describes: 'Zu wenige Fotos',
    when: ({ facts, t }) =>
      facts.profile.locationCount > 0 &&
      facts.profile.photoCount < t('profile.photos_target'),
    insight: ({ facts }) =>
      facts.profile.photoCount === 0
        ? 'Es sind keine Fotos hinterlegt.'
        : `Es sind ${facts.profile.photoCount} Fotos hinterlegt.`,
    recommend: ({ facts, t }) => {
      const needed = t('profile.photos_target') - facts.profile.photoCount;
      return {
        type: 'profile.photos_missing',
        title: needed === 1 ? 'Ein Foto hochladen' : `${needed} Fotos hochladen`,
        summary: facts.profile.photoCount === 0
          ? 'Keine Fotos hinterlegt.'
          : `Du hast ${facts.profile.photoCount}, ${t('profile.photos_target')} wirken vollständig.`,
        reason: 'Profile ohne Bilder werden seltener angeklickt.',
        expectedBenefit: 'Interessenten sehen, wie der Betrieb arbeitet',
        estimatedMinutes: 5,
        actionUrl: '/dashboard/fotos',
        priority: 'low',
        // Erfahrungswert, keine Messung.
        confidence: 0.7,
        sourceFacts: ['profile.photoCount'],
      };
    },
  },

  /* ── Betrieb ── */
  {
    id: 'sync.failing',
    status: 'active',
    meta: {
      title: 'Abgleich schlägt fehl',
      purpose: 'Erkennt fehlgeschlagene Sync-Jobs der letzten 24 Stunden.',
      rationale: 'Betriebsproblem, nicht Kundenproblem. Meist behebt es sich von selbst.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    source: 'google_business',
    category: 'connection',
    capability: 'none',
    describes: 'Abgleich schlägt fehl',
    when: ({ facts }) => facts.operations.syncFailedRecently,
    insight: () => 'Der letzte Abgleich mit Google ist fehlgeschlagen.',
    recommend: () => ({
      type: 'sync.failing',
      title: 'Verbindung prüfen',
      summary: 'Möglicherweise kommen keine neuen Daten an.',
      reason: 'WERKRUF versucht es automatisch erneut. Bleibt es dabei, stimmt etwas mit der Verbindung nicht.',
      expectedBenefit: 'Die Zahlen im Dashboard stimmen wieder',
      estimatedMinutes: 1,
      actionUrl: '/dashboard/google',
      priority: 'medium',
      confidence: 0.85,
      sourceFacts: ['operations.syncFailedRecently'],
    }),
  },

  {
    id: 'health.declined',
    status: 'active',
    meta: {
      title: 'Profilwert gefallen',
      purpose: 'Vergleicht den Profilwert mit dem der Vorwoche.',
      rationale: 'Symptom, nicht Ursache — deshalb mittlere Priorität und ein Verweis auf die Aufschlüsselung.',
      createdAt: '2026-09-10',
      author: 'Architektur',
      version: '1.0',
    },
    impactMetric: 'health.score',
    source: 'google_business',
    category: 'visibility',
    capability: 'none',
    describes: 'Profilwert deutlich gefallen',
    when: ({ facts, t }) =>
      facts.health.previous !== null &&
      facts.health.previous - facts.health.score >= t('health.drop_alert'),
    insight: ({ facts }) =>
      `Der Profilwert ist von ${facts.health.previous} auf ${facts.health.score} gefallen.`,
    recommend: ({ facts }) => ({
      type: 'health.declined',
      title: 'Ansehen, woran der Rückgang liegt',
      summary: `Von ${facts.health.previous} auf ${facts.health.score}.`,
      reason: 'Meist liegt es an unbeantworteten Bewertungen oder fehlenden Angaben.',
      expectedBenefit: 'Die Ursache steht in der Aufschlüsselung',
      estimatedMinutes: 2,
      actionUrl: '/dashboard',
      priority: 'medium',
      confidence: 0.85,
      sourceFacts: ['health.score', 'health.previous'],
    }),
  },
];

/* ─────────────────────────────────────────────
   § 5  SCHICHT 4 — PRIORISIERUNG

   Die Stufe kommt aus der Regel, die Feinsortierung aus vier
   Faktoren. Ohne die Feinsortierung stünden fünf Empfehlungen mit
   "medium" in zufälliger Reihenfolge — und die Reihenfolge ist die
   halbe Empfehlung.
───────────────────────────────────────────── */

/**
 * Gewicht innerhalb einer Prioritätsstufe.
 *
 *   Grundwert der Stufe
 *   + Sicherheit        unsichere Empfehlungen sinken
 *   + Leichtigkeit      was in zwei Minuten geht, steigt
 *
 * Warum Aufwand die Reihenfolge beeinflusst: Wer zwischen zwei gleich
 * wichtigen Sachen wählt, sollte die nehmen, die schnell erledigt ist —
 * dann sind eher beide getan als keine.
 */
function computeWeight(priority: Priority, confidence: Confidence, minutes: number): number {
  const base = PRIORITY_WEIGHT[priority];
  const confidenceBonus = (confidence - 0.5) * 10;        // 0 bis 5
  const easeBonus = Math.max(0, 5 - Math.log2(minutes + 1)); // 5 bei 0 Min, ~0 bei 30
  return Math.round((base + confidenceBonus + easeBonus) * 100) / 100;
}

/* ─────────────────────────────────────────────
   § 6  SCHICHT 5 — KOMMUNIKATION

   Wo eine Empfehlung erscheint, entscheidet die Engine — nicht die
   Regel und schon gar nicht der Kanal. Sonst entstehen mit der Zeit
   so viele Vorstellungen von "wichtig", wie es Regeln gibt.
───────────────────────────────────────────── */

function assignChannels(
  recommendation: Omit<Recommendation, 'channels'>,
  t: (key: string) => number,
): Recommendation['channels'] {
  return {
    // Wer nachsieht, will alles sehen.
    dashboard: true,
    weeklyEmail: recommendation.weight >= t('channel.weekly_from'),
    // Darüber steht nur, wofür man das Handy aus der Tasche holt.
    notification: recommendation.weight >= t('channel.notify_from'),
  };
}

/* ─────────────────────────────────────────────
   § 7  GESUNDHEITSWERT

   Gewichtung laut Vorgabe. Nur objektive Google-Daten — keine
   geschätzte Sichtbarkeit, kein Ranking, keine erfundenen Prozente.

   Die Erklärung nennt ausschliesslich den schwächsten Faktor. Wer
   fünf Baustellen gleichzeitig genannt bekommt, fängt keine an.
───────────────────────────────────────────── */

const HEALTH_WEIGHTS = {
  responseRate: 30,
  rating:       25,
  completeness: 20,
  recency:      15,
  photos:       10,
} as const;

interface HealthFactor {
  id: keyof typeof HEALTH_WEIGHTS;
  label: string;
  points: number;
  max: number;
  ratio: number;
}

interface HealthScoreResult {
  score: number;
  previous: number | null;
  trend: 'up' | 'down' | 'flat' | 'unknown';
  factors: HealthFactor[];
  strongest: HealthFactor | null;
  weakest: HealthFactor | null;
  /** Ein Satz. Nennt nur den schwächsten Faktor. */
  explanation: string;
  recommendedImprovement: string | null;
}

function computeHealthScore(facts: Facts, t: (key: string) => number): HealthScoreResult {
  const factors: HealthFactor[] = [];

  const push = (id: keyof typeof HEALTH_WEIGHTS, label: string, ratio: number) => {
    const max = HEALTH_WEIGHTS[id];
    const bounded = Math.max(0, Math.min(1, ratio));
    factors.push({ id, label, points: Math.round(bounded * max), max, ratio: bounded });
  };

  push('responseRate', 'Antwortquote', facts.reviews.responseRate ?? 0);

  /* 3,0 gibt null Punkte, 5,0 die vollen. Darunter zu differenzieren
     bringt nichts — ein Profil mit 2,1 statt 2,8 hat dasselbe
     Problem. */
  push('rating', 'Durchschnittsbewertung',
    facts.reviews.averageRating === null ? 0 : (facts.reviews.averageRating - 3) / 2);

  push('completeness', 'Profilangaben', facts.profile.completeness);

  const days = facts.reviews.daysSinceNewest;
  push('recency', 'Aktualität',
    days === null ? 0 : days <= 30 ? 1 : days <= 90 ? 0.7 : days <= 180 ? 0.4 : 0);

  push('photos', 'Fotos', facts.profile.photoCount / t('profile.photos_target'));

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const previous = facts.health.previous;

  const sorted = [...factors].sort((a, b) => a.ratio - b.ratio);
  const weakest = sorted[0] ?? null;
  const strongest = sorted[sorted.length - 1] ?? null;

  const trend: HealthScoreResult['trend'] =
    previous === null ? 'unknown'
    : score - previous >= 2 ? 'up'
    : previous - score >= 2 ? 'down'
    : 'flat';

  /* Ohne Verbindung gibt es keine Daten, also auch keinen sinnvollen
     schwächsten Faktor. "Am meisten holst du bei der Antwortquote
     heraus" wäre bei null Bewertungen richtig gerechnet und trotzdem
     Unsinn. */
  const explanation =
    !facts.connection.exists
      ? 'Der Wert entsteht, sobald dein Google-Profil verbunden ist.'
    : !weakest || weakest.ratio >= 0.95
      ? 'Alle Punkte, die sich beeinflussen lassen, sind erledigt.'
      : `Am meisten holst du bei "${weakest.label.toLowerCase()}" heraus — dort fehlen ${weakest.max - weakest.points} von ${weakest.max} Punkten.`;

  const improvements: Record<string, string> = {
    responseRate: 'Offene Bewertungen beantworten',
    rating:       'Zufriedene Kunden um eine Bewertung bitten',
    completeness: 'Fehlende Profilangaben ergänzen',
    recency:      'Kunden aktiv um Bewertungen bitten',
    photos:       'Fotos hochladen',
  };

  return {
    score, previous, trend, factors, strongest, weakest, explanation,
    recommendedImprovement: facts.connection.exists && weakest && weakest.ratio < 0.95
      ? improvements[weakest.id] ?? null
      : null,
  };
}

/* ─────────────────────────────────────────────
   § 8  AUSWERTUNG

   Der Ablauf. Alles davor ist Beschreibung, alles danach Darstellung.
───────────────────────────────────────────── */

interface EngineResult {
  facts: Facts;
  insights: Insight[];
  recommendations: Recommendation[];
  health: HealthScoreResult;
}

/**
 * Wendet den Regelkatalog auf Fakten an.
 *
 * Rein und ohne Datenbank: Fakten und Schwellwerte rein, Ergebnis
 * raus. Genau deshalb lässt sich jede Regel einzeln testen, ohne dass
 * etwas läuft.
 */
function evaluate(facts: Facts, thresholds: Thresholds): EngineResult {
  const t = (key: string): number => {
    const value = thresholds[key];
    if (value === undefined) {
      // Fehlender Schwellwert ist ein Programmierfehler, kein
      // Laufzeitfall — laut scheitern statt still 0 anzunehmen.
      throw new GbpError('config_error', `Unbekannter Schwellwert: ${key}`);
    }
    return value;
  };

  const ctx: RuleContext = { facts, t };
  const insights: Insight[] = [];
  const recommendations: Recommendation[] = [];
  const minConfidence = t('engine.min_confidence');

  for (const rule of RULES) {
    try {
      /* Ausgemusterte Regeln laufen nicht mehr. Sie bleiben im
         Katalog, damit alte Empfehlungen ihre Herleitung behalten. */
      if (rule.status === 'retired') continue;

      if (!rule.when(ctx)) continue;

      const subjects = rule.subjects ? rule.subjects(ctx) : [undefined];

      for (const subject of subjects) {
        insights.push({
          ruleId: rule.id,
          category: rule.category,
          text: rule.insight(ctx, subject),
          confidence: 1.0,
          facts: [],
        });

        if (!rule.recommend) continue;
        const draft = rule.recommend(ctx, subject);

        // Unter der Schwelle gar nicht erst zeigen.
        if (draft.confidence < minConfidence) continue;

        const weight = computeWeight(draft.priority, draft.confidence, draft.estimatedMinutes);

        const partial: Omit<Recommendation, 'channels'> = {
          ruleId: rule.id,
          ruleVersion: rule.meta.version,
          ruleStatus: rule.status,
          impactMetric: rule.impactMetric,
          source: rule.source,
          type: draft.type,
          category: rule.category,
          priority: draft.priority,
          weight,
          confidence: draft.confidence,
          title: draft.title,
          summary: draft.summary,
          reason: draft.reason,
          expectedBenefit: draft.expectedBenefit,
          estimatedEffort: draft.estimatedMinutes === 1
            ? '1 Minute' : `${draft.estimatedMinutes} Minuten`,
          estimatedMinutes: draft.estimatedMinutes,
          actionUrl: draft.actionUrl,
          capability: rule.capability,
          isDismissable: draft.isDismissable ?? true,
          subjectType: subject?.type,
          subjectId: subject?.id ?? null,
          data: subject?.data,
          expiresAt: draft.expiresAt,
          explanation: {
            sourceFacts: draft.sourceFacts,
            triggeredRule: `${rule.id}: ${rule.describes}`,
            reason: draft.reason,
            expectedOutcome: draft.expectedBenefit,
          },
        };

        /* Kandidaten laufen mit, erscheinen aber nirgends. Zwei
           Wochen Probebetrieb zeigen in ops_candidate_rules, was
           die Regel erzeugt hätte — bevor ein Kunde sie sieht. */
        const channels = rule.status === 'candidate'
          ? { dashboard: false, weeklyEmail: false, notification: false }
          : assignChannels(partial, t);

        recommendations.push({ ...partial, channels });
      }
    } catch (err) {
      // Eine kaputte Regel darf die anderen nicht mitreissen.
      console.error(JSON.stringify({
        scope: 'engine.rule', ruleId: rule.id,
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  recommendations.sort((a, b) => b.weight - a.weight);

  return { facts, insights, recommendations, health: computeHealthScore(facts, t) };
}

/** Übersetzt in das Format, das sync_events erwartet. */
function toEventRows(result: EngineResult) {
  return result.recommendations.map((r) => ({
    source: r.source,
    type: r.type,
    category: r.category,
    // Die Datenbank speichert eine Zahl; die Stufe steckt in data.
    priority: Math.round(Math.min(100, Math.max(0, r.weight))),
    title: r.title,
    summary: r.summary,
    reason: r.reason,
    recommendedAction: r.title,
    actionUrl: r.actionUrl,
    estimatedEffort: r.estimatedEffort,
    impact: r.expectedBenefit,
    inDashboard: r.channels.dashboard,
    inWeeklyEmail: r.channels.weeklyEmail,
    asNotification: r.channels.notification,
    isDismissable: r.isDismissable,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    data: { ...r.data, priorityLevel: r.priority, capability: r.capability },
    expiresAt: r.expiresAt,
    ruleId: r.ruleId,
    ruleVersion: r.ruleVersion,
    ruleStatus: r.ruleStatus,
    impactMetric: r.impactMetric,
    confidence: r.confidence,
    explanation: r.explanation,
  }));
}

/**
 * Bewertet einen Nutzer und schreibt das Ergebnis.
 *
 * Hier passiert "jedes Ereignis wird einmal bewertet". Alles danach
 * ist Darstellung.
 */
async function evaluateUser(userId: string, log: Logger): Promise<{
  events: number; created: number; updated: number; resolved: number; health: number;
}> {
  const db = adminClient();

  const [contextResult, thresholdResult] = await Promise.all([
    db.rpc('build_evaluation_context', { p_user_id: userId }),
    db.rpc('get_engine_thresholds'),
  ]);

  if (contextResult.error) {
    throw new GbpError('internal_error', 'Kontext nicht ladbar', { cause: contextResult.error });
  }
  if (thresholdResult.error) {
    throw new GbpError('internal_error', 'Schwellwerte nicht ladbar', { cause: thresholdResult.error });
  }

  const facts = buildFacts(contextResult.data as EvaluationContext);
  const result = evaluate(facts, thresholdResult.data as Thresholds);
  const rows = toEventRows(result);

  const { data, error } = await db.rpc('sync_events', {
    p_user_id: userId,
    p_events: rows,
    p_engine_version: ENGINE_VERSION,
  });
  if (error) {
    throw new GbpError('internal_error', 'Ereignisse nicht speicherbar', { cause: error });
  }

  const summary = data as { created: number; updated: number; resolved: number };

  log.debug('evaluated', {
    userId,
    engineVersion: ENGINE_VERSION,
    rules: RULES.length,
    insights: result.insights.length,
    recommendations: rows.length,
    health: result.health.score,
    ...summary,
  });

  return { events: rows.length, ...summary, health: result.health.score };
}



/* ─────────────────────────────────────────────
   SCHEDULER
───────────────────────────────────────────── */

type JobHandler = (job: SyncJobRow) => Promise<Record<string, unknown>>;

class SyncScheduler {
  constructor(
    private readonly handlers: Record<string, JobHandler>,
    private readonly log: Logger,
    private readonly db = adminClient(),
  ) {}

  /** Reiht einen Job ein. Gibt null zurück, wenn schon einer wartet. */
  async enqueue(input: {
    jobType: SyncJobType;
    userId?: string | null;
    accountId?: string | null;
    locationId?: string | null;
    payload?: Record<string, unknown>;
    priority?: number;
  }): Promise<string | null> {
    const { data, error } = await this.db.rpc('enqueue_sync_job', {
      p_job_type:    input.jobType,
      p_user_id:     input.userId ?? null,
      p_account_id:  input.accountId ?? null,
      p_location_id: input.locationId ?? null,
      p_payload:     input.payload ?? {},
      p_priority:    input.priority ?? 100,
    });

    if (error) throw new GbpError('internal_error', 'Job nicht einreihbar', { cause: error });
    return (data as string | null) ?? null;
  }

  /**
   * Arbeitet fällige Jobs ab.
   *
   * Das Zeitbudget ist keine Feinheit: Edge Functions werden hart
   * abgeschnitten. Wird ein Lauf mittendrin beendet, bleiben Jobs auf
   * "running" mit gesetztem locked_at stehen — release_stuck_sync_jobs()
   * holt sie zurück. Trotzdem besser, vorher aufzuhören.
   */
  async runDueJobs(options: { workerId: string; limit?: number; budgetMs?: number }): Promise<{
    claimed: number; succeeded: number; failed: number;
    results: Array<{ jobId: string; jobType: string; ok: boolean; error?: string }>;
  }> {
    const startedAt = Date.now();
    const budgetMs = options.budgetMs ?? 45_000;

    const { data, error } = await this.db.rpc('claim_sync_jobs', {
      p_worker: options.workerId,
      p_limit:  options.limit ?? 5,
    });

    if (error) throw new GbpError('internal_error', 'Jobs nicht übernehmbar', { cause: error });

    const jobs = (data ?? []) as SyncJobRow[];
    const results: Array<{ jobId: string; jobType: string; ok: boolean; error?: string }> = [];
    let succeeded = 0, failed = 0;

    for (const job of jobs) {
      if (Date.now() - startedAt > budgetMs) {
        // Rest zurück in die Schlange, damit der nächste Lauf ihn nimmt.
        await this.finish(job.id, false, null, 'budget_exhausted', 'Zeitbudget des Workers erschöpft');
        this.log.warn('worker_budget_exhausted', { jobId: job.id, jobType: job.job_type });
        results.push({ jobId: job.id, jobType: job.job_type, ok: false, error: 'budget_exhausted' });
        failed++;
        continue;
      }

      const handler = this.handlers[job.job_type];
      if (!handler) {
        await this.finish(job.id, false, null, 'no_handler', `Kein Handler für ${job.job_type}`);
        this.log.error('no_handler', { jobId: job.id, jobType: job.job_type });
        results.push({ jobId: job.id, jobType: job.job_type, ok: false, error: 'no_handler' });
        failed++;
        continue;
      }

      try {
        const result = await handler(job);
        await this.finish(job.id, true, result);
        results.push({ jobId: job.id, jobType: job.job_type, ok: true });
        succeeded++;
      } catch (err) {
        const gbpError = toGbpError(err);

        // reauth_required ist kein transienter Fehler — der Kunde muss
        // handeln. Weitere Versuche kosten nur Quota, also sofort
        // aufgeben statt dreimal zu wiederholen.
        if (gbpError.code === 'reauth_required' || gbpError.code === 'not_connected') {
          await this.abandon(job.id, gbpError.code, gbpError.message);
        } else {
          await this.finish(job.id, false, null, gbpError.code, gbpError.message);
        }

        this.log.error('job_failed', {
          jobId: job.id, jobType: job.job_type,
          code: gbpError.code, attempts: job.attempts, message: gbpError.message,
        });
        results.push({ jobId: job.id, jobType: job.job_type, ok: false, error: gbpError.code });
        failed++;
      }
    }

    this.log.debug('worker_run', {
      workerId: options.workerId, claimed: jobs.length, succeeded, failed,
      elapsedMs: Date.now() - startedAt,
    });

    return { claimed: jobs.length, succeeded, failed, results };
  }

  private async finish(
    jobId: string, success: boolean,
    result: Record<string, unknown> | null,
    errorCode?: string, errorMessage?: string,
  ): Promise<void> {
    const { error } = await this.db.rpc('finish_sync_job', {
      p_job_id: jobId, p_success: success, p_result: result ?? null,
      p_error_code: errorCode ?? null, p_error_message: errorMessage ?? null,
    });
    if (error) {
      this.log.error('finish_job_failed', { jobId, message: error.message });
    }
  }

  /** Endgültig aufgeben, ohne weitere Versuche. */
  private async abandon(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
    const { error } = await this.db.from('sync_jobs').update({
      status: 'failed', finished_at: new Date().toISOString(),
      error_code: errorCode, error_message: errorMessage.slice(0, 2000),
      locked_by: null, locked_at: null,
    }).eq('id', jobId);

    if (error) this.log.error('abandon_job_failed', { jobId, message: error.message });
  }
}

/* ─────────────────────────────────────────────
   VERDRAHTUNG
───────────────────────────────────────────── */

function createSyncScheduler(): SyncScheduler {
  const log = createLogger('sync');
  const service = new ReviewSyncService(new ReviewRepository(), log);

  const handlers: Record<string, JobHandler> = {
    sync_reviews: async (job) => {
      if (!job.location_id) {
        throw new GbpError('bad_request', 'sync_reviews ohne location_id');
      }
      const result = await service.syncLocation(job.location_id, {
        force: job.payload?.force === true,
      });

      /* Neue Daten heissen: die Entscheidungslage hat sich geändert.
         Best effort — schlägt die Bewertung fehl, war der Sync
         trotzdem erfolgreich. */
      if (job.user_id) {
        try { await evaluateUser(job.user_id, log); }
        catch (err) { log.warn('post_sync_evaluate_failed', { userId: job.user_id, message: String(err) }); }
      }

      return { ...result };
    },
    sync_locations: async (job) => {
      if (!job.account_id || !job.user_id) {
        throw new GbpError('bad_request', 'sync_locations ohne account_id oder user_id');
      }
      return { ...(await new LocationSyncService(log).syncAccount(job.account_id, job.user_id)) };
    },

    /* Nach jedem Sync neu bewerten. Als eigener Job, nicht angehängt:
       so lässt sich die Bewertung auch einzeln anstossen, wenn der
       Nutzer eine Antwort freigibt — ohne einen ganzen Sync. */
    evaluate: async (job) => {
      if (!job.user_id) {
        throw new GbpError('bad_request', 'evaluate ohne user_id');
      }
      return { ...(await evaluateUser(job.user_id, log)) };
    },

    publish_reply: async (job) => {
      const replyId = job.payload?.replyId;
      if (typeof replyId !== 'string') {
        throw new GbpError('bad_request', 'publish_reply ohne payload.replyId');
      }
      return { ...(await new ReplyPublisher(log).publish(replyId)) };
    },

    // Weitere Handler (sync_locations, sync_insights, …) kommen hier
    // dazu — der Scheduler selbst bleibt unverändert.
  };

  return new SyncScheduler(handlers, log);
}

/* ═══════════════════════════════════════════════════════════════
   11 — ROUTEN
═══════════════════════════════════════════════════════════════ */

/**
 * POST /connect
 * Body: { returnTo?: string, connectionId?: string }
 *
 * Gibt die Google-URL als JSON zurück, statt zu redirecten. Ein
 * Redirect würde bedeuten, dass der Browser die Function per
 * Top-Level-Navigation aufruft — dabei ginge der Authorization-Header
 * verloren. So bleibt die Route authentifiziert.
 */
async function handleConnect(request: Request): Promise<Response> {
  const user = await requireUser(request);

  let payload: { returnTo?: string; connectionId?: string } = {};
  try {
    const raw = await request.text();
    if (raw) payload = JSON.parse(raw);
  } catch { /* Standardwerte */ }

  const returnTo = resolveReturnTo(payload.returnTo ?? null);

  // Reconnect: E-Mail des bestehenden Kontos als login_hint, damit der
  // User nicht versehentlich ein anderes Google-Konto verknüpft.
  let loginHint: string | null = null;
  let connectionId: string | null = null;
  if (payload.connectionId) {
    const existing = await getConnection(user.id, payload.connectionId);
    loginHint = existing.provider_email;
    connectionId = existing.id;
  }

  const { verifier, challenge } = await createPkcePair();
  const state = await createOAuthState({
    userId: user.id,
    codeVerifier: verifier,
    returnTo,
    connectionId,
  });

  cleanupExpiredStates().catch(() => {});

  return jsonResponse(request, {
    authUrl: buildAuthorizationUrl({ state, codeChallenge: challenge, loginHint }),
  });
}

/**
 * GET /callback?code=…&state=…
 * Antwortet nie mit JSON, sondern redirectet zurück in die App.
 */
async function handleCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let returnTo = resolveReturnTo(null);

  try {
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      throw new GbpError(
        oauthError === 'access_denied' ? 'oauth_denied' : 'exchange_failed',
        `Google meldete: ${oauthError}`,
      );
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!state) throw new GbpError('invalid_state', 'Kein state-Parameter');
    if (!code) throw new GbpError('exchange_failed', 'Kein code-Parameter');

    const stateRow = await consumeOAuthState(state);
    returnTo = resolveReturnTo(stateRow.return_to);

    const tokens = await exchangeCodeForTokens(code, stateRow.code_verifier);

    // Ohne Refresh-Token wäre nach einer Stunde Schluss. Lieber sauber
    // abbrechen als eine Verbindung anlegen, die morgen tot ist.
    if (!tokens.refresh_token) {
      throw new GbpError('missing_refresh_token', 'Google lieferte kein refresh_token');
    }

    // Google lässt den User einzelne Häkchen abwählen. Was wir angefragt
    // haben, ist irrelevant — es zählt, was zurückkommt.
    const grantedScopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    const missing = REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length > 0) {
      throw new GbpError('insufficient_scope', `Fehlende Scopes: ${missing.join(', ')}`, {
        context: { grantedScopes },
      });
    }

    if (!tokens.id_token) {
      throw new GbpError('exchange_failed', 'Kein id_token — openid-Scope fehlt in der Konfiguration');
    }

    const claims = decodeIdTokenPayload<GoogleIdTokenClaims>(tokens.id_token);
    const { clientId } = getOAuthConfig();
    if (claims.aud !== clientId) {
      throw new GbpError('exchange_failed', 'id_token gehört zu einer anderen Client-ID');
    }
    // Aussteller prüfen. Google verwendet beide Schreibweisen.
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
      throw new GbpError('exchange_failed', 'id_token stammt nicht von Google', {
        context: { iss: claims.iss },
      });
    }
    if (!claims.sub) throw new GbpError('exchange_failed', 'id_token ohne sub-Claim');

    const confirmationToken = randomToken(32);

    await upsertConnection({
      userId: stateRow.user_id,
      googleAccountId: claims.sub,
      googleAccountEmail: claims.email ?? null,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      grantedScopes,
      confirmationToken,
    });

    // Zweite Stufe: der Client muss das Token mit gültiger Session
    // einlösen. Bis dahin ist die Verbindung 'pending' und für den
    // Token-Service unbrauchbar.
    return redirectWithResult(returnTo, {
      status: 'confirm',
      email: claims.email ?? null,
      token: confirmationToken,
    });
  } catch (err) {
    logError('callback', err);
    return redirectWithResult(returnTo, {
      status: 'error',
      code: err instanceof GbpError ? err.code : 'internal_error',
    });
  }
}

/** GET /status — nur PublicConnection, keine Tokens. */
async function handleStatus(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const rows = await listConnections(user.id);

  return jsonResponse(request, {
    connected: rows.some((row) => row.status === 'active'),
    connections: rows.map(toPublicConnection),
  });
}

/**
 * POST /disconnect — Body: { connectionId: string }
 *
 * Erst Widerruf bei Google, dann lokal löschen. Andersherum wäre falsch:
 * erst lokal löschen hiesse, das Refresh-Token zu verlieren, mit dem der
 * Widerruf überhaupt möglich ist. Der User hätte dann eine Freigabe in
 * seinem Google-Konto, die er nur noch dort von Hand entfernen kann.
 */
async function handleDisconnect(request: Request): Promise<Response> {
  const user = await requireUser(request);

  let connectionId: string | undefined;
  try {
    ({ connectionId } = await request.json());
  } catch { /* fällt unten durch */ }

  if (!connectionId) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'connectionId fehlt.', retryable: false },
    }, 400);
  }

  // Prüft implizit, dass die Verbindung diesem User gehört.
  const connection = await getConnection(user.id, connectionId);

  let revokedAtGoogle = false;
  if (connection.tokens?.refresh_token_encrypted) {
    try {
      const refreshToken = await decryptToken(connection.tokens.refresh_token_encrypted, user.id);
      revokedAtGoogle = await revokeToken(refreshToken);
    } catch (err) {
      logError('disconnect.revoke', err, { connectionId });
    }
  }

  await markConnectionUnusable(connectionId, 'disconnected', 'user_disconnected');

  return jsonResponse(request, { disconnected: true, revokedAtGoogle });
}

/**
 * GET /accounts[?connectionId=…]
 * Erster echter Verbraucher des Token-Service und Vorlage für alles
 * Weitere: kein Aufrufer sieht je ein Token, er nennt nur die User-ID.
 */
async function handleAccounts(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const connectionId = new URL(request.url).searchParams.get('connectionId') ?? undefined;

  const client = createGbpClient(user.id, connectionId);
  const accounts = await client.getAccounts();

  // Standorte sequenziell nachladen — die Business-Profile-APIs sind
  // eng quotiert und quittieren Bursts mit 429. Bei vielen Konten
  // gehört das ohnehin in einen sync_job statt in einen Request.
  const enriched: Array<GbpAccount & { locations: GbpLocation[] }> = [];
  for (const account of accounts) {
    enriched.push({ ...account, locations: await client.getLocations(account.name) });
  }

  return jsonResponse(request, { accounts: enriched });
}

/**
 * POST /sync/run
 *
 * Der Worker. Wird per pg_cron oder externem Scheduler aufgerufen,
 * nicht von Nutzern — deshalb ein gemeinsames Geheimnis statt einer
 * Session. requireUser() wäre hier falsch: es gibt keinen Nutzer.
 *
 * Body (optional): { limit?: number, budgetMs?: number }
 */
async function handleSyncRun(request: Request): Promise<Response> {
  requireWorkerSecret(request);

  const db = adminClient();
  const log = createLogger('worker');

  let options: { limit?: number; budgetMs?: number; trigger?: string } = {};
  try {
    const raw = await request.text();
    if (raw) options = JSON.parse(raw);
  } catch { /* Standardwerte */ }

  // Kennung des Laufs. Steht bei einem Absturz in locked_by und in
  // sync_runs.worker_id und macht nachvollziehbar, welcher Aufruf
  // etwas liegengelassen hat.
  const workerId = `edge-${crypto.randomUUID().slice(0, 8)}`;

  /* ── Lauf-Sperre ──
     claim_sync_jobs verhindert, dass zwei Worker denselben Job
     greifen — nicht, dass sich Läufe stapeln. Feuert Cron alle fünf
     Minuten und ein Lauf dauert länger, liefen sonst irgendwann
     mehrere gleichzeitig und würden die Google-Quota verbrennen. */
  const { data: runId, error: beginError } = await db.rpc('begin_sync_run', {
    p_worker:  workerId,
    p_trigger: options.trigger === 'manual' ? 'manual' : 'cron',
  });

  if (beginError) {
    throw new GbpError('internal_error', 'Lauf nicht startbar', { cause: beginError });
  }

  if (!runId) {
    // Kein Fehler: bei knapper Taktung der Normalfall.
    log.debug('run_skipped', { workerId, reason: 'locked' });
    return jsonResponse(request, { workerId, skipped: true, reason: 'already_running' });
  }

  const scheduler = createSyncScheduler();

  try {
    const summary = await scheduler.runDueJobs({
      workerId,
      limit:    Math.min(Math.max(options.limit ?? 5, 1), 20),
      budgetMs: Math.min(options.budgetMs ?? 45_000, 60_000),
    });

    await db.rpc('finish_sync_run', {
      p_run_id:    runId,
      p_worker:    workerId,
      p_claimed:   summary.claimed,
      p_succeeded: summary.succeeded,
      p_failed:    summary.failed,
      p_details:   { results: summary.results },
    });

    return jsonResponse(request, { workerId, runId, ...summary });

  } catch (err) {
    const gbpError = toGbpError(err);

    // Lauf IMMER abschliessen — finish_sync_run gibt die Sperre frei.
    // Ohne das bliebe der Worker bis zum Ablauf der TTL blockiert.
    await db.rpc('finish_sync_run', {
      p_run_id: runId, p_worker: workerId,
      p_error_code: gbpError.code, p_error_message: gbpError.message,
    });

    throw gbpError;
  }
}

/**
 * POST /sync/schedule
 *
 * Plant fällige Review-Syncs ein. Getrennt vom Worker, damit Planung
 * und Ausführung unterschiedlich getaktet werden können — planen
 * stündlich, arbeiten alle paar Minuten.
 */
async function handleSyncSchedule(request: Request): Promise<Response> {
  requireWorkerSecret(request);

  let options: { reviewAge?: string; locationAge?: string } = {};
  try {
    const raw = await request.text();
    if (raw) options = JSON.parse(raw);
  } catch { /* Standardwerte */ }

  const { data, error } = await adminClient().rpc('schedule_all_syncs', {
    // Nicht stündlich für JEDEN Standort: die Business-Profile-APIs
    // sind eng quotiert. Das ist der Regler, an dem man dreht, wenn
    // Google mit 429 antwortet.
    p_review_age:   options.reviewAge   ?? '2 hours',
    p_location_age: options.locationAge ?? '24 hours',
  });

  if (error) {
    throw new GbpError('internal_error', 'Planung fehlgeschlagen', { cause: error });
  }

  return jsonResponse(request, data ?? {});
}

/**
 * POST /sync/trigger
 *
 * Vom Nutzer angestossener Sync ("Jetzt aktualisieren"). Reiht nur
 * einen Job ein und antwortet sofort — ein synchroner Durchlauf würde
 * bei grossen Standorten in den Timeout laufen.
 *
 * Body: { locationId: string, force?: boolean }
 */
async function handleSyncTrigger(request: Request): Promise<Response> {
  const user = await requireUser(request);

  // Jeder Lauf kostet Google-Quota. 20 manuelle Anstösse pro Stunde
  // sind grosszügig für einen Menschen und eng für eine Schleife.
  await enforceRateLimit(`sync_trigger:${user.id}`, 20);

  let payload: { locationId?: string; force?: boolean } = {};
  try {
    payload = await request.json();
  } catch { /* fällt unten durch */ }

  const scheduler = createSyncScheduler();

  /* Ohne locationId: Standorte holen statt Bewertungen.
     Genau der Fall beim allerersten Mal — es gibt noch keine
     Standorte, also kann man auch keinen auswählen. Vorher war der
     Knopf in dieser Lage wirkungslos. */
  if (!payload.locationId) {
    const accounts = await listConnections(user.id);
    const active = accounts.filter((a) => a.status === 'active');

    if (active.length === 0) {
      throw new GbpError('not_connected', 'Kein aktives Google-Konto verbunden');
    }

    const jobIds: Array<string | null> = [];
    for (const account of active) {
      jobIds.push(await scheduler.enqueue({
        jobType: 'sync_locations',
        userId: user.id,
        accountId: account.id,
        payload: { force: payload.force === true },
        priority: 10,
      }));
    }

    return jsonResponse(request, {
      queued: true,
      scope: 'locations',
      jobIds,
      alreadyRunning: jobIds.every((id) => id === null),
    });
  }

  /* Mit locationId: Bewertungen dieses Standorts.
     Eigentümerprüfung im Code — die Service Role umgeht RLS. */
  const { data: location, error } = await adminClient()
    .from('google_locations').select('id, account_id, user_id')
    .eq('id', payload.locationId).eq('user_id', user.id)
    .is('deleted_at', null).maybeSingle();

  if (error) throw new GbpError('internal_error', 'Standort nicht ladbar', { cause: error });
  if (!location) throw new GbpError('not_found', 'Standort nicht gefunden');

  const jobId = await scheduler.enqueue({
    jobType: 'sync_reviews',
    userId: user.id,
    accountId: (location as { account_id: string }).account_id,
    locationId: payload.locationId,
    payload: { force: payload.force === true },
    // Vor die Hintergrundläufe: hier wartet jemand auf das Ergebnis.
    priority: 10,
  });

  return jsonResponse(request, {
    // null heisst: es lief bereits einer. Für den Nutzer dasselbe
    // Ergebnis, deshalb keine Fehlermeldung.
    queued: true,
    scope: 'reviews',
    jobId,
    alreadyRunning: jobId === null,
  });
}

/**
 * GET /health
 *
 * Für einen externen Wächter. Antwortet 200 bei 'ok' und 503 bei
 * 'degraded' — so kann ein Dienst wie UptimeRobot allein am
 * Statuscode alarmieren, ohne den Body zu lesen.
 *
 * Absichtlich OHNE Session und OHNE Worker-Secret: ein Health-Check,
 * der Anmeldedaten braucht, wird in der Praxis nicht eingerichtet.
 * Preisgegeben werden nur aggregierte Zahlen, keine Kundendaten und
 * keine Namen. Wer mitliest, erfährt, dass es das System gibt und wie
 * viele Verbindungen es hat — das ist vertretbar.
 */
async function handleHealth(request: Request): Promise<Response> {
  const { data, error } = await adminClient().rpc('ops_health_check');

  if (error) {
    // Antwortet die Datenbank nicht, ist das per Definition ungesund.
    logError('health', error);
    return jsonResponse(request, {
      status: 'degraded', problems: ['database_unreachable'], checkedAt: new Date().toISOString(),
    }, 503);
  }

  const health = data as { status: string };
  return jsonResponse(request, health, health.status === 'ok' ? 200 : 503);
}

/* ─────────────────────────────────────────────
   BESTÄTIGUNG DER VERKNÜPFUNG

   Zweite Stufe des OAuth-Flows. Siehe Migration 007 für das Warum.
───────────────────────────────────────────── */

/**
 * POST /connect/confirm
 * Body: { token: string }
 *
 * Schaltet eine 'pending'-Verbindung scharf — aber nur, wenn die
 * Session-User-ID zur Verbindung passt. Damit greift der Angriff
 * nicht mehr, bei dem jemand die Google-URL eines fremden Flows
 * untergeschoben bekommt: dessen Session gehört zu einem anderen
 * Nutzer, der Abgleich schlägt fehl.
 */
async function handleConnectConfirm(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const { token } = await readJsonBody<{ token?: string }>(request);

  if (!token || typeof token !== 'string' || token.length > 128) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'Token fehlt.', retryable: false },
    }, 400);
  }

  const { data, error } = await adminClient()
    .rpc('confirm_google_account', { p_token: token, p_user_id: user.id });

  if (error) {
    throw new GbpError('internal_error', 'Bestätigung fehlgeschlagen', { cause: error });
  }

  if (!data) {
    // Bewusst nicht unterscheiden zwischen "Token unbekannt",
    // "abgelaufen" und "gehört jemand anderem" — sonst wird die
    // Antwort zum Orakel.
    logError('connect.confirm', new GbpError('invalid_state', 'Bestätigung abgelehnt'), {
      userId: user.id,
    });
    throw new GbpError('invalid_state', 'Die Verknüpfung konnte nicht bestätigt werden');
  }

  const account = data as AccountRow;

  await writeAuditLog({
    userId: user.id,
    action: 'oauth.connected',
    entityType: 'google_account',
    entityId: account.id,
    metadata: { provider_email: account.provider_email },
  });

  return jsonResponse(request, {
    confirmed: true,
    connection: toPublicConnection({ ...account, tokens: null } as ConnectionRow),
  });
}

/* ─────────────────────────────────────────────
   RATE LIMITING

   Prüfung in der Datenbank, nicht im Speicher der Function: Edge
   Functions laufen in vielen Isolates, ein Zähler pro Isolate wäre
   wirkungslos.
───────────────────────────────────────────── */

async function enforceRateLimit(
  key: string,
  limit: number,
  windowInterval = '1 hour',
): Promise<void> {
  const { data, error } = await adminClient().rpc('check_rate_limit', {
    p_key: key, p_limit: limit, p_window: windowInterval,
  });

  if (error) {
    // Bei einem Fehler in der Bremse NICHT durchlassen: sonst wäre
    // eine überlastete Datenbank der einfachste Weg, sie auszuhebeln.
    throw new GbpError('internal_error', 'Limitprüfung fehlgeschlagen', { cause: error });
  }

  const result = data as { allowed: boolean; count: number; limit: number; resetsAt: string };
  if (!result.allowed) {
    throw new GbpError('rate_limited', 'Limit erreicht', {
      context: { key, count: result.count, limit: result.limit, resetsAt: result.resetsAt },
    });
  }
}

/* ─────────────────────────────────────────────
   ANTWORT-ROUTEN

   Der Nutzerteil des Ablaufs. Veröffentlicht wird hier NICHT
   synchron: der Aufruf reiht nur einen Job ein und kehrt sofort
   zurück. Ein Google-Aufruf im Request-Pfad hiesse, dass ein Timeout
   oder ein 503 den Nutzer mit einem Fehler zurücklässt, obwohl die
   Antwort vielleicht schon veröffentlicht ist.
───────────────────────────────────────────── */

/** Lädt eine Antwort und prüft, dass sie dem Aufrufer gehört. */
async function loadOwnReply(replyId: string, userId: string): Promise<ReplyRow> {
  const { data, error } = await adminClient()
    .from('review_replies').select('*')
    .eq('id', replyId).eq('user_id', userId)
    .is('deleted_at', null).maybeSingle();

  if (error) throw new GbpError('internal_error', 'Antwort nicht ladbar', { cause: error });
  if (!data) throw new GbpError('not_found', 'Antwort nicht gefunden');
  return data as ReplyRow;
}

/**
 * GET /replies?reviewId=…
 * Alle Entwürfe und Antworten zu einer Bewertung, neueste zuerst.
 */
async function handleRepliesList(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const reviewId = new URL(request.url).searchParams.get('reviewId');

  if (!reviewId) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'reviewId fehlt.', retryable: false },
    }, 400);
  }

  const { data, error } = await adminClient()
    .from('review_replies')
    .select('id, review_id, body, source, model, status, published_at, error_code, created_at, updated_at')
    .eq('review_id', reviewId).eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new GbpError('internal_error', 'Antworten nicht ladbar', { cause: error });
  return jsonResponse(request, { replies: data ?? [] });
}

/**
 * POST /replies/update
 * Body: { replyId, body }
 *
 * Bearbeitung durch den Nutzer. Nur im Status 'draft' erlaubt —
 * einen bereits bestätigten oder veröffentlichten Text nachträglich
 * zu ändern, ohne dass sich bei Google etwas tut, wäre irreführend.
 */
async function handleReplyUpdate(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const { replyId, body } = await readJsonBody<{ replyId?: string; body?: string }>(request);

  if (!replyId || typeof body !== 'string') {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'replyId oder body fehlt.', retryable: false },
    }, 400);
  }

  const trimmed = body.trim();
  if (!trimmed) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'Die Antwort darf nicht leer sein.', retryable: false },
    }, 400);
  }
  // Googles Limit für Antworttexte.
  if (trimmed.length > 4096) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'Die Antwort ist zu lang (max. 4096 Zeichen).', retryable: false },
    }, 400);
  }

  const existing = await loadOwnReply(replyId, user.id);
  if (existing.status !== 'draft') {
    throw new GbpError('bad_request', `Antwort im Status ${existing.status} ist nicht mehr bearbeitbar`);
  }

  const { error } = await adminClient()
    .from('review_replies')
    // source wechselt auf 'human', sobald jemand Hand angelegt hat.
    // Sonst stünde in der Auswertung, die KI habe einen Text
    // geschrieben, den in Wahrheit der Betrieb formuliert hat.
    .update({ body: trimmed, source: existing.source === 'ai' ? 'human' : existing.source })
    .eq('id', replyId).eq('user_id', user.id).eq('status', 'draft');

  if (error) throw new GbpError('internal_error', 'Antwort nicht speicherbar', { cause: error });

  await writeAuditLog({
    userId: user.id, action: 'reply.edited',
    entityType: 'review_reply', entityId: replyId,
    metadata: { characterCount: trimmed.length, previousSource: existing.source },
  });

  return jsonResponse(request, { updated: true, characterCount: trimmed.length });
}

/**
 * POST /replies/approve
 * Body: { replyId }
 *
 * Die Bestätigung durch den Nutzer. draft → approved, dann Job
 * einreihen. Ab hier ist der Text nicht mehr bearbeitbar.
 */
async function handleReplyApprove(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await enforceRateLimit(`reply_approve:${user.id}`, 100);
  const { replyId } = await readJsonBody<{ replyId?: string }>(request);

  if (!replyId) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'replyId fehlt.', retryable: false },
    }, 400);
  }

  const reply = await loadOwnReply(replyId, user.id);

  if (reply.status === 'published') {
    return jsonResponse(request, { queued: false, alreadyPublished: true });
  }
  if (reply.status !== 'draft' && reply.status !== 'failed') {
    throw new GbpError('bad_request', `Antwort im Status ${reply.status} kann nicht bestätigt werden`);
  }

  // Statuswechsel bedingt auf den gelesenen Status — verhindert, dass
  // zwei gleichzeitige Klicks beide durchgehen.
  const { data: approved, error } = await adminClient()
    .from('review_replies')
    .update({ status: 'approved', error_code: null, error_message: null })
    .eq('id', replyId).eq('user_id', user.id).eq('status', reply.status)
    .select('id').maybeSingle();

  if (error) throw new GbpError('internal_error', 'Status nicht setzbar', { cause: error });
  if (!approved) {
    // Zwischenzeitlich verändert. Kein Fehler für den Nutzer.
    return jsonResponse(request, { queued: false, alreadyRunning: true });
  }

  const { data: review } = await adminClient()
    .from('google_reviews').select('account_id').eq('id', reply.review_id).maybeSingle();

  const jobId = await createSyncScheduler().enqueue({
    jobType: 'publish_reply',
    userId: user.id,
    accountId: (review as { account_id: string } | null)?.account_id ?? null,
    locationId: reply.location_id,
    payload: { replyId },
    // Vor die Hintergrundläufe: hier wartet jemand auf das Ergebnis.
    priority: 5,
  });

  await writeAuditLog({
    userId: user.id, action: 'reply.approved',
    entityType: 'review_reply', entityId: replyId,
    metadata: { reviewId: reply.review_id, source: reply.source, jobId },
  });

  return jsonResponse(request, { queued: true, jobId, alreadyRunning: jobId === null });
}

/**
 * POST /replies/retract
 * Body: { replyId }
 *
 * Löscht eine veröffentlichte Antwort bei Google. Synchron, weil der
 * Vorgang schnell ist und der Nutzer das Ergebnis sofort sehen will.
 */
async function handleReplyRetract(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const { replyId } = await readJsonBody<{ replyId?: string }>(request);

  if (!replyId) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'replyId fehlt.', retryable: false },
    }, 400);
  }

  await new ReplyPublisher(createLogger('publish')).retract(replyId, user.id);
  return jsonResponse(request, { retracted: true });
}

/** Body lesen, ohne bei leerem oder kaputtem JSON zu werfen. */
async function readJsonBody<T>(request: Request): Promise<Partial<T>> {
  try {
    const raw = await request.text();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * GET /events/rules
 *
 * Der Regelkatalog als Dokumentation — für Entwickler, nie für
 * Kunden. Beantwortet ohne Blick in den Code: Welche Regeln gibt es,
 * was erkennen sie, warum, seit wann, in welcher Fassung, und welche
 * Kennzahl sollen sie bewegen.
 *
 * Geschützt über das Worker-Secret statt über eine Session: Es sind
 * Produktinterna, keine Kundendaten. Ein eingeloggter Kunde soll sie
 * nicht sehen — auch nicht aus Versehen.
 */
async function handleRuleCatalogue(request: Request): Promise<Response> {
  requireWorkerSecret(request);

  return jsonResponse(request, {
    engineVersion: ENGINE_VERSION,
    changelog: ENGINE_CHANGELOG,
    ruleCount: RULES.length,
    byStatus: RULES.reduce((acc, rule) => {
      acc[rule.status] = (acc[rule.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    rules: RULES.map((rule) => ({
      id: rule.id,
      status: rule.status,
      source: rule.source,
      category: rule.category,
      capability: rule.capability,
      impactMetric: rule.impactMetric ?? null,
      describes: rule.describes,
      ...rule.meta,
      /* Welche Schwellwerte die Regel liest. Aus dem Quelltext der
         Bedingung gelesen — mühsamer als eine Deklaration, aber es
         kann nicht veralten. Eine gepflegte Liste wäre nach dem
         zweiten Umbau falsch. */
      thresholds: [...new Set(
        [rule.when.toString(), rule.recommend?.toString() ?? '', rule.subjects?.toString() ?? '']
          .join(' ')
          .match(/t\(['"]([\w.]+)['"]\)/g)
          ?.map((m) => m.replace(/t\(['"]|['"]\)/g, '')) ?? [],
      )],
    })),
  });
}

/* ─────────────────────────────────────────────
   ENGINE-ROUTEN
───────────────────────────────────────────── */

/**
 * POST /events/evaluate
 *
 * Bewertet den eingeloggten Nutzer neu. Aufgerufen, wenn eine
 * Handlung die Lage geändert hat — etwa nach einer Freigabe.
 *
 * Synchron, weil der Nutzer auf das Ergebnis wartet und die
 * Bewertung eine Abfrage plus etwas Rechnerei ist, keine
 * Google-Aufrufe.
 */
async function handleEvaluate(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await enforceRateLimit(`evaluate:${user.id}`, 60);

  const result = await evaluateUser(user.id, createLogger('engine'));
  return jsonResponse(request, result);
}

/**
 * POST /events/dismiss
 * Body: { eventId: string }
 *
 * Wegklicken. Die eigentliche Prüfung steckt in der RLS-Policy —
 * der Nutzer darf nur dismissed_at setzen, und nur bei eigenen,
 * wegklickbaren Ereignissen.
 */
async function handleDismiss(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const { eventId, channel } = await readJsonBody<{ eventId?: string; channel?: string }>(request);

  if (!eventId) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'eventId fehlt.', retryable: false },
    }, 400);
  }

  /* Über die RPC, nicht per UPDATE: sie schreibt den Protokolleintrag
     und setzt die Sperrfrist. Ein direktes UPDATE würde beides
     überspringen, und die Empfehlung käme beim nächsten Lauf sofort
     wieder — genau das, was den Nutzer vertreibt. */
  const { error } = await adminClient().rpc('record_recommendation_action', {
    p_event_id: eventId,
    p_action: 'dismissed',
    p_channel: channel ?? 'dashboard',
    p_user_id: user.id,
  });

  if (error) throw new GbpError('internal_error', 'Nicht wegklickbar', { cause: error });
  return jsonResponse(request, { dismissed: true });
}

/**
 * POST /events/track
 * Body: { eventIds: string[], action: 'seen' | 'opened', channel?: string }
 *
 * Zustandswechsel aus der Oberfläche. "Gesehen" kommt gebündelt —
 * das Dashboard zeigt zehn Empfehlungen gleichzeitig, und zehn
 * einzelne Aufrufe wären zehn Roundtrips.
 */
async function handleTrack(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const { eventIds, action, channel } = await readJsonBody<{
    eventIds?: string[]; action?: string; channel?: string;
  }>(request);

  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'eventIds fehlen.', retryable: false },
    }, 400);
  }
  if (action !== 'seen' && action !== 'opened') {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'Aktion nicht erlaubt.', retryable: false },
    }, 400);
  }

  const db = adminClient();

  if (action === 'seen') {
    const { data, error } = await db.rpc('mark_recommendations_seen', {
      p_event_ids: eventIds.slice(0, 50),
      p_channel: channel ?? 'dashboard',
      p_user_id: user.id,
    });
    if (error) throw new GbpError('internal_error', 'Nicht vermerkbar', { cause: error });
    return jsonResponse(request, { tracked: data ?? 0 });
  }

  // "Geöffnet" betrifft immer genau eine Empfehlung.
  const { error } = await db.rpc('record_recommendation_action', {
    p_event_id: eventIds[0],
    p_action: 'opened',
    p_channel: channel ?? 'dashboard',
    p_user_id: user.id,
  });
  if (error) throw new GbpError('internal_error', 'Nicht vermerkbar', { cause: error });
  return jsonResponse(request, { tracked: 1 });
}

/**
 * POST /events/evaluate-all
 *
 * Alle aktiven Nutzer neu bewerten. Für den Cron — damit auch
 * zeitabhängige Ereignisse entstehen (Feiertag naht,
 * Bewertungsflaute), ohne dass ein Sync laufen muss.
 */
async function handleEvaluateAll(request: Request): Promise<Response> {
  requireWorkerSecret(request);
  const log = createLogger('engine');

  const { data, error } = await adminClient()
    .from('google_accounts')
    .select('user_id')
    .eq('status', 'active')
    .is('deleted_at', null);

  if (error) throw new GbpError('internal_error', 'Nutzer nicht ladbar', { cause: error });

  const rows = (data ?? []) as Array<{ user_id: string }>;
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  let evaluated = 0, failed = 0;

  for (const userId of userIds) {
    try { await evaluateUser(userId, log); evaluated++; }
    catch (err) { failed++; log.error('evaluate_failed', { userId, message: String(err) }); }
  }

  return jsonResponse(request, { users: userIds.length, evaluated, failed });
}

/**
 * Prüft das gemeinsame Geheimnis für Worker-Routen.
 *
 * Nötig, weil die Function ohne JWT-Prüfung läuft — ohne diese Hürde
 * könnte jeder den Worker im Sekundentakt anstossen und die
 * Google-Quota verbrennen.
 */
function requireWorkerSecret(request: Request): void {
  const expected = Deno.env.get('GBP_WORKER_SECRET');
  if (!expected) {
    throw new GbpError('config_error', 'GBP_WORKER_SECRET nicht gesetzt');
  }

  const provided = request.headers.get('X-Worker-Secret') ?? '';

  // Konstante Laufzeit: ein einfacher Vergleich verrät über die Dauer,
  // wie viele Zeichen stimmen.
  if (!timingSafeEqualStrings(provided, expected)) {
    throw new GbpError('unauthenticated', 'Ungültiges Worker-Secret');
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Längendifferenz ist ohnehin sichtbar; wichtig ist, dass der
  // Inhaltsvergleich nicht früh abbricht.
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/* ═══════════════════════════════════════════════════════════════
   12 — ROUTER
═══════════════════════════════════════════════════════════════ */

const FUNCTION_SLUG = 'google-business';

/**
 * Ermittelt die Route aus dem Pfad. Supabase reicht Unterpfade an die
 * Function durch: /functions/v1/google-business/connect → "connect".
 * Robust gegen abweichende Prefixe, weil der Slug gesucht statt
 * positionell angenommen wird.
 */
function resolveRoute(url: URL): { name: string; sub: string | null } {
  const segments = url.pathname.split('/').filter(Boolean);
  const slugIndex = segments.lastIndexOf(FUNCTION_SLUG);
  const offset = slugIndex === -1 ? segments.length - 1 : slugIndex + 1;
  return {
    name: segments[offset] ?? '',
    sub:  segments[offset + 1] ?? null,
  };
}

const ROUTES: Record<string, { method: 'GET' | 'POST'; handler: (r: Request) => Promise<Response> }> = {
  connect:    { method: 'POST', handler: handleConnect },
  callback:   { method: 'GET',  handler: handleCallback },
  status:     { method: 'GET',  handler: handleStatus },
  disconnect: { method: 'POST', handler: handleDisconnect },
  accounts:   { method: 'GET',  handler: handleAccounts },
  health:     { method: 'GET',  handler: handleHealth },
};

/* Unterrouten mit zweitem Pfadsegment: /sync/run, /sync/schedule, … */
const SYNC_ROUTES: Record<string, { method: 'GET' | 'POST'; handler: (r: Request) => Promise<Response> }> = {
  run:      { method: 'POST', handler: handleSyncRun },
  schedule: { method: 'POST', handler: handleSyncSchedule },
  trigger:  { method: 'POST', handler: handleSyncTrigger },
};

const CONNECT_ROUTES: Record<string, { method: 'GET' | 'POST'; handler: (r: Request) => Promise<Response> }> = {
  confirm: { method: 'POST', handler: handleConnectConfirm },
};

const EVENT_ROUTES: Record<string, { method: 'GET' | 'POST'; handler: (r: Request) => Promise<Response> }> = {
  evaluate:       { method: 'POST', handler: handleEvaluate },
  dismiss:        { method: 'POST', handler: handleDismiss },
  'evaluate-all': { method: 'POST', handler: handleEvaluateAll },
  track:          { method: 'POST', handler: handleTrack },
  rules:          { method: 'GET',  handler: handleRuleCatalogue },
};

const REPLY_ROUTES: Record<string, { method: 'GET' | 'POST'; handler: (r: Request) => Promise<Response> }> = {
  update:  { method: 'POST', handler: handleReplyUpdate },
  approve: { method: 'POST', handler: handleReplyApprove },
  retract: { method: 'POST', handler: handleReplyRetract },
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const { name: routeName, sub } = resolveRoute(url);

  const route =
    routeName === 'connect' && sub ? CONNECT_ROUTES[sub] :
    routeName === 'events'  && sub ? EVENT_ROUTES[sub] :
    routeName === 'sync'    ? (sub ? SYNC_ROUTES[sub] : undefined) :
    routeName === 'replies' ? (sub ? REPLY_ROUTES[sub]
                                   : { method: 'GET' as const, handler: handleRepliesList }) :
    ROUTES[routeName];

  if (!route) {
    return jsonResponse(request, {
      error: { code: 'not_found', message: 'Unbekannte Route.', retryable: false },
    }, 404);
  }

  if (request.method !== route.method) {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'Methode nicht erlaubt.', retryable: false },
    }, 405);
  }

  try {
    return await route.handler(request);
  } catch (err) {
    const gbpError = toGbpError(err);
    logError(sub ? `${routeName}/${sub}` : routeName, gbpError);
    return jsonResponse(request, gbpError.toPublic(), gbpError.status);
  }
});
