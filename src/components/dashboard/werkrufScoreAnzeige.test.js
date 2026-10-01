/**
 * WERKRUF Score: Anzeige und Einordnung.
 *
 * Die Einordnung interpretiert vorhandene Faktoren. Sie rechnet nichts
 * nach und erfindet keine Punktzahlen.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

import WerkrufScore, { ordneEin } from './WerkrufScore';

const F = (id, points) => ({ id, points });

/* Der tatsächliche Zustand von S&I am 01.10.: Profil vollständig,
   sonst nichts. */
const FRISCH = [
  F('responseRate', 0), F('rating', 0), F('recency', 0),
  F('completeness', 15), F('photos', 0),
];

describe('Einordnung ohne Bewertungen', () => {
  it('fasst die drei Bewertungsfaktoren zu einer Lücke zusammen', () => {
    /* Drei von fünf Faktoren messen Bewertungen. Ohne eine einzige
       Bewertung sind alle drei bei null — die naive Übersetzung ergäbe
       „es fehlen Antworten auf Bewertungen, Bewertungen und aktuelle
       Bewertungen". Wer keine hat, kann keine beantworten. */
    const { satz } = ordneEin(FRISCH, 0);

    expect(satz).toMatch(/erste Bewertungen/);
    expect(satz).toMatch(/Fotos/);
  });

  it('nennt die Teilfaktoren NICHT einzeln', () => {
    const { satz } = ordneEin(FRISCH, 0);

    expect(satz).not.toMatch(/Antworten auf Bewertungen/);
    expect(satz).not.toMatch(/aktuelle Bewertungen/);
  });

  it('nennt, was vollständig ist', () => {
    const { satz } = ordneEin(FRISCH, 0);
    expect(satz).toMatch(/Profilangaben/);
    expect(satz).toMatch(/vollständig/);
  });

  it('wiederholt die Lücke nicht als „am meisten Luft"', () => {
    /* Sie steht schon im Hauptsatz. */
    expect(ordneEin(FRISCH, 0).schwaeche).toBeNull();
  });

  it('erfindet keine Punktzahlen', () => {
    const { satz } = ordneEin(FRISCH, 0);
    expect(satz).not.toMatch(/\d+ Punkte/);
    expect(satz).not.toMatch(/85/);
  });
});

describe('Einordnung mit Bewertungen', () => {
  it('darf die Antwortquote als eigene Lücke benennen', () => {
    /* Sobald Bewertungen da sind, ist „nicht beantwortet" eine echte,
       eigene Lücke. */
    const mitOffenen = [
      F('responseRate', 0), F('rating', 25), F('recency', 20),
      F('completeness', 15), F('photos', 10),
    ];
    const { satz, schwaeche } = ordneEin(mitOffenen, 12);

    expect(`${satz} ${schwaeche}`).toMatch(/Antworten auf Bewertungen/);
  });

  it('darf fehlende Aktualität benennen', () => {
    const alt = [
      F('responseRate', 30), F('rating', 25), F('recency', 0),
      F('completeness', 15), F('photos', 10),
    ];
    const { satz, schwaeche } = ordneEin(alt, 12);

    expect(`${satz} ${schwaeche}`).toMatch(/aktuelle Bewertungen/);
  });

  it('erzwingt bei exakt gleicher Lücke keinen Sieger', () => {
    const { schwaeche } = ordneEin([F('rating', 5), F('recency', 0)], 5);
    /* Beide Lücken sind 20. */
    expect(schwaeche).toMatch(/mehreren Bereichen/);
  });

  it('benennt den klar größten Rückstand', () => {
    const { schwaeche } = ordneEin(
      [F('responseRate', 0), F('photos', 8), F('completeness', 15)], 10);
    expect(schwaeche).toMatch(/Antworten auf Bewertungen/);
  });

  it('erkennt den vollständig erreichten Zustand', () => {
    const voll = [
      F('responseRate', 30), F('rating', 25), F('recency', 20),
      F('completeness', 15), F('photos', 10),
    ];
    const { satz, schwaeche } = ordneEin(voll, 20);

    expect(satz).toMatch(/in Ordnung/);
    expect(schwaeche).toBeNull();
  });

  it('kommt ohne Faktoren zurecht', () => {
    expect(ordneEin(null).satz).toBe('');
    expect(ordneEin([]).satz).toBe('');
  });
});

describe('Anzeige', () => {
  const score = { score: 15, factors: FRISCH, reviewsTotal: 0, locationTitle: 'S&I.' };

  it('zeigt den Wert mit Bezugsgröße', () => {
    render(<WerkrufScore score={score} />);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('/100')).toBeInTheDocument();
  });

  it('nennt den Wert WERKRUF Score', () => {
    /* Nicht „Google Ranking Score", nicht „Sichtbarkeit bei Google". */
    render(<WerkrufScore score={score} />);
    expect(screen.getByText('WERKRUF Score')).toBeInTheDocument();
  });

  it('stellt klar, dass es kein Google-Ranking ist', () => {
    render(<WerkrufScore score={score} />);
    expect(screen.getByText(/kein Google-Ranking/)).toBeInTheDocument();
  });

  it('benennt den Betrieb', () => {
    render(<WerkrufScore score={score} betrieb="S&I." />);
    expect(screen.getByText('S&I.')).toBeInTheDocument();
  });

  it('zeigt ein Delta nur, wenn eines vorliegt', () => {
    const { rerender } = render(<WerkrufScore score={score} />);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();

    rerender(<WerkrufScore score={{ ...score, delta: 4 }} />);
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('zeigt beim Laden Platzhalter statt einer Null', () => {
    const { container } = render(<WerkrufScore loading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('zeigt bei fehlendem Score keine Null', () => {
    /* Eine 0 sähe aus wie ein schlechter Betrieb. */
    render(<WerkrufScore score={{ score: null, summary: 'Wähle einen Betrieb aus.' }} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByText('Wähle einen Betrieb aus.')).toBeInTheDocument();
  });

  it('bleibt bei niedriger Datenlage sichtbar und erklärt sie', () => {
    render(<WerkrufScore score={score} />);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText(/Für einen höheren Score fehlen/)).toBeInTheDocument();
  });
});

describe('Keine Vermischung mit dem SmartCheck', () => {
  const quelle = require('fs').readFileSync(
    'src/components/dashboard/WerkrufScore.js', 'utf8');

  it('verwendet visibility_score nicht', () => {
    const ohneKommentare = quelle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(ohneKommentare).not.toMatch(/visibility_score/);
  });
});
