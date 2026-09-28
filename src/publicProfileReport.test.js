import fs from 'fs';
const read = p => fs.readFileSync(p, 'utf8');
const endpoint=read('supabase/functions/request-profile-report/index.ts');
const worker=read('supabase/functions/send-email/index.ts');
const migration=read('supabase/migrations/20260928100000_public_profile_reports.sql');
const leadForm=read('src/components/LeadForm.js');

describe('public profile report pipeline',()=>{
  it('gates production on the applicable Google agreement and validates input',()=>{
    expect(endpoint).toContain('PUBLIC_REPORT_GOOGLE_TERMS_APPROVED');
    expect(endpoint).toContain('PUBLIC_REPORT_BILLING_COUNTRY');
    expect(endpoint).toContain("error:'invalid_email'");
    expect(endpoint).toContain("error:'invalid_place_id'");
  });
  it('re-fetches Places data server-side and uses the canonical calculator',()=>{
    expect(endpoint).toContain("import { calculateProfileScore }");
    expect(endpoint).toContain('places.googleapis.com/v1/places/');
    expect(endpoint).not.toMatch(/body\.(score|rating|reviewCount)/);
  });
  it('rate limits and deduplicates concurrent requests at database level',()=>{
    expect(migration).toContain('consume_profile_report_limit');
    expect(migration).toMatch(/unique index[\s\S]*email_hash, google_place_id/i);
    expect(endpoint).toContain("error:'rate_limited'");
  });
  it('answers the real Supabase browser preflight with all SDK headers',()=>{
    expect(endpoint).toContain("if (req.method === 'OPTIONS')");
    expect(endpoint).toContain("'Access-Control-Allow-Methods': 'POST, OPTIONS'");
    expect(endpoint).toContain('authorization, x-client-info, apikey, content-type');
    expect(endpoint).toContain("'Vary': 'Origin'");
  });
  it('requires Turnstile server-side and manages the browser widget lifecycle',()=>{
    expect(endpoint).toContain('if (!secret || !token) return false');
    expect(endpoint).not.toContain('PUBLIC_REPORT_ALLOW_NO_CAPTCHA');
    expect(endpoint).toContain('clean(body.captchaToken,2048)');
    expect(leadForm).toContain('turnstile.render');
    expect(leadForm).toContain("'expired-callback'");
    expect(leadForm).toContain('turnstile.reset');
    expect(leadForm).toContain('captchaToken}}');
  });
  it('never confirms a deduplicated failed request as accepted',()=>{
    expect(endpoint).toContain("error:'previous_request_failed'");
    expect(endpoint).toContain("status === 'failed'");
    expect(leadForm).toContain('previous_request_failed');
  });
  it('stores only a private PDF reference in the queue',()=>{
    expect(migration).toMatch(/'profile-reports'[\s\S]*false/);
    expect(endpoint).toContain('reportPath:path');
    expect(endpoint).not.toContain('pdfBytes');
  });
  it('creates a two-page PDF and reports unavailable fields',()=>{
    expect(endpoint.match(/doc\.addPage/g)).toHaveLength(2);
    expect(endpoint).toContain("'Score: nicht verfuegbar'");
    expect(endpoint).toContain("'nicht verfuegbar'");
  });
  it('attaches a validated PDF to Brevo and preserves retries',()=>{
    expect(worker).toContain("data.type !== 'application/pdf'");
    expect(worker).toContain("!== '%PDF-'");
    expect(worker).toContain('...(attachment ? { attachment } : {})');
    expect(worker).toContain("markReportFailed(row, stage");
    expect(worker).toContain("'pdf_attachment'");
  });
  it('synchronizes terminal queue failures to the report request',()=>{
    expect(worker).toContain('row.attempts >= row.max_attempts');
    expect(worker).toContain("markReportFailed(row, 'worker_budget'");
    expect(worker).toContain("markReportFailed(row, 'worker', 'render_error'");
    expect(worker).toContain("status: 'failed', failure_stage: stage");
  });
  it('does not enqueue when PDF generation fails',()=>{
    expect(endpoint.indexOf("status:'pdf_created'")).toBeLessThan(endpoint.indexOf("db.rpc('enqueue_email'"));
    expect(endpoint).toContain("status:'failed',failure_stage:'pdf_or_queue'");
  });
});
