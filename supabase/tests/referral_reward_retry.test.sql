-- WP10-Folgefix — Reward-Retry: Datenbankseite.
--
--   scripts/test-db/run.sh referral_reward_retry
--
--   T6  Versuch notieren laesst pending stehen (Zaehler, Zeit, Fehler)
--   T7  Erfolg danach → applied, last_error geloescht, Stripe-ID gesetzt
--   T8  zweites applied aendert nichts (Stripe-ID bleibt)
--   T9  pending_for_referral liefert nur pending des Referrals
--   Rechte: nur service_role

\set ON_ERROR_STOP on

create or replace function pg_temp.signup(p_name text, p_code text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_name || '@example.test',
          case when p_code is null then '{}'::jsonb else jsonb_build_object('referral_code', p_code) end);
  insert into public.user_profiles (id, company_name, plan) values (v_id, p_name, 'free') on conflict (id) do nothing;
  return v_id;
end $$;

begin;
select test.basis();
do $$
declare
  v_a uuid := test.id('user_a'); v_code text; v_k uuid; r jsonb; v_ref uuid; v_rw uuid; v_rw2 uuid; z public.referral_rewards; f text;
begin
  update public.user_profiles set plan = 'pro', stripe_customer_id = 'cus_a', stripe_subscription_status = 'active' where id = v_a;
  v_code := public.ensure_referral_code(v_a) ->> 'code';
  v_k := pg_temp.signup('kollege_retry', v_code);
  r := public.referral_mark_converted(v_k, 'in_r1', 4900, 'eur');
  assert (r ->> 'converted')::boolean, format('Vorbereitung: %s', r);
  v_ref := (r ->> 'referralId')::uuid;
  select id into v_rw from public.referral_rewards where referral_id = v_ref and beneficiary = 'referrer';
  select id into v_rw2 from public.referral_rewards where referral_id = v_ref and beneficiary = 'referred';

  /* T9 — beide offen */
  assert jsonb_array_length(public.referral_rewards_pending_for_referral(v_ref)) = 2, 'T9: nicht 2 pending';
  assert (public.referral_rewards_pending_for_referral(v_ref) -> 0 ->> 'attemptCount')::int = 0, 'T9: attemptCount nicht 0';

  /* T6 — transienter Fehler: Versuch notiert, Status bleibt pending */
  assert public.referral_reward_versuch_notieren(v_rw, 'StripeConnectionError: timeout'), 'T6: notieren false';
  assert public.referral_reward_versuch_notieren(v_rw, 'StripeAPIError: 503'), 'T6: zweites notieren false';
  select * into z from public.referral_rewards where id = v_rw;
  assert z.status = 'pending', format('T6: Status %s statt pending', z.status);
  assert z.attempt_count = 2 and z.last_attempt_at is not null and z.last_error = 'StripeAPIError: 503', format('T6: %s %s %s', z.attempt_count, z.last_attempt_at, z.last_error);
  assert jsonb_array_length(public.referral_rewards_pending_for_referral(v_ref)) = 2, 'T6: Reward aus pending verschwunden';
  assert jsonb_array_length(public.referral_rewards_pending_for(v_a)) = 1, 'T6: Reward nicht mehr fuer Nachholung sichtbar';
  /* langer Fehlertext wird gekuerzt */
  perform public.referral_reward_versuch_notieren(v_rw, repeat('x', 500));
  assert length((select last_error from public.referral_rewards where id = v_rw)) = 300, 'T6: last_error nicht gekuerzt';

  /* T7 — Retry erfolgreich: applied, Fehler weg, Stripe-ID gesetzt */
  assert public.referral_reward_set_status(v_rw, 'applied', 'cbtxn_1'), 'T7: applied false';
  select * into z from public.referral_rewards where id = v_rw;
  assert z.status = 'applied' and z.stripe_object_id = 'cbtxn_1' and z.last_error is null and z.applied_at is not null, 'T7: Zustand nach Erfolg';
  assert jsonb_array_length(public.referral_rewards_pending_for_referral(v_ref)) = 1, 'T7: applied noch pending';

  /* T8 — applied nie erneut: weder set_status noch notieren treffen */
  assert not public.referral_reward_set_status(v_rw, 'applied', 'cbtxn_2'), 'T8: zweites applied true';
  assert not public.referral_reward_versuch_notieren(v_rw, 'spaet'), 'T8: notieren auf applied true';
  select * into z from public.referral_rewards where id = v_rw;
  assert z.stripe_object_id = 'cbtxn_1' and z.attempt_count = 3 and z.last_error is null, 'T8: applied veraendert';

  /* Rechte */
  foreach f in array array['public.referral_reward_versuch_notieren(uuid,text)', 'public.referral_rewards_pending_for_referral(uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  /* Wirkung: authenticated kann keinen Versuch notieren */
  set local role authenticated;
  begin
    perform public.referral_reward_versuch_notieren(v_rw2, 'x');
    raise exception 'Rechte: authenticated konnte notieren';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;
rollback;

select '[wp10-retry] referral_reward_retry: alle Abschnitte bestanden' as ergebnis;
