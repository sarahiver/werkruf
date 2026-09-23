-- Stripe MVP state required by stripe-webhook.
-- Apply explicitly in the target Supabase project; this repository does not
-- run production migrations automatically.

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

alter table public.stripe_events
  add column if not exists type text,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists error_message text;

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;

alter table public.user_profiles
  add column if not exists stripe_cancel_at_period_end boolean not null default false,
  add column if not exists stripe_current_period_end timestamptz;

create index if not exists stripe_events_received_at_idx
  on public.stripe_events (received_at);
