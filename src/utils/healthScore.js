/**
 * Browser mirror of public.compute_health_score().
 *
 * Postgres remains authoritative for persisted snapshots, e-mails and the
 * decision engine. Keep this module in lockstep with the production baseline;
 * the conformance test compares both implementations' weights and vectors.
 */
export const HEALTH_WEIGHTS = Object.freeze({
  responseRate: 30,
  rating: 25,
  recency: 20,
  completeness: 15,
  photos: 10,
});

const present = (value) => value !== null && value !== undefined;

export function calculateHealthScoreInputs({ stats, location, now = Date.now() }) {
  const total = stats.totalReviews ?? 0;
  const answered = total - (stats.unanswered ?? 0);
  const responseRate = total > 0 ? answered / total : null;

  const rating = stats.averageRating;
  const ratingRatio = rating === null || rating === undefined
    ? 0
    : Math.max(0, Math.min(1, (rating - 3) / 2));

  const newest = stats.newestReviewAt ? new Date(stats.newestReviewAt) : null;
  const daysSinceNewest = newest
    ? Math.floor((now - newest.getTime()) / 864e5)
    : null;
  const recencyRatio = daysSinceNewest === null ? 0
    : daysSinceNewest <= 30 ? 1
    : daysSinceNewest <= 90 ? 0.7
    : daysSinceNewest <= 180 ? 0.4
    : 0;

  const profileFields = location ? [
    ['Telefonnummer', location.primary_phone],
    ['Website', location.website_uri],
    ['Adresse', location.locality],
    ['Kategorie', location.primary_category],
  ] : [];
  const filledFields = profileFields.filter(([, value]) => present(value));
  const missingFields = profileFields
    .filter(([, value]) => !present(value))
    .map(([name]) => name);

  const photoCount = stats.photoCount ?? 0;
  const points = {
    responseRate: Math.round((responseRate ?? 0) * HEALTH_WEIGHTS.responseRate),
    rating: Math.round(ratingRatio * HEALTH_WEIGHTS.rating),
    recency: Math.round(recencyRatio * HEALTH_WEIGHTS.recency),
    completeness: location
      ? Math.round((filledFields.length / profileFields.length) * HEALTH_WEIGHTS.completeness)
      : 0,
    photos: Math.round(Math.min(photoCount / 5, 1) * HEALTH_WEIGHTS.photos),
  };

  return {
    total,
    answered,
    responseRate,
    rating,
    daysSinceNewest,
    missingFields,
    photoCount,
    points,
    score: Object.values(points).reduce((sum, value) => sum + value, 0),
  };
}
