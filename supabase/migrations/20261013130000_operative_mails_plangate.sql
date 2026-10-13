-- ═══════════════════════════════════════════════════════════════
-- H1 P0 #4 — Operative Mails nur fuer berechtigte Empfaenger
-- ═══════════════════════════════════════════════════════════════
--
-- BEFUND
--
-- schedule_communications() lief ueber JEDEN Betrieb mit aktivem
-- Google-Konto:
--
--   from public.google_accounts a
--   join auth.users u on u.id = a.user_id
--   where a.status = 'active' and a.deleted_at is null
--
-- Kein Blick auf den Plan. Ein free-Nutzer bekam damit
--
--   critical_review_alert   "Jetzt antworten"
--   weekly_summary          Aufgabenliste
--   inactivity_reminder     dieselbe Aufgabenliste
--
-- und jede dieser Aufforderungen fuehrt auf etwas, das er nicht darf:
-- Antworten veroeffentlichen laeuft in requirePaidAccess,
-- /dashboard/fotos und /dashboard/kunden-gewinnung stehen hinter
-- ProGate. Eine Mail, die zu einer Bezahlschranke fuehrt, ist ein
-- gebrochenes Versprechen (§25/§26).
--
-- ═══════════════════════════════════════════════════════════════
-- DIE REGEL WIRD NICHT NEU ERFUNDEN
-- ═══════════════════════════════════════════════════════════════
--
-- Sie steht in src/utils/subscription.js (hasPaidAccess) und gilt
-- fuer ProGate und fuer requirePaidAccess in beiden Edge Functions.
-- has_paid_access() hier ist deren Uebersetzung nach SQL, Zweig fuer
-- Zweig in derselben Reihenfolge — denn der Mailversand laeuft in
-- pg_cron, also in Postgres, und kann JavaScript nicht aufrufen.
--
-- Eine zweite Umsetzung derselben Regel ist eine Last. Sie wird
-- deshalb an ihrer WIRKUNG gegen dieselbe Fallmatrix geprueft wie die
-- JS-Fassung:
--
--   supabase/tests/operativeMails.test.sql   SQL-Seite
--   src/utils/entitlement.test.js            JS-Seite
--   src/utils/planGateSql.test.js            haelt beide aneinander
--
-- Drei Feinheiten der Uebersetzung, die nicht offensichtlich sind:
--
-- 1 — founding_partner ZUERST. Ein Betrieb, der FRUEHER gezahlt hat,
--     traegt weiter eine stripe_subscription_id. Stuende der
--     Stripe-Zweig vorne, wertete er 'canceled' aus und verweigerte
--     dem Founding Partner den Zugang (§23).
--
-- 2 — JavaScript prueft `profile.stripe_subscription_id ||
--     profile.stripe_subscription_status` auf Wahrheitswert: Ein
--     LEERER String ist dort falsch, in SQL ist er NOT NULL. Deshalb
--     nullif(..., '') — sonst nehmen die zwei Fassungen bei einem
--     leeren Feld verschiedene Zweige.
--
-- 3 — Der trial-Zweig bleibt stehen, obwohl er toter Code ist:
--     user_profiles_plan_check erlaubt den Wert 'trial' nicht
--     (geprueft in Produktion am 13.10.2026). Ihn hier weglassen
--     hiesse, die Fassungen auseinanderlaufen zu lassen, und ihn in
--     JS zu entfernen ist eine eigene Entscheidung — zusammen mit
--     schedule_lifecycle_emails, das auf plan = 'trial' filtert und
--     deshalb nie eine Zeile findet.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION NICHT AENDERT
-- ═══════════════════════════════════════════════════════════════
--
-- plan_communications()      unveraendert. Sie entscheidet, OB ein
--                            Kanal etwas zu sagen hat. Wer etwas
--                            hoeren darf, entscheidet der Empfaenger
--                            — eine Frage, zwei Orte.
--
-- wants_notification()       unveraendert. Das ist die Einstellung
--                            des Nutzers, nicht sein Plan. Beide
--                            muessen zustimmen.
--
-- connection_broken          unveraendert (schedule_lifecycle_emails).
--                            Produktentscheidung: Sie zeigt auf
--                            /dashboard/google, fuer free erreichbar,
--                            und eine abgerissene Verbindung stoppt
--                            auch die freien Teile.
--
-- welcome, password reset, trial_*  unveraendert. Keine operative
--                            Kommunikation.
--
-- Wiederholbar. Laeuft im SQL Editor. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — DIE REGEL, NACH SQL UEBERSETZT
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.has_paid_access(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p record;
begin
  if p_user_id is null then
    return false;
  end if;

  select plan, stripe_subscription_id, stripe_subscription_status, trial_ends_at
    into v_p
    from public.user_profiles
   where id = p_user_id;

  /* Kein Profil: kein Zugang. Wie hasPaidAccess(null). */
  if not found then
    return false;
  end if;

  /* 1 — Founding Partner, vor allem anderen. */
  if v_p.plan = 'founding_partner' then
    return true;
  end if;

  /* 2 — Stripe, wenn es eine Spur davon gibt.
     nullif(..., '') spiegelt die Wahrheitswert-Pruefung in
     JavaScript; siehe Feinheit 2 im Kopf. */
  /* nullif und coalesce sind SQL-Syntax, keine Katalogfunktionen —
     sie brauchen (und vertragen) kein pg_catalog., auch bei leerem
     search_path nicht. */
  if coalesce(nullif(v_p.stripe_subscription_id, ''),
              nullif(v_p.stripe_subscription_status, '')) is not null then
    return coalesce(
      v_p.stripe_subscription_status in ('active', 'trialing', 'past_due'), false);
  end if;

  /* 3 — Altbestand: Testphase. Toter Code, bewusst gespiegelt. */
  if v_p.plan = 'trial' then
    return v_p.trial_ends_at is not null and v_p.trial_ends_at > pg_catalog.now();
  end if;

  /* 4 — Und sonst nur pro. 'free' und 'starter' fallen hier
     heraus — 'starter' ist im Constraint erlaubt, wird von keinem
     Code gesetzt und gilt damit als kein Zugang. Die sichere
     Richtung. */
  return v_p.plan = 'pro';
end;
$$;

revoke all on function public.has_paid_access(uuid) from public, anon;
grant execute on function public.has_paid_access(uuid) to authenticated, service_role;

comment on function public.has_paid_access(uuid) is
  'Darf dieser Nutzer die bezahlten Funktionen benutzen? SQL-Fassung der Regel aus src/utils/subscription.js (hasPaidAccess) — founding_partner zuerst, dann Stripe, dann Altbestand. Fallmatrix in supabase/tests/operativeMails.test.sql.';

/* ═══════════════════════════════════════════════════════════════
   2 — DIESELBE ANTWORT, ANDERE FRAGE
   ═══════════════════════════════════════════════════════════════

   Getrennter Name wie in JavaScript (wantsOperationalMail), und aus
   demselben Grund: "darf er die Funktion benutzen" und "soll er eine
   Mail bekommen" haben heute dieselbe Antwort und koennen morgen
   auseinandergehen — etwa eine Willkommensserie fuer free. Wer das
   aendert, aendert dann genau eine Funktion und sieht an ihrem Namen,
   was er anfasst. */

create or replace function public.wants_operational_mail(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_paid_access(p_user_id);
$$;

revoke all on function public.wants_operational_mail(uuid) from public, anon, authenticated;
grant execute on function public.wants_operational_mail(uuid) to service_role;

comment on function public.wants_operational_mail(uuid) is
  'Bekommt dieser Nutzer operative Kommunikation — Weekly, Critical Alert, Abwesenheitserinnerung? Heute identisch zu has_paid_access, absichtlich mit eigenem Namen.';

/* ═══════════════════════════════════════════════════════════════
   3 — DIE EMPFAENGERPRUEFUNG, AN EINER STELLE
   ═══════════════════════════════════════════════════════════════

   Gebaut auf der Fassung aus 20261007120000_weekly_state_payload.sql.
   Unveraendert uebernommen bis auf drei Stellen: den Zaehler
   v_gesperrt, die Pruefung am Kopf der Empfaengerschleife und
   'blocked' im Rueckgabewert. */

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

/* ── Selbstpruefung ──
   Nur Rechte, Vorhandensein und dass die Pruefung wirklich in
   schedule_communications steht. Keine Datenaenderung — die Wirkung
   prueft supabase/tests/operativeMails.test.sql an angelegten
   Profilen, die danach zurueckgerollt werden. */
do $$
declare
  v_oid oid;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_paid_access';
  if v_oid is null then
    raise exception 'has_paid_access fehlt nach der Migration';
  end if;
  if pg_catalog.has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'anon darf has_paid_access ausfuehren';
  end if;

  select p.oid into v_oid from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wants_operational_mail';
  if v_oid is null then
    raise exception 'wants_operational_mail fehlt nach der Migration';
  end if;
  if pg_catalog.has_function_privilege('anon', v_oid, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'wants_operational_mail ist zu weit freigegeben';
  end if;

  /* Und die Empfaengerpruefung sitzt wirklich in der Schleife. */
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.proname = 'schedule_communications'
       and pg_catalog.pg_get_functiondef(p.oid) like '%wants_operational_mail%'
  ) then
    raise exception 'schedule_communications prueft den Plan nicht';
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG IN PRODUKTION (lesend)
-- ═══════════════════════════════════════════════════════════════
--
-- 1 — Wen sperrt die Pruefung heute?
--
--   select p.plan, count(*) as betriebe,
--          count(*) filter (where public.has_paid_access(a.user_id)) as bekommen_mails
--     from public.google_accounts a
--     left join public.user_profiles p on p.id = a.user_id
--    where a.status = 'active' and a.deleted_at is null
--    group by p.plan order by p.plan;
--
-- 2 — Ein Lauf, ohne etwas zu verschicken? Nicht moeglich:
--     schedule_communications() reiht ein. Stattdessen den
--     Rueckgabewert des naechsten regulaeren Laufs ansehen:
--
--   select payload from public.ops_worker_runs
--    where kind = 'communications' order by started_at desc limit 1;
--
--   Erwartet: 'blocked' > 0, solange es free-Betriebe mit aktivem
--   Google-Konto gibt.
--
-- 3 — Dass nichts Falsches liegen geblieben ist:
--
--   select q.template, p.plan, count(*)
--     from public.email_queue q
--     join public.user_profiles p on p.id = q.user_id
--    where q.template in ('weekly_summary', 'critical_review_alert',
--                         'inactivity_reminder')
--      and q.created_at > now() - interval '7 days'
--    group by q.template, p.plan order by 1, 2;
--
--   Erwartet nach dem Einspielen: keine Zeile mit plan = 'free'.
