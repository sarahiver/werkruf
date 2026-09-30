-- 20260930120000_location_health_score.sql
--
-- Macht den WERKRUF Score eindeutig standortbezogen.
--
-- DAS PROBLEM
--
-- compute_health_score(user_id) mischt bei mehreren Betrieben zwei
-- Quellen:
--
--   Bewertungen      alle Bewertungen des NUTZERS, ohne Filter auf
--                    einen Standort
--   Profilangaben    vom aeltesten primaeren Standort
--                    (order by is_primary desc, created_at limit 1)
--
-- Bei einem Betrieb faellt das nicht auf. Bei zwei ergibt es einen
-- Wert, der zu keinem von beiden gehoert: Antwortquote und Bewertung
-- aus beiden zusammen, Telefon und Website aus einem davon.
--
-- DIE LOESUNG
--
-- compute_location_health_score(user_id, location_id) rechnet fuer
-- GENAU EINEN Standort.
--
-- compute_health_score(user_id) bleibt erhalten und waehlt den
-- Standort nach derselben Regel wie die Oberflaeche:
--
--   genau ein Standort            → dieser
--   mehrere mit Auswahl           → der ausgewaehlte (selected_at)
--   mehrere ohne gueltige Auswahl → kein Score
--
-- Bestehende Aufrufer brechen dadurch nicht: Die Signatur bleibt, und
-- bei einem Standort aendert sich das Ergebnis nicht.
--
-- DIE GEWICHTE BLEIBEN UNVERAENDERT
--
-- Antwortquote 30, Bewertung 25, Aktualitaet 20, Profilangaben 15,
-- Fotos 10. Die Funktionen aus den Paketen A bis C fliessen NICHT ein.
-- Eine Formel heimlich zu erweitern hiesse, dass der Wert von gestern
-- und der von heute verschiedene Dinge messen.
--
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — WELCHER STANDORT?
   ═══════════════════════════════════════════════════════════════ */

/*
 * Der Standort, auf den sich der Score bezieht.
 *
 * Gibt NULL zurueck, wenn mehrere Standorte ohne Auswahl vorliegen.
 * Das ist Absicht: Einen davon zu raten waere schlimmer, als keinen
 * Wert zu zeigen.
 */
create or replace function public.werkruf_score_location(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with aktive as (
    select id, selected_at
    from public.google_locations
    where user_id = p_user_id and deleted_at is null
  )
  select case
    when (select count(*) from aktive) = 1
      then (select id from aktive)
    else (select id from aktive where selected_at is not null
           order by selected_at desc limit 1)
  end;
$$;

comment on function public.werkruf_score_location is
  'Standort fuer den WERKRUF Score. NULL bei mehreren Standorten ohne Auswahl — raten waere schlimmer als nichts zu zeigen.';

/* ═══════════════════════════════════════════════════════════════
   2 — BERECHNUNG FUER EINEN STANDORT
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.compute_location_health_score(
  p_user_id     uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total       integer;
  v_unanswered  integer;
  v_rating      numeric;
  v_newest      timestamptz;
  v_days        integer;
  v_photos      integer;
  v_fields      integer := 0;
  v_filled      integer := 0;
  v_loc         record;

  v_response    integer := 0;
  v_rating_pts  integer := 0;
  v_recency     integer := 0;
  v_complete    integer := 0;
  v_photo_pts   integer := 0;
begin
  if p_location_id is null then
    /* Kein Standort bestimmbar. Kein Score — und das ausdruecklich,
       nicht als 0. Eine 0 sieht aus wie ein schlechter Betrieb. */
    return pg_catalog.jsonb_build_object(
      'score', null,
      'grund', 'kein_standort',
      'scoreVersion', 1);
  end if;

  /* Eigentum pruefen. Diese Funktion laeuft als security definer und
     umgeht damit RLS — ein fremder location_id darf hier nichts
     liefern. */
  select id, primary_phone, website_uri, locality, primary_category, title
    into v_loc
    from public.google_locations
   where id = p_location_id and user_id = p_user_id and deleted_at is null;

  if not found then
    return pg_catalog.jsonb_build_object(
      'score', null, 'grund', 'standort_nicht_gefunden', 'scoreVersion', 1);
  end if;

  /* ── Bewertungen: NUR dieses Standorts ──
     Genau hier lag die Vermischung. */
  select count(*),
         count(*) filter (where not is_answered),
         round(avg(star_rating)::numeric, 1),
         max(google_created_at)
    into v_total, v_unanswered, v_rating, v_newest
    from public.google_reviews
   where user_id = p_user_id
     and location_id = p_location_id
     and status = 'active';

  /* Antwortquote — 30 Punkte */
  if v_total > 0 then
    v_response := round(((v_total - v_unanswered)::numeric / v_total) * 30);
  end if;

  /* Bewertung — 25 Punkte, linear von 3,0 bis 5,0 */
  if v_rating is not null then
    v_rating_pts := round(greatest(0, least(1, (v_rating - 3) / 2)) * 25);
  end if;

  /* Aktualitaet — 20 Punkte, gestuft */
  if v_newest is not null then
    v_days := extract(day from (pg_catalog.now() - v_newest))::integer;
    v_recency := case
      when v_days <= 30  then 20
      when v_days <= 90  then 14
      when v_days <= 180 then 8
      else 0
    end;
  end if;

  /* Vollstaendigkeit — 15 Punkte, vier Felder dieses Standorts */
  v_fields := 4;
  v_filled :=
    (case when v_loc.primary_phone    is not null then 1 else 0 end) +
    (case when v_loc.website_uri      is not null then 1 else 0 end) +
    (case when v_loc.locality         is not null then 1 else 0 end) +
    (case when v_loc.primary_category is not null then 1 else 0 end);
  v_complete := round((v_filled::numeric / v_fields) * 15);

  /* Fotos — 10 Punkte, fuenf als Ziel.
     business_photos haengt am Nutzer, nicht am Standort. Solange das
     so ist, zaehlt hier derselbe Wert fuer alle Betriebe eines
     Nutzers — ein bekannter Rest an Unschaerfe, kein stiller. */
  select count(*) into v_photos
    from public.business_photos where profile_id = p_user_id;
  v_photo_pts := round(least(coalesce(v_photos, 0)::numeric / 5, 1) * 10);

  return pg_catalog.jsonb_build_object(
    'score', v_response + v_rating_pts + v_recency + v_complete + v_photo_pts,
    'factors', pg_catalog.jsonb_build_object(
      'responseRate', v_response, 'rating', v_rating_pts,
      'recency', v_recency, 'completeness', v_complete, 'photos', v_photo_pts
    ),
    'locationId',     p_location_id,
    'locationTitle',  v_loc.title,
    'reviewsTotal',   coalesce(v_total, 0),
    'unanswered',     coalesce(v_unanswered, 0),
    'averageRating',  v_rating,
    'newestReviewAt', v_newest,
    'photoCount',     coalesce(v_photos, 0),
    'scoreVersion',   1
  );
exception when others then
  /* Fehlt eine Tabelle, soll der Wochenlauf nicht komplett ausfallen. */
  return pg_catalog.jsonb_build_object(
    'score', null, 'grund', 'fehler', 'error', sqlerrm, 'scoreVersion', 1);
end;
$$;

comment on function public.compute_location_health_score is
  'WERKRUF Score fuer GENAU EINEN Standort. Gewichte: 30/25/20/15/10, Fassung 1.';

/* ═══════════════════════════════════════════════════════════════
   3 — BESTEHENDE SIGNATUR BEIBEHALTEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Waehlt den Standort und delegiert.
 *
 * Bestehende Aufrufer — Wochenmail, Briefing, ops — brauchen nichts zu
 * aendern. Bei einem Standort ist das Ergebnis identisch zu vorher;
 * bei mehreren ist es erstmals richtig.
 */
create or replace function public.compute_health_score(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.compute_location_health_score(
           p_user_id, public.werkruf_score_location(p_user_id));
$$;

comment on function public.compute_health_score is
  'WERKRUF Score des ausgewaehlten Standorts. Delegiert an compute_location_health_score.';

revoke all on function public.werkruf_score_location(uuid) from public, anon;
revoke all on function public.compute_location_health_score(uuid, uuid) from public, anon;
grant execute on function public.werkruf_score_location(uuid) to authenticated, service_role;
grant execute on function public.compute_location_health_score(uuid, uuid) to authenticated, service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Welcher Standort wird gewaehlt?
--   select l.title, l.selected_at is not null as ausgewaehlt,
--          l.id = public.werkruf_score_location(l.user_id) as zaehlt
--   from public.google_locations l where l.deleted_at is null;
--
-- Score je Standort — die Werte muessen sich unterscheiden, sobald
-- sich die Bewertungen unterscheiden:
--   select l.title,
--          public.compute_location_health_score(l.user_id, l.id) -> 'score' as score,
--          public.compute_location_health_score(l.user_id, l.id) -> 'reviewsTotal' as bewertungen
--   from public.google_locations l where l.deleted_at is null;
--
-- Der kanonische Wert:
--   select jsonb_pretty(public.compute_health_score(auth.uid()));
