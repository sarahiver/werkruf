import fs from 'fs';
import path from 'path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const migration = read('supabase/migrations/20260923120000_email_delivery_mvp.sql');
const sender = read('supabase/functions/send-email/index.ts');
const opsAlert = read('supabase/functions/ops-alert/index.ts');
const stripeWebhook = read('supabase/functions/stripe-webhook/index.ts');
const baseline = read('supabase/schema/production-baseline-2026-09-22.sql');

describe('MVP email delivery', () => {
  it('enforces queue idempotency and lets enqueue report duplicates', () => {
    expect(migration).toMatch(/unique index[^;]+email_queue \(dedupe_key\)/is);
    expect(baseline).toMatch(/on conflict \(dedupe_key\) do nothing/i);
    expect(sender).toContain('duplicate: data === null');
  });

  it('deduplicates welcome and both weekly scheduler paths by user and period', () => {
    expect(baseline).toContain("'welcome:' || new.id");
    expect(baseline.match(/'weekly_summary:' \|\| v_row\.user_id \|\| ':'/g)).toHaveLength(2);
    expect(baseline).toContain("to_char(date_trunc('week', now()), 'YYYY-MM-DD')");
    expect(baseline).toContain("'weekly_summary', v_row.email");
  });

  it('marks critical review events only after their alert was queued', () => {
    const alertBlock = baseline.match(/when 'immediate_alert'[\s\S]*?when 'weekly_email'/i)?.[0] ?? '';
    expect(alertBlock).toMatch(/if public\.enqueue_email\([\s\S]*?is not null then/i);
    expect(alertBlock).toMatch(/perform public\.mark_events_delivered\(v_ids, 'notification'\)/i);
  });

  it('rejects missing recipients before Brevo and keeps failed sends observable', () => {
    expect(baseline).toMatch(/p_to_email is null or p_to_email !~/i);
    expect(sender).toContain("message: 'Kein E-Mail-Adresse in der Session.'");
    expect(sender).toContain("errorCode: 'network_error'");
    expect(sender).toMatch(/p_error_code: result\.errorCode/);
    expect(baseline).toMatch(/status = 'failed', error_code = p_error_code/);
  });

  it('routes payment failures through the same durable, event-idempotent queue', () => {
    expect(stripeWebhook).toContain("p_template: 'payment_failed'");
    expect(stripeWebhook).toContain('p_dedupe_key: `payment_failed:${event.id}`');
    expect(stripeWebhook).not.toContain("fetch('https://api.brevo.com/v3/smtp/email'");
    expect(migration).toContain("'payment_failed'");
  });

  it('prevents browser roles from invoking privileged queue functions', () => {
    expect(migration).toMatch(/revoke all on function public\.enqueue_email[\s\S]*?from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.enqueue_email[\s\S]*?to service_role/i);
  });

  it('redirects every Brevo recipient in test mode', () => {
    expect(sender).toContain("if (mode === 'test') return requireEnv('EMAIL_TEST_RECIPIENT')");
    expect(opsAlert).toMatch(/mode === 'test'[\s\S]*?requireEnv\('EMAIL_TEST_RECIPIENT'\)/);
  });

  it('does not log customer addresses in the active send paths', () => {
    expect(sender).not.toMatch(/log\([^\n]+to_email/);
    expect(stripeWebhook).not.toContain("'[sendEmail] Gesendet an:'");
  });
});
