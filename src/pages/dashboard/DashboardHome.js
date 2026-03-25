import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import GooglePlacesAutocomplete from 'react-google-places-autocomplete';
import {
  AlertTriangle, CheckCircle, Link2, TrendingUp,
  Star, ArrowRight, Search, Loader, MapPin,
  Globe, X, Zap, Clock
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { fetchPlaceDetails, extractCity, calcScore, scoreColor, scoreBg, scoreLabel } from '../../hooks/usePlacesAnalysis';
import supabase from '../../supabaseClient';

const fadeUp  = keyframes`from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const spin    = keyframes`to{transform:rotate(360deg)}`;
const pulse   = keyframes`0%,100%{opacity:1}50%{opacity:.4}`;
const scaleIn = keyframes`from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}`;

/* ─────────────────────────────────────────────
   METRIC CARDS
───────────────────────────────────────────── */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px; margin-bottom: 24px;
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

const ScoreText = styled.div``;
const ScoreTitle = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .9rem; color: #1A1A1A;
`;
const ScoreSub = styled.p`
  font-family: var(--font-body); font-size: .77rem;
  color: var(--color-text-muted); line-height: 1.4;
`;

const OptBtn = styled(Link)`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .82rem; letter-spacing: .06em; text-transform: var(--text-transform);
  text-decoration: none; border-radius: var(--radius-button);
  white-space: nowrap; flex-shrink: 0; transition: filter .2s;
  &:hover { filter: brightness(.9); }
`;

/* ─────────────────────────────────────────────
   SECTION CARD
───────────────────────────────────────────── */
const SCard = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 22px 22px;
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
   BUSINESS IDENTIFIED STATE
───────────────────────────────────────────── */
const LinkedCard = styled.div`
  display: flex; align-items: center;
  gap: 16px; flex-wrap: wrap;
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
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
`;

const LinkedInfo = styled.div`flex: 1; min-width: 0;`;
const LinkedName = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .95rem; color: #1A1A1A;
`;
const LinkedMeta = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: #5A6A7A; margin-top: 2px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
`;
const MetaChip = styled.span`
  display: inline-flex; align-items: center; gap: 3px;
  svg { color: var(--color-accent); }
`;

const ResetBtn = styled.button`
  background: none; border: none; cursor: pointer;
  font-family: var(--font-body); font-size: .78rem;
  color: #5A6A7A; text-decoration: underline;
  text-underline-offset: 2px; flex-shrink: 0;
  &:hover { color: #D93025; }
`;

/* ─────────────────────────────────────────────
   AUTOCOMPLETE WRAPPER
───────────────────────────────────────────── */
const AcWrap = styled.div`
  & > div > div {
    border-radius: var(--radius-card) !important;
    border: 2px solid var(--color-border) !important;
    box-shadow: none !important;
    font-family: var(--font-body) !important;
    font-size: .95rem !important;
    min-height: 48px !important;
    background: var(--color-bg) !important;
    padding-left: 40px !important;
    transition: border-color .2s !important;
  }
  & > div > div:focus-within {
    border-color: var(--color-primary) !important;
    background: var(--color-white) !important;
  }
  & input { font-family: var(--font-body) !important; color: var(--color-text) !important; font-size: .95rem !important; }
  & [class*="placeholder"] { color: #A0ADB8 !important; font-size: .92rem !important; }
  & [class*="menu"] {
    border-radius: var(--radius-card) !important;
    border: 2px solid var(--color-primary) !important;
    border-top: none !important;
    box-shadow: 0 8px 24px rgba(var(--color-primary-rgb),.12) !important;
    z-index: 100 !important;
  }
  & [class*="option"] {
    font-family: var(--font-body) !important; font-size: .88rem !important;
    color: var(--color-primary) !important; padding: 10px 14px !important;
  }
  & [class*="option"]:hover { background: rgba(var(--color-primary-rgb),.05) !important; }
  & [class*="indicatorSeparator"] { display: none !important; }
  & [class*="loadingIndicator"] { color: var(--color-accent) !important; }
`;

const AcWrap2 = styled.div`position: relative;`;
const SearchIcon = styled.div`
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: var(--color-accent); display: flex; align-items: center; z-index: 5;
  pointer-events: none;
`;

const SaveBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 22px; margin-top: 12px;
  background: var(--color-primary); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .88rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover:not(:disabled) { filter: brightness(1.15); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

/* ─────────────────────────────────────────────
   GMB CARD
───────────────────────────────────────────── */
const GMBCard = styled(SCard)`
  background: var(--color-primary);
  border: none;
`;

const GMBBadge = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(var(--color-accent-rgb),.15);
  border: 1px solid rgba(var(--color-accent-rgb),.3);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-button); margin-bottom: 10px;
`;

const PulseDot = styled.span`
  width: 6px; height: 6px; background: var(--color-accent);
  border-radius: 50%; display: inline-block;
  animation: ${pulse} 1.5s ease infinite;
`;

const GMBTitle = styled.h3`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.15rem; text-transform: var(--text-transform);
  color: var(--color-white); margin-bottom: 6px;
`;

const GMBSub = styled.p`
  font-family: var(--font-body); font-size: .83rem;
  color: rgba(255,255,255,.6); margin-bottom: 18px; line-height: 1.55;
`;

const GMBBtn = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 22px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .92rem; letter-spacing: .07em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  box-shadow: 0 4px 16px rgba(var(--color-accent-rgb),.4);
  transition: filter .2s, transform .1s;
  &:hover { filter: brightness(.9); transform: translateY(-1px); }
`;

/* ─────────────────────────────────────────────
   GMB MODAL
───────────────────────────────────────────── */
const ModalOverlay = styled.div`
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: ${fadeIn} .2s ease both;
`;

const Modal = styled.div`
  background: var(--color-white);
  border-radius: var(--radius-card);
  border-top: 5px solid var(--color-accent);
  padding: 36px 32px;
  max-width: 480px; width: 100%;
  position: relative;
  animation: ${scaleIn} .25s ease both;
`;

const ModalClose = styled.button`
  position: absolute; top: 14px; right: 14px;
  background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); padding: 4px;
  border-radius: var(--radius-button);
  &:hover { background: var(--color-bg); }
`;

const ModalIcon = styled.div`
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(var(--color-accent-rgb),.1);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-accent); margin-bottom: 18px;
`;

const ModalTitle = styled.h3`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.3rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 10px;
`;

const ModalText = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text-muted); line-height: 1.65; margin-bottom: 20px;
`;

const ModalFeatures = styled.ul`
  list-style: none; display: flex; flex-direction: column;
  gap: 8px; margin-bottom: 24px;
`;

const ModalFeature = styled.li`
  display: flex; align-items: center; gap: 10px;
  font-family: var(--font-body); font-size: .85rem; color: #1A1A1A;
  svg { color: var(--color-accent); flex-shrink: 0; }
`;

const ModalCTA = styled.button`
  width: 100%; padding: 13px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: .07em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover { filter: brightness(.9); }
`;

const ModalNote = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: #A0ADB8; text-align: center; margin-top: 10px;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardHome() {
  const { profile, user, refreshProfile } = useAuthContext();
  const { brand, pricing, places }        = useIndustry();

  const [selectedPlace, setSelectedPlace] = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [savedMsg,      setSavedMsg]      = useState('');
  const [showModal,     setShowModal]     = useState(false);
  const [resetting,     setResetting]     = useState(false);

  const apiKey            = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;
  const hasBusiness       = !!profile?.google_place_id;
  const score             = profile?.visibility_score ?? null;

  /* ── Save business from autocomplete ── */
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

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      await supabase.from('user_profiles').update({
        google_place_id:     pd.place_id,
        company_name:        pd.name,
        city,
        google_rating:       pd.rating       || null,
        google_review_count: pd.user_ratings_total || null,
        visibility_score:    calc,
      }).eq('id', currentUser.id);

      await refreshProfile();
      setSavedMsg(pd.name);
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  /* ── Reset business link ── */
  const handleReset = async () => {
    setResetting(true);
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    await supabase.from('user_profiles').update({
      google_place_id:     null,
      company_name:        null,
      google_rating:       null,
      google_review_count: null,
      visibility_score:    null,
    }).eq('id', currentUser.id);
    setSelectedPlace(null);
    setSavedMsg('');
    await refreshProfile();
    setResetting(false);
  };

  return (
    <>
      {/* ── GMB MODAL ── */}
      {showModal && (
        <ModalOverlay onClick={() => setShowModal(false)}>
          <Modal onClick={e => e.stopPropagation()}>
            <ModalClose onClick={() => setShowModal(false)}>
              <X size={18} />
            </ModalClose>
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

      {/* ── SCORE BANNER ── */}
      {hasBusiness && score !== null && (
        <ScoreBanner $s={score}>
          <ScoreLeft>
            <ScoreCircle $s={score}>{score}</ScoreCircle>
            <ScoreText>
              <ScoreTitle>
                Dein Profil ist <strong>{scoreLabel(score)}</strong>.
              </ScoreTitle>
              <ScoreSub>
                {profile?.company_name || 'Dein Betrieb'} hat Optimierungspotenzial —
                jetzt beheben und mehr Anfragen bekommen.
              </ScoreSub>
            </ScoreText>
          </ScoreLeft>
          <OptBtn to="/dashboard/einstellungen">
            Jetzt optimieren <ArrowRight size={13} />
          </OptBtn>
        </ScoreBanner>
      )}

      {/* ── METRICS (only if business linked) ── */}
      {hasBusiness && (
        <Grid>
          <MetricCard $d="0s">
            <MetricLabel>Sichtbarkeits-Score</MetricLabel>
            <MetricValue $c={score !== null ? scoreColor(score) : undefined}>
              {score ?? '—'}<span style={{ fontSize:'1rem', opacity:.4 }}>/100</span>
            </MetricValue>
            <MetricSub>{score !== null ? scoreLabel(score) : 'Nicht berechnet'}</MetricSub>
          </MetricCard>

          <MetricCard $d=".05s">
            <MetricLabel>Ø Bewertung</MetricLabel>
            <MetricValue>
              {profile?.google_rating
                ? profile.google_rating.toFixed(1)
                : '—'}
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
            <MetricLabel>Monatl. Potenzial</MetricLabel>
            <MetricValue $c="var(--color-accent)">
              +{(pricing.roi.avgOrderValue * 5).toLocaleString('de-DE')}€
            </MetricValue>
            <MetricSub>bei optimiertem Profil</MetricSub>
          </MetricCard>
        </Grid>
      )}

      {/* ── ONBOARDING / BUSINESS CARD ── */}
      <SCard $d={hasBusiness ? '.2s' : '0s'}
        style={!hasBusiness ? { borderTop: `4px solid var(--color-accent)` } : {}}>

        {!hasBusiness ? (
          /* ── STATE: KEINE VERKNÜPFUNG ── */
          <>
            <StepBadge>Schritt 1 von 1</StepBadge>
            <SCardTitle>Welches ist dein Betrieb?</SCardTitle>
            <SCardSub>
              Verknüpfe deinen Google Business-Eintrag — dann analysieren wir
              deinen aktuellen Stand und zeigen dir, was du verbessern kannst.
            </SCardSub>

            <AcWrap2>
              <SearchIcon><Search size={15} /></SearchIcon>
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
                  <p style={{ padding:'12px', color:'#D93025',
                    fontFamily:'var(--font-body)', fontSize:'.85rem' }}>
                    ⚠ REACT_APP_GOOGLE_PLACES_API_KEY fehlt
                  </p>
                )}
              </AcWrap>
            </AcWrap2>

            <SaveBtn
              onClick={handleSave}
              disabled={!selectedPlace || saving}
            >
              {saving
                ? <><Loader size={14} className="spin" />Wird gespeichert…</>
                : <>Betrieb speichern <ArrowRight size={14} /></>
              }
            </SaveBtn>
          </>
        ) : (
          /* ── STATE: BETRIEB VERKNÜPFT ── */
          <>
            <SCardTitle>Dein verknüpfter Betrieb</SCardTitle>
            <LinkedCard>
              <LinkedIcon>
                <CheckCircle size={22} />
              </LinkedIcon>
              <LinkedInfo>
                <LinkedName>
                  {profile?.company_name || 'Betrieb verknüpft'}
                </LinkedName>
                <LinkedMeta>
                  {profile?.city && (
                    <MetaChip>
                      <MapPin size={11} color="var(--color-accent)" />
                      {profile.city}
                    </MetaChip>
                  )}
                  {profile?.google_rating && (
                    <MetaChip>
                      <Star size={11} color="var(--color-accent)" />
                      {profile.google_rating.toFixed(1)} Sterne
                    </MetaChip>
                  )}
                  {score !== null && (
                    <MetaChip>
                      Score: <strong style={{ color: scoreColor(score) }}>
                        {score}/100
                      </strong>
                    </MetaChip>
                  )}
                </LinkedMeta>
              </LinkedInfo>
              <ResetBtn
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? 'Wird zurückgesetzt…' : 'Ändern'}
              </ResetBtn>
            </LinkedCard>
          </>
        )}
      </SCard>

      {/* ── GMB BRIDGE ── */}
      <GMBCard $d={hasBusiness ? '.25s' : '.1s'}>
        <GMBBadge><PulseDot /> Vorbereitung</GMBBadge>
        <GMBTitle>Google Business Profil verknüpfen</GMBTitle>
        <GMBSub>
          Verknüpfe deinen Google Business Account, damit {brand.name} dein
          Profil direkt optimieren, Bewertungen verwalten und Beiträge posten
          kann — vollautomatisch.
        </GMBSub>
        <GMBBtn onClick={() => setShowModal(true)}>
          <Link2 size={15} />
          Google Business Profil verknüpfen
        </GMBBtn>
        <p style={{
          fontFamily: 'var(--font-body)', fontSize: '.7rem',
          color: 'rgba(255,255,255,.3)', marginTop: 10,
        }}>
          Wird in Phase 2 via Google Business Profile API aktiviert.
        </p>
      </GMBCard>
    </>
  );
}
