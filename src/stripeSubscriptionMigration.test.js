import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260923070000_stripe_subscription_mvp.sql'),
  'utf8',
);

describe('Stripe MVP migration scope', () => {
  it('creates only the expected Stripe event table', () => {
    expect(migration).toMatch(/create table if not exists public\.stripe_events/i);
    expect(migration.match(/create table/gi)).toHaveLength(1);
  });

  it('locks the event table away from browser roles', () => {
    expect(migration).toMatch(/alter table public\.stripe_events enable row level security/i);
    expect(migration).toMatch(/revoke all on table public\.stripe_events from anon, authenticated/i);
    expect(migration).not.toMatch(/create policy/i);
  });

  it('adds exactly the two required profile columns', () => {
    const profileAlter = migration.match(/alter table public\.user_profiles[\s\S]*?;/i)?.[0] ?? '';
    expect(profileAlter).toMatch(/stripe_cancel_at_period_end boolean not null default false/i);
    expect(profileAlter).toMatch(/stripe_current_period_end timestamptz/i);
    expect(profileAlter.match(/add column/gi)).toHaveLength(2);
  });

  it('does not mutate data or unrelated database objects', () => {
    expect(migration).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(migration).not.toMatch(/\b(create|alter|drop)\s+(function|trigger|view|type|index|schema)\b/i);
    expect(migration).not.toMatch(/\bdrop\s+(table|column)\b/i);
  });
});
