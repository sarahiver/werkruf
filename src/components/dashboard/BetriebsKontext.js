import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { MapPin, Link2, ChevronRight } from 'lucide-react';
import { useAusgewaehlterStandort } from '../../hooks/useAusgewaehlterStandort';

/* ─────────────────────────────────────────────────────────────────
   BetriebsKontext — „Für welchen Betrieb sehe ich gerade Daten?“ (WP3)

   ═════════════════════════════════════════════════════════════
   EINE WAHRHEIT
   ═════════════════════════════════════════════════════════════

   Die Anzeige kommt aus useAusgewaehlterStandort — derselben strengen
   Regel (nur selected_at zaehlt), die Fotos, Bewertungslink und die
   Uebersicht benutzen. Keine eigene Auswahl, kein locations[0], kein
   lokaler Zustand. Nach einem Wechsel auf /dashboard/google meldet
   selectLocation() das Ereignis, der Hook laedt neu, diese Anzeige
   folgt.

   Drei Zustaende, alle ehrlich:
     ausgewaehlt   Name · Ort, bei mehreren ein Link zum Wechseln
     ohne_auswahl  „Betrieb noch nicht ausgewaehlt“ + Link zur Auswahl
     keine         „Noch kein Betrieb verbunden“ + Link zur Verbindung

   Kein Fake-Betrieb, kein „undefined“, kein leerer Trenner.
───────────────────────────────────────────────────────────────── */

/** „S&I · Hamburg“ — der Ort nur, wenn er etwas sagt. Reine Funktion. */
export function betriebsZeile(standort) {
  const name = typeof standort?.title === 'string' ? standort.title.trim() : '';
  const ort  = typeof standort?.locality === 'string' ? standort.locality.trim() : '';
  if (!name && !ort) return '';
  if (!ort) return name;
  if (!name) return ort;
  return `${name} · ${ort}`;
}

/** Was die Karte zeigt — ohne React, fuer die Tests. */
export function betriebsKontext({ standort, grund, anzahl, loading, fehler }) {
  if (loading) return { art: 'laedt' };
  if (fehler)  return { art: 'fehler' };
  if (grund === 'ausgewaehlt' && standort) {
    return {
      art: 'ausgewaehlt',
      zeile: betriebsZeile(standort) || 'Betrieb ohne Namen',
      wechseln: anzahl > 1 ? { anzahl, label: `Wechseln (${anzahl} Betriebe)` } : null,
    };
  }
  if (grund === 'ohne_auswahl') {
    return { art: 'ohne_auswahl', anzahl, label: anzahl === 1 ? 'Betrieb bestätigen' : `Betrieb auswählen (${anzahl} Betriebe)` };
  }
  return { art: 'keine' };
}

const Karte = styled.div`
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.12);
`;
const Ueber = styled.p`
  font-family: var(--font-body); font-size: .62rem; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  color: rgba(255,255,255,.55); margin: 0 0 4px;
`;
const Name = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .9rem;
  color: var(--color-white); margin: 0; line-height: 1.3;
  overflow-wrap: anywhere;
`;
const Hinweis = styled.p`
  font-family: var(--font-body); font-size: .8rem;
  color: rgba(255,255,255,.8); margin: 0; line-height: 1.35;
`;
const Wechsel = styled(Link)`
  display: inline-flex; align-items: center; gap: 3px;
  margin-top: 6px;
  font-family: var(--font-body); font-size: .76rem; font-weight: 700;
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

/* Sidebar-Karte. */
export default function BetriebsKontext({ onNavigate }) {
  const zustand = useAusgewaehlterStandort();
  const k = betriebsKontext(zustand);

  if (k.art === 'laedt' || k.art === 'fehler') {
    /* Beim Laden nichts behaupten; bei einem Fehler lieber keine
       Karte als eine falsche. Die Seiten melden Fehler selbst. */
    return null;
  }

  return (
    <Karte data-testid="betriebs-kontext" data-art={k.art}>
      <Ueber>Dein Betrieb</Ueber>
      {k.art === 'ausgewaehlt' && (
        <>
          <Name><MapPin size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 5 }} />{k.zeile}</Name>
          {k.wechseln && (
            <Wechsel to="/dashboard/google" onClick={onNavigate}
                     aria-label={`Betrieb wechseln (${k.wechseln.anzahl} Betriebe)`}>
              {k.wechseln.label} <ChevronRight size={13} />
            </Wechsel>
          )}
        </>
      )}
      {k.art === 'ohne_auswahl' && (
        <>
          <Hinweis>Betrieb noch nicht ausgewählt</Hinweis>
          <Wechsel to="/dashboard/google" onClick={onNavigate} aria-label={k.label}>
            {k.label} <ChevronRight size={13} />
          </Wechsel>
        </>
      )}
      {k.art === 'keine' && (
        <>
          <Hinweis>Noch kein Betrieb verbunden</Hinweis>
          <Wechsel to="/dashboard/google" onClick={onNavigate} aria-label="Google-Profil verbinden">
            <Link2 size={12} /> Google-Profil verbinden
          </Wechsel>
        </>
      )}
    </Karte>
  );
}

/* Kopfzeile des Hauptbereichs: nur die Zeile, ohne Karte. Dieselbe
   Quelle (eigene Hook-Instanz, dieselbe Abfrage, dasselbe Ereignis). */
export function BetriebsKopf() {
  const k = betriebsKontext(useAusgewaehlterStandort());
  if (k.art === 'ausgewaehlt') return <span data-testid="betriebs-kopf">{k.zeile}</span>;
  if (k.art === 'ohne_auswahl') return <span data-testid="betriebs-kopf">Betrieb noch nicht ausgewählt</span>;
  if (k.art === 'keine') return <span data-testid="betriebs-kopf">Noch kein Betrieb verbunden</span>;
  return null;
}
