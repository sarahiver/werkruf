import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { CheckCircle, Zap, Star, ArrowRight, Shield } from 'lucide-react';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;

/* ─────────────────────────────────────────────
   STRIPE METADATA BUILDER
───────────────────────────────────────────── */
export function buildStripeMetadata({ plan, path, industryKey, userId, companyName }) {
  return {
    plan_type:       plan,                    // 'monthly' | 'quarterly' | 'annual'
    path_type:       path,                    // 'optimisation' | 'setup'
    setup_included:  path === 'setup',
    industry_key:    industryKey || 'handwerk',
    user_id:         userId || '',
    company_name:    companyName || '',
    // Stripe Price IDs — set these in Vercel env vars
    price_id: {
      monthly:   process.env.REACT_APP_STRIPE_PRICE_MONTHLY   || 'price_monthly',
      quarterly: process.env.REACT_APP_STRIPE_PRICE_QUARTERLY || 'price_quarterly',
      annual:    process.env.REACT_APP_STRIPE_PRICE_ANNUAL    || 'price_annual',
    }[plan],
  };
}

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Wrap = styled.div`animation: ${fadeUp} .4s ease both;`;

const Toggle = styled.div`
  display: flex; align-items: center; justify-content: center;
  gap: 0; margin-bottom: 20px;
  background: var(--color-border);
  border-radius: var(--radius-button);
  padding: 3px; width: fit-content; margin-left: auto; margin-right: auto;
`;

const ToggleBtn = styled.button`
  padding: 7px 16px;
  font-family: var(--font-body); font-weight: 600; font-size: .82rem;
  border: none; cursor: pointer;
  border-radius: calc(var(--radius-button) - 2px);
  transition: background .15s, color .15s;
  background: ${({ $active }) => $active ? 'var(--color-primary)' : 'transparent'};
  color: ${({ $active }) => $active ? 'white' : 'var(--color-text-muted)'};
  position: relative;
`;

const SaveBadge = styled.span`
  position: absolute; top: -8px; right: -6px;
  background: var(--color-accent); color: white;
  font-size: .58rem; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  padding: 2px 5px; border-radius: 4px;
  white-space: nowrap;
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: ${({ $hasSetup }) => $hasSetup ? '1fr 1.1fr' : '1fr'};
  gap: 12px;
  @media(max-width:640px){ grid-template-columns: 1fr; }
`;

/* Setup fee card (Path B only) */
const SetupCard = styled.div`
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 20px;
`;

const SetupLabel = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .72rem;
  letter-spacing: .1em; text-transform: uppercase;
  color: var(--color-text-muted); margin-bottom: 8px;
`;

const SetupPrice = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 2rem; color: var(--color-primary); line-height: 1;
  margin-bottom: 4px;
`;

const SetupNote = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-bottom: 14px; line-height: 1.4;
`;

const SetupFeatures = styled.ul`list-style: none; display: flex; flex-direction: column; gap: 7px;`;

const SetupFeature = styled.li`
  display: flex; align-items: flex-start; gap: 8px;
  font-family: var(--font-body); font-size: .82rem; color: var(--color-text);
  svg { color: #1E7E34; flex-shrink: 0; margin-top: 1px; }
`;

const OwnershipBox = styled.div`
  background: rgba(var(--color-accent-rgb), .08);
  border: 1px solid rgba(var(--color-accent-rgb), .2);
  border-radius: var(--radius-card);
  padding: 10px 12px; margin-top: 14px;
  display: flex; align-items: flex-start; gap: 8px;
`;

const OwnershipText = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text); line-height: 1.45;
  strong { color: var(--color-accent); font-weight: 700; }
`;

/* Subscription card */
const SubCard = styled.div`
  background: var(--color-primary);
  border-radius: var(--radius-card);
  padding: 20px;
  border-top: 4px solid var(--color-accent);
`;

const SubLabel = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .72rem;
  letter-spacing: .1em; text-transform: uppercase;
  color: rgba(255,255,255,.5); margin-bottom: 8px;
`;

const PriceRow = styled.div`
  display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px;
`;

const PriceNum = styled.span`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 2.4rem; line-height: 1; color: white;
`;

const PricePer = styled.span`
  font-family: var(--font-body); font-size: .85rem;
  color: rgba(255,255,255,.5);
`;

const PriceSavings = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-accent); font-weight: 600; margin-bottom: 14px;
`;

const SubFeatures = styled.ul`list-style: none; display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px;`;

const SubFeature = styled.li`
  display: flex; align-items: center; gap: 8px;
  font-family: var(--font-body); font-size: .82rem; color: rgba(255,255,255,.8);
  svg { color: var(--color-accent); flex-shrink: 0; }
`;

const CTABtn = styled.button`
  width: 100%; padding: 13px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: .07em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 4px 16px rgba(var(--color-accent-rgb),.4);
  transition: filter .2s, transform .1s;
  &:hover { filter: brightness(.9); transform: translateY(-1px); }
  &:disabled { opacity: .5; cursor: not-allowed; transform: none; }
`;

const TrialNote = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: rgba(255,255,255,.3); text-align: center; margin-top: 10px;
`;

/* ─────────────────────────────────────────────
   PRICING DATA
───────────────────────────────────────────── */
const PLANS = [
  {
    key:    'monthly',
    label:  'Monatlich',
    price:  49,
    total:  49,
    period: '/ Monat',
    badge:  null,
    savings: null,
  },
  {
    key:    'quarterly',
    label:  'Quartal',
    price:  43,      // 129 / 3
    total:  129,
    period: '/ Monat',
    badge:  'Beliebt',
    savings: '12% Ersparnis — statt 147€',
  },
  {
    key:    'annual',
    label:  'Jährlich',
    price:  37,      // 449 / 12
    total:  449,
    period: '/ Monat',
    badge:  'Best Value',
    savings: '24% Ersparnis — statt 588€',
  },
];

const SUB_FEATURES = [
  'Google-Profil Optimierung',
  'Bewertungs-Autopilot',
  'Monatliches PDF-Reporting',
  'KI-Antwort-Assistent',
  'Wettbewerber-Monitoring',
  'Monatlich kündbar',
];

const SETUP_FEATURES = [
  'Google Business Profil anlegen',
  'Verifizierung begleiten',
  'Vollständige Erstoptimierung',
  '30 Tage Software gratis',
];

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function PricingCard({
  path = 'optimisation',  // 'optimisation' | 'setup'
  onCheckout,             // (metadata) => void
  loading = false,
  companyName = '',
}) {
  const [selected, setSelected] = useState('quarterly');
  const plan = PLANS.find(p => p.key === selected);
  const isSetup = path === 'setup';

  const handleCTA = () => {
    if (onCheckout) {
      onCheckout({
        plan:        selected,
        path:        isSetup ? 'setup' : 'optimisation',
        setupFee:    isSetup ? 149 : 0,
        totalFirst:  isSetup ? 149 + plan.total : plan.total,
        priceMonthly: plan.price,
        companyName,
      });
    }
  };

  return (
    <Wrap>
      {/* Period toggle */}
      <Toggle>
        {PLANS.map(p => (
          <ToggleBtn
            key={p.key}
            $active={selected === p.key}
            onClick={() => setSelected(p.key)}
          >
            {p.label}
            {p.badge && selected !== p.key && (
              <SaveBadge>{p.badge}</SaveBadge>
            )}
          </ToggleBtn>
        ))}
      </Toggle>

      <Cards $hasSetup={isSetup}>
        {/* Setup Fee Card — Path B only */}
        {isSetup && (
          <SetupCard>
            <SetupLabel>Einmalige Setup-Fee</SetupLabel>
            <SetupPrice>149€</SetupPrice>
            <SetupNote>Einmalig · Kein Abo · Sofort starten</SetupNote>
            <SetupFeatures>
              {SETUP_FEATURES.map((f, i) => (
                <SetupFeature key={i}>
                  <CheckCircle size={14} />
                  {f}
                </SetupFeature>
              ))}
            </SetupFeatures>
            <OwnershipBox>
              <Shield size={15} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 1 }} />
              <OwnershipText>
                <strong>Dein Eigentum, für immer.</strong>{' '}
                Das Google Business Profil bleibt nach der Einrichtung dauerhaft dir — auch wenn du das Abo kündigst.
              </OwnershipText>
            </OwnershipBox>
          </SetupCard>
        )}

        {/* Subscription Card */}
        <SubCard>
          <SubLabel>
            {isSetup ? 'Danach: Software-Abo' : 'WERKRUF PRO'}
          </SubLabel>
          <PriceRow>
            <PriceNum>{plan.price}€</PriceNum>
            <PricePer>{plan.period}</PricePer>
          </PriceRow>
          {plan.savings ? (
            <PriceSavings>↓ {plan.savings}</PriceSavings>
          ) : (
            <PriceSavings style={{ color: 'rgba(255,255,255,.3)' }}>
              Flexibel — monatlich kündbar
            </PriceSavings>
          )}

          <SubFeatures>
            {SUB_FEATURES.map((f, i) => (
              <SubFeature key={i}>
                <CheckCircle size={14} />
                {f}
              </SubFeature>
            ))}
          </SubFeatures>

          <CTABtn onClick={handleCTA} disabled={loading}>
            {loading ? 'Wird verarbeitet…' : (
              <>
                {isSetup
                  ? `Jetzt für ${149 + plan.total}€ starten`
                  : `30 Tage gratis testen`
                }
                <ArrowRight size={16} />
              </>
            )}
          </CTABtn>

          <TrialNote>
            {isSetup
              ? `149€ Setup-Fee + ${plan.total}€ ${plan.label} · 30 Tage Software gratis inklusive`
              : `30 Tage kostenlos · dann ${plan.total}€ ${plan.label.toLowerCase()} · jederzeit kündbar`
            }
          </TrialNote>
        </SubCard>
      </Cards>
    </Wrap>
  );
}
