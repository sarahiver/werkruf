import React from 'react';
import styled, { keyframes, css } from 'styled-components';
import { Check, Clock } from 'lucide-react';
import { Card } from './GbUi';

/* ─────────────────────────────────────────────────────────────────
   EinrichtungsFortschritt

   Der Zustand zwischen "Google verbunden" und "erste Daten da".

   ═════════════════════════════════════════════════════════════
   WARUM KEIN PROZENTBALKEN
   ═════════════════════════════════════════════════════════════

   Weil wir die Strecke nicht kennen. Der Standortimport ist EIN Job:
   queued -> running -> succeeded. Es gibt keine Teilschritte, keine
   Zeilenzahl, kein "3 von 7". Jede Prozentzahl waere erfunden — und
   ein Balken, der bei 90 % stehenbleibt, ist die erste Luege, die ein
   Kunde von WERKRUF zu sehen bekommt.

   Was es ehrlich gibt, ist zweierlei:

     1. Ein UNBESTIMMTER Balken. Er sagt "etwas laeuft" und behauptet
        keine Strecke. Im Markup ist das ein progressbar OHNE
        aria-valuenow — die ARIA-Kodierung fuer genau diese Aussage.
        Der Screenreader meldet "beschaeftigt", keine Zahl.

     2. Echte PHASEN. Die drei Schritte sind keine Dekoration, sie
        stehen jeweils fuer eine pruefbare Tatsache:
          Konto verbunden   isConnected
          Betriebe geladen  locations.length > 0
          Bewertungen da    lastSyncedAt

   ═════════════════════════════════════════════════════════════
   WARUM "EINGEREIHT" UND "LAEUFT" UNTERSCHIEDEN WERDEN
   ═════════════════════════════════════════════════════════════

   sync/trigger reiht einen Job ein, er arbeitet nicht selbst. Der
   Worker (gbp-worker) holt ihn im Fuenf-Minuten-Takt ab. Ein frisch
   verbundener Kunde wartet also im Mittel zweieinhalb Minuten, bevor
   ueberhaupt etwas passiert.

   Am 20.10.2026 im Durchgang beobachtet: Die Seite gab nach 120
   Sekunden auf und meldete rot "dauert ungewoehnlich lange". Zwei
   Minuten spaeter waren beide Betriebe da. Der Job war nie kaputt —
   die Seite war ungeduldiger als das System, und die Meldung war
   schlicht falsch.

   Deshalb nennt diese Komponente die Taktung beim Namen, statt
   "einen Moment" zu versprechen. Wer weiss, dass alle fuenf Minuten
   ein Lauf startet, wartet anders als jemand, dem "gleich" gesagt
   wurde.
───────────────────────────────────────────────────────────────── */

/* Ab hier gilt die Wartezeit nicht mehr als normal. Fuenf Minuten
   Worker-Takt plus Laufzeit des Imports: Wer danach noch wartet,
   wartet laenger als die Taktung erklaert. Keine Fehlermeldung —
   nur der Punkt, ab dem die verstrichene Zeit genannt wird, statt
   sie zu verschweigen. */
export const WARTE_TAKT_MS = 5 * 60 * 1000;
export const LANGSAM_AB_MS = 6 * 60 * 1000;

/**
 * Reine Ableitung — kein React, kein Zustand, einzeln pruefbar.
 *
 * Ausdruecklich NICHT aus syncState abgeleitet. syncState kennt den
 * Wert 'never', und der bedeutet "noch nie etwas erfolgreich" — nicht
 * "gerade in Arbeit". Ein Balken an 'never' wuerde auch dann
 * animieren, wenn gar nichts laeuft.
 *
 * @param verbunden        isConnected
 * @param importStatus     locationImport.status: none|running|succeeded|failed
 * @param importJobStatus  locationImport.job?.status: queued|running|…
 * @param keineBetriebe    Import gelaufen, Google kennt keine Betriebe
 * @param anzahlStandorte  locations.length
 * @param lastSyncedAt     letzter erfolgreicher Bewertungsabgleich
 * @param laufenderJob     runningJob aus dem Hook (queued oder running)
 * @param begonnenAm       created_at des Importjobs
 * @param jetzt            Date.now(), injizierbar fuer Tests
 */
export function leiteEinrichtungAb({
  verbunden = false,
  importStatus = 'none',
  importJobStatus = null,
  keineBetriebe = false,
  anzahlStandorte = 0,
  lastSyncedAt = null,
  laufenderJob = null,
  begonnenAm = null,
  jetzt = Date.now(),
} = {}) {
  const standorteDa = anzahlStandorte > 0;
  const bewertungenDa = Boolean(lastSyncedAt);

  /* Die Einrichtung laeuft nur, solange sie weder fertig noch zu
     einem Ergebnis gekommen ist. Ein Import, der null Betriebe fand,
     ist ein ERGEBNIS — dafuer steht der EmptyState weiter unten auf
     der Seite, nicht ein weiterlaufender Balken. Ein gescheiterter
     Import ebenso: dort gehoert eine Fehlermeldung hin. */
  const aktiv = Boolean(verbunden)
    && !bewertungenDa
    && !keineBetriebe
    && importStatus !== 'failed';

  /* Nur das heisst wirklich "es bewegt sich": ein Job, den das
     System schuldet. Alles andere waere eine Animation ohne Vorgang
     dahinter. */
  const inArbeit = importStatus === 'running' || Boolean(laufenderJob);

  /* queued = eingereiht, aber der Worker war noch nicht dran.
     running = er arbeitet daran. Fuer den Kunden ist das der
     Unterschied zwischen "wartet auf den naechsten Lauf" und "laeuft
     gerade" — und nur im ersten Fall ist die Fuenf-Minuten-Taktung
     die Erklaerung, die er braucht. */
  const wartetAufWorker = importJobStatus === 'queued'
    || laufenderJob?.status === 'queued';

  const dauerMs = begonnenAm ? Math.max(0, jetzt - Date.parse(begonnenAm)) : null;
  const langsam = dauerMs !== null && dauerMs > LANGSAM_AB_MS;

  const schritte = [
    {
      id: 'konto',
      label: 'Google-Konto verbunden',
      zustand: 'fertig',
    },
    {
      id: 'betriebe',
      label: 'Betriebe aus deinem Profil laden',
      zustand: standorteDa ? 'fertig'
        : importStatus === 'running' ? 'aktiv'
        : 'wartet',
    },
    {
      id: 'bewertungen',
      label: 'Bewertungen und Kennzahlen holen',
      zustand: bewertungenDa ? 'fertig'
        : standorteDa ? 'aktiv'
        : 'wartet',
    },
  ];

  return { aktiv, inArbeit, wartetAufWorker, schritte, dauerMs, langsam };
}

/* Minuten:Sekunden. Keine Bibliothek fuer vier Zeilen. */
export function formatiereDauer(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return null;
  const gesamt = Math.floor(ms / 1000);
  const min = Math.floor(gesamt / 60);
  const sek = gesamt % 60;
  return `${min}:${String(sek).padStart(2, '0')}`;
}

/* ── Darstellung ── */

const gleiten = keyframes`
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
`;

const Balken = styled.div`
  position: relative;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--color-border);
  margin: 2px 0 14px;
`;

const BalkenLauf = styled.div`
  position: absolute;
  top: 0; bottom: 0; left: 0;
  width: 25%;
  border-radius: 2px;
  background: var(--color-accent);

  ${({ $inArbeit }) => $inArbeit
    ? css`animation: ${gleiten} 1.6s linear infinite;`
    /* Nichts in Arbeit: ein ruhiger Stummel statt einer Animation,
       die Bewegung behauptet, wo keine ist. */
    : css`width: 8%; opacity: .5;`}

  /* Eine Dauerschleife ist fuer manche Menschen nicht nur Deko,
     sondern eine Zumutung. Wer das System auf reduzierte Bewegung
     gestellt hat, bekommt eine ruhige Fuellung — die Information
     steht ohnehin im Text daneben, nicht im Balken. */
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    width: 100%;
    opacity: .35;
  }
`;

const SchrittListe = styled.ul`
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 9px;
`;

const Schritt = styled.li`
  display: flex; align-items: center; gap: 9px;
  font-family: var(--font-body); font-size: .82rem; line-height: 1.4;
  color: ${({ $zustand }) => $zustand === 'wartet'
    ? 'var(--color-text-muted)' : 'var(--color-text)'};
  font-weight: ${({ $zustand }) => ($zustand === 'aktiv' ? 700 : 400)};
`;

const Punkt = styled.span`
  flex-shrink: 0;
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  ${({ $zustand }) => {
    if ($zustand === 'fertig') {
      return css`background: #1E7E34; color: #fff;`;
    }
    if ($zustand === 'aktiv') {
      return css`
        background: transparent;
        border: 2px solid var(--color-accent);
      `;
    }
    return css`
      background: transparent;
      border: 2px solid var(--color-border);
    `;
  }}
`;

const Kopf = styled.div`
  display: flex; align-items: center; gap: 9px; margin-bottom: 10px;
`;

const Titel = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .87rem;
  color: var(--color-primary);
`;

const Unterzeile = styled.p`
  font-family: var(--font-body); font-size: .78rem; line-height: 1.55;
  color: var(--color-text-muted); margin: 12px 0 0;
`;

const Karte = styled(Card)`
  border-left: 3px solid var(--color-accent);
`;

/* Nur fuer Vorleseprogramme. Selbst definiert, weil es im Projekt
   keine Klasse sr-only gibt — className="sr-only" waere wirkungslos
   gewesen und der Zusatz "erledigt" stuende sichtbar in der Liste. */
const NurFuerVorleser = styled.span`
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

/**
 * @param einrichtung  Ergebnis von leiteEinrichtungAb()
 */
export default function EinrichtungsFortschritt({ einrichtung }) {
  const { inArbeit, wartetAufWorker, schritte, dauerMs, langsam } = einrichtung;

  const dauer = formatiereDauer(dauerMs);

  /*
   * Die Unterzeile ist der eigentliche Inhalt. Der Balken sagt nur
   * "es laeuft"; was der Kunde wissen muss, steht hier.
   *
   * Vier Faelle, und keiner davon verspricht einen Zeitpunkt, den wir
   * nicht halten koennen.
   */
  const unterzeile = langsam
    ? `Es dauert länger als erwartet — seit ${dauer}. Der Abgleich läuft im Hintergrund weiter, auch wenn du diese Seite schließt. Du musst nichts tun.`
    : wartetAufWorker
      ? 'Dein Auftrag ist eingereiht. WERKRUF startet alle fünf Minuten einen Abgleichlauf — es dauert also meist zwei bis drei Minuten, bis die ersten Daten da sind.'
      : inArbeit
        ? 'Deine Daten werden gerade von Google geholt.'
        : 'Die nächsten Schritte laufen automatisch. Du musst nichts tun.';

  return (
    <Karte>
      <Kopf>
        <Clock size={19} color="#D48A00" aria-hidden="true" />
        <Titel>Einrichtung läuft</Titel>
      </Kopf>

      {/*
        progressbar OHNE aria-valuenow. Das ist kein Versehen: Genau
        so kodiert ARIA einen unbestimmten Fortschritt. Eine Zahl
        hier waere geraten.
      */}
      <Balken
        role="progressbar"
        aria-label="Einrichtung läuft"
        aria-busy={inArbeit ? 'true' : 'false'}
      >
        <BalkenLauf $inArbeit={inArbeit} />
      </Balken>

      {/*
        aria-live polite, damit ein Screenreader den Phasenwechsel
        mitbekommt, ohne den Nutzer mitten im Satz zu unterbrechen.
      */}
      <SchrittListe aria-live="polite">
        {schritte.map((s) => (
          <Schritt key={s.id} $zustand={s.zustand} data-schritt={s.id} data-zustand={s.zustand}>
            <Punkt $zustand={s.zustand} aria-hidden="true">
              {s.zustand === 'fertig' && <Check size={11} strokeWidth={3} />}
            </Punkt>
            {s.label}
            {s.zustand === 'fertig' && <NurFuerVorleser> — erledigt</NurFuerVorleser>}
          </Schritt>
        ))}
      </SchrittListe>

      <Unterzeile>{unterzeile}</Unterzeile>
    </Karte>
  );
}
