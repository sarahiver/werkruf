-- 20261021140000_support_anfragen.sql
--
-- Direkter Draht für Founding Partner
--
-- ═══════════════════════════════════════════════════════════════
-- WOZU
-- ═══════════════════════════════════════════════════════════════
--
-- Die ersten Founding Partner brauchen einen Weg, den Anbieter zu
-- erreichen, der nicht "irgendeine Mail an irgendeine Adresse" ist.
-- Entschieden am 21.10.2026: ein Formular im Dashboard, nur fuer
-- Founding Partner sichtbar, eine Tabelle, eine Benachrichtigung an
-- den Anbieter ueber den bestehenden Ops-Alert-Weg. Kein Chat, kein
-- Ticketsystem, keine neue Abhaengigkeit.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT
-- ═══════════════════════════════════════════════════════════════
--
--   1. Tabelle support_requests mit RLS
--   2. Funktion set_support_request_status() fuer den Admin-Weg
--   3. ops_alerts() um einen Abschnitt erweitert (CREATE OR REPLACE,
--      Rumpf sonst wortgleich zur Fassung aus 20260929140000)
--
-- ═══════════════════════════════════════════════════════════════
-- DREI ENTSCHEIDUNGEN, DIE NICHT SELBSTVERSTAENDLICH SIND
-- ═══════════════════════════════════════════════════════════════
--
-- FOUNDING PARTNER WIRD IN DER DATENBANK GEPRUEFT, NICHT NUR IM
-- BROWSER. Die Karte ist im Dashboard nur fuer Founding Partner
-- sichtbar — aber Sichtbarkeit ist keine Regel. Wer die RPC direkt
-- aufruft, soll an derselben Stelle scheitern. Die Insert-Policy
-- prueft deshalb user_profiles.plan. Das ist dieselbe Wahrheit wie
-- isFoundingPartner() in src/utils/subscription.js: plan =
-- 'founding_partner', nichts weiter.
--
-- DER EIGENTUEMER DARF NICHT AENDERN UND NICHT LOESCHEN. Eine
-- Anfrage ist, einmal abgeschickt, Teil eines Gespraechs. Status,
-- Antwortzeitpunkt und Notiz setzt der Anbieter. Das verhindert
-- auch, dass sich jemand selbst auf "beantwortet" stellt und die
-- Benachrichtigung damit abwuergt.
--
-- LOESCHEN KASKADIERT MIT DEM KONTO. Supportanfragen sind
-- personenbezogen — freier Text ueber den eigenen Betrieb. Wer sein
-- Konto loescht, nimmt sie mit. Kein Trigger auf dieser Tabelle,
-- also kein neues Hindernis fuer die Kontoloeschung, die am 19.10.
-- gerade erst gangbar geworden ist (loeschung-blocker.sql).
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM UEBER ops_alerts() UND NICHT UEBER EINEN EIGENEN TRIGGER
-- ═══════════════════════════════════════════════════════════════
--
-- Ein Trigger mit net.http_post braeuchte Zugriff auf das Worker-
-- Secret im Vault — eine zweite Stelle mit diesem Recht. ops_alerts()
-- laeuft bereits alle 15 Minuten, hat den Mailweg, die Entprellung
-- und das Stummschalten. Eine neue Anfrage aendert den Fingerabdruck
-- des Alarms (ops_alerts_pending vergleicht die Details) und wird
-- damit sofort gemeldet; sind alle beantwortet, verschwindet der
-- Alarm und gilt als behoben. Hoechstens 15 Minuten Verzug — fuer
-- einen Mailweg angemessen.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Tabelle
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.support_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  subject      text not null,
  body         text not null,
  status       text not null default 'open',
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  admin_note   text,

  constraint support_requests_subject_laenge
    check (char_length(subject) between 3 and 140),
  constraint support_requests_body_laenge
    check (char_length(body) between 10 and 4000),
  constraint support_requests_status_check
    check (status in ('open', 'answered', 'closed')),
  constraint support_requests_admin_note_laenge
    check (admin_note is null or char_length(admin_note) <= 2000)
);

comment on table public.support_requests is
  'Direkter Draht der Founding Partner zum Anbieter. Eigentuemer legt an '
  'und liest eigene; Status und Notiz setzt nur der Admin.';

create index if not exists support_requests_user_idx
  on public.support_requests (user_id, created_at desc);

/* Fuer ops_alerts() und die Admin-Liste: offene zuerst. Partiell,
   weil beantwortete nie ueber diesen Weg gesucht werden. */
create index if not exists support_requests_offen_idx
  on public.support_requests (created_at)
  where status = 'open';

/* ═══════════════════════════════════════════════════════════════
   2 — Rechte und RLS
   ═══════════════════════════════════════════════════════════════

   Seit 20261012140000 (deny_by_default) bekommt eine neue Tabelle
   KEINE Rechte fuer anon und authenticated. Was der Browser braucht,
   muss hier ausdruecklich stehen — und nur das. */

alter table public.support_requests enable row level security;

grant select, insert on public.support_requests to authenticated;
/* update/delete: nicht fuer authenticated. Der Admin-Weg laeuft ueber
   die Edge Function admin-ops mit Service Role und die Funktion in
   Abschnitt 3. */

drop policy if exists support_requests_owner_read   on public.support_requests;
drop policy if exists support_requests_owner_insert on public.support_requests;
drop policy if exists support_requests_admin_read   on public.support_requests;

create policy support_requests_owner_read on public.support_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

/* Die Insert-Policy ist die eigentliche Regel dieser Migration.

   Drei Bedingungen, alle noetig:
     - eigene user_id — sonst koennte jemand im Namen anderer anlegen
     - Founding Partner laut user_profiles — Sichtbarkeit im Browser
       ist keine Regel, siehe Kopf
     - status/answered_at/admin_note auf Ausgangswerten — sonst
       koennte eine Anfrage als "beantwortet" geboren werden und die
       Benachrichtigung umgehen

   Der Blick in user_profiles funktioniert als authenticated, weil
   user_profiles_owner_read die eigene Zeile freigibt. */
create policy support_requests_owner_insert on public.support_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and answered_at is null
    and admin_note is null
    and exists (
      select 1 from public.user_profiles p
       where p.id = (select auth.uid())
         and p.plan = 'founding_partner'
    )
  );

/* Dasselbe Admin-Kriterium wie user_profiles_admin_read und
   leads_admin_read: app_metadata.role aus dem JWT. Nur lesen — fuer
   Aenderungen gibt es die Funktion unten. */
create policy support_requests_admin_read on public.support_requests
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

/* ═══════════════════════════════════════════════════════════════
   3 — Statuswechsel durch den Anbieter
   ═══════════════════════════════════════════════════════════════

   Wie set_founding_partner(): eine Funktion statt eines freien
   UPDATE aus der Edge Function (§19). Sie prueft den Uebergang und
   setzt answered_at genau einmal.

   Rueckgabe ist die Zeile selbst, damit admin-ops sie ins Audit
   schreiben kann, ohne noch einmal zu lesen. */
create or replace function public.set_support_request_status(
  p_request_id uuid,
  p_status     text,
  p_admin_note text default null
) returns public.support_requests
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  v_zeile public.support_requests;
begin
  if p_status not in ('open', 'answered', 'closed') then
    raise exception 'Unbekannter Status: %', p_status using errcode = 'check_violation';
  end if;

  update public.support_requests
     set status      = p_status,
         /* Einmal gesetzt, bleibt der erste Antwortzeitpunkt stehen —
            auch wenn der Status spaeter noch einmal wechselt. */
         answered_at = case
                         when p_status in ('answered', 'closed')
                           then coalesce(answered_at, now())
                         else answered_at
                       end,
         admin_note  = coalesce(p_admin_note, admin_note)
   where id = p_request_id
  returning * into v_zeile;

  if not found then
    raise exception 'Supportanfrage % nicht gefunden', p_request_id
      using errcode = 'no_data_found';
  end if;

  return v_zeile;
end;
$$;

comment on function public.set_support_request_status(uuid, text, text) is
  'Statuswechsel einer Supportanfrage durch den Anbieter. Setzt answered_at '
  'beim ersten Wechsel auf answered/closed. Nur service_role.';

revoke execute on function public.set_support_request_status(uuid, text, text) from public;
revoke execute on function public.set_support_request_status(uuid, text, text) from anon;
revoke execute on function public.set_support_request_status(uuid, text, text) from authenticated;
grant  execute on function public.set_support_request_status(uuid, text, text) to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — ops_alerts() um Abschnitt 9 erweitert
   ═══════════════════════════════════════════════════════════════

   Abschnitte 1-8 sind in der LOGIK unveraendert gegenueber
   20260929140000_ops_alerts_resolved_failures.sql; lediglich ein
   laengerer Erklaerkommentar in Abschnitt 5 ist gekuerzt. Nur
   Abschnitt 9 ist neu.

   Severity 'warning', nicht 'critical': Der Mailer (ops-alert) kennt
   genau diese zwei Werte und rendert 'warning' als "HINWEIS". Eine
   Supportanfrage ist kein Stoerfall — sie soll ankommen, nicht
   alarmieren. */
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

  return v_alerts;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   5 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════ */
do $$
declare
  v_policies integer;
begin
  if to_regclass('public.support_requests') is null then
    raise exception '[support] Tabelle fehlt nach der Migration';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.support_requests'::regclass) then
    raise exception '[support] RLS ist nicht aktiv';
  end if;

  select count(*) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'support_requests';
  if v_policies <> 3 then
    raise exception '[support] % Policies statt 3', v_policies;
  end if;

  /* Keine Schreibrechte fuer authenticated jenseits von insert. */
  if has_table_privilege('authenticated', 'public.support_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.support_requests', 'DELETE') then
    raise exception '[support] authenticated darf aendern oder loeschen — darf es nicht';
  end if;
  if has_table_privilege('anon', 'public.support_requests', 'SELECT') then
    raise exception '[support] anon darf lesen — darf es nicht';
  end if;

  if has_function_privilege('authenticated',
       'public.set_support_request_status(uuid, text, text)', 'execute') then
    raise exception '[support] set_support_request_status steht fuer authenticated offen';
  end if;

  if position('support.open' in pg_get_functiondef('public.ops_alerts()'::regprocedure)) = 0 then
    raise exception '[support] ops_alerts() kennt support.open nicht — alte Fassung aktiv';
  end if;

  raise notice '[support] in Ordnung — Tabelle, 3 Policies, Rechte zu, ops_alerts erweitert';
end $$;

commit;
