// acquisition-inbox — externe Lead-Inbox, Server zu Server (WP16.1-Fix).
//
// POST https://<projekt>.supabase.co/functions/v1/acquisition-inbox
// Header X-Werkruf-Import-Secret: <ACQUISITION_IMPORT_SECRET>
//
// Warum eine eigene Function und nicht mehr admin-ops/acquisition-inbox:
// admin-ops ist der Admin-Endpunkt (Nutzerpruefung per getUser, Admin-
// Allowlist). Eine Route mit ganz anderem Zugang (Shared Secret, kein
// Nutzer) gehoert nicht hinein — diese Function kann nichts ausser
// Leads anlegen.
//
// verify_jwt = false (supabase/config.toml): der Aufrufer hat kein
// Supabase-JWT. Schutz: pruefeInboxZugang — ohne Secret 503, falsch
// 401, zeitkonstant, vor jedem Lesen des Bodys.
//
// Die Logik steht in src/utils/akquiseInbox.js (Jest prueft sie mit
// Wirkung). Dedupe, Idempotenz und Lock liegen in der Datenbank
// (acquisition_import_rows) — derselbe Pfad wie der CSV-Import.
//
// Kein CORS: keine Browser-API. Kein Access-Control-Allow-Origin.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// @ts-ignore: JavaScript-Modul ohne Typen
import { verarbeiteInboxAnfrage } from '../../../src/utils/akquiseInbox.js';

/* Protokoll ohne Geheimnisse: nie Secret, nie Service-Key, nie Zeilen. */
const log = (ereignis: string, daten: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ scope: 'acquisition-inbox', ereignis, ...daten }));
};

const antwort = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

serve(async (req) => {
  try {
    /* Der Client entsteht erst, wenn importiert wird — also erst nach
       der Secret-Pruefung. Ohne gueltiges Secret kein DB-Kontakt. */
    let client: ReturnType<typeof createClient> | null = null;
    const db = () => {
      if (!client) {
        const url = Deno.env.get('SUPABASE_URL');
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!url || !key) throw Object.assign(new Error('Umgebung unvollstaendig'), { code: 'env' });
        client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      }
      return client;
    };

    const r = await verarbeiteInboxAnfrage({
      methode: req.method,
      secretKopf: req.headers.get('x-werkruf-import-secret'),
      secret: Deno.env.get('ACQUISITION_IMPORT_SECRET'),
      leseBody: () => req.json(),
      importiere: async (e: { mode: string; channel: string; source: string; importId: string; zeilen: unknown[] }) => {
        const { data, error } = await db().rpc('acquisition_import_rows', {
          p_mode: e.mode, p_channel: e.channel, p_source: e.source, p_external_import_id: e.importId,
          p_rows: e.zeilen, p_created_by: null,
        });
        if (error) throw error;
        return data;
      },
      auditiere: async (eintrag: Record<string, unknown>) => {
        const { error } = await db().from('audit_logs').insert(eintrag);
        if (error) log('audit_fehlgeschlagen', { message: String(error.message).slice(0, 200) });
      },
      log,
    }) as { status: number; body: unknown; headers?: Record<string, string> };
    return antwort(r.status, r.body, r.headers ?? {});
  } catch (err) {
    log('inbox_import_failed', { code: String((err as { code?: string })?.code ?? 'intern').slice(0, 40) });
    return antwort(500, { error: 'Import fehlgeschlagen' });
  }
});
