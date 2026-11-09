/**
 * WP13 — Jahresabo + Betriebsferien-Pause.
 *
 *   T1–T11   Jahresabo: Tarif-Mapping, keine Price-ID vom Client, 400,
 *            Trial fuer beide, kein zweiter Trial, Webhook erkennt
 *            month/year, FP unveraendert
 *   T12–T15  Referral + yearly: Reward bleibt Monatsbetrag (49 €), nie 490 €
 *   T16–T30  Pause: Validierung, zeitbasiertes Ende, Komponenten,
 *            Routen nur Pro/FP, Dashboard-Hinweis
 *   Mail     weekly/inactivity ruhen, critical/connection_broken laufen —
 *            Wirkung in supabase/tests/jahresabo_betriebsferien.test.sql
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import {
  TARIFE, tarifAusEingabe, pricePasstZuTarif, billingIntervalAusSubscription, intervallText,
  JAHRES_ERSPARNIS_CENTS, JAHRES_ERSPARNIS_MONATE,
} from './utils/tarife';
import { monatsbetragAusSubscription } from './utils/referralBetrag';
import { entscheideTrial, TRIAL_TAGE } from './utils/checkoutRegeln';
import {
  pruefePause, istPausiert, istPauseGeplant, heuteBerlin, tageZwischen, PAUSE_MAX_TAGE, PAUSE_TEXTE, formatDatumDe,
} from './utils/betriebsferien';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CHECKOUT = lies('../supabase/functions/create-checkout-session/index.ts');
const WEBHOOK  = lies('../supabase/functions/stripe-webhook/index.ts');
const GB       = lies('../supabase/functions/google-business/index.ts');
const MIG      = lies('../supabase/migrations/20261112090000_jahresabo_betriebsferien.sql');

const price = (iv, amount) => ({ id: `price_${iv}`, type: 'recurring', unit_amount: amount, currency: 'eur', livemode: false, recurring: { interval: iv, interval_count: 1 } });
const sub = (iv, amount) => ({ id: 'sub_1', items: { data: [{ price: price(iv, amount), quantity: 1 }] } });

describe('T1–T4 — Tarif-Mapping im Checkout', () => {
  it('T1 — monthly → STRIPE_PRICE_MONTHLY, 4900 / month', () => {
    const t = tarifAusEingabe({ plan: 'monthly' });
    expect(t.env).toBe('STRIPE_PRICE_MONTHLY');
    expect(t.betragCents).toBe(4900); expect(t.interval).toBe('month');
  });
  it('T2 — yearly → STRIPE_PRICE_YEARLY, 49000 / year; Alias billingInterval', () => {
    const t = tarifAusEingabe({ billingInterval: 'yearly' });
    expect(t.env).toBe('STRIPE_PRICE_YEARLY');
    expect(t.betragCents).toBe(49000); expect(t.interval).toBe('year');
    expect(tarifAusEingabe({ plan: 'YEARLY ' }).key).toBe('yearly');
    /* Kommunikation: 12 × 49 − 490 = 98 € = 2 Monate — exakt, kein Prozent */
    expect(JAHRES_ERSPARNIS_CENTS).toBe(9800);
    expect(JAHRES_ERSPARNIS_MONATE).toBe(2);
    expect(lies('components/TarifWahl.js')).not.toMatch(/%/);
  });
  it('T3 — Client kann keine Price-ID setzen: Server liest nur ENV des Tarifs', () => {
    expect(tarifAusEingabe({ plan: 'price_123' })).toBeNull();
    expect(tarifAusEingabe({ priceId: 'price_123' })).toBeNull();
    expect(CHECKOUT).toMatch(/const priceId = Deno\.env\.get\(tarif\.env\);/);
    expect(CHECKOUT).not.toMatch(/payload\.priceId|payload\.price|line_items:\s*\[\{ price: payload/);
    expect(CHECKOUT).toMatch(/line_items:\s*\[\{ price: priceId, quantity: 1 \}\]/);
    /* Price wird gegen den Tarif geprueft — ein Jahrespreis unter STRIPE_PRICE_MONTHLY faellt durch */
    expect(pricePasstZuTarif(price('year', 49000), TARIFE.monthly, false)).toBe(false);
    expect(pricePasstZuTarif(price('month', 4900), TARIFE.monthly, false)).toBe(true);
    expect(pricePasstZuTarif(price('year', 49000), TARIFE.yearly, false)).toBe(true);
    expect(pricePasstZuTarif(price('year', 44900), TARIFE.yearly, false)).toBe(false);
    expect(pricePasstZuTarif({ ...price('year', 49000), livemode: true }, TARIFE.yearly, false)).toBe(false);
  });
  it('T4 — ungueltiges billingInterval → 400', () => {
    expect(tarifAusEingabe({ plan: 'quarterly' })).toBeNull();
    expect(tarifAusEingabe({ billingInterval: 'lifetime' })).toBeNull();
    expect(tarifAusEingabe({})).toBeNull();
    expect(CHECKOUT).toMatch(/if \(!tarif\) \{\s*return json\(\{ error: `Ungueltiger Plan[^`]*` \}, 400\);/);
  });
});

describe('T5–T8 — Trial fuer beide Intervalle, nie ein zweiter', () => {
  it('T5/T6 — neuer Nutzer: 30 Tage, egal ob monthly oder yearly (Trial haengt nicht am Tarif)', () => {
    const t = entscheideTrial({ stripeHatteSubscriptions: false, profilHatteAbo: false });
    expect(t.trialTage).toBe(TRIAL_TAGE);
    /* Checkout: entscheideTrial kennt den Tarif nicht — kein Pfad, auf dem yearly etwas anderes bekaeme */
    expect(CHECKOUT).toMatch(/const trial = entscheideTrial\(\{\s*stripeHatteSubscriptions,\s*profilHatteAbo: hatteSchonAbo\(profile\),\s*\}\);/);
    expect(CHECKOUT).not.toMatch(/entscheideTrial\([^)]*tarif/);
    expect(CHECKOUT).toMatch(/\.\.\.\(trial\.trialTage > 0 \? \{ trial_period_days: trial\.trialTage \} : \{\}\)/);
  });
  it('T7/T8 — ehemaliger Abonnent: 0 Tage bei yearly wie bei monthly', () => {
    expect(entscheideTrial({ stripeHatteSubscriptions: true, profilHatteAbo: false }).trialTage).toBe(0);
    expect(entscheideTrial({ stripeHatteSubscriptions: false, profilHatteAbo: true }).trialTage).toBe(0);
    expect(CHECKOUT).not.toMatch(/yearly[^\n]*trial|trial[^\n]*yearly/i);
  });
});

describe('T9–T11 — Billing Truth im Webhook', () => {
  it('T9 — monthly Subscription → stripe_billing_interval month', () => {
    expect(billingIntervalAusSubscription(sub('month', 4900))).toBe('month');
  });
  it('T10 — yearly Subscription → year; unklar → null (nicht raten)', () => {
    expect(billingIntervalAusSubscription(sub('year', 49000))).toBe('year');
    expect(billingIntervalAusSubscription({ items: { data: [] } })).toBeNull();
    expect(billingIntervalAusSubscription({ items: { data: [{ price: price('month', 4900) }, { price: price('year', 49000) }] } })).toBeNull();
    expect(billingIntervalAusSubscription({ items: { data: [{ price: { ...price('month', 4900), recurring: { interval: 'week', interval_count: 1 } } }] } })).toBeNull();
    const created = WEBHOOK.slice(WEBHOOK.indexOf("case 'customer.subscription.created'"), WEBHOOK.indexOf("case 'invoice.paid'"));
    expect(created).toMatch(/stripe_billing_interval: billingIntervalAusSubscription\(sub\)/);
    expect(created).not.toMatch(/stripe_billing_interval: (meta|sub\.metadata)/);
    expect(intervallText('year')).toBe('490 € / Jahr');
    expect(intervallText('month')).toBe('49 € / Monat');
    expect(intervallText(null)).toBeNull();
  });
  it('T11 — FP bleibt FP: mapStatusToPlan/FP-Schutz unveraendert, Settings zeigen FP keinen Jahrespreis-Zwang', () => {
    expect(WEBHOOK).toMatch(/founding_partner/);
    const settings = lies('pages/dashboard/DashboardSettings.js');
    expect(settings).toMatch(/\{bezahlt && !foundingPartner && !isTrial && intervallText\(intervall\) && \(/);
    expect(settings).toMatch(/Kostenlos, solange du Teil des Founding-Partner-Programms bist\./);
  });
});

describe('T12–T15 — Referral + Jahresabo', () => {
  it('T12 — Referral + monthly → Reward 4900', () => {
    expect(monatsbetragAusSubscription(sub('month', 4900))).toMatchObject({ ok: true, amountCents: 4900 });
  });
  it('T13/T14 — Referral + yearly → Reward 4900 aus STRIPE_PRICE_MONTHLY, nie 49000, kein 1/12', () => {
    /* Jahres-Subscription hat keinen Monatspreis → Modul sagt kein_monatspreis … */
    expect(monatsbetragAusSubscription(sub('year', 49000))).toEqual({ ok: false, grund: 'kein_monatspreis' });
    /* … und der Webhook holt dann die Monats-Price aus ENV, nicht den Jahresbetrag */
    const fn = WEBHOOK.slice(WEBHOOK.indexOf('async function monatsbetragFuer'), WEBHOOK.indexOf('function mapStatusToPlan'));
    expect(fn).toMatch(/billingIntervalAusSubscription\(sub\) === 'year'/);
    expect(fn).toMatch(/Deno\.env\.get\('STRIPE_PRICE_MONTHLY'\)/);
    expect(fn).toMatch(/stripe\.prices\.retrieve\(monthlyPriceId\)/);
    expect(ohneKommentare(fn)).not.toMatch(/\/\s*12|49000|4900\b/);
    expect(fn).toMatch(/if \(!monthlyPriceId\) return \{ grund: 'jahresabo_ohne_monatspreis_env' \};/);
    /* JEDER zurueckgegebene Betrag stammt aus einem geprueften Monats-Item
       (m = Subscription-Item, mm = STRIPE_PRICE_MONTHLY) — nie aus dem
       Jahres-Item, nie aus einer Zahl. */
    const rumpf = ohneKommentare(fn).split('\n').slice(1).join('\n');   // ohne Signaturzeile
    const quellen = rumpf.match(/\{ amountCents: [^,]+/g) || [];
    expect(quellen.length).toBeGreaterThanOrEqual(2);
    for (const q of quellen) expect(['{ amountCents: m.amountCents', '{ amountCents: mm.amountCents']).toContain(q.trim());
    /* der Monatsbetrag der ENV-Price laeuft durch dieselbe Pruefung */
    expect(monatsbetragAusSubscription({ items: { data: [{ price: price('month', 4900), quantity: 1 }] } }).amountCents).toBe(4900);
  });
  it('T15 — Customer Balance: keine Sonderbehandlung fuer Jahresrechnungen', () => {
    const wende = WEBHOOK.slice(WEBHOOK.indexOf('async function wendeRewardsAn'), WEBHOOK.indexOf('async function monatsbetragFuer'));
    expect(wende).not.toMatch(/year|yearly|interval/);
    expect(wende).toMatch(/createBalanceTransaction\(/);
  });
});

describe('T16–T20 — Pause: Regeln (Client = Server)', () => {
  const heute = '2026-12-01';
  it('T19 — from > until → reject', () => {
    expect(pruefePause({ von: '2026-12-20', bis: '2026-12-19' }, heute)).toEqual({ ok: false, grund: 'bis_vor_von' });
  });
  it('T20 — > 56 Tage → reject; genau 56 ok', () => {
    expect(pruefePause({ von: '2026-12-01', bis: '2027-01-27' }, heute)).toMatchObject({ ok: false, grund: 'zu_lang', maxTage: PAUSE_MAX_TAGE });
    expect(pruefePause({ von: '2026-12-01', bis: '2027-01-26' }, heute)).toEqual({ ok: true });
    expect(tageZwischen('2026-12-01', '2027-01-26')).toBe(56);
  });
  it('nicht rueckwirkend, Datumsform, kein offenes Ende (C7)', () => {
    expect(pruefePause({ von: '2026-11-30', bis: '2026-12-05' }, heute)).toEqual({ ok: false, grund: 'rueckwirkend' });
    expect(pruefePause({ von: '2026-12-20', bis: '' }, heute)).toEqual({ ok: false, grund: 'datum_fehlt' });
    expect(pruefePause({ von: '2026-12-20', bis: null }, heute)).toEqual({ ok: false, grund: 'datum_fehlt' });
    expect(pruefePause({ von: '2026-02-30', bis: '2026-03-01' }, heute)).toEqual({ ok: false, grund: 'datum_fehlt' });
    /* SQL: beide null oder beide gesetzt, <= 56 Tage */
    expect(MIG).toMatch(/\(pause_from is null and pause_until is null\)\s*or \(pause_from is not null and pause_until is not null\s*and pause_until >= pause_from\s*and pause_until - pause_from <= 56\)/);
  });
  it('T16/T17/T18 — Server: Pro/FP ueber requirePaidAccess, Free blockiert; auch account_pause_set prueft has_paid_access', () => {
    const h = GB.slice(GB.indexOf('async function handleAccountPause('), GB.indexOf('const ACCOUNT_ROUTES'));
    expect(h).toMatch(/const user = await requireUser\(request\);\s*await requirePaidAccess\(user\.id\);/);
    expect(h).toMatch(/rpc\('account_pause_set', \{ p_user_id: user\.id, p_from: von, p_until: bis \}\)/);
    expect(h).not.toMatch(/p_user_id: body/);
    expect(MIG).toMatch(/if not public\.has_paid_access\(p_user_id\) then\s*return jsonb_build_object\('ok', false, 'reason', 'kein_pro'\);/);
    expect(GB).toMatch(/routeName === 'account' && sub \? ACCOUNT_ROUTES\[sub\]/);
    /* Client: Free sieht keinen Knopf */
    expect(lies('components/dashboard/Betriebsferien.js')).toMatch(/if \(!hasPaidAccess\(profile\)\) return null;/);
  });
});

describe('T27/T28 — zeitbasiertes Ende', () => {
  const p = { pause_from: '2026-12-20', pause_until: '2027-01-05' };
  it('T27 — pause_until vorbei → nicht mehr pausiert, ohne Cron', () => {
    expect(istPausiert(p, '2026-12-19')).toBe(false);
    expect(istPauseGeplant(p, '2026-12-19')).toBe(true);
    expect(istPausiert(p, '2026-12-20')).toBe(true);
    expect(istPausiert(p, '2027-01-05')).toBe(true);
    expect(istPausiert(p, '2027-01-06')).toBe(false);
    expect(istPauseGeplant(p, '2027-01-06')).toBe(false);
    expect(MIG).toMatch(/\(p_now at time zone 'Europe\/Berlin'\)::date between p\.pause_from and p\.pause_until/);
    expect(MIG).not.toMatch(/cron\.schedule/);
  });
  it('T28 — manuell beendet → Felder null → sofort aktiv', () => {
    expect(istPausiert({ pause_from: null, pause_until: null }, '2026-12-25')).toBe(false);
    expect(MIG).toMatch(/set pause_from = null, pause_until = null, pause_reason = null/);
    const h = GB.slice(GB.indexOf('async function handleAccountPauseEnd'), GB.indexOf('const ACCOUNT_ROUTES'));
    expect(h).toMatch(/rpc\('account_pause_end', \{ p_user_id: user\.id \}\)/);
    expect(h).toMatch(/action: 'account\.pause_ended'/);
  });
  it('heuteBerlin liefert einen Kalendertag', () => {
    expect(heuteBerlin(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');   // 00:30 Berlin
    expect(heuteBerlin(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');   // Sommerzeit
    expect(formatDatumDe('2027-01-03')).toBe('03.01.2027');
  });
});

/* ── Komponenten ── */
let mockProfil = {};
const mockRefresh = jest.fn();
jest.mock('./context/AuthContext', () => ({ useAuthContext: () => ({ profile: mockProfil, user: { id: 'u1' }, refreshProfile: mockRefresh }) }));
jest.mock('./supabaseClient', () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
  return { __esModule: true, default: client, supabase: client };
});
// eslint-disable-next-line import/first
import Betriebsferien, { PauseHinweis } from './components/dashboard/Betriebsferien';

describe('T29/T30 — Dashboard und Settings', () => {
  const heute = heuteBerlin();
  const inTagen = (n) => { const d = new Date(`${heute}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  it('T29 — Pause aktiv → Hinweis oben mit Enddatum, „Kritische Hinweise bleiben aktiv", Pause beenden', () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active', pause_from: inTagen(-1), pause_until: inTagen(5) };
    render(<PauseHinweis />);
    const b = screen.getByTestId('pause-hinweis');
    expect(b).toHaveTextContent(`WERKRUF ist bis ${formatDatumDe(inTagen(5))} pausiert.`);
    expect(b).toHaveTextContent('Kritische Hinweise bleiben aktiv.');
    expect(screen.getByText('Pause beenden')).toBeInTheDocument();
  });
  it('nicht pausiert → kein Hinweis; geplante Pause → kein Hinweis oben, aber in den Settings', () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active', pause_from: inTagen(3), pause_until: inTagen(10) };
    const { container, unmount } = render(<PauseHinweis />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<Betriebsferien />);
    expect(screen.getByTestId('pause-geplant')).toBeInTheDocument();
  });
  it('T16/T17 — Pro und FP sehen das Formular; T18 — Free nicht', () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
    const a = render(<Betriebsferien />);
    expect(screen.getByTestId('pause-starten')).toBeInTheDocument();
    a.unmount();
    mockProfil = { plan: 'founding_partner' };
    const b = render(<Betriebsferien />);
    expect(screen.getByTestId('pause-starten')).toBeInTheDocument();
    b.unmount();
    mockProfil = { plan: 'free', stripe_subscription_status: 'canceled' };
    const { container } = render(<Betriebsferien />);
    expect(container).toBeEmptyDOMElement();
  });
  it('T30 — Tasks bleiben: Pause loescht/resolved keine Events; Layout zeigt Outlet weiter', () => {
    expect(MIG).not.toMatch(/update public\.events|lifecycle = 'resolved'|delete from public\.events/);
    const layout = lies('pages/dashboard/DashboardLayout.js');
    expect(layout).toMatch(/<PauseHinweis \/>\s*<Content>\s*<Outlet \/>/);
  });
  it('Copy: Kommunikationspause, kein Billing-Pause-Vokabular', () => {
    const src = ohneKommentare(lies('utils/betriebsferien.js') + lies('components/dashboard/Betriebsferien.js'));
    expect(src).not.toMatch(/Abo pausieren|Zahlung pausieren|Keine Kosten|kostenfrei pausier/i);
    expect(PAUSE_TEXTE.billing).toMatch(/Abrechnung laufen dabei normal weiter/);
    expect(PAUSE_TEXTE.erklaerung).toMatch(/Google wird weiter überwacht\. Normale Aufgaben und Wochenmails ruhen\./);
  });
});

describe('Mail-Gate (Quelle; Wirkung in SQL)', () => {
  it('weekly + inactivity haengen an is_account_paused; immediate_alert nicht; Sync/Engine unberuehrt', () => {
    const fn = MIG.slice(MIG.indexOf('FUNCTION public.plan_communications'), MIG.indexOf('/* ── Selbstpruefung ── */'));
    expect(fn).toMatch(/v_pausiert\s+boolean := public\.is_account_paused\(p_user_id, p_now\);/);
    const k2 = fn.slice(fn.indexOf('KANAL 2'), fn.indexOf('KANAL 3'));
    const k3 = fn.slice(fn.indexOf('KANAL 3'));
    const k1 = fn.slice(fn.indexOf('KANAL 1'), fn.indexOf('KANAL 2'));
    expect(k2).toMatch(/if v_pausiert then[\s\S]*'channel', 'weekly_email', 'send', false,\s*'reason', 'Betriebsferien/);
    expect(k3).toMatch(/if v_pausiert then[\s\S]*'channel', 'inactivity_reminder', 'send', false,\s*'reason', 'Betriebsferien/);
    expect(k1).not.toMatch(/v_pausiert/);
    /* Sync, Engine, Lifecycle (connection_broken) werden von der Migration nicht angefasst */
    expect(MIG).not.toMatch(/schedule_lifecycle_emails|sync_jobs|run_engine|evaluate_location|schedule_performance_syncs/);
  });
  it('Admin: Support-Snapshot zeigt Intervall und Pause (minimal)', () => {
    const a = lies('utils/adminOps.js');
    expect(a).toMatch(/billingIntervall: profil\.stripe_billing_interval \|\| null/);
    expect(a).toMatch(/pause: \{\s*aktiv: istPausiert\(profil\),/);
  });
  it('Audit: billing_interval_selected, pause_started, pause_ended', () => {
    expect(CHECKOUT).toMatch(/action: 'subscription\.billing_interval_selected'/);
    expect(GB).toMatch(/action: 'account\.pause_started'/);
    expect(GB).toMatch(/action: 'account\.pause_ended'/);
  });
});
