/**
 * Zwei Umsetzungen, eine Regel (Paket H1, P0 #4).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESE DATEI GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Zugriffsregel steht in src/utils/subscription.js. ProGate und
 * requirePaidAccess benutzen sie — beide laufen in einer
 * JavaScript-Laufzeit.
 *
 * Der Mailversand nicht. schedule_communications() laeuft in pg_cron,
 * also in Postgres, und kann JavaScript nicht aufrufen. Deshalb gibt
 * es seit dem 13.10.2026 public.has_paid_access() als SQL-Fassung
 * derselben Regel.
 *
 * Das ist eine Last, und sie waere es nicht wert, wenn nur jemand
 * behauptete, die beiden seien gleich. Diese Datei prueft es:
 *
 *   1  Sie liest die Fallmatrix aus der SQL-Abnahme
 *      (supabase/tests/operativeMails.test.sql) und rechnet JEDEN
 *      Fall mit der JS-Regel nach. Weichen sie ab, faellt der Test —
 *      egal, welche Seite geaendert wurde.
 *
 *   2  Sie haelt die Eigenschaften fest, die beim Umbauen verloren
 *      gehen: die Reihenfolge der Zweige und die Statusliste.
 *
 * Die WIRKUNG der SQL-Seite steht in der SQL-Abnahme; die der
 * JS-Seite in entitlement.test.js. Hier geht es nur darum, dass die
 * beiden dasselbe sagen.
 */
import fs from 'fs';
import path from 'path';

import { hasPaidAccess, wantsOperationalMail } from './subscription';

const wurzel = path.resolve(__dirname, '../..');
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

const SQL_TEST  = lies('supabase/tests/operativeMails.test.sql');
const MIGRATION = lies('supabase/migrations/20261013130000_operative_mails_plangate.sql');
const JS_REGEL  = lies('src/utils/subscription.js');

/* Die Matrix aus der SQL-Abnahme einlesen. Format der Zeilen:

     ('free',  'sub_1', 'active', true,  'Etikett free, Abo aber aktiv'),

   null bleibt null, der leere String bleibt leer — genau der
   Unterschied, an dem die beiden Fassungen auseinanderlaufen
   koennten. */
function matrixAusSql() {
  const muster = /\(\s*'([a-z_]+)'\s*,\s*(null|'[^']*')\s*,\s*(null|'[^']*')\s*,\s*(true|false)\s*,\s*'([^']*)'\s*\)/g;
  const wert = (s) => (s === 'null' ? null : s.slice(1, -1));

  return [...SQL_TEST.matchAll(muster)].map((m) => ({
    plan: m[1],
    subId: wert(m[2]),
    status: wert(m[3]),
    erwartet: m[4] === 'true',
    warum: m[5],
  }));
}

const MATRIX = matrixAusSql();

describe('Die Fallmatrix der SQL-Abnahme gilt auch in JavaScript', () => {

  it('findet die Matrix überhaupt', () => {
    /* Ohne diese Zusage wäre ein leerer Parser ein grüner Test —
       die Falle bei jeder Prüfung, die ihre Fälle aus einer Datei
       liest. */
    expect(MATRIX.length).toBeGreaterThanOrEqual(18);

    /* Und sie muss beide Antworten enthalten. Eine Matrix, in der
       alles true ist, prüft nichts. */
    expect(MATRIX.some((f) => f.erwartet)).toBe(true);
    expect(MATRIX.some((f) => !f.erwartet)).toBe(true);
  });

  test.each(MATRIX)(
    'plan=$plan sub=$subId status=$status → $erwartet ($warum)',
    ({ plan, subId, status, erwartet }) => {
      const profil = {
        plan,
        stripe_subscription_id: subId,
        stripe_subscription_status: status,
        trial_ends_at: null,
      };

      expect(hasPaidAccess(profil)).toBe(erwartet);
      /* Operative Mails folgen derselben Regel — das ist die
         Eigenschaft, auf der die SQL-Seite aufsetzt. */
      expect(wantsOperationalMail(profil)).toBe(erwartet);
    },
  );
});

describe('Die SQL-Fassung hat dieselbe Form wie die JS-Fassung', () => {

  it('prüft founding_partner vor dem Stripe-Zweig', () => {
    /* Der Fehler aus §23, in SQL genauso möglich: Ein Founding
       Partner mit alter Stripe-Historie verliert sonst den Zugang. */
    const founding = MIGRATION.indexOf("v_p.plan = 'founding_partner'");
    const stripe = MIGRATION.indexOf('stripe_subscription_id');

    expect(founding).toBeGreaterThan(-1);
    expect(stripe).toBeGreaterThan(-1);
    expect(founding).toBeLessThan(MIGRATION.indexOf('nullif(v_p.stripe_subscription_id'));
  });

  it('kennt genau dieselben bezahlten Stripe-Status', () => {
    const ausJs = [...JS_REGEL.matchAll(/PAID_STATUSES = new Set\(\[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    const ausSql = [...MIGRATION.matchAll(
      /stripe_subscription_status in \(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));

    expect(ausJs.length).toBeGreaterThan(0);
    expect(new Set(ausSql)).toEqual(new Set(ausJs));
  });

  it('behandelt leere Stripe-Felder wie JavaScript', () => {
    /* `'' || ''` ist in JavaScript falsch, in SQL ist '' NOT NULL.
       Ohne nullif nähme SQL den Stripe-Zweig und antwortete false,
       wo JavaScript true sagt. Der Fall steht in der Matrix oben —
       diese Zusage nennt den Grund. */
    expect(MIGRATION).toMatch(/nullif\(v_p\.stripe_subscription_id, ''\)/);
    expect(MIGRATION).toMatch(/nullif\(v_p\.stripe_subscription_status, ''\)/);
  });

  it('spiegelt den toten trial-Zweig, statt ihn stillschweigend zu streichen', () => {
    /* Solange er in JS steht, steht er hier. Ihn zu entfernen ist
       eine eigene Entscheidung — und dann an beiden Stellen. */
    expect(JS_REGEL).toMatch(/plan === 'trial'/);
    expect(MIGRATION).toMatch(/v_p\.plan = 'trial'/);
  });

  it('gibt ohne Profil keinen Zugang', () => {
    expect(MIGRATION).toMatch(/if not found then\s*\n\s*return false;/);
    expect(hasPaidAccess(null)).toBe(false);
  });

  it('entscheidet nicht über die Identität des Nutzers', () => {
    /* §18. Keine Liste von Konten, keine E-Mail-Adresse. */
    expect(MIGRATION).not.toMatch(/user_id\s*=\s*'[0-9a-f]{8}-/i);
    expect(MIGRATION).not.toMatch(/u\.email\s*=\s*'/);
  });
});

describe('Die Empfängerprüfung sitzt an einer Stelle', () => {

  it('steht in der Empfängerschleife von schedule_communications', () => {
    const anf = MIGRATION.indexOf('FUNCTION public.schedule_communications');
    expect(anf).toBeGreaterThan(-1);

    const funktion = MIGRATION.slice(anf);
    const schleife = funktion.indexOf('for v_decision in');
    const pruefung = funktion.indexOf('darf_operativ then');

    expect(pruefung).toBeGreaterThan(-1);
    /* Vor der Kanalschleife: Ein später hinzugefügter Kanal ist dann
       von sich aus gesperrt. Das ist die sichere Richtung — die alte
       Lage entstand genau umgekehrt. */
    expect(pruefung).toBeLessThan(schleife);
  });

  it('fragt die gemeinsame Funktion, statt den Plan selbst zu deuten', () => {
    expect(MIGRATION).toMatch(/public\.wants_operational_mail\(a\.user_id\)/);

    /* Kein zweites `plan = 'pro'` in der Schleife. Das wäre eine
       dritte Umsetzung derselben Regel. */
    const anf = MIGRATION.indexOf('FUNCTION public.schedule_communications');
    const kopf = MIGRATION.slice(anf, MIGRATION.indexOf('for v_decision in', anf));
    expect(kopf).not.toMatch(/plan = 'pro'/);
    expect(kopf).not.toMatch(/plan in \(/);
  });

  it('zählt die gesperrten Empfänger, statt sie zu verschweigen', () => {
    /* „0 verschickt" allein sagt nicht, ob nichts anlag oder alles
       gesperrt war. */
    expect(MIGRATION).toMatch(/v_gesperrt := v_gesperrt \+ 1/);
    expect(MIGRATION).toMatch(/'blocked', v_gesperrt/);
  });

  it('lässt plan_communications und wants_notification unberührt', () => {
    /* Zwei verschiedene Fragen: Hat der Kanal etwas zu sagen
       (plan_communications), will der Nutzer es hören
       (wants_notification), darf er es hören (hier). Diese Migration
       beantwortet nur die dritte. */
    expect(MIGRATION).not.toMatch(/FUNCTION public\.plan_communications/);
    expect(MIGRATION).not.toMatch(/FUNCTION public\.wants_notification/);
  });

  it('rührt schedule_lifecycle_emails nicht an', () => {
    /* Produktentscheidung vom 13.10.2026: connection_broken geht
       weiter an alle — das Ziel /dashboard/google ist für free
       erreichbar, und eine abgerissene Verbindung stoppt auch die
       freien Teile. Festgehalten auch in
       supabase/tests/operativeMails.test.sql, Abschnitt 5. */
    expect(MIGRATION).not.toMatch(/FUNCTION public\.schedule_lifecycle_emails/);
    expect(SQL_TEST).toMatch(/connection_broken/);
  });
});
