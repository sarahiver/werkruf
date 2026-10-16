/**
 * Das Logo in der Kopfzeile.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Bis zum 16.10.2026 war das Logo schlicht `<Link to="/">`. Auf einer
 * Unterseite war das richtig. Auf der Landingpage selbst war es
 * wirkungslos: React Router navigiert auf dieselbe Route, die Seite
 * bleibt stehen, der Besucher bleibt unten.
 *
 * Genau dort greift man aber zum Logo. Ein Klick, der sichtbar nichts
 * tut, ist schlimmer als ein fehlender Knopf — der Besucher hält die
 * Seite für kaputt.
 *
 * Geprüft wird das Verhalten, nicht die Beschriftung: Zielpfad von
 * einer Unterseite, Scrollaufruf auf der Landingpage.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('./context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('./context/IndustryContext', () => ({ useIndustry: jest.fn() }));

const { useAuthContext } = require('./context/AuthContext');
const { useIndustry }    = require('./context/IndustryContext');
const Header = require('./components/Header').default;

const INDUSTRY = {
  brand: { name: 'WERKRUF', logo: 'WERKRUF' },
  pricing: { trialDays: 30 },
};

let scrollSpion;

beforeEach(() => {
  useIndustry.mockReturnValue(INDUSTRY);
  useAuthContext.mockReturnValue({ isAuthenticated: false });
  /* jsdom kennt window.scrollTo nicht als Funktion mit Wirkung —
     geprüft wird deshalb der Aufruf, nicht die Scrollposition. */
  scrollSpion = jest.fn();
  window.scrollTo = scrollSpion;
  jest.clearAllMocks();
});

const mitRoute = (pfad) => render(
  <MemoryRouter initialEntries={[pfad]}><Header /></MemoryRouter>,
);

const logo = () => screen.getByRole('link', { name: /zum Seitenanfang/i });

describe('Logo auf der Landingpage', () => {
  it('scrollt nach oben, statt dieselbe Route erneut zu laden', () => {
    mitRoute('/');
    fireEvent.click(logo());
    expect(scrollSpion).toHaveBeenCalledTimes(1);
    expect(scrollSpion).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 }),
    );
  });

  it('bleibt ein echter Link mit Ziel /', () => {
    /* Kein div mit onClick: Mittelklick, "in neuem Tab öffnen" und
       die Tastatur sollen weiter funktionieren. */
    mitRoute('/');
    expect(logo()).toHaveAttribute('href', '/');
  });
});

describe('Logo auf einer Unterseite', () => {
  /* Diese Gruppe prüfte zunächst, dass von einer Unterseite NICHT
     selbst gescrollt wird — in der Annahme, der Router setze die
     Position beim Seitenwechsel zurück. Die Messung im echten Browser
     widerlegte das: Von /impressum aus, 800px weit unten, wechselte
     der Pfad auf / und die Seite blieb auf 800px stehen. React Router
     fasst die Scrollposition nicht an.

     Der Test hatte die falsche Annahme festgeschrieben. Jetzt prüft er
     das, was der Besucher erwartet: Ziel ist /, und oben. */
  it.each(['/impressum', '/pricing', '/datenschutz', '/hilfe'])(
    'zeigt von %s auf die Startseite, und zwar an deren Anfang',
    (pfad) => {
      mitRoute(pfad);
      expect(logo()).toHaveAttribute('href', '/');
      fireEvent.click(logo());
      expect(scrollSpion).toHaveBeenCalledWith(
        expect.objectContaining({ top: 0, behavior: 'auto' }),
      );
    },
  );
});

describe('Mobilmenü', () => {
  /* `hidden: true`, weil styled-components die Medienabfrage auch in
     jsdom auswertet: Bei der dortigen Standardbreite steht der
     Umschalter auf `display: none` und fällt aus dem
     Barrierefreiheitsbaum. Für die Zustandslogik ist das egal — sie
     hängt am Klick, nicht an der Sichtbarkeit.

     Gelesen wird aria-expanded, nicht die berechnete CSS-Anzeige: Das
     Menü steht immer im DOM, nur seine Darstellung wechselt. Eine
     Prüfung auf `display` würde in jsdom die Medienabfrage für grosse
     Bildschirme treffen und wäre immer "none" — grün, ohne etwas zu
     belegen. */
  const umschalter = () => screen.getByLabelText(/Menü (öffnen|schliessen)/i);

  it('öffnet und schliesst über den Umschalter', () => {
    mitRoute('/');
    expect(umschalter()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(umschalter());
    expect(umschalter()).toHaveAttribute('aria-expanded', 'true');
  });

  it('schliesst sich beim Klick auf das Logo', () => {
    mitRoute('/');
    fireEvent.click(umschalter());
    expect(umschalter()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(logo());
    expect(umschalter()).toHaveAttribute('aria-expanded', 'false');
  });
});
