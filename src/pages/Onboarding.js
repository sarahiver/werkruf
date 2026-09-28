import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, Search, Zap } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';
import PlacesSearch from '../components/PlacesSearch';
import { calcScore } from '../hooks/usePlacesAnalysis';
import supabase from '../supabaseClient';
import { clearPublicFunnel, loadPublicFunnel } from '../utils/publicFunnel';

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

const ErrorBanner = styled.div`
  margin: 14px 0 0; padding: 11px 14px;
  background: #FDECEA; border-left: 3px solid #D93025;
  border-radius: var(--radius-card); color: #B3261E;
  font-family: var(--font-body); font-size: .82rem; line-height: 1.5;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Onboarding() {
  const { user, refreshProfile } = useAuthContext();
  const { brand, places }        = useIndustry();
  const navigate                 = useNavigate();
  const location                 = useLocation();
  const funnelResult             = location.state?.result || loadPublicFunnel()?.result || null;

  const [step,     setStep]     = useState(funnelResult?.placeId ? 2 : 1); // public selection still requires authorised connection
  const [selected, setSelected] = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [score,    setScore]    = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [saveError, setSaveError] = useState('');

  const saveSelection = async (result) => {
    if (!user?.id) throw new Error('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');

    // This records the user's candidate selection only. It does not persist
    // Google rating/review/address/website data and does not prove ownership.
    const { error } = await supabase
      .from('user_profiles')
      .update({
        google_place_id:     result.placeId,
        company_name:        result.name,
      })
      .eq('id', user.id);

    if (error) throw error;
  };

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !funnelResult?.placeId || !user?.id) return;
    restoredRef.current = true;
    setSaving(true);
    saveSelection(funnelResult)
      .catch((err) => {
        console.error('Onboarding restore save error:', err);
        setSaveError('Dein vorausgewählter Betrieb konnte nicht gespeichert werden. Bitte versuche es erneut.');
      })
      .finally(() => setSaving(false));
  // The persisted selection is intentionally consumed once after OAuth/auth restore.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handlePlaceSelect = async (result) => {
    if (!result) return;
    setSelected(result);

    // Calculate score immediately
    const s = calcScore({
      rating: result.rating,
      reviewCount: result.reviewCount,
      hasWebsite: result.hasWebsite,
      ratingAvailable: result.ratingAvailable,
      reviewCountAvailable: result.reviewCountAvailable,
      websiteAvailable: result.websiteAvailable,
    });
    setScore(s);
    setStep(3);
    setSaveError('');

    // Save to profile
    setSaving(true);
    try {
      await saveSelection(result);
    } catch (err) {
      console.error('Onboarding save error:', err);
      setSaveError('Dein Betrieb konnte nicht gespeichert werden. Bitte versuche es erneut.');
    } finally {
      setSaving(false);
    }
  };

  const retrySave = async () => {
    if (!selected || score === null) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveSelection(selected);
    } catch (err) {
      console.error('Onboarding retry error:', err);
      setSaveError('Speichern weiterhin nicht möglich. Deine Auswahl bleibt erhalten.');
    } finally {
      setSaving(false);
    }
  };

  const goToDashboard = async () => {
    if (saveError) return;
    setSaving(true);
    try {
      await refreshProfile();
      clearPublicFunnel();
      /* Direkt zur Verbindungsseite statt auf die Dashboard-Startseite.
         Der Landingpage-CTA verspricht die Google-Verbindung; ein
         Zwischenhalt, von dem aus der Nutzer selbst weiterklicken muss,
         waere genau der unnoetige Schritt, den die Umstellung
         beseitigen soll. */
      navigate('/dashboard/google');
    } catch (err) {
      console.error('Profile refresh error:', err);
      setSaveError('Dein Profil konnte nicht geladen werden. Bitte versuche es erneut.');
      setSaving(false);
    }
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
              Verbinde dein Google-Unternehmensprofil, bestätige den Standort
              und erhalte danach den tatsächlichen Health Score.
            </Sub>

            <FeatureList>
              <FeatureItem>
                <FeatureIcon><Search size={16} /></FeatureIcon>
                <FeatureText>
                  <FeatureName>Autorisierter Health Score</FeatureName>
                  <FeatureDesc>Erst nach Google-Business-OAuth und Standortbestätigung</FeatureDesc>
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
              {funnelResult?.name ? `${funnelResult.name} ist vorausgewählt. ` : ''}
              Wähle den Eintrag zur Einrichtung. Die Auswahl allein bestätigt keine Verwaltungsberechtigung.
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
                  WERKRUF führt dich durch die Einrichtung.
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
            <Title>Auswahl übernommen</Title>

            <ScorePreview>
              <ScoreNum $s={score}>{score}</ScoreNum>
              <ScoreLabel>
                vorläufiger öffentlicher Profil-Score
              </ScoreLabel>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '.88rem',
                color: 'var(--color-text)', marginTop: 12, lineHeight: 1.6 }}>
                <strong>{selected.name}</strong>
                {' — der tatsächliche Health Score folgt nach autorisierter Profilverknüpfung und Standortbestätigung.'}
              </p>
            </ScorePreview>

            <NextBtn onClick={goToDashboard} disabled={saving || !!saveError}>
              {saving
                ? <><span className="spin">◌</span> Wird gespeichert…</>
                : <>Dashboard öffnen <ArrowRight size={16} /></>
              }
            </NextBtn>

            {saveError && (
              <ErrorBanner role="alert">
                {saveError}
                <NextBtn type="button" $ghost onClick={retrySave} disabled={saving}>
                  {saving ? 'Speichert erneut…' : 'Erneut speichern'}
                </NextBtn>
              </ErrorBanner>
            )}

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
