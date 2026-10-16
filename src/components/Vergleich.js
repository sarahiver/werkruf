/*
 * Drei Wege, ein Google-Profil zu pflegen.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE SEKTION
 * ═══════════════════════════════════════════════════════════════
 *
 * Ein Handwerksbetrieb vergleicht WERKRUF nicht mit anderer Software.
 * Er vergleicht es mit dem, was er sonst täte: selbst machen oder eine
 * Agentur beauftragen. Solange diese Frage unbeantwortet bleibt, ist
 * der Preis nicht einzuordnen — 49 € sind teuer gegen "nichts tun" und
 * günstig gegen ein Betreuungspaket.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER BEWUSST NICHT STEHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Keine Wettbewerberpreise. Es gibt Anbieter mit 49 € netto und
 * zwölf Monaten Laufzeit und solche mit dreistelligen Monatspaketen;
 * eine Zahl in die Spalte zu schreiben hiesse, eine Spanne als
 * Tatsache auszugeben. "Monatspaket" ist das, was alle gemeinsam
 * haben.
 *
 * Keine Abwertung. Die Agenturspalte beschreibt ein anderes Modell,
 * kein schlechteres. Für einen Betrieb, der gar nichts selbst machen
 * will, ist eine Agentur die richtige Wahl — und dieser Betrieb ist
 * nicht die Zielgruppe von WERKRUF.
 *
 * Die Zeilen stehen in industryConfig unter pricing.comparison, damit
 * Text und Preisseite nicht auseinanderlaufen können.
 */
import React from 'react';
import styled from 'styled-components';
import { useIndustry } from '../context/IndustryContext';

const Section = styled.section`
  background: var(--color-primary);
  padding: 96px 24px;
`;

const Inner = styled.div`max-width: 1000px; margin: 0 auto;`;

const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 12px;
`;

const Titel = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.9rem, 4vw, 2.8rem);
  text-transform: var(--text-transform);
  color: var(--color-white); line-height: 1.06;
  margin-bottom: 16px;
  overflow-wrap: break-word; hyphens: auto;
`;

const Einleitung = styled.p`
  font-family: var(--font-body); font-size: 1rem;
  color: rgba(255,255,255,0.62); line-height: 1.7;
  max-width: 620px; margin-bottom: 44px;
`;

/* Auf dem Telefon wird aus der Tabelle eine Liste von Karten. Eine
   vierspaltige Tabelle auf 375px erzwingt waagerechtes Scrollen, und
   genau dort liest ein Handwerker. */
const Tabelle = styled.div`
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

const Zeile = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1.1fr;
  border-top: 1px solid rgba(255,255,255,0.1);
  &:first-child { border-top: none; }
  @media (max-width: 760px) { display: block; }
`;

const Kopf = styled(Zeile)`
  background: rgba(255,255,255,0.05);
  @media (max-width: 760px) { display: none; }
`;

const Zelle = styled.div`
  padding: 16px 18px;
  font-family: var(--font-body); font-size: 0.9rem;
  color: rgba(255,255,255,0.72); line-height: 1.5;
  @media (max-width: 760px) {
    display: flex; justify-content: space-between; gap: 16px;
    padding: 10px 18px;
    &::before {
      content: attr(data-spalte);
      font-weight: 700; color: rgba(255,255,255,0.45);
      font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em;
      flex-shrink: 0;
    }
  }
`;

const Merkmal = styled(Zelle)`
  font-weight: 700; color: var(--color-white);
  @media (max-width: 760px) {
    background: rgba(255,255,255,0.06);
    display: block; padding: 14px 18px 10px;
    &::before { content: none; }
  }
`;

const Unsere = styled(Zelle)`
  color: var(--color-white); font-weight: 700;
  background: rgba(var(--color-accent-rgb), 0.12);
  border-left: 2px solid var(--color-accent);
  @media (max-width: 760px) { border-left: none; }
`;

const KopfZelle = styled(Zelle)`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 0.95rem; letter-spacing: 0.06em;
  text-transform: var(--text-transform);
  color: var(--color-white);
`;

const Fazit = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.1rem, 2.2vw, 1.5rem);
  line-height: 1.35; letter-spacing: 0.02em;
  color: var(--color-white);
  margin-top: 44px; padding-left: 20px;
  border-left: 4px solid var(--color-accent);
  em { color: var(--color-accent); font-style: normal; }
`;

export default function Vergleich() {
  const { pricing, brand } = useIndustry();
  const zeilen = pricing.comparison ?? [];

  /* Ohne die neue Struktur (Gastro, Beauty) lieber gar nichts zeigen
     als eine halb gefüllte Tabelle. */
  if (!zeilen.length || !('werkruf' in (zeilen[0] ?? {}))) return null;

  return (
    <Section id="vergleich">
      <Inner>
        <Eyebrow>Die ehrliche Einordnung</Eyebrow>
        <Titel>Selbst machen, Agentur<br />oder {brand.name}?</Titel>
        <Einleitung>
          Dein Google-Profil pflegt sich nicht von allein. Es gibt drei Wege —
          und für viele Betriebe ist keiner davon offensichtlich der richtige.
          Deshalb hier nebeneinander, ohne Schönfärberei.
        </Einleitung>

        <Tabelle>
          <Kopf>
            <KopfZelle />
            <KopfZelle>Selbst machen</KopfZelle>
            <KopfZelle>Agentur</KopfZelle>
            <KopfZelle>{brand.name}</KopfZelle>
          </Kopf>

          {zeilen.map((z) => (
            <Zeile key={z.feature}>
              <Merkmal>{z.feature}</Merkmal>
              <Zelle data-spalte="Selbst">{z.selbst}</Zelle>
              <Zelle data-spalte="Agentur">{z.agentur}</Zelle>
              <Unsere data-spalte={brand.name}>{z.werkruf}</Unsere>
            </Zeile>
          ))}
        </Tabelle>

        <Fazit>
          {brand.name} ist für Betriebe, die <em>keine Agentur brauchen</em> —
          aber auch nicht jede Woche an Google denken wollen.
        </Fazit>
      </Inner>
    </Section>
  );
}
