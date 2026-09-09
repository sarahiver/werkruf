import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  MapPin, Star, MessageSquare, RefreshCw, CheckCircle,
  AlertTriangle, Clock, ArrowRight, Send, FileText,
} from 'lucide-react';
import { useIndustry } from '../../context/IndustryContext';
import { useGoogleBusiness } from '../../hooks/useGoogleBusiness';
import { useGoogleBusinessData } from '../../hooks/useGoogleBusinessData';
import GoogleBusinessConnect from '../../components/dashboard/GoogleBusinessConnect';
import {
  Page, PageTitle, PageSub, SectionTitle, Card,
  StatsRow, StatCard, SkeletonList, ErrorState, EmptyState,
  StarRating, ratingColor, Badge, GhostBtn, Spinner,
  formatDate, formatRelative,
} from '../../components/dashboard/gb/GbUi';

/* ─────────────────────────────────────────────
   DashboardGoogleBusiness

   Überblicksseite. Zeigt alles auf einen Blick, geht aber für Details
   auf die Unterseiten — eine Seite, die alles kann, kann am Ende
   nichts gut.
───────────────────────────────────────────── */

const LocationGrid = styled.div`
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
`;

const LocationCard = styled(Card)`
  display: flex; flex-direction: column; gap: 10px;
  ${({ $primary }) => $primary && 'border-left: 3px solid var(--color-accent);'}
`;

const LocationHead = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
`;

const LocationName = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .95rem; color: var(--color-primary); line-height: 1.3;
`;

const LocationMeta = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); display: flex; align-items: center; gap: 5px;
`;

const LocationStats = styled.div`
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding-top: 10px; border-top: 1px solid var(--color-border);
  font-family: var(--font-body); font-size: .8rem; color: var(--color-text);
`;

const SyncBar = styled(Card)`
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  border-left: 3px solid ${({ $state }) =>
    $state === 'error'   ? '#D93025' :
    $state === 'running' ? 'var(--color-accent)' :
    $state === 'never'   ? '#D48A00' : '#1E7E34'};
`;

const SyncInfo = styled.div`display: flex; align-items: center; gap: 11px;`;

const SyncText = styled.div`
  p:first-child {
    font-family: var(--font-body); font-weight: 700; font-size: .87rem;
    color: var(--color-primary);
  }
  p:last-child {
    font-family: var(--font-body); font-size: .78rem;
    color: var(--color-text-muted); margin-top: 2px;
  }
`;

const ReviewRow = styled.div`
  display: flex; gap: 12px; padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }
`;

const Avatar = styled.div`
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%;
  background: ${({ $rating }) => ratingColor($rating)};
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: var(--heading-weight); font-size: .82rem;
`;

const ReviewBody = styled.div`flex: 1; min-width: 0;`;

const ReviewHead = styled.div`
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 3px;
`;

const ReviewAuthor = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .85rem;
  color: var(--color-primary);
`;

const ReviewDate = styled.span`
  font-family: var(--font-body); font-size: .75rem; color: var(--color-text-muted);
`;

const ReviewText = styled.p`
  font-family: var(--font-body); font-size: .84rem; line-height: 1.6;
  color: var(--color-text);
  /* Auf drei Zeilen kappen — die Übersicht soll überfliegbar bleiben. */
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden;
`;

const FooterLink = styled(Link)`
  display: inline-flex; align-items: center; gap: 6px; margin-top: 14px;
  font-family: var(--font-body); font-size: .84rem; font-weight: 700;
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

export default function DashboardGoogleBusiness() {
  const { brand } = useIndustry();
  const { isConnected, loading: connectionLoading } = useGoogleBusiness();
  const {
    locations, stats, replyCounts, lastSyncedAt, runningJob, lastFailedJob,
    loading, error, reload, triggerSync,
  } = useGoogleBusinessData();

  const [syncing, setSyncing] = React.useState(false);

  const [syncError, setSyncError] = React.useState(null);

  /*
   * Abgleich anstossen.
   *
   * Ohne Standorte wird der Standort-Sync ausgelöst, sonst der
   * Bewertungs-Sync je Standort. Vorher war der Knopf genau dann
   * ausgegraut, wenn man ihn am dringendsten braucht: frisch
   * verbunden, noch keine Standorte da.
   */
  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      if (locations.length === 0) {
        await triggerSync(null);
      } else {
        await Promise.all(locations.map((l) => triggerSync(l.id)));
      }
      await reload();
    } catch (err) {
      console.error('[DashboardGoogleBusiness] Sync:', err);
      setSyncError('Der Abgleich konnte nicht gestartet werden.');
    } finally {
      setSyncing(false);
    }
  };

  /* Ohne Verbindung gibt es nichts anzuzeigen — dann nur die Karte. */
  if (!connectionLoading && !isConnected) {
    return (
      <Page>
        <PageTitle>Google Business Profil</PageTitle>
        <PageSub>
          Verbinde dein Profil, damit {brand.name} Bewertungen, Standortdaten
          und Sichtbarkeit auswerten kann.
        </PageSub>
        <GoogleBusinessConnect />
      </Page>
    );
  }

  /* 'never' als eigener Zustand: vorher stand bei einem frisch
     verbundenen Konto "Daten sind aktuell / Zuletzt abgeglichen noch
     nie" — beides gleichzeitig, und das eine widerlegt das andere. */
  const syncState = lastFailedJob ? 'error'
    : runningJob ? 'running'
    : lastSyncedAt ? 'ok'
    : 'never';

  return (
    <Page>
      <PageTitle>Google Business Profil</PageTitle>
      <PageSub>Standorte, Bewertungen und Antworten auf einen Blick.</PageSub>

      <GoogleBusinessConnect />

      {error ? (
        <ErrorState message={error} onRetry={reload} busy={loading} />
      ) : (
        <>
          {/* ── KENNZAHLEN ── */}
          <StatsRow>
            <StatCard
              loading={loading}
              value={locations.length}
              label="Standorte"
              accent="var(--color-accent)"
            />
            <StatCard
              loading={loading}
              value={stats?.totalReviews ?? 0}
              label="Bewertungen"
              accent="#4A6FA5"
            />
            <StatCard
              loading={loading}
              value={stats?.averageRating ?? '—'}
              unit={stats?.averageRating ? '/ 5' : undefined}
              label="Durchschnitt"
              accent={stats?.averageRating ? ratingColor(Math.round(stats.averageRating)) : undefined}
            />
            <StatCard
              loading={loading}
              value={stats?.unanswered ?? 0}
              label="Unbeantwortet"
              accent={stats?.unanswered > 0 ? '#D48A00' : '#1E7E34'}
              hint={stats?.unanswered > 0 ? 'Warten auf eine Antwort' : 'Alles beantwortet'}
            />
          </StatsRow>

          <StatsRow>
            <StatCard
              loading={loading}
              value={replyCounts.draft}
              label="KI-Entwürfe offen"
              accent="#7B5EA7"
              hint={replyCounts.draft > 0 ? 'Warten auf deine Freigabe' : undefined}
            />
            <StatCard
              loading={loading}
              value={replyCounts.approved}
              label="In Veröffentlichung"
              accent="var(--color-accent)"
            />
            <StatCard
              loading={loading}
              value={replyCounts.published}
              label="Veröffentlicht"
              accent="#1E7E34"
            />
            <StatCard
              loading={loading}
              value={replyCounts.failed}
              label="Fehlgeschlagen"
              accent={replyCounts.failed > 0 ? '#D93025' : undefined}
              hint={replyCounts.failed > 0 ? 'Brauchen Aufmerksamkeit' : undefined}
            />
          </StatsRow>

          {/* ── SYNC-STATUS ── */}
          <SectionTitle><RefreshCw size={15} /> Synchronisation</SectionTitle>

          {syncError && (
            <Card style={{ borderLeft: '3px solid #D93025', marginBottom: 12 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '.84rem', color: '#B3261E' }}>
                {syncError}
              </p>
            </Card>
          )}

          {loading ? <SkeletonList count={1} height={72} /> : (
            <SyncBar $state={syncState}>
              <SyncInfo>
                {syncState === 'error'   ? <AlertTriangle size={19} color="#D93025" />
                  : syncState === 'running' ? <Spinner size={19} color="var(--color-accent)" />
                  : syncState === 'never'   ? <Clock size={19} color="#D48A00" />
                  : <CheckCircle size={19} color="#1E7E34" />}
                <SyncText>
                  <p>
                    {syncState === 'error'   ? 'Letzter Abgleich fehlgeschlagen'
                      : syncState === 'running' ? 'Abgleich läuft'
                      : syncState === 'never'   ? 'Noch kein Abgleich gelaufen'
                      : 'Daten sind aktuell'}
                  </p>
                  <p>
                    {syncState === 'error'
                      ? `Fehler: ${lastFailedJob.error_code ?? 'unbekannt'} · Versuch ${lastFailedJob.attempts} von ${lastFailedJob.max_attempts}`
                      : syncState === 'never'
                        ? 'Starte den ersten Abgleich, um Standorte und Bewertungen zu laden.'
                        : `Zuletzt abgeglichen ${formatRelative(lastSyncedAt)}`}
                  </p>
                </SyncText>
              </SyncInfo>

              <GhostBtn onClick={handleSyncAll} disabled={syncing}>
                {syncing ? <Spinner size={14} /> : <RefreshCw size={14} />} Jetzt abgleichen
              </GhostBtn>
            </SyncBar>
          )}

          {/* ── STANDORTE ── */}
          <SectionTitle><MapPin size={15} /> Standorte</SectionTitle>

          {loading ? <SkeletonList count={2} height={140} />
            : locations.length === 0 ? (
              <EmptyState
                title="Noch keine Standorte"
                text="Die Standorte werden beim ersten Abgleich aus deinem Google-Profil übernommen. Das kann einen Moment dauern."
                action={
                  <GhostBtn onClick={handleSyncAll} disabled={syncing}>
                    {syncing ? <Spinner size={14} /> : <RefreshCw size={14} />} Jetzt abgleichen
                  </GhostBtn>
                }
              />
            ) : (
              <LocationGrid>
                {locations.map((location) => (
                  <LocationCard key={location.id} $primary={location.is_primary}>
                    <LocationHead>
                      <div>
                        <LocationName>{location.title || 'Ohne Namen'}</LocationName>
                        {location.locality && (
                          <LocationMeta><MapPin size={11} />{location.locality}</LocationMeta>
                        )}
                      </div>
                      {location.is_primary && <Badge $variant="info">Haupt</Badge>}
                    </LocationHead>

                    <LocationStats>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Star size={13} color="#F5A623" />
                        {location.average_rating ? location.average_rating.toFixed(1) : '—'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MessageSquare size={13} color="var(--color-text-muted)" />
                        {location.review_count}
                      </span>
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        color: 'var(--color-text-muted)', fontSize: '.76rem',
                      }}>
                        <Clock size={12} />{formatRelative(location.last_synced_at)}
                      </span>
                    </LocationStats>
                  </LocationCard>
                ))}
              </LocationGrid>
            )}

          {/* ── NEUESTE BEWERTUNGEN ── */}
          <SectionTitle><Star size={15} /> Neueste Bewertungen</SectionTitle>
          <LatestReviews />
        </>
      )}
    </Page>
  );
}

/* ─────────────────────────────────────────────
   Neueste Bewertungen

   Eigene Komponente mit eigener Abfrage: fünf Zeilen brauchen weder
   Filter noch Blätterleiste, und die volle Liste hier einzubinden
   würde die Übersicht unnötig schwer machen.
───────────────────────────────────────────── */

function LatestReviews() {
  const [reviews, setReviews] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = (await import('../../supabaseClient')).default;
      const { data, error: queryError } = await supabase
        .from('google_reviews')
        .select('id, star_rating, comment, reviewer_display_name, google_created_at, is_answered')
        .eq('status', 'active')
        .order('google_created_at', { ascending: false })
        .limit(5);

      if (queryError) throw queryError;
      setReviews(data ?? []);
    } catch (err) {
      console.error('[LatestReviews]', err);
      setError('Die Bewertungen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <SkeletonList count={3} height={80} />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  if (reviews.length === 0) {
    return (
      <EmptyState
        title="Noch keine Bewertungen"
        text="Sobald der erste Abgleich gelaufen ist, erscheinen hier die neuesten Bewertungen."
      />
    );
  }

  return (
    <Card>
      {reviews.map((review) => (
        <ReviewRow key={review.id}>
          <Avatar $rating={review.star_rating}>
            {(review.reviewer_display_name || '?').charAt(0).toUpperCase()}
          </Avatar>
          <ReviewBody>
            <ReviewHead>
              <ReviewAuthor>{review.reviewer_display_name || 'Anonym'}</ReviewAuthor>
              <StarRating value={review.star_rating} size={12} />
              <ReviewDate>{formatDate(review.google_created_at)}</ReviewDate>
              {review.is_answered
                ? <Badge $variant="success"><Send size={9} />beantwortet</Badge>
                : <Badge $variant="warning"><FileText size={9} />offen</Badge>}
            </ReviewHead>
            {review.comment
              ? <ReviewText>{review.comment}</ReviewText>
              : <ReviewText style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                  Nur Sterne, kein Text
                </ReviewText>}
          </ReviewBody>
        </ReviewRow>
      ))}

      <FooterLink to="/dashboard/bewertungen">
        Alle Bewertungen ansehen <ArrowRight size={14} />
      </FooterLink>
    </Card>
  );
}
