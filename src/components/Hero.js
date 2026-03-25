import React from 'react';
import styled, { keyframes } from 'styled-components';
import { ArrowRight, CheckCircle } from 'lucide-react';

/* ── Animations ── */
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(32px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.6; }
`;

/* ── Styled Components ── */
const HeroSection = styled.section`
  min-height: 100vh;
  background: #002C51;
  display: flex;
  align-items: center;
  position: relative;
  overflow: hidden;
  padding: 120px 24px 80px;
`;

/* Diagonal grid texture overlay */
const GridOverlay = styled.div`
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(rgba(255,140,0,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,140,0,0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
`;

/* Heavy diagonal stripe accent */
const DiagonalAccent = styled.div`
  position: absolute;
  top: -10%;
  right: -5%;
  width: 520px;
  height: 520px;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 20px,
    rgba(255,140,0,0.04) 20px,
    rgba(255,140,0,0.04) 40px
  );
  pointer-events: none;
`;

/* Orange corner block */
const OrangeBlock = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  background: #FF8C00;
`;

const Inner = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  align-items: center;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: 40px;
  }
`;

const Left = styled.div`
  animation: ${fadeUp} 0.7s ease both;
`;

const EyebrowTag = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,140,0,0.15);
  border: 1px solid rgba(255,140,0,0.4);
  color: #FF8C00;
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 6px 14px;
  margin-bottom: 24px;

  span {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: #FF8C00;
    border-radius: 50%;
    animation: ${pulse} 1.5s ease infinite;
  }
`;

const Headline = styled.h1`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: clamp(2.6rem, 5vw, 4.2rem);
  line-height: 1.0;
  text-transform: uppercase;
  color: white;
  margin-bottom: 8px;

  em {
    font-style: normal;
    color: #FF8C00;
  }
`;

const HeadlineSub = styled.h2`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: clamp(1.4rem, 2.5vw, 2rem);
  text-transform: uppercase;
  color: rgba(255,255,255,0.45);
  margin-bottom: 28px;
  letter-spacing: 0.04em;
`;

const Subline = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 1.1rem;
  color: rgba(255,255,255,0.72);
  line-height: 1.7;
  max-width: 480px;
  margin-bottom: 40px;
`;

const CTARow = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
`;

const CTAButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 32px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s, box-shadow 0.2s;
  box-shadow: 0 4px 24px rgba(255,140,0,0.35);

  &:hover {
    background: #E07A00;
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(255,140,0,0.5);
  }

  svg {
    transition: transform 0.2s;
  }
  &:hover svg {
    transform: translateX(4px);
  }
`;

const SecondaryLink = styled.a`
  font-family: 'Barlow', sans-serif;
  font-weight: 600;
  font-size: 0.9rem;
  color: rgba(255,255,255,0.55);
  letter-spacing: 0.06em;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.2s;

  &:hover {
    color: white;
  }
`;

/* Right side: stats panel */
const Right = styled.div`
  animation: ${fadeUp} 0.7s ease 0.2s both;

  @media (max-width: 900px) {
    order: -1;
  }
`;

const StatsPanel = styled.div`
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-left: 4px solid #FF8C00;
  padding: 36px 32px;
`;

const StatsPanelTitle = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 600;
  font-size: 0.8rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #FF8C00;
  margin-bottom: 28px;
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 28px;

  &:last-of-type {
    margin-bottom: 0;
  }
`;

const StatNum = styled.span`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 3rem;
  line-height: 1;
  color: white;

  em {
    font-style: normal;
    color: #FF8C00;
  }
`;

const StatLabel = styled.span`
  font-family: 'Barlow', sans-serif;
  font-size: 0.9rem;
  color: rgba(255,255,255,0.55);
  margin-top: 4px;
`;

const StatDivider = styled.div`
  height: 1px;
  background: rgba(255,255,255,0.08);
  margin: 24px 0;
`;

const CheckList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 32px;
`;

const CheckItem = styled.li`
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.9rem;
  color: rgba(255,255,255,0.7);

  svg {
    color: #FF8C00;
    flex-shrink: 0;
  }
`;

/* ── Component ── */
const Hero = () => (
  <HeroSection id="hero">
    <GridOverlay />
    <DiagonalAccent />
    <OrangeBlock />

    <Inner>
      <Left>
        <EyebrowTag>
          <span />
          Für Handwerk & Gewerbe
        </EyebrowTag>

        <Headline>
          Volle Auftragsbücher?<br />
          <em>Pick dir die Rosinen.</em>
        </Headline>
        <HeadlineSub>Schluss mit jedem Auftrag annehmen.</HeadlineSub>

        <Subline>
          Werkruf macht dein Handwerksunternehmen online sichtbar — damit A-Kunden dich finden, 
          nicht umgekehrt. Kein Bullshit, keine Knebelverträge. Nur mehr von den richtigen Aufträgen.
        </Subline>

        <CTARow>
          <CTAButton href="#form">
            Sichtbarkeits-Check starten
            <ArrowRight size={18} />
          </CTAButton>
          <SecondaryLink href="#features">Erstmal schauen →</SecondaryLink>
        </CTARow>

        <CheckList>
          <CheckItem><CheckCircle size={16} /> Kostenloser Check — kein Risiko</CheckItem>
          <CheckItem><CheckCircle size={16} /> Ergebnis in 48 Stunden</CheckItem>
          <CheckItem><CheckCircle size={16} /> Kein Vertrag, kein Kleingedrucktes</CheckItem>
        </CheckList>
      </Left>

      <Right>
        <StatsPanel>
          <StatsPanelTitle>Werkruf in Zahlen</StatsPanelTitle>

          <StatItem>
            <StatNum>3<em>x</em></StatNum>
            <StatLabel>mehr qualifizierte Anfragen im Schnitt</StatLabel>
          </StatItem>

          <StatDivider />

          <StatItem>
            <StatNum>48<em>h</em></StatNum>
            <StatLabel>bis du online sichtbar bist</StatLabel>
          </StatItem>

          <StatDivider />

          <StatItem>
            <StatNum>0<em>€</em></StatNum>
            <StatLabel>für den ersten Sichtbarkeits-Check</StatLabel>
          </StatItem>
        </StatsPanel>
      </Right>
    </Inner>
  </HeroSection>
);

export default Hero;
