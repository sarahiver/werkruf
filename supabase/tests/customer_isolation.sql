-- Destructive-looking but transactionally isolated acceptance test.
-- Run only against local/staging after all migrations: psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/customer_isolation.sql
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rls-a@example.invalid','',now(),now(),now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rls-b@example.invalid','',now(),now(),now());
insert into public.user_profiles (id, plan) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','free'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','free') on conflict do nothing;
insert into public.google_accounts (id,user_id,provider_account_id,status) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','provider-a','active'),
 ('b0000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','provider-b','active');
insert into public.google_locations (id,account_id,user_id,account_resource_name,location_resource_name,title) values
 ('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','accounts/a','locations/a','A'),
 ('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','accounts/b','locations/b','B');
insert into public.google_reviews (id,location_id,account_id,user_id,review_resource_name,star_rating,google_created_at) values
 ('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reviews/a',5,now()),
 ('b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','reviews/b',4,now());
insert into public.review_replies (id,review_id,location_id,user_id,body) values
 ('a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A reply'),
 ('b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B reply');
insert into public.oauth_tokens (account_id,user_id) values ('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
select is((select count(*)::int from public.google_accounts),1,'A sees one account');
select is((select count(*)::int from public.google_locations),1,'A sees one location');
select is((select count(*)::int from public.google_reviews),1,'A sees one review');
select is((select count(*)::int from public.review_replies),1,'A sees one reply');
select is((select count(*)::int from public.user_profiles),1,'A sees one profile');
select lives_ok($$update public.user_profiles set full_name='Allowed' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'A updates allowed profile field');
select throws_ok($$update public.user_profiles set plan='pro' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'42501',null,'A cannot update plan');
select throws_ok($$update public.user_profiles set setup_fee_paid=true where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'42501',null,'A cannot update billing flag');
select throws_ok($$select * from public.oauth_tokens$$,'42501',null,'A cannot read tokens');
select is((with changed as (update public.user_profiles set full_name='hacked' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1) select count(*)::int from changed),0,'A cannot update B profile');
select throws_ok($$select public.touch_dashboard_visit('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,'42501','forbidden','RPC rejects foreign user id');
select throws_ok($$select public.select_google_location('a0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'42501',null,'customer cannot call trusted location selector directly');

select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
select is((select count(*)::int from public.google_accounts),1,'B sees one account');
select is((select count(*)::int from public.google_locations),1,'B sees one location');
select is((select count(*)::int from public.google_reviews),1,'B sees one review');
select is((select count(*)::int from public.review_replies),1,'B sees one reply');
select is((select count(*)::int from public.google_locations where id='a0000000-0000-4000-8000-000000000002'),0,'B cannot read A location by id');
select is((with changed as (update public.google_locations set title='hacked' where id='a0000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from changed),0,'B cannot update A location');
select throws_ok($$select * from public.oauth_tokens$$,'42501',null,'B cannot read tokens');

set local role postgres;
select ok(public.select_google_location('a0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'trusted backend selects an authorised location');

select * from finish();
rollback;
