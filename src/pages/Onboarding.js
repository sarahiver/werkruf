import React from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, Search, Zap, AlertTriangle } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';
import { clearPublicFunnel } from '../utils/publicFunnel';
import supabase from '../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;

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

/* ── Zustimmung ── */

const Zustimmung = styled.label`
  display: flex; align-items: flex-start; gap: 10px;
  margin-top: 20px; padding: 14px 16px;
  background: var(--color-bg); border-radius: var(--radius-card);
  cursor: pointer;
  font-family: var(--font-body); font-size: .82rem; line-height: 1.55;
  color: var(--color-text);
  input { margin-top: 2px; flex-shrink: 0; width: 17px; height: 17px; accent-color: var(--color-accent); }
  a { color: var(--color-accent); }
`;

const Fehler = styled.p`
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 10px;
  font-family: var(--font-body); font-size: .8rem; line-height: 1.5;
  color: #B3261E;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Onboarding() {
  const { user, profile, refreshProfile } = useAuthContext();
  const { brand }                = useIndustry();
  const navigate                 = useNavigate();

  /*
   * ═══════════════════════════════════════════════════════════
   * DIE ZUSTIMMUNG
   * ═══════════════════════════════════════════════════════════
   *
   * Warum hier und nicht auf der Registrierungsseite:
   *
   * Es gibt zwei Wege in ein Konto — E-Mail mit Bestaetigungslink und
   * Google OAuth. Beim ersten gibt es im Moment des Klicks noch keine
   * Sitzung (die entsteht erst mit dem Link in der Mail), beim zweiten
   * laeuft ein Redirect zu Google dazwischen. Eine Zustimmung ohne
   * Sitzung ist niemandem zuordenbar, und sie durch den Browser zu
   * tragen (Metadaten, sessionStorage) hiesse, genau den Teil in die
   * Hand des Clients zu geben, der nachweisbar sein soll.
   *
   * Diese Seite ist die erste Stelle, die BEIDE Wege erreichen und auf
   * der eine gepruefte Sitzung vorliegt. Deshalb steht der Haken hier
   * — vor der ersten Benutzung, nicht danach.
   *
   * Festgehalten wird serverseitig: accept_terms() nimmt keine
   * user_id und keinen Zeitstempel (Migration 20261013140000). Der
   * Browser sagt nur, welche Fassung er angezeigt hat; weicht sie von
   * der geltenden ab, wird nichts gespeichert.
   *
   * Kein Re-Consent: Wer schon zugestimmt hat, sieht den Haken nicht
   * mehr. Eine neue Fassung fragt NICHT erneut.
   *
   * Hierher kommt man auf zwei Weisen: ueber den Bestaetigungslink
   * nach der Registrierung, und ueber getPostAuthDestination — die
   * Weiche schickt jede Anmeldung ohne accepted_terms_at hierher,
   * einmalig auch bestehende Konten. Sie prueft ausschliesslich das
   * FEHLEN der Zustimmung, nie die Fassung.
   */
  const [fassung, setFassung]   = React.useState(null);
  const [haken, setHaken]       = React.useState(false);
  const [fehler, setFehler]     = React.useState(null);
  const [laeuft, setLaeuft]     = React.useState(false);

  /* Null heisst: noch nicht geladen — dann ist weder "zugestimmt" noch
     "nicht zugestimmt" bekannt, und der Haken bleibt aus. */
  const schonZugestimmt = Boolean(profile?.accepted_terms_at);

  React.useEffect(() => {
    if (schonZugestimmt) return undefined;
    let abgebrochen = false;

    (async () => {
      const { data, error } = await supabase.rpc('current_terms_version');
      if (abgebrochen) return;
      if (error) {
        /* Ohne Fassung wird nicht zugestimmt. Fail closed: Lieber
           eine Fehlermeldung als ein Eintrag ohne Bezug. */
        console.error('[Onboarding] current_terms_version', error.code ?? error.message);
        setFehler('Die geltenden Bedingungen konnten nicht geladen werden. Bitte Seite neu laden.');
        return;
      }
      setFassung(data ?? null);
    })();

    return () => { abgebrochen = true; };
  }, [schonZugestimmt]);

  const goToDashboard = async () => {
      /* Zuerst die Zustimmung, dann weiter. Scheitert sie, bleibt der
         Nutzer hier — ohne Eintrag weitergehen zu lassen waere ein
         Nachweis, den es nicht gibt. */
      if (!schonZugestimmt) {
        setFehler(null);
        setLaeuft(true);
        const { error } = await supabase.rpc('accept_terms', { p_version: fassung });
        setLaeuft(false);

        if (error) {
          console.error('[Onboarding] accept_terms', error.code ?? error.message);
          setFehler('Die Zustimmung konnte nicht gespeichert werden. Bitte noch einmal versuchen.');
          return;
        }
        /* Damit das Profil im Kontext den Eintrag kennt — sonst
           erschiene der Haken beim Zurueckkehren erneut. */
        await refreshProfile?.();
      }

      clearPublicFunnel();
      /* Direkt zur Verbindungsseite statt auf die Dashboard-Startseite.
         Der Landingpage-CTA verspricht die Google-Verbindung; ein
         Zwischenhalt, von dem aus der Nutzer selbst weiterklicken muss,
         waere genau der unnoetige Schritt, den die Umstellung
         beseitigen soll. */
      navigate('/dashboard/google', { replace: true });
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
          <StepBar $active />
        </StepRow>

        {/* ── STEP 1: Welcome ── */}
        {(
          <>
            <StepBadge>Einrichtung</StepBadge>
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
                  <FeatureName>Priorisierte Aufgaben</FeatureName>
                  <FeatureDesc>Nach dem ersten Abgleich siehst du, was als Nächstes zählt</FeatureDesc>
                </FeatureText>
              </FeatureItem>
            </FeatureList>

            {/* Der Haken nur, solange keine Zustimmung vorliegt. Kein
                Rechtstext an dieser Stelle — verlinkt werden die
                Dokumente, die es gibt. */}
            {!schonZugestimmt && (
              <Zustimmung>
                <input
                  type="checkbox"
                  checked={haken}
                  onChange={(e) => { setHaken(e.target.checked); setFehler(null); }}
                />
                <span>
                  Ich habe die{' '}
                  <a href="/datenschutz" target="_blank" rel="noopener noreferrer">
                    Datenschutzerklärung
                  </a>{' '}
                  gelesen und stimme ihr zu. Das{' '}
                  <a href="/impressum" target="_blank" rel="noopener noreferrer">
                    Impressum
                  </a>{' '}
                  nennt den Anbieter.
                </span>
              </Zustimmung>
            )}

            <NextBtn
              onClick={goToDashboard}
              disabled={laeuft || (!schonZugestimmt && (!haken || !fassung))}
            >
              {laeuft ? 'Wird gespeichert…'
                : <>Google-Unternehmensprofil verbinden <ArrowRight size={16} /></>}
            </NextBtn>

            {fehler && (
              <Fehler role="alert"><AlertTriangle size={14} /> {fehler}</Fehler>
            )}
          </>
        )}
      </Card>
    </Page>
  );
}
