-- 20261005240000_recommendation_class.sql
--
-- Problem, Wachstum oder Marktimpuls.
--
-- WARUM
--
-- `category` sagt, WORUM es geht — Bewertungen, Profil, Verbindung.
-- Sie sagt nicht, ob etwas kaputt ist oder nur besser werden koennte.
-- Genau das entscheidet aber, wie dringend eine Aufgabe ist und ob sie
-- warten kann:
--
--   problem      Eine unbeantwortete schlechte Bewertung steht
--                oeffentlich. Eine verlorene Verbindung macht alle
--                Daten veraltet. Beides wartet nicht.
--
--   growth       Keine Bewertungen, keine Fotos, unvollstaendiges
--                Profil. Nichts ist kaputt; es fehlt etwas. Diese
--                Aufgaben koennen rotieren — sie sind naechste Woche
--                genauso wahr.
--
--   opportunity  "Vergleichbare Betriebe tun gerade X."
--                STRUKTURELL VORBEREITET, NICHT BENUTZT. Solange
--                keine Mitbewerberdaten vorliegen, darf keine Mail so
--                etwas behaupten.
--
-- Diese Unterscheidung ist die Grundlage fuer F1b: Rotation darf
-- Wachstumsaufgaben verschieben, Probleme nicht.
--
-- WAS NOCH NICHT PASSIERT
--
-- Keine Rotation, keine Reminder, keine Aenderung an der Auswahl.
-- Die Spalte wird gefuellt und ist lesbar; genutzt wird sie in F1b.
--
-- Gebaut auf der aktuellen Definition aus pg_get_functiondef.
-- Wiederholbar. Setzt bestehende Zeilen auf ihre Klasse.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — SPALTE
   ═══════════════════════════════════════════════════════════════ */

alter table public.events
  add column if not exists recommendation_class text not null default 'growth';

comment on column public.events.recommendation_class is
  'problem, growth oder opportunity. Unterscheidet "etwas ist kaputt" von "etwas fehlt noch" — Grundlage fuer Rotation in F1b.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_recommendation_class_check'
  ) then
    alter table public.events
      add constraint events_recommendation_class_check
      check (recommendation_class in ('problem', 'growth', 'opportunity'));
  end if;
end $$;

/* Fuer die Auswahl in F1b: offene Probleme eines Betriebs. */
create index if not exists events_klasse_idx
  on public.events (user_id, location_id, recommendation_class)
  where lifecycle in ('new', 'seen', 'opened');

/* ═══════════════════════════════════════════════════════════════
   2 — BESTEHENDE ZEILEN EINORDNEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Dieselbe Zuordnung wie in der Engine (REGEL_KLASSE in index.ts).
 *
 * Sie steht hier ein zweites Mal, und das ist ein bewusster
 * Kompromiss: Der Bestand muss eingeordnet werden, bevor die Engine
 * das naechste Mal laeuft. Neue Zeilen bekommen ihre Klasse von der
 * Engine; diese Zuordnung betrifft nur, was heute schon dasteht.
 *
 * Aendert sich eine Zuordnung spaeter, ist die Engine die Quelle —
 * sie ueberschreibt beim naechsten Lauf.
 */
update public.events
   set recommendation_class = case
     when type like 'connection.%'          then 'problem'
     when type like 'reviews.negative%'     then 'problem'
     when type like 'review.negative%'      then 'problem'
     when type like 'reply.publish_failed%' then 'problem'
     when type like 'sync.%'                then 'problem'
     else 'growth'
   end
 where recommendation_class = 'growth'
   and (type like 'connection.%' or type like 'review%negative%'
        or type like 'reply.publish_failed%' or type like 'sync.%');

/* ═══════════════════════════════════════════════════════════════
   3 — SCHREIBSEITE
   ═══════════════════════════════════════════════════════════════ */

CREATE OR REPLACE FUNCTION public.sync_events(p_user_id uuid, p_events jsonb, p_engine_version text, p_location_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event     jsonb;
  v_created   integer := 0;
  v_updated   integer := 0;
  v_resolved  integer := 0;
  v_id        uuid;
  v_subject   uuid;
begin
  /* Eigentum pruefen — security definer umgeht RLS. */
  if p_location_id is not null then
    if not exists (
      select 1 from public.google_locations
       where id = p_location_id and user_id = p_user_id and deleted_at is null
    ) then
      raise exception 'Standort % gehoert nicht zu Nutzer %', p_location_id, p_user_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  for v_event in select * from pg_catalog.jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    v_subject := (v_event ->> 'subjectId')::uuid;

    /* Gibt es die Empfehlung im DIESEM Umfang schon?
       is not distinct from, weil NULL = NULL in SQL nicht wahr ist —
       ohne das entstuende bei jedem Lauf eine neue Zeile. */
    select e.id into v_id
      from public.events e
     where e.user_id = p_user_id
       and e.location_id is not distinct from p_location_id
       and e.type = v_event ->> 'type'
       and e.subject_id is not distinct from v_subject
       and e.lifecycle in ('new', 'seen', 'opened')
     limit 1;

    if found then
      update public.events set
        priority           = (v_event ->> 'priority')::smallint,
        title              = v_event ->> 'title',
        summary            = v_event ->> 'summary',
        reason             = v_event ->> 'reason',
        recommended_action = v_event ->> 'recommendedAction',
        action_url         = v_event ->> 'actionUrl',
        estimated_effort   = v_event ->> 'estimatedEffort',
        estimated_minutes  = (v_event ->> 'estimatedMinutes')::smallint,
        recommendation_class = coalesce(v_event ->> 'recommendationClass', 'growth'),
        impact             = v_event ->> 'impact',
        in_dashboard       = coalesce((v_event ->> 'inDashboard')::boolean, true),
        in_weekly_email    = coalesce((v_event ->> 'inWeeklyEmail')::boolean, false),
        as_notification    = coalesce((v_event ->> 'asNotification')::boolean, false),
        is_dismissable     = coalesce((v_event ->> 'isDismissable')::boolean, true),
        data               = coalesce(v_event -> 'data', '{}'::jsonb),
        expires_at         = (v_event ->> 'expiresAt')::timestamptz,
        confidence         = (v_event ->> 'confidence')::numeric,
        explanation        = v_event -> 'explanation',
        updated_at         = pg_catalog.now()
      where id = v_id;

      v_updated := v_updated + 1;
    else
      insert into public.events (
        user_id, location_id, source, type, category, priority,
        title, summary, reason, recommended_action, action_url,
        estimated_effort, estimated_minutes, recommendation_class, impact,
        in_dashboard, in_weekly_email, as_notification, is_dismissable,
        subject_type, subject_id, data, expires_at,
        rule_id, confidence, explanation
      ) values (
        p_user_id,
        p_location_id,
        coalesce(v_event ->> 'source', 'google_business'),
        v_event ->> 'type',
        v_event ->> 'category',
        (v_event ->> 'priority')::smallint,
        v_event ->> 'title',
        v_event ->> 'summary',
        v_event ->> 'reason',
        v_event ->> 'recommendedAction',
        v_event ->> 'actionUrl',
        v_event ->> 'estimatedEffort',
        (v_event ->> 'estimatedMinutes')::smallint,
        /* Fehlt die Angabe, gilt growth: Eine Wachstumsaufgabe
           faelschlich als Problem zu melden waere Alarmismus. */
        coalesce(v_event ->> 'recommendationClass', 'growth'),
        v_event ->> 'impact',
        coalesce((v_event ->> 'inDashboard')::boolean, true),
        coalesce((v_event ->> 'inWeeklyEmail')::boolean, false),
        coalesce((v_event ->> 'asNotification')::boolean, false),
        coalesce((v_event ->> 'isDismissable')::boolean, true),
        v_event ->> 'subjectType',
        v_subject,
        coalesce(v_event -> 'data', '{}'::jsonb),
        (v_event ->> 'expiresAt')::timestamptz,
        v_event ->> 'ruleId',
        (v_event ->> 'confidence')::numeric,
        v_event -> 'explanation'
      );

      v_created := v_created + 1;
    end if;
  end loop;

  /* Veraltetes aufloesen — NUR im eigenen Umfang.
     Ohne p_location_id loeste eine S&I-Auswertung offene
     WERKRUF-Empfehlungen als geloest auf. */
  v_resolved := public.resolve_stale_events(p_user_id, coalesce(p_events, '[]'::jsonb), p_location_id);

  return pg_catalog.jsonb_build_object(
    'created',    v_created,
    'updated',    v_updated,
    'resolved',   v_resolved,
    'locationId', p_location_id,
    'scope',      case when p_location_id is null then 'account' else 'location' end,
    'engineVersion', p_engine_version
  );
end;
$function$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Wie verteilt sich der Bestand?
--   select recommendation_class, count(*), string_agg(distinct type, ', ')
--   from public.events group by recommendation_class;
--
-- Nach dem naechsten Engine-Lauf — die Engine setzt die Klasse:
--   select type, recommendation_class, created_at
--   from public.events
--   where lifecycle in ('new','seen','opened')
--   order by created_at desc;
--
-- Entsteht die neue Regel bei S&I?
--   select type, title, recommendation_class
--   from public.events
--   where type = 'reviews.none_yet' and lifecycle in ('new','seen','opened');
--   → nach dem naechsten Lauf: "Erste Bewertungen einsammeln", growth.
