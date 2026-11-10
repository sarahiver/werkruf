/**
 * WP14 — SMS-Bewertungsanfrage.
 *
 *   T7–T11   Mobilnummer → E.164, Ablehnungen
 *   T12–T17  Nachricht: Vorname, Betrieb, Link; kein „5 Sterne", kein
 *            Gating, kein Incentive; Segmentzaehlung
 *   Route    JWT → Access → eigener Standort → Server-Link → Nummer →
 *            Pruefung → Provider → Audit; keine Nummer in Logs/Audit;
 *            Pause blockt nicht (T36)
 *   Webhook  Secret, nur messageId/event, nichts geloggt
 *   UI       Einwilligungshinweis, Vorschau, Fehler, Erfolg
 *   T37/T38  PricingCard ohne Autopilot/PDF-Reporting
 *
 *   Wirkung von Access/Rate-Limit/Dedupe/Lifecycle: supabase/tests/
 *   sms_bewertungsanfrage.test.sql
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { normalisiereMobilnummer, formatMobilnummer } from './utils/mobilnummer';
import { bewertungsLink, istPlaceIdForm } from './utils/bewertungslink';
import {
  baueBewertungsSms, bereinigeVorname, smsSegmente, textErlaubt, VERBOTENE_MUSTER, SMS_SENDER, EINWILLIGUNG_HINWEIS, RATE_LIMIT,
  kurzerBewertungsLink, istShortCodeForm,
} from './utils/smsBewertung';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const GB = lies('../supabase/functions/google-business/index.ts');
const ROUTE = GB.slice(GB.indexOf('const BREVO_SMS_ENDPOINT'), GB.indexOf('const REVIEW_REQUEST_ROUTES'));
const SEND = ROUTE.slice(ROUTE.indexOf('async function handleReviewRequestSms('), ROUTE.indexOf('async function handleReviewRequestPreview'));
const HOOK = ROUTE.slice(ROUTE.indexOf('async function handleReviewRequestSmsWebhook'));
const MIG = lies('../supabase/migrations/20261112120000_sms_bewertungsanfrage.sql');
const PLACE = 'ChIJAbCdEfGhIjKlMnOpQrStUv';
const CODE = 'A7kx92Q';

describe('T7–T11 — Mobilnummer', () => {
  it('T7 — 0171… → +49171…', () => {
    expect(normalisiereMobilnummer('0171 1234567')).toEqual({ ok: true, e164: '+491711234567', national: '01711234567' });
    expect(normalisiereMobilnummer('0151/23456789')).toEqual({ ok: true, e164: '+4915123456789', national: '015123456789' });
  });
  it('T8 — +49171… bleibt; auch „+49 (0)171"', () => {
    expect(normalisiereMobilnummer('+49 171 1234567').e164).toBe('+491711234567');
    expect(normalisiereMobilnummer('+49 (0)171 1234567').e164).toBe('+491711234567');
  });
  it('T9 — 0049171… korrekt', () => {
    expect(normalisiereMobilnummer('0049-171-1234567').e164).toBe('+491711234567');
  });
  it('T10 — ungueltig: Festnetz, Ausland, ohne 0, falsche Laenge', () => {
    expect(normalisiereMobilnummer('040 1234567')).toEqual({ ok: false, grund: 'keine_mobilnummer' });
    expect(normalisiereMobilnummer('+43 660 1234567')).toEqual({ ok: false, grund: 'nur_deutsch' });
    expect(normalisiereMobilnummer('171 1234567')).toEqual({ ok: false, grund: 'keine_mobilnummer' });
    expect(normalisiereMobilnummer('0171 123')).toEqual({ ok: false, grund: 'laenge' });
    expect(normalisiereMobilnummer('0171 123456789012')).toEqual({ ok: false, grund: 'laenge' });
  });
  it('T11 — leer / alphabetisch / Sonderzeichen reject', () => {
    expect(normalisiereMobilnummer('')).toEqual({ ok: false, grund: 'leer' });
    expect(normalisiereMobilnummer('   ')).toEqual({ ok: false, grund: 'leer' });
    expect(normalisiereMobilnummer('null7171')).toEqual({ ok: false, grund: 'zeichen' });
    expect(normalisiereMobilnummer('0171;DROP')).toEqual({ ok: false, grund: 'zeichen' });
    expect(normalisiereMobilnummer(null)).toEqual({ ok: false, grund: 'leer' });
    expect(formatMobilnummer('+491711234567')).toBe('+49 171 1234567');
  });
});

describe('T12–T17 — Nachricht', () => {
  const t = baueBewertungsSms({ vorname: 'Thomas', betrieb: 'Elektro Müller', code: CODE });
  it('T12/T13/T14 — Vorname, Betrieb, kurzer WERKRUF-Link (WP14.2); Google-Link bleibt kanonisch fuer den Redirect', () => {
    expect(t).toMatch(/^Hallo Thomas, /);
    expect(t).toContain('bei Elektro Müller.');   // T13: Absender ist WERKRUF — der Kunde muss seinen Betrieb lesen
    expect(t).toContain(`https://werkruf.com/b/${CODE}`);
    expect(t).not.toMatch(/search\.google\.com/);
    expect(kurzerBewertungsLink(CODE)).toBe(`https://werkruf.com/b/${CODE}`);
    expect(kurzerBewertungsLink('abc')).toBeNull();
    expect(istShortCodeForm(PLACE)).toBe(false);          // C2: eine place_id ist kein Code
    expect(istShortCodeForm('11111111-1111-1111-1111-111111111111')).toBe(false);   // C3: keine UUID
    expect(bewertungsLink(PLACE)).toBe(`https://search.google.com/local/writereview?placeid=${PLACE}`);
    expect(istPlaceIdForm('short')).toBe(false);
    expect(bewertungsLink(null)).toBeNull();
    expect(bewertungsLink('http://evil')).toBeNull();
  });
  it('T15/T16/T17 — kein „5 Sterne", kein Gating, kein Incentive', () => {
    expect(textErlaubt(t)).toBe(true);
    expect(t).not.toMatch(/Stern/i);
    expect(t).not.toMatch(/unzufrieden/i);
    expect(t).not.toMatch(/Gutschein|Rabatt|Bonus/i);
    expect(textErlaubt('Bewerte uns mit 5 Sternen')).toBe(false);
    expect(textErlaubt('Wenn du unzufrieden bist, antworte erst uns')).toBe(false);
    expect(textErlaubt('Als Dankeschön gibt es einen Gutschein')).toBe(false);
    expect(VERBOTENE_MUSTER.length).toBeGreaterThanOrEqual(3);
    /* WP14.2 T1–T6 — auch POSITIVES Gating ist verboten */
    expect(t).not.toMatch(/zufrieden|gepasst|empfehlen/i);                      // T1
    expect(textErlaubt('Wenn du zufrieden warst, freuen wir uns')).toBe(false);  // T2
    expect(textErlaubt('Wenn alles gepasst hat, bewerte uns')).toBe(false);      // T3
    expect(textErlaubt('Wenn du uns empfehlen würdest, schreib uns')).toBe(false); // T4
    expect(textErlaubt('Wenn Sie zufrieden sind')).toBe(false);
    expect(textErlaubt('wenn alles gut war')).toBe(false);
    expect(textErlaubt('Teile gern deine Erfahrung bei Google')).toBe(true);     // T5
    expect(textErlaubt('Wir freuen uns über eine positive Bewertung')).toBe(false); // T6
    expect(textErlaubt('eine gute Bewertung')).toBe(false);
    expect(textErlaubt('bei 5 Sternen')).toBe(false);
    /* Der Server prueft die gebaute Nachricht gegen dieselbe Liste */
    expect(SEND).toMatch(/if \(!text \|\| !textErlaubt\(text\)\) throw new GbpError\('internal_error', 'Vorlage ungueltig'\);/);
  });
  it('Vorname wird bereinigt; Vorlage ohne Link oder Name → null', () => {
    expect(bereinigeVorname('  thomas  ')).toBe('thomas');
    expect(bereinigeVorname('Anna-Lena')).toBe('Anna-Lena');
    expect(bereinigeVorname('<script>')).toBeNull();
    expect(bereinigeVorname('x'.repeat(41))).toBeNull();
    expect(baueBewertungsSms({ vorname: 'Thomas', betrieb: 'B', code: 'nope' })).toBeNull();
    expect(baueBewertungsSms({ vorname: '', betrieb: 'B', code: CODE })).toBeNull();
  });
  it('Segmente: GSM-7 mit Umlauten, 160/153; UCS-2 bei Emoji', () => {
    expect(smsSegmente('Hallo äöü ß').encoding).toBe('GSM-7');
    expect(smsSegmente('a'.repeat(160))).toEqual({ encoding: 'GSM-7', zeichen: 160, segmente: 1 });
    expect(smsSegmente('a'.repeat(161)).segmente).toBe(2);
    expect(smsSegmente('a'.repeat(306)).segmente).toBe(2);
    expect(smsSegmente('a'.repeat(307)).segmente).toBe(3);
    expect(smsSegmente('€').zeichen).toBe(2);
    expect(smsSegmente('Hallo 😀').encoding).toBe('UCS-2');
    expect(smsSegmente('x'.repeat(71)).encoding).toBe('GSM-7');
    const s = smsSegmente(t);
    expect(s.encoding).toBe('GSM-7');
    expect(s.segmente).toBe(1);
    /* T24 (WP14.2) — realistisch: Maximilian, Elektrotechnik Müller GmbH, lange Place-ID.
       Alt (Google-Link direkt) vs. neu (Shortlink): weniger Einheiten, Ziel 1 Segment. */
    const placeLang = 'ChIJN1t_tDeuEmsRUsoyG83frY4ABCDEFGHIJKLMNOPQRSTUV';
    const alt = `Hallo Maximilian, vielen Dank für deinen Auftrag bei Elektrotechnik Müller GmbH. Wenn du zufrieden warst, freuen wir uns über eine kurze Google-Bewertung: ${bewertungsLink(placeLang)}`;
    const neu = baueBewertungsSms({ vorname: 'Maximilian', betrieb: 'Elektrotechnik Müller GmbH', code: CODE });
    expect(smsSegmente(alt).segmente).toBe(2);
    expect(smsSegmente(neu).zeichen).toBeLessThan(smsSegmente(alt).zeichen);
    expect(smsSegmente(neu).segmente).toBe(1);
    /* sehr langer Betriebsname darf weiterhin 2 Segmente sein — keine harte Garantie */
    expect(smsSegmente(baueBewertungsSms({ vorname: 'Maximilian', betrieb: 'X'.repeat(90), code: CODE })).segmente).toBe(2);
    expect(SMS_SENDER.length).toBeLessThanOrEqual(11);
    expect(SMS_SENDER).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('Route — Server-Wahrheit', () => {
  it('Flow: JWT → Access → eigener Standort → Server-Link → Nummer → Pruefung → Provider', () => {
    const i = (s) => SEND.indexOf(s);
    const reihe = ['await requireUser(request)', 'await requirePaidAccess(user.id)', 'await loadOwnLocation(body.locationId, user.id)',
      'bewertungsLink(location.place_id', 'normalisiereMobilnummer(body.telefon', "rpc('review_sms_pruefen'", "rpc('review_sms_anlegen'", 'await sendeBrevoSms('];
    for (let k = 1; k < reihe.length; k++) expect(i(reihe[k])).toBeGreaterThan(i(reihe[k - 1]));
    expect(i('await requireUser(request)')).toBeGreaterThan(-1);
  });
  it('C3 — keine reviewUrl/businessName/userId vom Client; Link nur aus place_id des eigenen Standorts', () => {
    expect(SEND).toMatch(/readJsonBody<\{ locationId\?: string; vorname\?: string; telefon\?: string \}>/);
    expect(SEND).not.toMatch(/body\.(reviewUrl|url|link|businessName|betrieb|userId)/);
    expect(ohneKommentare(ROUTE)).not.toMatch(/reviewUrl|review_url|businessName/i);
    expect(SEND).toMatch(/\n\s*const link = bewertungsLink\(location\.place_id \?\? null\);\n/);
    /* WP14.2: Text traegt den Shortlink des EIGENEN Standorts; Vorschau nutzt denselben Code-Weg */
    expect(SEND).toMatch(/const code = await ensureReviewShortCode\(user\.id, location\.id\);\s*const betrieb = \(location\.title \?\? ''\)\.trim\(\);\s*const text = baueBewertungsSms\(\{ vorname, betrieb, code \}\)/);
    const preview = ROUTE.slice(ROUTE.indexOf('async function handleReviewRequestPreview'), ROUTE.indexOf('async function handleReviewRequestSmsWebhook'));
    expect(preview).toMatch(/const code = await ensureReviewShortCode\(user\.id, location\.id\);[\s\S]*baueBewertungsSms\(\{ vorname, betrieb: \(location\.title \?\? ''\)\.trim\(\), code \}\)/);
    expect(SEND).not.toMatch(/baueBewertungsSms\(\{[^}]*placeId/);   // C6: kein langer Google-Link mehr in der SMS
    expect(SEND).toMatch(/\n\s*const text = baueBewertungsSms\(\{ vorname, betrieb, code \}\);\n/);   // unveraendert weitergereicht
    expect(SEND.match(/\btext\b\s*=/g)).toHaveLength(1);
    expect(ohneKommentare(SEND)).not.toMatch(/\.replace\(|\+ link|\$\{link\}/);
    expect(SEND).toMatch(/const betrieb = \(location\.title \?\? ''\)\.trim\(\);/);
    expect(SEND).toMatch(/if \(!link\) throw new GbpError\('bad_request', 'kein_link'/);   // T6
  });
  it('T3/T5 — Free 402 und fremder Standort 404 serverseitig; SQL prueft Besitz erneut', () => {
    expect(SEND).toMatch(/await requirePaidAccess\(user\.id\);/);
    expect(GB).toMatch(/async function loadOwnLocation\(locationId: string, userId: string\)[\s\S]*\.eq\('id', locationId\)\.eq\('user_id', userId\)/);
    expect(MIG).toMatch(/if not public\.has_paid_access\(p_user_id\) then\s*return jsonb_build_object\('ok', false, 'reason', 'kein_zugang'\)/);
    expect(MIG).toMatch(/raise exception 'Standort gehoert nicht zum Nutzer'/);
  });
  it('T36 — Pause blockt den manuellen Versand nicht', () => {
    expect(ROUTE).not.toMatch(/is_account_paused|istPausiert|pause_from/);
  });
  it('T29/T30/T32 — Provider ok → sent + messageId; Fehler → failed, erneut moeglich (kein Retry-Loop)', () => {
    expect(SEND).toMatch(/p_status: 'sent', p_provider_message_id: ergebnis\.messageId/);
    expect(SEND).toMatch(/p_status: 'failed', p_provider_message_id: null, p_error_code: ergebnis\.code/);
    expect(ROUTE).not.toMatch(/setTimeout|for \(let versuch|retries/);
    expect(ROUTE).toMatch(/BREVO_SMS_ENDPOINT = 'https:\/\/api\.brevo\.com\/v3\/transactionalSMS\/send'/);
    expect(ROUTE).toMatch(/type: 'transactional'/);
    expect(ROUTE).toMatch(/Deno\.env\.get\('BREVO_API_KEY'\)/);
    expect(ROUTE).not.toMatch(/NEXT_PUBLIC|REACT_APP_/);
  });
  it('T31 — keine Telefonnummer in Logs oder Audit: nur Hash, kein console.log(e164/telefon), Metadaten ohne Nummer', () => {
    const r = ohneKommentare(ROUTE);
    const logs = r.match(/console\.(log|error|warn)\([^;]*\)/g) || [];
    for (const l of logs) expect(l).not.toMatch(/e164|telefon|nummer\.|recipient|body\.telefon|payload|roh\b/);
    const audits = r.match(/writeAuditLog\(\{[\s\S]*?\}\)/g) || [];
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const a of audits) { expect(a).not.toMatch(/e164|telefon|nummer|hash|vorname/); expect(a).toMatch(/locationId: location\.id/); }
    expect(r).toMatch(/crypto\.subtle\.importKey\('raw'[\s\S]*HMAC/);
    const tabelle = MIG.slice(MIG.indexOf('create table if not exists public.review_sms_requests'), MIG.indexOf('create index'));
    expect(tabelle).not.toMatch(/phone_number|recipient_name|telefon|\bname\b/);
    expect(MIG).toMatch(/phone_hash\s+text not null check \(phone_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  });
  it('Testmodus wie bei E-Mail: SMS_DELIVERY_MODE=test → SMS_TEST_RECIPIENT, nie echte Kunden', () => {
    expect(ROUTE).toMatch(/Deno\.env\.get\('SMS_DELIVERY_MODE'\) \?\? 'production'/);
    expect(ROUTE).toMatch(/if \(mode === 'test'\) \{[\s\S]*SMS_TEST_RECIPIENT/);
  });
  it('T34/T35 — Webhook: Secret, nur messageId + event, Payload nie geloggt, DB idempotent', () => {
    expect(HOOK).toMatch(/if \(!expected \|\| geliefert !== expected\) throw new GbpError\('unauthenticated'/);
    expect(HOOK).toMatch(/rpc\('review_sms_delivery'/);
    /* Brevo SMS schickt msg_status, nicht event (Fix 10.11.2026 — erste Test-SMS blieb auf 'sent') */
    expect(HOOK).toMatch(/typeof roh\.msg_status === 'string' \? roh\.msg_status : \(typeof roh\.event === 'string' \? roh\.event : ''\)/);
    for (const k of ['delivered', 'hard_bounce', 'soft_bounce', 'rej', 'bl', 'skip', 'unsubscribed']) expect(HOOK).toMatch(new RegExp(`\\b${k}: '(delivered|failed)'`));
    const logs = ohneKommentare(HOOK).match(/console\.(log|error|warn)\([^;]*\)/g) || [];
    for (const l of logs) expect(l).not.toMatch(/payload|roh|\bto\b/);
    expect(MIG).toMatch(/if p_event = 'delivered' and v_status in \('queued', 'sent'\) then/);
    expect(MIG).toMatch(/return jsonb_build_object\('known', false, 'changed', false\)/);
  });
  it('WP14.2 T16–T18 — Webhook mit eigenem SMS_WEBHOOK_SECRET; BREVO_WEBHOOK_SECRET reicht nicht; Pepper nie aus BREVO', () => {
    expect(HOOK).toMatch(/const expected = Deno\.env\.get\('SMS_WEBHOOK_SECRET'\) \?\? '';/);
    expect(ohneKommentare(ROUTE)).not.toMatch(/BREVO_WEBHOOK_SECRET/);
    expect(ROUTE).toMatch(/const webhookSecret = Deno\.env\.get\('SMS_WEBHOOK_SECRET'\);/);
    expect(ROUTE).toMatch(/Deno\.env\.get\('SMS_PHONE_PEPPER'\) \?\? Deno\.env\.get\('SMS_WEBHOOK_SECRET'\)/);
  });
  it('WP14.2 T7–T12 — /b/<code>: nur GET, Lookup ueber Standort → place_id → Generator, 404 ohne Inhalt, kein Write, keine IDs', () => {
    const red = ROUTE.slice(ROUTE.indexOf('async function handleReviewShortRedirect'), ROUTE.indexOf('const REVIEW_REQUEST_ROUTES'));
    expect(red).toMatch(/if \(!istShortCodeForm\(code\)\) return new Response\(null, \{ status: 404/);
    expect(red).toMatch(/rpc\('review_short_link_place_id', \{ p_code: code \}\)/);
    expect(red).toMatch(/const ziel = bewertungsLink\(typeof data === 'string' \? data : null\);/);
    expect(red).toMatch(/if \(!ziel\) return new Response\(null, \{ status: 404/);
    expect(red).toMatch(/status: 302, headers: \{ \.\.\.kopf, Location: ziel \}/);
    expect(red).not.toMatch(/\.insert\(|\.update\(|click|last_used/);
    expect(red).not.toMatch(/JSON\.stringify\(\{[^}]*(place|location|user)/);
    expect(GB).toMatch(/if \(routeName === 'b' && sub\) \{[\s\S]*return handleReviewShortRedirect\(request, sub\);/);
    expect(GB).toMatch(/if \(request\.method !== 'GET' && request\.method !== 'HEAD'\)/);
    /* Vercel reicht werkruf.com/b/<code> an die Function durch; SPA-Fallback bleibt */
    const v = JSON.parse(lies('../vercel.json'));
    expect(v.rewrites[0]).toEqual({ source: '/b/:code', destination: 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/google-business/b/:code' });
    expect(v.rewrites[v.rewrites.length - 1]).toEqual({ source: '/(.*)', destination: '/index.html' });
    /* Migration: Link speichert keine URL/place_id, cascade bei Standortloeschung, ein aktiver Code je Standort */
    const m2 = lies('../supabase/migrations/20261112150000_review_short_links.sql');
    expect(m2).toMatch(/location_id uuid not null references public\.google_locations\(id\) on delete cascade/);
    expect(m2).toMatch(/review_short_links_one_active_per_location\s*on public\.review_short_links \(location_id\) where active/);
    expect(m2).toMatch(/code\s+text not null unique check \(code ~ '\^\[A-Za-z0-9\]\{7\}\$'\)/);
    expect(m2).toMatch(/where s\.code = p_code and s\.active and l\.deleted_at is null and l\.place_id is not null/);
  });
  it('Rate-Limit/Dedupe stehen in SQL mit den dokumentierten Zahlen', () => {
    expect(MIG).toMatch(/created_at >= p_now - interval '10 minutes'/);
    expect(MIG).toMatch(/if v_kurz >= 5 then/);
    expect(MIG).toMatch(/if v_tag >= 30 then/);
    expect(MIG).toMatch(/status in \('queued', 'sent', 'delivered'\)\s*and created_at >= p_now - interval '24 hours'/);
    expect(RATE_LIMIT).toEqual({ kurzFenster: 5, kurzMinuten: 10, tag: 30, dedupeStunden: 24 });
  });
});

/* ── Komponente ── */
jest.mock('./supabaseClient', () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
  return { __esModule: true, default: client, supabase: client };
});
// eslint-disable-next-line import/first
import SmsBewertungsanfrage from './components/dashboard/SmsBewertungsanfrage';

describe('UI — Bewertung per SMS anfragen', () => {
  let fetchAlt; const aufrufe = [];
  beforeEach(() => {
    fetchAlt = global.fetch; aufrufe.length = 0;
    global.fetch = jest.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      aufrufe.push({ url, body });
      if (url.endsWith('/review-request/sms-preview')) {
        return { ok: true, json: async () => ({ ok: true, text: baueBewertungsSms({ vorname: body.vorname, betrieb: 'Elektro Müller', code: CODE }), segments: 1 }) };
      }
      if (body.telefon === '0171 0000000') return { ok: false, json: async () => ({ error: { message: 'doppelt' } }) };
      return { ok: true, json: async () => ({ ok: true, status: 'sent', segments: 1 }) };
    });
  });
  afterEach(() => { global.fetch = fetchAlt; });
  const standorte = [{ id: 'loc-1', title: 'Elektro Müller', place_id: PLACE }];

  it('Einwilligungshinweis sichtbar, Vorschau vom Server, Client schickt nur locationId/vorname/telefon', async () => {
    render(<SmsBewertungsanfrage standorte={standorte} vorausgewaehlt="loc-1" />);
    expect(screen.getByTestId('sms-einwilligung')).toHaveTextContent(EINWILLIGUNG_HINWEIS);
    fireEvent.change(screen.getByTestId('sms-vorname'), { target: { value: 'Thomas' } });
    fireEvent.change(screen.getByTestId('sms-telefon'), { target: { value: '0171 1234567' } });
    await waitFor(() => expect(screen.getByTestId('sms-vorschau')).toHaveTextContent('Hallo Thomas'));
    expect(screen.getByTestId('sms-vorschau')).toHaveTextContent(`https://werkruf.com/b/${CODE}`);
    expect(screen.getByTestId('sms-segmente')).toHaveTextContent('1 SMS');
    await waitFor(() => expect(screen.getByTestId('sms-senden')).not.toBeDisabled());
    await act(async () => { fireEvent.click(screen.getByTestId('sms-senden')); });
    await screen.findByTestId('sms-erfolg');
    expect(screen.getByTestId('sms-erfolg')).toHaveTextContent('SMS wurde gesendet.');
    const send = aufrufe.find((a) => a.url.endsWith('/review-request/sms'));
    expect(Object.keys(send.body).sort()).toEqual(['locationId', 'telefon', 'vorname']);
    expect(screen.getByTestId('sms-vorname').value).toBe('');          // Formular geleert — nichts bleibt
    expect(screen.getByTestId('sms-telefon').value).toBe('');
  });
  it('Festnetz wird frueh gemeldet; Server-„doppelt" wird verstaendlich angezeigt', async () => {
    render(<SmsBewertungsanfrage standorte={standorte} vorausgewaehlt="loc-1" />);
    fireEvent.change(screen.getByTestId('sms-telefon'), { target: { value: '040 123456' } });
    expect(screen.getByTestId('sms-nummer-fehler')).toHaveTextContent('keine deutsche Mobilnummer');
    expect(screen.getByTestId('sms-senden')).toBeDisabled();
    fireEvent.change(screen.getByTestId('sms-vorname'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByTestId('sms-telefon'), { target: { value: '0171 0000000' } });
    await waitFor(() => expect(screen.getByTestId('sms-senden')).not.toBeDisabled());
    await act(async () => { fireEvent.click(screen.getByTestId('sms-senden')); });
    await screen.findByTestId('sms-fehler');
    expect(screen.getByTestId('sms-fehler')).toHaveTextContent('heute schon eine Bewertungsanfrage');
  });
  it('Betriebsauswahl nur bei mehreren Standorten; kein Link → Hinweis, Senden gesperrt', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: false, reason: 'kein_link' }) }));
    render(<SmsBewertungsanfrage standorte={[...standorte, { id: 'loc-2', title: 'Zweiter', place_id: null }]} vorausgewaehlt="loc-2" />);
    expect(screen.getByTestId('sms-betrieb')).toBeInTheDocument();
    await screen.findByTestId('sms-kein-link');
    expect(screen.getByTestId('sms-kein-link')).toHaveTextContent('noch kein Bewertungslink verfügbar');
    expect(screen.getByTestId('sms-senden')).toBeDisabled();
  });
  it('Copy: keine Autopilot-/Lese-Behauptung, kein Billing-Versprechen', () => {
    const src = ohneKommentare(lies('components/dashboard/SmsBewertungsanfrage.js'));
    expect(src).not.toMatch(/automatisch|Autopilot|gelesen|garantiert|DSGVO-konform/i);
    expect(src).toMatch(/SMS wurde gesendet\./);
  });
});

describe('T37/T38 — Product Truth PricingCard', () => {
  it('kein „Bewertungs-Autopilot", kein „Monatliches PDF-Reporting"', () => {
    const src = ohneKommentare(lies('components/PricingCard.js'));
    expect(src).not.toMatch(/Bewertungs-Autopilot/);
    expect(src).not.toMatch(/Monatliches PDF-Reporting|PDF-Report/);
    expect(src).not.toMatch(/SMS-Bewertungsanfrage/);   // kein Ersatzclaim automatisch
  });
  it('Mehr-Bewertungen-Seite verspricht keine automatischen Anfragen', () => {
    const src = ohneKommentare(lies('pages/dashboard/DashboardKundenGewinnung.js'));
    expect(src).not.toMatch(/Automatische Bewertungsanfragen|Autopilot/);
    expect(src).toMatch(/bewertungsLink\(placeId\)/);   // ein Generator
    expect(src).not.toMatch(/writereview\?placeid=\$\{/);
  });
});
