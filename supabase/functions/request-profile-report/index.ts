import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import * as pdfLib from 'npm:pdf-lib@1.17.1';
import { calculateProfileScore } from '../../../src/utils/visibilityScore.js';
import { createReportPdf } from '../../../src/utils/reportPdf.js';

const allowedOrigins = () => (Deno.env.get('PUBLIC_REPORT_ALLOWED_ORIGINS') ?? '')
  .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
function cors(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') ?? '').replace(/\/$/, '');
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : '';
  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json' } });
const env = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`missing_${name}`); return value; };
const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const placeIdPattern = /^[A-Za-z0-9_-]{10,255}$/;

async function verifyCaptcha(token: string, ip: string) {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret || !token) return false;
  const form = new FormData(); form.set('secret', secret); form.set('response', token); form.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  return response.ok && Boolean((await response.json()).success);
}

/* Aufbau und Layout des Berichts stehen in src/utils/reportPdf.js —
   damit Tests dieselbe Funktion ausfuehren wie der Produktivpfad. */

Deno.serve(async req => {
  const requestOrigin = (req.headers.get('origin') ?? '').replace(/\/$/, '');
  if (!allowedOrigins().includes(requestOrigin)) return json(req, { error: 'origin_not_allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  // Production stays closed until counsel confirms the applicable agreement for
  // the actual Cloud project and its billing country.
  if (Deno.env.get('PUBLIC_REPORT_GOOGLE_TERMS_APPROVED') !== 'true' || !Deno.env.get('PUBLIC_REPORT_BILLING_COUNTRY')) return json(req, { error:'legal_gate_closed' },503);
  let body: Record<string,unknown>; try { body=await req.json(); } catch { return json(req, {error:'invalid_json'},400); }
  const email=clean(body.email,254).toLowerCase(), placeId=clean(body.placeId,255), industry=clean(body.industryKey,32)||'handwerk';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, {error:'invalid_email'},422);
  if(!placeIdPattern.test(placeId)) return json(req, {error:'invalid_place_id'},422);
  if(!['handwerk','gastro','beauty'].includes(industry)) return json(req, {error:'invalid_industry'},422);
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  if(!await verifyCaptcha(clean(body.captchaToken,2048),ip)) return json(req, {error:'captcha_required'},403);
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}}); const emailHash=await sha(email), rateHash=await sha(`${ip}:${emailHash}`);
  const {data:allowed}=await db.rpc('consume_profile_report_limit',{p_key_hash:rateHash,p_limit:5}); if(!allowed) return json(req, {error:'rate_limited'},429);
  const fields='id,displayName,rating,userRatingCount,websiteUri'; const google=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=${fields}`,{headers:{'X-Goog-Api-Key':env('GOOGLE_PLACES_SERVER_API_KEY'),'X-Goog-FieldMask':fields}});
  if(!google.ok) return json(req, {error:'place_lookup_failed'},502); const place=await google.json(); if(place.id!==placeId) return json(req, {error:'invalid_place_id'},422);
  const company=clean(place.displayName?.text,160); const count=typeof place.userRatingCount==='number'?place.userRatingCount:null, rating=typeof place.rating==='number'?place.rating:null, website=Object.prototype.hasOwnProperty.call(place,'websiteUri')?Boolean(place.websiteUri):null;
  const score=calculateProfileScore({rating,ratingAvailable:rating!==null,reviewCount:count,reviewCountAvailable:count!==null,hasWebsite:website===true,websiteAvailable:website!==null});
  const {data:existing}=await db.from('profile_report_requests').select('id,status').eq('email_hash',emailHash).eq('google_place_id',placeId).gte('created_at',new Date(Date.now()-86400000).toISOString()).maybeSingle();
  if(existing) return existing.status === 'failed'
    ? json(req, {error:'previous_request_failed',requestId:existing.id,status:existing.status},409)
    : json(req, {requestId:existing.id,status:existing.status,deduplicated:true},202);
  const {data:report,error:reportError}=await db.from('profile_report_requests').insert({email_hash:emailHash,google_place_id:placeId,company_name:company,industry_key:industry,status:'accepted'}).select('id').single();
  if(reportError) { if(reportError.code==='23505') { const {data:duplicate}=await db.from('profile_report_requests').select('id,status').eq('email_hash',emailHash).eq('google_place_id',placeId).gte('created_at',new Date(Date.now()-86400000).toISOString()).single(); return duplicate?.status === 'failed' ? json(req, {error:'previous_request_failed',requestId:duplicate.id,status:duplicate.status},409) : json(req, {requestId:duplicate?.id,status:duplicate?.status,deduplicated:true},202); } return json(req, {error:'request_persistence_failed'},500); }
  const {data:lead,error:leadError}=await db.from('leads').insert({company_name:company,contact_person:'-',phone:'-',email,source:'public_profile_report',status:'new',industry_key:industry,google_place_id:placeId,visibility_score:score.score}).select('id').single();
  if(leadError) { await db.from('profile_report_requests').update({status:'failed',failure_stage:'lead',error_code:'lead_insert_failed'}).eq('id',report.id); return json(req, {error:'request_persistence_failed'},500); }
  await db.from('profile_report_requests').update({lead_id:lead.id,status:'pdf_generating',updated_at:new Date().toISOString()}).eq('id',report.id);
  try { const bytes=await createReportPdf(pdfLib,company,score,{rating,count,website}); const path=`${report.id}/profilbericht.pdf`; const upload=await db.storage.from('profile-reports').upload(path,bytes,{contentType:'application/pdf',upsert:false}); if(upload.error) throw new Error('pdf_upload_failed'); await db.from('profile_report_requests').update({status:'pdf_created',report_path:path,updated_at:new Date().toISOString()}).eq('id',report.id); const dedupe=`visibility_report:${report.id}`; const {data:queue,error:qerr}=await db.rpc('enqueue_email',{p_template:'visibility_report',p_to_email:email,p_to_name:company,p_user_id:null,p_dedupe_key:dedupe,p_payload:{companyName:company,industryKey:industry,reportRequestId:report.id,reportPath:path,score:score.score},p_scheduled_for:new Date().toISOString()}); if(qerr) throw new Error('queue_failed'); await db.from('profile_report_requests').update({status:'email_queued',queue_id:queue,updated_at:new Date().toISOString()}).eq('id',report.id); return json(req, {requestId:report.id,status:'email_queued'},202); } catch(e) { await db.from('profile_report_requests').update({status:'failed',failure_stage:'pdf_or_queue',error_code:String(e).slice(0,100),updated_at:new Date().toISOString()}).eq('id',report.id); return json(req, {error:'report_processing_failed',requestId:report.id},500); }
});
