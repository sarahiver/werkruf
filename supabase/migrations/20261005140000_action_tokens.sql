-- 20261005140000_action_tokens.sql
--
-- Sichere Tokens fuer Mail-Links.
--
-- DAS PROBLEM MIT MAIL-LINKS
--
-- Ein Link in einer E-Mail ist oeffentlich sichtbar und wird
-- automatisch geoeffnet — von Mailprovidern, Virenscannern,
-- Vorschaudiensten und Sicherheits-Gateways. Oft mehrfach, oft bevor
-- der Empfaenger die Mail ueberhaupt gelesen hat.
--
-- Daraus folgt alles Weitere:
--
--   Ein GET darf NIEMALS etwas veraendern.
--
-- Deshalb trennt dieses Modell zwei Dinge, die auf den ersten Blick
-- eins sind:
--
--   aufloesen (resolve)   Wer bist du, wohin darfst du? Beliebig oft,
--                         ohne Wirkung. Das macht der Scanner.
--   verbrauchen (consume) Eine bewusste Handlung des Menschen. Nur
--                         per POST, nur einmal.
--
-- Ein Token, der durch blosses Oeffnen verfaellt, ist unbrauchbar:
-- Der Scanner verbraucht ihn, und der Kunde klickt ins Leere.
--
-- WAS IN DER DATENBANK STEHT
--
-- Nur der SHA-256-Hash. Der Klartext existiert einmal — beim Erzeugen,
-- auf dem Weg in die Mail. Wer die Tabelle liest, kann daraus keinen
-- gueltigen Link bauen.
--
-- bcrypt oder argon2 waeren hier falsch: Der Token hat bereits 256 Bit
-- Entropie, es gibt nichts zu erraten. Ein langsamer Hash machte nur
-- das Nachschlagen langsam.
--
-- Wiederholbar. Legt keine Daten an.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — TABELLE
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.action_tokens (
  id            uuid primary key default gen_random_uuid(),

  /* Nur der Hash. Der Klartext steht ausschliesslich in der Mail. */
  token_hash    text not null,

  /* ── Fachliche Bindung ──
     Diese Werte stehen HIER, nicht in der URL. Ein Link, der
     ?event=... mitfuehrt und das glaubt, laesst sich umschreiben. */
  user_id       uuid not null references auth.users(id) on delete cascade,
  location_id   uuid references public.google_locations(id) on delete cascade,
  event_id      uuid references public.events(id) on delete cascade,

  /* Wofuer der Token gilt. Ein Token fuers Oeffnen einer Empfehlung
     darf nicht fuer etwas anderes taugen. */
  purpose       text not null,

  /* Wohin er fuehrt. Nur interne Pfade — siehe action_token_ziel_ok. */
  target_path   text not null,

  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,

  /* Verbraucht wird NUR durch eine bewusste Handlung, nie durch
     Aufloesen. */
  consumed_at   timestamptz,
  last_used_at  timestamptz,
  use_count     integer not null default 0
);

comment on table public.action_tokens is
  'Tokens fuer Mail-Links. Nur der SHA-256-Hash wird gespeichert; der Klartext existiert einmal beim Erzeugen.';

comment on column public.action_tokens.token_hash is
  'SHA-256 des Klartext-Tokens, hex. Kein bcrypt: 256 Bit Entropie lassen nichts zu erraten, und das Nachschlagen soll schnell bleiben.';

comment on column public.action_tokens.consumed_at is
  'Gesetzt NUR bei einer bewussten Handlung per POST. Ein GET — und damit jeder Mailscanner — laesst dieses Feld unberuehrt.';

/* ── Indizes ──
   token_hash eindeutig: Zwei Tokens mit demselben Hash gaebe es nur
   bei einer Kollision oder einem Fehler. */
create unique index if not exists action_tokens_hash_idx
  on public.action_tokens (token_hash);

create index if not exists action_tokens_user_idx
  on public.action_tokens (user_id);

/* Fuer das Widerrufen beim Erzeugen eines neuen Tokens und fuer
   "alle Tokens dieser Empfehlung widerrufen". */
create index if not exists action_tokens_aktiv_idx
  on public.action_tokens (user_id, purpose, event_id)
  where revoked_at is null and consumed_at is null;

/* Fuer das Aufraeumen. */
create index if not exists action_tokens_expires_idx
  on public.action_tokens (expires_at);

/* ── Rechte ──
   Der Browser darf diese Tabelle nicht sehen. Ein Hash ist zwar nicht
   umkehrbar, aber die Zeilen verraten, welche Empfehlungen es gibt,
   wann sie verschickt wurden und an wen. */
alter table public.action_tokens enable row level security;

revoke all on public.action_tokens from anon, authenticated;
grant all on public.action_tokens to service_role;

/* ═══════════════════════════════════════════════════════════════
   2 — ERLAUBTE ZIELE
   ═══════════════════════════════════════════════════════════════ */

/*
 * Kein offener Redirect.
 *
 * Ein Link, der auf ein beliebiges Ziel zeigt, ist eine Einladung:
 * Die Adresse traegt die Domain von WERKRUF, landet aber woanders —
 * und sieht fuer den Empfaenger vertrauenswuerdig aus.
 *
 * Deshalb eine Liste erlaubter Praefixe, keine Mustererkennung.
 * Besonders zu beachten: `//evil.example` ist ein protokollrelatives
 * Ziel. Es beginnt mit `/` und waere bei einer naiven Pruefung
 * erlaubt — der Browser laedt davon eine fremde Domain.
 */
create or replace function public.action_token_ziel_ok(p_path text)
returns boolean
language sql
immutable
as $$
  select p_path is not null
     and p_path like '/%'
     /* Protokollrelativ: fuehrt zu einer fremden Domain. */
     and p_path not like '//%'
     /* Kein Schema, auch nicht nach einem fuehrenden Slash. */
     and p_path not like '%://%'
     /* chr(92) statt eines Backslash-Literals: In manchen
        Konfigurationen frisst '\' das schliessende Hochkomma, und die
        Funktion laesst sich nicht anlegen. */
     and pg_catalog.strpos(p_path, pg_catalog.chr(92)) = 0
     and pg_catalog.lower(p_path) not like '%javascript:%'
     and pg_catalog.lower(p_path) not like '%data:%'
     and (
       p_path = '/dashboard'
       or p_path like '/dashboard/%'
     );
$$;

comment on function public.action_token_ziel_ok is
  'Ist dieser Zielpfad erlaubt? Nur interne Dashboard-Pfade. //host ist protokollrelativ und fuehrt zu einer fremden Domain — deshalb ausdruecklich ausgeschlossen.';

/* ═══════════════════════════════════════════════════════════════
   3 — ERZEUGEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Legt einen Token an. Den Klartext kennt nur der Aufrufer.
 *
 * Diese Funktion bekommt den FERTIGEN Hash — den Zufall erzeugt die
 * Edge Function mit crypto.getRandomValues. Postgres' gen_random_bytes
 * waere auch moeglich, aber dann stuende der Klartext kurz im
 * SQL-Rueckgabewert und damit womoeglich in einem Protokoll.
 *
 * Aeltere Tokens desselben Zwecks werden widerrufen: Es soll klar
 * sein, dass nur der neueste Link gilt. Sonst bliebe ein Link aus
 * einer Mail von vor drei Wochen gueltig, obwohl laengst ein neuer
 * verschickt wurde.
 */
create or replace function public.create_action_token(
  p_token_hash  text,
  p_user_id     uuid,
  p_purpose     text,
  p_target_path text,
  p_location_id uuid default null,
  p_event_id    uuid default null,
  p_ttl         interval default '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_expires  timestamptz := pg_catalog.now() + p_ttl;
  v_revoked  integer := 0;
begin
  if p_token_hash is null or pg_catalog.length(p_token_hash) < 64 then
    raise exception 'Token-Hash fehlt oder ist zu kurz'
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.action_token_ziel_ok(p_target_path) then
    raise exception 'Zielpfad % ist nicht erlaubt', p_target_path
      using errcode = 'invalid_parameter_value';
  end if;

  /* Gehoert der Standort diesem Nutzer? */
  if p_location_id is not null then
    if not exists (
      select 1 from public.google_locations
       where id = p_location_id and user_id = p_user_id and deleted_at is null
    ) then
      raise exception 'Standort gehoert nicht zu diesem Nutzer'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  /* Gehoert die Empfehlung diesem Nutzer — und diesem Standort? */
  if p_event_id is not null then
    if not exists (
      select 1 from public.events e
       where e.id = p_event_id
         and e.user_id = p_user_id
         and (p_location_id is null or e.location_id is not distinct from p_location_id)
    ) then
      raise exception 'Empfehlung gehoert nicht zu diesem Nutzer oder Standort'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  /* Aeltere Tokens desselben Zwecks widerrufen — nur der neueste
     Link gilt. */
  update public.action_tokens
     set revoked_at = pg_catalog.now()
   where user_id = p_user_id
     and purpose = p_purpose
     and event_id is not distinct from p_event_id
     and revoked_at is null
     and consumed_at is null;

  get diagnostics v_revoked = row_count;

  insert into public.action_tokens
    (token_hash, user_id, location_id, event_id, purpose, target_path, expires_at)
  values
    (p_token_hash, p_user_id, p_location_id, p_event_id, p_purpose, p_target_path, v_expires)
  returning id into v_id;

  /* KEIN Klartext in der Rueckgabe — den kennt nur der Aufrufer. */
  return pg_catalog.jsonb_build_object(
    'id', v_id, 'expiresAt', v_expires, 'revokedPrevious', v_revoked);
end;
$$;

comment on function public.create_action_token is
  'Legt einen Action-Token an. Erwartet den fertigen Hash; der Klartext bleibt beim Aufrufer und kommt nie in einen SQL-Rueckgabewert.';

/* ═══════════════════════════════════════════════════════════════
   4 — AUFLOESEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Prueft einen Token und liefert seinen Kontext.
 *
 * VERAENDERT NICHTS. Nicht consumed_at, nicht use_count.
 *
 * Diese Funktion wird von jedem Mailscanner aufgerufen, der den Link
 * oeffnet — oft mehrfach. Wuerde sie etwas verbrauchen, waere der Link
 * tot, bevor der Empfaenger ihn anklickt.
 *
 * Nach aussen gibt es nur zwei Antworten: gueltig mit Kontext, oder
 * ungueltig. Der Grund steht im Rueckgabewert fuer das Protokoll,
 * nicht fuer den Besucher: "Token abgelaufen" verraet, dass es ihn
 * gab, "Empfehlung gehoert anderem Nutzer" sogar mehr.
 */
create or replace function public.resolve_action_token(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.action_tokens;
begin
  if p_token_hash is null or pg_catalog.length(p_token_hash) < 64 then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'malformed');
  end if;

  select * into v_t from public.action_tokens where token_hash = p_token_hash;

  if not found then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if v_t.revoked_at is not null then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'revoked');
  end if;

  if v_t.expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  /* Der Standort kann inzwischen geloescht worden sein oder den
     Besitzer gewechselt haben. Die Bindung wird bei JEDEM Aufloesen
     neu geprueft, nicht nur beim Erzeugen. */
  if v_t.location_id is not null then
    if not exists (
      select 1 from public.google_locations
       where id = v_t.location_id and user_id = v_t.user_id and deleted_at is null
    ) then
      return pg_catalog.jsonb_build_object('valid', false, 'reason', 'location_mismatch');
    end if;
  end if;

  if v_t.event_id is not null then
    if not exists (
      select 1 from public.events e
       where e.id = v_t.event_id
         and e.user_id = v_t.user_id
         and (v_t.location_id is null or e.location_id is not distinct from v_t.location_id)
    ) then
      return pg_catalog.jsonb_build_object('valid', false, 'reason', 'event_mismatch');
    end if;
  end if;

  /* Der Zielpfad wird erneut geprueft. Die Liste erlaubter Pfade kann
     sich geaendert haben, seit der Token erzeugt wurde. */
  if not public.action_token_ziel_ok(v_t.target_path) then
    return pg_catalog.jsonb_build_object('valid', false, 'reason', 'invalid_target');
  end if;

  return pg_catalog.jsonb_build_object(
    'valid',      true,
    'tokenId',    v_t.id,
    'userId',     v_t.user_id,
    'locationId', v_t.location_id,
    'eventId',    v_t.event_id,
    'purpose',    v_t.purpose,
    'targetPath', v_t.target_path,
    'expiresAt',  v_t.expires_at,
    /* Wurde er schon einmal bewusst benutzt? Entscheidet D6, ob eine
       Handlung noch angeboten wird — das Aufloesen selbst bleibt
       davon unberuehrt. */
    'consumed',   v_t.consumed_at is not null);
end;
$$;

comment on function public.resolve_action_token is
  'Prueft einen Token und liefert den Kontext. VERAENDERT NICHTS — jeder Mailscanner ruft das auf, oft mehrfach.';

/* ═══════════════════════════════════════════════════════════════
   5 — VERBRAUCHEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Haelt eine bewusste Handlung fest.
 *
 * NUR aus einem POST aufzurufen, nie aus einem GET. Der Unterschied
 * ist nicht formal: Scanner senden GET, Menschen druecken Knoepfe.
 */
create or replace function public.consume_action_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pruefung jsonb;
  v_id       uuid;
begin
  v_pruefung := public.resolve_action_token(p_token_hash);

  if not (v_pruefung ->> 'valid')::boolean then
    return v_pruefung;
  end if;

  v_id := (v_pruefung ->> 'tokenId')::uuid;

  update public.action_tokens
     set consumed_at  = coalesce(consumed_at, pg_catalog.now()),
         last_used_at = pg_catalog.now(),
         use_count    = use_count + 1
   where id = v_id;

  return v_pruefung || pg_catalog.jsonb_build_object('consumed', true);
end;
$$;

comment on function public.consume_action_token is
  'Haelt eine bewusste Handlung fest. NUR aus einem POST aufrufen — Scanner senden GET.';

/* ═══════════════════════════════════════════════════════════════
   6 — WIDERRUFEN UND AUFRAEUMEN
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.revoke_action_tokens(
  p_user_id  uuid,
  p_event_id uuid default null,
  p_purpose  text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer;
begin
  update public.action_tokens
     set revoked_at = pg_catalog.now()
   where user_id = p_user_id
     and (p_event_id is null or event_id = p_event_id)
     and (p_purpose is null or purpose = p_purpose)
     and revoked_at is null;

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

comment on function public.revoke_action_tokens is
  'Widerruft Tokens eines Nutzers, wahlweise eingegrenzt auf eine Empfehlung oder einen Zweck.';

/*
 * Raeumt Abgelaufenes weg.
 *
 * Kein Cronjob in diesem Paket — die Tabelle waechst langsam. Die
 * Funktion steht bereit, falls sich das aendert.
 */
create or replace function public.cleanup_action_tokens(
  p_aufbewahrung interval default '30 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer;
begin
  delete from public.action_tokens
   where expires_at < pg_catalog.now() - p_aufbewahrung;

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   7 — RECHTE
   ═══════════════════════════════════════════════════════════════ */

revoke all on function public.create_action_token(text,uuid,text,text,uuid,uuid,interval) from public, anon, authenticated;
revoke all on function public.resolve_action_token(text) from public, anon, authenticated;
revoke all on function public.consume_action_token(text) from public, anon, authenticated;
revoke all on function public.revoke_action_tokens(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.cleanup_action_tokens(interval) from public, anon, authenticated;

grant execute on function public.create_action_token(text,uuid,text,text,uuid,uuid,interval) to service_role;
grant execute on function public.resolve_action_token(text) to service_role;
grant execute on function public.consume_action_token(text) to service_role;
grant execute on function public.revoke_action_tokens(uuid,uuid,text) to service_role;
grant execute on function public.cleanup_action_tokens(interval) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Tabelle und Rechte:
--   select tablename, rowsecurity from pg_tables where tablename = 'action_tokens';
--   select grantee, privilege_type from information_schema.table_privileges
--    where table_name = 'action_tokens';
--   → anon und authenticated duerfen nichts.
--
-- Zielpruefung:
--   select p, public.action_token_ziel_ok(p)
--   from (values ('/dashboard'), ('/dashboard/fotos'),
--                ('https://evil.example'), ('//evil.example'),
--                ('/dashboard/../admin'), ('javascript:alert(1)')) v(p);
--   → nur die ersten beiden true.
--
-- Bestand:
--   select purpose, count(*) filter (where revoked_at is null and expires_at > now()) as aktiv,
--          count(*) filter (where consumed_at is not null) as benutzt,
--          count(*) as gesamt
--   from public.action_tokens group by purpose;
