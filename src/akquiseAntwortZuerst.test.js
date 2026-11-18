/**
 * WP17 — Outreach „Antwort zuerst" (18.11.2026): Modul, Allowlist, Import, Quelltext.
 *
 *   M  Mail 1: reiner Text, Sie, Befund wortgleich, kein Link/Button/FP-Pitch,
 *      Betreff A/B, ohne Befund kein Rendern
 *   N  Nachfass: Wortlaut, gleicher Betreff, Erstmail als Zitat
 *   Q  Quoten, Antwort-Klassen, Vorlage fuer ein „Ja" (nicht automatisch)
 *   A  Allowlist: followup/record_reply, Parameter
 *   I  CSV mit und ohne google_profile_finding
 *   S  Server-Quelltext: Sperren in der DB, kein Cron, kein Bulk, Absender
 *   SQL-Seite: supabase/tests/akquise_antwort_zuerst.test.sql (S1–S15 mit Wirkung)
 */
import fs from 'fs';
import path from 'path';
import {
  renderErstkontakt, renderNachfass, erstkontaktAbsaetze, betreffFuerVariante, anredeSie, befundGueltig,
  ANTWORT_KLASSEN, ANTWORT_TEXT, ANTWORT_VORLAGE_POSITIV, akquiseQuoten, VERSAND_GRUND_TEXT, NACHFASS_GRUND_TEXT,
  SPERR_TEXT, pruefeLeadEingabe, ABSENDER_NAME, LEAD_FELDER,
} from './utils/akquise';
import { csvZuZeilen, bereiteImportVor, CSV_VORLAGE_KOPF } from './utils/akquiseImport';
import { ADMIN_AKTIONEN, pruefeAnfrage } from './utils/adminOps';
import { ANBIETER } from './config/anbieter';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const AO = lies('../supabase/functions/admin-ops/index.ts');
const SE = lies('../supabase/functions/send-email/index.ts');
const MIG = lies('../supabase/migrations/20261118090000_akquise_antwort_zuerst.sql');
const ADMIN = { id: '00000000-0000-4000-8000-00000000ad01', app_metadata: { role: 'admin' } };
const NUTZER = { id: '00000000-0000-4000-8000-0000000000b1', app_metadata: {} };
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const BEFUND = 'Elektrotechnik Mack hat bei Google 23 gute Bewertungen, auf die letzten fünf gibt es aber keine Antwort.';
const mail = (v = 'A', extra = {}) => renderErstkontakt({ companyName: 'Elektrotechnik Mack', contactPerson: 'Herr Mack', finding: BEFUND, variante: v, ...extra });

describe('Mail 1', () => {
  it('M1 — Wortlaut exakt nach Vorgabe, Befund wortgleich, Telefon aus den Anbieterangaben', () => {
    expect(mail().text).toBe([
      'Guten Tag Herr Mack,',
      BEFUND,
      'Das sehen genau die Leute, die Sie empfohlen bekommen und vorher kurz nachschauen.',
      'Ich bin Iver Bohnes aus Hamburg und entwickle ein kleines Werkzeug, das Handwerksbetrieben dabei hilft. Bevor ich Ihnen irgendetwas anbiete: Soll ich Ihnen kostenlos die drei Punkte schicken, die ich an Ihrem Google-Profil zuerst ändern würde?',
      'Ein kurzes „Ja“ als Antwort reicht.',
      `Viele Grüße\nIver Bohnes\nWERKRUF\n${ANBIETER.telefon}`,
      'Wenn Sie keine weitere Nachricht möchten, antworten Sie einfach mit „Nein“.',
    ].join('\n\n'));
    expect(mail().senderName).toBe('Iver Bohnes');
    expect(ABSENDER_NAME).toBe('Iver Bohnes');
  });
  it('M2 (Test 5) — kein Link, kein Button, kein Founding-Partner-Pitch, keine Features; HTML wie eine persoenliche Mail', () => {
    for (const v of ['A', 'B']) {
      const r = mail(v);
      for (const t of [r.text, r.html, r.subject]) {
        expect(t).not.toMatch(/https?:\/\/|www\.|werkruf\.com|<a\b|href=|<button|Founding|Partner|kostenlos testen|Präsentation|Wochenmail|Antwortvorschl|Health|Score/i);
      }
      expect(r.html).not.toMatch(/background|#0B2545|#F28C28|border-radius|<img|<table/i);
      /* WERKRUF genau einmal (Signatur) — „nur in einem kurzen Satz" */
      expect(r.text.match(/WERKRUF/g)).toHaveLength(1);
      /* Eine einzige Handlung: antworten */
      expect(r.text).toMatch(/Ein kurzes „Ja“ als Antwort reicht\./);
    }
  });
  it('M3 — durchgehend Sie-Form', () => {
    const t = mail().text;
    expect(t).not.toMatch(/\b(du|dich|dir|dein|deine|euch|euer|eure|ihr)\b/);
    expect(t).toMatch(/\bSie\b/); expect(t).toMatch(/\bIhnen\b/);
  });
  it('M4 — Betreff A/B nach Vorgabe; unbekannte Variante wirft', () => {
    expect(betreffFuerVariante('A', 'Elektrotechnik Mack')).toBe('Ihre Google-Bewertungen');
    expect(betreffFuerVariante('B', 'Elektrotechnik Mack')).toBe('Kurze Frage zu Elektrotechnik Mack bei Google');
    expect(mail('B').subject).toBe('Kurze Frage zu Elektrotechnik Mack bei Google');
    expect(() => betreffFuerVariante('C', 'X')).toThrow();
    expect(() => betreffFuerVariante(null, 'X')).toThrow();
  });
  it('M5 (Test 1, Modulseite) — ohne Befund kein Rendern; WERKRUF erfindet keinen Befund', () => {
    for (const f of [null, undefined, '', '   ', 'kurz']) {
      expect(befundGueltig(f)).toBe(false);
      expect(() => renderErstkontakt({ companyName: 'X', finding: f, variante: 'A' })).toThrow('Google-Befund fehlt');
    }
    expect(befundGueltig('x'.repeat(601))).toBe(false);
    /* Befund wird unveraendert uebernommen (nur getrimmt), nichts angehaengt */
    expect(erstkontaktAbsaetze({ finding: `  ${BEFUND}  ` })[1]).toBe(BEFUND);
  });
  it('M6 — Anrede: Name, sonst neutral; Platzhalter „-" zaehlt nicht als Name; Escaping im HTML', () => {
    expect(anredeSie('Herr Mack')).toBe('Guten Tag Herr Mack,');
    expect(anredeSie('-')).toBe('Guten Tag,');
    expect(anredeSie('')).toBe('Guten Tag,');
    expect(anredeSie(null)).toBe('Guten Tag,');
    const r = renderErstkontakt({ companyName: 'X', contactPerson: '<b>Max</b>', finding: 'Ihre letzte <script>Bewertung</script> ist von August 2026.', variante: 'A' });
    expect(r.html).not.toMatch(/<script>|<b>Max/);
    expect(r.html).toMatch(/&lt;script&gt;/);
  });
  it('M7 — ohne Telefon (null) keine leere Signaturzeile', () => {
    const r = renderErstkontakt({ companyName: 'X', finding: BEFUND, variante: 'A', telefon: null });
    expect(r.text).toMatch(/Viele Grüße\nIver Bohnes\nWERKRUF\n\nWenn Sie/);
  });
});

describe('Nachfass-Mail', () => {
  const erst = mail('A');
  const n = renderNachfass({ contactPerson: 'Herr Mack', subject: erst.subject, originalText: erst.text, originalSentAt: '2026-11-19T06:30:00Z' });
  it('N1 — Wortlaut nach Vorgabe, gleicher Betreff wie Mail 1', () => {
    expect(n.subject).toBe('Ihre Google-Bewertungen');
    expect(n.text.startsWith('Guten Tag Herr Mack,\n\nkurz nachgehakt: Soll ich Ihnen die drei Punkte zu Ihrem Google-Profil schicken?\n\nEin „Ja“ reicht.\n\nViele Grüße\nIver Bohnes\n\n')).toBe(true);
    expect(n.senderName).toBe('Iver Bohnes');
  });
  it('N2 — Erstmail als Zitat darunter (Brevo setzt keine In-Reply-To-Header)', () => {
    expect(n.text).toMatch(/Am 19\.11\.2026 schrieb Iver Bohnes:\n> Guten Tag Herr Mack,/);
    expect(n.text).toContain(`> ${BEFUND}`);
    expect(n.html).toMatch(/<blockquote/);
    expect(n.text).not.toMatch(/https?:\/\//);
    expect(() => renderNachfass({ subject: '', originalText: 'x' })).toThrow();
  });
});

describe('Antworten, Quoten, Vorlage', () => {
  it('Q1 — drei Klassen; Antwort ≠ Interesse im Wortlaut', () => {
    expect(ANTWORT_KLASSEN).toEqual(['positiv', 'negativ', 'sonstige']);
    expect(ANTWORT_TEXT).toEqual({ positiv: 'Positiv / „Ja"', negativ: 'Negativ / kein Interesse', sonstige: 'Sonstige Antwort' });
    expect(SPERR_TEXT.antwort_negativ).toMatch(/gesperrt/);
  });
  it('Q2 — Quoten bezogen auf zugestellt; Nenner 0 → null', () => {
    expect(akquiseQuoten({ angeschrieben: 158, zugestellt: 136, oeffnungErkannt: 50, antworten: 0, interesse: 0 }))
      .toEqual({ zustellRate: 86.1, oeffnungsRate: 36.8, antwortRate: 0, positivRate: 0 });
    expect(akquiseQuoten({})).toEqual({ zustellRate: null, oeffnungsRate: null, antwortRate: null, positivRate: null });
  });
  it('Q3 — Vorlage fuer ein „Ja": Platzhalter fuer drei Punkte, Founding-Partner-Angebot erst hier; ehrlicher Wortlaut', () => {
    expect(ANTWORT_VORLAGE_POSITIV).toMatch(/\{Punkt 1\}[\s\S]*\{Punkt 2\}[\s\S]*\{Punkt 3\}/);
    expect(ANTWORT_VORLAGE_POSITIV).toMatch(/Founding Partner dauerhaft kostenlos/);
    expect(ANTWORT_VORLAGE_POSITIV).toMatch(/schickt montags eine kurze Mail/);
    /* Wochenmail kommt jeden Montag — „meldet sich nur, wenn …" waere falsch; kein „überwacht" */
    expect(ANTWORT_VORLAGE_POSITIV).not.toMatch(/meldet sich nur|überwacht|Überwachung/);
    /* nirgends automatisch verwendet */
    expect(ohneKommentare(AO)).not.toMatch(/ANTWORT_VORLAGE_POSITIV/);
    expect(ohneKommentare(SE)).not.toMatch(/ANTWORT_VORLAGE_POSITIV/);
  });
  it('Q4 — Versand- und Nachfassgruende haben Text', () => {
    for (const k of ['befund_fehlt', 'variante_fehlt', 'bereits_angeschrieben', 'nachfass_nicht_moeglich']) expect(VERSAND_GRUND_TEXT[k]).toBeTruthy();
    for (const k of ['kein_lead', 'gesperrt', 'antwort_erfasst', 'bereits_nachgefasst', 'keine_erstmail']) expect(NACHFASS_GRUND_TEXT[k]).toBeTruthy();
    /* dieselben Codes wie in der Datenbank */
    for (const k of Object.keys(NACHFASS_GRUND_TEXT)) expect(MIG).toContain(`'${k}'`);
  });
});

describe('Allowlist', () => {
  it('A1 — followup verlangt Bestaetigung + Idempotenz; record_reply nur bekannte Klassen; Nicht-Admin 403', () => {
    expect(ADMIN_AKTIONEN.acquisition_followup).toMatchObject({ schreibt: true, parameter: ['leadId', 'idempotencyKey'], bestaetigung: true, auditAktion: 'admin.acquisition_followup_sent' });
    expect(ADMIN_AKTIONEN.acquisition_record_reply).toMatchObject({ schreibt: true, parameter: ['leadId', 'klasse'], auditAktion: 'admin.acquisition_reply_recorded' });
    const f = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_followup', parameter: { leadId: LEAD_ID, idempotencyKey: 'abcdef0123456789', email: 'x@y.de' } });
    expect(f.parameter).toEqual({ leadId: LEAD_ID, idempotencyKey: 'abcdef0123456789' });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_followup', parameter: { leadId: LEAD_ID } }).fehler).toBe('idempotencyKey fehlt');
    for (const k of ANTWORT_KLASSEN) {
      expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_record_reply', parameter: { leadId: LEAD_ID, klasse: k } }).parameter).toEqual({ leadId: LEAD_ID, klasse: k });
    }
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_record_reply', parameter: { leadId: LEAD_ID, klasse: 'interesse' } }).status).toBe(400);
    expect(pruefeAnfrage({ authUser: NUTZER, aktion: 'acquisition_record_reply', parameter: { leadId: LEAD_ID, klasse: 'positiv' } }).status).toBe(403);
    expect(pruefeAnfrage({ authUser: NUTZER, aktion: 'acquisition_followup', parameter: { leadId: LEAD_ID, idempotencyKey: 'abcdef0123456789' } }).status).toBe(403);
  });
  it('A2 — Vorschau: art erstkontakt (Standard) oder nachfass', () => {
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_preview', parameter: { leadId: LEAD_ID } }).parameter).toEqual({ leadId: LEAD_ID, art: 'erstkontakt' });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_preview', parameter: { leadId: LEAD_ID, art: 'nachfass' } }).parameter).toEqual({ leadId: LEAD_ID, art: 'nachfass' });
    expect(pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_preview', parameter: { leadId: LEAD_ID, art: 'fp' } }).status).toBe(400);
  });
  it('A3 — Lead-Feld google_profile_finding: editierbar, max. 600 Zeichen', () => {
    expect(LEAD_FELDER).toContain('google_profile_finding');
    expect(pruefeLeadEingabe({ google_profile_finding: `  ${BEFUND} ` }, { neu: false })).toEqual({ ok: true, werte: { google_profile_finding: BEFUND } });
    expect(pruefeLeadEingabe({ google_profile_finding: 'x'.repeat(601) }, { neu: false }).ok).toBe(false);
    const upd = pruefeAnfrage({ authUser: ADMIN, aktion: 'acquisition_lead_update', parameter: { leadId: LEAD_ID, lead: { google_profile_finding: BEFUND } } });
    expect(upd.parameter.lead).toEqual({ google_profile_finding: BEFUND });
  });
});

describe('CSV-Import', () => {
  it('I1 (Test 13) — neue Vorlage enthaelt google_profile_finding; Wert landet im Lead', () => {
    expect(CSV_VORLAGE_KOPF.split(',')).toContain('google_profile_finding');
    const r = csvZuZeilen(`company_name,email,google_profile_finding\nMack,info@mack.de,"${BEFUND}"\n`);
    expect(r.ok).toBe(true);
    const z = bereiteImportVor(r.zeilen);
    expect(z[0].werte).toEqual({ company_name: 'Mack', email: 'info@mack.de', google_profile_finding: BEFUND });
  });
  it('I2 (Test 14) — alte CSV ohne die Spalte: Import geht, Lead ohne Befund (nicht versandbereit)', () => {
    const r = csvZuZeilen('company_name,email,personalized_sentence\nAlt GmbH,alt@x.de,Satz\n');
    expect(r.ok).toBe(true);
    const z = bereiteImportVor(r.zeilen);
    expect(z[0].fehler).toBeNull();
    expect(z[0].werte).toEqual({ company_name: 'Alt GmbH', email: 'alt@x.de', personalized_sentence: 'Satz' });
    expect(z[0].werte).not.toHaveProperty('google_profile_finding');
  });
  it('I3 — Import-SQL uebernimmt das Feld, sendet nichts, setzt keine Antwort/Variante', () => {
    const imp = MIG.slice(MIG.indexOf('create or replace function public.acquisition_import_rows'), MIG.indexOf('/* ═══ 10'));
    expect(imp).toMatch(/nullif\(btrim\(w ->> 'google_profile_finding'\), ''\)/);
    expect(imp).not.toMatch(/enqueue_email|outreach_messages|reply_|outreach_subject_variant|followup_sent_at/);
  });
});

describe('Server (Quelltext)', () => {
  const ao = ohneKommentare(AO);
  it('S1 — Mail 1: Befund wird vor dem Versand geprueft; Variante aus der DB; Sperren in acquisition_outreach_send', () => {
    const senden = ao.slice(ao.indexOf('async function akquiseSenden'), ao.indexOf('async function akquiseNachfassen'));
    expect(senden).toMatch(/if \(!befundGueltig\(lead\.googleProfileFinding\)\) \{[\s\S]*?return \{ ok: false, code: 'befund_fehlt' \};/);
    expect(senden.indexOf("rpc('acquisition_assign_subject_variant'")).toBeLessThan(senden.indexOf("rpc('acquisition_outreach_send'"));
    expect(senden).toMatch(/p_template: 'outreach_erstkontakt'/);
    const sql = MIG.slice(MIG.indexOf('create or replace function public.acquisition_outreach_send'), MIG.indexOf('/* ═══ 13'));
    expect(sql).toMatch(/if v_befund is null then return jsonb_build_object\('ok', false, 'reason', 'befund_fehlt'\); end if;/);
    expect(sql).toMatch(/'bereits_angeschrieben'/);
  });
  it('S2 — Nachfass: Regel in der DB, Betreff aus der Erstmail, nur manuell (kein Cron, kein Bulk)', () => {
    const nach = ao.slice(ao.indexOf('async function akquiseNachfassen'), ao.indexOf('async function akquiseAntwortErfassen'));
    expect(nach).toMatch(/p_template: 'outreach_nachfass'/);
    expect(nach).not.toMatch(/leadIds|for \(const|Promise\.all|\.map\(/);
    const sql = MIG.slice(MIG.indexOf('create or replace function public.acquisition_outreach_send'), MIG.indexOf('/* ═══ 13'));
    expect(sql).toMatch(/v_subject := v_parent\.subject/);
    expect(MIG).toMatch(/create unique index if not exists outreach_messages_ein_nachfass/);
    /* keine neuen Crons/Schedules in diesem Paket */
    expect(MIG).not.toMatch(/cron\.schedule|pg_cron/);
  });
  it('S3 — Antwort erfassen: Status-Logik in der DB; positiv → interesse, negativ → kein_interesse + Sperre', () => {
    const sql = MIG.slice(MIG.indexOf('create or replace function public.acquisition_record_reply'), MIG.indexOf('/* ═══ 14'));
    expect(sql).toMatch(/p_klasse = 'positiv' and v_vorher in \('neu', 'vorbereitet', 'angeschrieben', 'zurueckgestellt', 'kein_interesse'\)/);
    expect(sql).toMatch(/v_nachher := 'kein_interesse'/);
    expect(sql).not.toMatch(/founding_partner'\)? then|v_nachher := 'founding_partner'/);
    expect(MIG).toMatch(/'antwort_negativ' from public\.leads l where l\.id = p_lead_id and l\.reply_classification = 'negativ'/);
  });
  it('S4 — Absender: gleiche Adresse, Name „Iver Bohnes" nur fuer die neuen Vorlagen; kein Reply-To erfunden', () => {
    expect(SE).toMatch(/sender: \{ name: rendered\.senderName \?\? brand\.name, email: brand\.senderEmail \}/);
    expect(SE).not.toMatch(/replyTo\s*:/);
    expect(AO).toMatch(/const AKQUISE_ABSENDER = \{ name: ABSENDER_NAME, email: 'info@werkruf\.com' \};/);
  });
  it('S5 — Migration: rueckwaertskompatibel (alte Vorlage bleibt, Trigger fuer alle drei, Selbstpruefung)', () => {
    expect(MIG).toMatch(/'founding_partner_outreach', 'outreach_erstkontakt', 'outreach_nachfass'/);
    expect(MIG).not.toMatch(/drop column|drop table|delete from public\.leads|update public\.leads set acquisition_status = /i);
    expect(MIG).toMatch(/raise notice '\[wp17\] in Ordnung'/);
    expect(MIG).toMatch(/add column if not exists google_profile_finding/);
  });
});
