-- 20261022160000_kontoloeschung_abschluss.sql
--
-- Kontoloeschung: Abschiedsmail, Stoerfall-Tabelle, Alarm (WP1)
--
-- ═══════════════════════════════════════════════════════════════
-- WOZU
-- ═══════════════════════════════════════════════════════════════
--
-- 20261019130000 hat die Datenbankseite der Loeschung repariert und
-- ist produktiv angewendet (geprueft 22.10.2026 in
-- supabase_migrations.schema_migrations). Diese Migration fasst sie
-- NICHT an. Sie ergaenzt, was delete-account/index.ts fuer den
-- sicheren Ablauf braucht:
--
--   1. Mailvorlage 'account_deleted' — die Bestaetigung geht VOR dem
--      Loeschen in die Queue (email_queue hat keinen Fremdschluessel
--      auf den Nutzer, die Zeile ueberlebt) und raus beim naechsten
--      Worker-Lauf.
--   2. Tabelle account_deletion_incidents — wenn Stripe scheitert
--      oder die Loeschung nach der Stripe-Kuendigung abbricht, steht
--      hier, was ein Mensch nacharbeiten muss. Kein stilles Log.
--   3. ops_alerts() Abschnitt 10 — der Eintrag wird zum kritischen
--      Alarm, bis jemand resolved_at setzt.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS IN DER STOERFALL-TABELLE STEHT — UND WAS NICHT
-- ═══════════════════════════════════════════════════════════════
--
-- Drin: user_id (ohne Fremdschluessel — der Nutzer kann schon weg
-- sein), E-Mail, Stripe-Customer und -Subscription, Stufe, Fehlercode
-- und eine gekuerzte Fehlermeldung. Das reicht, um bei Stripe
-- nachzusehen und den Kunden zu erreichen.
--
-- Nicht drin: Tokens, Schluessel, Request-Header, Stacktraces.
--
-- Zugriff: nur service_role. Kein anon, kein authenticated — auch
-- nicht lesend. Ein Kunde soll nicht die Stripe-IDs anderer Kunden
-- aus einer Stoerfalltabelle lesen koennen.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Mailvorlage zulassen
   ═══════════════════════════════════════════════════════════════
   Vollstaendige Liste aus 20261022140000 plus 'account_deleted'. */
alter table public.email_queue
  drop constraint if exists email_queue_template_check;
alter table public.email_queue
  add constraint email_queue_template_check check (template = any (array[
    'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
    'weekly_report', 'weekly_summary', 'visibility_report',
    'critical_review_alert', 'inactivity_reminder', 'payment_failed',
    'support_reply', 'consent_reminder', 'account_deleted'
  ]));

/* ═══════════════════════════════════════════════════════════════
   2 — Stoerfall-Tabelle
   ═══════════════════════════════════════════════════════════════ */
create table if not exists public.account_deletion_incidents (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null,
  email                  text,
  stage                  text not null check (stage in ('stripe', 'database', 'google', 'cloudinary', 'mail')),
  error_code             text,
  error_message          text check (error_message is null or char_length(error_message) <= 500),
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_cancelled       boolean not null default false,
  context                jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  resolved_at            timestamptz,
  resolved_note          text
);

comment on table public.account_deletion_incidents is
  'Kontoloeschungen, die nicht zu Ende kamen. Jede offene Zeile ist ein kritischer ops-Alarm. '
  'Abschliessen: update ... set resolved_at = now(), resolved_note = ''...''.';

create index if not exists account_deletion_incidents_offen_idx
  on public.account_deletion_incidents (created_at)
  where resolved_at is null;

alter table public.account_deletion_incidents enable row level security;
revoke all on table public.account_deletion_incidents from public, anon, authenticated;
grant select, insert, update on table public.account_deletion_incidents to service_role;

/* ═══════════════════════════════════════════════════════════════
   3 — ops_alerts() mit Abschnitt 10
   ═══════════════════════════════════════════════════════════════
   Wortgleich zur Fassung aus 20261021140000 (Abschnitte 1–9), plus
   Abschnitt 10. */
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

  /* ── 5. Sync-Jobs endgueltig gescheitert UND NICHT BEHOBEN ── */
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

  /* ── 9. Offene Supportanfragen (NEU, 21.10.2026) ──
     Die Details tragen die IDs und Betreffs. Eine neue Anfrage
     aendert damit den Fingerabdruck, und ops_alerts_pending() meldet
     sofort — nicht erst nach der Entprellung. Kein Anfragetext hier:
     Der steht im Admin, nicht in einer Alarm-Mail. */
  select count(*), jsonb_agg(jsonb_build_object(
           'id', id, 'betreff', left(subject, 80), 'seit', created_at)
           order by created_at)
    into v_count, v_detail
  from public.support_requests
  where status = 'open';

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'support.open', 'severity', 'warning',
      'title', v_count || ' offene Supportanfrage(n) von Founding Partnern',
      'detail', v_detail);
  end if;

  /* ── 10. Gescheiterte Kontoloeschungen (NEU, 22.10.2026, WP1) ──
     Ein Eintrag entsteht nur, wenn delete-account nach einem
     unumkehrbaren Schritt (Stripe gekuendigt) nicht zu Ende kam, oder
     wenn Stripe selbst scheiterte. Beides braucht einen Menschen.
     Die Details tragen die Stripe-Bezuege zur Wiederherstellung —
     keine Secrets, kein Token. */
  select count(*), jsonb_agg(jsonb_build_object(
           'id', id, 'stage', stage, 'email', email,
           'stripeCustomerId', stripe_customer_id,
           'stripeSubscriptionId', stripe_subscription_id,
           'errorCode', error_code, 'seit', created_at)
           order by created_at)
    into v_count, v_detail
  from public.account_deletion_incidents
  where resolved_at is null;

  if coalesce(v_count, 0) > 0 then
    v_alerts := v_alerts || jsonb_build_object(
      'key', 'account.deletion_failed', 'severity', 'critical',
      'title', v_count || ' Kontoloeschung(en) unvollstaendig — manuell nacharbeiten',
      'detail', v_detail);
  end if;

  return v_alerts;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   4 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'email_queue_template_check'
                    and pg_get_constraintdef(oid) like '%account_deleted%'
                    and pg_get_constraintdef(oid) like '%consent_reminder%'
                    and pg_get_constraintdef(oid) like '%support_reply%') then
    raise exception '[loeschung] email_queue-Constraint unvollstaendig';
  end if;
  if has_table_privilege('authenticated', 'public.account_deletion_incidents', 'SELECT')
     or has_table_privilege('anon', 'public.account_deletion_incidents', 'SELECT') then
    raise exception '[loeschung] Stoerfalltabelle fuer Browser-Rollen lesbar';
  end if;
  if position('account.deletion_failed' in
       (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ops_alerts')) = 0 then
    raise exception '[loeschung] ops_alerts kennt account.deletion_failed nicht';
  end if;
  raise notice '[loeschung] in Ordnung — Vorlage, Tabelle, Alarm';
  raise notice '[loeschung] WIRKUNGSLOS fuer die Mail, bis send-email die Vorlage account_deleted kennt';
end $$;

commit;
