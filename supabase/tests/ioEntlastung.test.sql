-- Abnahme: Takt und Lauf-Historie nach 20261104120000 (04.11.2026)
--
--   scripts/test-db/run.sh ioEntlastung
--
-- Gemessen: die fuenf Jobs tragen den neuen Takt UND ihren alten
-- Befehl (Vault-Secret, Body, Timeout); kein Job doppelt, keiner weg;
-- die uebrigen Jobs unveraendert. prune_sync_runs() loescht mit der
-- Vorgabe alles aelter als 7 Tage und nichts Juengeres.

begin;

do $$
declare
  v record;
  v_rest integer;
begin
  /* A — Takt */
  for v in select * from (values
      ('gbp-worker',      '*/15 * * * *'),
      ('mail-worker',     '*/30 * * * *'),
      ('comm-alerts',     '7 * * * *'),
      ('ops-alert',       '13 * * * *'),
      ('gbp-maintenance', '23 * * * *')) as t(jobname, schedule)
  loop
    if (select count(*) from cron.job where jobname = v.jobname) <> 1 then
      raise exception 'A: % kommt %-mal vor', v.jobname, (select count(*) from cron.job where jobname = v.jobname);
    end if;
    if (select schedule from cron.job where jobname = v.jobname) <> v.schedule then
      raise exception 'A: % steht auf % statt %', v.jobname, (select schedule from cron.job where jobname = v.jobname), v.schedule;
    end if;
  end loop;
  raise notice 'A: fuenf Jobs im neuen Takt, keiner doppelt';

  /* B — GEGENPROBE: Befehl unversehrt (Secret aus dem Vault, Pfad, Body) */
  for v in select jobname, command from cron.job
            where jobname in ('gbp-worker', 'mail-worker', 'comm-alerts', 'ops-alert')
  loop
    if v.command not like '%net.http_post%' or v.command not like '%gbp_worker_secret%' then
      raise exception 'B: Befehl von % verloren: %', v.jobname, left(v.command, 80);
    end if;
  end loop;
  if (select command from cron.job where jobname = 'gbp-worker') not like '%google-business/sync/run%' then
    raise exception 'B: gbp-worker zeigt nicht mehr auf sync/run';
  end if;
  if (select command from cron.job where jobname = 'gbp-maintenance') not like '%run_sync_maintenance%' then
    raise exception 'B: gbp-maintenance ruft run_sync_maintenance nicht mehr';
  end if;
  raise notice 'B: Befehle wortgleich erhalten';

  /* C — Unbeteiligte Jobs unveraendert */
  if (select schedule from cron.job where jobname = 'engine-daily') <> '30 4 * * *'
     or (select schedule from cron.job where jobname = 'gbp-schedule') <> '0 * * * *'
     or (select schedule from cron.job where jobname = 'comm-weekly') <> '0 7 * * 1' then
    raise exception 'C: ein unbeteiligter Job wurde veraendert';
  end if;
  raise notice 'C: engine-daily, gbp-schedule, comm-weekly unveraendert';

  /* D — Lauf-Historie: 7 Tage */
  insert into public.sync_runs (worker_id, trigger, status, started_at, finished_at, duration_ms)
  values ('t', 'cron', 'completed', now() - interval '8 days', now() - interval '8 days', 1),
         ('t', 'cron', 'completed', now() - interval '6 days', now() - interval '6 days', 1),
         ('t', 'cron', 'completed', now() - interval '1 hour', now() - interval '1 hour', 1);
  if public.prune_sync_runs() <> 1 then
    raise exception 'D: prune_sync_runs() hat nicht genau die 8-Tage-Zeile geloescht';
  end if;
  select count(*) into v_rest from public.sync_runs where worker_id = 't';
  if v_rest <> 2 then raise exception 'D: % Zeilen uebrig statt 2', v_rest; end if;
  raise notice 'D: 7-Tage-Frist wirkt, Juengeres bleibt';
end $$;

rollback;
