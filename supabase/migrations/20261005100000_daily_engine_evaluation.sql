-- 20261005100000_daily_engine_evaluation.sql
--
-- Täglicher Engine-Lauf, unabhängig vom Google-Abgleich.
--
-- WARUM
--
-- Die Decision Engine lief bisher nur als Nebenwirkung eines
-- Abgleichs. Solange Google nichts Neues liefert, lief sie nicht —
-- bei S&I zwischen dem 30.09. 05:58 und dem 01.10. 09:05 gar nicht.
--
-- Für datenabhängige Regeln reicht das. Für zeitabhängige nicht:
--
--   review.drought    "lange keine Bewertung" wird durch ABLAUF
--                     VON ZEIT wahr, nicht durch neue Daten
--   health.declined   braucht den Vergleich zur Vorwoche
--   Cooldowns         laufen ab, ohne dass jemand etwas tut
--   expires_at        dasselbe
--
-- Eine Regel, deren Wahrheit sich durch Zeit ändert, feuert ohne
-- regelmäßigen Lauf nie.
--
-- WAS DER LAUF NICHT TUT
--
-- Kein Google-Abgleich. Keine API-Aufrufe. Keine Mail. Er bewertet
-- ausschliesslich den vorhandenen Datenstand neu.
--
--   Der Abgleich aktualisiert die Daten.
--   Dieser Lauf bewertet ihre Bedeutung.
--
-- ZEITPUNKT
--
-- 04:30 UTC. Die Reihenfolge am Montag ist damit:
--
--   00:00  gbp-schedule     plant Abgleiche (stuendlich)
--   */5    gbp-worker       fuehrt sie aus
--   04:30  engine-daily     bewertet neu          ← dieser Job
--   07:00  comm-weekly      stellt die Wochenmail ein
--   */10   mail-worker      versendet
--
-- Die Montagsmail liest damit frisch bewertete Events — nicht den
-- Stand vom letzten Abgleich, der Tage zurueckliegen kann.
--
-- WIEDERHOLBAR
--
-- cron.unschedule vor cron.schedule: Ein zweites Einspielen legt
-- keinen zweiten Job an. Ohne das stuende die Engine-Bewertung nach
-- jedem Einspielen einmal mehr auf dem Plan.

begin;

do $$
begin
  /* Vorhandenen Job entfernen, falls die Migration erneut laeuft. */
  if exists (select 1 from cron.job where jobname = 'engine-daily') then
    perform cron.unschedule('engine-daily');
  end if;

  perform cron.schedule(
    'engine-daily',
    '30 4 * * *',
    $job$
      select net.http_post(
        url     := 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/google-business/events/evaluate-all',
        headers := jsonb_build_object(
                     'Content-Type',    'application/json',
                     /* Derselbe Schutz wie bei den uebrigen Worker-Jobs.
                        evaluate-all ist keine oeffentliche Route; das
                        Secret steht im Vault, nicht im Befehlstext. */
                     'X-Worker-Secret', (select decrypted_secret
                                           from vault.decrypted_secrets
                                          where name = 'gbp_worker_secret')),
        body    := '{}'::jsonb,
        /* Ein vollstaendiger Lauf ueber alle Nutzer und Betriebe
           braucht laenger als ein einzelner Abgleich. */
        timeout_milliseconds := 180000);
    $job$
  );
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Job angelegt, und nur einmal?
--   select jobname, schedule, active from cron.job where jobname = 'engine-daily';
--   select count(*) from cron.job where jobname = 'engine-daily';   -- muss 1 sein
--
-- Kein Platzhalter im Befehl?
--   select count(*) as platzhalter from cron.job
--    where jobname = 'engine-daily' and command like '%<%';         -- muss 0 sein
--
-- Nach dem ersten Lauf — was hat er bewirkt?
--   select j.jobname, d.status, d.start_time, d.end_time
--   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--   where j.jobname = 'engine-daily' order by d.start_time desc limit 5;
--
--   select status_code, left(content::text, 300) as antwort, created
--   from net._http_response order by created desc limit 3;
--
-- Erwartete Antwort:
--   {"users":1,"evaluated":1,"failed":0,"scopesEvaluated":3,
--    "scopesFailed":0,"created":0,"updated":2,"resolved":0,
--    "durationMs":...}
--
-- scopesEvaluated = 1 Konto + Anzahl aktiver Betriebe.
--
-- Einmal von Hand ausloesen, ohne auf 04:30 zu warten:
--   select net.http_post(
--     url     := 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/google-business/events/evaluate-all',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'X-Worker-Secret', (select decrypted_secret from vault.decrypted_secrets
--                                       where name = 'gbp_worker_secret')),
--     body    := '{}'::jsonb, timeout_milliseconds := 180000);
--
-- Abschalten, falls noetig:
--   select cron.unschedule('engine-daily');
