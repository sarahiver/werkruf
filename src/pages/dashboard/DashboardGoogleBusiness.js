import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  MapPin, Star, MessageSquare, RefreshCw, CheckCircle, Settings,
  AlertTriangle, Clock, ArrowRight, Send, FileText,
} from 'lucide-react';
import { useIndustry } from '../../context/IndustryContext';
import { useAuthContext } from '../../context/AuthContext';
import { useGoogleBusiness } from '../../hooks/useGoogleBusiness';
import { useGoogleBusinessData } from '../../hooks/useGoogleBusinessData';
import GoogleBusinessConnect from '../../components/dashboard/GoogleBusinessConnect';
import {
  darfAutoStarten, vermerkeVersuch, loescheOnboardingAbsicht, onboardingOffen, onboardingSchritt,
} from '../../utils/onboardingAbsicht';
import GoogleProfilVerwalten from '../../components/dashboard/GoogleProfilVerwalten';
import StammdatenEditor from '../../components/dashboard/StammdatenEditor';
import OeffnungszeitenEditor from '../../components/dashboard/OeffnungszeitenEditor';
import KategorienEditor from '../../components/dashboard/KategorienEditor';
import WeitereZeitenEditor from '../../components/dashboard/WeitereZeitenEditor';
import AttributeEditor from '../../components/dashboard/AttributeEditor';
import {
  Page, PageTitle, PageSub, SectionTitle, Card,
  StatsRow, StatCard, SkeletonList, ErrorState, EmptyState,
  StarRating, ratingColor, Badge, GhostBtn, Spinner,
  formatDate, formatRelative,
} from '../../components/dashboard/gb/GbUi';
import EinrichtungsFortschritt, {
  leiteEinrichtungAb,
} from '../../components/dashboard/gb/EinrichtungsFortschritt';

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

const HistorieZeile = styled.p`
  font-family: var(--font-body); font-size: .76rem;
  color: var(--color-text-muted); line-height: 1.55;
  margin: 10px 0 0; padding-left: 2px;
`;

/* Erscheint erst, wenn die Seite aufgehoert hat, von selbst
   nachzufragen. Der Zusatz steht daneben, nicht im Knopf: Was der
   Knopf tut — und vor allem, was er NICHT tut — gehoert sichtbar
   dazu. */
const NachsehenZeile = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 10px; padding-left: 2px;
  span {
    font-family: var(--font-body); font-size: .76rem;
    color: var(--color-text-muted);
  }
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

const SyncBar = styled(Card)`
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  /* reauth gehoert zu den roten Zustaenden. Ohne eigenen Zweig fiele
     er in den Standardfall und bekaeme einen gruenen Balken neben dem
     Satz "Verbindung muss erneuert werden" — die Farbe wuerde dem
     Text widersprechen, und die Farbe gewinnt. */
  border-left: 3px solid ${({ $state }) =>
    $state === 'error'   ? '#D93025' :
    $state === 'reauth'  ? '#D93025' :
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

/*
 * Nachfragen waehrend des einmaligen Erstimports.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM GESTUFT UND WARUM SO LANGE
 * ═══════════════════════════════════════════════════════════════
 *
 * Hier stand bis zum 20.10.2026: 48 × 2,5 s = zwei Minuten, danach
 * eine rote Meldung "dauert ungewoehnlich lange".
 *
 * Das war falsch gerechnet. sync/trigger REIHT einen Job nur EIN; der
 * Worker holt ihn ab, und gbp-worker laeuft im Fuenf-Minuten-Takt —
 * also alle 300 Sekunden, siehe den Zeitplan in
 * supabase/migrations/20261012120000_cron_kanonisch.sql.
 * Die Seite gab damit auf, bevor der Worker das erste Mal nachsah.
 *
 * Im Durchgang am 20.10.2026 beobachtet: rote Meldung um 15:09, beide
 * Betriebe um 15:11 da. Der Job war nie kaputt. Die Meldung erschien
 * nicht TROTZ, sondern WEGEN des Normalbetriebs — im Mittel wartet ein
 * frisch verbundener Kunde zweieinhalb Minuten, im schlechtesten Fall
 * fuenf.
 *
 * Deshalb gestuft statt gleichmaessig: dicht am Anfang, falls der
 * Worker-Takt gerade bevorsteht, danach sparsam. Ein gleichmaessiges
 * 2,5-Sekunden-Raster ueber 18 Minuten waeren 432 Abfragen — nach dem
 * Disk-IO-Befund vom 19.10. ist das kein theoretisches Argument.
 *
 *   Lauf  1–10   alle  3 s   →  30 s
 *   Lauf 11–25   alle 10 s   →   3 min
 *   Lauf 26–55   alle 30 s   →  18 min
 *
 * 55 Abfragen statt 432, und die Geduld der Seite ist zum ersten Mal
 * groesser als die Taktung des Systems.
 *
 * Danach KEINE Fehlermeldung. Ein Auftrag, der noch in der
 * Warteschlange steht, ist kein Fehler — er bekommt den ehrlichen
 * Satz und einen Knopf zum Nachsehen.
 */
const ERSTIMPORT_STUFEN = [
  { bisLauf: 10, abstand:  3000 },
  { bisLauf: 25, abstand: 10000 },
  { bisLauf: 55, abstand: 30000 },
];

/* Wie oft die verstrichene Zeit neu gerechnet wird. Rein oertlich,
   kein Netzzugriff — und die Dauer wird ohnehin erst jenseits der
   Sechs-Minuten-Schwelle ueberhaupt angezeigt. */
const UHR_TAKT_MS = 10000;

export default function DashboardGoogleBusiness() {
  const { brand } = useIndustry();
  const googleBusiness = useGoogleBusiness();
  const {
    isConnected, loading: connectionLoading,
    busy: verbindungBusy, error: verbindungsFehler, connect,
  } = googleBusiness;
  const {
    locations, stats, replyCounts, lastSyncedAt, latestJob, lastFailedJob,
    failedJobHistory, stalledJobs, locationImport, runningJob,
    loading, refreshing, error,
    reload, refresh, triggerSync, updateLocation, selectLocation,
  } = useGoogleBusinessData({ enabled: !connectionLoading && isConnected });

  /*
   * ═══════════════════════════════════════════════════════════════
   * EINRICHTUNG OHNE ZWEITEN KLICK
   * ═══════════════════════════════════════════════════════════════
   *
   * Wer "Testphase starten" geklickt hat, hat damit gesagt, was er
   * will. Ihn hier noch einmal auf "Google verbinden" klicken zu
   * lassen, ist kein Sicherheitsgewinn — der Einwilligungsdialog von
   * Google kommt ohnehin, und DORT entscheidet er wirklich.
   *
   * Die beiden Google-Durchlaeufe bleiben technisch getrennt:
   * Anmeldung fordert openid/email/profile, die Verbindung
   * business.manage. Nur der zweite WERKRUF-Schritt faellt weg.
   *
   * VIER SPERREN, DAMIT DARAUS KEINE SCHLEIFE WIRD:
   *
   *   1. absichtDarfStarten() — eine Absicht, ein Versuch. Der
   *      Zaehler liegt im sessionStorage, nicht in einer Ref: Diese
   *      Seite wird beim Ruecksprung von Google neu aufgebaut, und
   *      eine Ref waere dann wieder false.
   *   2. vermerkeVersuch() VOR connect(). Danach zu zaehlen hiesse
   *      nie zu zaehlen — der Browser ist dann schon bei Google.
   *   3. Kein Start, wenn der Ruecksprung einen Fehler trug.
   *      oauth_denied heisst: Der Nutzer hat abgelehnt. Ihm
   *      denselben Dialog erneut vorzusetzen, waere Noetigung.
   *      Stattdessen zeigt die Karte den Fehler und einen Knopf.
   *   4. Kein Start, solange geladen oder gearbeitet wird.
   *
   * Der Fehlerparameter wird EINMAL beim Aufbau gelesen, nicht aus
   * dem Zustand: useGoogleBusiness raeumt die Parameter aus der
   * Adresszeile, und dieser Effekt koennte vorher laufen.
   */
  const callbackTrugFehler = React.useRef(
    typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('gbp') === 'error',
  ).current;
  const autoStartRef = React.useRef(false);
  const { profile, profileLoading, profileError, refreshProfile } = useAuthContext();
  const einrichtungOffen = onboardingOffen({ profile, profileLoading, profileError });

  React.useEffect(() => {
    if (autoStartRef.current) return;
    if (!darfAutoStarten({
      absichtAktiv:   einrichtungOffen,
      laeuft:         connectionLoading,
      beschaeftigt:   verbindungBusy,
      verbunden:      isConnected,
      fehler:         verbindungsFehler,
      callbackFehler: callbackTrugFehler,
    })) return;

    autoStartRef.current = true;
    vermerkeVersuch();
    connect();
  }, [einrichtungOffen, connectionLoading, verbindungBusy, isConnected, verbindungsFehler,
      connect, callbackTrugFehler]);

  /*
   * Die Absicht ist erfuellt, sobald die Verbindung steht. Ab hier
   * traegt der normale Produktweg weiter — Standortauswahl,
   * Erstimport, Dashboard.
   *
   * Sofort loeschen, nicht spaeter: Eine liegengebliebene Absicht
   * wuerde beim naechsten Besuch dieser Seite erneut einen
   * Google-Dialog oeffnen.
   */
  React.useEffect(() => {
    if (isConnected) loescheOnboardingAbsicht();
  }, [isConnected]);

  /*
   * ═══════════════════════════════════════════════════════════════
   * ENDE DER EINRICHTUNG → DASHBOARD (WP2, 23.10.2026)
   * ═══════════════════════════════════════════════════════════════
   *
   * Sobald ein Betrieb ausgewaehlt ist (automatisch bei einem, per
   * Klick bei mehreren), hat die Datenbank onboarding_completed_at
   * gesetzt. Profil neu laden, damit Weiche und Auto-Start es sehen,
   * dann ins Dashboard — der Nutzer soll nach dem Einmalweg nicht auf
   * der Verbindungsseite stehen bleiben.
   *
   * Nur waehrend einer offenen Einrichtung. Wer spaeter hier den
   * Betrieb wechselt, bleibt auf dieser Seite. Einmal je Seitenaufbau,
   * damit ein langsames Profil-Reload keinen zweiten Sprung ausloest.
   */
  const navigate = useNavigate();
  const abschlussRef = React.useRef(false);
  /* Die serverseitig bestaetigte Auswahl — hier schon gebraucht, weiter
     unten fuer den lokalen Auswahlzustand. */
  const persistedSelection = locations.find((location) => location.selected_at)?.id ?? '';
  const einrichtungAbgeschlossen = onboardingSchritt({
    einrichtungOffen, loading, isConnected,
    locations, selectedLocationId: persistedSelection,
    keineBetriebe: locationImport.keineBetriebe,
  }) === 'fertig';

  React.useEffect(() => {
    if (!einrichtungAbgeschlossen || abschlussRef.current) return;
    abschlussRef.current = true;
    Promise.resolve(refreshProfile?.()).finally(() => navigate('/dashboard', { replace: true }));
  }, [einrichtungAbgeschlossen, refreshProfile, navigate]);

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
    /* Sofort nachladen, nicht erst im Polling-Takt.
       sync/trigger arbeitet den Job seit dem 20.10.2026 im selben
       Request ab (runJobNow). Die Antwort kommt also, wenn die
       Betriebe schon in der Datenbank stehen — auf den naechsten
       Polling-Lauf zu warten waere geschenkte Zeit.

       Kommt die Antwort mit processed: false, hat der Worker den Job
       oder das Zeitbudget war erschoepft. Dann uebernimmt das
       gestufte Nachfragen, und die Fortschrittskarte erklaert die
       Wartezeit. Ein refresh ist auch dann richtig: Er kostet eine
       Abfrage und beantwortet die Frage, ob schon etwas da ist. */
    triggerSync(null)
      .then(() => refresh())
      .catch(() =>
        setSyncError('Deine verwaltbaren Betriebe konnten nicht geladen werden.'));
  }, [isConnected, connectionLoading, loading, locations.length, locationImport.status,
      triggerSync, refresh]);

  /*
   * ═══════════════════════════════════════════════════════════════
   * ZUSTAND DER EINRICHTUNG
   * ═══════════════════════════════════════════════════════════════
   *
   * Bewusst NICHT aus syncState abgeleitet. syncState kennt den Wert
   * 'never', und der heisst "noch nie etwas erfolgreich" — nicht
   * "gerade in Arbeit". Die Karte hing frueher an 'never' und
   * behauptete damit Bewegung aus einem Zustand, der nur Abwesenheit
   * bedeutet.
   *
   * Die Ableitung steht in der Komponente und ist dort einzeln
   * geprueft; hier wird sie nur gefuettert.
   */
  const [jetzt, setJetzt] = React.useState(() => Date.now());
  const [nachsehenNoetig, setNachsehenNoetig] = React.useState(false);

  const einrichtung = leiteEinrichtungAb({
    verbunden:       isConnected,
    importStatus:    locationImport.status,
    importJobStatus: locationImport.job?.status ?? null,
    keineBetriebe:   locationImport.keineBetriebe,
    anzahlStandorte: locations.length,
    lastSyncedAt,
    laufenderJob:    runningJob,
    begonnenAm:      locationImport.job?.created_at ?? null,
    jetzt,
  });

  /* Nur fuer die Anzeige der verstrichenen Zeit. Oertlich, kein
     Netzzugriff. */
  const einrichtungAktiv = einrichtung.aktiv;
  React.useEffect(() => {
    if (!einrichtungAktiv) return undefined;
    const uhr = window.setInterval(() => setJetzt(Date.now()), UHR_TAKT_MS);
    return () => window.clearInterval(uhr);
  }, [einrichtungAktiv]);

  /*
   * Nachfragen, solange wirklich etwas in Arbeit ist.
   *
   * Das ist der einzige verbliebene Fortschrittsanzeiger im
   * Kundendashboard. Regulaere Hintergrundabgleiche bekommen keinen —
   * sie sind kein Ereignis, das Aufmerksamkeit braucht.
   *
   * setTimeout statt setInterval, weil der Abstand sich nach
   * ERSTIMPORT_STUFEN aendert; ein Interval kann das nicht.
   *
   * Gezaehlt wird nach LAEUFEN, nicht nach Date.now(): Die Stufen
   * sollen in Tests mit kuenstlicher Zeit exakt dieselben sein wie im
   * Browser, und eine Rechnung ueber Date.now() haengt daran, ob die
   * Testumgebung die Uhr mitdreht.
   */
  const einrichtungInArbeit = einrichtung.aktiv && einrichtung.inArbeit;
  React.useEffect(() => {
    if (!einrichtungInArbeit) return undefined;

    /* Neuer Abschnitt, neue Geduld. Sonst bliebe der Knopf aus einer
       frueheren Phase stehen, obwohl gerade wieder etwas laeuft. */
    setNachsehenNoetig(false);

    let abgebrochen = false;
    let timer;
    let lauf = 0;

    const planen = () => {
      const stufe = ERSTIMPORT_STUFEN.find((s) => lauf < s.bisLauf);
      /* Geduld aufgebraucht. KEIN Fehler — der Auftrag steht weiter in
         der Warteschlange und wird abgearbeitet. Die Seite hoert nur
         auf, von selbst nachzufragen. */
      if (!stufe) { setNachsehenNoetig(true); return; }
      timer = window.setTimeout(() => {
        if (abgebrochen) return;
        lauf += 1;
        refresh();
        planen();
      }, stufe.abstand);
    };

    planen();
    return () => { abgebrochen = true; window.clearTimeout(timer); };
  }, [einrichtungInArbeit, refresh]);

  /* Kein Polling fuer regulaere Hintergrundabgleiche mehr.
     Entfernt am 29.09. mit dem Knopf "Jetzt abgleichen". Damit
     entfallen Spinner, Zeitlimit, Verzoegerungszustand und die
     Statusabfrage alle drei Sekunden. */

  /* Die serverseitig bestätigte Auswahl ist die einzige Quelle für
     Kennzahlen. Ein lokaler "alle"-Zustand würde Betriebe vermischen. */
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
        <PageTitle>Dein Google-Profil</PageTitle>
        <PageSub>
          Verbinde dein Profil, damit {brand.name} Bewertungen, Betriebsdaten
          und Sichtbarkeit auswerten kann.
        </PageSub>
        <GoogleBusinessConnect googleBusiness={googleBusiness} />

      </Page>
    );
  }

  /* 'never' als eigener Zustand: vorher stand bei einem frisch
     verbundenen Konto "Daten sind aktuell / Zuletzt abgeglichen noch
     nie" — beides gleichzeitig, und das eine widerlegt das andere. */
  /* Der ausgewaehlte Betrieb. Die Profilverwaltung bezieht sich immer
     auf genau einen — alles andere vermischte Daten. */
  const ausgewaehlterStandort = selectedLocation
    ? locations.find((l) => l.id === selectedLocation) ?? null
    : null;

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

  /*
   * ═══════════════════════════════════════════════════════════════
   * AUFGEGEBEN IST NICHT DASSELBE WIE GESCHEITERT
   * ═══════════════════════════════════════════════════════════════
   *
   * Am 19.10.2026 in Produktion gemessen: Zwei Jobs standen auf
   * status = 'failed' mit attempts = 1 und max_attempts = 3. Die
   * Karte machte daraus "Versuch 1 von 3" — und versprach damit zwei
   * Wiederholungen, die nie kamen.
   *
   * Denn der Worker gibt bei reauth_required sofort auf, mit gutem
   * Grund (google-business/index.ts, abandon()):
   *
   *   "reauth_required ist kein transienter Fehler — der Kunde muss
   *    handeln. Weitere Versuche kosten nur Quota."
   *
   * abandon() schreibt failed direkt in die Tabelle und laesst
   * attempts stehen. Die Zahl ist danach kein Fortschritt mehr,
   * sondern ein Rest.
   *
   * Fuer den Kunden ist der Unterschied der ganze Punkt. Bei einem
   * aufgegebenen Job wartet er auf etwas, das nicht passiert —
   * waehrend direkt darueber der Knopf steht, der es loesen wuerde.
   * Deshalb bekommt dieser Fall einen eigenen Zustand mit einer
   * Handlungsaufforderung statt einer Fehlermeldung.
   *
   * Die Liste stammt aus derselben Stelle im Worker, damit beide
   * dasselbe meinen. Waechst sie dort, gehoert sie hier nachgezogen —
   * ein Test haelt das fest.
   */
  const AUFGEGEBEN_CODES = ['reauth_required', 'not_connected'];
  const istAufgegeben = Boolean(
    lastFailedJob && AUFGEGEBEN_CODES.includes(lastFailedJob.error_code),
  );

  const syncState = istAufgegeben ? 'reauth'
    : lastFailedJob ? 'error'
    : lastSyncedAt ? 'ok'
    : latestJob?.status === 'succeeded' ? 'ok'
    : 'never';

  return (
    <Page>
      <PageTitle>Dein Google-Profil</PageTitle>
      <PageSub>Dein Betrieb bei Google — Angaben, Bewertungen und Antworten auf einen Blick.</PageSub>

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
              : 'Welchen Betrieb möchtest du mit WERKRUF verwalten? Google hat diese Betriebe für dein Konto zurückgegeben — WERKRUF arbeitet immer für genau einen.'}
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
              hint={scopedStats?.unanswered === null ? 'Nur über alle Betriebe'
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
          {loading ? <SkeletonList count={1} height={72} />
            : einrichtung.aktiv ? (
            <>
              <EinrichtungsFortschritt einrichtung={einrichtung} />

              {/* Die Seite hat aufgehoert, von selbst nachzufragen.
                  Das ist KEIN Abgleich-Knopf: refresh() liest nur den
                  vorhandenen Stand neu, es wird kein Job eingereiht
                  und keine Google-Quota verbraucht. Der am 29.09.
                  entfernte Knopf "Jetzt abgleichen" stiess einen Sync
                  an — das hier tut es ausdruecklich nicht. */}
              {nachsehenNoetig && (
                <NachsehenZeile>
                  <GhostBtn onClick={() => { setJetzt(Date.now()); refresh(); }}>
                    Jetzt nachsehen
                  </GhostBtn>
                  <span>Lädt nur den aktuellen Stand neu.</span>
                </NachsehenZeile>
              )}
            </>
          ) : (
            <SyncBar $state={syncState}>
              <SyncInfo>
                {syncState === 'error' || syncState === 'reauth'
                  ? <AlertTriangle size={19} color="#D93025" />
                  : syncState === 'never' ? <Clock size={19} color="#D48A00" />
                  : <CheckCircle size={19} color="#1E7E34" />}
                <SyncText>
                  <p>
                    {/* 'never' heisst "noch nie etwas erfolgreich" und
                        NICHT "gerade in Arbeit". Hier stand bis zum
                        20.10.2026 "Einrichtung läuft" — eine Behauptung
                        ueber Bewegung, abgeleitet aus blosser
                        Abwesenheit.

                        Der laufende Fall hat jetzt seine eigene Karte
                        (einrichtung.aktiv). Damit ist dieser Zweig
                        praktisch unerreichbar geworden: Ein verbundenes
                        Konto ohne Erfolg ist entweder in Einrichtung,
                        oder sein letzter Job steht auf succeeded bzw.
                        failed — und dann greift 'ok' oder 'error'. Ohne
                        Verbindung kommt die Seite hier gar nicht an, sie
                        kehrt weiter oben mit der Verbinden-Karte zurueck.

                        Er bleibt als Netz stehen, aber mit einem Satz,
                        der auch dann stimmt, wenn wirklich nichts
                        laeuft. */}
                    {syncState === 'reauth' ? 'Verbindung zu Google muss erneuert werden'
                      : syncState === 'error' ? 'Letzter Abgleich fehlgeschlagen'
                      : syncState === 'never' ? 'Noch kein Abgleich gelaufen'
                      : 'Dein Google-Unternehmensprofil wird automatisch aktualisiert'}
                  </p>
                  <p>
                    {/* Kein Versuchszaehler: Dieser Job wird nicht
                        wiederholt. Stattdessen der Satz, der sagt, was
                        zu tun ist — der Knopf dafuer steht oben auf
                        dieser Seite. */}
                    {syncState === 'reauth'
                      ? 'Google hat den Zugriff widerrufen oder er ist abgelaufen. Verbinde dein Konto oben neu — danach läuft der Abgleich automatisch weiter.'
                      : syncState === 'error'
                        ? `Fehler: ${lastFailedJob.error_code ?? 'unbekannt'} · Versuch ${lastFailedJob.attempts} von ${lastFailedJob.max_attempts}`
                        : syncState === 'never'
                          ? 'Sobald dein Google-Unternehmensprofil verbunden ist, lädt WERKRUF die ersten Daten automatisch.'
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
          {/* NICHT waehrend der Einrichtung. Ein zweiter offener
              Auftrag ist dort der Normalfall — der Erstimport und der
              stuendliche Scheduler koennen beide eingereiht sein. Am
              20.10.2026 stand diese Zeile einem Kunden in seiner
              ersten Minute unter der Fortschrittsanzeige: eine
              Stoerungsmeldung ueber den planmaessigen Betrieb.

              Und die Grammatik war kaputt: "Ein älterer Auftrag ... sie
              bestimmen". */}
          {!einrichtung.aktiv && stalledJobs.length > 0 && (
            <HistorieZeile>
              {stalledJobs.length === 1
                ? 'Ein älterer Auftrag steht noch offen — er bestimmt den Status oben nicht.'
                : `${stalledJobs.length} ältere Aufträge stehen noch offen — sie bestimmen den Status oben nicht.`}
              {' '}Sie werden beim nächsten Lauf mit abgearbeitet.
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
          <SectionTitle><MapPin size={15} /> Ausgewählter Betrieb</SectionTitle>

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
                  action={
                    /* Drei Wege hinaus, keiner davon automatisch: Konto
                       wechseln (Kontowaehler bei Google), noch einmal
                       nachsehen, oder lesen, woran es liegen kann. */
                    <div data-testid="keine-betriebe-aktionen" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
                      <GhostBtn onClick={() => connect(null)} disabled={verbindungBusy}>
                        Anderes Google-Konto verbinden
                      </GhostBtn>
                      <GhostBtn onClick={() => triggerSync(null).then(() => refresh())} disabled={syncing || refreshing}>
                        Erneut prüfen
                      </GhostBtn>
                      <GhostBtn as="a" href="/hilfe">Hilfe</GhostBtn>
                    </div>
                  }
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
                  </LocationCard>
                ))}
              </LocationGrid>
            )}

          {/* ── GOOGLE-PROFIL VERWALTEN ──
              Gemeinsame Struktur mit Unternavigation. Welche Felder ein
              Bereich hat und ob sie fuer DIESEN Betrieb bearbeitbar
              sind, kommt aus src/utils/gbpFieldModel.js. */}
          {!loading && ausgewaehlterStandort && (
            <>
              <SectionTitle><Settings size={15} /> Google-Profil verwalten</SectionTitle>
              <Card>
                <GoogleProfilVerwalten
                  location={ausgewaehlterStandort}
                  bereiche={{
                    stammdaten: (
                      <StammdatenEditor
                        location={ausgewaehlterStandort}
                        onSave={updateLocation}
                      />
                    ),
                    kategorien: (
                      <>
                        <KategorienEditor
                          location={ausgewaehlterStandort}
                          onSave={updateLocation}
                        />
                        {/* Attribute laufen ueber einen eigenen
                            Google-Endpunkt mit eigener Maske — deshalb
                            ein eigener Speichervorgang, nicht
                            derselbe wie bei den Kategorien. */}
                        <SectionTitle style={{ marginTop: 28 }}>
                          <Settings size={15} /> Eigenschaften deines Betriebs
                        </SectionTitle>
                        <AttributeEditor location={ausgewaehlterStandort} />
                      </>
                    ),
                    oeffnungszeiten: (
                      <>
                        <OeffnungszeitenEditor
                          location={ausgewaehlterStandort}
                          onSave={updateLocation}
                        />
                        {/* Weitere Zeiten stehen bewusst darunter und
                            nicht in einem eigenen Reiter: Sie gehören
                            fachlich zu den Öffnungszeiten, haben aber
                            einen eigenen Speichervorgang. */}
                        <SectionTitle style={{ marginTop: 28 }}>
                          <Clock size={15} /> Weitere Zeiten
                        </SectionTitle>
                        <WeitereZeitenEditor
                          location={ausgewaehlterStandort}
                          onSave={updateLocation}
                        />
                      </>
                    ),
                  }}
                />
              </Card>
            </>
          )}

          {/* ── NEUESTE BEWERTUNGEN ── */}
          <SectionTitle><Star size={15} /> Neueste Bewertungen</SectionTitle>
          <LatestReviews />
        </>
      )}
    </Page>
  );
}

/* Der Profil-Editor ist am 29.09.2026 nach
   components/dashboard/StammdatenEditor.js umgezogen und wird dort
   ueber GoogleProfilVerwalten eingebunden. Seine Sicherheitskorrekturen
   sind vollstaendig mitgewandert. */

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
