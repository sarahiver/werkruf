import { useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useGoogleBusiness } from './useGoogleBusiness';
import { useGoogleBusinessData } from './useGoogleBusinessData';
import { useHealthScore } from './useHealthScore';
import { useEvents } from './useEvents';

/* ─────────────────────────────────────────────
   useDashboardBriefing

   Beantwortet die drei Fragen, mit denen jemand das Dashboard öffnet:

     1. Wie steht mein Betrieb da?
     2. Was braucht meine Aufmerksamkeit?
     3. Was mache ich als Nächstes?

   Keine neue Funktion — nur eine Zusammenfassung dessen, was die
   bestehenden Hooks ohnehin laden. Bisher lag diese Auswertung im
   Kopf des Nutzers: Kacheln lesen, Zahlen vergleichen, selbst
   schliessen, was zu tun ist. Das ist die eigentliche Last, die ein
   Dashboard abnehmen soll.

   @typedef {'critical'|'warning'|'info'} Severity
   Jede Empfehlung beantwortet vier Fragen, weil sonst niemand
   entscheiden kann, ob sie sich lohnt:

     title   Was ist passiert?
     detail  Warum zählt das?
     benefit Was bringt es?      — beobachtbar, nie hochgerechnet
     effort  Wie lange dauert es?

   Bei "benefit" steht bewusst nie eine Prozentzahl. "Sichtbarkeit +17%"
   wäre erfunden — es gibt keine Datenquelle, die das belegt. Was
   dasteht, ist entweder eine Tatsache über das Profil oder eine
   Aussage darüber, was ein Suchender sieht.

   @typedef {Object} ActionItem
   @property {string}   id
   @property {Severity} severity
   @property {string}   title
   @property {string}   detail
   @property {string}   benefit
   @property {string}   effort
   @property {string}   ctaLabel
   @property {string}   ctaTo
   @property {number}   [count]
───────────────────────────────────────────── */

/* Ab wann Daten als veraltet gelten. Grosszügig: der Planer läuft
   alle zwei Stunden, ein Ausfall über Nacht ist kein Drama. */

export function useDashboardBriefing() {
  useAuthContext();   /* profile wird hier nicht mehr gebraucht — der Score kommt aus useHealthScore */
  const {
    isConnected, brokenConnection,
    loading: connectionLoading,
  } = useGoogleBusiness();
  const {
    locations, stats, replyCounts, lastSyncedAt, runningJob, locationImport,
    loading: dataLoading, error, reload, triggerSync,
  } = useGoogleBusinessData({ enabled: !connectionLoading && isConnected });

  const loading = connectionLoading || dataLoading;

  /* Der kanonische WERKRUF Score des ausgewaehlten Betriebs. Eine
     Quelle fuer Dashboard, Engine und Mail — siehe
     src/utils/healthScore.js. */
  const healthScore = useHealthScore({ stats, locations, replyCounts, loading });

  const hoursSinceSync = useMemo(() => {
    if (!lastSyncedAt) return null;
    return (Date.now() - new Date(lastSyncedAt).getTime()) / 36e5;
  }, [lastSyncedAt]);

  /* ── Frage 2: Was braucht Aufmerksamkeit? ──
     Reihenfolge ist Absicht. Was den Betrieb blockiert, steht oben;
     was ihn nur verbessert, unten. Bei gleicher Dringlichkeit gilt:
     zuerst, was ein Kunde sieht. */
  /*
   * Die Aufgaben kommen aus der Decision Engine, nicht von hier.
   *
   * Bis zum 01.10.2026 erzeugte dieser Hook neun eigene Aufgaben —
   * connect, reauth, failed-replies, unanswered, drafts, no-locations,
   * stale, sync-failed, incomplete. Sieben davon hatte die Engine
   * ebenfalls, mit eigener Prioritaet, eigenem Wortlaut und eigenem
   * Lebenszyklus.
   *
   * Zwei Quellen fuer dieselbe Frage laufen auseinander: Das Dashboard
   * haette "3 Bewertungen warten" gezeigt, die Wochenmail "Antwortquote
   * verbessern" — aus zwei verschiedenen Regeln, mit zwei verschiedenen
   * Schwellen.
   *
   * Die beiden Faelle ohne Engine-Entsprechung sind bewusst keine
   * Aufgaben geworden:
   *
   *   no-locations  ist ein Zustand der Oberflaeche, keine Handlung
   *                 am Google-Profil. Steht jetzt in
   *                 standortAuswahlNoetig.
   *
   *   stale         ist eine Aussage ueber die Datenlage, kein
   *                 naechster Schritt fuer den Kunden. Steht jetzt in
   *                 datenstand.
   */
  const { events: engineAufgaben, loading: feedLaedt, error: feedFehler,
          locationResolved, reload: feedNeuLaden,
          melde: meldeGesehen, open: meldeGeoeffnet, dismiss: weglegen } = useEvents();

  /*
   * Braucht es eine Betriebsauswahl?
   *
   * Nur bei mehreren Betrieben ohne eindeutige Auswahl. Bei genau
   * einem ist nichts zu waehlen.
   */
  const standortAuswahlNoetig = !loading && !locationResolved && locations.length > 1;

  /*
   * Verbunden, aber kein Betrieb — und warum.
   *
   * Ein anderer Zustand als "keiner ausgewaehlt": Hier gibt es
   * nichts, woraus man waehlen koennte. Ohne diese Unterscheidung
   * lief der Zustand in den ok-Zweig ganz unten: "Alles im Griff" —
   * gesagt ueber ein leeres Konto.
   *
   * ── Warum drei Werte und nicht ein Ja/Nein ──
   *
   * "Google hat keinen Betrieb zurueckgegeben" ist falsch, solange der
   * Standortimport noch laeuft. Das ist kein Randfall: Genau diese
   * Minute erlebt jeder neue Kunde direkt nach dem Verbinden.
   *
   * Die Unterscheidung ist nicht neu — /dashboard/google trifft sie
   * schon (DashboardGoogleBusiness.js:505) und benutzt dafuer
   * locationImport aus useGoogleBusinessData. Hier dieselbe Quelle,
   * damit beide Seiten nicht auseinanderlaufen:
   *
   *   'laedt'           Import laeuft oder ist noch nicht gelaufen
   *   'keine_gefunden'  Import durchgelaufen, Google kennt keinen
   *   'fehler'          Import gescheitert, wird wiederholt
   *
   * ── Warum ueberhaupt im Browser, wenn die Engine eine Regel hat ──
   *
   * account.no_locations liefert dieselbe Aussage fuer Aufgabenliste
   * und Mail. Sie reicht hier aber nicht: Nach dem Verbinden laeuft
   * zuerst nur der Standortimport, und evaluateUser haengt am
   * Bewertungs-Sync — der ohne Betrieb nie laeuft. Bis zum taeglichen
   * Lauf gibt die Engine also keine Aufgabe her. Der Kunde sieht das
   * Dashboard aber jetzt.
   */
  const ohneBetrieb = useMemo(() => {
    if (loading || !isConnected || locations.length > 0) return null;
    if (locationImport?.keineBetriebe) return 'keine_gefunden';
    if (locationImport?.status === 'failed') return 'fehler';
    return 'laedt';
  }, [loading, isConnected, locations.length, locationImport]);

  /*
   * Wie alt sind die angezeigten Daten?
   *
   * Ein technischer Hinweis, keine Aufgabe. Der Kunde kann nichts
   * daran tun ausser abwarten — und eine Aufgabenkarte, die man nur
   * wegklicken kann, ist keine.
   */
  const datenstand = useMemo(() => {
    if (loading || hoursSinceSync === null) return null;
    if (hoursSinceSync < 24) return null;

    const tage = Math.floor(hoursSinceSync / 24);
    return {
      stunden: Math.round(hoursSinceSync),
      text: tage >= 1
        ? `Letzter Abgleich vor ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}.`
        : `Letzter Abgleich vor ${Math.round(hoursSinceSync)} Stunden.`,
      hinweis: 'Die angezeigten Daten sind möglicherweise nicht mehr aktuell.',
    };
  }, [loading, hoursSinceSync]);

  /* ── Frage 1: Wie steht der Betrieb da? ──
     Ein Zustand, ein Satz. Kein Score als nackte Zahl: "68 von 100"
     verlangt Deutung, "drei Bewertungen offen" nicht. */
  const status = useMemo(() => {
    if (loading) return { level: 'loading', headline: '', detail: '' };
    if (error)   return { level: 'error', headline: 'Daten nicht ladbar', detail: error };

    /* Die Dringlichkeit kommt aus der Prioritaet der Engine, nicht
       aus einer eigenen Einstufung. */
    const hoechste = engineAufgaben.reduce(
      (max, e) => Math.max(max, Number(e.priority ?? 0)), 0);
    const critical = hoechste >= 80 ? 1 : 0;
    const warning  = hoechste >= 50 && hoechste < 80 ? 1 : 0;

    if (!isConnected) {
      return {
        level: 'setup',
        headline: 'Noch nicht eingerichtet',
        detail: 'Verbinde dein Google-Profil — danach läuft alles Weitere von selbst.',
      };
    }
    /*
     * Verbunden, aber ohne Betrieb. Steht VOR den Engine-Zustaenden:
     * Solange kein Betrieb da ist, ist jede andere Aussage ueber das
     * Profil gegenstandslos.
     *
     * Ein level fuer drei Lagen, aber drei Saetze — die Stufe ist
     * dieselbe (nichts kaputt, noch nicht eingerichtet), die Aussage
     * nicht. Wortlaut wie auf /dashboard/google, damit der Kunde
     * nicht zwei Erklaerungen fuer denselben Zustand liest.
     *
     * Kein erfundener Grund: Google liefert eine leere Liste, keine
     * Begruendung. Was der Kunde pruefen kann, steht in der Aufgabe
     * darunter und auf /dashboard/google.
     */
    if (ohneBetrieb) {
      return {
        level: 'keine_betriebe',
        ...(ohneBetrieb === 'keine_gefunden' ? {
          headline: 'Noch kein Betrieb verbunden',
          detail: 'Die Verbindung zu Google steht, es kam aber kein Unternehmensprofil an, '
            + 'das du verwalten darfst.',
        } : ohneBetrieb === 'fehler' ? {
          headline: 'Betriebe konnten nicht geladen werden',
          detail: 'WERKRUF versucht es beim nächsten regulären Lauf erneut.',
        } : {
          headline: 'Deine Betriebe werden geladen',
          detail: 'WERKRUF holt gerade die Unternehmen, die du bei Google verwaltest. '
            + 'Das dauert einen Moment — du musst nichts tun.',
        }),
      };
    }
    if (critical > 0) {
      return {
        level: 'critical',
        headline: critical === 1 ? 'Eine Sache braucht dich' : `${critical} Sachen brauchen dich`,
        detail: 'Bis dahin läuft nicht alles wie vorgesehen.',
      };
    }
    if (warning > 0) {
      return {
        level: 'warning',
        headline: warning === 1 ? 'Eine Kleinigkeit offen' : `${warning} Kleinigkeiten offen`,
        detail: 'Nichts Dringendes — aber es lohnt sich.',
      };
    }
    return {
      level: 'ok',
      headline: 'Alles im Griff',
      detail: stats?.totalReviews
        ? `${stats.totalReviews} Bewertungen, alle beantwortet. WERKRUF meldet sich, wenn sich etwas ändert.`
        : 'WERKRUF meldet sich, wenn sich etwas ändert.',
    };
  }, [loading, error, engineAufgaben, isConnected, ohneBetrieb, stats]);

  /* ── Frage 3: Was als Nächstes? ──
     Genau eine Handlung. Zwei gleichwertige Knöpfe sind keine
     Empfehlung, sondern eine Rückfrage.

     Welche das ist, entscheidet die Engine über die Reihenfolge im
     Feed — hier wird nicht neu sortiert. */

  return {
    status,
    /* Aufgaben ausschliesslich aus der Engine. */
    actions: engineAufgaben,
    nextAction: engineAufgaben[0] ?? null,
    feedLaedt,
    feedFehler,
    feedNeuLaden,
    standortAuswahlNoetig,
    /* null, 'laedt', 'keine_gefunden' oder 'fehler' — siehe oben. */
    ohneBetrieb,
    datenstand,
    /* Rueckmeldungen an den Lebenszyklus der Engine. */
    melde: {
      gesehen: meldeGesehen,
      geoeffnet: meldeGeoeffnet,
      weggeklickt: weglegen,
    },
    /* Der kanonische WERKRUF Score — fuer die Anzeige ganz oben.
       Nicht visibility_score. */
    healthScore,
    /* Rohdaten durchreichen — der Gesundheitswert rechnet damit,
       und eine zweite Abfrage derselben Tabellen wäre Verschwendung. */
    locations,
    stats,
    replyCounts,
    /* Kennzahlen für die schmale Leiste. Bewusst nur drei — mehr
       liest niemand im Vorbeigehen. */
    metrics: {
      rating:      stats?.averageRating ?? null,
      reviews:     stats?.totalReviews ?? 0,
      unanswered:  stats?.unanswered ?? 0,
      published:   replyCounts.published,
      locations:   locations.length,
    },
    isConnected,
    brokenConnection,
    lastSyncedAt,
    runningJob,
    loading,
    error,
    reload,
    triggerSync,
  };
}

export default useDashboardBriefing;
