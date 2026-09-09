import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import {
  CheckCircle, Star, ArrowRight, Search, Loader, MapPin,
  PlusCircle, ChevronDown, Ghost,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import {
  fetchPlaceDetails, extractCity, calcScore,
  scoreColor, scoreBg, scoreLabel, saveManualLead
} from '../../hooks/usePlacesAnalysis';
import supabase from '../../supabaseClient';
import { useCheckout }    from '../../hooks/useCheckout';
import PlacesSearch      from '../../components/PlacesSearch';
import PathAPricingModal from '../../components/dashboard/PathAPricingModal';
import GoogleBusinessConnect from '../../components/dashboard/GoogleBusinessConnect';

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp    = keyframes`from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn    = keyframes`from{opacity:0}to{opacity:1}`;
const spin      = keyframes`to{transform:rotate(360deg)}`;
const slideDown = keyframes`from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}`;

/* ─────────────────────────────────────────────
   SEARCH STYLED
───────────────────────────────────────────── */
const SearchWrap = styled.div`position:relative;`;
const SearchIconAbs = styled.div`
  position:absolute;left:12px;top:50%;transform:translateY(-50%);
  color:var(--color-accent);display:flex;align-items:center;z-index:5;pointer-events:none;
`;
const SearchInput = styled.input`
  width:100%;padding:12px 40px 12px 38px;
  border:2px solid var(--color-border);
  background:var(--color-bg);color:var(--color-text);
  font-family:var(--font-body);font-size:.95rem;
  outline:none;border-radius:var(--radius-card);
  transition:border-color .2s;
  &:focus{border-color:var(--color-primary);background:var(--color-white);}
  &::placeholder{color:#A0ADB8;}
`;
const SearchSpinner = styled.div`
  position:absolute;right:12px;top:50%;transform:translateY(-50%);
  width:16px;height:16px;
  border:2px solid var(--color-border);
  border-top-color:var(--color-accent);
  border-radius:50%;animation:${spin} .7s linear infinite;
`;
const SuggestionList = styled.ul`
  position:absolute;top:calc(100% + 2px);left:0;right:0;
  background:var(--color-white);
  border:2px solid var(--color-primary);border-top:none;
  border-radius:0 0 var(--radius-card) var(--radius-card);
  list-style:none;z-index:100;max-height:280px;overflow-y:auto;
  box-shadow:0 8px 24px rgba(var(--color-primary-rgb),.12);
`;
const SuggestionItem = styled.li`
  padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--color-border);
  &:last-child{border-bottom:none;}
  &:hover{background:rgba(var(--color-primary-rgb),.05);}
`;
const SuggMain = styled.p`font-family:var(--font-body);font-size:.9rem;color:var(--color-primary);`;
const SuggSec  = styled.p`font-family:var(--font-body);font-size:.78rem;color:var(--color-text-muted);margin-top:1px;`;

/* ─────────────────────────────────────────────
   METRICS
───────────────────────────────────────────── */
const Grid = styled.div`
  display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));
  gap:14px;margin-bottom:22px;
`;
const MetricCard = styled.div`
  background:var(--color-white);border:1px solid var(--color-border);
  border-radius:var(--radius-card);padding:18px 20px;
  animation:${fadeUp} .45s ease ${({ $d }) => $d||'0s'} both;
`;
const MetricLabel = styled.p`
  font-family:var(--font-body);font-size:.7rem;text-transform:uppercase;
  letter-spacing:.1em;color:var(--color-text-muted);margin-bottom:8px;
`;
const MetricValue = styled.p`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.9rem;line-height:1;color:${({ $c }) => $c||'var(--color-primary)'};
`;
const MetricSub = styled.p`
  font-family:var(--font-body);font-size:.72rem;color:var(--color-text-muted);margin-top:4px;
`;

/* ─────────────────────────────────────────────
   SCORE BANNER
───────────────────────────────────────────── */
const ScoreBanner = styled.div`
  background:${({ $s }) => scoreBg($s)};
  border:1px solid ${({ $s }) => scoreColor($s)}44;
  border-left:4px solid ${({ $s }) => scoreColor($s)};
  border-radius:var(--radius-card);padding:14px 18px;
  display:flex;align-items:center;justify-content:space-between;
  gap:16px;flex-wrap:wrap;margin-bottom:22px;
  animation:${fadeUp} .4s ease both;
`;
const ScoreLeft  = styled.div`display:flex;align-items:center;gap:12px;`;
const ScoreCircle = styled.div`
  width:48px;height:48px;border-radius:50%;
  background:${({ $s }) => scoreColor($s)};
  color:white;display:flex;align-items:center;justify-content:center;
  font-family:var(--font-display);font-weight:900;font-size:1rem;flex-shrink:0;
`;
const ScoreTitle = styled.p`font-family:var(--font-body);font-weight:700;font-size:.9rem;color:#1A1A1A;`;
const ScoreSub2  = styled.p`font-family:var(--font-body);font-size:.77rem;color:var(--color-text-muted);line-height:1.4;`;
const OptBtn = styled.button`
  display:inline-flex;align-items:center;gap:6px;padding:8px 16px;
  background:var(--color-accent);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.82rem;letter-spacing:.06em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);white-space:nowrap;
  flex-shrink:0;cursor:pointer;transition:filter .2s;
  &:hover{filter:brightness(.9);}
`;

/* ─────────────────────────────────────────────
   SECTION CARD
───────────────────────────────────────────── */
const SCard = styled.div`
  background:var(--color-white);border:1px solid var(--color-border);
  border-radius:var(--radius-card);padding:22px;margin-bottom:18px;
  animation:${fadeUp} .45s ease ${({ $d }) => $d||'0s'} both;
`;
const SCardTitle = styled.h2`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.15rem;text-transform:var(--text-transform);
  color:var(--color-primary);margin-bottom:4px;
`;
const SCardSub = styled.p`
  font-family:var(--font-body);font-size:.82rem;
  color:var(--color-text-muted);margin-bottom:18px;line-height:1.5;
`;
const StepBadge = styled.span`
  display:inline-block;background:var(--color-accent);color:white;
  font-family:var(--font-body);font-weight:700;font-size:.68rem;
  letter-spacing:.1em;text-transform:uppercase;
  padding:3px 10px;border-radius:var(--radius-button);margin-bottom:10px;
`;

/* ─────────────────────────────────────────────
   LINKED STATE
───────────────────────────────────────────── */
const LinkedCard = styled.div`
  display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:16px 18px;background:#E8F5E9;
  border:1px solid #A5D6A7;border-left:4px solid #1E7E34;
  border-radius:var(--radius-card);animation:${fadeIn} .4s ease both;
`;
const LinkedIcon = styled.div`
  width:44px;height:44px;border-radius:50%;background:#1E7E34;
  color:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;
`;
const LinkedInfo  = styled.div`flex:1;min-width:0;`;
const LinkedName  = styled.p`font-family:var(--font-body);font-weight:700;font-size:.95rem;color:#1A1A1A;`;
const LinkedMeta  = styled.p`
  font-family:var(--font-body);font-size:.78rem;color:#5A6A7A;
  margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;
`;
const MetaChip  = styled.span`display:inline-flex;align-items:center;gap:3px;`;
const ResetBtn  = styled.button`
  background:none;border:none;cursor:pointer;font-family:var(--font-body);
  font-size:.78rem;color:#5A6A7A;text-decoration:underline;
  text-underline-offset:2px;flex-shrink:0;
  &:hover{color:#D93025;}
`;

/* ─────────────────────────────────────────────
   FALLBACK FORM
───────────────────────────────────────────── */
const FallbackTrigger = styled.button`
  display:flex;align-items:center;gap:7px;margin-top:14px;
  background:none;border:none;cursor:pointer;padding:0;
  font-family:var(--font-body);font-size:.82rem;color:var(--color-text-muted);
  text-decoration:underline;text-underline-offset:3px;transition:color .2s;
  &:hover{color:var(--color-accent);}
`;
const ManualForm = styled.div`
  margin-top:18px;border-top:1px solid var(--color-border);padding-top:18px;
  animation:${slideDown} .3s ease both;
`;
const ManualTitle = styled.p`
  font-family:var(--font-body);font-weight:700;font-size:.85rem;
  color:var(--color-primary);margin-bottom:12px;
`;
const FormGrid = styled.div`
  display:grid;grid-template-columns:1fr 1fr;gap:12px;
  @media(max-width:560px){grid-template-columns:1fr;}
`;
const Field   = styled.div`display:flex;flex-direction:column;gap:5px;`;
const Label   = styled.label`
  font-family:var(--font-body);font-weight:600;font-size:.72rem;
  letter-spacing:.08em;text-transform:uppercase;color:var(--color-primary);
`;
const Input   = styled.input`
  padding:10px 13px;
  border:2px solid ${({ $err }) => $err?'#E53E3E':'var(--color-border)'};
  background:var(--color-bg);color:var(--color-text);
  font-family:var(--font-body);font-size:.92rem;
  outline:none;border-radius:var(--radius-card);transition:border-color .2s;
  &:focus{border-color:var(--color-primary);background:var(--color-white);}
  &::placeholder{color:#A0ADB8;}
`;
const Select  = styled.select`
  padding:10px 13px;border:2px solid var(--color-border);
  background:var(--color-bg);color:var(--color-text);
  font-family:var(--font-body);font-size:.92rem;
  outline:none;border-radius:var(--radius-card);cursor:pointer;
  &:focus{border-color:var(--color-primary);}
`;
const ErrText = styled.span`font-family:var(--font-body);font-size:.72rem;color:#E53E3E;`;
const ManualSubmitBtn = styled.button`
  display:flex;align-items:center;gap:7px;padding:10px 22px;margin-top:14px;
  background:var(--color-accent);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.88rem;letter-spacing:.06em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);cursor:pointer;transition:filter .2s;
  &:hover:not(:disabled){filter:brightness(.9);}
  &:disabled{opacity:.5;cursor:not-allowed;}
  .spin{animation:${spin} .8s linear infinite;}
`;
const ManualSuccessBox = styled.div`
  display:flex;align-items:flex-start;gap:10px;padding:12px 16px;
  background:#E8F5E9;border-left:3px solid #1E7E34;
  border-radius:var(--radius-card);margin-top:14px;animation:${fadeIn} .3s ease both;
`;
const ManualSuccessText = styled.p`
  font-family:var(--font-body);font-size:.85rem;color:#1A1A1A;line-height:1.5;
  strong{font-weight:700;}
`;

/* ─────────────────────────────────────────────
   GHOST TOWN
───────────────────────────────────────────── */
const GhostCard = styled.div`
  background:var(--color-primary);border-radius:var(--radius-card);
  padding:32px 28px;margin-bottom:18px;
  animation:${fadeUp} .5s ease both;position:relative;overflow:hidden;
`;
const GhostGrid = styled.div`
  position:absolute;inset:0;pointer-events:none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(var(--color-accent-rgb),.04) 1px,transparent 1px);
  background-size:36px 36px;
`;
const GhostBadge = styled.div`
  display:inline-flex;align-items:center;gap:6px;
  background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.35);
  color:#ff8080;font-family:var(--font-body);font-weight:700;
  font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;
  padding:3px 10px;border-radius:var(--radius-button);margin-bottom:14px;
`;
const GhostTitle = styled.h2`
  font-size:clamp(1.4rem,3vw,1.9rem);text-transform:var(--text-transform);
  color:var(--color-white);line-height:1.1;margin-bottom:12px;
`;
const GhostAccent = styled.span`color:var(--color-accent);`;
const GhostText   = styled.p`
  font-family:var(--font-body);font-size:.9rem;
  color:rgba(255,255,255,.65);line-height:1.65;margin-bottom:24px;max-width:520px;
`;
const GhostSteps = styled.div`
  display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;
  @media(max-width:600px){grid-template-columns:1fr;}
`;
const GhostStep = styled.div`
  background:rgba(255,255,255,.06);border-radius:var(--radius-card);padding:14px 16px;
`;
const GhostStepNum  = styled.div`
  font-family:var(--font-display);font-weight:900;font-size:1.4rem;
  color:var(--color-accent);margin-bottom:4px;
`;
const GhostStepText = styled.p`
  font-family:var(--font-body);font-size:.8rem;color:rgba(255,255,255,.6);line-height:1.45;
`;
const GhostCTABtn = styled.button`
  display:inline-flex;align-items:center;gap:8px;padding:13px 26px;
  background:var(--color-accent);color:white;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1rem;letter-spacing:.07em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);cursor:pointer;
  box-shadow:0 4px 16px rgba(var(--color-accent-rgb),.4);
  transition:filter .2s,transform .1s;
  &:hover{filter:brightness(.9);transform:translateY(-1px);}
`;
const GhostResetBtn = styled.button`
  background: none;
  border: 1px solid rgba(255,255,255,.25);
  color: rgba(255,255,255,.55);
  font-family: var(--font-body); font-size: .8rem;
  padding: 10px 16px; border-radius: var(--radius-button);
  cursor: pointer; transition: border-color .2s, color .2s;
  &:hover:not(:disabled) { border-color: rgba(255,255,255,.5); color: rgba(255,255,255,.85); }
  &:disabled { opacity: .4; cursor: not-allowed; }
`;

/* Checkout pending banner */
const CheckoutBanner = styled.div`
  background: rgba(var(--color-accent-rgb),.1);
  border: 1px solid rgba(var(--color-accent-rgb),.3);
  border-left: 4px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 16px 18px; margin-bottom: 18px;
  display: flex; align-items: center; gap: 12px;
  animation: ${fadeIn} .3s ease both;
`;
const CheckoutBannerText = styled.div``;
const CheckoutBannerTitle = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .9rem; color: var(--color-primary); margin-bottom: 2px;
`;
const CheckoutBannerSub = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); line-height: 1.4;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardHome() {
  const { profile, user, refreshProfile } = useAuthContext();
  const { startCheckout, loading: checkoutLoading, error: checkoutError } = useCheckout();

  // Detect return from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (status === 'success') {
      // Clean URL
      window.history.replaceState({}, '', '/dashboard');
      // Refresh profile to get updated plan
      refreshProfile();
    }
  }, [refreshProfile]);
  const { brand, pricing, places, key: industryKey } = useIndustry();

  // Search
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState('');
  const [resetting,     setResetting]     = useState(false);

  // Fallback form
  const [showManual,   setShowManual]   = useState(false);
  const [manualName,   setManualName]   = useState('');
  const [manualTrade,  setManualTrade]  = useState('');
  const [manualEmail,  setManualEmail]  = useState(user?.email || '');
  const [manualErrors, setManualErrors] = useState({});
  const [manualSaving, setManualSaving] = useState(false);
  const [manualDone,   setManualDone]   = useState(false);

  // Modals
  const [showPathAPricing, setShowPathAPricing] = useState(false);
  const [checkoutPending,  setCheckoutPending]  = useState(null);

  const apiKey      = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;
  const hasBusiness = !!profile?.google_place_id;
  const isPro = profile?.plan === 'pro' || profile?.plan === 'trial';
  const isGhost     = profile?.visibility_score === 0
                   && !profile?.google_place_id
                   && !!profile?.company_name;
  const score       = profile?.visibility_score ?? null;

  /* ── Save from search ── */
  const handleSave = async (result) => {
    if (!result || saving) return;

    const userId = user?.id;
    if (!userId) {
      setSaveError('Nicht eingeloggt. Bitte Seite neu laden.');
      return;
    }

    setSaving(true);
    setSaveError('');

    try {
      const city = extractCity(result.addressComponents || []);
      const calc = calcScore({
        rating:      result.rating      || 0,
        reviewCount: result.reviewCount || 0,
        hasWebsite:  result.hasWebsite  || false,
      });

      console.log('[handleSave] Starting save for user:', userId);
      console.log('[handleSave] Data:', { placeId: result.placeId, name: result.name, city, calc });

      // Step 1: Get token from localStorage directly — no async, no lock
      const supabaseProjectId = process.env.REACT_APP_SUPABASE_URL
        ?.replace('https://', '')
        ?.split('.')[0];
      const storageKey = `sb-${supabaseProjectId}-auth-token`;
      let token = null;

      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) token = JSON.parse(raw)?.access_token;
      } catch (_) {}

      // Fallback: try all localStorage keys for Supabase token
      if (!token) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.includes('-auth-token')) {
            try {
              const val = JSON.parse(localStorage.getItem(k));
              if (val?.access_token) { token = val.access_token; break; }
            } catch (_) {}
          }
        }
      }

      if (!token) throw new Error('Kein Auth-Token in localStorage gefunden.');

      console.log('[handleSave] Got token from localStorage, calling REST API...');

      // Step 2: Direct REST PATCH — no Supabase client lock
      const supabaseUrl  = process.env.REACT_APP_SUPABASE_URL;
      const supabaseKey  = process.env.REACT_APP_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase Env-Variablen fehlen (REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY)');
      }

      const payload = {
        google_place_id:     result.placeId     || null,
        company_name:        result.name        || null,
        city:                city               || null,
        google_rating:       result.rating      || null,
        google_review_count: result.reviewCount || null,
        visibility_score:    calc,
      };

      console.log('[handleSave] PATCH payload:', payload);

      const res = await fetch(
        `${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`,
        {
          method:  'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        supabaseKey,
            'Authorization': `Bearer ${token}`,
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify(payload),
        }
      );

      console.log('[handleSave] Response status:', res.status);

      if (!res.ok) {
        const errText = await res.text();
        console.error('[handleSave] REST error:', errText);
        throw new Error(`Speichern fehlgeschlagen (${res.status}): ${errText}`);
      }

      console.log('[handleSave] Save successful — refreshing profile...');

      // Step 3: Refresh profile in context
      // Small delay to ensure DB write is committed
      await new Promise(r => setTimeout(r, 400));
      await refreshProfile();

      console.log('[handleSave] Profile refreshed — done!');

    } catch (err) {
      console.error('[handleSave] CAUGHT ERROR:', err.message);
      setSaveError('Fehler beim Speichern. Bitte versuche es erneut.');
    } finally {
      setSaving(false);
    }
  }

  /* ── Reset business (linked state) ── */
  const handleReset = async () => {
    setResetting(true);
    await supabase.from('user_profiles').update({
      google_place_id: null, company_name: null,
      google_rating: null, google_review_count: null, visibility_score: null,
    }).eq('id', user.id);
    setSelectedPlace(null);
    await refreshProfile();
    setResetting(false);
  };

  /* ── Reset ghost town (versehentlich manuell eingetragen) ── */
  const handleGhostReset = async () => {
    if (!window.confirm('Eintrag zurücksetzen? Du kannst danach deinen Betrieb per Google-Suche verknüpfen.')) return;
    setResetting(true);
    await supabase.from('user_profiles').update({
      company_name:     null,
      visibility_score: null,
      industry_key:     industryKey || 'handwerk',
    }).eq('id', user.id);
    // Mark the manual lead as cancelled
    await supabase.from('leads')
      .update({ status: 'cancelled' })
      .eq('email', user.email)
      .eq('needs_manual_setup', true)
      .eq('status', 'new');
    await refreshProfile();
    setResetting(false);
  };

  /* ── Manual submit ── */
  const handleManualSubmit = async () => {
    const errors = {};
    if (!manualName.trim()) errors.name  = 'Pflichtfeld';
    if (!manualTrade)       errors.trade = 'Bitte wählen';
    if (Object.keys(errors).length) { setManualErrors(errors); return; }
    setManualErrors({});
    setManualSaving(true);
    try {
      await saveManualLead({
        companyName: manualName.trim(),
        trade:       manualTrade,
        email:       manualEmail || user?.email,
        industryKey,
        userId:      null,
      });
      if (user?.id) {
        await supabase.from('user_profiles').update({
          company_name:     manualName.trim(),
          visibility_score: 0,
          industry_key:     industryKey || 'handwerk',
        }).eq('id', user.id);
      }
      await refreshProfile();
      setManualDone(true);
    } catch (err) { console.error('Manual submit error:', err); }
    setManualSaving(false);
  };

  /* ── Checkout ──
     setShowGhostSetup und der path-Parameter sind mit Path B
     entfallen — es gibt nur noch einen Weg zum Abo. */
  const handleCheckoutStart = async ({ metadata }) => {
    setShowPathAPricing(false);
    await startCheckout({
      plan:        metadata.plan_type,
      companyName: metadata.company_name || profile?.company_name || '',
      industryKey: metadata.industry_key || industryKey,
    });
  };

  return (
    <>
      {/* ── PATH A PRICING MODAL ── */}
      {showPathAPricing && (
        <PathAPricingModal
          onClose={() => setShowPathAPricing(false)}
          onCheckoutStart={handleCheckoutStart}
          companyName={profile?.company_name || ''}
          score={score}
          userId={user?.id}
          industryKey={industryKey}
        />
      )}

      {/* ── CHECKOUT LOADING / ERROR ── */}
      {checkoutLoading && (
        <CheckoutBanner>
          <Loader size={20} color="var(--color-accent)" style={{ flexShrink: 0, animation: 'spin .8s linear infinite' }} />
          <CheckoutBannerText>
            <CheckoutBannerTitle>Weiterleitung zu Stripe…</CheckoutBannerTitle>
            <CheckoutBannerSub>Bitte warte kurz — du wirst gleich weitergeleitet.</CheckoutBannerSub>
          </CheckoutBannerText>
        </CheckoutBanner>
      )}
      {checkoutError && (
        <CheckoutBanner style={{ borderLeftColor: '#D93025', background: '#FDECEA' }}>
          <CheckoutBannerText>
            <CheckoutBannerTitle style={{ color: '#D93025' }}>Checkout fehlgeschlagen</CheckoutBannerTitle>
            <CheckoutBannerSub>{checkoutError}</CheckoutBannerSub>
          </CheckoutBannerText>
        </CheckoutBanner>
      )}

      {/* ── KEIN GOOGLE-PROFIL ──
           Hier stand die "Digitale Geisterstadt" mit einem
           149-€-Setup-Angebot. Das war Dienstleistung: jemand legte
           das Profil von Hand an.

           Jetzt eine Anleitung. Ein Google-Profil anzulegen ist bei
           Google kostenlos und dauert zehn Minuten — dafür Geld zu
           nehmen liesse sich nicht begründen, wenn das Produkt
           Software ist. WERKRUF setzt danach an. */}
      {isGhost && (
        <GhostCard>
          <GhostGrid />
          <GhostBadge><Ghost size={12}/> Noch kein Google-Profil</GhostBadge>
          <GhostTitle>
            Dein Betrieb fehlt bei Google.<br/>
            <GhostAccent>Das änderst du in zehn Minuten.</GhostAccent>
          </GhostTitle>
          <GhostText>
            Wer online nach deiner Leistung sucht, findet gerade nur deine
            Konkurrenz. Ein Google-Unternehmensprofil ist kostenlos — du legst
            es direkt bei Google an, danach übernimmt {brand.name}.
          </GhostText>
          <GhostSteps>
            <GhostStep>
              <GhostStepNum>01</GhostStepNum>
              <GhostStepText>
                Profil bei Google anlegen — kostenlos, etwa zehn Minuten.
              </GhostStepText>
            </GhostStep>
            <GhostStep>
              <GhostStepNum>02</GhostStepNum>
              <GhostStepText>
                Verifizieren. Google schickt dir einen Code, meist per Postkarte
                oder Telefon. Das dauert ein paar Tage.
              </GhostStepText>
            </GhostStep>
            <GhostStep>
              <GhostStepNum>03</GhostStepNum>
              <GhostStepText>
                Profil mit {brand.name} verbinden. Ab dann läuft die Überwachung,
                und zu jeder Bewertung liegt ein Antwortvorschlag bereit.
              </GhostStepText>
            </GhostStep>
          </GhostSteps>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
            <GhostCTABtn
              as="a"
              href="https://business.google.com/create"
              target="_blank"
              rel="noopener noreferrer"
            >
              Bei Google anlegen <ArrowRight size={16}/>
            </GhostCTABtn>
            <GhostResetBtn onClick={handleGhostReset} disabled={resetting}>
              {resetting ? 'Wird zurückgesetzt…' : 'Betrieb existiert doch? Zurücksetzen'}
            </GhostResetBtn>
          </div>
          <p style={{
            fontFamily:'var(--font-body)',fontSize:'.72rem',
            color:'rgba(255,255,255,.3)',marginTop:14,
          }}>
            Das Profil gehört danach dir — {brand.name} arbeitet darin, besitzt es nicht.
          </p>
        </GhostCard>
      )}

      {/* ── SCORE BANNER (Path A) ── */}
      {hasBusiness && score !== null && !isGhost && (
        <ScoreBanner $s={score}>
          <ScoreLeft>
            <ScoreCircle $s={score}>{score}</ScoreCircle>
            <div>
              <ScoreTitle>Dein Profil ist <strong>{scoreLabel(score)}</strong>.</ScoreTitle>
              <ScoreSub2>{profile?.company_name} · Jetzt optimieren und mehr Anfragen bekommen.</ScoreSub2>
            </div>
          </ScoreLeft>
          {isPro ? (
            <span style={{
              background: 'rgba(var(--color-accent-rgb),.15)',
              border: '1px solid rgba(var(--color-accent-rgb),.3)',
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-body)', fontWeight: 700,
              fontSize: '.75rem', letterSpacing: '.1em', textTransform: 'uppercase',
              padding: '5px 12px', borderRadius: 'var(--radius-button)',
            }}>
              ✓ {profile?.plan === 'trial' ? 'Test-Phase aktiv' : 'PRO aktiv'}
            </span>
          ) : (
            <OptBtn onClick={() => setShowPathAPricing(true)}>
              PRO testen — 30 Tage gratis <ArrowRight size={13}/>
            </OptBtn>
          )}
        </ScoreBanner>
      )}

      {/* ── METRICS ── */}
      {hasBusiness && !isGhost && (
        <Grid>
          <MetricCard $d="0s">
            <MetricLabel>Sichtbarkeits-Score</MetricLabel>
            <MetricValue $c={score!==null?scoreColor(score):undefined}>
              {score??'—'}<span style={{fontSize:'1rem',opacity:.4}}>/100</span>
            </MetricValue>
            <MetricSub>{score!==null?scoreLabel(score):'Nicht berechnet'}</MetricSub>
          </MetricCard>
          <MetricCard $d=".05s">
            <MetricLabel>Ø Bewertung</MetricLabel>
            <MetricValue>{profile?.google_rating?.toFixed(1)??'—'}</MetricValue>
            <MetricSub>bei Google</MetricSub>
          </MetricCard>
          <MetricCard $d=".1s">
            <MetricLabel>Rezensionen</MetricLabel>
            <MetricValue>{profile?.google_review_count?.toLocaleString('de-DE')??'—'}</MetricValue>
            <MetricSub>gesamt</MetricSub>
          </MetricCard>
          <MetricCard $d=".15s">
            <MetricLabel>Monatl. Potenzial</MetricLabel>
            <MetricValue $c="var(--color-accent)">
              +{(pricing.roi.avgOrderValue*5).toLocaleString('de-DE')}€
            </MetricValue>
            <MetricSub>bei optimiertem Profil</MetricSub>
          </MetricCard>
        </Grid>
      )}

      {/* ── ONBOARDING / BUSINESS CARD ── */}
      {!isGhost && (
        <SCard $d={hasBusiness?'.2s':'0s'}
          style={!hasBusiness?{borderTop:'4px solid var(--color-accent)'}:{}}>
          {!hasBusiness ? (
            <>
              <StepBadge>Schritt 1 von 1</StepBadge>
              <SCardTitle>Welches ist dein Betrieb?</SCardTitle>
              <SCardSub>
                Verknüpfe deinen Google Business-Eintrag — dann analysieren wir
                deinen Stand und zeigen dir, was du verbessern kannst.
              </SCardSub>

              {apiKey && (
                <PlacesSearch
                  onSelect={(result) => {
                    if (!result) { setSelectedPlace(null); return; }
                    setSelectedPlace(result);
                  }}
                  onNoResults={() => {
                    setShowManual(true);
                    setTimeout(() => {
                      const el = document.getElementById('manual-form');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                  }}
                  placeholder={places.searchPlaceholder}
                  dark={false}
                />
              )}

              <button
                onClick={() => selectedPlace && !saving && handleSave(selectedPlace)}
                disabled={saving}
                style={{
                  display:'inline-flex',alignItems:'center',gap:7,
                  padding:'10px 22px',marginTop:12,
                  background: saving ? 'rgba(var(--color-primary-rgb),.6)' : 'var(--color-primary)',
                  color:'white',fontFamily:'var(--font-display)',
                  fontWeight:'var(--heading-weight)',fontSize:'.88rem',
                  letterSpacing:'.06em',textTransform:'var(--text-transform)',
                  border:'none',borderRadius:'var(--radius-button)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: !selectedPlace && !saving ? 0.5 : 1,
                }}
              >
                {saving
                  ? <><Loader size={14} style={{animation:'spin .8s linear infinite'}}/> Wird gespeichert…</>
                  : selectedPlace
                    ? <>✓ {selectedPlace.name} speichern</>
                    : <>Betrieb speichern <ArrowRight size={14}/></>
                }
              </button>
              {saveError && (
                <p style={{
                  fontFamily:'var(--font-body)',fontSize:'.78rem',
                  color:'#D93025',marginTop:8,
                  padding:'8px 12px',background:'#FDECEA',
                  borderLeft:'3px solid #D93025',borderRadius:'0 var(--radius-card) var(--radius-card) 0',
                }}>
                  {saveError}
                </p>
              )}

              {/* Fallback */}
              <FallbackTrigger onClick={() => setShowManual(!showManual)}>
                <PlusCircle size={14}/>
                Betrieb nicht gefunden? Hier manuell eintragen.
                <ChevronDown size={13} style={{
                  transform: showManual?'rotate(180deg)':'rotate(0deg)',
                  transition:'transform .2s',
                }}/>
              </FallbackTrigger>

              {showManual && !manualDone && (
                <ManualForm id="manual-form">
                  <ManualTitle>Manuelle Einrichtung</ManualTitle>
                  <FormGrid>
                    <Field>
                      <Label>Firmenname *</Label>
                      <Input type="text" placeholder="Sanitär Müller GmbH"
                        value={manualName}
                        onChange={e=>{setManualName(e.target.value);setManualErrors(p=>({...p,name:''}));}}
                        $err={!!manualErrors.name}/>
                      {manualErrors.name && <ErrText>{manualErrors.name}</ErrText>}
                    </Field>
                    <Field>
                      <Label>Branche *</Label>
                      <Select value={manualTrade}
                        onChange={e=>{setManualTrade(e.target.value);setManualErrors(p=>({...p,trade:''}));}}
                        style={{borderColor:manualErrors.trade?'#E53E3E':undefined}}>
                        <option value="">Bitte wählen</option>
                        {(places.tradeOptions||[]).map(opt=>(
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </Select>
                      {manualErrors.trade && <ErrText>{manualErrors.trade}</ErrText>}
                    </Field>
                  </FormGrid>
                  <Field style={{marginTop:12}}>
                    <Label>E-Mail (optional)</Label>
                    <Input type="email" placeholder={user?.email||'deine@email.de'}
                      value={manualEmail} onChange={e=>setManualEmail(e.target.value)}/>
                  </Field>
                  <ManualSubmitBtn onClick={handleManualSubmit} disabled={manualSaving}>
                    {manualSaving
                      ? <><Loader size={14} className="spin"/>Wird eingetragen…</>
                      : <>Betrieb eintragen lassen <ArrowRight size={14}/></>
                    }
                  </ManualSubmitBtn>
                </ManualForm>
              )}

              {manualDone && (
                <ManualSuccessBox>
                  <CheckCircle size={18} color="#1E7E34" style={{flexShrink:0,marginTop:1}}/>
                  <ManualSuccessText>
                    <strong>Eingetragen.</strong>{' '}
                    Wir legen dein Google Business Profil an und optimieren es vollständig.
                  </ManualSuccessText>
                </ManualSuccessBox>
              )}
            </>
          ) : (
            <>
              <SCardTitle>Dein verknüpfter Betrieb</SCardTitle>
              <LinkedCard>
                <LinkedIcon><CheckCircle size={22}/></LinkedIcon>
                <LinkedInfo>
                  <LinkedName>{profile?.company_name||'Betrieb verknüpft'}</LinkedName>
                  <LinkedMeta>
                    {profile?.city && <MetaChip><MapPin size={11} color="var(--color-accent)"/>{profile.city}</MetaChip>}
                    {profile?.google_rating && <MetaChip><Star size={11} color="var(--color-accent)"/>{profile.google_rating.toFixed(1)} Sterne</MetaChip>}
                    {score!==null && <MetaChip>Score: <strong style={{color:scoreColor(score)}}>{score}/100</strong></MetaChip>}
                  </LinkedMeta>
                </LinkedInfo>
                <ResetBtn onClick={handleReset} disabled={resetting}>
                  {resetting?'Wird zurückgesetzt…':'Ändern'}
                </ResetBtn>
              </LinkedCard>
            </>
          )}
        </SCard>
      )}

      {/* ── GOOGLE BUSINESS PROFILE ──
           Ersetzt die frühere "In Kürze verfügbar"-Bridge.
           Die Komponente lädt ihren Status selbst und zeigt je nach
           Lage: verbinden / verbunden / neu verbinden.

           Für Ghost-Profile (kein Google-Eintrag vorhanden) weiterhin
           ausgeblendet — dort gibt es noch nichts zu verknüpfen. */}
      {!isGhost && <GoogleBusinessConnect />}
    </>
  );
}
