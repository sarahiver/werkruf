import { hasPaidAccess, isCancellationScheduled } from './subscription';

const NOW = new Date('2026-09-23T12:00:00.000Z');

describe('subscription access', () => {
  test.each(['active', 'trialing', 'past_due'])('allows Stripe status %s', (status) => {
    expect(hasPaidAccess({
      plan: 'free', stripe_subscription_id: 'sub_1', stripe_subscription_status: status,
    }, NOW)).toBe(true);
  });

  test.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'])('denies Stripe status %s', (status) => {
    expect(hasPaidAccess({
      plan: 'pro', stripe_subscription_id: 'sub_1', stripe_subscription_status: status,
    }, NOW)).toBe(false);
  });

  test('allows a legacy trial only until its end', () => {
    expect(hasPaidAccess({ plan: 'trial', trial_ends_at: '2026-09-24T00:00:00Z' }, NOW)).toBe(true);
    expect(hasPaidAccess({ plan: 'trial', trial_ends_at: '2026-09-23T11:59:59Z' }, NOW)).toBe(false);
    expect(hasPaidAccess({ plan: 'trial', trial_ends_at: null }, NOW)).toBe(false);
  });

  test('keeps access while cancellation waits for period end', () => {
    const profile = {
      plan: 'pro', stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'active', stripe_cancel_at_period_end: true,
    };
    expect(hasPaidAccess(profile, NOW)).toBe(true);
    expect(isCancellationScheduled(profile)).toBe(true);
  });
});
