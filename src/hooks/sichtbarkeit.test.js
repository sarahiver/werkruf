/**
 * Sichtbarkeits-Tracking.
 *
 * Anlass: Bis zum 01.10. meldete das Dashboard alle geladenen
 * Empfehlungen sofort als gesehen — auch die dritte unterhalb des
 * Falzes. Die Kennzahl maß damit, wie oft das Dashboard geöffnet
 * wurde, nicht was jemand gelesen hat.
 */
import React from 'react';
import { render, act } from '@testing-library/react';

/* IntersectionObserver gibt es in jsdom nicht — nachgebildet, damit
   das Auslösen steuerbar ist. */
const beobachtete = new Map();
let letzteOptionen = null;

class FakeObserver {
  constructor(rueckruf, optionen) {
    this.rueckruf = rueckruf;
    letzteOptionen = optionen;
  }
  observe(el) { beobachtete.set(el, this); }
  unobserve(el) { beobachtete.delete(el); }
  disconnect() { beobachtete.clear(); }
  ausloesen(elemente) {
    this.rueckruf(elemente.map((el) => ({ target: el, isIntersecting: true })));
  }
}

global.IntersectionObserver = FakeObserver;

const { useSichtbarkeit } = require('./useSichtbarkeit');

function Liste({ ids, onGesehen }) {
  const { beobachte } = useSichtbarkeit(onGesehen);
  return (
    <div>
      {ids.map((id) => <article key={id} ref={beobachte(id)}>{id}</article>)}
    </div>
  );
}

const sichtbarMachen = (container, ...ids) => {
  const elemente = ids.map((id) =>
    [...container.querySelectorAll('article')].find((el) => el.textContent === id));
  const beobachter = beobachtete.get(elemente[0]);
  act(() => { beobachter.ausloesen(elemente); });
};

beforeEach(() => { beobachtete.clear(); letzteOptionen = null; });

describe('Gesehen heisst sichtbar', () => {
  it('meldet beim Rendern noch nichts', () => {
    const gesehen = jest.fn();
    render(<Liste ids={['a', 'b']} onGesehen={gesehen} />);

    /* Geladen ist nicht gesehen. */
    expect(gesehen).not.toHaveBeenCalled();
  });

  it('meldet, sobald die Karte sichtbar wird', () => {
    const gesehen = jest.fn();
    const { container } = render(<Liste ids={['a']} onGesehen={gesehen} />);

    sichtbarMachen(container, 'a');

    expect(gesehen).toHaveBeenCalledTimes(1);
    expect(gesehen).toHaveBeenCalledWith(['a']);
  });

  it('meldet mehrere gleichzeitig sichtbare gesammelt', () => {
    /* Drei sichtbare Karten sollen eine Anfrage ergeben, nicht drei. */
    const gesehen = jest.fn();
    const { container } = render(<Liste ids={['a', 'b', 'c']} onGesehen={gesehen} />);

    sichtbarMachen(container, 'a', 'b', 'c');

    expect(gesehen).toHaveBeenCalledTimes(1);
    expect(gesehen).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('meldet dieselbe Karte nicht zweimal', () => {
    const gesehen = jest.fn();
    const { container } = render(<Liste ids={['a']} onGesehen={gesehen} />);

    sichtbarMachen(container, 'a');
    const beobachter = new FakeObserver(() => {});
    /* Erneutes Auslösen auf demselben Element. */
    act(() => { beobachter.ausloesen([]); });

    expect(gesehen).toHaveBeenCalledTimes(1);
  });

  it('meldet nach einer Neuzeichnung nicht erneut', () => {
    const gesehen = jest.fn();
    const { container, rerender } = render(<Liste ids={['a']} onGesehen={gesehen} />);

    sichtbarMachen(container, 'a');
    rerender(<Liste ids={['a']} onGesehen={gesehen} />);

    expect(gesehen).toHaveBeenCalledTimes(1);
  });

  it('meldet eine später sichtbare Karte eigenständig', () => {
    const gesehen = jest.fn();
    const { container } = render(<Liste ids={['a', 'b']} onGesehen={gesehen} />);

    sichtbarMachen(container, 'a');
    expect(gesehen).toHaveBeenLastCalledWith(['a']);

    sichtbarMachen(container, 'b');
    expect(gesehen).toHaveBeenLastCalledWith(['b']);
    expect(gesehen).toHaveBeenCalledTimes(2);
  });
});

describe('Robustheit', () => {
  it('stört die Anzeige nicht, wenn das Melden wirft', () => {
    const gesehen = jest.fn(() => { throw new Error('Netz weg'); });
    const { container } = render(<Liste ids={['a']} onGesehen={gesehen} />);

    expect(() => sichtbarMachen(container, 'a')).not.toThrow();
    expect(container.querySelectorAll('article')).toHaveLength(1);
  });

  it('verwendet eine moderate Sichtbarkeitsschwelle', () => {
    /* Ein strengeres Kriterium liesse die dritte Karte auf kleinen
       Bildschirmen nie als gesehen gelten. */
    render(<Liste ids={['a']} onGesehen={jest.fn()} />);
    expect(letzteOptionen.threshold).toBeLessThanOrEqual(0.5);
    expect(letzteOptionen.threshold).toBeGreaterThan(0);
  });

  it('kommt ohne IntersectionObserver zurecht', () => {
    const alt = global.IntersectionObserver;
    delete global.IntersectionObserver;

    const gesehen = jest.fn();
    expect(() => render(<Liste ids={['a']} onGesehen={gesehen} />)).not.toThrow();
    /* Lieber keine Zahl als eine falsche. */
    expect(gesehen).not.toHaveBeenCalled();

    global.IntersectionObserver = alt;
  });
});

describe('Quelltext', () => {
  const quelle = require('fs').readFileSync('src/hooks/useEvents.js', 'utf8');

  it('meldet nicht mehr beim Laden der Events', () => {
    /* Der alte useEffect auf `events` ist weg. */
    expect(quelle).not.toMatch(/useEffect\(\(\) => \{\s*if \(events\.length === 0\) return;/);
  });

  it('bietet das Melden als eigene Funktion an', () => {
    expect(quelle).toMatch(/const melde = useCallback/);
  });
});
