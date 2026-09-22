import { useMemo } from 'react';
import { calculateHealthScoreInputs, HEALTH_WEIGHTS as WEIGHTS } from '../utils/healthScore';

/* ─────────────────────────────────────────────
   useHealthScore

   Ein Wert von 0 bis 100 für den Zustand des Google-Profils.

   REGEL: Jeder Faktor stützt sich auf Daten, die tatsächlich in
   unserer Datenbank liegen — aus google_reviews, google_locations und
   review_replies. Nichts wird geschätzt, hochgerechnet oder als
   "Sichtbarkeit" ausgegeben, was keine ist.

   Was bewusst NICHT eingeht:
     · Ranking oder Position — dafür gibt es keine Daten
     · Impressionen und Klicks — die Performance-API ist noch nicht
       angebunden. Sobald sie es ist, kommt "Aktivität" als Faktor
       dazu; bis dahin wäre jede Zahl erfunden.
     · Vergleich mit Mitbewerbern — kein Endpunkt für fremde Profile

   Jeder Faktor liefert seinen eigenen Beitrag mit Begründung. Ein
   Gesamtwert ohne Aufschlüsselung ist eine Behauptung; mit
   Aufschlüsselung ist er nachvollziehbar.

   @typedef {Object} HealthFactor
   @property {string} id
   @property {string} label
   @property {number} points     erreicht
   @property {number} max        möglich
   @property {string} verdict    ein Satz in Klartext
   @property {?string} action    was den Wert hebt, falls Luft ist
───────────────────────────────────────────── */

/* Gewichtung. Summe = 100.

   Die Antwortquote wiegt am schwersten, weil sie das Einzige ist, was
   der Betrieb vollständig selbst in der Hand hat — und das Einzige,
   was ein Suchender direkt sieht. Die Bewertung selbst wiegt weniger,
   obwohl sie wichtiger wirkt: Sie lässt sich kurzfristig kaum ändern,
   und ein Wert, den man nicht beeinflussen kann, gehört nicht in ein
   Werkzeug, das zu Handlungen führen soll. */
export function useHealthScore({ stats, locations, replyCounts, loading }) {
  return useMemo(() => {
    if (loading || !stats) {
      return { score: null, level: 'loading', factors: [], summary: '', headline: '' };
    }

    const factors = [];
    const location = locations?.[0];
    const canonical = calculateHealthScoreInputs({ stats, location });
    const { total, answered, responseRate: rate } = canonical;

    /* ── 1. Antwortquote ──
       Quelle: google_reviews.is_answered */
    if (total === 0) {
      factors.push({
        id: 'responseRate',
        label: 'Antworten auf Bewertungen',
        points: 0, max: WEIGHTS.responseRate,
        verdict: 'Noch keine Bewertungen — hier ist nichts zu beantworten.',
        action: null,
      });
    } else {
      const points = canonical.points.responseRate;
      factors.push({
        id: 'responseRate',
        label: 'Antworten auf Bewertungen',
        points, max: WEIGHTS.responseRate,
        verdict:
          rate === 1   ? 'Jede Bewertung ist beantwortet. Das sieht jeder, der dein Profil öffnet.'
          : rate >= .8 ? `${answered} von ${total} beantwortet. Fast vollständig.`
          : rate >= .5 ? `${answered} von ${total} beantwortet. Die Lücken fallen auf.`
                       : `Nur ${answered} von ${total} beantwortet. Ein Profil ohne Antworten wirkt verwaist.`,
        action: rate < 1 ? `${stats.unanswered} Bewertungen beantworten` : null,
      });
    }

    /* ── 2. Durchschnittsbewertung ──
       Quelle: google_reviews.star_rating

       Unter 3,0 gibt es keine Punkte, aber der Text bleibt sachlich:
       eine schlechte Bewertungslage lässt sich nicht wegoptimieren,
       und Schuldzuweisungen helfen niemandem. */
    const rating = canonical.rating;
    if (rating === null || rating === undefined) {
      factors.push({
        id: 'rating',
        label: 'Durchschnittsbewertung',
        points: 0, max: WEIGHTS.rating,
        verdict: 'Noch keine Bewertungen vorhanden.',
        action: 'Kunden nach einer Bewertung fragen',
      });
    } else {
      factors.push({
        id: 'rating',
        label: 'Durchschnittsbewertung',
        points: canonical.points.rating,
        max: WEIGHTS.rating,
        verdict:
          rating >= 4.7 ? `${rating.toFixed(1)} von 5 — kaum zu verbessern.`
          : rating >= 4.2 ? `${rating.toFixed(1)} von 5. Solide; jede neue gute Bewertung hebt den Schnitt.`
          : rating >= 3.5 ? `${rating.toFixed(1)} von 5. Wer vergleicht, merkt den Unterschied.`
                          : `${rating.toFixed(1)} von 5. Das kostet Anfragen, bevor jemand anruft.`,
        action: rating < 4.5 ? 'Zufriedene Kunden um eine Bewertung bitten' : null,
      });
    }

    /* ── 3. Aktualität ──
       Quelle: google_reviews.google_created_at, neueste

       Der Faktor, den fast niemand kennt: Ein Profil, dessen letzte
       Bewertung anderthalb Jahre alt ist, wirkt aufgegeben — auch bei
       fünf Sternen. */
    const daysSince = canonical.daysSinceNewest;

    if (daysSince === null) {
      factors.push({
        id: 'recency',
        label: 'Letzte Bewertung',
        points: 0, max: WEIGHTS.recency,
        verdict: 'Noch keine Bewertung eingegangen.',
        action: 'Bewertungslink an Kunden geben',
      });
    } else {
      const points = canonical.points.recency;
      factors.push({
        id: 'recency',
        label: 'Letzte Bewertung',
        points, max: WEIGHTS.recency,
        verdict:
          daysSince <= 30  ? 'Innerhalb des letzten Monats. Dein Profil wirkt lebendig.'
          : daysSince <= 90 ? `Vor ${Math.round(daysSince / 30)} Monaten. Noch in Ordnung.`
          : daysSince <= 180 ? `Vor ${Math.round(daysSince / 30)} Monaten. Wer vergleicht, merkt das.`
                             : `Vor über einem halben Jahr. Ein Profil ohne neue Bewertungen wirkt aufgegeben.`,
        action: daysSince > 60 ? 'Kunden aktiv um Bewertungen bitten' : null,
      });
    }

    /* ── 4. Vollständigkeit der Angaben ──
       Quelle: google_locations — die Felder, die der Standort-Sync
       tatsächlich befüllt. Nichts geschätzt. */
    const missing = canonical.missingFields;

    if (!location) {
      factors.push({
        id: 'completeness',
        label: 'Profilangaben',
        points: 0, max: WEIGHTS.completeness,
        verdict: 'Standortdaten noch nicht abgeglichen.',
        action: 'Abgleich starten',
      });
    } else {
      factors.push({
        id: 'completeness',
        label: 'Profilangaben',
        points: canonical.points.completeness,
        max: WEIGHTS.completeness,
        verdict: missing.length === 0
          ? 'Alle Grundangaben sind hinterlegt.'
          : `Es fehlt: ${missing.join(', ')}. Google spielt unvollständige Profile seltener aus.`,
        action: missing.length > 0 ? 'Angaben ergänzen' : null,
      });
    }

    /* ── 5. Fotos ──
       Quelle: business_photos. Google nennt keine Mindestzahl; fünf
       ist ein Erfahrungswert, kein offizieller Grenzwert — deshalb
       steht im Text auch keine Behauptung über Rankingwirkung. */
    const photoCount = canonical.photoCount;
    factors.push({
      id: 'photos',
      label: 'Fotos',
      points: canonical.points.photos,
      max: WEIGHTS.photos,
      verdict:
        photoCount === 0 ? 'Keine Fotos hinterlegt. Profile ohne Bilder werden seltener angeklickt.'
        : photoCount < 5 ? `${photoCount} ${photoCount === 1 ? 'Foto' : 'Fotos'}. Ein paar mehr geben ein besseres Bild vom Betrieb.`
                         : `${photoCount} Fotos. Ausreichend.`,
      action: photoCount < 5 ? 'Fotos hochladen' : null,
    });

    /* ── Gesamt ── */
    const score = canonical.score;
    const level = score >= 75 ? 'good' : score >= 50 ? 'ok' : 'weak';

    /* Die Begründung nennt den schwächsten Faktor, nicht alle.
       Wer fünf Baustellen gleichzeitig genannt bekommt, fängt keine
       davon an. */
    const weakest = [...factors]
      .filter((f) => f.max > 0)
      .sort((a, b) => (a.points / a.max) - (b.points / b.max))[0];

    const headline =
      level === 'good' ? 'Dein Profil ist gut aufgestellt'
      : level === 'ok'  ? 'Dein Profil ist solide, mit Luft nach oben'
                        : 'Dein Profil lässt Anfragen liegen';

    const summary = weakest && weakest.points < weakest.max
      ? `Am meisten holst du raus bei: ${weakest.label.toLowerCase()}. ${weakest.verdict}`
      : 'Alle Punkte, die sich beeinflussen lassen, sind erledigt.';

    return { score, level, factors, headline, summary, weakest };
  }, [stats, locations, loading]);
}

export default useHealthScore;
