import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/admin-ops/index.ts'), 'utf8');

describe('admin-ops edge function security contract', () => {
  test('authenticates the caller and requires server-managed admin metadata', () => {
    expect(source).toContain('caller.auth.getUser()');
    expect(source).toContain("user.app_metadata?.role !== 'admin'");
    expect(source).not.toContain('user.user_metadata?.role');
  });

  test('returns the required support signals without exposing OAuth tokens', () => {
    ['stripeStatus', 'googleStatus', 'lastGoogleSyncAt', 'lastSyncError', 'healthScore', 'reviewCount', 'openActions', 'lastMail']
      .forEach((field) => expect(source).toContain(field));
    expect(source).not.toContain("from('oauth_tokens')");
  });
});
