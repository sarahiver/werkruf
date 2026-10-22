-- Abnahme fuer die Erinnerung an die ausstehende Zustimmung (22.10.2026)
--
--   scripts/test-db/run.sh zustimmungErinnerung
--
-- ═══════════════════════════════════════════════════════════════
-- WAS GEMESSEN WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- schedule_consent_reminders() reiht Mails ein. Hier wird gezaehlt,
-- WER eine bekommt — und vor allem, wer NICHT:
--
--   • zugestimmt                      → keine
--   • Adresse nicht bestaetigt        → keine
--   • juenger als 3 Tage              → keine (noch)
--   • aelter als 14 Tage (Altbestand) → keine (nie)
--   • schon erinnert                  → keine zweite, auch nach Tagen
--   • im Fenster, bestaetigt, ohne Zustimmung → genau eine

begin;

insert into test.bezeichner (name, id) values
  ('faellig',      '88888888-8888-8888-8888-888888888801'),
  ('zugestimmt',   '88888888-8888-8888-8888-888888888802'),
  ('unbestaetigt', '88888888-8888-8888-8888-888888888803'),
  ('frisch',       '88888888-8888-8888-8888-888888888804'),
  ('altbestand',   '88888888-8888-8888-8888-888888888805')
on conflict (name) do update set id = excluded.id;

select test.benutzer('faellig',      'faellig@werkruf.test',      'Fälliger Betrieb');
select test.benutzer('zugestimmt',   'zugestimmt@werkruf.test',   'Hat zugestimmt');
select test.benutzer('unbestaetigt', 'unbestaetigt@werkruf.test', 'Nie bestätigt');
select test.benutzer('frisch',       'frisch@werkruf.test',       'Gestern registriert');
select test.benutzer('altbestand',   'altbestand@werkruf.test',   'Kunde seit Monaten');

do $$
declare
  c_jetzt   constant timestamptz := '2026-10-22 09:41:00+00';
  v_anzahl  integer;
  v_mail    public.email_queue;
begin
  /* Ausgangslage */
  update auth.users set email_confirmed_at = c_jetzt - interval '4 days'
   where id in (test.id('faellig'), test.id('zugestimmt'), test.id('frisch'), test.id('altbestand'));
  -- 'unbestaetigt' bleibt null

  update public.user_profiles set created_at = c_jetzt - interval '4 days',  accepted_terms_at = null  where id = test.id('faellig');
  update public.user_profiles set created_at = c_jetzt - interval '4 days',  accepted_terms_at = c_jetzt - interval '3 days' where id = test.id('zugestimmt');
  update public.user_profiles set created_at = c_jetzt - interval '4 days',  accepted_terms_at = null  where id = test.id('unbestaetigt');
  update public.user_profiles set created_at = c_jetzt - interval '1 day',   accepted_terms_at = null  where id = test.id('frisch');
  update public.user_profiles set created_at = c_jetzt - interval '40 days', accepted_terms_at = null  where id = test.id('altbestand');

  /* ─────────────────────────────────────────────────────────────
     A — Erster Lauf: genau eine Mail, an den Faelligen
     ───────────────────────────────────────────────────────────── */
  v_anzahl := public.schedule_consent_reminders(c_jetzt);
  if v_anzahl <> 1 then
    raise exception 'A: % Mails eingereiht statt genau einer', v_anzahl;
  end if;

  select * into v_mail from public.email_queue where template = 'consent_reminder';
  if v_mail.to_email <> 'faellig@werkruf.test' or v_mail.user_id <> test.id('faellig') then
    raise exception 'A: Mail an % (%) statt an den Faelligen', v_mail.to_email, v_mail.user_id;
  end if;
  if v_mail.payload ->> 'companyName' <> 'Fälliger Betrieb' then
    raise exception 'A: Payload ohne Firmenname: %', v_mail.payload;
  end if;
  raise notice 'A: genau eine Mail, an den Faelligen';

  /* ─────────────────────────────────────────────────────────────
     B — GEGENPROBEN: die vier anderen bekommen nichts
     ───────────────────────────────────────────────────────────── */
  if exists (select 1 from public.email_queue where template = 'consent_reminder'
              and user_id = test.id('zugestimmt')) then
    raise exception 'B: Erinnerung trotz Zustimmung';
  end if;
  if exists (select 1 from public.email_queue where template = 'consent_reminder'
              and user_id = test.id('unbestaetigt')) then
    raise exception 'B: Erinnerung an unbestaetigte Adresse';
  end if;
  if exists (select 1 from public.email_queue where template = 'consent_reminder'
              and user_id = test.id('frisch')) then
    raise exception 'B: Erinnerung schon nach einem Tag';
  end if;
  if exists (select 1 from public.email_queue where template = 'consent_reminder'
              and user_id = test.id('altbestand')) then
    raise exception 'B: Altbestand angeschrieben — der nutzt das Produkt laengst';
  end if;
  raise notice 'B: zugestimmt, unbestaetigt, frisch, Altbestand — alle ohne Mail';

  /* ─────────────────────────────────────────────────────────────
     C — Zweiter Lauf am naechsten Tag: nichts Neues
     ───────────────────────────────────────────────────────────── */
  v_anzahl := public.schedule_consent_reminders(c_jetzt + interval '1 day');
  if v_anzahl <> 0 then
    raise exception 'C: zweiter Lauf hat % Mails eingereiht', v_anzahl;
  end if;
  if (select count(*) from public.email_queue where template = 'consent_reminder') <> 1 then
    raise exception 'C: mehr als eine Erinnerung in der Queue';
  end if;
  raise notice 'C: keine zweite Erinnerung';

  /* ─────────────────────────────────────────────────────────────
     D — Der Frische wird faellig: Lauf drei Tage spaeter
     ───────────────────────────────────────────────────────────── */
  v_anzahl := public.schedule_consent_reminders(c_jetzt + interval '3 days');
  if v_anzahl <> 1 then
    raise exception 'D: % Mails statt einer fuer den inzwischen Faelligen', v_anzahl;
  end if;
  if not exists (select 1 from public.email_queue where template = 'consent_reminder'
                  and user_id = test.id('frisch')) then
    raise exception 'D: der inzwischen Faellige fehlt';
  end if;
  raise notice 'D: nachgewachsener Kandidat bekommt seine eine Mail';

  /* ─────────────────────────────────────────────────────────────
     E — Wer inzwischen zugestimmt hat, faellt heraus
     ───────────────────────────────────────────────────────────── */
  update public.user_profiles set accepted_terms_at = c_jetzt where id = test.id('unbestaetigt');
  update auth.users set email_confirmed_at = c_jetzt where id = test.id('unbestaetigt');
  v_anzahl := public.schedule_consent_reminders(c_jetzt + interval '5 days');
  if v_anzahl <> 0 then
    raise exception 'E: % Mails fuer jemanden, der bestaetigt UND zugestimmt hat', v_anzahl;
  end if;
  raise notice 'E: Zustimmung nach Bestaetigung — keine Mail';

  /* ─────────────────────────────────────────────────────────────
     F — Leeres Fenster wird abgewiesen
     ───────────────────────────────────────────────────────────── */
  begin
    perform public.schedule_consent_reminders(c_jetzt, interval '14 days', interval '3 days');
    raise exception 'F: leeres Fenster angenommen';
  exception when check_violation then null;
  end;
  raise notice 'F: leeres Fenster abgewiesen';
end $$;

/* ═══════════════════════════════════════════════════════════════
   G — Rechte und Cron, als Wirkung gemessen
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if has_function_privilege('authenticated',
       'public.schedule_consent_reminders(timestamptz, interval, interval)', 'execute')
     or has_function_privilege('anon',
       'public.schedule_consent_reminders(timestamptz, interval, interval)', 'execute') then
    raise exception 'G: schedule_consent_reminders fuer Browser-Rollen offen';
  end if;
  if not exists (select 1 from cron.job where jobname = 'consent-reminder'
                  and command like '%schedule_consent_reminders%') then
    raise exception 'G: Cron-Job consent-reminder fehlt oder ruft etwas anderes';
  end if;
  raise notice 'G: Rechte zu, Cron da';
end $$;

rollback;
