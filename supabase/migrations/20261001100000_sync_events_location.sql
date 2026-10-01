-- 20261001100000_sync_events_location.sql
--
-- Schreibseite der Decision Engine, standortbezogen.
--
-- WAS BISHER FEHLTE
--
-- sync_events(user_id, events, engine_version) schrieb kein
-- location_id und kein estimated_minutes, und loeste nutzerweit auf.
-- Die Tabellenspalten dafuer liegen seit 20260930160000 bereit,
-- resolve_stale_events ebenfalls — aufgerufen wurden sie nie.
--
-- DIE NEUE FASSUNG
--
-- sync_events(user_id, events, engine_version, location_id)
--
--   schreibt location_id an jede Zeile
--   uebernimmt estimatedMinutes als Zahl
--   loest ueber resolve_stale_events NUR im eigenen Umfang auf
--
-- p_location_id = null bedeutet KONTOUMFANG, nicht "alle". Die alte
-- dreistellige Signatur bleibt erhalten und delegiert dorthin —
-- bestehende Aufrufer brechen nicht, verhalten sich aber ab sofort
-- als Konto-Auswertung.
--
-- Wiederholbar. Aendert keine Daten.

begin;

create or replace function public.sync_events(
  p_user_id        uuid,
  p_events         jsonb,
  p_engine_version text,
  p_location_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
        estimated_effort, estimated_minutes, impact,
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
$$;

comment on function public.sync_events(uuid, jsonb, text, uuid) is
  'Schreibt Engine-Ergebnisse fuer GENAU EINEN Umfang. p_location_id = null bedeutet Konto, nicht "alle".';

/*
 * Die alte Signatur bleibt — als Konto-Auswertung.
 *
 * Bestehende Aufrufer brechen nicht. Sie bewerten ab sofort aber nur
 * noch den Kontoumfang; wer Betriebe auswerten will, gibt den Standort
 * mit. Das ist die sicherere Richtung: Ein vergessener Parameter fuehrt
 * dazu, dass zu WENIG bewertet wird, nicht dass Betriebe vermischt
 * werden.
 */
create or replace function public.sync_events(
  p_user_id        uuid,
  p_events         jsonb,
  p_engine_version text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.sync_events(p_user_id, p_events, p_engine_version, null::uuid);
$$;

comment on function public.sync_events(uuid, jsonb, text) is
  'Altlast-Signatur. Delegiert an den Kontoumfang. Fuer Betriebe die vierstellige Fassung verwenden.';

revoke all on function public.sync_events(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.sync_events(uuid, jsonb, text, uuid) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Nach dem naechsten Engine-Lauf:
--   select type, location_id, estimated_minutes, lifecycle, created_at
--   from public.events
--   where user_id = '<user-id>' and lifecycle in ('new','seen','opened')
--   order by created_at desc;
--
-- Erwartet: location_id gefuellt ausser bei connection.*,
-- estimated_minutes gefuellt.
--
-- Empfehlungen je Betrieb:
--   select l.title, e.type, e.estimated_minutes
--   from public.events e
--   join public.google_locations l on l.id = e.location_id
--   where e.lifecycle in ('new','seen','opened')
--   order by l.title, e.priority desc;
