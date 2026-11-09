/* ═══════════════════════════════════════════════════════════════
   WP10-Folgefix — Referral-Reward retryfähig
   ═══════════════════════════════════════════════════════════════

   Vorher: scheiterte stripe.customers.createBalanceTransaction()
   (Timeout, 429, 5xx, Netz), setzte der Webhook den Reward terminal
   auf 'failed'. referral_rewards_pending_for() liefert nur 'pending'
   — der verdiente Gratis-Monat war damit dauerhaft verloren.

   Jetzt: ein Stripe-Fehler lässt den Reward 'pending'. Der Versuch
   wird hier notiert (Zähler, Zeit, Fehlertext), der Webhook meldet den
   Handler-Fehler (500) und Stripe stellt das Event erneut zu. Beim
   nächsten Versuch greift derselbe Stripe-Idempotency-Key
   (werkruf-referral-reward-<id>) — nie ein zweiter Credit.

   'failed' bleibt im Check-Constraint erhalten, wird aber vom Webhook
   nicht mehr gesetzt: terminale Zustände sind fachlich ('invalid',
   'not_applicable') und kommen aus Regeln, nicht aus Stripe-Fehlern.

   Idempotent (IF NOT EXISTS / CREATE OR REPLACE). Keine bestehende
   Migration geändert. Nur service_role.
   ═══════════════════════════════════════════════════════════════ */

alter table public.referral_rewards
  add column if not exists attempt_count   integer     not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error      text;

comment on column public.referral_rewards.attempt_count   is 'Stripe-Versuche (createBalanceTransaction), erfolgreiche und fehlgeschlagene';
comment on column public.referral_rewards.last_attempt_at is 'Zeitpunkt des letzten Stripe-Versuchs';
comment on column public.referral_rewards.last_error      is 'Letzter Stripe-Fehler (gekürzt); null nach Erfolg';

/* Versuch notieren — nur für offene Rewards. Rückgabe: true, wenn eine
   Zeile getroffen wurde. Kein Statuswechsel: pending bleibt pending. */
create or replace function public.referral_reward_versuch_notieren(p_reward_id uuid, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  update public.referral_rewards
     set attempt_count   = attempt_count + 1,
         last_attempt_at = now(),
         last_error      = left(p_error, 300)
   where id = p_reward_id and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.referral_reward_versuch_notieren(uuid, text) from public, anon, authenticated;
grant execute on function public.referral_reward_versuch_notieren(uuid, text) to service_role;

/* Erfolg löscht den letzten Fehler — set_status bleibt sonst wie es ist. */
create or replace function public.referral_reward_set_status(p_reward_id uuid, p_status text, p_stripe_object_id text, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_status not in ('applied', 'failed', 'invalid') then
    raise exception 'ungültiger Status' using errcode = '22023';
  end if;
  update public.referral_rewards
     set status = p_status, stripe_object_id = coalesce(p_stripe_object_id, stripe_object_id),
         applied_at = case when p_status = 'applied' then now() else applied_at end,
         status_reason = p_reason,
         last_error = case when p_status = 'applied' then null else last_error end
   where id = p_reward_id and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.referral_reward_set_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.referral_reward_set_status(uuid, text, text, text) to service_role;

/* Offene Rewards eines Referrals — für den Retry-Pfad im Webhook
   (invoice.paid erneut zugestellt, Conversion schon durch, Rewards
   noch pending). Nur service_role. */
create or replace function public.referral_rewards_pending_for_referral(p_referral_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'userId', r.user_id, 'beneficiary', r.beneficiary,
                                                'amountCents', r.amount_cents, 'currency', r.currency,
                                                'attemptCount', r.attempt_count) order by r.created_at), '[]'::jsonb)
    from public.referral_rewards r
   where r.referral_id = p_referral_id and r.status = 'pending';
$$;
revoke all on function public.referral_rewards_pending_for_referral(uuid) from public, anon, authenticated;
grant execute on function public.referral_rewards_pending_for_referral(uuid) to service_role;

/* ── Selbstprüfung ── */
do $$
declare f text;
begin
  foreach f in array array['public.referral_reward_versuch_notieren(uuid,text)', 'public.referral_rewards_pending_for_referral(uuid)', 'public.referral_reward_set_status(uuid,text,text,text)'] loop
    if pg_catalog.has_function_privilege('anon', f, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[wp10-retry] Client-Rollen dürfen % ausführen', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '[wp10-retry] service_role darf % nicht', f;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'referral_rewards' and column_name = 'attempt_count') then
    raise exception '[wp10-retry] attempt_count fehlt';
  end if;
  raise notice '[wp10-retry] in Ordnung';
end $$;
