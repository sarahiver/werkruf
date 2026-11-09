-- 20261109140000_wochenstatus_fp_cockpit.sql
--
-- WP6 — Wochenstatus („Alles geprüft") und Founding-Partner-Cockpit
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM
-- ═══════════════════════════════════════════════════════════════
--
-- Die Montagsmail durfte bisher leer wirken: keine Aufgabe → ein
-- Satz. Ab WP6 beantwortet sie jede Woche drei Fragen — was Google
-- gebracht hat (WP5), was passiert ist, und was zu tun ist oder dass
-- geprüft wurde und nichts ansteht. Und: Die ersten zehn Founding
-- Partner sollen messbar sein — Zustellung, Öffnung, Klick, erledigte
-- Aufgaben, veröffentlichte Antworten, Zahlungsbereitschaft.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT
-- ═══════════════════════════════════════════════════════════════
--
--   1. weekly_happened()      — was in den letzten 7 Tagen passiert
--                               ist (Bewertungen, Antworten,
--                               erledigte Aufgaben), für den Betrieb
--                               der Mail. Füllt zugleich reviewsNew,
--                               lowestNewRating, newestReviewAt,
--                               repliesPublished — Felder, die die
--                               Vorlage seit dem 23.09. liest, der
--                               produktive Payload aber nie setzte.
--   2. weekly_check_facts()   — Rohfakten für den Prüfstatus:
--                               Verbindungsstatus, Alter des letzten
--                               Abgleichs, offene/fällige Aufgaben.
--                               Die Entscheidung fällt in
--                               src/utils/wochenstatus.js — einmal.
--   3. Zustellereignisse      — email_queue bekommt delivered_at,
--                               first_opened_at, last_opened_at,
--                               open_count, clicked_at,
--                               delivery_status; dazu die Tabelle
--                               communication_delivery_events (jedes
--                               Brevo-Ereignis einmal, idempotent über
--                               Nachricht + Ereignis + Zeitpunkt) und
--                               record_delivery_event() als einziger
--                               Schreibweg. Korrelation über
--                               email_queue.provider_id = Brevo
--                               Message-ID — nie über die Adresse.
--   4. founding_partner_feedback — „49 €?" und Notiz je Founding
--                               Partner, nur Admin, nie Kunde.
--   5. fp_cockpit_overview(), fp_cockpit_detail() — das Cockpit als
--                               zwei Funktionen; admin-ops ruft sie,
--                               rechnet selbst nichts.
--   6. schedule_communications() — wortgleich zu 20261109120000 plus
--                               happened / reviewsNew /
--                               lowestNewRating / newestReviewAt /
--                               repliesPublished / check im
--                               weekly_summary-Payload.
--
-- ═══════════════════════════════════════════════════════════════
-- KPI-DEFINITIONEN (gelten für Cockpit UND Doku)
-- ═══════════════════════════════════════════════════════════════
--
--   zugestellt        weekly_summary mit delivery_status = 'delivered'
--                     (Brevo-Ereignis). Ohne Webhook gibt es keine
--                     Zustellung im Sinne dieser KPI — nur „gesendet".
--   Öffnungsrate      zugestellte weekly_summary der letzten 28 Tage
--                     mit first_opened_at IS NOT NULL
--                     / zugestellte weekly_summary der letzten 28 Tage.
--                     Nicht opens/sends: Bounces verzerren sonst, und
--                     ein zweites Öffnen zählt nicht doppelt.
--                     Öffnung = technisches Open-Ereignis (Pixel), kein
--                     Beweis fürs Lesen (Apple Mail Privacy lädt vor).
--   erledigte Aufgabe events.lifecycle = 'completed' mit completed_at
--                     im Zeitraum — gesetzt NUR durch
--                     record_recommendation_action('completed'), also
--                     durch Klick „erledigt" im Dashboard oder
--                     complete_recommendations_for() nach einer echten
--                     Handlung (Antwort veröffentlicht, Profil
--                     geändert). 'resolved' (Engine: Zustand weg ohne
--                     Handlung), 'dismissed', 'expired' zählen NICHT.
--   Antworten         review_replies.status = 'published' mit
--                     published_at im Zeitraum. Entwürfe zählen nicht.
--   Action-Link       action_tokens.consumed_at im Zeitraum — gesetzt
--                     nur durch die bewusste Handlung per POST auf der
--                     /einstieg-Seite, nie durch einen Mailscanner
--                     (GET verändert consumed_at nicht).
--   Bewertungslink    NICHT messbar: Der Link führt direkt zu
--                     search.google.com/local/writereview. Das Cockpit
--                     zeigt stattdessen „neue Google-Bewertungen 30 Tage"
--                     (google_reviews.google_created_at) — alle Quellen,
--                     ausdrücklich so beschriftet.
--   letzte Anmeldung  auth.users.last_sign_in_at — Beginn einer
--                     Sitzung, nicht jeder Besuch (Sitzungen laufen
--                     lange). Beschriftet als „letzte Anmeldung".
--   49 €?             manuell, founding_partner_feedback.payment_intent.
--                     Keine Ableitung.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS SIE NICHT TUT
-- ═══════════════════════════════════════════════════════════════
--
-- Keine neuen Engine-Regeln, keine neue Mailvorlage, kein
-- Cold-Outreach, keine Attribution für den Bewertungslink, keine
-- Policies für Client-Rollen auf den neuen Tabellen.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Was passiert ist
   ═══════════════════════════════════════════════════════════════
   Für den Betrieb der Mail (p_location_id) plus Kontoebene bei den
   Aufgaben (wie completed_this_week). Nur Zählungen aus bestehenden
   Wahrheiten; nichts wird hier erfunden.

   Rückgabe:
     { since, reviewsNew, negativeNew, lowestNewRating, newestReviewAt,
       repliesPublished, tasksCompleted, unansweredTotal } */
create or replace function public.weekly_happened(
  p_user_id     uuid,
  p_location_id uuid,
  p_since       timestamptz default (now() - interval '7 days')
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
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

  return jsonb_build_object(
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
$$;

comment on function public.weekly_happened(uuid, uuid, timestamptz) is
  'Was in den letzten 7 Tagen fuer den Betrieb der Wochenmail passiert ist (WP6): Bewertungen, Antworten, erledigte Aufgaben.';

revoke execute on function public.weekly_happened(uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.weekly_happened(uuid, uuid, timestamptz) to service_role;

/* ═══════════════════════════════════════════════════════════════
   2 — Prüfstatus: Rohfakten
   ═══════════════════════════════════════════════════════════════
   Rückgabe:
     { connectionStatus, lastSyncedAt, syncAgeHours,
       openCount, dueCount, checkedAt }

   Entscheidung (ok_no_actions / actions_open / connection_problem /
   data_incomplete) in src/utils/wochenstatus.js. */
create or replace function public.weekly_check_facts(
  p_user_id     uuid,
  p_location_id uuid,
  p_now         timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_status  text;
  v_synced  timestamptz;
  v_zaehler jsonb;
begin
  /* Status der Verbindung, die zu diesem Betrieb gehoert; ohne Betrieb
     die beste Verbindung des Kontos. */
  if p_location_id is not null then
    select a.status, l.last_synced_at into v_status, v_synced
      from public.google_locations l
      join public.google_accounts a on a.id = l.account_id
     where l.id = p_location_id and l.user_id = p_user_id;
  end if;

  if v_status is null then
    select a.status into v_status
      from public.google_accounts a
     where a.user_id = p_user_id and a.deleted_at is null
     order by case a.status when 'active' then 0 else 1 end, a.updated_at desc
     limit 1;
  end if;

  v_zaehler := public.weekly_counts(p_user_id, p_location_id);

  return jsonb_build_object(
    'connectionStatus', coalesce(v_status, 'none'),
    'lastSyncedAt',     v_synced,
    'syncAgeHours',     case when v_synced is null then null
                             else round(extract(epoch from (p_now - v_synced)) / 3600.0, 1) end,
    'openCount',        coalesce((v_zaehler ->> 'open')::integer, 0),
    'dueCount',         coalesce((v_zaehler ->> 'due')::integer, 0),
    'checkedAt',        p_now
  );
end;
$$;

comment on function public.weekly_check_facts(uuid, uuid, timestamptz) is
  'Rohfakten fuer den Pruefstatus der Wochenmail (WP6). Die Entscheidung trifft leiteWochenstatusAb() in src/utils/wochenstatus.js.';

revoke execute on function public.weekly_check_facts(uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.weekly_check_facts(uuid, uuid, timestamptz) to service_role;

/* ═══════════════════════════════════════════════════════════════
   3 — Zustellereignisse
   ═══════════════════════════════════════════════════════════════ */
alter table public.email_queue
  add column if not exists delivered_at    timestamptz,
  add column if not exists first_opened_at timestamptz,
  add column if not exists last_opened_at  timestamptz,
  add column if not exists open_count      integer not null default 0,
  add column if not exists clicked_at      timestamptz,
  add column if not exists delivery_status text;

alter table public.email_queue
  drop constraint if exists email_queue_delivery_status_check;
alter table public.email_queue
  add constraint email_queue_delivery_status_check check (delivery_status is null or delivery_status in (
    'delivered', 'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'error'
  ));

comment on column public.email_queue.first_opened_at is
  'Erstes Brevo-Open (technisch: Pixel geladen). Kein Beweis fuers Lesen. Bleibt nach dem ersten Setzen stabil.';
comment on column public.email_queue.delivery_status is
  'Letzter Zustellzustand laut Brevo. delivered ist die Grundlage der Oeffnungsrate; Bounces/Blocked/Spam zaehlen nicht als zugestellt.';

create index if not exists email_queue_provider_id_idx
  on public.email_queue (provider_id) where provider_id is not null;

create table if not exists public.communication_delivery_events (
  id                  uuid        primary key default gen_random_uuid(),
  email_id            uuid        not null references public.email_queue (id) on delete cascade,
  user_id             uuid,
  template            text        not null,
  provider_message_id text        not null,
  event               text        not null,
  event_at            timestamptz not null,
  received_at         timestamptz not null default now(),
  constraint communication_delivery_events_event_check check (event in (
    'sent', 'delivered', 'opened', 'clicked',
    'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'error'
  )),
  /* Idempotenz: Brevo liefert dasselbe Ereignis bei Wiederholung mit
     demselben Zeitstempel. Zwei echte Opens haben zwei Zeitstempel. */
  constraint communication_delivery_events_einmalig unique (provider_message_id, event, event_at)
);

comment on table public.communication_delivery_events is
  'Brevo-Zustellereignisse je Produktmail (WP6). Korrelation ueber provider_message_id = email_queue.provider_id. Keine Adressen, keine IPs, keine Inhalte.';

create index if not exists communication_delivery_events_email_idx
  on public.communication_delivery_events (email_id, event);

alter table public.communication_delivery_events enable row level security;
revoke all on table public.communication_delivery_events from public, anon, authenticated;
grant select, insert on table public.communication_delivery_events to service_role;

/* Der einzige Schreibweg. Gibt zurueck, was passiert ist:
     unknown_message   keine Mail mit dieser Message-ID → nichts getan
     duplicate         Ereignis bereits erfasst → nichts getan
     recorded          Ereignis gespeichert, email_queue fortgeschrieben */
create or replace function public.record_delivery_event(
  p_message_id text,
  p_event      text,
  p_event_at   timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mail   public.email_queue;
  v_id     uuid;
  v_status text;
begin
  if p_message_id is null or length(trim(p_message_id)) = 0 then
    return jsonb_build_object('result', 'unknown_message');
  end if;

  select * into v_mail from public.email_queue
   where provider_id = p_message_id
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('result', 'unknown_message');
  end if;

  insert into public.communication_delivery_events
    (email_id, user_id, template, provider_message_id, event, event_at)
  values (v_mail.id, v_mail.user_id, v_mail.template, p_message_id, p_event, p_event_at)
  on conflict (provider_message_id, event, event_at) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('result', 'duplicate', 'emailId', v_mail.id, 'template', v_mail.template);
  end if;

  v_status := case p_event
    when 'delivered'   then 'delivered'
    when 'soft_bounce' then 'soft_bounce'
    when 'hard_bounce' then 'hard_bounce'
    when 'blocked'     then 'blocked'
    when 'spam'        then 'spam'
    when 'error'       then 'error'
    else null end;

  update public.email_queue
     set delivered_at    = case when p_event = 'delivered' then coalesce(delivered_at, p_event_at) else delivered_at end,
         first_opened_at = case when p_event = 'opened'    then least(coalesce(first_opened_at, p_event_at), p_event_at) else first_opened_at end,
         last_opened_at  = case when p_event = 'opened'    then greatest(coalesce(last_opened_at, p_event_at), p_event_at) else last_opened_at end,
         open_count      = case when p_event = 'opened'    then open_count + 1 else open_count end,
         clicked_at      = case when p_event = 'clicked'   then coalesce(clicked_at, p_event_at) else clicked_at end,
         /* Ein Open nach einem Bounce gibt es nicht; ein spaeteres
            delivered ueberschreibt einen fruehen Soft-Bounce. Nur
            Zustellzustaende aendern den Status. */
         delivery_status = coalesce(v_status, delivery_status),
         updated_at      = now()
   where id = v_mail.id;

  return jsonb_build_object('result', 'recorded', 'emailId', v_mail.id, 'template', v_mail.template, 'userId', v_mail.user_id);
end;
$$;

comment on function public.record_delivery_event(text, text, timestamptz) is
  'Brevo-Ereignis erfassen (WP6). Idempotent ueber (message_id, event, event_at); unbekannte Message-IDs werden gemeldet, nicht gespeichert.';

revoke execute on function public.record_delivery_event(text, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.record_delivery_event(text, text, timestamptz) to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — Founding-Partner-Feedback
   ═══════════════════════════════════════════════════════════════
   Eigene kleine Tabelle statt Spalten in user_profiles: Das Feld ist
   qualitativ, aendert sich oft, braucht updated_by — und user_profiles
   ist die Tabelle, die der Kunde per RLS liest. Hier liest niemand
   ausser dem Serverpfad. */
create table if not exists public.founding_partner_feedback (
  user_id        uuid        primary key references auth.users (id) on delete cascade,
  payment_intent text        not null default 'unbekannt',
  note           text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint founding_partner_feedback_intent_check check (payment_intent in (
    'unbekannt', 'ja', 'eher_ja', 'eher_nein', 'nein'
  )),
  constraint founding_partner_feedback_note_check check (note is null or length(note) <= 2000)
);

comment on table public.founding_partner_feedback is
  '„Wuerde 49 EUR zahlen?" und Notiz je Founding Partner (WP6). Nur Admin ueber admin-ops; kein Kunde sieht oder aendert das.';

alter table public.founding_partner_feedback enable row level security;
revoke all on table public.founding_partner_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.founding_partner_feedback to service_role;

create or replace function public.set_founding_partner_feedback(
  p_user_id    uuid,
  p_intent     text,
  p_note       text,
  p_updated_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.founding_partner_feedback;
begin
  if not exists (select 1 from public.user_profiles where id = p_user_id and plan = 'founding_partner') then
    raise exception 'Kein Founding Partner: %', p_user_id using errcode = 'invalid_parameter_value';
  end if;

  insert into public.founding_partner_feedback (user_id, payment_intent, note, updated_at, updated_by)
  values (p_user_id, coalesce(p_intent, 'unbekannt'), nullif(trim(coalesce(p_note, '')), ''), now(), p_updated_by)
  on conflict (user_id) do update
    set payment_intent = excluded.payment_intent,
        note           = excluded.note,
        updated_at     = now(),
        updated_by     = excluded.updated_by
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.set_founding_partner_feedback(uuid, text, text, uuid) from public, anon, authenticated;
grant  execute on function public.set_founding_partner_feedback(uuid, text, text, uuid) to service_role;

/* ═══════════════════════════════════════════════════════════════
   5 — Das Cockpit
   ═══════════════════════════════════════════════════════════════
   Eine Zeile je Founding Partner (user_profiles.plan =
   'founding_partner' — die kanonische Definition, keine neue). Alles
   aus bestehenden Tabellen, nach den Definitionen oben. */
create or replace function public.fp_cockpit_overview(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_rows   jsonb;
  v_kpis   jsonb;
  v_fp     integer;
  v_deliv  integer;
  v_opened integer;
  v_aktiv7 integer;
  v_ja     integer;
  v_reviews30 integer;
  v_webhook boolean;
begin
  select coalesce(jsonb_agg(z order by z ->> 'foundingPartnerSince'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'userId',               p.id,
      'companyName',          p.company_name,
      'fullName',             p.full_name,
      'email',                u.email,
      'foundingPartnerSince', p.founding_partner_since,
      'foundingPartnerNote',  p.founding_partner_note,
      'lastSignInAt',         u.last_sign_in_at,
      'googleConnected',      exists (select 1 from public.google_accounts a
                                       where a.user_id = p.id and a.deleted_at is null and a.status = 'active'),
      'connectionStatus',     (select a.status from public.google_accounts a
                                where a.user_id = p.id and a.deleted_at is null
                                order by case a.status when 'active' then 0 else 1 end limit 1),
      'locationCount',        (select count(*) from public.google_locations l
                                where l.user_id = p.id and l.deleted_at is null),
      'lastGoogleSyncAt',     (select max(l.last_synced_at) from public.google_locations l
                                where l.user_id = p.id and l.deleted_at is null),
      /* Montagsmail: die juengste */
      'lastWeeklyMail',       (select jsonb_build_object(
                                 'sentAt', m.sent_at, 'status', m.status,
                                 'deliveryStatus', m.delivery_status, 'deliveredAt', m.delivered_at,
                                 'firstOpenedAt', m.first_opened_at, 'lastOpenedAt', m.last_opened_at,
                                 'openCount', m.open_count, 'clickedAt', m.clicked_at)
                                 from public.email_queue m
                                where m.user_id = p.id and m.template = 'weekly_summary'
                                order by m.created_at desc limit 1),
      /* Oeffnungsrate letzte 28 Tage: zugestellt mit Open / zugestellt */
      'weeklyDelivered28d',   (select count(*) from public.email_queue m
                                where m.user_id = p.id and m.template = 'weekly_summary'
                                  and m.delivery_status = 'delivered'
                                  and m.created_at >= p_now - interval '28 days'),
      'weeklyOpened28d',      (select count(*) from public.email_queue m
                                where m.user_id = p.id and m.template = 'weekly_summary'
                                  and m.delivery_status = 'delivered'
                                  and m.first_opened_at is not null
                                  and m.created_at >= p_now - interval '28 days'),
      /* Action-Links: bewusste Handlung (consumed_at) */
      'lastActionLinkAt',     (select max(t.consumed_at) from public.action_tokens t where t.user_id = p.id),
      'actionLinks7d',        (select count(*) from public.action_tokens t
                                where t.user_id = p.id and t.consumed_at >= p_now - interval '7 days'),
      'actionLinks30d',       (select count(*) from public.action_tokens t
                                where t.user_id = p.id and t.consumed_at >= p_now - interval '30 days'),
      /* Erledigte Aufgaben: completed, konto-weit (alle Betriebe) */
      'tasksCompleted7d',     (select count(*) from public.events e
                                where e.user_id = p.id and e.lifecycle = 'completed'
                                  and e.completed_at >= p_now - interval '7 days'),
      'tasksCompleted30d',    (select count(*) from public.events e
                                where e.user_id = p.id and e.lifecycle = 'completed'
                                  and e.completed_at >= p_now - interval '30 days'),
      /* Wochen mit mindestens einer erledigten Aufgabe (letzte 4 ISO-Wochen) */
      'activeWeeks4',         (select count(distinct date_trunc('week', e.completed_at))
                                 from public.events e
                                where e.user_id = p.id and e.lifecycle = 'completed'
                                  and e.completed_at >= date_trunc('week', p_now) - interval '3 weeks'
                                  and e.completed_at < date_trunc('week', p_now) + interval '1 week'),
      /* Antworten: nur published */
      'repliesPublished7d',   (select count(*) from public.review_replies r
                                where r.user_id = p.id and r.status = 'published' and r.deleted_at is null
                                  and r.published_at >= p_now - interval '7 days'),
      'repliesPublished30d',  (select count(*) from public.review_replies r
                                where r.user_id = p.id and r.status = 'published' and r.deleted_at is null
                                  and r.published_at >= p_now - interval '30 days'),
      /* Bewertungslink NICHT messbar — Ersatz: neue Bewertungen, alle Quellen */
      'newReviews30d',        (select count(*) from public.google_reviews g
                                where g.user_id = p.id and g.status = 'active'
                                  and g.google_created_at >= p_now - interval '30 days'),
      'feedback',             (select jsonb_build_object(
                                 'paymentIntent', f.payment_intent, 'note', f.note, 'updatedAt', f.updated_at)
                                 from public.founding_partner_feedback f where f.user_id = p.id)
    ) as z
    from public.user_profiles p
    join auth.users u on u.id = p.id
   where p.plan = 'founding_partner'
  ) s;

  select count(*) into v_fp from public.user_profiles where plan = 'founding_partner';

  select count(*), count(*) filter (where m.first_opened_at is not null)
    into v_deliv, v_opened
    from public.email_queue m
    join public.user_profiles p on p.id = m.user_id and p.plan = 'founding_partner'
   where m.template = 'weekly_summary'
     and m.delivery_status = 'delivered'
     and m.created_at >= p_now - interval '28 days';

  select count(distinct e.user_id) into v_aktiv7
    from public.events e
    join public.user_profiles p on p.id = e.user_id and p.plan = 'founding_partner'
   where e.lifecycle = 'completed' and e.completed_at >= p_now - interval '7 days';

  select count(*) into v_ja
    from public.founding_partner_feedback f
    join public.user_profiles p on p.id = f.user_id and p.plan = 'founding_partner'
   where f.payment_intent = 'ja';

  select count(*) into v_reviews30
    from public.google_reviews g
    join public.user_profiles p on p.id = g.user_id and p.plan = 'founding_partner'
   where g.status = 'active' and g.google_created_at >= p_now - interval '30 days';

  /* Gab es ueberhaupt je ein Zustellereignis? Sonst heisst „0
     zugestellt" nur: Webhook nicht konfiguriert. */
  v_webhook := exists (select 1 from public.communication_delivery_events);

  v_kpis := jsonb_build_object(
    'foundingPartners',   v_fp,
    'weeklyDelivered28d', coalesce(v_deliv, 0),
    'weeklyOpened28d',    coalesce(v_opened, 0),
    'openRate28d',        case when coalesce(v_deliv, 0) > 0
                               then round(v_opened::numeric / v_deliv, 3) else null end,
    'activeLast7d',       coalesce(v_aktiv7, 0),
    'newReviews30d',      coalesce(v_reviews30, 0),
    'yesTo49',            coalesce(v_ja, 0),
    'deliveryTrackingActive', v_webhook,
    'reviewLinkMeasurable', false
  );

  return jsonb_build_object('kpis', v_kpis, 'partners', v_rows, 'asOf', p_now);
end;
$$;

comment on function public.fp_cockpit_overview(timestamptz) is
  'Founding-Partner-Cockpit (WP6): KPIs und eine Zeile je FP. Definitionen im Kopf der Migration 20261109140000.';

revoke execute on function public.fp_cockpit_overview(timestamptz) from public, anon, authenticated;
grant  execute on function public.fp_cockpit_overview(timestamptz) to service_role;

/* Detail: Betriebe getrennt, letzte 4 Wochenmails, Aktivitaet. */
create or replace function public.fp_cockpit_detail(p_user_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_overview jsonb;
  v_partner  jsonb;
begin
  if not exists (select 1 from public.user_profiles where id = p_user_id and plan = 'founding_partner') then
    return null;
  end if;

  v_overview := public.fp_cockpit_overview(p_now);
  select z into v_partner from jsonb_array_elements(v_overview -> 'partners') z
   where (z ->> 'userId')::uuid = p_user_id;

  return v_partner || jsonb_build_object(
    'locations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'locationId',          l.id,
        'title',               l.title,
        'locality',            l.locality,
        'selected',            l.selected_at is not null,
        'lastSyncedAt',        l.last_synced_at,
        'reviewCount',         l.review_count,
        'averageRating',       l.average_rating,
        'performanceSyncedAt', l.performance_synced_at,
        'tasksCompleted30d',   (select count(*) from public.events e
                                 where e.user_id = p_user_id and e.location_id = l.id
                                   and e.lifecycle = 'completed' and e.completed_at >= p_now - interval '30 days'),
        'tasksOpen',           (select count(*) from public.events e
                                 where e.user_id = p_user_id and e.location_id = l.id
                                   and e.lifecycle in ('new', 'seen', 'opened')),
        'repliesPublished30d', (select count(*) from public.review_replies r
                                 where r.user_id = p_user_id and r.location_id = l.id and r.status = 'published'
                                   and r.deleted_at is null and r.published_at >= p_now - interval '30 days'),
        'newReviews30d',       (select count(*) from public.google_reviews g
                                 where g.user_id = p_user_id and g.location_id = l.id and g.status = 'active'
                                   and g.google_created_at >= p_now - interval '30 days'),
        'actionLinks30d',      (select count(*) from public.action_tokens t
                                 where t.user_id = p_user_id and t.location_id = l.id
                                   and t.consumed_at >= p_now - interval '30 days')
      ) order by l.selected_at desc nulls last, l.title), '[]'::jsonb)
      from public.google_locations l
     where l.user_id = p_user_id and l.deleted_at is null
    ),
    'accountTasksCompleted30d', (select count(*) from public.events e
                                   where e.user_id = p_user_id and e.location_id is null
                                     and e.lifecycle = 'completed' and e.completed_at >= p_now - interval '30 days'),
    'weeklyMails', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'emailId', m.id, 'createdAt', m.created_at, 'sentAt', m.sent_at, 'status', m.status,
        'deliveryStatus', m.delivery_status, 'deliveredAt', m.delivered_at,
        'firstOpenedAt', m.first_opened_at, 'lastOpenedAt', m.last_opened_at,
        'openCount', m.open_count, 'clickedAt', m.clicked_at
      ) order by m.created_at desc), '[]'::jsonb)
      from (select * from public.email_queue
             where user_id = p_user_id and template = 'weekly_summary'
             order by created_at desc limit 4) m
    )
  );
end;
$$;

comment on function public.fp_cockpit_detail(uuid, timestamptz) is
  'Founding-Partner-Detail (WP6): Betriebe getrennt, letzte 4 Wochenmails, Aktivitaet. null, wenn kein Founding Partner.';

revoke execute on function public.fp_cockpit_detail(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.fp_cockpit_detail(uuid, timestamptz) to service_role;

/* ═══════════════════════════════════════════════════════════════
   6 — schedule_communications(): happened + check im Payload
   ═══════════════════════════════════════════════════════════════
   Wortgleich zur Fassung aus 20261109120000_performance_zahlen.sql
   bis auf die mit WP6 kommentierten Zeilen. */
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
    /* Wie viele Empfaenger der Plan ausgeschlossen hat. */
    'blocked', v_gesperrt,
    'scheduledAt', now()
  );
end;
$function$;

/* ═══════════════════════════════════════════════════════════════
   7 — Selbstprüfung
   ═══════════════════════════════════════════════════════════════ */
do $$
declare
  v_oid oid;
  v_sig text;
  v_tab text;
begin
  foreach v_tab in array array['communication_delivery_events', 'founding_partner_feedback'] loop
    if to_regclass('public.' || v_tab) is null then
      raise exception '[wp6] Tabelle fehlt: %', v_tab;
    end if;
    if not (select relrowsecurity from pg_catalog.pg_class where oid = ('public.' || v_tab)::regclass) then
      raise exception '[wp6] RLS auf % nicht aktiv', v_tab;
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || v_tab, 'SELECT')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || v_tab, 'SELECT') then
      raise exception '[wp6] Client-Rollen duerfen % lesen', v_tab;
    end if;
    if not pg_catalog.has_table_privilege('service_role', 'public.' || v_tab, 'INSERT') then
      raise exception '[wp6] service_role kann nicht in % schreiben', v_tab;
    end if;
  end loop;

  foreach v_sig in array array[
    'weekly_happened(p_user_id uuid, p_location_id uuid, p_since timestamp with time zone)',
    'weekly_check_facts(p_user_id uuid, p_location_id uuid, p_now timestamp with time zone)',
    'record_delivery_event(p_message_id text, p_event text, p_event_at timestamp with time zone)',
    'set_founding_partner_feedback(p_user_id uuid, p_intent text, p_note text, p_updated_by uuid)',
    'fp_cockpit_overview(p_now timestamp with time zone)',
    'fp_cockpit_detail(p_user_id uuid, p_now timestamp with time zone)'
  ] loop
    select p.oid into v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig;
    if v_oid is null then
      raise exception '[wp6] Funktion fehlt: %', v_sig;
    end if;
    if pg_catalog.has_function_privilege('anon', v_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception '[wp6] Client-Rollen duerfen % ausfuehren', v_sig;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_oid, 'execute') then
      raise exception '[wp6] service_role darf % nicht ausfuehren', v_sig;
    end if;
  end loop;

  if not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = 'public.email_queue'::regclass
                    and attname = 'first_opened_at' and not attisdropped) then
    raise exception '[wp6] email_queue.first_opened_at fehlt';
  end if;

  if position('weekly_check_facts' in
       pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure)) = 0
     or position('weekly_happened' in
       pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure)) = 0 then
    raise exception '[wp6] schedule_communications traegt happened/check nicht';
  end if;
  /* WP5 bleibt erhalten */
  if position('weekly_performance_for_mail' in
       pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure)) = 0 then
    raise exception '[wp6] schedule_communications hat performance (WP5) verloren';
  end if;

  raise notice '[wp6] in Ordnung — 2 Tabellen, 6 Funktionen, email_queue erweitert, Payload traegt happened/check';
end $$;

commit;
