import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Link } from 'react-router-dom';
import { CheckCircle, X, ChevronRight, ArrowRight, Zap } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;
const pulse  = keyframes`0%,100%{opacity:1}50%{opacity:.5}`;

/* ─────────────────────────────────────────────
   LAYOUT — all CSS vars
───────────────────────────────────────────── */
const Page = styled.div`background:var(--color-bg);min-height:100vh;`;

/* Hero */
const HeroBand = styled.section`
  background:var(--color-primary);
  padding:100px 24px 80px;position:relative;overflow:hidden;
`;
const HeroGrid = styled.div`
  position:absolute;inset:0;pointer-events:none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(var(--color-accent-rgb),.04) 1px,transparent 1px);
  background-size:44px 44px;
  display:${({ $show }) => $show ? 'block' : 'none'};
`;
const HeroInner = styled.div`max-width:900px;margin:0 auto;text-align:center;animation:${fadeUp} .6s ease both;`;
const Eyebrow = styled.div`
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(var(--color-accent-rgb),.12);
  border:1px solid rgba(var(--color-accent-rgb),.35);
  color:var(--color-accent);font-family:var(--font-body);font-weight:700;
  font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  padding:6px 14px;margin-bottom:24px;border-radius:var(--radius-button);
`;
const PulseDot = styled.span`
  width:6px;height:6px;background:var(--color-accent);border-radius:50%;
  display:inline-block;animation:${pulse} 1.5s ease infinite;
`;
const HeroH1 = styled.h1`
  font-size:clamp(2.4rem,5vw,3.8rem);text-transform:var(--text-transform);
  color:var(--color-white);line-height:1.02;margin-bottom:16px;
`;
const HeroAccent = styled.span`color:var(--color-accent);`;
const HeroSub = styled.p`
  font-family:var(--font-body);font-size:1.05rem;
  color:rgba(255,255,255,.65);max-width:560px;
  margin:0 auto 40px;line-height:1.7;
`;

/* ROI numbers */
const ROIRow = styled.div`display:flex;align-items:center;justify-content:center;flex-wrap:wrap;`;
const ROIItem = styled.div`
  padding:20px 32px;text-align:center;
  border-right:1px solid rgba(255,255,255,.1);
  &:last-child{border-right:none;}
  @media(max-width:600px){padding:14px 20px;}
`;
const ROINum = styled.div`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:clamp(2.2rem,4vw,3rem);color:var(--color-white);line-height:1;
`;
const ROIAccent = styled.span`color:var(--color-accent);`;
const ROILabel = styled.div`
  font-family:var(--font-body);font-size:.75rem;
  color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.1em;margin-top:4px;
`;

/* Calc */
const CalcSection = styled.section`
  background:var(--color-primary);
  border-top:1px solid rgba(255,255,255,.08);
  padding:0 24px 80px;
`;
const CalcInner = styled.div`max-width:900px;margin:0 auto;`;
const CalcCard = styled.div`
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1);
  border-left:5px solid var(--color-accent);
  border-radius:var(--radius-card);
  padding:32px 36px;
  @media(max-width:600px){padding:24px 20px;}
`;
const CalcLabel = styled.p`
  font-family:var(--font-body);font-weight:700;font-size:.75rem;
  letter-spacing:.16em;text-transform:uppercase;color:var(--color-accent);margin-bottom:20px;
`;
const CalcGrid = styled.div`
  display:grid;grid-template-columns:1fr auto 1fr auto 1fr;
  align-items:center;gap:16px;
  @media(max-width:680px){grid-template-columns:1fr;gap:8px;}
`;
const CalcBox = styled.div`
  text-align:center;padding:20px;
  background:rgba(255,255,255,.06);
  border-radius:var(--radius-card);
`;
const CalcNum = styled.div`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:2.2rem;color:${({ $c }) => $c || 'var(--color-white)'};line-height:1;
`;
const CalcLbl = styled.div`
  font-family:var(--font-body);font-size:.75rem;
  color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-top:5px;
`;
const CalcOp = styled.div`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:2rem;color:rgba(255,255,255,.3);text-align:center;
  @media(max-width:680px){display:none;}
`;
const CalcNote = styled.p`
  font-family:var(--font-body);font-size:.78rem;
  color:rgba(255,255,255,.4);text-align:center;margin-top:20px;line-height:1.6;
`;

/* Pricing cards */
const PricingSection = styled.section`padding:80px 24px 100px;background:var(--color-bg);`;
const PricingInner = styled.div`max-width:900px;margin:0 auto;`;
const PLabel = styled.p`
  font-family:var(--font-body);font-weight:700;font-size:.72rem;
  letter-spacing:.18em;text-transform:uppercase;
  color:var(--color-accent);text-align:center;margin-bottom:12px;
`;
const PH2 = styled.h2`
  font-size:clamp(2rem,4vw,2.8rem);text-transform:var(--text-transform);
  color:var(--color-primary);text-align:center;margin-bottom:48px;line-height:1.05;
`;
const CardsGrid = styled.div`
  display:grid;grid-template-columns:1fr 1.15fr;gap:2px;background:var(--color-border);
  @media(max-width:700px){grid-template-columns:1fr;}
`;

/* Free card */
const FreeCard = styled.div`
  background:var(--color-white);padding:36px 32px;
  border-radius:var(--radius-card) 0 0 var(--radius-card);
  @media(max-width:560px){padding:28px 20px;}
`;
const CardLabel = styled.p`
  font-family:var(--font-body);font-weight:700;font-size:.72rem;
  letter-spacing:.14em;text-transform:uppercase;
  color:${({ $c }) => $c||'var(--color-text-muted)'};margin-bottom:12px;
`;
const CardTitle = styled.h3`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.8rem;text-transform:var(--text-transform);
  color:var(--color-primary);margin-bottom:8px;
`;
const Price = styled.div`display:flex;align-items:baseline;gap:4px;margin-bottom:6px;`;
const PriceNum = styled.span`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:3rem;line-height:1;color:${({ $c }) => $c||'var(--color-primary)'};
`;
const PricePeriod = styled.span`
  font-family:var(--font-body);font-size:.9rem;color:var(--color-text-muted);margin-left:4px;
`;
const PriceNote = styled.p`
  font-family:var(--font-body);font-size:.8rem;color:#A0ADB8;margin-bottom:24px;
`;
const FeatureList = styled.ul`list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:28px;`;
const Feature = styled.li`
  display:flex;align-items:flex-start;gap:10px;
  font-family:var(--font-body);font-size:.9rem;
  color:${({ $muted }) => $muted?'#A0ADB8':'var(--color-text)'};
  svg{flex-shrink:0;margin-top:1px;}
`;

/* Pro card */
const ProCard = styled.div`
  background:var(--color-primary);padding:36px 32px;
  position:relative;overflow:hidden;
  border-radius:0 var(--radius-card) var(--radius-card) 0;
  @media(max-width:560px){padding:28px 20px;}
`;
const ProGlow = styled.div`
  position:absolute;top:0;left:0;right:0;height:5px;
  background:var(--color-accent);
`;
const ProBadge = styled.div`
  display:inline-block;background:var(--color-accent);color:var(--color-white);
  font-family:var(--font-body);font-weight:700;font-size:.75rem;
  letter-spacing:.1em;text-transform:uppercase;
  padding:4px 12px;margin-bottom:16px;border-radius:var(--radius-button);
`;
const TrialBanner = styled.div`
  background:rgba(var(--color-accent-rgb),.12);
  border:1px solid rgba(var(--color-accent-rgb),.3);
  border-radius:var(--radius-card);
  padding:12px 16px;margin-bottom:20px;
  display:flex;align-items:center;gap:10px;
`;
const TrialText = styled.p`
  font-family:var(--font-body);font-size:.83rem;
  color:var(--color-accent);font-weight:600;line-height:1.4;
  strong{display:block;font-weight:700;}
`;
const CTABtn = styled(Link)`
  display:flex;align-items:center;justify-content:center;gap:8px;
  padding:16px;width:100%;background:var(--color-accent);color:var(--color-white);
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.1rem;letter-spacing:.07em;text-transform:var(--text-transform);
  text-decoration:none;border-radius:var(--radius-button);
  box-shadow:0 4px 20px rgba(var(--color-accent-rgb),.4);
  transition:filter .2s,transform .1s;
  &:hover{filter:brightness(.9);transform:translateY(-2px);}
`;
const SecBtn = styled(Link)`
  display:flex;align-items:center;justify-content:center;gap:6px;
  padding:13px;width:100%;margin-top:2px;
  background:transparent;color:var(--color-text-muted);
  font-family:var(--font-body);font-weight:600;font-size:.88rem;
  text-decoration:none;border:2px solid var(--color-border);
  border-radius:var(--radius-button);
  transition:border-color .2s,color .2s;
  &:hover{border-color:var(--color-primary);color:var(--color-primary);}
`;

/* Comparison table */
const CompareSection = styled.section`background:var(--color-white);padding:80px 24px;`;
const CompareInner = styled.div`max-width:700px;margin:0 auto;`;
const CompareH2 = styled.h2`
  font-size:clamp(1.8rem,3.5vw,2.4rem);text-transform:var(--text-transform);
  color:var(--color-primary);text-align:center;margin-bottom:36px;
`;
const Table = styled.table`width:100%;border-collapse:collapse;`;
const Th = styled.th`
  font-family:var(--font-body);font-weight:700;font-size:.9rem;
  text-transform:uppercase;letter-spacing:.06em;
  padding:12px 16px;text-align:${({ $left }) => $left?'left':'center'};
  background:${({ $pro }) => $pro?'var(--color-primary)':'var(--color-bg)'};
  color:${({ $pro }) => $pro?'var(--color-white)':'var(--color-primary)'};
  border-bottom:2px solid ${({ $pro }) => $pro?'var(--color-accent)':'var(--color-border)'};
`;
const Tr = styled.tr`&:nth-child(even){background:#F8F9FA;}&:hover{background:rgba(var(--color-primary-rgb),.03);}`;
const Td = styled.td`
  font-family:var(--font-body);font-size:.88rem;
  color:${({ $muted }) => $muted?'#A0ADB8':'var(--color-text)'};
  padding:12px 16px;text-align:${({ $center }) => $center?'center':'left'};
  border-bottom:1px solid #F0F0F0;
`;
const Check = styled.span`color:#1E7E34;display:flex;justify-content:center;`;
const Cross  = styled.span`color:#D0D8E0;display:flex;justify-content:center;`;

/* Bottom CTA */
const CtaBand = styled.section`
  background:var(--color-primary);padding:72px 24px;text-align:center;
`;
const CtaInner = styled.div`max-width:640px;margin:0 auto;`;
const CtaH2 = styled.h2`
  font-size:clamp(2rem,4vw,3rem);text-transform:var(--text-transform);
  color:var(--color-white);line-height:1.05;margin-bottom:16px;
`;
const CtaSub = styled.p`
  font-family:var(--font-body);font-size:.98rem;
  color:rgba(255,255,255,.6);margin-bottom:32px;line-height:1.65;
`;
const CtaBtn = styled(Link)`
  display:inline-flex;align-items:center;gap:10px;
  padding:18px 40px;background:var(--color-accent);color:var(--color-white);
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.2rem;letter-spacing:.08em;text-transform:var(--text-transform);
  text-decoration:none;border-radius:var(--radius-button);
  box-shadow:0 6px 28px rgba(var(--color-accent-rgb),.4);
  transition:filter .2s,transform .15s;
  &:hover{filter:brightness(.9);transform:translateY(-3px);}
`;
const CtaNote = styled.p`
  font-family:var(--font-body);font-size:.78rem;
  color:rgba(255,255,255,.35);margin-top:16px;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Pricing() {
  const { pricing, brand, design, copy } = useIndustry();
  const { roi } = pricing;

  const [roiInput, setRoiInput] = useState(roi.sliderDefault);

  const newUnits     = Math.round(roiInput * roi.upliftFactor);
  const extraRevenue = newUnits * roi.avgOrderValue;
  const roiPct       = Math.round((extraRevenue - pricing.monthlyPrice) / pricing.monthlyPrice * 100);
  const heroMax      = (roi.maxMonthlyRevenue).toLocaleString('de-DE');

  return (
    <Page>
      {/* ── HERO ── */}
      <HeroBand>
        <HeroGrid $show={design.accentStripePattern} />
        <HeroInner>
          <Eyebrow><PulseDot /> {pricing.productName}</Eyebrow>
          <HeroH1>
            Investiere {pricing.monthlyPrice}{pricing.currency}.<br />
            <HeroAccent>Hol dir bis zu {heroMax}{pricing.currency} zurück.</HeroAccent>
          </HeroH1>
          <HeroSub>
            Kein Jahresvertrag. Keine Einrichtungsgebühr.{' '}
            Die ersten {pricing.trialDays} Tage kostenlos — danach nur, wenn du zufrieden bist.
          </HeroSub>
          <ROIRow>
            <ROIItem>
              <ROINum>{pricing.monthlyPrice}<ROIAccent>{pricing.currency}</ROIAccent></ROINum>
              <ROILabel>pro Monat</ROILabel>
            </ROIItem>
            <ROIItem>
              <ROINum>{pricing.trialDays}<ROIAccent>T</ROIAccent></ROINum>
              <ROILabel>kostenlos testen</ROILabel>
            </ROIItem>
            <ROIItem>
              <ROINum>3<ROIAccent>×</ROIAccent></ROINum>
              <ROILabel>mehr Anfragen</ROILabel>
            </ROIItem>
            <ROIItem>
              <ROINum>0<ROIAccent>{pricing.currency}</ROIAccent></ROINum>
              <ROILabel>Einrichtungsgebühr</ROILabel>
            </ROIItem>
          </ROIRow>
        </HeroInner>
      </HeroBand>

      {/* ── ROI CALCULATOR ── */}
      <CalcSection>
        <CalcInner>
          <CalcCard>
            <CalcLabel>Dein ROI — interaktiv berechnen</CalcLabel>

            <div style={{ marginBottom: 20 }}>
              <p style={{
                fontFamily: 'var(--font-body)', fontSize: '.83rem',
                color: 'rgba(255,255,255,.6)', marginBottom: 8,
              }}>
                {roi.sliderLabel}{' '}
                <strong style={{ color: 'white' }}>{roiInput}</strong>
              </p>
              <input
                type="range"
                min={roi.sliderMin} max={roi.sliderMax} step={roi.sliderStep}
                value={roiInput}
                onChange={e => setRoiInput(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-accent)' }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontFamily: 'var(--font-body)', fontSize: '.7rem',
                color: 'rgba(255,255,255,.3)', marginTop: 4,
              }}>
                <span>{roi.sliderMin}</span><span>{roi.sliderMax}</span>
              </div>
            </div>

            <CalcGrid>
              <CalcBox>
                <CalcNum>
                  {pricing.monthlyPrice}
                  <span style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,.4)' }}>
                    {pricing.currency}
                  </span>
                </CalcNum>
                <CalcLbl>{roi.investmentLabel}</CalcLbl>
              </CalcBox>
              <CalcOp>→</CalcOp>
              <CalcBox>
                <CalcNum $c="var(--color-accent)">+{newUnits}</CalcNum>
                <CalcLbl>{roi.callsLabel}</CalcLbl>
              </CalcBox>
              <CalcOp>=</CalcOp>
              <CalcBox style={{
                background: 'rgba(var(--color-accent-rgb), .12)',
                border: '1px solid rgba(var(--color-accent-rgb), .3)',
              }}>
                <CalcNum $c="var(--color-accent)">
                  {extraRevenue >= 1000
                    ? `${(extraRevenue / 1000).toFixed(1).replace('.', ',')}k`
                    : extraRevenue
                  }{pricing.currency}
                </CalcNum>
                <CalcLbl>{roi.revenueLabel}</CalcLbl>
              </CalcBox>
            </CalcGrid>

            <CalcNote>
              {roi.roiNote} {roi.avgOrderValue}{pricing.currency}.{' '}
              ROI in diesem Szenario:{' '}
              <strong style={{ color: 'var(--color-accent)' }}>{roiPct} %</strong>.
            </CalcNote>
          </CalcCard>
        </CalcInner>
      </CalcSection>

      {/* ── PRICING CARDS ── */}
      <PricingSection>
        <PricingInner>
          <PLabel>Tarife</PLabel>
          <PH2>Einfach. <HeroAccent>Transparent.</HeroAccent> Direkt.</PH2>

          <CardsGrid>
            {/* Free */}
            <FreeCard>
              <CardLabel>Kostenloser Einstieg</CardLabel>
              <CardTitle>Sichtbarkeits-Check</CardTitle>
              <Price>
                <PriceNum>0<span style={{ fontSize: '1.5rem' }}>{pricing.currency}</span></PriceNum>
              </Price>
              <PriceNote>Einmalig, kein Account erforderlich</PriceNote>
              <FeatureList>
                {pricing.comparison.slice(0, 2).map((f, i) => (
                  <Feature key={i}>
                    <CheckCircle size={16} color="#1E7E34" />
                    {f.feature}
                  </Feature>
                ))}
                {pricing.comparison.slice(2).map((f, i) => (
                  <Feature key={i} $muted>
                    <X size={16} color="#D0D8E0" />
                    {f.feature}
                  </Feature>
                ))}
              </FeatureList>
              <SecBtn to="/#check">
                Zum kostenlosen Check <ChevronRight size={14} />
              </SecBtn>
            </FreeCard>

            {/* PRO */}
            <ProCard>
              <ProGlow />
              <ProBadge>Empfohlen</ProBadge>
              <CardLabel $c="rgba(255,255,255,.5)">{pricing.productName}</CardLabel>
              <CardTitle style={{ color: 'var(--color-white)' }}>Volle Sichtbarkeit</CardTitle>
              <Price>
                <PriceNum $c="var(--color-accent)">
                  {pricing.monthlyPrice}
                  <span style={{ fontSize: '1.5rem' }}>{pricing.currency}</span>
                </PriceNum>
                <PricePeriod>{pricing.priceLabel}</PricePeriod>
              </Price>
              <PriceNote style={{ color: 'rgba(255,255,255,.35)' }}>
                Monatlich kündbar — kein Jahresvertrag
              </PriceNote>

              <TrialBanner>
                <Zap size={18} color="var(--color-accent)" style={{ flexShrink: 0 }} />
                <TrialText>
                  <strong>{pricing.trialDays} Tage kostenlos testen.</strong>
                  Danach {pricing.monthlyPrice}{pricing.currency} {pricing.priceLabel} — kündbar wann du willst.
                </TrialText>
              </TrialBanner>

              <FeatureList style={{ marginBottom: 24 }}>
                {pricing.features.map((f, i) => (
                  <Feature key={i} style={{ color: 'rgba(255,255,255,.85)' }}>
                    <CheckCircle size={16} color="var(--color-accent)" />
                    {f}
                  </Feature>
                ))}
              </FeatureList>

              <CTABtn to="/register">
                {pricing.trialCTA} <ArrowRight size={18} />
              </CTABtn>
              <p style={{
                fontFamily: 'var(--font-body)', fontSize: '.73rem',
                color: 'rgba(255,255,255,.3)', textAlign: 'center', marginTop: 12,
              }}>
                Keine Kreditkarte für die Testphase erforderlich.
              </p>
            </ProCard>
          </CardsGrid>
        </PricingInner>
      </PricingSection>

      {/* ── COMPARISON TABLE ── */}
      <CompareSection>
        <CompareInner>
          <CompareH2>Was du bekommst — auf einen Blick</CompareH2>
          <Table>
            <thead>
              <tr>
                <Th $left>Feature</Th>
                <Th>Free</Th>
                <Th $pro>Pro</Th>
              </tr>
            </thead>
            <tbody>
              {pricing.comparison.map((row, i) => (
                <Tr key={i}>
                  <Td>{row.feature}</Td>
                  <Td $center>
                    {row.free
                      ? <Check><CheckCircle size={16} /></Check>
                      : <Cross><X size={16} /></Cross>
                    }
                  </Td>
                  <Td $center><Check><CheckCircle size={16} /></Check></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CompareInner>
      </CompareSection>

      {/* ── BOTTOM CTA ── */}
      <CtaBand>
        <CtaInner>
          <CtaH2>
            Kein Risiko.<br />
            <HeroAccent>{pricing.trialDays} Tage auf unsere Kosten.</HeroAccent>
          </CtaH2>
          <CtaSub>
            Wenn du nach {pricing.trialDays} Tagen nicht mehr Anfragen hast als vorher,
            zahlst du nichts. Kein Kleingedrucktes. Kein Ärger.
          </CtaSub>
          <CtaBtn to="/register">
            {pricing.trialCTA} <ArrowRight size={20} />
          </CtaBtn>
          <CtaNote>
            Danach {pricing.monthlyPrice}{pricing.currency} {pricing.priceLabel} · Monatlich kündbar · Keine Einrichtungsgebühr
          </CtaNote>
        </CtaInner>
      </CtaBand>
    </Page>
  );
}
