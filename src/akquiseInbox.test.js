/**
 * WP16.1-Fix — externe Lead-Inbox als eigene Function `acquisition-inbox`.
 *
 *   T1–T5    Function existiert, verify_jwt=false, admin-ops unveraendert
 *            (false + eigene Nutzerpruefung, siehe config.toml 21.10.2026),
 *            keine Inbox-Route mehr in admin-ops, kein JWT noetig
 *   T6–T11   Secret: 503/503/401/401/ok, geteilter zeitkonstanter Helper,
 *            vor dem Body, nie geloggt, nie in der Antwort
 *   T12–T18  Preview/Commit ueber acquisition_import_rows (Kanal inbox),
 *            leadId durchgereicht, keine eigene Dedupe
 *   T19–T22  keine Mail, nur Status neu, kein FP — mit Wirkung in
 *            supabase/tests/akquise_import.test.sql (Block E; Dedupe B,
 *            Idempotenz C, Lock H)
 *   T23–T26  Admin: CSV weiter ueber admin-ops, Fehlertext sichtbar
 *
 * Die Anfragelogik (src/utils/akquiseInbox.js) wird hier mit Fakes
 * AUSGEFUEHRT — Status, Aufrufe, Logs —, nicht im Quelltext gesucht.
 */
import fs from 'fs';
import path from 'path';
import { verarbeiteInboxAnfrage, INBOX_AUDIT_AKTION } from './utils/akquiseInbox';
import { serverFehlertext } from './utils/adminFehler';

const WURZEL = path.resolve(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CONFIG = lies('supabase/config.toml');
const verifyJwt = (name) => {
  const m = new RegExp(`\\[functions\\.${name}\\]\\s*\\n((?:(?!\\[functions\\.)[^\\n]*\\n?)*)`).exec(CONFIG);
  const v = m && /verify_jwt\s*=\s*(true|false)/.exec(m[1]);
  return v ? v[1] === 'true' : null;
};

const SECRET = 'S'.repeat(24) + '-geheim-42';
const ZEILE = { company_name: 'Elektro Krause GmbH', email: 'Info@Elektro-Krause.de', city: 'Hamburg', website: 'https://elektro-krause.de', personalized_sentence: 'Satz' };
const DB_ANTWORT = {
  ok: true, mode: 'commit', reused: false, importId: 'imp-1',
  counts: { rows: 1, new: 1, duplicate: 0, duplicateInImport: 0, possibleDuplicate: 0, invalid: 0 },
  rows: [{ i: 1, status: 'new', grund: null, leadId: 'lead-1', companyName: 'Elektro Krause GmbH', email: 'info@elektro-krause.de' }],
};

function lauf(ueber = {}) {
  const aufrufe = { importiere: [], audit: [], log: [], body: 0 };
  const a = {
    methode: 'POST',
    secretKopf: SECRET,
    secret: SECRET,
    body: { source: 'chatgpt_recherche', externalImportId: 'recherche-2026-11-10', mode: 'commit', rows: [ZEILE] },
    dbAntwort: (e) => ({ ...DB_ANTWORT, mode: e.mode, importId: e.mode === 'commit' ? 'imp-1' : null }),
    ...ueber,
  };
  return verarbeiteInboxAnfrage({
    methode: a.methode,
    secretKopf: a.secretKopf,
    secret: a.secret,
    leseBody: async () => { aufrufe.body += 1; if (a.body instanceof Error) throw a.body; return a.body; },
    importiere: async (e) => { aufrufe.importiere.push(e); if (a.dbAntwort instanceof Error) throw a.dbAntwort; return a.dbAntwort(e); },
    auditiere: async (x) => { aufrufe.audit.push(x); },
    log: (ereignis, daten) => { aufrufe.log.push({ ereignis, daten }); },
  }).then((r) => ({ ...r, aufrufe }));
}

/* ───────── T1–T5: Function und Gateway ───────── */
describe('Function-Zuschnitt', () => {
  it('T1 — acquisition-inbox existiert und nutzt die geteilte Logik', () => {
    const quelle = lies('supabase/functions/acquisition-inbox/index.ts');
    expect(quelle).toMatch(/import \{ verarbeiteInboxAnfrage \} from '\.\.\/\.\.\/\.\.\/src\/utils\/akquiseInbox\.js'/);
    expect(quelle).toMatch(/Deno\.env\.get\('ACQUISITION_IMPORT_SECRET'\)/);
    expect(quelle).toMatch(/req\.headers\.get\('x-werkruf-import-secret'\)/);
  });
  it('T2 — acquisition-inbox: verify_jwt = false (Repo-Kanon config.toml, Deploy-Workflow liest ihn)', () => {
    expect(verifyJwt('acquisition-inbox')).toBe(false);
  });
  it('T3 — admin-ops: Konfiguration unveraendert (false seit 21.10.2026) UND prueft den Nutzer selbst, vor jeder Aktion', () => {
    /* Der Brief nahm verify_jwt = true an. Tatsaechlich steht admin-ops
       wegen des ES256-Gateway-Fehlers auf false; true wuerde den Admin
       sperren. Geprueft wird deshalb, dass die eigene Pruefung bleibt. */
    expect(verifyJwt('admin-ops')).toBe(false);
    const ao = ohneKommentare(lies('supabase/functions/admin-ops/index.ts'));
    const getUser = ao.indexOf('auth.getUser(token)');
    expect(getUser).toBeGreaterThan(ao.indexOf('serve('));
    expect(getUser).toBeLessThan(ao.indexOf('if (!urteil.erlaubt)'));
    expect(ao).toMatch(/if \(!authHeader\) return json\(\{ error: 'Nicht angemeldet' \}, 401\)/);
  });
  it('T4 — admin-ops hat keine Inbox-Route mehr: jeder Pfad laeuft durch die Admin-Pruefung', () => {
    const ao = ohneKommentare(lies('supabase/functions/admin-ops/index.ts'));
    expect(ao).not.toMatch(/acquisition-inbox|leadInbox|pruefeInboxZugang|ACQUISITION_IMPORT_SECRET|x-werkruf-import-secret|pathname/);
  });
  it('T5 — die Inbox braucht kein JWT: keine Nutzerpruefung, kein Authorization-Header', () => {
    const quelle = ohneKommentare(lies('supabase/functions/acquisition-inbox/index.ts')) + ohneKommentare(lies('src/utils/akquiseInbox.js'));
    expect(quelle).not.toMatch(/getUser|authorization|requireUser|app_metadata/i);
  });
  it('kein Browser-CORS: kein Access-Control-Allow-Origin, OPTIONS → 405', async () => {
    expect(ohneKommentare(lies('supabase/functions/acquisition-inbox/index.ts'))).not.toMatch(/Access-Control-Allow-Origin|corsHeaders/);
    const r = await lauf({ methode: 'OPTIONS' });
    expect(r.status).toBe(405);
    expect(r.headers).toEqual({ Allow: 'POST' });
  });
  it('nur POST — GET, PUT, DELETE → 405, ohne Secret-Pruefung, ohne Body, ohne DB', async () => {
    for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const r = await lauf({ methode: m });
      expect(r.status).toBe(405);
      expect(r.aufrufe.importiere).toEqual([]);
      expect(r.aufrufe.body).toBe(0);
    }
  });
});

/* ───────── T6–T11: Secret ───────── */
describe('Secret', () => {
  const nichtsPassiert = (r) => {
    expect(r.aufrufe.body).toBe(0);            // Body nicht einmal gelesen
    expect(r.aufrufe.importiere).toEqual([]);  // kein DB-Kontakt
    expect(r.aufrufe.audit).toEqual([]);
  };
  it('T6 — Secret nicht gesetzt → 503', async () => {
    for (const secret of [undefined, null, '']) {
      const r = await lauf({ secret });
      expect(r).toMatchObject({ status: 503, body: { error: 'Inbox nicht konfiguriert' } });
      nichtsPassiert(r);
    }
  });
  it('T7 — Secret zu kurz (< 16) → 503, auch wenn der Header passt', async () => {
    const r = await lauf({ secret: 'kurz-123', secretKopf: 'kurz-123' });
    expect(r.status).toBe(503);
    nichtsPassiert(r);
  });
  it('T8 — Header fehlt → 401', async () => {
    for (const secretKopf of [null, undefined, '']) {
      const r = await lauf({ secretKopf });
      expect(r).toMatchObject({ status: 401, body: { error: 'Nicht berechtigt' } });
      nichtsPassiert(r);
    }
  });
  it('T9 — Header falsch → 401 (auch knapp daneben)', async () => {
    for (const secretKopf of ['falsch', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toLowerCase(), ` ${SECRET}`]) {
      const r = await lauf({ secretKopf });
      expect(r.status).toBe(401);
      nichtsPassiert(r);
    }
  });
  it('T10 — richtiges Secret → Verarbeitung', async () => {
    const r = await lauf();
    expect(r.status).toBe(200);
    expect(r.aufrufe.importiere).toHaveLength(1);
  });
  it('T11 — geteilter, zeitkonstanter Helper; Secret nie in Log oder Antwort', async () => {
    expect(ohneKommentare(lies('src/utils/akquiseInbox.js'))).toMatch(/pruefeInboxZugang\(secretKopf, secret\)/);
    const alle = [await lauf(), await lauf({ secretKopf: 'falsch' }), await lauf({ dbAntwort: new Error('x') })];
    for (const r of alle) {
      const text = JSON.stringify([r.body, r.aufrufe.log, r.aufrufe.audit]);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('falsch');
    }
  });
});

/* ───────── T12–T18: Import ───────── */
describe('Import ueber den zentralen Pfad', () => {
  it('T12 — Preview: Modus preview an die DB, kein Audit', async () => {
    const r = await lauf({ body: { source: 'liste', externalImportId: 'lauf-0001', mode: 'preview', rows: [ZEILE] } });
    expect(r.status).toBe(200);
    expect(r.aufrufe.importiere[0]).toMatchObject({ mode: 'preview', channel: 'inbox' });
    expect(r.aufrufe.audit).toEqual([]);
  });
  it('T13 — Commit (Standard): Kanal inbox, Quelle/Import-ID unveraendert, Zeilen durch bereiteImportVor', async () => {
    const r = await lauf({ body: { source: ' ChatGPT_Recherche ', externalImportId: 'recherche-2026-11-10', rows: [ZEILE, { email: 'kaputt' }] } });
    expect(r.status).toBe(200);
    expect(r.aufrufe.importiere).toEqual([{
      mode: 'commit', channel: 'inbox', source: 'chatgpt_recherche', importId: 'recherche-2026-11-10',
      zeilen: [
        { i: 1, werte: { company_name: 'Elektro Krause GmbH', email: 'info@elektro-krause.de', city: 'Hamburg', website: 'https://elektro-krause.de', personalized_sentence: 'Satz' }, quelle: null, fehler: null },
        { i: 2, werte: null, quelle: null, fehler: 'E-Mail ist ungültig' },
      ],
    }]);
  });
  it('T14–T17 — keine eigene Dedupe/Idempotenz/Lock: die Antwort der DB geht unveraendert zurueck', async () => {
    const db = { ...DB_ANTWORT, reused: true, counts: { ...DB_ANTWORT.counts, new: 0, duplicate: 1 }, rows: [{ ...DB_ANTWORT.rows[0], status: 'duplicate', leadId: 'alt-1' }] };
    const r = await lauf({ dbAntwort: () => db });
    expect(r.body).toBe(db);
    /* Dieselbe Zeile zweimal im Request: die Logik filtert NICHT selbst —
       duplicate_in_import entscheidet acquisition_import_rows. */
    const zwei = await lauf({ body: { source: 'liste', externalImportId: 'lauf-0002', rows: [ZEILE, ZEILE] } });
    expect(zwei.aufrufe.importiere[0].zeilen).toHaveLength(2);
    const quelle = ohneKommentare(lies('src/utils/akquiseInbox.js'));
    expect(quelle).not.toMatch(/acquisition_website_key|acquisition_google_key|advisory|new Set|\.filter\(/);
  });
  it('T18 — leadId je Zeile kommt beim Aufrufer an (fuer werkruf_lead_id)', async () => {
    const r = await lauf();
    expect(r.body.rows[0]).toMatchObject({ i: 1, status: 'new', leadId: 'lead-1' });
  });
  it('Commit: Audit system.acquisition_inbox_import nur mit Quelle, Import-ID, Zaehlern — keine Zeilen, keine PII', async () => {
    const r = await lauf();
    expect(r.aufrufe.audit).toEqual([{
      user_id: null, actor_type: 'system', actor_id: null, action: INBOX_AUDIT_AKTION,
      entity_type: 'acquisition_imports', entity_id: 'imp-1',
      metadata: { source: 'chatgpt_recherche', externalImportId: 'recherche-2026-11-10', reused: false, counts: DB_ANTWORT.counts },
    }]);
    expect(INBOX_AUDIT_AKTION).toBe('system.acquisition_inbox_import');
    const text = JSON.stringify([r.aufrufe.audit, r.aufrufe.log]);
    expect(text).not.toMatch(/krause|elektro|Satz|Hamburg/i);
    expect(r.aufrufe.log.map((l) => l.ereignis)).toEqual(['inbox_import_success']);
  });
  it('DB-Fehler → 500 „Import fehlgeschlagen", Log inbox_import_failed nur mit Code', async () => {
    const r = await lauf({ dbAntwort: Object.assign(new Error('relation … info@elektro-krause.de'), { code: 'PGRST202' }) });
    expect(r).toMatchObject({ status: 500, body: { error: 'Import fehlgeschlagen' } });
    expect(r.aufrufe.log).toEqual([{ ereignis: 'inbox_import_failed', daten: { mode: 'commit', source: 'chatgpt_recherche', externalImportId: 'recherche-2026-11-10', code: 'PGRST202' } }]);
    expect(r.aufrufe.audit).toEqual([]);
  });
  it('Payload-Grenzen: kaputtes JSON, source, externalImportId, rows leer, > 1000 → 400 ohne DB', async () => {
    const faelle = [
      { body: new Error('json') }, { body: [] }, { body: null },
      { body: { source: 'X Y!', externalImportId: 'lauf-0001', rows: [ZEILE] } },
      { body: { source: 'liste', externalImportId: 'x', rows: [ZEILE] } },
      { body: { source: 'liste', externalImportId: 'lauf-0001', rows: [] } },
      { body: { source: 'liste', externalImportId: 'lauf-0001', rows: Array.from({ length: 1001 }, () => ZEILE) } },
    ];
    for (const f of faelle) {
      const r = await lauf(f);
      expect(r.status).toBe(400);
      expect(r.aufrufe.importiere).toEqual([]);
    }
  });
});

/* ───────── T19–T22: keine Mail ───────── */
describe('Inbox legt nur Leads an', () => {
  it('T19–T22 — kein Mailweg, kein Status, kein FP in Function oder Logik (Wirkung: akquise_import.test.sql Block E)', () => {
    const quelle = ohneKommentare(lies('supabase/functions/acquisition-inbox/index.ts')) + ohneKommentare(lies('src/utils/akquiseInbox.js'));
    expect(quelle).not.toMatch(/send-email|enqueue_email|email_queue|outreach_messages|acquisition_send|founding_partner|acquisition_status|\.update\(|functions\.invoke/);
    /* Genau zwei DB-Wege: der Import-RPC und das Audit. */
    expect(quelle.match(/\.rpc\('/g)).toHaveLength(1);
    expect(quelle).toMatch(/\.rpc\('acquisition_import_rows'/);
    expect(quelle.match(/\.from\('/g)).toHaveLength(1);
    expect(quelle).toMatch(/\.from\('audit_logs'\)\.insert/);
    const sql = lies('supabase/tests/akquise_import.test.sql');
    expect(sql).toMatch(/C6: Import erzeugte Mail\/Versand/);
    expect(sql).toMatch(/'inbox', 'chatgpt_recherche'/);
  });
});

/* ───────── T23–T26: Admin ───────── */
describe('Admin-Regression', () => {
  it('T24 — CSV-Import bleibt in admin-ops (Admin-Allowlist), nicht in der Inbox', () => {
    const ao = lies('supabase/functions/admin-ops/index.ts');
    expect(ao).toMatch(/case 'acquisition_import':/);
    expect(ao).toMatch(/channel: 'csv'/);
    expect(lies('supabase/functions/acquisition-inbox/index.ts')).not.toMatch(/acquisition_import'|channel: 'csv'/);
  });
  it('T23/T26 — Fehler von admin-ops werden im Admin lesbar statt „non-2xx"', async () => {
    const antwort = (status, body) => ({ status, clone() { return this; }, json: async () => body });
    expect(await serverFehlertext({ message: 'Edge Function returned a non-2xx status code', context: antwort(500, { error: 'Aktion fehlgeschlagen', code: 'PGRST202' }) }))
      .toBe('Aktion fehlgeschlagen (500, PGRST202)');
    expect(await serverFehlertext({ message: 'x', context: antwort(400, { error: 'rows: höchstens 1000 Zeilen' }) })).toBe('rows: höchstens 1000 Zeilen (400)');
    expect(await serverFehlertext({ message: 'Edge Function returned a non-2xx status code', context: { status: 502, json: async () => { throw new Error('kein json'); } } }))
      .toBe('Edge Function returned a non-2xx status code');
    expect(await serverFehlertext({ message: 'Netzwerk' })).toBe('Netzwerk');
    expect(await serverFehlertext(null)).toBe('Aufruf fehlgeschlagen');
  });
});
