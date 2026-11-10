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
} from './utils/smsBewertung';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const GB = lies('../supabase/functions/google-business/index.ts');
const ROUTE = GB.slice(GB.indexOf('const BREVO_SMS_ENDPOINT'), GB.indexOf('const REVIEW_REQUEST_ROUTES'));
const SEND = ROUTE.slice(ROUTE.indexOf('async function handleReviewRequestSms('), ROUTE.indexOf('async function handleReviewRequestPreview'));
const HOOK = ROUTE.slice(ROUTE.indexOf('async function handleReviewRequestSmsWebhook'));
const MIG = lies('../supabase/migrations/20261112120000_sms_bewertungsanfrage.sql');
const PLACE = 'ChIJAbCdEfGhIjKlMnOpQrStUv';

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
  const t = baueBewertungsSms({ vorname: 'Thomas', betrieb: 'Elektro Müller', placeId: PLACE });
  it('T12/T13/T14 — Vorname, Betrieb, kanonischer Link', () => {
    expect(t).toMatch(/^Hallo Thomas, /);
    expect(t).toContain('bei Elektro Müller.');   // T13: Absender ist WERKRUF — der Kunde muss seinen Betrieb lesen
    expect(t).toContain(bewertungsLink(PLACE));
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
    /* Der Server prueft die gebaute Nachricht gegen dieselbe Liste */
    expect(SEND).toMatch(/if \(!text \|\| !textErlaubt\(text\)\) throw new GbpError\('internal_error', 'Vorlage ungueltig'\);/);
  });
  it('Vorname wird bereinigt; Vorlage ohne Link oder Name → null', () => {
    expect(bereinigeVorname('  thomas  ')).toBe('thomas');
    expect(bereinigeVorname('Anna-Lena')).toBe('Anna-Lena');
    expect(bereinigeVorname('<script>')).toBeNull();
    expect(bereinigeVorname('x'.repeat(41))).toBeNull();
    expect(baueBewertungsSms({ vorname: 'Thomas', betrieb: 'B', placeId: 'nope' })).toBeNull();
    expect(baueBewertungsSms({ vorname: '', betrieb: 'B', placeId: PLACE })).toBeNull();
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
    expect(s.segmente).toBeGreaterThanOrEqual(1);
    expect(s.segmente).toBeLessThanOrEqual(2);
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
    expect(SEND).toMatch(/baueBewertungsSms\(\{ vorname, betrieb, placeId: location\.place_id \}\)/);
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
    const logs = ohneKommentare(HOOK).match(/console\.(log|error|warn)\([^;]*\)/g) || [];
    for (const l of logs) expect(l).not.toMatch(/payload|roh|\bto\b/);
    expect(MIG).toMatch(/if p_event = 'delivered' and v_status in \('queued', 'sent'\) then/);
    expect(MIG).toMatch(/return jsonb_build_object\('known', false, 'changed', false\)/);
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
        return { ok: true, json: async () => ({ ok: true, text: baueBewertungsSms({ vorname: body.vorname, betrieb: 'Elektro Müller', placeId: PLACE }), segments: 1 }) };
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
    expect(screen.getByTestId('sms-vorschau')).toHaveTextContent(bewertungsLink(PLACE));
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
