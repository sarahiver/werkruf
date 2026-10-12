-- Abnahme fuer den Auth-Uebergabezustand (Paket D6.2).
--
--   psql -v ON_ERROR_STOP=1 -f actionAuthState.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('userA',  test.id('user_a')),
  ('userB',  test.id('user_b')),
  ('si',     test.id('standort_si'));

/* Beide Nutzer mit eigenem Konto — dieser Test lebt vom Unterschied
   zwischen ihnen. Vorspann in scripts/test-db/sql/80-fixtures.sql. */
select test.basis();
select test.fremder();

insert into public.events (id, user_id, location_id, type, category, priority, title, summary)
values ('eeee2222-0000-0000-0000-000000000001',
        (select id from t where name='userA'), (select id from t where name='si'),
        'profile.photos_missing', 'profile', 29, '5 Fotos hochladen', 'x');

create or replace function pg_temp.h(p text) returns text
language sql immutable as $$ select encode(sha256(p::bytea), 'hex') $$;

/* Ein Action-Token fuer Nutzer A. */
do $$
declare v jsonb;
begin
  v := public.create_action_token(
    pg_temp.h('TokenFuerNutzerA-abcdefghijk'),
    (select id from t where name='userA'),
    'event.open', '/dashboard/fotos',
    (select id from t where name='si'),
    'eeee2222-0000-0000-0000-000000000001');

  insert into public.action_auth_states (state_hash, token_id, user_id, expires_at)
  values (pg_temp.h('StateFuerNutzerA-abcdefghijk'),
          (v ->> 'id')::uuid, (select id from t where name='userA'),
          now() + interval '10 minutes');
end $$;

/* ═══════════════════════════════════════════════════════
   A — Richtige Sitzung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.consume_action_auth_state(
    pg_temp.h('StateFuerNutzerA-abcdefghijk'), (select id from t where name='userA'));

  assert (v ->> 'valid')::boolean, 'A: Nutzer A kommt durch';
  assert v ->> 'targetPath' = '/dashboard/fotos', 'A: mit dem richtigen Ziel';
  assert (v ->> 'locationId')::uuid = (select id from t where name='si'),
    'A: und dem richtigen Betrieb';
end $$;

/* ═══════════════════════════════════════════════════════
   B — Falsche Sitzung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_id uuid;
begin
  /* Ein neuer Zustand — der erste ist verbraucht. */
  select id into v_id from public.action_tokens
   where user_id = (select id from t where name='userA') limit 1;

  insert into public.action_auth_states (state_hash, token_id, user_id, expires_at)
  values (pg_temp.h('StateZwei-abcdefghijklmnop'), v_id,
          (select id from t where name='userA'), now() + interval '10 minutes');

  /* Nutzer B ist im Browser angemeldet, der Link gehoert A. */
  v := public.consume_action_auth_state(
    pg_temp.h('StateZwei-abcdefghijklmnop'), (select id from t where name='userB'));

  assert not (v ->> 'valid')::boolean, 'B: Nutzer B kommt nicht durch';
  assert v ->> 'reason' = 'user_mismatch', 'B: mit eigenem Grund';

  /* Nichts ueber A darf durchsickern. */
  assert v -> 'targetPath' is null, 'B: kein Ziel';
  assert v -> 'locationId' is null, 'B: kein Betrieb';
  assert v -> 'eventId' is null,    'B: keine Empfehlung';
  assert v -> 'userId' is null,     'B: und keine Kennung';
end $$;

/* ═══════════════════════════════════════════════════════
   C — Ein abgewiesener Versuch verbraucht nichts
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  /* Nach dem gescheiterten Versuch von B muss A noch durchkommen —
     sonst zerstoerte ein falscher Browser den Link. */
  v := public.consume_action_auth_state(
    pg_temp.h('StateZwei-abcdefghijklmnop'), (select id from t where name='userA'));

  assert (v ->> 'valid')::boolean, 'C: A kommt danach noch durch';
end $$;

/* ═══════════════════════════════════════════════════════
   D — Einmalig
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.consume_action_auth_state(
    pg_temp.h('StateZwei-abcdefghijklmnop'), (select id from t where name='userA'));

  assert not (v ->> 'valid')::boolean, 'D: ein zweites Mal nicht';
  assert v ->> 'reason' = 'already_used', 'D: mit Grund';
end $$;

/* ═══════════════════════════════════════════════════════
   E — Abgelaufen
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_id uuid;
begin
  select id into v_id from public.action_tokens limit 1;

  insert into public.action_auth_states (state_hash, token_id, user_id, expires_at)
  values (pg_temp.h('StateAlt-abcdefghijklmnopq'), v_id,
          (select id from t where name='userA'), now() - interval '1 minute');

  v := public.consume_action_auth_state(
    pg_temp.h('StateAlt-abcdefghijklmnopq'), (select id from t where name='userA'));

  assert not (v ->> 'valid')::boolean and v ->> 'reason' = 'expired', 'E: abgelaufen';
end $$;

/* ═══════════════════════════════════════════════════════
   F — Der Token wird erneut geprueft
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_id uuid;
begin
  select id into v_id from public.action_tokens limit 1;

  insert into public.action_auth_states (state_hash, token_id, user_id, expires_at)
  values (pg_temp.h('StateDrei-abcdefghijklmnop'), v_id,
          (select id from t where name='userA'), now() + interval '10 minutes');

  /* Der Token wird zwischen Continue und Anmeldung widerrufen. */
  update public.action_tokens set revoked_at = now() where id = v_id;

  v := public.consume_action_auth_state(
    pg_temp.h('StateDrei-abcdefghijklmnop'), (select id from t where name='userA'));

  /* Der Zustand sagt nur, WELCHER Token gemeint war — nicht, dass er
     noch gilt. */
  assert not (v ->> 'valid')::boolean, 'F: ein widerrufener Token kommt nicht durch';
  assert v ->> 'reason' = 'revoked', 'F: mit dem Grund des Tokens';

  update public.action_tokens set revoked_at = null where id = v_id;
end $$;

/* ═══════════════════════════════════════════════════════
   G — Unbekannter Zustand
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.consume_action_auth_state(
    pg_temp.h('NieVergeben-abcdefghijklmn'), (select id from t where name='userA'));

  assert not (v ->> 'valid')::boolean and v ->> 'reason' = 'not_found', 'G: unbekannt';
end $$;

/* ═══════════════════════════════════════════════════════
   H — Ein Zustand fuer einen fremden Token
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen boolean := false; v_id uuid;
begin
  select id into v_id from public.action_tokens limit 1;

  begin
    perform public.create_action_auth_state(
      pg_temp.h('StateFremd-abcdefghijklmno'), v_id,
      (select id from t where name='userB'));
  exception when insufficient_privilege then v_abgewiesen := true;
  end;

  assert v_abgewiesen,
    'H: ein Zustand laesst sich nicht fuer einen fremden Token anlegen';
end $$;

/* ═══════════════════════════════════════════════════════
   I — Aufraeumen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  update public.action_auth_states set expires_at = now() - interval '3 days';
  v_anzahl := public.cleanup_action_auth_states('1 day');

  assert v_anzahl >= 1, 'I: Abgelaufenes wird entfernt';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
