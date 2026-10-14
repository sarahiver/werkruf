/**
 * Zahlungsaufforderung bei invoice.payment_failed (H2.2 D).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * H2.1 hat gemessen: der payment_failed-Zweig im Stripe-Webhook
 * reihte die Mail ein, sobald ein Profil zur stripe_customer_id
 * gefunden wurde — ohne jede Planprüfung. Ein Founding Partner mit
 * einem Altabo aus seiner Zahlerzeit konnte damit eine
 * Zahlungsaufforderung für einen Zugang bekommen, der kostenlos ist.
 *
 * ═══════════════════════════════════════════════════════════════
 * ZWEI FRAGEN, ZWEI PRÜFARTEN
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. WER darf gemahnt werden? Das entscheidet darfZahlungsmahnung().
 *    Geprüft wird die Funktion selbst, mit echten Profilzeilen —
 *    inklusive der Stripe-Zustände, die in der Praxis vorkommen.
 *
 * 2. WO wird gegated? Das ist eine Frage der Reihenfolge im
 *    Webhook, und die Reihenfolge ist der Kern des Auftrags: "am
 *    Mail-Enqueue gaten, nicht das Event überspringen."
 *
 *    Dafür gibt es keinen Weg über eine Funktion — die Reihenfolge
 *    steht im Quelltext. Der zweite Teil liest ihn deshalb, aber mit
 *    geprüften Schnittgrenzen: jeder Index wird einzeln belegt, damit
 *    kein leerer Abschnitt als grün durchgeht. Genau dieser Fehler
 *    hat in H2.1 einen Test grün gelassen, der nichts gelesen hat
 *    (indexOf('default:') ohne Startpunkt).
 */
import fs from 'fs';
import path from 'path';

import { darfZahlungsmahnung, isFoundingPartner } from './utils/subscription';

const wurzel = process.cwd();
const WEBHOOK = fs.readFileSync(
  path.join(wurzel, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');

/* ═══════════════════════════════════════════════════════
   1 — WER DARF GEMAHNT WERDEN
   ═══════════════════════════════════════════════════════ */

describe('darfZahlungsmahnung', () => {
  it('mahnt einen zahlenden Pro-Kunden mit echtem Stripe-Zustand', () => {
    /* Der Normalfall, für den die Mail gebaut wurde: die Karte ist
       abgelehnt worden, der Zugang läuft noch (past_due behält
       Zugang), und der Kunde muss es erfahren. */
    const pro = {
      plan: 'pro',
      stripe_customer_id: 'cus_pro',
      stripe_subscription_id: 'sub_pro',
      stripe_subscription_status: 'past_due',
    };
    expect(darfZahlungsmahnung(pro)).toBe(true);
  });

  it('mahnt auch einen free-Nutzer mit Stripe-Historie', () => {
    /* Weniger offensichtlich, aber richtig: wer auf free steht und
       einen gescheiterten Einzug hat, hatte ein Abo. Die Mail ist
       hier die einzige Nachricht, die er zu dem Vorgang bekommt.

       Das ist ausdrücklich NICHT dieselbe Frage wie bei den
       operativen Mails: dort ist free gesperrt (H1 P0 #4), weil die
       Handlungsaufforderungen hinter ProGate zeigen. Eine
       Zahlungsaufforderung zeigt nirgendwohin, sie informiert. */
    const free = {
      plan: 'free',
      stripe_customer_id: 'cus_frei',
      stripe_subscription_id: 'sub_alt',
      stripe_subscription_status: 'past_due',
    };
    expect(darfZahlungsmahnung(free)).toBe(true);
  });

  it('mahnt einen Founding Partner nicht — auch nicht mit laufendem Altabo', () => {
    const founding = {
      plan: 'founding_partner',
      stripe_customer_id: 'cus_alt',
      stripe_subscription_id: 'sub_alt',
      stripe_subscription_status: 'past_due',
    };
    expect(darfZahlungsmahnung(founding)).toBe(false);
    /* Der Zugang bleibt davon unberührt — das ist der Punkt. */
    expect(isFoundingPartner(founding)).toBe(true);
  });

  it('mahnt einen Founding Partner ohne jede Stripe-Spur nicht', () => {
    expect(darfZahlungsmahnung({ plan: 'founding_partner' })).toBe(false);
  });

  it('hängt nur am Plan, nicht am Stripe-Status', () => {
    /* Gegenprobe gegen eine naheliegende Fehlimplementierung: ein
       Gate über den Stripe-Status ('canceled' → nicht mahnen) würde
       den zahlenden Kunden in past_due treffen und den Founding
       Partner in active durchlassen — also genau verkehrt. */
    for (const status of ['active', 'trialing', 'past_due', 'canceled', 'unpaid', null]) {
      expect(darfZahlungsmahnung({ plan: 'founding_partner', stripe_subscription_status: status }))
        .toBe(false);
      expect(darfZahlungsmahnung({ plan: 'pro', stripe_subscription_status: status }))
        .toBe(true);
    }
  });

  it('mahnt bei fehlendem Profil', () => {
    /* Kein Founding Partner nachweisbar heisst nicht "sicher kein
       Zahler". Der Webhook bricht in diesem Fall ohnehin vorher ab
       (kein profile.id), aber die Funktion darf nicht aus Unwissen
       schweigen — sonst entscheidet ein fehlendes Profil über eine
       Zahlungsinformation. */
    expect(darfZahlungsmahnung(null)).toBe(true);
    expect(darfZahlungsmahnung({})).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════
   2 — WO WIRD GEGATED
   ═══════════════════════════════════════════════════════ */

describe('die Stelle im Webhook', () => {
  /* Schnittgrenzen einmal bestimmen, jede einzeln belegen. */
  const anfang = WEBHOOK.indexOf("case 'invoice.payment_failed'");
  const ende   = WEBHOOK.indexOf('default:', anfang === -1 ? 0 : anfang);

  it('findet den Zweig überhaupt', () => {
    /* Ohne diese Zusage wären alle folgenden Prüfungen Aussagen über
       einen leeren String. */
    expect(anfang).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(anfang);
  });

  const zweig = () => WEBHOOK.slice(anfang, ende);

  it('liest den Plan mit, wenn es das Profil holt', () => {
    expect(zweig()).toMatch(/\.select\('id, company_name, plan'\)/);
  });

  it('schreibt die Stripe-Spalten weiterhin', () => {
    /* Der Kern des Auftrags: das Event wird vollständig verarbeitet.
       Würde hier der Status nicht mehr gesetzt, wäre die Datenbank
       nach einem Fehlversuch falsch — und zwar still. */
    expect(zweig()).toMatch(/updateProfile\(supabase, profile\.id, \{ stripe_subscription_status: 'past_due' \}\)/);
  });

  it('gated die Mail NACH dem Schreiben und VOR dem Einreihen', () => {
    const abschnitt = zweig();

    const beiUpdate = abschnitt.indexOf('updateProfile(supabase, profile.id');
    const beiGate   = abschnitt.indexOf('darfZahlungsmahnung(profile)');
    const beiMail   = abschnitt.indexOf('enqueue_email');

    /* Erst belegen, dass es alle drei gibt. Ein -1 würde sonst als
       "steht ganz vorne" durchgehen und die Reihenfolgeprüfung
       verfälschen. */
    expect(beiUpdate).toBeGreaterThan(-1);
    expect(beiGate).toBeGreaterThan(-1);
    expect(beiMail).toBeGreaterThan(-1);

    expect(beiUpdate).toBeLessThan(beiGate);
    expect(beiGate).toBeLessThan(beiMail);
  });

  it('überspringt das Event nicht', () => {
    /* Es darf kein Ausstieg vor dem Status-Update stehen, der am Plan
       hängt. Geprüft wird der Abschnitt zwischen Zweiganfang und
       updateProfile: dort darf das Gate nicht vorkommen. */
    const abschnitt = zweig();
    const beiUpdate = abschnitt.indexOf('updateProfile(supabase, profile.id');
    expect(beiUpdate).toBeGreaterThan(0);

    const davor = abschnitt.slice(0, beiUpdate);
    expect(davor).not.toMatch(/darfZahlungsmahnung|founding_partner/);
  });

  it('protokolliert das Nicht-Einreihen', () => {
    /* Eine Mail, die lautlos nicht rausgeht, ist von einer
       verschluckten Mail nicht zu unterscheiden. */
    const abschnitt = zweig();
    expect(abschnitt).toMatch(/mail_nicht_eingereiht/);
    expect(abschnitt).toMatch(/grund: 'founding_partner'/);
  });

  it('lässt den Dedupe-Key unangetastet', () => {
    /* Der Key hängt an der Event-ID. Wird dasselbe Event nach einem
       Planwechsel erneut geliefert, soll die Mail dann rausgehen —
       der Nutzer ist dann kein Founding Partner mehr. */
    expect(zweig()).toMatch(/p_dedupe_key: `payment_failed:\$\{event\.id\}`/);
  });

  it('benutzt die geteilte Regel statt eines eigenen Vergleichs', () => {
    /* H1-Befund: dieselbe Zugangsregel existierte viermal. Ein
       viertes `=== 'founding_partner'` im Webhook wäre derselbe
       Fehler in klein. */
    expect(WEBHOOK).toMatch(
      /import \{ darfZahlungsmahnung \} from '\.\.\/\.\.\/\.\.\/src\/utils\/subscription\.js'/);
    expect(zweig()).not.toMatch(/===\s*'founding_partner'/);
  });
});
