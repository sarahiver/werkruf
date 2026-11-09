/**
 * WP10 — Empfehlungslink.
 *
 *   T2/T4/T5  Code-Form, Absicht merken, ungueltig → Startseite
 *   T11–T15   Conversion-Regel im Webhook (Quelltext)
 *   T16–T21   Rewards: Ledger-Anwendung, FP, Free pending, Idempotenz (Quelltext + SQL)
 *   T22       kein zweiter Trial
 *   T27–T31   Einstellungen
 *   T32–T36   Security (Quelltext; Wirkung in SQL)
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, act } from '@testing-library/react';
import {
  istCodeForm, merkeEmpfehlung, leseEmpfehlung, vergissEmpfehlung, empfehlungsUrl, empfehlungsZahlen, INTENT_TAGE,
} from './utils/empfehlung';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('T2/T4/T5 — Code und Absicht', () => {
  beforeEach(() => { vergissEmpfehlung(); });
  it('T2 — Code-Form: 10 alphanumerische Zeichen, keine UUID, keine Mail', () => {
    expect(istCodeForm('r8K3mP2qAb')).toBe(true);
    expect(istCodeForm('11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(istCodeForm('kai@bosse.test')).toBe(false);
    expect(istCodeForm('abc')).toBe(false);
    expect(istCodeForm(null)).toBe(false);
    expect(empfehlungsUrl('r8K3mP2qAb', 'https://werkruf.com')).toBe('https://werkruf.com/empfehlen/r8K3mP2qAb');
  });
  it('T4 — gueltige Form wird 30 Tage gemerkt; T8 — zweiter Code ueberschreibt nicht (first wins)', () => {
    const t0 = Date.UTC(2026, 10, 9);
    expect(merkeEmpfehlung('r8K3mP2qAb', t0)).toBe(true);
    expect(leseEmpfehlung(t0 + 5 * 86400000)).toBe('r8K3mP2qAb');
    expect(merkeEmpfehlung('ZZZZZZZZZZ', t0 + 1000)).toBe(false);
    expect(leseEmpfehlung(t0 + 1000)).toBe('r8K3mP2qAb');
    expect(leseEmpfehlung(t0 + (INTENT_TAGE + 1) * 86400000)).toBeNull();
  });
  it('T5 — ungueltige Form wird nicht gemerkt', () => {
    expect(merkeEmpfehlung('kaputt', Date.now())).toBe(false);
    expect(leseEmpfehlung()).toBeNull();
  });
  it('Zahlen: nur Echtes — Signup allein ist kein Gratis-Monat (T31)', () => {
    expect(empfehlungsZahlen({ invited: 3, converted: 1, rewards: [{ status: 'applied' }] })).toEqual({ eingeladen: 3, nutzenPro: 1, gratisMonate: 1, wartend: 0 });
    expect(empfehlungsZahlen({ invited: 2, converted: 0, rewards: [] })).toEqual({ eingeladen: 2, nutzenPro: 0, gratisMonate: 0, wartend: 0 });
    expect(empfehlungsZahlen({ invited: 1, converted: 1, rewards: [{ status: 'pending' }] })).toEqual({ eingeladen: 1, nutzenPro: 1, gratisMonate: 1, wartend: 1 });
    expect(empfehlungsZahlen({ rewards: [{ status: 'not_applicable' }, { status: 'invalid' }] }).gratisMonate).toBe(0);
    expect(empfehlungsZahlen(null).eingeladen).toBe(0);
  });
});

describe('Signup und Landing (Quelltext)', () => {
  it('T6 — Signup gibt den gemerkten Code als meta.referral_code mit und vergisst ihn danach', () => {
    const s = lies('pages/Signup.js');
    expect(s).toMatch(/const referralCode = leseEmpfehlung\(\);\s*if \(referralCode\) meta\.referral_code = referralCode;/);
    expect(s).toMatch(/if \(!signUpErr && referralCode\) vergissEmpfehlung\(\);/);
  });
  it('Route /empfehlen/:code rendert die Startseite mit Hinweis; Lookup nur ja/nein', () => {
    expect(lies('App.js')).toMatch(/<Route path="\/empfehlen\/:code" element=\{\s*<PublicLayout><EmpfehlungsHinweis \/><\/PublicLayout>/);
    const h = lies('components/EmpfehlungsHinweis.js');
    expect(h).toMatch(/google-business\/referral\/lookup\?code=\$\{encodeURIComponent\(code\)\}/);
    expect(h).not.toMatch(/\.rpc\(/);
    expect(h).toMatch(/<HomePage \/>/);
    expect(h).not.toMatch(/full_name|company_name|email/);
    expect(h).toMatch(/if \(!istCodeForm\(code\)\) return <Navigate to="\/" replace \/>;/);
  });
});

describe('T11–T22 — Conversion und Reward im Webhook (Quelltext)', () => {
  const w = lies('../supabase/functions/stripe-webhook/index.ts');
  const paidAnfang = w.indexOf("case 'invoice.paid'");
  const paid = w.slice(paidAnfang, w.indexOf("case '", paidAnfang + 1));
  it('T11/T12/T15 — nur invoice.paid mit amount_paid > 0 und Abo; checkout.session.completed zaehlt nicht', () => {
    expect(paid).toMatch(/if \(!istEchteConversion\(invoice\) \|\| !customerId \|\| !subId\) \{/);
    expect(paid).toMatch(/rpc\('referral_mark_converted'/);
    const checkout = w.slice(w.indexOf("case 'checkout.session.completed'"), w.indexOf("case 'customer.subscription.created'"));
    expect(checkout).not.toMatch(/referral/);
    /* Folgefix: der Betrag der Gutschrift = regulaerer Monatsbetrag der Subscription-Price, nicht amount_paid */
    expect(paid).toMatch(/p_amount_cents: betrag\.amountCents/);
    /* invoice.paid aendert nie den Plan — das tun nur die Subscription-Events */
    expect(paid).not.toMatch(/updateProfile|mapStatusToPlan/);
  });
  it('T16–T19 — Rewards werden aus dem Ledger angewendet: Customer Balance, Idempotency-Key = Reward-ID, FP nie, ohne Stripe-Kunde pending', () => {
    const fn = w.slice(w.indexOf('async function wendeRewardsAn'), w.indexOf('function mapStatusToPlan'));
    expect(fn).toMatch(/stripe\.customers\.createBalanceTransaction\(/);
    expect(fn).toMatch(/amount: -Math\.abs\(r\.amountCents\)/);
    expect(fn).toMatch(/idempotencyKey: `werkruf-referral-reward-\$\{r\.id\}`/);
    expect(fn).toMatch(/if \(!profil\?\.stripe_customer_id\) \{ zaehler\.skipped\+\+; continue; \}/);
    expect(fn).toMatch(/if \(profil\.plan === 'founding_partner'\) \{/);
    expect(fn).toMatch(/rpc\('referral_reward_set_status', \{\s*p_reward_id: r\.id, p_status: 'applied'/);
    expect(fn).not.toMatch(/trial_period_days|trial_end|coupons\.create|refunds\.create/);
  });
  it('T18 — Free-Werber: Nachholung bei customer.subscription.created, nicht bei updated', () => {
    const sub = w.slice(w.indexOf("case 'customer.subscription.created'"), w.indexOf("case 'customer.subscription.deleted'"));
    expect(sub).toMatch(/if \(event\.type === 'customer\.subscription\.created'\) \{/);
    expect(sub).toMatch(/rpc\('referral_rewards_pending_for', \{ p_user_id: userId \}\)/);
  });
  it('T22 — Trial-Schutz aus WP7 unveraendert', () => {
    const c = lies('../supabase/functions/create-checkout-session/index.ts');
    expect(c).toMatch(/entscheideTrial\(\{/);
    expect(c).not.toMatch(/referral/i);
    expect(lies('utils/checkoutRegeln.js')).toMatch(/if \(stripeHatteSubscriptions\) return \{ trialTage: 0/);
  });
  it('Audit: referral.converted und referral.reward_applied', () => {
    expect(w).toMatch(/action: 'referral\.converted'/);
    expect(w).toMatch(/action: 'referral\.reward_applied'/);
    expect(w).toMatch(/invoice\.paid\s+\(WP10/);
  });
});

/* ── Einstellungen ── */
let mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
const mockRpc = jest.fn();
jest.mock('./context/AuthContext', () => ({ useAuthContext: () => ({ profile: mockProfil }) }));
jest.mock('./supabaseClient', () => {
  const client = { rpc: (...a) => mockRpc(...a), auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-test' } } }) } };
  return { __esModule: true, default: client, supabase: client };
});
// eslint-disable-next-line import/first
import Weiterempfehlen from './components/dashboard/Weiterempfehlen';

describe('T27–T31 — Einstellungen', () => {
  let fetchAlt;
  beforeEach(() => { mockRpc.mockReset(); fetchAlt = global.fetch; });
  afterEach(() => { global.fetch = fetchAlt; });
  /* Code kommt vom Server (/referral/code mit JWT), Zahlen per Lese-RPC */
  const antworte = (code, summary) => {
    global.fetch = jest.fn(async (url, init) => {
      expect(url).toMatch(/\/functions\/v1\/google-business\/referral\/code$/);
      expect(init.headers.Authorization).toBe('Bearer jwt-test');
      return { ok: true, json: async () => ({ ...code, summary }) };
    });
    mockRpc.mockImplementation(async () => { throw new Error('kein Client-RPC erwartet'); });
  };

  it('T27/T28/T30 — berechtigter Pro-Nutzer sieht Link, Kopierknopf und echte Zahlen', async () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
    antworte({ code: 'r8K3mP2qAb', eligible: true }, { invited: 3, converted: 1, rewards: [{ status: 'applied', amountCents: 4900 }] });
    render(<Weiterempfehlen />);
    const feld = await screen.findByTestId('empfehlungslink');
    expect(feld.value).toMatch(/\/empfehlen\/r8K3mP2qAb$/);
    expect(screen.getByText('Link kopieren')).toBeInTheDocument();
    const z = screen.getByTestId('empfehlungszahlen');
    expect(z).toHaveTextContent('3 Kollegen eingeladen');
    expect(z).toHaveTextContent('1 davon nutzt Pro');
    expect(z).toHaveTextContent('1 Gratis-Monat verdient');
    expect(screen.queryByTestId('weiterempfehlen-fp')).toBeNull();
  });
  it('T29 — Founding Partner sieht den Hinweis, keinen eigenen Gratis-Monat-Zaehler', async () => {
    mockProfil = { plan: 'founding_partner' };
    antworte({ code: 'r8K3mP2qAb', eligible: true }, { invited: 1, converted: 1, rewards: [{ status: 'not_applicable' }] });
    render(<Weiterempfehlen />);
    await screen.findByTestId('empfehlungslink');
    expect(screen.getByTestId('weiterempfehlen-fp')).toHaveTextContent('ohnehin kostenlos');
    expect(screen.getByTestId('empfehlungszahlen')).not.toHaveTextContent('Gratis-Monat');
  });
  it('T31 — nur Signup: 0 Gratis-Monate; nicht berechtigt: Hinweis statt Link', async () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
    antworte({ code: 'r8K3mP2qAb', eligible: true }, { invited: 2, converted: 0, rewards: [] });
    const { unmount } = render(<Weiterempfehlen />);
    await screen.findByTestId('empfehlungslink');
    expect(screen.getByTestId('empfehlungszahlen')).toHaveTextContent('0 Gratis-Monate verdient');
    unmount();
    antworte({ code: null, eligible: false, reason: 'kein_standort' }, { invited: 0, converted: 0, rewards: [] });
    render(<Weiterempfehlen />);
    expect(await screen.findByTestId('weiterempfehlen-nicht')).toHaveTextContent('Google-Betrieb verbunden');
    expect(screen.queryByTestId('empfehlungslink')).toBeNull();
  });
  it('Kanon: kein Client-RPC — Code, Zahlen, Widerruf und Lookup ueber die Edge Function; Nutzer aus dem JWT', () => {
    const gb = lies('../supabase/functions/google-business/index.ts');
    const h = gb.slice(gb.indexOf('async function handleReferralCode'), gb.indexOf('const REFERRAL_ROUTES'));
    expect(h).toMatch(/const user = await requireUser\(request\);[\s\S]*rpc\('ensure_referral_code', \{ p_user_id: user\.id \}\)/);
    expect(h).toMatch(/rpc\('referral_summary_for', \{ p_user_id: user\.id \}\)/);
    expect(h).toMatch(/rpc\('revoke_referral_code', \{ p_user_id: user\.id \}\)/);
    expect(h).not.toMatch(/readJsonBody|requirePaidAccess/);
    /* Lookup: oeffentlich, Form vor DB, Antwort nur { valid } */
    const lookup = h.slice(h.indexOf('async function handleReferralLookup'));
    expect(lookup).toMatch(/if \(!REFERRAL_CODE_RE\.test\(code\)\) return jsonResponse\(request, \{ valid: false \}\);/);
    expect(lookup).toMatch(/jsonResponse\(request, \{ valid: !error && data === true \}\)/);
    expect(lookup).not.toMatch(/user_id|email|name/);
    expect(gb).toMatch(/routeName === 'referral' && sub \? REFERRAL_ROUTES\[sub\]/);
    /* Datenbank: alle WP10-Funktionen nur service_role */
    const mig = lies('../supabase/migrations/20261111090000_empfehlungslink.sql');
    for (const f of ['ensure_referral_code(uuid)', 'revoke_referral_code(uuid)', 'referral_code_gueltig(text)', 'referral_summary_for(uuid)']) {
      expect(mig).toContain(`grant execute on function public.${f} to service_role;`);
    }
    expect(mig).not.toMatch(/grant execute on function public\.(ensure_referral_code|revoke_referral_code|referral_code_gueltig|referral_summary_for)[^;]*to (anon|authenticated)/);
    expect(lies('components/dashboard/Weiterempfehlen.js')).not.toMatch(/\.rpc\(/);
  });
  it('Copy: kein „Geld verdienen"', () => {
    const src = lies('utils/empfehlung.js') + lies('components/dashboard/Weiterempfehlen.js');
    expect(src).not.toMatch(/Geld verdienen|Provision|Auszahlung/);
    expect(src).toMatch(/bekommt ihr beide einen Monat kostenlos/);
  });
});
