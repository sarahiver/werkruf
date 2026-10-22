-- 20261022140000_zustimmung_erinnerung.sql
--
-- Erinnerung an die ausstehende Zustimmung (AGB / Datenschutz)
--
-- ═══════════════════════════════════════════════════════════════
-- WOZU
-- ═══════════════════════════════════════════════════════════════
--
-- 22.10.2026, im Admin: ein Konto mit "Zustimmung: fehlt". Der Nutzer
-- hatte sich registriert, die Mail bestaetigt — und das Onboarding
-- nicht abgeschlossen. Ab heute haelt ihn das ZustimmungsTor vor dem
-- Dashboard an; aber wer nicht wiederkommt, sieht auch das Tor nicht.
--
-- Deshalb EINE Mail, drei Tage nach der Registrierung: "Du hast dich
-- registriert, ein Klick fehlt noch." Danach nichts mehr. Wer nach
-- einer Erinnerung nicht zustimmt, will nicht.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM OHNE PLAN-TOR UND OHNE wants_notification()
-- ═══════════════════════════════════════════════════════════════
--
-- Das Plan-Tor (20261013130000) gilt fuer operative Mails ueber das
-- Produkt — Wochenmail, Sofortmeldung. Diese Mail ist keine davon: Sie
-- gehoert zur Registrierung, die der Nutzer selbst ausgeloest hat, und
-- bezieht sich auf nichts anderes. Kein Marketing, keine Produktdaten.
-- Sie steht damit neben welcome und trial_*, nicht neben weekly_*.
--
-- ═══════════════════════════════════════════════════════════════
-- WER SIE BEKOMMT — UND WER NICHT
-- ═══════════════════════════════════════════════════════════════
--
--   bekommt:  accepted_terms_at fehlt
--             UND E-Mail-Adresse bestaetigt (sonst kann er sich gar
--                 nicht anmelden — erst bestaetigen, dann zustimmen;
--                 die Bestaetigungsmail ist ein anderes Thema)
--             UND Registrierung 3 bis 14 Tage her
--             UND noch nie erinnert (dedupe_key je Nutzer, fuer immer)
--
--   NICHT:    Altbestand. Konten, die aelter als 14 Tage sind, haben
--             entweder laengst zugestimmt oder sind Bestandskunden aus
--             der Zeit vor der Zustimmungspflicht. Denen zu schreiben
--             "du hast die Einrichtung nicht abgeschlossen" waere
--             falsch — sie nutzen das Produkt. Das Tor holt ihre
--             Zustimmung beim naechsten Aufruf ein; eine Mail dazu
--             brauchen sie nicht.
--
-- Die Grenzen (3 und 14 Tage) sind Parameter der Funktion, damit der
-- Test sie nicht umgehen muss und ein spaeterer Wechsel keine neue
-- Funktion braucht.
--
-- ═══════════════════════════════════════════════════════════════
-- WIE SIE LAEUFT
-- ═══════════════════════════════════════════════════════════════
--
-- Reines SQL im Cron (wie gbp-maintenance, history-prune): kein HTTP,
-- keine Edge Function, kein Secret. Taeglich 09:41 UTC. Das Einreihen
-- geht ueber enqueue_email(); verschickt wird wie alles andere vom
-- mail-worker. EMAIL_DELIVERY_MODE gilt also auch hier.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Mailvorlage zulassen
   ═══════════════════════════════════════════════════════════════
   Vollstaendige Liste aus 20261022120000 plus 'consent_reminder'. */
alter table public.email_queue
  drop constraint if exists email_queue_template_check;
alter table public.email_queue
  add constraint email_queue_template_check check (template = any (array[
    'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
    'weekly_report', 'weekly_summary', 'visibility_report',
    'critical_review_alert', 'inactivity_reminder', 'payment_failed',
    'support_reply', 'consent_reminder'
  ]));

/* ═══════════════════════════════════════════════════════════════
   2 — Die Funktion
   ═══════════════════════════════════════════════════════════════ */
create or replace function public.schedule_consent_reminders(
  p_now         timestamptz default now(),
  p_fruehestens interval    default interval '3 days',
  p_spaetestens interval    default interval '14 days'
) returns integer
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  v_kandidat record;
  v_mail_id  uuid;
  v_anzahl   integer := 0;
begin
  if p_fruehestens >= p_spaetestens then
    raise exception 'Fenster leer: fruehestens (%) muss vor spaetestens (%) liegen',
      p_fruehestens, p_spaetestens using errcode = 'check_violation';
  end if;

  for v_kandidat in
    select p.id, u.email, p.company_name, p.full_name,
           coalesce(p.industry_key, 'handwerk') as industry_key, p.created_at
      from public.user_profiles p
      join auth.users u on u.id = p.id
     where p.accepted_terms_at is null
       and u.email is not null
       and u.email_confirmed_at is not null
       and p.created_at <= p_now - p_fruehestens
       and p.created_at >  p_now - p_spaetestens
     order by p.created_at
  loop
    v_mail_id := public.enqueue_email(
      'consent_reminder',
      v_kandidat.email,
      /* Kein Zeitstempel im Schluessel — mit Absicht. Genau eine
         Erinnerung je Konto, fuer immer. */
      'consent_reminder:' || v_kandidat.id,
      v_kandidat.id,
      coalesce(v_kandidat.full_name, v_kandidat.company_name),
      jsonb_build_object(
        'companyName',    v_kandidat.company_name,
        'industryKey',    v_kandidat.industry_key,
        'registriertAm',  v_kandidat.created_at
      )
    );
    if v_mail_id is not null then
      v_anzahl := v_anzahl + 1;
    end if;
  end loop;

  return v_anzahl;
end;
$$;

comment on function public.schedule_consent_reminders(timestamptz, interval, interval) is
  'Reiht einmalig je Konto die Mail consent_reminder ein: Adresse '
  'bestaetigt, accepted_terms_at fehlt, Registrierung 3–14 Tage her. '
  'Taeglich per Cron (consent-reminder). Liefert die Zahl neu '
  'eingereihter Mails.';

revoke execute on function public.schedule_consent_reminders(timestamptz, interval, interval) from public;
revoke execute on function public.schedule_consent_reminders(timestamptz, interval, interval) from anon;
revoke execute on function public.schedule_consent_reminders(timestamptz, interval, interval) from authenticated;
grant  execute on function public.schedule_consent_reminders(timestamptz, interval, interval) to service_role;

/* ═══════════════════════════════════════════════════════════════
   3 — Cron
   ═══════════════════════════════════════════════════════════════
   09:41 UTC — 11:41 Berlin im Sommer, 10:41 im Winter. Vormittags,
   nicht nachts: Eine Mail um drei Uhr frueh wirkt wie ein Automat.
   Die krumme Minute, damit nicht alles zur vollen Stunde laeuft. */
do $$
begin
  if exists (select 1 from cron.job where jobname = 'consent-reminder') then
    perform cron.unschedule('consent-reminder');
  end if;
  perform cron.schedule('consent-reminder', '41 9 * * *',
    ' select public.schedule_consent_reminders(); ');
  raise notice '[cron] consent-reminder — 41 9 * * * — schedule_consent_reminders()';
end $$;

/* ═══════════════════════════════════════════════════════════════
   4 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'email_queue_template_check'
                    and pg_get_constraintdef(oid) like '%consent_reminder%'
                    and pg_get_constraintdef(oid) like '%support_reply%') then
    raise exception '[zustimmung] email_queue laesst consent_reminder nicht zu — oder support_reply ging verloren';
  end if;
  if has_function_privilege('authenticated',
       'public.schedule_consent_reminders(timestamptz, interval, interval)', 'execute') then
    raise exception '[zustimmung] schedule_consent_reminders steht fuer authenticated offen';
  end if;
  if not exists (select 1 from cron.job where jobname = 'consent-reminder') then
    raise exception '[zustimmung] Cron-Job consent-reminder fehlt';
  end if;
  raise notice '[zustimmung] in Ordnung — Vorlage, Funktion, Cron';
  raise notice '[zustimmung] WIRKUNGSLOS fuer die Mail, bis send-email die Vorlage consent_reminder kennt';
end $$;

commit;
