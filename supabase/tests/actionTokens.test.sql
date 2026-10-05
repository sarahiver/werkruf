-- Abnahme fuer Action-Tokens (Paket D5).
--
--   psql -f actionTokens.test.sql

\set ON_ERROR_STOP on

begin;

create temporary table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('user',    '11111111-1111-1111-1111-111111111111'),
  ('fremder', '22222222-2222-2222-2222-222222222222'),
  ('si',      '33333333-3333-3333-3333-333333333333'),
  ('werkruf', '44444444-4444-4444-4444-444444444444');

insert into auth.users (id, email) values
  ((select id from t where name='user'), 'iver@example.com'),
  ((select id from t where name='fremder'), 'fremd@example.com');

insert into public.google_locations (id, user_id, title, selected_at) values
  ((select id from t where name='si'),      (select id from t where name='user'), 'S&I.',    now()),
  ((select id from t where name='werkruf'), (select id from t where name='user'), 'WERKRUF', null);

/* Ein Hash sieht aus wie SHA-256-Hex: 64 Zeichen. */
create or replace function pg_temp.hash(p text) returns text
language sql immutable as $$ select encode(sha256(p::bytea), 'hex') $$;

/* ═══════════════════════════════════════════════════════
   1 — Nur der Hash steht in der Tabelle
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_klartext text := 'GeheimerTokenKlartext12345';
begin
  insert into public.events (user_id, location_id, type, category, priority, title, summary)
  values ((select id from t where name='user'), (select id from t where name='si'),
          'profile.photos_missing', 'profile', 29, 'Foto', 'x');

  v := public.create_action_token(
    pg_temp.hash(v_klartext), (select id from t where name='user'),
    'event.open', '/dashboard/fotos',
    (select id from t where name='si'),
    (select id from public.events limit 1));

  assert v ? 'id', 'Token angelegt';

  /* Der Klartext darf nirgends auftauchen — nicht in der Tabelle und
     nicht im Rueckgabewert. */
  assert (select count(*) from public.action_tokens
           where token_hash like '%' || v_klartext || '%') = 0,
    'Der Klartext steht nicht in der Tabelle';
  assert v::text not like '%' || v_klartext || '%',
    'Und nicht im Rueckgabewert';

  assert (select length(token_hash) from public.action_tokens limit 1) = 64,
    'Gespeichert wird ein SHA-256-Hash';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Aufloesen veraendert NICHTS
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_hash text := pg_temp.hash('GeheimerTokenKlartext12345');
begin
  /* Das ist der Kern: Mailscanner oeffnen den Link, oft mehrfach,
     bevor der Empfaenger ihn sieht. Wuerde das verbrauchen, waere der
     Link tot, bevor jemand ihn anklickt. */
  for i in 1..5 loop
    v := public.resolve_action_token(v_hash);
    assert (v ->> 'valid')::boolean, 'Auch beim ' || i || '. Mal gueltig';
  end loop;

  assert (select consumed_at from public.action_tokens where token_hash = v_hash) is null,
    'Fuenfmal aufgeloest, nie verbraucht';
  assert (select use_count from public.action_tokens where token_hash = v_hash) = 0,
    'Und nicht einmal gezaehlt';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Verbrauchen ist eine eigene Handlung
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_hash text := pg_temp.hash('GeheimerTokenKlartext12345');
begin
  v := public.consume_action_token(v_hash);
  assert (v ->> 'valid')::boolean, 'Verbrauchen gelingt';

  assert (select consumed_at from public.action_tokens where token_hash = v_hash) is not null,
    'Jetzt ist er verbraucht';

  /* Aufloesen geht weiterhin — der Besucher soll die Seite sehen
     koennen, auch nachdem er die Handlung ausgefuehrt hat. */
  v := public.resolve_action_token(v_hash);
  assert (v ->> 'valid')::boolean, 'Aufloesen geht weiterhin';
  assert (v ->> 'consumed')::boolean, 'Aber er ist als verbraucht gekennzeichnet';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Ein unbekannter Token wird abgewiesen
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  v := public.resolve_action_token(pg_temp.hash('nie-vergeben'));
  assert not (v ->> 'valid')::boolean, 'Unbekannt';
  assert v ->> 'reason' = 'not_found', 'Mit Grund fuers Protokoll';

  /* Kein Kontext in der Antwort — sonst verriete sie, dass es den
     Token gab. */
  assert v -> 'userId' is null, 'Und ohne Kontext';
  assert v -> 'targetPath' is null, 'Auch ohne Ziel';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Abgelaufen und widerrufen
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_hash text := pg_temp.hash('Abgelaufen-Token-1234567890');
begin
  perform public.create_action_token(
    v_hash, (select id from t where name='user'),
    'dashboard.open', '/dashboard', null, null, '7 days');

  update public.action_tokens set expires_at = now() - interval '1 hour'
   where token_hash = v_hash;

  v := public.resolve_action_token(v_hash);
  assert not (v ->> 'valid')::boolean and v ->> 'reason' = 'expired', 'Abgelaufen';

  /* Widerrufen. */
  update public.action_tokens set expires_at = now() + interval '7 days',
         revoked_at = now() where token_hash = v_hash;

  v := public.resolve_action_token(v_hash);
  assert not (v ->> 'valid')::boolean and v ->> 'reason' = 'revoked', 'Widerrufen';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Ein neuer Token widerruft den alten
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_alt text := pg_temp.hash('AlterToken-abcdefghijklmnop');
        v_neu text := pg_temp.hash('NeuerToken-abcdefghijklmnop');
        v_event uuid;
begin
  select id into v_event from public.events limit 1;

  perform public.create_action_token(v_alt, (select id from t where name='user'),
    'event.open', '/dashboard/fotos', (select id from t where name='si'), v_event);

  v := public.create_action_token(v_neu, (select id from t where name='user'),
    'event.open', '/dashboard/fotos', (select id from t where name='si'), v_event);

  /* Sonst bliebe ein Link aus einer Mail von vor drei Wochen gueltig,
     obwohl laengst ein neuer verschickt wurde. */
  assert (v ->> 'revokedPrevious')::int >= 1, 'Der alte wird widerrufen';
  assert not (public.resolve_action_token(v_alt) ->> 'valid')::boolean,
    'Und ist nicht mehr gueltig';
  assert (public.resolve_action_token(v_neu) ->> 'valid')::boolean,
    'Der neue schon';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Fremde Standorte und Empfehlungen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen boolean := false; v_event uuid;
begin
  select id into v_event from public.events limit 1;

  /* Fremder Nutzer, fremder Standort. */
  begin
    perform public.create_action_token(
      pg_temp.hash('Fremd-Token-aaaaaaaaaaaaaaaaa'),
      (select id from t where name='fremder'),
      'event.open', '/dashboard', (select id from t where name='si'), null);
  exception when insufficient_privilege then v_abgewiesen := true;
  end;
  assert v_abgewiesen, 'Ein fremder Standort wird abgewiesen';

  /* Empfehlung von S&I, Token fuer WERKRUF. */
  v_abgewiesen := false;
  begin
    perform public.create_action_token(
      pg_temp.hash('Falsch-Token-bbbbbbbbbbbbbbbb'),
      (select id from t where name='user'),
      'event.open', '/dashboard', (select id from t where name='werkruf'), v_event);
  exception when insufficient_privilege then v_abgewiesen := true;
  end;
  assert v_abgewiesen, 'Empfehlung und Standort muessen zusammenpassen';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Die Bindung wird bei JEDEM Aufloesen geprueft
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb; v_hash text := pg_temp.hash('Bindung-Token-ccccccccccccc');
begin
  perform public.create_action_token(
    v_hash, (select id from t where name='user'), 'dashboard.open', '/dashboard',
    (select id from t where name='werkruf'), null);

  assert (public.resolve_action_token(v_hash) ->> 'valid')::boolean, 'Zunaechst gueltig';

  /* Der Standort wird geloescht — der Token darf nicht weitergelten. */
  update public.google_locations set deleted_at = now()
   where id = (select id from t where name='werkruf');

  v := public.resolve_action_token(v_hash);
  assert not (v ->> 'valid')::boolean, 'Nach dem Loeschen nicht mehr';
  assert v ->> 'reason' = 'location_mismatch', 'Mit Grund';

  update public.google_locations set deleted_at = null
   where id = (select id from t where name='werkruf');
end $$;

/* ═══════════════════════════════════════════════════════
   9 — Unerlaubte Ziele
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen integer := 0; v_ziel text;
begin
  foreach v_ziel in array array[
    'https://evil.example', '//evil.example', 'javascript:alert(1)',
    '/admin', 'data:text/html,x', ''
  ] loop
    begin
      perform public.create_action_token(
        pg_temp.hash('Ziel-' || v_ziel || '-xxxxxxxxxxxxx'),
        (select id from t where name='user'), 'dashboard.open', v_ziel);
    exception when invalid_parameter_value then v_abgewiesen := v_abgewiesen + 1;
    end;
  end loop;

  assert v_abgewiesen = 6, 'Alle sechs unerlaubten Ziele werden abgewiesen';
end $$;

/* ═══════════════════════════════════════════════════════
   10 — Widerrufen von Hand
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer; v_hash text := pg_temp.hash('Widerruf-Token-ddddddddddd');
begin
  perform public.create_action_token(
    v_hash, (select id from t where name='user'), 'dashboard.open', '/dashboard');

  v_anzahl := public.revoke_action_tokens(
    (select id from t where name='user'), null, 'dashboard.open');

  assert v_anzahl >= 1, 'Tokens werden widerrufen';
  assert not (public.resolve_action_token(v_hash) ->> 'valid')::boolean,
    'Und gelten nicht mehr';
end $$;

/* ═══════════════════════════════════════════════════════
   11 — Zu kurzer Hash wird abgewiesen
   ═══════════════════════════════════════════════════════ */
do $$
declare v_abgewiesen boolean := false; v jsonb;
begin
  begin
    perform public.create_action_token(
      'kurz', (select id from t where name='user'), 'dashboard.open', '/dashboard');
  exception when invalid_parameter_value then v_abgewiesen := true;
  end;
  assert v_abgewiesen, 'Ein zu kurzer Hash wird nicht angenommen';

  v := public.resolve_action_token('kurz');
  assert not (v ->> 'valid')::boolean and v ->> 'reason' = 'malformed',
    'Und beim Aufloesen abgewiesen';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
