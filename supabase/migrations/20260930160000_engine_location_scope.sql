-- 20260930160000_engine_location_scope.sql
--
-- Macht die Decision Engine standortrein (Paket D2, SQL-Schicht).
--
-- DER GEFAEHRLICHSTE PUNKT ZUERST
--
-- sync_events loest bisher nutzerweit auf:
--
--   for v_id in select e.id from public.events e
--    where e.user_id = p_user_id
--      and e.lifecycle in ('new','seen','opened')
--      and not exists (... in den gelieferten Events ...)
--
-- Wird S&I ausgewertet, kommen WERKRUF-Empfehlungen naturgemaess nicht
-- im Ergebnis vor — und werden dadurch als geloest markiert. Der Kunde
-- verliert offene Aufgaben eines Betriebs, weil ein anderer
-- ausgewertet wurde.
--
-- WEITERE PUNKTE
--
--   events.location_id        Betriebskontext, getrennt von subject_id
--   events.estimated_minutes  Zahl statt Text — kein Regex auf
--                             "2 Minuten" fuer das Wochenbudget
--   Eindeutigkeit             user + location + type + subject
--   Impact-Metriken           je Standort, nicht nutzerweit
--   Snapshots                 location_id und score_version
--
-- BACKFILL
--
-- Nur wo die Zuordnung beweisbar ist: Nutzer mit genau einem aktiven
-- Standort. Bei mehreren wird nicht geraten — eine falsche Zuordnung
-- waere schlimmer als keine, weil sie richtig aussaehe.
--
-- Wiederholbar. Nicht destruktiv.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — SPALTEN
   ═══════════════════════════════════════════════════════════════ */

alter table public.events
  add column if not exists location_id uuid references public.google_locations(id) on delete cascade,
  add column if not exists estimated_minutes smallint;

comment on column public.events.location_id is
  'Betriebskontext. NULL nur bei echten Konto-/Verbindungsereignissen. NICHT aus subject_id ableiten — subject_id ist das Bezugsobjekt (Review, Location), location_id der Betrieb.';

comment on column public.events.estimated_minutes is
  'Aufwand als Zahl, direkt aus der Engine. estimated_effort bleibt fuer die Anzeige. Keine Fachlogik aus Text parsen, wenn die Zahl strukturiert vorliegt.';

create index if not exists events_location_offen_idx
  on public.events (location_id, priority desc)
  where lifecycle in ('new', 'seen', 'opened');

/* Vorsichtiges Backfill: nur bei genau einem aktiven Standort. */
update public.events e
   set location_id = einzig.id
  from (
    select l.user_id, l.id
    from public.google_locations l
    where l.deleted_at is null
      and (select count(*) from public.google_locations x
            where x.user_id = l.user_id and x.deleted_at is null) = 1
  ) einzig
 where e.user_id = einzig.user_id
   and e.location_id is null;

/* ═══════════════════════════════════════════════════════════════
   2 — ALTBESTAND BEREINIGEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Ohne eindeutigen Index konnte das "on conflict" in sync_events nie
 * greifen: Jeder Engine-Lauf legte eine NEUE Zeile an, statt die
 * vorhandene zu aktualisieren.
 *
 * Im Bestand stehen dadurch Dutzende identischer Empfehlungen —
 * gleicher Typ, gleiches Subject, gleicher Titel, gleiche data, nur
 * verschiedene created_at. Sie sind kein Standortunterschied, sondern
 * Wiederholungen derselben Aussage.
 *
 * Behandlung: Die AELTESTE offene Zeile je Schluessel bleibt — sie
 * traegt den Zeitpunkt, an dem das Problem erstmals auftrat, und
 * genau das haette ein funktionierendes Upsert erhalten. Die uebrigen
 * werden auf 'resolved' gesetzt.
 *
 * Nichts geht verloren, was die Engine nicht wiederherstellen koennte:
 * Besteht der Zustand fort, legt der naechste Lauf die Empfehlung neu
 * an — dann korrekt als eine einzige Zeile.
 */
do $$
declare v_anzahl integer;
begin
  with rang as (
    select id,
           row_number() over (
             partition by user_id, location_id, type, subject_id
             order by created_at
           ) as nr
    from public.events
    where lifecycle in ('new', 'seen', 'opened')
  )
  update public.events e
     set lifecycle = 'resolved',
         resolved_at = pg_catalog.now()
    from rang
   where e.id = rang.id and rang.nr > 1;

  get diagnostics v_anzahl = row_count;

  if v_anzahl > 0 then
    raise notice 'Dubletten bereinigt: % Zeilen auf resolved gesetzt. Ursache: fehlender eindeutiger Index, dadurch legte jeder Engine-Lauf eine neue Zeile an.', v_anzahl;
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════════
   3 — EINDEUTIGKEIT MIT STANDORT
   ═══════════════════════════════════════════════════════════════ */

/*
 * Bisher identifizierte sich ein Event ueber user + type + subject.
 * Eine standortweite Regel ohne konkretes Subject — etwa
 * "Foto hochladen" — haette bei S&I und WERKRUF dieselbe Zeile
 * getroffen und sich gegenseitig ueberschrieben.
 *
 * Zwei Teilindizes, weil NULL in einem Unique-Index nicht gleich NULL
 * ist: Ohne den zweiten waeren beliebig viele Events ohne subject_id
 * moeglich.
 */
/*
 * Die Indizes gelten nur fuer OFFENE Events.
 *
 * Eine abgeschlossene Empfehlung darf mehrfach in der Historie stehen —
 * dasselbe Problem kann im Maerz und im Juni auftreten. Nur offen darf
 * es jeweils einmal sein.
 *
 * Ohne diese Einschraenkung waere ausserdem die Bereinigung oben
 * wirkungslos: Die aufgeloesten Dubletten stuenden dem Index weiter im
 * Weg.
 */
create unique index if not exists events_identitaet_mit_subject_idx
  on public.events (user_id, location_id, type, subject_id)
  where lifecycle in ('new','seen','opened') and subject_id is not null and location_id is not null;

create unique index if not exists events_identitaet_ohne_subject_idx
  on public.events (user_id, location_id, type)
  where lifecycle in ('new','seen','opened') and subject_id is null and location_id is not null;

/* Konto-/Verbindungsereignisse ohne Standort. */
create unique index if not exists events_identitaet_konto_idx
  on public.events (user_id, type, subject_id)
  where lifecycle in ('new','seen','opened') and location_id is null and subject_id is not null;

create unique index if not exists events_identitaet_konto_ohne_subject_idx
  on public.events (user_id, type)
  where lifecycle in ('new','seen','opened') and location_id is null and subject_id is null;

/* ═══════════════════════════════════════════════════════════════
   4 — AUFLOESUNG IM RICHTIGEN UMFANG
   ═══════════════════════════════════════════════════════════════ */

/*
 * Loest Events auf, die in dieser Auswertung nicht mehr vorkommen —
 * aber NUR im ausgewerteten Umfang.
 *
 * p_location_id gesetzt  → nur Events dieses Standorts
 * p_location_id null     → nur Konto-Events (location_id is null)
 *
 * So bleiben offene Empfehlungen des anderen Betriebs unangetastet.
 */
create or replace function public.resolve_stale_events(
  p_user_id     uuid,
  p_events      jsonb,
  p_location_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_anzahl  integer := 0;
begin
  for v_id in
    select e.id from public.events e
     where e.user_id = p_user_id
       and e.location_id is not distinct from p_location_id
       and e.lifecycle in ('new', 'seen', 'opened')
       and not exists (
         select 1 from pg_catalog.jsonb_array_elements(p_events) x
          where x ->> 'type' = e.type
            and (x ->> 'subjectId')::uuid is not distinct from e.subject_id
       )
  loop
    perform public.record_recommendation_action(v_id, 'resolved', 'engine', null);
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end;
$$;

comment on function public.resolve_stale_events is
  'Loest veraltete Events NUR im ausgewerteten Umfang auf. Ohne diese Begrenzung markierte eine S&I-Auswertung offene WERKRUF-Empfehlungen als geloest.';

/* ═══════════════════════════════════════════════════════════════
   5 — IMPACT-METRIKEN JE STANDORT
   ═══════════════════════════════════════════════════════════════ */

/*
 * Misst die Wirkung einer Empfehlung anhand der Daten DIESES
 * Standorts.
 *
 * read_impact_metric(user_id, metric) bleibt fuer Konto-Ereignisse
 * erhalten. Standortbezogene Events verwenden ausschliesslich diese
 * Fassung — sonst maesse man die Wirkung einer S&I-Empfehlung an
 * WERKRUF-Daten mit.
 */
create or replace function public.read_location_impact_metric(
  p_user_id     uuid,
  p_location_id uuid,
  p_metric      text
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wert    numeric;
  v_total   integer;
  v_offen   integer;
  v_media   jsonb;
  v_loc     record;
begin
  if p_location_id is null then return null; end if;

  /* Eigentum pruefen — security definer umgeht RLS. */
  select primary_phone, website_uri, locality, primary_category, google_media
    into v_loc
    from public.google_locations
   where id = p_location_id and user_id = p_user_id and deleted_at is null;

  if not found then return null; end if;

  case p_metric
    when 'reviews.responseRate' then
      select count(*), count(*) filter (where not is_answered)
        into v_total, v_offen
        from public.google_reviews
       where user_id = p_user_id and location_id = p_location_id and status = 'active';
      v_wert := case when v_total > 0
                     then round(((v_total - v_offen)::numeric / v_total), 4)
                     else null end;

    when 'reviews.unansweredCount' then
      select count(*) into v_wert from public.google_reviews
       where user_id = p_user_id and location_id = p_location_id
         and status = 'active' and not is_answered;

    when 'reviews.totalCount' then
      select count(*) into v_wert from public.google_reviews
       where user_id = p_user_id and location_id = p_location_id and status = 'active';

    when 'reviews.averageRating' then
      select round(avg(star_rating)::numeric, 2) into v_wert
        from public.google_reviews
       where user_id = p_user_id and location_id = p_location_id and status = 'active';

    when 'profile.photoCount' then
      /* Google-Medienstand dieses Standorts — nicht die nutzerweite
         Upload-Historie. Siehe D1.1. */
      v_wert := public.werkruf_media_count(v_loc.google_media);

    when 'profile.completeness' then
      v_wert := (
        (case when v_loc.primary_phone    is not null then 1 else 0 end) +
        (case when v_loc.website_uri      is not null then 1 else 0 end) +
        (case when v_loc.locality         is not null then 1 else 0 end) +
        (case when v_loc.primary_category is not null then 1 else 0 end)
      )::numeric / 4;

    when 'health.score' then
      v_wert := (public.compute_location_health_score(p_user_id, p_location_id) ->> 'score')::numeric;

    else
      v_wert := null;
  end case;

  return v_wert;
end;
$$;

comment on function public.read_location_impact_metric is
  'Impact-Metrik fuer GENAU EINEN Standort. Ohne sie maesse man die Wirkung einer S&I-Empfehlung an WERKRUF-Daten mit.';

/* ═══════════════════════════════════════════════════════════════
   6 — SNAPSHOTS MIT STANDORT UND SCORE-FASSUNG
   ═══════════════════════════════════════════════════════════════ */

do $$
begin
  if to_regclass('public.weekly_snapshots') is not null then
    execute 'alter table public.weekly_snapshots
               add column if not exists location_id uuid references public.google_locations(id) on delete set null,
               add column if not exists score_version smallint';

    execute $sql$
      comment on column public.weekly_snapshots.location_id is
        'Betrieb, zu dem dieser Snapshot gehoert. NULL bei Altbestand ohne beweisbare Zuordnung — ein solcher Snapshot darf NICHT als Vorwochenwert dienen.'
    $sql$;

    execute $sql$
      comment on column public.weekly_snapshots.score_version is
        'Fassung der Score-Formel. Aendert sie sich, sind alte und neue Werte nicht unmittelbar vergleichbar.'
    $sql$;

    /* Backfill nur bei genau einem aktiven Standort. */
    execute $sql$
      update public.weekly_snapshots s
         set location_id = einzig.id
        from (
          select l.user_id, l.id
          from public.google_locations l
          where l.deleted_at is null
            and (select count(*) from public.google_locations x
                  where x.user_id = l.user_id and x.deleted_at is null) = 1
        ) einzig
       where s.user_id = einzig.user_id and s.location_id is null
    $sql$;
  end if;
end $$;

/*
 * Der Vorwochenwert — aber nur, wenn er vergleichbar ist.
 *
 * Gibt NULL zurueck, wenn der Snapshot keinem Standort zugeordnet ist
 * oder aus einer anderen Score-Fassung stammt. Dann feuert die Regel
 * health.declined noch nicht. Ein fehlender Trend ist besser als ein
 * falscher.
 */
create or replace function public.previous_location_health(
  p_user_id       uuid,
  p_location_id   uuid,
  p_score_version smallint default 1
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_wert numeric;
begin
  if p_location_id is null then return null; end if;
  if to_regclass('public.weekly_snapshots') is null then return null; end if;

  execute $sql$
    select (payload -> 'health' ->> 'score')::numeric
      from public.weekly_snapshots
     where user_id = $1
       and location_id = $2
       and score_version is not distinct from $3
     order by created_at desc
     limit 1
  $sql$
  into v_wert
  using p_user_id, p_location_id, p_score_version;

  return v_wert;
exception when others then
  /* Fehlt die payload-Struktur, ist kein Vergleich moeglich. Kein
     Trend ist besser als ein falscher. */
  return null;
end;
$$;

comment on function public.previous_location_health is
  'Vorwochenwert desselben Standorts und derselben Score-Fassung. NULL, wenn nicht vergleichbar — dann feuert health.declined nicht.';

/* ═══════════════════════════════════════════════════════════════
   7 — TRACKING UEBERNIMMT DEN STANDORT
   ═══════════════════════════════════════════════════════════════ */

do $$
begin
  if to_regclass('public.recommendation_events') is not null then
    execute 'alter table public.recommendation_events
               add column if not exists location_id uuid';
  end if;
end $$;

/*
 * Setzt location_id aus dem Event, nicht aus dem Subject-Typ.
 *
 * Bisher wurde sie teilweise nur gesetzt, wenn subject_type = location
 * war. Eine konkrete Review ist aber subject_type = review und gehoert
 * trotzdem zu einem Betrieb.
 */
create or replace function public.recommendation_events_set_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_id is null and new.event_id is not null then
    select e.location_id into new.location_id
      from public.events e where e.id = new.event_id;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.recommendation_events') is not null then
    execute 'drop trigger if exists recommendation_events_location on public.recommendation_events';
    execute 'create trigger recommendation_events_location
               before insert on public.recommendation_events
               for each row execute function public.recommendation_events_set_location()';
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════════
   8 — RECHTE
   ═══════════════════════════════════════════════════════════════ */

revoke all on function public.resolve_stale_events(uuid, jsonb, uuid) from public, anon;
revoke all on function public.read_location_impact_metric(uuid, uuid, text) from public, anon;
revoke all on function public.previous_location_health(uuid, uuid, smallint) from public, anon;

grant execute on function public.resolve_stale_events(uuid, jsonb, uuid) to service_role;
grant execute on function public.read_location_impact_metric(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.previous_location_health(uuid, uuid, smallint) to authenticated, service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Wie viele Events haben noch keinen Standort?
--   select location_id is null as ohne_standort, count(*)
--   from public.events group by 1;
--
-- Events je Betrieb:
--   select l.title, count(e.*) filter (where e.lifecycle in ('new','seen','opened')) as offen
--   from public.google_locations l
--   left join public.events e on e.location_id = l.id
--   where l.deleted_at is null group by l.title;
--
-- Impact-Metrik je Standort — die Werte muessen sich unterscheiden:
--   select l.title,
--          public.read_location_impact_metric(l.user_id, l.id, 'reviews.responseRate') as antwortquote,
--          public.read_location_impact_metric(l.user_id, l.id, 'profile.photoCount')   as fotos
--   from public.google_locations l where l.deleted_at is null;
--
-- Snapshots ohne beweisbare Zuordnung:
--   select count(*) from public.weekly_snapshots where location_id is null;
