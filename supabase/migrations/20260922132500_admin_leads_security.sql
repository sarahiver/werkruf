-- WERKRUF admin authorization + secure lead claim
-- Generated from production baseline 2026-09-22.
--
-- IMPORTANT: before applying this migration in production, ensure the intended
-- administrator has app_metadata.role = 'admin' and has refreshed their JWT.

begin;

-- 1) Replace the misleading broad SELECT policy on leads.
drop policy if exists "Admins can read leads" on public.leads;

create policy "Admins can read leads"
  on public.leads
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 2) Keep owner-only access for normal users, and add an explicit admin read
-- policy for the admin dashboard.
drop policy if exists "Admins can read user profiles" on public.user_profiles;

create policy "Admins can read user profiles"
  on public.user_profiles
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 3) Claim exactly one lead belonging to the currently authenticated user's
-- verified auth email. The client cannot choose a user id or email.
create or replace function public.claim_own_lead()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_lead public.leads%rowtype;
  v_profile_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select u.email
    into v_email
    from auth.users u
   where u.id = v_user_id;

  if v_email is null or btrim(v_email) = '' then
    return false;
  end if;

  select l.*
    into v_lead
    from public.leads l
   where lower(btrim(l.email)) = lower(btrim(v_email))
     and l.status = 'new'
   order by l.created_at desc
   limit 1
   for update;

  if not found then
    return false;
  end if;

  update public.user_profiles p
     set company_name = coalesce(v_lead.company_name, p.company_name),
         google_place_id = coalesce(v_lead.google_place_id, p.google_place_id),
         google_rating = coalesce(v_lead.google_rating, p.google_rating),
         google_review_count = coalesce(v_lead.google_review_count, p.google_review_count),
         visibility_score = coalesce(v_lead.visibility_score, p.visibility_score),
         city = coalesce(v_lead.city, p.city),
         industry_key = coalesce(v_lead.industry_key, p.industry_key),
         updated_at = now()
   where p.id = v_user_id;

  get diagnostics v_profile_updated = row_count;

  if v_profile_updated <> 1 then
    return false;
  end if;

  update public.leads
     set status = 'converted'
   where id = v_lead.id
     and status = 'new';

  return true;
end;
$$;

revoke all on function public.claim_own_lead() from public;
grant execute on function public.claim_own_lead() to authenticated;

commit;
