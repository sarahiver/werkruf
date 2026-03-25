import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { X, CheckCircle, TrendingUp } from 'lucide-react';
import PricingCard, { buildStripeMetadata } from '../PricingCard';

const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const scaleIn = keyframes`from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; overflow-y: auto;
  animation: ${fadeIn} .2s ease both;
`;

const Sheet = styled.div`
  background: var(--color-white);
  border-radius: var(--radius-card);
  border-top: 5px solid var(--color-accent);
  width: 100%; max-width: 520px;
  position: relative;
  animation: ${scaleIn} .25s ease both;
`;

const CloseBtn = styled.button`
  position: absolute; top: 16px; right: 16px;
  background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); padding: 4px;
  border-radius: var(--radius-button);
  &:hover { background: var(--color-bg); }
`;

const Head = styled.div`
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--color-border);
`;

const Title = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.3rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); line-height: 1.5;
`;

const Body = styled.div`padding: 24px;`;

const ScoreHighlight = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: rgba(var(--color-accent-rgb), .06);
  border-left: 3px solid var(--color-accent);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  margin-bottom: 20px;
`;

const ScoreNum = styled.div`
  font-family: var(--font-display); font-weight: 900;
  font-size: 1.8rem; line-height: 1;
  color: ${({ $c }) => $c || 'var(--color-primary)'};
`;

const ScoreText = styled.div``;
const ScoreLabel = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .85rem; color: var(--color-primary);
`;
const ScoreSub = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); line-height: 1.4;
`;

export default function PathAPricingModal({
  onClose,
  onCheckoutStart,
  companyName,
  score,
  userId,
  industryKey,
}) {
  const [loading, setLoading] = useState(false);

  const scoreColor = score >= 70 ? '#1E7E34' : score >= 45 ? '#D48A00' : '#D93025';
  const scoreLabel = score >= 70 ? 'GUT' : score >= 45 ? 'AUSBAUFÄHIG' : 'KRITISCH';

  const handleCheckout = ({ plan }) => {
    setLoading(true);
    const metadata = buildStripeMetadata({
      plan,
      path: 'optimisation',
      industryKey,
      userId,
      companyName,
    });
    if (onCheckoutStart) onCheckoutStart({ metadata, plan });
    setLoading(false);
  };

  return (
    <Overlay onClick={e => e.target === e.currentTarget && onClose()}>
      <Sheet>
        <CloseBtn onClick={onClose}><X size={18} /></CloseBtn>
        <Head>
          <Title>WERKRUF PRO starten</Title>
          <Sub>
            30 Tage kostenlos testen — danach nur wenn du zufrieden bist.
            Kein Jahresvertrag, monatlich kündbar.
          </Sub>
        </Head>
        <Body>
          {score !== null && (
            <ScoreHighlight>
              <ScoreNum $c={scoreColor}>{score}</ScoreNum>
              <ScoreText>
                <ScoreLabel>
                  {companyName} — Score: {scoreLabel}
                </ScoreLabel>
                <ScoreSub>
                  Mit WERKRUF PRO optimieren wir dein Profil auf 85+ Punkte.
                </ScoreSub>
              </ScoreText>
            </ScoreHighlight>
          )}
          <PricingCard
            path="optimisation"
            onCheckout={handleCheckout}
            loading={loading}
            companyName={companyName}
          />
        </Body>
      </Sheet>
    </Overlay>
  );
}
