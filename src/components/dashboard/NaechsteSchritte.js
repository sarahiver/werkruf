/**
 * Deine nächsten Schritte.
 *
 * Zeigt ausschließlich, was die Decision Engine entschieden hat. Diese
 * Komponente trifft keine fachliche Entscheidung — nicht welche
 * Aufgabe existiert, nicht in welcher Reihenfolge, nicht wie dringend.
 *
 * Erlaubt ist nur Darstellung: Prioritätsstufe aus der Zahl,
 * Aufwandstext aus den Minuten, und ein freundlicherer Titel, wo der
 * Engine-Wortlaut technisch klingt.
 */
import React from 'react';
import styled from 'styled-components';
import { ArrowRight, Check, X, AlertTriangle, RotateCw } from 'lucide-react';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Bereich = styled.section`  margin: 0 0 24px; `;

const Titel = styled.h2`
  font-family: var(--font-display); font-size: 1.05rem;
  color: var(--color-primary); margin: 0 0 12px;
`;

const Karte = styled.article`
  background: #fff; border: 1px solid var(--color-border);
  border-radius: 9px; padding: 15px 17px; margin: 0 0 10px;
  /* Die Dringlichkeit steht links als Streifen — und zusätzlich als
     Text in der Marke. Nur über Farbe wäre sie für manche unsichtbar. */
  border-left: 4px solid ${(p) => p.$farbe};
  display: grid; grid-template-columns: 1fr auto; gap: 14px;
  align-items: start;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;

const KartenText = styled.div`
  h3 { font-family: var(--font-body); font-size: .95rem; font-weight: 700;
       color: var(--color-primary); margin: 0 0 4px; }
  p  { font-family: var(--font-body); font-size: .85rem; line-height: 1.55;
       color: var(--color-text); margin: 0 0 4px; }
  small { font-family: var(--font-body); font-size: .78rem;
          color: var(--color-text-muted); display: block; }
`;

const Marken = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0;
`;

const Marke = styled.span`
  font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  border-radius: 4px; padding: 3px 8px;
  background: ${(p) => p.$hintergrund}; color: ${(p) => p.$farbe};
`;

const Knopfreihe = styled.div`
  display: flex; flex-direction: column; gap: 6px; align-items: stretch;
  @media (max-width: 640px) { flex-direction: row; }
`;

const Aktion = styled.a`
  font-family: var(--font-body); font-size: .85rem; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--color-primary); color: #fff; text-decoration: none;
  border: 0; border-radius: 6px; padding: 9px 15px; cursor: pointer;
  white-space: nowrap; min-height: 40px;
  &:hover { opacity: .9; }
`;

const Wegklicken = styled.button`
  font-family: var(--font-body); font-size: .78rem;
  background: none; border: 1px solid var(--color-border); border-radius: 6px;
  padding: 7px 11px; cursor: pointer; color: var(--color-text-muted);
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  min-height: 36px;
  &:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-primary); }
  &:disabled { opacity: .5; cursor: not-allowed; }
`;

const Zustand = styled.div`
  background: #fff; border: 1px solid var(--color-border);
  border-radius: 9px; padding: 20px 22px; text-align: left;
  h3 { font-family: var(--font-display); font-size: 1rem;
       color: var(--color-primary); margin: 0 0 6px;
       display: flex; align-items: center; gap: 8px; }
  p  { font-family: var(--font-body); font-size: .87rem; line-height: 1.6;
       color: var(--color-text-muted); margin: 0; max-width: 60ch; }
`;

const Platzhalter = styled.div`
  background: #fff; border: 1px solid var(--color-border);
  border-radius: 9px; padding: 15px 17px; margin: 0 0 10px;
  div { height: 14px; background: #EEF1F4; border-radius: 4px; }
  div + div { margin-top: 8px; }
`;

/* ─────────────────────────────────────────────
   DARSTELLUNGSREGELN
───────────────────────────────────────────── */

/**
 * Prioritätsstufe aus der Zahl der Engine.
 *
 * Eine Empfehlung mit Priorität 29 ist kein Notfall. Sie rot
 * darzustellen hiesse, dem Kunden Dringlichkeit zu suggerieren, die
 * die Engine nicht gemeint hat — und beim nächsten echten Notfall
 * glaubt er sie nicht mehr.
 */
export function stufeFuer(priority) {
  const p = Number(priority ?? 0);
  if (p >= 80) return { name: 'kritisch', farbe: '#D93025', hintergrund: '#FDECEA', text: '#8B1A12' };
  if (p >= 60) return { name: 'wichtig',  farbe: '#D48A00', hintergrund: '#FFF8E8', text: '#7A5200' };
  if (p >= 40) return { name: 'hilfreich', farbe: '#5F6875', hintergrund: '#EEF1F4', text: '#5F6875' };
  return         { name: 'wenn du Zeit hast', farbe: '#C3CAD2', hintergrund: '#F4F5F7', text: '#5F6875' };
}

/** Aufwand als Text. */
export function aufwandText(minuten) {
  const m = Number(minuten);
  if (!Number.isFinite(m) || m <= 0) return null;
  return m === 1 ? '1 Minute' : `${m} Minuten`;
}

/**
 * Der Titel der Engine.
 *
 * ABSICHTLICH OHNE UMFORMULIERUNG.
 *
 * Geplant war, bei null Fotos aus „5 Fotos hochladen" ein
 * „Erstes Foto hochladen" zu machen — rechnerisch ist die Fünf richtig,
 * klingt aber nach einer Pflichtmenge.
 *
 * Das scheitert an den Daten: Die Regel legt in `data` nur
 * `capability` und `priorityLevel` ab, keine Fotozahl. Eine Bedingung
 * auf `data.photoCount` wäre nie wahr geworden — die Oberfläche hätte
 * ausgesehen, als täte sie etwas, und hätte nichts getan.
 *
 * Auf den Zusammenfassungstext zu prüfen („Keine Fotos hinterlegt.")
 * wäre die Alternative und wäre schlechter: Eine Formulierung in der
 * Engine zu ändern bräche dann stillschweigend die Oberfläche.
 *
 * Damit es funktioniert, müsste die Regel `photoCount` in `data`
 * schreiben. Das ist eine Änderung an der Engine und gehört nicht in
 * dieses Paket.
 */
export function anzeigeTitel(event) {
  return event?.title ?? 'Aufgabe';
}

/* ─────────────────────────────────────────────
   ANZEIGE
───────────────────────────────────────────── */

export default function NaechsteSchritte({
  events, loading, fehler, onNeuLaden,
  standortAuswahlNoetig, standortAuswahlZiel = '/dashboard/google',
  onGeoeffnet, onWeggeklickt, wegklickenLaeuft,
}) {
  /* ── Laden ──
     Platzhalter, nicht „Alles erledigt". Ein kurz aufblitzendes
     „nichts zu tun" wäre eine Falschaussage. */
  if (loading) {
    return (
      <Bereich aria-busy="true">
        <Titel>Deine nächsten Schritte</Titel>
        {[0, 1].map((i) => (
          <Platzhalter key={i}>
            <div style={{ width: '45%' }} />
            <div style={{ width: '80%' }} />
          </Platzhalter>
        ))}
      </Bereich>
    );
  }

  /* ── Kein Betrieb ausgewählt ──
     Kein Engine-Ereignis, sondern ein Zustand der Oberfläche. */
  if (standortAuswahlNoetig) {
    return (
      <Bereich>
        <Titel>Deine nächsten Schritte</Titel>
        <Zustand>
          <h3>Welchen Betrieb möchtest du ansehen?</h3>
          <p>
            Wähle zuerst einen Betrieb aus. Danach zeigt WERKRUF dir Score und
            nächste Schritte für genau diesen Standort.
          </p>
          {/* Ein echter Link, kein Knopf mit Navigation im Klick —
              so funktionieren Mittelklick und "in neuem Tab öffnen". */}
          <Aktion href={standortAuswahlZiel} style={{ marginTop: 14 }}>
            Betrieb auswählen <ArrowRight size={14} />
          </Aktion>
        </Zustand>
      </Bereich>
    );
  }

  /* ── Fehler ──
     Kein Rückfall auf eine eigene Aufgabenliste. Das wäre eine zweite
     Wahrheit, und zwar genau dann, wenn die erste nicht erreichbar
     ist. */
  if (fehler) {
    return (
      <Bereich>
        <Titel>Deine nächsten Schritte</Titel>
        <Zustand role="alert">
          <h3><AlertTriangle size={17} /> Aufgaben konnten gerade nicht geladen werden.</h3>
          <p>{fehler}</p>
          <Aktion as="button" type="button" onClick={onNeuLaden} style={{ marginTop: 14 }}>
            <RotateCw size={14} /> Erneut versuchen
          </Aktion>
        </Zustand>
      </Bereich>
    );
  }

  /* ── Alles erledigt ──
     Keine erfundene Aufgabe, nur damit etwas dasteht. */
  if (!events || events.length === 0) {
    return (
      <Bereich>
        <Titel>Deine nächsten Schritte</Titel>
        <Zustand>
          <h3><Check size={17} /> Alles erledigt.</h3>
          <p>
            Diese Woche musst du nichts tun. WERKRUF beobachtet dein Profil
            weiter und meldet sich, wenn etwas wichtig wird.
          </p>
        </Zustand>
      </Bereich>
    );
  }

  return (
    <Bereich>
      <Titel>Deine nächsten Schritte</Titel>

      {/* Reihenfolge wie geliefert — die Engine hat sie bestimmt. */}
      {events.map((e) => {
        const stufe = aufwandStufe(e);
        const aufwand = aufwandText(e.estimatedMinutes);

        return (
          <Karte key={e.id} $farbe={stufe.farbe}>
            <KartenText>
              <h3>{anzeigeTitel(e)}</h3>
              {e.summary && <p>{e.summary}</p>}
              {e.reason && <small>{e.reason}</small>}
              {e.impact && <small>{e.impact}</small>}

              <Marken>
                <Marke $hintergrund={stufe.hintergrund} $farbe={stufe.text}>
                  {stufe.name}
                </Marke>
                {aufwand && (
                  <Marke $hintergrund="#EEF1F4" $farbe="#5F6875">{aufwand}</Marke>
                )}
              </Marken>
            </KartenText>

            <Knopfreihe>
              {/* Kein Knopf ohne Ziel — eine Route zu erraten wäre
                  schlimmer als keine anzubieten. */}
              {e.actionUrl && (
                <Aktion href={e.actionUrl} onClick={() => onGeoeffnet?.(e.id)}>
                  Erledigen <ArrowRight size={14} />
                </Aktion>
              )}
              {e.isDismissable && (
                <Wegklicken
                  type="button"
                  onClick={() => onWeggeklickt?.(e.id)}
                  disabled={wegklickenLaeuft}
                  aria-label={`${anzeigeTitel(e)} ausblenden`}
                >
                  <X size={12} /> Ausblenden
                </Wegklicken>
              )}
            </Knopfreihe>
          </Karte>
        );
      })}
    </Bereich>
  );
}

const aufwandStufe = (e) => stufeFuer(e.priority);
