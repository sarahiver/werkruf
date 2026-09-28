import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260928143000_google_customer_isolation.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/google-business/index.ts'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/dashboard/DashboardGoogleBusiness.js'), 'utf8');

describe('GBP tenant isolation release blocker', () => {
  test.each(['google_accounts', 'google_locations', 'google_reviews', 'review_replies', 'sync_jobs', 'oauth_tokens'])(
    '%s has RLS enabled', (table) => expect(migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i')),
  );

  it('binds every readable Google relation to auth.uid()', () => {
    expect((migration.match(/auth\.uid\(\)/g) || []).length).toBeGreaterThanOrEqual(10);
    expect(migration).toMatch(/revoke all on public\.oauth_tokens from anon, authenticated/i);
  });

  it('checks manipulated location ids against the authenticated identity', () => {
    expect(edge).toMatch(/\.eq\('id', payload\.locationId\)\.eq\('user_id', user\.id\)/);
    expect(edge).toMatch(/\.eq\('id', locationId\)\.eq\('user_id', userId\)/);
  });

  it('does not expose public Places linking in the managed-business dashboard', () => {
    expect(dashboard).not.toMatch(/BusinessLinkCard/);
  });
});
