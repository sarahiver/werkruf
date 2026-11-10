/* ═══════════════════════════════════════════════════════════════
   WP15 — Saison-Beitraege (Google Local Posts, STANDARD)
   ═══════════════════════════════════════════════════════════════

   Die Engine erkennt einen saisonalen Moment (Katalog in
   src/utils/saisonBeitraege.js) und erzeugt EIN Event je
   (Standort, Saison, Saisonjahr). Der Nutzer prueft den vorbereiteten
   Text, passt ihn an und veroeffentlicht bewusst — nie automatisch.

   1  seasonal_posts: Zustand je Veroeffentlichungsversuch.
      draft → publishing → published | failed | rejected
      google_post_name/google_state = Googles Antwort (nur diese Felder,
      kein ganzer Payload, keine Tokens).

   2  Idempotenz/Doppelklick: seasonal_post_begin() legt den Versuch an
      und ist die Sperre — partieller Unique-Index: je (user, location,
      season_key, season_year) hoechstens EINE Zeile in publishing oder
      published. Zweiter Klick → 'laeuft_bereits' / 'bereits_veroeffentlicht'.
      failed/rejected blockieren nicht (erneuter Versuch erlaubt).

   3  build_location_evaluation_context: + seasonalPosts (Kopie der
      WP9-Fassung 20261110150000 mit genau einem neuen Schluessel).
      Damit weiss die Regel, was schon veroeffentlicht ist.

   4  Kein Client-RPC (Kanon): alle Funktionen service_role; RLS
      own-select fuer die UI (Status anzeigen), keine Client-Writes.

   Loeschung: user → cascade, location → cascade (ohne Standort kein
   Beitrag), engine_event_id → set null.

   Idempotent. Keine bestehende Migration geaendert.
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.seasonal_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  location_id      uuid not null references public.google_locations(id) on delete cascade,
  season_key       text not null check (season_key ~ '^[a-z_]{3,40}$'),
  season_year      integer not null check (season_year between 2024 and 2100),
  engine_event_id  uuid references public.events(id) on delete set null,
  google_post_name text,
  summary_snapshot text not null check (length(summary_snapshot) between 1 and 1500),
  status           text not null default 'publishing' check (status in ('draft', 'publishing', 'published', 'failed', 'rejected')),
  google_state     text,
  error_code       text,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  failed_at        timestamptz,
  updated_at       timestamptz not null default now()
);
comment on table public.seasonal_posts is 'WP15 — Veroeffentlichungsversuche saisonaler Google-Beitraege. Nur Status + Googles name/state, kein Payload, keine Tokens.';

create index if not exists seasonal_posts_user_loc_idx on public.seasonal_posts (user_id, location_id, created_at desc);
/* Die Sperre: ein aktiver (publishing/published) Versuch je Saison und Standort. */
create unique index if not exists seasonal_posts_one_active
  on public.seasonal_posts (user_id, location_id, season_key, season_year)
  where status in ('publishing', 'published');

alter table public.seasonal_posts enable row level security;
revoke all on table public.seasonal_posts from public, anon, authenticated;
grant select on table public.seasonal_posts to authenticated;
drop policy if exists seasonal_posts_own on public.seasonal_posts;
create policy seasonal_posts_own on public.seasonal_posts for select to authenticated using (user_id = auth.uid());
grant all on table public.seasonal_posts to service_role;

/* ── Beginn eines Veroeffentlichungsversuchs = Sperre ── */
create or replace function public.seasonal_post_begin(
  p_user_id uuid, p_location_id uuid, p_season_key text, p_season_year integer, p_engine_event_id uuid, p_summary text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; v_status text;
begin
  if not public.has_paid_access(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'kein_zugang');
  end if;
  if not exists (select 1 from public.google_locations l where l.id = p_location_id and l.user_id = p_user_id and l.deleted_at is null) then
    raise exception 'Standort gehoert nicht zum Nutzer' using errcode = '42501';
  end if;
  /* Event, falls angegeben, muss zu Nutzer UND Standort gehoeren (T22) */
  if p_engine_event_id is not null and not exists (
    select 1 from public.events e where e.id = p_engine_event_id and e.user_id = p_user_id and e.location_id = p_location_id) then
    raise exception 'Event gehoert nicht zu diesem Standort' using errcode = '42501';
  end if;
  select status into v_status from public.seasonal_posts
   where user_id = p_user_id and location_id = p_location_id and season_key = p_season_key and season_year = p_season_year
     and status in ('publishing', 'published')
   limit 1;
  if v_status = 'published' then return jsonb_build_object('ok', false, 'reason', 'bereits_veroeffentlicht'); end if;
  if v_status = 'publishing' then return jsonb_build_object('ok', false, 'reason', 'laeuft_bereits'); end if;
  begin
    insert into public.seasonal_posts (user_id, location_id, season_key, season_year, engine_event_id, summary_snapshot, status)
    values (p_user_id, p_location_id, p_season_key, p_season_year, p_engine_event_id, p_summary, 'publishing')
    returning id into v_id;
  exception when unique_violation then
    /* Rennen zweier Klicks: der zweite verliert. */
    return jsonb_build_object('ok', false, 'reason', 'laeuft_bereits');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.seasonal_post_begin(uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.seasonal_post_begin(uuid, uuid, text, integer, uuid, text) to service_role;

/* ── Abschluss mit Googles Antwort ── */
create or replace function public.seasonal_post_finish(
  p_id uuid, p_status text, p_google_post_name text default null, p_google_state text default null, p_error_code text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_status not in ('published', 'failed', 'rejected') then
    raise exception 'ungueltiger Status' using errcode = '22023';
  end if;
  update public.seasonal_posts
     set status = p_status,
         google_post_name = coalesce(p_google_post_name, google_post_name),
         google_state = coalesce(p_google_state, google_state),
         error_code = case when p_status = 'published' then null else left(p_error_code, 120) end,
         published_at = case when p_status = 'published' then now() else published_at end,
         failed_at = case when p_status in ('failed', 'rejected') then now() else failed_at end,
         updated_at = now()
   where id = p_id and status = 'publishing';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.seasonal_post_finish(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.seasonal_post_finish(uuid, text, text, text, text) to service_role;

/* ── Status-Sync (optional, begrenzt): Googles state nachtragen ── */
create or replace function public.seasonal_post_state_update(p_id uuid, p_google_state text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  update public.seasonal_posts
     set google_state = p_google_state,
         status = case when p_google_state = 'REJECTED' then 'rejected' else status end,
         failed_at = case when p_google_state = 'REJECTED' then now() else failed_at end,
         updated_at = now()
   where id = p_id and status = 'published';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.seasonal_post_state_update(uuid, text) from public, anon, authenticated;
grant execute on function public.seasonal_post_state_update(uuid, text) to service_role;

/* ── Kontext mit seasonalPosts ── */
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

    /* WP15 — Saison-Beitraege dieses Standorts: was laeuft oder ist
       veroeffentlicht. Die Regel schlaegt eine Saison nicht erneut vor,
       wenn hier published/publishing fuer (season_key, season_year)
       steht. failed/rejected bleiben vorschlagbar. */
    'seasonalPosts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'seasonKey', sp.season_key, 'seasonYear', sp.season_year, 'status', sp.status, 'googleState', sp.google_state))
        from public.seasonal_posts sp
       where sp.location_id = p_location_id and sp.user_id = p_user_id
         and sp.status in ('publishing', 'published')
    ), '[]'::jsonb),

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


/* ── Selbstpruefung ── */
do $$
declare f text; v_def text;
begin
  foreach f in array array['public.seasonal_post_begin(uuid,uuid,text,integer,uuid,text)', 'public.seasonal_post_finish(uuid,text,text,text,text)', 'public.seasonal_post_state_update(uuid,text)'] loop
    if pg_catalog.has_function_privilege('anon', f, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[wp15] Client-Rollen duerfen % ausfuehren', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp15] service_role darf % nicht', f;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('authenticated', 'public.seasonal_posts', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.seasonal_posts', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.seasonal_posts', 'SELECT') then
    raise exception '[wp15] Client-Rechte auf seasonal_posts';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'seasonal_posts_one_active') then
    raise exception '[wp15] Sperr-Index fehlt';
  end if;
  v_def := pg_catalog.pg_get_functiondef('public.build_location_evaluation_context(uuid,uuid)'::regprocedure);
  if position('seasonalPosts' in v_def) = 0 or position('profileDiffs' in v_def) = 0 or position('''hours''' in v_def) = 0 then
    raise exception '[wp15] Kontext unvollstaendig (seasonalPosts/profileDiffs/hours)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'seasonal_posts'
              and column_name in ('access_token', 'refresh_token', 'google_payload', 'oauth_token')) then
    raise exception '[wp15] Token-/Payload-Spalte in seasonal_posts';
  end if;
  raise notice '[wp15] in Ordnung';
end $$;
