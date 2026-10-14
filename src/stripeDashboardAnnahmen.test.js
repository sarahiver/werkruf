/**
 * Die Annahmen, auf denen docs/operations/stripe-dashboard-mvp.md steht.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * H2.2 F ist ein Dokument, keine Änderung. Es sagt, welcher
 * Stripe-Zustand für den MVP gewollt ist — und begründet das jedes
 * Mal mit dem WERKRUF-Code:
 *
 *   „Leave past-due heisst Gratiszugang"      weil past_due → pro
 *   „Trial-Mail muss von Stripe kommen"       weil wir keine schicken
 *   „at_period_end passt zur Oberfläche"      weil die Anzeige dafür
 *                                              existiert
 *   „invoice.paid wird nicht verarbeitet"     weil der Webhook fünf
 *                                              Events kennt
 *
 * Ändert sich eine dieser Grundlagen, wird aus einer richtigen
 * Empfehlung eine falsche — und niemand merkt es, weil Dokumente
 * nicht rot werden. Dieser Test macht sie rot.
 *
 * Er prüft NICHT, wie Stripe eingestellt ist. Das kann kein Test im
 * Repo, und das Dokument behauptet es auch nicht.
 */
import fs from 'fs';
import path from 'path';

import { hasPaidAccess, isCancellationScheduled } from './utils/subscription';

const wurzel = process.cwd();
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

const WEBHOOK  = lies('supabase/functions/stripe-webhook/index.ts');
const SETTINGS = lies('src/pages/dashboard/DashboardSettings.js');
const DOKUMENT = lies('docs/operations/stripe-dashboard-mvp.md');

describe('Annahme 1 — past_due behält Zugang', () => {
  it('gibt einem past_due-Abo weiterhin Pro-Zugang', () => {
    /* Trägt die Empfehlung „nach dem letzten Versuch: Cancel".
       Wäre past_due kein Zugang, wäre „Leave past-due" harmlos und
       die Empfehlung überflüssig. */
    expect(hasPaidAccess({
      plan: 'pro',
      stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'past_due',
    })).toBe(true);
  });

  it('nimmt den Zugang bei unpaid, canceled und paused', () => {
    for (const status of ['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']) {
      expect(hasPaidAccess({
        plan: 'pro',
        stripe_subscription_id: 'sub_1',
        stripe_subscription_status: status,
      })).toBe(false);
    }
  });
});

describe('Annahme 2 — WERKRUF schickt keine Trial-Ende-Mail', () => {
  /* Die Funktion steht NICHT in einer Migration, sondern im
     Produktions-Baseline-Dump. Mein erster Entwurf las
     20260923120000_email_delivery_mvp.sql — dort kommt der Name
     zweimal vor, aber nur in revoke und grant. indexOf traf also die
     revoke-Zeile und schnitt einen Abschnitt hinter der Funktion aus;
     der Test wurde rot und hat damit meine falsche Annahme über das
     Repo korrigiert. */
  const BASELINE = lies('supabase/schema/production-baseline-2026-09-22.sql');

  it('sucht Trial-Empfänger über einen Planwert, den der Constraint ablehnt', () => {
    /* Der Kern der Begründung in Abschnitt 1.3 des Dokuments: die
       Funktion existiert, läuft und findet nie eine Zeile. */
    const anfang = BASELINE.indexOf('CREATE FUNCTION public.schedule_lifecycle_emails()');
    expect(anfang).toBeGreaterThan(-1);

    /* Bis zum Ende des Funktionsrumpfes, nicht bis zum Dateiende:
       sonst stünde hier eine Aussage über den ganzen Dump. */
    const ende = BASELINE.indexOf('$$;', anfang);
    expect(ende).toBeGreaterThan(anfang);

    const funktion = BASELINE.slice(anfang, ende);
    expect(funktion).toMatch(/plan = 'trial'/);
    expect(funktion).toMatch(/'trial_reminder'/);
    expect(funktion).toMatch(/'trial_ended'/);
  });

  it('erlaubt den Wert trial in der Spalte nicht', () => {
    /* Gegenstück zur Zeile darüber. Beides zusammen ist der Beweis;
       einzeln sagt keine der beiden Zeilen etwas.

       Zusätzlich in Produktion gemessen (H2.1 und H2.2 A):
       user_profiles_plan_check erlaubt genau diese vier Werte. */
    const constraint = lies('supabase/migrations/20261013090000_founding_partner_und_consent.sql');
    expect(constraint).toMatch(
      /check \(plan = any \(array\['free', 'starter', 'pro', 'founding_partner'\]\)\)/);
    expect(constraint).not.toMatch(/'trial'\]/);
  });
});

describe('Annahme 3 — die Oberfläche ist für at_period_end gebaut', () => {
  it('zeigt eine geplante Kündigung mit Enddatum an', () => {
    expect(SETTINGS).toMatch(/isCancellationScheduled/);
    expect(SETTINGS).toMatch(/Gekündigt — Zugang bis/);
    expect(SETTINGS).toMatch(/stripe_current_period_end/);
  });

  it('erkennt die geplante Kündigung an den Spalten, die at_period_end füllt', () => {
    expect(isCancellationScheduled({
      plan: 'pro',
      stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'active',
      stripe_cancel_at_period_end: true,
    })).toBe(true);

    /* Und nicht bei einem Founding Partner — der hat keine Periode. */
    expect(isCancellationScheduled({
      plan: 'founding_partner',
      stripe_cancel_at_period_end: true,
    })).toBe(false);
  });

  it('schreibt die beiden Spalten im Webhook', () => {
    expect(WEBHOOK).toMatch(/stripe_cancel_at_period_end: sub\.cancel_at_period_end/);
    expect(WEBHOOK).toMatch(/stripe_current_period_end/);
  });
});

describe('Annahme 4 — invoice.paid und Rückerstattungen werden nicht verarbeitet', () => {
  it('behandelt genau die fünf bekannten Events', () => {
    const faelle = WEBHOOK.match(/case '[a-z_.]+':/g) || [];
    const events = faelle
      .map((z) => z.replace(/case '|':/g, ''))
      .filter((z) => z.includes('.'));

    expect(events.sort()).toEqual([
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.deleted',
      'customer.subscription.updated',
      'invoice.payment_failed',
    ]);
  });

  it('kennt kein invoice.paid und keinen Refund-Pfad', () => {
    expect(WEBHOOK).not.toMatch(/case 'invoice\.paid'/);
    expect(WEBHOOK).not.toMatch(/case 'charge\.refunded'/);
    expect(WEBHOOK).not.toMatch(/case 'credit_note/);
  });
});

describe('das Dokument selbst', () => {
  it('behauptet keinen Zustand, sondern nennt ihn zu prüfen', () => {
    /* Der Auftrag war ausdrücklich: „ohne etwas als aktiv zu
       behaupten." Diese Prüfung ist grob — sie kann keinen Text
       bewerten —, aber sie hält den Satz fest, der das Dokument
       einordnet. Wird er gelöscht, ist die Einordnung weg. */
    expect(DOKUMENT).toMatch(/Es ist eine \*\*Prüfliste\*\*, keine Zustandsbeschreibung/);
    expect(DOKUMENT).toMatch(/Ich kann das Stripe-Konto von WERKRUF nicht lesen/);
  });

  it('trennt die drei Themen, die der Auftrag getrennt haben wollte', () => {
    expect(DOKUMENT).toMatch(/# 1\. Trial-Ende und anstehende Rechnung/);
    expect(DOKUMENT).toMatch(/# 2\. Smart Retries, Dunning-Dauer/);
    expect(DOKUMENT).toMatch(/# 3\. Kündigungsmodus im Customer Portal/);
  });

  it('nennt für jedes Thema Fundstelle, Sollzustand und Auswirkung', () => {
    /* Drei Abschnitte „Wo nachsehen", drei „Gewünschter
       MVP-Zustand". Fehlt einer, ist das Dokument unvollständig und
       nicht nur unschön. */
    expect((DOKUMENT.match(/## \d\.1 Wo nachsehen/g) || [])).toHaveLength(3);
    expect((DOKUMENT.match(/## \d\.2 Gewünschter MVP-Zustand/g) || [])).toHaveLength(3);
  });
});
