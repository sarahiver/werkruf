-- docs/operations/pre-smoke-restpruefung.sql
--
-- Phase 0A — die drei Punkte, die nach der Inventur offen blieben
--
-- Ausschließlich lesend. Eine einzige Anweisung.
-- Rolle postgres. Alles hineinkopieren, einmal Run.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS HIER GEKLÄRT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- 1  Hängt anonymise_user_on_delete() überhaupt an auth.users?
--    Die Funktion existiert im Schema-Dump. Das zugehörige
--    CREATE TRIGGER liegt im abgeschnittenen Teil der Datei und war
--    deshalb im Repository nicht prüfbar. Davon hängt ab, was beim
--    Löschen mit den sechs Leads passiert.
--
-- 2  Was steckt hinter iverbohnes' stripe_customer_id?
--    Die Inventur zeigt: Kunde vorhanden, kein Abo, plan=free,
--    Testphase am 11.10.2026 abgelaufen. Hier nur der DB-Zustand;
--    was Stripe selbst sagt, steht im Stripe-Dashboard.
--
-- 3  Sind die vier offenen Events wirklich nur bei ivergentz?
--    Und welche genau — damit nach dem Zurücksetzen belegbar ist,
--    dass sie weg sind.

with trigger_pruefung as (
  select
    1 as nr,
    '1 TRIGGER'::text as bereich,
    t.tgname::text    as gegenstand,
    'Tabelle=' || t.tgrelid::regclass::text
      || ' | Funktion=' || p.proname
      || ' | aktiv='    || (case t.tgenabled when 'D' then 'NEIN (deaktiviert)' else 'ja' end)
      || ' | Zeitpunkt='|| (case when (t.tgtype & 2) > 0 then 'BEFORE' else 'AFTER' end)
      || ' | bei DELETE=' || (case when (t.tgtype & 8) > 0 then 'ja' else 'nein' end) as wert
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
    and (p.proname like '%anonymise%' or p.proname like '%anonymize%'
         or t.tgrelid = 'auth.users'::regclass)
),
trigger_leer as (
  select 1, '1 TRIGGER'::text, '(keiner gefunden)'::text,
         'Kein eigener Trigger auf auth.users und keine anonymise-Funktion angehaengt'::text
  where not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal
       and (p.proname like '%anonymise%' or t.tgrelid = 'auth.users'::regclass))
),
stripe_bild as (
  select
    2 as nr,
    '2 STRIPE IN DER DB'::text as bereich,
    u.email::text as gegenstand,
    'plan='            || coalesce(p.plan, '-')
      || ' | customer='    || (case when p.stripe_customer_id is null then 'keiner' else 'vorhanden' end)
      || ' | subscription='|| (case when p.stripe_subscription_id is null then 'keine' else 'vorhanden' end)
      || ' | status='      || coalesce(p.stripe_subscription_status, '-')
      || ' | setup_fee='   || coalesce(p.setup_fee_paid::text, '-')
      || ' | trial='       || coalesce(to_char(p.trial_started_at, 'YYYY-MM-DD'), '-')
      || ' bis '           || coalesce(to_char(p.trial_ends_at,   'YYYY-MM-DD'), '-') as wert
  from auth.users u
  join public.user_profiles p on p.id = u.id
),
offene_events as (
  select
    3 as nr,
    '3 OFFENE EVENTS'::text as bereich,
    (u.email || ' / ' || e.type)::text as gegenstand,
    'kategorie=' || e.category
      || ' | prio='      || e.priority::text
      || ' | erstellt='  || to_char(e.created_at, 'YYYY-MM-DD')
      || ' | wochenmail='|| (case when e.in_weekly_email then 'ja' else 'nein' end)
      || ' | titel='     || left(e.title, 45) as wert
  from public.events e
  join auth.users u on u.id = e.user_id
  where e.resolved_at  is null
    and e.dismissed_at is null
    and (e.expires_at is null or e.expires_at > now())
)
select bereich, gegenstand, wert
from (
  select * from trigger_pruefung
  union all select * from trigger_leer
  union all select * from stripe_bild
  union all select * from offene_events
) s
order by nr, gegenstand;
