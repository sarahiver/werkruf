--
-- PostgreSQL database dump
--

\restrict mS63Y1RRGbPwxbzcoSdlyXdvaOu7eePgngjCVeMwBBcbcm3zqwGlR2gmAv7jrSW

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: anonymise_user_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anonymise_user_on_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Anonymise leads (keep for analytics, remove PII)
  UPDATE leads
  SET
    email          = 'deleted@werkruf.com',
    contact_person = 'Gelöschter Nutzer',
    phone          = '-',
    status         = 'deleted'
  WHERE email = OLD.email;

  -- business_photos cascade via FK ON DELETE CASCADE
  -- user_profiles cascade via FK ON DELETE CASCADE
  -- ai_usage_log cascade via FK ON DELETE CASCADE

  RETURN OLD;
END;
$$;


--
-- Name: begin_sync_run(text, text, interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_sync_run(p_worker text, p_trigger text DEFAULT 'cron'::text, p_ttl interval DEFAULT '00:10:00'::interval) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run_id uuid;
begin
  if not public.try_acquire_lock('sync_worker', p_worker, p_ttl) then
    -- Übersprungene Läufe werden protokolliert, aber ohne Sperre.
    -- Häufen sie sich, ist die Taktung zu eng oder ein Lauf hängt.
    insert into public.sync_runs (worker_id, trigger, status, finished_at, duration_ms)
    values (p_worker, p_trigger, 'skipped', now(), 0);
    return null;
  end if;

  insert into public.sync_runs (worker_id, trigger, status)
  values (p_worker, p_trigger, 'running')
  returning id into v_run_id;

  return v_run_id;
end;
$$;


--
-- Name: build_evaluation_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_evaluation_context(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx jsonb;
begin
  select jsonb_build_object(
    'userId', p_user_id,
    'now',    now(),

    'connection', (
      select jsonb_build_object(
        'status',        a.status,
        'providerEmail', a.provider_email,
        'lastErrorAt',   a.last_error_at,
        'lastErrorCode', a.last_error_code,
        'connectedAt',   a.connected_at
      )
      from public.google_accounts a
      where a.user_id = p_user_id and a.deleted_at is null
      order by case a.status when 'active' then 0 else 1 end, a.connected_at
      limit 1
    ),

    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',            l.id,
        'title',         l.title,
        'locality',      l.locality,
        'phone',         l.primary_phone,
        'website',       l.website_uri,
        'category',      l.primary_category,
        'lastSyncedAt',  l.last_synced_at,
        'reviewCount',   l.review_count,
        'averageRating', l.average_rating
      ))
      from public.google_locations l
      where l.user_id = p_user_id and l.deleted_at is null
    ), '[]'::jsonb),

    'reviews', (
      select jsonb_build_object(
        'total',       count(*),
        'unanswered',  count(*) filter (where not is_answered),
        'averageRating', round(avg(star_rating)::numeric, 1),
        'newestAt',    max(google_created_at),
        'last7d',      count(*) filter (where google_created_at > now() - interval '7 days'),
        'last30d',     count(*) filter (where google_created_at > now() - interval '30 days')
      )
      from public.google_reviews
      where user_id = p_user_id and status = 'active'
    ),

    /* Die schlechten Bewertungen einzeln — für jede entsteht ein
       eigenes Ereignis. Gedeckelt, damit ein Betrieb mit hundert
       Ein-Stern-Bewertungen nicht hundert Ereignisse erzeugt; die
       Engine bündelt sie ohnehin. */
    'lowRatedOpen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',        r.id,
        'rating',    r.star_rating,
        'createdAt', r.google_created_at,
        'reviewer',  r.reviewer_display_name,
        'locationId', r.location_id
      ) order by r.google_created_at desc)
      from (
        select * from public.google_reviews
        where user_id = p_user_id and status = 'active'
          and not is_answered and star_rating <= 2
        order by google_created_at desc
        limit 10
      ) r
    ), '[]'::jsonb),

    'replies', (
      select jsonb_build_object(
        'draft',     count(*) filter (where status = 'draft'),
        'approved',  count(*) filter (where status in ('approved', 'publishing')),
        'published', count(*) filter (where status = 'published'),
        'failed',    count(*) filter (where status = 'failed')
      )
      from public.review_replies
      where user_id = p_user_id and deleted_at is null
    ),

    'photoCount', (
      select count(*) from public.business_photos where profile_id = p_user_id
    ),

    'health', public.compute_health_score(p_user_id),

    'previousHealth', (
      select health_score from public.weekly_snapshots
      where user_id = p_user_id
      order by week_start desc offset 1 limit 1
    ),

    'syncFailed', exists (
      select 1 from public.sync_jobs
      where user_id = p_user_id and status = 'failed'
        and finished_at > now() - interval '24 hours'
    )
  ) into v_ctx;

  return v_ctx;
end;
$$;


--
-- Name: check_rate_limit(text, integer, interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rate_limit(p_key text, p_limit integer, p_window interval DEFAULT '01:00:00'::interval) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
  v_start timestamptz;
begin
  insert into public.rate_limits (key, window_start, request_count, updated_at)
  values (p_key, now(), 1, now())
  on conflict (key) do update
     set request_count = case
           when public.rate_limits.window_start < now() - p_window then 1
           else public.rate_limits.request_count + 1
         end,
         window_start = case
           when public.rate_limits.window_start < now() - p_window then now()
           else public.rate_limits.window_start
         end,
         updated_at = now()
  returning request_count, window_start into v_count, v_start;

  return jsonb_build_object(
    'allowed',   v_count <= p_limit,
    'count',     v_count,
    'limit',     p_limit,
    'resetsAt',  v_start + p_window
  );
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    to_email text NOT NULL,
    to_name text,
    template text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    sent_at timestamp with time zone,
    provider_id text,
    error_code text,
    error_message text,
    locked_by text,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_queue_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT email_queue_template_check CHECK ((template = ANY (ARRAY['welcome'::text, 'trial_reminder'::text, 'trial_ended'::text, 'connection_broken'::text, 'weekly_report'::text, 'weekly_summary'::text, 'visibility_report'::text, 'critical_review_alert'::text, 'inactivity_reminder'::text])))
);


--
-- Name: TABLE email_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_queue IS 'Ausgangswarteschlange. dedupe_key verhindert Doppelversand auf Datenbankebene.';


--
-- Name: claim_emails(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_emails(p_worker text, p_limit integer DEFAULT 20) RETURNS SETOF public.email_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select id from public.email_queue
     where status = 'queued' and scheduled_for <= now()
     order by scheduled_for
     limit p_limit
     for update skip locked
  )
  update public.email_queue e
     set status = 'sending', attempts = e.attempts + 1,
         locked_by = p_worker, locked_at = now()
    from candidates c
   where e.id = c.id
  returning e.*;
end;
$$;


--
-- Name: review_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    location_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    source text DEFAULT 'ai'::text NOT NULL,
    model text,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp with time zone,
    error_code text,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT review_replies_body_check CHECK ((length(btrim(body)) > 0)),
    CONSTRAINT review_replies_published_has_timestamp CHECK (((status <> 'published'::text) OR (published_at IS NOT NULL))),
    CONSTRAINT review_replies_source_check CHECK ((source = ANY (ARRAY['ai'::text, 'human'::text, 'template'::text]))),
    CONSTRAINT review_replies_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'publishing'::text, 'published'::text, 'failed'::text])))
);


--
-- Name: claim_reply_for_publishing(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_reply_for_publishing(p_reply_id uuid) RETURNS public.review_replies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_reply public.review_replies;
begin
  update public.review_replies
     set status = 'publishing', updated_at = now()
   where id = p_reply_id
     and status = 'approved'
     and deleted_at is null
  returning * into v_reply;

  -- Kein Fehler, wenn nichts passiert — der Aufrufer entscheidet.
  -- Häufigster Grund ist ein Doppelklick, und der ist harmlos.
  return v_reply;
end;
$$;


--
-- Name: sync_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    account_id uuid,
    location_id uuid,
    job_type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    priority smallint DEFAULT 100 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error_code text,
    error_message text,
    locked_by text,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_jobs_job_type_check CHECK ((job_type = ANY (ARRAY['sync_locations'::text, 'sync_reviews'::text, 'sync_insights'::text, 'publish_reply'::text, 'update_profile'::text, 'refresh_token'::text]))),
    CONSTRAINT sync_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: claim_sync_jobs(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_sync_jobs(p_worker text, p_limit integer DEFAULT 5) RETURNS SETOF public.sync_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select id
      from public.sync_jobs
     where status = 'queued'
       and scheduled_for <= now()
     order by priority, scheduled_for
     limit p_limit
     for update skip locked
  )
  update public.sync_jobs j
     set status    = 'running',
         attempts  = j.attempts + 1,
         locked_by = p_worker,
         locked_at = now(),
         started_at = coalesce(j.started_at, now())
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;


--
-- Name: cleanup_expired_oauth_states(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_oauth_states() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  delete from public.google_oauth_states where expires_at < now();
$$;


--
-- Name: cleanup_stripe_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_stripe_events() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from public.stripe_events
   where received_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


--
-- Name: complete_recommendations_for(uuid, text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_recommendations_for(p_user_id uuid, p_types text[], p_subject_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.events
     where user_id = p_user_id
       and type = any(p_types)
       and lifecycle in ('new', 'seen', 'opened')
       and (p_subject_id is null or subject_id = p_subject_id)
  loop
    perform public.record_recommendation_action(v_id, 'completed', 'dashboard', p_user_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


--
-- Name: complete_reply_publication(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_reply_publication(p_reply_id uuid, p_published_at timestamp with time zone DEFAULT now()) RETURNS public.review_replies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_reply public.review_replies;
begin
  update public.review_replies
     set status = 'published',
         published_at = p_published_at,
         error_code = null,
         error_message = null
   where id = p_reply_id
     and status = 'publishing'
  returning * into v_reply;

  if not found then
    raise exception 'Antwort % war nicht im Status publishing', p_reply_id
      using errcode = 'invalid_parameter_value';
  end if;

  update public.google_reviews
     set is_answered = true,
         answered_at = p_published_at
   where id = v_reply.review_id;

  return v_reply;
end;
$$;


--
-- Name: completed_this_week(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.completed_this_week(p_user_id uuid, p_since timestamp with time zone DEFAULT (now() - '7 days'::interval)) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', title, 'category', category) order by completed_at desc), '[]'::jsonb)
    from public.events
   where user_id = p_user_id
     and lifecycle = 'completed'
     and completed_at >= p_since;
$$;


--
-- Name: compute_health_score(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_health_score(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  select count(*),
         count(*) filter (where not is_answered),
         round(avg(star_rating)::numeric, 1),
         max(google_created_at)
    into v_total, v_unanswered, v_rating, v_newest
    from public.google_reviews
   where user_id = p_user_id and status = 'active';

  /* Antwortquote — 30 Punkte */
  if v_total > 0 then
    v_response := round(((v_total - v_unanswered)::numeric / v_total) * 30);
  end if;

  /* Bewertung — 25 Punkte, linear von 3,0 bis 5,0 */
  if v_rating is not null then
    v_rating_pts := round(greatest(0, least(1, (v_rating - 3) / 2)) * 25);
  end if;

  /* Aktualität — 20 Punkte, gestuft */
  if v_newest is not null then
    v_days := extract(day from (now() - v_newest))::integer;
    v_recency := case
      when v_days <= 30  then 20
      when v_days <= 90  then 14
      when v_days <= 180 then 8
      else 0
    end;
  end if;

  /* Vollständigkeit — 15 Punkte, vier Felder */
  select primary_phone, website_uri, locality, primary_category
    into v_loc
    from public.google_locations
   where user_id = p_user_id and deleted_at is null
   order by is_primary desc, created_at
   limit 1;

  if found then
    v_fields := 4;
    v_filled :=
      (case when v_loc.primary_phone    is not null then 1 else 0 end) +
      (case when v_loc.website_uri      is not null then 1 else 0 end) +
      (case when v_loc.locality         is not null then 1 else 0 end) +
      (case when v_loc.primary_category is not null then 1 else 0 end);
    v_complete := round((v_filled::numeric / v_fields) * 15);
  end if;

  /* Fotos — 10 Punkte, fünf als Ziel */
  select count(*) into v_photos
    from public.business_photos where profile_id = p_user_id;
  v_photo_pts := round(least(v_photos::numeric / 5, 1) * 10);

  return jsonb_build_object(
    'score', v_response + v_rating_pts + v_recency + v_complete + v_photo_pts,
    'factors', jsonb_build_object(
      'responseRate', v_response, 'rating', v_rating_pts,
      'recency', v_recency, 'completeness', v_complete, 'photos', v_photo_pts
    ),
    'reviewsTotal',  coalesce(v_total, 0),
    'unanswered',    coalesce(v_unanswered, 0),
    'averageRating', v_rating,
    'newestReviewAt', v_newest,
    'photoCount',    coalesce(v_photos, 0)
  );
exception when others then
  -- Fehlt eine Tabelle (z.B. business_photos), soll der Wochenlauf
  -- nicht komplett ausfallen.
  return jsonb_build_object('score', 0, 'factors', '{}'::jsonb, 'error', sqlerrm);
end;
$$;


--
-- Name: google_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider_account_id text NOT NULL,
    provider_email text,
    granted_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_refreshed_at timestamp with time zone,
    last_error_code text,
    last_error_at timestamp with time zone,
    refresh_failure_count integer DEFAULT 0 NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text DEFAULT 'google'::text NOT NULL,
    deleted_at timestamp with time zone,
    confirmation_token text,
    confirmation_expires_at timestamp with time zone,
    CONSTRAINT google_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'needs_reauth'::text, 'revoked'::text, 'disconnected'::text])))
);


--
-- Name: TABLE google_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.google_accounts IS 'Verknüpfte Google-Konten. Enthält KEINE Tokens — die liegen in oauth_tokens.';


--
-- Name: COLUMN google_accounts.confirmation_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.google_accounts.confirmation_token IS 'Einmal-Token. Nur ein authentifizierter Aufruf mit passender user_id aktiviert die Verbindung.';


--
-- Name: confirm_google_account(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_google_account(p_token text, p_user_id uuid) RETURNS public.google_accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_account public.google_accounts;
begin
  update public.google_accounts
     set status = 'active',
         confirmation_token = null,
         confirmation_expires_at = null
   where confirmation_token = p_token
     and user_id = p_user_id
     and status = 'pending'
     and confirmation_expires_at > now()
  returning * into v_account;

  return v_account;   -- null = Token unbekannt, abgelaufen oder fremd
end;
$$;


--
-- Name: enqueue_email(text, text, text, uuid, text, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_email(p_template text, p_to_email text, p_dedupe_key text, p_user_id uuid DEFAULT NULL::uuid, p_to_name text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_scheduled_for timestamp with time zone DEFAULT now()) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_id uuid;
begin
  if p_to_email is null or p_to_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Ungültige Empfängeradresse' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.email_queue (
    template, to_email, to_name, dedupe_key, user_id, payload, scheduled_for
  )
  values (
    p_template, lower(trim(p_to_email)), p_to_name, p_dedupe_key, p_user_id, p_payload, p_scheduled_for
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;   -- null = bereits eingereiht oder verschickt
end;
$_$;


--
-- Name: enqueue_sync_job(text, uuid, uuid, uuid, jsonb, smallint, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_sync_job(p_job_type text, p_user_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_priority smallint DEFAULT 100, p_scheduled_for timestamp with time zone DEFAULT now()) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if p_job_type = 'publish_reply' then
    if p_payload ->> 'replyId' is null then
      raise exception 'publish_reply benötigt payload.replyId'
        using errcode = 'invalid_parameter_value';
    end if;

    insert into public.sync_jobs (
      job_type, user_id, account_id, location_id, payload, priority, scheduled_for
    )
    values (
      p_job_type, p_user_id, p_account_id, p_location_id, p_payload, p_priority, p_scheduled_for
    )
    on conflict (job_type, (payload ->> 'replyId'))
      where status in ('queued', 'running') and job_type = 'publish_reply'
      do nothing
    returning id into v_id;

  elsif p_location_id is not null
        and p_job_type in ('sync_reviews', 'sync_locations', 'sync_insights') then

    insert into public.sync_jobs (
      job_type, user_id, account_id, location_id, payload, priority, scheduled_for
    )
    values (
      p_job_type, p_user_id, p_account_id, p_location_id, p_payload, p_priority, p_scheduled_for
    )
    on conflict (job_type, location_id)
      where status in ('queued', 'running')
        and location_id is not null
        and job_type in ('sync_reviews', 'sync_locations', 'sync_insights')
      do nothing
    returning id into v_id;

  else
    -- Alles Übrige ohne Deduplizierung.
    insert into public.sync_jobs (
      job_type, user_id, account_id, location_id, payload, priority, scheduled_for
    )
    values (
      p_job_type, p_user_id, p_account_id, p_location_id, p_payload, p_priority, p_scheduled_for
    )
    returning id into v_id;
  end if;

  return v_id;   -- null = es lief schon einer
end;
$$;


--
-- Name: explain_recommendation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.explain_recommendation(p_event_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id, 'type', e.type, 'title', e.title,
      'priority', e.priority, 'confidence', e.confidence,
      'createdAt', e.created_at, 'lifecycle', e.lifecycle,
      'generation', e.generation
    ),
    'rule', jsonb_build_object(
      'id', e.rule_id, 'version', e.rule_version, 'status', e.rule_status
    ),
    'explanation', e.explanation,
    'engine', (
      select jsonb_build_object(
        'version', v.version, 'releasedAt', v.released_at,
        'changes', v.changes, 'rationale', v.rationale
      )
      from public.engine_versions v where v.version = e.engine_version
    ),
    'impact', case when e.impact_metric is null then null else jsonb_build_object(
      'metric', e.impact_metric, 'baseline', e.impact_baseline,
      'value', e.impact_value, 'delta', e.impact_delta,
      'measuredAt', e.impact_measured_at
    ) end,
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', r.action, 'channel', r.channel, 'at', r.occurred_at
      ) order by r.occurred_at), '[]'::jsonb)
      from public.recommendation_events r where r.event_id = e.id
    )
  )
  from public.events e
  where e.id = p_event_id;
$$;


--
-- Name: fail_reply_publication(uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_reply_publication(p_reply_id uuid, p_error_code text, p_error_message text, p_permanent boolean DEFAULT false) RETURNS public.review_replies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_reply public.review_replies;
begin
  update public.review_replies
     set status = case when p_permanent then 'failed' else 'approved' end,
         error_code = p_error_code,
         error_message = left(p_error_message, 2000)
   where id = p_reply_id
     and status = 'publishing'
  returning * into v_reply;

  return v_reply;
end;
$$;


--
-- Name: finish_email(uuid, boolean, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_email(p_id uuid, p_success boolean, p_provider_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row public.email_queue;
begin
  select * into v_row from public.email_queue where id = p_id for update;
  if not found then return; end if;

  if p_success then
    update public.email_queue
       set status = 'sent', sent_at = now(), provider_id = p_provider_id,
           error_code = null, error_message = null, locked_by = null, locked_at = null
     where id = p_id;

  elsif v_row.attempts >= v_row.max_attempts then
    update public.email_queue
       set status = 'failed', error_code = p_error_code,
           error_message = left(p_error_message, 1000),
           locked_by = null, locked_at = null
     where id = p_id;

  else
    -- Zurück in die Schlange, mit wachsendem Abstand.
    update public.email_queue
       set status = 'queued',
           scheduled_for = now() + (power(v_row.attempts, 2) * interval '5 minutes'),
           error_code = p_error_code, error_message = left(p_error_message, 1000),
           locked_by = null, locked_at = null
     where id = p_id;
  end if;
end;
$$;


--
-- Name: finish_sync_job(uuid, boolean, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_sync_job(p_job_id uuid, p_success boolean, p_result jsonb DEFAULT NULL::jsonb, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text) RETURNS public.sync_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_job public.sync_jobs;
begin
  select * into v_job from public.sync_jobs where id = p_job_id for update;
  if not found then
    raise exception 'sync_job % nicht gefunden', p_job_id using errcode = 'no_data_found';
  end if;

  if p_success then
    update public.sync_jobs
       set status = 'succeeded', finished_at = now(), result = p_result,
           error_code = null, error_message = null,
           locked_by = null, locked_at = null
     where id = p_job_id
    returning * into v_job;

  elsif v_job.attempts >= v_job.max_attempts then
    update public.sync_jobs
       set status = 'failed', finished_at = now(),
           error_code = p_error_code, error_message = left(p_error_message, 2000),
           locked_by = null, locked_at = null
     where id = p_job_id
    returning * into v_job;

  else
    -- Zurück in die Schlange. 1 Min, 4 Min, 9 Min, … quadratisch.
    update public.sync_jobs
       set status = 'queued',
           scheduled_for = now() + (power(v_job.attempts, 2) * interval '1 minute'),
           error_code = p_error_code, error_message = left(p_error_message, 2000),
           locked_by = null, locked_at = null
     where id = p_job_id
    returning * into v_job;
  end if;

  return v_job;
end;
$$;


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    trigger text DEFAULT 'cron'::text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    duration_ms integer,
    claimed integer DEFAULT 0 NOT NULL,
    succeeded integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    error_code text,
    error_message text,
    details jsonb,
    CONSTRAINT sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'skipped'::text]))),
    CONSTRAINT sync_runs_trigger_check CHECK ((trigger = ANY (ARRAY['cron'::text, 'manual'::text, 'api'::text])))
);


--
-- Name: finish_sync_run(uuid, text, integer, integer, integer, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_sync_run(p_run_id uuid, p_worker text, p_claimed integer DEFAULT 0, p_succeeded integer DEFAULT 0, p_failed integer DEFAULT 0, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_details jsonb DEFAULT NULL::jsonb) RETURNS public.sync_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run public.sync_runs;
begin
  update public.sync_runs
     set status      = case when p_error_code is null then 'completed' else 'failed' end,
         finished_at = now(),
         duration_ms = (extract(epoch from (now() - started_at)) * 1000)::integer,
         claimed     = p_claimed,
         succeeded   = p_succeeded,
         failed      = p_failed,
         error_code  = p_error_code,
         error_message = left(p_error_message, 2000),
         details     = p_details
   where id = p_run_id
  returning * into v_run;

  -- Sperre auch dann freigeben, wenn die Zeile fehlt: sonst bliebe
  -- der Worker bis zum TTL blockiert.
  perform public.release_lock('sync_worker', p_worker);

  return v_run;
end;
$$;


--
-- Name: get_engine_thresholds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_engine_thresholds() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from public.engine_thresholds;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    full_name,
    industry_key,
    google_place_id,
    company_name,
    visibility_score,
    trial_started_at,
    trial_ends_at
  ) VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'industry_key', 'handwerk'),
    NEW.raw_user_meta_data->>'google_place_id',
    NEW.raw_user_meta_data->>'company_name',
    CASE WHEN NEW.raw_user_meta_data->>'visibility_score' IS NOT NULL
         THEN (NEW.raw_user_meta_data->>'visibility_score')::INTEGER
         ELSE NULL
    END,
    NOW(),
    NOW() + INTERVAL '30 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: is_in_cooldown(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_in_cooldown(p_user_id uuid, p_type text, p_subject_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.events
     where user_id = p_user_id
       and type = p_type
       and subject_id is not distinct from p_subject_id
       and cooldown_until is not null
       and cooldown_until > now()
  );
$$;


--
-- Name: last_email_sent(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.last_email_sent(p_user_id uuid, p_template text) RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select max(created_at)
    from public.email_queue
   where user_id = p_user_id
     and template = p_template
     and status in ('queued', 'sending', 'sent');
$$;


--
-- Name: mark_events_delivered(uuid[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_events_delivered(p_event_ids uuid[], p_channel text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_count integer;
begin
  update public.events
     set delivered = delivered || jsonb_build_object(p_channel, now())
   where id = any(p_event_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: mark_recommendations_seen(uuid[], text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_recommendations_seen(p_event_ids uuid[], p_channel text DEFAULT 'dashboard'::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  foreach v_id in array p_event_ids loop
    begin
      perform public.record_recommendation_action(v_id, 'seen', p_channel, p_user_id);
      v_count := v_count + 1;
    exception when others then
      -- Eine fehlende Empfehlung darf den Rest nicht aufhalten.
      null;
    end;
  end loop;
  return v_count;
end;
$$;


--
-- Name: measure_recommendation_impact(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.measure_recommendation_impact(p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row     record;
  v_value   numeric;
  v_count   integer := 0;
  v_cutoff  timestamptz := coalesce(p_after, now() - interval '7 days');
begin
  for v_row in
    select id, user_id, impact_metric, impact_baseline
      from public.events
     where impact_metric is not null
       and impact_measured_at is null
       and completed_at is not null
       and completed_at < v_cutoff
     order by completed_at
     limit p_limit
  loop
    v_value := public.read_impact_metric(v_row.user_id, v_row.impact_metric);

    update public.events
       set impact_value = v_value,
           impact_delta = case when v_value is not null and v_row.impact_baseline is not null
                               then v_value - v_row.impact_baseline end,
           impact_measured_at = now()
     where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: on_user_confirmed_send_welcome(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_user_confirmed_send_welcome() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_industry text;
  v_company  text;
  v_name     text;
begin
  -- Nur wenn die Adresse gerade erst bestätigt wurde.
  if new.email_confirmed_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

  if new.email is null then
    return new;
  end if;

  -- Aus den Signup-Metadaten, die Signup.js mitgibt. Fehlt etwas,
  -- greifen in der Vorlage die Standardwerte.
  v_industry := coalesce(new.raw_user_meta_data ->> 'industry_key', 'handwerk');
  v_company  := new.raw_user_meta_data ->> 'company_name';
  v_name     := coalesce(new.raw_user_meta_data ->> 'full_name',
                         new.raw_user_meta_data ->> 'name');

  /*
   * Fehler dürfen die Registrierung NIEMALS scheitern lassen.
   * Der Trigger hängt an auth.users — eine Ausnahme hier würde das
   * INSERT zurückrollen und den Nutzer aussperren. Eine nicht
   * verschickte Willkommensmail ist dagegen ein Schönheitsfehler.
   */
  begin
    perform public.enqueue_email(
      'welcome',
      new.email,
      'welcome:' || new.id,
      new.id,
      v_name,
      jsonb_build_object('industryKey', v_industry, 'companyName', v_company),
      -- Zwei Minuten Versatz: die Bestätigungsmail von Supabase soll
      -- zuerst ankommen.
      now() + interval '2 minutes'
    );
  exception when others then
    raise warning 'Willkommensmail nicht einreihbar für %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;


--
-- Name: ops_alert_mark_sent(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_alert_mark_sent(p_keys text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  update public.ops_alert_log
     set last_sent_at = now(),
         send_count   = send_count + 1
   where alert_key = any(p_keys);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: ops_alerts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_alerts() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'cron', 'net'
    AS $$
declare
  v_alerts jsonb := '[]'::jsonb;
  v_count  bigint;
  v_detail jsonb;
  v_http_jobs bigint;
begin

  /* ── 1. Fehlgeschlagene Cronjobs ── */
  select count(*), jsonb_agg(to_jsonb(f))
    into v_count, v_detail
  from public.ops_cron_failures(60) f;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'cron.failed',
      'severity', 'critical',
      'title',    v_count || ' Cronjob-Fehlschlaege in der letzten Stunde',
      'detail',   v_detail
    );
  end if;

  /* ── 2. Platzhalter in Cron-Kommandos ── */
  select count(*), jsonb_agg(to_jsonb(p))
    into v_count, v_detail
  from public.ops_placeholder_check() p;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'cron.placeholder',
      'severity', 'critical',
      'title',    'Nicht ersetzte Platzhalter in ' || v_count || ' Cron-Kommando(s)',
      'detail',   v_detail
    );
  end if;

  /* ── 2b. NEU: Fehlerhafte HTTP-Antworten ──
     Die Luecke, die beim Test von 020 auffiel. pg_cron sieht nur, ob
     der Request eingereiht wurde — nicht, was zurueckkam. Ein 401 aus
     falschem Worker-Secret oder ein 404 aus falscher URL bleibt sonst
     unsichtbar, beliebig lange.

     Schwelle bei 3: Ein einzelner 5xx von Google ist Alltag und wird
     wiederholt. Drei Fehler in einer Stunde sind ein Muster. */
  select count(*), jsonb_agg(to_jsonb(e))
    into v_count, v_detail
  from public.ops_http_errors(60) e;

  if coalesce((select sum(anzahl) from public.ops_http_errors(60)), 0) >= 3 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'net.errors',
      'severity', 'critical',
      'title',    (select sum(anzahl) from public.ops_http_errors(60))
                  || ' fehlerhafte HTTP-Antworten in der letzten Stunde',
      'detail',   jsonb_build_object(
                    'codes',   v_detail,
                    'hinweis', '401 = Worker-Secret, 404 = Function fehlt oder URL falsch, 403/429 = Google-Quota.',
                    'pruefen', 'select id, status_code, created, content from net._http_response order by id desc limit 20;'
                  )
    );
  end if;

  /* ── 3. Stille bei pg_net ── */
  select count(*) into v_http_jobs
  from cron.job
  where active and command like '%net.http_%';

  if v_http_jobs > 0 then
    select count(*) into v_count
    from net._http_response
    where created > now() - interval '30 minutes';

    if coalesce(v_count, 0) = 0 then
      v_alerts := v_alerts || jsonb_build_object(
        'key',      'net.silent',
        'severity', 'critical',
        'title',    'Seit 30 Minuten keine HTTP-Antwort, obwohl ' || v_http_jobs || ' Jobs feuern',
        'detail',   jsonb_build_object(
                      'hinweis', 'Genau das Muster des Ausfalls vom 9.-11.09.2026.',
                      'pruefen', 'select jobname, status, return_message from cron.job_run_details d join cron.job j on j.jobid=d.jobid order by start_time desc limit 20;'
                    )
      );
    end if;
  end if;

  /* ── 4. Worker laeuft nicht ── */
  select count(*) into v_count
  from public.sync_runs
  where started_at > now() - interval '60 minutes';

  if coalesce(v_count, 0) = 0
     and exists (select 1 from cron.job where jobname = 'gbp-worker' and active) then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'worker.stalled',
      'severity', 'critical',
      'title',    'Seit einer Stunde kein Worker-Lauf',
      'detail',   jsonb_build_object(
                    'letzter_lauf', (select max(started_at) from public.sync_runs)
                  )
    );
  end if;

  /* ── 5. Sync-Jobs endgueltig gescheitert ──
     rate_limited ausgenommen: Normalzustand, solange die Google-APIs
     nicht freigegeben sind. SOBALD GOOGLE FREIGIBT, DIESE ZEILE
     ENTFERNEN — dann ist rate_limited wieder ein echtes Signal. */
  select count(*), jsonb_agg(jsonb_build_object(
           'id', id, 'typ', job_type, 'versuche', attempts,
           'code', error_code, 'meldung', left(error_message, 200)))
    into v_count, v_detail
  from public.sync_jobs
  where attempts >= max_attempts
    and status <> 'succeeded'
    and coalesce(error_code, '') <> 'rate_limited'
    and updated_at > now() - interval '24 hours';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'sync.exhausted',
      'severity', 'warning',
      'title',    v_count || ' Sync-Job(s) endgueltig gescheitert',
      'detail',   v_detail
    );
  end if;

  /* ── 6. Mail-Warteschlange ── */
  select count(*), jsonb_agg(jsonb_build_object(
           'template', template, 'status', status, 'versuche', attempts,
           'code', error_code, 'seit', created_at))
    into v_count, v_detail
  from public.email_queue
  where (
          status = 'failed'
          or (status = 'queued'
              and coalesce(scheduled_for, created_at) < now() - interval '60 minutes')
        )
    and created_at > now() - interval '7 days';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'mail.stuck',
      'severity', 'warning',
      'title',    v_count || ' Mail(s) haengen in der Warteschlange',
      'detail',   v_detail
    );
  end if;

  /* ── 7. Google-Verbindungen kaputt ── */
  select count(*), jsonb_agg(jsonb_build_object(
           'konto', id, 'status', status, 'code', last_error_code,
           'seit', last_error_at))
    into v_count, v_detail
  from public.google_accounts
  where status in ('needs_reauth', 'revoked')
    and deleted_at is null;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'gbp.reauth',
      'severity', 'warning',
      'title',    v_count || ' Google-Verbindung(en) muessen erneuert werden',
      'detail',   v_detail
    );
  end if;

  /* ── 8. Stripe-Events unverarbeitet ── */
  if to_regclass('public.stripe_events') is not null then
    select count(*), jsonb_agg(jsonb_build_object(
             'id', id, 'typ', type, 'seit', received_at,
             'fehler', left(error_message, 200)))
      into v_count, v_detail
    from public.stripe_events
    where processed_at is null
      and received_at < now() - interval '15 minutes'
      and received_at > now() - interval '7 days';

    if coalesce(v_count, 0) > 0 then
      v_alerts := v_alerts || jsonb_build_object(
        'key',      'stripe.unprocessed',
        'severity', 'critical',
        'title',    v_count || ' Stripe-Event(s) unverarbeitet',
        'detail',   v_detail
      );
    end if;
  end if;

  return v_alerts;
end;
$$;


--
-- Name: FUNCTION ops_alerts(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ops_alerts() IS 'Alle Betriebspruefungen in einem Aufruf. Leeres Array = alles in Ordnung.';


--
-- Name: ops_alerts_pending(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_alerts_pending(p_cooldown interval DEFAULT '01:00:00'::interval) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_all     jsonb := public.ops_alerts();
  v_pending jsonb := '[]'::jsonb;
  v_item    jsonb;
  v_key     text;
  v_last    timestamptz;
begin
  for v_item in select * from jsonb_array_elements(v_all)
  loop
    v_key := v_item ->> 'key';

    -- Stummgeschaltet?
    if exists (
      select 1 from public.ops_alert_mutes m
       where m.alert_key = v_key
         and (m.muted_until is null or m.muted_until > now())
    ) then
      continue;
    end if;

    select last_sent_at into v_last
      from public.ops_alert_log where alert_key = v_key;

    if v_last is null or v_last < now() - p_cooldown then
      v_pending := v_pending || v_item;
    end if;

    -- Erstsichtung immer festhalten, auch wenn noch nicht gemeldet.
    insert into public.ops_alert_log (alert_key, last_detail)
    values (v_key, v_item -> 'detail')
    on conflict (alert_key) do update set last_detail = excluded.last_detail;
  end loop;

  return v_pending;
end;
$$;


--
-- Name: FUNCTION ops_alerts_pending(p_cooldown interval); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ops_alerts_pending(p_cooldown interval) IS 'Alarme, die jetzt gemeldet werden sollen. Beruecksichtigt Stummschaltung und Entprellung.';


--
-- Name: ops_cron_failures(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_cron_failures(p_minutes integer DEFAULT 60) RETURNS TABLE(jobname text, fehlschlaege bigint, letzter timestamp with time zone, meldung text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'cron'
    AS $$
  select
    j.jobname::text,
    count(*)                       as fehlschlaege,
    max(d.start_time)              as letzter,
    -- Nur die juengste Meldung, gekuerzt. Zwanzig identische Texte
    -- helfen niemandem.
    left((array_agg(d.return_message order by d.start_time desc))[1], 300) as meldung
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where d.status = 'failed'
    and d.start_time > now() - make_interval(mins => p_minutes)
  group by j.jobname
  order by count(*) desc;
$$;


--
-- Name: FUNCTION ops_cron_failures(p_minutes integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ops_cron_failures(p_minutes integer) IS 'Fehlgeschlagene Cron-Laeufe im Zeitfenster. Das Signal, das beim Ausfall vom 9.-11.09. als einziges vorhanden war.';


--
-- Name: ops_health_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_health_check() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_last_run       timestamptz;
  v_stale_runs     integer;
  v_overdue_jobs   integer;
  v_broken_accts   integer;
  v_total_accts    integer;
  v_stuck_replies  integer;
  v_problems       text[] := '{}';
begin
  select max(started_at) into v_last_run
    from public.sync_runs where status in ('completed', 'running');

  select count(*) into v_overdue_jobs
    from public.sync_jobs
   where status = 'queued' and scheduled_for < now() - interval '30 minutes';

  select count(*) into v_stale_runs
    from public.sync_runs
   where status = 'running' and started_at < now() - interval '15 minutes';

  select count(*) filter (where status in ('needs_reauth', 'revoked')),
         count(*)
    into v_broken_accts, v_total_accts
    from public.google_accounts where deleted_at is null;

  select count(*) into v_stuck_replies
    from public.review_replies
   where status = 'publishing' and updated_at < now() - interval '30 minutes';

  -- Kein Worker-Lauf seit 30 Minuten heisst: Cron steht oder die
  -- Function ist nicht erreichbar. Das ist der Alarm, der zählt —
  -- ohne Worker passiert gar nichts mehr.
  if v_last_run is null or v_last_run < now() - interval '30 minutes' then
    v_problems := v_problems || 'worker_stale';
  end if;

  if v_overdue_jobs > 50  then v_problems := v_problems || 'queue_backlog';   end if;
  if v_stale_runs  > 0    then v_problems := v_problems || 'runs_stuck';      end if;
  if v_stuck_replies > 0  then v_problems := v_problems || 'replies_stuck';   end if;

  -- Einzelne abgelaufene Verbindungen sind normal. Erst wenn mehr als
  -- ein Viertel betroffen ist, deutet das auf ein systemisches
  -- Problem hin — etwa einen falschen Verschlüsselungsschlüssel.
  if v_total_accts > 4 and v_broken_accts::numeric / v_total_accts > 0.25 then
    v_problems := v_problems || 'many_broken_connections';
  end if;

  return jsonb_build_object(
    'status',            case when array_length(v_problems, 1) is null then 'ok' else 'degraded' end,
    'problems',          v_problems,
    'checkedAt',         now(),
    'lastWorkerRun',     v_last_run,
    'overdueJobs',       v_overdue_jobs,
    'stuckRuns',         v_stale_runs,
    'stuckReplies',      v_stuck_replies,
    'accountsTotal',     v_total_accts,
    'accountsBroken',    v_broken_accts
  );
end;
$$;


--
-- Name: ops_http_errors(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_http_errors(p_minutes integer DEFAULT 60) RETURNS TABLE(status_code integer, anzahl bigint, letzter timestamp with time zone, auszug text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'net'
    AS $$
  select
    r.status_code,
    count(*)          as anzahl,
    max(r.created)    as letzter,
    left((array_agg(coalesce(r.content, r.error_msg)
                    order by r.created desc))[1], 200) as auszug
  from net._http_response r
  where r.created > now() - make_interval(mins => p_minutes)
    and (r.status_code >= 400 or r.error_msg is not null)
  group by r.status_code
  order by count(*) desc;
$$;


--
-- Name: FUNCTION ops_http_errors(p_minutes integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ops_http_errors(p_minutes integer) IS 'Fehlerhafte HTTP-Antworten aus pg_net. pg_cron meldet diese Faelle als "succeeded" — sie sind sonst unsichtbar.';


--
-- Name: ops_placeholder_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_placeholder_check() RETURNS TABLE(jobname text, ausschnitt text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'cron'
    AS $$
  select
    jobname::text,
    left(substring(command from '<[^>]{2,40}>'), 60) as ausschnitt
  from cron.job
  where command like '%<%'
    and command ~ '<[A-Za-z][A-Za-z0-9_-]{1,40}>';
$$;


--
-- Name: FUNCTION ops_placeholder_check(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ops_placeholder_check() IS 'Cron-Kommandos mit nicht ersetzten Platzhaltern. Muss leer sein.';


--
-- Name: plan_communications(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.plan_communications(p_user_id uuid, p_now timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_decisions jsonb := '[]'::jsonb;

  v_prefs      public.notification_preferences;
  v_open       integer;
  v_relevant   integer;
  v_last_visit timestamptz;
  v_days_away  numeric;
  v_last_sent  timestamptz;
  v_alert_count integer;
  v_alert_ids  uuid[];
  v_is_monday  boolean := extract(isodow from p_now) = 1;

begin
  select * into v_prefs
    from public.notification_preferences where user_id = p_user_id;

  /* Offene Empfehlungen. 'relevant' meint: mindestens mittlere
     Priorität — der Schwellwert steht in engine_thresholds, damit er
     ohne Deployment änderbar bleibt. */
  select count(*),
         count(*) filter (where priority >= 45)
    into v_open, v_relevant
    from public.events
   where user_id = p_user_id
     and lifecycle in ('new', 'seen', 'opened')
     and coalesce(rule_status, 'active') <> 'candidate';

  -- ─────────────────────────────────────────────
  -- KANAL 1 — SOFORTMELDUNG
  --
  -- Die Voreinstellung ist: nicht senden. Nur wenn das Warten bis
  -- Montag schadet.
  --
  -- Gebündelt: Kommen drei schlechte Bewertungen an einem Tag, ist
  -- das EINE Meldung. Drei Mails wären der schnellste Weg in den
  -- Spamfilter.
  -- ─────────────────────────────────────────────

  select count(*), array_agg(id)
    into v_alert_count, v_alert_ids
    from public.events
   where user_id = p_user_id
     and type in ('review.negative_unanswered', 'reviews.negative_batch')
     and lifecycle in ('new', 'seen')
     and coalesce(rule_status, 'active') <> 'candidate'
     -- Noch nicht gemeldet. Der Vermerk verhindert, dass dieselbe
     -- Bewertung bei jedem Worker-Lauf erneut alarmiert.
     and not (delivered ? 'notification');

  if coalesce(v_alert_count, 0) = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'immediate_alert', 'send', false,
      'reason', 'Keine ungemeldete kritische Bewertung');

  elsif not public.wants_notification(p_user_id, 'negative_review') then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'immediate_alert', 'send', false,
      'reason', 'Vom Nutzer abgeschaltet');

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'immediate_alert', 'send', true,
      'template', 'critical_review_alert',
      'reason', format('%s kritische %s ohne Antwort',
                       v_alert_count,
                       case when v_alert_count = 1 then 'Bewertung' else 'Bewertungen' end),
      'eventIds', to_jsonb(v_alert_ids),
      'count', v_alert_count);
  end if;

  -- ─────────────────────────────────────────────
  -- KANAL 2 — WOCHENMAIL
  --
  -- Der einzige Kanal, der auch dann sendet, wenn nichts war. Er
  -- trägt die Gewohnheit: Wer die Mail montags erwartet, öffnet sie
  -- auch in der Woche, in der etwas drinsteht.
  --
  -- "Alles in Ordnung" wird nicht verschickt — die Mail sagt es
  -- nebenbei, sie ist nicht dafür da.
  -- ─────────────────────────────────────────────

  v_last_sent := public.last_email_sent(p_user_id, 'weekly_summary');

  if not v_is_monday then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Nur montags');

  elsif not public.wants_notification(p_user_id, 'weekly_summary') then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Vom Nutzer abgeschaltet');

  elsif v_last_sent is not null and v_last_sent > p_now - interval '6 days' then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Diese Woche bereits verschickt',
      'lastSentAt', v_last_sent);

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', true,
      'template', 'weekly_summary',
      'reason', 'Wöchentlicher Rhythmus',
      'openRecommendations', v_open);
  end if;

  -- ─────────────────────────────────────────────
  -- KANAL 3 — ABWESENHEITS-ERINNERUNG
  --
  -- Nicht "du warst lange nicht da", sondern "es hat sich etwas
  -- angesammelt". Der Unterschied liegt nicht im Ton, sondern in der
  -- Bedingung: Ohne offene Aufgaben wird nichts verschickt, egal wie
  -- lange jemand weg war.
  --
  -- Drei Bedingungen, alle nötig:
  --   1. lange nicht im Dashboard
  --   2. es gibt offene Empfehlungen
  --   3. mindestens eine davon zählt wirklich
  --
  -- Die dritte verhindert den peinlichsten Fall: jemandem nach zehn
  -- Tagen wegen zweier fehlender Fotos zu schreiben.
  -- ─────────────────────────────────────────────

  v_last_visit := v_prefs.last_dashboard_visit_at;
  v_last_sent  := public.last_email_sent(p_user_id, 'inactivity_reminder');
  v_days_away  := case when v_last_visit is null then null
                       else extract(epoch from (p_now - v_last_visit)) / 86400 end;

  if v_last_visit is null then
    /* Noch nie im Dashboard gewesen. Das ist ein Onboarding-Fall,
       kein Abwesenheitsfall — die Willkommensmail deckt ihn ab. */
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Noch kein Dashboard-Besuch — Onboarding, nicht Abwesenheit');

  elsif v_days_away < coalesce(v_prefs.inactivity_days, 10) then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', format('Zuletzt vor %s Tagen im Dashboard', round(v_days_away)),
      'daysAway', round(v_days_away, 1));

  elsif v_open = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Nichts offen — Abwesenheit allein ist kein Anlass',
      'daysAway', round(v_days_away, 1));

  elsif v_relevant = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', format('%s offene Empfehlungen, aber keine von Belang', v_open),
      'daysAway', round(v_days_away, 1), 'open', v_open);

  elsif v_last_sent is not null and v_last_sent > p_now - interval '14 days' then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Vor weniger als 14 Tagen bereits erinnert',
      'lastSentAt', v_last_sent);

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', true,
      'template', 'inactivity_reminder',
      'reason', format('%s Tage abwesend, %s offene Empfehlungen, davon %s von Belang',
                       round(v_days_away), v_open, v_relevant),
      'daysAway', round(v_days_away, 1),
      'open', v_open, 'relevant', v_relevant);
  end if;

  return jsonb_build_object(
    'userId', p_user_id,
    'evaluatedAt', p_now,
    'decisions', v_decisions
  );
end;
$$;


--
-- Name: prune_email_queue(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_email_queue(p_keep interval DEFAULT '90 days'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_count integer;
begin
  -- Verschickte lange halten: der dedupe_key ist der Beleg, dass die
  -- Mail raus ist. Zu früh gelöscht, geht sie ein zweites Mal raus.
  delete from public.email_queue
   where status in ('sent', 'cancelled') and created_at < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: prune_rate_limits(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_rate_limits(p_keep interval DEFAULT '2 days'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  delete from public.rate_limits where updated_at < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: prune_sync_jobs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_sync_jobs() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  removed integer;
begin
  delete from public.sync_jobs
  where (status = 'succeeded' and finished_at < now() - interval '7 days')
     or (status in ('failed', 'cancelled') and finished_at < now() - interval '30 days');
  get diagnostics removed = row_count;
  return removed;
end;
$$;


--
-- Name: prune_sync_runs(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_sync_runs(p_keep interval DEFAULT '30 days'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  delete from public.sync_runs where started_at < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: purge_unconfirmed_accounts(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_unconfirmed_accounts(p_max_age interval DEFAULT '00:30:00'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  delete from public.oauth_tokens t
   using public.google_accounts a
   where t.account_id = a.id
     and a.status = 'pending'
     and a.connected_at < now() - p_max_age;

  delete from public.google_accounts
   where status = 'pending'
     and connected_at < now() - p_max_age;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: read_impact_metric(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_impact_metric(p_user_id uuid, p_metric text) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_total integer;
  v_open  integer;
begin
  case p_metric

    when 'reviews.responseRate' then
      select count(*), count(*) filter (where not is_answered)
        into v_total, v_open
        from public.google_reviews
       where user_id = p_user_id and status = 'active';
      return case when v_total > 0
                  then round(((v_total - v_open)::numeric / v_total), 4)
                  else null end;

    when 'reviews.unansweredCount' then
      select count(*) into v_open
        from public.google_reviews
       where user_id = p_user_id and status = 'active' and not is_answered;
      return v_open;

    when 'reviews.totalCount' then
      select count(*) into v_total
        from public.google_reviews
       where user_id = p_user_id and status = 'active';
      return v_total;

    when 'reviews.averageRating' then
      return (select round(avg(star_rating)::numeric, 2)
                from public.google_reviews
               where user_id = p_user_id and status = 'active');

    when 'profile.photoCount' then
      return (select count(*) from public.business_photos where profile_id = p_user_id);

    when 'profile.completeness' then
      return (
        select round(avg(
          ((case when primary_phone    is not null then 1 else 0 end) +
           (case when website_uri      is not null then 1 else 0 end) +
           (case when locality         is not null then 1 else 0 end) +
           (case when primary_category is not null then 1 else 0 end))::numeric / 4
        ), 4)
        from public.google_locations
        where user_id = p_user_id and deleted_at is null
      );

    when 'health.score' then
      return (public.compute_health_score(p_user_id) ->> 'score')::numeric;

    else
      -- Unbekannte Kennzahl ist ein Programmierfehler, kein
      -- Laufzeitfall. null statt Ausnahme, damit ein Tippfehler in
      -- einer Regel nicht die Nachmessung aller anderen blockiert.
      return null;
  end case;
end;
$$;


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source text DEFAULT 'google_business'::text NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    priority smallint NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    reason text,
    recommended_action text,
    action_url text,
    estimated_effort text,
    impact text,
    in_dashboard boolean DEFAULT true NOT NULL,
    in_weekly_email boolean DEFAULT false NOT NULL,
    as_notification boolean DEFAULT false NOT NULL,
    is_dismissable boolean DEFAULT true NOT NULL,
    subject_type text,
    subject_id uuid,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    resolved_at timestamp with time zone,
    delivered jsonb DEFAULT '{}'::jsonb NOT NULL,
    rule_id text,
    confidence numeric(3,2),
    explanation jsonb,
    lifecycle text DEFAULT 'new'::text NOT NULL,
    seen_at timestamp with time zone,
    opened_at timestamp with time zone,
    completed_at timestamp with time zone,
    engine_version text,
    generation integer DEFAULT 1 NOT NULL,
    dismiss_count integer DEFAULT 0 NOT NULL,
    cooldown_until timestamp with time zone,
    impact_metric text,
    impact_baseline numeric,
    impact_value numeric,
    impact_delta numeric,
    impact_measured_at timestamp with time zone,
    rule_status text,
    rule_version text,
    CONSTRAINT events_category_check CHECK ((category = ANY (ARRAY['reviews'::text, 'profile'::text, 'connection'::text, 'visibility'::text]))),
    CONSTRAINT events_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT events_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['new'::text, 'seen'::text, 'opened'::text, 'completed'::text, 'resolved'::text, 'dismissed'::text, 'expired'::text, 'superseded'::text]))),
    CONSTRAINT events_priority_check CHECK (((priority >= 0) AND (priority <= 100))),
    CONSTRAINT events_rule_status_check CHECK (((rule_status IS NULL) OR (rule_status = ANY (ARRAY['active'::text, 'candidate'::text, 'deprecated'::text, 'retired'::text]))))
);


--
-- Name: TABLE events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.events IS 'Ergebnis der Entscheidungs-Engine. Einzige Quelle für Dashboard, Wochenmail und Benachrichtigungen.';


--
-- Name: COLUMN events.explanation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.explanation IS 'Herleitung: welche Fakten, welche Regel, welche Erwartung. Wird im Frontend angezeigt.';


--
-- Name: COLUMN events.impact_metric; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.impact_metric IS 'Welche objektive Kennzahl diese Empfehlung bewegen soll. Von der Regel benannt, z. B. reviews.responseRate.';


--
-- Name: COLUMN events.rule_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.rule_version IS 'Fassung der Regel bei Erzeugung. Macht alte Empfehlungen nachvollziehbar, auch wenn die Regel sich geändert hat.';


--
-- Name: record_recommendation_action(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_recommendation_action(p_event_id uuid, p_action text, p_channel text DEFAULT 'dashboard'::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS public.events
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event    public.events;
  v_now      timestamptz := now();
  v_cooldown interval;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Empfehlung % nicht gefunden', p_event_id using errcode = 'no_data_found';
  end if;

  if p_user_id is not null and v_event.user_id <> p_user_id then
    raise exception 'Kein Zugriff' using errcode = 'insufficient_privilege';
  end if;

  case p_action

    when 'seen' then
      if v_event.seen_at is null then
        update public.events
           set lifecycle = case when lifecycle = 'new' then 'seen' else lifecycle end,
               seen_at = v_now
         where id = p_event_id
        returning * into v_event;
      else
        return v_event;
      end if;

    when 'opened' then
      update public.events
         set lifecycle = case when lifecycle in ('new','seen') then 'opened' else lifecycle end,
             opened_at = coalesce(opened_at, v_now),
             seen_at   = coalesce(seen_at, v_now)
       where id = p_event_id
      returning * into v_event;

    when 'completed' then
      /* Ausgangsstand VOR der Erledigung festhalten — nachträglich
         liesse er sich nicht rekonstruieren. */
      perform public.snapshot_impact_baseline(p_event_id);

      update public.events
         set lifecycle = 'completed',
             completed_at = v_now,
             resolved_at  = coalesce(resolved_at, v_now)
       where id = p_event_id
      returning * into v_event;

    when 'resolved' then
      update public.events
         set lifecycle = case when lifecycle = 'completed' then 'completed' else 'resolved' end,
             resolved_at = coalesce(resolved_at, v_now)
       where id = p_event_id
      returning * into v_event;

    when 'dismissed' then
      v_cooldown := case v_event.dismiss_count
                      when 0 then interval '14 days'
                      when 1 then interval '30 days'
                      else interval '100 years'
                    end;
      update public.events
         set lifecycle = 'dismissed', dismissed_at = v_now,
             dismiss_count = dismiss_count + 1,
             cooldown_until = v_now + v_cooldown
       where id = p_event_id
      returning * into v_event;

    when 'expired' then
      update public.events
         set lifecycle = 'expired', resolved_at = coalesce(resolved_at, v_now)
       where id = p_event_id
      returning * into v_event;

    when 'superseded' then
      update public.events
         set lifecycle = 'superseded', resolved_at = coalesce(resolved_at, v_now)
       where id = p_event_id
      returning * into v_event;

    else
      raise exception 'Unbekannte Aktion: %', p_action using errcode = 'invalid_parameter_value';
  end case;

  insert into public.recommendation_events (
    event_id, user_id, location_id, action,
    rule_id, priority, confidence, category,
    engine_version, rule_version, rule_status, channel
  ) values (
    v_event.id, v_event.user_id,
    case when v_event.subject_type = 'location' then v_event.subject_id else null end,
    p_action,
    v_event.rule_id, v_event.priority, v_event.confidence, v_event.category,
    v_event.engine_version, v_event.rule_version, v_event.rule_status, p_channel
  );

  return v_event;
end;
$$;


--
-- Name: reject_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'Tabelle % ist append-only', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;


--
-- Name: release_lock(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_lock(p_name text, p_worker text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_released boolean;
begin
  delete from public.sync_locks
   where name = p_name and locked_by = p_worker
  returning true into v_released;

  return coalesce(v_released, false);
end;
$$;


--
-- Name: release_stuck_emails(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_stuck_emails(p_timeout interval DEFAULT '00:15:00'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_count integer;
begin
  update public.email_queue
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         locked_by = null, locked_at = null,
         error_code = coalesce(error_code, 'send_timeout')
   where status = 'sending' and locked_at < now() - p_timeout;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: release_stuck_publications(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_stuck_publications(p_timeout interval DEFAULT '00:10:00'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  update public.review_replies
     set status = 'approved',
         error_code = coalesce(error_code, 'publish_timeout')
   where status = 'publishing'
     and updated_at < now() - p_timeout;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: release_stuck_sync_jobs(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_stuck_sync_jobs(p_timeout interval DEFAULT '00:15:00'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  released integer;
begin
  update public.sync_jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         locked_by = null,
         locked_at = null,
         error_code = coalesce(error_code, 'worker_timeout')
   where status = 'running'
     and locked_at < now() - p_timeout;
  get diagnostics released = row_count;
  return released;
end;
$$;


--
-- Name: release_stuck_sync_runs(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_stuck_sync_runs(p_timeout interval DEFAULT '00:15:00'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  update public.sync_runs
     set status = 'failed',
         finished_at = coalesce(finished_at, now()),
         duration_ms = coalesce(duration_ms,
                        (extract(epoch from (now() - started_at)) * 1000)::integer),
         error_code = coalesce(error_code, 'worker_timeout')
   where status = 'running'
     and started_at < now() - p_timeout;
  get diagnostics v_count = row_count;

  delete from public.sync_locks where expires_at < now();
  return v_count;
end;
$$;


--
-- Name: retract_reply(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retract_reply(p_reply_id uuid) RETURNS public.review_replies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_reply public.review_replies;
begin
  -- Soft-Delete statt Statuswechsel: der Partial-Unique-Index auf
  -- 'published' berücksichtigt deleted_at, damit später eine neue
  -- Antwort zur selben Bewertung möglich ist.
  update public.review_replies
     set deleted_at = now()
   where id = p_reply_id
     and status = 'published'
     and deleted_at is null
  returning * into v_reply;

  if not found then
    raise exception 'Antwort % ist nicht veröffentlicht', p_reply_id
      using errcode = 'invalid_parameter_value';
  end if;

  update public.google_reviews
     set is_answered = false,
         answered_at = null
   where id = v_reply.review_id;

  return v_reply;
end;
$$;


--
-- Name: run_sync_maintenance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_sync_maintenance() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return jsonb_build_object(
    'stuckJobs',         public.release_stuck_sync_jobs(),
    'stuckPublications', public.release_stuck_publications(),
    'stuckRuns',         public.release_stuck_sync_runs(),
    'stuckEmails',       public.release_stuck_emails(),
    'prunedJobs',        public.prune_sync_jobs(),
    'prunedRuns',        public.prune_sync_runs(),
    'prunedRateLimits',  public.prune_rate_limits(),
    'prunedEmails',      public.prune_email_queue(),
    'unconfirmed',       public.purge_unconfirmed_accounts(),
    'impactMeasured',    public.measure_recommendation_impact(),
    'expiredStates',     (select public.cleanup_expired_oauth_states())
  );
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;


--
-- Name: sanitize_profile_inputs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitize_profile_inputs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.company_name := public.sanitize_text(new.company_name, 200);
  new.city         := public.sanitize_text(new.city, 100);
  return new;
end;
$$;


--
-- Name: sanitize_text(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitize_text(input text, max_length integer DEFAULT 500) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  -- Strip HTML tags and limit length
  RETURN LEFT(
    REGEXP_REPLACE(input, '<[^>]*>', '', 'g'),
    max_length
  );
END;
$$;


--
-- Name: schedule_all_syncs(interval, interval, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_all_syncs(p_review_age interval DEFAULT '02:00:00'::interval, p_location_age interval DEFAULT '24:00:00'::interval, p_limit integer DEFAULT 500) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_locations integer := 0;
  v_reviews   integer := 0;
  v_row       record;
begin
  /* ── Konten und Standorte ──
     Ein Job pro Konto. Der Handler holt Konten UND deren Standorte,
     deshalb ohne location_id. */
  for v_row in
    select a.id as account_id, a.user_id
      from public.google_accounts a
     where a.deleted_at is null
       and a.status = 'active'
       and not exists (
         select 1 from public.sync_jobs j
          where j.account_id = a.id
            and j.job_type = 'sync_locations'
            and (j.status in ('queued', 'running')
                 or (j.status = 'succeeded'
                     and j.finished_at > now() - p_location_age))
       )
     limit p_limit
  loop
    if public.enqueue_sync_job(
         'sync_locations', v_row.user_id, v_row.account_id, null,
         '{}'::jsonb, 50::smallint
       ) is not null then
      v_locations := v_locations + 1;
    end if;
  end loop;

  /* ── Bewertungen ──
     Nur Standorte, deren letzter Abgleich lange genug her ist.
     nulls first: noch nie synchronisierte zuerst. */
  for v_row in
    select l.id as location_id, l.account_id, l.user_id
      from public.google_locations l
      join public.google_accounts  a on a.id = l.account_id
     where l.deleted_at is null
       and a.deleted_at is null
       and a.status = 'active'
       and (l.last_synced_at is null or l.last_synced_at < now() - p_review_age)
     order by l.last_synced_at nulls first
     limit p_limit
  loop
    if public.enqueue_sync_job(
         'sync_reviews', v_row.user_id, v_row.account_id, v_row.location_id
       ) is not null then
      v_reviews := v_reviews + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'locationJobs', v_locations,
    'reviewJobs',   v_reviews,
    'scheduledAt',  now()
  );
end;
$$;


--
-- Name: schedule_communications(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_communications(p_channel text DEFAULT 'all'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row      record;
  v_plan     jsonb;
  v_decision jsonb;
  v_sent     jsonb := '{}'::jsonb;
  v_alerts   integer := 0;
  v_weekly   integer := 0;
  v_inactive integer := 0;
  v_health   jsonb;
  v_ids      uuid[];
begin
  for v_row in
    select distinct a.user_id, u.email, p.company_name, p.full_name, p.industry_key
      from public.google_accounts a
      join auth.users u on u.id = a.user_id
      left join public.user_profiles p on p.id = a.user_id
     where a.status = 'active' and a.deleted_at is null and u.email is not null
  loop
    v_plan := public.plan_communications(v_row.user_id);

    for v_decision in select * from jsonb_array_elements(v_plan -> 'decisions')
    loop
      continue when not (v_decision ->> 'send')::boolean;
      continue when p_channel <> 'all' and v_decision ->> 'channel' <> p_channel;

      case v_decision ->> 'channel'

        when 'immediate_alert' then
          if public.enqueue_email(
               'critical_review_alert', v_row.email,
               /* Je Nutzer und Stunde höchstens eine — mehrere
                  Bewertungen in kurzem Abstand werden dadurch
                  gebündelt statt einzeln gemeldet. */
               'critical_alert:' || v_row.user_id || ':' ||
                 to_char(now(), 'YYYY-MM-DD-HH24'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 'companyName', v_row.company_name,
                 'industryKey', coalesce(v_row.industry_key, 'handwerk'),
                 'count', (v_decision ->> 'count')::integer,
                 'reason', v_decision ->> 'reason')
             ) is not null then
            v_alerts := v_alerts + 1;

            /* Vermerken, dass gemeldet wurde. Ohne das käme dieselbe
               Bewertung bei jedem Lauf erneut. */
            select array_agg(value::text::uuid)
              into v_ids
              from jsonb_array_elements_text(v_decision -> 'eventIds');
            perform public.mark_events_delivered(v_ids, 'notification');
          end if;

        when 'weekly_email' then
          v_health := public.compute_health_score(v_row.user_id);
          if public.enqueue_email(
               'weekly_summary', v_row.email,
               'weekly_summary:' || v_row.user_id || ':' ||
                 to_char(date_trunc('week', now()), 'YYYY-MM-DD'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 'companyName',  v_row.company_name,
                 'industryKey',  coalesce(v_row.industry_key, 'handwerk'),
                 'actions',      public.top_recommendations_for_email(v_row.user_id, 3),
                 'completed',    public.completed_this_week(v_row.user_id),
                 'healthScore',  (v_health ->> 'score')::integer,
                 'reviewsTotal', (v_health ->> 'reviewsTotal')::integer,
                 'unanswered',   (v_health ->> 'unanswered')::integer,
                 'averageRating',(v_health ->> 'averageRating')::numeric,
                 'openCount',    (v_decision ->> 'openRecommendations')::integer)
             ) is not null then
            v_weekly := v_weekly + 1;
          end if;

        when 'inactivity_reminder' then
          if public.enqueue_email(
               'inactivity_reminder', v_row.email,
               'inactivity:' || v_row.user_id || ':' || to_char(now(), 'IYYY-IW'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 'companyName', v_row.company_name,
                 'industryKey', coalesce(v_row.industry_key, 'handwerk'),
                 'daysAway',    (v_decision ->> 'daysAway')::numeric,
                 'open',        (v_decision ->> 'open')::integer,
                 'actions',     public.top_recommendations_for_email(v_row.user_id, 3))
             ) is not null then
            v_inactive := v_inactive + 1;
          end if;

        else null;
      end case;
    end loop;
  end loop;

  return jsonb_build_object(
    'alerts', v_alerts, 'weekly', v_weekly,
    'inactivity', v_inactive, 'scheduledAt', now()
  );
end;
$$;


--
-- Name: schedule_lifecycle_emails(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_lifecycle_emails() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_reminders integer := 0;
  v_ended     integer := 0;
  v_broken    integer := 0;
  v_row       record;
begin
  for v_row in
    select p.id, u.email, p.company_name, p.full_name, p.trial_ends_at, p.industry_key
      from public.user_profiles p
      join auth.users u on u.id = p.id
     where p.plan = 'trial'
       and p.trial_ends_at between now() + interval '6 days' and now() + interval '8 days'
       and u.email is not null
  loop
    if public.enqueue_email(
         'trial_reminder', v_row.email, 'trial_reminder:7:' || v_row.id,
         v_row.id, coalesce(v_row.full_name, v_row.company_name),
         jsonb_build_object(
           'companyName', v_row.company_name, 'trialEndsAt', v_row.trial_ends_at,
           'industryKey', coalesce(v_row.industry_key, 'handwerk'), 'daysLeft', 7)
       ) is not null then
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  for v_row in
    select p.id, u.email, p.company_name, p.full_name, p.industry_key
      from public.user_profiles p
      join auth.users u on u.id = p.id
     where p.plan = 'trial'
       and p.trial_ends_at between now() - interval '2 days' and now()
       and u.email is not null
  loop
    if public.enqueue_email(
         'trial_ended', v_row.email, 'trial_ended:' || v_row.id,
         v_row.id, coalesce(v_row.full_name, v_row.company_name),
         jsonb_build_object('companyName', v_row.company_name,
                            'industryKey', coalesce(v_row.industry_key, 'handwerk'))
       ) is not null then
      v_ended := v_ended + 1;
    end if;
  end loop;

  for v_row in
    select a.user_id, u.email, p.company_name, p.full_name, p.industry_key
      from public.google_accounts a
      join auth.users u on u.id = a.user_id
      left join public.user_profiles p on p.id = a.user_id
     where a.status in ('needs_reauth', 'revoked')
       and a.deleted_at is null
       and a.last_error_at > now() - interval '2 days'
       and u.email is not null
       and public.wants_notification(a.user_id, 'connection_lost')
  loop
    if public.enqueue_email(
         'connection_broken', v_row.email,
         'connection_broken:' || v_row.user_id || ':' || to_char(now(), 'IYYY-IW'),
         v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
         jsonb_build_object('companyName', v_row.company_name,
                            'industryKey', coalesce(v_row.industry_key, 'handwerk'))
       ) is not null then
      v_broken := v_broken + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'trialReminders', v_reminders, 'trialEnded', v_ended,
    'connectionBroken', v_broken, 'scheduledAt', now());
end;
$$;


--
-- Name: schedule_review_syncs(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_review_syncs(p_min_age interval DEFAULT '06:00:00'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer := 0;
  v_row   record;
begin
  for v_row in
    select l.id as location_id, l.account_id, l.user_id
      from public.google_locations l
      join public.google_accounts  a on a.id = l.account_id
     where l.deleted_at is null
       and a.deleted_at is null
       and a.status = 'active'
       and (l.last_synced_at is null or l.last_synced_at < now() - p_min_age)
     order by l.last_synced_at nulls first
     limit 500
  loop
    if public.enqueue_sync_job(
         'sync_reviews', v_row.user_id, v_row.account_id, v_row.location_id
       ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;


--
-- Name: schedule_weekly_summaries(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_weekly_summaries() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_week   date := date_trunc('week', now())::date;
  v_prev   date := (date_trunc('week', now()) - interval '7 days')::date;
  v_queued integer := 0;
  v_row    record;
  v_health jsonb;
  v_prior  public.weekly_snapshots;
  v_new    integer;
  v_lowest integer;
  v_pub    integer;
begin
  for v_row in
    select a.user_id, u.email, p.company_name, p.full_name, p.industry_key
      from public.google_accounts a
      join auth.users u on u.id = a.user_id
      left join public.user_profiles p on p.id = a.user_id
     where a.status = 'active'
       and a.deleted_at is null
       and u.email is not null
     group by a.user_id, u.email, p.company_name, p.full_name, p.industry_key
  loop
    v_health := public.compute_health_score(v_row.user_id);

    select count(*), min(star_rating)
      into v_new, v_lowest
      from public.google_reviews
     where user_id = v_row.user_id and status = 'active'
       and google_created_at >= v_prev and google_created_at < v_week;

    select count(*) into v_pub
      from public.review_replies
     where user_id = v_row.user_id and status = 'published'
       and published_at >= v_prev and published_at < v_week;

    select * into v_prior
      from public.weekly_snapshots
     where user_id = v_row.user_id and week_start = v_prev;

    insert into public.weekly_snapshots (
      user_id, week_start, health_score, health_factors,
      reviews_total, reviews_new, unanswered, average_rating,
      replies_published, photo_count, newest_review_at
    ) values (
      v_row.user_id, v_week,
      (v_health ->> 'score')::integer,
      v_health -> 'factors',
      (v_health ->> 'reviewsTotal')::integer,
      v_new,
      (v_health ->> 'unanswered')::integer,
      (v_health ->> 'averageRating')::numeric,
      v_pub,
      (v_health ->> 'photoCount')::integer,
      (v_health ->> 'newestReviewAt')::timestamptz
    )
    on conflict (user_id, week_start) do update
      set health_score = excluded.health_score,
          health_factors = excluded.health_factors,
          reviews_total = excluded.reviews_total,
          reviews_new = excluded.reviews_new,
          unanswered = excluded.unanswered,
          average_rating = excluded.average_rating,
          replies_published = excluded.replies_published,
          photo_count = excluded.photo_count,
          newest_review_at = excluded.newest_review_at;

    if not public.wants_notification(v_row.user_id, 'weekly_summary') then
      continue;
    end if;

    if public.enqueue_email(
         'weekly_summary', v_row.email,
         'weekly_summary:' || v_row.user_id || ':' || v_week,
         v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
         jsonb_build_object(
           'companyName',   v_row.company_name,
           'industryKey',   coalesce(v_row.industry_key, 'handwerk'),
           'weekStart',     v_week,
           'healthScore',   (v_health ->> 'score')::integer,
           /* null, wenn es keine Vorwoche gibt — die Mail sagt dann
              "erster Bericht" statt eine Veränderung zu erfinden. */
           'healthDelta',   case when v_prior.user_id is null then null
                                 else (v_health ->> 'score')::integer - v_prior.health_score end,
           'reviewsTotal',  (v_health ->> 'reviewsTotal')::integer,
           'reviewsNew',    v_new,
           /* Schlechteste neue Bewertung. Ohne die kann die Mail den
              wichtigsten Fall nicht erkennen. */
           'lowestNewRating', v_lowest,
           'unanswered',    (v_health ->> 'unanswered')::integer,
           'averageRating', (v_health ->> 'averageRating')::numeric,
           'ratingDelta',   case when v_prior.user_id is null or v_prior.average_rating is null then null
                                 else (v_health ->> 'averageRating')::numeric - v_prior.average_rating end,
           'repliesPublished', v_pub,
           'photoCount',    (v_health ->> 'photoCount')::integer,
           'newestReviewAt', v_health ->> 'newestReviewAt',
           'factors',       v_health -> 'factors',
           'priorFactors',  coalesce(v_prior.health_factors, '{}'::jsonb)
         )
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object('snapshots', v_queued, 'week', v_week, 'scheduledAt', now());
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: snapshot_impact_baseline(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.snapshot_impact_baseline(p_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.impact_metric is null then return; end if;

  update public.events
     set impact_baseline = public.read_impact_metric(v_event.user_id, v_event.impact_metric)
   where id = p_event_id and impact_baseline is null;
end;
$$;


--
-- Name: sync_events(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_events(p_user_id uuid, p_events jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_created  integer := 0;
  v_updated  integer := 0;
  v_resolved integer := 0;
  v_item     jsonb;
  v_existing boolean;
begin
  for v_item in select * from jsonb_array_elements(p_events)
  loop
    select exists (
      select 1 from public.events
       where user_id = p_user_id
         and type = v_item ->> 'type'
         and subject_id is not distinct from (v_item ->> 'subjectId')::uuid
    ) into v_existing;

    insert into public.events (
      user_id, source, type, category, priority,
      title, summary, reason,
      recommended_action, action_url, estimated_effort, impact,
      in_dashboard, in_weekly_email, as_notification, is_dismissable,
      subject_type, subject_id, data, expires_at
    ) values (
      p_user_id,
      coalesce(v_item ->> 'source', 'google_business'),
      v_item ->> 'type',
      v_item ->> 'category',
      (v_item ->> 'priority')::smallint,
      v_item ->> 'title',
      v_item ->> 'summary',
      v_item ->> 'reason',
      v_item ->> 'recommendedAction',
      v_item ->> 'actionUrl',
      v_item ->> 'estimatedEffort',
      v_item ->> 'impact',
      coalesce((v_item ->> 'inDashboard')::boolean, true),
      coalesce((v_item ->> 'inWeeklyEmail')::boolean, false),
      coalesce((v_item ->> 'asNotification')::boolean, false),
      coalesce((v_item ->> 'isDismissable')::boolean, true),
      v_item ->> 'subjectType',
      (v_item ->> 'subjectId')::uuid,
      coalesce(v_item -> 'data', '{}'::jsonb),
      (v_item ->> 'expiresAt')::timestamptz
    )
    on conflict (user_id, type, subject_id) do update set
      priority           = excluded.priority,
      title              = excluded.title,
      summary            = excluded.summary,
      reason             = excluded.reason,
      recommended_action = excluded.recommended_action,
      action_url         = excluded.action_url,
      estimated_effort   = excluded.estimated_effort,
      impact             = excluded.impact,
      in_dashboard       = excluded.in_dashboard,
      in_weekly_email    = excluded.in_weekly_email,
      as_notification    = excluded.as_notification,
      data               = excluded.data,
      expires_at         = excluded.expires_at,
      /* Ein wiederauftretendes Problem wird wieder offen — aber die
         Zustellung gilt als erledigt, sonst käme die Sofortmeldung
         bei jedem Worker-Lauf erneut. */
      resolved_at        = null;

    if v_existing then v_updated := v_updated + 1;
    else v_created := v_created + 1;
    end if;
  end loop;

  /* Was die Engine nicht mehr meldet, ist gelöst. */
  update public.events e
     set resolved_at = now()
   where e.user_id = p_user_id
     and e.resolved_at is null
     and not exists (
       select 1 from jsonb_array_elements(p_events) x
        where x ->> 'type' = e.type
          and (x ->> 'subjectId')::uuid is not distinct from e.subject_id
     );
  get diagnostics v_resolved = row_count;

  /* Abgelaufene ebenfalls schliessen. */
  update public.events
     set resolved_at = now()
   where user_id = p_user_id and resolved_at is null
     and expires_at is not null and expires_at < now();

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'resolved', v_resolved
  );
end;
$$;


--
-- Name: sync_events(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_events(p_user_id uuid, p_events jsonb, p_engine_version text DEFAULT 'unknown'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_created    integer := 0;
  v_updated    integer := 0;
  v_resolved   integer := 0;
  v_suppressed integer := 0;
  v_item       jsonb;
  v_existing   public.events;
  v_id         uuid;
begin
  for v_item in select * from jsonb_array_elements(p_events)
  loop
    select * into v_existing
      from public.events
     where user_id = p_user_id
       and type = v_item ->> 'type'
       and subject_id is not distinct from (v_item ->> 'subjectId')::uuid;

    if found and v_existing.cooldown_until is not null
       and v_existing.cooldown_until > now() then
      v_suppressed := v_suppressed + 1;
      continue;
    end if;

    insert into public.events (
      user_id, source, type, category, priority,
      title, summary, reason,
      recommended_action, action_url, estimated_effort, impact,
      in_dashboard, in_weekly_email, as_notification, is_dismissable,
      subject_type, subject_id, data, expires_at,
      rule_id, confidence, explanation, engine_version,
      rule_version, rule_status, impact_metric
    ) values (
      p_user_id,
      coalesce(v_item ->> 'source', 'google_business'),
      v_item ->> 'type', v_item ->> 'category',
      (v_item ->> 'priority')::smallint,
      v_item ->> 'title', v_item ->> 'summary', v_item ->> 'reason',
      v_item ->> 'recommendedAction', v_item ->> 'actionUrl',
      v_item ->> 'estimatedEffort', v_item ->> 'impact',
      coalesce((v_item ->> 'inDashboard')::boolean, true),
      coalesce((v_item ->> 'inWeeklyEmail')::boolean, false),
      coalesce((v_item ->> 'asNotification')::boolean, false),
      coalesce((v_item ->> 'isDismissable')::boolean, true),
      v_item ->> 'subjectType', (v_item ->> 'subjectId')::uuid,
      coalesce(v_item -> 'data', '{}'::jsonb),
      (v_item ->> 'expiresAt')::timestamptz,
      v_item ->> 'ruleId', (v_item ->> 'confidence')::numeric,
      v_item -> 'explanation', p_engine_version,
      v_item ->> 'ruleVersion', coalesce(v_item ->> 'ruleStatus', 'active'),
      v_item ->> 'impactMetric'
    )
    on conflict (user_id, type, subject_id) do update set
      priority = excluded.priority, title = excluded.title,
      summary = excluded.summary, reason = excluded.reason,
      recommended_action = excluded.recommended_action,
      action_url = excluded.action_url,
      estimated_effort = excluded.estimated_effort,
      impact = excluded.impact,
      in_dashboard = excluded.in_dashboard,
      in_weekly_email = excluded.in_weekly_email,
      as_notification = excluded.as_notification,
      data = excluded.data, expires_at = excluded.expires_at,
      rule_id = excluded.rule_id, confidence = excluded.confidence,
      explanation = excluded.explanation,
      engine_version = excluded.engine_version,
      rule_version = excluded.rule_version,
      rule_status = excluded.rule_status,
      impact_metric = excluded.impact_metric,
      generation = case
        when public.events.lifecycle in ('completed','resolved','expired')
        then public.events.generation + 1 else public.events.generation end,
      lifecycle = case
        when public.events.lifecycle in ('completed','resolved','expired')
        then 'new' else public.events.lifecycle end,
      seen_at = case
        when public.events.lifecycle in ('completed','resolved','expired')
        then null else public.events.seen_at end,
      opened_at = case
        when public.events.lifecycle in ('completed','resolved','expired')
        then null else public.events.opened_at end,
      resolved_at = null
    returning id into v_id;

    if v_existing.id is null then
      v_created := v_created + 1;
      insert into public.recommendation_events (
        event_id, user_id, action, rule_id, priority, confidence,
        category, engine_version, rule_version, rule_status, channel
      ) values (
        v_id, p_user_id, 'created',
        v_item ->> 'ruleId', (v_item ->> 'priority')::smallint,
        (v_item ->> 'confidence')::numeric, v_item ->> 'category',
        p_engine_version, v_item ->> 'ruleVersion',
        coalesce(v_item ->> 'ruleStatus', 'active'), 'engine'
      );
    else
      v_updated := v_updated + 1;
      if v_existing.lifecycle in ('completed','resolved','expired') then
        insert into public.recommendation_events (
          event_id, user_id, action, rule_id, priority, confidence,
          category, engine_version, rule_version, rule_status, channel
        ) values (
          v_id, p_user_id, 'regenerated',
          v_item ->> 'ruleId', (v_item ->> 'priority')::smallint,
          (v_item ->> 'confidence')::numeric, v_item ->> 'category',
          p_engine_version, v_item ->> 'ruleVersion',
          coalesce(v_item ->> 'ruleStatus', 'active'), 'engine'
        );
      end if;
    end if;
  end loop;

  for v_id in
    select e.id from public.events e
     where e.user_id = p_user_id
       and e.lifecycle in ('new','seen','opened')
       and not exists (
         select 1 from jsonb_array_elements(p_events) x
          where x ->> 'type' = e.type
            and (x ->> 'subjectId')::uuid is not distinct from e.subject_id
       )
  loop
    perform public.record_recommendation_action(v_id, 'resolved', 'engine', null);
    v_resolved := v_resolved + 1;
  end loop;

  for v_id in
    select id from public.events
     where user_id = p_user_id and lifecycle in ('new','seen','opened')
       and expires_at is not null and expires_at < now()
  loop
    perform public.record_recommendation_action(v_id, 'expired', 'engine', null);
  end loop;

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated,
    'resolved', v_resolved, 'suppressed', v_suppressed
  );
end;
$$;


--
-- Name: top_events(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.top_events(p_user_id uuid, p_channel text DEFAULT 'dashboard'::text, p_limit integer DEFAULT 3) RETURNS SETOF public.events
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select * from public.events
   where user_id = p_user_id
     and dismissed_at is null
     and resolved_at is null
     and (expires_at is null or expires_at > now())
     and case p_channel
           when 'weekly_email'  then in_weekly_email
           when 'notification'  then as_notification and not (delivered ? 'notification')
           else in_dashboard
         end
   order by priority desc, created_at desc
   limit p_limit;
$$;


--
-- Name: top_recommendations_for_email(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.top_recommendations_for_email(p_user_id uuid, p_limit integer DEFAULT 3) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.priority desc, x.minutes), '[]'::jsonb)
    from (
      select
        e.id,
        e.title,
        e.summary,
        e.reason,
        e.impact            as benefit,
        e.estimated_effort  as effort,
        e.priority,
        e.action_url,
        coalesce((regexp_match(e.estimated_effort, '(\d+)'))[1]::integer, 99) as minutes
      from public.events e
      where e.user_id = p_user_id
        and e.lifecycle in ('new', 'seen', 'opened')
        and e.in_weekly_email
        and coalesce(e.rule_status, 'active') <> 'candidate'
      order by e.priority desc,
               coalesce((regexp_match(e.estimated_effort, '(\d+)'))[1]::integer, 99)
      limit p_limit
    ) x;
$$;


--
-- Name: touch_dashboard_visit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_dashboard_visit(p_user_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
begin
  /* Ohne Parameter greift auth.uid(). Der Client kann damit keine
     fremde Kennung setzen — bei security definer wäre das sonst
     genau die Lücke: jeder könnte den Besuchszeitpunkt eines anderen
     Nutzers zurücksetzen und dessen Erinnerung unterdrücken. */
  if v_user is null then return; end if;

  insert into public.notification_preferences (user_id, last_dashboard_visit_at)
  values (v_user, now())
  on conflict (user_id) do update set last_dashboard_visit_at = now();
end;
$$;


--
-- Name: try_acquire_lock(text, text, interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_acquire_lock(p_name text, p_worker text, p_ttl interval DEFAULT '00:10:00'::interval) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_acquired boolean;
begin
  insert into public.sync_locks (name, locked_by, locked_at, expires_at)
  values (p_name, p_worker, now(), now() + p_ttl)
  on conflict (name) do update
     set locked_by  = excluded.locked_by,
         locked_at  = excluded.locked_at,
         expires_at = excluded.expires_at
   where public.sync_locks.expires_at < now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_user_plan(uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_plan(p_user_id uuid, p_plan text, p_trial_ends timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Only allow valid plan values
  IF p_plan NOT IN ('free', 'trial', 'pro', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid plan value: %', p_plan;
  END IF;

  UPDATE user_profiles
  SET
    plan           = p_plan,
    trial_ends_at  = COALESCE(p_trial_ends, trial_ends_at),
    updated_at     = now()
  WHERE id = p_user_id;
END;
$$;


--
-- Name: wants_notification(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wants_notification(p_user_id uuid, p_kind text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row public.notification_preferences;
begin
  select * into v_row from public.notification_preferences where user_id = p_user_id;

  if not found then
    -- Keine Einstellungen hinterlegt: alles an ausser der
    -- Flaute-Meldung, die standardmässig aus ist.
    return p_kind <> 'review_drought';
  end if;

  return case p_kind
    when 'weekly_summary'  then v_row.weekly_summary
    when 'negative_review' then v_row.negative_review
    when 'google_changed'  then v_row.google_changed
    when 'connection_lost' then v_row.connection_lost
    when 'holiday_hours'   then v_row.holiday_hours
    when 'review_drought'  then v_row.review_drought
    when 'monthly_report'  then v_row.monthly_report
    else true
  end;
end;
$$;


--
-- Name: weekly_recommendation_summary(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.weekly_recommendation_summary(p_user_id uuid, p_since timestamp with time zone DEFAULT (now() - '7 days'::interval)) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'completed', (
      select coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'category', e.category)), '[]'::jsonb)
        from public.events e
       where e.user_id = p_user_id
         and e.lifecycle = 'completed' and e.completed_at >= p_since
    ),
    'completedCount', (
      select count(*) from public.events
       where user_id = p_user_id and lifecycle = 'completed' and completed_at >= p_since
    ),
    'stillOpen', (
      select count(*) from public.events
       where user_id = p_user_id and lifecycle in ('new','seen','opened')
    ),
    'newThisWeek', (
      select count(*) from public.recommendation_events
       where user_id = p_user_id and action = 'created' and occurred_at >= p_since
    ),
    /* "Nicht mehr relevant" statt "verpasst". Wer eine Empfehlung
       nicht befolgt hat und das Problem hat sich erledigt, hat nichts
       falsch gemacht. */
    'noLongerRelevant', (
      select count(*) from public.events
       where user_id = p_user_id and lifecycle in ('resolved','expired')
         and resolved_at >= p_since
    )
  );
$$;


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    tokens integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    actor_type text DEFAULT 'user'::text NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'admin'::text])))
);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Append-only. Ab ca. 50 Mio. Zeilen auf monatliche Partitionierung nach created_at umstellen.';


--
-- Name: business_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    cloudinary_url text NOT NULL,
    public_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: engine_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engine_thresholds (
    key text NOT NULL,
    value numeric NOT NULL,
    description text NOT NULL,
    unit text,
    min_value numeric,
    max_value numeric,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT engine_thresholds_in_range CHECK ((((min_value IS NULL) OR (value >= min_value)) AND ((max_value IS NULL) OR (value <= max_value))))
);


--
-- Name: TABLE engine_thresholds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.engine_thresholds IS 'Stellschrauben der Intelligence Engine. Struktur steht im Code, Zahlen hier.';


--
-- Name: engine_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engine_versions (
    version text NOT NULL,
    released_at timestamp with time zone DEFAULT now() NOT NULL,
    changes text[] DEFAULT '{}'::text[] NOT NULL,
    rationale text,
    author text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE engine_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.engine_versions IS 'Änderungsverzeichnis. Verknüpft über events.engine_version mit den Empfehlungen, die eine Fassung erzeugt hat.';


--
-- Name: google_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    account_resource_name text NOT NULL,
    location_resource_name text NOT NULL,
    title text,
    address text,
    primary_phone text,
    place_id text,
    verification_state text,
    is_primary boolean DEFAULT false NOT NULL,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    postal_code text,
    locality text,
    region_code text,
    website_uri text,
    primary_category text,
    review_count integer DEFAULT 0 NOT NULL,
    average_rating numeric(2,1),
    last_synced_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: google_oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_oauth_states (
    nonce text NOT NULL,
    user_id uuid NOT NULL,
    code_verifier text NOT NULL,
    return_to text NOT NULL,
    connection_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: google_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    review_resource_name text NOT NULL,
    reviewer_display_name text,
    reviewer_photo_url text,
    reviewer_is_anonymous boolean DEFAULT false NOT NULL,
    star_rating smallint NOT NULL,
    comment text,
    google_created_at timestamp with time zone NOT NULL,
    google_updated_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    is_answered boolean DEFAULT false NOT NULL,
    answered_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT google_reviews_star_rating_check CHECK (((star_rating >= 1) AND (star_rating <= 5))),
    CONSTRAINT google_reviews_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deleted_upstream'::text])))
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_name text NOT NULL,
    contact_person text DEFAULT '-'::text NOT NULL,
    phone text DEFAULT '-'::text NOT NULL,
    trade text,
    city text,
    email text,
    source text DEFAULT 'landingpage'::text,
    status text DEFAULT 'new'::text NOT NULL,
    google_place_id text,
    google_rating numeric(3,1),
    google_review_count integer,
    visibility_score integer,
    industry_key text DEFAULT 'handwerk'::text,
    needs_manual_setup boolean DEFAULT false,
    CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'converted'::text, 'rejected'::text])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    weekly_summary boolean DEFAULT true NOT NULL,
    negative_review boolean DEFAULT true NOT NULL,
    google_changed boolean DEFAULT true NOT NULL,
    connection_lost boolean DEFAULT true NOT NULL,
    holiday_hours boolean DEFAULT true NOT NULL,
    review_drought boolean DEFAULT false NOT NULL,
    monthly_report boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_dashboard_visit_at timestamp with time zone,
    inactivity_days integer DEFAULT 10 NOT NULL,
    inactivity_reminder boolean DEFAULT true NOT NULL,
    CONSTRAINT notification_preferences_inactivity_days_check CHECK (((inactivity_days >= 3) AND (inactivity_days <= 90)))
);


--
-- Name: oauth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'google'::text NOT NULL,
    refresh_token_encrypted text,
    access_token_encrypted text,
    access_token_expires_at timestamp with time zone,
    encryption_key_id text,
    granted_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    last_refreshed_at timestamp with time zone,
    refresh_failure_count integer DEFAULT 0 NOT NULL,
    last_error_code text,
    last_error_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE oauth_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.oauth_tokens IS 'Verschlüsselte OAuth-Tokens. Kein Client-Zugriff, keine RLS-Policy, nur Service Role.';


--
-- Name: ops_alert_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_alert_log (
    alert_key text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone,
    send_count integer DEFAULT 0 NOT NULL,
    last_detail jsonb
);


--
-- Name: TABLE ops_alert_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ops_alert_log IS 'Wann welche Alarmart zuletzt gemeldet wurde. Steuert die Entprellung.';


--
-- Name: ops_alert_mutes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_alert_mutes (
    alert_key text NOT NULL,
    reason text,
    muted_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ops_alert_mutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ops_alert_mutes IS 'Stummgeschaltete Alarmarten. muted_until = null bedeutet unbefristet.';


--
-- Name: ops_alert_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_alert_status AS
 SELECT l.alert_key,
    l.first_seen_at,
    l.last_sent_at,
    l.send_count,
    (m.alert_key IS NOT NULL) AS stummgeschaltet,
    m.muted_until,
    m.reason AS stumm_grund
   FROM (public.ops_alert_log l
     LEFT JOIN public.ops_alert_mutes m ON ((m.alert_key = l.alert_key)))
  ORDER BY l.last_sent_at DESC NULLS LAST;


--
-- Name: VIEW ops_alert_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.ops_alert_status IS 'Welche Alarme gab es, wann wurden sie gemeldet, welche sind stumm.';


--
-- Name: ops_candidate_rules; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_candidate_rules AS
 SELECT rule_id,
    rule_version,
    count(*) AS would_have_created,
    count(DISTINCT user_id) AS affected_users,
    round(avg(priority), 1) AS avg_priority,
    round(avg(confidence), 2) AS avg_confidence,
    min(created_at) AS first_generated,
    max(created_at) AS last_generated
   FROM public.events
  WHERE (rule_status = 'candidate'::text)
  GROUP BY rule_id, rule_version
  ORDER BY (count(*)) DESC;


--
-- Name: recommendation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_events (
    id bigint NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    location_id uuid,
    action text NOT NULL,
    rule_id text,
    priority smallint,
    confidence numeric(3,2),
    category text,
    engine_version text,
    channel text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    rule_status text,
    rule_version text,
    CONSTRAINT recommendation_events_action_check CHECK ((action = ANY (ARRAY['created'::text, 'seen'::text, 'opened'::text, 'completed'::text, 'resolved'::text, 'dismissed'::text, 'expired'::text, 'superseded'::text, 'regenerated'::text])))
);


--
-- Name: TABLE recommendation_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.recommendation_events IS 'Append-only Verlauf jeder Empfehlung. Enthält keine personenbezogenen Inhalte.';


--
-- Name: ops_channel_effectiveness; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_channel_effectiveness AS
 WITH first_seen AS (
         SELECT DISTINCT ON (recommendation_events.event_id) recommendation_events.event_id,
            recommendation_events.channel AS first_channel,
            recommendation_events.occurred_at AS first_seen_at
           FROM public.recommendation_events
          WHERE (recommendation_events.action = 'seen'::text)
          ORDER BY recommendation_events.event_id, recommendation_events.occurred_at
        ), joined AS (
         SELECT f.first_channel,
            e.rule_id,
            e.category,
            e.lifecycle,
            e.priority,
            (EXTRACT(epoch FROM (e.completed_at - f.first_seen_at)) / (3600)::numeric) AS hours_to_complete
           FROM (first_seen f
             JOIN public.events e ON ((e.id = f.event_id)))
          WHERE (COALESCE(e.rule_status, 'active'::text) <> 'candidate'::text)
        )
 SELECT first_channel,
    count(*) AS shown,
    count(*) FILTER (WHERE (lifecycle = 'completed'::text)) AS completed,
    count(*) FILTER (WHERE (lifecycle = 'dismissed'::text)) AS dismissed,
    count(*) FILTER (WHERE (lifecycle = ANY (ARRAY['new'::text, 'seen'::text, 'opened'::text]))) AS still_open,
    round(avg(hours_to_complete), 1) AS avg_hours_to_complete,
        CASE
            WHEN (count(*) FILTER (WHERE (lifecycle = ANY (ARRAY['completed'::text, 'dismissed'::text, 'resolved'::text, 'expired'::text]))) > 0) THEN round(((count(*) FILTER (WHERE (lifecycle = 'completed'::text)))::numeric / (count(*) FILTER (WHERE (lifecycle = ANY (ARRAY['completed'::text, 'dismissed'::text, 'resolved'::text, 'expired'::text]))))::numeric), 3)
            ELSE NULL::numeric
        END AS completion_rate
   FROM joined
  GROUP BY first_channel
  ORDER BY (count(*)) DESC;


--
-- Name: ops_communication_volume; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_communication_volume AS
 SELECT (date_trunc('week'::text, created_at))::date AS week,
    template,
    count(*) AS queued,
    count(*) FILTER (WHERE (status = 'sent'::text)) AS sent,
    count(*) FILTER (WHERE (status = 'failed'::text)) AS failed,
    count(DISTINCT user_id) AS users
   FROM public.email_queue
  WHERE (created_at > (now() - '84 days'::interval))
  GROUP BY ((date_trunc('week'::text, created_at))::date), template
  ORDER BY ((date_trunc('week'::text, created_at))::date) DESC, template;


--
-- Name: ops_connection_health; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_connection_health AS
 SELECT status,
    count(*) AS accounts,
    count(*) FILTER (WHERE (last_error_at > (now() - '24:00:00'::interval))) AS errors_24h,
    min(connected_at) AS oldest,
    max(updated_at) AS last_change
   FROM public.google_accounts
  WHERE (deleted_at IS NULL)
  GROUP BY status;


--
-- Name: ops_email_queue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_email_queue AS
 SELECT template,
    status,
    count(*) AS mails,
    count(*) FILTER (WHERE (created_at > (now() - '24:00:00'::interval))) AS last_24h,
    min(scheduled_for) FILTER (WHERE (status = 'queued'::text)) AS oldest_queued,
    max(attempts) AS max_attempts_seen
   FROM public.email_queue
  GROUP BY template, status;


--
-- Name: ops_emails_per_user; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_emails_per_user AS
 SELECT (date_trunc('week'::text, created_at))::date AS week,
    round(avg(cnt), 2) AS avg_per_user,
    max(cnt) AS max_per_user,
    count(*) AS users
   FROM ( SELECT email_queue.user_id,
            date_trunc('week'::text, email_queue.created_at) AS created_at,
            count(*) AS cnt
           FROM public.email_queue
          WHERE ((email_queue.user_id IS NOT NULL) AND (email_queue.created_at > (now() - '84 days'::interval)))
          GROUP BY email_queue.user_id, (date_trunc('week'::text, email_queue.created_at))) t
  GROUP BY ((date_trunc('week'::text, created_at))::date)
  ORDER BY ((date_trunc('week'::text, created_at))::date) DESC;


--
-- Name: ops_engine_versions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_engine_versions AS
 SELECT COALESCE(engine_version, '(ohne)'::text) AS engine_version,
    count(*) AS events,
    count(DISTINCT user_id) AS users,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen
   FROM public.events
  GROUP BY COALESCE(engine_version, '(ohne)'::text)
  ORDER BY (min(created_at)) DESC;


--
-- Name: weekly_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    health_score integer NOT NULL,
    health_factors jsonb DEFAULT '{}'::jsonb NOT NULL,
    reviews_total integer DEFAULT 0 NOT NULL,
    reviews_new integer DEFAULT 0 NOT NULL,
    unanswered integer DEFAULT 0 NOT NULL,
    average_rating numeric(2,1),
    replies_published integer DEFAULT 0 NOT NULL,
    photo_count integer DEFAULT 0 NOT NULL,
    newest_review_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ops_health_distribution; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_health_distribution AS
 SELECT
        CASE
            WHEN (health_score >= 80) THEN '80-100'::text
            WHEN (health_score >= 60) THEN '60-79'::text
            WHEN (health_score >= 40) THEN '40-59'::text
            ELSE '0-39'::text
        END AS band,
    count(DISTINCT user_id) AS businesses,
    round(avg(health_score)) AS avg_score
   FROM public.weekly_snapshots
  WHERE (week_start >= ((date_trunc('week'::text, now()) - '7 days'::interval))::date)
  GROUP BY
        CASE
            WHEN (health_score >= 80) THEN '80-100'::text
            WHEN (health_score >= 60) THEN '60-79'::text
            WHEN (health_score >= 40) THEN '40-59'::text
            ELSE '0-39'::text
        END
  ORDER BY
        CASE
            WHEN (health_score >= 80) THEN '80-100'::text
            WHEN (health_score >= 60) THEN '60-79'::text
            WHEN (health_score >= 40) THEN '40-59'::text
            ELSE '0-39'::text
        END DESC;


--
-- Name: ops_ignored_notifications; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_ignored_notifications AS
 SELECT e.rule_id,
    count(*) AS sent,
    count(*) FILTER (WHERE (e.lifecycle = 'completed'::text)) AS completed,
    count(*) FILTER (WHERE (e.lifecycle = 'dismissed'::text)) AS dismissed,
    count(*) FILTER (WHERE (e.opened_at IS NULL)) AS never_opened,
        CASE
            WHEN (count(*) > 0) THEN round(((count(*) FILTER (WHERE (e.opened_at IS NULL)))::numeric / (count(*))::numeric), 3)
            ELSE NULL::numeric
        END AS ignore_rate
   FROM (public.recommendation_events r
     JOIN public.events e ON ((e.id = r.event_id)))
  WHERE ((r.action = 'seen'::text) AND (r.channel = 'notification'::text))
  GROUP BY e.rule_id
 HAVING (count(*) >= 5)
  ORDER BY
        CASE
            WHEN (count(*) > 0) THEN round(((count(*) FILTER (WHERE (e.opened_at IS NULL)))::numeric / (count(*))::numeric), 3)
            ELSE NULL::numeric
        END DESC NULLS LAST;


--
-- Name: ops_job_queue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_job_queue AS
 SELECT job_type,
    status,
    count(*) AS jobs,
    min(scheduled_for) AS oldest_scheduled,
    max(attempts) AS max_attempts_seen,
    round(avg(attempts), 1) AS avg_attempts,
    count(*) FILTER (WHERE ((scheduled_for < (now() - '01:00:00'::interval)) AND (status = 'queued'::text))) AS overdue
   FROM public.sync_jobs
  GROUP BY job_type, status;


--
-- Name: ops_priority_calibration; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_priority_calibration AS
 SELECT
        CASE
            WHEN (priority >= 80) THEN '80-100'::text
            WHEN (priority >= 60) THEN '60-79'::text
            WHEN (priority >= 40) THEN '40-59'::text
            WHEN (priority >= 20) THEN '20-39'::text
            ELSE '0-19'::text
        END AS priority_band,
    category,
    count(*) AS total,
    count(*) FILTER (WHERE (lifecycle = 'completed'::text)) AS completed,
    count(*) FILTER (WHERE (lifecycle = 'dismissed'::text)) AS dismissed,
    round(avg(confidence), 2) AS avg_confidence,
        CASE
            WHEN (count(*) FILTER (WHERE (lifecycle = ANY (ARRAY['completed'::text, 'dismissed'::text, 'resolved'::text, 'expired'::text]))) > 0) THEN round(((count(*) FILTER (WHERE (lifecycle = 'completed'::text)))::numeric / (count(*) FILTER (WHERE (lifecycle = ANY (ARRAY['completed'::text, 'dismissed'::text, 'resolved'::text, 'expired'::text]))))::numeric), 3)
            ELSE NULL::numeric
        END AS completion_rate
   FROM public.events
  WHERE (rule_id IS NOT NULL)
  GROUP BY
        CASE
            WHEN (priority >= 80) THEN '80-100'::text
            WHEN (priority >= 60) THEN '60-79'::text
            WHEN (priority >= 40) THEN '40-59'::text
            WHEN (priority >= 20) THEN '20-39'::text
            ELSE '0-19'::text
        END, category
  ORDER BY
        CASE
            WHEN (priority >= 80) THEN '80-100'::text
            WHEN (priority >= 60) THEN '60-79'::text
            WHEN (priority >= 40) THEN '40-59'::text
            WHEN (priority >= 20) THEN '20-39'::text
            ELSE '0-19'::text
        END DESC, category;


--
-- Name: ops_recommendation_flow; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_recommendation_flow AS
 SELECT (date_trunc('week'::text, occurred_at))::date AS week,
    count(*) FILTER (WHERE (action = 'created'::text)) AS created,
    count(*) FILTER (WHERE (action = 'seen'::text)) AS seen,
    count(*) FILTER (WHERE (action = 'opened'::text)) AS opened,
    count(*) FILTER (WHERE (action = 'completed'::text)) AS completed,
    count(*) FILTER (WHERE (action = 'dismissed'::text)) AS dismissed,
    count(*) FILTER (WHERE (action = 'regenerated'::text)) AS regenerated
   FROM public.recommendation_events
  WHERE (occurred_at > (now() - '84 days'::interval))
  GROUP BY ((date_trunc('week'::text, occurred_at))::date)
  ORDER BY ((date_trunc('week'::text, occurred_at))::date) DESC;


--
-- Name: ops_reply_pipeline; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ops_reply_pipeline AS
 SELECT status,
    source,
    count(*) AS replies,
    count(*) FILTER (WHERE (created_at > (now() - '24:00:00'::interval))) AS last_24h,
    min(created_at) F
