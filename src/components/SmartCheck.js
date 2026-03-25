import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes, css } from 'styled-components';
import {
  Search, MapPin, Star, AlertTriangle, MessageSquare,
  Clock, CheckCircle, Send, ChevronRight, X, Loader
} from 'lucide-react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   MOCK DATA — replace with real API later
───────────────────────────────────────────── */
const MOCK_SUGGESTIONS = [
  { name: 'Sanitär Müller GmbH',        city: 'Hamburg-Wandsbek' },
  { name: 'Heizung & Bad Schneider',    city: 'Hamburg-Barmbek'  },
  { name: 'Elektro Hoffmann',           city: 'Hamburg-Eimsbüttel'},
  { name: 'Maler Petersen',             city: 'Hamburg-Altona'   },
  { name: 'Dachdecker Koch & Söhne',    city: 'Hamburg-Bergedorf' },
  { name: 'Sanitär Nord Hamburg',       city: 'Hamburg-Nord'     },
  { name: 'KFZ Werkstatt Braun',        city: 'Hamburg-Harburg'  },
  { name: 'Garten & Landschaft Weber',  city: 'Hamburg-Rahlstedt'},
];

function getMockResult(name, city) {
  // deterministic fake data seeded by name length
  const seed = name.length;
  return {
    name,
    city,
    stars:          Math.round((2.8 + (seed % 7) * 0.3) * 10) / 10,
    reviewCount:    4 + (seed % 18),
    unanswered:     2 + (seed % 5),
    missingKeywords:3 + (seed % 4),
    profileScore:   20 + (seed % 35),
    monthlyLoss:    800 + (seed % 12) * 150,
  };
}

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

const scanBar = keyframes`
  0%   { width: 0%; }
  100% { width: 100%; }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-4px); }
  40%       { transform: translateX(4px); }
  60%       { transform: translateX(-4px); }
  80%       { transform: translateX(4px); }
`;

/* ─────────────────────────────────────────────
   LAYOUT WRAPPER
───────────────────────────────────────────── */
const Section = styled.section`
  background: #002C51;
  padding: 80px 24px 100px;
  position: relative;
  overflow: hidden;
`;

const GridBg = styled.div`
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,140,0,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,140,0,0.04) 1px, transparent 1px);
  background-size: 44px 44px;
  pointer-events: none;
`;

const SectionInner = styled.div`
  max-width: 760px;
  margin: 0 auto;
`;

const SectionEyebrow = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #FF8C00;
  text-align: center;
  margin-bottom: 12px;
`;

const SectionTitle = styled.h2`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: clamp(2rem, 4vw, 2.8rem);
  text-transform: uppercase;
  color: white;
  text-align: center;
  line-height: 1.05;
  margin-bottom: 10px;
`;

const TitleAccent = styled.span`
  color: #FF8C00;
`;

const SectionSubline = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.95rem;
  color: rgba(255,255,255,0.55);
  text-align: center;
  margin-bottom: 40px;
`;

/* ─────────────────────────────────────────────
   SMART CHECK CARD
───────────────────────────────────────────── */
const Card = styled.div`
  background: #F2F2F2;
  border-top: 5px solid #FF8C00;
  position: relative;
  animation: ${fadeUp} 0.5s ease both;
`;

const CardInner = styled.div`
  padding: 32px 32px 36px;
  @media (max-width: 560px) { padding: 24px 20px 28px; }
`;

/* ── Step 1: Search ── */
const StepLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
`;

const StepNum = styled.span`
  width: 22px;
  height: 22px;
  background: #002C51;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const StepText = styled.span`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #5A6A7A;
`;

const SearchWrapper = styled.div`
  position: relative;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 15px 48px 15px 48px;
  border: 2px solid ${({ $focused, $hasError }) =>
    $hasError ? '#E53E3E' : $focused ? '#002C51' : '#D0D8E0'};
  background: white;
  color: #1A1A1A;
  font-family: 'Barlow', sans-serif;
  font-size: 1rem;
  outline: none;
  border-radius: 0;
  transition: border-color 0.2s;
  ${({ $shake }) => $shake && css`animation: ${shake} 0.4s ease;`}

  &::placeholder { color: #A0ADB8; }
`;

const SearchIcon = styled.div`
  position: absolute;
  left: 15px;
  top: 50%;
  transform: translateY(-50%);
  color: ${({ $active }) => $active ? '#FF8C00' : '#A0ADB8'};
  display: flex;
  align-items: center;
  transition: color 0.2s;
`;

const ClearBtn = styled.button`
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 4px;
  color: #A0ADB8;
  cursor: pointer;
  display: flex;
  align-items: center;
  &:hover { color: #5A6A7A; }
`;

/* Autocomplete Dropdown */
const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  background: white;
  border: 2px solid #002C51;
  border-top: none;
  z-index: 50;
  max-height: 260px;
  overflow-y: auto;
  animation: ${fadeIn} 0.15s ease both;
`;

const DropdownItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #F0F0F0;
  transition: background 0.12s;

  &:last-child { border-bottom: none; }
  &:hover, &[data-active='true'] {
    background: #F0F5FA;
  }
`;

const DropdownIcon = styled.div`
  color: #FF8C00;
  flex-shrink: 0;
  display: flex;
  align-items: center;
`;

const DropdownName = styled.span`
  font-family: 'Barlow', sans-serif;
  font-weight: 600;
  font-size: 0.9rem;
  color: #002C51;
`;

const DropdownCity = styled.span`
  font-family: 'Barlow', sans-serif;
  font-size: 0.8rem;
  color: #5A6A7A;
  margin-left: auto;
  white-space: nowrap;
`;

const DropdownNote = styled.div`
  padding: 10px 16px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #A0ADB8;
  font-style: italic;
`;

/* ── Step 2: Loading ── */
const LoadingWrap = styled.div`
  animation: ${fadeIn} 0.3s ease both;
  padding: 8px 0 4px;
`;

const LoadingHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
`;

const SpinnerIcon = styled.div`
  color: #FF8C00;
  animation: ${spin} 0.8s linear infinite;
  display: flex;
`;

const LoadingTitle = styled.p`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  text-transform: uppercase;
  color: #002C51;
  letter-spacing: 0.04em;
`;

const ProgressTrack = styled.div`
  width: 100%;
  height: 6px;
  background: #E0E8F0;
  overflow: hidden;
  margin-bottom: 12px;
`;

const ProgressFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #FF8C00 0%, #FFB347 100%);
  animation: ${scanBar} ${({ $duration }) => $duration || '3s'} ease-in-out forwards;
  width: 0%;
`;

const LoadingSteps = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const LoadingStep = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.85rem;
  color: ${({ $done }) => $done ? '#1E7E34' : $done === false ? '#A0ADB8' : '#002C51'};
  transition: color 0.3s;
`;

const StepDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $done }) => $done ? '#1E7E34' : $done === false ? '#D0D8E0' : '#FF8C00'};
  flex-shrink: 0;
  ${({ $active }) => $active && css`animation: ${pulse} 1s ease infinite;`}
`;

/* ── Step 3: Result Teaser ── */
const ResultWrap = styled.div`
  animation: ${fadeUp} 0.4s ease both;
`;

const ResultHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
`;

const ResultCompany = styled.div``;

const CompanyName = styled.h3`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.4rem;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 2px;
`;

const CompanyCity = styled.p`
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.82rem;
  color: #5A6A7A;
  svg { color: #FF8C00; }
`;

const ScoreBadge = styled.div`
  background: ${({ $score }) =>
    $score >= 60 ? '#E8F5E9' : $score >= 40 ? '#FFF8E1' : '#FDECEA'};
  border: 2px solid ${({ $score }) =>
    $score >= 60 ? '#1E7E34' : $score >= 40 ? '#F5A623' : '#D93025'};
  padding: 8px 16px;
  text-align: center;
  flex-shrink: 0;
`;

const ScoreNum = styled.div`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 2rem;
  line-height: 1;
  color: ${({ $score }) =>
    $score >= 60 ? '#1E7E34' : $score >= 40 ? '#D48A00' : '#D93025'};
`;

const ScoreLabel = styled.div`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #5A6A7A;
  margin-top: 2px;
`;

/* Metrics row */
const MetricsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  background: #D0D8E0;
  margin-bottom: 16px;
`;

const MetricCell = styled.div`
  background: white;
  padding: 14px 12px;
  text-align: center;
`;

const MetricValue = styled.div`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 1.5rem;
  color: #002C51;
  line-height: 1;
  margin-bottom: 3px;
`;

const MetricLabel = styled.div`
  font-family: 'Barlow', sans-serif;
  font-size: 0.72rem;
  color: #5A6A7A;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

/* Star rating */
const StarsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  justify-content: center;
  margin-bottom: 2px;
`;

const StarIcon = styled.div`
  color: ${({ $filled }) => $filled ? '#FF8C00' : '#D0D8E0'};
  display: flex;
`;

/* Warning alerts */
const AlertList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
`;

const AlertItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: ${({ $type }) => $type === 'error' ? '#FDECEA' : $type === 'warn' ? '#FFF8E1' : '#E8F5E9'};
  border-left: 3px solid ${({ $type }) =>
    $type === 'error' ? '#D93025' : $type === 'warn' ? '#F5A623' : '#1E7E34'};
`;

const AlertIcon = styled.div`
  color: ${({ $type }) => $type === 'error' ? '#D93025' : $type === 'warn' ? '#F5A623' : '#1E7E34'};
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
`;

const AlertText = styled.div``;

const AlertTitle = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.88rem;
  color: #1A1A1A;
  margin-bottom: 1px;
`;

const AlertSub = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #5A6A7A;
`;

/* Blur teaser overlay */
const TeaserOverlay = styled.div`
  position: relative;
  margin-bottom: 20px;
`;

const BlurredSection = styled.div`
  filter: blur(5px);
  user-select: none;
  pointer-events: none;
`;

const OverlayLock = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,44,81,0.1);
`;

const LockBadge = styled.div`
  background: #002C51;
  color: white;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 0.9rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
`;

/* ── Step 4: Lead Form ── */
const LeadDivider = styled.div`
  height: 1px;
  background: #D0D8E0;
  margin: 24px 0 20px;
`;

const LeadTitle = styled.h4`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.2rem;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 6px;
`;

const LeadSub = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.85rem;
  color: #5A6A7A;
  margin-bottom: 16px;
  line-height: 1.5;
`;

const EmailRow = styled.div`
  display: flex;
  gap: 0;
  @media (max-width: 500px) { flex-direction: column; }
`;

const EmailInput = styled.input`
  flex: 1;
  padding: 14px 16px;
  border: 2px solid ${({ $error }) => $error ? '#E53E3E' : '#D0D8E0'};
  border-right: none;
  background: white;
  font-family: 'Barlow', sans-serif;
  font-size: 0.95rem;
  color: #1A1A1A;
  outline: none;
  border-radius: 0;
  transition: border-color 0.2s;
  &:focus { border-color: #002C51; }
  &::placeholder { color: #A0ADB8; }

  @media (max-width: 500px) {
    border-right: 2px solid ${({ $error }) => $error ? '#E53E3E' : '#D0D8E0'};
    border-bottom: none;
  }
`;

const SubmitBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  background: ${({ disabled }) => disabled ? '#D07000' : '#FF8C00'};
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: none;
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  white-space: nowrap;
  transition: background 0.2s, transform 0.1s;
  flex-shrink: 0;

  &:hover:not(:disabled) { background: #E07A00; transform: translateY(-1px); }
  .spin { animation: ${spin} 0.8s linear infinite; }

  @media (max-width: 500px) { width: 100%; justify-content: center; }
`;

const FormError = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #E53E3E;
  margin-top: 6px;
`;

const SuccessBox = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #E8F5E9;
  border-left: 4px solid #1E7E34;
  animation: ${fadeIn} 0.3s ease;
`;

const SuccessText = styled.div`
  font-family: 'Barlow', sans-serif;
  font-size: 0.9rem;
  color: #1A1A1A;
  strong { font-weight: 700; display: block; margin-bottom: 2px; }
`;

/* ── Trust strip ── */
const TrustStrip = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-top: 20px;
  flex-wrap: wrap;
`;

const TrustItem = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.75rem;
  color: rgba(255,255,255,0.5);
  svg { color: rgba(255,255,255,0.35); }
`;

/* ──────────────────────────────────────────────
   SCAN STEPS CONFIG
────────────────────────────────────────────── */
const SCAN_STEPS = [
  { label: 'WERKRUF scannt lokale SEO-Daten…',           ms: 900  },
  { label: (city) => `Prüfe Wettbewerb in ${city}…`,     ms: 1000 },
  { label: 'Analysiere Google-Profil-Vollständigkeit…',  ms: 700  },
  { label: 'Berechne Umsatzpotenzial…',                  ms: 400  },
];

function getStepLabel(step, city) {
  return typeof step.label === 'function' ? step.label(city) : step.label;
}

/* ──────────────────────────────────────────────
   STAR RATING HELPER
────────────────────────────────────────────── */
function StarRating({ value }) {
  return (
    <StarsRow>
      {[1, 2, 3, 4, 5].map(i => (
        <StarIcon key={i} $filled={i <= Math.round(value)}>
          <Star size={14} fill={i <= Math.round(value) ? '#FF8C00' : 'none'} />
        </StarIcon>
      ))}
    </StarsRow>
  );
}

/* ──────────────────────────────────────────────
   MAIN COMPONENT
────────────────────────────────────────────── */
const SmartCheck = () => {
  // Search
  const [query, setQuery]           = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeIdx, setActiveIdx]   = useState(-1);
  const [focused, setFocused]       = useState(false);
  const [shakeInput, setShakeInput] = useState(false);
  const inputRef = useRef(null);
  const dropRef  = useRef(null);

  // Phases: 'search' | 'scanning' | 'result' | 'sent'
  const [phase, setPhase]         = useState('search');
  const [selected, setSelected]   = useState(null);
  const [scanStep, setScanStep]   = useState(0);
  const [result, setResult]       = useState(null);

  // Lead form
  const [email, setEmail]         = useState('');
  const [emailError, setEmailError] = useState('');
  const [sending, setSending]     = useState(false);

  /* ── Autocomplete filter ── */
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      return;
    }
    const q = query.toLowerCase();
    const filtered = MOCK_SUGGESTIONS.filter(
      s => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q)
    );
    setSuggestions(filtered.slice(0, 6));
    setActiveIdx(-1);
  }, [query]);

  /* ── Close dropdown on outside click ── */
  useEffect(() => {
    const handler = (e) => {
      if (!dropRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── Run scan animation ── */
  const runScan = useCallback((item) => {
    setPhase('scanning');
    setScanStep(0);

    let accumulated = 0;
    SCAN_STEPS.forEach((step, i) => {
      accumulated += step.ms;
      setTimeout(() => setScanStep(i + 1), accumulated);
    });

    setTimeout(() => {
      setResult(getMockResult(item.name, item.city));
      setPhase('result');
    }, accumulated + 200);
  }, []);

  /* ── Select from dropdown ── */
  const handleSelect = (item) => {
    setQuery(item.name);
    setSelected(item);
    setSuggestions([]);
    runScan(item);
  };

  /* ── Manual submit (enter / button) ── */
  const handleSearchSubmit = () => {
    if (!query.trim()) {
      setShakeInput(true);
      setTimeout(() => setShakeInput(false), 500);
      return;
    }
    // If there's a match, use it; otherwise create custom entry
    const match = MOCK_SUGGESTIONS.find(
      s => s.name.toLowerCase() === query.toLowerCase()
    ) || { name: query, city: 'deiner Region' };
    setSelected(match);
    setSuggestions([]);
    runScan(match);
  };

  /* ── Keyboard navigation ── */
  const handleKeyDown = (e) => {
    if (!suggestions.length) {
      if (e.key === 'Enter') handleSearchSubmit();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0) handleSelect(suggestions[activeIdx]);
      else handleSearchSubmit();
    } else if (e.key === 'Escape') {
      setSuggestions([]);
    }
  };

  /* ── Email validation & submit ── */
  const handleEmailSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setEmailError('');
    setSending(true);

    try {
      await supabase.from('leads').insert([{
        company_name:   selected?.name || query,
        contact_person: '-',
        phone:          '-',
        city:           selected?.city || '',
        email,
        source:         'smart_check',
      }]);
    } catch (err) {
      console.error('Supabase error:', err);
    }

    setSending(false);
    setPhase('sent');
  };

  /* ── Reset ── */
  const handleReset = () => {
    setPhase('search');
    setQuery('');
    setSelected(null);
    setResult(null);
    setEmail('');
    setEmailError('');
    setScanStep(0);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  /* ─────────────────────────────────── RENDER ── */
  return (
    <Section id="check">
      <GridBg />
      <SectionInner>
        <SectionEyebrow>Kostenloser Sofort-Check</SectionEyebrow>
        <SectionTitle>
          Wie sichtbar bist du<br />
          <TitleAccent>gerade wirklich?</TitleAccent>
        </SectionTitle>
        <SectionSubline>
          Firmenname eingeben — in 3 Sekunden siehst du, was dir gerade entgeht.
        </SectionSubline>

        <Card>
          <CardInner>

            {/* ── PHASE: SEARCH ── */}
            {(phase === 'search' || phase === 'scanning') && (
              <>
                <StepLabel>
                  <StepNum>1</StepNum>
                  <StepText>Betrieb suchen</StepText>
                </StepLabel>

                <SearchWrapper ref={dropRef}>
                  <SearchIcon $active={focused || !!query}>
                    <Search size={18} />
                  </SearchIcon>

                  <SearchInput
                    ref={inputRef}
                    type="text"
                    placeholder="z.B. Sanitär Müller Hamburg"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={handleKeyDown}
                    $focused={focused}
                    $shake={shakeInput}
                    disabled={phase === 'scanning'}
                    autoComplete="off"
                  />

                  {query && phase === 'search' && (
                    <ClearBtn onClick={() => { setQuery(''); setSuggestions([]); inputRef.current?.focus(); }}>
                      <X size={16} />
                    </ClearBtn>
                  )}

                  {suggestions.length > 0 && phase === 'search' && (
                    <Dropdown>
                      {suggestions.map((s, i) => (
                        <DropdownItem
                          key={i}
                          data-active={i === activeIdx}
                          onMouseDown={() => handleSelect(s)}
                        >
                          <DropdownIcon><MapPin size={14} /></DropdownIcon>
                          <DropdownName>{s.name}</DropdownName>
                          <DropdownCity>{s.city}</DropdownCity>
                        </DropdownItem>
                      ))}
                      <DropdownNote>Nicht dabei? Einfach Enter drücken.</DropdownNote>
                    </Dropdown>
                  )}
                </SearchWrapper>
              </>
            )}

            {/* ── PHASE: SCANNING ── */}
            {phase === 'scanning' && (
              <LoadingWrap style={{ marginTop: 24 }}>
                <LoadingHeader>
                  <SpinnerIcon><Loader size={20} /></SpinnerIcon>
                  <LoadingTitle>Analyse läuft…</LoadingTitle>
                </LoadingHeader>

                <ProgressTrack>
                  <ProgressFill $duration={`${SCAN_STEPS.reduce((a, s) => a + s.ms, 0) / 1000}s`} />
                </ProgressTrack>

                <LoadingSteps>
                  {SCAN_STEPS.map((step, i) => {
                    const done = i < scanStep - 1 ? true : i === scanStep - 1 ? true : undefined;
                    const active = i === scanStep - 1 && phase === 'scanning';
                    return (
                      <LoadingStep key={i} $done={i < scanStep}>
                        <StepDot $done={i < scanStep} $active={active && i === scanStep - 1} />
                        {getStepLabel(step, selected?.city || 'deiner Region')}
                        {i < scanStep && <CheckCircle size={13} style={{ marginLeft: 4, color: '#1E7E34' }} />}
                      </LoadingStep>
                    );
                  })}
                </LoadingSteps>
              </LoadingWrap>
            )}

            {/* ── PHASE: RESULT ── */}
            {(phase === 'result' || phase === 'sent') && result && (
              <ResultWrap>
                {/* Header */}
                <ResultHeader>
                  <ResultCompany>
                    <CompanyName>{result.name}</CompanyName>
                    <CompanyCity>
                      <MapPin size={12} /> {result.city}
                    </CompanyCity>
                  </ResultCompany>

                  <ScoreBadge $score={result.profileScore}>
                    <ScoreNum $score={result.profileScore}>{result.profileScore}</ScoreNum>
                    <ScoreLabel>/ 100 Score</ScoreLabel>
                  </ScoreBadge>
                </ResultHeader>

                {/* Metrics */}
                <MetricsRow>
                  <MetricCell>
                    <StarRating value={result.stars} />
                    <MetricValue>{result.stars.toFixed(1)}</MetricValue>
                    <MetricLabel>Ø Bewertung</MetricLabel>
                  </MetricCell>
                  <MetricCell>
                    <MetricValue>{result.reviewCount}</MetricValue>
                    <MetricLabel>Rezensionen</MetricLabel>
                  </MetricCell>
                  <MetricCell>
                    <MetricValue style={{ color: '#D93025' }}>{result.unanswered}</MetricValue>
                    <MetricLabel>Ohne Antwort</MetricLabel>
                  </MetricCell>
                </MetricsRow>

                {/* Alerts */}
                <AlertList>
                  <AlertItem $type="error">
                    <AlertIcon $type="error"><AlertTriangle size={16} /></AlertIcon>
                    <AlertText>
                      <AlertTitle>
                        Achtung: {result.unanswered} Rezensionen ohne Antwort gefunden.
                      </AlertTitle>
                      <AlertSub>
                        Potenzielle Kunden sehen das. Jede unbeantwortete Bewertung kostet dich Vertrauen.
                      </AlertSub>
                    </AlertText>
                  </AlertItem>

                  <AlertItem $type="error">
                    <AlertIcon $type="error"><Search size={16} /></AlertIcon>
                    <AlertText>
                      <AlertTitle>
                        {result.missingKeywords} wichtige Keywords fehlen in deinem Profil.
                      </AlertTitle>
                      <AlertSub>
                        Google weiß nicht, für welche Anfragen es dich zeigen soll.
                      </AlertSub>
                    </AlertText>
                  </AlertItem>

                  {/* Blurred teaser for the rest */}
                  <TeaserOverlay>
                    <BlurredSection>
                      <AlertItem $type="warn">
                        <AlertIcon $type="warn"><Clock size={16} /></AlertIcon>
                        <AlertText>
                          <AlertTitle>Öffnungszeiten stimmen nicht mit Google überein.</AlertTitle>
                          <AlertSub>Das kostet dich direkt Anrufe an Wochenenden.</AlertSub>
                        </AlertText>
                      </AlertItem>
                      <AlertItem $type="warn" style={{ marginTop: 8 }}>
                        <AlertIcon $type="warn"><MessageSquare size={16} /></AlertIcon>
                        <AlertText>
                          <AlertTitle>Wettbewerber-Analyse: 3 stärkere Profile im Umkreis.</AlertTitle>
                          <AlertSub>Geschätzter Umsatzverlust: ~{result.monthlyLoss} EUR / Monat.</AlertSub>
                        </AlertText>
                      </AlertItem>
                    </BlurredSection>
                    {phase !== 'sent' && (
                      <OverlayLock>
                        <LockBadge>
                          <ChevronRight size={14} />
                          Im kostenlosen PDF-Report enthalten
                        </LockBadge>
                      </OverlayLock>
                    )}
                  </TeaserOverlay>
                </AlertList>

                {/* ── Lead Form ── */}
                {phase === 'result' && (
                  <>
                    <LeadDivider />
                    <LeadTitle>Dein vollständiger 4-seitiger Report</LeadTitle>
                    <LeadSub>
                      Wohin sollen wir deinen detaillierten Sichtbarkeits-Report (PDF) schicken?
                      Inkl. Wettbewerber-Analyse, Umsatzpotenzial und konkreten Handlungsempfehlungen.
                    </LeadSub>

                    <EmailRow>
                      <EmailInput
                        type="email"
                        placeholder="deine@email.de"
                        value={email}
                        onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                        onKeyDown={e => e.key === 'Enter' && handleEmailSubmit()}
                        $error={!!emailError}
                      />
                      <SubmitBtn onClick={handleEmailSubmit} disabled={sending}>
                        {sending ? (
                          <><Loader size={16} className="spin" /> Wird gesendet…</>
                        ) : (
                          <>Kostenlosen Report anfordern <ChevronRight size={16} /></>
                        )}
                      </SubmitBtn>
                    </EmailRow>
                    {emailError && <FormError>{emailError}</FormError>}
                  </>
                )}

                {/* ── Success ── */}
                {phase === 'sent' && (
                  <>
                    <LeadDivider />
                    <SuccessBox>
                      <CheckCircle size={28} color="#1E7E34" />
                      <SuccessText>
                        <strong>Report wird vorbereitet!</strong>
                        Wir schicken deinen persönlichen Sichtbarkeits-Report innerhalb von
                        48 Stunden an {email}. Schau auch im Spam-Ordner nach.
                      </SuccessText>
                    </SuccessBox>
                  </>
                )}

                {/* Reset link */}
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  <button
                    onClick={handleReset}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'Barlow, sans-serif', fontSize: '0.8rem',
                      color: '#5A6A7A', textDecoration: 'underline',
                      textUnderlineOffset: '2px'
                    }}
                  >
                    Anderen Betrieb prüfen
                  </button>
                </div>
              </ResultWrap>
            )}

          </CardInner>
        </Card>

        {/* Trust strip */}
        <TrustStrip>
          <TrustItem><CheckCircle size={12} /> Kostenlos & unverbindlich</TrustItem>
          <TrustItem><CheckCircle size={12} /> Kein Spam, versprochen</TrustItem>
          <TrustItem><CheckCircle size={12} /> Report in 48h</TrustItem>
        </TrustStrip>
      </SectionInner>
    </Section>
  );
};

export default SmartCheck;
