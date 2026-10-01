/**
 * WERKRUF Score.
 *
 * Der kanonische Wert aus D1 — nicht `visibility_score`. Der stammt
 * aus dem öffentlichen SmartCheck, wird ohne verbundenes Google-Konto
 * berechnet und misst etwas anderes.
 *
 * Die Einordnung darunter interpretiert die vorhandenen Faktoren. Sie
 * rechnet nichts nach und erfindet keine Punktzahlen: Ein Satz wie
 * „85 Punkte fehlen wegen Bewertungen" wäre falsch, weil die 85 sich
 * auf vier Faktoren verteilen.
 */
import React from 'react';
import styled from 'styled-components';
import { Info } from 'lucide-react';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Block = styled.section`
  background: #fff; border: 1px solid var(--color-border);
  border-radius: 10px; padding: 20px 22px; margin: 0 0 20px;
`;

const Kopf = styled.div`
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
`;

const Bezeichnung = styled.h2`
  font-family: var(--font-display); font-size: .82rem; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  color: var(--color-text-muted); margin: 0;
`;

const Wert = styled.p`
  font-family: var(--font-display); font-size: 2.4rem; font-weight: 700;
  color: var(--color-primary); margin: 4px 0 0; line-height: 1;
  small { font-size: .9rem; font-weight: 600; color: var(--color-text-muted);
          margin-left: 4px; }
`;

const Delta = styled.span`
  font-family: var(--font-body); font-size: .86rem; font-weight: 700;
  color: ${(p) => (p.$richtung === 'auf' ? '#1B5E20' : '#8B1A12')};
`;

const Einordnung = styled.p`
  font-family: var(--font-body); font-size: .88rem; line-height: 1.6;
  color: var(--color-text); margin: 12px 0 0; max-width: 62ch;
`;

const Schwaeche = styled.p`
  font-family: var(--font-body); font-size: .82rem; line-height: 1.55;
  color: var(--color-text-muted); margin: 6px 0 0;
`;

const Hilfetext = styled.p`
  font-family: var(--font-body); font-size: .76rem; line-height: 1.5;
  color: var(--color-text-muted); margin: 14px 0 0;
  display: flex; gap: 6px; align-items: flex-start;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const Platzhalter = styled.div`
  height: ${(p) => p.$hoehe ?? 20}px; width: ${(p) => p.$breite ?? '100%'};
  background: #EEF1F4; border-radius: 5px; margin: ${(p) => p.$rand ?? '0'};
`;

/* ─────────────────────────────────────────────
   EINORDNUNG

   Welche Faktoren liegen weit unter ihrem Höchstwert? Daraus entsteht
   ein Satz — ohne neue Berechnung.
───────────────────────────────────────────── */

const FAKTOR_NAMEN = {
  responseRate: 'Antworten auf Bewertungen',
  rating:       'Bewertungen',
  recency:      'aktuelle Bewertungen',
  completeness: 'Profilangaben',
  photos:       'Fotos',
};

const HOECHSTWERTE = {
  responseRate: 30, rating: 25, recency: 20, completeness: 15, photos: 10,
};

/**
 * Formuliert die Einordnung aus den Faktoren.
 *
 * @returns {{ satz: string, schwaeche: string|null }}
 */
export function ordneEin(factors) {
  if (!Array.isArray(factors) || factors.length === 0) {
    return { satz: '', schwaeche: null };
  }

  const anteil = (f) => {
    const max = HOECHSTWERTE[f.id];
    return max ? (f.points ?? 0) / max : null;
  };

  const voll = factors.filter((f) => anteil(f) !== null && anteil(f) >= 0.95);
  const leer = factors.filter((f) => anteil(f) !== null && anteil(f) === 0);

  /* Alles erreicht. */
  if (leer.length === 0 && voll.length === factors.length) {
    return {
      satz: 'Alle Bereiche, die WERKRUF messen kann, sind in Ordnung.',
      schwaeche: null,
    };
  }

  const nenne = (liste) => liste
    .map((f) => FAKTOR_NAMEN[f.id] ?? f.label ?? f.id)
    .filter(Boolean);

  /* Der häufige Fall bei einem frisch verbundenen Betrieb: Profil
     gepflegt, aber noch keine Bewertungen und keine Fotos. */
  let satz;
  if (voll.length > 0 && leer.length > 0) {
    satz = `${grossErstes(verbinde(nenne(voll)))} ${voll.length === 1 ? 'ist' : 'sind'} vollständig. `
         + `Für einen höheren Score fehlen aktuell vor allem ${verbinde(nenne(leer))}.`;
  } else if (leer.length > 0) {
    satz = `Für einige Bereiche liegen noch keine Daten vor — darunter ${verbinde(nenne(leer))}.`;
  } else {
    satz = 'In mehreren Bereichen gibt es noch Luft nach oben.';
  }

  /* „Am meisten Luft ist bei X" — nur wenn ein Faktor deutlich unter
     den anderen liegt. Einen Sieger zu erzwingen, wo zwei gleich
     schlecht sind, wäre eine erfundene Aussage. */
  const bewertbar = factors
    .filter((f) => anteil(f) !== null && anteil(f) < 0.95)
    .map((f) => ({ f, luecke: (HOECHSTWERTE[f.id] ?? 0) - (f.points ?? 0) }))
    .sort((a, b) => b.luecke - a.luecke);

  let schwaeche = null;
  if (bewertbar.length === 1) {
    schwaeche = `Am meisten Luft ist momentan bei ${nenne([bewertbar[0].f])[0]}.`;
  } else if (bewertbar.length > 1) {
    const [erster, zweiter] = bewertbar;
    schwaeche = erster.luecke > zweiter.luecke
      ? `Am meisten Luft ist momentan bei ${nenne([erster.f])[0]}.`
      : 'Bei mehreren Bereichen gibt es noch Luft nach oben.';
  }

  return { satz, schwaeche };
}

const verbinde = (teile) => (teile.length <= 1
  ? (teile[0] ?? '')
  : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`);

const grossErstes = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/* ─────────────────────────────────────────────
   ANZEIGE
───────────────────────────────────────────── */

export default function WerkrufScore({ score, loading, betrieb }) {
  if (loading) {
    return (
      <Block aria-busy="true">
        <Bezeichnung>WERKRUF Score</Bezeichnung>
        <Platzhalter $hoehe={40} $breite="140px" $rand="8px 0 0" />
        <Platzhalter $hoehe={14} $breite="80%" $rand="16px 0 0" />
        <Platzhalter $hoehe={14} $breite="55%" $rand="8px 0 0" />
      </Block>
    );
  }

  /* Kein Score — etwa bei mehreren Betrieben ohne Auswahl. Keine 0
     anzeigen: Die sähe aus wie ein schlechter Betrieb. */
  if (score?.score === null || score?.score === undefined) {
    return (
      <Block>
        <Bezeichnung>WERKRUF Score</Bezeichnung>
        <Einordnung>
          {score?.summary || 'Der Score steht zur Verfügung, sobald ein Betrieb ausgewählt ist.'}
        </Einordnung>
      </Block>
    );
  }

  const { satz, schwaeche } = ordneEin(score.factors);

  return (
    <Block>
      <Kopf>
        <Bezeichnung>WERKRUF Score</Bezeichnung>
        {betrieb && <Schwaeche style={{ margin: 0 }}>{betrieb}</Schwaeche>}
      </Kopf>

      <Wert>
        {score.score}<small>/100</small>
        {typeof score.delta === 'number' && score.delta !== 0 && (
          <>
            {' '}
            <Delta $richtung={score.delta > 0 ? 'auf' : 'ab'}>
              {score.delta > 0 ? '+' : ''}{score.delta}
            </Delta>
          </>
        )}
      </Wert>

      {satz && <Einordnung>{satz}</Einordnung>}
      {schwaeche && <Schwaeche>{schwaeche}</Schwaeche>}

      <Hilfetext>
        <Info size={13} />
        Der WERKRUF Score zeigt den Zustand deines Google-Profils anhand der Daten,
        die WERKRUF tatsächlich messen kann. Er ist kein Google-Ranking.
      </Hilfetext>
    </Block>
  );
}
