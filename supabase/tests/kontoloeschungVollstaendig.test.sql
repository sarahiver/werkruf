-- Abnahme: Kontoloeschung hinterlaesst KEINE nutzerbezogenen Daten (WP1, 22.10.2026)
--
--   scripts/test-db/run.sh kontoloeschungVollstaendig
--
-- ═══════════════════════════════════════════════════════════════
-- WAS GEMESSEN WIRD — UND WARUM GENERISCH
-- ═══════════════════════════════════════════════════════════════
--
-- kontoloeschung.test.sql prueft die enge Ausnahme und die zwei
-- bekannten Tabellen. Hier geht es um die Frage dahinter: Bleibt
-- IRGENDWO etwas vom Nutzer stehen? Deshalb nicht eine Liste
-- bekannter Tabellen (die veraltet mit der naechsten Migration),
-- sondern ein Durchlauf ueber information_schema: Jede Spalte in
-- public, die auf auth.users zeigt oder user_id/profile_id/owner_id
-- heisst, wird nach der geloeschten ID durchsucht.
--
-- Fixture ist der volle Betrieb: Nutzer, Google-Konto, zwei
-- Standorte, Bewertungen, Supportanfrage, Mail in der Queue,
-- Audit-Zeile, Empfehlungsereignis. So nah an Produktion, wie die
-- Testdatenbank es hergibt.
--
-- Gegenprobe: ein zweiter Nutzer mit denselben Datenarten bleibt
-- vollstaendig erhalten — Zeile fuer Zeile gezaehlt, vorher/nachher.

begin;

insert into test.bezeichner (name, id) values ('standort_b', '99999999-0000-0000-0000-00000000000b')
  on conflict (name) do update set id = excluded.id;

select test.basis();                      -- user_a mit Konto + 2 Standorten
select test.fremder();                    -- user_b mit Konto
select test.standort('standort_b', 'user_b', 'konto_b', null, true);
select test.bewertungen('standort_si', 3);
select test.bewertungen('standort_b', 2);

update public.user_profiles set plan = 'founding_partner' where id in (test.id('user_a'), test.id('user_b'));

insert into public.support_requests (user_id, subject, body)
values (test.id('user_a'), 'Frage A', 'Eine Frage des zu loeschenden Nutzers.'),
       (test.id('user_b'), 'Frage B', 'Eine Frage des bleibenden Nutzers.');

insert into public.audit_logs (user_id, action, ip_address, user_agent)
values (test.id('user_a'), 'test.a', '203.0.113.7'::inet, 'UA-A'),
       (test.id('user_b'), 'test.b', '198.51.100.9'::inet, 'UA-B');

insert into public.events (id, user_id, type, category, priority, title, summary)
values ('eeeeeeee-1111-0000-0000-00000000000a', test.id('user_a'), 'reviews.none_yet', 'reviews', 50, 'A', 'A'),
       ('eeeeeeee-1111-0000-0000-00000000000b', test.id('user_b'), 'reviews.none_yet', 'reviews', 50, 'B', 'B');
insert into public.recommendation_events (event_id, user_id, action)
values ('eeeeeeee-1111-0000-0000-00000000000a', test.id('user_a'), 'created'),
       ('eeeeeeee-1111-0000-0000-00000000000b', test.id('user_b'), 'created');

/* Abschiedsmail-Fall: eine Mail, die VOR der Loeschung eingereiht
   wurde, soll ueberleben (user_id null, Adresse bleibt). */
select public.enqueue_email('welcome', 'user_a@example.test', 'test:abschied', null, 'A', '{}'::jsonb);

do $$
declare
  v_a        uuid := test.id('user_a');
  v_b        uuid := test.id('user_b');
  v_spalte   record;
  v_anzahl   bigint;
  v_funde    text[] := '{}';
  v_b_vorher jsonb := '{}'::jsonb;
  v_b_nachher jsonb := '{}'::jsonb;
  v_sql      text;
begin
  /* ─────────────────────────────────────────────────────────────
     A — Bestand des bleibenden Nutzers festhalten (je Spalte)
     ───────────────────────────────────────────────────────────── */
  for v_spalte in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type = 'uuid'
       and (c.column_name in ('user_id', 'profile_id', 'owner_id')
            or (c.table_name = 'user_profiles' and c.column_name = 'id'))
  loop
    v_sql := format('select count(*) from public.%I where %I = $1', v_spalte.table_name, v_spalte.column_name);
    execute v_sql into v_anzahl using v_b;
    v_b_vorher := v_b_vorher || jsonb_build_object(v_spalte.table_name || '.' || v_spalte.column_name, v_anzahl);
  end loop;
  raise notice 'A: Bestand von user_b in % Spalten festgehalten', (select count(*) from jsonb_object_keys(v_b_vorher));

  /* ─────────────────────────────────────────────────────────────
     B — Loeschung (so wie auth.admin.deleteUser sie ausloest)
     ───────────────────────────────────────────────────────────── */
  delete from auth.users where id = v_a;
  if exists (select 1 from auth.users where id = v_a) then
    raise exception 'B: Nutzer nicht geloescht';
  end if;
  raise notice 'B: Loeschung durchgelaufen';

  /* ─────────────────────────────────────────────────────────────
     C — Kein Rest in irgendeiner nutzerbezogenen Spalte
     ───────────────────────────────────────────────────────────── */
  for v_spalte in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type = 'uuid'
       and (c.column_name in ('user_id', 'profile_id', 'owner_id')
            or (c.table_name = 'user_profiles' and c.column_name = 'id'))
  loop
    v_sql := format('select count(*) from public.%I where %I = $1', v_spalte.table_name, v_spalte.column_name);
    execute v_sql into v_anzahl using v_a;
    if v_anzahl > 0 then
      v_funde := v_funde || format('%s.%s (%s)', v_spalte.table_name, v_spalte.column_name, v_anzahl);
    end if;
  end loop;
  if cardinality(v_funde) > 0 then
    raise exception 'C: Reste des geloeschten Nutzers: %', array_to_string(v_funde, ', ');
  end if;
  raise notice 'C: keine Zeile verweist mehr auf den geloeschten Nutzer';

  /* ─────────────────────────────────────────────────────────────
     D — Was BLEIBEN soll: Audit entpersonalisiert, Mail ueberlebt
     ───────────────────────────────────────────────────────────── */
  if not exists (select 1 from public.audit_logs where action = 'test.a' and user_id is null
                    and ip_address is null and user_agent is null) then
    raise exception 'D: Audit-Zeile fehlt oder traegt noch Personenbezug';
  end if;
  if not exists (select 1 from public.email_queue where dedupe_key = 'test:abschied'
                    and to_email = 'user_a@example.test') then
    raise exception 'D: vor der Loeschung eingereihte Mail hat die Loeschung nicht ueberlebt';
  end if;
  raise notice 'D: Audit bleibt ohne Personenbezug, eingereihte Mail bleibt';

  /* ─────────────────────────────────────────────────────────────
     E — GEGENPROBE: user_b Zeile fuer Zeile unveraendert
     ───────────────────────────────────────────────────────────── */
  for v_spalte in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type = 'uuid'
       and (c.column_name in ('user_id', 'profile_id', 'owner_id')
            or (c.table_name = 'user_profiles' and c.column_name = 'id'))
  loop
    v_sql := format('select count(*) from public.%I where %I = $1', v_spalte.table_name, v_spalte.column_name);
    execute v_sql into v_anzahl using v_b;
    v_b_nachher := v_b_nachher || jsonb_build_object(v_spalte.table_name || '.' || v_spalte.column_name, v_anzahl);
  end loop;
  if v_b_vorher <> v_b_nachher then
    raise exception 'E: user_b veraendert. vorher % / nachher %', v_b_vorher, v_b_nachher;
  end if;
  if not exists (select 1 from public.audit_logs where action = 'test.b'
                    and user_id = v_b and ip_address is not null) then
    raise exception 'E: Audit-Zeile von user_b wurde mit entpersonalisiert';
  end if;
  if (select count(*) from public.google_reviews r join public.google_locations l on l.id = r.location_id
       where l.user_id = v_b) <> 2 then
    raise exception 'E: Bewertungen von user_b nicht mehr vollstaendig';
  end if;
  raise notice 'E: user_b unveraendert (% Spalten verglichen)', (select count(*) from jsonb_object_keys(v_b_nachher));

  /* ─────────────────────────────────────────────────────────────
     F — append-only greift sofort wieder
     ─────────────────────────────────────────────────────────────
     Innerhalb DERSELBEN Transaktion ist die Markierung noch gesetzt
     (transaktionslokal, bekannte und dokumentierte Grenze aus
     20261019130000). In Produktion ist deleteUser eine eigene
     Transaktion. Hier wie in kontoloeschung.test.sql Pruefung 11:
     Markierung zuruecknehmen, dann messen. Dass sie die Transaktion
     nicht ueberlebt, prueft dort Pruefung 12. */
  perform set_config('werkruf.konto_loeschung', '', true);
  begin
    update public.audit_logs set action = 'manipuliert' where action = 'test.b';
    raise exception 'F: audit_logs nach der Loeschung aenderbar';
  exception when restrict_violation then null;
  end;
  raise notice 'F: append-only wieder aktiv';
end $$;

rollback;
