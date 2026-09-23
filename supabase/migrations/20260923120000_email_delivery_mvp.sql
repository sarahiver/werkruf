-- MVP hardening for the transactional email outbox.
-- This migration is intentionally not executed by CI.

do $$
begin
  if to_regclass('public.email_queue') is null then
    raise exception 'WERKRUF base schema missing: public.email_queue does not exist';
  end if;

  if exists (
    select 1 from public.email_queue
    group by dedupe_key having count(*) > 1
  ) then
    raise exception 'email_queue contains duplicate dedupe_key values; resolve them before applying MVP email hardening';
  end if;
end
$$;

-- The ON CONFLICT in enqueue_email only provides idempotency when this
-- database-level invariant exists. It also serializes concurrent schedulers.
create unique index if not exists email_queue_dedupe_key_uidx
  on public.email_queue (dedupe_key);

alter table public.email_queue
  drop constraint if exists email_queue_template_check;

alter table public.email_queue
  add constraint email_queue_template_check check (template = any (array[
    'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
    'weekly_report', 'weekly_summary', 'visibility_report',
    'critical_review_alert', 'inactivity_reminder', 'payment_failed'
  ]));

-- These functions are worker internals. The public /enqueue route performs
-- authentication and derives its recipient from the verified session.
revoke all on function public.enqueue_email(text, text, text, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_emails(text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_email(uuid, boolean, text, text, text)
  from public, anon, authenticated;
revoke all on function public.schedule_lifecycle_emails()
  from public, anon, authenticated;
revoke all on function public.schedule_weekly_summaries()
  from public, anon, authenticated;
revoke all on function public.schedule_communications(text)
  from public, anon, authenticated;

grant execute on function public.enqueue_email(text, text, text, uuid, text, jsonb, timestamptz)
  to service_role;
grant execute on function public.claim_emails(text, integer) to service_role;
grant execute on function public.finish_email(uuid, boolean, text, text, text) to service_role;
grant execute on function public.schedule_lifecycle_emails() to service_role;
grant execute on function public.schedule_weekly_summaries() to service_role;
grant execute on function public.schedule_communications(text) to service_role;
