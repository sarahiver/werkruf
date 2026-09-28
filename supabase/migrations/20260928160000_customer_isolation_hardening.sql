-- Follow-up hardening. Safe whether 20260928143000 has only been staged or
-- already applied elsewhere. Apply in order; do not edit the earlier migration.

-- RLS is row-level, not column-level. Remove broad profile mutation grants and
-- allow only fields exposed by the profile settings UI.
revoke insert, update, delete on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;
grant update (full_name, company_name, phone, trade, city, avatar_url, industry_key, email_opt_out)
  on public.user_profiles to authenticated;

-- Customer clients only read Google-derived data. Every mutation goes through
-- an ownership-checking Edge Function; make that boundary explicit in grants.
revoke all on public.google_accounts, public.google_locations, public.google_reviews,
  public.review_replies, public.sync_jobs, public.oauth_tokens from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.google_accounts, public.google_locations, public.google_reviews,
     public.review_replies, public.sync_jobs from authenticated;
grant select on public.google_accounts, public.google_locations, public.google_reviews,
  public.review_replies, public.sync_jobs to authenticated;
revoke all on public.oauth_tokens from authenticated;

-- Replace every profile policy deterministically. Permissive policies combine
-- with OR, so leaving an old UPDATE policy in place would defeat hardening.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
  loop execute format('drop policy %I on public.user_profiles', p.policyname); end loop;
end $$;

create policy user_profiles_owner_read on public.user_profiles
  for select to authenticated using (id = (select auth.uid()));
create policy user_profiles_admin_read on public.user_profiles
  for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy user_profiles_owner_update on public.user_profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Other tenant data read/written directly by customer dashboard components.
alter table public.business_photos enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.events enable row level security;

do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('business_photos', 'notification_preferences', 'events')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

create policy business_photos_owner_all on public.business_photos
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy notification_preferences_owner_all on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy events_owner_read on public.events
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.business_photos, public.notification_preferences, public.events from anon;
revoke all on public.business_photos, public.notification_preferences, public.events from authenticated;
grant select, insert, delete on public.business_photos to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select on public.events to authenticated;

-- The previous SECURITY DEFINER implementation accepted an arbitrary user id.
-- Keep the signature for compatibility, but reject every foreign id.
create or replace function public.touch_dashboard_visit(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_user_id is not null and p_user_id <> v_user then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.notification_preferences (user_id, last_dashboard_visit_at)
  values (v_user, now())
  on conflict (user_id) do update set last_dashboard_visit_at = excluded.last_dashboard_visit_at;
end;
$$;
revoke all on function public.touch_dashboard_visit(uuid) from public, anon;
grant execute on function public.touch_dashboard_visit(uuid) to authenticated;
