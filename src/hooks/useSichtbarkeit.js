import React from 'react';

/**
 * Meldet eine Empfehlung, sobald ihre Karte tatsächlich sichtbar war.
 *
 * Geladen ist nicht gesehen. Alle drei Karten beim Abruf als gesehen
 * zu melden, während zwei davon unterhalb des Falzes stehen, macht die
 * Kennzahl wertlos: Sie misst dann, wie oft das Dashboard geöffnet
 * wurde, nicht was jemand gelesen hat.
 *
 * Jede ID wird höchstens einmal gemeldet. React rendert eine
 * Komponente mehrfach, und ein Beobachter löst beim Scrollen wiederholt
 * aus — ohne Gedächtnis entstünde aus einer Karte ein Dutzend
 * Meldungen.
 */

/* Ein Viertel der Karte reicht. Ein strengeres Kriterium würde auf
   kleinen Bildschirmen dazu führen, dass die dritte Karte nie als
   gesehen gilt, obwohl sie dastand. */
const SICHTBAR_AB = 0.25;

export function useSichtbarkeit(onGesehen, { schwelle = SICHTBAR_AB } = {}) {
  /* Was bereits gemeldet wurde — überlebt Neuzeichnungen, löst aber
     keine aus. Deshalb ein ref und kein state. */
  const gemeldet = React.useRef(new Set());
  const beobachter = React.useRef(null);
  const knoten = React.useRef(new Map());

  /* Die Rückmeldung in einem ref halten: Sonst müsste der Beobachter
     bei jeder neuen Funktionsinstanz neu aufgebaut werden, und jede
     Neuzeichnung erzeugte eine Beobachtungsrunde. */
  const meldung = React.useRef(onGesehen);
  React.useEffect(() => { meldung.current = onGesehen; }, [onGesehen]);

  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      /* Ohne Beobachter — ältere Browser, Testumgebungen — wird nicht
         gemeldet. Lieber keine Zahl als eine falsche. */
      return undefined;
    }

    beobachter.current = new IntersectionObserver((eintraege) => {
      const neu = [];

      for (const eintrag of eintraege) {
        if (!eintrag.isIntersecting) continue;

        const id = eintrag.target.getAttribute('data-event-id');
        if (!id || gemeldet.current.has(id)) continue;

        gemeldet.current.add(id);
        neu.push(id);

        /* Einmal gesehen bleibt gesehen — weiter zu beobachten
           brächte nichts. */
        beobachter.current.unobserve(eintrag.target);
      }

      if (neu.length > 0) {
        /* Gesammelt melden: Drei sichtbare Karten sollen eine Anfrage
           ergeben, nicht drei. */
        try { meldung.current?.(neu); } catch { /* Tracking darf die Anzeige nicht stören */ }
      }
    }, { threshold: schwelle });

    /* Knoten, die schon vor dem Aufbau registriert wurden. */
    knoten.current.forEach((el) => beobachter.current.observe(el));

    return () => {
      beobachter.current?.disconnect();
      beobachter.current = null;
    };
  }, [schwelle]);

  /**
   * An die Karte hängen: ref={beobachte(event.id)}
   */
  const beobachte = React.useCallback((id) => (el) => {
    if (!id) return;

    if (!el) {
      const alt = knoten.current.get(id);
      if (alt && beobachter.current) beobachter.current.unobserve(alt);
      knoten.current.delete(id);
      return;
    }

    el.setAttribute('data-event-id', id);
    knoten.current.set(id, el);

    /* Bereits gemeldete nicht erneut beobachten. */
    if (!gemeldet.current.has(id) && beobachter.current) {
      beobachter.current.observe(el);
    }
  }, []);

  return { beobachte, bereitsGemeldet: gemeldet };
}

export default useSichtbarkeit;
