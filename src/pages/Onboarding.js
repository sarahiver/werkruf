import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, Search, Building2, Zap } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';
import PlacesSearch from '../components/PlacesSearch';
import { extractCity, calcScore } from '../hooks/usePlacesAnalysis';
import supabase from '../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

const Page = styled.div`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex; align-items: center; justify-content: center;
  padding: 40px 24px;
  position: relative; overflow: hidden;
`;

const Grid = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb),.04) 1px, transparent 1px);
  background-size: 48px 48px;
`;

const AccentBar = styled.div`
  position: absolute; top: 0; right: 0;
  width: 5px; height: 100%; background: var(--color-accent);
`;

const Card = styled.div`
  background: var(--color-white);
  border-radius: var(--radius-card);
  border-top: 5px solid var(--color-accent);
  width: 100%; max-width: 540px;
  padding: 40px 36px;
  position: relative; z-index: 1;
  animation: ${fadeUp} .5s ease both;
`;

const StepRow = styled.div`
  display: flex; gap: 8px; margin-bottom: 28px;
`;
const StepBar = styled.div`
  flex: 1; height: 4px; border-radius: 2px;
  background: ${({ $done, $active }) =>
    $done ? '#1E7E34' : $active ? 'var(--color-accent)' : 'var(--color-border)'};
  transition: background .3s;
`;

const Logo = styled.p`
  font-family: var(--font-display); font-weight: 900;
  font-size: .85rem; letter-spacing: 3px; text-transform: uppercase;
  color: var(--color-primary); margin-bottom: 6px;
`;

const StepBadge = styled.span`
  display: inline-block;
  background: rgba(var(--color-accent-rgb),.1);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .7rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-button);
  margin-bottom: 12px;
`;

const Title = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.5rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 8px;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text-muted); line-height: 1.6; margin-bottom: 24px;
`;

const NextBtn = styled.button`
  width: 100%; padding: 14px;
  background: ${({ $ghost }) => $ghost ? 'none' : 'var(--color-accent)'};
  color: ${({ $ghost }) => $ghost ? 'var(--color-text-muted)' : 'white'};
  border: ${({ $ghost }) => $ghost ? '1px solid var(--color-border)' : 'none'};
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .95rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border-radius: var(--radius-button); cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: ${({ $ghost }) => $ghost ? 'none' : '0 4px 16px rgba(var(--color-accent-rgb),.35)'};
  transition: filter .2s, transform .1s;
  margin-top: 12px;
  &:hover:not(:disabled) { filter: brightness(.9); transform: translateY(-1px); }
  &:disabled { opacity: .5; cursor: not-allowed; transform: none; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const FeatureList = styled.div`
  display: flex; flex-direction: column; gap: 10px; margin: 20px 0;
`;
const FeatureItem = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: var(--color-bg); border-radius: var(--radius-card);
`;
const FeatureIcon = styled.div`
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--color-primary); color: var(--color-accent);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
`;
const FeatureText = styled.div``;
const FeatureName = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .88rem; color: var(--color-primary);
`;
const FeatureDesc = styled.p`
  font-family: var(--font-body); font-size: .75rem; color: var(--color-text-muted); margin-top: 1px;
`;

const ScorePreview = styled.div`
  text-align: center; padding: 24px;
  background: var(--color-bg); border-radius: var(--radius-card);
  margin: 20px 0;
`;
const ScoreNum = styled.div`
  font-family: var(--font-display); font-weight: 900;
  font-size: 4rem; line-height: 1;
  color: ${({ $s }) => $s >= 70 ? '#1E7E34' : $s >= 45 ? '#D48A00' : '#D93025'};
`;
const ScoreLabel = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-top: 6px;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Onboarding() {
  const { user, refreshProfile } = useAuthContext();
  const { brand, places }        = useIndustry();
  const navigate                 = useNavigate();

  const [step,     setStep]     = useState(1); // 1=welcome, 2=search, 3=score
  const [selected, setSelected] = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [score,    setScore]    = useState(null);
  const [showManual, setShowManual] = useState(false);

  const handlePlaceSelect = async (result) => {
    if (!result) return;
    setSelected(result);

    // Calculate score immediately
    const s = calcScore({
      rating:      result.rating      || 0,
      reviewCount: result.reviewCount || 0,
      hasWebsite:  result.hasWebsite  || false,
    });
    setScore(s);
    setStep(3);

    // Save to profile
    setSaving(true);
    try {
      const city = extractCity(result.addressComponents || []);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token && user?.id) {
        await fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':  'application/json',
              'apikey':        process.env.REACT_APP_SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${token}`,
              'Prefer':        'return=minimal',
            },
            body: JSON.stringify({
              google_place_id:     result.placeId,
              company_name:        result.name,
              city,
              google_rating:       result.rating      || null,
              google_review_count: result.reviewCount || null,
              visibility_score:    s,
            }),
          }
        );
      }
    } catch (err) {
      console.error('Onboarding save error:', err);
    }
    setSaving(false);
  };

  const goToDashboard = async () => {
    await refreshProfile();
    navigate('/dashboard');
  };

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || 'dir';

  return (
    <Page>
      <Grid />
      <AccentBar />
      <Card>
        <Logo>{brand.name}</Logo>

        {/* Step indicator */}
        <StepRow>
          {[1,2,3].map(s => (
            <StepBar key={s} $done={step > s} $active={step === s} />
          ))}
        </StepRow>

        {/* ── STEP 1: Welcome ── */}
        {step === 1 && (
          <>
            <StepBadge>Schritt 1 von 3</StepBadge>
            <Title>Willkommen,{'\n'}{firstName}!</Title>
            <Sub>
              In 2 Minuten siehst du wie gut dein Betrieb bei Google dasteht —
              und was wir verbessern können.
            </Sub>

            <FeatureList>
              <FeatureItem>
                <FeatureIcon><Search size={16} /></FeatureIcon>
                <FeatureText>
                  <FeatureName>Sichtbarkeits-Score</FeatureName>
                  <FeatureDesc>Wie gut findest du bei Google?</FeatureDesc>
                </FeatureText>
              </FeatureItem>
              <FeatureItem>
                <FeatureIcon><Zap size={16} /></FeatureIcon>
                <FeatureText>
                  <FeatureName>Konkrete Verbesserungen</FeatureName>
                  <FeatureDesc>Was kostet dich gerade Kunden?</FeatureDesc>
                </FeatureText>
              </FeatureItem>
              <FeatureItem>
                <FeatureIcon><CheckCircle size={16} /></FeatureIcon>
                <FeatureText>
                  <FeatureName>Persönlicher Fahrplan</FeatureName>
                  <FeatureDesc>4-seitiges PDF zum Download</FeatureDesc>
                </FeatureText>
              </FeatureItem>
            </FeatureList>

            <NextBtn onClick={() => setStep(2)}>
              Los geht's <ArrowRight size={16} />
            </NextBtn>
          </>
        )}

        {/* ── STEP 2: Search ── */}
        {step === 2 && (
          <>
            <StepBadge>Schritt 2 von 3</StepBadge>
            <Title>Welches ist dein Betrieb?</Title>
            <Sub>
              Suche deinen Google Business Eintrag — wir analysieren
              deinen aktuellen Stand in Sekunden.
            </Sub>

            <PlacesSearch
              onSelect={handlePlaceSelect}
              onNoResults={() => setShowManual(true)}
              placeholder={places.searchPlaceholder || 'z.B. Sanitär Müller Hamburg…'}
              dark={false}
            />

            {showManual && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '.82rem',
                  color: 'var(--color-text-muted)', marginBottom: 10 }}>
                  Noch kein Google Business Profil? Kein Problem —
                  wir richten es für dich ein.
                </p>
                <NextBtn onClick={goToDashboard} $ghost>
                  Trotzdem weiter zum Dashboard
                </NextBtn>
              </div>
            )}

            <NextBtn $ghost onClick={() => setStep(1)} style={{ marginTop: 8 }}>
              ← Zurück
            </NextBtn>
          </>
        )}

        {/* ── STEP 3: Score ── */}
        {step === 3 && selected && (
          <>
            <StepBadge>Schritt 3 von 3</StepBadge>
            <Title>Dein Ergebnis ist da!</Title>

            <ScorePreview>
              <ScoreNum $s={score}>{score}</ScoreNum>
              <ScoreLabel>
                von 100 Punkten · {score >= 70 ? 'Gut' : score >= 45 ? 'Ausbaufähig' : 'Kritisch'}
              </ScoreLabel>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '.88rem',
                color: 'var(--color-text)', marginTop: 12, lineHeight: 1.6 }}>
                <strong>{selected.name}</strong>
                {score < 70 && ' — hier lassen wir Kunden liegen. Wir können das ändern.'}
                {score >= 70 && ' — guter Start! Wir können noch mehr rausholen.'}
              </p>
            </ScorePreview>

            <NextBtn onClick={goToDashboard} disabled={saving}>
              {saving
                ? <><span className="spin">◌</span> Wird gespeichert…</>
                : <>Dashboard öffnen <ArrowRight size={16} /></>
              }
            </NextBtn>

            <p style={{ fontFamily: 'var(--font-body)', fontSize: '.72rem',
              color: '#A0ADB8', textAlign: 'center', marginTop: 10 }}>
              30 Tage kostenlos testen · dann 49€/Monat · jederzeit kündbar
            </p>
          </>
        )}
      </Card>
    </Page>
  );
}
