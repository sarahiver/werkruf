-- 20261020140000_job_sofort_verarbeiten.sql
--
-- Einen angestossenen Job sofort abarbeiten, statt auf den Worker zu warten
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND
-- ═══════════════════════════════════════════════════════════════
--
-- Am 20.10.2026 im UX-Durchgang gemessen: Nach dem Verbinden des
-- Google-Kontos sah ein frisch angemeldeter Kunde zweieinhalb Minuten
-- lang nichts. Die Kette:
--
--   sync/trigger          reiht einen Job ein und antwortet
--   gbp-worker  (5 min)   holt ihn ab
--   Standortimport        laeuft in ein, zwei Sekunden durch
--
-- Die Arbeit dauert Sekunden, das Warten auf den Abholtermin Minuten.
-- Im Mittel 150 Sekunden, im schlechtesten Fall 300.
--
-- Eine engere Cron-Taktung loest das nicht: pg_cron kann nicht feiner
-- als eine Minute, und eine Minute ist fuer den ersten Eindruck eines
-- Kunden immer noch zu lang. Wer sofort will, muss im Request
-- arbeiten.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT — UND WAS NICHT
-- ═══════════════════════════════════════════════════════════════
--
-- SIE LEGT ZWEI FUNKTIONEN AN. Mehr nicht. Keine Tabelle, kein
-- Fremdschluessel, kein Trigger, keine Zeile, kein Cron-Job.
--
-- SIE AENDERT NICHTS AN DER TAKTUNG. gbp-worker bleibt bei fuenf
-- Minuten, gbp-schedule bleibt stuendlich. Der Worker ist nach dieser
-- Migration das NETZ unter dem direkten Weg: Was im Request nicht
-- fertig wird, liegt weiterhin in der Warteschlange und wird beim
-- naechsten Lauf geholt. Ein misslungener Sofortversuch faellt damit
-- auf das heutige Verhalten zurueck, nicht ins Leere.
--
-- SIE AENDERT claim_sync_jobs NICHT. Die neue Funktion steht daneben.
-- Der Worker arbeitet unveraendert weiter; wer nur die Migration
-- anwendet und die Edge Function nicht neu ausrollt, hat genau den
-- Zustand von vorher.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ZWEI FUNKTIONEN UND NICHT EINE
-- ═══════════════════════════════════════════════════════════════
--
-- Weil ein Sofortversuch NICHTS KOSTEN DARF, wenn er nicht
-- durchkommt.
--
-- claim_sync_jobs() erhoeht beim Uebernehmen attempts um eins. Das
-- ist richtig: Ein Worker, der einen Job greift, hat einen Versuch
-- verbraucht. Fuer den Sofortweg stimmt es nicht. Laeuft er in sein
-- Zeitbudget, ist der Job nicht gescheitert — wir haben nur
-- aufgehoert zu warten.
--
-- Wuerde man dafuer finish_sync_job(success => false) nehmen, zaehlte
-- der Versuch gegen max_attempts. Bei einem Bewertungsabgleich, der
-- legitim laenger als das Budget braucht, waere der Job nach drei
-- Anlaeufen endgueltig 'failed' — allein wegen unserer Ungeduld.
--
-- Das ist exakt die Fehlerform vom selben Tag: Am 19.10. meldete das
-- Dashboard "Versuch 1 von 3" fuer einen Job, der nie wiederholt
-- wurde. Ein Zaehler, der etwas anderes bedeutet als er sagt.
--
-- release_sync_job() nimmt den Zaehler deshalb zurueck. Danach steht
-- der Job wieder genau so da, wie er ohne den Sofortversuch
-- dagestanden haette.
--
-- release_stuck_sync_jobs() bleibt unangetastet und laesst attempts
-- weiter stehen — dort IST ein Versuch verbraucht worden, der Worker
-- ist mittendrin abgeschnitten worden. Zwei verschiedene Faelle, zwei
-- verschiedene Funktionen.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — genau diesen einen Job uebernehmen
   ═══════════════════════════════════════════════════════════════

   Wortgleich zu claim_sync_jobs(), bis auf die Auswahl: dort
   "order by priority, scheduled_for limit p_limit", hier "id =
   p_job_id". Alles andere — 'running', attempts + 1, locked_by,
   locked_at, started_at — ist uebernommen, damit ein Job nicht je
   nach Weg in einem anderen Zustand landet.

   DIE ATOMARITAET IST DER GANZE PUNKT. 'for update skip locked' plus
   'status = queued' heisst: Hat der Cron-Worker den Job in der
   Zwischenzeit gegriffen, liefert diese Funktion KEINE Zeile. Der
   Request verarbeitet dann nichts und niemand arbeitet doppelt.

   Ohne diese Bedingung waere der Schaden nicht theoretisch: Zwei
   gleichzeitige Standortimporte desselben Kontos wuerden dieselben
   Betriebe zweimal schreiben und doppelt Google-Quota kosten. */
create or replace function public.claim_sync_job_by_id(
  p_job_id uuid,
  p_worker text
) returns setof public.sync_jobs
    language plpgsql
    security definer
    set search_path to 'public'
as $$
begin
  return query
  with candidate as (
    select id
      from public.sync_jobs
     where id = p_job_id
       and status = 'queued'
       and scheduled_for <= now()
       for update skip locked
  )
  update public.sync_jobs j
     set status     = 'running',
         attempts   = j.attempts + 1,
         locked_by  = p_worker,
         locked_at  = now(),
         started_at = coalesce(j.started_at, now())
    from candidate c
   where j.id = c.id
  returning j.*;
end;
$$;

comment on function public.claim_sync_job_by_id(uuid, text) is
  'Uebernimmt genau einen wartenden Job, damit sync/trigger ihn im '
  'Request abarbeiten kann. Liefert nichts, wenn der Cron-Worker ihn '
  'bereits hat — so arbeitet niemand doppelt.';

/* ═══════════════════════════════════════════════════════════════
   2 — den Job zurueckgeben, ohne einen Versuch zu berechnen
   ═══════════════════════════════════════════════════════════════

   Fuer den Fall, dass der Sofortversuch sein Zeitbudget erreicht.

   scheduled_for auf now(), nicht in die Zukunft: Der Job soll beim
   naechsten Worker-Lauf dran sein. Die quadratische Verzoegerung aus
   finish_sync_job() ist fuer Fehlschlaege gedacht, und hier ist
   nichts fehlgeschlagen.

   locked_by = p_worker ist keine Zierde: Ohne diese Bedingung koennte
   ein Request einen Job freigeben, den gerade der Cron-Worker
   bearbeitet — mitten in dessen Lauf, und der schriebe danach in eine
   Zeile, die schon wieder als wartend gilt. */
create or replace function public.release_sync_job(
  p_job_id uuid,
  p_worker text
) returns boolean
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  v_count integer;
begin
  update public.sync_jobs
     set status        = 'queued',
         scheduled_for = now(),
         attempts      = greatest(attempts - 1, 0),
         locked_by     = null,
         locked_at     = null
   where id = p_job_id
     and status = 'running'
     and locked_by = p_worker;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

comment on function public.release_sync_job(uuid, text) is
  'Gibt einen selbst uebernommenen Job zurueck in die Warteschlange '
  'und nimmt die Versuchszaehlung zurueck. Fuer den Sofortweg, der '
  'sein Zeitbudget erreicht: Das ist kein Fehlschlag.';

/* ═══════════════════════════════════════════════════════════════
   3 — Rechte
   ═══════════════════════════════════════════════════════════════

   Dasselbe Muster wie fuer die 46 Funktionen in
   20261014120000_execute_rechte_kanonisch.sql: zu, ausser fuer
   service_role.

   revoke von public ist nicht ueberfluessig. In Produktion traegt
   jede dieser Funktionen einen ausdruecklichen ACL-Eintrag mit leerem
   Empfaenger ("=X/postgres"), und das IST public. Ein revoke nur von
   anon und authenticated wuerde daran nichts aendern, weil das Recht
   ueber public weiter ankaeme.

   Beide Funktionen umgehen als SECURITY DEFINER die RLS auf
   sync_jobs. In der Hand eines Browsers waere das ein Weg, fremde
   Jobs zu uebernehmen oder freizugeben. */
revoke execute on function public.claim_sync_job_by_id(uuid, text) from public;
revoke execute on function public.claim_sync_job_by_id(uuid, text) from anon;
revoke execute on function public.claim_sync_job_by_id(uuid, text) from authenticated;
grant  execute on function public.claim_sync_job_by_id(uuid, text) to service_role;

revoke execute on function public.release_sync_job(uuid, text) from public;
revoke execute on function public.release_sync_job(uuid, text) from anon;
revoke execute on function public.release_sync_job(uuid, text) from authenticated;
grant  execute on function public.release_sync_job(uuid, text) to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════

   Eine Migration, die stillschweigend nichts tut, ist schlimmer als
   eine, die abbricht.

   Geprueft werden Existenz UND Rechte. Die Rechte sind hier der
   heiklere Teil: Eine Funktion, die da ist, aber fuer authenticated
   offensteht, waere schlimmer als gar keine. Das Verhalten selbst —
   Atomaritaet, Zaehler zurueck — prueft
   supabase/tests/jobSofortverarbeitung.test.sql gegen eine echte
   Datenbank; Textpruefungen koennen das nicht. */
do $$
declare
  v_fehlt  text[] := '{}';
  v_offen  text[] := '{}';
  v_sig    text;
begin
  foreach v_sig in array array[
    'claim_sync_job_by_id(p_job_id uuid, p_worker text)',
    'release_sync_job(p_job_id uuid, p_worker text)'
  ] loop
    if not exists (
      select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig
    ) then
      v_fehlt := v_fehlt || v_sig;
    end if;
  end loop;

  if array_length(v_fehlt, 1) is not null then
    raise exception '[sofort] Funktion fehlt nach der Migration: %',
      array_to_string(v_fehlt, ', ');
  end if;

  /* Gegenprobe zu den GRANTs oben: Steht eine der beiden fuer anon
     oder authenticated offen, bricht die Migration ab. */
  if has_function_privilege('anon',
       'public.claim_sync_job_by_id(uuid, text)', 'execute') then
    v_offen := v_offen || 'claim_sync_job_by_id/anon'::text;
  end if;
  if has_function_privilege('authenticated',
       'public.claim_sync_job_by_id(uuid, text)', 'execute') then
    v_offen := v_offen || 'claim_sync_job_by_id/authenticated'::text;
  end if;
  if has_function_privilege('anon',
       'public.release_sync_job(uuid, text)', 'execute') then
    v_offen := v_offen || 'release_sync_job/anon'::text;
  end if;
  if has_function_privilege('authenticated',
       'public.release_sync_job(uuid, text)', 'execute') then
    v_offen := v_offen || 'release_sync_job/authenticated'::text;
  end if;

  if array_length(v_offen, 1) is not null then
    raise exception '[sofort] Funktion steht offen fuer: %',
      array_to_string(v_offen, ', ');
  end if;

  if not has_function_privilege('service_role',
       'public.claim_sync_job_by_id(uuid, text)', 'execute')
     or not has_function_privilege('service_role',
       'public.release_sync_job(uuid, text)', 'execute') then
    raise exception '[sofort] service_role darf nicht ausfuehren — der Worker waere lahmgelegt';
  end if;

  raise notice '[sofort] in Ordnung — beide Funktionen stehen, Rechte zu, service_role darf';
  raise notice '[sofort] WIRKUNGSLOS, bis die Edge Function google-business neu ausgerollt ist';
end $$;

commit;
