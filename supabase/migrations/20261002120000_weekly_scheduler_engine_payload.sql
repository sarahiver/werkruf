-- 20261002120000_weekly_scheduler_engine_payload.sql
--
-- Der Wochenmail-Scheduler nutzt die standortreine Weekly-Schicht.
--
-- WAS BISHER FEHLTE
--
-- 20261002080000 hat weekly_payload_for() und weekly_mail_events()
-- gebaut — aufgerufen wurden sie nie. schedule_weekly_summaries()
-- arbeitete weiter nutzerweit:
--
--   compute_health_score(user_id)            ohne Standort
--   google_reviews where user_id = ...       alle Betriebe
--   review_replies where user_id = ...       alle Betriebe
--   weekly_snapshots ohne location_id        nicht vergleichbar
--
-- und schrieb kein engineEvents ins Payload. Die Mail hatte damit
-- nichts zu rendern, und send-email fiel auf eine leere Liste zurueck.
--
-- WAS SICH AENDERT
--
--   Standort kommt aus weekly_payload_for(), nicht geraten
--   Score, Bewertungen, Fotos und Aufgaben von dort
--   Neue Bewertungen und Antworten je Standort gezaehlt
--   Snapshot mit location_id und score_version
--   Vorwochenvergleich nur gegen denselben Standort und dieselbe
--     Score-Fassung
--
-- WAS BLEIBT
--
--   Nutzerauswahl, wants_notification, Dedupe-Schluessel, die
--   redaktionellen Wochenmetriken und die Rueckgabeform.
--
-- Wiederholbar. Aendert keine Daten.

begin;

create or replace function public.schedule_weekly_summaries()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week    date := date_trunc('week', now())::date;
  v_prev    date := (date_trunc('week', now()) - interval '7 days')::date;
  v_queued  integer := 0;
  v_ohne    integer := 0;   -- kein eindeutiger Standort
  v_stumm   integer := 0;   -- Wochenmail abbestellt
  v_row     record;
  v_payload jsonb;
  v_location uuid;
  v_prior   public.weekly_snapshots;
  v_new     integer;
  v_lowest  integer;
  v_pub     integer;
  v_score_version smallint;
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
    /* Standort, Score und Aufgaben aus einer Quelle. Kein zweiter
       Aufruf von compute_health_score — der rechnete nutzerweit. */
    v_payload := public.weekly_payload_for(v_row.user_id);

    /* Mehrere Betriebe ohne Auswahl, oder gar keiner: keine Mail.
       Eine Mail mit gemischten Empfehlungen waere schlechter als
       keine — der Kunde wuesste nicht, welcher Betrieb gemeint ist. */
    if (v_payload ->> 'skip')::boolean then
      v_ohne := v_ohne + 1;
      continue;
    end if;

    v_location      := (v_payload ->> 'locationId')::uuid;
    v_score_version := coalesce((v_payload ->> 'scoreVersion')::smallint, 1);

    /* ── Neue Bewertungen der Vorwoche, NUR dieses Standorts ── */
    select count(*), min(star_rating)
      into v_new, v_lowest
      from public.google_reviews
     where user_id = v_row.user_id
       and location_id = v_location
       and status = 'active'
       and google_created_at >= v_prev and google_created_at < v_week;

    /* ── Veroeffentlichte Antworten, NUR zu Bewertungen dieses
          Standorts ──
       review_replies traegt keinen Standort; der Bezug entsteht ueber
       die Bewertung. Ohne den Join zaehlte eine Antwort bei WERKRUF in
       der S&I-Mail mit. */
    select count(*) into v_pub
      from public.review_replies rr
      join public.google_reviews gr on gr.id = rr.review_id
     where rr.user_id = v_row.user_id
       and gr.location_id = v_location
       and rr.status = 'published'
       and rr.published_at >= v_prev and rr.published_at < v_week;

    /* ── Vorwoche: gleicher Betrieb, gleiche Score-Fassung ──
       Ein Vergleich zwischen S&I und WERKRUF ergaebe eine erfundene
       Veraenderung. Eine andere Score-Fassung misst etwas anderes. */
    select * into v_prior
      from public.weekly_snapshots
     where user_id = v_row.user_id
       and week_start = v_prev
       and location_id is not distinct from v_location
       and score_version is not distinct from v_score_version;

    insert into public.weekly_snapshots (
      user_id, location_id, score_version, week_start,
      health_score, health_factors,
      reviews_total, reviews_new, unanswered, average_rating,
      replies_published, photo_count, newest_review_at
    ) values (
      v_row.user_id, v_location, v_score_version, v_week,
      (v_payload ->> 'healthScore')::integer,
      coalesce(v_payload -> 'factors', '{}'::jsonb),
      (v_payload ->> 'reviewsTotal')::integer,
      v_new,
      (v_payload ->> 'unanswered')::integer,
      (v_payload ->> 'averageRating')::numeric,
      v_pub,
      (v_payload ->> 'photoCount')::integer,
      (v_payload ->> 'newestReviewAt')::timestamptz
    )
    on conflict (user_id, week_start) do update
      set location_id       = excluded.location_id,
          score_version     = excluded.score_version,
          health_score      = excluded.health_score,
          health_factors    = excluded.health_factors,
          reviews_total     = excluded.reviews_total,
          reviews_new       = excluded.reviews_new,
          unanswered        = excluded.unanswered,
          average_rating    = excluded.average_rating,
          replies_published = excluded.replies_published,
          photo_count       = excluded.photo_count,
          newest_review_at  = excluded.newest_review_at;

    if not public.wants_notification(v_row.user_id, 'weekly_summary') then
      v_stumm := v_stumm + 1;
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

           /* Welcher Betrieb — damit ein Nutzer mit zwei Betrieben
              sofort sieht, worum es geht. */
           'locationId',    v_location,
           'locationTitle', v_payload ->> 'locationTitle',

           'healthScore',   (v_payload ->> 'healthScore')::integer,
           'scoreVersion',  v_score_version,
           /* null, wenn es keine vergleichbare Vorwoche gibt — die
              Mail sagt dann "erster Bericht", statt eine Veraenderung
              zu erfinden. */
           'healthDelta',   case when v_prior.user_id is null then null
                                 else (v_payload ->> 'healthScore')::integer - v_prior.health_score end,

           'reviewsTotal',  (v_payload ->> 'reviewsTotal')::integer,
           'reviewsNew',    v_new,
           'lowestNewRating', v_lowest,
           'unanswered',    (v_payload ->> 'unanswered')::integer,
           'averageRating', (v_payload ->> 'averageRating')::numeric,
           'ratingDelta',   case when v_prior.user_id is null or v_prior.average_rating is null then null
                                 else (v_payload ->> 'averageRating')::numeric - v_prior.average_rating end,
           'repliesPublished', v_pub,
           'photoCount',    (v_payload ->> 'photoCount')::integer,
           'newestReviewAt', v_payload ->> 'newestReviewAt',
           'factors',       coalesce(v_payload -> 'factors', '{}'::jsonb),
           'priorFactors',  coalesce(v_prior.health_factors, '{}'::jsonb),

           /* Die Aufgaben — unveraendert durchgereicht.
              Kein Mapping, keine zweite Ableitung. Eine leere Liste
              ist ein gueltiges Ergebnis: Die Mail sagt dann
              "diese Woche musst du nichts tun". */
           'engineEvents',  coalesce(v_payload -> 'engineEvents', '[]'::jsonb),
           'eventCount',    coalesce((v_payload ->> 'eventCount')::integer, 0)
         )
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'snapshots',   v_queued,
    'queued',      v_queued,
    'ohneStandort', v_ohne,
    'abbestellt',  v_stumm,
    'week',        v_week,
    'scheduledAt', now());
end;
$$;

comment on function public.schedule_weekly_summaries is
  'Stellt die Wochenmails ein. Standort, Score und Aufgaben aus weekly_payload_for(); Wochenmetriken und Snapshot standortbezogen.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Trockenlauf — zaehlt, aendert aber die Queue nur, wenn der
-- Dedupe-Schluessel neu ist:
--   select public.schedule_weekly_summaries();
--
-- Was landet im Payload?
--   select payload -> 'locationTitle' as betrieb,
--          payload -> 'healthScore'   as score,
--          jsonb_array_length(payload -> 'engineEvents') as aufgaben,
--          payload -> 'engineEvents' -> 0 -> 'title' as erste_aufgabe
--   from public.email_queue
--   where template = 'weekly_summary'
--   order by created_at desc limit 5;
--
-- Snapshot standortbezogen?
--   select s.week_start, l.title, s.location_id, s.score_version, s.health_score
--   from public.weekly_snapshots s
--   left join public.google_locations l on l.id = s.location_id
--   order by s.week_start desc limit 5;
--
-- Wer bekam keine Mail?
--   Rueckgabewert von schedule_weekly_summaries(): ohneStandort,
--   abbestellt.
