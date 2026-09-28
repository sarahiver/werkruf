-- P0: tenant isolation for Google Business Profile data.
-- Review and apply through the normal migration process; do not run directly in production.

alter table public.google_accounts enable row level security;
alter table public.google_locations enable row level security;
alter table public.google_reviews enable row level security;
alter table public.review_replies enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.user_profiles enable row level security;

-- Recreate deterministic policies so this migration also repairs permissive legacy policies.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in
      ('google_accounts','google_locations','google_reviews','review_replies','sync_jobs','oauth_tokens')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
end $$;

create policy google_accounts_owner_read on public.google_accounts
  for select to authenticated using (user_id = (select auth.uid()));

create policy google_locations_owner_read on public.google_locations
  for select to authenticated using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.google_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
        and a.status = 'active' and a.deleted_at is null));

create policy google_reviews_owner_read on public.google_reviews
  for select to authenticated using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.google_locations l
      where l.id = location_id and l.user_id = (select auth.uid())
        and l.account_id = google_reviews.account_id and l.deleted_at is null));

create policy review_replies_owner_read on public.review_replies
  for select to authenticated using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.google_reviews r
      where r.id = review_id and r.user_id = (select auth.uid())));

create policy sync_jobs_owner_read on public.sync_jobs
  for select to authenticated using (
    user_id = (select auth.uid())
    and (account_id is null or exists (
      select 1 from public.google_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())))
    and (location_id is null or exists (
      select 1 from public.google_locations l
      where l.id = location_id and l.user_id = (select auth.uid()))));

-- Intentionally no oauth_tokens policy: not even encrypted tokens are client-readable.
revoke all on public.oauth_tokens from anon, authenticated;

-- Profiles are tenant scoped. A Places ID remains presentation/lead metadata only;
-- all managed locations come from google_locations after OAuth.
drop policy if exists user_profiles_owner_read on public.user_profiles;
drop policy if exists user_profiles_owner_update on public.user_profiles;
create policy user_profiles_owner_read on public.user_profiles
  for select to authenticated using (id = (select auth.uid()));
create policy user_profiles_owner_update on public.user_profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- confirmation is callable only by the service-role Edge Function. The function
-- still requires the authenticated user id and matches it atomically with token.
revoke all on function public.confirm_google_account(text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_google_account(text, uuid) to service_role;
