import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Lock, ArrowRight, CheckCircle, Zap } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { useCheckout } from '../../hooks/useCheckout';
import { hasPaidAccess, hatteSchonAbo } from '../../utils/subscription';
import { TRIAL_TAGE } from '../../utils/checkoutRegeln';
import TarifWahl from '../TarifWahl';

const fadeUp = keyframes`from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}`;
const float  = keyframes`0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}`;

const Overlay = styled.div`
  min-height: 60vh;
  display: flex; align-items: center; justify-content: center;
  padding: 40px 24px;
  animation: ${fadeUp} .4s ease both;
`;

const Card = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 40px 36px;
  max-width: 480px; width: 100%;
  text-align: center;
`;

const IconWrap = styled.div`
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(var(--color-accent-rgb), .1);
  border: 2px solid rgba(var(--color-accent-rgb), .2);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 20px;
  color: var(--color-accent);
  animation: ${float} 3s ease infinite;
`;

const Badge = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(var(--color-accent-rgb), .1);
  border: 1px solid rgba(var(--color-accent-rgb), .25);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .7rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 4px 10px; border-radius: var(--radius-button);
  margin-bottom: 16px;
`;

const Title = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.4rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 10px; line-height: 1.2;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text-muted); line-height: 1.65; margin-bottom: 24px;
`;

const FeatureList = styled.ul`
  list-style: none; text-align: left;
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 28px;
`;

const FeatureItem = styled.li`
  display: flex; align-items: center; gap: 10px;
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text);
  svg { color: var(--color-accent); flex-shrink: 0; }
`;

const CTABtn = styled.button`
  width: 100%; padding: 14px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: .07em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 4px 16px rgba(var(--color-accent-rgb), .35);
  transition: filter .2s, transform .1s;
  &:hover:not(:disabled) { filter: brightness(.9); transform: translateY(-1px); }
  &:disabled { opacity: .6; cursor: not-allowed; transform: none; }
`;

const Note = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: var(--color-text-muted); margin-top: 12px; line-height: 1.5;
`;

const ErrorText = styled.p`
  margin-top: 12px; color: #B3261E; font-family: var(--font-body);
  font-size: .8rem; line-height: 1.45;
`;

/* Nur, was es gibt (WP4, 23.10.2026). Hier standen „Monatliche
   PDF-Reports“ (am 21.10. aus dem Produkt genommen) und
   „Wettbewerber-Check“ (nie gebaut). Ein Versprechen hinter einer
   Bezahlschranke, das nicht eingeloest wird, ist das Gegenteil von
   dem, was die Schranke rechtfertigt. */
export const PRO_FEATURES = [
  'Priorisierte Aufgaben aus deinem echten Google-Profil',
  'Bewertungen mit Antwortvorschlägen — veröffentlicht wird nur, was du freigibst',
  'Wochenmail mit deinen Aufgaben, direkt erledigbar',
  'Sofortmeldung bei kritischen Bewertungen',
  'Fotos — hochladen und bei Google verwalten',
  'Mehr Bewertungen (QR-Code & Bewertungslink)',
];

/*
 * Was das Gate verspricht, haengt davon ab, wer davor steht (WP7 §8/§10).
 *
 *   Neukunde     → „30 Tage gratis testen", danach 49 €/Monat
 *   Wiedereinstieg (hatte schon ein Abo oder einen Test)
 *                → „Pro wieder aktivieren", 49 €/Monat ab sofort
 *
 * Der Server (create-checkout-session) entscheidet den Trial
 * endgueltig; die Oberflaeche darf nur nichts versprechen, was er
 * nicht einloest. Deshalb hier dieselbe Regel (hatteSchonAbo), nicht
 * eine eigene.
 */
export function gateTexte(profile, preis = 49) {
  if (hatteSchonAbo(profile)) {
    return {
      titel: 'gehört zu WERKRUF Pro.',
      sub: 'Du nutzt WERKRUF Free: Profil und Score bleiben im Blick. Mit Pro bekommst du wieder konkrete Aufgaben, Bewertungsantworten und laufende Unterstützung.',
      cta: 'Pro wieder aktivieren',
      note: `${preis} € / Monat · monatlich kündbar · kein Jahresvertrag`,
    };
  }
  return {
    titel: 'ist nur für PRO-Nutzer.',
    sub: `Starte deinen kostenlosen ${TRIAL_TAGE}-Tage-Test — du zahlst erst danach und kannst jederzeit kündigen.`,
    cta: `${TRIAL_TAGE} Tage gratis testen`,
    note: `Danach ${preis} € / Monat · monatlich kündbar · kein Jahresvertrag`,
  };
}

/* ─────────────────────────────────────────────
   COMPONENT

   Wraps any dashboard page — shows paywall
   if user is not on trial or pro plan.

   Usage:
     <ProGate feature="Bewertungen">
       <DashboardBewertungen />
     </ProGate>
───────────────────────────────────────────── */
export default function ProGate({ children, feature }) {
  const { profile, profileLoading, profileError, refreshProfile } = useAuthContext();
  const [tarif, setTarif] = useState('monthly');   // WP13
  const { pricing } = useIndustry();
  const { startCheckout, loading, error } = useCheckout();

  const isPro = hasPaidAccess(profile);
  const texte = gateTexte(profile, pricing?.monthlyPrice || 49);

  if (profileLoading) {
    return <Overlay><Card role="status">Abo-Status wird geladen…</Card></Overlay>;
  }

  if (profileError) {
    return (
      <Overlay><Card>
        <Title>Abo-Status nicht verfügbar</Title>
        <Sub>{profileError}</Sub>
        <CTABtn type="button" onClick={() => refreshProfile()}>Erneut laden</CTABtn>
      </Card></Overlay>
    );
  }

  // Allow access for pro/trial users
  if (isPro) return children;

  const handleUpgrade = () => {
    startCheckout({
      plan:        tarif,
      path:        'optimisation',
      companyName: profile?.company_name || '',
      industryKey: profile?.industry_key || 'handwerk',
      /* WP7 §19: nach dem Bezahlen zurueck hierher — mit Query
         (z. B. ?betrieb=…&review=…). window.location statt useLocation,
         damit das Gate keinen Router voraussetzt; der Server validiert
         den Pfad ohnehin (sichererRueckkehrpfad). */
      returnPath:  `${window.location.pathname}${window.location.search}`,
    });
  };

  return (
    <Overlay>
      <Card>
        <IconWrap>
          <Lock size={26} />
        </IconWrap>
        <Badge><Zap size={11} /> PRO Feature</Badge>
        <Title>
          {feature || 'Diese Funktion'}<br />{texte.titel}
        </Title>
        <Sub>{texte.sub}</Sub>

        <FeatureList>
          {PRO_FEATURES.map((f, i) => (
            <FeatureItem key={i}>
              <CheckCircle size={15} />
              {f}
            </FeatureItem>
          ))}
        </FeatureList>

        <TarifWahl value={tarif} onChange={setTarif} disabled={loading} />
        <CTABtn onClick={handleUpgrade} disabled={loading}>
          {loading
            ? 'Weiterleitung zu Stripe…'
            : <>{texte.cta} <ArrowRight size={16} /></>
          }
        </CTABtn>
        <Note>{texte.note}</Note>
        {error && <ErrorText role="alert">{error}</ErrorText>}
      </Card>
    </Overlay>
  );
}
