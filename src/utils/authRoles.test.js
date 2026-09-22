import { isAdminUser } from './authRoles';

describe('isAdminUser', () => {
  test('accepts only app_metadata.role=admin', () => {
    expect(isAdminUser({ app_metadata: { role: 'admin' } })).toBe(true);
  });

  test('does not trust user_metadata.role', () => {
    expect(isAdminUser({
      app_metadata: {},
      user_metadata: { role: 'admin' },
    })).toBe(false);
  });

  test('returns false for normal or missing users', () => {
    expect(isAdminUser({ app_metadata: { role: 'user' } })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
  });
});
