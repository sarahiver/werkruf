import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Target, Users, Clock, TrendingUp, Shield, Zap } from 'lucide-react';

/* ── Animations ── */
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ── Styled Components ── */
const Section = styled.section`
  background: #F2F2F2;
  padding: 100px 24px;
  position: relative;
  overflow: hidden;
`;

const TopStripe = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  background: repeating-linear-gradient(
    90deg,
    #002C51 0px,
    #002C51 60px,
    #FF8C00 60px,
    #FF8C00 80px
  );
`;

const Inner = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`;

const SectionHeader = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 32px;
  margin-bottom: 64px;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const Eyebrow = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #FF8C00;
  margin-bottom: 12px;
`;

const Title = styled.h2`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: clamp(2rem, 4vw, 3rem);
  text-transform: uppercase;
  color: #002C51;
  line-height: 1.05;

  em {
    font-style: normal;
    color: #FF8C00;
  }
`;

const HeaderNote = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 1rem;
  color: #5A6A7A;
  max-width: 280px;
  line-height: 1.6;

  @media (max-width: 700px) {
    max-width: 100%;
  }
`;

/* Feature Grid */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  background: #D0D8E0;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  background: white;
  padding: 40px 36px;
  position: relative;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  animation: ${fadeUp} 0.6s ease ${({ $delay }) => $delay || '0s'} both;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: #FF8C00;
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s ease;
  }

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(0,44,81,0.12);
    z-index: 1;
  }

  &:hover::before {
    transform: scaleX(1);
  }
`;

const CardNumber = styled.span`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 5rem;
  line-height: 1;
  color: rgba(0,44,81,0.07);
  display: block;
  margin-bottom: -16px;
  letter-spacing: -0.02em;
`;

const IconWrap = styled.div`
  width: 52px;
  height: 52px;
  background: #002C51;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  color: #FF8C00;
`;

const CardTitle = styled.h3`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.5rem;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 12px;
  letter-spacing: 0.02em;
`;

const CardBody = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.95rem;
  color: #5A6A7A;
  line-height: 1.7;
  margin-bottom: 20px;
`;

const CardTag = styled.span`
  display: inline-block;
  background: rgba(255,140,0,0.1);
  color: #FF8C00;
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 4px 10px;
`;

/* Bottom bar */
const BottomBar = styled.div`
  margin-top: 64px;
  background: #002C51;
  padding: 36px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
`;

const BottomText = styled.p`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.3rem;
  text-transform: uppercase;
  color: white;
  letter-spacing: 0.04em;
`;

const BottomCTA = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  transition: background 0.2s;

  &:hover {
    background: #E07A00;
  }
`;

/* ── Data ── */
const features = [
  {
    number: '01',
    icon: <Target size={24} />,
    title: 'A-Kunden Magnet',
    body: 'Dein Profil zieht genau die Auftraggeber an, die zahlen können und wollen. Keine Preisdiskussionen mit Leuten, die nur "mal fragen" wollen.',
    tag: 'Qualität statt Quantität',
  },
  {
    number: '02',
    icon: <Users size={24} />,
    title: 'Mitarbeiter-Magnet',
    body: 'Gute Leute suchen gute Betriebe. Mit einem starken Auftritt online findest du Fachkräfte, bevor der Markt sie schluckt — oder deine Konkurrenz.',
    tag: 'Fachkräfte gewinnen',
  },
  {
    number: '03',
    icon: <Clock size={24} />,
    title: 'Zeit zurückgewinnen',
    body: 'Kein Rumtelefonieren mehr mit Interessenten, die eh nix kaufen. Deine Zeit gehört den Projekten — nicht der Akquise.',
    tag: 'Weniger Stress',
  },
  {
    number: '04',
    icon: <TrendingUp size={24} />,
    title: 'Besser gefunden werden',
    body: 'Google, Maps, Branchenportale — wir sorgen dafür, dass dich die Richtigen finden, wenn sie suchen. Lokal und regional.',
    tag: 'SEO & Sichtbarkeit',
  },
  {
    number: '05',
    icon: <Shield size={24} />,
    title: 'Dein Ruf, geschützt',
    body: 'Bewertungen sind heute alles. Wir helfen dir, aktiv gute Rezensionen zu sammeln und auf schlechte professionell zu reagieren.',
    tag: 'Reputation',
  },
  {
    number: '06',
    icon: <Zap size={24} />,
    title: 'Schnell live',
    body: 'Kein monatelanges Hin-und-her. Dein Auftritt steht in 48 Stunden. Danach kannst du dich wieder ums Handwerk kümmern.',
    tag: 'Sofortstart',
  },
];

/* ── Component ── */
const Features = () => (
  <Section id="features">
    <TopStripe />
    <Inner>
      <SectionHeader>
        <div>
          <Eyebrow>Was du davon hast</Eyebrow>
          <Title>Digital. <em>Hart.</em><br />Auf den Punkt.</Title>
        </div>
        <HeaderNote>
          Kein Schnickschnack. Sechs Hebel, die deinen Betrieb nach vorne bringen.
        </HeaderNote>
      </SectionHeader>

      <Grid>
        {features.map((f, i) => (
          <Card key={f.number} $delay={`${i * 0.08}s`}>
            <CardNumber>{f.number}</CardNumber>
            <IconWrap>{f.icon}</IconWrap>
            <CardTitle>{f.title}</CardTitle>
            <CardBody>{f.body}</CardBody>
            <CardTag>{f.tag}</CardTag>
          </Card>
        ))}
      </Grid>

      <BottomBar>
        <BottomText>Bereit, die falschen Kunden loszuwerden?</BottomText>
        <BottomCTA href="#form">Jetzt Sichtbarkeits-Check machen →</BottomCTA>
      </BottomBar>
    </Inner>
  </Section>
);

export default Features;
