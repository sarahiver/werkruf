import React from 'react';

/* ─────────────────────────────────────────────────────────────────
   Fehlergrenze

   Faengt Renderfehler ab, die sonst den ganzen Baum abraeumen.

   ═════════════════════════════════════════════════════════════
   WARUM
   ═════════════════════════════════════════════════════════════

   Bis zum 21.10.2026 gab es im Projekt keine einzige ErrorBoundary.
   Jeder nicht abgefangene Fehler im Rendern — ein unerwartetes null
   aus einer Antwort, ein fehlendes Feld, ein Tippfehler in einer
   Komponente — endete fuer den Kunden in einer weissen Seite: keine
   Meldung, kein Knopf, keine Moeglichkeit zu sagen, was passiert ist.
   Und fuer uns in nichts, weil nichts protokolliert wurde.

   ═════════════════════════════════════════════════════════════
   WARUM EINE KLASSE
   ═════════════════════════════════════════════════════════════

   Weil React Fehlergrenzen nur als Klassen kennt. getDerivedStateFromError
   und componentDidCatch haben kein Hook-Gegenstueck.

   ═════════════════════════════════════════════════════════════
   WARUM OHNE styled-components, OHNE Router, OHNE Theme
   ═════════════════════════════════════════════════════════════

   Die Grenze ist der letzte Halt. Haengt sie an denselben Dingen wie
   der Rest der Seite, faellt sie mit ihm. Deshalb: einfache Elemente,
   Inline-Stile mit festen Markenfarben (dieselben wie in
   industryConfig.js, handwerk), ein normaler <a href> statt <Link>.

   Der Link fuehrt mit vollem Seitenaufruf zur Startseite. Das ist
   Absicht: Eine Grenze bleibt im Fehlerzustand, bis sie neu aufgebaut
   wird — und ein voller Aufruf baut alles neu auf. Eine Client-
   Navigation wuerde den kaputten Zustand womoeglich mitnehmen.

   ═════════════════════════════════════════════════════════════
   WAS SIE NICHT KANN
   ═════════════════════════════════════════════════════════════

   Fehler VOR React: fehlende Env-Variablen beim Build, ein nach dem
   Deploy verschwundener Chunk, ein Skriptfehler beim Laden. Dann
   mountet nichts, auch diese Grenze nicht. Dafuer steht der statische
   Rueckfall in public/index.html.

   Ebenso nicht: Fehler in Event-Handlern und in asynchronem Code
   (Promises, setTimeout). Die muessen dort behandelt werden, wo sie
   entstehen — React reicht sie nicht an Grenzen weiter.
───────────────────────────────────────────────────────────────── */

const FARBEN = {
  primaer: '#002C51',
  akzent:  '#FF8C00',
  text:    '#1A1A1A',
  gedeckt: '#5A6B7B',
};

const stil = {
  seite: {
    minHeight: '100vh', background: FARBEN.primaer,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px', boxSizing: 'border-box',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  karte: {
    background: '#fff', color: FARBEN.text,
    borderTop: `5px solid ${FARBEN.akzent}`, borderRadius: 6,
    maxWidth: 480, width: '100%', padding: '36px 32px',
  },
  marke: {
    margin: '0 0 18px', fontWeight: 'bold', fontSize: 15,
    letterSpacing: 3, color: FARBEN.primaer,
  },
  titel: { margin: '0 0 12px', fontSize: 20, color: FARBEN.primaer },
  text:  { margin: '0 0 14px', fontSize: 15, lineHeight: 1.55 },
  klein: { margin: 0, fontSize: 13, color: FARBEN.gedeckt, lineHeight: 1.55 },
  knopf: {
    display: 'inline-block', margin: '6px 10px 20px 0',
    background: FARBEN.akzent, color: '#fff', border: 0, borderRadius: 4,
    padding: '12px 22px', fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
    fontFamily: 'inherit',
  },
  link: {
    display: 'inline-block', margin: '6px 0 20px',
    color: FARBEN.primaer, fontSize: 15, fontWeight: 'bold',
    textDecoration: 'underline',
  },
  kennung: {
    margin: '14px 0 0', fontSize: 12, color: FARBEN.gedeckt,
    fontFamily: 'Consolas, Menlo, monospace', wordBreak: 'break-all',
  },
};

/* Kurze, lesbare Kennung je Vorfall. Steht auf der Seite und im
   Protokoll — so laesst sich eine Meldung eines Kunden einem Eintrag
   zuordnen, ohne dass der Kunde einen Stacktrace abtippen muss. */
function neueKennung() {
  const zeit = Date.now().toString(36).slice(-5);
  const zufall = Math.random().toString(36).slice(2, 6);
  return `${zeit}-${zufall}`.toUpperCase();
}

export default class Fehlergrenze extends React.Component {
  constructor(props) {
    super(props);
    this.state = { fehler: null, kennung: null };
  }

  static getDerivedStateFromError(fehler) {
    return { fehler, kennung: neueKennung() };
  }

  componentDidCatch(fehler, info) {
    /* console.error, nicht console.log: In den meisten Browsern und
       in Monitoring-Werkzeugen ist das der Kanal, der auffaellt.
       Die Kennung steht vorn, damit sie auch in gekuerzten Zeilen
       sichtbar bleibt. */
    console.error(
      `[Fehlergrenze ${this.state.kennung}]`,
      fehler,
      info?.componentStack ?? '',
    );
    if (typeof this.props.onFehler === 'function') {
      try { this.props.onFehler(fehler, info, this.state.kennung); } catch { /* nie werfen */ }
    }
  }

  render() {
    if (!this.state.fehler) return this.props.children;

    return (
      <div style={stil.seite} role="alert" data-testid="fehlergrenze">
        <div style={stil.karte}>
          <p style={stil.marke}>WERKRUF</p>
          <h1 style={stil.titel}>Da ist etwas schiefgelaufen</h1>
          <p style={stil.text}>
            Diese Seite konnte nicht angezeigt werden. Das liegt nicht an
            dir — ein neuer Versuch hilft meistens.
          </p>
          <button type="button" style={stil.knopf} onClick={() => window.location.reload()}>
            Seite neu laden
          </button>
          <a href="/" style={stil.link}>Zur Startseite</a>
          <p style={stil.klein}>
            Klappt es weiterhin nicht, schreib uns an{' '}
            <a href="mailto:info@werkruf.com" style={{ color: FARBEN.primaer }}>info@werkruf.com</a>
            {' '}und nenn die Kennung unten — dann finden wir den Vorfall.
          </p>
          <p style={stil.kennung}>Kennung {this.state.kennung}</p>
        </div>
      </div>
    );
  }
}
