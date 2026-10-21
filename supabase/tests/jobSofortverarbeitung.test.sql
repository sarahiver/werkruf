-- Abnahme fuer die Sofortverarbeitung angestossener Jobs
--
--   scripts/test-db/run.sh jobSofortverarbeitung
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Migration 20261020140000 legt zwei Funktionen an, damit
-- sync/trigger einen Job im laufenden Request abarbeiten kann statt
-- bis zu fuenf Minuten auf gbp-worker zu warten.
--
-- Beide Funktionen haben genau eine Eigenschaft, auf die sich alles
-- stuetzt, und beide Eigenschaften sind durch Hinsehen nicht zu
-- pruefen:
--
--   claim_sync_job_by_id  darf einen Job NUR uebernehmen, wenn ihn
--                         nicht schon jemand hat. Sonst laufen zwei
--                         Standortimporte desselben Kontos parallel,
--                         schreiben dieselben Betriebe doppelt und
--                         kosten doppelt Google-Quota.
--
--   release_sync_job      darf KEINEN Versuch berechnen. Taete es
--                         das, stuende ein Bewertungsabgleich, der
--                         legitim laenger als das Zeitbudget braucht,
--                         nach drei Anlaeufen endgueltig auf 'failed'
--                         — allein wegen unserer Ungeduld.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT UEBER TEXTMUSTER
-- ═══════════════════════════════════════════════════════════════
--
-- Eine Pruefung "enthaelt for update skip locked" waere wertlos: Sie
-- bestaende auch dann, wenn die Bedingung status = 'queued' fehlt —
-- und genau die verhindert die Doppelverarbeitung. Hier wird deshalb
-- nichts gelesen, sondern versucht: uebernehmen, nochmal uebernehmen,
-- freigeben, falsch freigeben.
--
-- Der entscheidende Vergleich steht in Abschnitt F: derselbe Job
-- einmal durch finish_sync_job() und einmal durch release_sync_job().
-- Der Unterschied im Zaehler IST die Zusage dieser Migration.

begin;

/* ═══════════════════════════════════════════════════════════════
   AUFBAU
   ═══════════════════════════════════════════════════════════════

   Jobs ohne user_id, account_id und location_id. Alle drei Spalten
   sind nullable, und ein null in location_id haelt die Zeilen aus dem
   partiellen Unique-Index sync_jobs_location_aktiv_idx heraus — der
   greift nur "where location_id is not null". Ohne das koennten hier
   nicht mehrere wartende sync_locations-Jobs nebeneinander stehen. */
do $$
declare
  v_job        uuid;
  v_zweiter    uuid;
  v_status     text;
  v_versuche   integer;
  v_sperre     text;
  v_start      timestamptz;
  v_plan       timestamptz;
  v_zeilen     integer;
  v_frei       boolean;
  v_versuche_a integer;
  v_versuche_b integer;
  v_plan_a     timestamptz;
  v_plan_b     timestamptz;
begin

  /* ─────────────────────────────────────────────────────────────
     A — Uebernehmen setzt den Job korrekt auf laufend
     ───────────────────────────────────────────────────────────── */
  insert into public.sync_jobs (job_type, status, priority, scheduled_for)
       values ('sync_locations', 'queued', 10, now() - interval '1 second')
    returning id into v_job;

  select count(*) into v_zeilen
    from public.claim_sync_job_by_id(v_job, 'inline-a');

  if v_zeilen <> 1 then
    raise exception 'A: claim_sync_job_by_id lieferte % Zeilen statt 1', v_zeilen;
  end if;

  select status, attempts, locked_by, started_at
    into v_status, v_versuche, v_sperre, v_start
    from public.sync_jobs where id = v_job;

  if v_status <> 'running' then
    raise exception 'A: Status ist % statt running', v_status;
  end if;
  if v_versuche <> 1 then
    raise exception 'A: attempts ist % statt 1', v_versuche;
  end if;
  if v_sperre <> 'inline-a' then
    raise exception 'A: locked_by ist % statt inline-a', coalesce(v_sperre, 'null');
  end if;
  if v_start is null then
    raise exception 'A: started_at wurde nicht gesetzt';
  end if;

  raise notice 'A: uebernommen — running, attempts 1, Sperre gesetzt';

  /* ─────────────────────────────────────────────────────────────
     B — GEGENPROBE: kein zweites Uebernehmen
     ─────────────────────────────────────────────────────────────

     Die tragende Pruefung. Haette claim_sync_job_by_id die Bedingung
     status = 'queued' nicht, kaeme hier eine zweite Zeile — und zwei
     Laeufe wuerden denselben Job gleichzeitig abarbeiten. */
  select count(*) into v_zeilen
    from public.claim_sync_job_by_id(v_job, 'inline-b');

  if v_zeilen <> 0 then
    raise exception
      'B: Ein laufender Job wurde ein zweites Mal uebernommen (% Zeilen). '
      'Doppelverarbeitung ist moeglich.', v_zeilen;
  end if;

  select attempts into v_versuche from public.sync_jobs where id = v_job;
  if v_versuche <> 1 then
    raise exception 'B: Der zweite Versuch hat attempts auf % erhoeht', v_versuche;
  end if;

  raise notice 'B: zweites Uebernehmen abgewiesen, Zaehler unveraendert';

  /* ─────────────────────────────────────────────────────────────
     C — GEGENPROBE: fremde Freigabe wirkungslos
     ─────────────────────────────────────────────────────────────

     Ohne die Bedingung locked_by = p_worker koennte ein Request einen
     Job freigeben, den gerade der Cron-Worker bearbeitet — mitten in
     dessen Lauf. */
  select public.release_sync_job(v_job, 'jemand-anderes') into v_frei;

  if v_frei then
    raise exception 'C: Ein fremder Worker durfte den Job freigeben';
  end if;

  select status, locked_by into v_status, v_sperre
    from public.sync_jobs where id = v_job;
  if v_status <> 'running' or v_sperre <> 'inline-a' then
    raise exception 'C: Der Job wurde trotzdem veraendert — %, %', v_status, v_sperre;
  end if;

  raise notice 'C: fremde Freigabe abgewiesen';

  /* ─────────────────────────────────────────────────────────────
     D — Eigene Freigabe nimmt den Versuch zurueck
     ───────────────────────────────────────────────────────────── */
  select public.release_sync_job(v_job, 'inline-a') into v_frei;

  if not v_frei then
    raise exception 'D: Die eigene Freigabe wurde abgewiesen';
  end if;

  select status, attempts, locked_by, locked_at, scheduled_for
    into v_status, v_versuche, v_sperre, v_start, v_plan
    from public.sync_jobs where id = v_job;

  if v_status <> 'queued' then
    raise exception 'D: Status ist % statt queued', v_status;
  end if;
  if v_versuche <> 0 then
    raise exception
      'D: attempts ist % statt 0 — ein abgelaufenes Budget haette einen '
      'Versuch gekostet', v_versuche;
  end if;
  if v_sperre is not null or v_start is not null then
    raise exception 'D: Die Sperre wurde nicht geloest';
  end if;
  if v_plan > now() then
    raise exception
      'D: scheduled_for liegt in der Zukunft (%) — der Worker soll ihn '
      'beim naechsten Lauf nehmen, nicht spaeter', v_plan;
  end if;

  raise notice 'D: freigegeben — queued, attempts 0, sofort faellig';

  /* ─────────────────────────────────────────────────────────────
     E — GEGENPROBEN an den Raendern
     ───────────────────────────────────────────────────────────── */

  /* Ein wartender Job laesst sich nicht freigeben. */
  select public.release_sync_job(v_job, 'inline-a') into v_frei;
  if v_frei then
    raise exception 'E1: Ein wartender Job wurde "freigegeben"';
  end if;

  select attempts into v_versuche from public.sync_jobs where id = v_job;
  if v_versuche <> 0 then
    raise exception 'E1: attempts ist % — greatest() schuetzt nicht', v_versuche;
  end if;

  /* Ein Job, der erst spaeter faellig ist, wird nicht uebernommen.
     Sonst wuerde ein Request die quadratische Wiederholungsplanung
     aus finish_sync_job() aushebeln. */
  insert into public.sync_jobs (job_type, status, priority, scheduled_for)
       values ('sync_reviews', 'queued', 10, now() + interval '5 minutes')
    returning id into v_zweiter;

  select count(*) into v_zeilen
    from public.claim_sync_job_by_id(v_zweiter, 'inline-c');
  if v_zeilen <> 0 then
    raise exception 'E2: Ein noch nicht faelliger Job wurde uebernommen';
  end if;

  /* Ein Job, den der Cron-Worker schon hat. */
  update public.sync_jobs
     set status = 'running', locked_by = 'edge-cron', locked_at = now()
   where id = v_zweiter;

  select count(*) into v_zeilen
    from public.claim_sync_job_by_id(v_zweiter, 'inline-d');
  if v_zeilen <> 0 then
    raise exception 'E3: Ein vom Worker gehaltener Job wurde uebernommen';
  end if;

  raise notice 'E: Raender halten — nicht faellig, fremd gehalten, wartend';

  /* ─────────────────────────────────────────────────────────────
     F — DER UNTERSCHIED, UM DEN ES GEHT
     ─────────────────────────────────────────────────────────────

     Zwei gleich aufgebaute Jobs. Einer wird nach dem Uebernehmen
     ueber finish_sync_job() als Fehlschlag abgeschlossen, der andere
     ueber release_sync_job() zurueckgegeben.

     Der Zaehlerunterschied ist die ganze Zusage dieser Migration:
     Ein abgelaufenes Zeitbudget ist kein Fehlschlag. Verschwindet
     diese Unterscheidung, faellt der Test hier — und nur hier. */
  insert into public.sync_jobs (job_type, status, priority, scheduled_for)
       values ('sync_reviews', 'queued', 10, now() - interval '1 second')
    returning id into v_job;
  insert into public.sync_jobs (job_type, status, priority, scheduled_for)
       values ('sync_reviews', 'queued', 10, now() - interval '1 second')
    returning id into v_zweiter;

  perform public.claim_sync_job_by_id(v_job,     'inline-f1');
  perform public.claim_sync_job_by_id(v_zweiter, 'inline-f2');

  perform public.finish_sync_job(v_job, false, null, 'budget_exhausted', 'Budget');
  perform public.release_sync_job(v_zweiter, 'inline-f2');

  select attempts, scheduled_for into v_versuche_a, v_plan_a
    from public.sync_jobs where id = v_job;
  select attempts, scheduled_for into v_versuche_b, v_plan_b
    from public.sync_jobs where id = v_zweiter;

  if v_versuche_a <> 1 then
    raise exception
      'F: finish_sync_job hat den Versuch nicht berechnet (attempts %) — '
      'dann war die Unterscheidung nie noetig', v_versuche_a;
  end if;
  if v_versuche_b <> 0 then
    raise exception
      'F: release_sync_job hat einen Versuch berechnet (attempts %). '
      'Genau das soll es nicht.', v_versuche_b;
  end if;
  if v_plan_a <= now() then
    raise exception
      'F: finish_sync_job hat nicht in die Zukunft geplant (%) — '
      'die quadratische Wiederholung fehlt', v_plan_a;
  end if;
  if v_plan_b > now() then
    raise exception 'F: release_sync_job hat in die Zukunft geplant (%)', v_plan_b;
  end if;

  raise notice
    'F: Unterschied belegt — finish kostet einen Versuch und verzoegert, '
    'release kostet nichts und ist sofort faellig';

end $$;

/* ═══════════════════════════════════════════════════════════════
   G — RECHTE
   ═══════════════════════════════════════════════════════════════

   Beide Funktionen umgehen als SECURITY DEFINER die RLS auf
   sync_jobs. In der Hand eines Browsers waere das ein Weg, fremde
   Jobs zu uebernehmen oder mitten im Lauf freizugeben.

   Geprueft wird die Wirkung ueber has_function_privilege, nicht der
   Text der Migration. */
do $$
declare
  v_offen text[] := '{}';
  r record;
begin
  for r in
    select unnest(array[
      'public.claim_sync_job_by_id(uuid, text)',
      'public.release_sync_job(uuid, text)'
    ]) as sig
  loop
    if has_function_privilege('anon', r.sig, 'execute') then
      v_offen := v_offen || (r.sig || '/anon');
    end if;
    if has_function_privilege('authenticated', r.sig, 'execute') then
      v_offen := v_offen || (r.sig || '/authenticated');
    end if;
    if not has_function_privilege('service_role', r.sig, 'execute') then
      v_offen := v_offen || (r.sig || '/service_role FEHLT');
    end if;
  end loop;

  if array_length(v_offen, 1) is not null then
    raise exception 'G: Rechte stimmen nicht — %', array_to_string(v_offen, ', ');
  end if;

  raise notice 'G: Rechte zu fuer anon und authenticated, offen fuer service_role';
end $$;

rollback;
