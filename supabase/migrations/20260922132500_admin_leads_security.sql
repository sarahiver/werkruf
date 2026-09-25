-- WERKRUF admin authorization + secure lead claim (authoritative)
-- Generated from production baseline 2026-09-22 and reconciled with the
-- former 021_admin_lead_security.sql variant.
--
-- IMPORTANT: before applying this migration in production, ensure the intended
-- administrator has app_metadata.role = 'admin' and has refreshed their JWT.
--
-- This migration deliberately removes every policy/function name introduced by
-- either older variant first. It is therefore safe to apply when neither, one,
-- or both variants were partially applied outside migration bookkeeping.

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
-- policy for the admin dashboard. Both historical names are removed so the
-- final state can never contain two equivalent permissive policies.
drop policy if exists "Admins can read user profiles" on public.user_profiles;
drop policy if exists "Admins can read all user profiles" on public.user_profiles;

create policy "Admins can read user profiles"
  on public.user_profiles
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 3) Claim exactly one lead belonging to the currently authenticated user's
-- verified auth email. The client cannot choose a user id or email.
-- DROP is required because PostgreSQL cannot change a function's return type
-- with CREATE OR REPLACE. The old variants returned either void or boolean.
drop function if exists public.claim_own_lead();

create function public.claim_own_lead()
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
   order by l.created_at desc, l.id desc
   limit 1
   for update;

  if not found then
    return false;
  end if;

  -- Existing profile values are authoritative. Lead data only fills gaps;
  -- blank strings count as gaps just like NULL.
  update public.user_profiles p
     set company_name = coalesce(nullif(p.company_name, ''), nullif(v_lead.company_name, '')),
         google_place_id = coalesce(nullif(p.google_place_id, ''), nullif(v_lead.google_place_id, '')),
         google_rating = coalesce(p.google_rating, v_lead.google_rating),
         google_review_count = coalesce(p.google_review_count, v_lead.google_review_count),
         visibility_score = coalesce(p.visibility_score, v_lead.visibility_score),
         city = coalesce(nullif(p.city, ''), nullif(v_lead.city, '')),
         industry_key = coalesce(nullif(p.industry_key, ''), nullif(v_lead.industry_key, '')),
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
revoke all on function public.claim_own_lead() from anon;
grant execute on function public.claim_own_lead() to authenticated;

commit;
