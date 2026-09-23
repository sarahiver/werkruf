-- Stripe MVP state required by stripe-webhook.
-- Apply explicitly in the target Supabase project; this repository does not
-- run production migrations automatically.

-- This is an incremental migration, not a project bootstrap. Fail before
-- creating stripe_events when the target is not an initialized WERKRUF
-- database; otherwise the migration would appear successful while webhook
-- persistence to user_profiles still fails.
do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception using
      errcode = '42P01',
      message = 'WERKRUF base schema missing: public.user_profiles does not exist',
      hint = 'Initialize or clone the WERKRUF schema in this test project, then run this incremental migration again.';
  end if;
end
$$;

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;

alter table public.user_profiles
  add column if not exists stripe_cancel_at_period_end boolean not null default false,
  add column if not exists stripe_current_period_end timestamptz;
