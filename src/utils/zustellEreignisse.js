/**
 * Brevo-Zustellereignisse normalisieren — WP6.
 *
 * Reines JavaScript ohne Importe: send-email (Deno) und Jest laden
 * dieselbe Datei.
 *
 * Brevo schickt fuer transaktionale Mails Webhook-Ereignisse mit
 * uneinheitlichen Namen (hardBounce / hard_bounce, opened /
 * unique_opened / proxy_open …). Hier wird daraus die kleine, feste
 * Menge, die communication_delivery_events kennt:
 *
 *   sent delivered opened clicked soft_bounce hard_bounce blocked
 *   spam error
 *
 * Alles andere (deferred, unsubscribed, unbekannt) wird ignoriert —
 * gemeldet, nicht gespeichert.
 *
 * Korrelation NUR ueber die Message-ID (email_queue.provider_id =
 * Brevo messageId aus der Versandantwort). Die Adresse im Ereignis
 * wird nicht gelesen: Zwei Mails an dieselbe Adresse sind zwei Mails.
 *
 * Datenschutz: Aus dem Ereignis werden genau drei Werte uebernommen —
 * Message-ID, Ereignisart, Zeitpunkt. Keine IP, kein User-Agent, kein
 * Link, kein Betreff, keine Adresse.
 */

export const EREIGNISSE = Object.freeze([
  'sent', 'delivered', 'opened', 'clicked',
  'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'error',
]);

const ABBILDUNG = Object.freeze({
  request:       'sent',
  sent:          'sent',
  delivered:     'delivered',
  opened:        'opened',
  unique_opened: 'opened',
  uniqueopened:  'opened',
  proxy_open:    'opened',
  click:         'clicked',
  clicked:       'clicked',
  soft_bounce:   'soft_bounce',
  softbounce:    'soft_bounce',
  hard_bounce:   'hard_bounce',
  hardbounce:    'hard_bounce',
  blocked:       'blocked',
  spam:          'spam',
  complaint:     'spam',
  invalid_email: 'error',
  invalid:       'error',
  error:         'error',
});

/** Brevo-Ereignisname → interner Name, oder null. */
export function ereignisArt(roh) {
  if (typeof roh !== 'string') return null;
  const key = roh.trim().toLowerCase().replace(/-/g, '_');
  return ABBILDUNG[key] ?? null;
}

/** Message-ID in der Form, in der sie in email_queue.provider_id steht. */
export function messageIdAus(ev) {
  const roh = ev?.['message-id'] ?? ev?.message_id ?? ev?.messageId ?? ev?.['message-Id'];
  if (typeof roh !== 'string') return null;
  const t = roh.trim();
  return t.length > 0 && t.length <= 512 ? t : null;
}

/** Zeitpunkt des Ereignisses: ts_event (Unix-Sekunden) vor date vor jetzt. */
export function zeitpunktAus(ev, jetzt = new Date()) {
  const ts = Number(ev?.ts_event ?? ev?.ts);
  if (Number.isFinite(ts) && ts > 1_000_000_000 && ts < 10_000_000_000) {
    return new Date(ts * 1000).toISOString();
  }
  if (typeof ev?.date === 'string') {
    /* Brevo: "2026-11-09 09:00:00" (ohne Zone, UTC) oder ISO. */
    const d = new Date(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ev.date.trim())
      ? ev.date.trim().replace(' ', 'T') + 'Z'
      : ev.date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return jetzt.toISOString();
}

/**
 * Ein rohes Ereignis → { messageId, event, eventAt } oder
 * { ignoriert: 'grund' }.
 */
export function normalisiereEreignis(ev, jetzt = new Date()) {
  if (!ev || typeof ev !== 'object') return { ignoriert: 'kein_objekt' };
  const messageId = messageIdAus(ev);
  if (!messageId) return { ignoriert: 'keine_message_id' };
  const event = ereignisArt(ev.event);
  if (!event) return { ignoriert: `unbekanntes_ereignis:${String(ev.event ?? '').slice(0, 40)}` };
  return { messageId, event, eventAt: zeitpunktAus(ev, jetzt) };
}

/**
 * Brevo schickt ein Objekt oder eine Liste. Hoechstens 200 je Aufruf —
 * mehr waere kein Webhook, sondern ein Import.
 */
export function normalisierePayload(body, jetzt = new Date()) {
  const liste = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  return liste.slice(0, 200).map((ev) => normalisiereEreignis(ev, jetzt));
}
