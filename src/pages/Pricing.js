import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Link } from 'react-router-dom';
import {
  CheckCircle, X, TrendingUp, Star, FileText,
  MessageSquare, Zap, ChevronRight, ArrowRight
} from 'lucide-react';

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp = keyframes`
  from{opacity:0;transform:translateY(20px)}
  to{opacity:1;transform:translateY(0)}
`;
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:.5}`;
const countUp = keyframes`from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}`;

/* ─────────────────────────────────────────────
   PAGE WRAPPER
───────────────────────────────────────────── */
const Page = styled.div`
  background: #F2F2F2;
  min-height: 100vh;
`;

/* ─────────────────────────────────────────────
   HERO BAND
───────────────────────────────────────────── */
const HeroBand = styled.section`
  background: #002C51;
  padding: 100px 24px 80px;
  position: relative;
  overflow: hidden;
`;

const HeroGrid = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(255,140,0,.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,140,0,.04) 1px, transparent 1px);
  background-size: 44px 44px;
`;

const HeroInner = styled.div`
  max-width: 900px; margin: 0 auto; text-align: center;
  animation: ${fadeUp} .6s ease both;
`;

const Eyebrow = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(255,140,0,.12); border: 1px solid rgba(255,140,0,.35);
  color: #FF8C00; font-family: 'Barlow',sans-serif; font-weight: 700;
  font-size: .72rem; letter-spacing: .18em; text-transform: uppercase;
  padding: 6px 14px; margin-bottom: 24px;
`;

const PulseDot = styled.span`
  width: 6px; height: 6px; background: #FF8C00; border-radius: 50%;
  display: inline-block; animation: ${pulse} 1.5s ease infinite;
`;

const HeroH1 = styled.h1`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: clamp(2.4rem, 5vw, 3.8rem); text-transform: uppercase;
  color: white; line-height: 1.02; margin-bottom: 16px;
`;

const HeroAccent = styled.span`color: #FF8C00;`;

const HeroSub = styled.p`
  font-family: 'Barlow', sans-serif; font-size: 1.05rem;
  color: rgba(255,255,255,.65); max-width: 560px;
  margin: 0 auto 40px; line-height: 1.7;
`;

/* ROI Headline numbers */
const ROIRow = styled.div`
  display: flex; align-items: center; justify-content: center;
  gap: 0; flex-wrap: wrap; margin-bottom: 0;
`;

const ROIItem = styled.div`
  padding: 20px 32px; text-align: center;
  border-right: 1px solid rgba(255,255,255,.1);
  &:last-child { border-right: none; }
  @media(max-width:600px){padding:14px 20px;}
`;

const ROINum = styled.div`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: clamp(2.2rem, 4vw, 3rem); color: white; line-height: 1;
  animation: ${countUp} .6s ease ${({ $d }) => $d || '0s'} both;
`;

const ROIAccent = styled.span`color: #FF8C00;`;
const ROILabel = styled.div`
  font-family: 'Barlow', sans-serif; font-size: .75rem;
  color: rgba(255,255,255,.5); text-transform: uppercase;
  letter-spacing: .1em; margin-top: 4px;
`;

/* ─────────────────────────────────────────────
   ROI CALCULATOR SECTION
───────────────────────────────────────────── */
const CalcSection = styled.section`
  background: #002C51; border-top: 1px solid rgba(255,255,255,.08);
  padding: 0 24px 80px;
`;

const CalcInner = styled.div`max-width: 900px; margin: 0 auto;`;

const CalcCard = styled.div`
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
  border-left: 5px solid #FF8C00; padding: 32px 36px;
  @media(max-width:600px){padding:24px 20px;}
`;

const CalcGrid = styled.div`
  display: grid; grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: center; gap: 16px;
  @media(max-width:680px){grid-template-columns:1fr;gap:8px;}
`;

const CalcBox = styled.div`
  text-align: center; padding: 20px;
  background: rgba(255,255,255,.06);
`;

const CalcNum = styled.div`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 2.2rem; color: ${({ $c }) => $c || 'white'}; line-height: 1;
`;

const CalcLabel = styled.div`
  font-family: 'Barlow', sans-serif; font-size: .75rem;
  color: rgba(255,255,255,.5); text-transform: uppercase;
  letter-spacing: .08em; margin-top: 5px;
`;

const CalcOp = styled.div`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 2rem; color: rgba(255,255,255,.3); text-align: center;
  @media(max-width:680px){display:none;}
`;

const CalcNote = styled.p`
  font-family: 'Barlow', sans-serif; font-size: .78rem;
  color: rgba(255,255,255,.4); text-align: center;
  margin-top: 20px; line-height: 1.6;
`;

/* ─────────────────────────────────────────────
   PRICING SECTION
───────────────────────────────────────────── */
const PricingSection = styled.section`
  padding: 80px 24px 100px; background: #F2F2F2;
`;

const PricingInner = styled.div`max-width: 900px; margin: 0 auto;`;

const PricingLabel = styled.p`
  font-family: 'Barlow', sans-serif; font-weight: 700; font-size: .72rem;
  letter-spacing: .18em; text-transform: uppercase; color: #FF8C00;
  text-align: center; margin-bottom: 12px;
`;

const PricingH2 = styled.h2`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: clamp(2rem, 4vw, 2.8rem); text-transform: uppercase;
  color: #002C51; text-align: center; margin-bottom: 48px; line-height: 1.05;
`;

const PricingH2Accent = styled.span`color: #FF8C00;`;

const CardsGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1.15fr; gap: 2px;
  background: #D0D8E0;
  @media(max-width:700px){grid-template-columns:1fr;}
`;

/* Free card */
const FreeCard = styled.div`
  background: white; padding: 36px 32px;
  @media(max-width:560px){padding:28px 20px;}
`;

const CardLabel = styled.p`
  font-family: 'Barlow', sans-serif; font-weight: 700; font-size: .72rem;
  letter-spacing: .14em; text-transform: uppercase;
  color: ${({ $c }) => $c || '#5A6A7A'}; margin-bottom: 12px;
`;

const CardTitle = styled.h3`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 1.8rem; text-transform: uppercase;
  color: #002C51; margin-bottom: 8px;
`;

const Price = styled.div`
  display: flex; align-items: baseline; gap: 4px; margin-bottom: 6px;
`;

const PriceNum = styled.span`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 3rem; line-height: 1; color: ${({ $c }) => $c || '#002C51'};
`;

const PricePeriod = styled.span`
  font-family: 'Barlow', sans-serif; font-size: .9rem;
  color: #5A6A7A; margin-left: 4px;
`;

const PriceNote = styled.p`
  font-family: 'Barlow', sans-serif; font-size: .8rem;
  color: #A0ADB8; margin-bottom: 24px;
`;

const FeatureList = styled.ul`
  list-style: none; display: flex; flex-direction: column; gap: 10px;
  margin-bottom: 28px;
`;

const Feature = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-family: 'Barlow', sans-serif; font-size: .9rem;
  color: ${({ $muted }) => $muted ? '#A0ADB8' : '#1A1A1A'};
  svg { flex-shrink: 0; margin-top: 1px; }
`;

/* PRO card */
const ProCard = styled.div`
  background: #002C51; padding: 36px 32px;
  position: relative; overflow: hidden;
  @media(max-width:560px){padding:28px 20px;}
`;

const ProGlow = styled.div`
  position: absolute; top: 0; left: 0; right: 0; height: 5px;
  background: #FF8C00;
`;

const ProBadge = styled.div`
  display: inline-block; background: #FF8C00; color: white;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
  font-size: .75rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 4px 12px; margin-bottom: 16px;
`;

const ProCardLabel = styled(CardLabel)`color: rgba(255,255,255,.5);`;
const ProCardTitle = styled(CardTitle)`color: white;`;
const ProPriceNum = styled(PriceNum)`color: #FF8C00;`;
const ProPricePeriod = styled(PricePeriod)`color: rgba(255,255,255,.5);`;
const ProPriceNote = styled(PriceNote)`color: rgba(255,255,255,.35);`;

const ProFeature = styled(Feature)`
  color: ${({ $muted }) => $muted ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.85)'};
`;

const TrialBanner = styled.div`
  background: rgba(255,140,0,.12); border: 1px solid rgba(255,140,0,.3);
  padding: 12px 16px; margin-bottom: 20px;
  display: flex; align-items: center; gap: 10px;
`;

const TrialText = styled.p`
  font-family: 'Barlow', sans-serif; font-size: .83rem;
  color: #FF8C00; font-weight: 600; line-height: 1.4;
  strong { display: block; font-weight: 700; }
`;

const CTABtn = styled(Link)`
  display: flex; align-items: center; justify-content: center;
  gap: 8px; padding: 16px; width: 100%;
  background: #FF8C00; color: white;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
  font-size: 1.1rem; letter-spacing: .07em; text-transform: uppercase;
  text-decoration: none; box-shadow: 0 4px 20px rgba(255,140,0,.4);
  transition: background .2s, transform .1s;
  &:hover{background:#E07A00;transform:translateY(-2px);}
`;

const SecondaryBtn = styled(Link)`
  display: flex; align-items: center; justify-content: center;
  gap: 6px; padding: 13px; width: 100%; margin-top: 2px;
  background: transparent; color: #5A6A7A;
  font-family: 'Barlow', sans-serif; font-weight: 600; font-size: .88rem;
  text-decoration: none; border: 2px solid #D0D8E0;
  transition: border-color .2s, color .2s;
  &:hover{border-color:#002C51;color:#002C51;}
`;

/* ─────────────────────────────────────────────
   COMPARISON TABLE
───────────────────────────────────────────── */
const CompareSection = styled.section`
  background: white; padding: 80px 24px;
`;

const CompareInner = styled.div`max-width: 700px; margin: 0 auto;`;

const CompareH2 = styled.h2`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: clamp(1.8rem, 3.5vw, 2.4rem); text-transform: uppercase;
  color: #002C51; text-align: center; margin-bottom: 36px;
`;

const Table = styled.table`
  width: 100%; border-collapse: collapse;
`;

const THead = styled.thead``;
const TBody = styled.tbody``;

const Th = styled.th`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
  font-size: .9rem; text-transform: uppercase; letter-spacing: .06em;
  padding: 12px 16px; text-align: ${({ $left }) => $left ? 'left' : 'center'};
  background: ${({ $pro }) => $pro ? '#002C51' : '#F2F2F2'};
  color: ${({ $pro }) => $pro ? 'white' : '#002C51'};
  border-bottom: 2px solid ${({ $pro }) => $pro ? '#FF8C00' : '#D0D8E0'};
`;

const Tr = styled.tr`
  &:nth-child(even){background:#F8F9FA;}
  &:hover{background:#F0F5FA;}
`;

const Td = styled.td`
  font-family: 'Barlow', sans-serif; font-size: .88rem;
  color: ${({ $muted }) => $muted ? '#A0ADB8' : '#1A1A1A'};
  padding: 12px 16px; text-align: ${({ $center }) => $center ? 'center' : 'left'};
  border-bottom: 1px solid #F0F0F0;
`;

const Check = styled.span`color: #1E7E34; display:flex;justify-content:center;`;
const Cross  = styled.span`color: #D0D8E0; display:flex;justify-content:center;`;

/* ─────────────────────────────────────────────
   BOTTOM CTA BAND
───────────────────────────────────────────── */
const CtaBand = styled.section`
  background: #002C51; padding: 72px 24px;
  text-align: center; position: relative; overflow: hidden;
`;

const CtaInner = styled.div`max-width: 640px; margin: 0 auto;`;

const CtaH2 = styled.h2`
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: clamp(2rem, 4vw, 3rem); text-transform: uppercase;
  color: white; line-height: 1.05; margin-bottom: 16px;
`;

const CtaSub = styled.p`
  font-family: 'Barlow', sans-serif; font-size: .98rem;
  color: rgba(255,255,255,.6); margin-bottom: 32px; line-height: 1.65;
`;

const CtaBtn = styled(Link)`
  display: inline-flex; align-items: center; gap: 10px;
  padding: 18px 40px; background: #FF8C00; color: white;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 1.2rem; letter-spacing: .08em; text-transform: uppercase;
  text-decoration: none; box-shadow: 0 6px 28px rgba(255,140,0,.4);
  transition: background .2s, transform .15s;
  &:hover{background:#E07A00;transform:translateY(-3px);}
`;

const CtaNote = styled.p`
  font-family: 'Barlow', sans-serif; font-size: .78rem;
  color: rgba(255,255,255,.35); margin-top: 16px;
`;

/* ─────────────────────────────────────────────
   FEATURES in PRO card
───────────────────────────────────────────── */
const PRO_FEATURES = [
  { icon: <TrendingUp size={15} color="#FF8C00" />,    text: 'Google-Profil Optimierung (vollständig)' },
  { icon: <Star size={15} color="#FF8C00" />,           text: 'Bewertungs-Autopilot (SMS + E-Mail)' },
  { icon: <FileText size={15} color="#FF8C00" />,       text: 'Monatliches PDF-Reporting' },
  { icon: <MessageSquare size={15} color="#FF8C00" />,  text: 'KI-Antwort-Assistent für Rezensionen' },
  { icon: <Zap size={15} color="#FF8C00" />,            text: 'Einrichtung in 48 Stunden' },
  { icon: <CheckCircle size={15} color="#FF8C00" />,    text: 'Monatlich kündbar — kein Jahresvertrag' },
];

const FREE_FEATURES = [
  { text: 'Sichtbarkeits-Check (einmalig)',      ok: true  },
  { text: '4-seitiger PDF-Report',               ok: true  },
  { text: 'Google-Profil Optimierung',           ok: false },
  { text: 'Bewertungs-Autopilot',                ok: false },
  { text: 'Monatliches Reporting',               ok: false },
  { text: 'KI-Antwort-Assistent',                ok: false },
];

const TABLE_ROWS = [
  { feature: 'Sichtbarkeits-Check',           free: true,  pro: true  },
  { feature: 'PDF-Report (4 Seiten)',          free: true,  pro: true  },
  { feature: 'Google-Profil Optimierung',      free: false, pro: true  },
  { feature: 'Keyword-Optimierung',            free: false, pro: true  },
  { feature: 'Bewertungs-Autopilot',           free: false, pro: true  },
  { feature: 'KI-Antwort-Assistent',           free: false, pro: true  },
  { feature: 'Monatliches PDF-Reporting',      free: false, pro: true  },
  { feature: 'Wettbewerber-Monitoring',        free: false, pro: true  },
  { feature: 'Persönlicher Ansprechpartner',   free: false, pro: true  },
];

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Pricing() {
  const [roiCalls, setRoiCalls] = useState(30);
  const avgOrder = 400;
  const monthlyExtra = Math.round(roiCalls * 0.3 * avgOrder);
  const roi = Math.round((monthlyExtra - 149) / 149 * 100);

  return (
    <Page>
      {/* ── HERO ── */}
      <HeroBand>
        <HeroGrid />
        <HeroInner>
          <Eyebrow><PulseDot /> Werkruf Pro</Eyebrow>
          <HeroH1>
            Investiere 149 €.<br />
            <HeroAccent>Hol dir bis zu {(9120).toLocaleString('de-DE')} € zurück.</HeroAccent>
          </HeroH1>
          <HeroSub>
            Kein Jahresvertrag. Keine Einrichtungsgebühr. 
            Die ersten 30 Tage kostenlos — danach nur, wenn du zufrieden bist.
          </HeroSub>

          <ROIRow>
            <ROIItem>
              <ROINum $d="0s">149<ROIAccent>€</ROIAccent></ROINum>
              <ROILabel>pro Monat</ROILabel>
            </ROIItem>
            <ROIItem>
              <ROINum $d=".1s">30<ROIAccent>T</ROIAccent></ROINum>
              <ROILabel>kostenlos testen</ROILabel>
            </ROIItem>
            <ROIItem>
              <ROINum $d=".2s">3<ROIAccent>×</ROIAccent></ROINum>
              <ROILabel>mehr Anfragen</ROILabel>
            </ROIItem>
            <ROIItem>
              <ROINum $d=".3s">0<ROIAccent>€</ROIAccent></ROINum>
              <ROILabel>Einrichtungsgebühr</ROILabel>
            </ROIItem>
          </ROIRow>
        </HeroInner>
      </HeroBand>

      {/* ── ROI CALCULATOR ── */}
      <CalcSection>
        <CalcInner>
          <CalcCard>
            <p style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
              fontSize: '.75rem', letterSpacing: '.16em', textTransform: 'uppercase',
              color: '#FF8C00', marginBottom: 20,
            }}>
              Dein ROI — interaktiv berechnen
            </p>

            <div style={{ marginBottom: 20 }}>
              <p style={{
                fontFamily: 'Barlow, sans-serif', fontSize: '.83rem',
                color: 'rgba(255,255,255,.6)', marginBottom: 8,
              }}>
                Wie viele Anrufe bekommst du aktuell pro Monat?{' '}
                <strong style={{ color: 'white' }}>{roiCalls}</strong>
              </p>
              <input
                type="range" min={5} max={150} step={5}
                value={roiCalls}
                onChange={e => setRoiCalls(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#FF8C00' }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontFamily: 'Barlow, sans-serif', fontSize: '.7rem',
                color: 'rgba(255,255,255,.3)', marginTop: 4,
              }}>
                <span>5</span><span>150</span>
              </div>
            </div>

            <CalcGrid>
              <CalcBox>
                <CalcNum>149<span style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,.4)' }}>€</span></CalcNum>
                <CalcLabel>dein Monatsbeitrag</CalcLabel>
              </CalcBox>
              <CalcOp>→</CalcOp>
              <CalcBox>
                <CalcNum $c="#FF8C00">+{Math.round(roiCalls * 0.3)}</CalcNum>
                <CalcLabel>neue Aufträge / Mo.*</CalcLabel>
              </CalcBox>
              <CalcOp>=</CalcOp>
              <CalcBox style={{ background: 'rgba(255,140,0,.12)', border: '1px solid rgba(255,140,0,.3)' }}>
                <CalcNum $c="#FF8C00">
                  {monthlyExtra >= 1000
                    ? `${(monthlyExtra/1000).toFixed(1).replace('.', ',')}k`
                    : monthlyExtra
                  }€
                </CalcNum>
                <CalcLabel>zusätzlicher Umsatz</CalcLabel>
              </CalcBox>
            </CalcGrid>

            <CalcNote>
              * Basiert auf Ø +30 % mehr qualifizierten Anfragen und einem
              durchschnittlichen Auftragswert von {avgOrder} €.
              ROI in diesem Szenario: <strong style={{ color: '#FF8C00' }}>{roi} %</strong>.
            </CalcNote>
          </CalcCard>
        </CalcInner>
      </CalcSection>

      {/* ── PRICING CARDS ── */}
      <PricingSection>
        <PricingInner>
          <PricingLabel>Tarife</PricingLabel>
          <PricingH2>
            Einfach. <PricingH2Accent>Transparent.</PricingH2Accent> Direkt.
          </PricingH2>

          <CardsGrid>
            {/* Free */}
            <FreeCard>
              <CardLabel>Kostenloser Einstieg</CardLabel>
              <CardTitle>Sichtbarkeits-Check</CardTitle>
              <Price>
                <PriceNum>0<span style={{ fontSize: '1.5rem' }}>€</span></PriceNum>
              </Price>
              <PriceNote>Einmalig, kein Account erforderlich</PriceNote>

              <FeatureList>
                {FREE_FEATURES.map((f, i) => (
                  <Feature key={i} $muted={!f.ok}>
                    {f.ok
                      ? <CheckCircle size={16} color="#1E7E34" />
                      : <X size={16} color="#D0D8E0" />
                    }
                    {f.text}
                  </Feature>
                ))}
              </FeatureList>

              <SecondaryBtn to="/#check">
                Zum kostenlosen Check <ChevronRight size={14} />
              </SecondaryBtn>
            </FreeCard>

            {/* PRO */}
            <ProCard>
              <ProGlow />
              <ProBadge>Empfohlen</ProBadge>
              <ProCardLabel $c="rgba(255,255,255,.5)">Werkruf Pro</ProCardLabel>
              <ProCardTitle>Volle Sichtbarkeit</ProCardTitle>
              <Price>
                <ProPriceNum>149<span style={{ fontSize: '1.5rem' }}>€</span></ProPriceNum>
                <ProPricePeriod>/ Monat (netto)</ProPricePeriod>
              </Price>
              <ProPriceNote>Monatlich kündbar — kein Jahresvertrag</ProPriceNote>

              <TrialBanner>
                <Zap size={18} color="#FF8C00" style={{ flexShrink: 0 }} />
                <TrialText>
                  <strong>30 Tage kostenlos testen.</strong>
                  Danach 149 € / Monat — kündbar wann du willst.
                </TrialText>
              </TrialBanner>

              <FeatureList style={{ marginBottom: 24 }}>
                {PRO_FEATURES.map((f, i) => (
                  <ProFeature key={i}>
                    {f.icon}
                    {f.text}
                  </ProFeature>
                ))}
              </FeatureList>

              <CTABtn to="/register">
                Jetzt 30 Tage gratis testen <ArrowRight size={18} />
              </CTABtn>

              <p style={{
                fontFamily: 'Barlow, sans-serif', fontSize: '.73rem',
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
            <THead>
              <tr>
                <Th $left>Feature</Th>
                <Th>Free</Th>
                <Th $pro>Pro</Th>
              </tr>
            </THead>
            <TBody>
              {TABLE_ROWS.map((row, i) => (
                <Tr key={i}>
                  <Td>{row.feature}</Td>
                  <Td $center>
                    {row.free
                      ? <Check><CheckCircle size={16} /></Check>
                      : <Cross><X size={16} /></Cross>
                    }
                  </Td>
                  <Td $center>
                    <Check><CheckCircle size={16} /></Check>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CompareInner>
      </CompareSection>

      {/* ── BOTTOM CTA ── */}
      <CtaBand>
        <CtaInner>
          <CtaH2>
            Kein Risiko.<br />
            <HeroAccent>30 Tage auf unsere Kosten.</HeroAccent>
          </CtaH2>
          <CtaSub>
            Wenn du nach 30 Tagen nicht mehr Anfragen hast als vorher,
            zahlst du nichts. Kein Kleingedrucktes. Kein Ärger.
          </CtaSub>
          <CtaBtn to="/register">
            Jetzt 30 Tage gratis starten <ArrowRight size={20} />
          </CtaBtn>
          <CtaNote>Danach 149 € / Monat · Monatlich kündbar · Keine Einrichtungsgebühr</CtaNote>
        </CtaInner>
      </CtaBand>
    </Page>
  );
}
