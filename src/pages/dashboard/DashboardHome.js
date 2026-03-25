import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import GooglePlacesAutocomplete from 'react-google-places-autocomplete';
import {
  AlertTriangle, CheckCircle, Link2, TrendingUp,
  Star, ArrowRight, Search, Loader, MapPin,
  Globe, X, Zap, Clock, PlusCircle, ChevronDown,
  Ghost, TrendingDown
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import {
  fetchPlaceDetails, extractCity, calcScore,
  scoreColor, scoreBg, scoreLabel, saveManualLead
} from '../../hooks/usePlacesAnalysis';
import supabase from '../../supabaseClient';

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp  = keyframes`from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const spin    = keyframes`to{transform:rotate(360deg)}`;
const pulse   = keyframes`0%,100%{opacity:1}50%{opacity:.4}`;
const scaleIn = keyframes`from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}`;
const slideDown = keyframes`from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}`;

/* ─────────────────────────────────────────────
   METRIC CARDS
───────────────────────────────────────────── */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 14px; margin-bottom: 22px;
`;

const MetricCard = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 18px 20px;
  animation: ${fadeUp} .45s ease ${({ $d }) => $d || '0s'} both;
`;

const MetricLabel = styled.p`
  font-family: var(--font-body); font-size: .7rem;
  text-transform: uppercase; letter-spacing: .1em;
  color: var(--color-text-muted); margin-bottom: 8px;
`;

const MetricValue = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.9rem; line-height: 1;
  color: ${({ $c }) => $c || 'var(--color-primary)'};
`;

const MetricSub = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: var(--color-text-muted); margin-top: 4px;
`;

/* ─────────────────────────────────────────────
   SCORE BANNER
───────────────────────────────────────────── */
const ScoreBanner = styled.div`
  background: ${({ $s }) => scoreBg($s)};
  border: 1px solid ${({ $s }) => scoreColor($s)}44;
  border-left: 4px solid ${({ $s }) => scoreColor($s)};
  border-radius: var(--radius-card);
  padding: 14px 18px;
  display: flex; align-items: center;
  justify-content: space-between; gap: 16px; flex-wrap: wrap;
  margin-bottom: 22px;
  animation: ${fadeUp} .4s ease both;
`;

const ScoreLeft = styled.div`display:flex;align-items:center;gap:12px;`;
const ScoreCircle = styled.div`
  width: 48px; height: 48px; border-radius: 50%;
  background: ${({ $s }) => scoreColor($s)};
  color: white; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 900;
  font-size: 1rem; flex-shrink: 0;
`;
const ScoreTitle = styled.p`font-family:var(--font-body);font-weight:700;font-size:.9rem;color:#1A1A1A;`;
const ScoreSub   = styled.p`font-family:var(--font-body);font-size:.77rem;color:var(--color-text-muted);line-height:1.4;`;
const OptBtn = styled(Link)`
  display:inline-flex;align-items:center;gap:6px;padding:8px 16px;
  background:var(--color-accent);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.82rem;letter-spacing:.06em;text-transform:var(--text-transform);
  text-decoration:none;border-radius:var(--radius-button);
  white-space:nowrap;flex-shrink:0;transition:filter .2s;
  &:hover{filter:brightness(.9);}
`;

/* ─────────────────────────────────────────────
   SECTION CARD
───────────────────────────────────────────── */
const SCard = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 22px;
  margin-bottom: 18px;
  animation: ${fadeUp} .45s ease ${({ $d }) => $d || '0s'} both;
`;

const SCardTitle = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.15rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

const SCardSub = styled.p`
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted); margin-bottom: 18px; line-height: 1.5;
`;

const StepBadge = styled.span`
  display: inline-block;
  background: var(--color-accent); color: white;
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-button); margin-bottom: 10px;
`;

/* ─────────────────────────────────────────────
   LINKED BUSINESS STATE
───────────────────────────────────────────── */
const LinkedCard = styled.div`
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 16px 18px;
  background: #E8F5E9;
  border: 1px solid #A5D6A7;
  border-left: 4px solid #1E7E34;
  border-radius: var(--radius-card);
  animation: ${fadeIn} .4s ease both;
`;

const LinkedIcon = styled.div`
  width: 44px; height: 44px; border-radius: 50%;
  background: #1E7E34; color: white;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
`;

const LinkedInfo = styled.div`flex:1;min-width:0;`;
const LinkedName = styled.p`font-family:var(--font-body);font-weight:700;font-size:.95rem;color:#1A1A1A;`;
const LinkedMeta = styled.p`
  font-family: var(--font-body); font-size: .78rem; color: #5A6A7A;
  margin-top: 2px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
`;
const MetaChip = styled.span`display:inline-flex;align-items:center;gap:3px;svg{color:var(--color-accent);}`;
const ResetBtn = styled.button`
  background:none;border:none;cursor:pointer;
  font-family:var(--font-body);font-size:.78rem;
  color:#5A6A7A;text-decoration:underline;text-underline-offset:2px;flex-shrink:0;
  &:hover{color:#D93025;}
`;

/* ─────────────────────────────────────────────
   AUTOCOMPLETE
───────────────────────────────────────────── */
const AcOuter = styled.div`position:relative;`;
const AcSearchIcon = styled.div`
  position:absolute;left:12px;top:50%;transform:translateY(-50%);
  color:var(--color-accent);display:flex;align-items:center;z-index:5;pointer-events:none;
`;
const AcWrap = styled.div`
  & > div > div {
    border-radius:var(--radius-card) !important;
    border:2px solid var(--color-border) !important;
    box-shadow:none !important;font-family:var(--font-body) !important;
    font-size:.95rem !important;min-height:48px !important;
    background:var(--color-bg) !important;padding-left:40px !important;
    transition:border-color .2s !important;
  }
  & > div > div:focus-within{border-color:var(--color-primary) !important;background:var(--color-white) !important;}
  & input{font-family:var(--font-body) !important;color:var(--color-text) !important;font-size:.95rem !important;}
  & [class*="placeholder"]{color:#A0ADB8 !important;font-size:.92rem !important;}
  & [class*="menu"]{
    border-radius:var(--radius-card) !important;border:2px solid var(--color-primary) !important;
    border-top:none !important;box-shadow:0 8px 24px rgba(var(--color-primary-rgb),.12) !important;z-index:100 !important;
  }
  & [class*="option"]{font-family:var(--font-body) !important;font-size:.88rem !important;color:var(--color-primary) !important;padding:10px 14px !important;}
  & [class*="option"]:hover{background:rgba(var(--color-primary-rgb),.05) !important;}
  & [class*="indicatorSeparator"]{display:none !important;}
  & [class*="loadingIndicator"]{color:var(--color-accent) !important;}
`;

const SaveBtn = styled.button`
  display:inline-flex;align-items:center;gap:7px;padding:10px 22px;margin-top:12px;
  background:var(--color-primary);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.88rem;letter-spacing:.06em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);cursor:pointer;
  transition:filter .2s;
  &:hover:not(:disabled){filter:brightness(1.15);}
  &:disabled{opacity:.5;cursor:not-allowed;}
  .spin{animation:${spin} .8s linear infinite;}
`;

/* ─────────────────────────────────────────────
   FALLBACK TRIGGER
───────────────────────────────────────────── */
const FallbackTrigger = styled.button`
  display: flex; align-items: center; gap: 7px;
  margin-top: 14px; background: none; border: none;
  cursor: pointer; padding: 0;
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted);
  text-decoration: underline; text-underline-offset: 3px;
  transition: color .2s;
  &:hover { color: var(--color-accent); }
`;

/* ─────────────────────────────────────────────
   MANUAL FORM
───────────────────────────────────────────── */
const ManualForm = styled.div`
  margin-top: 18px;
  border-top: 1px solid var(--color-border);
  padding-top: 18px;
  animation: ${slideDown} .3s ease both;
`;

const ManualTitle = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .85rem; color: var(--color-primary); margin-bottom: 12px;
`;

const FormGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  @media(max-width:560px){grid-template-columns:1fr;}
`;

const Field = styled.div`display:flex;flex-direction:column;gap:5px;`;

const Label = styled.label`
  font-family: var(--font-body); font-weight: 600;
  font-size: .72rem; letter-spacing: .08em; text-transform: uppercase;
  color: var(--color-primary);
`;

const Input = styled.input`
  padding: 10px 13px;
  border: 2px solid ${({ $err }) => $err ? '#E53E3E' : 'var(--color-border)'};
  background: var(--color-bg); color: var(--color-text);
  font-family: var(--font-body); font-size: .92rem;
  outline: none; border-radius: var(--radius-card);
  transition: border-color .2s;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
  &::placeholder { color: #A0ADB8; }
`;

const Select = styled.select`
  padding: 10px 13px;
  border: 2px solid var(--color-border);
  background: var(--color-bg); color: var(--color-text);
  font-family: var(--font-body); font-size: .92rem;
  outline: none; border-radius: var(--radius-card);
  cursor: pointer; transition: border-color .2s;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
`;

const ErrText = styled.span`
  font-family: var(--font-body); font-size: .72rem; color: #E53E3E;
`;

const ManualSubmitBtn = styled.button`
  display: flex; align-items: center; gap: 7px;
  padding: 10px 22px; margin-top: 14px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .88rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover:not(:disabled) { filter: brightness(.9); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const ManualSuccessBox = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 16px; background: #E8F5E9;
  border-left: 3px solid #1E7E34; border-radius: var(--radius-card);
  margin-top: 14px; animation: ${fadeIn} .3s ease both;
`;

const ManualSuccessText = styled.p`
  font-family: var(--font-body); font-size: .85rem; color: #1A1A1A; line-height: 1.5;
  strong { font-weight: 700; }
`;

/* ─────────────────────────────────────────────
   GHOST TOWN STATE (score = 0, manual entry)
───────────────────────────────────────────── */
const GhostCard = styled.div`
  background: var(--color-primary);
  border-radius: var(--radius-card);
  padding: 32px 28px;
  margin-bottom: 18px;
  animation: ${fadeUp} .5s ease both;
  position: relative; overflow: hidden;
`;

const GhostGrid = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb),.04) 1px, transparent 1px);
  background-size: 36px 36px;
`;

const GhostBadge = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(231,76,60,.15); border: 1px solid rgba(231,76,60,.35);
  color: #ff8080; font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-button); margin-bottom: 14px;
`;

const GhostTitle = styled.h2`
  font-size: clamp(1.4rem, 3vw, 1.9rem);
  text-transform: var(--text-transform);
  color: var(--color-white); line-height: 1.1; margin-bottom: 12px;
`;

const GhostAccent = styled.span`color: var(--color-accent);`;

const GhostText = styled.p`
  font-family: var(--font-body); font-size: .9rem;
  color: rgba(255,255,255,.65); line-height: 1.65; margin-bottom: 24px;
  max-width: 520px;
`;

const GhostScore = styled.div`
  display: inline-flex; align-items: baseline; gap: 6px;
  margin-bottom: 20px;
`;

const GhostScoreNum = styled.span`
  font-family: var(--font-display); font-weight: 900;
  font-size: 3.5rem; color: #ff6b6b; line-height: 1;
`;

const GhostScoreLabel = styled.span`
  font-family: var(--font-body); font-size: .88rem;
  color: rgba(255,255,255,.45);
`;

const GhostCTA = styled(Link)`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 26px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: .07em; text-transform: var(--text-transform);
  text-decoration: none; border-radius: var(--radius-button);
  box-shadow: 0 4px 16px rgba(var(--color-accent-rgb),.4);
  transition: filter .2s, transform .1s;
  &:hover { filter: brightness(.9); transform: translateY(-1px); }
`;

const GhostSteps = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; margin-bottom: 24px;
  @media(max-width:600px){grid-template-columns:1fr;}
`;

const GhostStep = styled.div`
  background: rgba(255,255,255,.06);
  border-radius: var(--radius-card);
  padding: 14px 16px;
`;

const GhostStepNum = styled.div`
  font-family: var(--font-display); font-weight: 900;
  font-size: 1.4rem; color: var(--color-accent); margin-bottom: 4px;
`;

const GhostStepText = styled.p`
  font-family: var(--font-body); font-size: .8rem;
  color: rgba(255,255,255,.6); line-height: 1.45;
`;

/* ─────────────────────────────────────────────
   GMB CARD
───────────────────────────────────────────── */
const GMBCard = styled(SCard)`background:var(--color-primary);border:none;`;
const GMBBadge = styled.div`
  display:inline-flex;align-items:center;gap:6px;
  background:rgba(var(--color-accent-rgb),.15);border:1px solid rgba(var(--color-accent-rgb),.3);
  color:var(--color-accent);font-family:var(--font-body);font-weight:700;
  font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;
  padding:3px 10px;border-radius:var(--radius-button);margin-bottom:10px;
`;
const PulseDot = styled.span`
  width:6px;height:6px;background:var(--color-accent);border-radius:50%;display:inline-block;
  animation:${pulse} 1.5s ease infinite;
`;
const GMBTitle = styled.h3`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.1rem;text-transform:var(--text-transform);color:var(--color-white);margin-bottom:6px;
`;
const GMBSub = styled.p`
  font-family:var(--font-body);font-size:.83rem;
  color:rgba(255,255,255,.6);margin-bottom:18px;line-height:1.55;
`;
const GMBBtn = styled.button`
  display:inline-flex;align-items:center;gap:8px;padding:11px 22px;
  background:var(--color-accent);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.92rem;letter-spacing:.07em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);cursor:pointer;
  box-shadow:0 4px 16px rgba(var(--color-accent-rgb),.4);
  transition:filter .2s,transform .1s;
  &:hover{filter:brightness(.9);transform:translateY(-1px);}
`;

/* Modal */
const ModalOverlay = styled.div`
  position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);
  display:flex;align-items:center;justify-content:center;padding:24px;
  animation:${fadeIn} .2s ease both;
`;
const Modal = styled.div`
  background:var(--color-white);border-radius:var(--radius-card);
  border-top:5px solid var(--color-accent);padding:36px 32px;
  max-width:480px;width:100%;position:relative;
  animation:${scaleIn} .25s ease both;
`;
const ModalClose = styled.button`
  position:absolute;top:14px;right:14px;background:none;border:none;
  cursor:pointer;color:var(--color-text-muted);padding:4px;
  border-radius:var(--radius-button);
  &:hover{background:var(--color-bg);}
`;
const ModalIcon = styled.div`
  width:56px;height:56px;border-radius:50%;
  background:rgba(var(--color-accent-rgb),.1);
  display:flex;align-items:center;justify-content:center;
  color:var(--color-accent);margin-bottom:18px;
`;
const ModalTitle = styled.h3`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.3rem;text-transform:var(--text-transform);
  color:var(--color-primary);margin-bottom:10px;
`;
const ModalText = styled.p`
  font-family:var(--font-body);font-size:.88rem;
  color:var(--color-text-muted);line-height:1.65;margin-bottom:20px;
`;
const ModalFeatures = styled.ul`list-style:none;display:flex;flex-direction:column;gap:8px;margin-bottom:24px;`;
const ModalFeature = styled.li`
  display:flex;align-items:center;gap:10px;
  font-family:var(--font-body);font-size:.85rem;color:#1A1A1A;
  svg{color:var(--color-accent);flex-shrink:0;}
`;
const ModalCTA = styled.button`
  width:100%;padding:13px;background:var(--color-accent);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1rem;letter-spacing:.07em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);cursor:pointer;
  transition:filter .2s;&:hover{filter:brightness(.9);}
`;
const ModalNote = styled.p`
  font-family:var(--font-body);font-size:.72rem;
  color:#A0ADB8;text-align:center;margin-top:10px;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardHome() {
  const { profile, user, refreshProfile } = useAuthContext();
  const { brand, pricing, places, key: industryKey } = useIndustry();

  // Search state
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [resetting,     setResetting]     = useState(false);

  // Fallback form state
  const [showManual,    setShowManual]    = useState(false);
  const [manualName,    setManualName]    = useState('');
  const [manualTrade,   setManualTrade]   = useState('');
  const [manualEmail,   setManualEmail]   = useState(user?.email || '');
  const [manualErrors,  setManualErrors]  = useState({});
  const [manualSaving,  setManualSaving]  = useState(false);
  const [manualDone,    setManualDone]    = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);

  const apiKey      = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;
  const hasBusiness = !!profile?.google_place_id;
  const isGhost     = profile?.visibility_score === 0 && !profile?.google_place_id && profile?.company_name;
  const score       = profile?.visibility_score ?? null;

  /* ── Save from Places ── */
  const handleSave = async () => {
    if (!selectedPlace) return;
    setSaving(true);
    try {
      const pd   = await fetchPlaceDetails(selectedPlace.value.place_id);
      const city = extractCity(pd.address_components);
      const calc = calcScore({
        rating:      pd.rating || 0,
        reviewCount: pd.user_ratings_total || 0,
        hasWebsite:  !!pd.website,
      });
      const { data: { user: cu } } = await supabase.auth.getUser();
      await supabase.from('user_profiles').update({
        google_place_id:     pd.place_id,
        company_name:        pd.name,
        city,
        google_rating:       pd.rating            || null,
        google_review_count: pd.user_ratings_total || null,
        visibility_score:    calc,
      }).eq('id', cu.id);
      await refreshProfile();
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  /* ── Reset ── */
  const handleReset = async () => {
    setResetting(true);
    const { data: { user: cu } } = await supabase.auth.getUser();
    await supabase.from('user_profiles').update({
      google_place_id: null, company_name: null,
      google_rating: null, google_review_count: null, visibility_score: null,
    }).eq('id', cu.id);
    setSelectedPlace(null);
    await refreshProfile();
    setResetting(false);
  };

  /* ── Manual form submit ── */
  const handleManualSubmit = async () => {
    const errors = {};
    if (!manualName.trim()) errors.name = 'Pflichtfeld';
    if (!manualTrade)       errors.trade = 'Bitte wählen';
    if (Object.keys(errors).length) { setManualErrors(errors); return; }
    setManualErrors({});
    setManualSaving(true);

    try {
      const { data: { user: cu } } = await supabase.auth.getUser();
      await saveManualLead({
        companyName: manualName.trim(),
        trade:       manualTrade,
        email:       manualEmail || user?.email,
        industryKey,
        userId:      cu?.id,
      });
      await refreshProfile();
      setManualDone(true);
    } catch (err) { console.error(err); }
    setManualSaving(false);
  };

  /* ─────── RENDER ─────── */
  return (
    <>
      {/* GMB Modal */}
      {showModal && (
        <ModalOverlay onClick={() => setShowModal(false)}>
          <Modal onClick={e => e.stopPropagation()}>
            <ModalClose onClick={() => setShowModal(false)}><X size={18} /></ModalClose>
            <ModalIcon><Link2 size={26} /></ModalIcon>
            <ModalTitle>In Kürze verfügbar</ModalTitle>
            <ModalText>
              Die vollautomatische Verbindung mit deinem Google Business Profil
              wird in der nächsten Phase aktiviert. Dann kann {brand.name} direkt
              in deinem Namen optimieren.
            </ModalText>
            <ModalFeatures>
              <ModalFeature><Zap size={15} />Profil-Updates vollautomatisch</ModalFeature>
              <ModalFeature><Star size={15} />Bewertungsanfragen nach Auftrag</ModalFeature>
              <ModalFeature><TrendingUp size={15} />Keyword-Optimierung in Echtzeit</ModalFeature>
              <ModalFeature><Clock size={15} />Öffnungszeiten immer aktuell</ModalFeature>
            </ModalFeatures>
            <ModalCTA onClick={() => setShowModal(false)}>
              Verstanden — ich warte auf Phase 2
            </ModalCTA>
            <ModalNote>Wir benachrichtigen dich per E-Mail sobald es losgeht.</ModalNote>
          </Modal>
        </ModalOverlay>
      )}

      {/* ── GHOST TOWN STATE ── */}
      {isGhost && (
        <GhostCard>
          <GhostGrid />
          <GhostBadge>
            <Ghost size={12} /> Digitale Geisterstadt
          </GhostBadge>

          <GhostScore>
            <GhostScoreNum>0</GhostScoreNum>
            <GhostScoreLabel>/ 100 Sichtbarkeits-Score</GhostScoreLabel>
          </GhostScore>

          <GhostTitle>
            Digitale Geisterstadt?<br />
            <GhostAccent>Wir holen dich auf die Karte.</GhostAccent>
          </GhostTitle>

          <GhostText>
            Da dein Betrieb bei Google nicht existiert, ist dein digitales
            Umsatzpotenzial aktuell bei <strong style={{ color: '#ff8080' }}>0 €</strong>.
            Jeder Kunde, der online nach dir sucht, findet stattdessen deine Konkurrenz.
            Wir ändern das — in 3 Schritten.
          </GhostText>

          <GhostSteps>
            <GhostStep>
              <GhostStepNum>01</GhostStepNum>
              <GhostStepText>Google Business Profil anlegen — kostenlos, dauert 10 Min.</GhostStepText>
            </GhostStep>
            <GhostStep>
              <GhostStepNum>02</GhostStepNum>
              <GhostStepText>Profil verifizieren lassen — per Postkarte oder Telefon.</GhostStepText>
            </GhostStep>
            <GhostStep>
              <GhostStepNum>03</GhostStepNum>
              <GhostStepText>{brand.name} übernimmt die komplette Optimierung für dich.</GhostStepText>
            </GhostStep>
          </GhostSteps>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <GhostCTA
              to="https://business.google.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Jetzt Google-Profil anlegen <ArrowRight size={16} />
            </GhostCTA>
          </div>

          <p style={{
            fontFamily: 'var(--font-body)', fontSize: '.72rem',
            color: 'rgba(255,255,255,.3)', marginTop: 14,
          }}>
            Unser Team wurde benachrichtigt — wir melden uns in 48h bei dir.
          </p>
        </GhostCard>
      )}

      {/* ── SCORE BANNER (normal state) ── */}
      {hasBusiness && score !== null && !isGhost && (
        <ScoreBanner $s={score}>
          <ScoreLeft>
            <ScoreCircle $s={score}>{score}</ScoreCircle>
            <div>
              <ScoreTitle>
                Dein Profil ist <strong>{scoreLabel(score)}</strong>.
              </ScoreTitle>
              <ScoreSub>
                {profile?.company_name} · Jetzt optimieren und mehr Anfragen bekommen.
              </ScoreSub>
            </div>
          </ScoreLeft>
          <OptBtn to="/dashboard/einstellungen">
            Jetzt optimieren <ArrowRight size={13} />
          </OptBtn>
        </ScoreBanner>
      )}

      {/* ── METRICS ── */}
      {hasBusiness && !isGhost && (
        <Grid>
          <MetricCard $d="0s">
            <MetricLabel>Sichtbarkeits-Score</MetricLabel>
            <MetricValue $c={score !== null ? scoreColor(score) : undefined}>
              {score ?? '—'}<span style={{ fontSize: '1rem', opacity: .4 }}>/100</span>
            </MetricValue>
            <MetricSub>{score !== null ? scoreLabel(score) : 'Nicht berechnet'}</MetricSub>
          </MetricCard>
          <MetricCard $d=".05s">
            <MetricLabel>Ø Bewertung</MetricLabel>
            <MetricValue>{profile?.google_rating?.toFixed(1) ?? '—'}</MetricValue>
            <MetricSub>bei Google</MetricSub>
          </MetricCard>
          <MetricCard $d=".1s">
            <MetricLabel>Rezensionen</MetricLabel>
            <MetricValue>{profile?.google_review_count?.toLocaleString('de-DE') ?? '—'}</MetricValue>
            <MetricSub>gesamt</MetricSub>
          </MetricCard>
          <MetricCard $d=".15s">
            <MetricLabel>Monatl. Potenzial</MetricLabel>
            <MetricValue $c="var(--color-accent)">
              +{(pricing.roi.avgOrderValue * 5).toLocaleString('de-DE')}€
            </MetricValue>
            <MetricSub>bei optimiertem Profil</MetricSub>
          </MetricCard>
        </Grid>
      )}

      {/* ── ONBOARDING / BUSINESS CARD ── */}
      {!isGhost && (
        <SCard $d={hasBusiness ? '.2s' : '0s'}
          style={!hasBusiness ? { borderTop: '4px solid var(--color-accent)' } : {}}>

          {!hasBusiness ? (
            <>
              <StepBadge>Schritt 1 von 1</StepBadge>
              <SCardTitle>Welches ist dein Betrieb?</SCardTitle>
              <SCardSub>
                Verknüpfe deinen Google Business-Eintrag — dann analysieren wir
                deinen Stand und zeigen dir, was du verbessern kannst.
              </SCardSub>

              <AcOuter>
                <AcSearchIcon><Search size={15} /></AcSearchIcon>
                <AcWrap>
                  {apiKey ? (
                    <GooglePlacesAutocomplete
                      apiKey={apiKey}
                      apiOptions={{ language: 'de', region: 'de' }}
                      selectProps={{
                        value: selectedPlace,
                        onChange: setSelectedPlace,
                        placeholder: places.searchPlaceholder,
                        noOptionsMessage: () => 'Kein Treffer — versuch es genauer.',
                        loadingMessage: () => 'Suche…',
                        isClearable: true,
                      }}
                      autocompletionRequest={{
                        componentRestrictions: places.componentRestrictions,
                        types: [places.primaryType],
                      }}
                    />
                  ) : (
                    <p style={{ padding: '12px', color: '#D93025',
                      fontFamily: 'var(--font-body)', fontSize: '.85rem' }}>
                      ⚠ REACT_APP_GOOGLE_PLACES_API_KEY fehlt
                    </p>
                  )}
                </AcWrap>
              </AcOuter>

              <SaveBtn onClick={handleSave} disabled={!selectedPlace || saving}>
                {saving
                  ? <><Loader size={14} className="spin" />Wird gespeichert…</>
                  : <>Betrieb speichern <ArrowRight size={14} /></>
                }
              </SaveBtn>

              {/* ── FALLBACK TRIGGER ── */}
              <FallbackTrigger onClick={() => setShowManual(!showManual)}>
                <PlusCircle size={14} />
                Betrieb nicht gefunden? Hier manuell eintragen.
                <ChevronDown
                  size={13}
                  style={{
                    transform: showManual ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform .2s',
                  }}
                />
              </FallbackTrigger>

              {/* ── MANUAL FORM ── */}
              {showManual && !manualDone && (
                <ManualForm>
                  <ManualTitle>Manuelle Einrichtung</ManualTitle>
                  <FormGrid>
                    <Field>
                      <Label>Firmenname *</Label>
                      <Input
                        type="text"
                        placeholder="Sanitär Müller GmbH"
                        value={manualName}
                        onChange={e => { setManualName(e.target.value); setManualErrors(p => ({...p, name: ''})); }}
                        $err={!!manualErrors.name}
                      />
                      {manualErrors.name && <ErrText>{manualErrors.name}</ErrText>}
                    </Field>

                    <Field>
                      <Label>Branche *</Label>
                      <Select
                        value={manualTrade}
                        onChange={e => { setManualTrade(e.target.value); setManualErrors(p => ({...p, trade: ''})); }}
                        style={{ borderColor: manualErrors.trade ? '#E53E3E' : undefined }}
                      >
                        <option value="">Bitte wählen</option>
                        {(places.tradeOptions || []).map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </Select>
                      {manualErrors.trade && <ErrText>{manualErrors.trade}</ErrText>}
                    </Field>
                  </FormGrid>

                  <Field style={{ marginTop: 12 }}>
                    <Label>E-Mail (optional)</Label>
                    <Input
                      type="email"
                      placeholder={user?.email || 'deine@email.de'}
                      value={manualEmail}
                      onChange={e => setManualEmail(e.target.value)}
                    />
                  </Field>

                  <ManualSubmitBtn
                    onClick={handleManualSubmit}
                    disabled={manualSaving}
                  >
                    {manualSaving
                      ? <><Loader size={14} className="spin" />Wird eingetragen…</>
                      : <>Betrieb eintragen lassen <ArrowRight size={14} /></>
                    }
                  </ManualSubmitBtn>
                </ManualForm>
              )}

              {/* ── MANUAL SUCCESS ── */}
              {manualDone && (
                <ManualSuccessBox>
                  <CheckCircle size={18} color="#1E7E34" style={{ flexShrink: 0, marginTop: 1 }} />
                  <ManualSuccessText>
                    <strong>Eingetragen! Unser Team meldet sich in 48h.</strong>
                    Wir legen dein Google Business Profil an und
                    optimieren es vollständig — du musst nichts weiter tun.
                  </ManualSuccessText>
                </ManualSuccessBox>
              )}
            </>
          ) : (
            /* ── LINKED STATE ── */
            <>
              <SCardTitle>Dein verknüpfter Betrieb</SCardTitle>
              <LinkedCard>
                <LinkedIcon><CheckCircle size={22} /></LinkedIcon>
                <LinkedInfo>
                  <LinkedName>{profile?.company_name || 'Betrieb verknüpft'}</LinkedName>
                  <LinkedMeta>
                    {profile?.city && (
                      <MetaChip><MapPin size={11} color="var(--color-accent)" />{profile.city}</MetaChip>
                    )}
                    {profile?.google_rating && (
                      <MetaChip><Star size={11} color="var(--color-accent)" />{profile.google_rating.toFixed(1)} Sterne</MetaChip>
                    )}
                    {score !== null && (
                      <MetaChip>
                        Score: <strong style={{ color: scoreColor(score) }}>{score}/100</strong>
                      </MetaChip>
                    )}
                  </LinkedMeta>
                </LinkedInfo>
                <ResetBtn onClick={handleReset} disabled={resetting}>
                  {resetting ? 'Wird zurückgesetzt…' : 'Ändern'}
                </ResetBtn>
              </LinkedCard>
            </>
          )}
        </SCard>
      )}

      {/* ── GMB BRIDGE ── */}
      {!isGhost && (
        <GMBCard $d={hasBusiness ? '.25s' : '.1s'}>
          <GMBBadge><PulseDot /> Vorbereitung</GMBBadge>
          <GMBTitle>Google Business Profil verknüpfen</GMBTitle>
          <GMBSub>
            Verknüpfe deinen Google Business Account, damit {brand.name} dein
            Profil direkt optimieren, Bewertungen verwalten und Beiträge posten kann.
          </GMBSub>
          <GMBBtn onClick={() => setShowModal(true)}>
            <Link2 size={15} /> Google Business Profil verknüpfen
          </GMBBtn>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '.7rem',
            color: 'rgba(255,255,255,.3)', marginTop: 10 }}>
            Wird in Phase 2 via Google Business Profile API aktiviert.
          </p>
        </GMBCard>
      )}
    </>
  );
}
