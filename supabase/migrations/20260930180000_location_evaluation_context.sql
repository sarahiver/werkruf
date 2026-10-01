-- 20260930180000_location_evaluation_context.sql
--
-- Macht den Evaluation Context standortrein (Paket D2, zweite Haelfte).
--
-- WAS BISHER VERMISCHT WURDE
--
-- build_evaluation_context(p_user_id) sammelt nutzerweit:
--
--   reviews         where user_id = p_user_id          — alle Betriebe
--   lowRatedOpen    dito                               — alle Betriebe
--   replies         where user_id = p_user_id          — alle Betriebe
--   photoCount      business_photos                    — nutzerweit
--   health          compute_health_score(user_id)      — seit D1 richtig
--   previousHealth  weekly_snapshots ohne location_id  — nicht vergleichbar
--   syncFailed      sync_jobs ohne location_id         — alle Betriebe
--
-- Die Engine bekommt damit Fakten, die zu keinem einzelnen Betrieb
-- gehoeren — und erzeugt daraus Empfehlungen, die sie einem zuordnet.
--
-- DIE NEUE FASSUNG
--
-- build_location_evaluation_context(user_id, location_id) liefert
-- ausschliesslich Fakten DIESES Standorts, plus den Kontozustand des
-- Google-Kontos, zu dem er gehoert.
--
-- build_evaluation_context(user_id) bleibt erhalten und delegiert ueber
-- werkruf_score_location — dieselbe Standortlogik wie D1.
--
-- OHNE EINDEUTIGEN STANDORT
--
-- Bei mehreren Betrieben ohne Auswahl entstehen KEINE standortbezogenen
-- Fakten. Statt 0-Werten, die wie ein schlechter Betrieb aussehen,
-- traegt der Kontext dann `locationResolved: false` — die Engine kann
-- daraus genau eine Empfehlung ableiten: "Betrieb auswaehlen".
--
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — KONTEXT FUER EINEN STANDORT
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.build_location_evaluation_context(
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
$$;

comment on function public.build_location_evaluation_context is
  'Evaluation Context fuer GENAU EINEN Standort. Alle Fakten gehoeren zu diesem Betrieb; keine Daten eines anderen fliessen ein.';

/* ═══════════════════════════════════════════════════════════════
   2 — BESTEHENDE SIGNATUR BEIBEHALTEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Waehlt den Standort nach der D1-Logik und delegiert.
 *
 * Bestehende Aufrufer brauchen nichts zu aendern. Bei einem Standort
 * ist das Ergebnis fachlich dasselbe wie vorher; bei mehreren ist es
 * erstmals richtig.
 */
create or replace function public.build_evaluation_context(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.build_location_evaluation_context(
           p_user_id, public.werkruf_score_location(p_user_id));
$$;

comment on function public.build_evaluation_context is
  'Evaluation Context des ausgewaehlten Standorts. Delegiert an build_location_evaluation_context.';

revoke all on function public.build_location_evaluation_context(uuid, uuid) from public, anon;
grant execute on function public.build_location_evaluation_context(uuid, uuid) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Kontext je Betrieb — die Zahlen muessen sich unterscheiden:
--   select l.title,
--          public.build_location_evaluation_context(l.user_id, l.id) -> 'reviews' -> 'total' as bewertungen,
--          public.build_location_evaluation_context(l.user_id, l.id) -> 'photoCount'         as fotos,
--          public.build_location_evaluation_context(l.user_id, l.id) -> 'health' -> 'score'  as score
--   from public.google_locations l where l.deleted_at is null;
--
-- Der kanonische Kontext:
--   select jsonb_pretty(public.build_evaluation_context('<user-id>'));
--
-- Ohne Auswahl bei mehreren Betrieben:
--   select public.build_evaluation_context('<user-id>') -> 'locationResolved';
--   → false, und multipleLocations → true
