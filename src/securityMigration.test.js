import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260922132500_admin_leads_security.sql'),
  'utf8',
);

const migrationFiles = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations'));

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
    expect(migration).toMatch(/from auth\.users (?:as )?u\s+where u\.id = v_user_id/i);
    expect(migration).toContain("set search_path = ''");
  });

  it('restricts RPC execution to authenticated users', () => {
    expect(migration).toMatch(/revoke all on function public\.claim_own_lead\(\) from public/i);
    expect(migration).toMatch(/revoke all on function public\.claim_own_lead\(\) from anon/i);
    expect(migration).toMatch(/grant execute on function public\.claim_own_lead\(\) to authenticated/i);
  });

  it('has one authoritative admin/lead migration and reconciles both historical states', () => {
    expect(migrationFiles.filter((file) => file.includes('admin_lead'))).toEqual([
      '20260922132500_admin_leads_security.sql',
    ]);
    expect(migration).toContain('drop policy if exists "Admins can read user profiles"');
    expect(migration).toContain('drop policy if exists "Admins can read all user profiles"');
    expect(migration.match(/create policy "Admins can read user profiles"/g)).toHaveLength(1);
    expect(migration).not.toContain('create policy "Admins can read all user profiles"');
  });

  it('normalizes the historical RPC return types to one boolean signature', () => {
    expect(migration).toMatch(/drop function if exists public\.claim_own_lead\(\)/i);
    expect(migration.match(/create function public\.claim_own_lead\(\)/gi)).toHaveLength(1);
    expect(migration).toMatch(/claim_own_lead\(\)\s*returns boolean/i);
    expect(migration).not.toMatch(/claim_own_lead\(\)\s*returns void/i);
  });

  it('preserves existing profile values and uses lead values only as fallbacks', () => {
    expect(migration).toContain("company_name = coalesce(nullif(p.company_name, ''), nullif(v_lead.company_name, ''))");
    expect(migration).toContain("city = coalesce(nullif(p.city, ''), nullif(v_lead.city, ''))");
    expect(migration).not.toContain('company_name = coalesce(v_lead.company_name, p.company_name)');
  });

  it('does not replace or remove the public lead insert policy', () => {
    expect(migration).not.toMatch(/drop policy[^;]*insert/i);
    expect(migration).not.toMatch(/for insert/i);
  });
});
