-- 20261005220000_location_scoped_critical_review_alerts.sql
--
-- Sofortmeldungen zu kritischen Bewertungen, je Betrieb.
--
-- DER NACHGEWIESENE FEHLER
--
-- plan_communications zaehlte kritische Bewertungen so:
--
--   select count(*), array_agg(id) ... where user_id = p_user_id
--
-- ohne Standort. Bei zwei Betrieben entstand daraus EINE Meldung mit
-- Bewertungen aus beiden, dem Registrierungsnamen als Betriebsname und
-- einem Dedupe-Schluessel ohne Standort:
--
--   critical_alert:<user>:<stunde>
--
-- Drei Folgen:
--
--   1. Der Kunde konnte nicht erkennen, welcher Betrieb betroffen war.
--   2. mark_events_delivered markierte Bewertungen BEIDER Betriebe als
--      gemeldet — auch die, von denen nie jemand erfuhr.
--   3. Trafen zwei Betriebe in derselben Stunde, kollidierte der
--      Schluessel, und die zweite Meldung fiel still aus.
--
-- WAS SICH AENDERT
--
--   Gruppierung nach user_id UND location_id
--   Je betroffenem Betrieb eine eigene Entscheidung und eine eigene Mail
--   Dedupe-Schluessel mit Standort
--   Betriebsname aus google_locations.title des BETROFFENEN Standorts
--   rule_freigegeben statt eigener candidate-Pruefung
--   Bewertungen ohne location_id loesen keine Mail aus
--
-- WAS BLEIBT
--
--   Buendelung: Drei Bewertungen fuer S&I in kurzem Abstand ergeben
--   weiterhin EINE Mail — nur eben fuer S&I, nicht fuer alles.
--
--   Der Lebenszyklus: new und seen. `opened` loest keine neue Meldung
--   aus, weil der Kunde die Empfehlung dann bereits gesehen hat.
--
-- WICHTIG: NICHT der ausgewaehlte Standort
--
-- werkruf_score_location kommt hier bewusst nicht vor. Eine negative
-- Bewertung bei WERKRUF muss als WERKRUF-Mail kommen, auch wenn im
-- Dashboard gerade S&I ausgewaehlt ist. Die Bewertung bestimmt den
-- Standort, nicht die Oberflaeche.
--
-- Gebaut auf der AKTUELLEN Definition aus pg_get_functiondef, nicht
-- auf einem aelteren Export.
--
-- Wiederholbar. Aendert keine Daten.

begin;

CREATE OR REPLACE FUNCTION public.plan_communications(p_user_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_decisions jsonb := '[]'::jsonb;

  v_prefs      public.notification_preferences;
  v_open       integer;
  v_relevant   integer;
  v_last_visit timestamptz;
  v_days_away  numeric;
  v_last_sent  timestamptz;
  v_alert_count integer;
  v_alert_ids  uuid[];
  /* Eine Zeile je betroffenem Standort. */
  v_gruppe     record;
  v_is_monday  boolean := extract(isodow from p_now) = 1;

  /* Der Betrieb, um den die Wochenmail geht. Dieselbe Regel wie beim
     WERKRUF Score, im Dashboard und in top_recommendations_for_email. */
  v_location   uuid;
  v_open_loc   integer;

begin
  select * into v_prefs
    from public.notification_preferences where user_id = p_user_id;

  /* Offene Empfehlungen. 'relevant' meint: mindestens mittlere
     Priorität — der Schwellwert steht in engine_thresholds, damit er
     ohne Deployment änderbar bleibt. */
  select count(*),
         count(*) filter (where priority >= 45)
    into v_open, v_relevant
    from public.events
   where user_id = p_user_id
     and lifecycle in ('new', 'seen', 'opened')
     and coalesce(rule_status, 'active') <> 'candidate';

  /*
   * Dieselbe Zaehlung, aber nur fuer den Betrieb der Wochenmail.
   *
   * v_open oben zaehlt nutzerweit — das ist fuer die
   * Abwesenheits-Erinnerung richtig ("es hat sich etwas
   * angesammelt", ueber alle Betriebe). Fuer die Wochenmail ist es
   * falsch: Sie sagte "2 offene Empfehlungen" und zeigte eine, weil
   * die zweite zu einem anderen Betrieb gehoerte.
   *
   * Gezaehlt wird, was auch in der Mail erscheinen koennte: derselbe
   * Standort, Konto-Ereignisse mit, Kanal E-Mail, kein Probebetrieb,
   * nicht pausiert, nicht abgelaufen.
   */
  v_location := public.werkruf_score_location(p_user_id);

  select count(*)
    into v_open_loc
    from public.events e
   where e.user_id = p_user_id
     and (e.location_id = v_location or e.location_id is null)
     and e.lifecycle in ('new', 'seen', 'opened')
     and e.in_weekly_email
     and public.rule_freigegeben(e.rule_status)
     and (e.cooldown_until is null or e.cooldown_until <= p_now)
     and (e.expires_at is null or e.expires_at > p_now);

  -- ─────────────────────────────────────────────
  -- KANAL 1 — SOFORTMELDUNG
  --
  -- Die Voreinstellung ist: nicht senden. Nur wenn das Warten bis
  -- Montag schadet.
  --
  -- Gebündelt: Kommen drei schlechte Bewertungen an einem Tag, ist
  -- das EINE Meldung. Drei Mails wären der schnellste Weg in den
  -- Spamfilter.
  -- ─────────────────────────────────────────────

  /*
   * JE STANDORT, nicht je Nutzer.
   *
   * Vorher wurden alle kritischen Bewertungen eines Nutzers in eine
   * Meldung gebuendelt. Bei zwei Betrieben bekam der Kunde eine Mail
   * mit dem Registrierungsnamen und Bewertungen aus beiden — und
   * konnte nicht erkennen, welcher Betrieb betroffen war.
   *
   * Eine negative Bewertung gehoert immer zu einem konkreten Betrieb.
   * Deshalb eine Gruppe je Standort, und daraus je eine Meldung.
   *
   * location_id is null wird ausdruecklich NICHT mitgenommen: Eine
   * Bewertung ohne Standort laesst sich keinem Betrieb zuordnen, und
   * sie dem ausgewaehlten zuzuschlagen waere geraten. Solche Events
   * bleiben liegen und sind ueber die Datenbank auffindbar.
   */
  for v_gruppe in
    select e.location_id,
           count(*)       as anzahl,
           array_agg(e.id) as ids
      from public.events e
     where e.user_id = p_user_id
       and e.type in ('review.negative_unanswered', 'reviews.negative_batch')
       and e.lifecycle in ('new', 'seen')
       and public.rule_freigegeben(e.rule_status)
       -- Noch nicht gemeldet. Der Vermerk verhindert, dass dieselbe
       -- Bewertung bei jedem Worker-Lauf erneut alarmiert.
       and not (e.delivered ? 'notification')
       -- Nur Bewertungen mit Standort.
       and e.location_id is not null
     group by e.location_id
  loop
    if not public.wants_notification(p_user_id, 'negative_review') then
      v_decisions := v_decisions || jsonb_build_object(
        'channel', 'immediate_alert', 'send', false,
        'locationId', v_gruppe.location_id,
        'reason', 'Vom Nutzer abgeschaltet');
    else
      v_decisions := v_decisions || jsonb_build_object(
        'channel', 'immediate_alert', 'send', true,
        'template', 'critical_review_alert',
        /* Der Standort gehoert zur Entscheidung. Ohne ihn muesste
           schedule_communications ihn erraten. */
        'locationId', v_gruppe.location_id,
        'reason', format('%s kritische %s ohne Antwort',
                         v_gruppe.anzahl,
                         case when v_gruppe.anzahl = 1 then 'Bewertung' else 'Bewertungen' end),
        'eventIds', to_jsonb(v_gruppe.ids),
        'count', v_gruppe.anzahl);
    end if;
  end loop;

  /* Keine betroffene Gruppe: eine Begruendung fuer die
     Nachvollziehbarkeit. */
  select count(*) into v_alert_count
    from public.events e
   where e.user_id = p_user_id
     and e.type in ('review.negative_unanswered', 'reviews.negative_batch')
     and e.lifecycle in ('new', 'seen')
     and public.rule_freigegeben(e.rule_status)
     and not (e.delivered ? 'notification')
     and e.location_id is not null;

  if coalesce(v_alert_count, 0) = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'immediate_alert', 'send', false,
      'reason', 'Keine ungemeldete kritische Bewertung');
  end if;

  -- ─────────────────────────────────────────────
  -- KANAL 2 — WOCHENMAIL
  --
  -- Der einzige Kanal, der auch dann sendet, wenn nichts war. Er
  -- trägt die Gewohnheit: Wer die Mail montags erwartet, öffnet sie
  -- auch in der Woche, in der etwas drinsteht.
  --
  -- "Alles in Ordnung" wird nicht verschickt — die Mail sagt es
  -- nebenbei, sie ist nicht dafür da.
  -- ─────────────────────────────────────────────

  v_last_sent := public.last_email_sent(p_user_id, 'weekly_summary');

  if not v_is_monday then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Nur montags');

  elsif not public.wants_notification(p_user_id, 'weekly_summary') then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Vom Nutzer abgeschaltet');

  elsif v_last_sent is not null and v_last_sent > p_now - interval '6 days' then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', false,
      'reason', 'Diese Woche bereits verschickt',
      'lastSentAt', v_last_sent);

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'weekly_email', 'send', true,
      'template', 'weekly_summary',
      'reason', 'Wöchentlicher Rhythmus',
      /* Standortbezogen — passend zu den Aufgaben, die die Mail
         tatsaechlich zeigt. */
      'openRecommendations', coalesce(v_open_loc, 0),
      'locationId', v_location);
  end if;

  -- ─────────────────────────────────────────────
  -- KANAL 3 — ABWESENHEITS-ERINNERUNG
  --
  -- Nicht "du warst lange nicht da", sondern "es hat sich etwas
  -- angesammelt". Der Unterschied liegt nicht im Ton, sondern in der
  -- Bedingung: Ohne offene Aufgaben wird nichts verschickt, egal wie
  -- lange jemand weg war.
  --
  -- Drei Bedingungen, alle nötig:
  --   1. lange nicht im Dashboard
  --   2. es gibt offene Empfehlungen
  --   3. mindestens eine davon zählt wirklich
  --
  -- Die dritte verhindert den peinlichsten Fall: jemandem nach zehn
  -- Tagen wegen zweier fehlender Fotos zu schreiben.
  -- ─────────────────────────────────────────────

  v_last_visit := v_prefs.last_dashboard_visit_at;
  v_last_sent  := public.last_email_sent(p_user_id, 'inactivity_reminder');
  v_days_away  := case when v_last_visit is null then null
                       else extract(epoch from (p_now - v_last_visit)) / 86400 end;

  if v_last_visit is null then
    /* Noch nie im Dashboard gewesen. Das ist ein Onboarding-Fall,
       kein Abwesenheitsfall — die Willkommensmail deckt ihn ab. */
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Noch kein Dashboard-Besuch — Onboarding, nicht Abwesenheit');

  elsif v_days_away < coalesce(v_prefs.inactivity_days, 10) then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', format('Zuletzt vor %s Tagen im Dashboard', round(v_days_away)),
      'daysAway', round(v_days_away, 1));

  elsif v_open = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Nichts offen — Abwesenheit allein ist kein Anlass',
      'daysAway', round(v_days_away, 1));

  elsif v_relevant = 0 then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', format('%s offene Empfehlungen, aber keine von Belang', v_open),
      'daysAway', round(v_days_away, 1), 'open', v_open);

  elsif v_last_sent is not null and v_last_sent > p_now - interval '14 days' then
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', false,
      'reason', 'Vor weniger als 14 Tagen bereits erinnert',
      'lastSentAt', v_last_sent);

  else
    v_decisions := v_decisions || jsonb_build_object(
      'channel', 'inactivity_reminder', 'send', true,
      'template', 'inactivity_reminder',
      'reason', format('%s Tage abwesend, %s offene Empfehlungen, davon %s von Belang',
                       round(v_days_away), v_open, v_relevant),
      'daysAway', round(v_days_away, 1),
      'open', v_open, 'relevant', v_relevant);
  end if;

  return jsonb_build_object(
    'userId', p_user_id,
    'evaluatedAt', p_now,
    'decisions', v_decisions
  );
end;
$function$;

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
  v_health   jsonb;
  v_ids      uuid[];
  v_loc_title text;
begin
  for v_row in
    select distinct a.user_id, u.email, p.company_name, p.full_name, p.industry_key
      from public.google_accounts a
      join auth.users u on u.id = a.user_id
      left join public.user_profiles p on p.id = a.user_id
     where a.status = 'active' and a.deleted_at is null and u.email is not null
  loop
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
                 'openCount',    (v_decision ->> 'openRecommendations')::integer)
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
    'inactivity', v_inactive, 'scheduledAt', now()
  );
end;
$function$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Welche Meldungen stuenden an?
--   select e ->> 'channel', e ->> 'locationId', e ->> 'count', e ->> 'reason'
--   from jsonb_array_elements(
--     public.plan_communications('<user-id>') -> 'decisions') e
--   where e ->> 'channel' = 'immediate_alert';
--   → eine Zeile je betroffenem Betrieb.
--
-- Bewertungen ohne Standort — die loesen keine Mail aus:
--   select id, type, created_at from public.events
--    where type in ('review.negative_unanswered', 'reviews.negative_batch')
--      and location_id is null
--      and lifecycle in ('new', 'seen');
--   → sollte leer sein; wenn nicht, ist beim Anlegen etwas schiefgegangen.
--
-- Nach einem Lauf:
--   select payload ->> 'companyName' as betrieb,
--          payload ->> 'count'       as anzahl,
--          jsonb_array_length(payload -> 'eventIds') as events,
--          dedupe_key
--   from public.email_queue
--   where template = 'critical_review_alert'
--   order by created_at desc limit 5;
--   → je Betrieb eine Zeile, Schluessel mit Standort.
