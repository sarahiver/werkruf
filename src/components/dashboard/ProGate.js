import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Lock, ArrowRight, CheckCircle, Zap } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { useCheckout } from '../../hooks/useCheckout';

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

const PRO_FEATURES = [
  'Google Bewertungen verwalten & beantworten',
  'KI-Antwort-Assistent (Claude)',
  'Foto-Upload & Galerie',
  'Kunden-Gewinnung (QR-Code & Review-Link)',
  'Monatliche PDF-Reports',
  'Profil-Monitoring & Wettbewerber-Check',
];

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
  const { profile } = useAuthContext();
  const { pricing } = useIndustry();
  const { startCheckout, loading } = useCheckout();

  const plan   = profile?.plan || 'free';
  const isPro  = plan === 'pro' || plan === 'trial';

  // Allow access for pro/trial users
  if (isPro) return children;

  const handleUpgrade = () => {
    startCheckout({
      plan:        'monthly',
      path:        'optimisation',
      companyName: profile?.company_name || '',
      industryKey: profile?.industry_key || 'handwerk',
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
          {feature || 'Diese Funktion'} ist<br />nur für PRO-Nutzer.
        </Title>
        <Sub>
          Starte deinen kostenlosen 30-Tage-Test —
          du zahlst erst danach und kannst jederzeit kündigen.
        </Sub>

        <FeatureList>
          {PRO_FEATURES.map((f, i) => (
            <FeatureItem key={i}>
              <CheckCircle size={15} />
              {f}
            </FeatureItem>
          ))}
        </FeatureList>

        <CTABtn onClick={handleUpgrade} disabled={loading}>
          {loading
            ? 'Weiterleitung zu Stripe…'
            : <>30 Tage gratis testen <ArrowRight size={16} /></>
          }
        </CTABtn>
        <Note>
          Danach {pricing?.pathA?.monthlyPrice || 49}€/Monat · monatlich kündbar · kein Jahresvertrag
        </Note>
      </Card>
    </Overlay>
  );
}
