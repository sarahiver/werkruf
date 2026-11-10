/**
 * WP16 — Admin Akquise + Brevo-Tracking.
 *
 *   Modul       Status/Ereignis-Trennung, Mail-Vorlage (Wortlaut, Escaping,
 *               Text=HTML), Eingabepruefung, Token-Form
 *   Allowlist   7 Aktionen, Parameter-Reduktion, kein userId-Zwang
 *   Server      admin-ops (Admin-Tor, Adresse aus DB, Token nie im Audit),
 *               send-email (Vorlage, Paritaet), google-business (GET/POST,
 *               Scanner-Schutz), vercel.json
 *   UI          Akquise-Bauteil: KPI, Liste, Vorschau → Bestaetigung →
 *               genau EIN Versand, Sperre, Testmodus-Band, Wortlaut
 *   SQL-Seite:  supabase/tests/akquise.test.sql (T1–T52 mit Wirkung)
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  AKQUISE_STATUS, AKQUISE_STATUS_TEXT, EREIGNIS_TEXT, SPERR_EREIGNISSE, normalisiereEmail, pruefeLeadEingabe,
  FP_MAIL_BETREFF, fpMailAbsaetze, renderFpMail, escapeHtml, istGueltigerToken, KPI_DEFINITION, VERSAND_GRUND_TEXT,
} from './utils/akquise';
import { ADMIN_AKTIONEN, pruefeAnfrage, baueAuditEintrag } from './utils/adminOps';
import { ereignisArt, EREIGNISSE } from './utils/zustellEreignisse';
import Akquise from './components/admin/Akquise';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ADMIN = { id: '00000000-0000-4000-8000-00000000ad01', app_metadata: { role: 'admin' } };
const NUTZER = { id: '00000000-0000-4000-8000-0000000000b1', app_metadata: {} };
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const AO = lies('../supabase/functions/admin-ops/index.ts');
const GB = lies('../supabase/functions/google-business/index.ts');
const SE = lies('../supabase/functions/send-email/index.ts');
const MIG = lies('../supabase/migrations/20261114090000_admin_akquise.sql');

/* ───────── Modul ───────── */
describe('Modul akquise.js', () => {
  it('Vertriebsstatus und Mail-Ereignisse sind getrennte Mengen; opened/delivered/clicked sind KEIN Status', () => {
    expect(AKQUISE_STATUS).toEqual(['neu', 'vorbereitet', 'angeschrieben', 'interesse', 'kein_interesse', 'founding_partner', 'zurueckgestellt']);
    for (const e of ['opened', 'delivered', 'clicked', 'first_open', 'sent']) expect(AKQUISE_STATUS).not.toContain(e);
    for (const s of AKQUISE_STATUS) { expect(AKQUISE_STATUS_TEXT[s]).toBeTruthy(); expect(EREIGNIS_TEXT[s]).toBeUndefined(); }
    expect(SPERR_EREIGNISSE).toEqual(['hard_bounce', 'blocked', 'spam', 'unsubscribed']);
  });
  it('Wortlaut: „Öffnung erkannt", nie „gelesen"; „Interesse bestätigt" nur fuer cta_clicked', () => {
    expect(EREIGNIS_TEXT.first_open).toBe('Öffnung erkannt');
    expect(Object.values(EREIGNIS_TEXT).join(' ')).not.toMatch(/gelesen|hat Interesse/i);
    expect(EREIGNIS_TEXT.cta_clicked).toBe('Interesse bestätigt');
    expect(EREIGNIS_TEXT.cta_viewed).not.toMatch(/Interesse bestätigt/);
    expect(KPI_DEFINITION.oeffnungErkannt).toMatch(/nicht Anzahl Opens/);
  });
  it('T9/T10 — E-Mail normalisiert, ungueltige abgelehnt; Pflichtfelder; technische Felder fallen weg', () => {
    expect(normalisiereEmail('  Info@Firma.DE ')).toBe('info@firma.de');
    expect(normalisiereEmail('kein-at')).toBeNull();
    expect(normalisiereEmail('a@b')).toBeNull();
    const ok = pruefeLeadEingabe({ company_name: ' Krause GmbH ', email: 'X@Y.de', status: 'converted', acquisition_status: 'founding_partner', provider_message_id: 'x', id: 'y' });
    expect(ok).toEqual({ ok: true, werte: { company_name: 'Krause GmbH', email: 'x@y.de' } });
    expect(pruefeLeadEingabe({ company_name: 'A' })).toEqual({ ok: false, fehler: 'E-Mail fehlt' });
    expect(pruefeLeadEingabe({ email: 'a@b.de' })).toEqual({ ok: false, fehler: 'Betrieb (company_name) fehlt' });
    expect(pruefeLeadEingabe({ company_name: 'A', email: 'kaputt' }).ok).toBe(false);
    expect(pruefeLeadEingabe({ company_name: 'A', email: 'a@b.de', website: 'firma.de' }).ok).toBe(false);
    expect(pruefeLeadEingabe({ company_name: 'A', email: 'a@b.de', personalized_sentence: 'x'.repeat(601) }).ok).toBe(false);
    expect(pruefeLeadEingabe({ note: 'nur Notiz' }, { neu: false })).toEqual({ ok: true, werte: { note: 'nur Notiz' } });
    expect(pruefeLeadEingabe({ company_name: '' }, { neu: false }).ok).toBe(false);
  });
  it('T19/T20 — Vorlage: Betreff, Anrede, personalisierter Satz als eigener Absatz, Vorgabetext unveraendert', () => {
    expect(FP_MAIL_BETREFF('Krause GmbH')).toBe('Darf ich Krause GmbH als WERKRUF Founding Partner einladen?');
    const a = fpMailAbsaetze({ contactPerson: 'Jens Krause', personalizedSentence: 'Bei euch sind drei Bewertungen unbeantwortet.' });
    expect(a[0]).toBe('Hallo Jens Krause,');
    expect(a[1]).toBe('stell dir vor: In unter 5 Minuten pro Woche das Google-Profil so pflegen, dass automatisch die lukrativeren Aufträge bei dir landen?');
    expect(a[2]).toBe('Genau dafür gibt es WERKRUF.');
    expect(a[3]).toMatch(/^Viele Betriebe leisten top Arbeit.*keine Daueraufgabe\.$/);
    expect(a[4]).toBe('Bei euch sind drei Bewertungen unbeantwortet.');
    expect(a[5]).toMatch(/^Warum ich dir schreibe: Ich suche aktuell 10 ausgewählte Handwerksbetriebe/);
    expect(a[6]).toBe('Als Founding Partner nutzt du WERKRUF dauerhaft 100 % kostenlos.');
    expect(a[7]).toMatchObject({ link: 'presentation' });
    expect(a[8]).toMatchObject({ link: 'cta', text: 'Klingt das grundsätzlich interessant? Eine kurze Antwort mit „Ja, Interesse“ reicht – die Einrichtung dauert knapp 10 Minuten.' });
    expect(a[9]).toBe('Beste Grüße\nIver Bohnes');
    /* ohne Satz: Absatz faellt weg, Reihenfolge bleibt */
    const b = fpMailAbsaetze({ contactPerson: '-', personalizedSentence: '' });
    expect(b[0]).toBe('Hallo zusammen,');
    expect(b).toHaveLength(9);
  });
  it('T15/T18 — Text und HTML tragen denselben Inhalt; Lead-Felder sind escaped; Links nur aus Parametern', () => {
    const r = renderFpMail({
      companyName: 'Krause <script>alert(1)</script> & Co',
      contactPerson: 'Jens "J" Krause',
      personalizedSentence: 'Satz mit <b>HTML</b> & Zeichen',
      presentationUrl: 'https://werkruf.com/p/fp/tok123', ctaUrl: 'https://werkruf.com/founding-partner/tok123',
    });
    expect(r.subject).toBe('Darf ich Krause <script>alert(1)</script> & Co als WERKRUF Founding Partner einladen?');
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('Satz mit &lt;b&gt;HTML&lt;/b&gt; &amp; Zeichen');
    expect(r.html).toContain('Hallo Jens &quot;J&quot; Krause,');
    expect(r.text).toContain('Satz mit <b>HTML</b> & Zeichen');
    expect(r.text).toContain('https://werkruf.com/p/fp/tok123');
    expect(r.text).toContain('https://werkruf.com/founding-partner/tok123');
    expect(r.html).toContain('href="https://werkruf.com/p/fp/tok123"');
    expect(r.html).toContain('href="https://werkruf.com/founding-partner/tok123"');
    expect((r.html.match(/href="/g) || []).length).toBe(2);
    /* Paritaet: jeder Textabsatz steht (escaped) im HTML */
    for (const abs of fpMailAbsaetze({ contactPerson: 'Jens "J" Krause', personalizedSentence: 'Satz mit <b>HTML</b> & Zeichen' })) {
      const t = typeof abs === 'string' ? abs : abs.text;
      expect(r.text).toContain(t);
      expect(r.html).toContain(escapeHtml(t).replace(/\n/g, '<br>'));
    }
    expect(r.html).not.toMatch(/unsubscribe|Abmelden/i);   // keine erfundene Abmeldemechanik (Doku)
  });
  it('Token-Form: opaque base64url 32–64 Zeichen, nichts anderes', () => {
    expect(istGueltigerToken('A'.repeat(43))).toBe(true);
    expect(istGueltigerToken('abc')).toBe(false);
    expect(istGueltigerToken('a'.repeat(43) + '@')).toBe(false);
    expect(istGueltigerToken(null)).toBe(false);
  });
  it('Brevo-Normalizer kennt unsubscribed (Sperrgrund), WP6-Arten unveraendert', () => {
    expect(ereignisArt('unsubscribed')).toBe('unsubscribed');
    expect(EREIGNISSE).toEqual(['sent', 'delivered', 'opened', 'clicked', 'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'error', 'unsubscribed']);
    expect(ereignisArt('deferred')).toBeNull();
  });
});

/* ───────── Allowlist ───────── */
describe('Allowlist (adminOps.js)', () => {
  it('8 Akquise-Aktionen (WP16.1: + acquisition_import); schreibende haben Audit-Namen; send verlangt Bestaetigung', () => {
    const akq = Object.keys(ADMIN_AKTIONEN).filter((k) => k.startsWith('acquisition_')).sort();
    expect(akq).toEqual(['acquisition_import', 'acquisition_lead_create', 'acquisition_lead_detail', 'acquisition_lead_update', 'acquisition_list', 'acquisition_preview', 'acquisition_send', 'acquisition_set_status']);
    expect(ADMIN_AKTIONEN.acquisition_lead_create.auditAktion).toBe('admin.acquisition_lead_created');
    expect(ADMIN_AKTIONEN.acquisition_lead_update.auditAktion).toBe('admin.acquisition_lead_updated');
    expect(ADMIN_AKTIONEN.acquisition_set_status.auditAktion).toBe('admin.acquisition_status_changed');
    expect(ADMIN_AKTIONEN.acquisition_send.auditAktion).toBe('admin.acquisition_email_sent');
    expect(ADMIN_AKTIONEN.acquisition_send.bestaetigung).toBe(true);
    expect(ADMIN_AKTIONEN.acquisition_send.parameter).toEqual(['leadId', 'idempotencyKey']);
    expect(ADMIN_AKTIONEN.acquisition_send.parameter).not.toContain('email');
  });
  it('T16 — kein Admin → 403, ohne Sitzung → 401, auch fuer Lesen', () => {
    for (const aktion of ['acquisition_list', 'acquisition_send', 'acquisition_lead_create']) {
      expect(pruefeAnfrage({ authUser: NUTZER, aktion, parameter: { leadId: LEAD_ID } }).status).toBe(403);
      expect(pruefeAnfrage({ authUser: null, aktion }).status).toBe(401);
    }
  });
  it('T17/T12 — Parameter werden reduziert: keine Mailadresse, keine technischen Felder, kein userId-Zwang', () => {
    const send = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_send', parameter: { leadId: LEAD_ID, idempotencyKey: 'abcdef0123456789', email: 'hacker@evil.de', to: 'x', provider_message_id: 'y' } });
    expect(send.erlaubt).toBe(true);
    expect(send.parameter).toEqual({ leadId: LEAD_ID, idempotencyKey: 'abcdef0123456789' });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_send', parameter: { leadId: LEAD_ID } }).fehler).toBe('idempotencyKey fehlt');
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_send', parameter: { leadId: 'nicht-uuid', idempotencyKey: 'abcdef0123456789' } }).status).toBe(400);
    const upd = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_lead_update', parameter: { leadId: LEAD_ID, lead: { note: 'x', status: 'converted', acquisition_status: 'founding_partner', provider_message_id: 'p' } } });
    expect(upd.parameter.lead).toEqual({ note: 'x' });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_lead_update', parameter: { leadId: LEAD_ID, lead: { status: 'x' } } }).fehler).toBe('Keine Änderung');
    const create = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_lead_create', parameter: { lead: { company_name: 'A', email: 'A@B.de' } } });
    expect(create.parameter).toEqual({ lead: { company_name: 'A', email: 'a@b.de' } });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_lead_create', parameter: { lead: { company_name: 'A', email: 'kaputt' } } }).fehler).toBe('E-Mail ist ungültig');
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_set_status', parameter: { leadId: LEAD_ID, status: 'opened' } }).status).toBe(400);
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_set_status', parameter: { leadId: LEAD_ID, status: 'interesse' } }).parameter).toEqual({ leadId: LEAD_ID, status: 'interesse', note: null });
    const list = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_list', parameter: { limit: 9999, status: '', suche: ' x ' } });
    expect(list.parameter).toEqual({ status: 'alle', suche: 'x', limit: 500 });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_list', parameter: { status: 'opened' } }).status).toBe(400);
  });
  it('T13 — Audit fuer Leads: entity_type leads, keine Nutzer-ID', () => {
    const e = baueAuditEintrag({ aktion: 'acquisition_lead_create', adminId: ADMIN.id, userId: null, erfolg: true, ergebnis: { x: 1 }, entityType: 'leads', entityId: LEAD_ID });
    expect(e).toMatchObject({ action: 'admin.acquisition_lead_created', entity_type: 'leads', entity_id: LEAD_ID, user_id: null, actor_type: 'admin', actor_id: ADMIN.id });
    /* Bestand unveraendert */
    expect(baueAuditEintrag({ aktion: 'set_founding_partner', adminId: ADMIN.id, userId: NUTZER.id, erfolg: true })).toMatchObject({ entity_type: 'user_profiles', entity_id: NUTZER.id });
  });
});

/* ───────── Server (Quelltext) ───────── */
describe('admin-ops (Quelltext)', () => {
  const senden = ohneKommentare(AO.slice(AO.indexOf('async function akquiseSenden'), AO.length));
  it('C1 — jede Aktion laeuft durch das Tor (pruefeAnfrage) und den Dispatcher', () => {
    expect(AO).toMatch(/const urteil = pruefeAnfrage\(\{/);
    expect(AO).toMatch(/if \(!urteil\.erlaubt\) \{/);
    for (const a of ['acquisition_list', 'acquisition_lead_detail', 'acquisition_preview', 'acquisition_lead_create', 'acquisition_lead_update', 'acquisition_set_status', 'acquisition_send']) {
      expect(AO).toMatch(new RegExp(`case '${a}':`));
    }
  });
  it('T17/C2 — Versand: Lead aus der DB (acquisition_lead_detail), nie eine Adresse aus dem Body; Payload ohne Adresse', () => {
    expect(senden).toMatch(/admin\.rpc\('acquisition_lead_detail', \{ p_lead_id: leadId \}\)/);
    expect(senden).not.toMatch(/p\.(email|to|toEmail|address)\b/);
    expect(senden).toMatch(/companyName: lead\.companyName, contactPerson: lead\.contactPerson \?\? null,/);
    expect(senden).not.toMatch(/p_payload: \{[^}]*email/);
    expect(senden).toMatch(/admin\.rpc\('acquisition_outreach_begin', \{/);
    expect(senden).toMatch(/p_idempotency_key: p\.idempotencyKey/);
  });
  it('T21/T48 — Token: 32 Zufallsbytes base64url, nur der Hash geht in die DB, nie Token im Audit/Log', () => {
    expect(senden).toMatch(/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    expect(senden).toMatch(/const tokenHash = await sha256Hex\(token\);/);
    expect(senden).toMatch(/p_token_hash: tokenHash/);
    const audits = senden.match(/leadAudit\(\{ aktion: 'acquisition_send'[^\n]*/g) || [];
    expect(audits.length).toBeGreaterThanOrEqual(3);
    for (const a of audits) expect(a).not.toMatch(/\btoken\b|tokenHash|presentationUrl|ctaUrl/);
    expect(senden).not.toMatch(/log\([^)]*token/);
  });
  it('T23 — Testmodus kommt aus EMAIL_DELIVERY_MODE, wird mitgegeben und in der Antwort/Vorschau sichtbar', () => {
    expect(AO).toMatch(/Deno\.env\.get\('EMAIL_DELIVERY_MODE'\)/);
    expect(senden).toMatch(/p_delivery_mode: modus\.mode/);
    expect(senden).toMatch(/deliveryMode: modus\.mode, testRecipient: modus\.testRecipient/);
    const vorschau = AO.slice(AO.indexOf('async function akquiseVorschau'), AO.indexOf('async function akquiseLeadAnlegen'));
    expect(vorschau).toMatch(/deliveryMode: modus\.mode, testRecipient: modus\.testRecipient/);
    expect(vorschau).toMatch(/renderFpMail\(\{/);
    expect(vorschau).toMatch(/sender: \{ name: 'WERKRUF', email: 'info@werkruf\.com' \}/);
  });
  it('T15 — Vorschau und Worker rendern mit derselben Funktion (renderFpMail aus akquise.js)', () => {
    expect(AO).toMatch(/import \{ renderFpMail \} from '\.\.\/\.\.\/\.\.\/src\/utils\/akquise\.js'/);
    expect(SE).toMatch(/import \{ renderFpMail \} from '\.\.\/\.\.\/\.\.\/src\/utils\/akquise\.js'/);
    expect(SE).toMatch(/case 'founding_partner_outreach': \{[\s\S]*?renderFpMail\(\{[\s\S]*?presentationUrl: String\(payload\.presentationUrl \?\? ''\),\s*ctaUrl: String\(payload\.ctaUrl \?\? ''\),/);
    expect(SE).toMatch(/\| 'founding_partner_outreach';/);
  });
  it('T13 — Audit bei Anlegen/Aendern/Status/Versand, auch bei Fehlschlag', () => {
    for (const a of ['acquisition_lead_create', 'acquisition_lead_update', 'acquisition_set_status', 'acquisition_send']) {
      const treffer = AO.match(new RegExp(`aktion: '${a}'`, 'g')) || [];
      expect(treffer.length).toBeGreaterThanOrEqual(2);
    }
    expect(AO).toMatch(/entityType: 'leads'/);
  });
  it('kein Bulk: Versand nimmt genau eine leadId, keine Liste, keine Schleife ueber Leads', () => {
    expect(senden).not.toMatch(/leadIds|for \(const lead of|\.map\(\(lead\)|Promise\.all/);
  });
});

describe('google-business — oeffentliche Token-Routen (Quelltext)', () => {
  const block = ohneKommentare(GB.slice(GB.indexOf('const AKQUISE_PDF_URL'), GB.indexOf('WP13 — Betriebsferien-Pause')));
  const dispatch = ohneKommentare(GB.slice(GB.indexOf("if (routeName === 'p' && sub === 'fp')"), GB.indexOf("if (routeName === 'a' && sub)")));
  it('T46/T49/C6 — Praesentation: GET → presentation_clicked → 302 auf PDF; nie cta_clicked', () => {
    const praes = block.slice(block.indexOf('async function handleAkquisePraesentation'), block.indexOf('async function handleAkquiseCtaInfo'));
    expect(praes).toMatch(/akquiseLinkEreignis\(token, 'presentation_clicked'\)/);
    expect(praes).toMatch(/status: 302, headers: \{ \.\.\.AKQUISE_KOPF, Location: AKQUISE_PDF_URL \}/);
    expect(praes).not.toMatch(/cta_clicked|interesse/);
    expect(dispatch).toMatch(/if \(request\.method !== 'GET' && request\.method !== 'HEAD'\)/);
  });
  it('T30/T50/T52 (Fix1) — GET …/info = JSON (cta_viewed), nur POST …/interesse setzt cta_clicked und leitet ins Frontend; GET /interesse 405; kein HTML', () => {
    const info = block.slice(block.indexOf('async function handleAkquiseCtaInfo'), block.indexOf('async function handleAkquiseCtaPost'));
    const post = block.slice(block.indexOf('async function handleAkquiseCtaPost'));
    expect(info).toMatch(/akquiseLinkEreignis\(token, 'cta_viewed'\)/);
    expect(info).not.toMatch(/cta_clicked/);
    expect(info).toMatch(/return actionJson\(\{ valid: true \}, 200, request\);/);
    expect(post).toMatch(/akquiseLinkEreignis\(token, 'cta_clicked'\)/);
    expect(post).toMatch(/leiteZumFrontend\(`\/founding-partner\/\$\{encodeURIComponent\(token\)\}\?danke=1`\)/);
    expect(block).not.toMatch(/<!doctype html>|text\/html|<form/);
    expect(dispatch).toMatch(/if \(request\.method === 'POST' && interesse\) return handleAkquiseCtaPost\(sub\);/);
    expect(dispatch).toMatch(/if \(request\.method === 'GET' && info\) return handleAkquiseCtaInfo\(request, sub\);/);
    expect(dispatch).toMatch(/leiteZumFrontend\(`\/founding-partner\/\$\{encodeURIComponent\(sub\)\}`\)/);
    expect(dispatch).toMatch(/405/);
  });
  it('T47/T48 — unbekannter/ungueltiger Token → 404 ohne Hinweis; Lookup nur ueber SHA-256', () => {
    expect(block).toMatch(/if \(!istAkquiseToken\(token\)\) return \{ ok: false \};/);
    expect(block).toMatch(/p_token_hash: await hashe\(token\), p_kind: art/);
    expect(block).toMatch(/if \(!r\.ok\) return new Response\(null, \{ status: 404, headers: AKQUISE_KOPF \}\);/);
    expect(block).toMatch(/if \(!r\.ok\) return actionJson\(\{ valid: false \}, 404, request\);/);
    expect(block).not.toMatch(/lead_id|email|leadId/);
    expect(block).toMatch(/'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex'/);
  });
  it('vercel.json (Fix1): /p/fp/:token → Function (302), /founding-partner/* NICHT mehr → SPA rendert; Catch-all zuletzt', () => {
    const v = JSON.parse(lies('../vercel.json'));
    const q = Object.fromEntries(v.rewrites.map((r) => [r.source, r.destination]));
    expect(q['/p/fp/:token']).toMatch(/\/functions\/v1\/google-business\/p\/fp\/:token$/);
    expect(Object.keys(q).some((k) => k.startsWith('/founding-partner'))).toBe(false);
    expect(Object.keys(q).some((k) => k.startsWith('/a/'))).toBe(false);
    expect(q['/b/:code']).toBeTruthy();
    expect(v.rewrites[v.rewrites.length - 1]).toEqual({ source: '/(.*)', destination: '/index.html' });
    const app = lies('./App.js');
    expect(app).toMatch(/<Route path="\/a\/:token" element=\{<ActionLink \/>\} \/>/);
    expect(app).toMatch(/<Route path="\/founding-partner\/:token" element=\{<FoundingPartnerInteresse \/>\} \/>/);
  });
});

describe('Migration (Quelltext) — Trennung und Sperre', () => {
  it('C5/C9 — kein Trigger und keine Funktion setzt acquisition_status aus Brevo; nur acquisition_link_event (cta_clicked) und Admin/Versand', () => {
    const brevoTrigger = MIG.slice(MIG.indexOf('create or replace function public.outreach_copy_delivery_event'), MIG.indexOf('/* ═══ 6'));
    expect(brevoTrigger).not.toMatch(/acquisition_status/);
    const queueTrigger = MIG.slice(MIG.indexOf('create or replace function public.outreach_sync_from_queue'), MIG.indexOf('create or replace function public.outreach_copy_delivery_event'));
    expect(queueTrigger).not.toMatch(/acquisition_status/);
    const link = MIG.slice(MIG.indexOf('create or replace function public.acquisition_link_event'), MIG.indexOf('/* ═══ 10'));
    expect(link).toMatch(/if v_vorher is null or v_vorher in \('neu', 'vorbereitet', 'angeschrieben', 'zurueckgestellt'\) then/);
    expect(link).not.toMatch(/'founding_partner', 'interesse'\)|in \('founding_partner'/);
    expect(MIG).toMatch(/\[wp16\] Brevo-Trigger beruehrt Vertriebsstatus/);
  });
  it('C7/C8 — Sperre aus der Historie; Idempotenz ueber (message, fingerprint); eine queued je Lead', () => {
    expect(MIG).toMatch(/e\.event_type in \('hard_bounce', 'blocked', 'spam', 'unsubscribed'\)/);
    expect(MIG).toMatch(/if v_block is not null then return jsonb_build_object\('ok', false, 'reason', 'gesperrt', 'grund', v_block\); end if;/);
    expect(MIG).toMatch(/constraint outreach_email_events_einmalig unique \(outreach_message_id, fingerprint\)/);
    expect(MIG).toMatch(/create unique index if not exists outreach_messages_one_queued on public\.outreach_messages \(lead_id\) where status = 'queued'/);
    expect(MIG).toMatch(/select \* into v_existing from public\.outreach_messages where idempotency_key = p_idempotency_key;/);
  });
  it('C10/C11 — RLS/Rechte: outreach-Tabellen ohne Client-Rechte; claim_own_lead und leads.status unangetastet', () => {
    expect(MIG).toMatch(/revoke all on table public\.outreach_messages from public, anon, authenticated/);
    expect(MIG).toMatch(/revoke all on table public\.outreach_email_events from public, anon, authenticated/);
    const code = ohneKommentare(MIG).replace(/^\s*--.*$/gm, '');
    expect(code).not.toMatch(/claim_own_lead|leads_status_check/);
    expect(code).not.toMatch(/grant[^;]*to (anon|authenticated)/);
    expect(code).not.toMatch(/create policy/);
    expect(MIG).toMatch(/'founding_partner_outreach'\n\]\)\);/);
  });
});

/* ───────── UI ───────── */
describe('Akquise-Bauteil', () => {
  const LEAD = {
    id: LEAD_ID, companyName: 'Krause GmbH', contactPerson: 'Jens Krause', email: 'jens@krause.de', city: 'Kiel', trade: 'Elektro',
    acquisitionStatus: 'angeschrieben', leadStatus: 'new', lastOutreachAt: '2026-11-10T09:00:00Z',
    lastMessage: { id: 'm1', status: 'sent', deliveryMode: 'production' },
    deliveredAt: '2026-11-10T09:01:00Z', firstOpenAt: '2026-11-10T09:30:00Z', presentationClickedAt: null, ctaClickedAt: null, blockReason: null,
  };
  const GESPERRT = { ...LEAD, id: '33333333-3333-4333-8333-333333333333', companyName: 'Bounce AG', email: 'x@bounce.de', blockReason: 'hard_bounce', acquisitionStatus: 'angeschrieben' };
  const DETAIL = (lead) => ({
    lead: { ...lead, personalizedSentence: 'Drei Bewertungen unbeantwortet.', note: '' },
    messages: [{ id: 'm1', status: 'sent', deliveryMode: 'production', createdAt: '2026-11-10T09:00:00Z' }],
    events: [
      { id: 'e1', type: 'sent', at: '2026-11-10T09:00:00Z' }, { id: 'e2', type: 'delivered', at: '2026-11-10T09:01:00Z' },
      { id: 'e3', type: 'first_open', at: '2026-11-10T09:30:00Z' }, { id: 'e4', type: 'opened', at: '2026-11-10T10:30:00Z' },
    ],
    deliveryMode: 'production',
  });
  const VORSCHAU = {
    ok: true, to: 'jens@krause.de', toName: 'Jens Krause', subject: 'Darf ich Krause GmbH als WERKRUF Founding Partner einladen?',
    text: 'Hallo Jens Krause,\n\nstell dir vor …\n\nDrei Bewertungen unbeantwortet.\n\nBeste Grüße\nIver Bohnes', html: '<p>x</p>',
    personalizedSentence: 'Drei Bewertungen unbeantwortet.', presentationUrl: 'https://werkruf.com/p/fp/VORSCHAU-TOKEN', ctaUrl: 'https://werkruf.com/founding-partner/VORSCHAU-TOKEN',
    sender: { name: 'WERKRUF', email: 'info@werkruf.com' }, deliveryMode: 'production', testRecipient: null, blockReason: null,
  };

  function mockOps({ deliveryMode = 'production', leads = [LEAD, GESPERRT], sendErgebnis } = {}) {
    const calls = [];
    const ops = jest.fn(async (action, params = {}) => {
      calls.push({ action, params });
      switch (action) {
        case 'acquisition_list': return { leads, kpi: { leads: 2, angeschrieben: 2, zugestellt: 1, oeffnungErkannt: 1, interesse: 0, foundingPartner: 0, gesperrt: 1 }, deliveryMode };
        case 'acquisition_lead_detail': return DETAIL(leads.find((l) => l.id === params.leadId) || LEAD);
        case 'acquisition_preview': return { ...VORSCHAU, deliveryMode, testRecipient: deliveryMode === 'test' ? 'iver@test.de' : null };
        case 'acquisition_send': return sendErgebnis || { ok: true, messageId: 'm2', reused: false, status: 'queued', deliveryMode, testRecipient: deliveryMode === 'test' ? 'iver@test.de' : null };
        case 'acquisition_lead_create': return { ok: true, leadId: LEAD_ID };
        default: return { ok: true };
      }
    });
    return { ops, calls };
  }

  it('KPI-Block, Liste mit Zustellung/Öffnung erkannt, Sperrwarnung; Wortlaut ohne „gelesen"', async () => {
    const { ops } = mockOps();
    render(<Akquise rufeAdminOps={ops} />);
    await screen.findByText('Krause GmbH');
    const kpi = screen.getByTestId('akquise-kpi');
    expect(kpi).toHaveTextContent('Leads'); expect(kpi).toHaveTextContent('Öffnung erkannt'); expect(kpi).toHaveTextContent('Founding Partner');
    expect(screen.getAllByTestId('akquise-lead')).toHaveLength(2);
    const signale = screen.getAllByTestId('akquise-signale')[0];
    /* WP16.1: kompakte Signal-Chips; der volle Wortlaut steht im aria-label/title
       („Öffnung erkannt", nie „gelesen"). */
    expect(within(signale).getByLabelText(/^Zugestellt /)).toHaveAttribute('data-ja', 'true');
    expect(within(signale).getByLabelText(/^Öffnung erkannt \(kein Lesebeweis\) /)).toHaveAttribute('data-ja', 'true');
    expect(within(signale).getByLabelText(/^Präsentation geklickt: noch nicht/)).toHaveAttribute('data-ja', 'false');
    expect(within(signale).getByLabelText(/^Interesse bestätigt: noch nicht/)).toHaveAttribute('data-ja', 'false');
    expect(screen.getByTestId('akquise-gesperrt')).toHaveTextContent('Hard Bounce');
    expect(document.body.textContent).not.toMatch(/gelesen/);
    expect(screen.queryByTestId('akquise-testmodus')).toBeNull();
  });

  it('T14/T24 — Vorschau → „Mail senden" → Bestaetigung → genau EIN acquisition_send mit leadId + idempotencyKey (keine Adresse); Doppelklick blockiert', async () => {
    const { ops, calls } = mockOps();
    render(<Akquise rufeAdminOps={ops} />);
    fireEvent.click(await screen.findByText('Krause GmbH'));
    await screen.findByTestId('akquise-detail');
    expect(screen.queryByTestId('akquise-senden')).toBeNull();                 // kein One-Click aus der Zeile
    fireEvent.click(await screen.findByTestId('akquise-vorschau'));
    const inhalt = await screen.findByTestId('akquise-vorschau-inhalt');
    expect(inhalt).toHaveTextContent('An: jens@krause.de');
    expect(inhalt).toHaveTextContent('Betreff: Darf ich Krause GmbH als WERKRUF Founding Partner einladen?');
    expect(inhalt).toHaveTextContent('Präsentationslink: https://werkruf.com/p/fp/VORSCHAU-TOKEN');
    expect(inhalt).toHaveTextContent('CTA: https://werkruf.com/founding-partner/VORSCHAU-TOKEN');
    expect(screen.getByTestId('akquise-vorschau-text')).toHaveTextContent('Drei Bewertungen unbeantwortet.');
    fireEvent.click(screen.getByTestId('akquise-senden'));
    expect(calls.filter((c) => c.action === 'acquisition_send')).toHaveLength(0);   // erst Bestaetigung
    const ja = screen.getByTestId('akquise-senden-bestaetigen');
    expect(ja).toHaveTextContent('Ja, jetzt an jens@krause.de senden');
    fireEvent.click(ja); fireEvent.click(ja); fireEvent.click(ja);
    await waitFor(() => expect(calls.filter((c) => c.action === 'acquisition_send')).toHaveLength(1));
    const send = calls.find((c) => c.action === 'acquisition_send');
    expect(Object.keys(send.params).sort()).toEqual(['idempotencyKey', 'leadId']);
    expect(send.params.leadId).toBe(LEAD_ID);
    expect(send.params.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,120}$/);   // was der Server verlangt
    expect(JSON.stringify(send.params)).not.toContain('krause.de');
    expect(await screen.findByTestId('akquise-meldung')).toHaveTextContent('Mail eingereiht');
    expect(screen.queryByTestId('akquise-senden-bestaetigen')).toBeNull();
  });

  it('T23 — Testmodus: Band oben, Vorschau und Bestaetigung nennen den Testempfaenger, nicht den Lead', async () => {
    const { ops } = mockOps({ deliveryMode: 'test' });
    render(<Akquise rufeAdminOps={ops} />);
    expect(await screen.findByTestId('akquise-testmodus')).toHaveTextContent('Testmodus');
    fireEvent.click(screen.getByText('Krause GmbH'));
    fireEvent.click(await screen.findByTestId('akquise-vorschau'));
    expect(await screen.findByTestId('akquise-vorschau-test')).toHaveTextContent('geht an iver@test.de, nicht an jens@krause.de');
    fireEvent.click(screen.getByTestId('akquise-senden'));
    expect(screen.getByTestId('akquise-senden-bestaetigen')).toHaveTextContent('an den Testempfänger senden');
    fireEvent.click(screen.getByTestId('akquise-senden-bestaetigen'));
    expect(await screen.findByTestId('akquise-meldung')).toHaveTextContent('Testversand eingereiht — geht nur an iver@test.de');
  });

  it('T32 — gesperrter Lead: kein Vorschau-/Sendeknopf, klare Warnung; Server-Ablehnung wird lesbar', async () => {
    const { ops, calls } = mockOps({ sendErgebnis: { ok: false, code: 'gesperrt', grund: 'hard_bounce' } });
    render(<Akquise rufeAdminOps={ops} />);
    fireEvent.click(await screen.findByText('Bounce AG'));
    expect(await screen.findByTestId('akquise-versand-gesperrt')).toHaveTextContent('Lead ist für weiteren Mailversand gesperrt: Hard Bounce.');
    expect(screen.queryByTestId('akquise-vorschau')).toBeNull();
    expect(calls.filter((c) => c.action === 'acquisition_send')).toHaveLength(0);
    /* Server lehnt trotzdem ab (zweite Verteidigung) → Text */
    /* WP16.1: Detail-Panel statt Aufklappen — ein Klick auf einen anderen Lead wechselt. */
    fireEvent.click(screen.getByText('Krause GmbH'));
    fireEvent.click(await screen.findByTestId('akquise-vorschau'));
    fireEvent.click(await screen.findByTestId('akquise-senden'));
    fireEvent.click(screen.getByTestId('akquise-senden-bestaetigen'));
    expect(await screen.findByRole('alert')).toHaveTextContent(VERSAND_GRUND_TEXT.gesperrt);
  });

  it('Eventhistorie chronologisch mit Wortlaut; Statusfeld ist manuell und ruft acquisition_set_status', async () => {
    const { ops, calls } = mockOps();
    render(<Akquise rufeAdminOps={ops} />);
    fireEvent.click(await screen.findByText('Krause GmbH'));
    const hist = await screen.findByTestId('akquise-historie');
    const zeilen = within(hist).getAllByRole('listitem').map((li) => li.textContent);
    expect(zeilen[0]).toMatch(/^Gesendet/); expect(zeilen[1]).toMatch(/^Zugestellt/); expect(zeilen[2]).toMatch(/^Öffnung erkannt/); expect(zeilen[3]).toMatch(/^Weitere Öffnung erkannt/);
    fireEvent.change(screen.getByTestId('akquise-status-feld'), { target: { value: 'interesse' } });
    await waitFor(() => expect(calls.find((c) => c.action === 'acquisition_set_status')).toEqual({ action: 'acquisition_set_status', params: { leadId: LEAD_ID, status: 'interesse' } }));
  });

  it('T7 — Lead anlegen: Pflichtfelder Betrieb + E-Mail, sonst Knopf aus; Request nur mit Formularfeldern', async () => {
    const { ops, calls } = mockOps({ leads: [] });
    render(<Akquise rufeAdminOps={ops} />);
    await screen.findByText(/Noch keine Akquise-Leads/);
    fireEvent.click(screen.getByTestId('akquise-neu'));
    expect(screen.getByTestId('akquise-anlegen')).toBeDisabled();
    fireEvent.change(screen.getByTestId('lead-company'), { target: { value: 'Neu GmbH' } });
    expect(screen.getByTestId('akquise-anlegen')).toBeDisabled();
    fireEvent.change(screen.getByTestId('lead-email'), { target: { value: 'neu@firma.de' } });
    fireEvent.change(screen.getByTestId('lead-satz'), { target: { value: 'Persönlicher Satz.' } });
    fireEvent.click(screen.getByTestId('akquise-anlegen'));
    await waitFor(() => expect(calls.find((c) => c.action === 'acquisition_lead_create')).toBeTruthy());
    const c = calls.find((c) => c.action === 'acquisition_lead_create');
    expect(c.params.lead).toMatchObject({ company_name: 'Neu GmbH', email: 'neu@firma.de', personalized_sentence: 'Persönlicher Satz.' });
    expect(Object.keys(c.params.lead)).not.toContain('acquisition_status');
  });
});
