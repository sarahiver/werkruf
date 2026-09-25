-- Complete, API-confirmed Google Location state. Do not execute automatically.
-- JSONB preserves Google's category-dependent structures without inventing fields.
alter table public.google_locations
  add column if not exists google_profile jsonb not null default '{}'::jsonb,
  add column if not exists google_updated jsonb,
  add column if not exists google_diff_mask text[] not null default '{}'::text[],
  add column if not exists google_media jsonb not null default '[]'::jsonb;

comment on column public.google_locations.google_profile is
  'Last confirmed Location read from Business Information API; Google is source of truth.';
comment on column public.google_locations.google_updated is
  'Serving-data proposal from locations.getGoogleUpdated; never auto-accepted.';
