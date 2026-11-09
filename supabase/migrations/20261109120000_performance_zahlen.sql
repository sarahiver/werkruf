-- 20261109120000_performance_zahlen.sql
--
-- WP5 — Google-Leistungsdaten: Kontoauszug in der Montagsmail
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM
-- ═══════════════════════════════════════════════════════════════
--
-- Bis hier sagte WERKRUF: „Was musst du tun?" Nicht: „Was hat dein
-- Profil gebracht?" Ein Handwerker, dessen Profil aufgeräumt ist,
-- bekam eine Montagsmail ohne Aufgabe — und keinen Grund, sie zu
-- öffnen. Diese Migration legt die Datenbasis dafür, dass die Mail
-- jede Woche Zahlen trägt: Aufrufe, Anrufe, Website-Klicks,
-- Routenanfragen — gezählt von Google, nicht von uns.
--
-- Quelle: Business Profile Performance API,
--   locations/{id}:fetchMultiDailyMetricsTimeSeries
-- mit der Listing-ID aus google_locations.location_resource_name.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT
-- ═══════════════════════════════════════════════════════════════
--
--   1. google_performance_daily — Tages-Rohdaten je Standort und
--      Metrik. PK (location_id, metric, date): ein zweiter Sync
--      derselben Tage ist ein Upsert, nie eine zweite Zeile. Google
--      korrigiert Tageswerte nachträglich; der Upsert übernimmt die
--      Korrektur.
--   2. google_locations: performance_synced_at, performance_error_code
--      — der Planer liest, der Worker schreibt.
--   3. schedule_performance_syncs() — reiht sync_insights-Jobs ein,
--      einen je Standort und Tag. Jobtyp, Dedupe und CHECK gibt es
--      seit der Baseline; nur der Planer fehlte. Läuft im bestehenden
--      stündlichen gbp-schedule, kein neuer Cron.
--   4. performance_summary() — Summen je Metrik über einen Zeitraum.
--      Die einzige Stelle, an der summiert wird.
--   5. weekly_performance_for_mail() — wählt die Berichtswoche und
--      liefert Summen für Woche und Vorwoche.
--   6. monthly_performance() — Kalendermonat, vorbereitet für die
--      Rechnungsmail (WP6+). Keine Mail hier.
--   7. schedule_communications() — wortgleich zu 20261013130000, plus
--      ein Schlüssel im weekly_summary-Payload: performance.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE BERICHTSWOCHE
-- ═══════════════════════════════════════════════════════════════
--
-- Google liefert Leistungsdaten mit zwei bis fünf Tagen Verzögerung.
-- Am Montag fehlen die letzten Tage der Vorwoche oft noch. Eine Mail,
-- die „letzte Woche: 7 Anrufe" sagt und drei Tage unterschlägt, ist
-- falsch.
--
-- Deshalb: Berichtswoche = die jüngste Kalenderwoche Mo–So, für die
-- alle sieben Tage vorliegen — die direkt vergangene, sonst die davor.
-- Liegt keine der beiden vollständig vor, sagt die Mail das. Die
-- Vorperiode sind die sieben Tage vor der Berichtswoche. Der
-- Zeitraum steht in der Mail, damit niemand raten muss.
--
-- „Vollständig" heißt: sieben verschiedene Tage mit Zeilen. Eine Zeile
-- mit Wert 0 ist ein Tag mit Daten (Google lässt value bei Null weg,
-- liefert den Tag aber). Ein Tag ohne Zeile ist ein Tag ohne Daten.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS SIE NICHT TUT
-- ═══════════════════════════════════════════════════════════════
--
-- Keine Engine-Regeln aus Leistungsdaten, keine Suchbegriffe
-- (ListSearchKeywordImpressionsMonthly), keine Rechnungsmail, kein
-- Client-Zugriff auf die Tabelle (deny by default; WP5 zeigt die
-- Zahlen nur in der Mail). Kein neuer Cron.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Tages-Rohdaten
   ═══════════════════════════════════════════════════════════════ */
create table if not exists public.google_performance_daily (
  location_id uuid        not null references public.google_locations (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  metric      text        not null,
  date        date        not null,
  value       bigint      not null,
  fetched_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint google_performance_daily_pkey primary key (location_id, metric, date),
  constraint google_performance_daily_value_check check (value >= 0),
  /* Nur aktuelle Metriken der Performance API v1. BUSINESS_CONVERSATIONS
     und BUSINESS_FOOD_ORDERS sind veraltet und fehlen absichtlich.
     MESSAGING_CLICKS ist zugelassen, wird aber nicht abgerufen — kein
     Messaging-Use-Case im Produkt. */
  constraint google_performance_daily_metric_check check (metric in (
    'CALL_CLICKS',
    'WEBSITE_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'MESSAGING_CLICKS'
  ))
);

comment on table public.google_performance_daily is
  'Tageswerte der Business Profile Performance API je Standort und Metrik (WP5). '
  'PK (location_id, metric, date) macht den Sync idempotent. Nur Serverpfad.';

create index if not exists google_performance_daily_location_date_idx
  on public.google_performance_daily (location_id, date);

create index if not exists google_performance_daily_user_idx
  on public.google_performance_daily (user_id);

/* updated_at beim Upsert fortschreiben. Der Worker setzt es nicht
   selbst — so steht es auch dann richtig, wenn ein anderer Weg
   schreibt. clock_timestamp() statt now(): now() ist innerhalb einer
   Transaktion eingefroren, und ein Upsert-Lauf schreibt viele Zeilen in
   einer. */
create or replace function public.google_performance_daily_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists google_performance_daily_touch on public.google_performance_daily;
create trigger google_performance_daily_touch
  before update on public.google_performance_daily
  for each row execute function public.google_performance_daily_touch();

revoke execute on function public.google_performance_daily_touch() from public, anon, authenticated;

/* Deny by default. Keine Policies: WP5 liest die Tabelle nur über
   den Serverpfad (Worker, schedule_communications). Ein Dashboard
   bekommt später eine eigene, geprüfte Policy — nicht beiläufig hier. */
alter table public.google_performance_daily enable row level security;
revoke all on table public.google_performance_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.google_performance_daily to service_role;

/* ═══════════════════════════════════════════════════════════════
   2 — Zustand am Standort
   ═══════════════════════════════════════════════════════════════ */
alter table public.google_locations
  add column if not exists performance_synced_at  timestamptz,
  add column if not exists performance_error_code text;

comment on column public.google_locations.performance_synced_at is
  'Letzter erfolgreicher Leistungsdaten-Sync (WP5). Der Planer reiht Standorte ein, deren Wert fehlt oder aelter als p_age ist.';
comment on column public.google_locations.performance_error_code is
  'Fehlercode des letzten Leistungsdaten-Syncs, null nach Erfolg. api_disabled = Performance API im Cloud-Projekt nicht aktiv.';

/* ═══════════════════════════════════════════════════════════════
   3 — Planung
   ═══════════════════════════════════════════════════════════════
   Ein sync_insights-Job je Standort, wenn der letzte Erfolg älter als
   p_age ist. Standorte, die noch nie Daten hatten, zuerst. Die
   Dedupe gegen queued/running übernimmt enqueue_sync_job (Baseline).

   p_age 22 Stunden statt 24: der Planer läuft stündlich; mit exakt
   24 würde ein Standort je nach Lauf-Minute manchmal einen Tag
   aussetzen. */
create or replace function public.schedule_performance_syncs(
  p_age   interval default '22 hours',
  p_limit integer  default 500
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jobs integer := 0;
  v_row  record;
begin
  for v_row in
    select l.id as location_id, l.account_id, l.user_id
      from public.google_locations l
      join public.google_accounts  a on a.id = l.account_id
     where l.deleted_at is null
       and a.deleted_at is null
       and a.status = 'active'
       and (l.performance_synced_at is null
            or l.performance_synced_at < now() - p_age)
     order by l.performance_synced_at nulls first
     limit p_limit
  loop
    if public.enqueue_sync_job(
         'sync_insights', v_row.user_id, v_row.account_id, v_row.location_id,
         '{}'::jsonb,
         /* Hinter Bewertungen (Standard 100) und Standorten (50):
            Leistungsdaten sind Zusatznutzen. */
         120::smallint
       ) is not null then
      v_jobs := v_jobs + 1;
    end if;
  end loop;

  return jsonb_build_object('insightJobs', v_jobs, 'scheduledAt', now());
end;
$$;

comment on function public.schedule_performance_syncs(interval, integer) is
  'Reiht sync_insights-Jobs ein (WP5). Aufgerufen von google-business/sync/schedule nach schedule_all_syncs.';

revoke execute on function public.schedule_performance_syncs(interval, integer) from public, anon, authenticated;
grant  execute on function public.schedule_performance_syncs(interval, integer) to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — Summen je Zeitraum
   ═══════════════════════════════════════════════════════════════
   Rückgabe: { "<METRIC>": { "summe": n, "tage": k }, … } — nur Metriken
   mit mindestens einer Zeile im Zeitraum. Eine Metrik ohne Zeile fehlt
   im Objekt; der Leser erkennt daran „keine Daten", nicht „0".

   Keine Impressions-Summe hier: Welche vier Metriken „Aufrufe" bilden,
   entscheidet die Darstellung (googlePerformance.js). Intern bleiben
   sie getrennt. */
create or replace function public.performance_summary(
  p_location_id uuid,
  p_von         date,
  p_bis         date
)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    jsonb_object_agg(metric, jsonb_build_object('summe', summe, 'tage', tage)),
    '{}'::jsonb)
    from (
      select metric, sum(value)::bigint as summe, count(*)::integer as tage
        from public.google_performance_daily
       where location_id = p_location_id
         and date between p_von and p_bis
       group by metric
    ) s;
$$;

comment on function public.performance_summary(uuid, date, date) is
  'Summen je Metrik ueber einen Zeitraum (WP5). Einzige Stelle, an der Leistungsdaten summiert werden.';

revoke execute on function public.performance_summary(uuid, date, date) from public, anon, authenticated;
grant  execute on function public.performance_summary(uuid, date, date) to service_role;

/* ═══════════════════════════════════════════════════════════════
   5 — Berichtswoche für die Montagsmail
   ═══════════════════════════════════════════════════════════════
   Rückgabe:
     { status: 'ok' | 'unvollstaendig' | 'keine_daten',
       zeitraum:    { von, bis },     -- Mo–So der Berichtswoche
       vorzeitraum: { von, bis },     -- die 7 Tage davor
       aktuell: { METRIC: { summe, tage } },
       vorher:  { METRIC: { summe, tage } } }

   keine_daten     kein einziger Tageswert für den Standort
   unvollstaendig  Daten vorhanden, aber keine der beiden letzten
                   Wochen mit allen sieben Tagen
   ok              Berichtswoche gewählt, Summen gefüllt

   Woche nach Europe/Berlin: Die Mail geht an deutsche Betriebe, die
   Google-Tage sind Standort-Ortstage. */
create or replace function public.weekly_performance_for_mail(
  p_location_id uuid,
  p_now         timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_montag   date;
  v_von      date;
  v_bis      date;
  v_tage     integer;
  v_gewaehlt boolean := false;
  v_versuch  integer;
begin
  if p_location_id is null then
    return jsonb_build_object('status', 'keine_daten');
  end if;

  if not exists (select 1 from public.google_performance_daily where location_id = p_location_id) then
    return jsonb_build_object('status', 'keine_daten');
  end if;

  v_montag := (date_trunc('week', p_now at time zone 'Europe/Berlin'))::date;

  /* Zuerst die direkt vergangene Woche, dann die davor. */
  for v_versuch in 1..2 loop
    v_von := v_montag - (7 * v_versuch);
    v_bis := v_von + 6;

    select count(distinct date) into v_tage
      from public.google_performance_daily
     where location_id = p_location_id
       and date between v_von and v_bis;

    if v_tage = 7 then
      v_gewaehlt := true;
      exit;
    end if;
  end loop;

  if not v_gewaehlt then
    return jsonb_build_object('status', 'unvollstaendig');
  end if;

  return jsonb_build_object(
    'status',      'ok',
    'zeitraum',    jsonb_build_object('von', to_char(v_von, 'YYYY-MM-DD'), 'bis', to_char(v_bis, 'YYYY-MM-DD')),
    'vorzeitraum', jsonb_build_object('von', to_char(v_von - 7, 'YYYY-MM-DD'), 'bis', to_char(v_von - 1, 'YYYY-MM-DD')),
    'aktuell',     public.performance_summary(p_location_id, v_von, v_bis),
    'vorher',      public.performance_summary(p_location_id, v_von - 7, v_von - 1)
  );
end;
$$;

comment on function public.weekly_performance_for_mail(uuid, timestamptz) is
  'Berichtswoche (juengste vollstaendige Mo–So) mit Summen fuer Woche und Vorwoche (WP5). Fuer den weekly_summary-Payload.';

revoke execute on function public.weekly_performance_for_mail(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.weekly_performance_for_mail(uuid, timestamptz) to service_role;

/* ═══════════════════════════════════════════════════════════════
   6 — Kalendermonat (vorbereitet, noch ohne Mail)
   ═══════════════════════════════════════════════════════════════
   p_monat: irgendein Tag des gewünschten Monats. Vorgabe: der
   Vormonat — am Monatsersten ist der Vormonat der erste, der
   vollständig vorliegen kann.

   tage = Tage mit Daten im Monat; der Leser vergleicht mit den
   Kalendertagen und weiß, ob der Monat komplett ist. */
create or replace function public.monthly_performance(
  p_location_id uuid,
  p_monat       date default (date_trunc('month', now() - interval '1 month'))::date
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_von  date := date_trunc('month', p_monat)::date;
  v_bis  date := (date_trunc('month', p_monat) + interval '1 month - 1 day')::date;
  v_vvon date := (date_trunc('month', p_monat) - interval '1 month')::date;
  v_vbis date := v_von - 1;
  v_tage integer;
begin
  if p_location_id is null then
    return jsonb_build_object('status', 'keine_daten');
  end if;

  select count(distinct date) into v_tage
    from public.google_performance_daily
   where location_id = p_location_id
     and date between v_von and v_bis;

  if coalesce(v_tage, 0) = 0 then
    return jsonb_build_object('status', 'keine_daten',
      'zeitraum', jsonb_build_object('von', to_char(v_von, 'YYYY-MM-DD'), 'bis', to_char(v_bis, 'YYYY-MM-DD')));
  end if;

  return jsonb_build_object(
    'status',        case when v_tage = (v_bis - v_von + 1) then 'ok' else 'unvollstaendig' end,
    'tage',          v_tage,
    'kalendertage',  (v_bis - v_von + 1),
    'zeitraum',      jsonb_build_object('von', to_char(v_von, 'YYYY-MM-DD'),  'bis', to_char(v_bis, 'YYYY-MM-DD')),
    'vorzeitraum',   jsonb_build_object('von', to_char(v_vvon, 'YYYY-MM-DD'), 'bis', to_char(v_vbis, 'YYYY-MM-DD')),
    'aktuell',       public.performance_summary(p_location_id, v_von, v_bis),
    'vorher',        public.performance_summary(p_location_id, v_vvon, v_vbis)
  );
end;
$$;

comment on function public.monthly_performance(uuid, date) is
  'Kalendermonat mit Summen fuer Monat und Vormonat (WP5). Datenfunktion fuer eine spaetere Rechnungsmail; hier noch ohne Mail.';

revoke execute on function public.monthly_performance(uuid, date) from public, anon, authenticated;
grant  execute on function public.monthly_performance(uuid, date) to service_role;

/* ═══════════════════════════════════════════════════════════════
   7 — schedule_communications(): performance im weekly_summary-Payload
   ═══════════════════════════════════════════════════════════════
   Wortgleich zur Fassung aus 20261013130000_operative_mails_plangate.sql
   bis auf den neuen Schlüssel 'performance' im weekly_summary-Payload
   (Zeile mit WP5-Kommentar). */
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
  v_health   jsonb;
  v_ids      uuid[];
  v_loc_title text;
  v_zaehler   jsonb;
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

    select l.title into v_loc_title
      from public.google_locations l
     where l.id = public.werkruf_score_location(v_row.user_id);

    for v_decision in select * from jsonb_array_elements(v_plan -> 'decisions')
    loop
      continue when not (v_decision ->> 'send')::boolean;
      continue when p_channel <> 'all' and v_decision ->> 'channel' <> p_channel;

      case v_decision ->> 'channel'

        when 'immediate_alert' then
          if public.enqueue_email(
               'critical_review_alert', v_row.email,
               /* Je Nutzer und Stunde höchstens eine — mehrere
                  Bewertungen in kurzem Abstand werden dadurch
                  gebündelt statt einzeln gemeldet. */
               /* Der Standort gehoert in den Schluessel. Ohne ihn
                  kollidierten zwei Betriebe in derselben Stunde, und
                  die zweite Meldung fiele still aus. */
               'critical_alert:' || v_row.user_id || ':' ||
                 coalesce(v_decision ->> 'locationId', 'kein') || ':' ||
                 to_char(now(), 'YYYY-MM-DD-HH24'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
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
    /* Wie viele Empfaenger der Plan ausgeschlossen hat. */
    'blocked', v_gesperrt,
    'scheduledAt', now()
  );
end;
$function$;

/* ═══════════════════════════════════════════════════════════════
   8 — Selbstprüfung
   ═══════════════════════════════════════════════════════════════
   Nur Struktur und Rechte. Die Wirkung prüft
   supabase/tests/performanceZahlen.test.sql. */
do $$
declare
  v_oid oid;
  v_sig text;
begin
  if to_regclass('public.google_performance_daily') is null then
    raise exception '[wp5] google_performance_daily fehlt';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.google_performance_daily'::regclass
       and contype = 'p'
       and pg_catalog.pg_get_constraintdef(oid) ilike '%(location_id, metric, date)%'
  ) then
    raise exception '[wp5] Primaerschluessel (location_id, metric, date) fehlt — Upsert haette keine Grundlage';
  end if;

  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.google_performance_daily'::regclass) then
    raise exception '[wp5] RLS auf google_performance_daily nicht aktiv';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.google_performance_daily', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.google_performance_daily', 'SELECT') then
    raise exception '[wp5] Client-Rollen duerfen google_performance_daily lesen — nicht vorgesehen';
  end if;

  if not pg_catalog.has_table_privilege('service_role', 'public.google_performance_daily', 'INSERT') then
    raise exception '[wp5] service_role kann nicht in google_performance_daily schreiben — der Worker liefe leer';
  end if;

  if not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = 'public.google_locations'::regclass
                    and attname = 'performance_synced_at' and not attisdropped) then
    raise exception '[wp5] google_locations.performance_synced_at fehlt';
  end if;

  foreach v_sig in array array[
    'schedule_performance_syncs(p_age interval, p_limit integer)',
    'performance_summary(p_location_id uuid, p_von date, p_bis date)',
    'weekly_performance_for_mail(p_location_id uuid, p_now timestamp with time zone)',
    'monthly_performance(p_location_id uuid, p_monat date)'
  ] loop
    select p.oid into v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig;
    if v_oid is null then
      raise exception '[wp5] Funktion fehlt: %', v_sig;
    end if;
    if pg_catalog.has_function_privilege('anon', v_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception '[wp5] Client-Rollen duerfen % ausfuehren', v_sig;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_oid, 'execute') then
      raise exception '[wp5] service_role darf % nicht ausfuehren', v_sig;
    end if;
  end loop;

  /* Der Payload traegt den neuen Schluessel. */
  if position('weekly_performance_for_mail' in
       pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure)) = 0 then
    raise exception '[wp5] schedule_communications ruft weekly_performance_for_mail nicht';
  end if;

  raise notice '[wp5] in Ordnung — Tabelle, Spalten, 4 Funktionen, Payload-Schluessel performance';
end $$;

commit;
