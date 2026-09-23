import { formatAdminDate, getCustomerProblem, getSubscriptionLabel } from './adminOps';

describe('admin ops presentation', () => {
  test('distinguishes active and expired trials', () => {
    expect(getSubscriptionLabel({ trialEndsAt: '2026-09-24T00:00:00Z' }, Date.parse('2026-09-23T00:00:00Z'))).toBe('Trial aktiv');
    expect(getSubscriptionLabel({ trialEndsAt: '2026-09-22T00:00:00Z' }, Date.parse('2026-09-23T00:00:00Z'))).toBe('Trial abgelaufen');
  });

  test('prioritizes broken Google authorization over downstream errors', () => {
    expect(getCustomerProblem({ googleStatus: 'needs_reauth', lastSyncError: { message: 'quota' } })).toBe('Google muss neu verbunden werden');
  });

  test('surfaces useful sync and mail failure reasons', () => {
    expect(getCustomerProblem({ googleStatus: 'active', lastSyncError: { jobType: 'sync_reviews', message: 'API 403' } })).toBe('sync_reviews: API 403');
    expect(getCustomerProblem({ googleStatus: 'active', lastMail: { status: 'failed', error_code: 'provider_error' } })).toBe('Mail fehlgeschlagen: provider_error');
  });

  test('handles missing and invalid timestamps', () => {
    expect(formatAdminDate(null)).toBe('—');
    expect(formatAdminDate('invalid')).toBe('—');
  });
});
