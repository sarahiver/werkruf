import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/021_admin_lead_security.sql'),
  'utf8',
);

describe('admin and lead security migration', () => {
  it('uses only the server-managed app_metadata role for admin policies', () => {
    expect(migration).toContain("-> 'app_metadata' ->> 'role') = 'admin'");
    expect(migration).not.toContain("-> 'user_metadata'");
    expect(migration).not.toMatch(/auth\.role\(\)\s*=\s*'authenticated'/);
  });

  it('keeps lead claiming server-side and bound to auth.uid()', () => {
    expect(migration).toMatch(/function public\.claim_own_lead\(\)/);
    expect(migration).toMatch(/security definer/i);
    expect(migration).toContain('v_user_id uuid := auth.uid()');
    expect(migration).toContain('from auth.users as users');
    expect(migration).toContain("set search_path = ''");
  });

  it('restricts RPC execution to authenticated users', () => {
    expect(migration).toMatch(/revoke all on function public\.claim_own_lead\(\) from public/i);
    expect(migration).toMatch(/revoke all on function public\.claim_own_lead\(\) from anon/i);
    expect(migration).toMatch(/grant execute on function public\.claim_own_lead\(\) to authenticated/i);
  });

  it('does not replace or remove the public lead insert policy', () => {
    expect(migration).not.toMatch(/drop policy[^;]*insert/i);
    expect(migration).not.toMatch(/for insert/i);
  });
});
