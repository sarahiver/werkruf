/**
 * WP16-Fix1 — Token-Seiten vom Supabase-Gateway ins Frontend.
 *
 * Ursache: Das Gateway liefert HTML von Edge Functions auf *.supabase.co
 * als text/plain mit Sandbox-CSP aus. Betroffen waren /a/<token>
 * (Wochenmail) und /founding-partner/<token> (WP16).
 *
 *   T1–T7    Action Page (/a/:token): Route, GET zeigt nur, JSON, neutraler
 *            Fehler, POST-Formular an die Function, Redirect danach
 *   T8–T14   Founding Partner (/founding-partner/:token)
 *   T15–T17  alte Links: Function-GET → 302 ins Frontend, kein HTML, Token bleibt
 *   T18–T20  Mail: neue Links beginnen mit <APP>/a/, keine Supabase-URL
 *   T21–T24  Architektur: kein text/html, kein <!doctype>, JSON-Content-Type, Redirects
 *   SQL-Seite (Token-Logik, cta_clicked, Status): supabase/tests/akquise.test.sql,
 *   actionTokens.test.sql — unveraendert, nichts daran neu erfunden.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ActionLink from './pages/ActionLink';
import FoundingPartnerInteresse from './pages/FoundingPartnerInteresse';
import { ladeTokenAuskunft, istTokenForm, TEXT } from './utils/tokenSeite';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const GB = ohneKommentare(lies('../supabase/functions/google-business/index.ts'));
const SE = ohneKommentare(lies('../supabase/functions/send-email/index.ts'));
const TOKEN = 'abcDEF123_-xyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';

function mockFetch(antworten) {
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const a = typeof antworten === 'function' ? antworten(url) : antworten;
    if (a instanceof Error) throw a;
    return { ok: a.status ? a.status < 400 : true, status: a.status ?? 200, json: async () => a.body ?? a };
  });
  return calls;
}
const zeige = (pfad, element) => render(
  <MemoryRouter initialEntries={[pfad]}><Routes><Route path="/a/:token" element={<ActionLink />} /><Route path="/founding-partner/:token" element={<FoundingPartnerInteresse />} /></Routes></MemoryRouter>,
);

afterEach(() => { delete global.fetch; });

/* ───────── T1–T7 Action Page ───────── */
describe('T1–T7 — /a/:token', () => {
  it('T1/T2 — Route existiert, GET rendert Betrieb, Aufgabe, Aufwand und Formular', async () => {
    const calls = mockFetch({ valid: true, title: 'Bewertung von Max beantworten', businessName: 'S&I Haustechnik', effort: 'etwa 2 Minuten', done: false, requiresConfirmation: true });
    zeige(`/a/${TOKEN}`);
    expect(await screen.findByText('Bewertung von Max beantworten')).toBeInTheDocument();
    expect(screen.getByText('S&I Haustechnik')).toBeInTheDocument();
    expect(screen.getByText('etwa 2 Minuten')).toBeInTheDocument();
    const form = screen.getByTestId('action-form');
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', `${process.env.REACT_APP_SUPABASE_URL ?? ''}/functions/v1/google-business/a/${TOKEN}/continue`);
    expect(lies('./App.js')).toMatch(/<Route path="\/a\/:token" element=\{<ActionLink \/>\} \/>/);
    /* T3 — GET mutiert nichts: genau ein GET auf …/info, kein POST, kein continue */
    expect(calls).toEqual([{ url: `${process.env.REACT_APP_SUPABASE_URL ?? ''}/functions/v1/google-business/a/${TOKEN}/info`, method: 'GET' }]);
  });
  it('T4 — JSON-Auskunft der Function: nur Minimum, keine IDs/Nutzer/Google-Ressourcen', () => {
    const get = GB.slice(GB.indexOf('async function handleActionLinkGet'), GB.indexOf('async function handleActionLinkPost'));
    expect(get).toMatch(/return actionJson\(\{\s*valid: true,\s*title: aufgabe \?\? 'Weiter zu deinem Dashboard',\s*businessName: betrieb,\s*effort: aufwand,\s*done: erledigt,\s*requiresConfirmation: !erledigt,\s*\}\);/);
    const antwort = get.slice(get.indexOf('return actionJson({'), get.indexOf('});', get.indexOf('return actionJson({')));
    expect(antwort).not.toMatch(/userId|locationId|eventId|tokenId|resource|token/);
    expect(get).toMatch(/return actionAbweisung\(\);/);
    expect(GB).toMatch(/function actionAbweisung\(\): Response \{\s*return actionJson\(\{ valid: false \}\);/);
    /* GET loest nichts aus (wie vor Fix1) */
    expect(get).not.toMatch(/generateLink|consume_action_token|record_recommendation_action|activate_google_location|\.update\(|\.insert\(/);
  });
  it('T5 — ungueltiger Token → neutraler Text, ohne Grund; Netzfehler getrennt', async () => {
    mockFetch({ valid: false });
    const erste = zeige(`/a/${TOKEN}`);
    expect(await screen.findByText(TEXT.ungueltig)).toBeInTheDocument();
    expect(screen.queryByTestId('action-form')).toBeNull();
    expect(document.body.textContent).not.toMatch(/abgelaufen|widerrufen|unbekannt|falsch/i);
    erste.unmount();
    delete global.fetch;
    mockFetch(new Error('offline'));
    zeige(`/a/${TOKEN}x`);
    expect(await screen.findByRole('alert')).toHaveTextContent(TEXT.netz);
    expect(screen.queryByText(TEXT.ungueltig)).toBeNull();
    /* Token-Form schon im Client: kein Request fuer Unsinn */
    expect(istTokenForm('abc')).toBe(false); expect(istTokenForm(TOKEN)).toBe(true);
  });
  it('T6/T7 — POST fuehrt die bestehende Aktion aus (unveraendert) und leitet per 302 weiter; Abweisungen sind Redirects ins Frontend, kein HTML', () => {
    const post = GB.slice(GB.indexOf('async function handleActionLinkPost'), GB.indexOf('async function handleEinstieg') > 0 ? GB.indexOf('async function handleEinstieg') : GB.indexOf('POST /einstieg'));
    expect(post).toMatch(/await pruefeActionToken\(token, request, log\)/);
    expect(post).toMatch(/record_recommendation_action/);
    expect(post).toMatch(/rpc\('activate_google_location'/);
    expect(post).toMatch(/auth\.admin\.generateLink/);
    expect(post).toMatch(/status: 302/);
    expect(post).toMatch(/leiteZumFrontend\(`\/a\/\$\{encodeURIComponent\(token\)\}\?status=ungueltig`\)/);
    expect(post).toMatch(/leiteZumFrontend\(`\/a\/\$\{encodeURIComponent\(token\)\}\?status=erledigt`\)/);
    expect(post).not.toMatch(/actionSeite|text\/html|ACTION_HEADERS \}\)/);
    /* Origin-Pruefung kennt das Frontend */
    expect(post).toMatch(/const erlaubt = \[basis, appBasis\(\), Deno\.env\.get\('SUPABASE_URL'\) \?\? '', \.\.\.getAllowedOrigins\(\)\]/);
  });
  it('T7b — Rueckkehr vom POST: ?status=erledigt / ?status=ungueltig rendern ohne erneuten Request', async () => {
    const calls = mockFetch({ valid: true });
    zeige(`/a/${TOKEN}?status=erledigt`);
    expect(await screen.findByText(TEXT.erledigt)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

/* ───────── T8–T14 Founding Partner ───────── */
describe('T8–T14 — /founding-partner/:token', () => {
  it('T8/T9/T10 — Route existiert; GET zeigt Seite, ruft nur …/fp/<token>/info (cta_viewed), nie …/interesse', async () => {
    const calls = mockFetch({ valid: true });
    zeige(`/founding-partner/${TOKEN}`);
    expect(await screen.findByText('Interesse?')).toBeInTheDocument();
    const form = screen.getByTestId('fp-form');
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', `${process.env.REACT_APP_SUPABASE_URL ?? ''}/functions/v1/google-business/fp/${TOKEN}/interesse`);
    expect(calls).toEqual([{ url: `${process.env.REACT_APP_SUPABASE_URL ?? ''}/functions/v1/google-business/fp/${TOKEN}/info`, method: 'GET' }]);
    expect(lies('./App.js')).toMatch(/<Route path="\/founding-partner\/:token" element=\{<FoundingPartnerInteresse \/>\} \/>/);
    const info = GB.slice(GB.indexOf('async function handleAkquiseCtaInfo'), GB.indexOf('async function handleAkquiseCtaPost'));
    expect(info).toMatch(/'cta_viewed'/); expect(info).not.toMatch(/cta_clicked|acquisition_status/);
  });
  it('T11–T14 — POST setzt cta_clicked ueber acquisition_link_event (nur aufwaerts, idempotent — SQL-Tests), antwortet mit 302 ?danke=1; Danke-Seite rendert ohne Request', async () => {
    const post = GB.slice(GB.indexOf('async function handleAkquiseCtaPost'), GB.indexOf('const REVIEW_REQUEST_ROUTES') > GB.indexOf('async function handleAkquiseCtaPost') ? GB.indexOf('const REVIEW_REQUEST_ROUTES') : GB.indexOf('WP13 — Betriebsferien-Pause'));
    expect(post).toMatch(/akquiseLinkEreignis\(token, 'cta_clicked'\)/);
    expect(post).toMatch(/\?danke=1`\)/);
    const mig = lies('../supabase/migrations/20261114090000_admin_akquise.sql');
    expect(mig).toMatch(/if v_vorher is null or v_vorher in \('neu', 'vorbereitet', 'angeschrieben', 'zurueckgestellt'\) then/);   // T13: founding_partner nie zurueck
    expect(mig).toMatch(/values \(v_msg\.id, v_msg\.lead_id, 'werkruf', 'cta_clicked', 'cta_clicked', now\(\)\)\s+on conflict \(outreach_message_id, fingerprint\) do nothing/);   // T14
    const calls = mockFetch({ valid: true });
    zeige(`/founding-partner/${TOKEN}?danke=1`);
    expect(await screen.findByText(/Danke — Interesse ist notiert/)).toBeInTheDocument();
    expect(screen.queryByTestId('fp-form')).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it('ungueltiger Token → neutral (404 der Function), Netzfehler getrennt', async () => {
    mockFetch({ status: 404, body: { valid: false } });
    zeige(`/founding-partner/${TOKEN}`);
    expect(await screen.findByText(TEXT.ungueltig)).toBeInTheDocument();
    expect(screen.queryByTestId('fp-form')).toBeNull();
  });
});

/* ───────── T15–T17 alte Links ───────── */
describe('T15–T17 — alte Links auf *.supabase.co', () => {
  const dispatch = GB.slice(GB.indexOf("if (routeName === 'a' && sub)"), GB.indexOf("if (routeName === 'a' && sub)") + 1600);
  it('T15/T16 — alter GET /a/<token> liefert kein HTML, sondern 302 auf <APP>/a/<token>', () => {
    expect(dispatch).toMatch(/if \(request\.method === 'GET' && !weiter\) \{\s*return leiteZumFrontend\(`\/a\/\$\{encodeURIComponent\(sub\)\}`\);/);
    expect(GB).toMatch(/function leiteZumFrontend\(pfad: string\): Response \{\s*return new Response\(null, \{\s*status: 302,\s*headers: \{\s*'Location': `\$\{appBasis\(\)\}\$\{pfad\}`,/);
    expect(GB).toMatch(/'Cache-Control': 'no-store, no-cache, must-revalidate, private',\s*'Referrer-Policy': 'no-referrer',\s*'X-Robots-Tag': 'noindex',/);
  });
  it('T17 — bestehender Token bleibt gueltig: der Redirect prueft und verbraucht nichts; Fortsetzung laeuft ueber dieselbe pruefeActionToken/resolve_action_token', () => {
    const redirectZeile = dispatch.slice(dispatch.indexOf("request.method === 'GET' && !weiter"), dispatch.indexOf("request.method === 'GET' && !weiter") + 200);
    expect(redirectZeile).not.toMatch(/pruefeActionToken|consume|rpc\(/);
    expect(GB).toMatch(/rpc\('resolve_action_token', \{ p_token_hash: hash \}\)/);
    expect(GB).not.toMatch(/create_action_token_v2|neuer Token/);
    /* alte /fp/<token>-Adresse ebenfalls ins Frontend */
    expect(GB).toMatch(/istAkquiseToken\(sub\)\) return leiteZumFrontend\(`\/founding-partner\/\$\{encodeURIComponent\(sub\)\}`\)/);
  });
});

/* ───────── T18–T20 Mail ───────── */
describe('T18–T20 — Mail-Links', () => {
  it('T18/T19 — alle Action-Links werden aus EINER Quelle gebaut: <APP>/a/<token>; keine Supabase-Action-URL mehr', () => {
    expect(SE).toMatch(/const ACTION_LINK_BASIS = \(Deno\.env\.get\('APP_URL'\) \?\? 'https:\/\/www\.werkruf\.com'\)\.replace\(\/\\\/\+\$\/, ''\);/);
    expect(SE).toMatch(/const actionLinkUrl = \(klartext: string\) => `\$\{ACTION_LINK_BASIS\}\/a\/\$\{klartext\}`;/);
    expect((SE.match(/actionLinkUrl\(klartext\)/g) || []).length).toBe(3);   // Wochenmail, Sofortmail, Profil-Diff
    expect(SE).not.toMatch(/functions\/v1\/google-business\/a\//);
    expect(SE).not.toMatch(/SUPABASE_URL'\) \?\? ''[\s\S]{0,400}\/a\//);
  });
  it('T20 — Token-Erzeugung unveraendert: create_action_token mit user/location/event/ttl', () => {
    expect(SE).toMatch(/rpc\('create_action_token'/);
    expect(SE).toMatch(/p_user_id:\s+userId/);
    expect(SE).toMatch(/p_ttl:\s+laufzeitIntervall\(\)/);
  });
});

/* ───────── T21–T24 Architektur ───────── */
describe('T21–T24 — Architektur', () => {
  it('T21/T22 — google-business liefert kein text/html und kein <!doctype html> mehr', () => {
    expect(GB).not.toMatch(/text\/html/);
    expect(GB).not.toMatch(/<!doctype html>|<html/i);
    expect(GB).not.toMatch(/function actionSeite|function akquiseSeite|function hEsc/);
  });
  it('T23 — JSON-Antworten tragen application/json; T24 — Redirects bleiben 302 (Praesentation, Fortsetzung, Frontend)', () => {
    expect(GB).toMatch(/'Content-Type': 'application\/json; charset=utf-8'/);
    expect(GB).toMatch(/function actionJson\(body: unknown, status = 200\): Response \{\s*return new Response\(JSON\.stringify\(body\), \{ status, headers: ACTION_HEADERS \}\);/);
    expect(GB).toMatch(/status: 302, headers: \{ \.\.\.AKQUISE_KOPF, Location: AKQUISE_PDF_URL \}/);
    expect((GB.match(/status: 302/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('andere HTML-Quellen in Functions sind Mail-/Report-Inhalte, keine Browser-Antworten (gemeldet, nicht umgebaut)', () => {
    const se = lies('../supabase/functions/send-email/index.ts');
    expect(se).toMatch(/htmlContent: rendered\.html/);           // HTML geht an Brevo, nicht an den Browser
    expect(se).not.toMatch(/'Content-Type': 'text\/html/);
  });
  it('ladeTokenAuskunft: 404 → ungueltig, 5xx/Netz → netz, valid:false → ungueltig', async () => {
    expect(await ladeTokenAuskunft('x', async () => ({ ok: false, status: 404, json: async () => ({}) }))).toEqual({ zustand: 'ungueltig' });
    expect(await ladeTokenAuskunft('x', async () => ({ ok: false, status: 503, json: async () => ({}) }))).toEqual({ zustand: 'netz' });
    expect(await ladeTokenAuskunft('x', async () => { throw new Error('offline'); })).toEqual({ zustand: 'netz' });
    expect(await ladeTokenAuskunft('x', async () => ({ ok: true, status: 200, json: async () => ({ valid: false }) }))).toEqual({ zustand: 'ungueltig' });
    expect((await ladeTokenAuskunft('x', async () => ({ ok: true, status: 200, json: async () => ({ valid: true, title: 'T' }) }))).zustand).toBe('ok');
  });
});
