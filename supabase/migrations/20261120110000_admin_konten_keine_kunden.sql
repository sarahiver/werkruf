/*
 * Admin-Konten sind keine Kunden.
 *
 * Wer die Rolle admin hat (auth.users.raw_app_meta_data.role — dieselbe
 * Quelle wie die Admin-Pruefung in admin-ops), erscheint nicht mehr in
 * der Kundenliste, im Founding-Partner-Cockpit (Liste und KPIs) und im
 * Produkt-Funnel der Analyse. Entscheidung ueber die Rolle, nicht ueber
 * eine E-Mail-Adresse oder ID im Code.
 *
 * Das Konto selbst bleibt unveraendert (Plan, Daten, Mails).
 * Neue Migration; 20261109140000 bleibt unveraendert.
 */

create or replace function public.ist_internes_konto(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select u.raw_app_meta_data ->> 'role' = 'admin' from auth.users u where u.id = p_user_id), false)
$$;
revoke all on function public.ist_internes_konto(uuid) from public, anon, authenticated;
grant execute on function public.ist_internes_konto(uuid) to service_role;

create or replace function public.interne_konten()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id from auth.users u where u.raw_app_meta_data ->> 'role' = 'admin'
$$;
revoke all on function public.interne_konten() from public, anon, authenticated;
grant execute on function public.interne_konten() to service_role;

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
   where p.plan = 'founding_partner' and not public.ist_internes_konto(p.id)
  ) s;

  select count(*) into v_fp from public.user_profiles pp where pp.plan = 'founding_partner' and not public.ist_internes_konto(pp.id);

  select count(*), count(*) filter (where m.first_opened_at is not null)
    into v_deliv, v_opened
    from public.email_queue m
    join public.user_profiles p on p.id = m.user_id and p.plan = 'founding_partner' and not public.ist_internes_konto(p.id)
   where m.template = 'weekly_summary'
     and m.delivery_status = 'delivered'
     and m.created_at >= p_now - interval '28 days';

  select count(distinct e.user_id) into v_aktiv7
    from public.events e
    join public.user_profiles p on p.id = e.user_id and p.plan = 'founding_partner' and not public.ist_internes_konto(p.id)
   where e.lifecycle = 'completed' and e.completed_at >= p_now - interval '7 days';

  select count(*) into v_ja
    from public.founding_partner_feedback f
    join public.user_profiles p on p.id = f.user_id and p.plan = 'founding_partner' and not public.ist_internes_konto(p.id)
   where f.payment_intent = 'ja';

  select count(*) into v_reviews30
    from public.google_reviews g
    join public.user_profiles p on p.id = g.user_id and p.plan = 'founding_partner' and not public.ist_internes_konto(p.id)
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
  'Founding-Partner-Cockpit (WP6): KPIs und eine Zeile je FP, ohne Admin-Konten. Definitionen im Kopf der Migration 20261109140000.';
revoke execute on function public.fp_cockpit_overview(timestamptz) from public, anon, authenticated;
grant  execute on function public.fp_cockpit_overview(timestamptz) to service_role;

/* ═══ Selbstpruefung ═══ */
do $$
declare f text; v_def text;
begin
  foreach f in array array['public.ist_internes_konto(uuid)', 'public.interne_konten()', 'public.fp_cockpit_overview(timestamptz)'] loop
    if pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') or pg_catalog.has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[interne-konten] % ist fuer Clients ausfuehrbar', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') then raise exception '[interne-konten] % fehlt service_role', f; end if;
  end loop;
  raise notice '[interne-konten] in Ordnung';
end $$;
