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
  renderErstkontakt, renderNachfass, erstkontaktAbsaetze, betreffFuerVariante, anredeMoin, befundGueltig,
  BEFUND_TYPEN, BEFUND_TYP_SCHLUESSEL, normalisiereBefundTyp,
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
const mail = (v = 'A', extra = {}) => renderErstkontakt({ contactPerson: 'Alexander Reiser', finding: BEFUND, findingType: 'unbeantwortet', variante: v, ...extra });
const MIG171 = lies('../supabase/migrations/20261119090000_akquise_befund_typ.sql');

describe('Mail 1 (WP17.1: Du-Form, „Moin", Befund-Typen)', () => {
  it('M1 — Wortlaut exakt nach Vorgabe (Typ 2), Befund wortgleich nach „aufgefallen:", Telefon aus den Anbieterangaben', () => {
    expect(mail().text).toBe([
      'Moin Alexander,',
      `ich bin gerade über dein Google-Profil gestolpert. Dabei ist mir aufgefallen: ${BEFUND}`,
      'Genau das lesen die Leute, die dich empfohlen bekommen und vorher kurz nachschauen. Eine kurze Antwort zeigt ihnen, dass sich jemand kümmert.',
      'Ich bin Iver aus Hamburg und baue gerade WERKRUF, ein kleines Werkzeug für Handwerksbetriebe. WERKRUF schreibt dir zu jeder Bewertung auf Knopfdruck einen Antwortvorschlag. Du prüfst, änderst und gibst frei.',
      'Ich suche gerade zehn Betriebe, die es kostenlos nutzen und mir ehrlich sagen, was noch fehlt. Hast du Lust? Ein kurzes „Ja“ reicht, dann schicke ich dir alles Weitere.',
      `Beste Grüße aus Hamburg\nIver Bohnes\nWERKRUF · ${ANBIETER.telefon}`,
      'Falls du keine weitere Nachricht willst, antworte einfach mit „Nein“.',
    ].join('\n\n'));
    expect(mail().senderName).toBe('Iver Bohnes');
    expect(ABSENDER_NAME).toBe('Iver Bohnes');
  });
  it('M2 (Test 5) — kein Link, kein Button, kein „Founding Partner", keine Agentur-Leistung („soll ich dir … schicken")', () => {
    for (const typ of BEFUND_TYP_SCHLUESSEL) {
      for (const v of ['A', 'B']) {
        const r = renderErstkontakt({ contactPerson: 'Max', finding: BEFUND, findingType: typ, variante: v });
        for (const t of [r.text, r.html, r.subject]) {
          expect(t).not.toMatch(/https?:\/\/|www\.|werkruf\.com|<a\b|href=|<button|Founding|Partner|Präsentation/i);
          /* Werkzeug statt Dienstleistung: nichts, was Iver fuer den Betrieb erledigt */
          expect(t).not.toMatch(/soll ich (dir|Ihnen)[^.?]*(schicken|schreiben|machen|erstellen|ergänzen)|ich (schreibe|erstelle|kümmere)/i);
        }
        expect(r.html).not.toMatch(/background|#0B2545|#F28C28|border-radius|<img|<table/i);
        expect(r.text).toMatch(/Ein kurzes „Ja“ reicht/);
      }
    }
  });
  it('M3 — durchgehend Du-Form; kein Sie', () => {
    for (const typ of BEFUND_TYP_SCHLUESSEL) {
      const t = renderErstkontakt({ contactPerson: 'Max', finding: BEFUND, findingType: typ, variante: 'A' }).text.replace(BEFUND, '');
      expect(t).not.toMatch(/\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren)\b/);
      expect(t).toMatch(/\b(dich|dir|dein|du)\b/);
    }
  });
  it('M4 — Betreff: B einheitlich, A je Typ; unbekannte Variante/Typ wirft', () => {
    expect(betreffFuerVariante('B', 'starkes_profil')).toBe('Kurze Frage zu deinem Google-Profil');
    for (const k of ['starkes_profil', 'unbeantwortet', 'kritisch_offen', 'wenige_bewertungen']) expect(betreffFuerVariante('A', k)).toBe('Deine Google-Bewertungen');
    expect(betreffFuerVariante('A', 'profil_luecke')).toBe('Dein Google-Profil');
    expect(() => betreffFuerVariante('C', 'unbeantwortet')).toThrow();
    expect(() => betreffFuerVariante('A', 'super')).toThrow();
  });
  it('M5 (Test 1, Modulseite) — ohne Befund oder ohne Typ kein Rendern; Befund wird nie erzeugt', () => {
    for (const f of [null, undefined, '', '   ', 'kurz']) {
      expect(befundGueltig(f)).toBe(false);
      expect(() => renderErstkontakt({ finding: f, findingType: 'unbeantwortet', variante: 'B' })).toThrow('Google-Befund fehlt');
    }
    expect(() => renderErstkontakt({ finding: BEFUND, findingType: null, variante: 'B' })).toThrow('Befund-Typ fehlt');
    expect(befundGueltig('x'.repeat(601))).toBe(false);
    expect(erstkontaktAbsaetze({ finding: `  ${BEFUND}  `, findingType: 'unbeantwortet' })[1]).toBe(`ich bin gerade über dein Google-Profil gestolpert. Dabei ist mir aufgefallen: ${BEFUND}`);
  });
  it('M6 — Anrede „Moin Vorname,"; Herr/Frau oder kein Name → „Moin,"; Escaping im HTML', () => {
    expect(anredeMoin('Alexander Reiser')).toBe('Moin Alexander,');
    expect(anredeMoin('Ayşe')).toBe('Moin Ayşe,');
    for (const n of ['Herr Mack', 'Frau Özdemir', 'Hr. Mack', 'Dr. Weber', '-', '', '   ', null]) expect(anredeMoin(n)).toBe('Moin,');
    const r = renderErstkontakt({ contactPerson: '<b>Max</b>', finding: 'Ihre letzte <script>Bewertung</script> ist von August 2026.', findingType: 'wenige_bewertungen', variante: 'A' });
    expect(r.html).not.toMatch(/<script>|<b>Max/);
    expect(r.html).toMatch(/&lt;script&gt;/);
  });
  it('M7 — ohne Telefon (null) nur „WERKRUF" in der Signatur', () => {
    const r = renderErstkontakt({ finding: BEFUND, findingType: 'profil_luecke', variante: 'A', telefon: null });
    expect(r.text).toMatch(/Beste Grüße aus Hamburg\nIver Bohnes\nWERKRUF\n\nFalls du/);
  });
  it('M8 — fünf Typen, jeweils eigene Bruecke und eigener Werkzeug-Satz; Typ 1 nennt die Lob-Seite nicht als Problem', () => {
    expect(BEFUND_TYP_SCHLUESSEL).toEqual(['starkes_profil', 'unbeantwortet', 'kritisch_offen', 'wenige_bewertungen', 'profil_luecke']);
    const bruecken = new Set(BEFUND_TYP_SCHLUESSEL.map((k) => BEFUND_TYPEN[k].bruecke));
    const werkzeuge = new Set(BEFUND_TYP_SCHLUESSEL.map((k) => BEFUND_TYPEN[k].werkzeug));
    expect(bruecken.size).toBe(5); expect(werkzeuge.size).toBe(5);
    expect(BEFUND_TYPEN.starkes_profil.bruecke).toMatch(/schaut danach aber auch auf den Rest/);
    expect(BEFUND_TYPEN.starkes_profil.bruecke).not.toMatch(/Bewertung/);
  });
  it('M9 — Feature-Truth: jeder Werkzeug-Satz hat sein Gegenstueck im Code', () => {
    const W = Object.fromEntries(BEFUND_TYP_SCHLUESSEL.map((k) => [k, BEFUND_TYPEN[k].werkzeug]));
    /* „taeglich pruefen": Engine-Lauf + Profil-Waechter */
    expect(W.starkes_profil).toMatch(/prüft dein Profil täglich/);
    expect(lies('utils/wochenstatus.js')).toMatch(/GEPRUEFT/);
    /* Antwortvorschlag auf Knopfdruck, Freigabe */
    expect(W.unbeantwortet).toMatch(/auf Knopfdruck einen Antwortvorschlag\. Du prüfst, änderst und gibst frei\./);
    expect(lies('pages/dashboard/DashboardBewertungen.js')).toMatch(/Antwort vorschlagen/);
    /* sofort melden bei schlechten Bewertungen */
    expect(W.kritisch_offen).toMatch(/meldet dir schlechte Bewertungen sofort/);
    expect(SE).toMatch(/critical_review_alert/);
    /* Link, QR, SMS */
    expect(W.wenige_bewertungen).toMatch(/per Link, QR-Code oder SMS/);
    expect(lies('pages/dashboard/DashboardKundenGewinnung.js')).toMatch(/QRCodeSVG/);
    expect(lies('components/dashboard/SmsBewertungsanfrage.js')).toMatch(/EINWILLIGUNG_HINWEIS/);
    /* direkt eintragen → Google */
    expect(W.profil_luecke).toMatch(/du trägst sie gleich dort ein – die Änderung geht direkt an Google\./);
    expect(lies('../supabase/functions/google-business/index.ts')).toMatch(/updateMask/);
    /* nirgends: automatisch antworten / veroeffentlichen / Ranking */
    for (const t of Object.values(W)) expect(t).not.toMatch(/automatisch|Ranking|garantiert|Überwach/i);
  });
  it('M10 — Typ normalisieren: Schluessel, Nummer, Bezeichnung; sonst null', () => {
    expect(normalisiereBefundTyp('2')).toBe('unbeantwortet');
    expect(normalisiereBefundTyp(' Lücken im Profil ')).toBe('profil_luecke');
    expect(normalisiereBefundTyp('STARKES_PROFIL')).toBe('starkes_profil');
    for (const x of ['', '6', 'super', null, undefined]) expect(normalisiereBefundTyp(x)).toBeNull();
  });
});

describe('Nachfass-Mail', () => {
  const erst = mail('A');
  const n = renderNachfass({ contactPerson: 'Alexander Reiser', subject: erst.subject, originalText: erst.text, originalSentAt: '2026-11-19T06:30:00Z' });
  it('N1 — Wortlaut, gleicher Betreff wie Mail 1, Werkzeug statt Dienstleistung', () => {
    expect(n.subject).toBe('Deine Google-Bewertungen');
    expect(n.text.startsWith('Moin Alexander,\n\nkurz nachgehakt: Hast du Lust, WERKRUF kostenlos auszuprobieren? Ein „Ja“ reicht.\n\nBeste Grüße\nIver\n\n')).toBe(true);
    expect(n.senderName).toBe('Iver Bohnes');
  });
  it('N2 — Erstmail (gespeicherter Text) als Zitat darunter; ohne Text kein Zitat', () => {
    expect(n.text).toMatch(/Am 19\.11\.2026 schrieb Iver Bohnes:\n> Moin Alexander,/);
    expect(n.text).toContain(`> ich bin gerade über dein Google-Profil gestolpert. Dabei ist mir aufgefallen: ${BEFUND}`);
    expect(n.html).toMatch(/<blockquote/);
    expect(n.text).not.toMatch(/https?:\/\//);
    const ohne = renderNachfass({ contactPerson: 'Max', subject: 'X', originalText: '' });
    expect(ohne.text).not.toMatch(/schrieb Iver Bohnes/);
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
  it('Q3 — Vorlage fuer ein „Ja": Du-Form, Founding Partner erst hier, Anmeldung selbst; ehrlicher Wortlaut; nie automatisch', () => {
    expect(ANTWORT_VORLAGE_POSITIV).toMatch(/^Moin \{Vorname\},/);
    expect(ANTWORT_VORLAGE_POSITIV).toMatch(/einer von zehn Founding Partnern/);
    expect(ANTWORT_VORLAGE_POSITIV).toMatch(/https:\/\/werkruf\.com\/signup/);
    expect(ANTWORT_VORLAGE_POSITIV).not.toMatch(/meldet sich nur|überwacht|Überwachung|\bSie\b|\bIhnen\b/);
    expect(ohneKommentare(AO)).not.toMatch(/ANTWORT_VORLAGE_POSITIV/);
    expect(ohneKommentare(SE)).not.toMatch(/ANTWORT_VORLAGE_POSITIV/);
  });
  it('Q4 — Versand- und Nachfassgruende haben Text', () => {
    for (const k of ['befund_fehlt', 'befund_typ_fehlt', 'variante_fehlt', 'bereits_angeschrieben', 'nachfass_nicht_moeglich']) expect(VERSAND_GRUND_TEXT[k]).toBeTruthy();
    expect(MIG171).toContain("'befund_typ_fehlt'");
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
  it('A4 — Lead-Feld finding_type: editierbar, normalisiert, unbekannt → Fehler', () => {
    expect(LEAD_FELDER).toContain('finding_type');
    expect(pruefeLeadEingabe({ finding_type: '5' }, { neu: false })).toEqual({ ok: true, werte: { finding_type: 'profil_luecke' } });
    expect(pruefeLeadEingabe({ finding_type: '' }, { neu: false })).toEqual({ ok: true, werte: { finding_type: null } });
    expect(pruefeLeadEingabe({ finding_type: 'irgendwas' }, { neu: false }).ok).toBe(false);
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
  it('I1b — finding_type: Nummer, Schluessel oder Bezeichnung → Schluessel; unbekannter Typ → Zeilenfehler', () => {
    const r = csvZuZeilen(`company_name,email,google_profile_finding,finding_type\nA,a@x.de,"${BEFUND}",2\nB,b@x.de,"${BEFUND}",Lücken im Profil\nC,c@x.de,"${BEFUND}",starkes_profil\nD,d@x.de,"${BEFUND}",super\nE,e@x.de,,\n`);
    const z = bereiteImportVor(r.zeilen);
    expect(z.map((x) => x.werte?.finding_type ?? null)).toEqual(['unbeantwortet', 'profil_luecke', 'starkes_profil', null, null]);
    expect(z[3].fehler).toMatch(/Befund-Typ unbekannt: super/);
    expect(z[4].fehler).toBeNull();
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
    expect(senden).toMatch(/if \(!lead\.findingType \|\| !BEFUND_TYP_SCHLUESSEL\.includes\(lead\.findingType as string\)\) \{[\s\S]*?return \{ ok: false, code: 'befund_typ_fehlt' \};/);
    /* exakter Text von Mail 1 geht als Snapshot in die DB (Zitat im Nachfass) */
    expect(senden).toMatch(/findingType: lead\.findingType, variante, text: r\.text \}/);
    expect(MIG171).toMatch(/v_text := left\(nullif\(btrim\(coalesce\(p_payload ->> 'text', ''\)\), ''\), 6000\);/);
    expect(MIG171).toMatch(/if v_lead\.finding_type is null then return jsonb_build_object\('ok', false, 'reason', 'befund_typ_fehlt'\); end if;/);
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
