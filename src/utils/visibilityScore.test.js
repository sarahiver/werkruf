import { calculateProfileScore, calculateVisibilityScore } from './visibilityScore';

describe('vorläufiger öffentlicher Profil-Score', () => {
  it('scores all three documented criteria', () => {
    const result = calculateProfileScore({ rating: 4.6, reviewCount: 50, hasWebsite: true });
    expect(result.score).toBe(100);
    expect(result.criteria.map(c => [c.key, c.weight])).toEqual([
      ['rating', 45], ['reviews', 30], ['website', 25],
    ]);
  });

  it('does not treat unavailable API fields as confirmed defects', () => {
    expect(calculateVisibilityScore({ rating: null, reviewCount: null, hasWebsite: null,
      ratingAvailable: false, reviewCountAvailable: false, websiteAvailable: false })).toBeNull();
    expect(calculateVisibilityScore({ reviewCount: 12, reviewCountAvailable: true,
      ratingAvailable: false, websiteAvailable: false })).toBe(73);
  });

  it('treats a real zero-review value as a neutral new-profile state', () => {
    const result = calculateProfileScore({ rating: null, reviewCount: 0, hasWebsite: true,
      ratingAvailable: false, reviewCountAvailable: true, websiteAvailable: true });
    expect(result.score).toBe(89);
    expect(result.criteria[0]).toEqual(expect.objectContaining({ available: false }));
    expect(result.criteria[1].detail).toMatch(/Neues Profil/);
  });

  it('distinguishes a confirmed missing website from an omitted website field', () => {
    expect(calculateVisibilityScore({ rating: 4.5, reviewCount: 20, hasWebsite: false, websiteAvailable: true })).toBe(71);
    expect(calculateVisibilityScore({ rating: 4.5, reviewCount: 20, hasWebsite: null, websiteAvailable: false })).toBe(95);
  });
});
