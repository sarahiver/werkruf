-- Abnahme: onboarding_completed_at (WP2, 23.10.2026)
--
--   scripts/test-db/run.sh onboardingAbschluss
--
-- Gemessen wird: Ein neues Profil beginnt offen. Die erste
-- erfolgreiche Betriebsauswahl — ueber JEDEN der drei Wege — schliesst
-- ab. Eine fehlgeschlagene Auswahl (fremder Betrieb) schliesst NICHT
-- ab. Ein zweiter Wechsel verschiebt den Zeitpunkt nicht. Der
-- Nachbar bleibt unberuehrt.

begin;

/* Produktionsfassung von auth.uid(): liest request.jwt.claims, wie
   PostgREST sie setzt. Transaktionslokal, rollt mit zurueck. */
create or replace function auth.uid()
returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

insert into test.bezeichner (name, id) values ('standort_b', '99999999-0000-0000-0000-00000000000c')
  on conflict (name) do update set id = excluded.id;
select test.basis();      -- user_a, konto_a, standort_si (primary), standort_werkruf
select test.fremder();    -- user_b, konto_b
select test.standort('standort_b', 'user_b', 'konto_b', null, true);

/* Die Fixtures setzen selected_at nicht; is_primary ja. Fuer den Test
   zaehlt selected_at — also sauber auf "nichts gewaehlt". */
update public.google_locations set selected_at = null where user_id in (test.id('user_a'), test.id('user_b'));
update public.user_profiles set onboarding_completed_at = null where id in (test.id('user_a'), test.id('user_b'));

do $$
declare
  v_a   uuid := test.id('user_a');
  v_b   uuid := test.id('user_b');
  v_si  uuid := test.id('standort_si');
  v_wr  uuid := test.id('standort_werkruf');
  v_sb  uuid := test.id('standort_b');
  v_ok  boolean;
  v_t1  timestamptz;
  v_t2  timestamptz;
  v_auto uuid;
begin
  /* A — offen zu Beginn */
  if (select onboarding_completed_at from public.user_profiles where id = v_a) is not null then
    raise exception 'A: neues Profil gilt schon als fertig';
  end if;
  raise notice 'A: neues Profil ist offen';

  /* B — GEGENPROBE: fremder Betrieb schliesst nicht ab */
  v_ok := public.select_google_location(v_sb, v_a);
  if v_ok then raise exception 'B: fremder Betrieb wurde ausgewaehlt'; end if;
  if (select onboarding_completed_at from public.user_profiles where id = v_a) is not null then
    raise exception 'B: fehlgeschlagene Auswahl hat abgeschlossen';
  end if;
  raise notice 'B: fehlgeschlagene Auswahl schliesst nicht ab';

  /* C — Auswahl per Klick (mehrere Betriebe) schliesst ab */
  v_ok := public.select_google_location(v_si, v_a);
  if not v_ok then raise exception 'C: eigene Auswahl fehlgeschlagen'; end if;
  select onboarding_completed_at into v_t1 from public.user_profiles where id = v_a;
  if v_t1 is null then raise exception 'C: Auswahl hat nicht abgeschlossen'; end if;
  raise notice 'C: erste Auswahl schliesst ab';

  /* D — Wechsel verschiebt den Zeitpunkt nicht */
  perform pg_sleep(0.01);
  v_ok := public.select_google_location(v_wr, v_a);
  select onboarding_completed_at into v_t2 from public.user_profiles where id = v_a;
  if v_t2 <> v_t1 then raise exception 'D: Abschlusszeitpunkt wurde verschoben (% → %)', v_t1, v_t2; end if;
  raise notice 'D: Zeitpunkt bleibt beim Wechsel';

  /* E — GEGENPROBE: Nachbar unberuehrt */
  if (select onboarding_completed_at from public.user_profiles where id = v_b) is not null then
    raise exception 'E: Nachbar wurde abgeschlossen';
  end if;
  raise notice 'E: Nachbar bleibt offen';

  /* F — Auto-Auswahl bei genau einem Betrieb schliesst ab (user_b) */
  v_auto := public.auto_select_single_location(v_b);
  if v_auto is distinct from v_sb then raise exception 'F: Auto-Auswahl lieferte %', v_auto; end if;
  if (select onboarding_completed_at from public.user_profiles where id = v_b) is null then
    raise exception 'F: Auto-Auswahl hat nicht abgeschlossen';
  end if;
  raise notice 'F: Auto-Auswahl schliesst ab';

  /* G — Spalte fuer den Eigentuemer lesbar (das Frontend liest das Profil) */
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('role', 'authenticated', true);
  if (select onboarding_completed_at from public.user_profiles where id = v_a) is null then
    raise exception 'G: Eigentuemer sieht seinen Abschluss nicht';
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'G: Eigentuemer liest die Spalte';
end $$;

rollback;
