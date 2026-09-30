-- 20260930140000_location_photos.sql
--
-- Schliesst die letzte Multi-Location-Luecke im WERKRUF Score.
--
-- DAS PROBLEM
--
-- 20260930120000 hat Bewertungen und Profilangaben auf einen Standort
-- begrenzt, den Foto-Faktor aber nicht:
--
--   select count(*) from public.business_photos where profile_id = p_user_id
--
-- business_photos haengt am Nutzer, nicht am Standort. Bei zwei
-- Betrieben zaehlten also beide dieselben Fotos — und der Browser kam
-- zu einem anderen Ergebnis als die Datenbank, weil
-- useGoogleBusinessData bereits selectedLocation.google_media
-- verwendet.
--
-- DIE QUELLE
--
-- google_locations.google_media ist der tatsaechliche Google-
-- Medienstand dieses Standorts, aktualisiert nach media/list und
-- media/create. Das ist die fachliche Wahrheit — nicht die lokale
-- Upload-Historie, die auch Bilder enthaelt, die nie bei Google
-- gelandet sind.
--
-- Damit stimmen SQL und Browser ueberein.
--
-- ZUSAETZLICH
--
-- business_photos bekommt einen location_id. Nicht fuer den Score —
-- dafuer ist google_media zustaendig — sondern fuer die
-- Upload-Historie, das Loeschen und spaetere Action-Links.
--
-- Das Backfill ist bewusst vorsichtig: Nur Nutzer mit genau EINEM
-- aktiven Standort bekommen eine Zuordnung. Bei mehreren wird nicht
-- geraten; die Zeile bleibt ohne Standort und faellt damit aus jeder
-- standortbezogenen Auswertung heraus.
--
-- Wiederholbar. Aendert bestehende Zuordnungen nicht.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — MEDIENZAEHLUNG, TYPSICHER
   ═══════════════════════════════════════════════════════════════ */

/*
 * Wie viele Google-Medien hat dieser Standort?
 *
 * google_media ist jsonb mit Vorgabe '[]'. In der Praxis kann dort
 * durch aeltere Laeufe auch null oder ein Objekt stehen —
 * jsonb_array_length wuerde dann werfen und die ganze
 * Score-Berechnung in den exception-Zweig schicken.
 *
 * Deshalb wird der Typ geprueft, statt ihn vorauszusetzen.
 */
create or replace function public.werkruf_media_count(p_media jsonb)
returns integer
language sql
immutable
as $$
  select case
    when p_media is null then 0
    when pg_catalog.jsonb_typeof(p_media) = 'array' then pg_catalog.jsonb_array_length(p_media)
    else 0
  end;
$$;

comment on function public.werkruf_media_count is
  'Anzahl Google-Medien aus google_media. Prueft den JSON-Typ, statt ihn vorauszusetzen — ein Objekt oder null darf die Score-Berechnung nicht abbrechen.';

/* ═══════════════════════════════════════════════════════════════
   2 — FOTO-FAKTOR AUS DEM STANDORT
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
    return pg_catalog.jsonb_build_object(
      'score', null, 'grund', 'kein_standort', 'scoreVersion', 1);
  end if;

  /* Eigentum pruefen — security definer umgeht RLS. */
  select id, primary_phone, website_uri, locality, primary_category, title, google_media
    into v_loc
    from public.google_locations
   where id = p_location_id and user_id = p_user_id and deleted_at is null;

  if not found then
    return pg_catalog.jsonb_build_object(
      'score', null, 'grund', 'standort_nicht_gefunden', 'scoreVersion', 1);
  end if;

  /* ── Bewertungen: nur dieses Standorts ── */
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

  /* ── Fotos — 10 Punkte, fuenf als Ziel ──
     Quelle ist der Google-Medienstand DIESES Standorts, nicht die
     nutzerweite Upload-Historie. Vorher zaehlten bei zwei Betrieben
     beide dieselben Fotos, und der Browser kam zu einem anderen
     Ergebnis als die Datenbank. */
  v_photos := public.werkruf_media_count(v_loc.google_media);
  v_photo_pts := round(least(v_photos::numeric / 5, 1) * 10);

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
    'photoCount',     v_photos,
    'photoSource',    'google_media',
    'scoreVersion',   1
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'score', null, 'grund', 'fehler', 'error', sqlerrm, 'scoreVersion', 1);
end;
$$;

comment on function public.compute_location_health_score is
  'WERKRUF Score fuer GENAU EINEN Standort. Fotos aus google_media dieses Standorts. Gewichte 30/25/20/15/10, Fassung 1.';

/* ═══════════════════════════════════════════════════════════════
   3 — UPLOAD-HISTORIE STANDORTBEZOGEN
   ═══════════════════════════════════════════════════════════════ */

alter table public.business_photos
  add column if not exists location_id uuid references public.google_locations(id) on delete set null;

comment on column public.business_photos.location_id is
  'Zu welchem Google-Standort dieser Upload gehoert. NULL bei Altbestand, der sich nicht eindeutig zuordnen liess. Fuer den Score NICHT verwendet — dort zaehlt google_locations.google_media.';

create index if not exists business_photos_location_idx
  on public.business_photos (location_id) where location_id is not null;

/*
 * Vorsichtiges Backfill.
 *
 * Nur Nutzer mit GENAU EINEM aktiven Standort. Bei mehreren laesst
 * sich nicht feststellen, zu welchem Betrieb ein alter Upload gehoerte
 * — und eine falsche Zuordnung waere schlimmer als gar keine: Sie
 * saehe richtig aus.
 */
update public.business_photos p
   set location_id = einzig.id
  from (
    /* min(uuid) gibt es in Postgres nicht. Da es ohnehin genau eine
       Zeile je Nutzer sein muss, reicht eine Aggregation ueber das
       Array — oder wie hier: der Standort selbst, gefiltert auf
       Nutzer mit genau einem. */
    select l.user_id, l.id
    from public.google_locations l
    where l.deleted_at is null
      and (select count(*) from public.google_locations x
            where x.user_id = l.user_id and x.deleted_at is null) = 1
  ) einzig
 where p.profile_id = einzig.user_id
   and p.location_id is null;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Foto-Faktor je Standort — die Werte muessen sich unterscheiden,
-- sobald sich die Medienzahl unterscheidet:
--   select l.title,
--          public.werkruf_media_count(l.google_media) as medien,
--          public.compute_location_health_score(l.user_id, l.id) -> 'factors' -> 'photos' as punkte
--   from public.google_locations l where l.deleted_at is null;
--
-- Browser und Datenbank muessen uebereinstimmen — der Browser zaehlt
-- selectedLocation.google_media.length:
--   select l.title, jsonb_array_length(l.google_media) as browser_zaehlt,
--          public.werkruf_media_count(l.google_media)  as sql_zaehlt
--   from public.google_locations l where l.deleted_at is null;
--
-- Nicht zugeordnete Altbestaende:
--   select count(*) from public.business_photos where location_id is null;
