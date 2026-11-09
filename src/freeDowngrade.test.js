/**
 * WP7 — Free-Downgrade und Pro-Wiedereinstieg.
 *
 *   T1–T7   Access-Stufe (accessTier) ueber die Stripe-Zustaende
 *   T8/T9   Free-Umfang: sehen ja, Pro-Seiten nein
 *   T10     ProGate zeigt Upgrade, nicht Fehler — und fuer Ex-Kunden keinen Trial
 *   T15–T17 Kuendigung: Enddatum, Pro bis Periodenende, danach Free
 *   T18–T20 Trial nur beim ersten Abo
 *   T22/T23 Rueckkehrpfad: intern ja, extern nein
 *   T37–T40 Mail-Copy der Free-Meldung
 *   §34     Server-Gates unveraendert (Quelltext)
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import {
  hasPaidAccess, accessTier, hatteSchonAbo, isCancellationScheduled, ACCESS_TIER_LABEL,
} from './utils/subscription';
import {
  entscheideTrial, sichererRueckkehrpfad, baueCheckoutUrls, TRIAL_TAGE,
} from './utils/checkoutRegeln';
import { istFreiErreichbar, FREE_PFADE, proCtaText, FREE_HINWEIS } from './utils/freeUmfang';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const jetzt = new Date('2026-11-10T10:00:00Z');
const zukunft = '2026-12-12T00:00:00Z';
const vergangen = '2026-10-01T00:00:00Z';

/* ── Profile, wie der Webhook sie hinterlaesst ── */
const P = {
  fpCanceled:   { plan: 'founding_partner', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled' },
  fpOhneStripe: { plan: 'founding_partner' },
  trialing:     { plan: 'pro', stripe_subscription_id: 'sub_2', stripe_subscription_status: 'trialing', trial_ends_at: zukunft },
  active:       { plan: 'pro', stripe_subscription_id: 'sub_3', stripe_subscription_status: 'active' },
  gekuendigt:   { plan: 'pro', stripe_subscription_id: 'sub_4', stripe_subscription_status: 'active',
                  stripe_cancel_at_period_end: true, stripe_current_period_end: zukunft },
  canceled:     { plan: 'free', stripe_subscription_id: 'sub_5', stripe_subscription_status: 'canceled',
                  stripe_cancel_at_period_end: false, stripe_current_period_end: vergangen },
  trialAbgelaufen: { plan: 'free', stripe_subscription_id: 'sub_6', stripe_subscription_status: 'canceled', trial_ends_at: null },
  unpaid:       { plan: 'free', stripe_subscription_id: 'sub_7', stripe_subscription_status: 'unpaid' },
  incomplete:   { plan: 'free', stripe_subscription_id: 'sub_8', stripe_subscription_status: 'incomplete' },
  paused:       { plan: 'free', stripe_subscription_id: 'sub_9', stripe_subscription_status: 'paused' },
  pastDue:      { plan: 'pro', stripe_subscription_id: 'sub_10', stripe_subscription_status: 'past_due' },
  neu:          { plan: 'free' },
};

describe('T1–T7 — eine Access-Wahrheit, als Stufe', () => {
  it('T1 — Founding Partner mit canceled Stripe → founding_partner, voller Zugang', () => {
    expect(accessTier(P.fpCanceled, jetzt)).toBe('founding_partner');
    expect(hasPaidAccess(P.fpCanceled, jetzt)).toBe(true);
    expect(accessTier(P.fpOhneStripe, jetzt)).toBe('founding_partner');
    expect(isCancellationScheduled({ ...P.fpCanceled, stripe_cancel_at_period_end: true })).toBe(false);
  });
  it('T2/T3 — trialing und active → pro', () => {
    expect(accessTier(P.trialing, jetzt)).toBe('pro');
    expect(accessTier(P.active, jetzt)).toBe('pro');
  });
  it('T4/T16 — gekuendigt, Periodenende in der Zukunft → weiterhin pro', () => {
    expect(accessTier(P.gekuendigt, jetzt)).toBe('pro');
    expect(hasPaidAccess(P.gekuendigt, jetzt)).toBe(true);
    expect(isCancellationScheduled(P.gekuendigt)).toBe(true);
  });
  it('T5/T17 — nach Periodenende canceled → free, aber nicht ausgesperrt (Profil bleibt lesbar)', () => {
    expect(accessTier(P.canceled, jetzt)).toBe('free');
    expect(hasPaidAccess(P.canceled, jetzt)).toBe(false);
    expect(isCancellationScheduled(P.canceled)).toBe(false);
  });
  it('T6 — Trial abgelaufen ohne Zahlung → free', () => {
    expect(accessTier(P.trialAbgelaufen, jetzt)).toBe('free');
  });
  it('T7 — unpaid / incomplete / paused → free (kein Lockout-Zustand)', () => {
    for (const p of [P.unpaid, P.incomplete, P.paused, P.neu]) {
      expect(accessTier(p, jetzt)).toBe('free');
    }
    expect(ACCESS_TIER_LABEL.free).toBe('Free');
  });
  it('past_due bleibt bewusst pro (Dunning laeuft bei Stripe)', () => {
    expect(accessTier(P.pastDue, jetzt)).toBe('pro');
  });
  it('Invariante: hasPaidAccess ⇔ accessTier ≠ free — fuer jeden Fall', () => {
    for (const p of Object.values(P)) {
      expect(hasPaidAccess(p, jetzt)).toBe(accessTier(p, jetzt) !== 'free');
    }
    expect(accessTier(null)).toBe('free');
  });
});

describe('T8/T9 — Free-Umfang', () => {
  it('T8 — Uebersicht, Google-Profil, Einstellungen sind frei; Pro-Seiten nicht', () => {
    expect(istFreiErreichbar('/dashboard')).toBe(true);
    expect(istFreiErreichbar('/dashboard/google')).toBe(true);
    expect(istFreiErreichbar('/dashboard/einstellungen?x=1')).toBe(true);
    expect(istFreiErreichbar('/dashboard/bewertungen?status=offen')).toBe(false);
    expect(istFreiErreichbar('/dashboard/fotos')).toBe(false);
    expect(istFreiErreichbar('/dashboard/kunden-gewinnung')).toBe(false);
    expect(istFreiErreichbar(null)).toBe(false);
    expect(FREE_PFADE).not.toContain('/dashboard/bewertungen');
  });
  it('T9 — die Pro-Seiten stehen in App.js hinter ProGate', () => {
    const app = lies('App.js');
    expect(app).toMatch(/path="bewertungen" element=\{\s*<ProGate feature="Bewertungen">/);
    for (const datei of ['pages/dashboard/DashboardFotos.js', 'pages/dashboard/DashboardKundenGewinnung.js']) {
      expect(lies(datei)).toMatch(/<ProGate feature=/);
    }
    /* und die Uebersicht zeigt Free den Hinweis statt der Aufgaben */
    const home = lies('pages/dashboard/DashboardHome.js');
    expect(home).toMatch(/\{!istPro && !ohneBetrieb && !standortAuswahlNoetig && \(\s*<FreeHinweis/);
    expect(home).toMatch(/events=\{istPro \? actions : \[\]\}/);
    expect(home).toMatch(/istPro \|\| istFreiErreichbar\(nextAction\.actionUrl\)/);
  });
});

/* Jest erlaubt in der Mock-Factory nur Variablen mit „mock"-Praefix. */
let mockGateProfil = null;
jest.mock('./context/AuthContext', () => ({ useAuthContext: () => ({ profile: mockGateProfil, profileLoading: false, profileError: null, refreshProfile: jest.fn() }) }));
jest.mock('./context/IndustryContext', () => ({ useIndustry: () => ({ pricing: { monthlyPrice: 49, trialDays: 30 } }) }));
jest.mock('./hooks/useCheckout', () => ({ useCheckout: () => ({ startCheckout: jest.fn(), loading: false, error: null }) }));
// eslint-disable-next-line import/first
import ProGate from './components/dashboard/ProGate';

describe('T10 — ProGate: Upgrade statt Fehler, ehrlich zum Trial', () => {
  const gateMit = (profile) => {
    mockGateProfil = profile;
    return render(<ProGate feature="Bewertungen"><div>GEHEIM</div></ProGate>);
  };

  it('Ex-Kunde: „Pro wieder aktivieren", kein 30-Tage-Versprechen, Inhalt verborgen', () => {
    gateMit(P.canceled);
    expect(screen.queryByText('GEHEIM')).toBeNull();
    expect(screen.getByText('Pro wieder aktivieren')).toBeInTheDocument();
    expect(screen.queryByText(/30 Tage/)).toBeNull();
    expect(screen.getAllByText(/49 € \/ Monat/).length).toBeGreaterThan(0);   // WP13: auch in der Tarifwahl
    expect(screen.getByText(/WERKRUF Free/)).toBeInTheDocument();
  });
  it('Neukunde: 30 Tage gratis, danach 49 €', () => {
    gateMit(P.neu);
    expect(screen.getByText(/30 Tage gratis testen/)).toBeInTheDocument();
    expect(screen.getByText(/Danach 49 € \/ Monat/)).toBeInTheDocument();
  });
  it('Pro und Founding Partner sehen den Inhalt', () => {
    const a = gateMit(P.gekuendigt); expect(screen.getByText('GEHEIM')).toBeInTheDocument(); a.unmount();
    gateMit(P.fpCanceled); expect(screen.getByText('GEHEIM')).toBeInTheDocument();
  });
  it('T40 — keine alten Claims im Gate', () => {
    /* Kommentare raus — dort steht die Geschichte der gestrichenen Claims. */
    const src = lies('components/dashboard/ProGate.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/PDF|Wettbewerber|Umsatz|automatische Kunden|Kunden garantiert/i);
  });
  it('T22 — Gate uebergibt den aktuellen Pfad als returnPath', () => {
    expect(lies('components/dashboard/ProGate.js')).toMatch(/returnPath:\s+`\$\{window\.location\.pathname\}\$\{window\.location\.search\}`/);
  });
});

describe('T15 — Einstellungen zeigen das Pro-Ende aus der echten Subscription', () => {
  it('Text und Datum stehen in der Datei, kein hartes Datum', () => {
    const s = lies('pages/dashboard/DashboardSettings.js');
    expect(s).toMatch(/Pro endet am \{periodEnd \|\| 'Ende des Abrechnungszeitraums'\}/);
    expect(s).toMatch(/Danach nutzt du WERKRUF kostenlos im Free-Modus weiter/);
    expect(s).toMatch(/stripe_current_period_end/);
    expect(s).not.toMatch(/Dezember 2026/);
    /* Free mit Stripe-Kunde bekommt einen Weg zurueck, nicht nur das Portal */
    expect(s).toMatch(/\) : bezahlt && hasStripeCustomer \? \(/);
    expect(s).toMatch(/proCtaText\(hatteAbo\)/);
  });
});

describe('T18–T20 — Trial nur beim ersten Abo', () => {
  it('T18 — ehemaliger Pro (Stripe-Historie) → 0 Tage', () => {
    expect(entscheideTrial({ stripeHatteSubscriptions: true, profilHatteAbo: true })).toEqual({ trialTage: 0, grund: 'stripe_historie' });
  });
  it('T19 — ehemaliger Trial, Stripe-Historie vorhanden → kein zweiter Trial; Profil allein reicht auch', () => {
    expect(entscheideTrial({ stripeHatteSubscriptions: true, profilHatteAbo: false }).trialTage).toBe(0);
    expect(entscheideTrial({ stripeHatteSubscriptions: false, profilHatteAbo: true })).toEqual({ trialTage: 0, grund: 'profil_historie' });
    expect(hatteSchonAbo(P.trialAbgelaufen)).toBe(true);
    expect(hatteSchonAbo(P.canceled)).toBe(true);
  });
  it('T20 — erstmaliger Kunde → 30 Tage', () => {
    expect(entscheideTrial({ stripeHatteSubscriptions: false, profilHatteAbo: false })).toEqual({ trialTage: TRIAL_TAGE, grund: 'erster_start' });
    expect(TRIAL_TAGE).toBe(30);
    expect(hatteSchonAbo(P.neu)).toBe(false);
    expect(hatteSchonAbo(null)).toBe(false);
  });
  it('C6-Schutz im Quelltext: die Function fragt Stripe (status all) und setzt trial_period_days nur bei > 0', () => {
    const fn = lies('../supabase/functions/create-checkout-session/index.ts');
    expect(fn).toMatch(/status: 'all'/);
    expect(fn).toMatch(/\.\.\.\(trial\.trialTage > 0 \? \{ trial_period_days: trial\.trialTage \} : \{\}\)/);
    expect(fn).not.toMatch(/trial_period_days: 30/);
    expect(fn).not.toMatch(/const TRIAL_DAYS/);
  });
  it('CTA-Text folgt derselben Regel', () => {
    expect(proCtaText(true)).toBe('Pro wieder aktivieren');
    expect(proCtaText(false)).toBe('WERKRUF Pro starten');
    expect(FREE_HINWEIS.titel).toBe('Du nutzt WERKRUF Free.');
  });
});

describe('T22/T23 — Rueckkehrpfad', () => {
  it('T22 — interner Dashboard-Pfad mit Query bleibt erhalten', () => {
    const p = '/dashboard/bewertungen?betrieb=abc&status=offen&review=xyz';
    expect(sichererRueckkehrpfad(p)).toBe(p);
    expect(sichererRueckkehrpfad('/dashboard')).toBe('/dashboard');
    expect(sichererRueckkehrpfad('/dashboard/fotos')).toBe('/dashboard/fotos');
  });
  it('T23/C8 — alles Externe oder Verdaechtige faellt auf /dashboard', () => {
    for (const p of [
      'https://evil.example/x', '//evil.example', '/dashboard//evil', 'dashboard/x', '/admin',
      '/dashboardx', '/dashboard/..\\x', '/dashboard/javascript:alert(1)', '/dashboard/?q=data:text',
      '/dashboard/a b', '/dashboard/<script>', '', null, 42, '/'+'x'.repeat(600),
    ]) {
      expect(sichererRueckkehrpfad(p)).toBe('/dashboard');
    }
  });
  it('Checkout-URLs: Erfolg immer ueber /dashboard?checkout=success, Rueckkehr als Parameter', () => {
    const u = baueCheckoutUrls('https://werkruf.com', '/dashboard/bewertungen?review=1');
    expect(u.successUrl).toBe('https://werkruf.com/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}&zurueck=%2Fdashboard%2Fbewertungen%3Freview%3D1');
    expect(u.cancelUrl).toBe('https://werkruf.com/dashboard/bewertungen?review=1?checkout=cancelled'.replace('?review=1?', '?review=1?'));
    const boese = baueCheckoutUrls('https://werkruf.com', 'https://evil.example');
    expect(boese.successUrl).not.toMatch(/zurueck/);
    expect(boese.cancelUrl).toBe('https://werkruf.com/dashboard?checkout=cancelled');
  });
  it('Layout leitet erst nach Freischaltung weiter und prueft den Pfad erneut', () => {
    const l = lies('pages/dashboard/DashboardLayout.js');
    expect(l).toMatch(/if \(checkoutResult === 'success' && hasPaidAccess\(profile\)\)/);
    expect(l).toMatch(/sichererRueckkehrpfad\(searchParams\.get\('zurueck'\)\)/);
    expect(l.indexOf("hasPaidAccess(profile))")).toBeLessThan(l.indexOf("navigate(zurueck, { replace: true })"));
  });
});

describe('T37–T40 — Free-Meldung', () => {
  const mail = lies('../supabase/functions/send-email/index.ts');
  const block = mail.slice(mail.indexOf("case 'critical_review_free'"), mail.indexOf("case 'payment_failed'"));

  it('T37 — nennt Free; T38 — 49 € im Monat; T39 — kein Trial-Claim; T40 — keine alten Claims', () => {
    expect(block).toMatch(/Free/);
    expect(block).toMatch(/49 € im Monat/);
    expect(block).not.toMatch(/30 Tage|kostenlos testen|gratis/i);
    expect(block).not.toMatch(/PDF|Wettbewerber|Umsatz|kostet dich Kunden|sofort!/i);
  });
  it('Free-CTA fuehrt nicht in den Editor, sondern „ansehen & mit Pro antworten"; derselbe Token-Weg', () => {
    expect(block).toMatch(/label: 'Bewertung ansehen & mit Pro antworten'/);
    expect(block).not.toMatch(/Antwortvorschlag liegt im Dashboard bereit/);
    expect(mail).toMatch(/row\.template === 'critical_review_alert' \|\| row\.template === 'critical_review_free'\s*\?\s*await ergaenzeSofortmailLink/);
  });
  it('T24 — die Pro-Meldung ist unveraendert', () => {
    const pro = mail.slice(mail.indexOf("case 'critical_review_alert'"), mail.indexOf("case 'critical_review_free'"));
    expect(pro).toMatch(/label: count === 1 \? 'Jetzt antworten' : 'Antworten ansehen'/);
    expect(pro).toMatch(/Der Antwortvorschlag liegt im Dashboard bereit/);
  });
});

describe('§34 — Server-Gates bleiben; der Mail-Link ist kein Access Grant', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  it('alle Schreibwege rufen requirePaidAccess', () => {
    for (const h of ['handleLocationUpdate', 'handleMediaCreate', 'handleMediaDelete', 'handleReplyUpdate', 'handleReplyApprove', 'handleReplyRetract', 'handleAttributesUpdate']) {
      const start = gb.indexOf(`async function ${h}(`);
      expect(start).toBeGreaterThan(0);
      const body = gb.slice(start, gb.indexOf('\nasync function ', start + 10));
      expect(body).toMatch(/await requirePaidAccess\(/);
    }
    expect(lies('../supabase/functions/generate-review-reply/index.ts')).toMatch(/leseAccess\(adminClient\(\), userId\)/);
  });
  it('T31 — /einstieg und Action-Link pruefen keinen Plan und gewaehren keinen: Ziel ist nur Navigation', () => {
    const einstieg = gb.slice(gb.indexOf('async function handleEinstieg('), gb.indexOf('\nasync function ', gb.indexOf('async function handleEinstieg(') + 10));
    expect(einstieg).toMatch(/zielErlaubt\(ziel\)/);
    expect(einstieg).not.toMatch(/update\(\{\s*plan/);
    expect(einstieg).not.toMatch(/stripe_subscription_status/);
  });
});
