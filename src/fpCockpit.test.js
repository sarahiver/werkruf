/**
 * WP6 — Founding-Partner-Cockpit: Darstellungsregeln (real), Bauteil
 * gegen einen nachgebildeten admin-ops-Aufruf (real), Zugangstor
 * pruefeAnfrage (real), Verdrahtung in admin-ops (Quelltext).
 *
 *   T14/T15  nur Admin — Tor und Seite
 *   T18–T22  KPI-Darstellung aus den Zahlen der Datenbank
 *   T25/T26  „49 €?" nur ueber die Allowlist, nur gueltige Werte
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  labelZahlungsbereitschaft, formatProzent, oeffnungsrateText, aktiveWochenText,
  zustellungText, oeffnungText, kpiKacheln, ZAHLUNGSBEREITSCHAFT,
} from './utils/fpCockpit';
import { pruefeAnfrage, ADMIN_AKTIONEN, FP_ZAHLUNGSBEREITSCHAFT } from './utils/adminOps';
import FoundingPartnerCockpit from './components/admin/FoundingPartnerCockpit';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('Darstellung — nichts behaupten, was nicht gemessen ist', () => {
  it('T18 — Oeffnungsrate nur aus zugestellten Mails; ohne Zustellereignisse „—" mit Grund', () => {
    expect(oeffnungsrateText({ deliveryTrackingActive: false, weeklyDelivered28d: 0 }))
      .toEqual({ wert: '—', hinweis: 'Brevo-Webhook noch nicht aktiv — keine Zustelldaten' });
    expect(oeffnungsrateText({ deliveryTrackingActive: true, weeklyDelivered28d: 0 }).wert).toBe('—');
    const r = oeffnungsrateText({ deliveryTrackingActive: true, weeklyDelivered28d: 6, weeklyOpened28d: 4, openRate28d: 0.667 });
    expect(r.wert).toBe('67 %');
    expect(r.hinweis).toMatch(/4 von 6 zugestellten/);
    expect(r.hinweis).toMatch(/kein Lesebeweis/);
    expect(formatProzent(null)).toBe('—');
  });

  it('„Oeffnung erkannt", nie „gelesen"; Mehrfach-Open als Anzahl, nicht als mehr Mails', () => {
    expect(oeffnungText(null)).toBe('keine Öffnung erkannt');
    expect(oeffnungText({ firstOpenedAt: '2026-11-09', openCount: 1 })).toBe('Öffnung erkannt, zuletzt 2026-11-09');
    expect(oeffnungText({ firstOpenedAt: '2026-11-09', lastOpenedAt: '2026-11-10', openCount: 3 })).toBe('Öffnung erkannt (3×), zuletzt 2026-11-10');
    expect(oeffnungText({ firstOpenedAt: '2026-11-09' })).not.toMatch(/gelesen/);
  });

  it('T22 — Hard Bounce ist nicht zugestellt', () => {
    expect(zustellungText({ status: 'sent', deliveryStatus: 'hard_bounce' })).toMatchObject({ wert: 'Hard Bounce', ton: 'rot' });
    expect(zustellungText({ status: 'sent', deliveryStatus: 'delivered' })).toMatchObject({ wert: 'zugestellt', ton: 'gruen' });
    expect(zustellungText({ status: 'sent', deliveryStatus: null })).toMatchObject({ wert: 'gesendet' });
    expect(zustellungText({ status: 'failed' })).toMatchObject({ wert: 'fehlgeschlagen' });
    expect(zustellungText(null)).toMatchObject({ wert: 'keine' });
  });

  it('Wochen aktiv 0..4; Bewertungslink als nicht messbar beschriftet', () => {
    expect(aktiveWochenText(3)).toBe('3/4 Wochen');
    expect(aktiveWochenText(9)).toBe('4/4 Wochen');
    expect(aktiveWochenText(undefined)).toBe('0/4 Wochen');
    const k = kpiKacheln({ foundingPartners: 2, deliveryTrackingActive: false, newReviews30d: 5, yesTo49: 1, activeLast7d: 1 });
    const reviews = k.find((x) => x.key === 'reviews');
    expect(reviews.label).toMatch(/neue Google-Bewertungen/);
    expect(reviews.label).not.toMatch(/QR/);
    expect(reviews.hinweis).toMatch(/nicht messbar/);
    expect(k.find((x) => x.key === 'deliv').wert).toBe('—');
    expect(k.find((x) => x.key === 'ja').wert).toBe('1');
  });

  it('Zahlungsbereitschaft: dieselben Werte wie das Tor und die Datenbank', () => {
    expect(ZAHLUNGSBEREITSCHAFT.map((z) => z.wert)).toEqual(FP_ZAHLUNGSBEREITSCHAFT);
    expect(labelZahlungsbereitschaft('eher_ja')).toBe('eher ja');
    expect(labelZahlungsbereitschaft(undefined)).toBe('unbekannt');
    const migration = lies('../supabase/migrations/20261109140000_wochenstatus_fp_cockpit.sql');
    FP_ZAHLUNGSBEREITSCHAFT.forEach((w) => expect(migration).toMatch(new RegExp(`'${w}'`)));
  });
});

describe('T14/T15/T25/T26 — das Tor', () => {
  const admin  = { id: '11111111-1111-1111-1111-111111111111', app_metadata: { role: 'admin' } };
  const kunde  = { id: '22222222-2222-2222-2222-222222222222', app_metadata: {} };
  const frech  = { id: '22222222-2222-2222-2222-222222222222', app_metadata: {}, user_metadata: { role: 'admin' } };
  const fp     = '33333333-3333-3333-3333-333333333333';

  it('T14 — Admin darf Cockpit lesen und Feedback setzen', () => {
    expect(pruefeAnfrage({ authUser: admin, aktion: 'fp_cockpit_overview', parameter: {} })).toMatchObject({ erlaubt: true, parameter: {} });
    expect(pruefeAnfrage({ authUser: admin, aktion: 'fp_cockpit_detail', parameter: { userId: fp } })).toMatchObject({ erlaubt: true, parameter: { userId: fp } });
    const u = pruefeAnfrage({ authUser: admin, aktion: 'set_fp_feedback', parameter: { userId: fp, paymentIntent: 'ja', note: ' würde zahlen ' } });
    expect(u).toMatchObject({ erlaubt: true, parameter: { userId: fp, paymentIntent: 'ja', note: 'würde zahlen' } });
  });

  it('T15/T26 — normaler Nutzer: 403 fuer alle drei, auch mit user_metadata.role', () => {
    for (const aktion of ['fp_cockpit_overview', 'fp_cockpit_detail', 'set_fp_feedback']) {
      expect(pruefeAnfrage({ authUser: kunde, aktion, parameter: { userId: fp, paymentIntent: 'ja' } })).toMatchObject({ erlaubt: false, status: 403 });
      expect(pruefeAnfrage({ authUser: frech, aktion, parameter: { userId: fp, paymentIntent: 'ja' } })).toMatchObject({ erlaubt: false, status: 403 });
      expect(pruefeAnfrage({ authUser: null, aktion, parameter: {} })).toMatchObject({ erlaubt: false, status: 401 });
    }
  });

  it('T25 — nur die fuenf Werte; Notiz begrenzt; userId Pflicht', () => {
    expect(pruefeAnfrage({ authUser: admin, aktion: 'set_fp_feedback', parameter: { userId: fp, paymentIntent: 'vielleicht' } })).toMatchObject({ erlaubt: false, status: 400 });
    expect(pruefeAnfrage({ authUser: admin, aktion: 'set_fp_feedback', parameter: { userId: fp, paymentIntent: 'ja', note: 'x'.repeat(2001) } })).toMatchObject({ erlaubt: false, status: 400 });
    expect(pruefeAnfrage({ authUser: admin, aktion: 'set_fp_feedback', parameter: { paymentIntent: 'ja' } })).toMatchObject({ erlaubt: false, status: 400 });
    expect(pruefeAnfrage({ authUser: admin, aktion: 'fp_cockpit_detail', parameter: { userId: 'nicht-uuid' } })).toMatchObject({ erlaubt: false, status: 400 });
    /* nur das Erlaubte kommt durch */
    const u = pruefeAnfrage({ authUser: admin, aktion: 'set_fp_feedback', parameter: { userId: fp, paymentIntent: 'nein', plan: 'pro', note: null } });
    expect(u.parameter).toEqual({ userId: fp, paymentIntent: 'nein', note: null });
    expect(ADMIN_AKTIONEN.set_fp_feedback.schreibt).toBe(true);
    expect(ADMIN_AKTIONEN.fp_cockpit_overview.schreibt).toBe(false);
  });

  it('admin-ops: drei Handler, nur RPCs, Audit beim Schreiben', () => {
    const fn = lies('../supabase/functions/admin-ops/index.ts');
    expect(fn).toMatch(/case 'fp_cockpit_overview':\s*return json\(await fpCockpitUebersicht\(admin\)\)/);
    expect(fn).toMatch(/case 'fp_cockpit_detail':\s*return json\(await fpCockpitDetail\(admin, parameter\.userId as string\)\)/);
    expect(fn).toMatch(/case 'set_fp_feedback':\s*return json\(await setzeFpFeedback\(admin, adminId, parameter\)\)/);
    expect(fn).toMatch(/rpc\('fp_cockpit_overview'\)/);
    expect(fn).toMatch(/rpc\('fp_cockpit_detail', \{ p_user_id: userId \}\)/);
    expect(fn).toMatch(/rpc\('set_founding_partner_feedback', \{\s*p_user_id:\s+userId,\s*p_intent:\s+p\.paymentIntent as string,\s*p_note:[^,]+,\s*p_updated_by: adminId,\s*\}\)/);
    const setze = fn.slice(fn.indexOf('async function setzeFpFeedback'), fn.indexOf('async function listeSupportAnfragen'));
    expect((setze.match(/auditiere\(/g) || []).length).toBe(2);
    /* keine direkte Tabelle fuers Cockpit */
    const cockpit = fn.slice(fn.indexOf('async function fpCockpitUebersicht'), fn.indexOf('async function listeSupportAnfragen'));
    expect(cockpit).not.toMatch(/\.from\(/);
  });

  it('Admin.js rendert das Cockpit nur nach isAdmin', () => {
    const admin = lies('pages/Admin.js');
    expect(admin.indexOf('if (authLoading || !isAdmin) return null;')).toBeLessThan(admin.indexOf('<FoundingPartnerCockpit rufeAdminOps={rufeAdminOps} />'));
  });
});

/* ── Bauteil ── */
const uebersicht = {
  asOf: '2026-11-09T10:00:00Z',
  kpis: { foundingPartners: 2, weeklyDelivered28d: 3, weeklyOpened28d: 2, openRate28d: 0.667, activeLast7d: 1, newReviews30d: 4, yesTo49: 1, deliveryTrackingActive: true, reviewLinkMeasurable: false },
  partners: [
    { userId: 'u1', companyName: 'Malerbetrieb Bosse', fullName: 'Kai Bosse', email: 'kai@bosse.test', foundingPartnerSince: '2026-10-20T00:00:00Z',
      googleConnected: true, connectionStatus: 'active', locationCount: 1, lastGoogleSyncAt: '2026-11-09T06:00:00Z',
      lastWeeklyMail: { sentAt: '2026-11-09T07:00:00Z', status: 'sent', deliveryStatus: 'delivered', firstOpenedAt: '2026-11-09T08:00:00Z', lastOpenedAt: '2026-11-09T08:30:00Z', openCount: 2 },
      tasksCompleted7d: 2, tasksCompleted30d: 5, activeWeeks4: 3, repliesPublished30d: 1, actionLinks30d: 2, lastActionLinkAt: '2026-11-03T09:00:00Z',
      newReviews30d: 3, feedback: { paymentIntent: 'ja', note: 'stark', updatedAt: '2026-11-05T00:00:00Z' } },
    { userId: 'u2', companyName: 'NDB Elektrotechnik', fullName: null, email: 'info@ndb.test', foundingPartnerSince: '2026-10-25T00:00:00Z',
      googleConnected: false, connectionStatus: 'needs_reauth', locationCount: 2, lastGoogleSyncAt: '2026-11-01T06:00:00Z',
      lastWeeklyMail: { sentAt: '2026-11-09T07:00:00Z', status: 'sent', deliveryStatus: 'hard_bounce', firstOpenedAt: null, openCount: 0 },
      tasksCompleted7d: 0, tasksCompleted30d: 0, activeWeeks4: 0, repliesPublished30d: 0, actionLinks30d: 0, lastActionLinkAt: null,
      newReviews30d: 1, feedback: null },
  ],
};
const detailU2 = {
  partner: { ...uebersicht.partners[1],
    locations: [
      { locationId: 'l1', title: 'NDB Stade', locality: 'Stade', selected: true, lastSyncedAt: '2026-11-01T06:00:00Z', tasksOpen: 2, tasksCompleted30d: 0, repliesPublished30d: 0, newReviews30d: 1, actionLinks30d: 0 },
      { locationId: 'l2', title: 'NDB Buxtehude', locality: 'Buxtehude', selected: false, lastSyncedAt: null, tasksOpen: 0, tasksCompleted30d: 0, repliesPublished30d: 0, newReviews30d: 0, actionLinks30d: 0 },
    ],
    accountTasksCompleted30d: 0,
    weeklyMails: [{ emailId: 'm1', createdAt: '2026-11-09T07:00:00Z', status: 'sent', deliveryStatus: 'hard_bounce', firstOpenedAt: null, openCount: 0 }],
  },
};

describe('Bauteil', () => {
  function ops(aufrufe) {
    return jest.fn(async (action, params) => {
      aufrufe.push({ action, params });
      if (action === 'fp_cockpit_overview') return uebersicht;
      if (action === 'fp_cockpit_detail') return params.userId === 'u2' ? detailU2 : { partner: null };
      if (action === 'set_fp_feedback') return { ok: true };
      throw new Error('unbekannt');
    });
  }

  it('T16/T18 — zeigt KPIs und genau die gelieferten Partner, Bewertungslink als nicht messbar', async () => {
    const aufrufe = [];
    render(<FoundingPartnerCockpit rufeAdminOps={ops(aufrufe)} />);
    await waitFor(() => expect(screen.getAllByTestId('fp-zeile')).toHaveLength(2));
    expect(aufrufe[0]).toEqual({ action: 'fp_cockpit_overview', params: undefined });
    const kpis = screen.getByTestId('fp-kpis');
    expect(within(kpis).getByText('67 %')).toBeInTheDocument();
    expect(within(kpis).getByText(/nicht messbar/)).toBeInTheDocument();
    expect(screen.getByText('Malerbetrieb Bosse')).toBeInTheDocument();
    expect(screen.getByText('Hard Bounce')).toBeInTheDocument();
    expect(screen.getByText(/Öffnung erkannt \(2×\)/)).toBeInTheDocument();
    expect(screen.queryByText(/gelesen/)).toBeNull();
    expect(screen.getAllByText('3/4 Wochen')).toHaveLength(1);
  });

  it('T17/T24 — Detail trennt Betriebe; T25 — Feedback speichern geht ueber set_fp_feedback', async () => {
    const aufrufe = [];
    render(<FoundingPartnerCockpit rufeAdminOps={ops(aufrufe)} />);
    await waitFor(() => expect(screen.getAllByTestId('fp-zeile')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('fp-zeile')[1]);
    await waitFor(() => expect(screen.getAllByTestId('fp-betrieb')).toHaveLength(2));
    expect(screen.getByText(/NDB Stade \(gewählt\)/)).toBeInTheDocument();
    expect(screen.getByText('NDB Buxtehude')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Zahlungsbereitschaft'), { target: { value: 'eher_ja' } });
    fireEvent.change(screen.getByLabelText('Notiz'), { target: { value: 'braucht mehrere Standorte' } });
    fireEvent.click(screen.getByText('Speichern'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Gespeichert.'));
    const schreib = aufrufe.find((a) => a.action === 'set_fp_feedback');
    expect(schreib.params).toEqual({ userId: 'u2', paymentIntent: 'eher_ja', note: 'braucht mehrere Standorte' });
    /* danach neu geladen, damit „Ja zu 49 €" stimmt */
    expect(aufrufe.filter((a) => a.action === 'fp_cockpit_overview').length).toBe(2);
  });

  it('Fehler werden gezeigt, nicht verschluckt', async () => {
    const kaputt = jest.fn(async () => { throw new Error('Kein Zugriff'); });
    render(<FoundingPartnerCockpit rufeAdminOps={kaputt} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Kein Zugriff'));
    expect(screen.queryByTestId('fp-zeile')).toBeNull();
  });
});
