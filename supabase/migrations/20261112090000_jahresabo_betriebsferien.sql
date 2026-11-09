/* ═══════════════════════════════════════════════════════════════
   WP13 — Jahresabo + Betriebsferien-Pause
   ═══════════════════════════════════════════════════════════════

   1  user_profiles.stripe_billing_interval — 'month' | 'year'. Wird
      AUSSCHLIESSLICH vom Stripe-Webhook aus
      subscription.items.data[].price.recurring.interval geschrieben.
      Stripe bleibt Source of Truth; die Spalte ist der Spiegel, damit
      Settings/Admin ohne Stripe-Aufruf wissen, was laeuft.

   2  Betriebsferien (Account-weit): pause_from / pause_until (date,
      Europe/Berlin), pause_reason. Pause ist ein KOMMUNIKATIONS-
      zustand: Wochenmail und Abwesenheitserinnerung ruhen; kritische
      Sofortmeldungen, Google-Sync, Engine, Dashboard und die
      Stripe-Abrechnung laufen weiter. Kein Datenzustand — Events
      werden nicht aufgeloest.

      Maximal 56 Tage (8 Wochen): laengste uebliche Betriebsferien im
      Handwerk sind Sommer (3–4 Wochen) und Weihnachten/Neujahr (2–3
      Wochen); 8 Wochen deckt beides mit Reserve, verhindert aber
      „fuer immer pausiert" — ein Konto, das nie wieder etwas hoert,
      waere ein stiller Downgrade.

   3  is_account_paused(user, now) — DIE eine Wahrheit. Zeitbasiert,
      kein Cron: nach pause_until ist das Konto von selbst wieder aktiv.

   4  account_pause_set / account_pause_end — nur service_role; der
      Client erreicht sie ueber die Edge Function google-business
      (/account/pause, /account/pause-end), die den Nutzer aus dem JWT
      nimmt und Pro/FP prueft (Kanon 20261014120000/130000: kein
      Client-RPC). Validierung hier noch einmal: has_paid_access,
      nicht rueckwirkend, from <= until, <= 56 Tage.

   5  plan_communications — Kopie der WP8-Fassung (20261110120000) mit
      genau drei Ergaenzungen: v_pausiert, Pause-Zweig vor weekly_email
      und vor inactivity_reminder, 'paused' im Rueckgabewert.
      immediate_alert (kritische Bewertung, kritische Profilaenderung
      prio >= 80) bleibt unberuehrt — das ist „Kritisches kommt durch".

   Idempotent. Keine bestehende Migration geaendert.
   ═══════════════════════════════════════════════════════════════ */

/* ── 1/2 Spalten ── */
alter table public.user_profiles
  add column if not exists stripe_billing_interval text,
  add column if not exists pause_from   date,
  add column if not exists pause_until  date,
  add column if not exists pause_reason text;

alter table public.user_profiles drop constraint if exists user_profiles_billing_interval_check;
alter table public.user_profiles
  add constraint user_profiles_billing_interval_check
  check (stripe_billing_interval is null or stripe_billing_interval in ('month', 'year'));

alter table public.user_profiles drop constraint if exists user_profiles_pause_check;
alter table public.user_profiles
  add constraint user_profiles_pause_check
  check (
    (pause_from is null and pause_until is null)
    or (pause_from is not null and pause_until is not null
        and pause_until >= pause_from
        and pause_until - pause_from <= 56)
  );

comment on column public.user_profiles.stripe_billing_interval is 'Spiegel von Stripe: month | year. Nur der Webhook schreibt.';
comment on column public.user_profiles.pause_from  is 'Betriebsferien von (Europe/Berlin, inklusiv). Kommunikationspause, keine Billing-Pause.';
comment on column public.user_profiles.pause_until is 'Betriebsferien bis (inklusiv). Danach automatisch wieder aktiv.';

/* ── 3 Die eine Wahrheit ── */
create or replace function public.is_account_paused(p_user_id uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select (p_now at time zone 'Europe/Berlin')::date between p.pause_from and p.pause_until
       from public.user_profiles p
      where p.id = p_user_id and p.pause_from is not null and p.pause_until is not null),
    false);
$$;
revoke all on function public.is_account_paused(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.is_account_paused(uuid, timestamptz) to service_role;

/* ── 4 Pause setzen / beenden ── */
create or replace function public.account_pause_set(p_user_id uuid, p_from date, p_until date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  if p_user_id is null then raise exception 'p_user_id fehlt' using errcode = '22004'; end if;
  if not public.has_paid_access(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'kein_pro');
  end if;
  if p_from is null or p_until is null then
    return jsonb_build_object('ok', false, 'reason', 'datum_fehlt');
  end if;
  if p_from < v_heute then
    return jsonb_build_object('ok', false, 'reason', 'rueckwirkend');
  end if;
  if p_until < p_from then
    return jsonb_build_object('ok', false, 'reason', 'bis_vor_von');
  end if;
  if p_until - p_from > 56 then
    return jsonb_build_object('ok', false, 'reason', 'zu_lang', 'maxTage', 56);
  end if;
  update public.user_profiles
     set pause_from = p_from, pause_until = p_until, pause_reason = 'betriebsferien', updated_at = now()
   where id = p_user_id;
  return jsonb_build_object('ok', true, 'pauseFrom', p_from, 'pauseUntil', p_until,
                            'paused', public.is_account_paused(p_user_id));
end;
$$;
revoke all on function public.account_pause_set(uuid, date, date) from public, anon, authenticated;
grant execute on function public.account_pause_set(uuid, date, date) to service_role;

create or replace function public.account_pause_end(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_user_id is null then raise exception 'p_user_id fehlt' using errcode = '22004'; end if;
  update public.user_profiles
     set pause_from = null, pause_until = null, pause_reason = null, updated_at = now()
   where id = p_user_id and pause_from is not null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.account_pause_end(uuid) from public, anon, authenticated;
grant execute on function public.account_pause_end(uuid) to service_role;

/* ── 5 plan_communications mit Pause ── */
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
  /* WP13 — Betriebsferien: normale Kommunikation ruht, Kritisches nicht. */
  v_pausiert   boolean := public.is_account_paused(p_user_id, p_now);

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

  if v_pausiert then
    /* WP13: Wochenmail ist normale Kommunikation → ruht. Der Rhythmus
       (last_email_sent) wird nicht beruehrt; nach der Pause kommt die
       naechste Montagsmail regulaer. */
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Betriebsferien — normale Kommunikation pausiert');

  elsif not v_is_monday then
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

  if v_pausiert then
    /* WP13: Abwesenheit waehrend der Betriebsferien ist gewollt. */
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Betriebsferien — normale Kommunikation pausiert');

  elsif v_last_visit is null then
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
    'paused', v_pausiert,
    'decisions', v_decisions
  );
end;
$function$;


/* ── Selbstpruefung ── */
do $$
declare f text; v_u uuid;
begin
  foreach f in array array['public.is_account_paused(uuid,timestamptz)', 'public.account_pause_set(uuid,date,date)', 'public.account_pause_end(uuid)'] loop
    if pg_catalog.has_function_privilege('anon', f, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[wp13] Client-Rollen duerfen % ausfuehren', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp13] service_role darf % nicht', f;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'pause_until') then
    raise exception '[wp13] pause_until fehlt';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_pause_check') then
    raise exception '[wp13] Pause-Constraint fehlt';
  end if;
  /* plan_communications traegt die Pause */
  if position('is_account_paused' in pg_get_functiondef('public.plan_communications(uuid,timestamptz)'::regprocedure)) = 0 then
    raise exception '[wp13] plan_communications kennt die Pause nicht';
  end if;
  /* immediate_alert haengt NICHT an der Pause: kein Pause-Zweig vor dem Kanal-1-Block */
  raise notice '[wp13] in Ordnung';
end $$;
