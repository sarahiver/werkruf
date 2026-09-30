/**
 * Google-Profil verwalten.
 *
 * Die gemeinsame Struktur für alle Profilbereiche. Statt einer
 * endlosen Seite eine Unternavigation; jeder Bereich bekommt seine
 * eigene Komponente.
 *
 * Welche Felder in welchen Bereich gehören und ob sie für DIESEN
 * Betrieb bearbeitbar sind, kommt aus src/utils/gbpFieldModel.js.
 * Dort steht es einmal — nicht in jedem Bereich neu.
 *
 * ⚠️  Das Modell steuert nur die Anzeige. Verbindlich ist die Prüfung
 * in der Edge Function: Sie wertet dieselben Google-Metadaten aus und
 * lehnt gesperrte Felder ab, auch wenn die Oberfläche umgangen wird.
 *
 * Bereiche ohne eigene Komponente zeigen, was die Bestandsaufnahme
 * über sie sagt, statt eine leere Seite. Das ist ehrlicher als ein
 * Platzhalter, der Funktionalität andeutet.
 */
import React from 'react';
import styled from 'styled-components';
import { Lock, AlertTriangle, Info } from 'lucide-react';

import {
  BEREICHE, SCHREIBART, bereichFuerStandort, bereicheMitStatus,
} from '../../utils/gbpFieldModel';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Navigation = styled.nav`
  display: flex; flex-wrap: wrap; gap: 4px;
  border-bottom: 1px solid var(--color-border);
  margin: 0 0 20px;
`;

const Reiter = styled.button`
  font-family: var(--font-body); font-size: .86rem; font-weight: 600;
  background: none; border: 0; cursor: pointer;
  padding: 9px 14px; margin-bottom: -1px;
  color: ${(p) => (p.$aktiv ? 'var(--color-primary)' : 'var(--color-text-muted)')};
  border-bottom: 2px solid ${(p) => (p.$aktiv ? 'var(--color-accent)' : 'transparent')};
  &:hover { color: var(--color-primary); }
  &:disabled { opacity: .45; cursor: default; }
`;

const Zaehler = styled.span`
  font-size: .7rem; font-weight: 700; margin-left: 6px;
  color: var(--color-text-muted);
`;

const BereichsKopf = styled.div`
  margin: 0 0 16px;
  h3 { font-family: var(--font-display); font-size: 1.05rem;
       color: var(--color-primary); margin: 0 0 4px; }
  p  { font-family: var(--font-body); font-size: .84rem;
       color: var(--color-text-muted); line-height: 1.55; margin: 0; }
`;

const FeldZeile = styled.div`
  display: grid; grid-template-columns: 1fr auto; gap: 12px;
  align-items: start;
  padding: 11px 0; border-top: 1px solid var(--color-border);
  &:first-of-type { border-top: 0; }
`;

const FeldName = styled.div`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-primary); font-weight: 600;
  small { display: block; font-weight: 400; font-size: .76rem;
          color: var(--color-text-muted); margin-top: 3px; line-height: 1.5; }
`;

const Marke = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  font-size: .7rem; font-weight: 700; white-space: nowrap;
  border-radius: 4px; padding: 3px 8px;
  background: ${(p) => (p.$art === 'gesperrt' ? '#FDECEA'
    : p.$art === 'lesen' ? '#EEF1F4' : '#E8F5E9')};
  color: ${(p) => (p.$art === 'gesperrt' ? '#8B1A12'
    : p.$art === 'lesen' ? '#5F6875' : '#1B5E20')};
`;

const Hinweisbox = styled.div`
  font-family: var(--font-body); font-size: .82rem; line-height: 1.6;
  border-left: 3px solid ${(p) => (p.$art === 'warnung' ? '#D48A00' : '#8A9199')};
  background: ${(p) => (p.$art === 'warnung' ? '#FFF8E8' : '#F4F5F7')};
  color: ${(p) => (p.$art === 'warnung' ? '#7A5200' : '#5F6875')};
  border-radius: 6px; padding: 11px 14px; margin: 0 0 16px;
  display: flex; gap: 9px; align-items: flex-start;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

/* ─────────────────────────────────────────────
   FELDÜBERSICHT

   Zeigt je Bereich, was es gibt und was damit möglich ist. Bereiche
   mit eigener Bearbeitung reichen `children` herein; die Übersicht
   steht dann darunter.
───────────────────────────────────────────── */

export function Feldliste({ bereich, location }) {
  const felder = bereichFuerStandort(bereich, location);
  if (felder.length === 0) return null;

  return (
    <div>
      {felder.map((f) => (
        <FeldZeile key={f.pfad}>
          <FeldName>
            {f.label}
            {f.hinweis && <small>{f.hinweis}</small>}
            {!f.erlaubt && f.grund && <small>{f.grund}</small>}
            {f.erlaubt && f.art === SCHREIBART.GANZ && f.ganzGrund && (
              <small>{f.ganzGrund}</small>
            )}
            {f.kategorieabhaengig && (
              <small>Verfügbarkeit hängt von der Hauptkategorie ab.</small>
            )}
          </FeldName>

          {!f.erlaubt && f.code === 'nur_lesbar' ? (
            <Marke $art="lesen"><Lock size={11} /> nur lesbar</Marke>
          ) : !f.erlaubt && f.code === 'noch_nicht_umgesetzt' ? (
            /* Nicht „gesperrt" — das klänge nach einer Schranke.
               Hier kommt es noch. */
            <Marke $art="lesen">folgt</Marke>
          ) : !f.erlaubt ? (
            <Marke $art="gesperrt"><Lock size={11} /> gesperrt</Marke>
          ) : (
            <Marke $art="offen">bearbeitbar</Marke>
          )}
        </FeldZeile>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   RAHMEN
───────────────────────────────────────────── */

export default function GoogleProfilVerwalten({ location, bereiche = {} }) {
  const [aktiv, setAktiv] = React.useState('stammdaten');

  /* Ohne ausgewählten Betrieb gibt es nichts zu verwalten. */
  if (!location) {
    return (
      <Hinweisbox>
        <Info size={15} />
        Wähle oben einen Betrieb aus, um sein Google-Profil zu verwalten.
      </Hinweisbox>
    );
  }

  const mitStatus = bereicheMitStatus(location);
  const aktuell = BEREICHE.find((b) => b.key === aktiv) ?? BEREICHE[0];
  const status = mitStatus.find((b) => b.key === aktiv);
  const inhalt = bereiche[aktiv];

  /* Voice of Merchant fehlt: Dann sind alle Schreibfelder gesperrt,
     und der Grund gehört nach oben — nicht zwanzigmal einzeln an jedes
     Feld. */
  const ohneVoiceOfMerchant =
    location.google_profile?.metadata?.hasVoiceOfMerchant === false;

  return (
    <div>
      <Navigation>
        {mitStatus.map((b) => (
          <Reiter
            key={b.key}
            $aktiv={b.key === aktiv}
            onClick={() => setAktiv(b.key)}
            aria-current={b.key === aktiv ? 'page' : undefined}
          >
            {b.titel}
            {b.ausFeldmodell && (
              <Zaehler>{b.felderBearbeitbar}/{b.felderGesamt}</Zaehler>
            )}
          </Reiter>
        ))}
      </Navigation>

      <BereichsKopf>
        <h3>{aktuell.titel}</h3>
        <p>{aktuell.beschreibung}</p>
      </BereichsKopf>

      {ohneVoiceOfMerchant && (
        <Hinweisbox $art="warnung" role="status">
          <AlertTriangle size={15} />
          <span>
            <strong>Google hat die Kontrolle über dieses Profil noch nicht bestätigt.</strong>{' '}
            Änderungen würden zwar übermittelt, aber nicht veröffentlicht. Prüfe in
            deinem Google-Unternehmensprofil, ob eine Bestätigung aussteht.
          </span>
        </Hinweisbox>
      )}

      {inhalt}

      {status?.ausFeldmodell && (
        <>
          {inhalt && <BereichsKopf style={{ marginTop: 24 }}>
            <h3>Felder in diesem Bereich</h3>
            <p>Was die Google-API hier vorsieht und was für deinen Betrieb möglich ist.</p>
          </BereichsKopf>}
          <Feldliste bereich={aktiv} location={location} />
        </>
      )}

      {!status?.ausFeldmodell && !inhalt && (
        <Hinweisbox>
          <Info size={15} />
          <span>
            Dieser Bereich ist noch nicht eingerichtet. Was die Google-API dafür
            vorsieht, steht in <code>docs/google-api-inventory.md</code>.
          </span>
        </Hinweisbox>
      )}
    </div>
  );
}
