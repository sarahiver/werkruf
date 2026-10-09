-- 20261009100000_opening_hours_context.sql
--
-- Reguläre Oeffnungszeiten im Evaluation Context.
--
-- WO SIE HERKOMMEN — UND WO SIE BISHER VERLOREN GINGEN
--
--   Google getLocations, Feldmaske enthaelt regularHours   ✓ wird abgefragt
--   mapGoogleLocationFields                                 ✓ wird gemappt
--   google_locations.google_profile.regularHours            ✓ wird gespeichert
--   build_location_evaluation_context                       ✗ liest es nicht
--
-- Der Sync war nie das Problem. Die Daten liegen seit jeher da; nur
-- der Kontext hat sie nicht weitergereicht. Deshalb braucht es hier
-- weder eine neue Spalte noch einen Resync noch einen Eingriff in den
-- Sync-Code.
--
-- PRESENT UND RELIABLE
--
-- Zwei verschiedene Aussagen, und die Trennung ist der Kern:
--
--   present    Es sind Zeiten hinterlegt.
--   reliable   Wir wissen das sicher.
--
-- Ohne die zweite entstuende dieselbe Falle wie bei den Bewertungen
-- in F1a: Ein nie synchronisierter Standort saehe aus wie einer ohne
-- Oeffnungszeiten.
--
-- Verlaesslich heisst dreierlei:
--
--   1. last_synced_at ist gesetzt.
--   2. google_profile traegt den SCHLUESSEL regularHours. Der Mapper
--      schreibt ihn immer, auch als null — fehlt er, stammt die Zeile
--      aus der Zeit davor. Das unterscheidet "Google lieferte nichts"
--      von "wir haben nie gefragt".
--   3. Kein gescheiterter Abgleich in den letzten 24 Stunden.
--
-- WAS present NICHT PRUEFT
--
-- Wie viele Tage, wie viele Perioden, ob die Zeiten plausibel sind.
-- Montag bis Freitag gepflegt ist vorhanden. Durchgehend geoeffnet
-- auch. Ein bewusst geschlossener Tag ebenfalls — Google liefert dann
-- eine gueltige Struktur, und die zaehlt.
--
-- Sonderoeffnungszeiten bleiben aussen vor: Sie ersetzen keine
-- regulaeren.
--
-- Gebaut auf der aktuellen Definition aus pg_get_functiondef.
-- Wiederholbar. Aendert keine Daten.

begin;

CREATE OR REPLACE FUNCTION public.build_location_evaluation_context(p_user_id uuid, p_location_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ctx         jsonb;
  v_loc         record;
  v_mehrere     boolean;
begin
  /* Wie viele aktive Betriebe gibt es ueberhaupt? Davon haengt ab, ob
     "Betrieb auswaehlen" eine sinnvolle Empfehlung waere. */
  select count(*) > 1 into v_mehrere
    from public.google_locations
   where user_id = p_user_id and deleted_at is null;

  /* ── Kein eindeutiger Standort ──
     Keine 0-Werte als Ersatz. Die Engine soll erkennen, dass sie
     nichts Standortbezogenes beurteilen kann. */
  if p_location_id is null then
    return pg_catalog.jsonb_build_object(
      'userId',            p_user_id,
      'now',               pg_catalog.now(),
      'locationResolved',  false,
      'multipleLocations', coalesce(v_mehrere, false),
      'connection', (
        select pg_catalog.jsonb_build_object(
          'status',        a.status,
          'providerEmail', a.provider_email,
          'lastErrorAt',   a.last_error_at,
          'lastErrorCode', a.last_error_code,
          'connectedAt',   a.connected_at)
        from public.google_accounts a
        where a.user_id = p_user_id and a.deleted_at is null
        order by case a.status when 'active' then 0 else 1 end, a.connected_at
        limit 1
      )
    );
  end if;

  /* Eigentum pruefen — security definer umgeht RLS. */
  select l.*, l.account_id as acc into v_loc
    from public.google_locations l
   where l.id = p_location_id and l.user_id = p_user_id and l.deleted_at is null;

  if not found then
    return pg_catalog.jsonb_build_object(
      'userId', p_user_id, 'now', pg_catalog.now(),
      'locationResolved', false, 'reason', 'standort_nicht_gefunden');
  end if;

  select pg_catalog.jsonb_build_object(
    'userId',            p_user_id,
    'now',               pg_catalog.now(),
    'locationResolved',  true,
    'multipleLocations', coalesce(v_mehrere, false),

    /* Der eine Betrieb, um den es geht. */
    'location', pg_catalog.jsonb_build_object(
      'id',            v_loc.id,
      'title',         v_loc.title,
      'locality',      v_loc.locality,
      'phone',         v_loc.primary_phone,
      'website',       v_loc.website_uri,
      'category',      v_loc.primary_category,
      'lastSyncedAt',  v_loc.last_synced_at,
      'reviewCount',   v_loc.review_count,
      'averageRating', v_loc.average_rating
    ),

    /* Kontozustand des Google-Kontos, zu dem DIESER Standort gehoert —
       nicht irgendeines Kontos des Nutzers. */
    'connection', (
      select pg_catalog.jsonb_build_object(
        'status',        a.status,
        'providerEmail', a.provider_email,
        'lastErrorAt',   a.last_error_at,
        'lastErrorCode', a.last_error_code,
        'connectedAt',   a.connected_at)
      from public.google_accounts a
      where a.id = v_loc.account_id and a.user_id = p_user_id and a.deleted_at is null
    ),

    /* ── Bewertungen: nur dieses Standorts ── */
    'reviews', (
      select pg_catalog.jsonb_build_object(
        'total',         count(*),
        'unanswered',    count(*) filter (where not is_answered),
        'averageRating', round(avg(star_rating)::numeric, 1),
        'newestAt',      max(google_created_at),
        'last7d',        count(*) filter (where google_created_at > pg_catalog.now() - interval '7 days'),
        'last30d',       count(*) filter (where google_created_at > pg_catalog.now() - interval '30 days'))
      from public.google_reviews
      where user_id = p_user_id and location_id = p_location_id and status = 'active'
    ),

    'lowRatedOpen', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',         r.id,
        'rating',     r.star_rating,
        'createdAt',  r.google_created_at,
        'reviewer',   r.reviewer_display_name,
        'locationId', r.location_id
      ) order by r.google_created_at desc)
      from (
        select * from public.google_reviews
        where user_id = p_user_id and location_id = p_location_id
          and status = 'active' and not is_answered and star_rating <= 2
        order by google_created_at desc
        limit 10
      ) r
    ), '[]'::jsonb),

    /* ── Antworten: nur zu Bewertungen dieses Standorts ──
       review_replies haengt am Nutzer; der Standortbezug entsteht
       ueber die Bewertung. */
    'replies', (
      select pg_catalog.jsonb_build_object(
        'draft',     count(*) filter (where rr.status = 'draft'),
        'approved',  count(*) filter (where rr.status in ('approved', 'publishing')),
        'published', count(*) filter (where rr.status = 'published'),
        'failed',    count(*) filter (where rr.status = 'failed'))
      from public.review_replies rr
      join public.google_reviews gr on gr.id = rr.review_id
      where rr.user_id = p_user_id and rr.deleted_at is null
        and gr.location_id = p_location_id
    ),

    /* Fotos aus dem Google-Medienstand dieses Standorts — siehe D1.1. */
    'photoCount', public.werkruf_media_count(v_loc.google_media),

    'health', public.compute_location_health_score(p_user_id, p_location_id),

    /* Vorwochenwert nur, wenn er vergleichbar ist: gleicher Standort,
       gleiche Score-Fassung. Sonst null — dann feuert health.declined
       nicht. Ein fehlender Trend ist besser als ein falscher. */
    'previousHealth', public.previous_location_health(p_user_id, p_location_id, 1::smallint),

    /*
     * Reguläre Oeffnungszeiten.
     *
     * Sie liegen bereits in google_profile — der Sync fragt
     * regularHours in der Feldmaske ab und mapGoogleLocationFields
     * legt sie dort ab. Verloren gingen sie nur hier: Der Kontext
     * hat sie nie gelesen.
     *
     * present und reliable sind zwei verschiedene Aussagen:
     *
     *   present   Es sind Zeiten hinterlegt.
     *   reliable  Wir wissen das sicher.
     *
     * Ohne die zweite entstuende dieselbe Falle wie bei den
     * Bewertungen in F1a: Ein Standort, der nie synchronisiert wurde,
     * saehe aus wie einer ohne Oeffnungszeiten — und bekaeme eine
     * Empfehlung, die vielleicht gar nicht stimmt.
     *
     * Verlaesslich heisst:
     *
     *   1. Der Standort wurde schon einmal synchronisiert.
     *   2. google_profile traegt den Schluessel regularHours.
     *      Der Mapper schreibt ihn IMMER, auch als null. Fehlt er,
     *      stammt die Zeile aus der Zeit vor diesem Mapper.
     *   3. Der letzte Abgleich ist nicht gescheitert.
     *
     * present heisst: Es gibt Perioden. Wie viele, welche Tage, ob
     * plausibel — das prueft F1c nicht. Montag bis Freitag gepflegt
     * ist vorhanden; durchgehend geoeffnet auch.
     */
    'openingHours', (
      select pg_catalog.jsonb_build_object(
        'reliable', coalesce(
          v_loc.last_synced_at is not null
          and (v_loc.google_profile ? 'regularHours')
          and not exists (
            select 1 from public.sync_jobs
            where user_id = p_user_id
              and location_id = p_location_id
              and status = 'failed'
              and finished_at > pg_catalog.now() - interval '24 hours'
          ), false),
        /* Perioden vorhanden. Ein leeres Array ist nicht vorhanden —
           Google liefert dann schlicht nichts. */
        /*
         * coalesce ist hier nicht kosmetisch.
         *
         * Steht regularHours auf JSON-null, liefert der Pfadzugriff
         * SQL-NULL, jsonb_typeof davon ebenfalls NULL, und der
         * Vergleich wird NULL statt false. Die Regel prueft spaeter
         * `!present` — und NULL ist weder wahr noch falsch, sodass
         * die Bedingung nie greift.
         *
         * Genau dieser Fall ist der haeufigste: Google liefert keine
         * Zeiten, der Mapper schreibt null.
         */
        'present', coalesce(
          pg_catalog.jsonb_typeof(
            v_loc.google_profile -> 'regularHours' -> 'periods') = 'array'
          and pg_catalog.jsonb_array_length(
            v_loc.google_profile -> 'regularHours' -> 'periods') > 0,
          false)
      )
    ),

    /* Sync-Zustand dieses Standorts. */
    'syncFailed', exists (
      select 1 from public.sync_jobs
      where user_id = p_user_id
        and location_id = p_location_id
        and status = 'failed'
        and finished_at > pg_catalog.now() - interval '24 hours'
    )
  ) into v_ctx;

  return v_ctx;
exception when others then
  /* Fehlt eine Spalte oder Tabelle, soll der Engine-Lauf nicht
     vollstaendig ausfallen. */
  return pg_catalog.jsonb_build_object(
    'userId', p_user_id, 'now', pg_catalog.now(),
    'locationResolved', false, 'reason', 'fehler', 'error', sqlerrm);
end;
$function$;


commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Was sagen die echten Daten?
--   select l.title,
--          public.build_location_evaluation_context(l.user_id, l.id)
--            -> 'openingHours' as oeffnungszeiten
--   from public.google_locations l
--   where l.user_id = '<user-id>' and l.deleted_at is null;
--
--   {"reliable": true,  "present": false}  → Empfehlung entsteht
--   {"reliable": false, "present": false}  → unbekannt, keine Empfehlung
--   {"reliable": true,  "present": true}   → alles gut
--
-- Woran liegt ein unreliable?
--   select title, last_synced_at is not null as synchronisiert,
--          google_profile ? 'regularHours'   as schluessel_da,
--          google_profile -> 'regularHours'  as inhalt
--   from public.google_locations where user_id = '<user-id>';
