-- 20261104120000_io_entlastung.sql
--
-- Disk-IO-Budget: Takt der Hintergrundjobs senken, Lauf-Historie kuerzen
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND (04.11.2026, gemessen in Produktion)
-- ═══════════════════════════════════════════════════════════════
--
-- Supabase meldete ein erschoepftes Disk-IO-Budget. Die Messung
-- (pg_stat_statements, pg_stat_user_tables, cron.job_run_details):
--
--   • Plattenlesen aller Abfragen zusammen: wenige MB. Nicht die Ursache.
--   • Kein Job laeuft lang oder scheitert (750 Laeufe/Tag, 2,5 Minuten
--     Datenbankzeit insgesamt).
--   • Aber: net.http_request_queue 587 Autovacuums, sync_locks 306 —
--     auf Tabellen mit null bis sechs lebenden Zeilen. Jeder Cron-Lauf,
--     der eine Edge Function ruft, ist ein Insert und ein Delete in der
--     pg_net-Queue, dazu Sperre rein und raus in sync_locks. 750-mal am
--     Tag. Jedes Mal WAL, Checkpoint, Autovacuum.
--
-- Auf dem kleinsten Compute ist das IO-Budget ein Burst-Guthaben, das
-- sich nur in Ruhe auffuellt. Diese Datenbank hat keine Ruhe: alle
-- fuenf Minuten ein Worker, alle zehn der Mailversand, alle fuenfzehn
-- drei weitere Jobs. Nicht schwer — nur nie still.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT
-- ═══════════════════════════════════════════════════════════════
--
--   1. Takt senken (vor dem ersten Kunden, spaeter wieder anhebbar):
--        gbp-worker       */5  → */15     (Aktualisierung; Onboarding
--                                          laeuft seit 20.10. inline
--                                          und bleibt sofort)
--        mail-worker      */10 → */30     (Mails warten bis 30 Min)
--        comm-alerts      */15 → stuendlich (Sofortmeldung bis 60 Min)
--        ops-alert        */15 → stuendlich
--        gbp-maintenance  */15 → stuendlich
--      Von 720 auf ≈ 190 Laeufe am Tag ueber diese fuenf Jobs — gut ein Viertel.
--      Krumme Minuten, damit nichts zur vollen Stunde zusammenfaellt.
--
--   2. prune_sync_runs(): Vorgabe 30 → 7 Tage. 8 640 Zeilen waren
--      exakt 30 Tage × 288 Worker-Laeufe; sieben Tage reichen fuer
--      jede Fehlersuche, und eine kleine Tabelle ist fuer Autovacuum
--      billiger.
--
-- Der Befehlstext der Jobs bleibt wortgleich (Vault-Secret, Body,
-- Timeout): Er wird aus cron.job gelesen und mit dem neuen Takt wieder
-- angelegt. Keine Logik, kein Produktverhalten aendert sich.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS SIE NICHT TUT
-- ═══════════════════════════════════════════════════════════════
--
-- Sie fasst die pg_net-Queue nicht an (Supabase-Infrastruktur) und
-- aendert kein Lock- oder Lauf-Protokoll: Deren Churn ist proportional
-- zur Zahl der Laeufe — der Takt IST der Hebel. Ob er reicht, zeigt
-- der Disk-IO-Graph nach 48 Stunden. Wenn nicht, ist das Compute-
-- Upgrade der naechste Schritt — dann mit Befund statt Verdacht.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Takt
   ═══════════════════════════════════════════════════════════════ */
do $$
declare
  v_neu record;
  v_alt record;
begin
  for v_neu in
    select * from (values
      ('gbp-worker',      '*/15 * * * *'),
      ('mail-worker',     '*/30 * * * *'),
      ('comm-alerts',     '7 * * * *'),
      ('ops-alert',       '13 * * * *'),
      ('gbp-maintenance', '23 * * * *')
    ) as t(jobname, schedule)
  loop
    select jobname, schedule, command into v_alt
      from cron.job where jobname = v_neu.jobname;
    if v_alt is null then
      raise exception '[io] Job % fehlt — erst 20261012120000 anwenden', v_neu.jobname;
    end if;
    if v_alt.schedule = v_neu.schedule then
      raise notice '[io] % steht schon auf % — unveraendert', v_neu.jobname, v_neu.schedule;
      continue;
    end if;
    perform cron.unschedule(v_neu.jobname);
    perform cron.schedule(v_neu.jobname, v_neu.schedule, v_alt.command);
    raise notice '[io] % : % → %', v_neu.jobname, v_alt.schedule, v_neu.schedule;
  end loop;
end $$;

/* ═══════════════════════════════════════════════════════════════
   2 — Lauf-Historie: 7 Tage
   ═══════════════════════════════════════════════════════════════
   Wortgleich zur Baseline, nur die Vorgabe. run_sync_maintenance()
   ruft die Funktion ohne Argument. */
create or replace function public.prune_sync_runs(p_keep interval default '7 days'::interval)
returns integer
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  v_count integer;
begin
  delete from public.sync_runs where started_at < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.prune_sync_runs(interval) is
  'Loescht sync_runs aelter als p_keep (Vorgabe 7 Tage, bis 04.11.2026: 30). '
  'Laeuft in run_sync_maintenance().';

/* ═══════════════════════════════════════════════════════════════
   3 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════ */
do $$
declare
  v_schedule text;
  v_default  text;
begin
  for v_schedule in
    select jobname || ' ' || schedule from cron.job
     where jobname in ('gbp-worker', 'mail-worker', 'comm-alerts', 'ops-alert', 'gbp-maintenance')
  loop
    raise notice '[io] %', v_schedule;
  end loop;

  if (select schedule from cron.job where jobname = 'gbp-worker') <> '*/15 * * * *' then
    raise exception '[io] gbp-worker nicht auf 15 Minuten';
  end if;
  /* Vier Jobs rufen per pg_net eine Edge Function; gbp-maintenance ist
     reines SQL (run_sync_maintenance). Beides muss erhalten sein. */
  if (select count(*) from cron.job
       where jobname in ('gbp-worker', 'mail-worker', 'comm-alerts', 'ops-alert')
         and command not like '%net.http_post%') > 0
     or (select command from cron.job where jobname = 'gbp-maintenance') not like '%run_sync_maintenance%' then
    raise exception '[io] Befehlstext eines Jobs verloren';
  end if;
  if (select count(*) from cron.job
       where jobname in ('gbp-worker', 'mail-worker', 'comm-alerts', 'ops-alert', 'gbp-maintenance')) <> 5 then
    raise exception '[io] Job-Dubletten oder -Verluste';
  end if;

  select pg_get_function_arguments(p.oid) into v_default
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'prune_sync_runs';
  if v_default not like '%7 days%' then
    raise exception '[io] prune_sync_runs-Vorgabe ist nicht 7 Tage: %', v_default;
  end if;

  raise notice '[io] in Ordnung — 5 Jobs im neuen Takt, Lauf-Historie 7 Tage';
end $$;

commit;
