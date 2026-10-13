/*
 * Entitlement-Matrix und Planwechsel (Paket H1, §49 und §50).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM EIGENE DATEI NEBEN subscription.test.js
 * ═══════════════════════════════════════════════════════════════
 *
 * subscription.test.js prueft die Stripe-Zweige — das ist die alte,
 * richtige Abdeckung und bleibt unveraendert. Diese Datei prueft,
 * was H1 hinzufuegt: founding_partner, die Reihenfolge der Zweige
 * und die Planwechsel.
 *
 * Die Trennung ist Absicht. Wer den Stripe-Teil anfasst, soll nicht
 * in einer Datei landen, in der auch die Founding-Partner-Regeln
 * stehen, und umgekehrt.
 *
 * ═══════════════════════════════════════════════════════════════
 * DER FEHLER, DEN DIESE DATEI GEFUNDEN HAT
 * ═══════════════════════════════════════════════════════════════
 *
 * hasPaidAccess hatte bis H1 diese Reihenfolge:
 *
 *   1. if (stripe_subscription_id || stripe_subscription_status) …
 *   2. if (plan === 'trial') …
 *   3. return plan === 'pro';
 *
 * Ein Founding Partner, der FRUEHER einmal gezahlt hat, traegt
 * weiter stripe_subscription_id. Zweig 1 haette gegriffen,
 * PAID_STATUSES.has('canceled') ausgewertet — false — und ihm den
 * Zugang verweigert, obwohl plan = 'founding_partner' ist.
 *
 * Das ist der Fall aus §23 des Auftrags und kein Randfall: die
 * ersten Founding Partner werden bestehende Nutzer sein. Der Test
 * "behaelt den Zugang mit alter, gekuendigter Subscription" unten
 * ist deshalb der wichtigste in dieser Datei.
 */

import {
  hasPaidAccess,
  isFoundingPartner,
  isCancellationScheduled,
  wantsOperationalMail,
} from './subscription';

const JETZT = new Date('2026-10-13T12:00:00.000Z');

/* ═══════════════════════════════════════════════════════
   §49 — DIE MATRIX
   ═══════════════════════════════════════════════════════

   Eine Regel entscheidet alle vier Spalten der Matrix:

     ProGate        src/components/dashboard/ProGate.js  → hasPaidAccess
     Google Write   requirePaidAccess in beiden Functions → _shared/access.ts
                    → hasPaidAccess
     Weekly         wantsOperationalMail
     Alerts         wantsOperationalMail

   Deshalb wird hier die Regel geprueft und nicht viermal dasselbe
   ueber vier Aufrufer. Dass die Aufrufer sie wirklich benutzen,
   steht in entitlementGates.test.js (Quelltextpruefung) — ein
   Jest-Test kann es nicht nachweisen, ohne die Aufrufer zu mocken
   und damit genau das zu umgehen, was er pruefen soll. */

describe('§49 Entitlement-Matrix', () => {
  const faelle = [
    { plan: 'free',             erwartet: false, hinweis: 'Beobachter, noch nicht berechtigt' },
    { plan: 'starter',          erwartet: false, hinweis: 'toter Wert, faellt auf kein Zugang' },
    { plan: 'pro',              erwartet: true,  hinweis: 'zahlender Kunde' },
    { plan: 'founding_partner', erwartet: true,  hinweis: 'kostenlos, funktional wie pro' },
  ];

  test.each(faelle)('$plan → Zugang $erwartet ($hinweis)', ({ plan, erwartet }) => {
    const profil = { plan };
    expect(hasPaidAccess(profil, JETZT)).toBe(erwartet);
    /* Weekly und Alerts folgen derselben Regel (§26). */
    expect(wantsOperationalMail(profil, JETZT)).toBe(erwartet);
  });

  /* 'starter' ausdruecklich eingeordnet, wie §49 verlangt: der Wert
     ist im CHECK-Constraint erlaubt, wird aber von keinem Code
     gesetzt und von keiner Access-Logik behandelt. Er faellt damit
     auf "kein Zugang", und das ist die sichere Richtung. */
  it('ordnet starter als kein Zugang ein, nicht als Pro', () => {
    expect(hasPaidAccess({ plan: 'starter' }, JETZT)).toBe(false);
  });

  it('unterscheidet founding_partner von pro, ohne den Zugang zu unterscheiden', () => {
    const founding = { plan: 'founding_partner' };
    const pro = { plan: 'pro' };

    expect(hasPaidAccess(founding, JETZT)).toBe(hasPaidAccess(pro, JETZT));
    expect(isFoundingPartner(founding)).toBe(true);
    expect(isFoundingPartner(pro)).toBe(false);
  });

  it('gibt ohne Profil keinen Zugang', () => {
    expect(hasPaidAccess(null, JETZT)).toBe(false);
    expect(hasPaidAccess(undefined, JETZT)).toBe(false);
    expect(wantsOperationalMail(null, JETZT)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
   §50 — PLANWECHSEL
   ═══════════════════════════════════════════════════════ */

describe('§50 Planwechsel', () => {

  it('free → founding_partner gibt Zugang', () => {
    expect(hasPaidAccess({ plan: 'free' }, JETZT)).toBe(false);
    expect(hasPaidAccess({ plan: 'founding_partner' }, JETZT)).toBe(true);
  });

  it('founding_partner → free nimmt ihn wieder', () => {
    expect(hasPaidAccess({ plan: 'founding_partner' }, JETZT)).toBe(true);
    expect(hasPaidAccess({ plan: 'free' }, JETZT)).toBe(false);
  });

  it('pro → free/canceled nimmt den Zugang', () => {
    expect(hasPaidAccess({
      plan: 'pro', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active',
    }, JETZT)).toBe(true);
    expect(hasPaidAccess({
      plan: 'free', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled',
    }, JETZT)).toBe(false);
  });

  it('gibt Founding Partner ohne jede Stripe-Spur Zugang', () => {
    expect(hasPaidAccess({
      plan: 'founding_partner',
      stripe_subscription_id: null,
      stripe_subscription_status: null,
      trial_ends_at: null,
    }, JETZT)).toBe(true);
  });

  /* ── Der wichtigste Test dieser Datei ──

     Gegen die alte Reihenfolge der Zweige war er rot. Ein bestehender
     Nutzer, der von pro auf founding_partner wechselt, behaelt seine
     Stripe-Historie — absichtlich, damit die Buchhaltung sie findet
     (siehe 20261013090000_founding_partner_und_consent.sql,
     Abschnitt 4). Der Zugang darf daran nicht haengen. */
  it.each([
    'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'past_due', 'active',
  ])('behaelt den Zugang als Founding Partner mit Stripe-Status %s', (status) => {
    expect(hasPaidAccess({
      plan: 'founding_partner',
      stripe_subscription_id: 'sub_alt',
      stripe_subscription_status: status,
      stripe_cancel_at_period_end: true,
      trial_ends_at: '2020-01-01T00:00:00Z',
    }, JETZT)).toBe(true);
  });

  it('meldet fuer einen Founding Partner keine anstehende Kuendigung', () => {
    /* Haette er noch ein cancel_at_period_end aus seiner Zeit als
       Zahler, wuerde das Dashboard sonst "laeuft aus am …" anzeigen —
       fuer einen Zugang, der nicht auslaeuft. */
    expect(isCancellationScheduled({
      plan: 'founding_partner',
      stripe_subscription_id: 'sub_alt',
      stripe_subscription_status: 'active',
      stripe_cancel_at_period_end: true,
    })).toBe(false);

    /* Fuer einen echten Zahler weiter wie bisher. */
    expect(isCancellationScheduled({
      plan: 'pro',
      stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'active',
      stripe_cancel_at_period_end: true,
    })).toBe(true);
  });

  /* ── Alter Action Link nach Access-Verlust (§50, letzter Punkt) ──

     Was ein Action Link kann, nachdem der Zugang weg ist, entscheidet
     NICHT diese Regel, sondern wo sie aufgerufen wird. Der Link
     erzeugt eine angemeldete Sitzung (google-business/index.ts:6495);
     die Pro-Aktion dahinter laeuft in requirePaidAccess.

     Hier wird deshalb nur das geprueft, was hier pruefbar ist: dass
     ein Profil nach dem Verlust des Zugangs auch dann keinen hat,
     wenn es ueber einen alten Link hereinkommt — der Link aendert am
     Profil nichts. Die Gatestellen selbst prueft
     entitlementGates.test.js. */
  it('gibt einem abgelaufenen Zugang auch ueber einen alten Link nichts', () => {
    const nachVerlust = {
      plan: 'free',
      stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'canceled',
      trial_ends_at: '2026-01-01T00:00:00Z',
    };
    expect(hasPaidAccess(nachVerlust, JETZT)).toBe(false);
    expect(wantsOperationalMail(nachVerlust, JETZT)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
   DIE REIHENFOLGE DER ZWEIGE, EINZELN
   ═══════════════════════════════════════════════════════

   Die Tests oben wuerden auch bestehen, wenn jemand founding_partner
   in PAID_STATUSES aufnaehme oder einen vierten Zweig dahinter
   haengte. Dieser Abschnitt haelt fest, dass founding_partner VORNE
   steht — die Eigenschaft, an der der alte Code gescheitert waere. */

describe('Reihenfolge: founding_partner vor Stripe', () => {
  it('entscheidet founding_partner, ohne den Stripe-Status anzusehen', () => {
    /* Ein Status, der in keiner Liste steht. Wuerde der Stripe-Zweig
       zuerst greifen, waere das Ergebnis false. */
    expect(hasPaidAccess({
      plan: 'founding_partner',
      stripe_subscription_id: 'sub_x',
      stripe_subscription_status: 'etwas_unbekanntes',
    }, JETZT)).toBe(true);
  });

  it('laesst den Stripe-Zweig fuer alle anderen Plaene zuerst greifen', () => {
    /* plan sagt pro, Stripe sagt gekuendigt → Stripe gewinnt. Diese
       Eigenschaft war vorher richtig und bleibt es. */
    expect(hasPaidAccess({
      plan: 'pro',
      stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'canceled',
    }, JETZT)).toBe(false);
  });
});
