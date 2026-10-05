-- 20261005180000_communication_path_alignment.sql
--
-- Dashboard und Wochenmail auf dieselbe fachliche Grundlage.
--
-- DER ECHTE PFAD
--
--   cron comm-weekly (0 7 * * 1)
--     → POST send-email/plan, X-Worker-Secret
--       → schedule_communications(channel)
--         → plan_communications(user_id)          entscheidet OB
--         → top_recommendations_for_email(uid, 3) liefert WAS
--         → completed_this_week(user_id)
--         → enqueue_email(...)  → email_queue
--   cron mail-worker (*/10)
--     → POST send-email/run  → render → Versand
--
-- schedule_weekly_summaries() kommt darin NICHT vor.
--
-- WAS DIESE MIGRATION AENDERT
--
--   1. events_feed schliesst rule_status = 'candidate' aus.
--      Bisher nur die Mail. Eine Regel im Probebetrieb erschien
--      dadurch im Dashboard, aber nicht in der Mail — dieselbe Regel,
--      zwei Antworten.
--
--   2. top_recommendations_for_email deckelt hart auf drei.
--      p_limit ist ein Vorschlag, kein Versprechen: Eine Mail mit
--      zwanzig Aufgaben ist keine Hilfe.
--
--   3. estimated_minutes ist die primaere Quelle.
--      Der Regex auf estimated_effort bleibt nur fuer Altbestand, der
--      vor Paket D2 entstand.
--
-- WAS SIE NICHT AENDERT
--
-- schedule_communications und plan_communications bleiben unberuehrt.
-- Keine neuen Regeln, keine neuen Schwellen, kein anderer Score.
--
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — FACHLICHE FREIGABE, EINE DEFINITION
   ═══════════════════════════════════════════════════════════════ */

/*
 * Darf diese Regel Kunden erreichen?
 *
 * `candidate` ist der Probebetrieb: Die Engine darf solche Regeln
 * auswerten und Events anlegen, damit sich beobachten laesst, wie oft
 * sie feuern — aber weder Dashboard noch Mail zeigen sie.
 *
 * NULL und 'active' gelten als freigegeben. Andere Werte werden
 * ebenfalls durchgelassen: Ein unbekannter Status still auszublenden
 * hiesse, dass eine neue Einstufung ohne Zutun Empfehlungen
 * verschwinden laesst. Kommt ein weiterer Status hinzu, gehoert er
 * hier ausdruecklich hinein.
 */
create or replace function public.rule_freigegeben(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, 'active') <> 'candidate';
$$;

comment on function public.rule_freigegeben is
  'Darf diese Regel Kunden erreichen? candidate ist Probebetrieb. Unbekannte Werte gelten als freigegeben — ein stilles Ausblenden waere schlimmer als ein sichtbarer Fehler.';

/* ═══════════════════════════════════════════════════════════════
   2 — DASHBOARD: PROBEBETRIEB AUSSCHLIESSEN
   ═══════════════════════════════════════════════════════════════ */

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
      /* NEU: Probebetrieb erreicht auch das Dashboard nicht.
         Vorher filterte nur die Mail — dieselbe Regel, zwei
         Antworten. */
      and public.rule_freigegeben(e.rule_status)
      and (p_category is null or e.category = p_category)
      and (
        case
          when p_lifecycle is not null then e.lifecycle = any(p_lifecycle)
          else public.event_ist_offen(e.lifecycle, e.in_dashboard, e.cooldown_until, e.expires_at)
        end
      )
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
  'Empfehlungs-Feed eines Standorts. Dieselbe fachliche Freigabe wie die Mail: rule_freigegeben, Lebenszyklus, Standort.';

/* ═══════════════════════════════════════════════════════════════
   3 — MAIL: HARTE OBERGRENZE UND STRUKTURIERTER AUFWAND
   ═══════════════════════════════════════════════════════════════ */

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

  /*
   * Hoechstens drei.
   *
   * p_limit ist ein Vorschlag, kein Versprechen. Eine Mail mit zwanzig
   * Aufgaben ist keine Hilfe, sondern eine zweite Aufgabe — und ein
   * Aufrufer, der 20 uebergibt, hat das Produktprinzip vermutlich
   * nicht gemeint.
   */
  v_limit := least(greatest(coalesce(p_limit, 3), 0), 3);

  select coalesce(jsonb_agg(x order by x.priority desc, x.minutes, x.created_at), '[]'::jsonb)
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
        /*
         * estimated_minutes ist die Quelle.
         *
         * Der Regex bleibt ausschliesslich fuer Altbestand, der vor
         * Paket D2 entstand und die Spalte nicht gefuellt hat. Bei
         * "unter 1 Stunde" zoege er die 1 — deshalb steht die Spalte
         * davor.
         */
        coalesce(
          e.estimated_minutes,
          (regexp_match(e.estimated_effort, '(\d+)'))[1]::integer,
          99
        ) as minutes
      from public.events e
      where e.user_id = p_user_id
        and (e.location_id = v_location or e.location_id is null)
        and e.lifecycle in ('new', 'seen', 'opened')
        and e.in_weekly_email
        and public.rule_freigegeben(e.rule_status)
        and (e.cooldown_until is null or e.cooldown_until <= now())
        and (e.expires_at is null or e.expires_at > now())
      order by
        e.priority desc,
        coalesce(
          e.estimated_minutes,
          (regexp_match(e.estimated_effort, '(\d+)'))[1]::integer,
          99
        ),
        /* Dritte Spalte wie im Dashboard: haelt die Reihenfolge bei
           gleicher Prioritaet und gleichem Aufwand fest. */
        e.created_at asc,
        e.id asc
      limit v_limit
    ) x;

  return v_ergebnis;
end;
$$;

comment on function public.top_recommendations_for_email is
  'Aufgaben der Wochenmail: ein Betrieb plus Konto, hoechstens drei, Aufwand aus estimated_minutes. Gleiche Freigabe und Standortlogik wie events_feed.';

/* ═══════════════════════════════════════════════════════════════
   4 — ERLEDIGTES: FREIGABE ANGLEICHEN
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.completed_this_week(
  p_user_id uuid,
  p_since   timestamptz default (now() - interval '7 days')
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_location uuid;
  v_ergebnis jsonb;
begin
  v_location := public.werkruf_score_location(p_user_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'completedAt', e.completed_at
         ) order by e.completed_at desc), '[]'::jsonb)
    into v_ergebnis
    from public.events e
   where e.user_id = p_user_id
     and (e.location_id = v_location or e.location_id is null)
     and e.lifecycle = 'completed'
     and public.rule_freigegeben(e.rule_status)
     and e.completed_at >= p_since;

  return v_ergebnis;
end;
$$;

comment on function public.completed_this_week is
  'Erledigte Aufgaben der Woche fuer den ausgewaehlten Betrieb plus Konto. Gleiche Freigabe wie Mail und Dashboard.';

/* ═══════════════════════════════════════════════════════════════
   5 — ALTLAST KENNZEICHNEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * schedule_weekly_summaries() wird NICHT geloescht.
 *
 * Kein produktiver Pfad ruft sie auf — der Cron geht ueber
 * send-email/plan → schedule_communications. Sie zu entfernen
 * koennte aber Migrationen, Tests oder Admin-Wege brechen, die ich
 * nicht kenne.
 *
 * Stattdessen ein Kommentar, der die Verwechslung beim naechsten Mal
 * verhindert. Genau diese Verwechslung hat Paket D4 wirkungslos
 * gemacht.
 */
do $$
begin
  if to_regprocedure('public.schedule_weekly_summaries()') is not null then
    execute $sql$
      comment on function public.schedule_weekly_summaries is
        'ALTLAST — NICHT PRODUKTIV. Der Cron comm-weekly geht ueber send-email/plan → schedule_communications → top_recommendations_for_email. Diese Funktion ruft niemand auf. Vor einer Aenderung pruefen: select proname from pg_proc where pg_get_functiondef(oid) like ''%schedule_weekly_summaries%'';'
    $sql$;
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Ruft irgendetwas die Altlast auf?
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname <> 'schedule_weekly_summaries'
--      and pg_get_functiondef(p.oid) like '%schedule_weekly_summaries%';
--   select jobname from cron.job where command like '%schedule_weekly_summaries%';
--   → beide leer.
--
-- Dashboard und Mail, derselbe Betrieb:
--   select
--     public.events_feed('<uid>', public.werkruf_score_location('<uid>'), 3) -> 'items' -> 0 ->> 'id' as dashboard,
--     public.top_recommendations_for_email('<uid>', 3) -> 0 ->> 'id' as mail;
--   → identisch, sofern das Event beide Kanalflags traegt.
--
-- Obergrenze:
--   select jsonb_array_length(public.top_recommendations_for_email('<uid>', 20));
--   → hoechstens 3.
--
-- Aufwand aus der Spalte:
--   select x ->> 'title', x ->> 'minutes'
--   from jsonb_array_elements(public.top_recommendations_for_email('<uid>', 3)) x;
