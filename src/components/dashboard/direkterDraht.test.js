/**
 * Direkter Draht — Support-Kanal nur fuer Founding Partner
 *
 * Die Datenbankregel prueft supabase/tests/supportAnfragen.test.sql
 * mit echtem Rollenwechsel. Hier geht es um die Oberflaeche: Wer sieht
 * die Karte, was wird gesendet, und was passiert, wenn die Datenbank
 * trotzdem nein sagt.
 *
 * Die tragende Gegenprobe: Ein Nicht-Founding-Partner bekommt nicht
 * nur keine Karte — es wird fuer ihn auch NICHTS abgefragt. Eine
 * unsichtbare Karte, die trotzdem laedt, waere eine stille Last auf
 * jeder Uebersicht aller Kunden.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockFrom = jest.fn();
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { from: (...a) => mockFrom(...a) },
}));

const mockAuth = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => mockAuth(),
}));

import DirekterDraht, {
  pruefeEingabe, BETREFF_MAX, TEXT_MAX, ANTWORT_ZUSAGE,
} from './DirekterDraht';

const FP     = { user: { id: 'u-fp' },    profile: { plan: 'founding_partner' } };
const KUNDE  = { user: { id: 'u-kunde' }, profile: { plan: 'pro' } };

/* Attrappe der Abfragekette. insert() und select().order().limit()
   werden einzeln steuerbar gemacht. */
let insertErgebnis;
let listeErgebnis;
const insertMock = jest.fn();

function kette() {
  return {
    select: () => ({
      order: () => ({ limit: () => Promise.resolve(listeErgebnis) }),
    }),
    insert: (zeile) => { insertMock(zeile); return Promise.resolve(insertErgebnis); },
  };
}

beforeEach(() => {
  mockFrom.mockReset(); insertMock.mockReset(); mockAuth.mockReset();
  mockFrom.mockImplementation(kette);
  insertErgebnis = { data: null, error: null };
  listeErgebnis  = { data: [], error: null };
});

/* ─────────────────────────────────────────────────────────────
   TEIL 1 — Eingabepruefung
   ───────────────────────────────────────────────────────────── */

describe('pruefeEingabe — dieselben Grenzen wie die Datenbank', () => {
  it('nimmt eine ordentliche Anfrage an und trimmt', () => {
    const r = pruefeEingabe({ betreff: '  Frage  ', text: '  Wie trage ich Feiertage ein?  ' });
    expect(r).toEqual({ betreff: 'Frage', text: 'Wie trage ich Feiertage ein?' });
  });

  it('weist zu kurzen Betreff und zu kurzen Text ab', () => {
    expect(pruefeEingabe({ betreff: 'ab', text: 'lang genug, wirklich' }).fehler).toMatch(/Betreff/);
    expect(pruefeEingabe({ betreff: 'Frage', text: 'kurz' }).fehler).toMatch(/Anliegen/);
  });

  it('weist zu lange Eingaben ab — exakt an der Grenze der CHECK-Constraints', () => {
    expect(pruefeEingabe({ betreff: 'x'.repeat(BETREFF_MAX), text: 'y'.repeat(10) }).fehler).toBeUndefined();
    expect(pruefeEingabe({ betreff: 'x'.repeat(BETREFF_MAX + 1), text: 'y'.repeat(10) }).fehler).toMatch(/höchstens/);
    expect(pruefeEingabe({ betreff: 'Frage', text: 'y'.repeat(TEXT_MAX) }).fehler).toBeUndefined();
    expect(pruefeEingabe({ betreff: 'Frage', text: 'y'.repeat(TEXT_MAX + 1) }).fehler).toMatch(/höchstens/);
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 2 — Sichtbarkeit
   ───────────────────────────────────────────────────────────── */

describe('DirekterDraht — wer sieht ihn', () => {
  it('zeigt Founding Partnern die Karte', async () => {
    mockAuth.mockReturnValue(FP);
    render(<DirekterDraht />);
    expect(screen.getByTestId('direkter-draht')).toBeInTheDocument();
    expect(screen.getByText(/Direkter Draht/)).toBeInTheDocument();
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('support_requests'));
  });

  /* ── GEGENPROBE ── */
  it('zeigt anderen Kunden NICHTS — und fragt fuer sie auch nichts ab', async () => {
    mockAuth.mockReturnValue(KUNDE);
    const { container } = render(<DirekterDraht />);
    expect(container).toBeEmptyDOMElement();
    /* Kurz warten, damit ein faelschlicher Effekt Zeit haette. */
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('zeigt ohne Profil nichts', () => {
    mockAuth.mockReturnValue({ user: { id: 'u' }, profile: null });
    const { container } = render(<DirekterDraht />);
    expect(container).toBeEmptyDOMElement();
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 3 — Senden
   ───────────────────────────────────────────────────────────── */

const tippen = (betreff, text) => {
  fireEvent.change(screen.getByLabelText(/Betreff/), { target: { value: betreff } });
  fireEvent.change(screen.getByLabelText(/Nachricht/), { target: { value: text } });
};

describe('DirekterDraht — Senden', () => {
  it('sendet genau user_id, subject und body — und keinen Status', async () => {
    mockAuth.mockReturnValue(FP);
    render(<DirekterDraht />);
    tippen('Feiertage', 'Wie trage ich Feiertage in die Öffnungszeiten ein?');
    fireEvent.click(screen.getByRole('button', { name: /Absenden/ }));

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const zeile = insertMock.mock.calls[0][0];
    expect(zeile).toEqual({
      user_id: 'u-fp',
      subject: 'Feiertage',
      body: 'Wie trage ich Feiertage in die Öffnungszeiten ein?',
    });
    /* Die Insert-Policy verlangt status = 'open' als Vorgabe. Ein
       mitgeschickter Status — egal welcher — waere ein Fehler. */
    expect(Object.keys(zeile)).not.toContain('status');

    expect(await screen.findByRole('status')).toHaveTextContent(ANTWORT_ZUSAGE);
    /* Felder geleert. */
    expect(screen.getByLabelText(/Betreff/).value).toBe('');
  });

  it('sendet bei ungueltiger Eingabe nichts und erklaert warum', async () => {
    mockAuth.mockReturnValue(FP);
    render(<DirekterDraht />);
    tippen('Hi', 'zu kurz');
    fireEvent.click(screen.getByRole('button', { name: /Absenden/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Betreff/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('nennt die RLS-Abweisung beim Namen, statt sie zu verschlucken', async () => {
    /* Karte sichtbar, Datenbank sagt trotzdem nein — der Fall, in dem
       das Profil im Browser und der Plan in der Datenbank
       auseinanderliegen. */
    mockAuth.mockReturnValue(FP);
    insertErgebnis = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
    render(<DirekterDraht />);
    tippen('Frage', 'Eine ganz normale Frage an euch.');
    fireEvent.click(screen.getByRole('button', { name: /Absenden/ }));

    const alarm = await screen.findByRole('alert');
    expect(alarm).toHaveTextContent(/nicht als Founding Partner freigeschaltet/);
    expect(alarm).toHaveTextContent(/info@werkruf\.com/);
    /* Eingabe bleibt stehen — der Nutzer soll sie nicht neu tippen. */
    expect(screen.getByLabelText(/Betreff/).value).toBe('Frage');
  });

  it('zeigt eigene Anfragen mit Status', async () => {
    mockAuth.mockReturnValue(FP);
    listeErgebnis = { data: [
      { id: 'a1', subject: 'Erste Frage',  status: 'open',     created_at: new Date().toISOString(), answered_at: null },
      { id: 'a2', subject: 'Zweite Frage', status: 'answered', created_at: new Date().toISOString(), answered_at: new Date().toISOString() },
    ], error: null };
    render(<DirekterDraht />);

    expect(await screen.findByText('Erste Frage')).toBeInTheDocument();
    expect(screen.getByText('Zweite Frage')).toBeInTheDocument();
    expect(screen.getByText('Offen')).toBeInTheDocument();
    expect(screen.getByText('Beantwortet')).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 4 — Antwort des Anbieters (22.10.2026)
   ───────────────────────────────────────────────────────────── */

describe('DirekterDraht — Antwort unter der Anfrage', () => {
  it('zeigt die Antwort, wenn eine da ist, und fragt die Spalten dafuer ab', async () => {
    mockAuth.mockReturnValue(FP);
    const selectMock = jest.fn(() => ({ order: () => ({ limit: () => Promise.resolve(listeErgebnis) }) }));
    mockFrom.mockImplementation(() => ({ select: selectMock, insert: () => Promise.resolve(insertErgebnis) }));
    listeErgebnis = { data: [
      { id: 'a1', subject: 'Feiertage', status: 'answered', created_at: '2026-10-22T08:00:00Z',
        answered_at: '2026-10-22T09:00:00Z', admin_reply: 'Unter Öffnungszeiten → Sonderzeiten.', replied_at: '2026-10-22T09:00:00Z' },
      { id: 'a2', subject: 'Noch offen', status: 'open', created_at: '2026-10-22T10:00:00Z',
        answered_at: null, admin_reply: null, replied_at: null },
    ], error: null };
    render(<DirekterDraht />);
    const antworten = await screen.findAllByTestId('support-antwort');
    expect(antworten).toHaveLength(1);
    expect(antworten[0]).toHaveTextContent('Unter Öffnungszeiten → Sonderzeiten.');
    expect(antworten[0]).toHaveTextContent(/Antwort von WERKRUF/);
    expect(selectMock.mock.calls[0][0]).toMatch(/admin_reply/);
    expect(selectMock.mock.calls[0][0]).toMatch(/replied_at/);
  });

  /* ── GEGENPROBE ── */
  it('zeigt ohne Antwort keinen Antwortblock', async () => {
    mockAuth.mockReturnValue(FP);
    listeErgebnis = { data: [
      { id: 'a2', subject: 'Noch offen', status: 'open', created_at: '2026-10-22T10:00:00Z', answered_at: null, admin_reply: null, replied_at: null },
    ], error: null };
    render(<DirekterDraht />);
    await screen.findByText('Noch offen');
    expect(screen.queryByTestId('support-antwort')).not.toBeInTheDocument();
  });
});
