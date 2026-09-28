import fs from 'fs';
const read = p => fs.readFileSync(p, 'utf8');
const endpoint=read('supabase/functions/request-profile-report/index.ts');
const worker=read('supabase/functions/send-email/index.ts');
const migration=read('supabase/migrations/20260928100000_public_profile_reports.sql');

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
    expect(worker).toContain("failure_stage: 'brevo'");
  });
  it('does not enqueue when PDF generation fails',()=>{
    expect(endpoint.indexOf("status:'pdf_created'")).toBeLessThan(endpoint.indexOf("db.rpc('enqueue_email'"));
    expect(endpoint).toContain("status:'failed',failure_stage:'pdf_or_queue'");
  });
});
