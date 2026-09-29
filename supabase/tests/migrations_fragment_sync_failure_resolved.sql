create or replace function public.sync_failure_resolved(
  p_user_id     uuid,
  p_account_id  uuid,
  p_job_type    text,
  p_location_id uuid,
  p_failed_at   timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sync_jobs s
     where s.status = 'succeeded'
       and s.created_at > p_failed_at
       and s.user_id     = p_user_id
       and s.job_type    = p_job_type
       and s.account_id  is not distinct from p_account_id
       and s.location_id is not distinct from p_location_id
  );
$$;

comment on function public.sync_failure_resolved is
  'Gilt ein gescheiterter Sync-Job als behoben? Nur ein spaeterer Erfolg desselben Nutzers, Kontos, Jobtyps und Standorts zaehlt.';

/* Betriebssicht: welche Fehler sind offen, welche behoben. */
create or replace view public.ops_sync_failures as
select
  j.id,
  j.user_id,
  j.account_id,
  j.location_id,
  j.job_type,
  j.attempts,
  j.max_attempts,
  j.error_code,
  j.created_at,
  j.updated_at,
  public.sync_failure_resolved(
    j.user_id, j.account_id, j.job_type, j.location_id, j.created_at
  ) as behoben
from public.sync_jobs j
where j.attempts >= j.max_attempts
  and j.status <> 'succeeded';

comment on view public.ops_sync_failures is
  'Endgueltig gescheiterte Sync-Jobs mit Kennzeichnung, ob ein spaeterer Erfolg sie behoben hat. Historie bleibt vollstaendig.';

