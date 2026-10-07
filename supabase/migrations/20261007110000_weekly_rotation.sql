-- 20261007110000_weekly_rotation.sql
--
-- Welche faellige Aufgabe kommt diese Woche in die Mail?
--
-- ZWEI FRAGEN, GETRENNT
--
--   Darf sie?    weekly_event_is_due — Erinnerungszustand
--   Welche?      die Reihenfolge unten
--
-- DIE REIHENFOLGE
--
--   1. Prioritaet, grob gestuft
--   2. innerhalb einer Stufe: noch nie gezeigt zuerst
--   3. dann laenger ueberfaellig zuerst
--   4. dann aelter zuerst
--   5. dann id
--
-- WARUM GESTUFT UND NICHT EXAKT
--
-- Ein Rangpunkt Unterschied ist keine fachliche Aussage. Foto 60 und
-- Bewertungen 59 sind gleich wichtig; dass die eine Zahl groesser ist,
-- war eine Setzung beim Schreiben der Regel.
--
-- Ohne Stufen gaebe es keine Rotation: Foto 60 schlaegt Bewertungen 59
-- jede Woche, und die Rotation liefe ins Leere.
--
-- Die Stufen entsprechen den Baendern, die das Dashboard anzeigt:
--
--   80+  kritisch
--   60+  wichtig
--   40+  hilfreich
--   < 40 wenn du Zeit hast
--
-- Innerhalb einer Stufe rotiert es, zwischen den Stufen nicht. Eine
-- Aufgabe mit 85 schlaegt eine mit 70, auch wenn die nie gezeigt
-- wurde.
--
-- WAS SICH NICHT AENDERT
--
-- canonical_recommendation_events bleibt die fachliche Wahrheit.
-- Das Dashboard sieht die Faelligkeit nicht — eine offene Aufgabe
-- bleibt dort sichtbar, auch wenn sie diese Woche nicht gemailt wird.
--
-- Gebaut auf der aktuellen Definition aus pg_get_functiondef.
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — PRIORITAETSSTUFE
   ═══════════════════════════════════════════════════════════════ */

/*
 * Die Stufe einer Prioritaet.
 *
 * Dieselben Grenzen, die das Dashboard als "kritisch", "wichtig",
 * "hilfreich" und "wenn du Zeit hast" anzeigt. Sie hier zu
 * wiederholen waere eine zweite Wahrheit — aber die Anzeige liegt in
 * JavaScript, und SQL kann sie nicht lesen. Aendert sich eine Grenze,
 * gehoert sie an beiden Stellen geaendert; der Test haelt das fest.
 */
create or replace function public.priority_stufe(p_priority smallint)
returns smallint
language sql
immutable
as $$
  select case
    when coalesce(p_priority, 0) >= 80 then 4   -- kritisch
    when coalesce(p_priority, 0) >= 60 then 3   -- wichtig
    when coalesce(p_priority, 0) >= 40 then 2   -- hilfreich
    else 1                                      -- wenn du Zeit hast
  end::smallint;
$$;

comment on function public.priority_stufe is
  'Die Prioritaetsstufe. Innerhalb einer Stufe rotiert die Wochenmail, zwischen den Stufen nicht. Grenzen wie in der Dashboard-Anzeige.';

/* ═══════════════════════════════════════════════════════════════
   2 — DIE AUSWAHL
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

  /* Hoechstens drei. p_limit ist ein Vorschlag, kein Versprechen. */
  v_limit := least(greatest(coalesce(p_limit, 3), 0), 3);

  select coalesce(jsonb_agg(x order by x.stufe desc, x.nie_gezeigt desc,
                                     x.ueberfaellig_tage desc,
                                     x.created_at asc, x.id asc), '[]'::jsonb)
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
        e.recommendation_class,
        case when e.location_id is null then 'account' else 'location' end as scope,

        /* ── Die Sortiermerkmale, sichtbar im Ergebnis ──
           Sie stehen mit im Rueckgabewert, damit nachvollziehbar ist,
           warum eine Aufgabe gewonnen hat — und damit F2 sie spaeter
           einem Modell geben kann, ohne sie neu zu berechnen. */

        public.priority_stufe(e.priority) as stufe,

        /* Noch nie in einer Mail: hat Vorrang innerhalb der Stufe. */
        (coalesce(e.weekly_reminder_count, 0) = 0) as nie_gezeigt,
        coalesce(e.weekly_reminder_count, 0)       as weekly_reminder_count,
        e.weekly_last_sent_at,
        e.weekly_next_due_at,

        /* Wie lange ueberfaellig. Was laenger wartet, kommt zuerst —
           innerhalb derselben Stufe und unter den schon Gezeigten. */
        case
          when e.weekly_next_due_at is null then 0
          else greatest(0, extract(epoch from (now() - e.weekly_next_due_at)) / 86400)
        end::numeric(10,2) as ueberfaellig_tage,

        coalesce(
          e.estimated_minutes,
          (regexp_match(e.estimated_effort, '(\d+)'))[1]::integer,
          99
        ) as minutes

      from public.canonical_recommendation_events(p_user_id, v_location, true) e
      where e.in_weekly_email
        /* Der Erinnerungszustand entscheidet, ob sie diese Woche
           darf. Das Dashboard sieht diese Bedingung nicht. */
        and public.weekly_event_is_due(e.weekly_next_due_at, e.weekly_reminder_count)
      order by
        public.priority_stufe(e.priority) desc,
        (coalesce(e.weekly_reminder_count, 0) = 0) desc,
        case
          when e.weekly_next_due_at is null then 0
          else greatest(0, extract(epoch from (now() - e.weekly_next_due_at)) / 86400)
        end desc,
        e.created_at asc,
        e.id asc
      limit v_limit
    ) x;

  return v_ergebnis;
end;
$$;

comment on function public.top_recommendations_for_email is
  'Faellige Aufgaben der Wochenmail, hoechstens drei. Reihenfolge: Prioritaetsstufe, dann nie gezeigt, dann laenger ueberfaellig, dann aelter.';

/* ═══════════════════════════════════════════════════════════════
   3 — ZAEHLER FUER DEN ZUSTAND DER WOCHE
   ═══════════════════════════════════════════════════════════════ */

/*
 * Wie viele sind offen, wie viele faellig?
 *
 * Die Unterscheidung traegt die drei Zustaende der Wochenmail:
 *
 *   offen 0,  faellig 0  →  alles erledigt
 *   offen 3,  faellig 0  →  diese Woche nichts Neues
 *   offen 3,  faellig 2  →  zwei Aufgaben
 *
 * Der mittlere Fall ist der Grund fuer dieses Paket. Ohne ihn saehe
 * die Mail aus wie "alles perfekt", obwohl drei Aufgaben offen sind —
 * sie sind nur gerade nicht an der Reihe.
 */
create or replace function public.weekly_counts(
  p_user_id     uuid,
  p_location_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'open', count(*),
    'due',  count(*) filter (
      where public.weekly_event_is_due(e.weekly_next_due_at, e.weekly_reminder_count)
    )
  )
  from public.canonical_recommendation_events(p_user_id, p_location_id, true) e
  where e.in_weekly_email;
$$;

comment on function public.weekly_counts is
  'Offene und faellige Aufgaben der Wochenmail. Die Differenz unterscheidet "alles erledigt" von "diese Woche nichts Neues".';

revoke all on function public.weekly_counts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.weekly_counts(uuid, uuid) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Was kommt diese Woche?
--   select x ->> 'title' as aufgabe, x ->> 'stufe' as stufe,
--          x ->> 'nie_gezeigt' as neu, x ->> 'ueberfaellig_tage' as tage
--   from jsonb_array_elements(
--     public.top_recommendations_for_email('<user-id>', 3)) x;
--
-- Welcher Zustand?
--   select public.weekly_counts('<user-id>',
--            public.werkruf_score_location('<user-id>'));
--   → {"open": 3, "due": 0} heisst: diese Woche nichts Neues.
--
-- Das Dashboard sieht die Faelligkeit nicht:
--   select jsonb_array_length(
--     public.events_feed('<user-id>',
--       public.werkruf_score_location('<user-id>'), 50) -> 'items');
--   → unveraendert, auch wenn due = 0.
