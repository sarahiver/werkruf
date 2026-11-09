-- WP7 — Free-Downgrade und Pro-Wiedereinstieg
--
-- Was diese Migration tut:
--
--   1. access_tier(uuid): die kanonische Stufe (free | pro |
--      founding_partner) in SQL — dieselbe Regel wie has_paid_access(),
--      als Name statt Boolean. Fuer Support-Ansicht und Tests; der
--      Zugang selbst wird weiter ueber has_paid_access() entschieden.
--
--   2. Vorlage critical_review_free im Template-Constraint.
--
--   3. schedule_communications(): die EINE Ausnahme fuer Free — eine
--      neue kritische Bewertung alarmiert auch ohne Pro. Dieselbe
--      Engine-Entscheidung, derselbe Dedupe-Vermerk, andere Vorlage.
--      Wochenmail und Abwesenheitserinnerung bleiben Pro/FP.
--
-- Was sie NICHT tut: kein Feld plan = 'free' erfinden (der Webhook
-- setzt es bereits bei subscription.deleted), keine Loeschung, keine
-- Stripe-Aenderung, kein neuer Sync-Pfad (die Scheduler filtern nach
-- account.status, nicht nach Plan — Free wird weiter synchronisiert).

/* ═══════════════════════════════════════════════════════════════
   1 — access_tier()
   ═══════════════════════════════════════════════════════════════ */
create or replace function public.access_tier(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_plan text;
begin
  select plan into v_plan from public.user_profiles where id = p_user_id;
  if v_plan is null then return 'free'; end if;
  /* founding_partner VOR allem anderen — wie has_paid_access(). */
  if v_plan = 'founding_partner' then return 'founding_partner'; end if;
  if public.has_paid_access(p_user_id) then return 'pro'; end if;
  return 'free';
end;
$$;

comment on function public.access_tier(uuid) is
  'Produktstufe free | pro | founding_partner (WP7). Abgeleitet aus has_paid_access(); founding_partner zuerst. SQL-Fassung von accessTier() in src/utils/subscription.js.';

/* Nur service_role: Die Oberflaeche rechnet die Stufe selbst (accessTier
   in subscription.js, aus dem eigenen Profil); der Admin bekommt sie
   ueber admin-ops. Eine stabile SECURITY-DEFINER-Funktion fuer
   authenticated freizugeben widerspraeche der Selbstpruefung aus
   20261014130000 (deny by default, H2.2). */
revoke all on function public.access_tier(uuid) from public, anon, authenticated;
grant execute on function public.access_tier(uuid) to service_role;

/* ═══════════════════════════════════════════════════════════════
   2 — Vorlage critical_review_free
   ═══════════════════════════════════════════════════════════════
   Vollstaendige Liste aus 20261022160000 plus die neue. */
alter table public.email_queue
  drop constraint if exists email_queue_template_check;
alter table public.email_queue
  add constraint email_queue_template_check check (template = any (array[
    'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
    'weekly_report', 'weekly_summary', 'visibility_report',
    'critical_review_alert', 'inactivity_reminder', 'payment_failed',
    'support_reply', 'consent_reminder', 'account_deleted',
    'critical_review_free'
  ]));

/* ═══════════════════════════════════════════════════════════════
   3 — schedule_communications mit Free-Zweig
   ═══════════════════════════════════════════════════════════════
   Kopie der WP6-Fassung (20261109140000) mit genau einer Ergaenzung
   im gesperrt-Zweig. */
create or replace function public.schedule_communications(p_channel text default 'all')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  /* WP7: Free-Alarme (kritische Bewertung als Wiedereinstieg). */
  v_free_alerts integer := 0;
  v_free_plan   jsonb;
  v_free_dec    jsonb;
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

      /*
       * WP7 — die EINE Ausnahme fuer Free: eine neue kritische
       * Bewertung darf alarmieren. Nicht die Wochenmail, nicht die
       * Abwesenheitserinnerung — nur das.
       *
       * Dieselbe Wahrheit wie fuer Pro: plan_communications() liefert
       * die immediate_alert-Entscheidung aus den Engine-Events
       * (review.negative_unanswered / reviews.negative_batch), und
       * derselbe Vermerk delivered.notification verhindert, dass
       * dieselbe Bewertung beim naechsten Lauf erneut alarmiert. Kein
       * zweites „rating <= 2" hier, kein zweiter Dedupe.
       *
       * Andere Vorlage (critical_review_free): die Mail fuehrt nicht
       * in den Antwort-Editor, sondern sagt, was ist, und wie Pro
       * hilft. Der Link bleibt Navigation — ProGate entscheidet.
       */
      if p_channel in ('all', 'immediate_alert') then
        v_free_plan := public.plan_communications(v_row.user_id);
        for v_free_dec in select * from jsonb_array_elements(v_free_plan -> 'decisions')
        loop
          continue when v_free_dec ->> 'channel' <> 'immediate_alert';
          continue when not (v_free_dec ->> 'send')::boolean;
          if public.enqueue_email(
               'critical_review_free', v_row.email,
               'critical_free:' || v_row.user_id || ':' ||
                 coalesce(v_free_dec ->> 'locationId', 'kein') || ':' ||
                 to_char(now(), 'YYYY-MM-DD-HH24'),
               v_row.user_id, coalesce(v_row.full_name, v_row.company_name),
               jsonb_build_object(
                 'companyName',   coalesce(
                                    nullif(trim((select l.title from public.google_locations l
                                                  where l.id = (v_free_dec ->> 'locationId')::uuid)), ''),
                                    v_row.company_name, 'dein Betrieb'),
                 'locationTitle', (select l.title from public.google_locations l
                                    where l.id = (v_free_dec ->> 'locationId')::uuid),
                 'accountName',   v_row.company_name,
                 'locationId',    v_free_dec ->> 'locationId',
                 'industryKey',   coalesce(v_row.industry_key, 'handwerk'),
                 'count',         (v_free_dec ->> 'count')::integer,
                 'reason',        v_free_dec ->> 'reason',
                 'accessTier',    'free')
             ) is not null then
            v_free_alerts := v_free_alerts + 1;
            select array_agg(value::text::uuid)
              into v_ids
              from jsonb_array_elements_text(v_free_dec -> 'eventIds');
            perform public.mark_events_delivered(v_ids, 'notification');
          end if;
        end loop;
      end if;

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
    /* WP7 */
    'freeAlerts', v_free_alerts,
    /* Wie viele Empfaenger der Plan ausgeschlossen hat. */
    'blocked', v_gesperrt,
    'scheduledAt', now()
  );
end;
$function$;

revoke all on function public.schedule_communications(text) from public, anon, authenticated;
grant execute on function public.schedule_communications(text) to service_role;

/* ═══════════════════════════════════════════════════════════════
   SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════════ */
do $$
declare v_def text;
begin
  v_def := pg_catalog.pg_get_functiondef('public.schedule_communications(text)'::regprocedure);
  if position('critical_review_free' in v_def) = 0 then
    raise exception '[wp7] schedule_communications kennt critical_review_free nicht';
  end if;
  /* Der Free-Zweig (zwischen 'if not v_row.darf_operativ then' und
     dem ersten 'continue;' danach) darf nur die Sofortmeldung kennen —
     keine Wochenmail, keine Abwesenheitserinnerung. */
  declare
    v_von  integer := position('if not v_row.darf_operativ then' in v_def);
    v_rest text;
    v_zweig text;
  begin
    v_rest  := substring(v_def from v_von);
    v_zweig := substring(v_rest from 1 for position(E'\n      continue;' in v_rest));
    if position('weekly_summary' in v_zweig) > 0 or position('inactivity_reminder' in v_zweig) > 0 then
      raise exception '[wp7] Free-Zweig enthaelt weekly_summary oder inactivity_reminder';
    end if;
    if position('critical_review_free' in v_zweig) = 0 then
      raise exception '[wp7] Free-Zweig ohne critical_review_free';
    end if;
  end;
  if pg_catalog.has_function_privilege('anon', 'public.access_tier(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.access_tier(uuid)', 'EXECUTE') then
    raise exception '[wp7] Client-Rollen duerfen access_tier ausfuehren';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.schedule_communications(text)', 'EXECUTE') then
    raise exception '[wp7] authenticated darf schedule_communications ausfuehren';
  end if;
  perform 1 from pg_constraint where conname = 'email_queue_template_check'
     and pg_get_constraintdef(oid) like '%critical_review_free%';
  if not found then raise exception '[wp7] Template-Constraint ohne critical_review_free'; end if;
  raise notice '[wp7] in Ordnung';
end $$;
