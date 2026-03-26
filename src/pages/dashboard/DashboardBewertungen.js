import ProGate from '../../components/dashboard/ProGate';
import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Star, Sparkles, Copy, CheckCheck, AlertCircle, ExternalLink, Loader } from 'lucide-react';
import supabase from '../../supabaseClient';
import { useAuthContext } from '../../context/AuthContext';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

/* ─────────────────────────────────────────────
   MOCK REVIEWS
───────────────────────────────────────────── */
const MOCK_REVIEWS = [
  {
    id: '1',
    author:   'Thomas K.',
    avatar:   'TK',
    rating:   5,
    date:     '2026-03-10',
    text:     'Absolut top! Die Heizung wurde schnell und sauber repariert. Sehr freundlich und pünktlich. Kann ich nur weiterempfehlen!',
    replied:  false,
  },
  {
    id: '2',
    author:   'Sandra M.',
    avatar:   'SM',
    rating:   4,
    date:     '2026-03-05',
    text:     'Gute Arbeit, alles funktioniert einwandfrei. Kleiner Abzug weil der Termin sich etwas verzögert hat, aber das Ergebnis stimmt.',
    replied:  false,
  },
  {
    id: '3',
    author:   'Bernd W.',
    avatar:   'BW',
    rating:   2,
    date:     '2026-02-28',
    text:     'Leider war ich nicht zufrieden. Die Reparatur hat nicht lange gehalten und ich musste nochmal jemanden anrufen. Schade.',
    replied:  false,
  },
  {
    id: '4',
    author:   'Julia F.',
    avatar:   'JF',
    rating:   5,
    date:     '2026-02-20',
    text:     'Notfallreparatur am Wochenende — innerhalb von 2 Stunden war jemand da! Sehr professionell und der Preis war fair. Danke!',
    replied:  true,
    reply:    'Vielen Dank Julia! Notfälle sind uns immer wichtig — froh dass wir helfen konnten.',
  },
  {
    id: '5',
    author:   'Klaus H.',
    avatar:   'KH',
    rating:   3,
    date:     '2026-02-12',
    text:     'Handwerk war in Ordnung, aber die Kommunikation könnte besser sein. Mehrfach angerufen bis jemand zurückgerufen hat.',
    replied:  false,
  },
];

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Page = styled.div`animation: ${fadeUp} .4s ease both;`;

const SimBanner = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; margin-bottom: 24px;
  background: rgba(var(--color-accent-rgb), .08);
  border: 1px solid rgba(var(--color-accent-rgb), .25);
  border-left: 4px solid var(--color-accent);
  border-radius: var(--radius-card);
`;
const SimText = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text); line-height: 1.5;
  strong { color: var(--color-accent); }
`;

const PageTitle = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.4rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;
const PageSub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); margin-bottom: 24px;
`;

const StatsRow = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px; margin-bottom: 24px;
`;
const StatCard = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 16px;
  animation: ${fadeUp} .4s ease ${({ $d }) => $d || '0s'} both;
`;
const StatNum = styled.p`
  font-family: var(--font-display); font-weight: 900;
  font-size: 1.8rem; color: ${({ $c }) => $c || 'var(--color-primary)'};
  line-height: 1;
`;
const StatLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: var(--color-text-muted); margin-top: 4px; text-transform: uppercase; letter-spacing: .08em;
`;

const ReviewList = styled.div`display: flex; flex-direction: column; gap: 14px;`;

const ReviewCard = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 20px;
  border-left: 4px solid ${({ $rating }) =>
    $rating >= 4 ? '#1E7E34' : $rating === 3 ? '#D48A00' : '#D93025'};
  animation: ${fadeUp} .4s ease ${({ $d }) => $d || '0s'} both;
`;

const ReviewTop = styled.div`
  display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px;
`;
const Avatar = styled.div`
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--color-primary); color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-body); font-weight: 700; font-size: .8rem;
  flex-shrink: 0;
`;
const ReviewMeta = styled.div`flex: 1;`;
const AuthorName = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .92rem; color: var(--color-primary);
`;
const ReviewDate = styled.p`
  font-family: var(--font-body); font-size: .75rem;
  color: var(--color-text-muted); margin-top: 2px;
`;

const Stars = styled.div`
  display: flex; gap: 2px;
`;
const StarIcon = styled.span`
  color: ${({ $filled }) => $filled ? '#F4B400' : '#D0D8E0'};
  font-size: 15px;
`;

const ReviewText = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text); line-height: 1.65; margin-bottom: 14px;
`;

const ReplyBox = styled.div`
  background: var(--color-bg);
  border-left: 3px solid #1E7E34;
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  padding: 10px 14px; margin-bottom: 12px;
`;
const ReplyLabel = styled.p`
  font-family: var(--font-body); font-size: .7rem;
  font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  color: #1E7E34; margin-bottom: 4px;
`;
const ReplyText = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text); line-height: 1.55;
`;

const AISection = styled.div`margin-top: 12px;`;

const GenerateBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px;
  background: var(--color-primary); color: white;
  font-family: var(--font-body); font-weight: 700;
  font-size: .82rem; border: none; border-radius: var(--radius-button);
  cursor: pointer; transition: filter .2s;
  &:hover:not(:disabled) { filter: brightness(1.15); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const DraftArea = styled.div`margin-top: 12px; animation: ${fadeUp} .3s ease both;`;

const DraftLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted); margin-bottom: 6px;
  display: flex; align-items: center; gap: 6px;
`;

const DraftTextarea = styled.textarea`
  width: 100%; box-sizing: border-box;
  padding: 12px 14px;
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text); line-height: 1.6;
  background: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-card);
  resize: vertical; min-height: 90px;
  outline: none;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
`;

const DraftActions = styled.div`
  display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap;
`;

const CopyBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  background: var(--color-accent); color: white;
  font-family: var(--font-body); font-weight: 700; font-size: .8rem;
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover { filter: brightness(.9); }
`;

const PublishHint = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px;
  background: rgba(var(--color-accent-rgb), .06);
  border: 1px solid rgba(var(--color-accent-rgb), .2);
  border-radius: var(--radius-card);
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text); line-height: 1.5;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardBewertungen() {
  const { profile } = useAuthContext();
  const [drafts,   setDrafts]   = useState({});
  const [loading,  setLoading]  = useState({});
  const [copied,   setCopied]   = useState({});
  const [reviews,  setReviews]  = useState(MOCK_REVIEWS);

  const avgRating  = (MOCK_REVIEWS.reduce((s, r) => s + r.rating, 0) / MOCK_REVIEWS.length).toFixed(1);
  const unreplied  = MOCK_REVIEWS.filter(r => !r.replied).length;
  const companyName = profile?.company_name || 'dein Betrieb';

  const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  /* ── Generate AI reply via Claude API ── */
  const generateReply = async (review) => {
    setLoading(prev => ({ ...prev, [review.id]: true }));
    try {
      // Secure: Claude API called server-side via Edge Function
      // API key never exposed to browser
      const { data, error } = await supabase.functions.invoke('generate-review-reply', {
        body: {
          reviewText:   review.text,
          reviewerName: review.author,
          rating:       review.rating,
          companyName,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setDrafts(prev => ({ ...prev, [review.id]: data.reply || '' }));
    } catch (err) {
      console.error('[generateReply] Error:', err.message);
      setDrafts(prev => ({
        ...prev,
        [review.id]: err.message.includes('Rate limit')
          ? err.message
          : 'Fehler beim Generieren. Bitte nochmal versuchen.',
      }));
    }
    setLoading(prev => ({ ...prev, [review.id]: false }));
  };

  const copyToClipboard = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [id]: false })), 2500);
  };

  return (
    <ProGate feature="Bewertungen & KI-Assistent">
    <Page>
      <PageTitle>Bewertungen</PageTitle>
      <PageSub>Alle Google-Rezensionen auf einen Blick — mit KI-Antwort-Assistent.</PageSub>

      {/* Simulation Banner */}
      <SimBanner>
        <AlertCircle size={18} color="var(--color-accent)" style={{ flexShrink: 0 }} />
        <SimText>
          <strong>Simulation aktiv</strong> — Diese Bewertungen sind Beispieldaten.
          Echte Google-Rezensionen werden nach Verknüpfung deines Google Business Profils geladen.
          Der KI-Assistent funktioniert bereits vollständig.
        </SimText>
      </SimBanner>

      {/* Stats */}
      <StatsRow>
        <StatCard $d="0s">
          <StatNum $c="#F4B400">{avgRating}</StatNum>
          <StatLabel>Ø Bewertung</StatLabel>
        </StatCard>
        <StatCard $d=".05s">
          <StatNum>{MOCK_REVIEWS.length}</StatNum>
          <StatLabel>Rezensionen</StatLabel>
        </StatCard>
        <StatCard $d=".1s">
          <StatNum $c={unreplied > 0 ? '#D93025' : '#1E7E34'}>{unreplied}</StatNum>
          <StatLabel>Unbeantwortet</StatLabel>
        </StatCard>
        <StatCard $d=".15s">
          <StatNum $c="#1E7E34">
            {MOCK_REVIEWS.filter(r => r.rating >= 4).length}
          </StatNum>
          <StatLabel>Positiv (4-5★)</StatLabel>
        </StatCard>
      </StatsRow>

      {/* Review List */}
      <ReviewList>
        {reviews.map((review, idx) => (
          <ReviewCard key={review.id} $rating={review.rating} $d={`${idx * .05}s`}>
            <ReviewTop>
              <Avatar>{review.avatar}</Avatar>
              <ReviewMeta>
                <AuthorName>{review.author}</AuthorName>
                <ReviewDate>{formatDate(review.date)}</ReviewDate>
              </ReviewMeta>
              <Stars>
                {[1,2,3,4,5].map(s => (
                  <StarIcon key={s} $filled={s <= review.rating}>★</StarIcon>
                ))}
              </Stars>
            </ReviewTop>

            <ReviewText>{review.text}</ReviewText>

            {/* Existing reply */}
            {review.replied && review.reply && (
              <ReplyBox>
                <ReplyLabel>Deine Antwort</ReplyLabel>
                <ReplyText>{review.reply}</ReplyText>
              </ReplyBox>
            )}

            {/* AI Section */}
            {!review.replied && (
              <AISection>
                {!drafts[review.id] ? (
                  <GenerateBtn
                    onClick={() => generateReply(review)}
                    disabled={loading[review.id]}
                  >
                    {loading[review.id]
                      ? <><Loader size={14} className="spin" /> KI denkt…</>
                      : <><Sparkles size={14} /> Antwort-Vorschlag mit Claude generieren</>
                    }
                  </GenerateBtn>
                ) : (
                  <DraftArea>
                    <DraftLabel>
                      <Sparkles size={12} color="var(--color-accent)" />
                      KI-Entwurf — bearbeite nach Bedarf:
                    </DraftLabel>
                    <DraftTextarea
                      value={drafts[review.id]}
                      onChange={e => setDrafts(prev => ({ ...prev, [review.id]: e.target.value }))}
                    />
                    <DraftActions>
                      <CopyBtn onClick={() => copyToClipboard(review.id, drafts[review.id])}>
                        {copied[review.id]
                          ? <><CheckCheck size={14} /> Kopiert!</>
                          : <><Copy size={14} /> Text kopieren</>
                        }
                      </CopyBtn>
                      <GenerateBtn
                        onClick={() => generateReply(review)}
                        disabled={loading[review.id]}
                        style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                          border: '1px solid var(--color-border)' }}
                      >
                        {loading[review.id]
                          ? <Loader size={13} className="spin" />
                          : '↻ Neu generieren'
                        }
                      </GenerateBtn>
                    </DraftActions>

                    <PublishHint style={{ marginTop: 10 }}>
                      <ExternalLink size={14} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        <strong>Jetzt kopieren & bei Google einfügen.</strong>{' '}
                        Automatische Veröffentlichung folgt nach Google Business Profil-Verknüpfung.{' '}
                        {profile?.google_place_id && (
                          <a
                            href={`https://business.google.com/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            Google Business öffnen →
                          </a>
                        )}
                      </span>
                    </PublishHint>
                  </DraftArea>
                )}
              </AISection>
            )}
          </ReviewCard>
        ))}
      </ReviewList>
    </Page>
    </ProGate>
  );
}
