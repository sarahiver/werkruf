-- 20261002080000_weekly_engine_events.sql
--
-- Die Wochenmail bezieht ihre Aufgaben aus der Decision Engine.
--
-- WAS BISHER GESCHAH
--
-- schedule_weekly_summaries baut ein Payload aus Rohwerten, und
-- assessWeek in send-email leitet daraus eigene Aufgaben ab:
--
--   unanswered > 0        → "Bewertungen beantworten"
--   photoCount < 5        → "Fotos hochladen"
--   daysSinceReview > 45  → "Bewertungen einsammeln"
--
-- Das ist eine zweite Decision Engine mit eigenen Schwellen. Das
-- Dashboard zeigt "5 Fotos hochladen" mit Prioritaet 29, die Mail
-- sagt etwas anderes — aus denselben Daten, nach anderen Regeln.
--
-- AUSSERDEM: nutzerweit statt standortbezogen
--
-- Der Lauf zieht Bewertungen und Antworten ueber `user_id`. Bei zwei
-- Betrieben mischt die Mail beide — genau das, was D1 bis D3 fuer
-- Score, Engine und Dashboard behoben haben.
--
-- DIESE MIGRATION
--
--   weekly_mail_events()        Aufgaben aus events, standortrein,
--                               Kanal E-Mail, hoechstens drei
--   schedule_weekly_summaries() Standortbezug und Engine-Events im
--                               Payload
--
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — AUFGABEN FUER DIE MAIL
   ═══════════════════════════════════════════════════════════════ */

/*
 * Dieselben Events wie im Dashboard, gefiltert auf den Mailkanal.
 *
 * Der Unterschied zu events_feed ist allein `in_weekly_email` statt
 * `in_dashboard`. Die Standortlogik, die Sortierung und die
 * Lebenszyklus-Filter sind identisch — eine Regel, die im Dashboard
 * oben steht, steht auch in der Mail oben.
 */
create or replace function public.weekly_mail_events(
  p_user_id     uuid,
  p_location_id uuid,
  p_limit       integer default 3
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sichtbar as (
    select e.*
    from public.events e
    where e.user_id = p_user_id
      /* Dieser Betrieb plus echte Konto-Ereignisse. Eine verlorene
         Verbindung betrifft jeden Betrieb und gehoert in jede Mail. */
      and (e.location_id = p_location_id or e.location_id is null)
      and e.in_weekly_email
      and e.lifecycle in ('new', 'seen', 'opened')
      and (e.cooldown_until is null or e.cooldown_until <= pg_catalog.now())
      and (e.expires_at is null or e.expires_at > pg_catalog.now())
  )
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
    /* Die Zahl, nicht der Text. Ein Wochenbudget laesst sich nicht
       aus "5 Minuten" per Regex errechnen. */
    'estimatedMinutes',  s.estimated_minutes,
    'impact',            s.impact,
    'locationId',        s.location_id,
    'scope',             case when s.location_id is null then 'account' else 'location' end
  ) order by s.priority desc, s.created_at asc, s.id asc), '[]'::jsonb)
  from (
    select * from sichtbar
    order by priority desc, created_at asc, id asc
    limit greatest(coalesce(p_limit, 3), 0)
  ) s;
$$;

comment on function public.weekly_mail_events is
  'Aufgaben der Wochenmail aus der Decision Engine. Gleiche Standortlogik und Sortierung wie events_feed, gefiltert auf in_weekly_email.';

revoke all on function public.weekly_mail_events(uuid, uuid, integer) from public, anon;
grant execute on function public.weekly_mail_events(uuid, uuid, integer) to service_role;

/* ═══════════════════════════════════════════════════════════════
   2 — PAYLOAD MIT STANDORT UND ENGINE-EVENTS
   ═══════════════════════════════════════════════════════════════ */

/*
 * Ergaenzt das Wochen-Payload um:
 *
 *   locationId, locationTitle   damit ein Nutzer mit zwei Betrieben
 *                               sieht, um welchen es geht
 *   engineEvents                die Aufgaben, hoechstens drei
 *   scoreVersion                damit alte und neue Werte nicht
 *                               stillschweigend verglichen werden
 *
 * Nutzer mit mehreren Betrieben ohne Auswahl bekommen KEINE Mail.
 * Eine Mail mit gemischten Empfehlungen waere schlechter als keine:
 * Der Kunde wuesste nicht, welcher Betrieb gemeint ist, und wuerde
 * womoeglich am falschen arbeiten.
 */
create or replace function public.weekly_payload_for(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location uuid;
  v_titel    text;
  v_health   jsonb;
  v_events   jsonb;
  v_anzahl   integer;
begin
  v_location := public.werkruf_score_location(p_user_id);

  if v_location is null then
    select count(*) into v_anzahl
      from public.google_locations
     where user_id = p_user_id and deleted_at is null;

    return pg_catalog.jsonb_build_object(
      'skip', true,
      'grund', case when v_anzahl > 1 then 'mehrere_ohne_auswahl' else 'kein_standort' end,
      'locationCount', v_anzahl);
  end if;

  select title into v_titel from public.google_locations where id = v_location;

  v_health := public.compute_location_health_score(p_user_id, v_location);
  v_events := public.weekly_mail_events(p_user_id, v_location, 3);

  return pg_catalog.jsonb_build_object(
    'skip',          false,
    'locationId',    v_location,
    'locationTitle', v_titel,
    'healthScore',   (v_health ->> 'score')::integer,
    'scoreVersion',  (v_health ->> 'scoreVersion')::integer,
    'reviewsTotal',  (v_health ->> 'reviewsTotal')::integer,
    'unanswered',    (v_health ->> 'unanswered')::integer,
    'averageRating', (v_health ->> 'averageRating')::numeric,
    'photoCount',    (v_health ->> 'photoCount')::integer,
    'newestReviewAt',(v_health ->> 'newestReviewAt'),
    /* Die Aufgaben. Keine zweite Ableitung in der Mail. */
    'engineEvents',  v_events,
    'eventCount',    pg_catalog.jsonb_array_length(v_events)
  );
end;
$$;

comment on function public.weekly_payload_for is
  'Wochen-Payload eines Nutzers: Standort, kanonischer Score und Engine-Aufgaben. skip=true bei mehreren Betrieben ohne Auswahl — eine gemischte Mail waere schlechter als keine.';

revoke all on function public.weekly_payload_for(uuid) from public, anon;
grant execute on function public.weekly_payload_for(uuid) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Was bekaeme die Wochenmail?
--   select jsonb_pretty(public.weekly_payload_for('<user-id>'));
--
-- Nur die Aufgaben:
--   select jsonb_pretty(public.weekly_mail_events(
--     '<user-id>', public.werkruf_score_location('<user-id>')));
--
-- Wer bekaeme keine Mail und warum?
--   select u.id, p.grund, p.locationCount
--   from auth.users u,
--        lateral public.weekly_payload_for(u.id) p(payload)
--   where (p.payload ->> 'skip')::boolean;
--
-- Dashboard und Mail im Vergleich — die Aufgaben muessen fachlich
-- dieselben sein, soweit beide Kanaele freigegeben sind:
--   select
--     (public.events_feed('<user-id>', public.werkruf_score_location('<user-id>'), 3) -> 'items') as dashboard,
--     public.weekly_mail_events('<user-id>', public.werkruf_score_location('<user-id>'), 3) as mail;
