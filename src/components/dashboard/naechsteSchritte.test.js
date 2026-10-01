/**
 * Deine nächsten Schritte.
 *
 * Schwerpunkt: Die Darstellung trifft keine fachliche Entscheidung.
 * Was gezeigt wird, kommt aus dem Feed — Reihenfolge, Dringlichkeit
 * und Existenz der Aufgabe inbegriffen.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

import NaechsteSchritte, { stufeFuer, aufwandText, anzeigeTitel }
  from './NaechsteSchritte';

const E = (ueberschreibung = {}) => ({
  id: 'e1', type: 'profile.photos_missing', category: 'profile',
  priority: 29, title: '5 Fotos hochladen', summary: 'Keine Fotos hinterlegt.',
  reason: 'Profile ohne Bilder werden seltener angeklickt.',
  impact: 'Interessenten sehen, wie der Betrieb arbeitet',
  estimatedMinutes: 5, actionUrl: '/dashboard/fotos',
  isDismissable: true, lifecycle: 'new', data: {},
  ...ueberschreibung,
});

const klicke = async (el) => { await act(async () => { fireEvent.click(el); }); };

describe('Prioritätsdarstellung', () => {
  it('stellt eine niedrige Priorität ruhig dar', () => {
    /* 29 von 100 ist kein Notfall. Rot darzustellen hiesse,
       Dringlichkeit zu suggerieren, die die Engine nicht gemeint hat —
       und beim nächsten echten Notfall glaubt der Kunde sie nicht. */
    const stufe = stufeFuer(29);
    expect(stufe.name).toBe('wenn du Zeit hast');
    expect(stufe.farbe).not.toBe('#D93025');
  });

  it('staffelt nach oben', () => {
    expect(stufeFuer(95).name).toBe('kritisch');
    expect(stufeFuer(70).name).toBe('wichtig');
    expect(stufeFuer(45).name).toBe('hilfreich');
  });

  it('nennt die Stufe als Text, nicht nur als Farbe', () => {
    render(<NaechsteSchritte events={[E()]} />);
    expect(screen.getByText('wenn du Zeit hast')).toBeInTheDocument();
  });
});

describe('Aufwand', () => {
  it('formatiert Minuten', () => {
    expect(aufwandText(1)).toBe('1 Minute');
    expect(aufwandText(5)).toBe('5 Minuten');
  });

  it('zeigt nichts ohne Angabe', () => {
    /* Die Engine liefert estimatedMinutes; fehlt es, wird nichts
       erfunden. */
    expect(aufwandText(null)).toBeNull();
    expect(aufwandText(0)).toBeNull();
  });
});

describe('Titel', () => {
  it('übernimmt den Engine-Titel unverändert', () => {
    /* Eine Umformulierung bei null Fotos war geplant, scheitert aber
       an den Daten: Die Regel legt keine Fotozahl in `data` ab. Eine
       Bedingung darauf wäre nie wahr geworden — die Oberfläche hätte
       ausgesehen, als täte sie etwas. */
    expect(anzeigeTitel(E())).toBe('5 Fotos hochladen');
    expect(anzeigeTitel(E({ type: 'reviews.unanswered', title: 'Bewertung beantworten' })))
      .toBe('Bewertung beantworten');
  });

  it('kommt ohne Titel zurecht', () => {
    expect(anzeigeTitel({})).toBe('Aufgabe');
    expect(anzeigeTitel(null)).toBe('Aufgabe');
  });
});

describe('Die vier Zustände', () => {
  it('zeigt beim Laden Platzhalter, nicht „Alles erledigt"', () => {
    /* Ein kurz aufblitzendes „nichts zu tun" wäre eine Falschaussage. */
    const { container } = render(<NaechsteSchritte events={[]} loading />);
    expect(screen.queryByText(/Alles erledigt/)).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('zeigt „Alles erledigt" bei leerem Feed', () => {
    render(<NaechsteSchritte events={[]} />);
    expect(screen.getByText(/Alles erledigt/)).toBeInTheDocument();
    expect(screen.getByText(/beobachtet dein Profil weiter/)).toBeInTheDocument();
  });

  it('zeigt bei fehlender Auswahl den Auswahl-Zustand, keine Aufgaben', () => {
    render(<NaechsteSchritte events={[E()]} standortAuswahlNoetig />);

    expect(screen.getByText(/Welchen Betrieb möchtest du ansehen/)).toBeInTheDocument();
    /* Keine Aufgaben irgendeines Betriebs. */
    expect(screen.queryByText(/Foto hochladen/)).not.toBeInTheDocument();
  });

  it('zeigt bei einem Fehler keinen Rückfall auf eigene Aufgaben', () => {
    render(<NaechsteSchritte events={[]} fehler="Netzwerk weg" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/nicht geladen werden/);
    expect(screen.getByText('Netzwerk weg')).toBeInTheDocument();
    expect(screen.queryByText(/Alles erledigt/)).not.toBeInTheDocument();
  });

  it('unterscheidet leeren Feed von Fehler', () => {
    const { rerender } = render(<NaechsteSchritte events={[]} />);
    expect(screen.getByText(/Alles erledigt/)).toBeInTheDocument();

    rerender(<NaechsteSchritte events={[]} fehler="kaputt" />);
    expect(screen.queryByText(/Alles erledigt/)).not.toBeInTheDocument();
  });
});

describe('Keine eigene Fachlogik', () => {
  it('zeigt genau die gelieferten Aufgaben', () => {
    render(<NaechsteSchritte events={[E(), E({ id: 'e2', title: 'Bewertung beantworten', type: 'x' })]} />);

    expect(screen.getByText('5 Fotos hochladen')).toBeInTheDocument();
    expect(screen.getByText('Bewertung beantworten')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('behält die Reihenfolge des Feeds bei', () => {
    /* Nicht neu sortieren — die Engine hat entschieden. Eine
       Umsortierung nach Aufwand oder Kategorie wäre eine zweite
       Priorisierung. */
    const karten = render(
      <NaechsteSchritte events={[
        E({ id: 'a', title: 'Erste', priority: 20, type: 'x' }),
        E({ id: 'b', title: 'Zweite', priority: 90, type: 'y' }),
      ]} />,
    ).container.querySelectorAll('article h3');

    expect(karten[0]).toHaveTextContent('Erste');
    expect(karten[1]).toHaveTextContent('Zweite');
  });

  it('zeigt keine vierte Aufgabe, wenn drei kommen', () => {
    render(<NaechsteSchritte events={[
      E({ id: 'a', type: 'a' }), E({ id: 'b', type: 'b' }), E({ id: 'c', type: 'c' }),
    ]} />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});

describe('Aktionen', () => {
  it('verlinkt auf die actionUrl der Engine', () => {
    render(<NaechsteSchritte events={[E()]} />);
    expect(screen.getByRole('link', { name: /Erledigen/ }))
      .toHaveAttribute('href', '/dashboard/fotos');
  });

  it('rendert keinen Knopf ohne Ziel', () => {
    /* Eine Route zu erraten wäre schlimmer als keine anzubieten. */
    render(<NaechsteSchritte events={[E({ actionUrl: null })]} />);
    expect(screen.queryByRole('link', { name: /Erledigen/ })).not.toBeInTheDocument();
  });

  it('meldet den Klick, ohne die Navigation zu blockieren', async () => {
    const geoeffnet = jest.fn();
    render(<NaechsteSchritte events={[E()]} onGeoeffnet={geoeffnet} />);

    const link = screen.getByRole('link', { name: /Erledigen/ });
    await klicke(link);

    expect(geoeffnet).toHaveBeenCalledWith('e1');
    /* Der Link bleibt ein Link — die Navigation hängt nicht am
       Tracking. */
    expect(link).toHaveAttribute('href', '/dashboard/fotos');
  });

  it('bietet Ausblenden nur bei dismissable', () => {
    const { rerender } = render(<NaechsteSchritte events={[E()]} />);
    expect(screen.getByRole('button', { name: /ausblenden/i })).toBeInTheDocument();

    rerender(<NaechsteSchritte events={[E({ isDismissable: false })]} />);
    expect(screen.queryByRole('button', { name: /ausblenden/i })).not.toBeInTheDocument();
  });

  it('meldet das Ausblenden mit der Event-ID', async () => {
    const weggeklickt = jest.fn();
    render(<NaechsteSchritte events={[E()]} onWeggeklickt={weggeklickt} />);
    await klicke(screen.getByRole('button', { name: /ausblenden/i }));

    expect(weggeklickt).toHaveBeenCalledWith('e1');
  });
});
