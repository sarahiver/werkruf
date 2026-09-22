/** Public Google Places check. Deliberately separate from the signed-in health score. */
export function calculateVisibilityScore({ rating, reviewCount, hasWebsite }) {
  let score = 100;

  if (!rating || rating === 0) score -= 35;
  else if (rating < 3.0) score -= 40;
  else if (rating < 3.5) score -= 30;
  else if (rating < 4.0) score -= 20;
  else if (rating < 4.5) score -= 10;

  if (!reviewCount || reviewCount === 0) score -= 25;
  else if (reviewCount < 5) score -= 20;
  else if (reviewCount < 20) score -= 15;
  else if (reviewCount < 50) score -= 10;

  if (!hasWebsite) score -= 15;

  return Math.max(0, Math.min(100, score));
}

export const scoreColor = (score) => score >= 70 ? '#1E7E34' : score >= 45 ? '#D48A00' : '#D93025';
export const scoreBg = (score) => score >= 70 ? '#E8F5E9' : score >= 45 ? '#FFF8E1' : '#FDECEA';
export const scoreLabel = (score) => score >= 70 ? 'GUT' : score >= 45 ? 'AUSBAUFÄHIG' : 'KRITISCH';
