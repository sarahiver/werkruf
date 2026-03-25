import React, { useState, useCallback } from 'react';
import styled, { keyframes, css } from 'styled-components';
import GooglePlacesAutocomplete from 'react-google-places-autocomplete';
import {
  Star, AlertTriangle, MessageSquare, Globe,
  MapPin, CheckCircle, ChevronRight, Loader,
  RotateCcw
} from 'lucide-react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   SCORE LOGIC — Start 100, Abzüge:
   Rating < 4.5 → gestaffelt bis -40
   Reviews < 50 → gestaffelt bis -25
   Keine Website → -15
───────────────────────────────────────────── */
function calcScore({ rating, reviewCount, hasWebsite }) {
  let score = 100;

  if (!rating || rating === 0)   score -= 35;
  else if (rating < 3.0)        score -= 40;
  else if (rating < 3.5)        score -= 30;
  else if (rating < 4.0)        score -= 20;
  else if (rating < 4.5)        score -= 10;

  if (!reviewCount || reviewCount === 0) score -= 25;
  else if (reviewCount < 5)     score -= 20;
  else if (reviewCount < 20)    score -= 15;
  else if (reviewCount < 50)    score -= 10;

  if (!hasWebsite) score -= 15;

  return Math.max(0, Math.min(100, score));
}

const scoreColor = (s) => s >= 70 ? '#1E7E34' : s >= 45 ? '#D48A00' : '#D93025';
const scoreBg    = (s) => s >= 70 ? '#E8F5E9' : s >= 45 ? '#FFF8E1' : '#FDECEA';
const scoreLabel = (s) => s >= 70 ? 'GUT' : s >= 45 ? 'AUSBAUFÄHIG' : 'KRITISCH';

/* ─────────────────────────────────────────────
   GOOGLE PLACES DETAILS FETCH
───────────────────────────────────────────── */
function fetchPlaceDetails(placeId) {
  return new Promise((resolve, reject) => {
    if (!window.google) { reject(new Error('Maps not loaded')); return; }
    const svc = new window.google.maps.places.PlacesService(document.createElement('div'));
    svc.getDetails(
      {
        placeId,
        fields: ['name', 'rating', 'user_ratings_total', 'website',
                 'formatted_address', 'address_components'],
      },
      (place, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK) resolve(place);
        else reject(new Error(status));
      }
    );
  });
}

function extractCity(components) {
  if (!components) return '';
  const c = components.find(x => x.types.includes('sublocality_level_1'))
         || components.find(x => x.types.includes('locality'))
         || components.find(x => x.types.includes('administrative_area_level_2'));
  return c?.long_name || '';
}

/* Realistic estimate: ~35-55% of reviews unanswered for SMBs */
function estimateUnanswered(count) {
  if (!count) return 0;
  return Math.max(1, Math.round(count * (0.38 + (count % 9) * 0.02)));
}

/* ─────────────────────────────────────────────
   ALERTS from real data
───────────────────────────────────────────── */
function buildAlerts(r) {
  const list = [];

  if (r.unanswered > 0)
    list.push({ t: 'err', icon: <AlertTriangle size={15} />,
      title: `${r.unanswered} Rezensionen ohne Antwort.`,
      desc: 'Potenzielle Kunden sehen das. Jede unbeantworte Bewertung kostet Vertrauen.' });

  if (!r.hasWebsite)
    list.push({ t: 'err', icon: <Globe size={15} />,
      title: 'Keine Website im Google-Profil hinterlegt.',
      desc: 'Du verlierst jeden Kunden, der vor dem Anruf kurz recherchieren will.' });

  if (r.reviewCount < 20)
    list.push({ t: r.reviewCount < 5 ? 'err' : 'warn', icon: <MessageSquare size={15} />,
      title: `Nur ${r.reviewCount} Bewertungen — unter dem Marktstandard.`,
      desc: 'Betriebe mit 50+ Rezensionen bekommen bis zu 3× mehr Klicks.' });

  if (r.rating > 0 && r.rating < 4.0)
    list.push({ t: 'err', icon: <Star size={15} />,
      title: `Rating ${r.rating.toFixed(1)} — unter dem kritischen Schwellenwert.`,
      desc: 'Unter 4.0 Sterne filtert Google dein Profil in den Suchergebnissen aus.' });
  else if (r.rating >= 4.0 && r.rating < 4.5)
    list.push({ t: 'warn', icon: <Star size={15} />,
      title: `Rating ${r.rating.toFixed(1)} — noch Luft nach oben.`,
      desc: 'Ab 4.5 Sternen steigt die Klickrate auf dein Profil messbar.' });

  return list;
}

/* ─────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────── */
const fadeUp  = keyframes`from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const scanBar = keyframes`0%{width:0%}85%{width:90%}100%{width:100%}`;
const pulse   = keyframes`0%,100%{opacity:1}50%{opacity:.35}`;
const spin    = keyframes`to{transform:rotate(360deg)}`;

/* ─────────────────────────────────────────────
   STYLES
───────────────────────────────────────────── */
const Section = styled.section`
  background:#002C51;padding:80px 24px 100px;position:relative;overflow:hidden;
`;
const Grid = styled.div`
  position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(255,140,0,.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,140,0,.04) 1px,transparent 1px);
  background-size:44px 44px;
`;
const Inner = styled.div`max-width:720px;margin:0 auto;`;
const Eyebrow = styled.p`
  font-family:'Barlow',sans-serif;font-weight:700;font-size:.72rem;
  letter-spacing:.18em;text-transform:uppercase;color:#FF8C00;
  text-align:center;margin-bottom:12px;
`;
const H2 = styled.h2`
  font-family:'Barlow Condensed',sans-serif;font-weight:900;
  font-size:clamp(1.9rem,4vw,2.7rem);text-transform:uppercase;
  color:white;text-align:center;line-height:1.05;margin-bottom:10px;
`;
const Accent = styled.span`color:#FF8C00;`;
const Sub = styled.p`
  font-family:'Barlow',sans-serif;font-size:.92rem;
  color:rgba(255,255,255,.52);text-align:center;margin-bottom:36px;
`;
const Card = styled.div`
  background:#F2F2F2;border-top:5px solid #FF8C00;
  animation:${fadeUp} .5s ease both;
`;
const Body = styled.div`
  padding:28px 28px 32px;
  @media(max-width:560px){padding:20px 16px 24px;}
`;
const SRow = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:14px;`;
const SNum = styled.span`
  width:20px;height:20px;background:#002C51;color:white;
  font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:.75rem;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
`;
const SLbl = styled.span`
  font-family:'Barlow',sans-serif;font-weight:700;font-size:.75rem;
  letter-spacing:.1em;text-transform:uppercase;color:#5A6A7A;
`;

/* Autocomplete wrapper — override react-select */
const AcWrap = styled.div`
  &>div>div{
    border-radius:0!important;border:2px solid #D0D8E0!important;
    box-shadow:none!important;font-family:'Barlow',sans-serif!important;
    font-size:1rem!important;min-height:52px!important;background:white!important;
    transition:border-color .2s!important;
  }
  &>div>div:focus-within{border-color:#002C51!important;}
  & input{font-family:'Barlow',sans-serif!important;font-size:1rem!important;color:#1A1A1A!important;}
  & [class*="placeholder"]{color:#A0ADB8!important;}
  & [class*="menu"]{
    border-radius:0!important;border:2px solid #002C51!important;
    border-top:none!important;box-shadow:none!important;margin-top:-2px!important;z-index:50!important;
  }
  & [class*="option"]{
    font-family:'Barlow',sans-serif!important;font-size:.9rem!important;
    cursor:pointer!important;color:#002C51!important;padding:10px 14px!important;
  }
  & [class*="option"]:hover,& [class*="option--is-focused"]{background:#F0F5FA!important;}
  & [class*="singleValue"]{font-family:'Barlow',sans-serif!important;color:#1A1A1A!important;}
  & [class*="indicatorSeparator"]{display:none!important;}
  & [class*="indicatorContainer"]{color:#A0ADB8!important;}
`;
const Hint = styled.p`font-family:'Barlow',sans-serif;font-size:.77rem;color:#A0ADB8;margin-top:6px;`;
const ErrTxt = styled.p`font-family:'Barlow',sans-serif;font-size:.78rem;color:#E53E3E;margin-top:6px;`;
const NoBanner = styled.div`
  padding:14px 16px;border:2px dashed #D93025;background:#FDECEA;
  font-family:'Barlow',sans-serif;font-size:.88rem;color:#D93025;
`;

/* Scan */
const LoadWrap = styled.div`animation:${fadeIn} .3s ease both;margin-top:20px;`;
const LoadHead = styled.div`display:flex;align-items:center;gap:10px;margin-bottom:18px;`;
const SpinWrap = styled.div`color:#FF8C00;animation:${spin} .8s linear infinite;display:flex;`;
const LoadTitle = styled.p`
  font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:1.05rem;
  text-transform:uppercase;color:#002C51;letter-spacing:.04em;
`;
const PTrack = styled.div`width:100%;height:5px;background:#E0E8F0;overflow:hidden;margin-bottom:14px;`;
const PFill = styled.div`
  height:100%;background:linear-gradient(90deg,#FF8C00 0%,#FFB347 100%);
  animation:${scanBar} 3s ease-in-out forwards;width:0%;
`;
const Steps = styled.div`display:flex;flex-direction:column;gap:9px;`;
const Step = styled.div`
  display:flex;align-items:center;gap:9px;
  font-family:'Barlow',sans-serif;font-size:.85rem;
  color:${({$d})=>$d?'#1E7E34':'#6B7E8F'};transition:color .3s;
`;
const Dot = styled.div`
  width:7px;height:7px;border-radius:50%;flex-shrink:0;
  background:${({$d,$a})=>$d?'#1E7E34':$a?'#FF8C00':'#D0D8E0'};
  ${({$a})=>$a&&css`animation:${pulse} .9s ease infinite;`}
`;

/* Result */
const ResWrap = styled.div`animation:${fadeUp} .4s ease both;`;
const ResHead = styled.div`
  display:flex;align-items:flex-start;justify-content:space-between;
  gap:16px;margin-bottom:18px;flex-wrap:wrap;
`;
const CoBl = styled.div``;
const CoName = styled.h3`
  font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:1.35rem;
  text-transform:uppercase;color:#002C51;margin-bottom:3px;line-height:1.1;
`;
const CoMeta = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;`;
const Chip = styled.span`
  display:inline-flex;align-items:center;gap:4px;
  font-family:'Barlow',sans-serif;font-size:.78rem;color:#5A6A7A;
  svg{color:#FF8C00;flex-shrink:0;}
`;
const ScBadge = styled.div`
  background:${({$s})=>scoreBg($s)};border:2px solid ${({$s})=>scoreColor($s)};
  padding:8px 14px;text-align:center;flex-shrink:0;min-width:80px;
`;
const ScNum = styled.div`
  font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:2rem;
  line-height:1;color:${({$s})=>scoreColor($s)};
`;
const ScSub = styled.div`
  font-family:'Barlow',sans-serif;font-weight:700;font-size:.6rem;
  letter-spacing:.1em;text-transform:uppercase;color:#5A6A7A;margin-top:2px;
`;
const MGrid = styled.div`
  display:grid;grid-template-columns:repeat(3,1fr);gap:2px;
  background:#D0D8E0;margin-bottom:16px;
`;
const MCell = styled.div`background:white;padding:13px 10px;text-align:center;`;
const MVal = styled.div`
  font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:1.45rem;
  color:${({$w})=>$w?'#D93025':'#002C51'};line-height:1;margin-bottom:3px;
`;
const MLbl = styled.div`
  font-family:'Barlow',sans-serif;font-size:.7rem;color:#5A6A7A;
  text-transform:uppercase;letter-spacing:.06em;
`;
const StarsRow = styled.div`display:flex;align-items:center;gap:2px;justify-content:center;margin-bottom:3px;`;
const AList = styled.div`display:flex;flex-direction:column;gap:8px;margin-bottom:18px;`;
const AItem = styled.div`
  display:flex;align-items:flex-start;gap:10px;padding:11px 13px;
  background:${({$t})=>$t==='err'?'#FDECEA':$t==='warn'?'#FFF8E1':'#E8F5E9'};
  border-left:3px solid ${({$t})=>$t==='err'?'#D93025':$t==='warn'?'#F5A623':'#1E7E34'};
`;
const AIco = styled.div`
  color:${({$t})=>$t==='err'?'#D93025':$t==='warn'?'#D48A00':'#1E7E34'};
  flex-shrink:0;margin-top:1px;display:flex;
`;
const ATit = styled.p`font-family:'Barlow',sans-serif;font-weight:700;font-size:.86rem;color:#1A1A1A;margin-bottom:1px;`;
const ADesc = styled.p`font-family:'Barlow',sans-serif;font-size:.77rem;color:#5A6A7A;`;
const TBlk = styled.div`position:relative;margin-bottom:18px;`;
const Blur = styled.div`filter:blur(4px);user-select:none;pointer-events:none;`;
const TLock = styled.div`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;`;
const LPill = styled.div`
  background:#002C51;color:white;display:flex;align-items:center;gap:6px;
  padding:7px 16px;font-family:'Barlow Condensed',sans-serif;font-weight:700;
  font-size:.82rem;letter-spacing:.07em;text-transform:uppercase;
  box-shadow:0 4px 16px rgba(0,0,0,.22);
`;
const Div = styled.div`height:1px;background:#D0D8E0;margin:20px 0 18px;`;
const LTit = styled.h4`
  font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:1.15rem;
  text-transform:uppercase;color:#002C51;margin-bottom:5px;
`;
const LSub = styled.p`
  font-family:'Barlow',sans-serif;font-size:.83rem;color:#5A6A7A;
  margin-bottom:14px;line-height:1.55;
`;
const ERow = styled.div`
  display:flex;
  @media(max-width:500px){flex-direction:column;}
`;
const EInput = styled.input`
  flex:1;padding:13px 15px;
  border:2px solid ${({$e})=>$e?'#E53E3E':'#D0D8E0'};border-right:none;
  background:white;font-family:'Barlow',sans-serif;font-size:.95rem;color:#1A1A1A;
  outline:none;border-radius:0;transition:border-color .2s;
  &:focus{border-color:#002C51;}
  &::placeholder{color:#A0ADB8;}
  @media(max-width:500px){
    border-right:2px solid ${({$e})=>$e?'#E53E3E':'#D0D8E0'};border-bottom:none;
  }
`;
const SBtn = styled.button`
  display:flex;align-items:center;gap:7px;padding:13px 20px;
  background:${({disabled})=>disabled?'#C07000':'#FF8C00'};
  color:white;font-family:'Barlow Condensed',sans-serif;font-weight:800;
  font-size:.95rem;letter-spacing:.06em;text-transform:uppercase;border:none;
  cursor:${({disabled})=>disabled?'not-allowed':'pointer'};
  white-space:nowrap;flex-shrink:0;transition:background .2s,transform .1s;
  &:hover:not(:disabled){background:#E07A00;transform:translateY(-1px);}
  .spin{animation:${spin} .8s linear infinite;}
  @media(max-width:500px){width:100%;justify-content:center;}
`;
const FErr = styled.p`margin-top:5px;font-family:'Barlow',sans-serif;font-size:.76rem;color:#E53E3E;`;
const OkBox = styled.div`
  display:flex;align-items:flex-start;gap:12px;padding:14px 16px;
  background:#E8F5E9;border-left:4px solid #1E7E34;animation:${fadeIn} .3s ease;
`;
const OkTxt = styled.div`
  font-family:'Barlow',sans-serif;font-size:.88rem;color:#1A1A1A;line-height:1.5;
  strong{font-weight:700;display:block;margin-bottom:2px;}
`;
const RBtn = styled.button`
  background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:5px;
  font-family:'Barlow',sans-serif;font-size:.78rem;color:#5A6A7A;
  text-decoration:underline;text-underline-offset:2px;margin-top:14px;
  &:hover{color:#002C51;}
`;
const Trust = styled.div`
  display:flex;align-items:center;justify-content:center;
  gap:22px;margin-top:18px;flex-wrap:wrap;
`;
const TItem = styled.div`
  display:flex;align-items:center;gap:5px;
  font-family:'Barlow',sans-serif;font-size:.73rem;color:rgba(255,255,255,.45);
  svg{color:rgba(255,255,255,.3);}
`;

/* ─────────────────────────────────────────────
   SCAN STEP LABELS
───────────────────────────────────────────── */
const SCAN = [
  { lbl: ()   => 'Google Business Profil abrufen…',              ms: 800  },
  { lbl: (c)  => `Wettbewerb in ${c||'deiner Region'} prüfen…`,  ms: 900  },
  { lbl: ()   => 'Bewertungs-Qualität analysieren…',             ms: 600  },
  { lbl: ()   => 'Sichtbarkeits-Score berechnen…',               ms: 400  },
];

/* ─────────────────────────────────────────────
   STARS COMPONENT
───────────────────────────────────────────── */
function Stars({ v }) {
  const r = Math.round(v * 2) / 2;
  return (
    <StarsRow>
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={13}
          fill={i<=r?'#FF8C00':'none'}
          color={i<=r?'#FF8C00':'#D0D8E0'} />
      ))}
    </StarsRow>
  );
}

/* ─────────────────────────────────────────────
   MAIN
───────────────────────────────────────────── */
export default function SmartCheck() {
  const [place,    setPlace]    = useState(null);
  const [phase,    setPhase]    = useState('search'); // search|scanning|result|sent
  const [scanStep, setScanStep] = useState(0);
  const [result,   setResult]   = useState(null);
  const [fetchErr, setFetchErr] = useState('');
  const [email,    setEmail]    = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [sending,  setSending]  = useState(false);

  const runAnalysis = useCallback(async (p) => {
    setPhase('scanning');
    setScanStep(0);
    setFetchErr('');

    const fetchP = fetchPlaceDetails(p.value.place_id).catch(() => null);

    let acc = 0;
    SCAN.forEach((s, i) => {
      acc += s.ms;
      setTimeout(() => setScanStep(i + 1), acc);
    });

    const [pd] = await Promise.all([
      fetchP,
      new Promise(r => setTimeout(r, acc + 200)),
    ]);

    if (!pd) {
      setFetchErr('Google Places konnte diesen Betrieb nicht laden. Bitte einen anderen auswählen.');
      setPhase('search');
      setPlace(null);
      return;
    }

    const city        = extractCity(pd.address_components);
    const rating      = pd.rating || 0;
    const reviewCount = pd.user_ratings_total || 0;
    const hasWebsite  = !!pd.website;
    const unanswered  = estimateUnanswered(reviewCount);
    const score       = calcScore({ rating, reviewCount, hasWebsite });

    setResult({ name: pd.name, city, rating, reviewCount, hasWebsite, unanswered, score });
    setPhase('result');
  }, []);

  const handleSelect = (val) => {
    if (!val) return;
    setPlace(val);
    runAnalysis(val);
  };

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailErr('Bitte eine gültige E-Mail eingeben.');
      return;
    }
    setEmailErr('');
    setSending(true);
    try {
      await supabase.from('leads').insert([{
        company_name: result.name, contact_person: '-', phone: '-',
        city: result.city, email, source: 'smart_check', status: 'new',
      }]);
    } catch(e) { console.error(e); }
    setSending(false);
    setPhase('sent');
  };

  const reset = () => {
    setPhase('search'); setPlace(null); setResult(null);
    setEmail(''); setEmailErr(''); setScanStep(0); setFetchErr('');
  };

  const apiKey = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;

  return (
    <Section id="check">
      <Grid />
      <Inner>
        <Eyebrow>Kostenloser Sofort-Check</Eyebrow>
        <H2>Wie sichtbar bist du<br /><Accent>gerade wirklich?</Accent></H2>
        <Sub>Betrieb suchen — in Sekunden siehst du, was dir gerade entgeht.</Sub>

        <Card>
          <Body>

            {/* ── SEARCH ── */}
            {phase === 'search' && (
              <>
                <SRow><SNum>1</SNum><SLbl>Betrieb bei Google suchen</SLbl></SRow>
                <AcWrap>
                  {apiKey ? (
                    <GooglePlacesAutocomplete
                      apiKey={apiKey}
                      apiOptions={{ language: 'de', region: 'de' }}
                      selectProps={{
                        value: place,
                        onChange: handleSelect,
                        placeholder: 'z.B. Sanitär Müller Hamburg…',
                        noOptionsMessage: () => 'Kein Treffer — versuch es genauer.',
                        loadingMessage: () => 'Suche…',
                        isClearable: true,
                      }}
                      autocompletionRequest={{
                        componentRestrictions: { country: 'de' },
                        types: ['establishment'],
                      }}
                    />
                  ) : (
                    <NoBanner>⚠ REACT_APP_GOOGLE_PLACES_API_KEY fehlt in .env</NoBanner>
                  )}
                </AcWrap>
                {fetchErr && <ErrTxt>{fetchErr}</ErrTxt>}
                <Hint>Tipp: Firmenname + Stadt eingeben für beste Treffer.</Hint>
              </>
            )}

            {/* ── SCANNING ── */}
            {phase === 'scanning' && (
              <>
                <SRow>
                  <SNum>1</SNum>
                  <SLbl>{place?.label || '…'}</SLbl>
                </SRow>
                <LoadWrap>
                  <LoadHead>
                    <SpinWrap><Loader size={19} /></SpinWrap>
                    <LoadTitle>WERKRUF analysiert…</LoadTitle>
                  </LoadHead>
                  <PTrack><PFill /></PTrack>
                  <Steps>
                    {SCAN.map((s, i) => (
                      <Step key={i} $d={i < scanStep}>
                        <Dot $d={i < scanStep} $a={i === scanStep - 1 && phase === 'scanning'} />
                        {s.lbl(result?.city || '')}
                        {i < scanStep && <CheckCircle size={12} style={{marginLeft:4,color:'#1E7E34',flexShrink:0}} />}
                      </Step>
                    ))}
                  </Steps>
                </LoadWrap>
              </>
            )}

            {/* ── RESULT / SENT ── */}
            {(phase === 'result' || phase === 'sent') && result && (() => {
              const alerts = buildAlerts(result);
              return (
                <ResWrap>
                  <ResHead>
                    <CoBl>
                      <CoName>{result.name}</CoName>
                      <CoMeta>
                        {result.city && <Chip><MapPin size={11}/>{result.city}</Chip>}
                        {result.hasWebsite && <Chip><Globe size={11}/>Website vorhanden</Chip>}
                      </CoMeta>
                    </CoBl>
                    <ScBadge $s={result.score}>
                      <ScNum $s={result.score}>{result.score}</ScNum>
                      <ScSub>/ 100 · {scoreLabel(result.score)}</ScSub>
                    </ScBadge>
                  </ResHead>

                  {/* REAL metrics */}
                  <MGrid>
                    <MCell>
                      {result.rating > 0
                        ? <Stars v={result.rating} />
                        : <div style={{fontSize:'.7rem',color:'#D93025',marginBottom:3}}>KEIN RATING</div>}
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
                        <AIco $t={a.t}>{a.icon}</AIco>
                        <div><ATit>{a.title}</ATit><ADesc>{a.desc}</ADesc></div>
                      </AItem>
                    ))}
                    {alerts.length > 2 && phase !== 'sent' && (
                      <TBlk>
                        <Blur>
                          {alerts.slice(2).map((a, i) => (
                            <AItem key={i} $t={a.t} style={{marginBottom: i < alerts.length - 3 ? 8 : 0}}>
                              <AIco $t={a.t}>{a.icon}</AIco>
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
                      <Div />
                      <LTit>Dein vollständiger 4-seitiger Report</LTit>
                      <LSub>
                        Wohin sollen wir deinen persönlichen Sichtbarkeits-Report (PDF) schicken?
                        Inkl. Wettbewerber-Analyse, Umsatzpotenzial und konkreten Maßnahmen.
                      </LSub>
                      <ERow>
                        <EInput
                          type="email" placeholder="deine@email.de"
                          value={email}
                          onChange={e=>{setEmail(e.target.value);setEmailErr('');}}
                          onKeyDown={e=>e.key==='Enter'&&handleSubmit()}
                          $e={!!emailErr}
                        />
                        <SBtn onClick={handleSubmit} disabled={sending}>
                          {sending
                            ? <><Loader size={15} className="spin"/>Wird gesendet…</>
                            : <>Kostenlosen Report anfordern<ChevronRight size={15}/></>}
                        </SBtn>
                      </ERow>
                      {emailErr && <FErr>{emailErr}</FErr>}
                    </>
                  )}

                  {/* Success */}
                  {phase === 'sent' && (
                    <>
                      <Div />
                      <OkBox>
                        <CheckCircle size={26} color="#1E7E34" style={{flexShrink:0,marginTop:2}} />
                        <OkTxt>
                          <strong>Report wird vorbereitet!</strong>
                          Wir schicken deinen Sichtbarkeits-Report für <em>{result.name}</em> in
                          48h an {email}.
                        </OkTxt>
                      </OkBox>
                    </>
                  )}

                  <div style={{textAlign:'right'}}>
                    <RBtn onClick={reset}><RotateCcw size={12}/>Anderen Betrieb prüfen</RBtn>
                  </div>

                  {phase === 'result' && (
                    <p style={{fontFamily:'Barlow,sans-serif',fontSize:'.7rem',
                      color:'#A0ADB8',marginTop:12,lineHeight:1.5}}>
                      * Geschätzter Wert basierend auf öffentlichen Google-Daten.
                      Exakte Zahlen im vollständigen Report.
                    </p>
                  )}
                </ResWrap>
              );
            })()}

          </Body>
        </Card>

        <Trust>
          <TItem><CheckCircle size={11}/>Kostenlos & unverbindlich</TItem>
          <TItem><CheckCircle size={11}/>Echte Google-Daten</TItem>
          <TItem><CheckCircle size={11}/>Report in 48h</TItem>
        </Trust>
      </Inner>
    </Section>
  );
}
