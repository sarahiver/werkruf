/*
 * Preisseite.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS AM 16.10.2026 VERSCHWUNDEN IST — UND WARUM
 * ═══════════════════════════════════════════════════════════════
 *
 * Diese Seite trug bis heute 565 Zeilen, die grösstenteils eine
 * ältere Produktgeneration beschrieben. Entfernt wurden:
 *
 * 1 — DER ROI-RECHNER.
 *     Ein Schieberegler fragte "Wie viele Anrufe bekommst du aktuell
 *     pro Monat?", multiplizierte mit 0,30 und beschriftete das
 *     Ergebnis als "neue Aufträge" — eine Abschlussquote kam nirgends
 *     vor. Bei der Voreinstellung 30 zeigte die Seite 3.600 €
 *     Zusatzumsatz und "ROI 7247 %". Weder die 30 % noch die 400 €
 *     Auftragswert waren belegt.
 *
 * 2 — "3× MEHR ANFRAGEN" und "BIS ZU 9.120 € ZURÜCK".
 *     Beide standen im selben Hero wie die +30-%-Rechnung und
 *     widersprachen ihr: 3× sind +200 %, und der Rechner darunter kam
 *     auf 18.000 € statt 9.120 €.
 *
 * 3 — DER FREE-TARIF.
 *     Eine Karte "Sichtbarkeits-Check, 0 €, kein Account erforderlich"
 *     bewarb den öffentlichen Check und das Befund-PDF. Beides ist
 *     seit dem 28.09.2026 abgeschaltet, das PDF zusätzlich hinter
 *     einem geschlossenen Rechte-Gate.
 *
 * 4 — DIE ERFOLGSGARANTIE.
 *     "Wenn du nach 30 Tagen nicht mehr Anfragen hast als vorher,
 *     zahlst du nichts. Kein Kleingedrucktes." WERKRUF misst Anfragen
 *     nicht, und einen Erstattungsweg gibt es im Code nicht. Wer nicht
 *     kündigt, wird am 31. Tag abgebucht.
 *
 * 5 — DER ABSCHLUSS-CTA AUF /register.
 *     Diese Route existiert nicht. Der letzte Knopf der Seite führte
 *     auf die Fehlerseite.
 *
 * Belege zu allen fünf Punkten: docs/operations/p4a-product-truth-audit.md.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIE SEITE JETZT SO KURZ IST
 * ═══════════════════════════════════════════════════════════════
 *
 * Preis, Vergleich, FAQ und Abschluss stehen seit dem Umbau auch auf
 * der Landingpage — als eigene Komponenten. Sie hier ein zweites Mal
 * auszuformulieren hiesse, zwei Fassungen zu pflegen, die
 * auseinanderlaufen. Genau daran ist die alte Preisseite gestorben.
 *
 * Diese Seite bringt deshalb einen eigenen Kopf mit und setzt
 * darunter dieselben Bausteine ein.
 */
import React from 'react';
import styled from 'styled-components';
import { useIndustry } from '../context/IndustryContext';

import Preis        from '../components/Preis';
import Vergleich    from '../components/Vergleich';
import FAQ          from '../components/FAQ';
import AbschlussCTA from '../components/AbschlussCTA';

const Page = styled.div`background: var(--color-bg); min-height: 100vh;`;

const Kopf = styled.section`
  background: var(--color-primary);
  padding: 110px 24px 72px;
  position: relative; overflow: hidden;
`;

const Raster = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb), .04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb), .04) 1px, transparent 1px);
  background-size: 44px 44px;
  display: ${({ $show }) => ($show ? 'block' : 'none')};
`;

const Inner = styled.div`
  max-width: 860px; margin: 0 auto;
  text-align: center; position: relative;
`;

const Eyebrow = styled.div`
  display: inline-block;
  background: rgba(var(--color-accent-rgb), .12);
  border: 1px solid rgba(var(--color-accent-rgb), .35);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .72rem; letter-spacing: .18em; text-transform: uppercase;
  padding: 6px 14px; margin-bottom: 22px;
  border-radius: var(--radius-button);
`;

const H1 = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(2.1rem, 5vw, 3.4rem);
  text-transform: var(--text-transform);
  color: var(--color-white); line-height: 1.04;
  margin-bottom: 18px;
  overflow-wrap: break-word; hyphens: auto;
`;

const Akzent = styled.span`color: var(--color-accent);`;

const Lead = styled.p`
  font-family: var(--font-body); font-size: 1.05rem;
  color: rgba(255,255,255,.65); line-height: 1.7;
  max-width: 580px; margin: 0 auto;
`;

/* Vier Tatsachen statt vier Werbezahlen. Hier stand bis heute eine
   Reihe mit "3× mehr Anfragen" — die einzige Zahl darin, die keine
   Tatsache war, und zugleich die auffälligste. */
const Fakten = styled.div`
  display: flex; align-items: center; justify-content: center;
  flex-wrap: wrap; margin-top: 40px;
`;

const Fakt = styled.div`
  padding: 16px 30px; text-align: center;
  border-right: 1px solid rgba(255,255,255,.12);
  &:last-child { border-right: none; }
  @media (max-width: 600px) { padding: 12px 18px; }
`;

const FaktZahl = styled.div`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.8rem, 3.6vw, 2.6rem);
  color: var(--color-white); line-height: 1;
`;

const FaktText = styled.div`
  font-family: var(--font-body); font-size: .74rem;
  color: rgba(255,255,255,.5);
  text-transform: uppercase; letter-spacing: .1em; margin-top: 6px;
`;

export default function Pricing() {
  const { pricing, design, brand } = useIndustry();

  return (
    <Page>
      <Kopf>
        <Raster $show={design.accentStripePattern} />
        <Inner>
          <Eyebrow>{pricing.productName}</Eyebrow>
          <H1>
            Ein Produkt.<br />
            <Akzent>Ein Preis.</Akzent>
          </H1>
          <Lead>
            Keine Staffelung, kein Einstiegspaket, keine Einrichtungsgebühr.
            {' '}{brand.name} kann für jeden Betrieb dasselbe — also kostet es
            für jeden Betrieb dasselbe.
          </Lead>

          <Fakten>
            <Fakt>
              <FaktZahl>{pricing.monthlyPrice}<Akzent>{pricing.currency}</Akzent></FaktZahl>
              <FaktText>pro Monat</FaktText>
            </Fakt>
            <Fakt>
              <FaktZahl>{pricing.trialDays}<Akzent>T</Akzent></FaktZahl>
              <FaktText>kostenlos testen</FaktText>
            </Fakt>
            <Fakt>
              <FaktZahl>0<Akzent>{pricing.currency}</Akzent></FaktZahl>
              <FaktText>Einrichtung</FaktText>
            </Fakt>
            <Fakt>
              <FaktZahl>1<Akzent>×</Akzent></FaktZahl>
              <FaktText>Klick zum Kündigen</FaktText>
            </Fakt>
          </Fakten>
        </Inner>
      </Kopf>

      <Preis />
      <Vergleich />
      <FAQ />
      <AbschlussCTA />
    </Page>
  );
}
