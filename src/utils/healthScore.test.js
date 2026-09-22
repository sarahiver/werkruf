import fs from 'fs';
import path from 'path';
import { calculateHealthScoreInputs, HEALTH_WEIGHTS } from './healthScore';

const baseline = fs.readFileSync(
  path.join(process.cwd(), 'supabase/schema/production-baseline-2026-09-22.sql'),
  'utf8',
);
const googleBusinessFunction = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/google-business/index.ts'),
  'utf8',
);

const NOW = Date.parse('2026-09-22T12:00:00Z');

describe('canonical signed-in health score', () => {
  it('keeps browser weights aligned with compute_health_score()', () => {
    const functionSql = baseline.match(
      /CREATE FUNCTION public\.compute_health_score[\s\S]*?\n\$\$;/,
    )?.[0] ?? '';

    expect(HEALTH_WEIGHTS).toEqual({
      responseRate: 30,
      rating: 25,
      recency: 20,
      completeness: 15,
      photos: 10,
    });
    expect(functionSql).toContain("v_response := round(((v_total - v_unanswered)::numeric / v_total) * 30)");
    expect(functionSql).toContain("least(1, (v_rating - 3) / 2)) * 25");
    expect(functionSql).toContain('when v_days <= 30  then 20');
    expect(functionSql).toContain('(v_filled::numeric / v_fields) * 15');
    expect(functionSql).toContain('least(v_photos::numeric / 5, 1) * 10');
  });

  it('makes the decision engine consume the canonical server result instead of recalculating it', () => {
    const engineCalculation = googleBusinessFunction.match(
      /function computeHealthScore\(facts: Facts\)[\s\S]*?\n}\n\n\/\* ─+\n   § 8/,
    )?.[0] ?? '';

    expect(engineCalculation).toContain('const score = facts.health.score');
    expect(engineCalculation).toContain('facts.health.factors[id]');
    expect(engineCalculation).not.toContain('facts.profile.completeness');
    expect(engineCalculation).not.toContain('facts.reviews.daysSinceNewest');
  });

  it.each([
    {
      name: 'complete healthy profile',
      stats: {
        totalReviews: 10, unanswered: 0, averageRating: 5,
        newestReviewAt: '2026-09-10T12:00:00Z', photoCount: 5,
      },
      location: {
        primary_phone: '123', website_uri: 'https://example.com',
        locality: 'Berlin', primary_category: 'Autowerkstatt',
      },
      factors: { responseRate: 30, rating: 25, recency: 20, completeness: 15, photos: 10 },
      score: 100,
    },
    {
      name: 'partial profile at score boundaries',
      stats: {
        totalReviews: 4, unanswered: 1, averageRating: 4,
        newestReviewAt: '2026-07-01T12:00:00Z', photoCount: 2,
      },
      location: {
        primary_phone: '123', website_uri: null,
        locality: 'Berlin', primary_category: null,
      },
      factors: { responseRate: 23, rating: 13, recency: 14, completeness: 8, photos: 4 },
      score: 62,
    },
    {
      name: 'no reviews, location or photos',
      stats: {
        totalReviews: 0, unanswered: 0, averageRating: null,
        newestReviewAt: null, photoCount: 0,
      },
      location: null,
      factors: { responseRate: 0, rating: 0, recency: 0, completeness: 0, photos: 0 },
      score: 0,
    },
  ])('$name produces the same factor points as the SQL rules', ({ stats, location, factors, score }) => {
    expect(calculateHealthScoreInputs({ stats, location, now: NOW })).toMatchObject({
      points: factors,
      score,
    });
  });

  it('matches SQL non-null completeness semantics', () => {
    const result = calculateHealthScoreInputs({
      stats: { totalReviews: 0, averageRating: null, photoCount: 0 },
      location: {
        primary_phone: '', website_uri: '', locality: '', primary_category: '',
      },
      now: NOW,
    });

    expect(result.points.completeness).toBe(15);
  });
});
