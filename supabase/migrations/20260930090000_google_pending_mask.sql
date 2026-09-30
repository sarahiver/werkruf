-- 20260930090000_google_pending_mask.sql
--
-- Speichert pendingMask getrennt von diffMask.
--
-- WARUM GETRENNT
--
-- Beide kommen aus locations.getGoogleUpdated, bedeuten aber
-- Verschiedenes:
--
--   pendingMask  Felder, fuer die der INHABER eine Aenderung
--                eingereicht hat, die noch nicht auf Maps und in der
--                Suche veroeffentlicht ist.
--                → "Google prueft deine Aenderung."
--
--   diffMask     Felder, in denen die VERBRAUCHERANSICHT von den
--                Angaben des Inhabers abweicht — von Google oder von
--                Nutzern erzeugte Unterschiede.
--                → "Google zeigt etwas anderes an als du hinterlegt
--                   hast."
--
-- Sie zusammenzuwerfen hiesse, dem Kunden "deine Aenderung wird
-- geprueft" zu melden, wenn in Wahrheit jemand anderes etwas geaendert
-- hat — oder umgekehrt.
--
-- google_diff_mask existiert bereits. Diese Migration ergaenzt nur die
-- zweite Spalte.
--
-- Wiederholbar. Aendert keine vorhandenen Daten.

begin;

alter table public.google_locations
  add column if not exists google_pending_mask text[] not null default '{}'::text[];

comment on column public.google_locations.google_pending_mask is
  'Felder mit eingereichter, noch nicht veroeffentlichter Aenderung des Inhabers (getGoogleUpdated.pendingMask). NICHT mit google_diff_mask verwechseln.';

comment on column public.google_locations.google_diff_mask is
  'Felder, in denen die Verbraucheransicht von den Angaben des Inhabers abweicht (getGoogleUpdated.diffMask). Sagt nichts ueber eigene Einreichungen.';

/* Betriebssicht: Was steht bei welchem Standort zur Pruefung an? */
create or replace view public.ops_gbp_pending_edits as
select
  l.id,
  l.user_id,
  l.title,
  l.google_pending_mask,
  l.google_diff_mask,
  array_length(l.google_pending_mask, 1) as anzahl_ausstehend,
  (l.google_profile -> 'metadata' ->> 'hasPendingEdits')::boolean as google_meldet_ausstehend,
  l.last_synced_at
from public.google_locations l
where l.deleted_at is null
  and (array_length(l.google_pending_mask, 1) > 0
       or (l.google_profile -> 'metadata' ->> 'hasPendingEdits')::boolean is true)
order by l.last_synced_at desc;

comment on view public.ops_gbp_pending_edits is
  'Standorte mit eingereichten, noch nicht veroeffentlichten Aenderungen.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Spalte vorhanden?
--   select column_name, data_type from information_schema.columns
--    where table_name = 'google_locations'
--      and column_name in ('google_pending_mask', 'google_diff_mask');
--
-- Nach einem Schreibvorgang:
--   select title, google_pending_mask, google_diff_mask,
--          google_profile -> 'metadata' ->> 'hasPendingEdits' as meldet_google
--   from public.google_locations where selected_at is not null;
--
-- Was steht insgesamt an?
--   select * from public.ops_gbp_pending_edits;
