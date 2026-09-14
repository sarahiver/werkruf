-- 020_ops_alerts.sql
--
-- Betriebsalarm. Anlass: Vom 9. bis 11. September 2026 lief zwei Tage
-- lang kein einziger HTTP-Cronjob, und niemand hat es bemerkt. Sentry
-- haette nichts gesehen (kein Frontend-Fehler), UptimeRobot auch nicht
-- (/health antwortet direkt und war gesund). Sichtbar war es
-- ausschliesslich in cron.job_run_details.
--
-- Diese Migration legt die Erkennung an. Den Versand uebernimmt die
-- Edge Function ops-alert — bewusst getrennt von send-email, damit der
-- Alarm nicht an derselben Maschinerie haengt, die er ueberwacht.
--
-- Wiederholbar. Laeuft im SQL Editor.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — ZUSTANDSHALTUNG
   ═══════════════════════════════════════════════════════════════ */

-- Entprellung. Ohne sie kaeme alle 15 Minuten dieselbe Meldung, und
-- ein Alarm, der staendig schreit, wird nach zwei Tagen ignoriert.
create table if not exists public.ops_alert_log (
  alert_key     text primary key,
  first_seen_at timestamptz not null default now(),
  last_sent_at  timestamptz,
  send_count    integer     not null default 0,
  last_detail   jsonb
);

alter table public.ops_alert_log enable row level security;

comment on table public.ops_alert_log is
  'Wann welche Alarmart zuletzt gemeldet wurde. Steuert die Entprellung.';

-- Stummschaltung. Fuer bekannte Zustaende, die man nicht taeglich
-- gemeldet bekommen will — etwa Google-Quota, solange die Freigabe
-- aussteht.
create table if not exists public.ops_alert_mutes (
  alert_key   text primary key,
  reason      text,
  muted_until timestamptz,          -- null = unbefristet
  created_at  timestamptz not null default now()
);

alter table public.ops_alert_mutes enable row level security;

comment on table public.ops_alert_mutes is
  'Stummgeschaltete Alarmarten. muted_until = null bedeutet unbefristet.';

/* ═══════════════════════════════════════════════════════════════
   2 — EINZELPRUEFUNGEN
   ═══════════════════════════════════════════════════════════════ */

-- Fehlgeschlagene Cronjobs im Zeitfenster, nach Job gruppiert.
create or replace function public.ops_cron_failures(p_minutes integer default 60)
returns table (
  jobname      text,
  fehlschlaege bigint,
  letzter      timestamptz,
  meldung      text
)
language sql
security definer
set search_path = public, cron
as $$
  select
    j.jobname::text,
    count(*)                       as fehlschlaege,
    max(d.start_time)              as letzter,
    -- Nur die juengste Meldung, gekuerzt. Zwanzig identische Texte
    -- helfen niemandem.
    left((array_agg(d.return_message order by d.start_time desc))[1], 300) as meldung
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where d.status = 'failed'
    and d.start_time > now() - make_interval(mins => p_minutes)
  group by j.jobname
  order by count(*) desc;
$$;

comment on function public.ops_cron_failures is
  'Fehlgeschlagene Cron-Laeufe im Zeitfenster. Das Signal, das beim Ausfall vom 9.-11.09. als einziges vorhanden war.';

-- Platzhalter in Cron-Kommandos. Siehe Uebergabe §14, Fallen 8 und 11:
-- zweimal ist genau das passiert, einmal mit <WORKER-SECRET> im Vault,
-- einmal mit <PROJECT-REF> in allen fuenf HTTP-Jobs.
create or replace function public.ops_placeholder_check()
returns table (jobname text, ausschnitt text)
language sql
security definer
set search_path = public, cron
as $$
  select
    jobname::text,
    left(substring(command from '<[^>]{2,40}>'), 60) as ausschnitt
  from cron.job
  where command like '%<%'
    and command ~ '<[A-Za-z][A-Za-z0-9_-]{1,40}>';
$$;

comment on function public.ops_placeholder_check is
  'Cron-Kommandos mit nicht ersetzten Platzhaltern. Muss leer sein.';

/* ═══════════════════════════════════════════════════════════════
   3 — GESAMTBILD
   ═══════════════════════════════════════════════════════════════ */

/*
 * Alle Pruefungen in einem Aufruf.
 *
 * Gibt ein JSON-Array zurueck, je Eintrag:
 *   key       stabile Kennung, Grundlage der Entprellung
 *   severity  'critical' oder 'warning'
 *   title     eine Zeile
 *   detail    was dahintersteckt
 *
 * Bewusst NICHT abgedeckt: rate_limited bei Sync-Jobs. Das ist der
 * Normalzustand, solange die Google-APIs nicht freigegeben sind, und
 * wuerde alle 15 Minuten eine Mail erzeugen. Sobald Google freigibt,
 * gehoert die Ausnahme entfernt — dann ist rate_limited wieder ein
 * echtes Signal.
 */
create or replace function public.ops_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public, cron, net
as $$
declare
  v_alerts jsonb := '[]'::jsonb;
  v_count  bigint;
  v_detail jsonb;
  v_http_jobs bigint;
begin

  /* ── 1. Fehlgeschlagene Cronjobs ── */
  select count(*), jsonb_agg(to_jsonb(f))
    into v_count, v_detail
  from public.ops_cron_failures(60) f;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'cron.failed',
      'severity', 'critical',
      'title',    v_count || ' Cronjob-Fehlschlaege in der letzten Stunde',
      'detail',   v_detail
    );
  end if;

  /* ── 2. Platzhalter in Cron-Kommandos ── */
  select count(*), jsonb_agg(to_jsonb(p))
    into v_count, v_detail
  from public.ops_placeholder_check() p;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'cron.placeholder',
      'severity', 'critical',
      'title',    'Nicht ersetzte Platzhalter in ' || v_count || ' Cron-Kommando(s)',
      'detail',   v_detail
    );
  end if;

  /* ── 3. Stille bei pg_net ──
     Das Muster des Ausfalls vom 9.-11.09.: pg_cron feuert weiter, aber
     kein HTTP-Request kommt durch. Bedingung: Es gibt aktive HTTP-Jobs,
     und trotzdem steht seit 30 Minuten keine Antwort in
     net._http_response. Der Worker laeuft alle 5 Minuten — 30 Minuten
     Stille ist kein Zufall. */
  select count(*) into v_http_jobs
  from cron.job
  where active and command like '%net.http_%';

  if v_http_jobs > 0 then
    select count(*) into v_count
    from net._http_response
    where created > now() - interval '30 minutes';

    if coalesce(v_count, 0) = 0 then
      v_alerts := v_alerts || jsonb_build_object(
        'key',      'net.silent',
        'severity', 'critical',
        'title',    'Seit 30 Minuten keine HTTP-Antwort, obwohl ' || v_http_jobs || ' Jobs feuern',
        'detail',   jsonb_build_object(
                      'hinweis', 'Genau das Muster des Ausfalls vom 9.-11.09.2026.',
                      'pruefen', 'select jobname, status, return_message from cron.job_run_details d join cron.job j on j.jobid=d.jobid order by start_time desc limit 20;'
                    )
      );
    end if;
  end if;

  /* ── 4. Worker laeuft nicht ──
     gbp-worker sollte alle 5 Minuten einen Eintrag in sync_runs
     erzeugen. Bleibt der aus, arbeitet die Warteschlange nicht. */
  select count(*) into v_count
  from public.sync_runs
  where started_at > now() - interval '60 minutes';

  if coalesce(v_count, 0) = 0
     and exists (select 1 from cron.job where jobname = 'gbp-worker' and active) then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'worker.stalled',
      'severity', 'critical',
      'title',    'Seit einer Stunde kein Worker-Lauf',
      'detail',   jsonb_build_object(
                    'letzter_lauf', (select max(started_at) from public.sync_runs)
                  )
    );
  end if;

  /* ── 5. Sync-Jobs endgueltig gescheitert ──
     rate_limited ausgenommen, siehe Kommentar oben. */
  select count(*), jsonb_agg(jsonb_build_object(
           'id', id, 'typ', job_type, 'versuche', attempts,
           'code', error_code, 'meldung', left(error_message, 200)))
    into v_count, v_detail
  from public.sync_jobs
  where attempts >= max_attempts
    and status <> 'succeeded'
    and coalesce(error_code, '') <> 'rate_limited'
    and updated_at > now() - interval '24 hours';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'sync.exhausted',
      'severity', 'warning',
      'title',    v_count || ' Sync-Job(s) endgueltig gescheitert',
      'detail',   v_detail
    );
  end if;

  /* ── 6. Mail-Warteschlange ──
     Gescheitert, oder seit ueber einer Stunde faellig und unversandt. */
  select count(*), jsonb_agg(jsonb_build_object(
           'template', template, 'status', status, 'versuche', attempts,
           'code', error_code, 'seit', created_at))
    into v_count, v_detail
  from public.email_queue
  where (
          status = 'failed'
          or (status = 'queued'
              and coalesce(scheduled_for, created_at) < now() - interval '60 minutes')
        )
    and created_at > now() - interval '7 days';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'mail.stuck',
      'severity', 'warning',
      'title',    v_count || ' Mail(s) haengen in der Warteschlange',
      'detail',   v_detail
    );
  end if;

  /* ── 7. Google-Verbindungen kaputt ──
     Kundenproblem, nicht Systemproblem — aber der Betrieb merkt es
     sonst erst Wochen spaeter. */
  select count(*), jsonb_agg(jsonb_build_object(
           'konto', id, 'status', status, 'code', last_error_code,
           'seit', last_error_at))
    into v_count, v_detail
  from public.google_accounts
  where status in ('needs_reauth', 'revoked')
    and deleted_at is null;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key',      'gbp.reauth',
      'severity', 'warning',
      'title',    v_count || ' Google-Verbindung(en) muessen erneuert werden',
      'detail',   v_detail
    );
  end if;

  /* ── 8. Stripe-Events unverarbeitet ──
     Ein Event ohne processed_at heisst: Der Handler ist ausgestiegen.
     Bei Zahlungen faellt das sonst erst auf, wenn ein Kunde sich
     beschwert. */
  if to_regclass('public.stripe_events') is not null then
    select count(*), jsonb_agg(jsonb_build_object(
             'id', id, 'typ', type, 'seit', received_at,
             'fehler', left(error_message, 200)))
      into v_count, v_detail
    from public.stripe_events
    where processed_at is null
      and received_at < now() - interval '15 minutes'
      and received_at > now() - interval '7 days';

    if coalesce(v_count, 0) > 0 then
      v_alerts := v_alerts || jsonb_build_object(
        'key',      'stripe.unprocessed',
        'severity', 'critical',
        'title',    v_count || ' Stripe-Event(s) unverarbeitet',
        'detail',   v_detail
      );
    end if;
  end if;

  return v_alerts;
end;
$$;

comment on function public.ops_alerts is
  'Alle Betriebspruefungen in einem Aufruf. Leeres Array = alles in Ordnung.';

/* ═══════════════════════════════════════════════════════════════
   4 — ENTPRELLUNG
   ═══════════════════════════════════════════════════════════════ */

/*
 * Gibt nur zurueck, was tatsaechlich gemeldet werden soll:
 * nicht stummgeschaltet und laenger als p_cooldown nicht versandt.
 *
 * Markiert NICHT als versandt — das macht ops_alert_mark_sent, nachdem
 * die Mail draussen ist. Andernfalls waere ein Alarm verloren, wenn
 * der Versand scheitert.
 */
create or replace function public.ops_alerts_pending(
  p_cooldown interval default '1 hour'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_all     jsonb := public.ops_alerts();
  v_pending jsonb := '[]'::jsonb;
  v_item    jsonb;
  v_key     text;
  v_last    timestamptz;
begin
  for v_item in select * from jsonb_array_elements(v_all)
  loop
    v_key := v_item ->> 'key';

    -- Stummgeschaltet?
    if exists (
      select 1 from public.ops_alert_mutes m
       where m.alert_key = v_key
         and (m.muted_until is null or m.muted_until > now())
    ) then
      continue;
    end if;

    select last_sent_at into v_last
      from public.ops_alert_log where alert_key = v_key;

    if v_last is null or v_last < now() - p_cooldown then
      v_pending := v_pending || v_item;
    end if;

    -- Erstsichtung immer festhalten, auch wenn noch nicht gemeldet.
    insert into public.ops_alert_log (alert_key, last_detail)
    values (v_key, v_item -> 'detail')
    on conflict (alert_key) do update set last_detail = excluded.last_detail;
  end loop;

  return v_pending;
end;
$$;

comment on function public.ops_alerts_pending is
  'Alarme, die jetzt gemeldet werden sollen. Beruecksichtigt Stummschaltung und Entprellung.';

-- Nach erfolgreichem Versand aufrufen.
create or replace function public.ops_alert_mark_sent(p_keys text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.ops_alert_log
     set last_sent_at = now(),
         send_count   = send_count + 1
   where alert_key = any(p_keys);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   5 — BETRIEBSSICHT
   ═══════════════════════════════════════════════════════════════ */

create or replace view public.ops_alert_status as
select
  l.alert_key,
  l.first_seen_at,
  l.last_sent_at,
  l.send_count,
  m.alert_key is not null as stummgeschaltet,
  m.muted_until,
  m.reason as stumm_grund
from public.ops_alert_log l
left join public.ops_alert_mutes m on m.alert_key = l.alert_key
order by l.last_sent_at desc nulls last;

comment on view public.ops_alert_status is
  'Welche Alarme gab es, wann wurden sie gemeldet, welche sind stumm.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Was ist gerade los?
--   select jsonb_pretty(public.ops_alerts());
--
-- Was wuerde jetzt gemeldet?
--   select jsonb_pretty(public.ops_alerts_pending());
--
-- Zustand:
--   select * from public.ops_alert_status;
--
-- Einzelpruefungen:
--   select * from public.ops_cron_failures(60);
--   select * from public.ops_placeholder_check();
--
-- Stummschalten (Beispiel):
--   insert into public.ops_alert_mutes (alert_key, reason, muted_until)
--   values ('gbp.reauth', 'Bekannt, Kunde informiert', now() + interval '7 days')
--   on conflict (alert_key) do update
--     set reason = excluded.reason, muted_until = excluded.muted_until;
--
-- Stummschaltung aufheben:
--   delete from public.ops_alert_mutes where alert_key = 'gbp.reauth';
