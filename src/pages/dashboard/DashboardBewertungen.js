import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import {
  Search, Sparkles, Send, Check, AlertTriangle, X,
  Copy, RotateCcw, Filter, ShieldAlert,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { useReviews } from '../../hooks/useReviews';
import { useGoogleBusinessData } from '../../hooks/useGoogleBusinessData';
import {
  Page, PageTitle, PageSub, Card,
  Toolbar, SearchWrap, SearchInput, Select,
  SkeletonList, ErrorState, EmptyState, Pagination,
  StarRating, ratingColor, Badge, GhostBtn, PrimaryBtn, Spinner,
  formatDate, fadeUp,
} from '../../components/dashboard/gb/GbUi';

/* ─────────────────────────────────────────────
   DashboardBewertungen

   Läuft jetzt auf echten Daten aus google_reviews statt auf Mocks.
   Suche, Filter und Blättern passieren serverseitig — bei einem
   Betrieb mit 2.000 Bewertungen wäre alles andere unbrauchbar.

   Der Antwort-Ablauf: KI-Entwurf erzeugen → bearbeiten → freigeben.
   Veröffentlicht wird über einen Hintergrund-Job, nicht hier.
───────────────────────────────────────────── */

const ReviewCard = styled(Card)`
  border-left: 3px solid ${({ $rating }) => ratingColor($rating)};
  margin-bottom: 14px;
  animation: ${fadeUp} .3s ease both;
`;

const Head = styled.div`
  display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px;
`;

const Avatar = styled.div`
  width: 38px; height: 38px; flex-shrink: 0; border-radius: 50%;
  background: ${({ $rating }) => ratingColor($rating)};
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: var(--heading-weight); font-size: .88rem;
`;

const Meta = styled.div`flex: 1; min-width: 0;`;

const MetaTop = styled.div`
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
`;

const Author = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .89rem;
  color: var(--color-primary);
`;

const DateText = styled.span`
  font-family: var(--font-body); font-size: .76rem; color: var(--color-text-muted);
`;

const Body = styled.p`
  font-family: var(--font-body); font-size: .88rem; line-height: 1.65;
  color: var(--color-text); margin-top: 8px;
  white-space: pre-wrap; word-break: break-word;
`;

const NoText = styled(Body)`font-style: italic; color: var(--color-text-muted);`;

const PublishedBox = styled.div`
  margin-top: 12px; padding: 12px 14px;
  background: var(--color-bg); border-radius: var(--radius-card);
  border-left: 2px solid #1E7E34;
`;

const BoxLabel = styled.p`
  display: flex; align-items: center; gap: 6px;
  font-family: var(--font-body); font-weight: 700; font-size: .74rem;
  text-transform: uppercase; letter-spacing: .06em;
  color: var(--color-text-muted); margin-bottom: 6px;
`;

const BoxText = styled.p`
  font-family: var(--font-body); font-size: .85rem; line-height: 1.6;
  color: var(--color-text); white-space: pre-wrap;
`;

const DraftArea = styled.div`margin-top: 12px; animation: ${fadeUp} .25s ease both;`;

const Textarea = styled.textarea`
  width: 100%; min-height: 120px; resize: vertical;
  padding: 12px 14px;
  border: 1px solid ${({ $warn }) => ($warn ? '#D93025' : 'var(--color-border)')};
  border-radius: var(--radius-card);
  background: var(--color-white); color: var(--color-text);
  font-family: var(--font-body); font-size: .87rem; line-height: 1.6;
  &:focus { outline: none; border-color: var(--color-accent); }
  &:disabled { background: var(--color-bg); color: var(--color-text-muted); }
`;

const DraftFoot = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-top: 9px; flex-wrap: wrap;
`;

const CharCount = styled.span`
  font-family: var(--font-body); font-size: .74rem;
  color: ${({ $over }) => ($over ? '#D93025' : 'var(--color-text-muted)')};
`;

const Actions = styled.div`display: flex; gap: 8px; flex-wrap: wrap;`;

const ReviewNotice = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 10px; padding: 10px 12px;
  background: #FFF4E0; border-radius: var(--radius-card);
  font-family: var(--font-body); font-size: .8rem; line-height: 1.5; color: #8A5A00;
  svg { flex-shrink: 0; margin-top: 1px; }
`;

const Banner = styled.div`
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  padding: 11px 14px; margin-bottom: 14px;
  background: #FDECEA; color: #B3261E; border-radius: var(--radius-card);
  font-family: var(--font-body); font-size: .83rem;
  button { background: none; border: none; cursor: pointer; color: inherit; padding: 2px; }
`;

/* Googles Limit für Antworttexte. */
const MAX_REPLY_CHARS = 4096;

export default function DashboardBewertungen() {
  const { profile } = useAuthContext();
  const { brand } = useIndustry();
  const { locations } = useGoogleBusinessData();

  const {
    reviews, replies, total, page, pageSize,
    loading, error, busy, actionError,
    search, setSearch, rating, setRating,
    answered, setAnswered, locationId, setLocationId,
    sort, setSort, hasFilters, resetFilters,
    setPage, reload,
    generateReply, saveDraft, approveReply, dismissActionError,
  } = useReviews();

  // Lokale Textstände, damit Tippen nicht bei jedem Anschlag speichert.
  const [edits, setEdits] = useState({});
  const [copied, setCopied] = useState({});

  // Beim Seitenwechsel verwerfen — sonst hängt der Text der alten
  // Bewertung an der neuen.
  useEffect(() => { setEdits({}); }, [page]);

  const facts = {
    companyName:  profile?.company_name || brand.name,
    industry:     profile?.trade || undefined,
    contactEmail: profile?.email || undefined,
    contactPhone: profile?.phone || undefined,
  };

  const bodyFor = (review) =>
    edits[review.id] ?? replies[review.id]?.body ?? '';

  const handleGenerate = async (review) => {
    try {
      const data = await generateReply(review, facts);
      setEdits((prev) => ({ ...prev, [review.id]: data.reply }));
    } catch { /* Meldung steckt in actionError */ }
  };

  const handleApprove = async (review) => {
    const reply = replies[review.id];
    if (!reply) return;

    const edited = edits[review.id];
    try {
      // Erst speichern, wenn der Text verändert wurde — danach ist er
      // nicht mehr bearbeitbar.
      if (edited !== undefined && edited !== reply.body) {
        await saveDraft(review.id, reply.id, edited);
      }
      await approveReply(review.id, reply.id);
    } catch { /* Meldung steckt in actionError */ }
  };

  const copy = (review) => {
    navigator.clipboard.writeText(bodyFor(review));
    setCopied((prev) => ({ ...prev, [review.id]: true }));
    setTimeout(() => setCopied((prev) => ({ ...prev, [review.id]: false })), 2200);
  };

  return (
    <Page>
      <PageTitle>Bewertungen</PageTitle>
      <PageSub>
        Alle Google-Bewertungen deiner Standorte. Antworten schlägt {brand.name} vor —
        veröffentlicht wird erst nach deiner Freigabe.
      </PageSub>

      {actionError && (
        <Banner>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={15} />{actionError}
          </span>
          <button onClick={dismissActionError} aria-label="Schliessen"><X size={15} /></button>
        </Banner>
      )}

      {/* ── FILTER ── */}
      <Toolbar>
        <SearchWrap>
          <Search size={15} />
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="In Bewertungen suchen…"
          />
        </SearchWrap>

        <Select value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="all">Alle Sterne</option>
          {[5, 4, 3, 2, 1].map((s) => (
            <option key={s} value={s}>{s} {s === 1 ? 'Stern' : 'Sterne'}</option>
          ))}
        </Select>

        <Select value={answered} onChange={(e) => setAnswered(e.target.value)}>
          <option value="all">Alle</option>
          <option value="open">Unbeantwortet</option>
          <option value="done">Beantwortet</option>
        </Select>

        {locations.length > 1 && (
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="all">Alle Standorte</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.title || 'Ohne Namen'}</option>
            ))}
          </Select>
        )}

        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="rating_low">Schlechteste zuerst</option>
          <option value="rating_high">Beste zuerst</option>
        </Select>

        {hasFilters && (
          <GhostBtn onClick={resetFilters}>
            <RotateCcw size={13} /> Zurücksetzen
          </GhostBtn>
        )}
      </Toolbar>

      {/* ── LISTE ── */}
      {loading ? <SkeletonList count={4} height={150} />
        : error ? <ErrorState message={error} onRetry={reload} />
        : reviews.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'Keine Treffer' : 'Noch keine Bewertungen'}
            text={hasFilters
              ? 'Zu diesen Filtern gibt es nichts. Versuch es mit weniger Einschränkungen.'
              : 'Sobald der erste Abgleich mit Google gelaufen ist, erscheinen die Bewertungen hier.'}
            action={hasFilters
              ? <GhostBtn onClick={resetFilters}><Filter size={13} /> Filter zurücksetzen</GhostBtn>
              : undefined}
          />
        ) : (
          <>
            {reviews.map((review) => {
              const reply = replies[review.id];
              const text = bodyFor(review);
              const isPublished = reply?.status === 'published';
              const isPending = reply?.status === 'approved' || reply?.status === 'publishing';
              const isEditable = reply?.status === 'draft' || reply?.status === 'failed';
              const state = busy[review.id];
              const tooLong = text.length > MAX_REPLY_CHARS;

              return (
                <ReviewCard key={review.id} $rating={review.star_rating}>
                  <Head>
                    <Avatar $rating={review.star_rating}>
                      {(review.reviewer_display_name || '?').charAt(0).toUpperCase()}
                    </Avatar>
                    <Meta>
                      <MetaTop>
                        <Author>{review.reviewer_display_name || 'Anonym'}</Author>
                        <StarRating value={review.star_rating} size={13} />
                        <DateText>{formatDate(review.google_created_at)}</DateText>
                        {isPublished && <Badge $variant="success"><Check size={9} />beantwortet</Badge>}
                        {isPending && <Badge $variant="info"><Send size={9} />wird veröffentlicht</Badge>}
                        {reply?.status === 'failed' && (
                          <Badge $variant="danger"><AlertTriangle size={9} />fehlgeschlagen</Badge>
                        )}
                      </MetaTop>

                      {review.comment
                        ? <Body>{review.comment}</Body>
                        : <NoText>Nur Sterne, kein Text</NoText>}
                    </Meta>
                  </Head>

                  {/* Veröffentlicht — nur noch lesen */}
                  {isPublished && (
                    <PublishedBox>
                      <BoxLabel><Check size={11} />Deine Antwort</BoxLabel>
                      <BoxText>{reply.body}</BoxText>
                    </PublishedBox>
                  )}

                  {/* In Veröffentlichung */}
                  {isPending && (
                    <PublishedBox style={{ borderLeftColor: 'var(--color-accent)' }}>
                      <BoxLabel><Send size={11} />Wird an Google übertragen</BoxLabel>
                      <BoxText>{reply.body}</BoxText>
                    </PublishedBox>
                  )}

                  {/* Kein Entwurf vorhanden */}
                  {!reply && (
                    <PrimaryBtn
                      onClick={() => handleGenerate(review)}
                      disabled={state === 'generating'}
                    >
                      {state === 'generating' ? <Spinner size={14} /> : <Sparkles size={14} />}
                      {state === 'generating' ? 'Wird geschrieben…' : 'Antwort vorschlagen'}
                    </PrimaryBtn>
                  )}

                  {/* Entwurf bearbeitbar */}
                  {isEditable && (
                    <DraftArea>
                      <BoxLabel>
                        <Sparkles size={11} />
                        {reply.source === 'ai' ? 'KI-Vorschlag' : 'Dein Entwurf'}
                      </BoxLabel>

                      <Textarea
                        value={text}
                        $warn={tooLong}
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [review.id]: e.target.value }))}
                        disabled={!!state}
                      />

                      {reply.requiresHumanReview && (
                        <ReviewNotice>
                          <ShieldAlert size={14} />
                          <span>
                            Bitte vor dem Veröffentlichen genau lesen.
                            {reply.detectedIssues?.length > 0 &&
                              ` Auffällig: ${reply.detectedIssues.join(', ')}.`}
                          </span>
                        </ReviewNotice>
                      )}

                      {reply.status === 'failed' && reply.error_code && (
                        <ReviewNotice style={{ background: '#FDECEA', color: '#B3261E' }}>
                          <AlertTriangle size={14} />
                          <span>Die Veröffentlichung ist gescheitert. Du kannst es erneut versuchen.</span>
                        </ReviewNotice>
                      )}

                      <DraftFoot>
                        <CharCount $over={tooLong}>
                          {text.length} / {MAX_REPLY_CHARS} Zeichen
                        </CharCount>

                        <Actions>
                          <GhostBtn onClick={() => copy(review)} disabled={!text}>
                            {copied[review.id] ? <Check size={13} /> : <Copy size={13} />}
                            {copied[review.id] ? 'Kopiert' : 'Kopieren'}
                          </GhostBtn>

                          <GhostBtn
                            onClick={() => handleGenerate(review)}
                            disabled={!!state}
                          >
                            {state === 'generating' ? <Spinner size={13} /> : <RotateCcw size={13} />}
                            Neu vorschlagen
                          </GhostBtn>

                          <PrimaryBtn
                            onClick={() => handleApprove(review)}
                            disabled={!!state || !text.trim() || tooLong}
                          >
                            {state === 'publishing' || state === 'saving'
                              ? <Spinner size={14} /> : <Send size={14} />}
                            Freigeben & veröffentlichen
                          </PrimaryBtn>
                        </Actions>
                      </DraftFoot>
                    </DraftArea>
                  )}
                </ReviewCard>
              );
            })}

            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onChange={setPage}
              busy={loading}
            />
          </>
        )}
    </Page>
  );
}
