import { hasAdminRole } from './authorization';

describe('hasAdminRole', () => {
  it('accepts a server-managed admin claim', () => {
    expect(hasAdminRole({ app_metadata: { role: 'admin' } })).toBe(true);
  });

  it('does not trust an admin role in user metadata', () => {
    expect(hasAdminRole({ user_metadata: { role: 'admin' } })).toBe(false);
  });

  it('rejects users without the admin claim', () => {
    expect(hasAdminRole({ app_metadata: { role: 'member' } })).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
  });
});
