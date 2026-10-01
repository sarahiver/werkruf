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

describe('Einordnung', () => {
  it('nennt, was vollständig ist, und was fehlt', () => {
    const { satz } = ordneEin(FRISCH);

    expect(satz).toMatch(/Profilangaben/);
    expect(satz).toMatch(/vollständig/);
    expect(satz).toMatch(/fehlen/);
  });

  it('erfindet keine Punktzahlen', () => {
    /* „85 Punkte fehlen wegen Bewertungen" wäre falsch — die 85
       verteilen sich auf vier Faktoren. */
    const { satz } = ordneEin(FRISCH);
    expect(satz).not.toMatch(/\d+ Punkte/);
    expect(satz).not.toMatch(/85/);
  });

  it('erzwingt keinen Sieger, wenn mehrere gleich schlecht sind', () => {
    /* responseRate und rating sind beide bei 0 — aber die Lücke ist
       unterschiedlich groß (30 gegen 25). */
    const gleich = [F('rating', 0), F('recency', 0)];
    const { schwaeche } = ordneEin([...gleich, F('completeness', 15)]);

    /* rating hat die größere Lücke (25 gegen 20) — also benennbar. */
    expect(schwaeche).toMatch(/Bewertungen/);
  });

  it('sagt bei exakt gleicher Lücke nichts Bestimmtes', () => {
    const { schwaeche } = ordneEin([F('rating', 5), F('recency', 0)]);
    /* Beide Lücken sind 20 — kein Sieger. */
    expect(schwaeche).toMatch(/mehreren Bereichen/);
  });

  it('erkennt den vollständig erreichten Zustand', () => {
    const voll = [
      F('responseRate', 30), F('rating', 25), F('recency', 20),
      F('completeness', 15), F('photos', 10),
    ];
    const { satz, schwaeche } = ordneEin(voll);

    expect(satz).toMatch(/in Ordnung/);
    expect(schwaeche).toBeNull();
  });

  it('kommt ohne Faktoren zurecht', () => {
    expect(ordneEin(null).satz).toBe('');
    expect(ordneEin([]).satz).toBe('');
  });
});

describe('Anzeige', () => {
  const score = { score: 15, factors: FRISCH, locationTitle: 'S&I.' };

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
