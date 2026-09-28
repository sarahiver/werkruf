-- Records an explicit customer selection. OAuth authorises an account; it does
-- not imply which of that account's businesses the customer wants to manage.
alter table public.google_locations
  add column if not exists selected_at timestamptz;

create unique index if not exists google_locations_one_selected_per_user
  on public.google_locations (user_id)
  where selected_at is not null and deleted_at is null;

comment on column public.google_locations.selected_at is
  'Set only by the ownership-checking location/select Edge route after an explicit customer choice.';

create or replace function public.select_google_location(p_location_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.google_locations l
      join public.google_accounts a on a.id = l.account_id
     where l.id = p_location_id and l.user_id = p_user_id
       and a.user_id = p_user_id and a.status = 'active'
       and l.deleted_at is null and a.deleted_at is null
  ) then return false; end if;

  update public.google_locations
     set is_primary = (id = p_location_id),
         selected_at = case when id = p_location_id then now() else null end
   where user_id = p_user_id and deleted_at is null;
  return true;
end;
$$;
revoke all on function public.select_google_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public.select_google_location(uuid, uuid) to service_role;
