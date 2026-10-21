/**
 * Fehlergrenze — statt Weiss eine Seite
 *
 * Bis zum 21.10.2026 gab es keine. Ein Renderfehler irgendwo im Baum
 * hiess: leere Seite, kein Satz, kein Knopf, kein Protokoll.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Fehlergrenze from './Fehlergrenze';

function Explodiert({ wenn }) {
  if (wenn) throw new Error('absichtlich kaputt');
  return <p>alles gut</p>;
}

/* React schreibt bei jedem abgefangenen Fehler zusaetzlich eigene
   Hinweise auf console.error. Die sind hier erwartet und wuerden die
   Ausgabe zumuellen — deshalb stumm, aber mitgezaehlt. */
let fehlerAusgabe;
beforeEach(() => { fehlerAusgabe = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { fehlerAusgabe.mockRestore(); });

describe('Fehlergrenze', () => {
  it('laesst gesunde Kinder unangetastet', () => {
    render(<Fehlergrenze><Explodiert wenn={false} /></Fehlergrenze>);
    expect(screen.getByText('alles gut')).toBeInTheDocument();
    expect(screen.queryByTestId('fehlergrenze')).not.toBeInTheDocument();
  });

  it('zeigt bei einem Renderfehler eine Seite statt nichts', () => {
    render(<Fehlergrenze><Explodiert wenn /></Fehlergrenze>);

    const seite = screen.getByTestId('fehlergrenze');
    expect(seite).toBeInTheDocument();
    expect(seite).toHaveAttribute('role', 'alert');
    expect(screen.getByText(/Da ist etwas schiefgelaufen/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Seite neu laden/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Zur Startseite/i })).toHaveAttribute('href', '/');
    expect(screen.getByText(/info@werkruf\.com/)).toBeInTheDocument();
  });

  it('nennt eine Kennung, die auch im Protokoll steht', () => {
    const gemeldet = jest.fn();
    render(<Fehlergrenze onFehler={gemeldet}><Explodiert wenn /></Fehlergrenze>);

    const kennungText = screen.getByText(/^Kennung /).textContent;
    const kennung = kennungText.replace(/^Kennung /, '').trim();
    expect(kennung).toMatch(/^[A-Z0-9]+-[A-Z0-9]+$/);

    /* Dieselbe Kennung an den Protokollhaken ... */
    expect(gemeldet).toHaveBeenCalledTimes(1);
    expect(gemeldet.mock.calls[0][2]).toBe(kennung);

    /* ... und in console.error, vorn in der Zeile, damit sie auch in
       gekuerzten Ausgaben sichtbar bleibt. */
    const eigene = fehlerAusgabe.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].startsWith('[Fehlergrenze '),
    );
    expect(eigene).toBeDefined();
    expect(eigene[0]).toContain(kennung);
  });

  it('ueberlebt einen werfenden Protokollhaken', () => {
    const kaputterHaken = jest.fn(() => { throw new Error('Haken kaputt'); });
    expect(() => {
      render(<Fehlergrenze onFehler={kaputterHaken}><Explodiert wenn /></Fehlergrenze>);
    }).not.toThrow();
    expect(screen.getByTestId('fehlergrenze')).toBeInTheDocument();
  });

  it('kommt ohne Theme-Variablen aus — die Farben sind fest', () => {
    /* Die Grenze ist der letzte Halt. Haengt sie an denselben Dingen
       wie der Rest, faellt sie mit ihm. Hier gibt es keinen
       ThemeInjector und keine CSS-Variablen — und sie muss trotzdem
       sichtbar sein. */
    render(<Fehlergrenze><Explodiert wenn /></Fehlergrenze>);
    const seite = screen.getByTestId('fehlergrenze');
    expect(seite.style.background).toBe('rgb(0, 44, 81)');
    expect(seite.style.background).not.toContain('var(');
  });
});
