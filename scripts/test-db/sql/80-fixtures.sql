-- 80-fixtures.sql
--
-- Zentrale Testdaten im Schema test.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES SIE GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Vorher baute jede Testdatei ihren Vorspann selbst:
--
--   insert into public.google_locations (id, user_id, title, selected_at)
--
-- account_id fehlte — in Produktion eine Pflichtspalte. Dreizehn Tests
-- erzeugten damit Standorte ohne Konto, also Daten, die es in
-- Produktion nicht geben kann. Gegen ein schemagetreues Abbild
-- scheitern sie alle.
--
-- Der Fehler war nicht, dass jemand account_id vergessen hat. Der
-- Fehler war, dass dreizehn Dateien dieselbe Sache dreizehnmal
-- aufschrieben. Wer eine Pflichtspalte hinzufuegt, kann nicht
-- dreizehn Dateien pflegen.
--
-- Ab hier gibt es einen Ort.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIE HELFER TUN UND WAS NICHT
-- ═══════════════════════════════════════════════════════════════
--
-- Sie setzen Pflichtfelder und sonst nichts. Kein Profiltext, keine
-- Bewertungen, keine Oeffnungszeiten — was ein Test fachlich braucht,
-- setzt er selbst, sichtbar in seinem eigenen Text. Ein Helfer, der
-- fachliche Daten mitbringt, macht Tests unlesbar: man sieht nicht
-- mehr, woran eine Behauptung haengt.
--
-- Alle Helfer sind mehrfach aufrufbar. Tests laufen in
-- begin … rollback, aber ein Test darf test.basis() auch zweimal
-- rufen, ohne dass es knallt.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE BEZEICHNER
-- ═══════════════════════════════════════════════════════════════
--
-- test.id() gibt feste UUIDs zu lesbaren Namen zurueck. Die Werte sind
-- genau die, die die bestehenden Tests schon benutzten — damit ihre
-- Rumpftexte unveraendert bleiben koennen.
--
--   user_a            11111111-…   der Nutzer, um den es geht
--   user_b            22222222-…   ein fremder Nutzer (Abgrenzung)
--   standort_si       33333333-…   S&I.      — der gewaehlte Betrieb
--   standort_werkruf  44444444-…   WERKRUF   — der zweite Betrieb
--   konto_a           55555555-…   Google-Konto von user_a
--   konto_b           66666666-…   Google-Konto von user_b
--
-- Wiederholbar.

create schema if not exists test;

comment on schema test is
  'Testhelfer. Enthaelt nichts, was in Produktion existiert oder existieren soll.';

/* ═══════════════════════════════════════════════════════════════
   1 — BEZEICHNER STATT UUID-WUESTE
   ═══════════════════════════════════════════════════════════════ */

create table if not exists test.bezeichner (
  name text primary key,
  id   uuid not null unique
);

insert into test.bezeichner (name, id) values
  ('user_a',           '11111111-1111-1111-1111-111111111111'),
  ('user_b',           '22222222-2222-2222-2222-222222222222'),
  ('standort_si',      '33333333-3333-3333-3333-333333333333'),
  ('standort_werkruf', '44444444-4444-4444-4444-444444444444'),
  ('konto_a',          '55555555-5555-5555-5555-555555555555'),
  ('konto_b',          '66666666-6666-6666-6666-666666666666')
on conflict (name) do update set id = excluded.id;

/*
 * test.id('user_a')
 *
 * Wirft bei unbekanntem Namen. Ein Tippfehler soll nicht still null
 * ergeben — null in einer Pflichtspalte haette genau den Fehler
 * zurueckgebracht, den G1 behebt.
 */
create or replace function test.id(p_name text)
returns uuid
language plpgsql
stable
as $$
declare v_id uuid;
begin
  select id into v_id from test.bezeichner where name = p_name;
  if v_id is null then
    raise exception 'Unbekannter Testbezeichner: %. Bekannt: %',
      p_name,
      (select string_agg(name, ', ' order by name) from test.bezeichner)
      using errcode = 'invalid_parameter_value';
  end if;
  return v_id;
end $$;

/* ═══════════════════════════════════════════════════════════════
   2 — NUTZER
   ═══════════════════════════════════════════════════════════════ */

/*
 * Ein Nutzer, wie ihn die Anwendung kennt: Anmeldung, Profil,
 * Benachrichtigungseinstellungen.
 *
 * Alle drei, weil die Kommunikationslogik alle drei liest. Ein Nutzer
 * ohne notification_preferences bekommt keine Wochenmail — ein Test,
 * der das nicht weiss, prueft am Ende nichts (so geschehen in
 * communicationPath.test.sql).
 */
create or replace function test.benutzer(
  p_name         text default 'user_a',
  p_email        text default null,
  p_firma        text default 'Firma Rolf Müller Sanitär und Heizungstechnik',
  p_branche      text default 'handwerk'
)
returns uuid
language plpgsql
as $$
declare v_id uuid := test.id(p_name);
begin
  insert into auth.users (id, email)
  values (v_id, coalesce(p_email, p_name || '@example.test'))
  on conflict (id) do nothing;

  insert into public.user_profiles (id, company_name, industry_key)
  values (v_id, p_firma, p_branche)
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (v_id)
  on conflict (user_id) do nothing;

  return v_id;
end $$;

/* ═══════════════════════════════════════════════════════════════
   3 — GOOGLE-KONTO
   ═══════════════════════════════════════════════════════════════ */

/*
 * provider_account_id ist in Produktion NOT NULL — das war einer der
 * beiden Befunde, die G1 ausgeloest haben. Der Helfer setzt es immer.
 *
 * Der Wert folgt der Google-Form accounts/<n>, weil Produktionscode die
 * Ressourcennamen stellenweise zerlegt. Ein Platzhalter wie 'x' wuerde
 * dort still danebenliegen.
 */
create or replace function test.konto(
  p_name     text default 'konto_a',
  p_benutzer text default 'user_a',
  p_status   text default 'active'
)
returns uuid
language plpgsql
as $$
declare
  v_id   uuid := test.id(p_name);
  v_user uuid := test.id(p_benutzer);
begin
  insert into public.google_accounts
    (id, user_id, provider, provider_account_id, status)
  values (v_id, v_user, 'google',
          'accounts/' || pg_catalog.abs(pg_catalog.hashtext(p_name)), p_status)
  on conflict (id) do nothing;

  return v_id;
end $$;

/* ═══════════════════════════════════════════════════════════════
   4 — STANDORT
   ═══════════════════════════════════════════════════════════════ */

/*
 * account_id ist in Produktion NOT NULL — der zweite Befund.
 *
 * p_gewaehlt entscheidet ueber selected_at. Welcher Standort gewaehlt
 * ist, bestimmt werkruf_score_location() und damit, worueber Dashboard
 * und Wochenmail ueberhaupt sprechen. Genau ein Standort je Nutzer
 * sollte gewaehlt sein; der Helfer prueft das nicht, weil Produktion es
 * auch nicht erzwingt.
 */
create or replace function test.standort(
  p_name     text default 'standort_si',
  p_benutzer text default 'user_a',
  p_konto    text default 'konto_a',
  p_titel    text default null,
  p_gewaehlt boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_id    uuid := test.id(p_name);
  v_user  uuid := test.id(p_benutzer);
  v_konto uuid := test.id(p_konto);
  v_titel text := coalesce(
    p_titel,
    case p_name
      when 'standort_si'      then 'S&I.'
      when 'standort_werkruf' then 'WERKRUF'
      else p_name
    end);
begin
  insert into public.google_locations
    (id, user_id, account_id, account_resource_name, location_resource_name,
     title, selected_at)
  values (v_id, v_user, v_konto,
          'accounts/' || pg_catalog.abs(pg_catalog.hashtext(p_konto)),
          'locations/' || pg_catalog.abs(pg_catalog.hashtext(p_name)),
          v_titel,
          case when p_gewaehlt then pg_catalog.now() else null end)
  on conflict (id) do nothing;

  return v_id;
end $$;

/* ═══════════════════════════════════════════════════════════════
   5 — BEWERTUNGEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * google_reviews hat fuenf Pflichtspalten, die kein Test im Kopf
 * behalten sollte:
 *
 *   location_id  account_id  user_id
 *   review_resource_name     google_created_at
 *
 * Nutzer und Konto liest der Helfer aus dem Standort — so koennen sie
 * nicht auseinanderlaufen. review_resource_name folgt der Google-Form
 * und ist je Zeile verschieden, weil es in Produktion die Kennung der
 * Bewertung ist.
 *
 * Fachlich entscheidend sind nur Sterne, Antwortstand und Alter. Genau
 * die stehen in den Parametern, und nur die soll ein Test setzen.
 */
create or replace function test.bewertungen(
  p_standort    text    default 'standort_si',
  p_anzahl      integer default 1,
  p_sterne      integer default 5,
  p_beantwortet boolean default true,
  p_alter       interval default '3 days'
)
returns integer
language plpgsql
as $$
declare
  v_loc   uuid := test.id(p_standort);
  v_user  uuid;
  v_konto uuid;
begin
  select user_id, account_id into v_user, v_konto
    from public.google_locations where id = v_loc;

  if v_user is null then
    raise exception 'Standort % existiert nicht. test.basis() zuerst rufen.',
      p_standort using errcode = 'invalid_parameter_value';
  end if;

  insert into public.google_reviews
    (location_id, account_id, user_id, review_resource_name,
     star_rating, is_answered, answered_at, google_created_at, status)
  select
    v_loc, v_konto, v_user,
    'locations/' || pg_catalog.abs(pg_catalog.hashtext(p_standort))
      || '/reviews/' || pg_catalog.gen_random_uuid()::text,
    p_sterne,
    p_beantwortet,
    case when p_beantwortet then pg_catalog.now() - p_alter else null end,
    pg_catalog.now() - p_alter,
    'active'
  from pg_catalog.generate_series(1, p_anzahl);

  return p_anzahl;
end $$;

/* ═══════════════════════════════════════════════════════════════
   6 — DER GEWOEHNLICHE FALL
   ═══════════════════════════════════════════════════════════════ */

/*
 * test.basis()
 *
 *   user_a
 *   ├─ konto_a
 *   ├─ S&I.      (gewaehlt)
 *   └─ WERKRUF   (nicht gewaehlt)
 *
 * Fast jeder Test braucht genau das: einen Nutzer mit zwei Standorten,
 * von denen einer gewaehlt ist. Daran haengt alles, was seit Paket D2
 * standortbezogen ist — der zweite Standort ist nicht Zierde, sondern
 * die Gegenprobe: er beweist, dass eine Aussage wirklich auf den
 * gewaehlten Betrieb begrenzt ist.
 *
 * Ein Konto fuer beide Standorte, nicht eines je Standort: so arbeitet
 * das Produkt. Ein Google-Konto verwaltet mehrere Standorte.
 */
create or replace function test.basis()
returns void
language plpgsql
as $$
begin
  perform test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  perform test.standort('standort_si',      'user_a', 'konto_a', null, true);
  perform test.standort('standort_werkruf', 'user_a', 'konto_a', null, false);
end $$;

/*
 * Ein fremder Nutzer mit eigenem Konto.
 *
 * Fuer Abgrenzungstests: sieht user_b etwas von user_a? Wird nur
 * angelegt, wo es gebraucht wird — die meisten Tests brauchen nur die
 * user_b-UUID, ohne dass dahinter Daten liegen muessen.
 */
create or replace function test.fremder()
returns uuid
language plpgsql
as $$
begin
  perform test.benutzer('user_b', null, 'Fremdbetrieb GmbH', 'handwerk');
  perform test.konto('konto_b', 'user_b');
  return test.id('user_b');
end $$;

/* ═══════════════════════════════════════════════════════════════
   RECHTE
   ═══════════════════════════════════════════════════════════════ */

grant usage on schema test to service_role;
