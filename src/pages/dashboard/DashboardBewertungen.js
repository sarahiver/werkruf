import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import {
  Search, Sparkles, Send, Check, AlertTriangle, X,
  Copy, RotateCcw, Filter, ShieldAlert,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useBetriebsname } from '../../hooks/useBetriebsname';
import { useIndustry } from '../../context/IndustryContext';
import { useReviews } from '../../hooks/useReviews';
import { useGoogleBusinessData } from '../../hooks/useGoogleBusinessData';
import { useAusgewaehlterStandort } from '../../hooks/useAusgewaehlterStandort';
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
  /* Verlinkte Bewertung (WP4): ruhig hervorheben, nicht blinken. */
  ${({ $ziel }) => $ziel && 'box-shadow: 0 0 0 2px var(--color-accent); scroll-margin-top: 80px;'}
`;

const ZeigtZeile = styled.p`
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin: 0 0 12px; font-family: var(--font-body); font-size: .82rem; color: var(--color-text-muted);
  button { background: none; border: none; cursor: pointer; padding: 0;
           font-family: inherit; font-size: inherit; font-weight: 700; color: var(--color-primary); text-decoration: underline; }
`;

const Hinweis = styled.p`
  margin: 0 0 12px; padding: 10px 12px; border-radius: var(--radius-card);
  background: #EEF2F6; color: var(--color-primary);
  font-family: var(--font-body); font-size: .82rem; line-height: 1.5;
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

/* ═══════════════════════════════════════════════════════════════
   STARTZUSTAND DER SEITE (WP4, 23.10.2026)
   ═══════════════════════════════════════════════════════════════

   Bis dahin startete die Seite mit „Alle Betriebe · Alle · Neueste“.
   Wer von der Uebersicht mit „3 ohne Antwort“ kam, sah sieben — die
   Uebersicht zaehlt den ausgewaehlten Betrieb, die Seite zaehlte alle.

   Jetzt: Standard = ausgewaehlter Betrieb + unbeantwortet + neueste
   zuerst. Die Adresse darf das ueberschreiben:

     ?betrieb=<location-id>   nur, wenn die ID zu einem EIGENEN Betrieb
                              gehoert (locations aus useGoogleBusinessData,
                              RLS-gefiltert). Fremde oder unbekannte IDs
                              werden ignoriert → ausgewaehlter Betrieb.
                              Die Datenbank wuerde fremde Daten ohnehin
                              nicht liefern (RLS auf google_reviews);
                              die Pruefung hier verhindert nur eine
                              leere, verwirrende Liste.
     ?status=offen|beantwortet|alle
     ?review=<id>             diese Bewertung sichtbar machen (Hook)

   Alle Filter bleiben bedienbar; „Alle Betriebe“ ist ein Klick.

   Reine Funktion, damit der Test sie ohne Rendern pruefen kann. */
export function leiteStartfilterAb({ params, eigeneLocationIds, ausgewaehlteId }) {
  const lies = (k) => (params && typeof params.get === 'function' ? params.get(k) : null);
  const eigene = new Set(Array.isArray(eigeneLocationIds) ? eigeneLocationIds : []);

  const betriebParam = lies('betrieb');
  let locationId;
  let betriebIgnoriert = false;
  if (betriebParam === 'alle' || betriebParam === 'all') {
    locationId = 'all';
  } else if (betriebParam && eigene.has(betriebParam)) {
    locationId = betriebParam;
  } else {
    if (betriebParam) betriebIgnoriert = true;
    locationId = ausgewaehlteId ?? 'all';
  }

  const statusParam = lies('status');
  const answered = statusParam === 'alle' || statusParam === 'all' ? 'all'
    : statusParam === 'beantwortet' || statusParam === 'done' ? 'done'
    : 'open';

  const review = lies('review');
  const reviewId = review && /^[0-9a-f-]{36}$/i.test(review) ? review : null;

  return { locationId, answered, sort: 'newest', reviewId, betriebIgnoriert };
}

/* Der Rahmen: wartet, bis Betriebe und Auswahl bekannt sind, und
   startet die eigentliche Seite dann mit festem Startzustand. Ohne
   diesen Schritt muesste useReviews mit „alle“ starten und spaeter
   umspringen — ein Laden zu viel und ein Flackern. */
export default function DashboardBewertungen() {
  const [params] = useSearchParams();
  const { locations, loading: betriebeLaden } = useGoogleBusinessData();
  const auswahl = useAusgewaehlterStandort();

  if (betriebeLaden || auswahl.loading) {
    return (
      <Page>
        <PageTitle>Bewertungen</PageTitle>
        <SkeletonList count={3} height={140} />
      </Page>
    );
  }

  const start = leiteStartfilterAb({
    params,
    eigeneLocationIds: (locations ?? []).map((l) => l.id),
    ausgewaehlteId: auswahl.standort?.id ?? null,
  });

  return <BewertungenInhalt start={start} locations={locations ?? []} />;
}

export function BewertungenInhalt({ start, locations }) {
  const { profile } = useAuthContext();
  /* Google-Name vor Registrierungsname — siehe hooks/useBetriebsname.js. */
  const { name: betriebsname } = useBetriebsname();
  const { brand } = useIndustry();

  const {
    reviews, replies, total, page, pageSize,
    loading, error, busy, actionError,
    search, setSearch, rating, setRating,
    answered, setAnswered, locationId, setLocationId,
    sort, setSort, hasFilters, resetFilters,
    setPage, reload,
    generateReply, saveDraft, approveReply, dismissActionError,
    verlinkt,
  } = useReviews({ locationId: start.locationId, answered: start.answered, sort: start.sort, reviewId: start.reviewId });

  /* Zur verlinkten Bewertung scrollen — einmal, sobald sie da ist. */
  const zielRef = useRef(null);
  const gescrollt = useRef(false);
  useEffect(() => {
    if (gescrollt.current || !verlinkt || verlinkt.status !== 'gefunden') return;
    if (zielRef.current && typeof zielRef.current.scrollIntoView === 'function') {
      gescrollt.current = true;
      zielRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [verlinkt, reviews]);

  const betriebName = (id) => locations.find((l) => l.id === id)?.title || null;
  const standardAktiv = answered === 'open' && sort === 'newest' && rating === 'all' && !search
    && locationId !== 'all';

  // Lokale Textstände, damit Tippen nicht bei jedem Anschlag speichert.
  const [edits, setEdits] = useState({});
  const [copied, setCopied] = useState({});

  // Beim Seitenwechsel verwerfen — sonst hängt der Text der alten
  // Bewertung an der neuen.
  useEffect(() => { setEdits({}); }, [page]);

  const facts = {
    companyName:  betriebsname || brand.name,
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
        Alle Google-Bewertungen deiner Betriebe. Antworten schlägt {brand.name} vor —
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

      {/* ── WAS DIE SEITE GERADE ZEIGT (WP4) ──
          Die Selects unten tragen den Zustand; dieser Satz macht ihn
          lesbar und bietet den einen Klick zurueck auf „alles“. */}
      {standardAktiv && (
        <ZeigtZeile data-testid="filter-zeile">
          <span>Zeigt: <strong>{betriebName(locationId) || 'ausgewählter Betrieb'}</strong> · Unbeantwortet · Neueste zuerst</span>
          <button type="button" onClick={() => { setLocationId('all'); setAnswered('all'); }}>
            Alle Bewertungen anzeigen
          </button>
        </ZeigtZeile>
      )}
      {start.betriebIgnoriert && (
        <Hinweis role="status">Der verlinkte Betrieb gehört nicht zu deinem Konto — gezeigt wird dein ausgewählter Betrieb.</Hinweis>
      )}
      {verlinkt?.status === 'fehlt' && (
        <Hinweis role="status" data-testid="verlinkt-fehlt">
          Die verlinkte Bewertung wurde nicht gefunden oder ist bereits erledigt.
        </Hinweis>
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
            <option value="all">Alle Betriebe</option>
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
            {/* Verlinkte Bewertung ausserhalb der aktuellen Seite/Filter:
                oben anheften, mit ihrem ECHTEN Zustand. Dieselbe Karte,
                derselbe Antwortfluss. */}
            {[...(verlinkt?.status === 'gefunden' && !verlinkt.inListe && verlinkt.review ? [verlinkt.review] : []), ...reviews].map((review) => {
              const istZiel = verlinkt?.status === 'gefunden' && review.id === start.reviewId;
              const angeheftet = istZiel && !verlinkt.inListe;
              const reply = replies[review.id];
              const text = bodyFor(review);
              const isPublished = reply?.status === 'published';
              const isPending = reply?.status === 'approved' || reply?.status === 'publishing';
              const isEditable = reply?.status === 'draft' || reply?.status === 'failed';
              const state = busy[review.id];
              const tooLong = text.length > MAX_REPLY_CHARS;

              return (
                <ReviewCard key={review.id} $rating={review.star_rating} $ziel={istZiel}
                            ref={istZiel ? zielRef : undefined} data-testid={istZiel ? 'verlinkte-bewertung' : undefined}>
                  {angeheftet && (
                    <Badge $variant="info" style={{ marginBottom: 8 }}>
                      Verlinkte Bewertung{review.is_answered ? ' — bereits beantwortet' : ''}
                    </Badge>
                  )}
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
