-- 20261005190000_mail_dashboard_sort_alignment.sql
--
-- Mail und Dashboard sortieren gleich.
--
-- DIE ABWEICHUNG
--
--   Dashboard (events_feed):
--     priority desc, created_at asc, id asc
--
--   Mail (top_recommendations_for_email):
--     priority desc, minutes asc, created_at asc, id asc
--                    ^^^^^^^^^^^
--
-- Der Aufwand stand in der Mail zwischen Prioritaet und Alter. Bei
-- gleicher Prioritaet entschied damit "schnell zuerst" — eine zweite
-- Rangfolge, die niemand so beschlossen hat.
--
-- Beispiel:
--
--   A  Prioritaet 50, vor drei Tagen angelegt, 30 Minuten
--   B  Prioritaet 50, heute angelegt,           5 Minuten
--
--   Dashboard:  A, B   (A wartet laenger)
--   Mail:       B, A   (B geht schneller)
--
-- Zwei Antworten auf dieselbe Frage. Welche gilt, haengt davon ab, wo
-- der Kunde hinsieht.
--
-- WAS BLEIBT
--
-- estimated_minutes bleibt im Ergebnis und bleibt die primaere Quelle
-- fuer den angezeigten Aufwand. Der Regex auf estimated_effort bleibt
-- als Rueckfall fuer Altbestand vor Paket D2.
--
-- Nur aus dem ORDER BY verschwindet die Zahl: Sie beschreibt, wie
-- lange etwas dauert — nicht, wie wichtig es ist. Das entscheidet die
-- Engine ueber die Prioritaet.
--
-- Wiederholbar. Aendert keine Daten.

begin;

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
           Ergebnis, aber nicht mehr im ORDER BY. */
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
      /* Exakt wie events_feed. Bei gleicher Prioritaet entscheidet das
         Alter, nicht der Aufwand: Was laenger wartet, kommt zuerst. */
      order by e.priority desc, e.created_at asc, e.id asc
      limit v_limit
    ) x;

  return v_ergebnis;
end;
$$;

comment on function public.top_recommendations_for_email is
  'Aufgaben der Wochenmail. Sortierung exakt wie events_feed: priority desc, created_at asc, id asc. estimated_minutes beschreibt den Aufwand, nicht den Rang.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Gleiche Reihenfolge in beiden Kanaelen:
--   with d as (
--     select ord, x ->> 'id' as id
--     from jsonb_array_elements(
--       public.events_feed('<uid>', public.werkruf_score_location('<uid>'), 3) -> 'items'
--     ) with ordinality q(x, ord)),
--   m as (
--     select ord, x ->> 'id' as id
--     from jsonb_array_elements(
--       public.top_recommendations_for_email('<uid>', 3)
--     ) with ordinality q(x, ord))
--   select d.ord, d.id as dashboard, m.id as mail, d.id = m.id as gleich
--   from d full join m on m.ord = d.ord order by coalesce(d.ord, m.ord);
--   → Spalte gleich ueberall true, sofern beide Kanalflags gesetzt sind.
--
-- Aufwand bleibt sichtbar:
--   select x ->> 'title', x ->> 'minutes'
--   from jsonb_array_elements(public.top_recommendations_for_email('<uid>', 3)) x;
