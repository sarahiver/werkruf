-- Abnahme fuer die Empfaengerpruefung operativer Mails
-- (Paket H1, P0 #4).
--
--   psql -f operativeMails.test.sql
--
-- Setzt 20261013130000_operative_mails_plangate.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS HIER GEPRUEFT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- 1  has_paid_access als Wahrheitstabelle — dieselben Faelle wie
--    src/utils/entitlement.test.js (§49). Zwei Umsetzungen derselben
--    Regel sind nur dann vertretbar, wenn beide gegen dieselbe
--    Matrix geprueft werden.
--
-- 2  Die WIRKUNG: laeuft schedule_communications, landet fuer einen
--    free-Betrieb keine Zeile in email_queue — und fuer pro und
--    founding_partner dieselbe wie vorher. Nicht der Wortlaut der
--    Funktion, sondern was in der Warteschlange steht.
--
-- 3  Die Gegenproben: dass die Sperre nicht zu weit greift
--    (founding_partner, Stripe aktiv, pro) und nicht am falschen
--    Kanal haengt (connection_broken bleibt).
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DER KRITISCHE ALARM UND NICHT DIE WOCHENMAIL
-- ═══════════════════════════════════════════════════════════════
--
-- plan_communications sendet die Wochenmail nur montags
-- (v_is_monday) und nimmt p_now nicht aus dem Aufruf von
-- schedule_communications. An einem Dienstag ist die Entscheidung
-- also ohnehin 'Nur montags' — die Sperre waere nicht beobachtbar.
--
-- Der kritische Alarm haengt an keinem Wochentag. Und weil die
-- Pruefung am EMPFAENGER sitzt und nicht am Kanal, gilt das Ergebnis
-- fuer alle drei Kanaele dieser Funktion: Ein gesperrter Empfaenger
-- erreicht die Kanalschleife nie. Abschnitt 4 haelt genau das fest.

\set ON_ERROR_STOP on

/* ═══════════════════════════════════════════════════════
   1 — DIE WAHRHEITSTABELLE
   ═══════════════════════════════════════════════════════ */
begin;

do $$
declare
  v_id uuid := test.benutzer('user_a');
  v_fall record;
begin
  for v_fall in
    select *
      from (values
        /* plan,              sub_id,   status,      erwartet, warum */
        ('free',              null,     null,        false, 'Beobachter, noch nicht berechtigt'),
        ('starter',           null,     null,        false, 'toter Wert, faellt auf kein Zugang'),
        ('pro',               null,     null,        true,  'zahlender Kunde'),
        ('founding_partner',  null,     null,        true,  'kostenlos, funktional wie pro'),

        /* Stripe entscheidet, sobald es eine Spur gibt. */
        ('pro',   'sub_1', 'active',             true,  'Abo laeuft'),
        ('pro',   'sub_1', 'trialing',           true,  'Stripe-Testphase'),
        ('pro',   'sub_1', 'past_due',           true,  'Zahlung offen, Zugang bleibt'),
        ('pro',   'sub_1', 'canceled',           false, 'gekuendigt'),
        ('pro',   'sub_1', 'unpaid',             false, 'unbezahlt'),
        ('pro',   'sub_1', 'incomplete',         false, 'nie zustande gekommen'),
        ('pro',   'sub_1', 'incomplete_expired', false, 'abgelaufen'),
        ('pro',   'sub_1', 'paused',             false, 'ausgesetzt'),
        ('free',  'sub_1', 'active',             true,  'Etikett free, Abo aber aktiv'),
        ('free',  'sub_1', 'canceled',           false, 'nach dem Verlust'),

        /* Der Fall aus §23: founding_partner mit Stripe-Historie.
           Stuende der Stripe-Zweig vorne, waere jede Zeile hier
           false. */
        ('founding_partner', 'sub_alt', 'canceled',           true, 'Historie, Zugang bleibt'),
        ('founding_partner', 'sub_alt', 'unpaid',             true, 'dito'),
        ('founding_partner', 'sub_alt', 'incomplete_expired', true, 'dito'),
        ('founding_partner', 'sub_alt', 'paused',             true, 'dito'),
        ('founding_partner', 'sub_alt', 'active',             true, 'dito'),

        /* Leerer String ist in JavaScript falsch, in SQL NOT NULL —
           nullif(..., '') haelt beide Fassungen zusammen. Ohne das
           naehme SQL hier den Stripe-Zweig und antwortete false,
           JavaScript den Planzweig und true. */
        ('pro',   '',      '',                   true,  'leere Stripe-Felder zaehlen nicht als Spur'),
        ('free',  '',      '',                   false, 'dito, ohne Plan aber kein Zugang')
      ) as t(plan, sub_id, status, erwartet, warum)
  loop
    update public.user_profiles
       set plan = v_fall.plan,
           stripe_subscription_id = v_fall.sub_id,
           stripe_subscription_status = v_fall.status,
           trial_ends_at = null
     where id = v_id;

    assert public.has_paid_access(v_id) = v_fall.erwartet,
      format('plan=%s sub=%s status=%s → erwartet %s (%s)',
             v_fall.plan, coalesce(v_fall.sub_id, 'NULL'),
             coalesce(v_fall.status, 'NULL'), v_fall.erwartet, v_fall.warum);

    /* Operative Mails folgen derselben Regel (§26). */
    assert public.wants_operational_mail(v_id) = v_fall.erwartet,
      format('wants_operational_mail weicht ab bei plan=%s', v_fall.plan);
  end loop;
end $$;

/* ── Der Zustand jedes neuen Kontos (H2.1, §8) ──
   handle_new_user setzt trial_started_at und trial_ends_at = now() +
   30 Tage fuer JEDE Registrierung, aber keinen plan — die
   Spaltenvorgabe 'free' gilt. Gemessen: Die Trial-Spalten allein
   geben keinen Zugang. Wer das aendert, aendert damit den Zugang
   jedes free-Kontos. */
do $$
declare v_id uuid := test.benutzer('user_a');
begin
  update public.user_profiles
     set plan = 'free',
         stripe_subscription_id = null, stripe_subscription_status = null,
         trial_started_at = pg_catalog.now(),
         trial_ends_at    = pg_catalog.now() + interval '30 days'
   where id = v_id;

  assert not public.has_paid_access(v_id),
    'Ein frisch registriertes Konto hat trotz trial_ends_at keinen Zugang';

  /* Gegenprobe zur Lesbarkeit: der Zugang haengt am Plan, nicht am
     Datum. */
  update public.user_profiles set plan = 'pro' where id = v_id;
  assert public.has_paid_access(v_id), 'Mit plan = pro schon';
end $$;

/* Ohne Profil: kein Zugang. Wie hasPaidAccess(null). */
do $$
begin
  assert not public.has_paid_access('99999999-9999-9999-9999-999999999999'),
    'Ein unbekannter Nutzer hat keinen Zugang';
  assert not public.has_paid_access(null),
    'NULL hat keinen Zugang';
  assert not public.wants_operational_mail(null),
    'und bekommt keine Mail';
end $$;

/* Die Testphase: der Zweig existiert, auch wenn der Constraint den
   Wert nicht zulaesst. Geprueft wird er deshalb an der Funktion
   selbst, nicht an einer Zeile — sonst muesste der Test den
   Constraint umgehen und damit einen Zustand herstellen, den
   Produktion nicht kennt. */
do $$
begin
  assert pg_catalog.pg_get_functiondef(
           (select oid from pg_catalog.pg_proc
             where proname = 'has_paid_access' limit 1)) like '%trial_ends_at%',
    'Der trial-Zweig ist noch da (toter Code, bewusst gespiegelt)';

  assert not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'user_profiles_plan_check'
       and pg_catalog.pg_get_constraintdef(oid) like '%''trial''%'
  ), 'und der Constraint laesst den Wert weiter nicht zu — Lage unveraendert';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   2 — DIE WIRKUNG: free bekommt keinen kritischen Alarm
   ═══════════════════════════════════════════════════════ */
begin;

/* Lage: ein Betrieb mit aktivem Google-Konto, eine unbeantwortete
   schlechte Bewertung als Ereignis, Benachrichtigungen an. Genau
   die Lage, in der plan_communications 'immediate_alert' mit
   send = true beantwortet. */
create or replace function pg_temp.lage(p_plan text)
returns void
language plpgsql
as $$
declare
  v_user uuid;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  perform test.standort('standort_si', 'user_a', 'konto_a', null, true);

  update public.user_profiles
     set plan = p_plan,
         stripe_subscription_id = null,
         stripe_subscription_status = null
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
  v_user uuid := test.id('user_a');
  v_erg  jsonb;
begin
  perform pg_temp.lage('free');

  /* Vorbedingung: Die Planung WILL senden. Ohne diese Zusage prueft
     der Test unten nur, dass nichts anlag. */
  assert exists (
    select 1 from jsonb_array_elements(public.plan_communications(v_user) -> 'decisions') d
     where d ->> 'channel' = 'immediate_alert' and (d ->> 'send')::boolean
  ), 'Vorbedingung: plan_communications will einen Alarm senden';

  v_erg := public.schedule_communications('immediate_alert');

  assert (v_erg ->> 'alerts')::integer = 0,
    format('Kein Alarm fuer free (erhalten: %s)', v_erg ->> 'alerts');
  assert (v_erg ->> 'blocked')::integer = 1,
    format('Der Empfaenger wird als gesperrt gezaehlt (erhalten: %s)', v_erg ->> 'blocked');

  assert not exists (
    select 1 from public.email_queue
     where user_id = v_user and template = 'critical_review_alert'
  ), 'Und in der Warteschlange liegt nichts';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   3 — DIE GEGENPROBEN: pro, founding_partner, Stripe
   ═══════════════════════════════════════════════════════

   Eine Sperre, die alles sperrt, ist keine Sperre, sondern ein
   Ausfall. */
begin;

create or replace function pg_temp.lage(p_plan text)
returns void
language plpgsql
as $$
declare
  v_user uuid;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a');
  perform test.standort('standort_si', 'user_a', 'konto_a', null, true);

  update public.user_profiles
     set plan = p_plan,
         stripe_subscription_id = null,
         stripe_subscription_status = null
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
  v_plan text;
begin
  foreach v_plan in array array['pro', 'founding_partner']
  loop
    perform pg_temp.lage(v_plan);
    v_user := test.id('user_a');

    v_erg := public.schedule_communications('immediate_alert');

    assert (v_erg ->> 'alerts')::integer = 1,
      format('%s bekommt den Alarm (erhalten: %s)', v_plan, v_erg ->> 'alerts');
    assert (v_erg ->> 'blocked')::integer = 0,
      format('%s wird nicht gesperrt (erhalten: %s)', v_plan, v_erg ->> 'blocked');

    assert exists (
      select 1 from public.email_queue
       where user_id = v_user and template = 'critical_review_alert'
    ), format('%s hat eine Zeile in der Warteschlange', v_plan);
  end loop;
end $$;

/* Und der Fall, der ohne nullif falsch waere: Etikett free, Abo
   aktiv. Der zahlt — er bekommt seine Mail. */
do $$
declare
  v_user uuid;
  v_erg  jsonb;
begin
  perform pg_temp.lage('free');
  v_user := test.id('user_a');

  update public.user_profiles
     set stripe_subscription_id = 'sub_1', stripe_subscription_status = 'active'
   where id = v_user;

  v_erg := public.schedule_communications('immediate_alert');

  assert (v_erg ->> 'alerts')::integer = 1,
    'Ein aktives Abo entscheidet, nicht das Planetikett';
  assert (v_erg ->> 'blocked')::integer = 0, 'und wird nicht gesperrt';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   4 — DIE PRUEFUNG SITZT AM EMPFAENGER, NICHT AM KANAL
   ═══════════════════════════════════════════════════════

   Der Grund, warum Abschnitt 2 mit einem Kanal fuer alle drei
   steht: Ein gesperrter Empfaenger erreicht die Kanalschleife nie.
   Haette jemand die Pruefung spaeter in die Kanaele verschoben,
   waere ein neuer Kanal von sich aus offen — und das ist die
   Fehlerklasse, aus der dieses Paket entstand. */
begin;

do $$
declare
  v_def text;
  v_kopf text;
  v_schleife integer;
  v_pruefung integer;
begin
  v_def := pg_catalog.pg_get_functiondef(
    (select oid from pg_catalog.pg_proc where proname = 'schedule_communications' limit 1));

  v_schleife := pg_catalog.strpos(v_def, 'for v_decision in');
  v_pruefung := pg_catalog.strpos(v_def, 'darf_operativ then');

  assert v_pruefung > 0, 'Die Empfaengerpruefung steht in der Funktion';
  assert v_schleife > 0, 'Die Kanalschleife ist noch da';
  assert v_pruefung < v_schleife,
    'Die Pruefung steht VOR der Kanalschleife — sonst waere ein neuer Kanal offen';

  /* Und sie fragt die gemeinsame Funktion, statt den Plan selbst zu
     deuten. Ein `plan = 'pro'` an dieser Stelle waere eine dritte
     Umsetzung derselben Regel. */
  v_kopf := pg_catalog.substr(v_def, 1, v_schleife);
  assert v_kopf like '%wants_operational_mail%',
    'Sie benutzt wants_operational_mail';
  assert v_kopf not like '%plan = ''pro''%' and v_kopf not like '%plan in (%',
    'und deutet den Plan nicht selbst';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   5 — WAS NICHT GESPERRT WIRD
   ═══════════════════════════════════════════════════════

   Produktentscheidung vom 13.10.2026: connection_broken geht weiter
   an alle. Sie zeigt auf /dashboard/google — fuer free erreichbar,
   und eine abgerissene Verbindung stoppt auch die freien Teile.

   Der Test haelt die Entscheidung fest, damit sie nicht beim
   naechsten Durchgang beilaeufig mitgesperrt wird. */
begin;

do $$
declare
  v_user uuid;
  v_erg  jsonb;
begin
  v_user := test.benutzer('user_a');
  perform test.konto('konto_a', 'user_a', 'needs_reauth');

  update public.user_profiles set plan = 'free' where id = v_user;
  update public.google_accounts
     set last_error_at = pg_catalog.now() - interval '1 hour',
         last_error_code = 'invalid_grant'
   where id = test.id('konto_a');

  delete from public.email_queue where user_id = v_user;

  v_erg := public.schedule_lifecycle_emails();

  assert exists (
    select 1 from public.email_queue
     where user_id = v_user and template = 'connection_broken'
  ), 'Ein free-Betrieb erfaehrt, dass seine Verbindung weg ist';
end $$;

rollback;
