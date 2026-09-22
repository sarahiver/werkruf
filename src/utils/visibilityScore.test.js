import { calculateVisibilityScore } from './visibilityScore';

describe('public visibility score', () => {
  it('keeps the separate Google Places rules unchanged', () => {
    expect(calculateVisibilityScore({ rating: 5, reviewCount: 50, hasWebsite: true })).toBe(100);
    expect(calculateVisibilityScore({ rating: 0, reviewCount: 0, hasWebsite: false })).toBe(25);
    expect(calculateVisibilityScore({ rating: 4.2, reviewCount: 10, hasWebsite: true })).toBe(75);
  });
});
