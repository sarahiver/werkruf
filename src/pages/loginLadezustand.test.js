/**
 * Login im Ladezustand — die Seite darf beim Klick nicht sterben
 *
 * ═══════════════════════════════════════════════════════════════
 * ANLASS
 * ═══════════════════════════════════════════════════════════════
 *
 * 22.10.2026: Klick auf „Mit Google einloggen" → sofort die
 * Fehlergrenze, dann trotzdem Googles Kontoauswahl. Ursache in
 * Login.js Zeile 253: ein styled-components-keyframes-Objekt in einem
 * UNGETAGGTEN Template-String fuer ein Inline-style. Die Bibliothek
 * wirft dabei beim Rendern — und zwar genau dann, wenn loading auf
 * true springt, also bei jedem Klick auf einen Anmeldeknopf.
 *
 * Das war auch die weisse Seite vom 21.10. auf dem Behoerdenrechner.
 * Ohne Fehlergrenze: Weiss. Mit Google ging es weiter, weil die
 * Weiterleitung den Absturz ueberholte.
 *
 * ═══════════════════════════════════════════════════════════════
 * ZWEI PRUEFUNGEN
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. Verhalten: Login rendert mit loading = true, ohne zu werfen.
 *      Dafuer bleibt signInEmail absichtlich unaufgeloest — so bleibt
 *      der Ladezustand stehen und der Spinner MUSS rendern.
 *   2. Muster: Nirgends in src/ steht ein keyframes-Objekt in einem
 *      ungetaggten String. Das faengt die Klasse, nicht nur die
 *      Instanz — Signup.js hatte es richtig, Login.js nicht, und
 *      niemand hat den Unterschied gesehen.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/* Login importiert VERWAIST_MARKER aus useAuth, und der zieht den
   Supabase-Client herein, der beim Laden Env-Werte verlangt. Hier
   geht es nicht um Netz — nachgebildet. */
jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));

const mockAuth = jest.fn();
jest.mock('../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => mockAuth(),
}));
jest.mock('../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF', logo: 'WERKRUF' } }),
}));
jest.mock('../utils/postAuthDestination', () => ({
  getPostAuthDestination: jest.fn(() => Promise.resolve('/dashboard')),
}));

import Login from './Login';

/* Ein Versprechen, das nie eingeloest wird: Der Ladezustand bleibt
   stehen, und genau den wollen wir rendern sehen. */
const nieFertig = () => new Promise(() => {});

beforeEach(() => {
  window.sessionStorage.clear();
  mockAuth.mockReturnValue({
    isAuthenticated: false, recoveryMode: false,
    signInGoogle: jest.fn(nieFertig),
    signInEmail:  jest.fn(nieFertig),
  });
});

const seite = () => render(<MemoryRouter><Login /></MemoryRouter>);

describe('Login — Ladezustand', () => {
  it('rendert nach Klick auf „Einloggen" den Spinner, statt zu werfen', async () => {
    seite();
    fireEvent.change(screen.getByPlaceholderText(/deine@email/i), { target: { value: 'test@example.invalid' } });
    fireEvent.change(screen.getByPlaceholderText(/Dein Passwort/i), { target: { value: 'geheim123' } });

    /* Ein Renderfehler wuerde hier als Exception aus fireEvent/React
       hochkommen und den Test rot machen. */
    fireEvent.click(screen.getByRole('button', { name: /^Einloggen/ }));

    await waitFor(() => expect(screen.getByText(/Einloggen…/)).toBeInTheDocument());
    expect(document.querySelector('.spin')).not.toBeNull();
    /* Der Knopf ist waehrend des Ladens gesperrt. */
    expect(screen.getByRole('button', { name: /Einloggen…/ })).toBeDisabled();
  });

  it('rendert nach Klick auf „Mit Google einloggen" weiter, statt zu werfen', async () => {
    seite();
    fireEvent.click(screen.getByRole('button', { name: /Mit Google einloggen/ }));
    /* Beide Knoepfe gesperrt, Seite steht noch. */
    await waitFor(() => expect(screen.getByRole('button', { name: /Mit Google einloggen/ })).toBeDisabled());
    expect(screen.getByText(/Willkommen zurück/i)).toBeInTheDocument();
  });
});

describe('Muster: keyframes nur in getaggten Templates', () => {
  it('interpoliert nirgends in src/ ein keyframes-Objekt in einen gewoehnlichen String', () => {
    const wurzel = path.resolve(__dirname, '..');
    const treffer = [];

    const lauf = (ordner) => {
      for (const name of fs.readdirSync(ordner)) {
        const voll = path.join(ordner, name);
        if (fs.statSync(voll).isDirectory()) { lauf(voll); continue; }
        if (!/\.jsx?$/.test(name) || /\.test\.jsx?$/.test(name)) continue;
        const quelle = fs.readFileSync(voll, 'utf8');

        /* Namen aller keyframes-Konstanten in dieser Datei. */
        const namen = [...quelle.matchAll(/const\s+(\w+)\s*=\s*keyframes`/g)].map((m) => m[1]);
        if (namen.length === 0) continue;

        /* Jede Interpolation eines dieser Namen, die NICHT in einem
           styled-/css-/keyframes-Template steht. Heuristik: steht die
           Interpolation innerhalb von style={{ … }} oder in einem
           Template-String, der nach einem ':' oder '=' beginnt, ist
           es ein ungetaggter String. */
        for (const n of namen) {
          const re = new RegExp('(style=\\{\\{[^}]*|[:=]\\s*)`[^`]*\\$\\{' + n + '\\}', 'g');
          for (const m of quelle.matchAll(re)) {
            const zeile = quelle.slice(0, m.index).split('\n').length;
            treffer.push(`${path.relative(wurzel, voll)}:${zeile} — \${${n}} in ungetaggtem String`);
          }
        }
      }
    };
    lauf(wurzel);

    expect(treffer).toEqual([]);
  });
});
