-- 019_stripe_events.sql
-- Idempotenz für den Stripe-Webhook.
--
-- Stripe wiederholt Webhooks bei Timeout oder 5xx. Ohne diese Tabelle
-- laufen Handler mehrfach: doppelte Mails, zurueckgesetzte Trial-Daten.
--
-- Wiederholbar. Laeuft im SQL Editor.

begin;

create table if not exists public.stripe_events (
  id            text primary key,          -- Stripe Event-ID (evt_…)
  type          text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error_message text
);

create index if not exists stripe_events_received_at_idx
  on public.stripe_events (received_at desc);

create index if not exists stripe_events_unprocessed_idx
  on public.stripe_events (received_at desc)
  where processed_at is null;

-- Nur Service Role. Kein Policy-Eintrag = kein Zugriff fuer authenticated.
alter table public.stripe_events enable row level security;

comment on table public.stripe_events is
  'Verarbeitete Stripe-Webhook-Events. Primaerschluessel verhindert Doppelverarbeitung bei Stripe-Retries.';

-- Betriebssicht: was kam rein, was blieb haengen?
create or replace view public.ops_stripe_events as
select
  type,
  count(*)                                        as gesamt,
  count(*) filter (where processed_at is not null) as verarbeitet,
  count(*) filter (where processed_at is null)     as offen,
  count(*) filter (where error_message is not null) as mit_fehler,
  max(received_at)                                 as zuletzt
from public.stripe_events
group by type
order by zuletzt desc;

comment on view public.ops_stripe_events is
  'Stripe-Webhook-Durchsatz je Eventtyp. "offen" > 0 ueber laengere Zeit heisst: Handler bricht ab.';

-- Aufraeumen: Events aelter als 90 Tage entfernen.
create or replace function public.cleanup_stripe_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.stripe_events
   where received_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

commit;

-- Pruefung
-- select to_regclass('public.stripe_events');
-- select * from public.ops_stripe_events;
