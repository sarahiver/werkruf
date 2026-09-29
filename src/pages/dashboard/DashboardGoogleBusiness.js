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

const RefreshMarke = styled.span`
  font-family: var(--font-body); font-size: .72rem;
  color: var(--color-text-muted); white-space: nowrap;
`;

const EditorHinweis = styled.div`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.5;
  border-radius: 6px; padding: 9px 12px;
  border-left: 3px solid ${p => p.$art === 'ok' ? '#1E7E34' : '#D93025'};
  background: ${p => p.$art === 'ok' ? '#E8F5E9' : '#FDECEA'};
  color: ${p => p.$art === 'ok' ? '#1B5E20' : '#8B1A12'};
  strong { display: inline; }
  small { color: inherit; opacity: .8; }
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

/* Nur fuer den einmaligen Erstimport nach dem Verbinden.
   48 × 2,5 s = zwei Minuten. Danach fragt die Seite nicht weiter nach;
   der Job im Backend laeuft davon unberuehrt weiter. */
const ERSTIMPORT_INTERVALL_MS = 2500;
const ERSTIMPORT_MAX = 48;

export default function DashboardGoogleBusiness() {
  const { brand } = useIndustry();
  const googleBusiness = useGoogleBusiness();
  const { isConnected, loading: connectionLoading } = googleBusiness;
  const {
    locations, stats, replyCounts, lastSyncedAt, latestJob, lastFailedJob,
    failedJobHistory, stalledJobs, locationImport, loading, refreshing, error,
    reload, refresh, triggerSync, updateLocation, selectLocation,
  } = useGoogleBusinessData({ enabled: !connectionLoading && isConnected });

  const [syncing, setSyncing] = React.useState(false);

  const [syncError, setSyncError] = React.useState(null);
  const erstimportRef = React.useRef(false);

  /*
   * EINMALIGER ERSTIMPORT nach dem Verbinden.
   *
   * OAuth autorisiert ein Konto, nicht einen Betrieb. Welche
   * Unternehmen das Konto verwaltet, holt erst der Standortimport.
   * Darauf bis zum naechsten stuendlichen Scheduler-Lauf zu warten,
   * waere fuer einen frisch verbundenen Kunden unzumutbar.
   *
   * Der Zustand kommt aus locationImport, nicht aus einer Ref: Eine Ref
   * wird bei jedem Seitenaufbau zurueckgesetzt, und ein erfolgreicher
   * Import, der null Betriebe fand, loeste dadurch bei jedem Reload
   * einen neuen aus.
   */
  React.useEffect(() => {
    if (!isConnected || connectionLoading || loading) return;
    if (locations.length > 0) return;
    if (locationImport.status !== 'none') return;   // schon gelaufen
    if (erstimportRef.current) return;              // nur einmal je Seitenaufbau
    erstimportRef.current = true;
    triggerSync(null).catch(() =>
      setSyncError('Deine verwaltbaren Betriebe konnten nicht geladen werden.'));
  }, [isConnected, connectionLoading, loading, locations.length, locationImport.status, triggerSync]);

  /*
   * Fortschritt NUR fuer diesen Einrichtungsschritt.
   *
   * Das ist der einzige verbliebene Fortschrittsanzeiger im
   * Kundendashboard. Regulaere Hintergrundabgleiche bekommen keinen —
   * sie sind kein Ereignis, das Aufmerksamkeit braucht.
   *
   * Endet, sobald der Import ein Ergebnis hat: Betriebe da, null
   * Betriebe gefunden, oder gescheitert.
   */
  React.useEffect(() => {
    if (!isConnected || locationImport.status !== 'running') return undefined;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      refresh();
      if (polls >= ERSTIMPORT_MAX) {
        window.clearInterval(timer);
        setSyncError('Das Laden deiner Betriebe dauert ungewöhnlich lange. Sieh in ein paar Minuten erneut nach.');
      }
    }, ERSTIMPORT_INTERVALL_MS);
    return () => window.clearInterval(timer);
  }, [isConnected, locationImport.status, refresh]);

  /* Kein Polling fuer regulaere Hintergrundabgleiche mehr.
     Entfernt am 29.09. mit dem Knopf "Jetzt abgleichen". Damit
     entfallen Spinner, Zeitlimit, Verzoegerungszustand und die
     Statusabfrage alle drei Sekunden. */

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
  /* handleSync entfernt am 29.09.
     Der Kunde stoesst keine Synchronisierung mehr an. Der Scheduler
     plant stuendlich, der Worker arbeitet alle fuenf Minuten ab. Ein
     manueller Abgleich bleibt im Admin-Bereich verfuegbar. */

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
  /* Ruhiger Zustand: Ein laufender Hintergrundjob taucht hier NICHT
     mehr auf. Nur ein weiterhin bestehender Fehler oder ein noch nie
     gelaufener Abgleich verdienen einen Hinweis. */
  const syncState = lastFailedJob ? 'error'
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

          {/* Ruhige Statusinformation statt Synchronisationskarte.
              Kein Spinner fuer regulaere Hintergrundjobs, kein
              Abgleich-Knopf. Bezieht sich auf den ausgewaehlten
              Betrieb — lastSyncedAt ist darauf begrenzt. */}
          {loading ? <SkeletonList count={1} height={72} /> : (
            <SyncBar $state={syncState}>
              <SyncInfo>
                {syncState === 'error' ? <AlertTriangle size={19} color="#D93025" />
                  : syncState === 'never' ? <Clock size={19} color="#D48A00" />
                  : <CheckCircle size={19} color="#1E7E34" />}
                <SyncText>
                  <p>
                    {syncState === 'error' ? 'Letzter Abgleich fehlgeschlagen'
                      : syncState === 'never' ? 'Einrichtung läuft'
                      : 'Dein Google-Unternehmensprofil wird automatisch aktualisiert'}
                  </p>
                  <p>
                    {syncState === 'error'
                      ? `Fehler: ${lastFailedJob.error_code ?? 'unbekannt'} · Versuch ${lastFailedJob.attempts} von ${lastFailedJob.max_attempts}`
                      : syncState === 'never'
                        ? 'Die ersten Daten werden geladen. Das dauert einen Moment — du musst nichts tun.'
                        : `Zuletzt erfolgreich abgeglichen: ${formatRelative(lastSyncedAt)}`}
                  </p>
                </SyncText>
              </SyncInfo>

              {/* Dezenter Hinweis auf die stille Aktualisierung — kein
                  Skeleton, kein Spinner. */}
              {refreshing && <RefreshMarke>wird aktualisiert…</RefreshMarke>}
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
              /* Drei verschiedene Zustaende, die vorher alle denselben
                 Knopf zeigten. Besonders der mittlere: Ein Import, der
                 null Betriebe fand, ist ein ERGEBNIS — kein Anlass,
                 es nochmal zu versuchen. */
              locationImport.keineBetriebe ? (
                <EmptyState
                  title="Keine verwaltbaren Betriebe gefunden"
                  text={'Google hat für das verbundene Konto kein Unternehmensprofil zurückgegeben, das du verwalten darfst. '
                    + 'Prüfe, ob du im Google-Unternehmensprofil als Inhaber oder Administrator eingetragen bist — '
                    + 'und ob du dich mit dem richtigen Konto verbunden hast.'}
                />
              ) : locationImport.status === 'failed' ? (
                <EmptyState
                  title="Betriebe konnten nicht geladen werden"
                  text={`Der Import ist gescheitert (${locationImport.job?.error_code ?? 'unbekannt'}). `
                    + 'WERKRUF versucht es beim nächsten regulären Lauf erneut.'}
                />
              ) : (
                <EmptyState
                  title="Deine Betriebe werden geladen"
                  text="WERKRUF holt gerade die Unternehmen, die du bei Google verwaltest. Das dauert einen Moment — du musst nichts tun."
                />
              )
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

/**
 * Profil-Editor.
 *
 * Drei Regeln, die diese Komponente einhalten muss:
 *
 * 1. NUR tatsaechlich geaenderte Felder werden uebertragen. Vorher
 *    gingen bei jedem Speichern alle drei raus — mit updateMask
 *    "phoneNumbers,profile,websiteUri". Google ersetzt bei
 *    updateMask=profile das GESAMTE profile-Objekt: Wer nur die
 *    Beschreibung aenderte, loeschte damit jedes andere Unterfeld,
 *    das Google dort fuehrt. Jetzt Punktpfade, also
 *    profile.description.
 *
 * 2. Die Rueckmeldung behauptet nicht mehr, als bekannt ist. Eine
 *    erfolgreiche PATCH-Antwort heisst: Google hat die Aenderung
 *    ANGENOMMEN. Ob sie oeffentlich auf Maps erscheint, sagt die API
 *    nicht — Google prueft eingereichte Aenderungen und veroeffentlicht
 *    sie spaeter oder gar nicht. "Von Google bestaetigt" war deshalb
 *    falsch.
 *
 * 3. Erfolg und Fehler sind getrennte Zustaende. Vorher landeten beide
 *    im selben notice-String und sahen gleich aus.
 */
function LocationProfileEditor({ location, onSave }) {
  /* Ausgangswerte aus dem bestaetigten Google-Stand. */
  const urspruenglich = React.useMemo(() => ({
    telefon:      location.primary_phone || '',
    website:      location.website_uri || '',
    beschreibung: location.google_profile?.profile?.description || '',
  }), [location.primary_phone, location.website_uri, location.google_profile]);

  const [telefon, setTelefon]           = React.useState(urspruenglich.telefon);
  const [website, setWebsite]           = React.useState(urspruenglich.website);
  const [beschreibung, setBeschreibung] = React.useState(urspruenglich.beschreibung);

  const [busy, setBusy]       = React.useState(false);
  const [erfolg, setErfolg]   = React.useState(null);
  const [fehler, setFehler]   = React.useState(null);

  /* Nach erfolgreichem Speichern liefert der Server den bestaetigten
     Stand; die Ausgangswerte wandern nach. Ohne das gaelte das Feld
     weiterhin als geaendert und ginge beim naechsten Mal erneut raus. */
  React.useEffect(() => {
    setTelefon(urspruenglich.telefon);
    setWebsite(urspruenglich.website);
    setBeschreibung(urspruenglich.beschreibung);
  }, [urspruenglich]);

  const geaendert = {
    telefon:      telefon.trim()      !== urspruenglich.telefon,
    website:      website.trim()      !== urspruenglich.website,
    beschreibung: beschreibung.trim() !== urspruenglich.beschreibung,
  };
  const etwasGeaendert = Object.values(geaendert).some(Boolean);

  const speichern = async () => {
    setBusy(true); setErfolg(null); setFehler(null);

    /* Punktpfade: Jeder Eintrag ersetzt genau dieses Unterfeld.
       Unveraenderte Felder tauchen gar nicht erst auf und landen damit
       auch nicht in der updateMask. */
    const aenderungen = {};

    /* phoneNumbers akzeptiert Google NUR als Ganzes — das Discovery-
       Dokument sagt ausdruecklich, dass primaryPhone und
       additionalPhones nicht einzeln ueber die updateMask geaendert
       werden duerfen. Die vorhandenen additionalPhones werden deshalb
       mitgeschickt, sonst loescht das Speichern sie. */
    if (geaendert.telefon) {
      aenderungen.phoneNumbers = {
        ...(location.google_profile?.phoneNumbers || {}),
        primaryPhone: telefon.trim() || null,
      };
    }

    if (geaendert.website) aenderungen.websiteUri = website.trim() || null;

    /* profile hat nur das Unterfeld description — hier ist der
       Punktpfad zulaessig und genauer. */
    if (geaendert.beschreibung) aenderungen['profile.description'] = beschreibung.trim() || null;

    try {
      const antwort = await onSave(location.id, aenderungen);

      /* Nur bei confirmed: true. Alles andere ist keine Bestaetigung. */
      if (antwort?.confirmed) {
        setErfolg({
          felder: antwort.updateMask ? antwort.updateMask.split(',') : Object.keys(aenderungen),
        });
      } else {
        setFehler('Google hat die Änderung nicht bestätigt. Bitte versuche es erneut.');
      }
    } catch (error) {
      setFehler(error.message || 'Die Änderung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
      <small>Name, Adresse und Verifizierungsstatus werden von Google nur lesend angezeigt.</small>

      <ProfileInput aria-label="Telefonnummer" value={telefon}
        onChange={(e) => setTelefon(e.target.value)} placeholder="Telefonnummer" />
      <ProfileInput aria-label="Website" value={website}
        onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
      <ProfileTextarea aria-label="Unternehmensbeschreibung" value={beschreibung}
        onChange={(e) => setBeschreibung(e.target.value)} placeholder="Unternehmensbeschreibung" />

      {location.google_diff_mask?.length > 0 && (
        <Badge $variant="warning">Google-Änderung: {location.google_diff_mask.join(', ')}</Badge>
      )}

      <div>
        <GhostBtn onClick={speichern} disabled={busy || !etwasGeaendert}>
          {busy ? <Spinner size={14} /> : <Send size={14} />}
          {busy ? 'Wird übermittelt…' : 'Bei Google speichern'}
        </GhostBtn>
      </div>

      {erfolg && (
        <EditorHinweis $art="ok">
          <strong>An Google übermittelt.</strong>{' '}
          Google kann die Veröffentlichung noch überprüfen — bis dahin ist im
          Unternehmensprofil weiterhin der bisherige Stand sichtbar.
          {erfolg.felder.length > 0 && (
            <><br /><small>Übermittelt: {erfolg.felder.join(', ')}</small></>
          )}
        </EditorHinweis>
      )}

      {fehler && (
        <EditorHinweis $art="fehler" role="alert">
          <strong>Nicht gespeichert.</strong> {fehler}
        </EditorHinweis>
      )}
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
