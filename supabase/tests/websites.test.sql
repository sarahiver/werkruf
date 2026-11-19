-- Websites: je Betrieb eine, Adresse eindeutig, kein direkter Client-Zugriff.
--   scripts/test-db/run.sh websites
\set ON_ERROR_STOP on

begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_loc uuid := test.id('standort_werkruf'); ok boolean;
begin
  insert into public.websites (user_id, location_id, slug) values (v_a, v_loc, 'elektro-krause');

  /* W1 — je Betrieb hoechstens eine Website */
  begin
    insert into public.websites (user_id, location_id, slug) values (v_a, v_loc, 'elektro-krause-2');
    ok := false;
  exception when unique_violation then ok := true; end;
  assert ok, 'W1: zweite Website fuer denselben Betrieb';

  /* W2 — ungueltige Adresse wird abgewiesen */
  begin
    update public.websites set slug = 'Elektro Krause' where location_id = v_loc;
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'W2: Slug mit Leerzeichen/Grossbuchstaben angenommen';
  begin
    update public.websites set slug = 'a--b' where location_id = v_loc;
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'W2: Slug mit doppeltem Bindestrich angenommen';

  /* W3 — Status nur entwurf/veroeffentlicht, hoechstens 12 Leistungen */
  begin
    update public.websites set status = 'live' where location_id = v_loc;
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'W3: unbekannter Status angenommen';
  begin
    update public.websites set leistungen = (select jsonb_agg(jsonb_build_object('name', 'L' || g)) from generate_series(1, 13) g) where location_id = v_loc;
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'W3: 13 Leistungen angenommen';
end $$;
rollback;

/* W4 — Adresse ueber Betriebe hinweg eindeutig */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_loc_b uuid; ok boolean;
begin
  insert into public.websites (user_id, location_id, slug) values (v_a, test.id('standort_werkruf'), 'meister-betrieb');
  select id into v_loc_b from public.google_locations where user_id = v_b limit 1;
  if v_loc_b is null then raise notice 'W4: kein Standort fuer user_b im Testbestand — uebersprungen'; return; end if;
  begin
    insert into public.websites (user_id, location_id, slug) values (v_b, v_loc_b, 'meister-betrieb');
    ok := false;
  exception when unique_violation then ok := true; end;
  assert ok, 'W4: zwei Betriebe mit derselben Adresse';
end $$;
rollback;

/* W5 — Rechte: Client liest und schreibt nie direkt */
do $$
begin
  assert not pg_catalog.has_table_privilege('authenticated', 'public.websites', 'SELECT'), 'W5: authenticated darf lesen';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.websites', 'INSERT'), 'W5: authenticated darf schreiben';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.websites', 'UPDATE'), 'W5: authenticated darf aendern';
  assert not pg_catalog.has_table_privilege('anon', 'public.websites', 'SELECT'), 'W5: anon darf lesen';
  assert (select relrowsecurity from pg_class where oid = 'public.websites'::regclass), 'W5: RLS aus';
end $$;
