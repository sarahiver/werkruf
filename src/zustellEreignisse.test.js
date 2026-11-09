/**
 * WP6 — Brevo-Zustellereignisse: Normalisierung (real) und der
 * Webhook in send-email (Verdrahtung).
 *
 *   T27–T29 Ereignisarten
 *   T30     unbekannte Message-ID → an der Datenbank; hier: ohne ID ignoriert
 *   T31     Idempotenz liegt in der Datenbank (unique) — hier: Zeitpunkt stabil
 *   T32     Webhook ohne Secret abgewiesen
 *   T33     keine Zuordnung ueber die Adresse
 */
import fs from 'fs';
import path from 'path';
import {
  EREIGNISSE, ereignisArt, messageIdAus, zeitpunktAus, normalisiereEreignis, normalisierePayload,
} from './utils/zustellEreignisse';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const jetzt = new Date('2026-11-09T10:00:00Z');

describe('T27–T29 — Ereignisarten', () => {
  it('Brevo-Namen in beiden Schreibweisen → feste Menge', () => {
    expect(ereignisArt('delivered')).toBe('delivered');
    expect(ereignisArt('opened')).toBe('opened');
    expect(ereignisArt('unique_opened')).toBe('opened');
    expect(ereignisArt('proxy_open')).toBe('opened');
    expect(ereignisArt('click')).toBe('clicked');
    expect(ereignisArt('hardBounce')).toBe('hard_bounce');
    expect(ereignisArt('hard_bounce')).toBe('hard_bounce');
    expect(ereignisArt('softBounce')).toBe('soft_bounce');
    expect(ereignisArt('soft-bounce')).toBe('soft_bounce');
    expect(ereignisArt('blocked')).toBe('blocked');
    expect(ereignisArt('spam')).toBe('spam');
    expect(ereignisArt('invalid_email')).toBe('error');
    expect(ereignisArt('request')).toBe('sent');
  });
  it('deferred / unsubscribed / Unsinn werden ignoriert', () => {
    expect(ereignisArt('deferred')).toBeNull();
    expect(ereignisArt('unsubscribed')).toBeNull();
    expect(ereignisArt('')).toBeNull();
    expect(ereignisArt(42)).toBeNull();
  });
  it('jede Ausgabe ist eine erlaubte Art', () => {
    for (const roh of ['request', 'delivered', 'opened', 'click', 'hardBounce', 'softBounce', 'blocked', 'spam', 'error']) {
      expect(EREIGNISSE).toContain(ereignisArt(roh));
    }
  });
});

describe('Message-ID und Zeitpunkt', () => {
  it('message-id in Brevo-Schreibweise, exakt wie provider_id', () => {
    const id = '<202611090900.12345678@smtp-relay.mailin.fr>';
    expect(messageIdAus({ 'message-id': id })).toBe(id);
    expect(messageIdAus({ messageId: ` ${id} ` })).toBe(id);
    expect(messageIdAus({})).toBeNull();
    expect(messageIdAus({ 'message-id': 'x'.repeat(600) })).toBeNull();
  });
  it('T31 — ts_event ist der Zeitpunkt; derselbe ts_event ergibt denselben Wert (Grundlage der Unique-Idempotenz)', () => {
    const a = zeitpunktAus({ ts_event: 1794128400 }, jetzt);
    const b = zeitpunktAus({ ts_event: 1794128400, date: '2030-01-01 00:00:00' }, jetzt);
    expect(a).toBe(b);
    expect(a).toBe('2026-11-08T09:00:00.000Z');
  });
  it('date ohne Zone gilt als UTC; ohne alles: jetzt', () => {
    expect(zeitpunktAus({ date: '2026-11-09 09:00:00' }, jetzt)).toBe('2026-11-09T09:00:00.000Z');
    expect(zeitpunktAus({ date: '2026-11-09T09:00:00+01:00' }, jetzt)).toBe('2026-11-09T08:00:00.000Z');
    expect(zeitpunktAus({}, jetzt)).toBe(jetzt.toISOString());
    expect(zeitpunktAus({ ts_event: 'abc' }, jetzt)).toBe(jetzt.toISOString());
  });
});

describe('Normalisierung', () => {
  const ev = { event: 'unique_opened', email: 'kunde@example.test', 'message-id': '<a@b>', ts_event: 1794128400, ip: '1.2.3.4', 'user-agent': 'x' };

  it('T33 — nur Message-ID, Art, Zeitpunkt — keine Adresse, keine IP, kein User-Agent', () => {
    const n = normalisiereEreignis(ev, jetzt);
    expect(n).toEqual({ messageId: '<a@b>', event: 'opened', eventAt: '2026-11-08T09:00:00.000Z' });
    expect(JSON.stringify(n)).not.toMatch(/example\.test|1\.2\.3\.4|user-agent/);
  });
  it('T30 — ohne Message-ID oder mit unbekannter Art: ignoriert, nicht geraten', () => {
    expect(normalisiereEreignis({ event: 'opened', email: 'x@y' }, jetzt)).toEqual({ ignoriert: 'keine_message_id' });
    expect(normalisiereEreignis({ 'message-id': '<a@b>', event: 'deferred' }, jetzt).ignoriert).toMatch(/^unbekanntes_ereignis:deferred/);
    expect(normalisiereEreignis(null, jetzt)).toEqual({ ignoriert: 'kein_objekt' });
  });
  it('Objekt oder Liste, hoechstens 200', () => {
    expect(normalisierePayload(ev, jetzt)).toHaveLength(1);
    expect(normalisierePayload([ev, ev, { event: 'spam' }], jetzt)).toHaveLength(3);
    expect(normalisierePayload(Array(300).fill(ev), jetzt)).toHaveLength(200);
    expect(normalisierePayload('kaputt', jetzt)).toEqual([]);
  });
});

describe('Webhook in send-email', () => {
  const mail = lies('../supabase/functions/send-email/index.ts');
  const hook = mail.slice(mail.indexOf("case 'brevo-webhook'"), mail.indexOf("case 'enqueue'"));

  it('T32 — ohne Secret in der Umgebung 503, ohne passendes Secret 401, zeitkonstant verglichen', () => {
    expect(hook).toMatch(/Deno\.env\.get\('BREVO_WEBHOOK_SECRET'\)/);
    expect(hook).toMatch(/if \(!expected\)[\s\S]{0,200}503/);
    expect(hook).toMatch(/timingSafeEqual\(geliefert, expected\)/);
    expect(hook).toMatch(/401/);
    expect(hook).toMatch(/X-Werkruf-Webhook-Secret|searchParams\.get\('secret'\)/);
  });

  it('T27–T31 — jedes Ereignis geht durch normalisierePayload und record_delivery_event; sonst nichts', () => {
    expect(hook).toMatch(/normalisierePayload\(body\)/);
    expect(hook).toMatch(/rpc\('record_delivery_event', \{\s*p_message_id: e\.messageId, p_event: e\.event, p_event_at: e\.eventAt,\s*\}\)/);
    /* keine direkte Tabelle, keine Zuordnung ueber die Adresse */
    expect(hook).not.toMatch(/\.from\('email_queue'\)|\.from\('communication_delivery_events'\)/);
    expect(hook).not.toMatch(/to_email|\.email\b/);
    /* Duplikate und Unbekanntes werden gezaehlt, nicht geworfen */
    expect(hook).toMatch(/duplicate/);
    expect(hook).toMatch(/unknown_message/);
    expect(hook).toMatch(/return jsonResponse\(\{ ok: true, \.\.\.zaehler \}\)/);
  });

  it('keine Rohdaten im Log', () => {
    expect(hook).not.toMatch(/log\([^)]*\bbody\b/);
    expect(hook).not.toMatch(/log\([^)]*\bereignisse\b(?!\.length)/);
  });

  it('Message-ID der Versandantwort landet weiter in provider_id (die Korrelation)', () => {
    expect(mail).toMatch(/providerId: body\?\.messageId/);
    expect(mail).toMatch(/p_provider_id: result\.providerId \?\? null/);
  });
});
