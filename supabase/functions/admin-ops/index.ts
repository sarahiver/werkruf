// admin-ops — der eine serverseitige Admin-Endpunkt (H3).
//
// ═══════════════════════════════════════════════════════════════
// WAS SICH GEGENUEBER DER VORFASSUNG AENDERT
// ═══════════════════════════════════════════════════════════════
//
// Vorher: ein POST ohne Parameter, das immer dasselbe tat — bis zu
// 100 Profile, dazu listUsers({ perPage: 1000 }) und EIN
// compute_health_score-RPC PRO KUNDE. Bei 100 Kunden also 100 RPCs
// pro Seitenaufbau; genau das, was H3 §43 verbietet.
//
// Jetzt: eine Aktion je Aufruf, aus einer Allowlist, mit geprueften
// Parametern und Audit fuer alles, was schreibt.
//
//   list_customers               Suche, serverseitig begrenzt
//   get_customer_support_state   der Snapshot fuer EINEN Kunden
//   trigger_customer_sync        Job einreihen, Kunden-/Standort-Scope
//   set_founding_partner         bestehende RPC
//   clear_founding_partner       bestehende RPC
//
// Die Liste laedt keine Scores mehr. Teure Details gehoeren in die
// Detailansicht, und die holt genau einen Kunden (§43).
//
// ═══════════════════════════════════════════════════════════════
// WO DIE REGELN STEHEN
// ═══════════════════════════════════════════════════════════════
//
// Nicht hier. Wer darf, welche Aktionen es gibt, was ein gueltiger
// Parameter ist und wie der Snapshot aussieht, steht in
// src/utils/adminOps.js — als reines JavaScript, damit Jest es
// wirklich aufruft.
//
// Diese Datei holt Daten und schreibt; sie entscheidet nichts. Der
// Grund ist handfest: `deno check` laeuft in dieser Umgebung nicht,
// und ein Jest-Test koennte diese Datei nur als TEXT pruefen. In
// H2.2 hat genau diese Art Pruefung dreimal einen Kommentar
// getroffen statt Code — einmal mit dem Ergebnis, dass ein
// behobener Befund unbemerkt blieb.
//
// ═══════════════════════════════════════════════════════════════
// KEINE FREIE SCHNITTSTELLE
// ═══════════════════════════════════════════════════════════════
//
// §26: kein execute_sql, kein table/column/value. Jede Aktion steht
// in ADMIN_AKTIONEN, jeder Parameter wird geprueft und auf das
// Erlaubte reduziert. Was nicht in der Allowlist steht, bekommt 400
// — und ein Nicht-Admin bekommt 403, bevor er erfaehrt, welche
// Aktionen es gibt.
//
// §45: keine destruktiven Aktionen. Kein Loeschen, kein Leeren von
// Queues, keine Stripe-Manipulation, keine Google-Schreibaktion.
//
// Deploy via Supabase Dashboard:
//   Edge Functions → admin-ops → Code ersetzen → Deploy
//   Verify JWT: AN (der Aufruf kommt aus dem eingeloggten Admin-UI)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

import {
  pruefeAnfrage,
  baueSupportSnapshot,
  baueAuditEintrag,
} from '../../../src/utils/adminOps.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

/* Protokoll ohne Geheimnisse (§23). Hier landet nie ein Token, nie
   ein Service-Key, nie ein Auth-Objekt — nur Aktion, Admin, Ziel. */
const log = (ereignis: string, daten: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ scope: 'admin-ops', ereignis, ...daten }));
};

function umgebung(name: string): string {
  const wert = Deno.env.get(name);
  if (!wert) throw new Error(`${name} fehlt`);
  return wert;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = umgebung('SUPABASE_URL');

  /* ── 1. Wer ruft ──

     Der Anon-Key-Client dient ausschliesslich dazu, das mitgeschickte
     JWT von Supabase pruefen zu lassen. Er liest keine Daten; dafuer
     kommt unten der Service-Role-Client. */
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Nicht angemeldet' }, 401);

  /* Eigener Typ statt `typeof authUser`: der erste Entwurf schrieb
     `data.user as typeof authUser`, und weil die Variable zu diesem
     Zeitpunkt noch `null` ist, hiess das "wandle User in null um".
     deno check in CI hat das als TS2352 gemeldet, und die Folge war
     eine Kette von `never`-Fehlern. */
  interface Aufrufer {
    id: string;
    app_metadata?: { role?: string } & Record<string, unknown>;
  }

  /* ═══════════════════════════════════════════════════════════
     GEAENDERT AM 21.10.2026 — WARUM NICHT MEHR DER ANON-CLIENT
     ═══════════════════════════════════════════════════════════

     Bis hierher stand: createClient(url, SUPABASE_ANON_KEY, { global:
     { headers: { Authorization } } }) und dann getUser() OHNE
     Argument. In Produktion antwortete das fuer einen gueltigen
     ES256-Admin-Token mit "Nicht angemeldet" — und weil die Zeile den
     Fehler von getUser() verwarf, stand in den Logs nichts. Die
     Ursache war von aussen nicht zu bestimmen.

     google-business prueft denselben Token seit jeher anders und
     nachweislich erfolgreich: Service-Role-Client, Token EXPLIZIT an
     getUser(token). Genau das hier. Zwei Unterschiede weniger, die
     schiefgehen koennen: keine Abhaengigkeit vom eingespielten
     Anon-Key, keine Abhaengigkeit davon, wie supabase-js ohne Sitzung
     mit globalen Headern umgeht.

     Dieser Client dient AUSSCHLIESSLICH der Tokenpruefung. Er ist auf
     diesen try-Block begrenzt und ruft nie .from() oder .rpc(). Der
     Datenzugriff kommt erst nach dem Urteil (const admin = … unten).
     Ein Test haelt beides fest.

     Und: Scheitert die Pruefung, steht der Grund im Log — Code,
     Status, Meldung. Nie der Token. */
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Nicht angemeldet' }, 401);
  const token = authHeader.slice(7).trim();
  if (!token) return json({ error: 'Nicht angemeldet' }, 401);

  let aufrufer: Aufrufer | null = null;
  try {
    const pruefer = createClient(url, umgebung('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await pruefer.auth.getUser(token);
    if (error || !data?.user) {
      log('auth_abgelehnt', {
        code:    (error as { code?: string } | null)?.code ?? null,
        status:  (error as { status?: number } | null)?.status ?? null,
        message: error?.message ?? 'kein Nutzer in der Antwort',
      });
      return json({ error: 'Nicht angemeldet' }, 401);
    }
    aufrufer = { id: data.user.id, app_metadata: data.user.app_metadata };
  } catch (err) {
    log('auth_fehler', { message: String(err) });
    return json({ error: 'Nicht angemeldet' }, 401);
  }

  if (!aufrufer) return json({ error: 'Nicht angemeldet' }, 401);

  /* ── 2. Darf er das ──

     pruefeAnfrage macht alles in einem: Sitzung, Adminrolle, Aktion
     aus der Allowlist, Parameter. Rueckwaertskompatibel: ein Body
     ohne `action` ist die alte Kundenliste. Die Oberflaeche und die
     Function werden getrennt deployt, und zwischen den beiden
     Deploys soll das Admin-UI nicht leer sein. */
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const aktion = typeof body.action === 'string' && body.action
    ? body.action
    : 'list_customers';

  const urteil = pruefeAnfrage({
    authUser: aufrufer,
    aktion,
    parameter: (body.params as Record<string, unknown>) ?? body,
  });

  if (!urteil.erlaubt) {
    log('abgewiesen', {
      status: urteil.status,
      aktion,
      adminId: aufrufer.id,
      grund: urteil.fehler,
    });
    return json({ error: urteil.fehler }, urteil.status);
  }

  const admin = createClient(url, umgebung('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* Nach `if (!urteil.erlaubt) return` ist parameter gesetzt — aber
     der Rueckgabetyp kommt aus einer JS-Datei, und TypeScript kann
     die Union dort nicht am Feld `erlaubt` unterscheiden. Deshalb
     hier ausdruecklich und nicht mit `!`: ein leeres Objekt ist der
     richtige Fallback, weil jede Aktion ihre Parameter selbst prueft
     und `pruefeAnfrage` sie bereits reduziert hat. */
  const parameter: Record<string, unknown> = urteil.parameter ?? {};
  const adminId = aufrufer.id;

  try {
    switch (urteil.aktion) {
      case 'list_customers':
        return json(await listeKunden(admin, parameter));

      case 'get_customer_support_state':
        return json(await supportZustand(admin, parameter.userId as string));

      case 'trigger_customer_sync':
        return json(await stosseSyncAn(admin, adminId, parameter));

      case 'set_founding_partner':
        return json(await setzeFoundingPartner(admin, adminId, parameter));

      case 'clear_founding_partner':
        return json(await entzieheFoundingPartner(admin, adminId, parameter));

      case 'list_support_requests':
        return json(await listeSupportAnfragen(admin, parameter));

      case 'set_support_status':
        return json(await setzeSupportStatus(admin, adminId, parameter));

      case 'reply_support_request':
        return json(await beantworteSupportAnfrage(admin, adminId, parameter));

      default:
        /* Unerreichbar: pruefeAnfrage laesst nur die Allowlist durch.
           Steht hier, damit eine neue Aktion in adminOps.js ohne
           Handler nicht stillschweigend 200 liefert. */
        return json({ error: 'Aktion ohne Handler' }, 500);
    }
  } catch (err) {
    /* §24: brauchbarer Fehler, aber keine rohe Ausgabe. Der Code
       geht an den Browser, die Einzelheiten ins Log. */
    log('handler_fehler', { aktion: urteil.aktion, adminId, message: String(err) });
    return json({ error: 'Aktion fehlgeschlagen', code: fehlerCode(err) }, 500);
  }
});

function fehlerCode(err: unknown): string {
  const text = String((err as { code?: string })?.code ?? '');
  return text || 'intern';
}

/* ═════════════════════════════════════════════
   LISTE
   ═════════════════════════════════════════════ */

/* Als ein Zeichenketten-Literal und nicht als join() ueber ein Array:
   postgrest-js leitet den Zeilentyp aus dem select-Text ab. Ist der
   Text zur Uebersetzungszeit unbekannt, faellt der Typ auf
   GenericStringError zurueck, und jeder Feldzugriff darauf ist ein
   Fehler. Gefunden hat das `deno check` in CI — zehn Meldungen aus
   dieser einen Zeile. */
const LISTEN_SPALTEN =
  'id,company_name,plan,created_at,stripe_subscription_status,founding_partner_since,accepted_terms_at';

/**
 * Kundensuche (§5, §42).
 *
 * Gesucht wird nach Unternehmensname, User-ID und Standortname; die
 * Mailadresse kommt aus auth.users und wird deshalb getrennt
 * aufgeloest.
 *
 * Keine Vollabfrage: `limit` ist serverseitig auf 100 begrenzt
 * (adminOps.js), ohne Angabe 25. Und keine Scores — die Liste soll
 * eine Zeile pro Kunde kosten, nicht einen RPC.
 */
async function listeKunden(admin: SupabaseClient, p: Record<string, unknown>) {
  const suche = String(p.suche ?? '').trim();
  const limit = Number(p.limit ?? 25);

  let treffer: string[] | null = null;

  if (suche) {
    const ids = new Set<string>();

    /* Direkte UUID — der schnellste Weg, wenn der Support eine ID
       aus einem Log kopiert. */
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suche)) {
      ids.add(suche.toLowerCase());
    }

    const muster = `%${suche.replace(/[%_]/g, (z) => `\\${z}`)}%`;

    const [nachFirma, nachStandort] = await Promise.all([
      admin.from('user_profiles').select('id').ilike('company_name', muster).limit(limit),
      admin.from('google_locations').select('user_id').ilike('title', muster).limit(limit),
    ]);
    if (nachFirma.error) throw nachFirma.error;
    if (nachStandort.error) throw nachStandort.error;

    (nachFirma.data ?? []).forEach((r) => ids.add(r.id));
    (nachStandort.data ?? []).forEach((r) => { if (r.user_id) ids.add(r.user_id); });

    /* Mailadresse: auth.users ist nicht per PostgREST filterbar.
       listUsers mit kleiner Seite statt perPage 1000 wie vorher. */
    const { data: authListe } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    (authListe?.users ?? [])
      .filter((u) => (u.email ?? '').toLowerCase().includes(suche.toLowerCase()))
      .forEach((u) => ids.add(u.id));

    treffer = [...ids].slice(0, limit);
    if (treffer.length === 0) {
      return { customers: [], suche, generatedAt: new Date().toISOString() };
    }
  }

  let abfrage = admin.from('user_profiles').select(LISTEN_SPALTEN)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (treffer) abfrage = abfrage.in('id', treffer);

  const { data: profile, error } = await abfrage;
  if (error) throw error;

  const ids = (profile ?? []).map((row) => row.id);

  /* Zwei Abfragen fuer die ganze Liste, nicht zwei pro Kunde. */
  const [konten, { data: authListe }] = await Promise.all([
    ids.length
      ? admin.from('google_accounts').select('user_id,status,deleted_at').in('user_id', ids)
      : Promise.resolve({ data: [], error: null }),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);
  if ((konten as { error?: unknown }).error) throw (konten as { error: unknown }).error;

  const kontoJeUser = new Map<string, { status?: string; deleted_at?: string | null }>();
  ((konten as { data?: Array<{ user_id: string; status?: string; deleted_at?: string | null }> }).data ?? [])
    .forEach((k) => { if (!kontoJeUser.has(k.user_id)) kontoJeUser.set(k.user_id, k); });

  const mailJeUser = new Map((authListe?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return {
    customers: (profile ?? []).map((row) => {
      const konto = kontoJeUser.get(row.id);
      return {
        id: row.id,
        unternehmen: row.company_name,
        email: mailJeUser.get(row.id) ?? null,
        plan: row.plan,
        stripeStatus: row.stripe_subscription_status,
        foundingPartnerSeit: row.founding_partner_since,
        consentVorhanden: Boolean(row.accepted_terms_at),
        registriertAm: row.created_at,
        googleStatus: !konto ? 'not_connected'
          : konto.deleted_at ? 'deleted'
          : (konto.status ?? 'unbekannt'),
      };
    }),
    suche,
    generatedAt: new Date().toISOString(),
  };
}

/* ═════════════════════════════════════════════
   SNAPSHOT
   ═════════════════════════════════════════════ */

/**
 * Alles fuer einen Kunden, in einem Rutsch (§28, §30).
 *
 * Sieben gezielte Abfragen parallel, danach formt
 * baueSupportSnapshot. Keine Tokens, keine Secrets, kein
 * vollstaendiges Auth-Objekt (§23, §41) — aus auth.users kommt
 * ausschliesslich die Mailadresse.
 */
async function supportZustand(admin: SupabaseClient, userId: string) {
  const [profil, konto, standorte, jobs, mails, events, authUser] = await Promise.all([
    admin.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('google_accounts')
      .select('id,status,connected_at,last_error_code,last_error_at,deleted_at')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('google_locations')
      .select('id,title,locality,place_id,is_primary,selected_at,last_synced_at,review_count,average_rating,google_media,deleted_at')
      .eq('user_id', userId).order('created_at', { ascending: true }),
    admin.from('sync_jobs')
      .select('id,job_type,status,location_id,attempts,max_attempts,error_code,error_message,finished_at,created_at,updated_at')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(25),
    admin.from('email_queue')
      .select('id,template,status,to_email,scheduled_for,sent_at,attempts,error_code')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(25),
    admin.from('events')
      .select('id,type,category,recommendation_class,priority,lifecycle,location_id,created_at,in_weekly_email,cooldown_until')
      .eq('user_id', userId).in('lifecycle', ['new', 'seen', 'opened'])
      .order('priority', { ascending: false }).limit(50),
    admin.auth.admin.getUserById(userId),
  ]);

  for (const r of [profil, konto, standorte, jobs, mails, events]) {
    if ((r as { error?: unknown }).error) throw (r as { error: unknown }).error;
  }

  if (!profil.data) return { snapshot: null, error: 'Kein Profil zu dieser ID' };

  return {
    snapshot: baueSupportSnapshot({
      profil: profil.data,
      authEmail: authUser.data?.user?.email ?? null,
      konto: konto.data ?? null,
      standorte: standorte.data ?? [],
      jobs: jobs.data ?? [],
      mails: mails.data ?? [],
      events: events.data ?? [],
    }),
    generatedAt: new Date().toISOString(),
  };
}

/* ═════════════════════════════════════════════
   AKTIONEN
   ═════════════════════════════════════════════ */

/** Audit, immer — auch bei Fehlschlag (§22). */
async function auditiere(
  admin: SupabaseClient,
  eintrag: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from('audit_logs').insert(eintrag);
  if (error) {
    /* Das Audit darf die Aktion nicht verschlucken, aber sein
       Ausfall darf auch nicht unsichtbar sein. */
    log('audit_fehlgeschlagen', { action: eintrag.action, message: String(error.message) });
  }
}

/**
 * Sync fuer genau diesen Kunden (§11, §36).
 *
 * Ueber public.enqueue_sync_job, also ueber dieselbe Queue und
 * dieselbe Lock-Mechanik wie jeder andere Sync. Kein direkter
 * Funktionsaufruf, der parallel zum Worker laeuft, und kein globaler
 * Sync.
 *
 * Standortwahl: der uebergebene Standort, sonst der gewaehlte, sonst
 * der einzige. Gibt es keinen, wird ein sync_locations-Job
 * eingereiht — das ist der Fall "Google verbunden, keine Standorte",
 * und genau dort ist ein Standortimport die richtige Antwort.
 */
async function stosseSyncAn(
  admin: SupabaseClient,
  adminId: string,
  p: Record<string, unknown>,
) {
  const userId = p.userId as string;
  const gewuenscht = (p.locationId as string | null) ?? null;

  const { data: konto, error: kontoFehler } = await admin
    .from('google_accounts')
    .select('id,status,deleted_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1).maybeSingle();
  if (kontoFehler) throw kontoFehler;

  if (!konto || konto.deleted_at) {
    const ergebnis = { ok: false, code: 'kein_google_konto' };
    await auditiere(admin, baueAuditEintrag({
      aktion: 'trigger_customer_sync', adminId, userId, erfolg: false, fehler: ergebnis.code,
    }));
    return ergebnis;
  }

  const { data: standorte, error: standortFehler } = await admin
    .from('google_locations')
    .select('id,selected_at,deleted_at')
    .eq('user_id', userId);
  if (standortFehler) throw standortFehler;

  const aktive = (standorte ?? []).filter((s) => !s.deleted_at);
  const ziel = gewuenscht
    ? aktive.find((s) => s.id === gewuenscht)
    : aktive.find((s) => s.selected_at) ?? (aktive.length === 1 ? aktive[0] : null);

  if (gewuenscht && !ziel) {
    /* Fremder oder geloeschter Standort. Nicht einfach den eigenen
       nehmen — das waere eine stille Umdeutung (§36). */
    const ergebnis = { ok: false, code: 'standort_gehoert_nicht_zum_kunden' };
    await auditiere(admin, baueAuditEintrag({
      aktion: 'trigger_customer_sync', adminId, userId, erfolg: false, fehler: ergebnis.code,
    }));
    return ergebnis;
  }

  const jobArt = ziel ? 'sync_reviews' : 'sync_locations';

  const { data: jobId, error: jobFehler } = await admin.rpc('enqueue_sync_job', {
    p_job_type: jobArt,
    p_user_id: userId,
    p_account_id: konto.id,
    p_location_id: ziel?.id ?? null,
    p_payload: { ausgeloestVon: 'admin-ops', adminId },
    p_priority: 5,
  });

  if (jobFehler) {
    await auditiere(admin, baueAuditEintrag({
      aktion: 'trigger_customer_sync', adminId, userId, erfolg: false, fehler: jobFehler.message,
    }));
    throw jobFehler;
  }

  const ergebnis = {
    ok: true,
    jobId: jobId ?? null,
    jobArt,
    locationId: ziel?.id ?? null,
    /* sync_reviews bewertet die Engine nach dem Sync selbst
       (evaluateUser im Worker). Deshalb gibt es in H3 keine eigene
       "Engine neu bewerten"-Aktion — siehe docs/h3-support-minimum.md. */
    engineWirdNeuBewertet: jobArt === 'sync_reviews',
  };

  await auditiere(admin, baueAuditEintrag({
    aktion: 'trigger_customer_sync', adminId, userId, erfolg: true, ergebnis,
  }));

  log('sync_eingereiht', { adminId, userId, jobArt, jobId: jobId ?? null });
  return ergebnis;
}

/**
 * Founding Partner setzen (§19, §20).
 *
 * Ueber public.set_founding_partner, nicht ueber ein Update auf
 * user_profiles.plan. Die RPC setzt plan UND
 * founding_partner_since/-note zusammen; ein direktes Update wuerde
 * den Plan ohne das Datum setzen, und damit waere nicht mehr
 * feststellbar, seit wann jemand dabei ist.
 */
async function setzeFoundingPartner(
  admin: SupabaseClient,
  adminId: string,
  p: Record<string, unknown>,
) {
  const userId = p.userId as string;

  const { data: vorher, error: leseFehler } = await admin
    .from('user_profiles').select('plan').eq('id', userId).maybeSingle();
  if (leseFehler) throw leseFehler;

  if (!vorher) {
    const ergebnis = { ok: false, code: 'kein_profil' };
    await auditiere(admin, baueAuditEintrag({
      aktion: 'set_founding_partner', adminId, userId, erfolg: false, fehler: ergebnis.code,
    }));
    return ergebnis;
  }

  const { data: seit, error } = await admin.rpc('set_founding_partner', {
    p_user_id: userId,
    p_note: (p.note as string | null) ?? null,
  });

  if (error) {
    await auditiere(admin, baueAuditEintrag({
      aktion: 'set_founding_partner', adminId, userId, erfolg: false, fehler: error.message,
    }));
    throw error;
  }

  const ergebnis = { ok: true, planVorher: vorher.plan, seit: seit ?? null };
  await auditiere(admin, baueAuditEintrag({
    aktion: 'set_founding_partner', adminId, userId, erfolg: true, ergebnis,
  }));
  log('founding_partner_gesetzt', { adminId, userId, planVorher: vorher.plan });
  return ergebnis;
}

/**
 * Founding Partner entziehen (§21).
 *
 * Die Folgen stehen in der Antwort, damit die Oberflaeche sie zeigen
 * kann, ohne sie selbst herzuleiten: operative Mails hoeren auf, die
 * Pro-Funktionen sind gesperrt. Beides folgt aus hasPaidAccess und
 * wantsOperationalMail, nicht aus einer zweiten Regel hier.
 */
async function entzieheFoundingPartner(
  admin: SupabaseClient,
  adminId: string,
  p: Record<string, unknown>,
) {
  const userId = p.userId as string;

  const { data: vorher, error: leseFehler } = await admin
    .from('user_profiles').select('plan').eq('id', userId).maybeSingle();
  if (leseFehler) throw leseFehler;

  if (vorher?.plan !== 'founding_partner') {
    const ergebnis = { ok: false, code: 'kein_founding_partner', planAktuell: vorher?.plan ?? null };
    await auditiere(admin, baueAuditEintrag({
      aktion: 'clear_founding_partner', adminId, userId, erfolg: false, fehler: ergebnis.code,
    }));
    return ergebnis;
  }

  const { data: planVorher, error } = await admin.rpc('clear_founding_partner', {
    p_user_id: userId,
    p_plan: (p.plan as string) ?? 'free',
  });

  if (error) {
    await auditiere(admin, baueAuditEintrag({
      aktion: 'clear_founding_partner', adminId, userId, erfolg: false, fehler: error.message,
    }));
    throw error;
  }

  const ergebnis = {
    ok: true,
    planVorher: planVorher ?? 'founding_partner',
    planJetzt: (p.plan as string) ?? 'free',
    folgen: ['operative Mails hoeren auf', 'Pro-Funktionen sind gesperrt'],
  };

  await auditiere(admin, baueAuditEintrag({
    aktion: 'clear_founding_partner', adminId, userId, erfolg: true, ergebnis,
  }));
  log('founding_partner_entzogen', { adminId, userId });
  return ergebnis;
}

/* ═══════════════════════════════════════════════════════════════
   DIREKTER DRAHT — Supportanfragen der Founding Partner (21.10.2026)
   ═══════════════════════════════════════════════════════════════

   Zwei Aktionen. Lesen liefert die Anfragen mit Betrieb und E-Mail —
   der Anbieter antwortet per Mail, also muss die Adresse hier stehen.
   Der Statuswechsel laeuft ueber set_support_request_status() in der
   Datenbank, nicht ueber ein freies UPDATE (§19): Die Funktion prueft
   den Uebergang und setzt answered_at genau einmal. */

async function listeSupportAnfragen(
  admin: SupabaseClient,
  p: Record<string, unknown>,
) {
  const status = (p.status as string) ?? 'open';
  const limit  = (p.limit as number) ?? 50;

  let abfrage = admin
    .from('support_requests')
    .select('id, user_id, subject, body, status, created_at, answered_at, admin_note')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'alle') abfrage = abfrage.eq('status', status);

  const { data: anfragen, error } = await abfrage;
  if (error) throw error;
  if (!anfragen || anfragen.length === 0) {
    return { requests: [], status, generatedAt: new Date().toISOString() };
  }

  /* Betrieb und E-Mail dazu. E-Mail aus auth.users ueber die Admin-API —
     user_profiles traegt sie nicht. Eine Abfrage je Nutzer, aber die
     Liste ist klein (Founding Partner sind eine Handvoll) und begrenzt. */
  const nutzerIds = [...new Set(anfragen.map((a) => a.user_id as string))];
  const { data: profile } = await admin
    .from('user_profiles').select('id, company_name, plan').in('id', nutzerIds);
  const firmen = new Map((profile ?? []).map((pr) => [pr.id as string, pr]));

  const mails = new Map<string, string | null>();
  for (const id of nutzerIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    mails.set(id, data?.user?.email ?? null);
  }

  return {
    status,
    generatedAt: new Date().toISOString(),
    requests: anfragen.map((a) => ({
      id: a.id,
      userId: a.user_id,
      betrieb: firmen.get(a.user_id as string)?.company_name ?? null,
      plan: firmen.get(a.user_id as string)?.plan ?? null,
      email: mails.get(a.user_id as string) ?? null,
      betreff: a.subject,
      text: a.body,
      status: a.status,
      seit: a.created_at,
      beantwortetAm: a.answered_at,
      notiz: a.admin_note,
    })),
  };
}

async function setzeSupportStatus(
  admin: SupabaseClient,
  adminId: string,
  p: Record<string, unknown>,
) {
  const requestId = p.requestId as string;

  const { data: zeile, error } = await admin.rpc('set_support_request_status', {
    p_request_id: requestId,
    p_status:     p.status as string,
    p_admin_note: (p.note as string | null) ?? null,
  });

  /* Die userId fuer das Audit kommt aus der Zeile selbst — der Client
     schickt sie nicht mit. Bei einem Fehler kennen wir sie nicht;
     dann steht die requestId im Ergebnis. */
  if (error) {
    await auditiere(admin, baueAuditEintrag({
      aktion: 'set_support_status', adminId, userId: null, erfolg: false, fehler: error.message,
      ergebnis: { requestId },
    }));
    throw error;
  }

  const ergebnis = {
    ok: true,
    requestId,
    status: (zeile as { status?: string } | null)?.status ?? (p.status as string),
    beantwortetAm: (zeile as { answered_at?: string } | null)?.answered_at ?? null,
  };

  await auditiere(admin, baueAuditEintrag({
    aktion: 'set_support_status', adminId,
    userId: (zeile as { user_id?: string } | null)?.user_id ?? null,
    erfolg: true, ergebnis,
  }));
  log('support_status_gesetzt', { adminId, requestId, status: ergebnis.status });
  return ergebnis;
}

/* Antwort auf eine Supportanfrage (22.10.2026). Alles Fachliche —
   Speichern, Status, Mail — passiert in reply_support_request() in
   EINER Transaktion. Hier nur Aufruf und Audit. Der Antworttext steht
   nicht im Audit: Er steht in der Anfrage selbst. */
async function beantworteSupportAnfrage(
  admin: SupabaseClient,
  adminId: string,
  p: Record<string, unknown>,
) {
  const requestId = p.requestId as string;

  const { data: zeile, error } = await admin.rpc('reply_support_request', {
    p_request_id: requestId,
    p_reply:      p.reply as string,
  });

  if (error) {
    await auditiere(admin, baueAuditEintrag({
      aktion: 'reply_support_request', adminId, userId: null, erfolg: false, fehler: error.message,
      ergebnis: { requestId },
    }));
    throw error;
  }

  const ergebnis = {
    ok: true,
    requestId,
    status: (zeile as { status?: string } | null)?.status ?? 'answered',
    beantwortetAm: (zeile as { replied_at?: string } | null)?.replied_at ?? null,
    zeichen: String(p.reply ?? '').length,
  };

  await auditiere(admin, baueAuditEintrag({
    aktion: 'reply_support_request', adminId,
    userId: (zeile as { user_id?: string } | null)?.user_id ?? null,
    erfolg: true, ergebnis,
  }));
  log('support_beantwortet', { adminId, requestId, zeichen: ergebnis.zeichen });
  return ergebnis;
}
