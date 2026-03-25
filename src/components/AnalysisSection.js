import React, { useState } from 'react';
import styled, { keyframes, css } from 'styled-components';
import {
  Star, AlertTriangle, MessageSquare, Globe, MapPin,
  CheckCircle, ChevronRight, Loader, RotateCcw
} from 'lucide-react';
import {
  scoreColor, scoreBg, scoreLabel, buildAlerts, SCAN_STEPS
} from '../hooks/usePlacesAnalysis';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp  = keyframes`from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const scanBar = keyframes`0%{width:0%}85%{width:90%}100%{width:100%}`;
const pulse   = keyframes`0%,100%{opacity:1}50%{opacity:.35}`;
const spin    = keyframes`to{transform:rotate(360deg)}`;

/* ─────────────────────────────────────────────
   LAYOUT
───────────────────────────────────────────── */
const Section = styled.section`
  background: #F2F2F2;
  padding: 80px 24px 100px;
  position: relative;
  /* Scroll margin so sticky header doesn't overlap */
  scroll-margin-top: 0px;
`;

const TopStripe = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 5px;
  background: repeating-linear-gradient(
    90deg,
    #002C51 0px, #002C51 60px,
    #FF8C00 60px, #FF8C00 80px
  );
`;

const Inner = styled.div`
  max-width: 720px;
  margin: 0 auto;
`;

const Eyebrow = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #FF8C00;
  text-align: center;
  margin-bottom: 10px;
`;

const H2 = styled.h2`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: clamp(1.8rem, 3.5vw, 2.5rem);
  text-transform: uppercase;
  color: #002C51;
  text-align: center;
  line-height: 1.05;
  margin-bottom: 8px;
`;

const Accent = styled.span`color: #FF8C00;`;

const SubText = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.9rem;
  color: #5A6A7A;
  text-align: center;
  margin-bottom: 36px;
`;

/* ─────────────────────────────────────────────
   IDLE STATE
───────────────────────────────────────────── */
const IdleBox = styled.div`
  background: white;
  border-top: 5px solid #D0D8E0;
  padding: 48px 32px;
  text-align: center;
  animation: ${fadeIn} 0.4s ease both;
`;

const IdleIcon = styled.div`
  width: 64px; height: 64px;
  background: #F2F2F2;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  color: #D0D8E0;
`;

const IdleText = styled.p`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  text-transform: uppercase;
  color: #A0ADB8;
  letter-spacing: 0.05em;
`;

const IdleSub = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.82rem;
  color: #C0C8D0;
  margin-top: 6px;
`;

/* ─────────────────────────────────────────────
   CARD (shared wrapper)
───────────────────────────────────────────── */
const Card = styled.div`
  background: white;
  border-top: 5px solid #FF8C00;
  animation: ${fadeUp} 0.4s ease both;
`;

const CardBody = styled.div`
  padding: 28px 28px 32px;
  @media (max-width: 560px) { padding: 20px 16px 26px; }
`;

/* ─────────────────────────────────────────────
   SCANNING
───────────────────────────────────────────── */
const LoadHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
`;

const SpinWrap = styled.div`
  color: #FF8C00;
  animation: ${spin} 0.8s linear infinite;
  display: flex;
`;

const LoadTitle = styled.p`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  text-transform: uppercase;
  color: #002C51;
  letter-spacing: 0.04em;
`;

const CompanyPreview = styled.span`
  color: #FF8C00;
`;

const PTrack = styled.div`
  width: 100%; height: 5px;
  background: #E0E8F0;
  overflow: hidden;
  margin-bottom: 16px;
`;

const PFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #FF8C00 0%, #FFB347 100%);
  animation: ${scanBar} 2.9s ease-in-out forwards;
  width: 0%;
`;

const ScanSteps = styled.div`
  display: flex;
  flex-direction: column;
  gap: 9px;
`;

const ScanStep = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.85rem;
  color: ${({ $done }) => $done ? '#1E7E34' : '#6B7E8F'};
  transition: color 0.3s;
`;

const ScanDot = styled.div`
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $done, $active }) => $done ? '#1E7E34' : $active ? '#FF8C00' : '#D0D8E0'};
  ${({ $active }) => $active && css`animation: ${pulse} 0.9s ease infinite;`}
`;

/* ─────────────────────────────────────────────
   RESULT
───────────────────────────────────────────── */
const ResHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
`;

const CoName = styled.h3`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.4rem;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 4px;
  line-height: 1.1;
`;

const CoMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #5A6A7A;
  svg { color: #FF8C00; flex-shrink: 0; }
`;

const ScBadge = styled.div`
  background: ${({ $s }) => scoreBg($s)};
  border: 2px solid ${({ $s }) => scoreColor($s)};
  padding: 8px 14px;
  text-align: center;
  flex-shrink: 0;
  min-width: 82px;
`;

const ScNum = styled.div`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 2rem;
  line-height: 1;
  color: ${({ $s }) => scoreColor($s)};
`;

const ScLbl = styled.div`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #5A6A7A;
  margin-top: 2px;
`;

/* Metrics */
const MGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  background: #D0D8E0;
  margin-bottom: 16px;
`;

const MCell = styled.div`
  background: white;
  padding: 13px 10px;
  text-align: center;
`;

const MVal = styled.div`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 1.45rem;
  color: ${({ $w }) => $w ? '#D93025' : '#002C51'};
  line-height: 1;
  margin-bottom: 3px;
`;

const MLbl = styled.div`
  font-family: 'Barlow', sans-serif;
  font-size: 0.7rem;
  color: #5A6A7A;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const StarsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  justify-content: center;
  margin-bottom: 3px;
`;

/* Alerts */
const AList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
`;

const AItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  background: ${({ $t }) => $t === 'err' ? '#FDECEA' : $t === 'warn' ? '#FFF8E1' : '#E8F5E9'};
  border-left: 3px solid ${({ $t }) =>
    $t === 'err' ? '#D93025' : $t === 'warn' ? '#F5A623' : '#1E7E34'};
`;

const AIco = styled.div`
  color: ${({ $t }) => $t === 'err' ? '#D93025' : $t === 'warn' ? '#D48A00' : '#1E7E34'};
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
`;

const ATit = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.86rem;
  color: #1A1A1A;
  margin-bottom: 1px;
`;

const ADesc = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.77rem;
  color: #5A6A7A;
`;

/* Blur teaser */
const TBlk = styled.div`position: relative; margin-bottom: 18px;`;
const Blur = styled.div`filter: blur(4px); user-select: none; pointer-events: none;`;
const TLock = styled.div`
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
`;

const LPill = styled.div`
  background: #002C51;
  color: white;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 0.82rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  box-shadow: 0 4px 16px rgba(0,0,0,0.22);
`;

/* Lead form */
const Divider = styled.div`height: 1px; background: #D0D8E0; margin: 20px 0 18px;`;

const LTit = styled.h4`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.15rem;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 5px;
`;

const LSub = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.83rem;
  color: #5A6A7A;
  margin-bottom: 14px;
  line-height: 1.55;
`;

const ERow = styled.div`
  display: flex;
  @media (max-width: 500px) { flex-direction: column; }
`;

const EInput = styled.input`
  flex: 1;
  padding: 13px 15px;
  border: 2px solid ${({ $e }) => $e ? '#E53E3E' : '#D0D8E0'};
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
    border-right: 2px solid ${({ $e }) => $e ? '#E53E3E' : '#D0D8E0'};
    border-bottom: none;
  }
`;

const SBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 13px 20px;
  background: ${({ disabled }) => disabled ? '#C07000' : '#FF8C00'};
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: none;
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.2s, transform 0.1s;
  &:hover:not(:disabled) { background: #E07A00; transform: translateY(-1px); }
  .spin { animation: ${spin} 0.8s linear infinite; }
  @media (max-width: 500px) { width: 100%; justify-content: center; }
`;

const FErr = styled.p`
  margin-top: 5px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.76rem;
  color: #E53E3E;
`;

const OkBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: #E8F5E9;
  border-left: 4px solid #1E7E34;
  animation: ${fadeIn} 0.3s ease;
`;

const OkTxt = styled.div`
  font-family: 'Barlow', sans-serif;
  font-size: 0.88rem;
  color: #1A1A1A;
  line-height: 1.5;
  strong { font-weight: 700; display: block; margin-bottom: 2px; }
`;

const RBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #5A6A7A;
  text-decoration: underline;
  text-underline-offset: 2px;
  margin-top: 14px;
  &:hover { color: #002C51; }
`;

const Footnote = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.7rem;
  color: #A0ADB8;
  margin-top: 12px;
  line-height: 1.5;
`;

/* ─────────────────────────────────────────────
   STARS
───────────────────────────────────────────── */
function Stars({ v }) {
  const r = Math.round(v * 2) / 2;
  return (
    <StarsRow>
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={13}
          fill={i <= r ? '#FF8C00' : 'none'}
          color={i <= r ? '#FF8C00' : '#D0D8E0'} />
      ))}
    </StarsRow>
  );
}

/* ─────────────────────────────────────────────
   ALERT ICONS (kept local, no import needed)
───────────────────────────────────────────── */
function alertIcon(i, t) {
  const icons = [AlertTriangle, Globe, MessageSquare, Star, Star];
  const Icon = icons[i] || AlertTriangle;
  return <Icon size={15} />;
}

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
const AnalysisSection = ({ phase, scanStep, result, selectedPlace, onReset, onMarkSent }) => {
  const [email,    setEmail]    = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [sending,  setSending]  = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailErr('Bitte eine gültige E-Mail eingeben.');
      return;
    }
    setEmailErr('');
    setSending(true);
    try {
      await supabase.from('leads').insert([{
        company_name:   result.name,
        contact_person: '-',
        phone:          '-',
        city:           result.city,
        email,
        source:         'smart_check',
        status:         'new',
      }]);
    } catch (e) { console.error(e); }
    setSending(false);
    onMarkSent();
  };

  const alerts = result ? buildAlerts(result) : [];

  return (
    <Section id="analysis">
      <TopStripe />
      <Inner>
        <Eyebrow>Dein Analyse-Ergebnis</Eyebrow>
        <H2>Dein <Accent>Sichtbarkeits-</Accent>Score</H2>
        <SubText>
          {phase === 'idle'
            ? 'Betrieb oben eingeben — hier erscheinen deine Ergebnisse.'
            : phase === 'scanning'
            ? 'Analyse läuft…'
            : `Ergebnis für ${result?.name}`}
        </SubText>

        {/* ── IDLE ── */}
        {phase === 'idle' && (
          <IdleBox>
            <IdleIcon>
              <Star size={28} />
            </IdleIcon>
            <IdleText>Noch kein Betrieb ausgewählt</IdleText>
            <IdleSub>Scroll nach oben und gib deinen Firmennamen ein.</IdleSub>
          </IdleBox>
        )}

        {/* ── SCANNING ── */}
        {phase === 'scanning' && (
          <Card>
            <CardBody>
              <LoadHead>
                <SpinWrap><Loader size={20} /></SpinWrap>
                <LoadTitle>
                  WERKRUF analysiert{' '}
                  {selectedPlace?.label
                    ? <CompanyPreview>{selectedPlace.label.split(',')[0]}</CompanyPreview>
                    : '…'}
                </LoadTitle>
              </LoadHead>

              <PTrack><PFill /></PTrack>

              <ScanSteps>
                {SCAN_STEPS.map((s, i) => (
                  <ScanStep key={i} $done={i < scanStep}>
                    <ScanDot
                      $done={i < scanStep}
                      $active={i === scanStep - 1 && phase === 'scanning'}
                    />
                    {s.lbl(result?.city || '')}
                    {i < scanStep && (
                      <CheckCircle size={12}
                        style={{ marginLeft: 4, color: '#1E7E34', flexShrink: 0 }} />
                    )}
                  </ScanStep>
                ))}
              </ScanSteps>
            </CardBody>
          </Card>
        )}

        {/* ── RESULT / SENT ── */}
        {(phase === 'result' || phase === 'sent') && result && (
          <Card>
            <CardBody>
              <ResHead>
                <div>
                  <CoName>{result.name}</CoName>
                  <CoMeta>
                    {result.city && <Chip><MapPin size={11} />{result.city}</Chip>}
                    {result.hasWebsite && <Chip><Globe size={11} />Website vorhanden</Chip>}
                  </CoMeta>
                </div>
                <ScBadge $s={result.score}>
                  <ScNum $s={result.score}>{result.score}</ScNum>
                  <ScLbl>/ 100 · {scoreLabel(result.score)}</ScLbl>
                </ScBadge>
              </ResHead>

              {/* Real metrics */}
              <MGrid>
                <MCell>
                  {result.rating > 0
                    ? <Stars v={result.rating} />
                    : <div style={{ fontSize: '.7rem', color: '#D93025', marginBottom: 3 }}>KEIN RATING</div>
                  }
                  <MVal $w={result.rating > 0 && result.rating < 4.0}>
                    {result.rating > 0 ? result.rating.toFixed(1) : '—'}
                  </MVal>
                  <MLbl>Ø Bewertung</MLbl>
                </MCell>
                <MCell>
                  <MVal $w={result.reviewCount < 10}>{result.reviewCount}</MVal>
                  <MLbl>Rezensionen</MLbl>
                </MCell>
                <MCell>
                  <MVal $w={result.unanswered > 0}>{result.unanswered}</MVal>
                  <MLbl>Ohne Antwort*</MLbl>
                </MCell>
              </MGrid>

              {/* Alerts */}
              <AList>
                {alerts.slice(0, 2).map((a, i) => (
                  <AItem key={i} $t={a.t}>
                    <AIco $t={a.t}>{alertIcon(i, a.t)}</AIco>
                    <div>
                      <ATit>{a.title}</ATit>
                      <ADesc>{a.desc}</ADesc>
                    </div>
                  </AItem>
                ))}

                {alerts.length > 2 && phase !== 'sent' && (
                  <TBlk>
                    <Blur>
                      {alerts.slice(2).map((a, i) => (
                        <AItem key={i} $t={a.t}
                          style={{ marginBottom: i < alerts.slice(2).length - 1 ? 8 : 0 }}>
                          <AIco $t={a.t}>{alertIcon(i + 2, a.t)}</AIco>
                          <div><ATit>{a.title}</ATit><ADesc>{a.desc}</ADesc></div>
                        </AItem>
                      ))}
                    </Blur>
                    <TLock>
                      <LPill>
                        <ChevronRight size={13} />
                        {alerts.length - 2} weitere Befunde im PDF-Report
                      </LPill>
                    </TLock>
                  </TBlk>
                )}
              </AList>

              {/* Lead form */}
              {phase === 'result' && (
                <>
                  <Divider />
                  <LTit>Dein vollständiger 4-seitiger Report</LTit>
                  <LSub>
                    Wohin sollen wir deinen persönlichen Sichtbarkeits-Report (PDF) schicken?
                    Inkl. Wettbewerber-Analyse, Umsatzpotenzial und konkreten Maßnahmen.
                  </LSub>
                  <ERow>
                    <EInput
                      type="email"
                      placeholder="deine@email.de"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setEmailErr(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                      $e={!!emailErr}
                    />
                    <SBtn onClick={handleSubmit} disabled={sending}>
                      {sending
                        ? <><Loader size={15} className="spin" />Wird gesendet…</>
                        : <>Kostenlosen Report anfordern<ChevronRight size={15} /></>
                      }
                    </SBtn>
                  </ERow>
                  {emailErr && <FErr>{emailErr}</FErr>}
                </>
              )}

              {/* Success */}
              {phase === 'sent' && (
                <>
                  <Divider />
                  <OkBox>
                    <CheckCircle size={26} color="#1E7E34"
                      style={{ flexShrink: 0, marginTop: 2 }} />
                    <OkTxt>
                      <strong>Report wird vorbereitet!</strong>
                      Wir schicken deinen Sichtbarkeits-Report für{' '}
                      <em>{result.name}</em> in 48h an {email}.
                    </OkTxt>
                  </OkBox>
                </>
              )}

              <div style={{ textAlign: 'right' }}>
                <RBtn onClick={onReset}>
                  <RotateCcw size={12} /> Anderen Betrieb prüfen
                </RBtn>
              </div>

              {phase === 'result' && (
                <Footnote>
                  * Geschätzter Wert basierend auf öffentlichen Google-Daten.
                  Exakte Zahlen im vollständigen Report.
                </Footnote>
              )}
            </CardBody>
          </Card>
        )}
      </Inner>
    </Section>
  );
};

export default AnalysisSection;
