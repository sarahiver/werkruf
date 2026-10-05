-- 20261005210000_action_auth_state.sql
--
-- Der Uebergabezustand zwischen Mail-Link und Anmeldung.
--
-- DAS PROBLEM
--
-- Nach dem Continue-POST schickt Supabase den Besucher ueber einen
-- Anmeldelink zurueck in die Anwendung. Dabei geht verloren, worum es
-- ging: welcher Nutzer, welcher Betrieb, welche Empfehlung.
--
-- Den rohen Action-Token mitzuschicken waere der naheliegende Weg und
-- der falsche: Er stuende dann in der Adresszeile, im Verlauf, im
-- Referer und womoeglich in einem Protokoll — ein Geheimnis, das
-- eine Woche gilt.
--
-- Stattdessen ein eigener, kurzlebiger Zustand:
--
--   gilt zehn Minuten statt sieben Tage
--   gilt einmal statt beliebig oft
--   verweist auf den Token, enthaelt ihn nicht
--
-- WARUM NICHT DER TOKEN SELBST EINMALIG WIRD
--
-- Ein gescheiterter Anmeldeversuch soll den Mail-Link nicht zerstoeren.
-- Der Kunde klickt erneut, und es funktioniert. Der Uebergabezustand
-- dagegen darf einmalig sein: Er entsteht bei jedem Continue neu.
--
-- WAS DER ZUSTAND NICHT ENTSCHEIDET
--
-- Er sagt nur, WELCHER Token gemeint war. Ob der noch gilt, wem er
-- gehoert, ob die Empfehlung noch offen ist — all das wird nach der
-- Anmeldung erneut gegen den Token geprueft. Der Zustand ist ein
-- Verweis, keine Vollmacht.
--
-- Wiederholbar. Legt keine Daten an.

begin;

create table if not exists public.action_auth_states (
  id          uuid primary key default gen_random_uuid(),

  /* Wie beim Action-Token: nur der Hash. Der Klartext steht in der
     Adresse, die Supabase zurueckgibt. */
  state_hash  text not null,

  /* Der Token, um den es geht. Die Quelle der Wahrheit bleibt dort. */
  token_id    uuid not null references public.action_tokens(id) on delete cascade,

  /* Zum Abgleich mit der Sitzung nach der Anmeldung. */
  user_id     uuid not null references auth.users(id) on delete cascade,

  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  /* Einmalig: Ein alter Zustand darf nicht wiederverwendet werden. */
  used_at     timestamptz
);

comment on table public.action_auth_states is
  'Kurzlebiger Uebergabezustand zwischen Mail-Link und Anmeldung. Verweist auf den Action-Token, enthaelt ihn nicht.';

comment on column public.action_auth_states.used_at is
  'Einmalig. Gesetzt NACH erfolgreicher Anmeldung — nicht davor, sonst zerstoerte ein gescheiterter Versuch den Zustand.';

create unique index if not exists action_auth_states_hash_idx
  on public.action_auth_states (state_hash);

create index if not exists action_auth_states_expires_idx
  on public.action_auth_states (expires_at);

alter table public.action_auth_states enable row level security;
revoke all on public.action_auth_states from anon, authenticated;
grant all on public.action_auth_states to service_role;

/* ═══════════════════════════════════════════════════════════════
   ANLEGEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Zehn Minuten.
 *
 * Lang genug fuer eine Anmeldung mit Mailwechsel, kurz genug, dass
 * ein liegengebliebener Zustand nicht am naechsten Tag noch gilt.
 */
create or replace function public.create_action_auth_state(
  p_state_hash text,
  p_token_id   uuid,
  p_user_id    uuid,
  p_ttl        interval default '10 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_expires timestamptz := pg_catalog.now() + p_ttl;
begin
  if p_state_hash is null or pg_catalog.length(p_state_hash) < 64 then
    raise exception 'State-Hash fehlt oder ist zu kurz'
      using errcode = 'invalid_parameter_value';
  end if;

  /* Der Token muss diesem Nutzer gehoeren. */
  if not exists (
    select 1 from public.action_tokens
     where id = p_token_id and user_id = p_user_id
  ) then
    raise exception 'Token gehoert nicht zu diesem Nutzer'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.action_auth_states (state_hash, token_id, user_id, expires_at)
  values (p_state_hash, p_token_id, p_user_id, v_expires)
  returning id into v_id;

  return pg_catalog.jsonb_build_object('id', v_id, 'expiresAt', v_expires);
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   EINLOESEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Loest den Zustand ein — NUR fuer den Nutzer, der ihn angelegt hat.
 *
 * p_session_user_id kommt aus der Supabase-Sitzung des Browsers, nicht
 * aus der Adresse. Hier entscheidet sich der Fall, um den es in diesem
 * Paket geht:
 *
 *   Der Mail-Link gehoert Nutzer A.
 *   Im Browser ist Nutzer B angemeldet.
 *
 * Ohne diese Pruefung bekaeme B den Betrieb, die Empfehlung und das
 * Ziel von A zu sehen. Mit ihr bekommt er eine Absage, die nichts
 * ueber A verraet.
 *
 * Der Zustand wird erst NACH erfolgreicher Pruefung verbraucht: Ein
 * Abbruch soll ihn nicht aufzehren.
 */
create or replace function public.consume_action_auth_state(
  p_state_hash      text,
  p_session_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.action_auth_states;
  v_token jsonb;
begin
  if p_state_hash is null or pg_catalog.length(p_state_hash) < 64 then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'malformed');
  end if;

  select * into v_state from public.action_auth_states
   where state_hash = p_state_hash;

  if not found then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if v_state.used_at is not null then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'already_used');
  end if;

  if v_state.expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  /* ── Der Kern ──
     Die Sitzung muss dem Nutzer gehoeren, fuer den der Link erzeugt
     wurde. */
  if p_session_user_id is null or p_session_user_id <> v_state.user_id then
    /* Eigener Grund, damit die Oberflaeche eine passende Auskunft
       geben kann — ohne zu verraten, wem der Link gehoert. */
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'user_mismatch');
  end if;

  /*
   * Den Token erneut vollstaendig pruefen.
   *
   * Zwischen Continue und Anmeldung koennen Minuten liegen. In dieser
   * Zeit kann der Token ablaufen, der Betrieb geloescht oder die
   * Empfehlung einem anderen Standort zugeordnet werden. Der
   * Uebergabezustand sagt nur, WELCHER Token gemeint war — nicht, dass
   * er noch gilt.
   */
  select public.resolve_action_token(t.token_hash) into v_token
    from public.action_tokens t where t.id = v_state.token_id;

  if v_token is null or not (v_token ->> 'valid')::boolean then
    return pg_catalog.jsonb_build_object(
      'valid', false, 'reason', coalesce(v_token ->> 'reason', 'token_invalid'));
  end if;

  /* Erst jetzt verbrauchen. */
  update public.action_auth_states
     set used_at = pg_catalog.now()
   where id = v_state.id;

  return v_token || pg_catalog.jsonb_build_object('stateId', v_state.id);
end;
$$;

comment on function public.consume_action_auth_state is
  'Loest den Uebergabezustand ein. Die Sitzung muss dem Nutzer gehoeren, fuer den der Link erzeugt wurde; der Token wird erneut vollstaendig geprueft.';

/* ═══════════════════════════════════════════════════════════════
   AUFRAEUMEN
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.cleanup_action_auth_states(
  p_aufbewahrung interval default '1 day'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer;
begin
  delete from public.action_auth_states
   where expires_at < pg_catalog.now() - p_aufbewahrung;
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

revoke all on function public.create_action_auth_state(text,uuid,uuid,interval) from public, anon, authenticated;
revoke all on function public.consume_action_auth_state(text,uuid) from public, anon, authenticated;
revoke all on function public.cleanup_action_auth_states(interval) from public, anon, authenticated;

grant execute on function public.create_action_auth_state(text,uuid,uuid,interval) to service_role;
grant execute on function public.consume_action_auth_state(text,uuid) to service_role;
grant execute on function public.cleanup_action_auth_states(interval) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Rechte:
--   select grantee, privilege_type from information_schema.table_privileges
--    where table_name = 'action_auth_states';
--   → anon und authenticated duerfen nichts.
--
-- Bestand nach einem Einstieg:
--   select id, token_id, expires_at, used_at is not null as verbraucht
--   from public.action_auth_states order by created_at desc limit 5;
--
-- Liegengebliebene aufraeumen:
--   select public.cleanup_action_auth_states();
