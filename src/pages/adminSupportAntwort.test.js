/**
 * Direkter Draht im Admin — Antwort aus dem Produkt (22.10.2026)
 *
 * Bis dahin: "Als beantwortet markieren" und "Erledigt", Antworten per
 * Mailprogramm. Jetzt steht ein Antwortfeld da. Die tragenden
 * Prüfungen sind die Gegenproben: Ein leeres Feld schickt NICHTS,
 * ein Fehler lässt den Entwurf stehen, und die Anfrage verschwindet
 * erst aus "offen", wenn der Server die Antwort angenommen hat.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

import Admin from './Admin';

jest.mock('../context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

const { useAuthContext } = require('../context/AuthContext');
const supabase = require('../supabaseClient').default;

const ANFRAGE_ID = '22222222-2222-4222-8222-222222222222';
const anfrage = (u = {}) => ({
  id: ANFRAGE_ID, betreff: 'Feiertage eintragen', text: 'Wie trage ich Feiertage ein?',
  betrieb: 'Sanitär Müller', email: 'chef@mueller.test', seit: '2026-10-22T08:00:00Z', status: 'open',
  ...u,
});

let aufrufe;
let antwortErgebnis;

const richteEin = ({ anfragen = [anfrage()] } = {}) => {
  aufrufe = [];
  antwortErgebnis = { data: { ok: true, requestId: ANFRAGE_ID, status: 'answered' }, error: null };
  useAuthContext.mockImplementation(() => ({ isAdmin: true, signOut: jest.fn(), loading: false }));
  supabase.from.mockImplementation(() => ({
    select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
  }));
  supabase.functions.invoke.mockImplementation((name, { body }) => {
    aufrufe.push({ name, ...body });
    if (body.action === 'list_customers')         return Promise.resolve({ data: { customers: [] }, error: null });
    if (body.action === 'list_support_requests')  return Promise.resolve({ data: { requests: anfragen }, error: null });
    if (body.action === 'reply_support_request')  return Promise.resolve(antwortErgebnis);
    return Promise.resolve({ data: { ok: true }, error: null });
  });
};

const zeige = async () => { await act(async () => { render(<Admin />); }); };
const antwortAufrufe = () => aufrufe.filter((a) => a.action === 'reply_support_request');

describe('Admin — Antwort auf Supportanfrage', () => {
  it('zeigt pro offener Anfrage ein Antwortfeld und keinen Mailto-Link mehr', async () => {
    richteEin();
    await zeige();
    const bereich = await screen.findByTestId('admin-support');
    expect(within(bereich).getByLabelText('Deine Antwort')).toBeInTheDocument();
    expect(within(bereich).getByRole('button', { name: /Antworten & senden/ })).toBeInTheDocument();
    expect(bereich.querySelector('a[href^="mailto:"]')).toBeNull();
    /* Die Mailadresse bleibt lesbar — zur Information. */
    expect(within(bereich).getByText('chef@mueller.test')).toBeInTheDocument();
  });

  /* ── GEGENPROBE ── */
  it('schickt mit leerem Feld NICHTS — der Knopf ist gesperrt', async () => {
    richteEin();
    await zeige();
    const knopf = await screen.findByRole('button', { name: /Antworten & senden/ });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    /* Auch Leerzeichen zählen nicht. */
    fireEvent.change(screen.getByLabelText('Deine Antwort'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /Antworten & senden/ })).toBeDisabled();
    expect(antwortAufrufe()).toHaveLength(0);
  });

  it('schickt genau requestId und den getrimmten Text über admin-ops und nimmt die Anfrage aus "offen"', async () => {
    richteEin();
    await zeige();
    await screen.findByTestId('admin-support');
    fireEvent.change(screen.getByLabelText('Deine Antwort'), { target: { value: '  Unter Öffnungszeiten → Sonderzeiten.  ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Antworten & senden/ })); });

    expect(antwortAufrufe()).toHaveLength(1);
    const { name, action, params } = antwortAufrufe()[0];
    expect(name).toBe('admin-ops');
    expect(action).toBe('reply_support_request');
    expect(params).toEqual({ requestId: ANFRAGE_ID, reply: 'Unter Öffnungszeiten → Sonderzeiten.' });
    /* Nicht set_support_status daneben — die Funktion setzt den Status selbst. */
    expect(aufrufe.some((a) => a.action === 'set_support_status')).toBe(false);

    await waitFor(() => expect(screen.queryByText('Wie trage ich Feiertage ein?')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/Mail ist eingereiht/);
  });

  /* ── GEGENPROBE ── */
  it('lässt bei einem Fehler den Entwurf stehen und die Anfrage in "offen"', async () => {
    richteEin();
    await zeige();
    await screen.findByTestId('admin-support');
    antwortErgebnis = { data: null, error: { message: 'Supportanfrage nicht gefunden' } };

    fireEvent.change(screen.getByLabelText('Deine Antwort'), { target: { value: 'Mein Entwurf' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Antworten & senden/ })); });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Deine Antwort')).toHaveValue('Mein Entwurf');
    expect(screen.getByText('Wie trage ich Feiertage ein?')).toBeInTheDocument();
  });

  it('bietet "Erledigt ohne Antwort" weiter an — für Anfragen, die keine Antwort brauchen', async () => {
    richteEin();
    await zeige();
    await screen.findByTestId('admin-support');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Erledigt ohne Antwort/ })); });
    const s = aufrufe.find((a) => a.action === 'set_support_status');
    expect(s.params).toMatchObject({ requestId: ANFRAGE_ID, status: 'closed' });
    expect(antwortAufrufe()).toHaveLength(0);
  });
});
