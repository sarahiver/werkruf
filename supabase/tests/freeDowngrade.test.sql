-- WP7 — Free-Downgrade und Pro-Wiedereinstieg: Datenbankseite.
--
--   scripts/test-db/run.sh freeDowngrade
--
--   access_tier()      T1–T7 in SQL (founding_partner vor Stripe)
--   T11–T14            Kuendigung (plan free, Status canceled) loescht nichts
--   T24–T30            Sofortmeldung: Pro/FP unveraendert, Free bekommt die
--                      Free-Fassung, 5 Sterne nicht, keine Wochenmail,
--                      keine Abwesenheitsmail, kein zweiter Alarm
--   T33/T35            Free wird weiter synchronisiert; Sync erzeugt keine Mail
--   Rechte             anon/authenticated
--
-- Jeder Abschnitt in einer eigenen Transaktion mit rollback.

\set ON_ERROR_STOP on

/* ═══════════════════════════════════════════════════════
   access_tier() — dieselbe Matrix wie accessTier() in JS
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_user uuid := test.id('user_a');
  f record;
begin
  for f in select * from (values
      ('founding_partner', 'sub_1', 'canceled',   'founding_partner'),   -- T1
      ('founding_partner', null,    null,         'founding_partner'),
      ('pro',              'sub_2', 'trialing',   'pro'),                -- T2
      ('pro',              'sub_3', 'active',     'pro'),                -- T3/T4
      ('pro',              'sub_4', 'past_due',   'pro'),
      ('free',             'sub_5', 'canceled',   'free'),               -- T5/T6
      ('free',             'sub_6', 'unpaid',     'free'),               -- T7
      ('free',             'sub_7', 'incomplete', 'free'),
      ('free',             'sub_8', 'paused',     'free'),
      ('free',             null,    null,         'free'),
      /* Etikett free, Abo aktiv: das Abo zaehlt */
      ('free',             'sub_9', 'active',     'pro')
    ) as t(plan, sub, status, erwartet)
  loop
    update public.user_profiles
       set plan = f.plan, stripe_subscription_id = f.sub, stripe_subscription_status = f.status,
           stripe_cancel_at_period_end = coalesce(f.status = 'active', false), stripe_current_period_end = now() + interval '20 days'
     where id = v_user;
    assert public.access_tier(v_user) = f.erwartet,
      format('access_tier(%s/%s/%s) = %s, erwartet %s', f.plan, f.sub, f.status, public.access_tier(v_user), f.erwartet);
    /* Invariante zu has_paid_access */
    assert public.has_paid_access(v_user) = (public.access_tier(v_user) <> 'free'),
      format('Invariante verletzt fuer %s/%s', f.plan, f.status);
  end loop;
  assert public.access_tier('00000000-0000-0000-0000-00000000dead') = 'free', 'ohne Profil: free';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T11–T14 — Kuendigung loescht nichts
   ═══════════════════════════════════════════════════════
   Der Webhook schreibt bei subscription.deleted genau diese Felder
   (stripe-webhook/index.ts). Hier dieselbe Mutation — und danach ist
   alles noch da. */
begin;
select test.basis();
select test.bewertungen('standort_si', 3, 5, true, '2 days');
do $$
declare
  v_user uuid := test.id('user_a');
  v_vorher record;
begin
  update public.user_profiles set plan = 'pro', stripe_subscription_id = 'sub_x', stripe_subscription_status = 'active',
         stripe_cancel_at_period_end = true, stripe_current_period_end = now() + interval '10 days' where id = v_user;
  select (select count(*) from public.google_accounts where user_id = v_user and deleted_at is null) as konten,
         (select count(*) from public.google_locations where user_id = v_user and deleted_at is null) as standorte,
         (select count(*) from public.google_reviews where user_id = v_user) as bewertungen,
         (select count(*) from public.oauth_tokens where user_id = v_user) as tokens
    into v_vorher;
  assert v_vorher.standorte = 2 and v_vorher.bewertungen = 3, 'Vorbedingung';
  /* T16: vor Periodenende Pro */
  assert public.access_tier(v_user) = 'pro', 'T16: vor Periodenende pro';

  /* Periodenende: so schreibt der Webhook */
  update public.user_profiles
     set plan = 'free', stripe_subscription_status = 'canceled', stripe_cancel_at_period_end = false,
         stripe_current_period_end = now(), trial_ends_at = null
   where id = v_user;

  assert public.access_tier(v_user) = 'free', 'T17: nach Periodenende free';
  assert (select count(*) from auth.users where id = v_user) = 1, 'T14: Nutzer geloescht';
  assert (select count(*) from public.google_accounts where user_id = v_user and deleted_at is null) = v_vorher.konten, 'T11: Google-Verbindung weg';
  assert (select count(*) from public.oauth_tokens where user_id = v_user) = v_vorher.tokens, 'T11: Tokens weg';
  assert (select count(*) from public.google_locations where user_id = v_user and deleted_at is null) = v_vorher.standorte, 'T12: Standorte weg';
  assert (select count(*) from public.google_reviews where user_id = v_user) = v_vorher.bewertungen, 'T13: Bewertungen weg';
  assert (select count(*) from public.google_locations where user_id = v_user and selected_at is not null) = 1, 'T27-Vorgriff: gewaehlter Betrieb bleibt';
  /* Score bleibt berechenbar (T34) */
  assert public.compute_health_score(v_user) is not null, 'T34: Score fuer Free nicht berechenbar';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T24–T30 — Sofortmeldung je Stufe
   ═══════════════════════════════════════════════════════ */
begin;

create or replace function pg_temp.lage(p_plan text, p_status text default null)
returns void
language plpgsql
as $$
declare v_user uuid;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  perform test.standort('standort_si', 'user_a', 'konto_a', null, true);
  update public.user_profiles
     set plan = p_plan,
         stripe_subscription_id = case when p_status is null then null else 'sub_t' end,
         stripe_subscription_status = p_status
   where id = v_user;
  delete from public.events where user_id = v_user;
  insert into public.events
    (id, user_id, location_id, type, category, priority, title, summary,
     estimated_minutes, in_dashboard, in_weekly_email, as_notification,
     lifecycle, created_at, subject_type, subject_id)
  values
    ('aa000000-0000-0000-0000-0000000000aa', v_user, test.id('standort_si'),
     'review.negative_unanswered', 'reviews', 95,
     'Schlechte Bewertung beantworten', 'Ein Stern, ohne Antwort',
     10, true, true, true, 'new', pg_catalog.now(),
     'review', 'bb000000-0000-0000-0000-0000000000bb');
  delete from public.email_queue where user_id = v_user;
end $$;

do $$
declare
  v_user uuid;
  v_erg  jsonb;
  m      public.email_queue;
begin
  /* T24/T25 — Pro und FP: bestehender Alarm, KEINE Free-Fassung */
  perform pg_temp.lage('pro', 'active');
  v_user := test.id('user_a');
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 1 and (v_erg ->> 'freeAlerts')::int = 0, format('T24: %s', v_erg);
  assert exists (select 1 from public.email_queue where user_id = v_user and template = 'critical_review_alert'), 'T24: Pro-Vorlage fehlt';
  assert not exists (select 1 from public.email_queue where user_id = v_user and template = 'critical_review_free'), 'T24: Pro bekam Free-Vorlage';

  perform pg_temp.lage('founding_partner', 'canceled');
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 1 and (v_erg ->> 'freeAlerts')::int = 0, format('T25: %s', v_erg);

  /* T26 — Free (gekuendigt, canceled): Free-Fassung, genau eine */
  perform pg_temp.lage('free', 'canceled');
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'alerts')::int = 0, format('T26: Pro-Alarm fuer Free: %s', v_erg);
  assert (v_erg ->> 'freeAlerts')::int = 1, format('T26: Free-Alarm fehlt: %s', v_erg);
  assert (v_erg ->> 'blocked')::int = 1, 'T26: Free zaehlt weiter als gesperrt fuer Pro-Mails';
  select * into m from public.email_queue where user_id = v_user and template = 'critical_review_free';
  assert found, 'T26: keine Zeile';
  assert m.payload ->> 'accessTier' = 'free', 'T26: Payload ohne accessTier';
  assert (m.payload ->> 'locationId')::uuid = test.id('standort_si'), 'T26: Standort fehlt im Payload';
  assert not exists (select 1 from public.email_queue where user_id = v_user and template = 'critical_review_alert'), 'T26: Free bekam Pro-Vorlage';
  /* Vermerk gesetzt — die Basis fuer T30 */
  assert (select delivered ? 'notification' from public.events where id = 'aa000000-0000-0000-0000-0000000000aa'), 'T26: Event nicht als gemeldet vermerkt';

  /* T30 — zweiter Lauf: nichts Neues */
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'freeAlerts')::int = 0, format('T30: zweiter Alarm fuer dieselbe Bewertung: %s', v_erg);
  assert (select count(*) from public.email_queue where user_id = v_user and template = 'critical_review_free') = 1, 'T30: zweite Zeile';

  /* T28/T29 — Montagslauf fuer Free: keine weekly_summary, keine inactivity */
  v_erg := public.schedule_communications('all');
  assert (v_erg ->> 'weekly')::int = 0 and (v_erg ->> 'inactivity')::int = 0, format('T28/T29: %s', v_erg);
  assert not exists (select 1 from public.email_queue where user_id = v_user and template in ('weekly_summary', 'inactivity_reminder')),
    'T28/T29: Free bekam Wochen-/Abwesenheitsmail';

  /* T27 — Free + 5-Sterne-Bewertung (kein negatives Event): nichts */
  perform pg_temp.lage('free', 'canceled');
  delete from public.events where user_id = v_user;
  perform test.bewertungen('standort_si', 1, 5, false, '1 hour');
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'freeAlerts')::int = 0, format('T27: Alarm ohne kritische Bewertung: %s', v_erg);
  assert not exists (select 1 from public.email_queue where user_id = v_user and template = 'critical_review_free'), 'T27: Zeile trotz 5 Sternen';

  /* Nutzer hat Sofortmeldungen abgeschaltet → auch Free nicht */
  perform pg_temp.lage('free', 'canceled');
  update public.notification_preferences set negative_review = false where user_id = v_user;
  v_erg := public.schedule_communications('immediate_alert');
  assert (v_erg ->> 'freeAlerts')::int = 0, format('Abgeschaltet, trotzdem Free-Alarm: %s', v_erg);

  /* Weekly-Kanal allein loest keinen Free-Alarm aus */
  perform pg_temp.lage('free', 'canceled');
  v_erg := public.schedule_communications('weekly_email');
  assert (v_erg ->> 'freeAlerts')::int = 0, 'Free-Alarm im Weekly-Kanal';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   T33/T35 — Free wird weiter synchronisiert, Sync erzeugt keine Mail
   ═══════════════════════════════════════════════════════ */
begin;
select test.basis();
do $$
declare
  v_user uuid := test.id('user_a');
  v_n integer;
begin
  update public.user_profiles set plan = 'free', stripe_subscription_id = 'sub_c', stripe_subscription_status = 'canceled' where id = v_user;
  delete from public.sync_jobs where user_id = v_user;
  perform public.schedule_review_syncs();
  select count(*) into v_n from public.sync_jobs where user_id = v_user and job_type = 'sync_reviews';
  assert v_n >= 1, format('T33: Free-Konto bekommt keinen Review-Sync (%s Jobs)', v_n);
  perform public.schedule_all_syncs();
  select count(*) into v_n from public.sync_jobs where user_id = v_user;
  assert v_n >= 2, format('T33: Free-Konto wird nicht voll synchronisiert (%s Jobs)', v_n);
  /* Der Planer kennt den Plan nicht — nur den Kontostatus. */
  assert position('has_paid_access' in pg_get_functiondef('public.schedule_all_syncs(interval,interval,integer)'::regprocedure)) = 0
     and position('user_profiles' in pg_get_functiondef('public.schedule_review_syncs(interval)'::regprocedure)) = 0,
    'T33: Sync-Planer filtert nach Plan';
  /* T35: Sync allein reiht keine Mail ein */
  assert (select count(*) from public.email_queue where user_id = v_user) = 0, 'T35: Sync erzeugte eine Mail';
end $$;
rollback;

/* ═══════════════════════════════════════════════════════
   Rechte
   ═══════════════════════════════════════════════════════ */
begin;
do $$
begin
  assert not pg_catalog.has_function_privilege('anon', 'public.access_tier(uuid)', 'EXECUTE'), 'anon darf access_tier';
  assert not pg_catalog.has_function_privilege('authenticated', 'public.access_tier(uuid)', 'EXECUTE'), 'authenticated darf access_tier (deny by default)';
  assert pg_catalog.has_function_privilege('service_role', 'public.access_tier(uuid)', 'EXECUTE'), 'service_role darf access_tier nicht';
  assert not pg_catalog.has_function_privilege('authenticated', 'public.schedule_communications(text)', 'EXECUTE'), 'authenticated darf schedule_communications';
  assert not pg_catalog.has_function_privilege('anon', 'public.schedule_communications(text)', 'EXECUTE'), 'anon darf schedule_communications';
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'email_queue_template_check') like '%critical_review_free%',
    'Template-Constraint ohne critical_review_free';
end $$;
rollback;

select '[wp7] freeDowngrade: alle Abschnitte bestanden' as ergebnis;
