-- WP14 — SMS-Bewertungsanfrage: Datenbankseite.
--
--   scripts/test-db/run.sh sms_bewertungsanfrage
--
--   T1–T3     Pro ja, FP ja, Free nein (review_sms_pruefen)
--   T4/T5     eigener Standort ja, fremder Standort nein (review_sms_anlegen)
--   T18–T21   Rate-Limit 5/10 min, 30/Tag; anderer Account unberuehrt
--   T22–T25   Dedupe 24 h account-weit; andere Nummer ok; failed darf erneut
--   T29–T33   Lifecycle queued → sent → delivered | failed; Webhook idempotent,
--             nur bekannte Message-ID; Status nur vorwaerts
--   Rechte    service_role only; authenticated liest nur Eigenes
--   Loeschung user weg → Zeilen weg; Standort weg → location_id null

\set ON_ERROR_STOP on

create or replace function pg_temp.hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;
create or replace function pg_temp.als(p_user uuid) returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', p_user);
end $$;

/* ═══ T1–T5 — Zugang und Besitz ═══ */
begin;
select test.basis();
select test.fremder();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_si uuid := test.id('standort_si'); v_fremd uuid; r jsonb; v_id uuid; v_ok boolean;
begin
  /* test.basis() legt standort_werkruf bereits fuer user_a an — der fremde Standort muss eigens her */
  v_fremd := gen_random_uuid();
  insert into public.google_locations (id, user_id, account_id, account_resource_name, location_resource_name, title, selected_at)
  values (v_fremd, v_b, test.id('konto_b'), 'accounts/fremd', 'locations/fremd', 'Fremder Betrieb', now());
  /* T1 — Pro */
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_a', stripe_subscription_status = 'active' where id = v_a;
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491711111111'));
  assert (r ->> 'ok')::boolean, format('T1: Pro abgelehnt: %s', r);
  /* T2 — FP */
  perform public.set_founding_partner(v_b, 'Test');
  r := public.review_sms_pruefen(v_b, pg_temp.hash('+491711111111'));
  assert (r ->> 'ok')::boolean, format('T2: FP abgelehnt: %s', r);
  /* T3 — Free */
  update public.user_profiles set plan = 'free', stripe_subscription_status = 'canceled' where id = v_a;
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491711111111'));
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'kein_zugang', format('T3: Free erlaubt: %s', r);
  update public.user_profiles set plan = 'pro', stripe_subscription_status = 'active' where id = v_a;

  /* T4 — eigener Standort */
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491711111111'), 2);
  assert v_id is not null and (select status from public.review_sms_requests where id = v_id) = 'queued', 'T4: nicht angelegt';
  /* T5 — fremder Standort */
  v_ok := false;
  begin perform public.review_sms_anlegen(v_a, v_fremd, pg_temp.hash('+491711111111'), 1); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T5: fremder Standort angenommen';
  assert (select count(*) from public.review_sms_requests where user_id = v_a) = 1, 'T5: Zeile trotzdem da';
  /* Hash-Form erzwungen */
  v_ok := false;
  begin perform public.review_sms_anlegen(v_a, v_si, '+491711111111', 1); exception when check_violation then v_ok := true; end;
  assert v_ok, 'Klartext-Nummer als Hash akzeptiert';
end $$;
rollback;

/* ═══ T18–T25 — Rate-Limit und Dedupe ═══ */
begin;
select test.basis();
select test.fremder();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_si uuid := test.id('standort_si'); r jsonb; v_id uuid; v_zwei uuid; i integer;
  v_now timestamptz := now();
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_x', stripe_subscription_status = 'active' where id in (v_a, v_b);

  /* T18 — unter Limit */
  for i in 1..4 loop
    v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+4917100000' || i::text), 1);
    perform public.review_sms_status_setzen(v_id, 'sent', 'msg-' || i::text, null);
  end loop;
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491710000099'), v_now);
  assert (r ->> 'ok')::boolean and (r ->> 'kurz')::int = 4, format('T18: %s', r);
  /* T19 — fuenfter Versuch angelegt → sechster blockiert (Kurzzeit) */
  perform public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491710000005'), 1);
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491710000099'), v_now);
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'limit_kurz', format('T19: %s', r);
  /* nach 11 Minuten wieder frei (Kurzfenster), Tageslimit noch nicht */
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491710000099'), v_now + interval '11 minutes');
  assert (r ->> 'ok')::boolean, format('T19b: Kurzfenster nicht verstrichen: %s', r);
  /* T21 — anderer Account unberuehrt */
  r := public.review_sms_pruefen(v_b, pg_temp.hash('+491710000099'), v_now);
  assert (r ->> 'ok')::boolean and (r ->> 'kurz')::int = 0, format('T21: %s', r);

  /* T20 — Tageslimit: 30 Versuche verteilt ueber den Tag */
  delete from public.review_sms_requests where user_id = v_a;
  for i in 1..30 loop
    insert into public.review_sms_requests (user_id, location_id, phone_hash, status, created_at)
    values (v_a, v_si, pg_temp.hash('+4917200000' || lpad(i::text, 2, '0')), 'sent', v_now - (i || ' minutes')::interval * 40);
  end loop;
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491710000099'), v_now);
  assert (r ->> 'ok')::boolean = false and r ->> 'reason' = 'limit_tag', format('T20: %s', r);
  /* fehlgeschlagene Versuche zaehlen fuers Limit mit (Missbrauchsschutz) */
  update public.review_sms_requests set status = 'failed' where user_id = v_a;
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491710000099'), v_now);
  assert r ->> 'reason' = 'limit_tag', 'T20b: failed zaehlt nicht fuers Limit';

  /* T22–T25 — Dedupe */
  delete from public.review_sms_requests where user_id = v_a;
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491711234567'), 1);
  perform public.review_sms_status_setzen(v_id, 'sent', 'msg-d1', null);
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491711234567'), v_now);
  assert r ->> 'reason' = 'doppelt', format('T22: gleiche Nummer <24h erlaubt: %s', r);
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491719999999'), v_now);
  assert (r ->> 'ok')::boolean, format('T23: andere Nummer blockiert: %s', r);
  /* T24 — account-weit: zweiter Standort desselben Accounts, gleiche Nummer → blockiert */
  v_zwei := test.standort('standort_werkruf', 'user_a', 'konto_a', 'Zweiter Betrieb', false);
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491711234567'), v_now);
  assert r ->> 'reason' = 'doppelt', 'T24: zweiter Standort umgeht Dedupe';
  /* Nachbar-Account mit derselben Nummer ist ein anderer Betrieb → erlaubt */
  r := public.review_sms_pruefen(v_b, pg_temp.hash('+491711234567'), v_now);
  assert (r ->> 'ok')::boolean, 'T24b: Dedupe wirkt ueber Accounts hinweg';
  /* nach 24 h wieder erlaubt */
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491711234567'), v_now + interval '25 hours');
  assert (r ->> 'ok')::boolean, 'T22b: Dedupe laeuft nicht ab';
  /* T25 — failed darf erneut */
  delete from public.review_sms_requests where user_id = v_a;
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491711234567'), 1);
  perform public.review_sms_status_setzen(v_id, 'failed', null, 'brevo_503');
  r := public.review_sms_pruefen(v_a, pg_temp.hash('+491711234567'), v_now);
  assert (r ->> 'ok')::boolean, format('T25: nach failed blockiert: %s', r);
end $$;
rollback;

/* ═══ T29–T35 — Lifecycle und Webhook ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si'); v_id uuid; r jsonb; z public.review_sms_requests; v_ok boolean;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_status = 'active' where id = v_a;
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491711234567'), 2);
  /* T29/T32 — sent + Message-ID */
  assert public.review_sms_status_setzen(v_id, 'sent', 'brevo-123', null), 'T29: sent false';
  select * into z from public.review_sms_requests where id = v_id;
  assert z.status = 'sent' and z.provider_message_id = 'brevo-123' and z.sent_at is not null and z.segment_count = 2, 'T29/T32';
  /* Status nur aus queued: zweites setzen aendert nichts */
  assert not public.review_sms_status_setzen(v_id, 'failed', null, 'x'), 'Status aus sent veraendert';
  /* T33 — delivered via Webhook; T35 — Wiederholung idempotent */
  r := public.review_sms_delivery('brevo-123', 'delivered');
  assert (r ->> 'known')::boolean and (r ->> 'changed')::boolean and r ->> 'status' = 'delivered', format('T33: %s', r);
  r := public.review_sms_delivery('brevo-123', 'delivered');
  assert (r ->> 'known')::boolean and (r ->> 'changed')::boolean = false, format('T35: nicht idempotent: %s', r);
  /* failed nach delivered: nicht rueckwaerts */
  r := public.review_sms_delivery('brevo-123', 'failed', 'hard_bounce');
  assert (r ->> 'changed')::boolean = false and (select status from public.review_sms_requests where id = v_id) = 'delivered', 'Lifecycle rueckwaerts';
  /* unbekannte Message-ID */
  r := public.review_sms_delivery('unbekannt-999', 'delivered');
  assert (r ->> 'known')::boolean = false and (r ->> 'changed')::boolean = false, 'unbekannte ID verarbeitet';
  /* T30 — Provider-Fehler */
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491719999999'), 1);
  assert public.review_sms_status_setzen(v_id, 'failed', null, 'brevo_429'), 'T30';
  select * into z from public.review_sms_requests where id = v_id;
  assert z.status = 'failed' and z.error_code = 'brevo_429' and z.failed_at is not null and z.provider_message_id is null, 'T30: Zustand';
  /* Message-ID eindeutig */
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491718888888'), 1);
  v_ok := false;
  begin perform public.review_sms_status_setzen(v_id, 'sent', 'brevo-123', null); exception when unique_violation then v_ok := true; end;
  assert v_ok, 'doppelte provider_message_id akzeptiert';
end $$;
rollback;

/* ═══ Rechte ═══ */
begin;
select test.basis();
select test.fremder();
do $$
declare f text; v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_si uuid := test.id('standort_si'); v_n integer; v_ok boolean;
begin
  foreach f in array array['public.review_sms_pruefen(uuid,text,timestamptz)', 'public.review_sms_anlegen(uuid,uuid,text,integer)',
                           'public.review_sms_status_setzen(uuid,text,text,text)', 'public.review_sms_delivery(text,text,text)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  update public.user_profiles set plan = 'pro', stripe_subscription_status = 'active' where id = v_a;
  perform public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491711234567'), 1);
  /* authenticated: nur eigene Zeilen, keine Writes */
  perform pg_temp.als(v_b);
  set local role authenticated;
  select count(*) into v_n from public.review_sms_requests; assert v_n = 0, format('RLS: Fremder sieht %s', v_n);
  v_ok := false;
  begin insert into public.review_sms_requests (user_id, location_id, phone_hash) values (v_b, v_si, pg_temp.hash('x')); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'RLS: authenticated konnte einfuegen';
  reset role;
  perform pg_temp.als(v_a);
  set local role authenticated;
  select count(*) into v_n from public.review_sms_requests; assert v_n = 1, 'RLS: Eigentuemer sieht Eigenes nicht';
  reset role;
  set local role anon;
  v_ok := false;
  begin perform count(*) from public.review_sms_requests; exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'anon liest review_sms_requests';
  reset role;
end $$;
rollback;

/* ═══ Loeschung ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_si uuid := test.id('standort_si'); v_id uuid;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_status = 'active' where id = v_a;
  v_id := public.review_sms_anlegen(v_a, v_si, pg_temp.hash('+491711234567'), 1);
  /* Standort geloescht → Historie bleibt ohne Betriebsbezug */
  delete from public.google_locations where id = v_si;
  assert (select location_id from public.review_sms_requests where id = v_id) is null, 'Loeschung: location_id nicht null';
  /* Konto geloescht → keine Waisen */
  delete from auth.users where id = v_a;
  assert (select count(*) from public.review_sms_requests where id = v_id) = 0, 'Loeschung: Waisen';
end $$;
rollback;

select '[wp14] sms_bewertungsanfrage: alle Abschnitte bestanden' as ergebnis;
