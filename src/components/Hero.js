import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import GooglePlacesAutocomplete from 'react-google-places-autocomplete';
import { Search, CheckCircle } from 'lucide-react';
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

/* Autocomplete overrides */
const AcWrap = styled.div`
  position: relative;
  margin-bottom: 8px;

  & > div > div {
    border-radius: var(--radius-card) !important;
    border: 2px solid var(--color-primary) !important;
    box-shadow: none !important;
    font-family: var(--font-body) !important;
    font-size: 1.05rem !important;
    min-height: 58px !important;
    background: var(--color-white) !important;
    cursor: text !important;
    padding-left: 44px !important;
    transition: border-color 0.2s, box-shadow 0.2s !important;
  }

  & > div > div:focus-within {
    border-color: var(--color-accent) !important;
    box-shadow: 0 0 0 3px rgba(var(--color-accent-rgb), 0.18) !important;
  }

  & input {
    font-family: var(--font-body) !important;
    font-size: 1.05rem !important;
    color: var(--color-text) !important;
  }

  & [class*="placeholder"] {
    color: #A0ADB8 !important;
    font-size: 0.98rem !important;
  }

  & [class*="menu"] {
    border-radius: var(--radius-card) !important;
    border: 2px solid var(--color-primary) !important;
    border-top: none !important;
    box-shadow: 0 8px 24px rgba(var(--color-primary-rgb), 0.14) !important;
    margin-top: -2px !important;
    z-index: 200 !important;
  }

  & [class*="option"] {
    font-family: var(--font-body) !important;
    font-size: 0.92rem !important;
    cursor: pointer !important;
    color: var(--color-primary) !important;
    padding: 12px 16px !important;
    border-bottom: 1px solid var(--color-border) !important;
  }

  & [class*="option"]:hover,
  & [class*="option--is-focused"] {
    background: rgba(var(--color-primary-rgb), 0.04) !important;
  }

  & [class*="singleValue"] {
    font-family: var(--font-body) !important;
    color: var(--color-text) !important;
    font-size: 1.05rem !important;
  }

  & [class*="indicatorSeparator"] { display: none !important; }
  & [class*="indicatorContainer"]  { color: #A0ADB8 !important; }
  & [class*="loadingIndicator"]    { color: var(--color-accent) !important; }
`;

const SearchIconOverlay = styled.div`
  position: absolute;
  left: 16px; top: 50%;
  transform: translateY(-50%);
  color: var(--color-accent);
  display: flex; align-items: center;
  pointer-events: none; z-index: 10;
`;

const Hint = styled.p`
  font-family: var(--font-body);
  font-size: 0.73rem;
  color: #A0ADB8;
  margin-bottom: 22px;
`;

const ErrTxt = styled.p`
  font-family: var(--font-body);
  font-size: 0.78rem;
  color: #D93025;
  margin-top: 5px; margin-bottom: 10px;
`;

const NoBanner = styled.div`
  padding: 14px 16px;
  border: 2px dashed #D93025;
  background: #FDECEA;
  font-family: var(--font-body);
  font-size: 0.85rem; color: #D93025;
`;

/* Stats */
const StatsStrip = styled.div`
  border-top: 1px solid var(--color-border);
  padding-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
`;

const StatItem = styled.div`
  text-align: center; padding: 0 8px;
  border-right: 1px solid var(--color-border);
  &:last-child { border-right: none; }
`;

const StatNum = styled.div`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.6rem; line-height: 1;
  color: var(--color-primary);
`;

const StatAccent = styled.span`color: var(--color-accent);`;

const StatLabel = styled.div`
  font-family: var(--font-body);
  font-size: 0.68rem; color: var(--color-text-muted);
  margin-top: 3px; line-height: 1.3;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
const Hero = ({ onPlaceSelect, fetchErr }) => {
  const { copy, places, design } = useIndustry();
  const { hero: heroCopy, check: checkCopy } = copy;

  const [localPlace, setLocalPlace] = useState(null);
  const apiKey = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;

  const handleSelect = (value) => {
    if (!value) return;
    setLocalPlace(value);
    const el = document.getElementById('analysis');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => onPlaceSelect(value), 350);
  };

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
            <CardTitle>{checkCopy.cardTitle}</CardTitle>
            <CardSub>{checkCopy.cardSub}</CardSub>

            <AcWrap>
              <SearchIconOverlay>
                <Search size={20} />
              </SearchIconOverlay>

              {apiKey ? (
                <GooglePlacesAutocomplete
                  apiKey={apiKey}
                  apiOptions={{ language: 'de', region: 'de' }}
                  selectProps={{
                    value: localPlace,
                    onChange: handleSelect,
                    placeholder: places.searchPlaceholder,
                    noOptionsMessage: () => 'Kein Treffer — versuch es genauer.',
                    loadingMessage: () => 'Suche…',
                    isClearable: true,
                  }}
                  autocompletionRequest={{
                    componentRestrictions: places.componentRestrictions,
                    types: [places.primaryType],
                    // Industry-specific types passed as keyword hint
                  }}
                />
              ) : (
                <NoBanner>⚠ REACT_APP_GOOGLE_PLACES_API_KEY fehlt in .env</NoBanner>
              )}
            </AcWrap>

            {fetchErr && <ErrTxt>{fetchErr}</ErrTxt>}
            <Hint>{places.searchHint}</Hint>

            <StatsStrip>
              <StatItem>
                <StatNum>3<StatAccent>×</StatAccent></StatNum>
                <StatLabel>mehr Anfragen</StatLabel>
              </StatItem>
              <StatItem>
                <StatNum>48<StatAccent>h</StatAccent></StatNum>
                <StatLabel>bis du sichtbarer bist</StatLabel>
              </StatItem>
              <StatItem>
                <StatNum>0<StatAccent>€</StatAccent></StatNum>
                <StatLabel>für den Check</StatLabel>
              </StatItem>
            </StatsStrip>
          </SearchCard>
        </Right>
      </Inner>
    </HeroSection>
  );
};

export default Hero;
