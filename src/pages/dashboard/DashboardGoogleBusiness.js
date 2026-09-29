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
  border-color: ${p => p.$active ? 'var(--color-accent)' : 'var(--color-border)'};
  border-width: ${p => p.$active ? '2px' : '1px'};
  border-style: solid;
  display: flex; flex-direction: column; gap: 10px;
  ${({ $primary }) => $primary && 'border-left: 3px solid var(--color-accent);'}
`;

const LocationHead = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
`;

const SyncAktionen = styled.div`
  display: flex; align-items: center; gap: 12px;
`;

const RefreshMarke = styled.span`
  font-family: var(--font-body); font-size: .72rem;
  color: var(--color-text-muted); white-space: nowrap;
`;

const HistorieZeile = styled.p`
  font-family: var(--font-body); font-size: .76rem;
  color: var(--color-text-muted); line-height: 1.55;
  margin: 10px 0 0; padding-left: 2px;
`;

const AktivMarke = styled.span`
  display: inline-block; margin-left: 8px; vertical-align: 2px;
  background: var(--color-accent); color: #fff;
  font-size: .64rem; font-weight: 800; letter-spacing: .5px;
  text-transform: uppercase; border-radius: 3px; padding: 2px 6px;
`;

const AktivHinweis = styled.p`
  display: flex; align-items: center; gap: 6px; margin: 10px 0 0;
  font-size: .78rem; font-weight: 700; color: #1E7E34;
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
const ProfileInput = styled.input`
  width: 100%; padding: 9px 10px; border: 1px solid var(--color-border);
  border-radius: 7px; font: .82rem var(--font-body); background: var(--color-bg);
`;
const ProfileTextarea = styled.textarea`
  width: 100%; min-height: 76px; resize: vertical; padding: 9px 10px;
  border: 1px solid var(--color-border); border-radius: 7px;
  font: .82rem var(--font-body); background: var(--color-bg);
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

/* 40 × 3 s = zwei Minuten. Danach fragt die Seite nicht weiter nach;
   der Job im Backend laeuft davon unberuehrt weiter. */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX = 40;

export default function DashboardGoogleBusiness() {
  const { brand } = useIndustry();
  const googleBusiness = useGoogleBusiness();
  const { isConnected, loading: connectionLoading } = googleBusiness;
  const {
    locations, stats, replyCounts, lastSyncedAt, latestJob, runningJob, lastFailedJob,
    failedJobHistory, stalledJobs, loading, refreshing, error,
    reload, refresh, triggerSync, updateLocation, selectLocation,
  } = useGoogleBusinessData({ enabled: !connectionLoading && isConnected });

  const [syncing, setSyncing] = React.useState(false);

  const [syncError, setSyncError] = React.useState(null);
  const initialSyncRef = React.useRef(false);

  /* Google OAuth grants an account. The actual businesses are fetched only
     afterwards. Start that import automatically and poll while it is queued so
     a freshly connected user does not have to discover the sync button. */
  React.useEffect(() => {
    if (!isConnected || connectionLoading || loading || locations.length > 0 || initialSyncRef.current) return;
    initialSyncRef.current = true;
    triggerSync(null).catch(() => setSyncError('Deine verwaltbaren Betriebe konnten nicht geladen werden.'));
  }, [isConnected, connectionLoading, loading, locations.length, triggerSync]);

  /* Wartet auf den ersten Standortimport nach dem Verbinden.
     refresh() statt reload(): still nachladen, ohne die Seite auf
     Skeletons zurueckzusetzen. */
  React.useEffect(() => {
    if (!isConnected || locations.length > 0 || lastFailedJob) return undefined;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      refresh();
      if (polls >= 48) {
        window.clearInterval(timer);
        setSyncError('Das Laden dauert ungewöhnlich lange. Bitte versuche den Abgleich erneut.');
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isConnected, locations.length, lastFailedJob, refresh]);

  /* Nach dem Start eines Abgleichs den Status nachladen, bis ein
     endgültiges Ergebnis vorliegt.

     Beendet wird das Polling, sobald kein Job mehr queued oder running
     ist — dann steht succeeded oder failed fest — oder nach zwei
     Minuten. Ein fehlender Worker darf den Browser nicht endlos
     nachfragen lassen. */
  /*
   * Ein Polling-Zyklus je Job — nicht mehr.
   *
   * Der Effekt haengt allein an runningJob.id. Das Objekt selbst
   * aendert sich bei jedem Laden, die ID nicht; ohne diese Einengung
   * wuerde jeder Abruf das Intervall neu starten und mehrere Zyklen
   * liefen nebeneinander.
   *
   * Beendet wird der Zyklus, sobald der Job nicht mehr queued oder
   * running ist — dann steht succeeded oder failed fest und
   * runningJob wird null, was den Effekt aufraeumt. Beim
   * Betriebswechsel wechselt die ID ebenfalls, das alte Intervall
   * wird verworfen. Beim Verlassen der Seite greift die
   * Aufraeumfunktion.
   *
   * Nach dem Zeitlimit wird NICHT weiter gefragt und der Job NICHT als
   * gescheitert markiert — das entscheidet allein das Backend. Die
   * Oberflaeche zeigt stattdessen einen Verzoegerungszustand.
   */
  const [delayedJobId, setDelayedJobId] = React.useState(null);

  React.useEffect(() => {
    const jobId = runningJob?.id;
    if (!jobId) return undefined;

    setDelayedJobId((aktuell) => (aktuell === jobId ? aktuell : null));

    let abgelaufen = false;
    let polls = 0;

    const timer = window.setInterval(() => {
      if (abgelaufen) return;
      polls += 1;
      refresh();
      if (polls >= POLL_MAX) {
        abgelaufen = true;
        window.clearInterval(timer);
        setDelayedJobId(jobId);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      abgelaufen = true;
      window.clearInterval(timer);
    };
  }, [runningJob?.id, refresh]);

  /* Der Verzoegerungshinweis gilt nur fuer den Job, der ihn ausgeloest
     hat. Sobald ein anderer Job laeuft oder keiner mehr offen ist,
     verschwindet er von selbst. */
  const jobVerzoegert = Boolean(delayedJobId) && delayedJobId === runningJob?.id;

  /* Die serverseitig bestätigte Auswahl ist die einzige Quelle für
     Kennzahlen. Ein lokaler "alle"-Zustand würde Betriebe vermischen. */
  const persistedSelection = locations.find((location) => location.selected_at)?.id ?? '';
  const [selectedLocation, setSelectedLocation] = React.useState('');
  React.useEffect(() => {
    setSelectedLocation(persistedSelection);
  }, [persistedSelection]);

  /*
   * Abgleich anstossen.
   *
   * Ohne Standorte wird der Standort-Sync ausgelöst, sonst der
   * Bewertungs-Sync je Standort. Vorher war der Knopf genau dann
   * ausgegraut, wenn man ihn am dringendsten braucht: frisch
   * verbunden, noch keine Standorte da.
   */
  /*
   * Abgleich anstossen.
   *
   * Drei Faelle, in dieser Reihenfolge:
   *   keine Standorte  → Standortimport, um die verwaltbaren Betriebe
   *                      erst einmal aus Google zu holen
   *   Betrieb gewaehlt → Bewertungs-Sync AUSSCHLIESSLICH fuer dessen
   *                      location_id
   *   nichts gewaehlt  → Hinweis statt Sammelabgleich
   *
   * Vorher lief hier Promise.all ueber alle Standorte. Bei zwei
   * Betrieben verbrauchte ein Klick doppelt Google-Quota und
   * aktualisierte auch den Betrieb, den der Nutzer gerade nicht
   * ansieht.
   */
  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      if (locations.length === 0) {
        await triggerSync(null);
      } else if (selectedLocation) {
        await triggerSync(selectedLocation);
      } else {
        setSyncError('Bitte wähle zuerst den Betrieb, den du abgleichen möchtest.');
        return;
      }
      await reload();
    } catch (err) {
      console.error('[DashboardGoogleBusiness] Sync:', err);
      setSyncError('Der Abgleich konnte nicht gestartet werden.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectLocation = async (locationId) => {
    setSyncing(true);
    setSyncError(null);
    try {
      await selectLocation(locationId);
      setSelectedLocation(locationId);
    } catch (err) {
      /* selectionPersisted heisst: Der Wechsel hat geklappt, nur der
         Abgleich lief nicht an. Die Auswahl darf dann nicht
         zurueckspringen. */
      if (err?.selectionPersisted) setSelectedLocation(locationId);
      setSyncError(err.message || 'Der Betrieb konnte nicht ausgewählt werden.');
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
        <GoogleBusinessConnect googleBusiness={googleBusiness} />

      </Page>
    );
  }

  /* 'never' als eigener Zustand: vorher stand bei einem frisch
     verbundenen Konto "Daten sind aktuell / Zuletzt abgeglichen noch
     nie" — beides gleichzeitig, und das eine widerlegt das andere. */
  const visibleLocations = selectedLocation
    ? locations.filter((l) => l.id === selectedLocation)
    : locations;

  const scopedStats = selectedLocation ? stats : null;

  /* Der juengste Job des ausgewaehlten Betriebs bestimmt den Zustand.
     lastFailedJob ist seit dem 29.09. nur noch gesetzt, wenn der
     juengste Job gescheitert ist — ein alter Fehlschlag verdraengt
     keinen spaeteren Erfolg mehr. */
  const syncState = jobVerzoegert ? 'delayed'
    : runningJob ? 'running'
    : lastFailedJob ? 'error'
    : lastSyncedAt ? 'ok'
    : latestJob?.status === 'succeeded' ? 'ok'
    : 'never';

  return (
    <Page>
      <PageTitle>Google Business Profil</PageTitle>
      <PageSub>Standorte, Bewertungen und Antworten auf einen Blick.</PageSub>

      <GoogleBusinessConnect googleBusiness={googleBusiness} />

      {/* Dauerhaft erreichbar, nicht nur bis zur ersten Auswahl.
          Ein Google-Konto kann mehrere Unternehmen verwalten; wer
          wechseln will, muss das jederzeit koennen. */}
      {!loading && locations.length > 0 && (
        <Card>
          <SectionTitle>
            {locations.length > 1 ? 'Betrieb auswählen' : 'Verwalteter Betrieb'}
          </SectionTitle>
          <PageSub>
            {selectedLocation
              ? 'Alle Kennzahlen, Bewertungen und Aufgaben unten beziehen sich auf den ausgewählten Betrieb. Du kannst jederzeit wechseln.'
              : 'Google hat diese Betriebe für dein autorisiertes Konto zurückgegeben. Wähle den Betrieb, den du mit WERKRUF verwalten möchtest.'}
          </PageSub>
          <LocationGrid>
            {locations.map((location) => {
              const aktiv = location.id === selectedLocation;
              return (
                <LocationCard key={location.id} $active={aktiv}>
                  <LocationName>
                    {location.title || 'Betrieb ohne Namen'}
                    {aktiv && <AktivMarke>ausgewählt</AktivMarke>}
                  </LocationName>
                  <LocationMeta><MapPin size={13}/>{location.locality || 'Ort nicht angegeben'}</LocationMeta>
                  {aktiv ? (
                    <AktivHinweis><CheckCircle size={13}/>Wird gerade verwaltet</AktivHinweis>
                  ) : (
                    <GhostBtn onClick={() => handleSelectLocation(location.id)} disabled={syncing}>
                      {syncing ? <Spinner size={14}/> : <>Zu diesem Betrieb wechseln <ArrowRight size={14}/></>}
                    </GhostBtn>
                  )}
                </LocationCard>
              );
            })}
          </LocationGrid>
        </Card>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} busy={loading} />
      ) : (
        <>
          {/* ── KENNZAHLEN ── */}
          <StatsRow>
            <StatCard
              loading={loading}
              value={selectedLocation ? 1 : '—'}
              label="Ausgewählter Betrieb"
              accent="var(--color-accent)"
            />
            <StatCard
              loading={loading}
              value={scopedStats?.totalReviews ?? 0}
              label="Bewertungen"
              accent="#4A6FA5"
            />
            <StatCard
              loading={loading}
              value={scopedStats?.averageRating ?? '—'}
              unit={scopedStats?.averageRating ? '/ 5' : undefined}
              label="Durchschnitt"
              accent={scopedStats?.averageRating
                ? ratingColor(Math.round(scopedStats.averageRating)) : undefined}
            />
            <StatCard
              loading={loading}
              value={scopedStats?.unanswered ?? '—'}
              label="Unbeantwortet"
              accent={scopedStats?.unanswered > 0 ? '#D48A00' : '#1E7E34'}
              hint={scopedStats?.unanswered === null ? 'Nur über alle Standorte'
                : scopedStats?.unanswered > 0 ? 'Warten auf eine Antwort' : 'Alles beantwortet'}
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
                  : syncState === 'delayed' ? <Clock size={19} color="#D48A00" />
                  : syncState === 'running' ? <Spinner size={19} color="var(--color-accent)" />
                  : syncState === 'never'   ? <Clock size={19} color="#D48A00" />
                  : <CheckCircle size={19} color="#1E7E34" />}
                <SyncText>
                  <p>
                    {syncState === 'error'   ? 'Letzter Abgleich fehlgeschlagen'
                      : syncState === 'delayed' ? 'Abgleich dauert länger als üblich'
                      : syncState === 'running' ? 'Abgleich läuft'
                      : syncState === 'never'   ? 'Noch kein Abgleich gelaufen'
                      : 'Daten sind aktuell'}
                  </p>
                  <p>
                    {syncState === 'error'
                      ? `Fehler: ${lastFailedJob.error_code ?? 'unbekannt'} · Versuch ${lastFailedJob.attempts} von ${lastFailedJob.max_attempts}`
                      : syncState === 'delayed'
                        /* Bewusst KEINE Fehlermeldung: Der Job läuft im
                           Hintergrund weiter, nur diese Seite fragt
                           nicht mehr nach. */
                        ? 'Der Auftrag ist weiterhin eingereiht. Lade die Seite später neu oder starte den Abgleich erneut.'
                      : syncState === 'never'
                        ? 'Starte den ersten Abgleich, um Standorte und Bewertungen zu laden.'
                        : `Zuletzt abgeglichen ${formatRelative(lastSyncedAt)}`}
                  </p>
                </SyncText>
              </SyncInfo>

              <SyncAktionen>
                {/* Dezenter Hinweis auf die stille Aktualisierung.
                    Bewusst KEIN Skeleton: Kennzahlen, Standortkarten und
                    offene Formulare bleiben stehen. */}
                {refreshing && <RefreshMarke>wird aktualisiert…</RefreshMarke>}
                <GhostBtn onClick={handleSync} disabled={syncing}>
                  {syncing ? <Spinner size={14} /> : <RefreshCw size={14} />} Jetzt abgleichen
                </GhostBtn>
              </SyncAktionen>
            </SyncBar>
          )}

          {/* Historie. Fruehere Fehlschlaege bleiben sichtbar, bestimmen
              aber nicht mehr den aktuellen Zustand — genau das war der
              Fehler: Ein Fehlversuch von vor Wochen meldete dauerhaft
              einen Fehler, den es nicht mehr gab. */}
          {stalledJobs.length > 0 && (
            <HistorieZeile>
              {stalledJobs.length === 1
                ? 'Ein älterer Auftrag steht noch offen'
                : `${stalledJobs.length} ältere Aufträge stehen noch offen`}
              {' — '}sie bestimmen den Status oben nicht. Häufen sie sich, werden Aufträge eingereiht, aber nicht abgearbeitet.
            </HistorieZeile>
          )}

          {syncState !== 'error' && failedJobHistory.length > 0 && (
            <HistorieZeile>
              {failedJobHistory.length === 1
                ? 'Ein früherer Abgleich war fehlgeschlagen'
                : `${failedJobHistory.length} frühere Abgleiche waren fehlgeschlagen`}
              {' — '}zuletzt {formatRelative(failedJobHistory[0].created_at)}. Der aktuelle Stand ist davon nicht betroffen.
            </HistorieZeile>
          )}

          {/* ── STANDORTE ── */}
          <SectionTitle><MapPin size={15} /> Standorte</SectionTitle>

          {loading ? <SkeletonList count={2} height={140} />
            : visibleLocations.length === 0 ? (
              <EmptyState
                title="Noch keine Standorte"
                text="Die Standorte werden beim ersten Abgleich aus deinem Google-Profil übernommen. Das kann einen Moment dauern."
                action={
                  <GhostBtn onClick={handleSync} disabled={syncing}>
                    {syncing ? <Spinner size={14} /> : <RefreshCw size={14} />} Jetzt abgleichen
                  </GhostBtn>
                }
              />
            ) : (
              <LocationGrid>
                {visibleLocations.map((location) => (
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
                    <LocationProfileEditor location={location} onSave={updateLocation} />
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

function LocationProfileEditor({ location, onSave }) {
  const [phone, setPhone] = React.useState(location.primary_phone || '');
  const [website, setWebsite] = React.useState(location.website_uri || '');
  const [description, setDescription] = React.useState(location.google_profile?.profile?.description || '');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const save = async () => {
    setBusy(true); setNotice('');
    try {
      await onSave(location.id, {
        phoneNumbers: { ...(location.google_profile?.phoneNumbers || {}), primaryPhone: phone || null },
        websiteUri: website || null,
        profile: { description: description || null },
      });
      setNotice('Von Google bestätigt.');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
      <small>Name, Adresse und Verifizierungsstatus werden von Google nur lesend angezeigt.</small>
      <ProfileInput aria-label="Telefonnummer" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefonnummer" />
      <ProfileInput aria-label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
      <ProfileTextarea aria-label="Unternehmensbeschreibung" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Unternehmensbeschreibung" />
      {location.google_diff_mask?.length > 0 && <Badge $variant="warning">Google-Änderung: {location.google_diff_mask.join(', ')}</Badge>}
      <div><GhostBtn onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : <Send size={14} />} Bei Google speichern</GhostBtn></div>
      {notice && <small>{notice}</small>}
    </div>
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
