-- 20261005160000_email_recommendations_location.sql
--
-- Die Wochenmail zeigt nur noch Empfehlungen EINES Betriebs.
--
-- WAS TATSAECHLICH LAEUFT
--
-- Der Weg zur Wochenmail ist:
--
--   cron comm-weekly
--     → send-email/plan
--       → schedule_communications()
--         → top_recommendations_for_email(user_id, 3)
--
-- NICHT schedule_weekly_summaries(). Die habe ich in Paket D4
-- umgebaut — sie wird von niemandem aufgerufen. Der Umbau war
-- korrekt und wirkungslos.
--
-- DREI BEFUNDE IN top_recommendations_for_email
--
--   1. where e.user_id = p_user_id, ohne Standort.
--      Die Mail vom 05.10. zeigte zwei Eintraege "5 Fotos hochladen" —
--      einen von S&I, einen von WERKRUF. Der Kunde konnte nicht
--      erkennen, welcher Betrieb gemeint war.
--
--   2. regexp_match(estimated_effort, '(\d+)') fuer die Sortierung.
--      Seit Paket D2 steht der Aufwand als Zahl in estimated_minutes.
--      Der Regex zerlegt weiterhin "5 Minuten" — und liefert bei
--      "ca. 10 Min." die 10, bei "unter 1 Stunde" die 1.
--
--   3. rule_status <> 'candidate' schliesst Regeln im Probebetrieb
--      aus. Bleibt unveraendert.
--
-- WAS NICHT GEAENDERT WIRD
--
-- schedule_communications und plan_communications bleiben unberuehrt.
-- Die Korrektur sitzt dort, wo das Problem ist. Ein Umbau des
-- Aufrufers waere mehr Flaeche fuer denselben Zweck.
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
  v_ergebnis jsonb;
begin
  /* Der Betrieb, um den es geht — dieselbe Regel wie beim WERKRUF
     Score und im Dashboard. Bei mehreren ohne Auswahl: null. */
  v_location := public.werkruf_score_location(p_user_id);

  /*
   * Kein eindeutiger Betrieb: KEINE Empfehlungen.
   *
   * Eine Mail mit Aufgaben beider Betriebe ist schlechter als eine
   * ohne — der Kunde wuesste nicht, welcher gemeint ist, und wuerde
   * womoeglich am falschen arbeiten.
   *
   * Konto-Ereignisse wie eine verlorene Verbindung erscheinen
   * trotzdem: Sie betreffen jeden Betrieb.
   */
  select coalesce(jsonb_agg(x order by x.priority desc, x.minutes), '[]'::jsonb)
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
        /* Zum Betrieb oder zum Konto — die Mail stellt beides
           verschieden dar. */
        case when e.location_id is null then 'account' else 'location' end as scope,
        /*
         * Die Zahl, nicht der Text.
         *
         * estimated_minutes ist seit Paket D2 gefuellt. Der Regex
         * bleibt als Rueckfall fuer Altbestand, der vor der Umstellung
         * entstand — er greift nur, wenn die Spalte leer ist.
         */
        coalesce(
          e.estimated_minutes,
          (regexp_match(e.estimated_effort, '(\d+)'))[1]::integer,
          99
        ) as minutes
      from public.events e
      where e.user_id = p_user_id
        /* Dieser Betrieb plus echte Konto-Ereignisse. Bei v_location
           is null bleiben nur die Konto-Ereignisse uebrig. */
        and (e.location_id = v_location or e.location_id is null)
        and e.lifecycle in ('new', 'seen', 'opened')
        and e.in_weekly_email
        and coalesce(e.rule_status, 'active') <> 'candidate'
        /* Pausierte und abgelaufene erscheinen nicht — in der Mail
           so wenig wie im Dashboard. */
        and (e.cooldown_until is null or e.cooldown_until <= now())
        and (e.expires_at is null or e.expires_at > now())
      order by
        e.priority desc,
        coalesce(
          e.estimated_minutes,
          (regexp_match(e.estimated_effort, '(\d+)'))[1]::integer,
          99
        )
      limit greatest(coalesce(p_limit, 3), 0)
    ) x;

  return v_ergebnis;
end;
$$;

comment on function public.top_recommendations_for_email is
  'Aufgaben der Wochenmail fuer GENAU EINEN Betrieb plus Konto-Ereignisse. Aufwand aus estimated_minutes; der Regex auf estimated_effort bleibt nur als Rueckfall fuer Altbestand.';

/* ═══════════════════════════════════════════════════════════════
   ERLEDIGTES DER WOCHE
   ═══════════════════════════════════════════════════════════════ */

/*
 * Dieselbe Vermischung, dieselbe Korrektur.
 *
 * "Du hast diese Woche X erledigt" soll sich auf den Betrieb beziehen,
 * um den die Mail geht.
 */
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
     and e.completed_at >= p_since;

  return v_ergebnis;
end;
$$;

comment on function public.completed_this_week is
  'Erledigte Aufgaben der Woche fuer den ausgewaehlten Betrieb plus Konto.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Was bekaeme die naechste Wochenmail?
--   select jsonb_pretty(public.top_recommendations_for_email(
--     'cd3080f3-b31a-4df9-81fd-6c63e3f18159', 3));
--
-- Erwartet: EINE Aufgabe, mit locationId des ausgewaehlten Betriebs
-- und minutes = 5 (aus estimated_minutes, nicht aus dem Text).
--
-- Gegenprobe gegen das Dashboard — dieselbe Empfehlung muss oben
-- stehen:
--   select
--     public.events_feed('<user-id>', public.werkruf_score_location('<user-id>'), 3)
--       -> 'items' -> 0 ->> 'id'  as dashboard,
--     public.top_recommendations_for_email('<user-id>', 3)
--       -> 0 ->> 'id'             as mail;
--
-- Woher kommt der Aufwand?
--   select title, estimated_minutes, estimated_effort
--   from public.events where lifecycle in ('new','seen','opened');
--   → estimated_minutes gefuellt: der Regex greift nicht mehr.
