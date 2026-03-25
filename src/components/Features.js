import React from 'react';
import styled from 'styled-components';
import { Target, Users, Clock, TrendingUp, Shield, Zap } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';

const ICONS = [Target, Users, Clock, TrendingUp, Shield, Zap];

const Section = styled.section`
  background: var(--color-bg);
  padding: 100px 24px;
  position: relative;
  overflow: hidden;
`;

const TopStripe = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0; height: 5px;
  background: repeating-linear-gradient(
    90deg,
    var(--color-primary) 0px, var(--color-primary) 60px,
    var(--color-accent) 60px, var(--color-accent) 80px
  );
  display: ${({ $show }) => $show ? 'block' : 'none'};
`;

const Inner = styled.div`max-width: 1200px; margin: 0 auto;`;

const SectionHeader = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 32px;
  margin-bottom: 64px;
  @media (max-width: 700px) { grid-template-columns: 1fr; }
`;

const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 12px;
`;

const Title = styled.h2`
  font-size: clamp(2rem, 4vw, 3rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.05;
`;

const TitleAccent = styled.span`color: var(--color-accent);`;

const HeaderNote = styled.p`
  font-family: var(--font-body); font-size: 0.95rem;
  color: var(--color-text-muted); max-width: 280px; line-height: 1.65;
  @media (max-width: 700px) { max-width: 100%; }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  background: var(--color-border);
  @media (max-width: 900px) { grid-template-columns: 1fr 1fr; }
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;

const Card = styled.div`
  background: var(--color-white);
  padding: 40px 32px;
  position: relative;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  border-radius: var(--radius-card);

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    background: var(--color-accent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s ease;
  }

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(var(--color-primary-rgb), 0.12);
    z-index: 1;
  }

  &:hover::before { transform: scaleX(1); }
`;

const CardNum = styled.span`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 4.5rem; line-height: 1;
  color: rgba(var(--color-primary-rgb), 0.06);
  display: block; margin-bottom: -12px;
`;

const IconWrap = styled.div`
  width: 50px; height: 50px;
  background: var(--color-primary);
  border-radius: var(--radius-button);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 18px;
  color: var(--color-accent);
`;

const CardTitle = styled.h3`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.4rem;
  text-transform: var(--text-transform);
  color: var(--color-primary);
  margin-bottom: 10px;
`;

const CardBody = styled.p`
  font-family: var(--font-body); font-size: 0.92rem;
  color: var(--color-text-muted); line-height: 1.7; margin-bottom: 18px;
`;

const CardTag = styled.span`
  display: inline-block;
  background: rgba(var(--color-accent-rgb), 0.1);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 4px 10px;
  border-radius: var(--radius-button);
`;

const BottomBar = styled.div`
  margin-top: 64px;
  background: var(--color-primary);
  border-radius: var(--radius-card);
  padding: 36px 40px;
  display: flex; align-items: center;
  justify-content: space-between; gap: 24px; flex-wrap: wrap;
`;

const BottomText = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.3rem; text-transform: var(--text-transform);
  color: var(--color-white); letter-spacing: 0.04em;
`;

const BottomCTA = styled.a`
  display: inline-flex; align-items: center;
  padding: 12px 28px;
  background: var(--color-accent); color: var(--color-white);
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: 0.08em;
  text-transform: var(--text-transform);
  white-space: nowrap;
  border-radius: var(--radius-button);
  transition: filter 0.2s;
  &:hover { filter: brightness(0.9); }
`;

const Features = () => {
  const { copy, design } = useIndustry();
  const features = copy.features;

  return (
    <Section id="features">
      <TopStripe $show={design.topStripe} />
      <Inner>
        <SectionHeader>
          <div>
            <Eyebrow>Was du davon hast</Eyebrow>
            <Title>Digital. <TitleAccent>Hart.</TitleAccent><br />Auf den Punkt.</Title>
          </div>
          <HeaderNote>
            Kein Schnickschnack. Sechs Hebel, die deinen Betrieb nach vorne bringen.
          </HeaderNote>
        </SectionHeader>

        <Grid>
          {features.map((f, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <Card key={f.num}>
                <CardNum>{f.num}</CardNum>
                <IconWrap><Icon size={22} /></IconWrap>
                <CardTitle>{f.title}</CardTitle>
                <CardBody>{f.body}</CardBody>
                <CardTag>{f.tag}</CardTag>
              </Card>
            );
          })}
        </Grid>

        <BottomBar>
          <BottomText>Bereit, die falschen Kunden loszuwerden?</BottomText>
          <BottomCTA href="#check">Jetzt Sichtbarkeits-Check machen →</BottomCTA>
        </BottomBar>
      </Inner>
    </Section>
  );
};

export default Features;
