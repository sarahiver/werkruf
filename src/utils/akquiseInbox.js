/*
 * Externe Lead-Inbox (WP16.1-Fix) — die ganze Anfragelogik, ohne Deno.
 *
 * supabase/functions/acquisition-inbox/index.ts ist nur die Huelle:
 * Umgebung lesen, Service-Role-Client bauen, diese Funktion aufrufen.
 * So prueft Jest die Wirkung (Status, was aufgerufen wird, was nicht),
 * statt Quelltext nach Mustern abzusuchen.
 *
 *   POST → Secret (pruefeInboxZugang) → Payload → bereiteImportVor
 *        → acquisition_import_rows (channel 'inbox') → JSON
 *
 * Kein Admin, keine UI, keine Mail, kein Status ausser „neu". Dedupe,
 * Idempotenz und Lock liegen ausschliesslich in acquisition_import_rows.
 */

import { bereiteImportVor, MAX_ZEILEN, pruefeInboxZugang } from './akquiseImport.js';

export const INBOX_AUDIT_AKTION = 'system.acquisition_inbox_import';

/**
 * @param {object} a
 * @param {string} a.methode                HTTP-Methode
 * @param {string|null} a.secretKopf        Header X-Werkruf-Import-Secret
 * @param {string|null|undefined} a.secret  ACQUISITION_IMPORT_SECRET
 * @param {() => Promise<unknown>} a.leseBody  liefert das geparste JSON (wirft bei kaputtem JSON)
 * @param {(e: {mode:string, channel:'inbox', source:string, importId:string, zeilen:Array}) => Promise<any>} a.importiere
 *        ruft acquisition_import_rows — erst NACH der Secret-Pruefung erzeugt
 * @param {(eintrag: Record<string, unknown>) => Promise<void>} a.auditiere
 * @param {(ereignis: string, daten?: Record<string, unknown>) => void} a.log
 * @returns {Promise<{status:number, body:object, headers?:object}>}
 */
export async function verarbeiteInboxAnfrage({ methode, secretKopf, secret, leseBody, importiere, auditiere, log }) {
  if (methode !== 'POST') return { status: 405, body: { error: 'Method not allowed' }, headers: { Allow: 'POST' } };

  /* Zuerst das Secret — vor jedem Lesen des Bodys, vor jedem DB-Kontakt. */
  const zugang = pruefeInboxZugang(secretKopf, secret);
  if (!zugang.ok) {
    log(zugang.status === 503 ? 'inbox_nicht_konfiguriert' : 'inbox_abgelehnt', { status: zugang.status });
    return { status: zugang.status, body: { error: zugang.fehler } };
  }

  let body;
  try { body = await leseBody(); } catch { return { status: 400, body: { error: 'Kein JSON' } }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'Kein JSON' } };

  const source = typeof body.source === 'string' ? body.source.trim().toLowerCase() : '';
  const importId = typeof body.externalImportId === 'string' ? body.externalImportId.trim() : '';
  const mode = body.mode === 'preview' ? 'preview' : 'commit';
  if (!/^[a-z0-9_-]{2,40}$/.test(source)) return { status: 400, body: { error: 'source ungültig (a-z, 0-9, _ -, 2–40 Zeichen)' } };
  if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(importId)) return { status: 400, body: { error: 'externalImportId ungültig (4–120 Zeichen)' } };
  if (!Array.isArray(body.rows) || body.rows.length === 0) return { status: 400, body: { error: 'rows fehlt' } };
  if (body.rows.length > MAX_ZEILEN) return { status: 400, body: { error: `Höchstens ${MAX_ZEILEN} Zeilen je Import` } };

  /* Zeilen als flache Objekte; Zeilennummer = Position (1-basiert). */
  const zeilen = bereiteImportVor(body.rows.map((roh, idx) => ({ i: idx + 1, roh: roh && typeof roh === 'object' ? roh : {} })));

  try {
    const r = await importiere({ mode, channel: 'inbox', source, importId, zeilen });
    if (mode === 'commit') {
      /* Keine Zeileninhalte, keine Mails, keine Namen — nur Zaehler. */
      await auditiere({
        user_id: null, actor_type: 'system', actor_id: null, action: INBOX_AUDIT_AKTION,
        entity_type: 'acquisition_imports', entity_id: r?.importId ?? null,
        metadata: { source, externalImportId: importId, reused: Boolean(r?.reused), counts: r?.counts ?? null },
      });
    }
    log('inbox_import_success', { mode, source, externalImportId: importId, reused: Boolean(r?.reused), counts: r?.counts ?? null });
    return { status: 200, body: r };
  } catch (err) {
    /* Nur der Code ins Log (z. B. PGRST202 = Migration fehlt), nie die Zeilen. */
    log('inbox_import_failed', { mode, source, externalImportId: importId, code: String(err?.code ?? 'intern').slice(0, 40) });
    return { status: 500, body: { error: 'Import fehlgeschlagen' } };
  }
}
