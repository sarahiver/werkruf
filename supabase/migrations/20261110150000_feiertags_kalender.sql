-- WP9 — Feiertags-Kalender: Engine-Kontext um Oeffnungszeiten und
-- Adresse erweitern.
--
-- Feiertage sind deterministisch (src/utils/feiertage.js) — keine
-- Tabelle, keine Cron-Aenderung, keine neue RPC. Die Engine braucht
-- nur die Rohdaten je Standort: regulaere Perioden, Sonderzeiten,
-- storefrontAddress (administrativeArea → Bundesland). Alles liegt
-- bereits in google_locations.google_profile.

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
  perform public.assert_eigener_zugriff(p_user_id);
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

    /* WP8 — offene Profil-Differenzen (Waechter). Nur was der Sync
       zuletzt festgestellt hat; die Engine macht daraus Events. */
    'profileDiffs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id',            d.id,
               'fieldPath',     d.field_path,
               'prio',          d.prio,
               'label',         d.label,
               'changeType',    d.change_type,
               'origin',        d.origin,
               'merchantValue', d.merchant_value,
               'consumerValue', d.consumer_value,
               'firstSeenAt',   d.first_seen_at,
               'lastSeenAt',    d.last_seen_at,
               'rejectionReason', d.rejection_reason)
             order by d.first_seen_at)
        from public.google_profile_diffs d
       where d.location_id = p_location_id
         and d.user_id = p_user_id
         and d.resolved_at is null), '[]'::jsonb),

    /* WP9 — Oeffnungszeiten und Adresse fuer den Feiertags-Check.
       Rohdaten aus google_profile; die Feiertagslogik liegt in
       src/utils/feiertage.js, nicht hier. */
    'hours', pg_catalog.jsonb_build_object(
      'regularPeriods',     coalesce(v_loc.google_profile -> 'regularHours' -> 'periods', '[]'::jsonb),
      'specialHourPeriods', coalesce(v_loc.google_profile -> 'specialHours' -> 'specialHourPeriods', '[]'::jsonb),
      'storefrontAddress',  v_loc.google_profile -> 'storefrontAddress',
      'reliable',           v_loc.last_synced_at is not null and (v_loc.google_profile ? 'regularHours')
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
  if sqlstate = '42501' then raise; end if;
  /* Fehlt eine Spalte oder Tabelle, soll der Engine-Lauf nicht
     vollstaendig ausfallen. */
  return pg_catalog.jsonb_build_object(
    'userId', p_user_id, 'now', pg_catalog.now(),
    'locationResolved', false, 'reason', 'fehler', 'error', sqlerrm);
end;
$function$;

do $$
declare v_def text;
begin
  v_def := pg_catalog.pg_get_functiondef('public.build_location_evaluation_context(uuid,uuid)'::regprocedure);
  if position('specialHourPeriods' in v_def) = 0 or position('storefrontAddress' in v_def) = 0 then
    raise exception '[wp9] Kontext ohne hours-Block';
  end if;
  if position('profileDiffs' in v_def) = 0 then
    raise exception '[wp9] WP8-profileDiffs verloren';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.build_location_evaluation_context(uuid,uuid)', 'EXECUTE') then
    raise exception '[wp9] anon darf den Kontext bauen';
  end if;
  raise notice '[wp9] in Ordnung';
end $$;
