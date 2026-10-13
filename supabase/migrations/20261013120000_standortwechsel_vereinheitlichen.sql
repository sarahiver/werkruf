-- ═══════════════════════════════════════════════════════════════
-- H1 — Betriebswechsel über Mail-Links: ein Weg statt drei
-- ═══════════════════════════════════════════════════════════════
--
-- BEFUND (gemessen, nicht vermutet)
--
-- Zwei Stellen in google-business/index.ts setzten selected_at direkt,
-- ohne die bisherige Auswahl zurueckzusetzen:
--
--   handleActionLinkPost   (:6650)
--   handleEinstieg         (:6841)
--
--   update google_locations set selected_at = now()
--    where id = <neuer Betrieb> and user_id = <Nutzer>
--
-- Gegen den Index google_locations_one_selected_per_user (unique je
-- user_id, where selected_at is not null and deleted_at is null) ist
-- das bei mehreren Betrieben ein Verstoss. In der Testdatenbank
-- gemessen, mit zwei Standorten und einer bestehenden Auswahl:
--
--   ERROR: duplicate key value violates unique constraint
--          "google_locations_one_selected_per_user"
--
-- Beide Aufrufe schlucken den Fehler (.then(() => {}, () => {})). Der
-- Wechsel scheitert also still, und das Dashboard zeigt danach den
-- Betrieb, der vorher ausgewaehlt war — genau das, was der Kommentar
-- an der Stelle verhindern soll ("Sonst zeigte das Dashboard nach dem
-- Einstieg den falschen").
--
-- Realer Aufrufpfad: Ein Kunde mit mehreren Betrieben klickt in einer
-- Mail auf eine Aufgabe eines ANDEREN Betriebs als des ausgewaehlten.
-- Bei genau einem Standort tritt es nicht auf — dann trifft das
-- UPDATE dieselbe Zeile, die schon ausgewaehlt ist.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT EINFACH select_google_location AUFRUFEN
-- ═══════════════════════════════════════════════════════════════
--
-- Naheliegend, und fast richtig. Aber select_google_location verlangt
-- zusaetzlich ein AKTIVES Google-Konto:
--
--   join public.google_accounts a on a.id = l.account_id
--   ... and a.status = 'active'
--
-- Die beiden Mail-Pfade verlangten das nie. Haette man sie einfach
-- umgestellt, waere aus einem Fehler ein zweiter geworden: Ein Kunde
-- mit abgerissener Verbindung (needs_reauth) klickt auf eine Aufgabe
-- und landet beim falschen Betrieb — ohne jede Meldung, denn der
-- Rueckgabewert false sah genauso aus wie vorher der geschluckte
-- Fehler.
--
-- Deshalb zwei Eingaenge auf EINE Umsetzung:
--
--   select_google_location      Der Kunde waehlt im Dashboard aus.
--                               Verlangt ein aktives Konto —
--                               unveraendert, nach aussen identisch.
--
--   activate_google_location    Ein Mail-Link zeigt auf einen
--                               bestimmten Betrieb. Verlangt nur:
--                               gehoert dem Nutzer, nicht geloescht.
--                               Genau die Pruefung, die die beiden
--                               TS-Stellen bisher hatten.
--
-- Die Mechanik (Advisory-Lock, Zuruecksetzen und Setzen als getrennte
-- Anweisungen) steht nur noch EINMAL da:
-- apply_google_location_selection. Zwei Kopien waeren wieder die
-- Lage, aus der dieser Befund entstanden ist.
--
-- Der Unterschied ist bewusst und sichtbar: Die Zugriffsregel aendert
-- sich an keiner Stelle. activate_google_location prueft genau so
-- streng wie die TS-Stellen vorher — der Fehler war nicht die
-- Pruefung, sondern das fehlende Zuruecksetzen.
--
-- Wiederholbar. Laeuft im SQL Editor. Aendert von sich aus keine
-- Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — DIE UMSETZUNG, EINMAL
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.apply_google_location_selection(
  p_location_id           uuid,
  p_user_id               uuid,
  p_require_active_account boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_treffer integer;
  v_erlaubt boolean;
begin
  if p_location_id is null or p_user_id is null then
    return false;
  end if;

  /* ── 1. Eigentum pruefen ──
     Zwei Strengegrade, siehe Kopf der Migration. Beide verlangen:
     der Standort gehoert dem Nutzer und ist nicht geloescht. */
  if p_require_active_account then
    select exists (
      select 1
        from public.google_locations l
        join public.google_accounts a on a.id = l.account_id
       where l.id = p_location_id and l.user_id = p_user_id
         and a.user_id = p_user_id and a.status = 'active'
         and l.deleted_at is null and a.deleted_at is null
    ) into v_erlaubt;
  else
    select exists (
      select 1
        from public.google_locations l
       where l.id = p_location_id and l.user_id = p_user_id
         and l.deleted_at is null
    ) into v_erlaubt;
  end if;

  if not v_erlaubt then
    return false;
  end if;

  /* ── 2. Gleichzeitige Wechsel serialisieren ──
     Ohne das koennten zwei parallele Aufrufe beide Schritt 3
     ausfuehren und danach beide Schritt 4 — der zweite liefe in
     denselben Unique-Verstoss. Derselbe Schluessel wie in
     auto_select_single_location, damit sich die Wege gegenseitig
     sehen. Der Lock endet mit der Transaktion. */
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  /* ── 3. Bisherige Auswahl zuruecksetzen ──
     Getrennt von Schritt 4 — der Kern der Behebung aus
     20260929090000: Eine gemeinsame Anweisung verletzt den
     Unique-Index, weil die Zeilenreihenfolge im UPDATE nicht
     festgelegt ist.

     id <> p_location_id laesst eine bestehende Auswahl auf DEMSELBEN
     Betrieb unberuehrt: Ein zweiter Klick aendert nichts. */
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

  return v_treffer = 1;
end;
$$;

revoke all on function public.apply_google_location_selection(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_google_location_selection(uuid, uuid, boolean)
  to service_role;

comment on function public.apply_google_location_selection(uuid, uuid, boolean) is
  'Setzt die Betriebsauswahl eines Nutzers. Zuruecksetzen und Setzen sind getrennte Anweisungen unter einem Advisory-Lock — eine gemeinsame verletzt google_locations_one_selected_per_user. Nicht direkt aufrufen: select_google_location (Dashboard) oder activate_google_location (Mail-Link).';

/* ═══════════════════════════════════════════════════════════════
   2 — EINGANG 1: DER KUNDE WAEHLT IM DASHBOARD
   ═══════════════════════════════════════════════════════════════

   Nach aussen unveraendert: gleiche Signatur, gleiche Pruefung,
   gleicher Rueckgabewert. Nur der Rumpf delegiert jetzt.
   Die Regressionspruefung dazu steht in
   supabase/tests/standortwechsel.test.sql, Abschnitt 6. */

create or replace function public.select_google_location(p_location_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.apply_google_location_selection(p_location_id, p_user_id, true);
$$;

revoke all on function public.select_google_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public.select_google_location(uuid, uuid) to service_role;

comment on function public.select_google_location(uuid, uuid) is
  'Waehlt genau einen Betrieb pro Nutzer aus — der Weg fuer die Auswahl im Dashboard. Verlangt ein aktives Google-Konto. Umsetzung in apply_google_location_selection.';

/* ═══════════════════════════════════════════════════════════════
   3 — EINGANG 2: EIN MAIL-LINK ZEIGT AUF EINEN BETRIEB
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.activate_google_location(p_location_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.apply_google_location_selection(p_location_id, p_user_id, false);
$$;

revoke all on function public.activate_google_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_google_location(uuid, uuid) to service_role;

comment on function public.activate_google_location(uuid, uuid) is
  'Stellt den ausgewaehlten Betrieb auf den Standort um, auf den ein Mail-Link zeigt. Verlangt kein aktives Google-Konto — sonst zeigte das Dashboard bei abgerissener Verbindung den falschen Betrieb. Umsetzung in apply_google_location_selection.';

/* ── Selbstpruefung ──
   Nur Rechte und Signaturen, keine Datenaenderung. Die Wirkung
   prueft supabase/tests/standortwechsel.test.sql. */
do $$
declare
  v_name text;
  v_oid  oid;
begin
  foreach v_name in array array[
    'apply_google_location_selection',
    'select_google_location',
    'activate_google_location'
  ] loop
    select p.oid into v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;

    if v_oid is null then
      raise exception '% fehlt nach der Migration', v_name;
    end if;

    if not pg_catalog.has_function_privilege('service_role', v_oid, 'execute') then
      raise exception 'service_role darf % nicht ausfuehren', v_name;
    end if;

    if pg_catalog.has_function_privilege('anon', v_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception '% ist fuer anon oder authenticated ausfuehrbar', v_name;
    end if;

    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid) then
      raise exception '% laeuft nicht als security definer', v_name;
    end if;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG IN PRODUKTION
-- ═══════════════════════════════════════════════════════════════
--
-- 1 — Wen betraf der Befund ueberhaupt? Nutzer mit mehr als einem
--     aktiven Standort (lesend):
--
--   select user_id, count(*) as standorte, count(selected_at) as gewaehlt
--     from public.google_locations
--    where deleted_at is null
--    group by user_id
--   having count(*) > 1;
--
-- 2 — Wechsel ueber den Mail-Weg, fuer einen dieser Nutzer:
--
--   select public.activate_google_location('<andere-location-uuid>', '<user-uuid>');
--   select id, title, selected_at, is_primary
--     from public.google_locations where user_id = '<user-uuid>';
--
--   Erwartet: true, und GENAU EINE Zeile mit selected_at is not null.
--   Vorher: 23505, geschluckt, keine Aenderung.
--
-- 3 — Dashboard-Weg unveraendert (aktives Konto noetig):
--
--   select public.select_google_location('<location-uuid>', '<user-uuid>');
--
--   Erwartet: true bei aktivem Konto, false ohne.
