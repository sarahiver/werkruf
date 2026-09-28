-- Durable public profile-report workflow. Apply manually after the Google
-- Maps Platform terms gate and the 20260923120000 email hardening migration.
create table if not exists public.profile_report_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  email_hash text not null,
  google_place_id text not null,
  company_name text not null,
  industry_key text not null default 'handwerk',
  status text not null default 'accepted' check (status in
    ('accepted','pdf_generating','pdf_created','email_queued','provider_accepted','delivered','failed')),
  report_path text,
  queue_id uuid references public.email_queue(id) on delete set null,
  failure_stage text,
  error_code text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

alter table public.profile_report_requests enable row level security;
revoke all on public.profile_report_requests from public, anon, authenticated;
create unique index if not exists profile_report_request_dedupe_uidx
  on public.profile_report_requests (email_hash, google_place_id, ((created_at at time zone 'UTC')::date));
create index if not exists profile_report_request_status_idx
  on public.profile_report_requests(status, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-reports', 'profile-reports', false, 5000000, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5000000,
  allowed_mime_types = array['application/pdf'];

-- No storage.objects policy is intentional: only service_role can access files.

create table if not exists public.profile_report_rate_limits (
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  primary key (key_hash, window_start)
);
alter table public.profile_report_rate_limits enable row level security;
revoke all on public.profile_report_rate_limits from public, anon, authenticated;

create or replace function public.consume_profile_report_limit(p_key_hash text, p_limit integer default 5)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_window timestamptz := date_trunc('hour', now()); v_count integer;
begin
  insert into profile_report_rate_limits(key_hash, window_start, request_count)
  values (p_key_hash, v_window, 1)
  on conflict (key_hash, window_start) do update
    set request_count = profile_report_rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= p_limit;
end $$;
revoke all on function public.consume_profile_report_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_profile_report_limit(text, integer) to service_role;

comment on table public.profile_report_requests is
  'Ops: inspect status/failure_stage/error_code only; PDF objects expire after 24h and must be removed by a scheduled cleanup.';
