/**
 * Vorläufiger öffentlicher Google-Profil-Score.
 *
 * Er bewertet ausschließlich die Vollständigkeit/Vertrauenssignale der beim
 * Places-Abruf tatsächlich verfügbaren Felder. Er ist weder Google-Ranking
 * noch Messung der Auffindbarkeit. Fehlende API-Felder werden aus Nenner und
 * Zähler entfernt; null ist deshalb nicht dasselbe wie ein bestätigter Mangel.
 */
export function calculateProfileScore(input) {
  const criteria = [];
  const add = (key, label, weight, available, points, detail) => criteria.push({
    key, label, weight, available, points: available ? points : null, detail,
  });

  const ratingAvailable = input.ratingAvailable ?? typeof input.rating === 'number';
  const reviewsAvailable = input.reviewCountAvailable ?? typeof input.reviewCount === 'number';
  const websiteAvailable = input.websiteAvailable ?? typeof input.hasWebsite === 'boolean';

  if (!reviewsAvailable || input.reviewCount === 0) {
    // A new profile must not be punished for having no history. In that case
    // Google exposes no rating, so rating is marked inapplicable/unavailable.
    add('rating', 'Öffentliche Bewertung', 45, false, 0,
      reviewsAvailable ? 'Noch keine Rezensionen – noch keine Bewertung möglich.' : 'Nicht von Google bereitgestellt.');
  } else {
    const rating = input.rating;
    const points = rating >= 4.5 ? 45 : rating >= 4 ? 36 : rating >= 3.5 ? 27 : rating >= 3 ? 18 : 9;
    add('rating', 'Öffentliche Bewertung', 45, ratingAvailable, points,
      ratingAvailable ? `${rating.toFixed(1)} von 5 Sternen` : 'Nicht von Google bereitgestellt.');
  }

  if (reviewsAvailable) {
    const count = input.reviewCount;
    // Zero is a real value, but treated as a neutral starting point rather
    // than evidence of a deficient profile.
    const points = count === 0 ? 24 : count < 5 ? 18 : count < 20 ? 22 : count < 50 ? 26 : 30;
    add('reviews', 'Öffentliche Rezensionen', 30, true, points,
      count === 0 ? 'Neues Profil ohne Rezensionen' : `${count} öffentliche Rezensionen`);
  } else add('reviews', 'Öffentliche Rezensionen', 30, false, 0, 'Nicht von Google bereitgestellt.');

  add('website', 'Website-Verknüpfung', 25, websiteAvailable, input.hasWebsite ? 25 : 0,
    websiteAvailable ? (input.hasWebsite ? 'Website im Profil verknüpft' : 'Keine Website im Profil verknüpft') : 'Nicht von Google bereitgestellt.');

  const applicable = criteria.filter(c => c.available);
  const max = applicable.reduce((sum, c) => sum + c.weight, 0);
  const earned = applicable.reduce((sum, c) => sum + c.points, 0);
  return { score: max ? Math.round((earned / max) * 100) : null, criteria };
}

export function calculateVisibilityScore(input) {
  return calculateProfileScore(input).score;
}

export const scoreColor = (score) => score >= 70 ? '#1E7E34' : score >= 45 ? '#D48A00' : '#D93025';
export const scoreBg = (score) => score >= 70 ? '#E8F5E9' : score >= 45 ? '#FFF8E1' : '#FDECEA';
export const scoreLabel = (score) => score >= 70 ? 'GUT AUSGEFÜLLT' : score >= 45 ? 'AUSBAUFÄHIG' : 'LÜCKENHAFT';
