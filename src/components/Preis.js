/*
 * Der Preis auf der Landingpage.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESE SEKTION GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Bis zum 16.10.2026 nannte die Landingpage den Preis an keiner
 * einzigen Stelle. Wer den Hero-CTA drückte, erfuhr erst nach der
 * Registrierung, dass WERKRUF Geld kostet — der teuerste denkbare
 * Moment dafür. Ein Betrieb, der den Preis vorher kennt, registriert
 * sich seltener, bricht aber auch seltener ab, und er fühlt sich
 * nicht überrumpelt.
 *
 * ═══════════════════════════════════════════════════════════════
 * EIN PRODUKT, EIN PREIS
 * ═══════════════════════════════════════════════════════════════
 *
 * Kein kostenloser Tarif: Es gibt keinen. Die Preisseite zeigte bis
 * heute eine Free-Karte für den "Sichtbarkeits-Check ohne Anmeldung",
 * den es seit dem 28.09.2026 nicht mehr gibt.
 *
 * Keine Quartals- oder Jahrespreise: Der Checkout steht fest auf
 * 'monthly'. Ein Preis auf der Seite, den der Bezahlvorgang nicht
 * annimmt, ist ein Abbruch mit Ansage.
 *
 * Keine Rechnung mit erfundenen Zahlen. Die einzige Zahl, die hier
 * steht, ist die wahre: 49 € im Monat, 588 € im Jahr.
 */
import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';
import { useAuthContext } from '../context/AuthContext';

const Section = styled.section`
  background: var(--color-bg);
  padding: 96px 24px;
`;

const Inner = styled.div`max-width: 900px; margin: 0 auto;`;

const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 12px; text-align: center;
`;

const Titel = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.9rem, 4vw, 2.8rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.06;
  text-align: center; margin-bottom: 40px;
  overflow-wrap: break-word; hyphens: auto;
`;

const Karte = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 44px 44px 40px;
  @media (max-width: 620px) { padding: 32px 22px 30px; }
`;

const PreisZeile = styled.div`
  display: flex; align-items: baseline; justify-content: center;
  gap: 10px; flex-wrap: wrap;
`;

const Betrag = styled.span`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(3rem, 8vw, 4.4rem); line-height: 1;
  color: var(--color-primary);
`;

const Periode = styled.span`
  font-family: var(--font-body); font-size: 1rem;
  color: var(--color-text-muted);
`;

const Unterzeile = styled.p`
  font-family: var(--font-body); font-size: 0.95rem;
  color: var(--color-text-muted); text-align: center;
  margin: 10px 0 0;
`;

const Trennlinie = styled.hr`
  border: none; border-top: 1px solid var(--color-border);
  margin: 32px 0;
`;

const Liste = styled.ul`
  list-style: none; padding: 0; margin: 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px 28px;
  @media (max-width: 620px) { grid-template-columns: 1fr; }
`;

const Punkt = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-family: var(--font-body); font-size: 0.92rem;
  color: var(--color-text); line-height: 1.55;
  svg { color: var(--color-accent); flex-shrink: 0; margin-top: 3px; }
`;

const Cta = styled(Link)`
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-top: 32px; padding: 17px 28px;
  background: var(--color-accent); color: var(--color-white);
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.12rem; letter-spacing: 0.06em;
  text-transform: var(--text-transform);
  text-decoration: none; text-align: center;
  border-radius: var(--radius-button);
  transition: filter 0.2s;
  &:hover { filter: brightness(0.92); }
`;

const Fussnote = styled.p`
  font-family: var(--font-body); font-size: 0.82rem;
  color: var(--color-text-muted); text-align: center;
  line-height: 1.6; margin: 14px 0 0;
`;

/* Die Einordnung ohne Rechnung.

   Hier stand bis zum 16.10.2026 ein Schieberegler, der aus 30 Anrufen
   "9 neue Aufträge", "3.600 € Zusatzumsatz" und "ROI 7247 %" machte.
   Keine der drei Zahlen war belegbar, und die Rechnung verwandelte
   einen Anruf stillschweigend in einen Auftrag.

   Was bleibt, ist eine Bedingung statt einer Prognose: Wenn, dann. */
const Einordnung = styled.div`
  margin-top: 36px; padding: 22px 24px;
  background: rgba(var(--color-primary-rgb), 0.04);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-button);
  font-family: var(--font-body); font-size: 0.95rem;
  color: var(--color-text); line-height: 1.7;
  strong { color: var(--color-primary); }
`;

export default function Preis() {
  const { pricing, brand } = useIndustry();
  const { isAuthenticated } = useAuthContext();

  const jahr = pricing.monthlyPrice * 12;
  const ziel = isAuthenticated ? '/dashboard' : '/signup';

  return (
    <Section id="preis">
      <Inner>
        <Eyebrow>Ein Produkt, ein Preis</Eyebrow>
        <Titel>Was {brand.name} kostet</Titel>

        <Karte>
          <PreisZeile>
            <Betrag>{pricing.monthlyPrice}{pricing.currency}</Betrag>
            <Periode>{pricing.priceLabel}</Periode>
          </PreisZeile>
          <Unterzeile>
            Die ersten {pricing.trialDays} Tage kostenlos · monatlich kündbar ·
            keine Einrichtungsgebühr
          </Unterzeile>

          <Trennlinie />

          <Liste>
            {(pricing.features ?? []).map((f) => (
              <Punkt key={f}><Check size={16} />{f}</Punkt>
            ))}
          </Liste>

          <Cta to={ziel}>
            {isAuthenticated
              ? 'Zum Dashboard'
              : `Jetzt ${pricing.trialDays} Tage kostenlos testen`}
            <ArrowRight size={19} />
          </Cta>
          <Fussnote>
            Zahlungsdaten werden beim Start hinterlegt — in den ersten{' '}
            {pricing.trialDays} Tagen wird nichts abgebucht.
          </Fussnote>

          <Einordnung>
            {brand.name} kostet <strong>{pricing.monthlyPrice} {pricing.currency} im Monat</strong>,
            also <strong>{jahr} {pricing.currency} im Jahr</strong>. Wenn dein besserer
            lokaler Auftritt im Jahr auch nur zu einem zusätzlichen Auftrag
            beiträgt, kann sich der Monatsbeitrag bereits rechnen. Versprechen
            können wir das nicht — entscheiden tut am Ende dein Kunde.
          </Einordnung>
        </Karte>
      </Inner>
    </Section>
  );
}
