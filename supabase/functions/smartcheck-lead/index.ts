/*
 * smartcheck-lead — nimmt einen Lead aus dem oeffentlichen SmartCheck an.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESE FUNCTION GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Bis zum 13.10.2026 schrieb SmartCheck direkt aus dem Browser:
 *
 *   src/components/SmartCheck.js:415
 *     await supabase.from('leads').insert([...]);
 *   src/components/SmartCheck.js:416
 *     catch(e) { console.error(e); }
 *   src/components/SmartCheck.js:418
 *     setPhase('sent');            ← bedingungslos
 *
 * Ein Besucher ohne Login ist `anon`. RLS verweigert anon das INSERT auf
 * public.leads (nachgewiesen im G2-Restore-Beweis: "public.leads: anon
 * hat INSERT, RLS verweigert es (keine Policy)"). Der Lead fiel also auf
 * den Boden, und der Besucher bekam "gesendet".
 *
 * Und der Fehler wurde nicht einmal verschluckt: der Supabase-Client
 * WIRFT bei einem Datenbankfehler nicht, er gibt { error } zurueck. Der
 * catch-Block fing nie etwas — der Fehler wurde nie angesehen. Das ist
 * schlimmer als eine ignorierte Exception, weil es im Code aussieht wie
 * eine Fehlerbehandlung.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM SERVERSEITIG UND NICHT PER GRANT
 * ═══════════════════════════════════════════════════════════════
 *
 * Der naheliegende Fix waere
 *
 *   grant insert on public.leads to anon;
 *   create policy ... for insert to anon with check (true);
 *
 * Ein Einzeiler — und ein Spam-Tor. Der anon-Schluessel wird im
 * Browser-Bundle ausgeliefert; jeder kann damit beliebig viele Zeilen
 * in die Leadliste schreiben, ohne Rate-Limit, ohne Validierung, ohne
 * dass eine Policy das unterscheiden koennte. Ausserdem haette es
 * G2.2 (deny by default) an der ersten Stelle aufgeweicht, an der es
 * unbequem wurde.
 *
 * Dieser Weg hier existierte bereits: request-profile-report ist seit
 * dem 28.09.2026 ein oeffentlicher, registrierungsfreier Endpunkt mit
 * Herkunftspruefung, Validierung, atomarem Rate-Limit und
 * Service-Role-Write. Diese Function folgt demselben Aufbau — bewusst
 * bis in die Hilfsfunktionen hinein, damit es ein Muster bleibt und
 * nicht zwei werden.
 *
 * ═══════════════════════════════════════════════════════════════
 * SCHUTZSCHICHTEN, IN DIESER REIHENFOLGE
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. Herkunft    nur die konfigurierten Origins
 *   2. Methode     nur POST
 *   3. Form        JSON, bekannte Felder, Laengen, E-Mail-Muster
 *   4. Bremse      check_rate_limit je IP und je E-Mail
 *   5. Doppelung   gleicher Lead binnen einer Stunde → kein zweiter Satz
 *   6. Write       service_role, Fehler wird GEMELDET, nicht geschluckt
 *
 * Erst wenn 6 bestaetigt, antwortet die Function mit stored: true. Das
 * Frontend darf Erfolg nur dann zeigen.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS SIE NICHT TUT
 * ═══════════════════════════════════════════════════════════════
 *
 * Keine Google-Abfrage, kein PDF, keine Mail. Der SmartCheck ermittelt
 * die Kennzahlen im Browser ueber die Places-API und schickt sie mit;
 * diese Function bewertet nichts nach. Wer einen serverseitig
 * berechneten Bericht will, nimmt request-profile-report — das ist ein
 * anderer Funnel mit anderem Versprechen.
 *
 * Konsequenz, die man kennen muss: die mitgeschickten Kennzahlen
 * (score, rating, reviewCount) kommen vom Client und sind damit nicht
 * vertrauenswuerdig. Sie landen als Anhaltspunkt in der Leadliste, nie
 * in einer Entscheidung. Deshalb werden sie unten hart auf plausible
 * Bereiche begrenzt, statt sie zu uebernehmen wie sie kommen.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

/* ── Herkunft ──
   Dieselbe Umgebungsvariable wie request-profile-report: es ist
   dieselbe Frage ("von welcher Seite darf ein anonymer Aufruf
   kommen"), und zwei Listen waeren zwei Wahrheiten. */
const allowedOrigins = () => (Deno.env.get('PUBLIC_REPORT_ALLOWED_ORIGINS') ?? '')
  .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') ?? '').replace(/\/$/, '');
  const allowOrigin = allowedOrigins().includes(origin) ? origin : '';
  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors(req), 'content-type': 'application/json' },
  });

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name}`);
  return value;
};

const sha = async (value: string) =>
  Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )).map(x => x.toString(16).padStart(2, '0')).join('');

/* trim + harte Laengengrenze. Nicht "kuerzen, falls zu lang" als
   Nebeneffekt irgendwo im Code, sondern an der Grenze, einmal. */
const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/* Zahl aus dem Browser: nur annehmen, wenn sie eine Zahl IST und im
   plausiblen Bereich liegt. null statt Fehler — eine fehlende Kennzahl
   darf keinen Lead verhindern. */
const zahl = (value: unknown, min: number, max: number): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,255}$/;

/* Felder, die diese Function kennt. Alles andere wird verworfen —
   §6 des Auftrags: "Keine ungefilterten Browserobjekte persistieren."
   Ein unbekanntes Feld ist kein Fehler (sonst bricht jeder
   Frontend-Vorlauf), aber es kommt auch nicht in die Datenbank. */
const BEKANNTE_FELDER = new Set([
  'email', 'companyName', 'city', 'placeId', 'industryKey',
  'score', 'rating', 'reviewCount', 'trade',
]);

Deno.serve(async req => {
  /* 1 — Herkunft. Vor allem anderen, auch vor OPTIONS: ein Aufruf von
     einer fremden Seite bekommt keine CORS-Erlaubnis und damit auch
     keine Auskunft darueber, dass dieser Endpunkt existiert. */
  const requestOrigin = (req.headers.get('origin') ?? '').replace(/\/$/, '');
  if (!allowedOrigins().includes(requestOrigin)) {
    return json(req, { error: 'origin_not_allowed' }, 403);
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  /* 2 — Form */
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid_json' }, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(req, { error: 'invalid_json' }, 400);
  }

  /* Unbekannte Felder: werden ignoriert, aber gezaehlt. Ein Frontend,
     das ploetzlich etwas Neues mitschickt, soll im Protokoll
     auffallen und nicht stillschweigend die Haelfte verlieren. */
  const unbekannt = Object.keys(body).filter(k => !BEKANNTE_FELDER.has(k));

  const email    = clean(body.email, 254).toLowerCase();
  const company  = clean(body.companyName, 200);
  const city     = clean(body.city, 120);
  const placeId  = clean(body.placeId, 255);
  const industry = clean(body.industryKey, 32) || 'handwerk';
  const trade    = clean(body.trade, 120);

  if (!EMAIL.test(email))        return json(req, { error: 'invalid_email' }, 422);
  if (!company)                  return json(req, { error: 'missing_company' }, 422);
  if (placeId && !PLACE_ID.test(placeId)) {
    return json(req, { error: 'invalid_place_id' }, 422);
  }

  const score  = zahl(body.score, 0, 100);
  const rating = zahl(body.rating, 0, 5);
  const count  = zahl(body.reviewCount, 0, 1_000_000);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unbekannt';

  let db;
  try {
    db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
  } catch (fehler) {
    console.error('[smartcheck-lead] Konfiguration fehlt', String(fehler));
    return json(req, { error: 'not_configured' }, 503);
  }

  /* 3 — Bremse.
     check_rate_limit ist der Mechanismus, den google-business und
     generate-review-reply schon benutzen (p_key, p_limit, p_window).
     Kein zweiter gebaut.

     Zwei Schluessel, weil sie zwei verschiedene Missbraeuche treffen:
     eine IP, die hundert Formulare abschickt, und eine Mailadresse,
     die ueber wechselnde IPs eingetragen wird. Die E-Mail wird
     gehasht — ein Rate-Limit-Schluessel ist kein Ort fuer eine
     Kundenmailadresse.

     Bei einem FEHLER der Bremse wird NICHT durchgelassen. Sonst waere
     eine ueberlastete Datenbank der einfachste Weg, sie auszuhebeln —
     dieselbe Begruendung steht in google-business/index.ts. */
  const emailHash = await sha(email);
  const [limitIp, limitMail] = await Promise.all([
    db.rpc('check_rate_limit', { p_key: `smartcheck_ip:${ip}`, p_limit: 20, p_window: '01:00:00' }),
    db.rpc('check_rate_limit', { p_key: `smartcheck_mail:${emailHash.slice(0, 32)}`, p_limit: 3, p_window: '01:00:00' }),
  ]);

  for (const l of [limitIp, limitMail]) {
    if (l.error) {
      console.error('[smartcheck-lead] Limitpruefung fehlgeschlagen', l.error.message);
      return json(req, { error: 'rate_limit_unavailable' }, 503);
    }
    if ((l.data as { allowed?: boolean } | null)?.allowed === false) {
      return json(req, { error: 'rate_limited' }, 429);
    }
  }

  /* 4 — Doppelung.
     §9 Punkt 6: "doppelter Submit sinnvoll behandelt". Ein Besucher,
     der zweimal klickt, soll keine zwei Leads erzeugen und trotzdem
     eine Erfolgsmeldung sehen — ein Fehler waere hier falsch, denn
     sein Lead IST gespeichert.

     Keine Unique-Bedingung in der Datenbank: die waere eine Migration
     auf einer Tabelle mit Altbestand, und "gleicher Lead" ist eine
     fachliche und keine strukturelle Aussage (dieselbe Mail darf nach
     Wochen wieder eintragen). Ein Fenster von einer Stunde reicht
     gegen Doppelklicks und gegen einen erneuten Versuch nach einem
     Netzfehler. */
  const seit = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: vorhanden, error: suchFehler } = await db
    .from('leads').select('id')
    .eq('email', email).eq('source', 'smart_check')
    .gte('created_at', seit)
    .limit(1).maybeSingle();

  if (suchFehler) {
    console.error('[smartcheck-lead] Doppelungspruefung fehlgeschlagen', suchFehler.message);
    return json(req, { error: 'storage_failed' }, 500);
  }

  if (vorhanden) {
    return json(req, { stored: true, duplicate: true, leadId: vorhanden.id }, 200);
  }

  /* 5 — Write.
     Der ganze Zweck dieser Function: der Fehler wird ANGESEHEN. */
  const { data: lead, error: schreibFehler } = await db
    .from('leads')
    .insert({
      company_name:     company,
      contact_person:   '-',
      phone:            '-',
      city:             city || null,
      trade:            trade || null,
      email,
      source:           'smart_check',
      status:           'new',
      industry_key:     industry,
      google_place_id:  placeId || null,
      visibility_score: score,
      google_rating:    rating,
      google_review_count: count,
    })
    .select('id')
    .single();

  if (schreibFehler || !lead) {
    /* Keine Interna nach draussen: der Besucher bekommt einen Code,
       das Protokoll die Ursache. */
    console.error('[smartcheck-lead] Lead nicht gespeichert', schreibFehler?.message ?? 'kein Datensatz');
    return json(req, { error: 'storage_failed' }, 500);
  }

  if (unbekannt.length > 0) {
    console.warn('[smartcheck-lead] unbekannte Felder verworfen', unbekannt.join(','));
  }

  return json(req, { stored: true, leadId: lead.id }, 201);
});
