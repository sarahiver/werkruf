import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import GooglePlacesAutocomplete from 'react-google-places-autocomplete';
import { Search, CheckCircle } from 'lucide-react';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to   { opacity: 1; transform: translateY(0); }
`;
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
`;

const HeroSection = styled.section`
  min-height: 100vh;
  background: #002C51;
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
    linear-gradient(rgba(255,140,0,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,140,0,0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
`;

const OrangeBar = styled.div`
  position: absolute;
  top: 0; right: 0;
  width: 5px; height: 100%;
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
    gap: 32px;
  }
`;

/* LEFT */
const Left = styled.div`
  animation: ${fadeUp} 0.7s ease both;
  @media (max-width: 900px) { order: 1; }
`;

const EyebrowTag = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,140,0,0.12);
  border: 1px solid rgba(255,140,0,0.35);
  color: #FF8C00;
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 14px;
  margin-bottom: 22px;
`;

const Dot = styled.span`
  width: 6px; height: 6px;
  background: #FF8C00;
  border-radius: 50%;
  display: inline-block;
  animation: ${pulse} 1.5s ease infinite;
`;

const Headline = styled.h1`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: clamp(2.6rem, 5vw, 4.2rem);
  line-height: 1.0;
  text-transform: uppercase;
  color: white;
  margin-bottom: 8px;
`;

const Accent = styled.span`color: #FF8C00;`;

const HeadlineSub = styled.p`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: clamp(1.1rem, 2vw, 1.5rem);
  text-transform: uppercase;
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
  font-family: 'Barlow', sans-serif;
  font-size: 0.88rem;
  color: rgba(255,255,255,0.62);
  svg { color: #FF8C00; flex-shrink: 0; }
`;

/* RIGHT — Search card */
const Right = styled.div`
  animation: ${fadeUp} 0.7s ease 0.15s both;
  @media (max-width: 900px) { order: 2; }
`;

const SearchCard = styled.div`
  background: white;
  border-top: 5px solid #FF8C00;
  padding: 32px 28px 28px;

  @media (max-width: 560px) {
    padding: 24px 20px 22px;
  }
`;

const CardTitle = styled.p`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.15rem;
  text-transform: uppercase;
  color: #002C51;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
`;

const CardSub = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.82rem;
  color: #5A6A7A;
  margin-bottom: 20px;
  line-height: 1.5;
`;

/* Autocomplete — large, prominent */
const AcWrap = styled.div`
  position: relative;
  margin-bottom: 8px;

  & > div > div {
    border-radius: 0 !important;
    border: 2px solid #002C51 !important;
    box-shadow: none !important;
    font-family: 'Barlow', sans-serif !important;
    font-size: 1.05rem !important;
    min-height: 58px !important;
    background: white !important;
    cursor: text !important;
    padding-left: 44px !important;
    transition: border-color 0.2s, box-shadow 0.2s !important;
  }

  & > div > div:focus-within {
    border-color: #FF8C00 !important;
    box-shadow: 0 0 0 3px rgba(255,140,0,0.18) !important;
  }

  & input {
    font-family: 'Barlow', sans-serif !important;
    font-size: 1.05rem !important;
    color: #1A1A1A !important;
  }

  & [class*="placeholder"] {
    color: #A0ADB8 !important;
    font-family: 'Barlow', sans-serif !important;
    font-size: 0.98rem !important;
  }

  & [class*="menu"] {
    border-radius: 0 !important;
    border: 2px solid #002C51 !important;
    border-top: none !important;
    box-shadow: 0 8px 24px rgba(0,44,81,0.14) !important;
    margin-top: -2px !important;
    z-index: 200 !important;
  }

  & [class*="option"] {
    font-family: 'Barlow', sans-serif !important;
    font-size: 0.92rem !important;
    cursor: pointer !important;
    color: #002C51 !important;
    padding: 12px 16px !important;
    border-bottom: 1px solid #F2F2F2 !important;
  }

  & [class*="option"]:hover,
  & [class*="option--is-focused"] {
    background: #F0F5FA !important;
  }

  & [class*="singleValue"] {
    font-family: 'Barlow', sans-serif !important;
    color: #1A1A1A !important;
    font-size: 1.05rem !important;
  }

  & [class*="indicatorSeparator"] { display: none !important; }
  & [class*="indicatorContainer"]  { color: #A0ADB8 !important; }
  & [class*="loadingIndicator"]    { color: #FF8C00 !important; }
`;

const SearchIconOverlay = styled.div`
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #FF8C00;
  display: flex;
  align-items: center;
  pointer-events: none;
  z-index: 10;
`;

const Hint = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.73rem;
  color: #A0ADB8;
  margin-bottom: 22px;
`;

const ErrTxt = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #D93025;
  margin-top: 5px;
  margin-bottom: 10px;
`;

const NoBanner = styled.div`
  padding: 14px 16px;
  border: 2px dashed #D93025;
  background: #FDECEA;
  font-family: 'Barlow', sans-serif;
  font-size: 0.85rem;
  color: #D93025;
`;

/* Stats strip */
const StatsStrip = styled.div`
  border-top: 1px solid #E8EDF2;
  padding-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
`;

const StatItem = styled.div`
  text-align: center;
  padding: 0 8px;
  border-right: 1px solid #E8EDF2;
  &:last-child { border-right: none; }
`;

const StatNum = styled.div`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 1.6rem;
  line-height: 1;
  color: #002C51;
`;

const StatOrange = styled.span`color: #FF8C00;`;

const StatLabel = styled.div`
  font-family: 'Barlow', sans-serif;
  font-size: 0.68rem;
  color: #5A6A7A;
  margin-top: 3px;
  line-height: 1.3;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
const Hero = ({ onPlaceSelect, fetchErr }) => {
  const [localPlace, setLocalPlace] = useState(null);
  const apiKey = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;

  const handleSelect = (value) => {
    if (!value) return;
    setLocalPlace(value);

    // 1. Smooth-scroll to analysis section
    const el = document.getElementById('analysis');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 2. Short delay so scroll begins before fetch fires
    setTimeout(() => onPlaceSelect(value), 350);
  };

  return (
    <HeroSection id="hero">
      <GridOverlay />
      <OrangeBar />

      <Inner>
        {/* ── LEFT: Copy ── */}
        <Left>
          <EyebrowTag><Dot /> Für Handwerk &amp; Gewerbe</EyebrowTag>

          <Headline>
            Volle Auftragsbücher?<br />
            <Accent>Pick dir die Rosinen.</Accent>
          </Headline>
          <HeadlineSub>Schluss damit, jeden Auftrag annehmen zu müssen.</HeadlineSub>

          <CheckList>
            <CheckItem><CheckCircle size={15} /> Echte Google-Daten — kein Schätzwert</CheckItem>
            <CheckItem><CheckCircle size={15} /> Sichtbarkeits-Score in Sekunden</CheckItem>
            <CheckItem><CheckCircle size={15} /> Kostenloser 4-seitiger PDF-Report</CheckItem>
          </CheckList>
        </Left>

        {/* ── RIGHT: Search Card ── */}
        <Right>
          <SearchCard>
            <CardTitle>Kostenloser Sichtbarkeits-Check</CardTitle>
            <CardSub>
              Betrieb eingeben — wir zeigen dir in Sekunden, was dir gerade entgeht.
            </CardSub>

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
                    placeholder: 'z.B. Sanitär Müller Hamburg…',
                    noOptionsMessage: () => 'Kein Treffer — versuch es genauer.',
                    loadingMessage: () => 'Suche…',
                    isClearable: true,
                  }}
                  autocompletionRequest={{
                    componentRestrictions: { country: 'de' },
                    types: ['establishment'],
                  }}
                />
              ) : (
                <NoBanner>⚠ REACT_APP_GOOGLE_PLACES_API_KEY fehlt in .env</NoBanner>
              )}
            </AcWrap>

            {fetchErr && <ErrTxt>{fetchErr}</ErrTxt>}
            <Hint>Tipp: Firmenname + Stadt eingeben für beste Treffer.</Hint>

            <StatsStrip>
              <StatItem>
                <StatNum>3<StatOrange>x</StatOrange></StatNum>
                <StatLabel>mehr qualifizierte Anfragen</StatLabel>
              </StatItem>
              <StatItem>
                <StatNum>48<StatOrange>h</StatOrange></StatNum>
                <StatLabel>bis du sichtbarer bist</StatLabel>
              </StatItem>
              <StatItem>
                <StatNum>0<StatOrange>€</StatOrange></StatNum>
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
