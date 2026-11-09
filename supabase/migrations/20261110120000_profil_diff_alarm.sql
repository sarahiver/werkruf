-- WP8 — Profil-Diff-Alarm (der Waechter)
--
-- Google fuehrt fuer jeden Standort eine Inhaber-Sicht (locations.get)
-- und eine oeffentliche Sicht (:getGoogleUpdated). Weichen sie
-- voneinander ab, soll WERKRUF es erkennen, ehrlich benennen und einen
-- sicheren Weg zur Korrektur geben.
--
--   1. google_profile_diffs — ein Datensatz je (Standort, Feld, Zustand),
--      mit first/last_seen und resolved_at. Idempotent: derselbe Diff
--      erzeugt keine zweite Zeile, ein geaenderter Consumer-Wert schon.
--   2. upsert_profile_diffs(): schreibt das Ergebnis eines Syncs und
--      schliesst, was nicht mehr da ist.
--   3. build_location_evaluation_context(): + profileDiffs → Engine.
--   4. plan_communications(): Kanal 1b fuer kritische externe
--      Aenderungen; schedule_communications(): Vorlage aus der
--      Entscheidung (profile_change_alert).
--   5. weekly_happened(): + profileChanges fuer "Was passiert ist".
--
-- Kein Auto-Revert. Kein Cron. Kein zweiter Sync-Pfad.

/* ═══════════════════════════════════════════════════════════════
   1 — Tabelle
   ═══════════════════════════════════════════════════════════════ */
create table if not exists public.google_profile_diffs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  location_id      uuid not null references public.google_locations(id) on delete cascade,
  source           text not null default 'getGoogleUpdated_v1',
  field_path       text not null,
  prio             text not null check (prio in ('kritisch', 'mittel', 'info')),
  label            text not null,
  change_type      text not null check (change_type in ('changed', 'closed_by_google', 'pending', 'rejected')),
  origin           text not null check (origin in ('unknown', 'pending', 'updated_by_google', 'rejected')),
  lifecycle_stage  text,
  merchant_value   jsonb,
  consumer_value   jsonb,
  fingerprint      text not null,
  google_edit_at   timestamptz,
  rejection_reason text,
  detected_at      timestamptz not null default now(),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      text check (resolved_by in ('sync', 'accepted', 'restored', 'location_deleted')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.google_profile_diffs is
  'WP8: Differenzen zwischen Inhaber-Sicht und oeffentlicher Google-Sicht je Standort und Feld. Offen = resolved_at null. Ein Datensatz je Zustand (fingerprint); derselbe Zustand aktualisiert nur last_seen_at.';

/* Je Standort und Feld hoechstens ein OFFENER Diff. */
create unique index if not exists google_profile_diffs_offen_idx
  on public.google_profile_diffs (location_id, field_path) where resolved_at is null;
create index if not exists google_profile_diffs_user_idx
  on public.google_profile_diffs (user_id, resolved_at);

alter table public.google_profile_diffs enable row level security;
revoke all on table public.google_profile_diffs from public, anon, authenticated;
grant select, insert, update, delete on table public.google_profile_diffs to service_role;

/* Der Inhaber darf seine eigenen Diffs lesen (Dashboard). Nur lesen. */
drop policy if exists google_profile_diffs_own_select on public.google_profile_diffs;
create policy google_profile_diffs_own_select on public.google_profile_diffs
  for select to authenticated using (user_id = auth.uid());
grant select on table public.google_profile_diffs to authenticated;

create or replace function public.google_profile_diffs_touch()
returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists google_profile_diffs_touch on public.google_profile_diffs;
create trigger google_profile_diffs_touch before update on public.google_profile_diffs
  for each row execute function public.google_profile_diffs_touch();

/* ═══════════════════════════════════════════════════════════════
   2 — upsert_profile_diffs(): das Ergebnis EINES Syncs einspielen
   ═══════════════════════════════════════════════════════════════
   p_diffs: Array aus berechneDiffs() (src/utils/profilDiff.js) plus
   'fingerprint' je Eintrag.

   Regeln (WP8 §7):
     gleicher Fingerabdruck offen       → last_seen_at, Werte auffrischen; kein neuer Datensatz
     anderer Fingerabdruck offen        → alten schliessen (sync), neuen anlegen
     offener Diff nicht mehr geliefert  → schliessen (sync)
   Rueckgabe: { new: n, same: n, changed: n, resolved: n, openIds: [...] }
*/
create or replace function public.upsert_profile_diffs(
  p_user_id uuid, p_location_id uuid, p_diffs jsonb, p_source text default 'getGoogleUpdated_v1')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d        jsonb;
  v_offen  public.google_profile_diffs;
  v_new    integer := 0;
  v_same   integer := 0;
  v_chg    integer := 0;
  v_res    integer := 0;
  v_pfade  text[] := '{}';
  v_ids    uuid[] := '{}';
  v_id     uuid;
begin
  /* Eigentum: der Standort muss dem Nutzer gehoeren. */
  perform 1 from public.google_locations l where l.id = p_location_id and l.user_id = p_user_id and l.deleted_at is null;
  if not found then
    raise exception 'Standort gehoert nicht zum Nutzer' using errcode = '42501';
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_diffs, '[]'::jsonb))
  loop
    continue when (d ->> 'fieldPath') is null or (d ->> 'fingerprint') is null;
    v_pfade := v_pfade || (d ->> 'fieldPath');

    select * into v_offen from public.google_profile_diffs
     where location_id = p_location_id and field_path = d ->> 'fieldPath' and resolved_at is null;

    if found and v_offen.fingerprint = d ->> 'fingerprint' then
      update public.google_profile_diffs
         set last_seen_at = clock_timestamp(),
             merchant_value = d -> 'merchantValue',
             lifecycle_stage = coalesce(d ->> 'lifecycleStage', lifecycle_stage),
             google_edit_at = coalesce((d ->> 'googleEditAt')::timestamptz, google_edit_at),
             rejection_reason = coalesce(d ->> 'rejectionReason', rejection_reason),
             origin = coalesce(d ->> 'origin', origin)
       where id = v_offen.id;
      v_same := v_same + 1;
      v_ids := v_ids || v_offen.id;
      continue;
    end if;

    if found then
      update public.google_profile_diffs
         set resolved_at = now(), resolved_by = 'sync'
       where id = v_offen.id;
      v_chg := v_chg + 1;
    end if;

    insert into public.google_profile_diffs
      (user_id, location_id, source, field_path, prio, label, change_type, origin, lifecycle_stage,
       merchant_value, consumer_value, fingerprint, google_edit_at, rejection_reason)
    values
      (p_user_id, p_location_id, p_source, d ->> 'fieldPath',
       coalesce(d ->> 'prio', 'info'), coalesce(d ->> 'label', d ->> 'fieldPath'),
       coalesce(d ->> 'changeType', 'changed'), coalesce(d ->> 'origin', 'unknown'), d ->> 'lifecycleStage',
       d -> 'merchantValue', d -> 'consumerValue', d ->> 'fingerprint',
       (d ->> 'googleEditAt')::timestamptz, d ->> 'rejectionReason')
    returning id into v_id;
    v_ids := v_ids || v_id;
    if not found then null; end if;
    v_new := v_new + 1;
  end loop;

  /* Alles Offene, das dieser Sync nicht mehr meldet, ist aufgeloest. */
  with geschlossen as (
    update public.google_profile_diffs
       set resolved_at = now(), resolved_by = 'sync'
     where location_id = p_location_id and user_id = p_user_id
       and resolved_at is null
       and not (field_path = any (v_pfade))
    returning 1)
  select count(*) into v_res from geschlossen;

  return jsonb_build_object('new', v_new, 'same', v_same, 'changed', v_chg, 'resolved', v_res,
                            'openIds', to_jsonb(v_ids));
end;
$$;

revoke all on function public.upsert_profile_diffs(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.upsert_profile_diffs(uuid, uuid, jsonb, text) to service_role;

/* Diff als aufgeloest markieren — nach Uebernehmen/Wiederherstellen.
   Der naechste Sync bestaetigt oder legt neu an. */
create or replace function public.resolve_profile_diff(p_diff_id uuid, p_user_id uuid, p_by text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_by not in ('accepted', 'restored') then
    raise exception 'ungueltiger Grund' using errcode = '22023';
  end if;
  update public.google_profile_diffs
     set resolved_at = now(), resolved_by = p_by
   where id = p_diff_id and user_id = p_user_id and resolved_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.resolve_profile_diff(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_profile_diff(uuid, uuid, text) to service_role;

/* Fuer die Mailvorlage: die Diffs zu einer Liste von IDs. */
create or replace function public.profile_diffs_for_mail(p_ids jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'fieldPath', d.field_path, 'label', d.label, 'prio', d.prio,
           'changeType', d.change_type, 'origin', d.origin,
           'merchantValue', d.merchant_value, 'consumerValue', d.consumer_value,
           'firstSeenAt', d.first_seen_at, 'rejectionReason', d.rejection_reason)
           order by d.prio, d.first_seen_at), '[]'::jsonb)
    from public.google_profile_diffs d
   where d.id in (select value::text::uuid from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)))
     and d.resolved_at is null;
$$;
revoke all on function public.profile_diffs_for_mail(jsonb) from public, anon, authenticated;
grant execute on function public.profile_diffs_for_mail(jsonb) to service_role;

/* ═══════════════════════════════════════════════════════════════
   3 — Vorlage
   ═══════════════════════════════════════════════════════════════ */
alter table public.email_queue drop constraint if exists email_queue_template_check;
alter table public.email_queue add constraint email_queue_template_check check (template = any (array[
  'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
  'weekly_report', 'weekly_summary', 'visibility_report',
  'critical_review_alert', 'inactivity_reminder', 'payment_failed',
  'support_reply', 'consent_reminder', 'account_deleted',
  'critical_review_free', 'profile_change_alert'
]));

/* ═══════════════════════════════════════════════════════════════
   4 — Engine-Kontext
   ═══════════════════════════════════════════════════════════════ */
CREATE OR REPLACE FUNCTION public.build_location_evaluation_context(p_user_id uuid, p_location_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ctx         jsonb;
  v_loc         record;
  v_mehrere     boolean;
begin
  perform public.assert_eigener_zugriff(p_user_id);
  /* Wie viele aktive Betriebe gibt es ueberhaupt? Davon haengt ab, ob
     "Betrieb auswaehlen" eine sinnvolle Empfehlung waere. */
  select count(*) > 1 into v_mehrere
    from public.google_locations
   where user_id = p_user_id and deleted_at is null;

  /* ── Kein eindeutiger Standort ──
     Keine 0-Werte als Ersatz. Die Engine soll erkennen, dass sie
     nichts Standortbezogenes beurteilen kann. */
  if p_location_id is null then
    return pg_catalog.jsonb_build_object(
      'userId',            p_user_id,
      'now',               pg_catalog.now(),
      'locationResolved',  false,
      'multipleLocations', coalesce(v_mehrere, false),
      'connection', (
        select pg_catalog.jsonb_build_object(
          'status',        a.status,
          'providerEmail', a.provider_email,
          'lastErrorAt',   a.last_error_at,
          'lastErrorCode', a.last_error_code,
          'connectedAt',   a.connected_at)
        from public.google_accounts a
        where a.user_id = p_user_id and a.deleted_at is null
        order by case a.status when 'active' then 0 else 1 end, a.connected_at
        limit 1
      )
    );
  end if;

  /* Eigentum pruefen — security definer umgeht RLS. */
  select l.*, l.account_id as acc into v_loc
    from public.google_locations l
   where l.id = p_location_id and l.user_id = p_user_id and l.deleted_at is null;

  if not found then
    return pg_catalog.jsonb_build_object(
      'userId', p_user_id, 'now', pg_catalog.now(),
      'locationResolved', false, 'reason', 'standort_nicht_gefunden');
  end if;

  select pg_catalog.jsonb_build_object(
    'userId',            p_user_id,
    'now',               pg_catalog.now(),
    'locationResolved',  true,
    'multipleLocations', coalesce(v_mehrere, false),

    /* Der eine Betrieb, um den es geht. */
    'location', pg_catalog.jsonb_build_object(
      'id',            v_loc.id,
      'title',         v_loc.title,
      'locality',      v_loc.locality,
      'phone',         v_loc.primary_phone,
      'website',       v_loc.website_uri,
      'category',      v_loc.primary_category,
      'lastSyncedAt',  v_loc.last_synced_at,
      'reviewCount',   v_loc.review_count,
      'averageRating', v_loc.average_rating
    ),

    /* Kontozustand des Google-Kontos, zu dem DIESER Standort gehoert —
       nicht irgendeines Kontos des Nutzers. */
    'connection', (
      select pg_catalog.jsonb_build_object(
        'status',        a.status,
        'providerEmail', a.provider_email,
        'lastErrorAt',   a.last_error_at,
        'lastErrorCode', a.last_error_code,
        'connectedAt',   a.connected_at)
      from public.google_accounts a
      where a.id = v_loc.account_id and a.user_id = p_user_id and a.deleted_at is null
    ),

    /* ── Bewertungen: nur dieses Standorts ── */
    'reviews', (
      select pg_catalog.jsonb_build_object(
        'total',         count(*),
        'unanswered',    count(*) filter (where not is_answered),
        'averageRating', round(avg(star_rating)::numeric, 1),
        'newestAt',      max(google_created_at),
        'last7d',        count(*) filter (where google_created_at > pg_catalog.now() - interval '7 days'),
        'last30d',       count(*) filter (where google_created_at > pg_catalog.now() - interval '30 days'))
      from public.google_reviews
      where user_id = p_user_id and location_id = p_location_id and status = 'active'
    ),

    'lowRatedOpen', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',         r.id,
        'rating',     r.star_rating,
        'createdAt',  r.google_created_at,
        'reviewer',   r.reviewer_display_name,
        'locationId', r.location_id
      ) order by r.google_created_at desc)
      from (
        select * from public.google_reviews
        where user_id = p_user_id and location_id = p_location_id
          and status = 'active' and not is_answered and star_rating <= 2
        order by google_created_at desc
        limit 10
      ) r
    ), '[]'::jsonb),

    /* ── Antworten: nur zu Bewertungen dieses Standorts ──
       review_replies haengt am Nutzer; der Standortbezug entsteht
       ueber die Bewertung. */
    'replies', (
      select pg_catalog.jsonb_build_object(
        'draft',     count(*) filter (where rr.status = 'draft'),
        'approved',  count(*) filter (where rr.status in ('approved', 'publishing')),
        'published', count(*) filter (where rr.status = 'published'),
        'failed',    count(*) filter (where rr.status = 'failed'))
      from public.review_replies rr
      join public.google_reviews gr on gr.id = rr.review_id
      where rr.user_id = p_user_id and rr.deleted_at is null
        and gr.location_id = p_location_id
    ),

    /* Fotos aus dem Google-Medienstand dieses Standorts — siehe D1.1. */
    'photoCount', public.werkruf_media_count(v_loc.google_media),

    'health', public.compute_location_health_score(p_user_id, p_location_id),

    /* Vorwochenwert nur, wenn er vergleichbar ist: gleicher Standort,
       gleiche Score-Fassung. Sonst null — dann feuert health.declined
       nicht. Ein fehlender Trend ist besser als ein falscher. */
    'previousHealth', public.previous_location_health(p_user_id, p_location_id, 1::smallint),

    /*
     * Reguläre Oeffnungszeiten.
     *
     * Sie liegen bereits in google_profile — der Sync fragt
     * regularHours in der Feldmaske ab und mapGoogleLocationFields
     * legt sie dort ab. Verloren gingen sie nur hier: Der Kontext
     * hat sie nie gelesen.
     *
     * present und reliable sind zwei verschiedene Aussagen:
     *
     *   present   Es sind Zeiten hinterlegt.
     *   reliable  Wir wissen das sicher.
     *
     * Ohne die zweite entstuende dieselbe Falle wie bei den
     * Bewertungen in F1a: Ein Standort, der nie synchronisiert wurde,
     * saehe aus wie einer ohne Oeffnungszeiten — und bekaeme eine
     * Empfehlung, die vielleicht gar nicht stimmt.
     *
     * Verlaesslich heisst:
     *
     *   1. Der Standort wurde schon einmal synchronisiert.
     *   2. google_profile traegt den Schluessel regularHours.
     *      Der Mapper schreibt ihn IMMER, auch als null. Fehlt er,
     *      stammt die Zeile aus der Zeit vor diesem Mapper.
     *   3. Der letzte Abgleich ist nicht gescheitert.
     *
     * present heisst: Es gibt Perioden. Wie viele, welche Tage, ob
     * plausibel — das prueft F1c nicht. Montag bis Freitag gepflegt
     * ist vorhanden; durchgehend geoeffnet auch.
     */
    'openingHours', (
      select pg_catalog.jsonb_build_object(
        'reliable', coalesce(
          v_loc.last_synced_at is not null
          and (v_loc.google_profile ? 'regularHours')
          and not exists (
            select 1 from public.sync_jobs
            where user_id = p_user_id
              and location_id = p_location_id
              and status = 'failed'
              and finished_at > pg_catalog.now() - interval '24 hours'
          ), false),
        /* Perioden vorhanden. Ein leeres Array ist nicht vorhanden —
           Google liefert dann schlicht nichts. */
        /*
         * coalesce ist hier nicht kosmetisch.
         *
         * Steht regularHours auf JSON-null, liefert der Pfadzugriff
         * SQL-NULL, jsonb_typeof davon ebenfalls NULL, und der
         * Vergleich wird NULL statt false. Die Regel prueft spaeter
         * `!present` — und NULL ist weder wahr noch falsch, sodass
         * die Bedingung nie greift.
         *
         * Genau dieser Fall ist der haeufigste: Google liefert keine
         * Zeiten, der Mapper schreibt null.
         */
        'present', coalesce(
          pg_catalog.jsonb_typeof(
            v_loc.google_profile -> 'regularHours' -> 'periods') = 'array'
          and pg_catalog.jsonb_array_length(
            v_loc.google_profile -> 'regularHours' -> 'periods') > 0,
          false)
      )
    ),

    /* WP8 — offene Profil-Differenzen (Waechter). Nur was der Sync
       zuletzt festgestellt hat; die Engine macht daraus Events. */
    'profileDiffs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id',            d.id,
               'fieldPath',     d.field_path,
               'prio',          d.prio,
               'label',         d.label,
               'changeType',    d.change_type,
               'origin',        d.origin,
               'merchantValue', d.merchant_value,
               'consumerValue', d.consumer_value,
               'firstSeenAt',   d.first_seen_at,
               'lastSeenAt',    d.last_seen_at,
               'rejectionReason', d.rejection_reason)
             order by d.first_seen_at)
        from public.google_profile_diffs d
       where d.location_id = p_location_id
         and d.user_id = p_user_id
         and d.resolved_at is null), '[]'::jsonb),

    /* Sync-Zustand dieses Standorts. */
    'syncFailed', exists (
      select 1 from public.sync_jobs
      where user_id = p_user_id
        and location_id = p_location_id
        and status = 'failed'
        and finished_at > pg_catalog.now() - interval '24 hours'
    )
  ) into v_ctx;

  return v_ctx;
exception when others then
  if sqlstate = '42501' then raise; end if;
  /* Fehlt eine Spalte oder Tabelle, soll der Engine-Lauf nicht
     vollstaendig ausfallen. */
  return pg_catalog.jsonb_build_object(
    'userId', p_user_id, 'now', pg_catalog.now(),
    'locationResolved', false, 'reason', 'fehler', 'error', sqlerrm);
end;
$function$;

/* ═══════════════════════════════════════════════════════════════
   5 — plan_communications: Kanal 1b
   ═══════════════════════════════════════════════════════════════ */
CREATE OR REPLACE FUNCTION public.plan_communications(p_user_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_decisions jsonb := '[]'::jsonb;

  v_prefs      public.notification_preferences;
  v_open       integer;
  v_relevant   integer;
  v_last_visit timestamptz;
  v_days_away  numeric;
  v_last_sent  timestamptz;
  v_alert_count integer;
  v_alert_ids  uuid[];
  /* Eine Zeile je betroffenem Standort. */
  v_gruppe     record;
  v_is_monday  boolean := extract(isodow from p_now) = 1;

  /* Der Betrieb, um den die Wochenmail geht. Dieselbe Regel wie beim
     WERKRUF Score, im Dashboard und in top_recommendations_for_email. */
  v_location   uuid;
  v_open_loc   integer;

begin
  select * into v_prefs
    from public.notification_preferences where user_id = p_user_id;

  /* Offene Empfehlungen. 'relevant' meint: mindestens mittlere
     Priorität — der Schwellwert steht in engine_thresholds, damit er
     ohne Deployment änderbar bleibt. */
  select count(*),
         count(*) filter (where priority >= 45)
    into v_open, v_relevant
    from public.events
   where user_id = p_user_id
     and lifecycle in ('new', 'seen', 'opened')
     and coalesce(rule_status, 'active') <> 'candidate';

  /*
   * Dieselbe Zaehlung, aber nur fuer den Betrieb der Wochenmail.
   *
   * v_open oben zaehlt nutzerweit — das ist fuer die
   * Abwesenheits-Erinnerung richtig ("es hat sich etwas
   * angesammelt", ueber alle Betriebe). Fuer die Wochenmail ist es
   * falsch: Sie sagte "2 offene Empfehlungen" und zeigte eine, weil
   * die zweite zu einem anderen Betrieb gehoerte.
   *
   * Gezaehlt wird, was auch in der Mail erscheinen koennte: derselbe
   * Standort, Konto-Ereignisse mit, Kanal E-Mail, kein Probebetrieb,
   * nicht pausiert, nicht abgelaufen.
   */
  v_location := public.werkruf_score_location(p_user_id);

  select count(*)
    into v_open_loc
    from public.events e
   where e.user_id = p_user_id
     and (e.location_id = v_location or e.location_id is null)
     and e.lifecycle in ('new', 'seen', 'opened')
     and e.in_weekly_email
     and public.rule_freigegeben(e.rule_status)
     and (e.cooldown_until is null or e.cooldown_until <= p_now)
     and (e.expires_at is null or e.expires_at > p_now);

  -- ─────────────────────────────────────────────
  -- KANAL 1 — SOFORTMELDUNG
  --
  -- Die Voreinstellung ist: nicht senden. Nur wenn das Warten bis
  -- Montag schadet.
  --
  -- Gebündelt: Kommen drei schlechte Bewertungen an einem Tag, ist
  -- das EINE Meldung. Drei Mails wären der schnellste Weg in den
  -- Spamfilter.
  -- ─────────────────────────────────────────────

  /*
   * JE STANDORT, nicht je Nutzer.
   *
   * Vorher wurden alle kritischen Bewertungen eines Nutzers in eine
   * Meldung gebuendelt. Bei zwei Betrieben bekam der Kunde eine Mail
   * mit dem Registrierungsnamen und Bewertungen aus beiden — und
   * konnte nicht erkennen, welcher Betrieb betroffen war.
   *
   * Eine negative Bewertung gehoert immer zu einem konkreten Betrieb.
   * Deshalb eine Gruppe je Standort, und daraus je eine Meldung.
   *
   * location_id is null wird ausdruecklich NICHT mitgenommen: Eine
   * Bewertung ohne Standort laesst sich keinem Betrieb zuordnen, und
   * sie dem ausgewaehlten zuzuschlagen waere geraten. Solche Events
   * bleiben liegen und sind ueber die Datenbank auffindbar.
   */
  for v_gruppe in
    select e.location_id,
           count(*)       as anzahl,
           array_agg(e.id) as ids
      from public.events e
     where e.user_id = p_user_id
       and e.type in ('review.negative_unanswered', 'reviews.negative_batch')
       and e.lifecycle in ('new', 'seen')
       and public.rule_freigegeben(e.rule_status)
       -- Noch nicht gemeldet. Der Vermerk verhindert, dass dieselbe
       -- Bewertung bei jedem Worker-Lauf erneut alarmiert.
       and not (e.delivered ? 'notification')
       -- Nur Bewertungen mit Standort.
       and e.location_id is not null
     group by e.location_id
  loop
    if not public.wants_notification(p_user_id, 'negative_review') then
      v_decisions := v_decisions || jsonb_build_object(
        'channel', 'immediate_alert', 'send', false,
        'locationId', v_gruppe.location_id,
        'reason', 'Vom Nutzer abgeschaltet');
    else
      v_decisions := v_decisions || jsonb_build_object(
        'channel', 'immediate_alert', 'send', true,
        'template', 'critical_review_alert',
        /* Der Standort gehoert zur Entscheidung. Ohne ihn muesste
           schedule_communications ihn erraten. */
        'locationId', v_gruppe.location_id,
        'reason', format('%s kritische %s ohne Antwort',
                         v_gruppe.anzahl,
                         case when v_gruppe.anzahl = 1 then 'Bewertung' else 'Bewertungen' end),
        'eventIds', to_jsonb(v_gruppe.ids),
        'count', v_gruppe.anzahl);
    end if;
  end loop;

  /* Keine betroffene Gruppe: eine Begruendung fuer die
     Nachvollziehbarkeit. */
  select count(*) into v_alert_count
    from public.events e
   where e.user_id = p_user_id
     and e.type in ('review.negative_unanswered', 'reviews.negative_batch')
     and e.lifecycle in ('new', 'seen')
     and public.rule_freigegeben(e.rule_status)
     and not (e.delivered ? 'notification')
     and e.location_id is not null;

  if coalesce(v_alert_count, 0) = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'immediate_alert', 'send', false,
      'reason', 'Keine ungemeldete kritische Bewertung');
  end if;

  -- ─────────────────────────────────────────────
  -- KANAL 1b — KRITISCHE PROFILAENDERUNG (WP8)
  --
  -- Google zeigt oeffentlich etwas anderes als hinterlegt — bei
  -- Telefon, Website, Adresse, Hauptkategorie oder dem
  -- Geschlossen-Status. Dieselbe Mechanik wie bei Bewertungen:
  -- Engine-Event, Vermerk delivered.notification, eine Meldung je
  -- Standort. Pending und Rejected sind KEIN Sofortalarm — die
  -- eigene Aenderung ist unterwegs bzw. abgelehnt, das steht im
  -- Dashboard und in der Wochenmail.
  -- ─────────────────────────────────────────────
  for v_gruppe in
    select e.location_id,
           count(*)        as anzahl,
           array_agg(e.id) as ids,
           array_agg(e.subject_id) as diff_ids
      from public.events e
     where e.user_id = p_user_id
       and e.type in ('profile.external_change', 'profile.closed_by_google')
       and e.lifecycle in ('new', 'seen')
       and public.rule_freigegeben(e.rule_status)
       and e.priority >= 80
       and not (e.delivered ? 'notification')
       and e.location_id is not null
     group by e.location_id
  loop
    if not public.wants_notification(p_user_id, 'negative_review') then
      v_decisions := v_decisions || jsonb_build_object(
        'channel', 'immediate_alert', 'send', false, 'template', 'profile_change_alert',
        'locationId', v_gruppe.location_id, 'reason', 'Vom Nutzer abgeschaltet');
    else
      v_decisions := v_decisions || jsonb_build_object(
        'channel', 'immediate_alert', 'send', true,
        'template', 'profile_change_alert',
        'locationId', v_gruppe.location_id,
        'reason', format('%s kritische Profilaenderung(en)', v_gruppe.anzahl),
        'eventIds', to_jsonb(v_gruppe.ids),
        'diffIds',  to_jsonb(v_gruppe.diff_ids),
        'count', v_gruppe.anzahl);
    end if;
  end loop;

  -- ─────────────────────────────────────────────
  -- KANAL 2 — WOCHENMAIL
  --
  -- Der einzige Kanal, der auch dann sendet, wenn nichts war. Er
  -- trägt die Gewohnheit: Wer die Mail montags erwartet, öffnet sie
  -- auch in der Woche, in der etwas drinsteht.
  --
  -- "Alles in Ordnung" wird nicht verschickt — die Mail sagt es
  -- nebenbei, sie ist nicht dafür da.
  -- ─────────────────────────────────────────────

  v_last_sent := public.last_email_sent(p_user_id, 'weekly_summary');

  if not v_is_monday then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Nur montags');

  elsif not public.wants_notification(p_user_id, 'weekly_summary') then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Vom Nutzer abgeschaltet');

  elsif v_last_sent is not null and v_last_sent > p_now - interval '6 days' then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Diese Woche bereits verschickt',
      'lastSentAt', v_last_sent);

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', true,
      'template', 'weekly_summary',
      'reason', 'Wöchentlicher Rhythmus',
      /* Standortbezogen — passend zu den Aufgaben, die die Mail
         tatsaechlich zeigt. */
      'openRecommendations', coalesce(v_open_loc, 0),
      'locationId', v_location);
  end if;

  -- ─────────────────────────────────────────────
  -- KANAL 3 — ABWESENHEITS-ERINNERUNG
  --
  -- Nicht "du warst lange nicht da", sondern "es hat sich etwas
  -- angesammelt". Der Unterschied liegt nicht im Ton, sondern in der
  -- Bedingung: Ohne offene Aufgaben wird nichts verschickt, egal wie
  -- lange jemand weg war.
  --
  -- Drei Bedingungen, alle nötig:
  --   1. lange nicht im Dashboard
  --   2. es gibt offene Empfehlungen
  --   3. mindestens eine davon zählt wirklich
  --
  -- Die dritte verhindert den peinlichsten Fall: jemandem nach zehn
  -- Tagen wegen zweier fehlender Fotos zu schreiben.
  -- ─────────────────────────────────────────────

  v_last_visit := v_prefs.last_dashboard_visit_at;
  v_last_sent  := public.last_email_sent(p_user_id, 'inactivity_reminder');
  v_days_away  := case when v_last_visit is null then null
                       else extract(epoch from (p_now - v_last_visit)) / 86400 end;

  if v_last_visit is null then
    /* Noch nie im Dashboard gewesen. Das ist ein Onboarding-Fall,
       kein Abwesenheitsfall — die Willkommensmail deckt ihn ab. */
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Noch kein Dashboard-Besuch — Onboarding, nicht Abwesenheit');

  elsif v_days_away < coalesce(v_prefs.inactivity_days, 10) then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', format('Zuletzt vor %s Tagen im Dashboard', round(v_days_away)),
      'daysAway', round(v_days_away, 1));

  elsif v_open = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Nichts offen — Abwesenheit allein ist kein Anlass',
      'daysAway', round(v_days_away, 1));

  elsif v_relevant = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', format('%s offene Empfehlungen, aber keine von Belang', v_open),
      'daysAway', round(v_days_away, 1), 'open', v_open);

  elsif v_last_sent is not null and v_last_sent > p_now - interval '14 days' then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Vor weniger als 14 Tagen bereits erinnert',
      'lastSentAt', v_last_sent);

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', true,
      'template', 'inactivity_reminder',
      'reason', format('%s Tage abwesend, %s offene Empfehlungen, davon %s von Belang',
                       round(v_days_away), v_open, v_relevant),
      'daysAway', round(v_days_away, 1),
      'open', v_open, 'relevant', v_relevant);
  end if;

  return jsonb_build_object(
    'userId', p_user_id,
    'evaluatedAt', p_now,
    'decisions', v_decisions
  );
end;
$function$;

/* ═══════════════════════════════════════════════════════════════
   6 — schedule_communications: Vorlage aus der Entscheidung
   ═══════════════════════════════════════════════════════════════ */
CREATE OR REPLACE FUNCTION public.schedule_communications(p_channel text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row      record;
  v_plan     jsonb;
  v_decision jsonb;
  v_sent     jsonb := '{}'::jsonb;
  v_alerts   integer := 0;
  v_weekly   integer := 0;
  v_inactive integer := 0;
  /* Empfaenger, die wegen ihres Plans keine operative Mail bekommen.
     Steht im Rueckgabewert, damit ein Lauf beurteilbar bleibt: "0
     verschickt" allein sagt nicht, ob nichts anlag oder alles
     gesperrt war. */
  v_gesperrt integer := 0;
  v_vorlage  text;
  /* WP7: Free-Alarme (kritische Bewertung als Wiedereinstieg). */
  v_free_alerts integer := 0;
  v_free_plan   jsonb;
  v_free_dec    jsonb;
  v_health   jsonb;
  v_ids      uuid[];
  v_loc_title text;
  v_zaehler   jsonb;
  /* WP6 */
  v_happened  jsonb;
  v_check     jsonb;
begin
  for v_row in
    select distinct a.user_id, u.email, p.company_name, p.full_name, p.industry_key,
           public.wants_operational_mail(a.user_id) as darf_operativ
      from public.google_accounts a
      join auth.users u on u.id = a.user_id
      left join public.user_profiles p on p.id = a.user_id
     where a.status = 'active' and a.deleted_at is null and u.email is not null
  loop
    /*
     * ── DIE ZENTRALE EMPFAENGERPRUEFUNG ──
     *
     * Hier und nur hier wird entschieden, ob ein Betrieb operative
     * Kommunikation bekommt. Alle drei Kanaele dieser Funktion
     * tragen Aufgaben, die hinter der Bezahlschranke liegen:
     *
     *   immediate_alert      "Jetzt antworten" → Antwort
     *                        veroeffentlichen, requirePaidAccess
     *   weekly_email         Aufgabenliste → /dashboard/fotos,
     *                        /kunden-gewinnung, beide ProGate
     *   inactivity_reminder  dieselbe Aufgabenliste
     *
     * Eine Mail "Jetzt antworten", die auf eine Bezahlschranke
     * fuehrt, ist ein gebrochenes Versprechen (§25/§26). Deshalb
     * nicht je Kanal, sondern einmal am Empfaenger: Ein neuer Kanal
     * in dieser Funktion ist damit von sich aus gesperrt — das ist
     * die sichere Richtung, und die alte Lage entstand genau
     * umgekehrt (eine Pruefung, die man vergessen kann, wird
     * vergessen).
     *
     * NICHT hier gesperrt, weil nicht hier erzeugt:
     * connection_broken (schedule_lifecycle_emails). Sie zeigt auf
     * /dashboard/google — fuer free erreichbar, und eine abgerissene
     * Verbindung stoppt auch die freien Teile.
     */
    if not v_row.darf_operativ then
      v_gesperrt := v_gesperrt + 1;

      /*
       * WP7 — die EINE Ausnahme fuer Free: eine neue kritische
       * Bewertung darf alarmieren. Nicht die Wochenmail, nicht die
       * Abwesenheitserinnerung — nur das.
       *
       * Dieselbe Wahrheit wie fuer Pro: plan_communications() liefert
       * die immediate_alert-Entscheidung aus den Engine-Events
       * (review.negative_unanswered / reviews.negative_batch), und
       * derselbe Vermerk delivered.notification verhindert, dass
       * dieselbe Bewertung beim naechsten Lauf erneut alarmiert. Kein
       * zweites „rating <= 2" hier, kein zweiter Dedupe.
       *
       * Andere Vorlage (critical_review_free): die Mail fuehrt nicht
       * in den Antwort-Editor, sondern sagt, was ist, und wie Pro
       * hilft. Der Link bleibt Navigation — ProGate entscheidet.
       */
      if p_channel in ('all', 'immediate_alert') then
        v_free_plan := public.plan_communications(v_row.user_id);
        for v_free_dec in select * from jsonb_array_elements(v_free_plan -> 'decisions')
        loop
          continue when v_free_dec ->> 'channel' <> 'immediate_alert';
          continue when not (v_free_dec ->> 'send')::boolean;
          /* WP8: die Free-Ausnahme gilt NUR fuer kritische Bewertungen.
             Profilmeldungen (profile_change_alert) sind Pro — ohne
             diese Zeile liefe jede Sofortentscheidung als Free-Mail. */
          continue when coalesce(v_free_dec ->> 'template', 'critical_review_alert') <> 'critical_review_alert';
          if public.enqueue_email(
               'critical_review_free', v_row.email,
               'critical_free:' || v_row.user_id || ':' ||
                 coalesce(v_free_dec ->> 'locationId', 'kein') || ':' ||
                 to_char(now(), 'YYYY-MM-DD-HH24'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 'companyName',   coalesce(
                                    nullif(trim((select l.title from public.google_locations l
                                                  where l.id = (v_free_dec ->> 'locationId')::uuid)), ''),
                                    v_row.company_name, 'dein Betrieb'),
                 'locationTitle', (select l.title from public.google_locations l
                                    where l.id = (v_free_dec ->> 'locationId')::uuid),
                 'accountName',   v_row.company_name,
                 'locationId',    v_free_dec ->> 'locationId',
                 'industryKey',   coalesce(v_row.industry_key, 'handwerk'),
                 'count',         (v_free_dec ->> 'count')::integer,
                 'reason',        v_free_dec ->> 'reason',
                 'accessTier',    'free')
             ) is not null then
            v_free_alerts := v_free_alerts + 1;
            select array_agg(value::text::uuid)
              into v_ids
              from jsonb_array_elements_text(v_free_dec -> 'eventIds');
            perform public.mark_events_delivered(v_ids, 'notification');
          end if;
        end loop;
      end if;

      continue;
    end if;

    v_plan := public.plan_communications(v_row.user_id);

    /*
     * Der Name des Betriebs, um den es geht.
     *
     * company_name stammt aus der Registrierung. Bei einem Betrieb
     * stimmt das meist; bei zweien sagte die Mail
     * "Firma Rolf Mueller Sanitaer und Heizungstechnik" und zeigte
     * Aufgaben von "S&I." — der Kunde konnte nicht erkennen, worum
     * es geht.
     *
     * Vorrang hat deshalb der Google-Name des ausgewaehlten
     * Standorts. Fehlt er, bleibt der Registrierungsname.
     */
    v_zaehler := public.weekly_counts(
      v_row.user_id, public.werkruf_score_location(v_row.user_id));

    /* WP6: einmal je Empfaenger berechnen, mehrfach im Payload nutzen. */
    v_happened := public.weekly_happened(
      v_row.user_id, public.werkruf_score_location(v_row.user_id));
    v_check := public.weekly_check_facts(
      v_row.user_id, public.werkruf_score_location(v_row.user_id));

    select l.title into v_loc_title
      from public.google_locations l
     where l.id = public.werkruf_score_location(v_row.user_id);

    for v_decision in select * from jsonb_array_elements(v_plan -> 'decisions')
    loop
      continue when not (v_decision ->> 'send')::boolean;
      continue when p_channel <> 'all' and v_decision ->> 'channel' <> p_channel;

      case v_decision ->> 'channel'

        when 'immediate_alert' then
          /* WP8: die Entscheidung nennt die Vorlage; ohne Angabe
             bleibt es die Bewertungsmeldung. */
          v_vorlage := coalesce(v_decision ->> 'template', 'critical_review_alert');
          if public.enqueue_email(
               v_vorlage, v_row.email,
               /* Je Nutzer und Stunde höchstens eine — mehrere
                  Bewertungen in kurzem Abstand werden dadurch
                  gebündelt statt einzeln gemeldet. */
               /* Der Standort gehoert in den Schluessel. Ohne ihn
                  kollidierten zwei Betriebe in derselben Stunde, und
                  die zweite Meldung fiele still aus. */
               (case when v_vorlage = 'critical_review_alert' then 'critical_alert:' else v_vorlage || ':' end)
                 || v_row.user_id || ':' ||
                 coalesce(v_decision ->> 'locationId', 'kein') || ':' ||
                 to_char(now(), 'YYYY-MM-DD-HH24'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 /* WP8: die betroffenen Diffs fuer die Vorlage. */
                 'diffs', case when v_vorlage = 'profile_change_alert' then public.profile_diffs_for_mail(v_decision -> 'diffIds') else null end,
                 /* Der Name des betroffenen Betriebs — nicht der aus
                    der Registrierung, und nicht der gerade im
                    Dashboard ausgewaehlte. Die Bewertung bestimmt den
                    Standort, nicht die Oberflaeche. */
                 'companyName',   coalesce(
                                    nullif(trim((select l.title from public.google_locations l
                                                  where l.id = (v_decision ->> 'locationId')::uuid)), ''),
                                    v_row.company_name, 'dein Betrieb'),
                 'locationTitle', (select l.title from public.google_locations l
                                    where l.id = (v_decision ->> 'locationId')::uuid),
                 'accountName',   v_row.company_name,
                 'locationId',    v_decision ->> 'locationId',
                 'industryKey', coalesce(v_row.industry_key, 'handwerk'),
                 'count', (v_decision ->> 'count')::integer,
                 'reason', v_decision ->> 'reason')
             ) is not null then
            v_alerts := v_alerts + 1;

            /* Vermerken, dass gemeldet wurde. Ohne das käme dieselbe
               Bewertung bei jedem Lauf erneut. */
            select array_agg(value::text::uuid)
              into v_ids
              from jsonb_array_elements_text(v_decision -> 'eventIds');
            perform public.mark_events_delivered(v_ids, 'notification');
          end if;

        when 'weekly_email' then
          v_health := public.compute_health_score(v_row.user_id);
          if public.enqueue_email(
               'weekly_summary', v_row.email,
               'weekly_summary:' || v_row.user_id || ':' ||
                 to_char(date_trunc('week', now()), 'YYYY-MM-DD'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 /* Der Google-Name des Betriebs, Registrierungsname
                    als Rueckfall. */
                 'companyName',  coalesce(nullif(trim(v_loc_title), ''),
                                          v_row.company_name, 'dein Betrieb'),
                 /* Zusaetzlich getrennt, damit Vorlagen den Unterschied
                    kennen koennen. */
                 'locationTitle', nullif(trim(v_loc_title), ''),
                 'accountName',   v_row.company_name,
                 'locationId',    public.werkruf_score_location(v_row.user_id),
                 'userId',        v_row.user_id,
                 'industryKey',  coalesce(v_row.industry_key, 'handwerk'),
                 'actions',      public.top_recommendations_for_email(v_row.user_id, 3),
                 'completed',    public.completed_this_week(v_row.user_id),
                 'healthScore',  (v_health ->> 'score')::integer,
                 'reviewsTotal', (v_health ->> 'reviewsTotal')::integer,
                 'unanswered',   (v_health ->> 'unanswered')::integer,
                 'averageRating',(v_health ->> 'averageRating')::numeric,
                 'openCount',    (v_zaehler ->> 'open')::integer,
                 /* Faellig, nicht nur offen. Die Differenz traegt den
                    Zustand der Woche. */
                 'dueCount',     (v_zaehler ->> 'due')::integer,
                 /*
                  * WP5 (09.11.2026): Deine Google-Woche.
                  *
                  * Summen der letzten vollstaendigen Berichtswoche und
                  * der Woche davor, je Metrik — aus
                  * google_performance_daily. Die Mail rechnet daraus
                  * Aufrufe, Anrufe, Website-Klicks, Routenanfragen und
                  * den Vergleich (src/utils/googlePerformance.js).
                  *
                  * status keine_daten → die Mail zeigt den Block nicht.
                  * Nie eine erfundene Null.
                  */
                 'performance',  public.weekly_performance_for_mail(
                                   public.werkruf_score_location(v_row.user_id), now()),
                 /*
                  * WP6 (09.11.2026): Was passiert ist + Pruefstatus.
                  *
                  * happened: neue/negative Bewertungen, veroeffentlichte
                  * Antworten, erledigte Aufgaben der letzten 7 Tage fuer
                  * den ausgewaehlten Betrieb — aus google_reviews,
                  * review_replies, events. Dieselben Zahlen fuellen
                  * reviewsNew, lowestNewRating, newestReviewAt und
                  * repliesPublished, die die Vorlage seit dem 23.09. liest,
                  * die aber in diesem Payload nie gesetzt waren (die Mail
                  * sagte deshalb immer "0 neue Bewertungen").
                  *
                  * check: Rohfakten fuer leiteWochenstatusAb() in
                  * src/utils/wochenstatus.js — Verbindungsstatus und
                  * Alter des letzten Abgleichs. Die Entscheidung
                  * "Alles geprueft" faellt NICHT hier und nicht in der
                  * Vorlage, sondern in genau dieser einen Funktion.
                  */
                 'happened',         v_happened,
                 'reviewsNew',       (v_happened ->> 'reviewsNew')::integer,
                 'lowestNewRating',  (v_happened ->> 'lowestNewRating')::integer,
                 'newestReviewAt',   v_happened ->> 'newestReviewAt',
                 'repliesPublished', (v_happened ->> 'repliesPublished')::integer,
                 'check',            v_check,
                 /*
                  * Der Zustand, ausdruecklich.
                  *
                  * Aus actions.length allein liesse sich nicht
                  * unterscheiden, ob nichts offen ist oder nur nichts
                  * faellig — und die Mail wuerde bei drei offenen
                  * Aufgaben "alles erledigt" sagen.
                  */
                 'weeklyState',  case
                                   when (v_zaehler ->> 'open')::integer = 0 then 'all_clear'
                                   when (v_zaehler ->> 'due')::integer  = 0 then 'quiet_week'
                                   else 'action_due'
                                 end)
             ) is not null then
            v_weekly := v_weekly + 1;
          end if;

        when 'inactivity_reminder' then
          if public.enqueue_email(
               'inactivity_reminder', v_row.email,
               'inactivity:' || v_row.user_id || ':' || to_char(now(), 'IYYY-IW'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 'companyName', v_row.company_name,
                 'industryKey', coalesce(v_row.industry_key, 'handwerk'),
                 'daysAway',    (v_decision ->> 'daysAway')::numeric,
                 'open',        (v_decision ->> 'open')::integer,
                 'actions',     public.top_recommendations_for_email(v_row.user_id, 3))
             ) is not null then
            v_inactive := v_inactive + 1;
          end if;

        else null;
      end case;
    end loop;
  end loop;

  return jsonb_build_object(
    'alerts', v_alerts, 'weekly', v_weekly,
    'inactivity', v_inactive,
    /* WP7 */
    'freeAlerts', v_free_alerts,
    /* Wie viele Empfaenger der Plan ausgeschlossen hat. */
    'blocked', v_gesperrt,
    'scheduledAt', now()
  );
end;
$function$;

revoke all on function public.schedule_communications(text) from public, anon, authenticated;
grant execute on function public.schedule_communications(text) to service_role;

/* ═══════════════════════════════════════════════════════════════
   7 — weekly_happened: profileChanges
   ═══════════════════════════════════════════════════════════════ */
CREATE OR REPLACE FUNCTION public.weekly_happened(p_user_id uuid, p_location_id uuid, p_since timestamp with time zone DEFAULT (now() - '7 days'::interval))
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile jsonb;
  v_reviews_new  integer := 0;
  v_negative_new integer := 0;
  v_lowest       integer;
  v_newest       timestamptz;
  v_replies      integer := 0;
  v_tasks        integer := 0;
  v_unanswered   integer := 0;
begin
  if p_location_id is not null then
    select count(*) filter (where google_created_at >= p_since),
           count(*) filter (where google_created_at >= p_since and star_rating <= 2),
           min(star_rating) filter (where google_created_at >= p_since),
           max(google_created_at),
           count(*) filter (where not is_answered)
      into v_reviews_new, v_negative_new, v_lowest, v_newest, v_unanswered
      from public.google_reviews
     where location_id = p_location_id
       and user_id = p_user_id
       and status = 'active';

    select count(*) into v_replies
      from public.review_replies
     where location_id = p_location_id
       and user_id = p_user_id
       and status = 'published'
       and published_at >= p_since
       and deleted_at is null;
  end if;

  /* Erledigt = completed, wie completed_this_week(): Betrieb der Mail
     plus Konto-Aufgaben (location_id null). */
  select count(*) into v_tasks
    from public.events e
   where e.user_id = p_user_id
     and (e.location_id = p_location_id or e.location_id is null)
     and e.lifecycle = 'completed'
     and e.completed_at >= p_since;

  /* WP8 — Profilaenderungen der Woche: offene mittlere/kritische
     Diffs und in der Woche aufgeloeste. Fuer "Was passiert ist". */
  select coalesce(jsonb_agg(jsonb_build_object(
           'fieldPath', d.field_path, 'label', d.label, 'prio', d.prio,
           'changeType', d.change_type, 'origin', d.origin,
           'merchantValue', d.merchant_value, 'consumerValue', d.consumer_value,
           'resolvedAt', d.resolved_at, 'firstSeenAt', d.first_seen_at)
           order by d.first_seen_at desc), '[]'::jsonb)
    into v_profile
    from public.google_profile_diffs d
   where d.user_id = p_user_id
     and p_location_id is not null
     and d.location_id = p_location_id
     and d.prio in ('kritisch', 'mittel')
     and (d.resolved_at is null or d.resolved_at >= p_since)
     and (d.first_seen_at >= p_since or d.resolved_at >= p_since or d.resolved_at is null);

  return jsonb_build_object(
    'profileChanges',   v_profile,
    'since',            p_since,
    'reviewsNew',       coalesce(v_reviews_new, 0),
    'negativeNew',      coalesce(v_negative_new, 0),
    'lowestNewRating',  v_lowest,
    'newestReviewAt',   v_newest,
    'repliesPublished', coalesce(v_replies, 0),
    'tasksCompleted',   coalesce(v_tasks, 0),
    'unansweredTotal',  coalesce(v_unanswered, 0)
  );
end;
$function$;

/* ═══════════════════════════════════════════════════════════════
   SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════════ */
do $$
declare v_def text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.google_profile_diffs'::regclass) then
    raise exception '[wp8] google_profile_diffs ohne RLS';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.google_profile_diffs', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.google_profile_diffs', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.google_profile_diffs', 'SELECT') then
    raise exception '[wp8] Client-Rollen duerfen google_profile_diffs schreiben oder anon lesen';
  end if;
  foreach v_def in array array['public.upsert_profile_diffs(uuid,uuid,jsonb,text)', 'public.resolve_profile_diff(uuid,uuid,text)', 'public.profile_diffs_for_mail(jsonb)']
  loop
    if pg_catalog.has_function_privilege('authenticated', v_def, 'EXECUTE') or pg_catalog.has_function_privilege('anon', v_def, 'EXECUTE') then
      raise exception '[wp8] Client-Rollen duerfen % ausfuehren', v_def;
    end if;
  end loop;
  v_def := pg_catalog.pg_get_functiondef('public.plan_communications(uuid,timestamptz)'::regprocedure);
  if position('profile.closed_by_google' in v_def) = 0 then raise exception '[wp8] plan_communications ohne Kanal 1b'; end if;
  v_def := pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure);
  if position('profile_diffs_for_mail' in v_def) = 0 then raise exception '[wp8] schedule_communications ohne Diff-Payload'; end if;
  if position('critical_review_free' in v_def) = 0 then raise exception '[wp8] WP7-Free-Zweig verloren'; end if;
  if position($chk$<> 'critical_review_alert'$chk$ in v_def) = 0 then raise exception '[wp8] Free-Zweig filtert nicht auf die Bewertungsvorlage'; end if;
  v_def := pg_catalog.pg_get_functiondef('public.build_location_evaluation_context(uuid,uuid)'::regprocedure);
  if position('profileDiffs' in v_def) = 0 then raise exception '[wp8] Kontext ohne profileDiffs'; end if;
  raise notice '[wp8] in Ordnung';
end $$;
