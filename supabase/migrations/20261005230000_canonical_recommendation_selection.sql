-- 20261005230000_canonical_recommendation_selection.sql
--
-- Eine Definition davon, welche Empfehlung fachlich gilt.
--
-- DER BEFUND
--
-- events_feed und top_recommendations_for_email beantworten dieselbe
-- Frage — welche Empfehlungen gelten fuer diesen Betrieb — an zwei
-- Stellen. Der Vergleich der aktuellen Definitionen:
--
--   Bereich      events_feed              top_recommendations
--   ──────────────────────────────────────────────────────────
--   User         user_id = p_user_id      gleich            ✓
--   Standort     Parameter                intern aufgeloest  ✗
--   Konto        abwaehlbar               immer dabei        ✗
--   Lifecycle    in event_ist_offen       fest nachgebaut    ✗
--   rule_status  rule_freigegeben         rule_freigegeben   ✓
--   Cooldown     in event_ist_offen       eigene Bedingung   ✗
--   Expiry       in event_ist_offen       eigene Bedingung   ✗
--   Kanal        in_dashboard             in_weekly_email    gewollt
--   Sortierung   priority, created, id    gleich             ✓
--   Limit        1 bis 50                 hart 3             gewollt
--
-- Viermal dieselbe Regel an zwei Orten. Jede davon ist in Paket D
-- schon einmal auseinandergelaufen: die Sortierung in D4.7, der
-- Probebetrieb in D4.6.
--
-- DIE URSACHE
--
-- event_ist_offen vermischt zwei Dinge:
--
--   event_ist_offen(lifecycle, in_dashboard, cooldown_until, expires_at)
--                               ^^^^^^^^^^^^
--
-- Der Kanal steckt mitten in der fachlichen Pruefung. Die Mail konnte
-- die Funktion deshalb nicht verwenden und hat die drei uebrigen
-- Bedingungen nachgebaut. Genau dort entsteht Drift.
--
-- WAS DIESE MIGRATION TUT
--
--   event_ist_fachlich_offen   Lifecycle, Cooldown, Expiry. Kein Kanal.
--   event_ist_offen            bleibt, wird zum Wrapper: in_dashboard
--                              AND event_ist_fachlich_offen
--   canonical_recommendation_events(user, location)
--                              die gemeinsame Auswahl, kanalneutral
--
-- events_feed und top_recommendations_for_email bauen darauf auf und
-- behalten ihre Signaturen. schedule_communications bleibt unberuehrt.
--
-- KEINE NEUE FACHLOGIK
--
-- Prioritaeten, Schwellen, Eventtypen, Cooldown-Strategie: unveraendert.
-- Nur zusammengefuehrt, was zweimal dastand.
--
-- Gebaut auf den aktuellen Definitionen aus pg_get_functiondef.
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — FACHLICH OFFEN, OHNE KANAL
   ═══════════════════════════════════════════════════════════════ */

/*
 * Gilt diese Empfehlung noch?
 *
 * Drei Bedingungen, kein Kanal:
 *
 *   Lifecycle   new, seen, opened — alles andere ist erledigt,
 *               weggeklickt oder abgelaufen
 *   Cooldown    eine Empfehlung in Pause ist vorhanden, aber nicht
 *               faellig
 *   Expiry      "antworte innerhalb von 48 Stunden" verfaellt
 *
 * Ob sie im Dashboard oder in der Mail erscheint, entscheidet der
 * Kanal — und der gehoert nicht hierher.
 */
create or replace function public.event_ist_fachlich_offen(
  p_lifecycle      text,
  p_cooldown_until timestamptz,
  p_expires_at     timestamptz
)
returns boolean
language sql
stable
as $$
  select p_lifecycle in ('new', 'seen', 'opened')
     and (p_cooldown_until is null or p_cooldown_until <= pg_catalog.now())
     and (p_expires_at is null or p_expires_at > pg_catalog.now());
$$;

comment on function public.event_ist_fachlich_offen is
  'Gilt diese Empfehlung noch? Lifecycle, Cooldown, Expiry — ohne Kanal. Die gemeinsame Definition fuer Dashboard und Mail.';

/*
 * Der bestehende Helfer bleibt — als Wrapper.
 *
 * Seine Signatur ist in Gebrauch, und ein Breaking Change waere hier
 * keinen Gewinn wert. Sichtbar wird dafuer, was er wirklich ist:
 * Kanal UND fachliche Pruefung.
 */
create or replace function public.event_ist_offen(
  p_lifecycle      text,
  p_in_dashboard   boolean,
  p_cooldown_until timestamptz,
  p_expires_at     timestamptz
)
returns boolean
language sql
stable
as $$
  select coalesce(p_in_dashboard, true)
     and public.event_ist_fachlich_offen(p_lifecycle, p_cooldown_until, p_expires_at);
$$;

comment on function public.event_ist_offen is
  'Dashboard-Variante: in_dashboard UND event_ist_fachlich_offen. Bleibt fuer bestehende Aufrufer; neue Logik gehoert in event_ist_fachlich_offen.';

/* ═══════════════════════════════════════════════════════════════
   2 — DIE GEMEINSAME AUSWAHL
   ═══════════════════════════════════════════════════════════════ */

/*
 * Welche Empfehlungen gelten fuer diesen Betrieb?
 *
 * Kanalneutral: kein in_dashboard, kein in_weekly_email, kein Limit.
 * Wer diese Funktion aufruft, entscheidet selbst, was er davon zeigt.
 *
 * Der Standort kommt als PARAMETER, nicht aus einer Aufloesung
 * hierin. So ist an jeder Aufrufstelle sichtbar, ueber welchen Betrieb
 * gesprochen wird — und zwei Aufrufer koennen nicht versehentlich
 * verschiedene meinen.
 *
 * @param p_location_id    der Betrieb. NULL heisst: nur Konto-
 *                         Ereignisse, nicht "alle".
 * @param p_include_account Konto-Ereignisse mitliefern. Eine verlorene
 *                         Verbindung betrifft jeden Betrieb und wuerde
 *                         sonst nirgends erscheinen.
 *
 * Die Sortierung steht hier, nicht bei den Aufrufern:
 *
 *   priority desc     was den Betrieb am meisten bewegt
 *   created_at asc    bei Gleichstand das Aeltere — es wartet laenger
 *   id asc            damit die Reihenfolge ueberhaupt festliegt
 *
 * Die dritte Spalte ist kein Schmuck: Ohne sie ist die Reihenfolge bei
 * gleicher Prioritaet und gleichem Zeitstempel nicht definiert.
 */
create or replace function public.canonical_recommendation_events(
  p_user_id         uuid,
  p_location_id     uuid    default null,
  p_include_account boolean default true
)
returns setof public.events
language sql
stable
security definer
set search_path = ''
as $$
  select e.*
  from public.events e
  where e.user_id = p_user_id
    and (
      (p_location_id is not null
        and (e.location_id = p_location_id
             or (p_include_account and e.location_id is null)))
      or
      (p_location_id is null and e.location_id is null)
    )
    and public.rule_freigegeben(e.rule_status)
    and public.event_ist_fachlich_offen(e.lifecycle, e.cooldown_until, e.expires_at)
  order by e.priority desc, e.created_at asc, e.id asc;
$$;

comment on function public.canonical_recommendation_events is
  'Die gemeinsame fachliche Auswahl: Standort, Konto, Freigabe, Lifecycle, Cooldown, Expiry, Sortierung. OHNE Kanal und OHNE Limit — das entscheidet der Aufrufer.';

/* Nur serverseitig. Das Frontend geht ueber events_feed. */
revoke all on function public.canonical_recommendation_events(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.canonical_recommendation_events(uuid, uuid, boolean)
  to service_role;

revoke all on function public.event_ist_fachlich_offen(text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.event_ist_fachlich_offen(text, timestamptz, timestamptz)
  to authenticated, service_role;

/* ═══════════════════════════════════════════════════════════════
   3 — DASHBOARD
   ═══════════════════════════════════════════════════════════════ */

/*
 * Was hier bleibt: der Kanalfilter, das Limit, die Pagination, das
 * DTO und der ausdrueckliche Lifecycle-Filter fuer die Historie.
 *
 * Was verschwindet: Standortbedingung, rule_freigegeben, Lifecycle,
 * Cooldown, Expiry, Sortierung. Alles aus der gemeinsamen Basis.
 *
 * Signatur und Rueckgabe unveraendert.
 */
create or replace function public.events_feed(
  p_user_id         uuid,
  p_location_id     uuid    default null,
  p_limit           integer default 10,
  p_offset          integer default 0,
  p_category        text    default null,
  p_lifecycle       text[]  default null,
  p_include_account boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_items    jsonb;
  v_gesamt   integer;
  v_offen    integer;
begin
  if p_location_id is not null then
    if not exists (
      select 1 from public.google_locations
       where id = p_location_id and user_id = p_user_id and deleted_at is null
    ) then
      return pg_catalog.jsonb_build_object(
        'items', '[]'::jsonb, 'total', 0, 'open', 0,
        'limit', v_limit, 'offset', v_offset,
        'error', 'standort_nicht_gefunden');
    end if;
  end if;

  with sichtbar as (
    /*
     * Ein ausdruecklicher Lifecycle-Filter umgeht die gemeinsame
     * Basis — fuer eine Historienansicht ("zeig mir die erledigten").
     * Standort, Freigabe und Kanal gelten dabei weiter.
     */
    select e.*
    from public.events e
    where p_lifecycle is not null
      and e.user_id = p_user_id
      and (
        (p_location_id is not null
          and (e.location_id = p_location_id
               or (p_include_account and e.location_id is null)))
        or
        (p_location_id is null and e.location_id is null)
      )
      and public.rule_freigegeben(e.rule_status)
      and e.lifecycle = any(p_lifecycle)
      and coalesce(e.in_dashboard, true)
      and (p_category is null or e.category = p_category)

    union all

    /* Der Normalfall: die gemeinsame Auswahl, gefiltert auf den
       Dashboard-Kanal. */
    select e.*
    from public.canonical_recommendation_events(
           p_user_id, p_location_id, p_include_account) e
    where p_lifecycle is null
      and coalesce(e.in_dashboard, true)
      and (p_category is null or e.category = p_category)
  ),
  zahlen as (
    select
      count(*) as gesamt,
      count(*) filter (
        where public.event_ist_offen(lifecycle, in_dashboard, cooldown_until, expires_at)
      ) as offen
    from sichtbar
  ),
  seite as (
    select * from sichtbar
    /* Dieselbe Sortierung wie in der gemeinsamen Basis — das union all
       gibt die Reihenfolge nicht weiter. */
    order by priority desc, created_at asc, id asc
    limit v_limit offset v_offset
  ),
  gebaut as (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',                s.id,
      'type',              s.type,
      'category',          s.category,
      'priority',          s.priority,
      'title',             s.title,
      'summary',           s.summary,
      'reason',            s.reason,
      'recommendedAction', s.recommended_action,
      'actionUrl',         s.action_url,
      'estimatedEffort',   s.estimated_effort,
      'estimatedMinutes',  s.estimated_minutes,
      'impact',            s.impact,
      'isDismissable',     s.is_dismissable,
      'lifecycle',         s.lifecycle,
      'subjectType',       s.subject_type,
      'subjectId',         s.subject_id,
      'locationId',        s.location_id,
      'scope',             case when s.location_id is null then 'account' else 'location' end,
      'createdAt',         s.created_at,
      'seenAt',            s.seen_at,
      'ruleId',            s.rule_id,
      'data',              s.data
    ) order by s.priority desc, s.created_at asc, s.id asc), '[]'::jsonb) as items
    from seite s
  )
  select gebaut.items, zahlen.gesamt, zahlen.offen
    into v_items, v_gesamt, v_offen
    from gebaut, zahlen;

  return pg_catalog.jsonb_build_object(
    'items',  v_items,
    'total',  coalesce(v_gesamt, 0),
    'open',   coalesce(v_offen, 0),
    'limit',  v_limit,
    'offset', v_offset,
    'hasMore', v_offset + v_limit < coalesce(v_gesamt, 0),
    'locationId', p_location_id
  );
end;
$$;

comment on function public.events_feed is
  'Empfehlungs-Feed des Dashboards. Auswahl aus canonical_recommendation_events, hier nur Kanal, Kategorie, Pagination und DTO.';

/* ═══════════════════════════════════════════════════════════════
   4 — WOCHENMAIL
   ═══════════════════════════════════════════════════════════════ */

/*
 * Was hier bleibt: Standortaufloesung, Kanalfilter, das harte Limit
 * von drei, das Mail-DTO.
 *
 * Was verschwindet: Lifecycle, Cooldown, Expiry, rule_freigegeben,
 * Sortierung. Alles aus der gemeinsamen Basis.
 *
 * Die Standortaufloesung bleibt hier, damit schedule_communications
 * unveraendert bleibt — die Funktion hat in Paket D zweimal Aerger
 * gemacht, und ein weiterer Eingriff waere mehr Risiko als Gewinn.
 */
create or replace function public.top_recommendations_for_email(
  p_user_id uuid,
  p_limit   integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_location uuid;
  v_limit    integer;
  v_ergebnis jsonb;
begin
  v_location := public.werkruf_score_location(p_user_id);

  /* Hoechstens drei. p_limit ist ein Vorschlag, kein Versprechen. */
  v_limit := least(greatest(coalesce(p_limit, 3), 0), 3);

  select coalesce(jsonb_agg(x order by x.priority desc, x.created_at asc, x.id asc),
                  '[]'::jsonb)
    into v_ergebnis
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
        e.location_id,
        e.created_at,
        case when e.location_id is null then 'account' else 'location' end as scope,
        /* Beschreibt den Aufwand, nicht den Rang. Steht deshalb im
           Ergebnis, aber nicht im ORDER BY. Der Regex bleibt
           ausschliesslich fuer Altbestand vor Paket D2. */
        coalesce(
          e.estimated_minutes,
          (regexp_match(e.estimated_effort, '(\d+)'))[1]::integer,
          99
        ) as minutes
      /* Die gemeinsame Auswahl — Standort, Freigabe, Lifecycle,
         Cooldown, Expiry und Sortierung kommen von dort. */
      from public.canonical_recommendation_events(p_user_id, v_location, true) e
      where e.in_weekly_email
      limit v_limit
    ) x;

  return v_ergebnis;
end;
$$;

comment on function public.top_recommendations_for_email is
  'Aufgaben der Wochenmail. Auswahl aus canonical_recommendation_events, hier nur Standortaufloesung, Kanal, Limit 3 und DTO.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Dieselbe Grundmenge in beiden Kanaelen:
--   with gemeinsam as (
--     select id, priority, created_at
--     from public.canonical_recommendation_events(
--            '<uid>', public.werkruf_score_location('<uid>'))
--     where in_dashboard and in_weekly_email)
--   select g.id,
--          g.id = (public.events_feed('<uid>', public.werkruf_score_location('<uid>'), 50)
--                    -> 'items' -> (row_number() over (order by g.priority desc,
--                                   g.created_at, g.id) - 1)::int ->> 'id') as passt
--   from gemeinsam g;
--
-- Einfacher: der Contract-Test in supabase/tests/recommendationContract.test.sql
--
-- Rechte:
--   select proname, proacl from pg_proc
--    where proname in ('canonical_recommendation_events',
--                      'event_ist_fachlich_offen');
--   → canonical nur service_role.
