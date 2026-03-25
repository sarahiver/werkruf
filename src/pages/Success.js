import React from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { CheckCircle, AlertTriangle, ArrowRight, TrendingDown } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp = keyframes`from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}`;
const checkPop = keyframes`
  0%  { opacity:0; transform: scale(0.4); }
  70% { transform: scale(1.15); }
  100%{ opacity:1; transform: scale(1); }
`;
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:.55}`;

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Page = styled.div`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  position: relative;
  overflow: hidden;
`;

const GridBg = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb),.04) 1px, transparent 1px);
  background-size: 44px 44px;
`;

const Card = styled.div`
  background: white;
  border-top: 6px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 52px 48px;
  max-width: 600px;
  width: 100%;
  position: relative;
  animation: ${fadeUp} .6s ease both;
  @media(max-width:560px){padding:36px 24px;}
`;

const CheckWrap = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: 28px;
  color: var(--color-accent);
  animation: ${checkPop} .5s cubic-bezier(.22,1,.36,1) both;
`;

const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: .72rem;
  letter-spacing: .18em; text-transform: uppercase;
  color: var(--color-accent);
  text-align: center; margin-bottom: 12px;
`;

const Headline = styled.h1`
  font-size: clamp(1.8rem, 4vw, 2.4rem);
  text-transform: var(--text-transform);
  color: var(--color-primary);
  text-align: center;
  line-height: 1.1;
  margin-bottom: 8px;
`;

const HeadlineAccent = styled.span`color: var(--color-accent);`;

const SubText = styled.p`
  font-family: var(--font-body);
  font-size: .9rem;
  color: var(--color-text-muted);
  text-align: center;
  margin-bottom: 32px;
  line-height: 1.6;
`;

/* Urgency block */
const UrgencyBox = styled.div`
  background: #FDECEA;
  border: 1px solid #F5A8A0;
  border-left: 4px solid #D93025;
  border-radius: var(--radius-card);
  padding: 20px 20px;
  margin-bottom: 28px;
  animation: ${fadeUp} .6s ease .15s both;
`;

const UrgencyRow = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
`;

const UrgencyIcon = styled.div`
  color: #D93025; flex-shrink: 0; margin-top: 2px;
  animation: ${pulse} 2s ease infinite;
`;

const UrgencyTitle = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .95rem; color: #1A1A1A; margin-bottom: 4px;
`;

const UrgencyText = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: #5A1A1A; line-height: 1.55;
`;

const LossNumber = styled.span`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.15rem;
  color: #D93025;
`;

/* Score chip */
const ScoreChip = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  background: #FFF3E0;
  border: 1px solid rgba(var(--color-accent-rgb), .3);
  border-radius: var(--radius-button);
  padding: 6px 14px;
  margin-bottom: 24px;
`;

const ScoreLabel = styled.span`
  font-family: var(--font-body); font-weight: 700;
  font-size: .8rem; color: var(--color-text-muted);
  text-transform: uppercase; letter-spacing: .06em;
`;

const ScoreNum = styled.span`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.1rem;
  color: ${({ $score }) =>
    $score >= 70 ? '#1E7E34' : $score >= 45 ? '#D48A00' : '#D93025'};
`;

/* CTA */
const CTABtn = styled(Link)`
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 17px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.1rem; letter-spacing: .07em; text-transform: var(--text-transform);
  text-decoration: none;
  border-radius: var(--radius-button);
  box-shadow: 0 4px 20px rgba(var(--color-accent-rgb), .4);
  transition: filter .2s, transform .1s;
  margin-bottom: 12px;
  &:hover { filter: brightness(.9); transform: translateY(-2px); }
`;

const SecondaryLink = styled(Link)`
  display: block; text-align: center;
  font-family: var(--font-body); font-size: .83rem;
  color: var(--color-text-muted); text-decoration: underline;
  text-underline-offset: 3px;
  transition: color .2s;
  &:hover { color: var(--color-primary); }
`;

const Divider = styled.div`
  height: 1px; background: var(--color-border);
  margin: 24px 0;
`;

const EmailConfirm = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  background: #E8F5E9;
  border-radius: var(--radius-card);
  margin-bottom: 24px;
`;

const EmailText = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: #1A1A1A; line-height: 1.4;
  strong { font-weight: 700; }
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Success() {
  const location = useLocation();
  const navigate  = useNavigate();
  const { pricing, brand }  = useIndustry();

  // Get data passed from AnalysisSection via navigate state
  const { email, result } = location.state || {};

  // Redirect back if no state (direct URL access)
  if (!result) {
    navigate('/', { replace: true });
    return null;
  }

  // Urgency calculation: unanswered reviews * avgOrderValue * 0.1 * 12 months factor
  const monthlyLoss = Math.round(
    (result.unanswered || 2) * pricing.roi.avgOrderValue * 0.1
  );

  return (
    <Page>
      <GridBg />
      <Card>
        <CheckWrap>
          <CheckCircle size={64} strokeWidth={1.5} />
        </CheckWrap>

        <Eyebrow>Report wird erstellt</Eyebrow>

        <Headline>
          Moin! Dein Report für{' '}
          <HeadlineAccent>{result.name}</HeadlineAccent>{' '}
          ist unterwegs.
        </Headline>

        {/* Email confirmation */}
        <SubText>
          Wir schicken ihn in den nächsten 48 Stunden an:
        </SubText>

        <EmailConfirm>
          <CheckCircle size={18} color="#1E7E34" style={{ flexShrink: 0 }} />
          <EmailText><strong>{email}</strong></EmailText>
        </EmailConfirm>

        {/* Score chip */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <ScoreChip>
            <TrendingDown size={15} color="#D48A00" />
            <ScoreLabel>Aktueller Score:</ScoreLabel>
            <ScoreNum $score={result.score}>{result.score} / 100</ScoreNum>
          </ScoreChip>
        </div>

        {/* Urgency block — the loss hook */}
        <UrgencyBox>
          <UrgencyRow>
            <UrgencyIcon>
              <AlertTriangle size={20} />
            </UrgencyIcon>
            <div>
              <UrgencyTitle>
                Achtung: {result.unanswered} unbeantwortete Bewertungen gefunden.
              </UrgencyTitle>
              <UrgencyText>
                Du verlierst aktuell schätzungsweise{' '}
                <LossNumber>~{monthlyLoss.toLocaleString('de-DE')} €</LossNumber>{' '}
                Umsatz pro Monat — weil potenzielle Kunden dein Profil sehen
                und zur Konkurrenz wechseln. Das lässt sich in 48h beheben.
              </UrgencyText>
            </div>
          </UrgencyRow>
        </UrgencyBox>

        <Divider />

        {/* CTA */}
        <CTABtn
          to="/signup"
          state={{ prefillEmail: email, result }}
        >
          Direkt beheben — {pricing.trialDays} Tage {brand.name} kostenlos
          <ArrowRight size={18} />
        </CTABtn>

        <SecondaryLink to="/">
          Erstmal den Report abwarten →
        </SecondaryLink>
      </Card>
    </Page>
  );
}
