-- 20261001080000_events_feed.sql
--
-- Leseseite der Decision Engine: der Empfehlungs-Feed.
--
-- WARUM IN SQL UND NICHT IN DER EDGE FUNCTION
--
-- Sortierung, Filter, Pagination und die Standortsicht gehoeren an die
-- Stelle, an der die Daten liegen. Die Function waere sonst gezwungen,
-- mehr Zeilen zu holen als sie ausgibt, und die Reihenfolge im
-- Speicher herzustellen — bei Pagination ergaebe das instabile
-- Ergebnisse.
--
-- DIE SORTIERUNG IST VERBINDLICH
--
--   1. priority absteigend        was den Betrieb am meisten bewegt
--   2. created_at aufsteigend     bei Gleichstand das Aeltere zuerst
--   3. id                         damit die Reihenfolge ueber Seiten
--                                 hinweg stabil bleibt
--
-- Ohne das dritte Kriterium koennten zwei Empfehlungen mit gleicher
-- Prioritaet und gleichem Zeitstempel auf Seite 1 und Seite 2
-- gleichzeitig oder gar nicht erscheinen.
--
-- WAS NICHT ERSCHEINT
--
--   lifecycle completed/dismissed/expired/resolved
--   cooldown_until in der Zukunft
--   expires_at in der Vergangenheit
--   in_dashboard = false
--
-- Diese Migration legt nur Lesefunktionen an. Keine Datenaenderung.
-- Wiederholbar.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — WELCHE EMPFEHLUNGEN SIND OFFEN?
   ═══════════════════════════════════════════════════════════════ */

/*
 * Eine Sicht, kein Duplikat der Bedingungen.
 *
 * Die Frage "ist diese Empfehlung offen?" wird an drei Stellen
 * gebraucht: Feed, Zaehler, Wochenmail. Sie dreimal zu formulieren
 * hiesse, dass sie dreimal auseinanderlaufen kann.
 */
/*
 * Felder einzeln statt als Zeilentyp.
 *
 * Ein Zeilentyp bindet die Funktion an genau eine Tabelle — eine
 * temporaere Kopie oder ein Subquery-Ergebnis hat einen anderen Typ,
 * und der Aufruf scheitert mit "function does not exist". Vier
 * Parameter sind laenger zu schreiben und dafuer ueberall verwendbar.
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
  select p_lifecycle in ('new', 'seen', 'opened')
     and coalesce(p_in_dashboard, true)
     and (p_cooldown_until is null or p_cooldown_until <= pg_catalog.now())
     and (p_expires_at is null or p_expires_at > pg_catalog.now());
$$;

comment on function public.event_ist_offen is
  'Ist diese Empfehlung offen? Eine Definition fuer Feed, Zaehler und Wochenmail.';

/* ═══════════════════════════════════════════════════════════════
   2 — DER FEED
   ═══════════════════════════════════════════════════════════════ */

/*
 * @param p_location_id  Standort. NULL heisst: Konto-Empfehlungen
 *                       (location_id is null), NICHT "alle".
 *                       "Alle" waere die Vermischung, die D2 behebt.
 * @param p_include_account  Konto-Empfehlungen zusaetzlich mitliefern.
 *                       Verbindungsprobleme betreffen jeden Betrieb
 *                       und wuerden sonst nirgends erscheinen.
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
/* nicht stable: legt eine temporaere Tabelle an */
security definer
set search_path = 'pg_catalog, public, pg_temp'
as $$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_items    jsonb;
  v_gesamt   integer;
  v_offen    integer;
begin
  /* Eigentum des Standorts pruefen — security definer umgeht RLS. */
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

  /* Der Umfang als wiederverwendbare Bedingung.
     Ein CTE lebt nur fuer EINE Anweisung — Zaehlung und Seite
     brauchen die Bedingung aber beide. Deshalb eine temporaere
     Tabelle, die am Transaktionsende verschwindet. */
  create temporary table if not exists _feed_sichtbar
    on commit drop as select * from public.events where false;
  delete from _feed_sichtbar;

  insert into _feed_sichtbar
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
    and (p_category is null or e.category = p_category)
    and (
      case
        when p_lifecycle is not null then e.lifecycle = any(p_lifecycle)
        else public.event_ist_offen(e.lifecycle, e.in_dashboard, e.cooldown_until, e.expires_at)
      end
    );

  select count(*), count(*) filter (where public.event_ist_offen(f.lifecycle, f.in_dashboard, f.cooldown_until, f.expires_at))
    into v_gesamt, v_offen
    from _feed_sichtbar f;

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
      /* Ob die Empfehlung zum Betrieb oder zum Konto gehoert — die
         Oberflaeche stellt beides verschieden dar. */
      'scope',             case when s.location_id is null then 'account' else 'location' end,
      'createdAt',         s.created_at,
      'seenAt',            s.seen_at,
      'ruleId',            s.rule_id,
      /* data enthaelt Fachdaten der Regel, keine Interna. */
      'data',              s.data
    ) order by s.priority desc, s.created_at asc, s.id asc), '[]'::jsonb)
  into v_items
  from (
    select * from _feed_sichtbar
    /* Die dritte Spalte ist kein Schmuck: Ohne sie ist die Reihenfolge
       bei gleicher Prioritaet und gleichem Zeitstempel nicht
       festgelegt, und Pagination liefert Dubletten oder Luecken. */
    order by priority desc, created_at asc, id asc
    limit v_limit offset v_offset
  ) s;

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
  'Empfehlungs-Feed eines Standorts. Sortierung priority desc, created_at asc, id asc — die dritte Spalte haelt die Pagination stabil.';

/* ═══════════════════════════════════════════════════════════════
   3 — GESEHEN MARKIEREN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Markiert die ausgelieferten Empfehlungen als gesehen.
 *
 * Bewusst getrennt vom Lesen: Ein Feed-Abruf ist nicht zwingend ein
 * Ansehen. Die Oberflaeche entscheidet, wann sie es meldet — etwa
 * wenn die Karte tatsaechlich im Sichtbereich war.
 *
 * Nur new → seen. Alles weitere bleibt unberuehrt, damit ein zweiter
 * Aufruf keinen Zustand zurueckdreht.
 */
create or replace function public.events_mark_seen(
  p_user_id uuid,
  p_ids     uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.events
     set lifecycle = 'seen',
         seen_at = coalesce(seen_at, pg_catalog.now()),
         updated_at = pg_catalog.now()
   where id = any(p_ids)
     and user_id = p_user_id      -- Eigentum, nicht nur die ID
     and lifecycle = 'new';

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

comment on function public.events_mark_seen is
  'Markiert new → seen. Prueft das Eigentum ueber user_id, nicht nur die ID.';

revoke all on function public.events_feed(uuid, uuid, integer, integer, text, text[], boolean) from public, anon;
revoke all on function public.events_mark_seen(uuid, uuid[]) from public, anon;
revoke all on function public.event_ist_offen(text, boolean, timestamptz, timestamptz) from public, anon;

grant execute on function public.events_feed(uuid, uuid, integer, integer, text, text[], boolean) to authenticated, service_role;
grant execute on function public.events_mark_seen(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.event_ist_offen(text, boolean, timestamptz, timestamptz) to authenticated, service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Feed des ausgewaehlten Standorts:
--   select jsonb_pretty(public.events_feed(
--     '<user-id>', public.werkruf_score_location('<user-id>')));
--
-- Je Betrieb:
--   select l.title,
--          public.events_feed(l.user_id, l.id) -> 'open' as offen,
--          jsonb_array_length(public.events_feed(l.user_id, l.id) -> 'items') as geliefert
--   from public.google_locations l where l.deleted_at is null;
--
-- Nur Konto-Empfehlungen:
--   select public.events_feed('<user-id>', null) -> 'items';
