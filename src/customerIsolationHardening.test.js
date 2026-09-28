import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260928160000_customer_isolation_hardening.sql'), 'utf8');
const integration = fs.readFileSync(path.join(root, 'supabase/tests/customer_isolation.sql'), 'utf8');

describe('customer isolation hardening migration', () => {
  it('uses column grants instead of broad profile update rights', () => {
    expect(migration).toMatch(/revoke insert, update, delete on public\.user_profiles/i);
    expect(migration).toMatch(/grant update \(full_name, company_name, phone, trade, city, avatar_url, industry_key, email_opt_out\)/i);
    for (const protectedField of ['plan', 'trial_started_at', 'trial_ends_at', 'stripe_subscription_id', 'stripe_subscription_status', 'setup_fee_paid']) {
      expect(migration.match(/grant update \([^)]+\)/i)?.[0]).not.toContain(protectedField);
    }
  });
  it('replaces overlapping profile and dashboard data policies', () => {
    expect(migration).toMatch(/tablename = 'user_profiles'/);
    expect(migration).toMatch(/business_photos_owner_all/);
    expect(migration).toMatch(/notification_preferences_owner_all/);
    expect(migration).toMatch(/events_owner_read/);
  });
  it('prevents the security-definer RPC from accepting another user id', () => {
    expect(migration).toMatch(/p_user_id is not null and p_user_id <> v_user/);
    expect(migration).toMatch(/raise exception 'forbidden'/);
  });
  it('ships a transactional two-user database test', () => {
    expect(integration).toMatch(/begin;[\s\S]*rollback;/i);
    expect(integration).toMatch(/A cannot update plan/);
    expect(integration).toMatch(/B cannot read A location by id/);
    expect(integration).toMatch(/cannot read tokens/g);
  });
});
