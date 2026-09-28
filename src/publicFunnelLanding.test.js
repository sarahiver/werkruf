/**
 * Verhaltenstests fuer den neuen oeffentlichen Funnel.
 *
 * Geprueft wird die gerenderte Seite, nicht ihr Quelltext: dass der
 * Beispiel-Score aus der kanonischen Berechnung stammt, als Beispiel
 * gekennzeichnet ist, keine Google-Anfrage ausloest, und dass der CTA
 * je nach Anmeldezustand ans richtige Ziel fuehrt.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ExampleScore, { BEISPIEL_BETRIEB, beispielAufgaben } from './components/ExampleScore';
import Hero from './components/Hero';
import HomePage from './pages/HomePage';
import { calculateHealthScoreInputs, HEALTH_WEIGHTS } from './utils/healthScore';
import { PUBLIC_FUNNEL_KEY } from './utils/publicFunnel';

jest.mock('./context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('./context/IndustryContext', () => ({ useIndustry: jest.fn() }));

const { useAuthContext } = require('./context/AuthContext');
const { useIndustry }    = require('./context/IndustryContext');

const INDUSTRY = {
  copy: {
    features: [
      { title: 'Merkmal eins', text: 'Beschreibung eins' },
      { title: 'Merkmal zwei', text: 'Beschreibung zwei' },
    ],
    hero: {
    eyebrow: 'Für Handwerksbetriebe',
    headline: 'Dein Google-Profil',
    headlineAccent: 'in Ordnung',
    subline: 'WERKRUF hält es aktuell.',
    checks: ['Punkt eins', 'Punkt zwei'],
    },
  },
  design: { accentStripePattern: false },
  places: { searchPlaceholder: '', searchHint: '' },
};

beforeEach(() => {
  useIndustry.mockReturnValue(INDUSTRY);
  useAuthContext.mockReturnValue({ isAuthenticated: false });
  window.sessionStorage.clear();
  jest.clearAllMocks();
});

const mitRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Beispiel-Score', () => {
  it('zeigt genau den Wert, den die kanonische Berechnung liefert', () => {
    const erwartet = calculateHealthScoreInputs({
      stats: BEISPIEL_BETRIEB.stats, location: BEISPIEL_BETRIEB.location,
    });
    mitRouter(<ExampleScore />);
    expect(screen.getByText(String(erwartet.score))).toBeInTheDocument();
  });

  it('ist unuebersehbar als Beispiel gekennzeichnet', () => {
    mitRouter(<ExampleScore />);
    expect(screen.getByText(/Beispiel mit erfundenen Daten/i)).toBeInTheDocument();
    expect(screen.getByText(/^Beispiel:/)).toBeInTheDocument();
    expect(screen.getAllByText(/erfundenen Betrieb/i).length).toBeGreaterThanOrEqual(1);
  });

  it('nennt alle fuenf kanonischen Faktoren mit ihrer Gewichtung', () => {
    mitRouter(<ExampleScore />);
    const ergebnis = calculateHealthScoreInputs({
      stats: BEISPIEL_BETRIEB.stats, location: BEISPIEL_BETRIEB.location,
    });
    expect(Object.keys(ergebnis.points)).toHaveLength(5);
    Object.entries(ergebnis.points).forEach(([key, punkte]) => {
      expect(screen.getByText(`${punkte} / ${HEALTH_WEIGHTS[key]}`)).toBeInTheDocument();
    });
  });

  it('sortiert die Aufgaben nach dem schwaechsten Faktor zuerst', () => {
    const { points } = calculateHealthScoreInputs({
      stats: BEISPIEL_BETRIEB.stats, location: BEISPIEL_BETRIEB.location,
    });
    const aufgaben = beispielAufgaben(points);
    expect(aufgaben.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < aufgaben.length; i++) {
      expect(aufgaben[i - 1].anteil).toBeLessThanOrEqual(aufgaben[i].anteil);
    }
    // Voll erreichte Faktoren tauchen nicht als Aufgabe auf.
    aufgaben.forEach((a) => expect(a.anteil).toBeLessThan(1));
  });

  it('macht keine Netzwerkanfrage — der Score kommt aus synthetischen Daten', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('Die Landingpage darf nicht bei Google anfragen');
    });
    mitRouter(<ExampleScore />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('stellt klar, dass es kein Google-Ranking ist', () => {
    mitRouter(<ExampleScore />);
    expect(screen.getByText(/kein Google-Ranking/i)).toBeInTheDocument();
  });
});

describe('Hero-CTA', () => {
  it('fuehrt nicht angemeldete Besucher zur Registrierung', () => {
    useAuthContext.mockReturnValue({ isAuthenticated: false });
    mitRouter(<Hero />);
    const cta = screen.getByRole('link', { name: /Google-Unternehmensprofil verbinden/i });
    expect(cta).toHaveAttribute('href', '/signup');
  });

  it('fuehrt angemeldete Nutzer direkt zur Verbindungsseite', () => {
    useAuthContext.mockReturnValue({ isAuthenticated: true });
    mitRouter(<Hero />);
    const cta = screen.getByRole('link', { name: /Google-Unternehmensprofil verbinden/i });
    expect(cta).toHaveAttribute('href', '/dashboard/google');
  });

  it('bietet bereits Registrierten den Anmeldeweg', () => {
    mitRouter(<Hero />);
    expect(screen.getByRole('link', { name: /^Anmelden$/i })).toHaveAttribute('href', '/login');
  });

  it('behauptet keine Rangverbesserung und keine Zeitzusage', () => {
    mitRouter(<Hero />);
    expect(screen.queryByText(/mehr Anfragen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bis du sichtbarer bist/i)).not.toBeInTheDocument();
  });
});

describe('Landingpage insgesamt', () => {
  it('enthaelt keine oeffentliche PDF-Anforderung mehr', () => {
    mitRouter(<HomePage />);
    expect(screen.queryByText(/PDF-Bericht anfordern/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/kostenlosen PDF-Bericht/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/E-Mail-Adresse/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sicherheitscheck/i)).not.toBeInTheDocument();
  });

  it('bietet kein oeffentliches Suchfeld fuer den Betrieb', () => {
    mitRouter(<HomePage />);
    expect(screen.queryByLabelText(/Betrieb/i)).not.toBeInTheDocument();
  });

  it('raeumt eine alte Funnel-Auswahl aus einer frueheren Sitzung weg', () => {
    window.sessionStorage.setItem(PUBLIC_FUNNEL_KEY, JSON.stringify({
      email: 'alt@example.com',
      result: { placeId: 'ChIJalt', name: 'Alter Betrieb', dataSource: 'places' },
    }));
    mitRouter(<HomePage />);
    expect(window.sessionStorage.getItem(PUBLIC_FUNNEL_KEY)).toBeNull();
  });
});
