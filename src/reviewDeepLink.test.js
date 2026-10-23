/**
 * Review-Deep-Link: Sofortmail, Engine, ProGate (WP4, 23.10.2026)
 *
 * T8  Sofortmail: der Knopf fuehrt ueber den bestehenden Action-Token,
 *     target_path traegt betrieb, status=offen und die Review-ID.
 *     Kein zweiter Link.
 * T10 ProGate verspricht nichts, was es nicht gibt.
 * Engine: die Aufgabe „Bewertung beantworten“ zeigt auf die Bewertung.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('T8 — Sofortmail ueber den Token-Weg', () => {
  const mail = lies('../supabase/functions/send-email/index.ts');
  const kritisch = mail.slice(mail.indexOf("case 'critical_review_alert'"), mail.indexOf("case 'payment_failed'"));
  const helfer = mail.slice(mail.indexOf('async function ergaenzeSofortmailLink'), mail.indexOf('function render('));

  it('der Worker haengt den Token-Link an die Sofortmail — mit demselben Token-Mechanismus wie die Wochenmail', () => {
    expect(mail).toMatch(/row\.template === 'critical_review_alert'[\s\S]{0,120}ergaenzeSofortmailLink\(/);
    expect(helfer).toMatch(/erzeugeToken\(\)/);
    expect(helfer).toMatch(/rpc\('create_action_token'/);
    expect(helfer).toMatch(/p_location_id:\s+locationId/);
    expect(helfer).toMatch(/p_ttl:\s+laufzeitIntervall\(\)/);
    expect(helfer).toMatch(/zielErlaubt\(ziel\)/);
  });

  it('target_path: betrieb + status=offen + review-ID aus dem Ereignis (subject_id)', () => {
    expect(helfer).toMatch(/\/dashboard\/bewertungen\?betrieb=\$\{encodeURIComponent\(locationId\)\}&status=offen/);
    expect(helfer).toMatch(/&review=\$\{encodeURIComponent\(reviewId\)\}/);
    expect(helfer).toMatch(/\.eq\('type', 'review\.negative_unanswered'\)/);
    expect(helfer).toMatch(/select\('id, subject_id'\)/);
    /* nur bei genau einer Bewertung */
    expect(helfer).toMatch(/Number\(payload\.count \?\? 1\) === 1/);
  });

  /* ── GEGENPROBE ── */
  it('genau EIN Knopf, EIN Link: Token-URL, sonst Fallback — nie beides', () => {
    expect((kritisch.match(/url:/g) || []).length).toBe(1);
    expect(kritisch).toMatch(/payload\.ctaUrl[\s\S]{0,80}\? payload\.ctaUrl[\s\S]{0,120}: `\$\{brand\.appUrl\}\/dashboard\/bewertungen\?status=offen`/);
    /* Keine Review-ID ausserhalb des Tokens: der Fallback traegt keine */
    expect(kritisch).not.toMatch(/review=/);
  });

  it('Token-Sicherheit unveraendert: Hashing, Laufzeit und Zweckliste kommen weiter aus actionToken.js', () => {
    expect(mail).toMatch(/from '\.\.\/\.\.\/\.\.\/src\/utils\/actionToken\.js'/);
    const token = lies('utils/actionToken.js');
    expect(token).toMatch(/return pfad === '\/dashboard' \|\| pfad\.startsWith\('\/dashboard\/'\);/);
    expect(token).toMatch(/EVENT_OEFFNEN: 'event\.open'/);
  });
});

describe('Engine — Aufgabe zeigt auf die Bewertung', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  it('review.negative_unanswered: actionUrl mit status=offen und review=<subject.id>', () => {
    const regel = gb.slice(gb.indexOf("id: 'review.negative_unanswered'"), gb.indexOf("id: 'review.negative_batch'"));
    expect(regel).toMatch(/actionUrl: `\/dashboard\/bewertungen\?status=offen&review=\$\{subject\?\.id \?\? ''\}`/);
  });
  it('die uebrigen Bewertungsaufgaben oeffnen die offene Liste', () => {
    const rest = gb.slice(gb.indexOf("id: 'review.negative_batch'"), gb.indexOf("id: 'reply.drafts_waiting'") + 2000);
    expect(rest).not.toMatch(/actionUrl: '\/dashboard\/bewertungen',/);
    expect((rest.match(/actionUrl: '\/dashboard\/bewertungen\?status=offen'/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

/* ── T10 ProGate ── */
jest.mock('./context/AuthContext', () => ({
  useAuthContext: () => ({ profile: { plan: 'free', stripe_subscription_status: null }, profileLoading: false, profileError: null, refreshProfile: jest.fn() }),
}));
jest.mock('./context/IndustryContext', () => ({
  useIndustry: () => ({ pricing: { monthlyPrice: 49, currency: '€', trialDays: 30, productName: 'WERKRUF Pro' }, brand: { name: 'WERKRUF' } }),
}));
jest.mock('./hooks/useCheckout', () => ({ useCheckout: () => ({ startCheckout: jest.fn(), loading: false, error: null }) }));
import ProGate from './components/dashboard/ProGate';

describe('T10 — ProGate Product Truth', () => {
  it('nennt weder PDF-Reports noch Wettbewerber-Check — nur echte Funktionen', () => {
    render(<ProGate feature="Bewertungen"><div>geschuetzt</div></ProGate>);
    const text = document.body.textContent;
    expect(text).not.toMatch(/PDF-Report/i);
    expect(text).not.toMatch(/Wettbewerber/i);
    expect(text).toMatch(/Antwortvorschl/);
    expect(text).toMatch(/Wochenmail/);
    expect(text).toMatch(/Sofortmeldung/);
    expect(screen.queryByText('geschuetzt')).not.toBeInTheDocument();
  });
});
