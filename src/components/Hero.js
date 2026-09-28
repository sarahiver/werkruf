import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Link } from 'react-router-dom';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to   { opacity: 1; transform: translateY(0); }
`;
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
`;

/* ─────────────────────────────────────────────
   STYLED — all colors from CSS vars
───────────────────────────────────────────── */
const HeroSection = styled.section`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  position: relative;
  overflow: hidden;
  padding: 120px 24px 80px;
`;

const GridOverlay = styled.div`
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb), 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
  /* Only show for heavy-duty industries */
  display: ${({ $show }) => $show ? 'block' : 'none'};
`;

const AccentBar = styled.div`
  position: absolute;
  top: 0; right: 0;
  width: 5px; height: 100%;
  background: var(--color-accent);
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
    gap: 32px;
  }
`;

const Left = styled.div`
  animation: ${fadeUp} 0.7s ease both;
  @media (max-width: 900px) { order: 1; }
`;

const EyebrowTag = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(var(--color-accent-rgb), 0.12);
  border: 1px solid rgba(var(--color-accent-rgb), 0.35);
  color: var(--color-accent);
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 14px;
  margin-bottom: 22px;
`;

const Dot = styled.span`
  width: 6px; height: 6px;
  background: var(--color-accent);
  border-radius: 50%;
  display: inline-block;
  animation: ${pulse} 1.5s ease infinite;
`;

const Headline = styled.h1`
  font-size: clamp(2.6rem, 5vw, 4.2rem);
  line-height: 1.0;
  color: var(--color-white);
  margin-bottom: 8px;
  text-transform: var(--text-transform);
`;

const HeadlineAccent = styled.span`
  color: var(--color-accent);
`;

const HeadlineSub = styled.p`
  font-family: var(--font-display);
  font-size: clamp(1.1rem, 2vw, 1.5rem);
  text-transform: var(--text-transform);
  color: rgba(255,255,255,0.38);
  margin-bottom: 32px;
  letter-spacing: 0.04em;
`;

const CheckList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const CheckItem = styled.li`
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 0.88rem;
  color: rgba(255,255,255,0.62);
  svg { color: var(--color-accent); flex-shrink: 0; }
`;

/* Search Card */
const Right = styled.div`
  animation: ${fadeUp} 0.7s ease 0.15s both;
  @media (max-width: 900px) { order: 2; }
`;

const SearchCard = styled.div`
  background: var(--color-white);
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 32px 28px 28px;
  @media (max-width: 560px) { padding: 24px 20px 22px; }
`;

const CardTitle = styled.p`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.15rem;
  text-transform: var(--text-transform);
  color: var(--color-primary);
  letter-spacing: var(--letter-spacing);
  margin-bottom: 4px;
`;

const CardSub = styled.p`
  font-family: var(--font-body);
  font-size: 0.82rem;
  color: var(--color-text-muted);
  margin-bottom: 20px;
  line-height: 1.5;
`;

const CtaButton = styled(Link)`
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 16px 20px; margin-top: 6px;
  background: var(--color-accent); color: #fff;
  border-radius: var(--radius-button); text-decoration: none;
  font-weight: 800; font-size: 1rem; line-height: 1.3;
  transition: filter .15s ease;
  &:hover { filter: brightness(1.07); }
`;

const CtaHinweis = styled.p`
  font-size: .78rem; color: #66717e; line-height: 1.55; margin: 14px 0 0;
`;

const Anmeldung = styled.p`
  font-size: .82rem; color: #66717e; margin: 16px 0 0;
  padding-top: 14px; border-top: 1px solid var(--color-border);
`;

const AnmeldeLink = styled(Link)`
  color: var(--color-accent); font-weight: 700; text-decoration: underline;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
const Hero = () => {
  const { copy, design } = useIndustry();
  const { hero: heroCopy } = copy;
  const { isAuthenticated } = useAuthContext();

  /* Ein Ziel, zwei Ausgangslagen. Angemeldete Nutzer landen direkt auf
     der Verbindungsseite, alle anderen bei der Registrierung — von dort
     fuehrt das Onboarding weiter zur selben Seite. */
  const ctaZiel = isAuthenticated ? '/dashboard/google' : '/signup';

  return (
    <HeroSection id="hero">
      <GridOverlay $show={design.accentStripePattern} />
      <AccentBar />

      <Inner>
        <Left>
          <EyebrowTag><Dot /> {heroCopy.eyebrow}</EyebrowTag>

          <Headline>
            {heroCopy.headline}<br />
            <HeadlineAccent>{heroCopy.headlineAccent}</HeadlineAccent>
          </Headline>

          <HeadlineSub>{heroCopy.subline}</HeadlineSub>

          <CheckList>
            {heroCopy.checks.map((check, i) => (
              <CheckItem key={i}>
                <CheckCircle size={15} />
                {check}
              </CheckItem>
            ))}
          </CheckList>
        </Left>

        <Right>
          <SearchCard>
            <CardTitle>Dein Unternehmensprofil verbinden</CardTitle>
            <CardSub>
              Eine Berechtigung, zwei Minuten. Danach prüft WERKRUF dein Profil
              laufend und sagt dir, was zu tun ist.
            </CardSub>

            <CtaButton to={ctaZiel}>
              Jetzt Google-Unternehmensprofil verbinden
              <ArrowRight size={18} />
            </CtaButton>

            <CtaHinweis>
              WERKRUF liest dein Unternehmensprofil und schlägt Änderungen vor.
              Veröffentlicht wird nur, was du freigibst. Kein Zugriff auf E-Mails,
              Kontakte oder Dateien.
            </CtaHinweis>

            <Anmeldung>
              Schon registriert? <AnmeldeLink to="/login">Anmelden</AnmeldeLink>
            </Anmeldung>
          </SearchCard>
        </Right>

      </Inner>
    </HeroSection>
  );
};

export default Hero;
