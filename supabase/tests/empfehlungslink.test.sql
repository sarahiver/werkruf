-- WP10 — Empfehlungslink: Datenbankseite.
--
--   scripts/test-db/run.sh empfehlungslink
--
--   T1/T3/T36  Code eindeutig, nicht ableitbar, revoke/rotation
--   T6–T10     Zuordnung beim Signup: Referral, kein Referral, first wins,
--              bestehender Nutzer nicht, Selbst-Empfehlung nicht
--   T13–T15    Conversion: nur amount > 0, nur einmal
--   T16–T21    Rewards: genau zwei, FP not_applicable, Free pending,
--              mehrere Referrals getrennt, Statuswechsel nur einmal
--   T32–T35    Rechte: anon nichts, authenticated nur Eigenes (RLS),
--              Schreiben und Code-Anlage nur service_role (Edge Function)
--   Loeschung  Geworbener weg → offenes Referral invalid; Werber weg →
--              Referral bleibt, Reward des Geworbenen bleibt

\set ON_ERROR_STOP on

/* Signup-Nachbildung: auth.users mit raw_user_meta_data, dann Profil
   (loest handle_new_user_referral aus). test.benutzer legt beides an
   ohne Meta — deshalb hier direkt. */
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

create or replace function pg_temp.als(p_user uuid) returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', p_user);
end $$;

/* ═══════════════════════════════════════════════════════
   T1/T3/T36 — Code
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); r jsonb; r2 jsonb; v_alt text;
begin
  r := public.ensure_referral_code(v_a);
  assert (r ->> 'eligible')::boolean, format('T1: Nutzer mit Standort nicht berechtigt: %s', r);
  assert (r ->> 'code') ~ '^[A-Za-z0-9]{10}$', format('T1: Codeform: %s', r);
  /* T2 — nicht ableitbar: enthaelt kein Stueck der User-ID */
  assert position(substr(replace(v_a::text, '-', ''), 1, 6) in (r ->> 'code')) = 0, 'T2: Code traegt User-ID';
  /* stabil */
  r2 := public.ensure_referral_code(v_a);
  assert r2 ->> 'code' = r ->> 'code', 'T1: Code nicht stabil';
  assert (select count(*) from public.referral_codes where user_id = v_a) = 1, 'T1: zwei Codes';

  /* T36 — revoke: alter Code ungueltig, neuer anders */
  v_alt := r ->> 'code';
  assert public.referral_code_gueltig(v_alt), 'Lookup: gueltiger Code false';
  assert public.revoke_referral_code(v_a), 'T36: revoke false';
  assert not public.revoke_referral_code(v_a), 'T36: zweiter revoke true';
  assert not public.referral_code_gueltig(v_alt), 'T3: widerrufener Code gueltig';
  r2 := public.ensure_referral_code(v_a);
  assert r2 ->> 'code' <> v_alt and (r2 ->> 'code') ~ '^[A-Za-z0-9]{10}$', 'T36: kein neuer Code nach revoke';
  assert public.referral_code_gueltig(r2 ->> 'code'), 'T36: neuer Code ungueltig';
  assert not public.referral_code_gueltig('nicht-da-1'), 'Lookup: falscher Code true';
  assert not public.referral_code_gueltig(null), 'Lookup: null true';
end $$;
rollback;

/* Eligibility: ohne Standort kein Code */
begin;
do $$
declare v uuid := pg_temp.signup('ohne_betrieb'); r jsonb;
begin
  r := public.ensure_referral_code(v);
  assert (r ->> 'eligible')::boolean = false and r ->> 'reason' = 'kein_standort', format('Eligibility: %s', r);
  assert (select count(*) from public.referral_codes where user_id = v) = 0, 'Code trotz fehlendem Standort';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T6–T10 — Zuordnung beim Signup
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_a uuid := test.id('user_a'); v_code text; v_neu uuid; v_neu2 uuid; v_neu3 uuid; v_ref public.referrals;
begin
  perform pg_temp.als(v_a);
  v_code := public.ensure_referral_code(v_a) ->> 'code';

  /* T6 */
  v_neu := pg_temp.signup('kollege_1', v_code);
  select * into v_ref from public.referrals where referred_user_id = v_neu;
  assert found and v_ref.referrer_user_id = v_a and v_ref.status = 'signed_up', 'T6: keine Zuordnung';

  /* T7 */
  v_neu2 := pg_temp.signup('ohne_code');
  assert not exists (select 1 from public.referrals where referred_user_id = v_neu2), 'T7: Zuordnung ohne Code';

  /* ungueltiger Code → still nichts */
  v_neu3 := pg_temp.signup('falscher_code', 'ZZZZZZZZZZ');
  assert not exists (select 1 from public.referrals where referred_user_id = v_neu3), 'ungueltiger Code zugeordnet';

  /* T8 — spaeterer anderer Code ueberschreibt nicht (unique referred_user_id) */
  begin
    insert into public.referrals (referrer_user_id, referred_user_id) values (test.id('user_b'), v_neu);
    raise exception 'T8: zweite Zuordnung moeglich';
  exception when unique_violation then null; when foreign_key_violation then null;
  end;
  assert (select referrer_user_id from public.referrals where referred_user_id = v_neu) = v_a, 'T8: Werber geaendert';

  /* T9 — bestehender Nutzer: Trigger laeuft nur bei INSERT des Profils */
  update auth.users set raw_user_meta_data = jsonb_build_object('referral_code', v_code) where id = v_neu2;
  update public.user_profiles set company_name = 'x' where id = v_neu2;
  assert not exists (select 1 from public.referrals where referred_user_id = v_neu2), 'T9: bestehender Nutzer nachtraeglich zugeordnet';

  /* T10 — Selbst-Empfehlung: Constraint und Trigger */
  begin
    insert into public.referrals (referrer_user_id, referred_user_id) values (v_a, v_a);
    raise exception 'T10: Selbst-Referral eingefuegt';
  exception when check_violation then null;
  end;
  /* T10b — ueber den Signup-Pfad: eigener Code im Meta → keine Zuordnung,
     und das Signup selbst darf daran nicht scheitern */
  declare v_self uuid := gen_random_uuid(); v_selfcode text := 'SeLbSt0001';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (v_self, 'selbst@example.test', jsonb_build_object('referral_code', v_selfcode));
    insert into public.referral_codes (user_id, code) values (v_self, v_selfcode);
    insert into public.user_profiles (id, company_name, plan) values (v_self, 'selbst', 'free') on conflict (id) do nothing;
    assert not exists (select 1 from public.referrals where referred_user_id = v_self or referrer_user_id = v_self), 'T10b: Selbst-Referral ueber Signup';
  end;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T13–T21 — Conversion und Rewards
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_a uuid := test.id('user_a'); v_code text; v_k1 uuid; v_k2 uuid; r jsonb; v_rw public.referral_rewards; v_id uuid;
begin
  update public.user_profiles set plan = 'pro', stripe_customer_id = 'cus_a', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  perform pg_temp.als(v_a);
  v_code := public.ensure_referral_code(v_a) ->> 'code';
  v_k1 := pg_temp.signup('kollege_1', v_code);
  v_k2 := pg_temp.signup('kollege_2', v_code);
  update public.user_profiles set stripe_customer_id = 'cus_k1' where id = v_k1;

  /* T11/T15 — 0-€-Rechnung (Trial) → nichts */
  r := public.referral_mark_converted(v_k1, 'in_trial', 0);
  assert (r ->> 'converted')::boolean = false and r ->> 'reason' = 'betrag_null', format('T15: %s', r);
  assert (select status from public.referrals where referred_user_id = v_k1) = 'signed_up', 'T11: Trial konvertiert';
  assert (select count(*) from public.referral_rewards) = 0, 'T11: Rewards ohne Zahlung';

  /* T13/T16 — erste echte Zahlung → converted, genau 2 Rewards */
  r := public.referral_mark_converted(v_k1, 'in_001', 4900);
  assert (r ->> 'converted')::boolean, format('T13: %s', r);
  assert (select status from public.referrals where referred_user_id = v_k1) = 'converted', 'T13: Status';
  assert (select converted_invoice_id from public.referrals where referred_user_id = v_k1) = 'in_001', 'T13: Rechnung';
  assert (select count(*) from public.referral_rewards where referral_id = (r ->> 'referralId')::uuid) = 2, 'T16: nicht genau 2 Rewards';
  assert jsonb_array_length(r -> 'rewards') = 2, 'T16: Rueckgabe';
  /* T19 — Werber Pro → pending (anwendbar), T23 — Betrag = 4900 */
  select * into v_rw from public.referral_rewards where referral_id = (r ->> 'referralId')::uuid and beneficiary = 'referrer';
  assert v_rw.status = 'pending' and v_rw.user_id = v_a and v_rw.amount_cents = 4900, format('T19/T23: %s %s', v_rw.status, v_rw.amount_cents);
  select * into v_rw from public.referral_rewards where referral_id = (r ->> 'referralId')::uuid and beneficiary = 'referred';
  assert v_rw.status = 'pending' and v_rw.user_id = v_k1, 'T16: Reward Geworbener';

  /* T14/T21 — zweite Rechnung / Webhook erneut: nichts Neues */
  r := public.referral_mark_converted(v_k1, 'in_002', 4900);
  assert (r ->> 'converted')::boolean = false and r ->> 'reason' = 'kein_offenes_referral', format('T14: %s', r);
  r := public.referral_mark_converted(v_k1, 'in_001', 4900);
  assert (r ->> 'converted')::boolean = false, 'T21: dasselbe Event erneut konvertiert';
  assert (select count(*) from public.referral_rewards where user_id in (v_a, v_k1)) = 2, 'T21: Rewards verdoppelt';
  /* Unique auf (referral_id, beneficiary) physisch */
  begin
    insert into public.referral_rewards (referral_id, user_id, beneficiary, amount_cents)
    values ((select id from public.referrals where referred_user_id = v_k1), v_a, 'referrer', 4900);
    raise exception 'T21: doppelter Reward einfuegbar';
  exception when unique_violation then null;
  end;

  /* T25 — Statuswechsel nur einmal */
  select id into v_id from public.referral_rewards where user_id = v_a and status = 'pending';
  assert public.referral_reward_set_status(v_id, 'applied', 'cbtxn_1'), 'T25: applied false';
  assert not public.referral_reward_set_status(v_id, 'applied', 'cbtxn_2'), 'T25: zweites applied true';
  assert (select stripe_object_id from public.referral_rewards where id = v_id) = 'cbtxn_1', 'T25: Stripe-ID ueberschrieben';
  assert jsonb_array_length(public.referral_rewards_pending_for(v_a)) = 0, 'pending_for zeigt applied';
  assert jsonb_array_length(public.referral_rewards_pending_for(v_k1)) = 1, 'pending_for Geworbener';

  /* T20 — zweites Referral → eigener Eintrag, Werber hat 2 getrennte */
  r := public.referral_mark_converted(v_k2, 'in_010', 4900);
  assert (r ->> 'converted')::boolean, 'T20';
  assert (select count(*) from public.referral_rewards where user_id = v_a) = 2, 'T20: nicht zwei getrennte Werber-Rewards';
  assert (select count(distinct referral_id) from public.referral_rewards where user_id = v_a) = 2, 'T20: gleiche referral_id';

  /* Zusammenfassung fuer die Einstellungen (Edge Function setzt p_user_id) — nur Zaehler, keine fremden IDs */
  r := public.referral_summary_for(v_a);
  assert (r ->> 'invited')::int = 2 and (r ->> 'converted')::int = 2, format('Summary: %s', r);
  assert r::text !~ (v_k1::text) and r::text !~ (v_k2::text), 'Summary traegt IDs der Geworbenen';
  r := public.referral_summary_for(v_k1);
  assert (r ->> 'invited')::int = 0 and (r ->> 'referredBy')::boolean, format('Summary Geworbener: %s', r);
end $$;
rollback;

/* T17 — Founding Partner als Werber */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_code text; v_k uuid; r jsonb;
begin
  perform public.set_founding_partner(v_a, 'Test');
  perform pg_temp.als(v_a);
  v_code := public.ensure_referral_code(v_a) ->> 'code';
  v_k := pg_temp.signup('kollege_fp', v_code);
  r := public.referral_mark_converted(v_k, 'in_fp', 4900);
  assert (r ->> 'converted')::boolean, 'T17: nicht konvertiert';
  assert (select status from public.referral_rewards where user_id = v_a) = 'not_applicable', 'T17: FP bekam pending/applied';
  assert (select status from public.referral_rewards where user_id = v_k) = 'pending', 'T17: Geworbener ohne Reward';
  assert jsonb_array_length(public.referral_rewards_pending_for(v_a)) = 0, 'T17: FP in pending_for';
end $$;
rollback;

/* T18 — Free-Werber: Reward pending, verfaellt nicht */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_code text; v_k uuid; r jsonb;
begin
  update public.user_profiles set plan = 'free', stripe_subscription_status = 'canceled', stripe_subscription_id = 'sub_alt' where id = v_a;
  perform pg_temp.als(v_a);
  v_code := public.ensure_referral_code(v_a) ->> 'code';
  v_k := pg_temp.signup('kollege_free', v_code);
  r := public.referral_mark_converted(v_k, 'in_free', 4900);
  assert (select status from public.referral_rewards where user_id = v_a) = 'pending', 'T18: Free-Reward nicht pending';
  assert jsonb_array_length(public.referral_rewards_pending_for(v_a)) = 1, 'T18: nicht in pending_for (Nachholung bei Reaktivierung)';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T32–T35 — Rechte
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
select test.fremder();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_code text; v_k uuid; v_n integer; v_ok boolean; f text;
begin
  perform pg_temp.als(v_a);
  v_code := public.ensure_referral_code(v_a) ->> 'code';
  v_k := pg_temp.signup('kollege_r', v_code);
  perform public.referral_mark_converted(v_k, 'in_r', 4900);

  /* Rechte statisch */
  foreach f in array array['public.referral_mark_converted(uuid,text,integer,text)', 'public.referral_rewards_pending_for(uuid)', 'public.referral_reward_set_status(uuid,text,text,text)', 'public.ensure_referral_code(uuid)', 'public.revoke_referral_code(uuid)', 'public.referral_code_gueltig(text)', 'public.referral_summary_for(uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('T33: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('T33: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('service_role darf %s nicht', f);
  end loop;
  assert not pg_catalog.has_table_privilege('anon', 'public.referral_codes', 'SELECT'), 'T32: anon liest Codes';
  assert not pg_catalog.has_table_privilege('anon', 'public.referrals', 'SELECT'), 'C8: anon liest referrals';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.referrals', 'UPDATE'), 'T35: authenticated aendert referrals';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.referral_rewards', 'INSERT'), 'T33: authenticated legt Rewards an';

  /* T34 — Wirkung: user_b sieht nichts von user_a */
  perform pg_temp.als(v_b);
  set local role authenticated;
  select count(*) into v_n from public.referrals; assert v_n = 0, format('T34: Fremder sieht %s Referrals', v_n);
  select count(*) into v_n from public.referral_rewards; assert v_n = 0, format('T34: Fremder sieht %s Rewards', v_n);
  select count(*) into v_n from public.referral_codes; assert v_n = 0, 'T34: Fremder sieht Codes';
  /* T35 — direktes Setzen von referrer_user_id */
  v_ok := false;
  begin update public.referrals set referrer_user_id = v_b; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T35: authenticated konnte referrer_user_id setzen';
  v_ok := false;
  begin perform public.referral_mark_converted(v_k, 'x', 4900); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T33: authenticated konnte konvertieren';
  /* Kanon 20261014120000: Code-Anlage fuer einen FREMDEN Nutzer ist als authenticated unmoeglich */
  v_ok := false;
  begin perform public.ensure_referral_code(v_a); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'Kanon: authenticated konnte ensure_referral_code(uuid) ausfuehren';
  reset role;
  /* Eigentuemer sieht Eigenes */
  perform pg_temp.als(v_a);
  set local role authenticated;
  select count(*) into v_n from public.referrals; assert v_n = 1, 'Werber sieht sein Referral nicht';
  select count(*) into v_n from public.referral_rewards; assert v_n = 1, 'Werber sieht seinen Reward nicht';
  reset role;
  /* anon: gar nichts — der Lookup laeuft ueber die Edge Function (service_role) */
  set local role anon;
  v_ok := false;
  begin perform public.referral_code_gueltig(v_code); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T32: anon konnte referral_code_gueltig ausfuehren (Kanon)';
  v_ok := false;
  begin perform count(*) from public.referral_codes; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T32/C8: anon liest referral_codes';
  reset role;
  set local role service_role;
  assert public.referral_code_gueltig(v_code), 'T32: service_role Lookup false';
  reset role;
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Loeschung
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_code text; v_k1 uuid; v_k2 uuid; r jsonb; v_ref uuid;
begin
  update public.user_profiles set plan = 'pro', stripe_customer_id = 'cus_a', stripe_subscription_status = 'active' where id = v_a;
  perform pg_temp.als(v_a);
  v_code := public.ensure_referral_code(v_a) ->> 'code';
  v_k1 := pg_temp.signup('k_offen', v_code);
  v_k2 := pg_temp.signup('k_konv', v_code);
  r := public.referral_mark_converted(v_k2, 'in_k2', 4900);
  perform public.referral_reward_set_status((select id from public.referral_rewards where user_id = v_a), 'applied', 'cbtxn_a');

  /* Geworbener (offen) geloescht → Referral invalid, nichts kaskadiert */
  delete from auth.users where id = v_k1;
  assert (select status from public.referrals where referral_code_id = (select id from public.referral_codes where user_id = v_a) and referred_user_id is null) = 'invalid', 'Loeschung: offenes Referral nicht invalid';

  /* Geworbener (konvertiert) geloescht → Werber-Reward bleibt applied, Geworbenen-Reward pending → invalid */
  select id into v_ref from public.referrals where converted_invoice_id = 'in_k2';
  delete from auth.users where id = v_k2;
  assert (select status from public.referrals where id = v_ref) = 'converted', 'Loeschung: konvertiertes Referral veraendert';
  assert (select status from public.referral_rewards where referral_id = v_ref and beneficiary = 'referrer') = 'applied', 'Loeschung: verdienter Werber-Reward weg';
  assert (select status from public.referral_rewards where referral_id = v_ref and beneficiary = 'referred') = 'invalid', 'Loeschung: offener Reward des Geloeschten nicht invalid';

  /* Werber geloescht → Referral bleibt (referrer null), Code weg, Rewards bleiben ohne Nutzer */
  delete from auth.users where id = v_a;
  assert (select count(*) from public.referral_codes where user_id = v_a) = 0, 'Loeschung: Code bleibt';
  assert (select referrer_user_id is null and status = 'converted' from public.referrals where id = v_ref), 'Loeschung: Referral-Historie weg';
  assert (select count(*) from public.referral_rewards where referral_id = v_ref) = 2, 'Loeschung: Ledger kaskadiert';
end $$;
rollback;

select '[wp10] empfehlungslink: alle Abschnitte bestanden' as ergebnis;
