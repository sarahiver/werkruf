/**
 * WP15 — Saison-Beitraege.
 *
 *   T1–T9    Engine/Katalog: Fenster, Dedupe, Subjekt, Klasse, Kategorie, Jahreswechsel, Ostern
 *   T10–T17  Inhalt: Vorlagen neutral, Laenge, Leere, Status-Texte
 *   T18–T25  Zugang/Sicherheit (Quelltext): Pro, Ownership, nichts vom Client
 *   T26–T35  Provider (Quelltext): Endpoint, STANDARD, PROCESSING≠live, REJECTED, Fehlerklassen
 *   T36–T39  Idempotenz: Sperre in SQL (Quelltext) + Dashboard ohne Saisonlogik
 *   D1–D6    Dialog
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  SAISONEN, SAISON_KEYS, HEIZUNGS_KATEGORIEN, BEITRAG_MAX_ZEICHEN, BEITRAG_MIN_ZEICHEN,
  saison, saisonGiltFuer, saisonFenster, offeneSaisons, saisonSubjektId, baueBeitragsVorschlag,
  textErlaubtFuerBeitrag, textOhneWirkungsversprechen, pruefeBeitragstext, statusText, BEITRAG_GRUND_TEXT,
} from './utils/saisonBeitraege';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const D = (y, m, d) => ({ year: y, month: m, day: d });
const gb = lies('../supabase/functions/google-business/index.ts');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const mig = lies('../supabase/migrations/20261113090000_saison_beitraege.sql');

/* ───────── T1–T9 Engine/Katalog ───────── */
describe('T1–T9 — Saisonfenster und Engine', () => {
  it('T1 — im Fenster: Weihnachten am 10.12., Sommer am 01.07., nicht am 24.12./16.07.', () => {
    expect(offeneSaisons({ heute: D(2026, 12, 10) }).map((s) => s.key)).toEqual(['weihnachten']);
    expect(offeneSaisons({ heute: D(2026, 7, 1) }).map((s) => s.key)).toEqual(['sommer']);
    expect(offeneSaisons({ heute: D(2026, 12, 24) })).toEqual([]);
    expect(offeneSaisons({ heute: D(2026, 7, 16) })).toEqual([]);
    expect(offeneSaisons({ heute: D(2026, 11, 10) })).toEqual([]);   // heute: nichts
  });
  it('T2 — Jahreswechsel laeuft ueber Silvester: 30.12.2026 und 03.01.2027 sind dasselbe Saisonjahr 2026', () => {
    const a = offeneSaisons({ heute: D(2026, 12, 30) });
    const b = offeneSaisons({ heute: D(2027, 1, 3) });
    expect(a.map((s) => s.key)).toEqual(['jahreswechsel']);
    expect(b.map((s) => s.key)).toEqual(['jahreswechsel']);
    expect(a[0].jahr).toBe(2026); expect(b[0].jahr).toBe(2026);
    expect(a[0].bisIso).toBe('2027-01-06');
    expect(offeneSaisons({ heute: D(2027, 1, 7) })).toEqual([]);
    expect(saisonFenster(saison('jahreswechsel'), 2026)).toEqual({ von: D(2026, 12, 27), bis: D(2027, 1, 6) });
  });
  it('T3 — Ostern beweglich: 14 Tage vor Ostersonntag (2026: 05.04.) bis Ostersonntag', () => {
    expect(offeneSaisons({ heute: D(2026, 3, 22) }).map((s) => s.key)).toEqual(['ostern']);
    expect(offeneSaisons({ heute: D(2026, 4, 5) }).map((s) => s.key)).toEqual(['ostern']);
    expect(offeneSaisons({ heute: D(2026, 3, 21) })).toEqual([]);
    expect(offeneSaisons({ heute: D(2026, 4, 6) })).toEqual([]);
    expect(offeneSaisons({ heute: D(2027, 3, 20) }).map((s) => s.key)).toEqual(['ostern']);   // 2027: 28.03.
  });
  it('T4 — Heizsaison nur fuer Heizungs-Kategorien, nie aus dem Namen geraten', () => {
    expect(offeneSaisons({ heute: D(2026, 10, 1), primaryCategory: 'gcid:plumber' }).map((s) => s.key)).toEqual(['heizsaison']);
    expect(offeneSaisons({ heute: D(2026, 10, 1), primaryCategory: 'gcid:painter' })).toEqual([]);
    expect(offeneSaisons({ heute: D(2026, 10, 1), primaryCategory: null })).toEqual([]);
    expect(offeneSaisons({ heute: D(2026, 10, 1) })).toEqual([]);
    expect(saisonGiltFuer(saison('heizsaison'), 'GCID:HEATING_CONTRACTOR')).toBe(true);
    expect(saisonGiltFuer(saison('heizsaison'), 'Heizung Müller GmbH')).toBe(false);
    expect(HEIZUNGS_KATEGORIEN).toContain('gcid:heating_contractor');
  });
  it('T5 — dringend ab dringendAbTagen vor Fensterende; tageBisEnde stimmt', () => {
    const w1 = offeneSaisons({ heute: D(2026, 12, 10) })[0];
    expect(w1.tageBisEnde).toBe(13); expect(w1.dringend).toBe(false);
    const w2 = offeneSaisons({ heute: D(2026, 12, 17) })[0];
    expect(w2.tageBisEnde).toBe(6); expect(w2.dringend).toBe(true);
  });
  it('T6 — Subjekt-Id deterministisch je (Standort, Saison, Jahr); naechstes Jahr ist ein neues Subjekt', () => {
    const a = saisonSubjektId('loc-1', 'weihnachten', 2026);
    expect(a).toBe(saisonSubjektId('loc-1', 'weihnachten', 2026));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(saisonSubjektId('loc-1', 'weihnachten', 2027));
    expect(a).not.toBe(saisonSubjektId('loc-2', 'weihnachten', 2026));
    expect(a).not.toBe(saisonSubjektId('loc-1', 'jahreswechsel', 2026));
  });
  it('T7 — Regel: growth, visibility, low/medium, nie critical, Pfad mit season=&year=, kein Sofortalarm', () => {
    const rule = gb.slice(gb.indexOf("id: 'content.seasonal_post'"), gb.indexOf("id: 'profile.photos_missing'"));
    expect(rule).toMatch(/category: 'visibility'/);
    expect(rule).toMatch(/priority: s\.dringend \? 'medium' : 'low'/);
    expect(rule).not.toMatch(/'critical'|'high'/);
    expect(rule).toMatch(/id: saisonSubjektId\(facts\.seasons\.locationId \?\? 'konto', s\.key, s\.jahr\)/);
    expect(rule).toMatch(/actionUrl: `\/dashboard\/google\?season=\$\{s\.key\}&year=\$\{s\.jahr\}`/);
    expect(rule).toMatch(/when: \(\{ facts \}\) => facts\.seasons\.open\.length > 0/);
    expect(gb).toMatch(/'content\.seasonal_post':\s+'growth'/);
    const alarm = lies('../supabase/migrations/20261110120000_profil_diff_alarm.sql');
    expect(alarm.slice(alarm.indexOf('KANAL 1b'), alarm.indexOf('KANAL 2'))).not.toMatch(/seasonal/);
    expect(mig).not.toMatch(/enqueue_email|immediate_alert|cron\.schedule/);
  });
  it('T8 — Fakten: offene Saisons minus publishing/published aus dem Kontext; now injiziert, kein Date-Override', () => {
    const facts = gb.slice(gb.indexOf('seasons: (() => {'), gb.indexOf('/* WP8: aus dem Kontext'));
    expect(facts).toMatch(/const d = new Date\(now\);/);
    expect(facts).toMatch(/offeneSaisons\(\{ heute, primaryCategory: loc\?\.category \?\? null \}\)/);
    expect(facts).toMatch(/\(e\.status === 'published' \|\| e\.status === 'publishing'\)/);
    expect(facts).not.toMatch(/failed|rejected/);
    expect(gb).not.toMatch(/searchParams\.get\('date'\)|query\.date|body\.date\b.*season/);
  });
  it('T9 — Kontext liefert seasonalPosts nur fuer publishing/published; Katalog hat 5 Saisons mit eindeutigen Keys', () => {
    expect(mig).toMatch(/'seasonalPosts',[\s\S]*?and sp\.status in \('publishing', 'published'\)/);
    expect(SAISON_KEYS).toEqual(['weihnachten', 'jahreswechsel', 'ostern', 'sommer', 'heizsaison']);
    expect(new Set(SAISON_KEYS).size).toBe(SAISONEN.length);
    expect(saison('rabattwoche')).toBeNull();
  });
});

/* ───────── T10–T17 Inhalt ───────── */
describe('T10–T17 — Inhalt', () => {
  const VERBOTEN = ['10 % Rabatt', 'Jetzt Termin sichern', 'kostenlose Beratung', '24h Notdienst', 'freie Termine', 'Winterangebot', 'Sonderpreis', '€', 'Garantie'];
  it('T10 — jede Vorlage enthaelt den Betrieb, keine verbotenen Muster, Laenge im Rahmen', () => {
    for (const key of SAISON_KEYS) {
      const t = baueBeitragsVorschlag({ key, betrieb: 'Müller Haustechnik' });
      expect(t).toContain('Müller Haustechnik');
      expect(textErlaubtFuerBeitrag(t)).toBe(true);
      for (const v of VERBOTEN) expect(t.toLowerCase()).not.toContain(v.toLowerCase());
      expect(pruefeBeitragstext(t).ok).toBe(true);
    }
  });
  it('T10b — Product Truth: 1.500 ist ein WERKRUF-Limit, keine Google-Angabe (Kommentar, Fehlertext, Dialog)', () => {
    const src = lies('./utils/saisonBeitraege.js');
    expect(src).toMatch(/WERKRUF begrenzt Saison-Beitraege fuer eine kompakte Darstellung auf\s+1\.500 Zeichen/);
    expect(src).not.toMatch(/Google-Hilfe 1\.500|Google erlaubt maximal|Google nimmt längere|Google nimmt laengere/i);
    expect(BEITRAG_GRUND_TEXT.zu_lang).toBe('Höchstens 1.500 Zeichen pro WERKRUF-Saisonbeitrag.');
    expect(BEITRAG_GRUND_TEXT.zu_lang).not.toMatch(/Google/);
    expect(lies('./components/dashboard/SaisonBeitragDialog.js')).not.toMatch(/Google (erlaubt|nimmt|akzeptiert)/i);
  });
  it('T10c — Product Truth: keine Sichtbarkeits-/Ranking-/Nachfrageversprechen in Aufgabe, Begruendung, Vorlage, Regel', () => {
    for (const s of SAISONEN) {
      for (const t of [s.titel, s.aufgabe, s.warum, baueBeitragsVorschlag({ key: s.key, betrieb: 'B' })]) {
        expect(textOhneWirkungsversprechen(t)).toBe(true);
        expect(t).not.toMatch(/sichtbar|Ranking|besser gefunden|mehr Anfragen|Kunden suchen jetzt/i);
      }
    }
    expect(saison('weihnachten').warum).toBe('Weihnachten steht vor der Tür. Mit einem aktuellen Beitrag kannst du deinen Kunden direkt im Google-Profil einen kurzen Weihnachtsgruß zeigen.');
    expect(saison('heizsaison').warum).toBe('Die Heizsaison beginnt. Jetzt passt ein aktueller Beitrag zu diesem saisonalen Thema.');
    expect(textOhneWirkungsversprechen('hält dein Profil sichtbar')).toBe(false);
    expect(textOhneWirkungsversprechen('wirst besser gefunden')).toBe(false);
    const rule = gb.slice(gb.indexOf("id: 'content.seasonal_post'"), gb.indexOf("id: 'profile.photos_missing'"));
    expect(rule).not.toMatch(/sichtbar|Ranking|besser gefunden|mehr Anfragen/i);
  });
  it('T10d — Product Truth: Vorlagen behaupten keine Erreichbarkeit/Oeffnung (Betriebsferien)', () => {
    for (const key of SAISON_KEYS) {
      const t = baueBeitragsVorschlag({ key, betrieb: 'B' });
      expect(t).not.toMatch(/wir sind .{0,30}\b(da|erreichbar)\b|wie gewohnt|geöffnet|Öffnungszeiten|erreichbar|freie Termine|Termin vereinbaren/i);
    }
    expect(baueBeitragsVorschlag({ key: 'sommer', betrieb: 'B' })).toBe('Einen schönen Sommer wünscht euch das Team von B.\n\nWir wünschen euch eine gute Sommerzeit.');
    expect(textErlaubtFuerBeitrag('Wir sind weiterhin für euch da — wie gewohnt über die Kontaktdaten in unserem Profil.')).toBe(false);
    expect(textErlaubtFuerBeitrag('Wir sind wie gewohnt geöffnet.')).toBe(false);
    expect(textErlaubtFuerBeitrag('Wir wünschen euch eine gute Sommerzeit.')).toBe(true);
    /* Nutzertexte bleiben frei: nur Laenge */
    expect(pruefeBeitragstext('Wir sind im August wie gewohnt für euch da.').ok).toBe(true);
  });
  it('T11 — Mustererkennung schlaegt bei Angebots-/Notdienst-/Preis-/Garantie-Text an', () => {
    for (const v of VERBOTEN) expect(textErlaubtFuerBeitrag(`Hallo. ${v} bei uns.`)).toBe(false);
    expect(textErlaubtFuerBeitrag('Wir wünschen frohe Ostern.')).toBe(true);
  });
  it('T12 — ohne Betrieb oder unbekannter Key: keine Vorlage', () => {
    expect(baueBeitragsVorschlag({ key: 'weihnachten', betrieb: '' })).toBeNull();
    expect(baueBeitragsVorschlag({ key: 'weihnachten', betrieb: '   ' })).toBeNull();
    expect(baueBeitragsVorschlag({ key: 'rabattwoche', betrieb: 'X' })).toBeNull();
  });
  it('T13 — Textpruefung: leer, zu kurz, zu lang, ok (Codepoints, getrimmt)', () => {
    expect(pruefeBeitragstext('')).toEqual({ ok: false, grund: 'leer' });
    expect(pruefeBeitragstext('   \n ')).toEqual({ ok: false, grund: 'leer' });
    expect(pruefeBeitragstext(null)).toEqual({ ok: false, grund: 'leer' });
    expect(pruefeBeitragstext('Hallo Welt').grund).toBe('zu_kurz');
    expect(pruefeBeitragstext('x'.repeat(BEITRAG_MAX_ZEICHEN + 1)).grund).toBe('zu_lang');
    expect(pruefeBeitragstext('🎄'.repeat(BEITRAG_MAX_ZEICHEN)).ok).toBe(true);
    const ok = pruefeBeitragstext('  Frohe Weihnachten euch allen!\r\nEuer Team  ');
    expect(ok).toEqual({ ok: true, text: 'Frohe Weihnachten euch allen!\nEuer Team', zeichen: 39 });
    expect(BEITRAG_MIN_ZEICHEN).toBe(20); expect(BEITRAG_MAX_ZEICHEN).toBe(1500);
  });
  it('T14 — Status: PROCESSING heisst uebermittelt, nicht live; LIVE live; REJECTED abgelehnt; failed erneut', () => {
    expect(statusText('PROCESSING', 'published')).toBe('Beitrag wurde an Google übermittelt.');
    expect(statusText('PROCESSING', 'published')).not.toMatch(/live|veröffentlicht/);
    expect(statusText('LIVE', 'published')).toBe('Beitrag ist auf Google veröffentlicht.');
    expect(statusText('REJECTED', 'rejected')).toMatch(/abgelehnt.*erneut/);
    expect(statusText(null, 'failed')).toMatch(/fehlgeschlagen.*erneut/);
    expect(statusText(null, 'publishing')).toMatch(/wird an Google übermittelt/);
  });
  it('T15 — Vorlagen enthalten keine erfundenen Leistungen/Zahlen', () => {
    for (const key of SAISON_KEYS) expect(baueBeitragsVorschlag({ key, betrieb: 'B' })).not.toMatch(/\d/);
  });
  it('T16 — Nutzertext wird nur auf Laenge geprueft (der Betrieb kennt sein Geschaeft) — serverseitig dieselbe Funktion', () => {
    const h = ohneKommentare(gb.slice(gb.indexOf('async function handleSeasonalPostPublish'), gb.indexOf('async function handleHolidayHours')));
    expect(h).toMatch(/pruefeBeitragstext\(roh\)/);
    expect(h).not.toMatch(/textErlaubtFuerBeitrag/);
    expect(pruefeBeitragstext('Wir haben wieder freie Termine im Januar.').ok).toBe(true);
  });
  it('T17 — Grundtexte fuer alle Server-Gruende vorhanden', () => {
    for (const g of ['leer', 'zu_kurz', 'zu_lang', 'bereits_veroeffentlicht', 'laeuft_bereits', 'keine_saison', 'kein_zugang']) expect(BEITRAG_GRUND_TEXT[g]).toBeTruthy();
  });
});

/* ───────── T18–T25 Zugang/Sicherheit ───────── */
describe('T18–T25 — Zugang und Sicherheit (Quelltext)', () => {
  const h = ohneKommentare(gb.slice(gb.indexOf('async function handleSeasonalPostPublish'), gb.indexOf('async function handleHolidayHours')));
  const p = ohneKommentare(gb.slice(gb.indexOf('async function handleSeasonalPostPreview'), gb.indexOf('async function handleSeasonalPostPublish')));
  it('T18/T19 — JWT, Pro/FP und eigener Standort in Preview und Publish', () => {
    for (const x of [h, p]) {
      expect(x).toMatch(/const user = await requireUser\(request\);/);
      expect(x).toMatch(/await requirePaidAccess\(user\.id\);/);
      expect(x).toMatch(/loadOwnLocation\(body\.locationId, user\.id\)/);
    }
  });
  it('T20 — Client liefert nur locationId, seasonKey, seasonYear, eventId, summary', () => {
    expect(h).toMatch(/readJsonBody<\{ locationId\?: string; seasonKey\?: string; seasonYear\?: number; eventId\?: string; summary\?: string \}>/);
    expect(h).not.toMatch(/body\.(parent|name|resource|topicType|languageCode|accountId|userId|user_id|token|url|callToAction|media)\b/);
    expect(h).toMatch(/client\.createLocalPost\(location\.account_resource_name, location\.location_resource_name, summary, 'de'\)/);
  });
  it('T21 — Saison muss HEUTE offen sein; Key aus dem Katalog, nicht vom Client', () => {
    expect(h).toMatch(/const d = new Date\(\);/);
    expect(h).toMatch(/offeneSaisons\(\{ heute, primaryCategory: location\.primary_category \?\? null \}\)/);
    expect(h).toMatch(/\.find\(\(o\) => o\.key === body\.seasonKey && \(body\.seasonYear === undefined \|\| Number\(body\.seasonYear\) === o\.jahr\)\);/);
    expect(h).toMatch(/if \(!offen\) throw new GbpError\('bad_request', 'keine_saison', \{ anzeigbar: true \}\);/);
  });
  it('T22 — Event: vom Client nur als UUID, sonst ueber subject_id des Nutzers/Standorts; SQL prueft Zugehoerigkeit', () => {
    expect(h).toMatch(/\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(body\.eventId\)/);
    expect(h).toMatch(/\.eq\('user_id', user\.id\)\.eq\('location_id', location\.id\)\.eq\('type', 'content\.seasonal_post'\)/);
    expect(h).toMatch(/\.eq\('subject_id', saisonSubjektId\(location\.id, offen\.key, offen\.jahr\)\)/);
    expect(mig).toMatch(/select 1 from public\.events e where e\.id = p_engine_event_id and e\.user_id = p_user_id and e\.location_id = p_location_id\) then\s+raise exception 'Event gehoert nicht zu diesem Standort' using errcode = '42501'/);
    expect(mig).toMatch(/raise exception 'Standort gehoert nicht zum Nutzer' using errcode = '42501'/);
  });
  it('T23 — Free: Server 402 (payment_required) UND SQL kein_zugang', () => {
    expect(h).toMatch(/if \(b\.reason === 'kein_zugang'\) throw new GbpError\('payment_required', 'Kein aktiver Produktzugang'\);/);
    expect(mig).toMatch(/if not public\.has_paid_access\(p_user_id\) then\s+return jsonb_build_object\('ok', false, 'reason', 'kein_zugang'\);/);
    expect(gb).toMatch(/payment_required: 402/);
  });
  it('T24 — Rechte: Tabelle nur eigene Zeilen lesen, kein Client-Schreiben, RPCs nur service_role', () => {
    expect(mig).toMatch(/alter table public\.seasonal_posts enable row level security/);
    expect(mig).toMatch(/create policy seasonal_posts_own on public\.seasonal_posts for select to authenticated using \(user_id = auth\.uid\(\)\)/);
    expect(mig).toMatch(/revoke all on table public\.seasonal_posts from public, anon, authenticated/);
    expect(mig).not.toMatch(/for (insert|update|delete) to authenticated/);
    for (const fn of ['seasonal_post_begin', 'seasonal_post_finish', 'seasonal_post_state_update']) {
      expect(mig).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
      expect(mig).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
    }
    expect(gb).not.toMatch(/supabase\.rpc\('seasonal_post_/);
    expect(lies('./components/dashboard/SaisonBeitragDialog.js')).not.toMatch(/\.rpc\(|from\('seasonal_posts'\)/);
  });
  it('T25 — Audit ohne Volltext/Token; keine Tokens, keine Google-Payloads in seasonal_posts', () => {
    expect(h).toMatch(/action: 'seasonal_post\.publish_started'/);
    expect(h).toMatch(/metadata: \{ locationId: location\.id, seasonKey: offen\.key, seasonYear: offen\.jahr, zeichen: \[\.\.\.summary\]\.length \}/);
    expect(h).not.toMatch(/metadata: \{[^}]*(?:summary:|: summary\b|summary,)/);   // nur die Laenge, nie der Text
    expect(h).not.toMatch(/access_token|refresh_token/);
    const ddl = mig.slice(mig.indexOf('create table if not exists public.seasonal_posts'), mig.indexOf('alter table public.seasonal_posts enable row level security'));
    expect(ddl).not.toMatch(/google_payload|jsonb|access_token|refresh_token/);
    expect(mig).toMatch(/column_name in \('access_token', 'refresh_token', 'google_payload', 'oauth_token'\)/);   // Selbstcheck der Migration
    expect(mig).toMatch(/summary_snapshot text not null check \(length\(summary_snapshot\) between 1 and 1500\)/);
  });
});

/* ───────── T26–T35 Provider ───────── */
describe('T26–T35 — Provider Google Local Posts (Quelltext)', () => {
  const cl = ohneKommentare(gb.slice(gb.indexOf('createLocalPost(accountName'), gb.indexOf('getLocalPost(postName')));
  const h = ohneKommentare(gb.slice(gb.indexOf('async function handleSeasonalPostPublish'), gb.indexOf('async function handleHolidayHours')));
  it('T26/T27 — v4 localPosts.create unter dem Standort-Parent, Body nur languageCode/summary/topicType STANDARD', () => {
    expect(cl).toMatch(/GBP_LEGACY_API, `\$\{parent\}\/localPosts`/);
    expect(cl).toMatch(/method: 'POST'/);
    expect(cl).toMatch(/body: \{ languageCode, summary, topicType: 'STANDARD' \}/);
    expect(cl).not.toMatch(/callToAction|media|event|offer|schedule|recurr|OFFER|EVENT|ALERT/);
    expect(gb).toMatch(/GBP_LEGACY_API = 'https:\/\/mybusiness\.googleapis\.com\/v4'/);
  });
  it('T28 — Parent aus eigener DB-Zeile (accounts/…/locations/…), normalisiert; nie aus dem Request', () => {
    expect(cl).toMatch(/const parent = `\$\{normalizeName\(accountName, 'accounts'\)\}\/\$\{normalizeName\(locationName, 'locations'\)\}`;/);
  });
  it('T29/T30 — PROCESSING ist nicht live; Antwort meldet live nur bei LIVE', () => {
    expect(h).toMatch(/const state = antwort\.state \?\? 'PROCESSING';/);
    expect(h).toMatch(/live: state === 'LIVE'/);
    expect(h).not.toMatch(/live: true/);
  });
  it('T31 — REJECTED: Zeile rejected + error_code google_rejected, Event bleibt offen, ok:false', () => {
    expect(h).toMatch(/const rejected = state === 'REJECTED';/);
    expect(h).toMatch(/p_status: rejected \? 'rejected' : 'published'/);
    expect(h).toMatch(/p_error_code: rejected \? 'google_rejected' : null/);
    expect(h).toMatch(/if \(!rejected && eventId\) \{\s+await admin\.rpc\('record_recommendation_action', \{ p_event_id: eventId, p_action: 'completed'/);
    expect(h).toMatch(/ok: !rejected/);
  });
  it('T32–T34 — Google-Fehler: Zeile failed mit Fehlercode, Audit, bestehende Klassen (reauth 409, rate 429, api 502)', () => {
    expect(h).toMatch(/const g = toGbpError\(err\);/);
    expect(h).toMatch(/seasonal_post_finish', \{ p_id: postId, p_status: 'failed', p_google_post_name: null, p_google_state: null, p_error_code: g\.code \}/);
    expect(h).toMatch(/action: 'seasonal_post\.failed'/);
    expect(h).toMatch(/throw g;/);
    expect(h).not.toMatch(/for \(|while \(|\bretry\b|wiederhol/i);   // kein automatischer Retry
    expect(gb).toMatch(/reauth_required: 409/); expect(gb).toMatch(/rate_limited: 429/); expect(gb).toMatch(/google_api_error: 502/); expect(gb).toMatch(/payment_required: 402/);
  });
  it('T35 — Routen dokumentiert in LOCATION_ROUTES, POST', () => {
    expect(gb).toMatch(/'seasonal-post-preview':\s+\{ method: 'POST', handler: handleSeasonalPostPreview \}/);
    expect(gb).toMatch(/'seasonal-post':\s+\{ method: 'POST', handler: handleSeasonalPostPublish \}/);
  });
});

/* ───────── T36–T39 Idempotenz ───────── */
describe('T36–T39 — Idempotenz (SQL-Quelltext) und Dashboard ohne Saisonlogik', () => {
  it('T36 — eine aktive Zeile je Nutzer/Standort/Saison/Jahr (partieller Unique-Index publishing|published)', () => {
    expect(mig).toMatch(/create unique index if not exists seasonal_posts_one_active\s+on public\.seasonal_posts \(user_id, location_id, season_key, season_year\)\s+where status in \('publishing', 'published'\)/);
  });
  it('T37 — begin: published → bereits_veroeffentlicht, publishing → laeuft_bereits, Race → unique_violation → laeuft_bereits', () => {
    const b = mig.slice(mig.indexOf('create or replace function public.seasonal_post_begin'), mig.indexOf('create or replace function public.seasonal_post_finish'));
    expect(b).toMatch(/if v_status = 'published' then return jsonb_build_object\('ok', false, 'reason', 'bereits_veroeffentlicht'\); end if;/);
    expect(b).toMatch(/if v_status = 'publishing' then return jsonb_build_object\('ok', false, 'reason', 'laeuft_bereits'\); end if;/);
    expect(b).toMatch(/exception when unique_violation then[\s\S]*?return jsonb_build_object\('ok', false, 'reason', 'laeuft_bereits'\);/);
  });
  it('T38 — failed/rejected sperren nicht (Index greift nur publishing/published); finish nur aus publishing', () => {
    const f = mig.slice(mig.indexOf('create or replace function public.seasonal_post_finish'), mig.indexOf('create or replace function public.seasonal_post_state_update'));
    expect(f).toMatch(/and status = 'publishing'/);
    expect(f).toMatch(/p_status not in \('published', 'failed', 'rejected'\)/);
  });
  it('T39 — Dashboard rechnet keine Saison aus: nur URL-Parameter, Server entscheidet', () => {
    const page = lies('./pages/dashboard/DashboardGoogleBusiness.js');
    expect(page).toMatch(/q\.get\('season'\)/);
    expect(page).toMatch(/<SaisonBeitragDialog\s+location=\{ausgewaehlterStandort\}\s+seasonKey=\{saisonParams\.key\}\s+seasonYear=\{saisonParams\.jahr\}/);
    expect(page).not.toMatch(/offeneSaisons|SAISONEN|saisonFenster/);
    const dlg = lies('./components/dashboard/SaisonBeitragDialog.js');
    expect(dlg).not.toMatch(/offeneSaisons|SAISONEN|saisonFenster|baueBeitragsVorschlag|localPosts|topicType:/);
    expect(dlg).toMatch(/rufeLocation\('seasonal-post-preview'/);
    expect(dlg).toMatch(/rufeLocation\('seasonal-post', \{ locationId: location\.id, seasonKey: season\.key, seasonYear: season\.jahr, eventId, summary: text \}\)/);
  });
});

/* ───────── Admin-Snapshot ───────── */
describe('Admin — Support-Snapshot', () => {
  it('zaehlt uebermittelt/fehlgeschlagen, zeigt letzten Beitrag ohne Text; SMS-Zaehler ebenfalls befuellt', () => {
    const { baueSupportSnapshot } = require('./utils/adminOps');
    const snap = baueSupportSnapshot({
      profil: { id: 'u1', plan: 'pro', stripe_subscription_status: 'active' }, konto: null, standorte: [], jobs: [], mails: [], events: [],
      seasonalPosts: [
        { id: 'p3', season_key: 'weihnachten', season_year: 2026, status: 'rejected', google_state: 'REJECTED', error_code: 'google_rejected', created_at: '2026-12-03T10:00:00Z', summary_snapshot: 'GEHEIM' },
        { id: 'p2', season_key: 'sommer', season_year: 2026, status: 'published', google_state: 'PROCESSING', created_at: '2026-07-01T10:00:00Z' },
        { id: 'p1', season_key: 'ostern', season_year: 2026, status: 'failed', error_code: 'google_api_error', created_at: '2026-03-25T10:00:00Z' },
      ],
      smsRequests: [{ status: 'delivered', created_at: '2026-11-09T10:00:00Z' }, { status: 'failed', created_at: '2026-11-08T10:00:00Z', error_code: 'brevo' }],
    });
    expect(snap.saisonBeitraege).toEqual({
      uebermittelt: 1, fehlgeschlagen: 2,
      letzter: { saison: 'weihnachten', jahr: 2026, status: 'rejected', googleState: 'REJECTED', fehlerCode: 'google_rejected', am: '2026-12-03T10:00:00Z' },
    });
    expect(JSON.stringify(snap)).not.toContain('GEHEIM');
    expect(snap.smsBewertungsanfragen).toEqual({ gesendet: 1, fehlgeschlagen: 1, letzte: { status: 'delivered', am: '2026-11-09T10:00:00Z', fehlerCode: null } });
    const ao = lies('../supabase/functions/admin-ops/index.ts');
    expect(ao).toMatch(/admin\.from\('seasonal_posts'\)\s+\.select\('id,location_id,season_key,season_year,status,google_state,error_code,created_at,published_at,failed_at'\)/);
    expect(ao).not.toMatch(/summary_snapshot/);
  });
});

/* ───────── Dialog ───────── */
let mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
jest.mock('./context/AuthContext', () => ({ useAuthContext: () => ({ profile: mockProfil }) }));
jest.mock('./supabaseClient', () => ({ __esModule: true, default: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-test' } } }) } } }));
// eslint-disable-next-line import/first
import SaisonBeitragDialog from './components/dashboard/SaisonBeitragDialog';

const LOC = { id: 'loc-1', title: 'S&I Haustechnik' };
const SEASON = { key: 'weihnachten', jahr: 2026, titel: 'Weihnachtsgruß', aufgabe: 'Weihnachtsbeitrag vorbereiten', warum: 'Weihnachten steht vor der Tür.', bisIso: '2026-12-23' };
const VORSCHLAG = baueBeitragsVorschlag({ key: 'weihnachten', betrieb: 'S&I Haustechnik' });

function mockFetch(antworten) {
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization });
    const pfad = url.split('/location/')[1];
    const a = antworten[pfad];
    const r = typeof a === 'function' ? a(body) : a;
    return { ok: r.http ? r.http < 400 : true, json: async () => r.body ?? r };
  });
  return calls;
}

describe('D1–D6 — Dialog', () => {
  afterEach(() => { mockProfil = { plan: 'pro', stripe_subscription_status: 'active' }; delete global.fetch; });

  it('D1 — zeigt Vorschlag vom Server, Nutzer passt an, veroeffentlicht; nur erlaubte Felder gehen raus; PROCESSING = uebermittelt', async () => {
    const calls = mockFetch({
      'seasonal-post-preview': { ok: true, season: SEASON, vorschlag: VORSCHLAG, maxZeichen: 1500, bisheriger: null },
      'seasonal-post': { ok: true, postId: 'p1', status: 'published', googleState: 'PROCESSING', live: false, searchUrl: null },
    });
    render(<SaisonBeitragDialog location={LOC} seasonKey="weihnachten" seasonYear="2026" />);
    expect(await screen.findByText('Weihnachtsbeitrag vorbereiten')).toBeInTheDocument();
    expect(screen.getByTestId('saison-text')).toHaveValue(VORSCHLAG);
    expect(calls[0].body).toEqual({ locationId: 'loc-1', seasonKey: 'weihnachten', seasonYear: 2026 });
    expect(calls[0].auth).toBe('Bearer jwt-test');
    fireEvent.change(screen.getByTestId('saison-text'), { target: { value: 'Frohe Weihnachten wünscht das Team von S&I Haustechnik!' } });
    fireEvent.click(screen.getByTestId('saison-veroeffentlichen'));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].body).toEqual({ locationId: 'loc-1', seasonKey: 'weihnachten', seasonYear: 2026, eventId: null, summary: 'Frohe Weihnachten wünscht das Team von S&I Haustechnik!' });
    expect(Object.keys(calls[1].body).sort()).toEqual(['eventId', 'locationId', 'seasonKey', 'seasonYear', 'summary']);
    expect(await screen.findByTestId('saison-status')).toHaveTextContent('Beitrag wurde an Google übermittelt.');
    expect(screen.getByTestId('saison-status')).not.toHaveTextContent(/live|veröffentlicht/);
    expect(screen.getByTestId('saison-veroeffentlichen')).toBeDisabled();
  });
  it('D2 — Original wiederherstellen; zu kurzer Text blockiert; Zaehler', async () => {
    mockFetch({ 'seasonal-post-preview': { ok: true, season: SEASON, vorschlag: VORSCHLAG, maxZeichen: 1500, bisheriger: null } });
    render(<SaisonBeitragDialog location={LOC} seasonKey="weihnachten" />);
    await screen.findByText('Weihnachtsbeitrag vorbereiten');
    fireEvent.change(screen.getByTestId('saison-text'), { target: { value: 'Hallo' } });
    expect(screen.getByTestId('saison-textfehler')).toHaveTextContent('mindestens 20 Zeichen');
    expect(screen.getByTestId('saison-veroeffentlichen')).toBeDisabled();
    expect(screen.getByTestId('saison-zaehler')).toHaveTextContent('5 / 1500');
    fireEvent.click(screen.getByTestId('saison-original'));
    expect(screen.getByTestId('saison-text')).toHaveValue(VORSCHLAG);
    expect(screen.getByTestId('saison-veroeffentlichen')).toBeEnabled();
  });
  it('D3 — bereits veroeffentlicht: kein Formular, Status sichtbar', async () => {
    mockFetch({ 'seasonal-post-preview': { ok: true, season: SEASON, vorschlag: VORSCHLAG, bisheriger: { status: 'published', googleState: 'PROCESSING' } } });
    render(<SaisonBeitragDialog location={LOC} seasonKey="weihnachten" />);
    expect(await screen.findByTestId('saison-status')).toHaveTextContent('an Google übermittelt');
    expect(screen.queryByTestId('saison-veroeffentlichen')).toBeNull();
  });
  it('D4 — REJECTED sichtbar, Text des abgelehnten Beitrags vorbelegt, erneut veroeffentlichbar', async () => {
    const calls = mockFetch({
      'seasonal-post-preview': { ok: true, season: SEASON, vorschlag: VORSCHLAG, bisheriger: { status: 'rejected', googleState: 'REJECTED', text: 'Mein abgelehnter Text für die Weihnachtszeit.' } },
      'seasonal-post': { ok: true, postId: 'p2', status: 'published', googleState: 'PROCESSING' },
    });
    render(<SaisonBeitragDialog location={LOC} seasonKey="weihnachten" />);
    expect(await screen.findByTestId('saison-status')).toHaveTextContent('Google hat den Beitrag abgelehnt');
    expect(screen.getByTestId('saison-text')).toHaveValue('Mein abgelehnter Text für die Weihnachtszeit.');
    fireEvent.click(screen.getByTestId('saison-veroeffentlichen'));
    await waitFor(() => expect(calls.length).toBe(2));
  });
  it('D5 — Serverfehler (laeuft_bereits 409 / keine_saison) werden lesbar angezeigt', async () => {
    mockFetch({
      'seasonal-post-preview': { ok: true, season: SEASON, vorschlag: VORSCHLAG, bisheriger: null },
      'seasonal-post': { http: 409, body: { error: { code: 'bad_request', message: 'laeuft_bereits', retryable: false } } },
    });
    render(<SaisonBeitragDialog location={LOC} seasonKey="weihnachten" />);
    await screen.findByText('Weihnachtsbeitrag vorbereiten');
    fireEvent.click(screen.getByTestId('saison-veroeffentlichen'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Die Veröffentlichung läuft gerade');
    delete global.fetch;
    mockFetch({ 'seasonal-post-preview': { ok: false, reason: 'keine_saison' } });
    render(<SaisonBeitragDialog location={LOC} seasonKey="sommer" />);
    expect(await screen.findByTestId('saison-keine')).toHaveTextContent('kein saisonaler Beitrag vorgesehen');
  });
  it('D6 — Free sieht nichts (Server blockt zusaetzlich), kein Request', () => {
    mockProfil = { plan: 'free', stripe_subscription_status: 'canceled', stripe_subscription_id: 's' };
    const calls = mockFetch({});
    const { container } = render(<SaisonBeitragDialog location={LOC} seasonKey="weihnachten" />);
    expect(container).toBeEmptyDOMElement();
    expect(calls.length).toBe(0);
  });
});
