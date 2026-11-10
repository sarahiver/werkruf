/**
 * WP16.1 — Lead-Import (CSV + externe Inbox), Browser- und Serverseite.
 *
 *   CSV        Parser (BOM, CRLF/LF, Quotes, Komma/Umbruch in Quotes,
 *              Semikolon, leere Zellen), Kopfzeile, Grenzen
 *   Aufbereit. bereiteImportVor = bestehender Lead-Kanon
 *   Allowlist  acquisition_import: Modus, Import-ID, Zeilen serverseitig
 *              neu aufbereitet, Nicht-Admin 403
 *   Server     admin-ops: Inbox vor Admin-Tor, Secret 503/401 zeitkonstant,
 *              EIN Importpfad, kein Versand/Status, Audit
 *   UI         Datei → Vorschau → Reiter → Commit genau einmal → Ergebnis
 *   SQL-Seite: supabase/tests/akquise_import.test.sql (Dedupe mit Wirkung)
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  parseCsv, erkenneTrennzeichen, csvZuZeilen, bereiteImportVor, standardReiter, zeilenFuerReiter,
  neueImportId, pruefeInboxZugang, CSV_VORLAGE_KOPF, IMPORT_SPALTEN, IGNORIERTE_SPALTEN, MAX_ZEILEN, IMPORT_STATUS, IMPORT_STATUS_TEXT,
} from './utils/akquiseImport';
import { ADMIN_AKTIONEN, pruefeAnfrage } from './utils/adminOps';
import AkquiseImport from './components/admin/AkquiseImport';

/* jsdom dieser react-scripts-Version hat kein window.crypto; Browser und
   Deno haben es. Node-WebCrypto einsetzen, keine Attrappe. */
if (typeof window !== 'undefined' && !window.crypto) {
  Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
}

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ADMIN = { id: '00000000-0000-4000-8000-00000000ad01', app_metadata: { role: 'admin' } };
const NUTZER = { id: '00000000-0000-4000-8000-0000000000b1', app_metadata: {} };
const AO = lies('../supabase/functions/admin-ops/index.ts');
const MIG = lies('../supabase/migrations/20261115090000_akquise_import.sql');
const KOPF = 'company_name,contact_person,email,phone,trade,city,website,google_profile_url,personalized_sentence,note,source,import_status,imported_at,werkruf_lead_id';

/* ───────── CSV ───────── */
describe('CSV-Parser', () => {
  it('Vorlage = Spaltenschema aus dem Auftrag; Workflow-Spalten werden ignoriert', () => {
    expect(CSV_VORLAGE_KOPF).toBe(KOPF);
    expect(IGNORIERTE_SPALTEN).toEqual(['import_status', 'imported_at', 'werkruf_lead_id']);
    for (const s of IGNORIERTE_SPALTEN) expect(IMPORT_SPALTEN).not.toContain(s);
  });
  it('BOM, CRLF, Komma und Zeilenumbruch in Quotes, "" als Quote, leere Zellen', () => {
    const csv = `﻿company_name,email,note\r\n"Krause, Elektro",info@krause.de,"Zeile 1\r\nZeile 2"\r\n"Sag ""Hallo""",a@b.de,\r\n`;
    expect(parseCsv(csv, ',')).toEqual([
      ['company_name', 'email', 'note'],
      ['Krause, Elektro', 'info@krause.de', 'Zeile 1\r\nZeile 2'],
      ['Sag "Hallo"', 'a@b.de', ''],
    ]);
    const r = csvZuZeilen(csv);
    expect(r.ok).toBe(true);
    expect(r.zeilen).toEqual([
      { i: 2, roh: { company_name: 'Krause, Elektro', email: 'info@krause.de', note: 'Zeile 1\r\nZeile 2' } },
      { i: 3, roh: { company_name: 'Sag "Hallo"', email: 'a@b.de', note: '' } },
    ]);
  });
  it('LF und Semikolon (deutsches Excel) werden erkannt', () => {
    expect(erkenneTrennzeichen('company_name;email;city\n')).toBe(';');
    expect(erkenneTrennzeichen('"a;b",c,d\n')).toBe(',');   // Semikolon in Quotes zaehlt nicht
    const r = csvZuZeilen('company_name;email;city\nKrause GmbH;info@krause.de;Kiel\n\n');
    expect(r).toMatchObject({ ok: true, trennzeichen: ';', zeilen: [{ i: 2, roh: { company_name: 'Krause GmbH', email: 'info@krause.de', city: 'Kiel' } }] });
  });
  it('Kopfzeile: Gross/Klein und Leerzeichen egal; ignorierte und unbekannte Spalten landen nie in Lead-Feldern', () => {
    const r = csvZuZeilen(`${KOPF},geheim\nA,,a@b.de,,,,,,,,liste1,done,2026-01-01,abc,x\n`.replace('company_name', ' Company_Name '));
    expect(r.ok).toBe(true);
    expect(r.unbekannteSpalten).toEqual(['geheim']);
    expect(Object.keys(r.zeilen[0].roh)).toEqual(IMPORT_SPALTEN);
    expect(r.zeilen[0].roh).not.toHaveProperty('werkruf_lead_id');
    expect(r.zeilen[0].roh).not.toHaveProperty('geheim');
  });
  it('Falsche Kopfzeile, doppelte Spalten, leere Datei, nur Kopf, > 1000 Zeilen → klare Meldung', () => {
    const f1 = csvZuZeilen('firma,mail\nA,a@b.de\n');
    expect(f1.ok).toBe(false);
    expect(f1.fehler).toMatch(/Pflichtspalten fehlen: company_name, email/);
    expect(f1.fehler).toContain(KOPF);
    expect(csvZuZeilen('company_name,email,email\nA,a@b.de,c@d.de\n')).toEqual({ ok: false, fehler: 'Spalte mehrfach vorhanden: email' });
    expect(csvZuZeilen('   ').ok).toBe(false);
    expect(csvZuZeilen('company_name,email\n').fehler).toMatch(/keine Datenzeilen/);
    const viele = `company_name,email\n${Array.from({ length: MAX_ZEILEN + 1 }, (_, k) => `B${k},b${k}@x.de`).join('\n')}`;
    expect(csvZuZeilen(viele).fehler).toMatch(/Höchstens 1000 Zeilen/);
    expect(csvZuZeilen(`company_name,email\n${Array.from({ length: MAX_ZEILEN }, (_, k) => `B${k},b${k}@x.de`).join('\n')}`).ok).toBe(true);
  });
});

/* ───────── Aufbereitung = Lead-Kanon ───────── */
describe('bereiteImportVor', () => {
  it('nutzt pruefeLeadEingabe: Mail normalisiert, Felder getrimmt, leere Zellen nicht gesetzt', () => {
    expect(bereiteImportVor([{ i: 2, roh: { company_name: ' Krause ', email: ' Info@Krause.DE ', city: '', note: '  ', source: ' liste_a ' } }]))
      .toEqual([{ i: 2, werte: { company_name: 'Krause', email: 'info@krause.de' }, quelle: 'liste_a', fehler: null }]);
  });
  it('ungueltige Zeilen tragen den Grund, Werte fallen weg', () => {
    const r = bereiteImportVor([
      { i: 2, roh: { company_name: 'A', email: 'kaputt' } },
      { i: 3, roh: { email: 'a@b.de' } },
      { i: 4, roh: { company_name: 'A', email: 'a@b.de', website: 'ohne-protokoll.de' } },
      { i: 5, roh: { company_name: 'A', email: 'a@b.de', source: 'x'.repeat(61) } },
    ]);
    expect(r.map((z) => z.werte)).toEqual([null, null, null, null]);
    expect(r[1].fehler).toBe('Betrieb (company_name) fehlt');
    expect(r[3].fehler).toMatch(/source ist zu lang/);
    for (const z of r) expect(z.fehler).toBeTruthy();
  });
  it('technische Felder (status, acquisition_status, id) kommen nie durch; flache Inbox-Objekte gehen auch', () => {
    const [z] = bereiteImportVor([{ company_name: 'A', email: 'a@b.de', status: 'converted', acquisition_status: 'founding_partner', id: 'x', werkruf_lead_id: 'y' }]);
    expect(z).toEqual({ i: 1, werte: { company_name: 'A', email: 'a@b.de' }, quelle: null, fehler: null });
    expect(bereiteImportVor('kein array')).toEqual([]);
  });
  it('Reiter: Standard ist das erste Problem; Status und Texte vollstaendig', () => {
    expect(standardReiter({ new: 3, invalid: 1, possibleDuplicate: 1 })).toBe('fehler');
    expect(standardReiter({ new: 3, possibleDuplicate: 1 })).toBe('pruefen');
    expect(standardReiter({ new: 3, duplicateInImport: 1 })).toBe('dubletten');
    expect(standardReiter({ new: 3 })).toBe('neu');
    const zeilen = [{ status: 'new' }, { status: 'duplicate' }, { status: 'duplicate_in_import' }, { status: 'invalid' }];
    expect(zeilenFuerReiter(zeilen, 'dubletten')).toHaveLength(2);
    expect(zeilenFuerReiter(zeilen, 'alle')).toHaveLength(4);
    for (const s of IMPORT_STATUS) expect(IMPORT_STATUS_TEXT[s]).toBeTruthy();
    expect(neueImportId()).toMatch(/^csv-[0-9a-f]{32}$/);
    expect(neueImportId()).not.toBe(neueImportId());
  });
});

/* ───────── Allowlist ───────── */
describe('admin-ops Allowlist: acquisition_import', () => {
  const zeilen = [{ i: 2, roh: { company_name: 'A', email: 'A@B.de' } }];
  it('ist schreibend, auditiert, nur Admin', () => {
    expect(ADMIN_AKTIONEN.acquisition_import).toMatchObject({ schreibt: true, auditAktion: 'admin.acquisition_import' });
    expect(pruefeAnfrage({ authUser: NUTZER, aktion: 'acquisition_import', parameter: { mode: 'preview', importId: 'csv-12345678', rows: zeilen } }))
      .toMatchObject({ erlaubt: false, status: 403 });
  });
  it('Zeilen werden SERVERSEITIG neu aufbereitet — ein „vorvalidiertes" werte-Feld aus dem Browser zaehlt nicht', () => {
    const u = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_import', parameter: { mode: 'commit', importId: 'csv-12345678',
      rows: [{ i: 2, roh: { company_name: 'A', email: 'kaputt' }, werte: { company_name: 'A', email: 'boese@x.de' }, fehler: null }] } });
    expect(u.erlaubt).toBe(true);
    expect(u.parameter.rows).toEqual([{ i: 2, werte: null, quelle: null, fehler: expect.any(String) }]);
    const ok = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_import', parameter: { mode: 'preview', importId: 'csv-12345678', rows: zeilen } });
    expect(ok.parameter.rows[0].werte).toEqual({ company_name: 'A', email: 'a@b.de' });
  });
  it('Modus nur preview|commit, Import-ID geprueft, 1–1000 Zeilen', () => {
    const p = (parameter) => pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_import', parameter });
    expect(p({ mode: 'upsert', importId: 'csv-12345678', rows: zeilen }).erlaubt).toBe(false);
    expect(p({ mode: 'commit', importId: 'kurz', rows: zeilen }).erlaubt).toBe(false);
    expect(p({ mode: 'commit', importId: "x'; drop--", rows: zeilen }).erlaubt).toBe(false);
    expect(p({ mode: 'commit', importId: 'csv-12345678', rows: [] }).erlaubt).toBe(false);
    expect(p({ mode: 'commit', importId: 'csv-12345678', rows: Array.from({ length: 1001 }, () => zeilen[0]) }).erlaubt).toBe(false);
  });
  it('acquisition_list nimmt optional eine Import-UUID', () => {
    const p = (parameter) => pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_list', parameter });
    expect(p({ importId: '22222222-2222-4222-8222-222222222222' }).erlaubt).toBe(true);
    expect(p({ importId: 'keine-uuid' }).erlaubt).toBe(false);
  });
});

/* ───────── Inbox-Zugang (Wirkung) ───────── */
describe('pruefeInboxZugang', () => {
  const SECRET = 'a'.repeat(20) + 'Geheim42';
  it('kein oder zu kurzes Secret konfiguriert → 503 (Inbox aus, nie offen)', () => {
    for (const e of [undefined, null, '', 'kurz']) expect(pruefeInboxZugang(SECRET, e)).toEqual({ ok: false, status: 503, fehler: 'Inbox nicht konfiguriert' });
    expect(pruefeInboxZugang('', '')).toMatchObject({ ok: false, status: 503 });
  });
  it('fehlender, falscher, abgeschnittener, verlaengerter Header → 401', () => {
    for (const g of [undefined, null, '', 'falsch', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase(), ` ${SECRET}`]) {
      expect(pruefeInboxZugang(g, SECRET)).toEqual({ ok: false, status: 401, fehler: 'Nicht berechtigt' });
    }
  });
  it('richtiges Secret → ok', () => {
    expect(pruefeInboxZugang(SECRET, SECRET)).toEqual({ ok: true });
  });
});

/* ───────── Server (admin-ops) ───────── */
describe('admin-ops: Import und Inbox', () => {
  const code = ohneKommentare(AO);
  const inbox = code.slice(code.indexOf('async function leadInbox'));
  const importFn = code.slice(code.indexOf('async function importiereZeilen'), code.indexOf('async function akquiseImport'));

  it('Inbox-Weiche liegt VOR dem Admin-Tor (Secret statt Admin-JWT) und nur fuer genau diesen Pfad', () => {
    const serve = code.indexOf('serve(');
    const weiche = code.indexOf("endsWith('/acquisition-inbox')");
    const tor = code.indexOf('if (!urteil.erlaubt)');
    expect(weiche).toBeGreaterThan(serve);
    expect(weiche).toBeLessThan(tor);
  });
  it('Inbox nutzt die geteilte Secret-Pruefung VOR dem Lesen des Bodys; Secret wird nie geloggt', () => {
    expect(inbox.indexOf('pruefeInboxZugang(')).toBeGreaterThan(-1);
    expect(inbox.indexOf('pruefeInboxZugang(')).toBeLessThan(inbox.indexOf('req.json()'));
    expect(inbox).toMatch(/x-werkruf-import-secret/);
    expect(inbox).toMatch(/if \(!zugang\.ok\)[\s\S]*?return json\(\{ error: zugang\.fehler \}, zugang\.status\)/);
    expect(inbox).not.toMatch(/log\([^)]*(ACQUISITION_IMPORT_SECRET|x-werkruf-import-secret)/);
  });
  it('EIN Importpfad: CSV und Inbox rufen dieselbe Funktion, die nur acquisition_import_rows ruft', () => {
    expect((code.match(/importiereZeilen\(admin, \{/g) || []).length).toBe(2);
    expect(code).toMatch(/channel: 'csv'/);
    expect(inbox).toMatch(/channel: 'inbox'/);
    expect(importFn).toMatch(/rpc\('acquisition_import_rows'/);
    expect(inbox).toMatch(/bereiteImportVor\(/);
  });
  it('Inbox und Import verschicken nichts und setzen keinen Status', () => {
    for (const teil of [inbox.slice(0, inbox.indexOf('\n}\n')), importFn]) {
      expect(teil).not.toMatch(/send-email|enqueue_email|outreach_messages|acquisition_send|founding_partner|interesse|\.update\(/);
    }
  });
  it('Commit wird auditiert (Admin- und System-Weg), Fehler neutral', () => {
    expect(code).toMatch(/aktion: 'acquisition_import'[\s\S]*?entityType: 'acquisition_imports'/);
    expect(inbox).toMatch(/actor_type: 'system', actor_id: null, action: 'system.acquisition_inbox_import'/);
    expect(inbox).toMatch(/json\(\{ error: 'Import fehlgeschlagen' \}, 500\)/);
  });
  it('Migration: nur neue Leads (INSERT, kein Upsert auf leads), Advisory-Lock, Selbstpruefung', () => {
    const m = ohneKommentare(MIG);
    expect(m).toMatch(/pg_advisory_xact_lock/);
    expect(m).not.toMatch(/insert into public\.leads[\s\S]{0,600}on conflict[^;]*do update/i);
    expect(m).toMatch(/\[wp16\.1\] in Ordnung/);
    expect(m).toMatch(/revoke all on function public\.acquisition_import_rows/i);
  });
});

/* ───────── UI ───────── */
const VORSCHAU = {
  ok: true, mode: 'preview', reused: false, importId: null,
  counts: { rows: 4, new: 2, duplicate: 1, duplicateInImport: 0, possibleDuplicate: 0, invalid: 1 },
  rows: [
    { i: 2, status: 'new', companyName: 'Neu Eins', email: 'eins@x.de' },
    { i: 3, status: 'new', companyName: 'Neu Zwei', email: 'zwei@x.de' },
    { i: 4, status: 'duplicate', grund: 'E-Mail existiert bereits', companyName: 'Alt', email: 'alt@x.de', leadId: 'l-alt' },
    { i: 5, status: 'invalid', grund: 'E-Mail ist ungültig', companyName: 'Kaputt', email: null },
  ],
};
const ERGEBNIS = { ...VORSCHAU, mode: 'commit', importId: '33333333-3333-4333-8333-333333333333' };

const datei = (text, name = 'leads.csv') => new File([text], name, { type: 'text/csv' });
const waehle = async (f) => { await act(async () => { fireEvent.change(screen.getByTestId('import-datei'), { target: { files: [f] } }); }); };

describe('AkquiseImport (UI)', () => {
  let ops; let neue; let zu;
  beforeEach(() => {
    neue = jest.fn(); zu = jest.fn();
    ops = jest.fn((action, p) => {
      if (p.mode === 'commit') return new Promise((ok) => setTimeout(() => ok(ERGEBNIS), 20));
      return Promise.resolve(VORSCHAU);
    });
  });
  const zeig = () => render(<AkquiseImport rufeAdminOps={ops} onSchliessen={zu} onNeueAnzeigen={neue} />);

  it('Datei → Vorschau: Zeilen gehen roh an den Server, Zusammenfassung, Standard-Reiter Fehler', async () => {
    zeig();
    await waehle(datei('company_name,email\nNeu Eins,eins@x.de\n'));
    await waitFor(() => expect(screen.getByTestId('import-vorschau')).toBeInTheDocument());
    expect(ops).toHaveBeenCalledTimes(1);
    const [action, p] = ops.mock.calls[0];
    expect(action).toBe('acquisition_import');
    expect(p).toMatchObject({ mode: 'preview', rows: [{ i: 2, roh: { company_name: 'Neu Eins', email: 'eins@x.de' } }] });
    expect(p.importId).toMatch(/^csv-[0-9a-f]{32}$/);
    expect(screen.getByTestId('import-summen')).toHaveTextContent('2Neu');
    expect(screen.getByTestId('import-summen')).toHaveTextContent('1Dubletten');
    expect(screen.getByTestId('import-summen')).toHaveTextContent('1Fehler');
    /* Problemzeilen zuerst */
    expect(screen.getByTestId('import-reiter-fehler')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('import-zeilen')).toHaveTextContent('Kaputt');
    expect(screen.getByTestId('import-zeilen')).not.toHaveTextContent('Neu Eins');
    fireEvent.click(screen.getByTestId('import-reiter-alle'));
    expect(screen.getByTestId('import-zeilen')).toHaveTextContent('Neu Eins');
    expect(screen.getByTestId('import-reiter-dubletten')).toHaveTextContent('Dubletten (1)');
  });

  it('Commit genau EINMAL auch bei Doppelklick, mit derselben Import-ID wie die Vorschau', async () => {
    zeig();
    await waehle(datei('company_name,email\nNeu Eins,eins@x.de\n'));
    await waitFor(() => screen.getByTestId('import-commit'));
    expect(screen.getByTestId('import-commit')).toHaveTextContent('2 Leads importieren');
    await act(async () => { fireEvent.click(screen.getByTestId('import-commit')); fireEvent.click(screen.getByTestId('import-commit')); });
    await waitFor(() => screen.getByTestId('import-ergebnis'));
    const commits = ops.mock.calls.filter(([, p]) => p.mode === 'commit');
    expect(commits).toHaveLength(1);
    expect(commits[0][1].importId).toBe(ops.mock.calls[0][1].importId);
    expect(screen.getByTestId('import-ergebnis')).toHaveTextContent('2 Leads angelegt');
    fireEvent.click(screen.getByTestId('import-neue-anzeigen'));
    expect(neue).toHaveBeenCalledWith(ERGEBNIS.importId);
  });

  it('Kopfzeilen-Fehler: Meldung, KEIN Serveraufruf', async () => {
    zeig();
    await waehle(datei('firma;mail\nA;a@b.de\n'));
    await waitFor(() => screen.getByTestId('import-fehler'));
    expect(screen.getByTestId('import-fehler')).toHaveTextContent(/Pflichtspalten fehlen/);
    expect(ops).not.toHaveBeenCalled();
  });

  it('nichts Neues → Import-Knopf gesperrt; nirgends ein Versand-Knopf', async () => {
    ops.mockImplementation(() => Promise.resolve({ ...VORSCHAU, counts: { ...VORSCHAU.counts, new: 0 }, rows: VORSCHAU.rows.slice(2) }));
    zeig();
    await waehle(datei('company_name,email\nAlt,alt@x.de\n'));
    await waitFor(() => screen.getByTestId('import-commit'));
    expect(screen.getByTestId('import-commit')).toBeDisabled();
    expect(screen.queryByText(/senden|verschicken|anschreiben/i)).not.toBeInTheDocument();
  });

  it('Wiederholter Commit (reused) wird ehrlich gemeldet', async () => {
    ops.mockImplementation((a, p) => Promise.resolve(p.mode === 'commit' ? { ...ERGEBNIS, reused: true } : VORSCHAU));
    zeig();
    await waehle(datei('company_name,email\nNeu Eins,eins@x.de\n'));
    await waitFor(() => screen.getByTestId('import-commit'));
    await act(async () => { fireEvent.click(screen.getByTestId('import-commit')); });
    expect(screen.getByTestId('import-ergebnis')).toHaveTextContent(/bereits abgeschlossen — es wurde nichts doppelt angelegt/);
  });
});
