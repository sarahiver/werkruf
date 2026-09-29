-- 20260929140000_ops_alerts_resolved_failures.sql
--
-- Behebt: Der Alarm sync.exhausted meldet seit Tagen stuendlich
-- 22 endgueltig gescheiterte Standortimporte, obwohl danach ein
-- erfolgreicher Import lief. Die Fehler stammen aus der Zeit vor der
-- Korrektur in 20260929090000.
--
-- URSACHE
-- ops_alerts() zaehlte in Abschnitt 5 schlicht alle Jobs mit
-- attempts >= max_attempts im 24-Stunden-Fenster:
--
--   from public.sync_jobs
--   where attempts >= max_attempts
--     and status <> 'succeeded'
--     and coalesce(error_code, '') <> 'rate_limited'
--     and updated_at > now() - interval '24 hours';
--
-- Ein spaeterer Erfolg desselben Kontos wurde nie betrachtet. Damit
-- galt jeder Fehler als aktueller Vorfall, solange er im Zeitfenster
-- lag — und jede Stunde ging dieselbe Mail raus.
--
-- BEHEBUNG
-- Ein Fehler gilt als behoben, wenn es einen SPAETEREN erfolgreichen
-- Job gibt, der zum selben Vorgang gehoert. "Derselbe Vorgang" heisst:
--
--   user_id      gleich  — Mandantengrenze, niemals kundenuebergreifend
--   account_id   gleich  — ein anderes Google-Konto behebt nichts
--   job_type     gleich  — ein Bewertungs-Sync behebt keinen
--                          Standortimport
--   location_id  gleich  — bei standortbezogenen Jobs; bei
--                          Standortimporten ist die Spalte auf beiden
--                          Seiten null, deshalb "is not distinct from"
--
-- Ein NEUER Fehler nach dem Erfolg hat keinen spaeteren Erfolg und
-- meldet sich damit wieder. Historische Jobs bleiben vollstaendig
-- erhalten — es wird nichts geloescht und nichts stummgeschaltet.
--
-- WEITERE AENDERUNG
-- Die Ausnahme fuer rate_limited faellt weg. Sie war der Normalzustand,
-- solange die Google-APIs nicht freigegeben waren. Seit der Freigabe
-- ist eine erschoepfte Quota ein echtes Signal.
--
-- Wiederholbar. Aendert keine Daten, loescht keine Jobs.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — BEHOBEN ODER NICHT
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.sync_failure_resolved(
  p_user_id     uuid,
  p_account_id  uuid,
  p_job_type    text,
  p_location_id uuid,
  p_failed_at   timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sync_jobs s
     where s.status = 'succeeded'
       and s.created_at > p_failed_at
       and s.user_id     = p_user_id
       and s.job_type    = p_job_type
       and s.account_id  is not distinct from p_account_id
       and s.location_id is not distinct from p_location_id
  );
$$;

comment on function public.sync_failure_resolved is
  'Gilt ein gescheiterter Sync-Job als behoben? Nur ein spaeterer Erfolg desselben Nutzers, Kontos, Jobtyps und Standorts zaehlt.';

/* Betriebssicht: welche Fehler sind offen, welche behoben. */
create or replace view public.ops_sync_failures as
select
  j.id,
  j.user_id,
  j.account_id,
  j.location_id,
  j.job_type,
  j.attempts,
  j.max_attempts,
  j.error_code,
  j.created_at,
  j.updated_at,
  public.sync_failure_resolved(
    j.user_id, j.account_id, j.job_type, j.location_id, j.created_at
  ) as behoben
from public.sync_jobs j
where j.attempts >= j.max_attempts
  and j.status <> 'succeeded';

comment on view public.ops_sync_failures is
  'Endgueltig gescheiterte Sync-Jobs mit Kennzeichnung, ob ein spaeterer Erfolg sie behoben hat. Historie bleibt vollstaendig.';

/* ═══════════════════════════════════════════════════════════════
   2 — ops_alerts() MIT DER UNTERSCHEIDUNG
   ═══════════════════════════════════════════════════════════════ */

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
      'key', 'cron.failed', 'severity', 'critical',
      'title', v_count || ' Cronjob-Fehlschlaege in der letzten Stunde',
      'detail', v_detail);
  end if;

  /* ── 2. Platzhalter in Cron-Kommandos ── */
  select count(*), jsonb_agg(to_jsonb(p))
    into v_count, v_detail
  from public.ops_placeholder_check() p;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'cron.placeholder', 'severity', 'critical',
      'title', 'Nicht ersetzte Platzhalter in ' || v_count || ' Cron-Kommando(s)',
      'detail', v_detail);
  end if;

  /* ── 2b. Fehlerhafte HTTP-Antworten ── */
  select count(*), jsonb_agg(to_jsonb(e))
    into v_count, v_detail
  from public.ops_http_errors(60) e;

  if coalesce((select sum(anzahl) from public.ops_http_errors(60)), 0) >= 3 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'net.errors', 'severity', 'critical',
      'title', (select sum(anzahl) from public.ops_http_errors(60))
               || ' fehlerhafte HTTP-Antworten in der letzten Stunde',
      'detail', jsonb_build_object(
        'codes', v_detail,
        'hinweis', '401 = Worker-Secret, 404 = Function fehlt oder URL falsch, 403/429 = Google-Quota.'));
  end if;

  /* ── 3. Stille bei pg_net ── */
  select count(*) into v_http_jobs
  from cron.job where active and command like '%net.http_%';

  if v_http_jobs > 0 then
    select count(*) into v_count
    from net._http_response where created > now() - interval '30 minutes';

    if coalesce(v_count, 0) = 0 then
      v_alerts := v_alerts || jsonb_build_object(
        'key', 'net.silent', 'severity', 'critical',
        'title', 'Seit 30 Minuten keine HTTP-Antwort, obwohl ' || v_http_jobs || ' Jobs feuern',
        'detail', jsonb_build_object('hinweis', 'Muster des Ausfalls vom 9.-11.09.2026.'));
    end if;
  end if;

  /* ── 4. Worker laeuft nicht ── */
  select count(*) into v_count
  from public.sync_runs where started_at > now() - interval '60 minutes';

  if coalesce(v_count, 0) = 0
     and exists (select 1 from cron.job where jobname = 'gbp-worker' and active) then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'worker.stalled', 'severity', 'critical',
      'title', 'Seit einer Stunde kein Worker-Lauf',
      'detail', jsonb_build_object('letzter_lauf', (select max(started_at) from public.sync_runs)));
  end if;

  /* ── 5. Sync-Jobs endgueltig gescheitert UND NICHT BEHOBEN ──
     Das ist die Aenderung. Vorher zaehlte hier jeder Fehler im
     24-Stunden-Fenster, unabhaengig davon, ob danach ein Erfolg kam.

     Das Zeitfenster ist auf 7 Tage erweitert: Ein wirklich offener
     Fehler soll nicht dadurch verschwinden, dass er alt wird. Behoben
     wird er ueber einen spaeteren Erfolg, nicht ueber Zeitablauf.

     rate_limited ist NICHT mehr ausgenommen — seit der Google-Freigabe
     vom 26.09. ist eine erschoepfte Quota ein echtes Signal. */
  select count(*), jsonb_agg(jsonb_build_object(
           'id', id, 'typ', job_type, 'versuche', attempts,
           'code', error_code, 'seit', created_at))
    into v_count, v_detail
  from public.ops_sync_failures
  where not behoben
    and created_at > now() - interval '7 days';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'sync.exhausted', 'severity', 'warning',
      'title', v_count || ' Sync-Job(s) endgueltig gescheitert und nicht behoben',
      'detail', v_detail);
  end if;

  /* ── 6. Mail-Warteschlange ── */
  select count(*), jsonb_agg(jsonb_build_object(
           'template', template, 'status', status, 'versuche', attempts,
           'code', error_code, 'seit', created_at))
    into v_count, v_detail
  from public.email_queue
  where (status = 'failed'
         or (status = 'queued'
             and coalesce(scheduled_for, created_at) < now() - interval '60 minutes'))
    and created_at > now() - interval '7 days';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'mail.stuck', 'severity', 'warning',
      'title', v_count || ' Mail(s) haengen in der Warteschlange',
      'detail', v_detail);
  end if;

  /* ── 7. Google-Verbindungen kaputt ── */
  select count(*), jsonb_agg(jsonb_build_object(
           'konto', id, 'status', status, 'code', last_error_code, 'seit', last_error_at))
    into v_count, v_detail
  from public.google_accounts
  where status in ('needs_reauth', 'revoked') and deleted_at is null;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'gbp.reauth', 'severity', 'warning',
      'title', v_count || ' Google-Verbindung(en) muessen erneuert werden',
      'detail', v_detail);
  end if;

  /* ── 8. Stripe-Events unverarbeitet ── */
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
        'key', 'stripe.unprocessed', 'severity', 'critical',
        'title', v_count || ' Stripe-Event(s) unverarbeitet',
        'detail', v_detail);
    end if;
  end if;

  return v_alerts;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   3 — ENTPRELLUNG NACH EINEM BEHOBENEN VORFALL ZURUECKSETZEN
   ═══════════════════════════════════════════════════════════════ */

alter table public.ops_alert_log
  add column if not exists last_signature text,
  add column if not exists resolved_at    timestamptz;

comment on column public.ops_alert_log.last_signature is
  'Fingerabdruck des zuletzt gemeldeten Sachverhalts. Aendert er sich, gilt der Vorfall als neu — Entprellung und Zaehler werden zurueckgesetzt.';

create or replace function public.ops_alerts_pending(
  p_cooldown interval default '1 hour'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_all      jsonb := public.ops_alerts();
  v_pending  jsonb := '[]'::jsonb;
  v_item     jsonb;
  v_key      text;
  v_last     timestamptz;
  v_signatur text;
  v_bekannt  text;
  v_aktive   text[] := array(select jsonb_array_elements(v_all) ->> 'key');
begin
  /* Nicht mehr gemeldete Alarme gelten als behoben. last_sent_at wird
     geleert, damit ein spaeteres Wiederauftreten SOFORT meldet statt
     an der Entprellung eines alten Vorfalls haengenzubleiben. */
  update public.ops_alert_log
     set resolved_at    = now(),
         last_sent_at   = null,
         last_signature = null
   where last_sent_at is not null
     and not (alert_key = any(v_aktive));

  for v_item in select * from jsonb_array_elements(v_all)
  loop
    v_key := v_item ->> 'key';

    if exists (
      select 1 from public.ops_alert_mutes m
       where m.alert_key = v_key
         and (m.muted_until is null or m.muted_until > now())
    ) then
      continue;
    end if;

    /* Fingerabdruck des Sachverhalts. Aendert er sich, ist es ein
       anderer Vorfall — etwa ein neuer Fehler nach einem behobenen. */
    v_signatur := md5(coalesce(v_item -> 'detail', 'null'::jsonb)::text);

    select last_sent_at, last_signature
      into v_last, v_bekannt
      from public.ops_alert_log where alert_key = v_key;

    if v_bekannt is distinct from v_signatur then
      /* Neuer Vorfall: Zaehler zuruecksetzen und sofort melden. */
      insert into public.ops_alert_log (alert_key, last_detail, last_signature, first_seen_at)
      values (v_key, v_item -> 'detail', v_signatur, now())
      on conflict (alert_key) do update
        set last_detail    = excluded.last_detail,
            last_signature = excluded.last_signature,
            first_seen_at  = now(),
            send_count     = 0,
            resolved_at    = null;
      v_pending := v_pending || v_item;
    else
      insert into public.ops_alert_log (alert_key, last_detail, last_signature)
      values (v_key, v_item -> 'detail', v_signatur)
      on conflict (alert_key) do update
        set last_detail = excluded.last_detail,
            resolved_at = null;
      if v_last is null or v_last < now() - p_cooldown then
        v_pending := v_pending || v_item;
      end if;
    end if;
  end loop;

  return v_pending;
end;
$$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Die 22 historischen Fehler ansehen und pruefen, ob sie als behoben
-- gelten:
--   select job_type, behoben, count(*)
--   from public.ops_sync_failures group by 1,2 order by 1,2;
--
-- Was der Alarm jetzt meldet:
--   select jsonb_pretty(public.ops_alerts());
--
-- Zustand der Entprellung:
--   select * from public.ops_alert_status;
--
-- Nichts wurde geloescht:
--   select count(*) from public.sync_jobs where attempts >= max_attempts
--     and status <> 'succeeded';
