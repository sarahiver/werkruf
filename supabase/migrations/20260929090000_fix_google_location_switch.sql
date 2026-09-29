-- 20260929090000_fix_google_location_switch.sql
--
-- Behebt: Der Wechsel zwischen zwei autorisierten Betrieben schlaegt mit
-- "Der Betrieb konnte nicht ausgewaehlt werden" fehl, sobald bereits
-- einer ausgewaehlt ist.
--
-- URSACHE
-- select_google_location aus 20260928170000 setzt alte und neue Auswahl
-- in EINER UPDATE-Anweisung:
--
--   update public.google_locations
--      set is_primary  = (id = p_location_id),
--          selected_at = case when id = p_location_id then now() else null end
--    where user_id = p_user_id and deleted_at is null;
--
-- Der Index google_locations_one_selected_per_user ist ein gewoehnlicher
-- Unique-Index, nicht deferrable. Postgres prueft ihn beim Schreiben
-- jeder einzelnen Zeile, und die Reihenfolge innerhalb eines UPDATE ist
-- nicht festgelegt. Wird die NEUE Zeile vor der alten geschrieben, haben
-- kurzzeitig beide selected_at is not null — 23505, unique_violation.
--
-- Dass es beim ERSTEN Auswaehlen funktioniert, passt dazu: Dort gibt es
-- keine zweite Zeile, die den Index belegt.
--
-- BEHEBUNG
-- Zwei Anweisungen in derselben Transaktion: erst die bisherige Auswahl
-- zuruecksetzen, dann die neue setzen. Zwischen beiden ist der Index
-- nie doppelt belegt. Eine Funktion in plpgsql laeuft ohnehin in genau
-- einer Transaktion; ein Zwischenzustand wird nie sichtbar.
--
-- NEBENLAEUFIGKEIT
-- Zwei gleichzeitige Wechsel desselben Nutzers koennten beide die alte
-- Auswahl loeschen und danach beide eine neue setzen — wieder 23505.
-- Ein Advisory Lock auf die Nutzer-ID serialisiert das. Er gilt nur fuer
-- die Dauer der Transaktion und betrifft ausschliesslich diesen einen
-- Nutzer; andere Kunden warten nicht.
--
-- BEIBEHALTEN
--   - der Unique-Index (genau ein ausgewaehlter Betrieb pro Nutzer)
--   - die serverseitige Eigentumspruefung ueber google_accounts
--   - security definer mit leerem search_path
--   - Ausfuehrungsrecht ausschliesslich fuer service_role
--
-- Wiederholbar. Laeuft im SQL Editor. Aendert keine Daten.

begin;

/* Index und Spalte unveraendert — hier nur zur Sicherheit, damit die
   Migration auch auf einem Stand ohne 20260928170000 durchlaeuft. */
alter table public.google_locations
  add column if not exists selected_at timestamptz;

create unique index if not exists google_locations_one_selected_per_user
  on public.google_locations (user_id)
  where selected_at is not null and deleted_at is null;

create or replace function public.select_google_location(p_location_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_treffer integer;
begin
  /* ── 1. Eigentum pruefen ──
     Unveraendert: Der Standort muss dem Nutzer gehoeren UND ueber ein
     aktives, nicht geloeschtes Konto desselben Nutzers laufen. */
  if not exists (
    select 1
      from public.google_locations l
      join public.google_accounts a on a.id = l.account_id
     where l.id = p_location_id and l.user_id = p_user_id
       and a.user_id = p_user_id and a.status = 'active'
       and l.deleted_at is null and a.deleted_at is null
  ) then
    return false;
  end if;

  /* ── 2. Gleichzeitige Wechsel serialisieren ──
     Ohne das koennten zwei parallele Aufrufe beide Schritt 3 ausfuehren
     und danach beide Schritt 4 — der zweite liefe in denselben
     Unique-Verstoss. Der Lock endet mit der Transaktion. */
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  /* ── 3. Bisherige Auswahl zuruecksetzen ──
     Getrennt von Schritt 4, das ist der Kern der Behebung. Die
     Bedingung id <> p_location_id laesst eine bereits bestehende
     Auswahl unberuehrt: Ein zweiter Klick auf denselben Betrieb
     aendert nichts. */
  update public.google_locations
     set selected_at = null,
         is_primary  = false
   where user_id = p_user_id
     and deleted_at is null
     and id <> p_location_id
     and (selected_at is not null or is_primary);

  /* ── 4. Neuen Betrieb auswaehlen ──
     coalesce haelt den urspruenglichen Zeitpunkt fest, wenn der
     Betrieb bereits ausgewaehlt war — "seit wann" bleibt damit
     aussagekraeftig. */
  update public.google_locations
     set selected_at = coalesce(selected_at, pg_catalog.now()),
         is_primary  = true
   where id = p_location_id
     and user_id = p_user_id
     and deleted_at is null;

  get diagnostics v_treffer = row_count;

  /* Sollte nach der Pruefung in Schritt 1 nicht eintreten. Falls doch
     — etwa weil die Zeile dazwischen geloescht wurde —, meldet die
     Funktion einen Misserfolg statt still nichts zu tun. */
  return v_treffer = 1;
end;
$$;

revoke all on function public.select_google_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public.select_google_location(uuid, uuid) to service_role;

comment on function public.select_google_location(uuid, uuid) is
  'Waehlt genau einen Betrieb pro Nutzer aus. Zuruecksetzen und Setzen sind getrennte Anweisungen in derselben Transaktion — eine gemeinsame verletzt google_locations_one_selected_per_user, weil die Zeilenreihenfolge im UPDATE nicht festgelegt ist.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Ausgangslage ansehen:
--   select id, title, selected_at, is_primary
--   from public.google_locations
--   where deleted_at is null order by title;
--
-- Wechsel trocken durchspielen — <user-uuid> und <location-uuid>
-- ersetzen, NICHT als Platzhalter ausfuehren (siehe Uebergabe §14
-- Falle 11):
--
--   begin;
--     select public.select_google_location('<location-uuid>', '<user-uuid>');
--     select id, title, selected_at from public.google_locations
--      where user_id = '<user-uuid>' and deleted_at is null;
--   rollback;
--
-- Erwartet: true, und genau eine Zeile mit selected_at is not null.
--
-- Gegenprobe auf den Index:
--   select count(*) from public.google_locations
--    where user_id = '<user-uuid>' and selected_at is not null and deleted_at is null;
--   -- muss 0 oder 1 sein, nie mehr
