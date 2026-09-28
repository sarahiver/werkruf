-- Read-only production/staging inventory for the Supabase SQL Editor.
-- This script changes no data and does not prove isolation by itself.
begin read only;

-- 1. All three rows must exist, in this order.
select version, name
from supabase_migrations.schema_migrations
where version in ('20260928143000', '20260928160000', '20260928170000')
order by version;

-- 2. relrowsecurity must be true for every row. relforcerowsecurity may be
-- false because service-role workers intentionally bypass RLS and perform
-- explicit ownership checks.
select c.relname as table_name, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'user_profiles', 'google_accounts', 'google_locations', 'google_reviews',
    'review_replies', 'sync_jobs', 'oauth_tokens', 'business_photos',
    'notification_preferences', 'events'
  )
order by c.relname;

-- 3. Compare this complete list with the migration definitions. In
-- particular there must be no additional permissive UPDATE policy on
-- user_profiles and no policy at all on oauth_tokens.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'user_profiles', 'google_accounts', 'google_locations', 'google_reviews',
    'review_replies', 'sync_jobs', 'oauth_tokens', 'business_photos',
    'notification_preferences', 'events'
  )
order by tablename, policyname;

-- 4. authenticated may update exactly these profile columns. The result
-- must contain no billing/subscription columns such as plan,
-- setup_fee_paid, stripe_customer_id or subscription_status.
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'user_profiles'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type, column_name;

-- 5. Must return zero rows: browser roles have no oauth_tokens privileges.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'oauth_tokens'
  and grantee in ('anon', 'authenticated');

-- 6. Definer flag, fixed search_path and ACL for the sensitive RPCs.
-- Expected:
--   touch_dashboard_visit(uuid): authenticated EXECUTE only
--   confirm_google_account(text,uuid): service_role EXECUTE only
--   select_google_location(uuid,uuid): service_role EXECUTE only
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig,
       coalesce(array_agg(acl.privilege_type || ':' ||
         case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
         order by acl.grantee, acl.privilege_type)
         filter (where acl.grantee is not null), '{}') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
where n.nspname = 'public'
  and p.proname in (
    'touch_dashboard_visit', 'confirm_google_account', 'select_google_location'
  )
group by p.oid, p.proname, p.prosecdef, p.proconfig
order by p.proname, arguments;

rollback;
