import { useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useGoogleBusiness } from './useGoogleBusiness';
import { useGoogleBusinessData } from './useGoogleBusinessData';

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
   @typedef {Object} ActionItem
   @property {string}   id
   @property {Severity} severity
   @property {string}   title       Was ist los — in einem Satz
   @property {string}   detail      Warum es zählt
   @property {string}   ctaLabel
   @property {string}   ctaTo       Ziel im Dashboard
   @property {number}   [count]
───────────────────────────────────────────── */

/* Ab wann Daten als veraltet gelten. Grosszügig: der Planer läuft
   alle zwei Stunden, ein Ausfall über Nacht ist kein Drama. */
const STALE_HOURS = 48;

export function useDashboardBriefing() {
  const { profile } = useAuthContext();
  const {
    isConnected, needsReauth, brokenConnection,
    loading: connectionLoading,
  } = useGoogleBusiness();
  const {
    locations, stats, replyCounts, lastSyncedAt, runningJob, lastFailedJob,
    loading: dataLoading, error, reload, triggerSync,
  } = useGoogleBusinessData();

  const loading = connectionLoading || dataLoading;

  const hoursSinceSync = useMemo(() => {
    if (!lastSyncedAt) return null;
    return (Date.now() - new Date(lastSyncedAt).getTime()) / 36e5;
  }, [lastSyncedAt]);

  /* ── Frage 2: Was braucht Aufmerksamkeit? ──
     Reihenfolge ist Absicht. Was den Betrieb blockiert, steht oben;
     was ihn nur verbessert, unten. Bei gleicher Dringlichkeit gilt:
     zuerst, was ein Kunde sieht. */
  const actions = useMemo(() => {
    if (loading) return [];
    const items = [];

    if (!isConnected && !needsReauth) {
      items.push({
        id: 'connect',
        severity: 'critical',
        title: 'Google-Profil noch nicht verbunden',
        detail: 'Ohne Verbindung kann nichts überwacht und nichts beantwortet werden. Dauert zwei Minuten.',
        ctaLabel: 'Jetzt verbinden',
        ctaTo: '/dashboard/google',
      });
    }

    if (needsReauth) {
      items.push({
        id: 'reauth',
        severity: 'critical',
        title: 'Verbindung zu Google abgerissen',
        detail: 'Seitdem kommen keine neuen Bewertungen an, und freigegebene Antworten werden nicht übertragen.',
        ctaLabel: 'Neu verbinden',
        ctaTo: '/dashboard/google',
      });
    }

    if (replyCounts.failed > 0) {
      items.push({
        id: 'failed-replies',
        severity: 'critical',
        title: `${replyCounts.failed} ${replyCounts.failed === 1 ? 'Antwort' : 'Antworten'} nicht veröffentlicht`,
        detail: 'Die Übertragung an Google ist gescheitert. Ein zweiter Versuch reicht meistens.',
        ctaLabel: 'Ansehen',
        ctaTo: '/dashboard/bewertungen',
        count: replyCounts.failed,
      });
    }

    /* Unbeantwortete Bewertungen: der Punkt, den ein Kunde sieht.
       Deshalb vor allem Internen. */
    if (stats?.unanswered > 0) {
      items.push({
        id: 'unanswered',
        severity: stats.unanswered > 3 ? 'critical' : 'warning',
        title: `${stats.unanswered} ${stats.unanswered === 1 ? 'Bewertung wartet' : 'Bewertungen warten'} auf Antwort`,
        detail: 'Zu jeder liegt ein Vorschlag bereit. Lesen, anpassen, freigeben.',
        ctaLabel: 'Antworten freigeben',
        ctaTo: '/dashboard/bewertungen',
        count: stats.unanswered,
      });
    }

    if (replyCounts.draft > 0) {
      items.push({
        id: 'drafts',
        severity: 'warning',
        title: `${replyCounts.draft} ${replyCounts.draft === 1 ? 'Entwurf liegt' : 'Entwürfe liegen'} bereit`,
        detail: 'Vorgeschlagen, aber noch nicht freigegeben. Veröffentlicht wird nichts ohne dein Ja.',
        ctaLabel: 'Durchsehen',
        ctaTo: '/dashboard/bewertungen',
        count: replyCounts.draft,
      });
    }

    if (isConnected && locations.length === 0 && !runningJob) {
      items.push({
        id: 'no-locations',
        severity: 'warning',
        title: 'Standorte noch nicht geladen',
        detail: 'Der erste Abgleich holt Standorte und Bewertungen aus deinem Profil.',
        ctaLabel: 'Abgleich starten',
        ctaTo: '/dashboard/google',
      });
    }

    if (isConnected && hoursSinceSync !== null && hoursSinceSync > STALE_HOURS) {
      items.push({
        id: 'stale',
        severity: 'warning',
        title: 'Daten sind nicht mehr aktuell',
        detail: `Der letzte Abgleich ist über ${Math.round(hoursSinceSync / 24)} Tage her.`,
        ctaLabel: 'Jetzt abgleichen',
        ctaTo: '/dashboard/google',
      });
    }

    if (lastFailedJob && !needsReauth) {
      items.push({
        id: 'sync-failed',
        severity: 'warning',
        title: 'Letzter Abgleich fehlgeschlagen',
        detail: 'WERKRUF versucht es automatisch erneut. Bleibt es dabei, sieh im Profil nach.',
        ctaLabel: 'Profil prüfen',
        ctaTo: '/dashboard/google',
      });
    }

    /* Profil unvollständig — wichtig, aber nie dringend. Steht
       deshalb immer unten, egal wie niedrig der Wert ist. */
    const score = profile?.visibility_score;
    if (isConnected && typeof score === 'number' && score < 70) {
      items.push({
        id: 'incomplete',
        severity: 'info',
        title: 'Profil ist unvollständig',
        detail: 'Fehlende Fotos, Öffnungszeiten oder Leistungen kosten Sichtbarkeit — dauerhaft.',
        ctaLabel: 'Lücken ansehen',
        ctaTo: '/dashboard/google',
      });
    }

    return items;
  }, [
    loading, isConnected, needsReauth, replyCounts, stats,
    locations.length, runningJob, lastFailedJob, hoursSinceSync,
    profile?.visibility_score,
  ]);

  /* ── Frage 1: Wie steht der Betrieb da? ──
     Ein Zustand, ein Satz. Kein Score als nackte Zahl: "68 von 100"
     verlangt Deutung, "drei Bewertungen offen" nicht. */
  const status = useMemo(() => {
    if (loading) return { level: 'loading', headline: '', detail: '' };
    if (error)   return { level: 'error', headline: 'Daten nicht ladbar', detail: error };

    const critical = actions.filter((a) => a.severity === 'critical').length;
    const warning  = actions.filter((a) => a.severity === 'warning').length;

    if (!isConnected) {
      return {
        level: 'setup',
        headline: 'Noch nicht eingerichtet',
        detail: 'Verbinde dein Google-Profil — danach läuft alles Weitere von selbst.',
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
  }, [loading, error, actions, isConnected, stats]);

  /* ── Frage 3: Was als Nächstes? ──
     Genau eine Handlung. Zwei gleichwertige Knöpfe sind keine
     Empfehlung, sondern eine Rückfrage. */
  const nextAction = actions[0] ?? null;

  return {
    status,
    actions,
    nextAction,
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
