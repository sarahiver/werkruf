begin;

-- A table grant only permits a query to reach RLS. The policy remains the
-- authoritative check and trusts only server-managed app_metadata.
drop policy if exists "Admins can read leads" on public.leads;

create policy "Admins can read leads"
on public.leads
for select
to authenticated
using (
  coalesce(
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
);

-- Keep the existing owner-only profile policies unchanged and add the read
-- access required by the admin overview.
create policy "Admins can read all user profiles"
on public.user_profiles
for select
to authenticated
using (
  coalesce(
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
);

-- Claim exactly one unconverted lead belonging to the authenticated user's
-- server-side auth email. No identity or email is accepted from the caller.
create or replace function public.claim_own_lead()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_lead public.leads%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select users.email
    into v_email
    from auth.users as users
   where users.id = v_user_id;

  if v_email is null then
    raise exception 'authenticated user has no email' using errcode = '22023';
  end if;

  select leads.*
    into v_lead
    from public.leads as leads
   where lower(btrim(leads.email)) = lower(btrim(v_email))
     and leads.status = 'new'
   order by leads.created_at desc, leads.id desc
   limit 1
   for update;

  -- No new matching lead also makes repeated calls a safe no-op.
  if not found then
    return;
  end if;

  update public.user_profiles as profiles
     set company_name = coalesce(profiles.company_name, nullif(v_lead.company_name, '')),
         google_place_id = coalesce(profiles.google_place_id, nullif(v_lead.google_place_id, '')),
         google_rating = coalesce(profiles.google_rating, v_lead.google_rating),
         google_review_count = coalesce(profiles.google_review_count, v_lead.google_review_count),
         visibility_score = coalesce(profiles.visibility_score, v_lead.visibility_score),
         city = coalesce(profiles.city, nullif(v_lead.city, '')),
         industry_key = coalesce(profiles.industry_key, nullif(v_lead.industry_key, ''))
   where profiles.id = v_user_id;

  -- Do not consume the lead before the new user's profile exists.
  if not found then
    return;
  end if;

  update public.leads as leads
     set status = 'converted'
   where leads.id = v_lead.id
     and leads.status = 'new';
end;
$$;

revoke all on function public.claim_own_lead() from public;
revoke all on function public.claim_own_lead() from anon;
grant execute on function public.claim_own_lead() to authenticated;

commit;
