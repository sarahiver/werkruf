import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import {
  Star, AlertTriangle, MessageSquare, Globe, MapPin,
  CheckCircle, ChevronRight, Loader, RotateCcw, TrendingUp
} from 'lucide-react';
import {
  scoreColor, scoreBg, scoreLabel,
  buildAlerts, SCAN_STEPS, saveLeadToSupabase,
} from '../hooks/usePlacesAnalysis';
import { useIndustry } from '../context/IndustryContext';

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp  = keyframes`from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const scanBar = keyframes`0%{width:0%}85%{width:90%}100%{width:100%}`;
const pulse   = keyframes`0%,100%{opacity:1}50%{opacity:.35}`;
const spin    = keyframes`to{transform:rotate(360deg)}`;
const stampIn = keyframes`
  0%  { opacity:0; transform:scale(1.3) rotate(-4deg); }
  60% { opacity:1; transform:scale(0.97) rotate(1deg); }
  100%{ opacity:1; transform:scale(1) rotate(0deg); }
`;

/* ─────────────────────────────────────────────
   STYLES — CSS vars throughout
───────────────────────────────────────────── */
const Section = styled.section`
  background: var(--color-bg);
  padding: 80px 24px 100px;
  position: relative;
`;

const TopStripe = styled.div`
  position: absolute; top:0; left:0; right:0; height:5px;
  background: repeating-linear-gradient(
    90deg,
    var(--color-primary) 0px, var(--color-primary) 60px,
    var(--color-accent) 60px, var(--color-accent) 80px
  );
  display: ${({ $show }) => $show ? 'block' : 'none'};
`;

const Inner = styled.div`max-width:720px;margin:0 auto;`;

const Eyebrow = styled.p`
  font-family: var(--font-body); font-weight:700; font-size:.72rem;
  letter-spacing:.18em; text-transform:uppercase;
  color: var(--color-accent); text-align:center; margin-bottom:10px;
`;

const H2 = styled.h2`
  font-size: clamp(1.8rem,3.5vw,2.5rem);
  color: var(--color-primary); text-align:center;
  line-height:1.05; margin-bottom:8px;
  text-transform: var(--text-transform);
`;

const Accent = styled.span`color: var(--color-accent);`;

const SubText = styled.p`
  font-family: var(--font-body); font-size:.9rem;
  color: var(--color-text-muted); text-align:center; margin-bottom:36px;
`;

/* Idle */
const IdleBox = styled.div`
  background: var(--color-white);
  border-top: 5px solid var(--color-border);
  border-radius: var(--radius-card);
  padding:48px 32px; text-align:center;
  animation: ${fadeIn} .4s ease both;
`;
const IdleIcon = styled.div`
  width:56px;height:56px;background:var(--color-bg);border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  margin:0 auto 14px;color:var(--color-border);
`;
const IdleTxt = styled.p`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.05rem;text-transform:var(--text-transform);
  color:#A0ADB8;letter-spacing:.05em;
`;
const IdleSub = styled.p`
  font-family:var(--font-body);font-size:.8rem;color:#C0C8D0;margin-top:5px;
`;

/* Card */
const Card = styled.div`
  background: var(--color-white);
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  animation: ${fadeUp} .4s ease both;
`;
const CardBody = styled.div`
  padding:28px 28px 32px;
  @media(max-width:560px){padding:20px 16px 26px;}
`;

/* Scan */
const LoadHead = styled.div`display:flex;align-items:center;gap:10px;margin-bottom:18px;`;
const SpinWrap = styled.div`color:var(--color-accent);animation:${spin} .8s linear infinite;display:flex;`;
const LoadTitle = styled.p`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.1rem;text-transform:var(--text-transform);
  color:var(--color-primary);letter-spacing:.04em;
`;
const PlacePreview = styled.span`color:var(--color-accent);`;
const PTrack = styled.div`width:100%;height:5px;background:var(--color-border);overflow:hidden;margin-bottom:16px;`;
const PFill = styled.div`
  height:100%;
  background:linear-gradient(90deg, var(--color-accent) 0%, rgba(var(--color-accent-rgb),.6) 100%);
  animation:${scanBar} 2.9s ease-in-out forwards;width:0%;
`;
const ScanSteps = styled.div`display:flex;flex-direction:column;gap:9px;`;
const ScanStep = styled.div`
  display:flex;align-items:center;gap:9px;
  font-family:var(--font-body);font-size:.85rem;
  color:${({ $d }) => $d ? '#1E7E34' : 'var(--color-text-muted)'};
  transition:color .3s;
`;
const ScanDot = styled.div`
  width:7px;height:7px;border-radius:50%;flex-shrink:0;
  background:${({ $d,$a }) => $d ? '#1E7E34' : $a ? 'var(--color-accent)' : 'var(--color-border)'};
  ${({ $a }) => $a && css`animation:${pulse} .9s ease infinite;`}
`;

/* Result header */
const ResHead = styled.div`
  display:flex;align-items:flex-start;justify-content:space-between;
  gap:16px;margin-bottom:18px;flex-wrap:wrap;
`;
const CoName = styled.h3`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.4rem;text-transform:var(--text-transform);
  color:var(--color-primary);margin-bottom:4px;line-height:1.1;
`;
const CoMeta = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;`;
const Chip = styled.span`
  display:inline-flex;align-items:center;gap:4px;
  font-family:var(--font-body);font-size:.78rem;color:var(--color-text-muted);
  svg{color:var(--color-accent);flex-shrink:0;}
`;
const ScBadge = styled.div`
  background:${({ $s }) => scoreBg($s)};
  border:2px solid ${({ $s }) => scoreColor($s)};
  border-radius:var(--radius-card);
  padding:8px 14px;text-align:center;flex-shrink:0;min-width:82px;
`;
const ScNum = styled.div`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:2rem;line-height:1;color:${({ $s }) => scoreColor($s)};
`;
const ScLbl = styled.div`
  font-family:var(--font-body);font-weight:700;font-size:.6rem;
  letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);margin-top:2px;
`;

/* Metrics */
const MGrid = styled.div`display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:var(--color-border);margin-bottom:16px;`;
const MCell = styled.div`background:var(--color-white);padding:13px 10px;text-align:center;`;
const MVal = styled.div`
  font-family:var(--font-display);font-weight:var(--heading-weight);font-size:1.45rem;
  color:${({ $w }) => $w ? '#D93025' : 'var(--color-primary)'};line-height:1;margin-bottom:3px;
`;
const MLbl = styled.div`font-family:var(--font-body);font-size:.7rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.06em;`;
const StarsRow = styled.div`display:flex;align-items:center;gap:2px;justify-content:center;margin-bottom:3px;`;

/* Alerts */
const AList = styled.div`display:flex;flex-direction:column;gap:8px;margin-bottom:18px;`;
const AItem = styled.div`
  display:flex;align-items:flex-start;gap:10px;padding:11px 13px;
  background:${({ $t }) => $t==='err'?'#FDECEA':$t==='warn'?'#FFF8E1':'#E8F5E9'};
  border-left:3px solid ${({ $t }) => $t==='err'?'#D93025':$t==='warn'?'#F5A623':'#1E7E34'};
`;
const AIco = styled.div`color:${({ $t }) => $t==='err'?'#D93025':$t==='warn'?'#D48A00':'#1E7E34'};flex-shrink:0;margin-top:1px;display:flex;`;
const ATit = styled.p`font-family:var(--font-body);font-weight:700;font-size:.86rem;color:#1A1A1A;margin-bottom:1px;`;
const ADesc = styled.p`font-family:var(--font-body);font-size:.77rem;color:var(--color-text-muted);`;

/* Blur teaser */
const TBlk = styled.div`position:relative;margin-bottom:18px;`;
const Blur = styled.div`filter:blur(4px);user-select:none;pointer-events:none;`;
const TLock = styled.div`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;`;
const LPill = styled.div`
  background:var(--color-primary);color:var(--color-white);
  display:flex;align-items:center;gap:6px;padding:7px 16px;
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.82rem;letter-spacing:.07em;text-transform:uppercase;
  border-radius:var(--radius-button);
  box-shadow:0 4px 16px rgba(var(--color-primary-rgb),.3);
`;

/* Lead form */
const Divider = styled.div`height:1px;background:var(--color-border);margin:20px 0 18px;`;
const LTit = styled.h4`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.15rem;text-transform:var(--text-transform);
  color:var(--color-primary);margin-bottom:5px;
`;
const LSub = styled.p`font-family:var(--font-body);font-size:.83rem;color:var(--color-text-muted);margin-bottom:14px;line-height:1.55;`;
const ERow = styled.div`display:flex;@media(max-width:500px){flex-direction:column;}`;
const EInput = styled.input`
  flex:1;padding:13px 15px;
  border:2px solid ${({ $e }) => $e?'#E53E3E':'var(--color-border)'};
  border-right:none;background:var(--color-white);
  font-family:var(--font-body);font-size:.95rem;color:var(--color-text);
  outline:none;border-radius:var(--radius-card) 0 0 var(--radius-card);
  transition:border-color .2s;
  &:focus{border-color:var(--color-primary);}
  &::placeholder{color:#A0ADB8;}
  @media(max-width:500px){
    border-right:2px solid ${({ $e }) => $e?'#E53E3E':'var(--color-border)'};
    border-bottom:none;
    border-radius:var(--radius-card) var(--radius-card) 0 0;
  }
`;
const SBtn = styled.button`
  display:flex;align-items:center;gap:7px;padding:13px 20px;
  background:${({ disabled }) => disabled?'rgba(var(--color-accent-rgb),.6)':'var(--color-accent)'};
  color:var(--color-white);font-family:var(--font-display);
  font-weight:var(--heading-weight);font-size:.95rem;
  letter-spacing:.06em;text-transform:var(--text-transform);
  border:none;flex-shrink:0;
  cursor:${({ disabled }) => disabled?'not-allowed':'pointer'};
  white-space:nowrap;
  border-radius:0 var(--radius-button) var(--radius-button) 0;
  transition:background .2s,transform .1s;
  &:hover:not(:disabled){filter:brightness(0.9);transform:translateY(-1px);}
  .spin{animation:${spin} .8s linear infinite;}
  @media(max-width:500px){width:100%;justify-content:center;border-radius:0 0 var(--radius-button) var(--radius-button);}
`;
const FErr = styled.p`margin-top:5px;font-family:var(--font-body);font-size:.76rem;color:#E53E3E;`;

/* Success */
const SuccessWrap = styled.div`animation:${fadeIn} .3s ease both;`;
const SuccessStamp = styled.div`
  display:inline-flex;align-items:center;gap:12px;
  background:var(--color-primary);padding:16px 20px;
  border-radius:var(--radius-card);
  margin-bottom:20px;width:100%;
  animation:${stampIn} .5s cubic-bezier(.22,1,.36,1) both;
`;
const SuccessIcon = styled.div`
  width:44px;height:44px;background:var(--color-accent);
  border-radius:var(--radius-button);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
`;
const SuccessTitle = styled.p`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1.2rem;text-transform:var(--text-transform);
  color:var(--color-white);letter-spacing:.04em;line-height:1.1;
`;
const SuccessSub = styled.p`font-family:var(--font-body);font-size:.82rem;color:rgba(255,255,255,.62);margin-top:3px;line-height:1.5;`;

/* Upsell */
const UpsellBox = styled.div`
  background:rgba(var(--color-accent-rgb),.08);
  border-left:4px solid var(--color-accent);
  border-radius:0 var(--radius-card) var(--radius-card) 0;
  padding:16px 18px;margin-bottom:16px;
`;
const UpsellTitle = styled.p`
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1rem;text-transform:var(--text-transform);
  color:var(--color-primary);margin-bottom:4px;letter-spacing:.03em;
`;
const UpsellText = styled.p`font-family:var(--font-body);font-size:.83rem;color:var(--color-text-muted);line-height:1.55;margin-bottom:12px;`;
const UpsellLink = styled(Link)`
  display:inline-flex;align-items:center;gap:6px;
  padding:10px 20px;background:var(--color-accent);color:var(--color-white);
  font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:.9rem;letter-spacing:.07em;text-transform:var(--text-transform);
  text-decoration:none;border-radius:var(--radius-button);
  transition:filter .2s;
  &:hover{filter:brightness(.9);}
`;

const RBtn = styled.button`
  background:none;border:none;cursor:pointer;
  display:flex;align-items:center;gap:5px;
  font-family:var(--font-body);font-size:.78rem;
  color:var(--color-text-muted);text-decoration:underline;
  text-underline-offset:2px;margin-top:14px;
  &:hover{color:var(--color-primary);}
`;

const Footnote = styled.p`font-family:var(--font-body);font-size:.7rem;color:#A0ADB8;margin-top:12px;line-height:1.5;`;

/* ─────────────────────────────────────────────
   STARS
───────────────────────────────────────────── */
function Stars({ v }) {
  const r = Math.round(v * 2) / 2;
  return (
    <StarsRow>
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={13}
          fill={i <= r ? 'var(--color-accent)' : 'none'}
          color={i <= r ? 'var(--color-accent)' : 'var(--color-border)'} />
      ))}
    </StarsRow>
  );
}

const ALERT_ICONS = [AlertTriangle, Globe, MessageSquare, Star, TrendingUp];
function AlertIcon({ idx }) {
  const Icon = ALERT_ICONS[idx % ALERT_ICONS.length] || AlertTriangle;
  return <Icon size={15} />;
}

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
const AnalysisSection = ({
  phase, scanStep, result, selectedPlace, onReset, onMarkSent,
}) => {
  const { key: industryKey, copy, design } = useIndustry();
  const { analysis: analysisCopy } = copy;

  const navigate = useNavigate();
  const [email,   setEmail]   = useState('');
  const [emailErr,setEmailErr]= useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailErr('Bitte eine gültige E-Mail eingeben.');
      return;
    }
    setEmailErr('');
    setSending(true);
    try {
      await saveLeadToSupabase({ email, result, industryKey });
    } catch (err) {
      console.error('Supabase:', err);
    }
    setSending(false);
    navigate('/success', { state: { email, result } });
  };

  const alerts = result ? buildAlerts(result) : [];
  const scanningName = selectedPlace?.label?.split(',')[0] || '…';

  return (
    <Section id="analysis">
      <TopStripe $show={design.topStripe} />
      <Inner>
        <Eyebrow>{analysisCopy.eyebrow}</Eyebrow>
        <H2>{analysisCopy.title} <Accent>{analysisCopy.titleAccent}</Accent></H2>
        <SubText>
          {phase === 'idle'    ? 'Betrieb oben eingeben — hier erscheinen deine Ergebnisse.'
          : phase === 'scanning' ? `Analysiere ${scanningName}…`
          : result               ? `Ergebnis für ${result.name}`
          : ''}
        </SubText>

        {/* IDLE */}
        {phase === 'idle' && (
          <IdleBox>
            <IdleIcon><Star size={26} /></IdleIcon>
            <IdleTxt>Noch kein Betrieb ausgewählt</IdleTxt>
            <IdleSub>Scroll nach oben und gib deinen Firmennamen ein.</IdleSub>
          </IdleBox>
        )}

        {/* SCANNING */}
        {phase === 'scanning' && (
          <Card>
            <CardBody>
              <LoadHead>
                <SpinWrap><Loader size={20} /></SpinWrap>
                <LoadTitle>
                  WERKRUF analysiert <PlacePreview>{scanningName}</PlacePreview>
                </LoadTitle>
              </LoadHead>
              <PTrack><PFill /></PTrack>
              <ScanSteps>
                {SCAN_STEPS.map((s, i) => (
                  <ScanStep key={i} $d={i < scanStep}>
                    <ScanDot $d={i < scanStep} $a={i === scanStep - 1 && phase === 'scanning'} />
                    {s.lbl(result?.city || '')}
                    {i < scanStep && (
                      <CheckCircle size={12} style={{ marginLeft: 4, color: '#1E7E34', flexShrink: 0 }} />
                    )}
                  </ScanStep>
                ))}
              </ScanSteps>
            </CardBody>
          </Card>
        )}

        {/* RESULT / SENT */}
        {(phase === 'result' || phase === 'sent') && result && (
          <Card>
            <CardBody>
              <ResHead>
                <div>
                  <CoName>{result.name}</CoName>
                  <CoMeta>
                    {result.city && <Chip><MapPin size={11} />{result.city}</Chip>}
                    {result.hasWebsite
                      ? <Chip><Globe size={11} />Website vorhanden</Chip>
                      : <Chip style={{ color: '#D93025' }}><Globe size={11} />Keine Website</Chip>
                    }
                  </CoMeta>
                </div>
                <ScBadge $s={result.score}>
                  <ScNum $s={result.score}>{result.score}</ScNum>
                  <ScLbl>/ 100 · {scoreLabel(result.score)}</ScLbl>
                </ScBadge>
              </ResHead>

              {/* Real Google metrics */}
              <MGrid>
                <MCell>
                  {result.rating > 0
                    ? <Stars v={result.rating} />
                    : <div style={{fontSize:'.7rem',color:'#D93025',marginBottom:3}}>KEIN RATING</div>
                  }
                  <MVal $w={result.rating > 0 && result.rating < 4.0}>
                    {result.rating > 0 ? result.rating.toFixed(1) : '—'}
                  </MVal>
                  <MLbl>Ø Bewertung</MLbl>
                </MCell>
                <MCell>
                  <MVal $w={result.reviewCount < 10}>
                    {result.reviewCount.toLocaleString('de-DE')}
                  </MVal>
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
                    <AIco $t={a.t}><AlertIcon idx={i} /></AIco>
                    <div><ATit>{a.title}</ATit><ADesc>{a.desc}</ADesc></div>
                  </AItem>
                ))}
                {alerts.length > 2 && phase !== 'sent' && (
                  <TBlk>
                    <Blur>
                      {alerts.slice(2).map((a, i) => (
                        <AItem key={i} $t={a.t} style={{ marginBottom: i < alerts.slice(2).length - 1 ? 8 : 0 }}>
                          <AIco $t={a.t}><AlertIcon idx={i + 2} /></AIco>
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
                  <LSub>Wohin sollen wir deinen persönlichen Sichtbarkeits-Report (PDF) schicken?</LSub>
                  <ERow>
                    <EInput
                      type="email" placeholder="deine@email.de"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setEmailErr(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                      $e={!!emailErr}
                    />
                    <SBtn onClick={handleSubmit} disabled={sending}>
                      {sending
                        ? <><Loader size={15} className="spin" />Wird gesendet…</>
                        : <>Report anfordern<ChevronRight size={15} /></>
                      }
                    </SBtn>
                  </ERow>
                  {emailErr && <FErr>{emailErr}</FErr>}
                </>
              )}

              {/* Success — Heavy Duty */}
              {phase === 'sent' && (
                <SuccessWrap>
                  <Divider />
                  <SuccessStamp>
                    <SuccessIcon>
                      <CheckCircle size={24} color="white" />
                    </SuccessIcon>
                    <div>
                      <SuccessTitle>
                        {analysisCopy.successGreeting} Dein persönlicher Report für {result.name} wird erstellt.
                      </SuccessTitle>
                      <SuccessSub>
                        {analysisCopy.successSub} {email}.
                      </SuccessSub>
                    </div>
                  </SuccessStamp>
                  <UpsellBox>
                    <UpsellTitle>{analysisCopy.upsellTitle}</UpsellTitle>
                    <UpsellText>{analysisCopy.upsellText}</UpsellText>
                    <UpsellLink to="/pricing">
                      30 Tage gratis testen <ChevronRight size={14} />
                    </UpsellLink>
                  </UpsellBox>
                </SuccessWrap>
              )}

              <div style={{ textAlign: 'right' }}>
                <RBtn onClick={onReset}><RotateCcw size={12} /> Anderen Betrieb prüfen</RBtn>
              </div>
              {phase === 'result' && (
                <Footnote>* Geschätzter Wert basierend auf öffentlichen Google-Daten.</Footnote>
              )}
            </CardBody>
          </Card>
        )}
      </Inner>
    </Section>
  );
};

export default AnalysisSection;
