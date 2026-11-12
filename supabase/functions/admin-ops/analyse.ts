// admin-ops · Analyse (Paket B): GA4 Data API + Search Console + Produkt-Funnel.
//
// Nur lesend, nur Aggregate. Zugriff auf Google per Service Account
// (JWT-Bearer, RS256 via WebCrypto) mit den Scopes analytics.readonly und
// webmasters.readonly — nichts, was schreiben koennte.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GA4_PROPERTY_ID              Zahl, GA4 → Verwaltung → Property-Details
//   GOOGLE_SERVICE_ACCOUNT_JSON  Schluesseldatei des Service Accounts
//   GSC_SITE_URL                 z. B. sc-domain:werkruf.com
//
// Jede Quelle steht fuer sich: faellt GSC aus, kommen GA4 und der
// Produkt-Funnel trotzdem. Fehler gehen als kurzer Code an den Admin,
// nie mit Schluessel, Token oder Rohantwort.
//
// Rechnung und Anfragekoerper: src/utils/analyseBericht.js (Jest).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
// @ts-ignore: JavaScript-Modul ohne Typen
import {
  zeitraeume, ga4Anfragen, gscAnfragen, werteGa4Aus, werteGscAus, produktFunnel,
  fehlendeKonfiguration, leseServiceAccount, berlinMitternachtUtc, plusTage, GOOGLE_SCOPES,
} from '../../../src/utils/analyseBericht.js';
// @ts-ignore: JavaScript-Modul ohne Typen
import { ACCESS_SPALTEN } from '../../../src/utils/accessGate.js';

type Quelle = { status: 'ok'; daten: unknown } | { status: 'nicht_konfiguriert'; fehlt: string[] } | { status: 'fehler'; code: string };

/* Pro Isolate kurz zwischenspeichern: schont das GA4-Kontingent, wenn
   der Admin zwischen Bereichen hin- und herwechselt. */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { bis: number; wert: unknown }>();
let tokenCache: { token: string; bis: number } | null = null;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

async function googleToken(sa: { clientEmail: string; privateKey: string }): Promise<string> {
  if (tokenCache && tokenCache.bis > Date.now() + 60_000) return tokenCache.token;
  const jetzt = Math.floor(Date.now() / 1000);
  const kopf = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const inhalt = b64urlText(JSON.stringify({ iss: sa.clientEmail, scope: GOOGLE_SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: jetzt, exp: jetzt + 3600 }));
  const pem = sa.privateKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const schluessel = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', schluessel, new TextEncoder().encode(`${kopf}.${inhalt}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${kopf}.${inhalt}.${b64url(sig)}`,
  });
  if (!r.ok) throw Object.assign(new Error('token'), { code: `google_token_${r.status}` });
  const d = await r.json();
  tokenCache = { token: d.access_token, bis: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return d.access_token;
}

async function postJson(url: string, token: string, body: unknown, codePrefix: string) {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(codePrefix), { code: `${codePrefix}_${r.status}` });
  return r.json();
}

async function holeAlle(anfragen: Record<string, unknown>, ausfuehren: (body: unknown) => Promise<unknown>) {
  const namen = Object.keys(anfragen);
  const werte = await Promise.all(namen.map((n) => ausfuehren(anfragen[n])));
  return Object.fromEntries(namen.map((n, i) => [n, werte[i]]));
}

function fehlerCode(err: unknown) {
  return String((err as { code?: string })?.code ?? 'intern').slice(0, 40);
}

export async function analyseUebersicht(
  admin: SupabaseClient,
  p: { zeitraum: number },
  log: (e: string, d?: Record<string, unknown>) => void,
) {
  const schluessel = `z${p.zeitraum}`;
  const treffer = cache.get(schluessel);
  if (treffer && treffer.bis > Date.now()) return treffer.wert;

  const z = zeitraeume(p.zeitraum);
  const env = {
    GA4_PROPERTY_ID: Deno.env.get('GA4_PROPERTY_ID'),
    GOOGLE_SERVICE_ACCOUNT_JSON: Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON'),
    GSC_SITE_URL: Deno.env.get('GSC_SITE_URL'),
  };
  const fehlt: string[] = fehlendeKonfiguration(env);
  const sa = env.GOOGLE_SERVICE_ACCOUNT_JSON ? leseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON) : null;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON && !sa) fehlt.push('GOOGLE_SERVICE_ACCOUNT_JSON (ungültig)');

  let tokenVersprechen: Promise<string> | null = null;
  const tokenEinmal = () => (tokenVersprechen ??= googleToken(sa!));

  const gaFehlt = fehlt.filter((f) => !f.startsWith('GSC_'));
  const gscFehlt = fehlt.filter((f) => !f.startsWith('GA4_'));

  const ga4 = async (): Promise<Quelle> => {
    if (gaFehlt.length) return { status: 'nicht_konfiguriert', fehlt: gaFehlt };
    try {
      const token = await tokenEinmal();
      const prop = String(env.GA4_PROPERTY_ID).trim();
      const roh = await holeAlle(ga4Anfragen(z), (body) =>
        postJson(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`, token, body, 'ga4'));
      return { status: 'ok', daten: werteGa4Aus(roh) };
    } catch (err) {
      log('analyse_ga4_fehler', { code: fehlerCode(err) });
      return { status: 'fehler', code: fehlerCode(err) };
    }
  };

  const gsc = async (): Promise<Quelle> => {
    if (gscFehlt.length) return { status: 'nicht_konfiguriert', fehlt: gscFehlt };
    try {
      const token = await tokenEinmal();
      const site = encodeURIComponent(String(env.GSC_SITE_URL).trim());
      const roh = await holeAlle(gscAnfragen(z), (body) =>
        postJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, token, body, 'gsc'));
      return { status: 'ok', daten: werteGscAus(roh) };
    } catch (err) {
      log('analyse_gsc_fehler', { code: fehlerCode(err) });
      return { status: 'fehler', code: fehlerCode(err) };
    }
  };

  const produkt = async (): Promise<Quelle> => {
    try {
      const von = berlinMitternachtUtc(z.aktuell.start);
      const bis = berlinMitternachtUtc(plusTage(z.aktuell.end, 1));
      const { data: profile, error } = await admin
        .from('user_profiles')
        .select(`id, accepted_terms_at, ${ACCESS_SPALTEN}`)
        .gte('created_at', von)
        .lt('created_at', bis)
        .limit(5000);
      if (error) throw Object.assign(new Error('profile'), { code: 'db_profile' });
      const ids = (profile ?? []).map((x: { id: string }) => x.id);
      let verbundene = new Set<string>();
      if (ids.length) {
        const { data: konten, error: e2 } = await admin
          .from('google_accounts').select('user_id').eq('status', 'active').is('deleted_at', null).in('user_id', ids);
        if (e2) throw Object.assign(new Error('google'), { code: 'db_google' });
        verbundene = new Set((konten ?? []).map((k: { user_id: string }) => k.user_id));
      }
      return { status: 'ok', daten: produktFunnel(profile ?? [], verbundene) };
    } catch (err) {
      log('analyse_produkt_fehler', { code: fehlerCode(err) });
      return { status: 'fehler', code: fehlerCode(err) };
    }
  };

  /* Ein Token fuer GA4 und GSC (beide laufen parallel). */
  const [g, s, pf] = await Promise.all([ga4(), gsc(), produkt()]);
  const wert = { zeitraum: z, ga4: g, gsc: s, produkt: pf, erzeugt: new Date().toISOString() };
  /* Nur vollstaendige Antworten zwischenspeichern — ein Fehler soll
     beim naechsten Klick neu versucht werden. */
  if (g.status !== 'fehler' && s.status !== 'fehler' && pf.status !== 'fehler') cache.set(schluessel, { bis: Date.now() + CACHE_MS, wert });
  return wert;
}
