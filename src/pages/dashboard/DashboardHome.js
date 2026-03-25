import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import GooglePlacesAutocomplete from 'react-google-places-autocomplete';
import {
  AlertTriangle, CheckCircle, Link2, TrendingUp,
  Star, ArrowRight, Search, Loader, RefreshCw
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { fetchPlaceDetails, extractCity, calcScore } from '../../hooks/usePlacesAnalysis';
import supabase from '../../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;
const pulse  = keyframes`0%,100%{opacity:1}50%{opacity:.4}`;

/* ─────────────────────────────────────────────
   SHARED LAYOUT COMPONENTS
───────────────────────────────────────────── */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
`;

const MetricCard = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 20px;
  animation: ${fadeUp} .5s ease ${({ $d }) => $d || '0s'} both;
`;

const MetricLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  text-transform: uppercase; letter-spacing: .1em;
  color: var(--color-text-muted); margin-bottom: 8px;
`;

const MetricValue = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 2rem; line-height: 1;
  color: ${({ $c }) => $c || 'var(--color-primary)'};
`;

const MetricSub = styled.p`
  font-family: var(--font-body); font-size: .75rem;
  color: var(--color-text-muted); margin-top: 4px;
`;

const SectionCard = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 24px;
  margin-bottom: 20px;
  animation: ${fadeUp} .5s ease ${({ $d }) => $d || '0s'} both;
`;

const SectionTitle = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.2rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

const SectionSub = styled.p`
  font-family: var(--font-body); font-size: .83rem;
  color: var(--color-text-muted); margin-bottom: 20px; line-height: 1.5;
`;

/* Score banner */
const ScoreBanner = styled.div`
  background: ${({ $score }) =>
    $score >= 70 ? '#E8F5E9' : $score >= 45 ? '#FFF8E1' : '#FDECEA'};
  border: 1px solid ${({ $score }) =>
    $score >= 70 ? '#A5D6A7' : $score >= 45 ? '#FFE082' : '#FFCDD2'};
  border-left: 4px solid ${({ $score }) =>
    $score >= 70 ? '#1E7E34' : $score >= 45 ? '#D48A00' : '#D93025'};
  border-radius: var(--radius-card);
  padding: 16px 20px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  margin-bottom: 24px;
  animation: ${fadeUp} .4s ease both;
`;

const ScoreBannerLeft = styled.div`display:flex;align-items:center;gap:12px;`;
const ScoreCircle = styled.div`
  width: 52px; height: 52px;
  border-radius: 50%;
  background: ${({ $score }) =>
    $score >= 70 ? '#1E7E34' : $score >= 45 ? '#D48A00' : '#D93025'};
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 900;
  font-size: 1.1rem; flex-shrink: 0;
`;
const ScoreBannerText = styled.div``;
const ScoreBannerTitle = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .9rem; color: #1A1A1A;
`;
const ScoreBannerSub = styled.p`
  font-family: var(--font-body); font-size: .78rem; color: #5A6A7A; line-height: 1.4;
`;

const OptimizeBtn = styled(Link)`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .85rem; letter-spacing: .06em; text-transform: var(--text-transform);
  text-decoration: none; border-radius: var(--radius-button);
  white-space: nowrap; flex-shrink: 0;
  transition: filter .2s;
  &:hover { filter: brightness(.9); }
`;

/* Onboarding */
const OnboardingCard = styled(SectionCard)`
  border-top: 4px solid var(--color-accent);
`;

const StepBadge = styled.span`
  display: inline-block;
  background: var(--color-accent); color: white;
  font-family: var(--font-body); font-weight: 700;
  font-size: .7rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-button);
  margin-bottom: 12px;
`;

/* Places autocomplete overrides */
const AcWrap = styled.div`
  & > div > div {
    border-radius: var(--radius-card) !important;
    border: 2px solid var(--color-border) !important;
    box-shadow: none !important;
    font-family: var(--font-body) !important;
    font-size: .95rem !important;
    min-height: 48px !important;
    background: var(--color-bg) !important;
    padding-left: 38px !important;
    transition: border-color .2s !important;
  }
  & > div > div:focus-within {
    border-color: var(--color-primary) !important;
    background: var(--color-white) !important;
  }
  & input { font-family: var(--font-body) !important; color: var(--color-text) !important; }
  & [class*="placeholder"] { color: #A0ADB8 !important; }
  & [class*="menu"] {
    border-radius: var(--radius-card) !important;
    border: 2px solid var(--color-primary) !important;
    border-top: none !important;
    box-shadow: 0 8px 24px rgba(var(--color-primary-rgb),.12) !important;
    z-index: 100 !important;
  }
  & [class*="option"] {
    font-family: var(--font-body) !important; font-size: .9rem !important;
    color: var(--color-primary) !important; padding: 10px 14px !important;
  }
  & [class*="option"]:hover { background: rgba(var(--color-primary-rgb),.05) !important; }
  & [class*="indicatorSeparator"] { display: none !important; }
`;

const AcRelative = styled.div`position: relative;`;
const AcSearchIcon = styled.div`
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: var(--color-accent); display: flex; align-items: center; z-index: 5;
`;

const SaveBtn = styled.button`
  display: flex; align-items: center; gap: 8px;
  padding: 11px 24px; margin-top: 14px;
  background: var(--color-primary); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .9rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover { filter: brightness(1.1); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

/* GMB Bridge */
const GMBCard = styled(SectionCard)`
  background: linear-gradient(135deg, var(--color-primary) 0%, rgba(var(--color-primary-rgb), .85) 100%);
  border: none;
  color: white;
`;

const GMBTitle = styled.h3`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.2rem; text-transform: var(--text-transform);
  color: white; margin-bottom: 6px;
`;

const GMBSub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: rgba(255,255,255,.65); margin-bottom: 20px; line-height: 1.55;
`;

const GMBBtn = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 24px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .95rem; letter-spacing: .07em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  box-shadow: 0 4px 16px rgba(var(--color-accent-rgb), .4);
  transition: filter .2s, transform .1s;
  &:hover { filter: brightness(.9); transform: translateY(-1px); }
`;

const GMBBadge = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(var(--color-accent-rgb), .15);
  border: 1px solid rgba(var(--color-accent-rgb), .3);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 600; font-size: .72rem;
  letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-button);
  margin-bottom: 12px;
  span { animation: ${pulse} 1.5s ease infinite; }
`;

const PulseCircle = styled.span`
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-accent); display: inline-block;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardHome() {
  const { profile, refreshProfile } = useAuthContext();
  const { brand, pricing, places }  = useIndustry();

  const [selectedPlace, setSelectedPlace] = useState(null);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const apiKey = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;

  // Determine state: has_business | no_business
  const hasBusinessLinked = !!profile?.google_place_id;
  const score = profile?.visibility_score || null;
  const scoreLabel = score >= 70 ? 'GUT' : score >= 45 ? 'AUSBAUFÄHIG' : 'KRITISCH';

  /* Save selected business to profile */
  const handleSaveBusiness = async () => {
    if (!selectedPlace) return;
    setSavingBusiness(true);

    try {
      const pd = await fetchPlaceDetails(selectedPlace.value.place_id);
      const city        = extractCity(pd.address_components);
      const rating      = pd.rating || 0;
      const reviewCount = pd.user_ratings_total || 0;
      const hasWebsite  = !!pd.website;
      const calcedScore = calcScore({ rating, reviewCount, hasWebsite });

      const { error } = await supabase
        .from('user_profiles')
        .update({
          google_place_id:     pd.place_id,
          company_name:        pd.name,
          city,
          google_rating:       rating,
          google_review_count: reviewCount,
          visibility_score:    calcedScore,
        })
        .eq('id', (await supabase.auth.getUser()).data.user?.id);

      if (error) throw error;

      refreshProfile();
      setSavedMsg(`${pd.name} wurde verknüpft!`);
    } catch (err) {
      console.error(err);
    }
    setSavingBusiness(false);
  };

  /* ─── RENDER ─── */
  return (
    <div>

      {/* Score banner — only if profile has score */}
      {hasBusinessLinked && score !== null && (
        <ScoreBanner $score={score}>
          <ScoreBannerLeft>
            <ScoreCircle $score={score}>{score}</ScoreCircle>
            <ScoreBannerText>
              <ScoreBannerTitle>
                Dein Profil ist noch <strong>{scoreLabel}</strong>.
              </ScoreBannerTitle>
              <ScoreBannerSub>
                {profile?.company_name || 'Dein Betrieb'} hat Optimierungspotenzial.
                Jetzt beheben und mehr Anfragen bekommen.
              </ScoreBannerSub>
            </ScoreBannerText>
          </ScoreBannerLeft>
          <OptimizeBtn to="/dashboard/einstellungen">
            Jetzt optimieren <ArrowRight size={14} />
          </OptimizeBtn>
        </ScoreBanner>
      )}

      {/* ── ONBOARDING STEP 1: No business linked yet ── */}
      {!hasBusinessLinked && (
        <OnboardingCard $d="0s">
          <StepBadge>Schritt 1 von 1</StepBadge>
          <SectionTitle>Welches ist dein Betrieb?</SectionTitle>
          <SectionSub>
            Verknüpfe deinen Google Business-Eintrag — dann analysieren wir deinen
            aktuellen Stand und zeigen dir, was du verbesserst kannst.
          </SectionSub>

          {savedMsg ? (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px',
              background:'#E8F5E9', borderRadius:'var(--radius-card)' }}>
              <CheckCircle size={18} color="#1E7E34" />
              <p style={{ fontFamily:'var(--font-body)', fontSize:'.88rem', color:'#1A1A1A' }}>
                {savedMsg}
              </p>
            </div>
          ) : (
            <>
              <AcRelative>
                <AcSearchIcon><Search size={16} /></AcSearchIcon>
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
                    <p style={{padding:'12px',color:'#D93025',fontFamily:'var(--font-body)',fontSize:'.85rem'}}>
                      ⚠ REACT_APP_GOOGLE_PLACES_API_KEY fehlt in .env
                    </p>
                  )}
                </AcWrap>
              </AcRelative>

              <SaveBtn
                onClick={handleSaveBusiness}
                disabled={!selectedPlace || savingBusiness}
              >
                {savingBusiness
                  ? <><Loader size={15} className="spin" />Wird gespeichert…</>
                  : <>Betrieb speichern <ArrowRight size={15} /></>
                }
              </SaveBtn>
            </>
          )}
        </OnboardingCard>
      )}

      {/* ── METRICS — shown if business is linked ── */}
      {hasBusinessLinked && (
        <Grid>
          <MetricCard $d="0s">
            <MetricLabel>Sichtbarkeits-Score</MetricLabel>
            <MetricValue $c={score >= 70 ? '#1E7E34' : score >= 45 ? '#D48A00' : '#D93025'}>
              {score ?? '—'}<span style={{fontSize:'1rem',opacity:.5}}>/100</span>
            </MetricValue>
            <MetricSub>{scoreLabel}</MetricSub>
          </MetricCard>

          <MetricCard $d=".05s">
            <MetricLabel>Ø Bewertung</MetricLabel>
            <MetricValue>
              {profile?.google_rating?.toFixed(1) ?? '—'}
            </MetricValue>
            <MetricSub>bei Google</MetricSub>
          </MetricCard>

          <MetricCard $d=".1s">
            <MetricLabel>Rezensionen</MetricLabel>
            <MetricValue>
              {profile?.google_review_count?.toLocaleString('de-DE') ?? '—'}
            </MetricValue>
            <MetricSub>gesamt</MetricSub>
          </MetricCard>

          <MetricCard $d=".15s">
            <MetricLabel>Monat. Potenzial</MetricLabel>
            <MetricValue $c="var(--color-accent)">
              +{(pricing.roi.avgOrderValue * 5).toLocaleString('de-DE')}€
            </MetricValue>
            <MetricSub>bei optimiertem Profil</MetricSub>
          </MetricCard>
        </Grid>
      )}

      {/* ── GMB BRIDGE ── */}
      <GMBCard $d={hasBusinessLinked ? '.2s' : '.05s'}>
        <GMBBadge><PulseCircle /> <span /> Vorbereitung</GMBBadge>
        <GMBTitle>Google Business Profil verknüpfen</GMBTitle>
        <GMBSub>
          Verknüpfe deinen Google Business Account, damit {brand.name} dein Profil
          direkt optimieren, Bewertungen verwalten und Beiträge posten kann —
          vollautomatisch.
        </GMBSub>
        <GMBBtn type="button" onClick={() => alert('Google OAuth für GMB API — kommt in Phase 2!')}>
          <Link2 size={16} />
          Google Business Profil verknüpfen
        </GMBBtn>
        <p style={{ fontFamily:'var(--font-body)', fontSize:'.72rem',
          color:'rgba(255,255,255,.35)', marginTop:10 }}>
          Wird in Phase 2 via Google Business Profile API aktiviert.
        </p>
      </GMBCard>

    </div>
  );
}
