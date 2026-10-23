-- 20261023120000_onboarding_abschluss.sql
--
-- Onboarding-Zustand datenbankfest: user_profiles.onboarding_completed_at
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND (WP2, 23.10.2026)
-- ═══════════════════════════════════════════════════════════════
--
-- "Testphase starten" setzt eine Onboarding-Absicht — im
-- sessionStorage des Tabs. Sie traegt den Nutzer von der Startseite
-- nach /onboarding und startet auf der Verbindungsseite den
-- Business-OAuth von selbst. Das funktioniert, solange alles in EINEM
-- Tab passiert.
--
-- Der E-Mail-Weg passiert nicht in einem Tab: Der Bestaetigungslink
-- oeffnet einen neuen. Dort gibt es keine Absicht. Folge: Rueckfall
-- auf /, kein Weiterleiten, auf der Verbindungsseite kein Auto-Start,
-- ein zweiter manueller Klick. Genau der Bruch, den WP2 schliesst.
--
-- Die Absicht gehoert deshalb dorthin, wo sie jeden Tab, jeden
-- Browser und jede Bestaetigungsmail ueberlebt: ans Profil.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIE SPALTE SAGT — UND WAS NICHT
-- ═══════════════════════════════════════════════════════════════
--
--   onboarding_completed_at IS NULL      → Einrichtung noch offen.
--                                          Weiche und Auto-Start duerfen.
--   onboarding_completed_at IS NOT NULL  → fertig. Nie wieder
--                                          automatisch OAuth, nie
--                                          wieder Weiterleiten von /.
--
-- Gesetzt wird sie an GENAU EINER Stelle: in
-- apply_google_location_selection(), dem einen Weg, ueber den jede
-- Betriebsauswahl laeuft (Dashboard-Klick, Auto-Auswahl bei einem
-- Betrieb, Mail-Link). Die erste erfolgreiche Auswahl ist das Ende
-- des Onboardings. Kein Frontend-Flag entscheidet das.
--
-- Sie ist KEINE Sicherheitsentscheidung. Wer was darf, regeln RLS,
-- Eigentumspruefungen und die OAuth-Zustaende wie bisher. Die Spalte
-- entscheidet nur, ob die Oberflaeche einen Nutzer an die Hand nimmt.
--
-- ═══════════════════════════════════════════════════════════════
-- BESTAND: ALLE VORHANDENEN PROFILE GELTEN ALS FERTIG
-- ═══════════════════════════════════════════════════════════════
--
-- Ein bestehender Kunde darf beim naechsten Login nicht wie ein
-- Neukunde durch den Business-OAuth geschickt werden — auch dann
-- nicht, wenn er seine Verbindung nie hergestellt oder wieder
-- verloren hat. Fuer ihn gibt es die Reauth-Zustaende und den Knopf.
-- Deshalb werden ALLE Profile, die es beim Einspielen schon gibt,
-- als abgeschlossen markiert. Nur Profile, die danach entstehen,
-- beginnen mit NULL.
--
-- Das ist bewusst konservativ. Der Preis: Wer sich gestern
-- registriert und noch nicht zugestimmt hat, bekommt den Einmalweg
-- nicht nachtraeglich. Er bekommt den bisherigen Weg mit einem Klick
-- mehr. Das ist der kleinere Fehler.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Spalte
   ═══════════════════════════════════════════════════════════════ */
alter table public.user_profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.user_profiles.onboarding_completed_at is
  'Zeitpunkt der ersten erfolgreichen Betriebsauswahl = Ende des Onboardings. '
  'NULL = Einrichtung offen (Weiche und Auto-OAuth duerfen). Gesetzt nur in apply_google_location_selection(). '
  'Bestand beim Einspielen (23.10.2026) pauschal als fertig markiert.';

/* ═══════════════════════════════════════════════════════════════
   2 — Bestand: fertig
   ═══════════════════════════════════════════════════════════════
   Wiederholbar: Nur Zeilen, die noch NULL sind und VOR dieser
   Migration entstanden. Beim zweiten Lauf gibt es keine solchen. */
do $$
declare v_anzahl integer;
begin
  update public.user_profiles
     set onboarding_completed_at = pg_catalog.now()
   where onboarding_completed_at is null
     and created_at < pg_catalog.now();
  get diagnostics v_anzahl = row_count;
  raise notice '[onboarding] % Bestandsprofil(e) als abgeschlossen markiert', v_anzahl;
end $$;

/* ═══════════════════════════════════════════════════════════════
   3 — apply_google_location_selection(): Abschluss setzen
   ═══════════════════════════════════════════════════════════════
   Wortgleich zur Fassung aus 20261013120000 (Schritte 1–4), plus
   Schritt 5. Signatur, Rechte, Rueckgabe unveraendert. */
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

  /* ── 5. Einrichtung abgeschlossen (NEU, 23.10.2026, WP2) ──
     Die erste erfolgreiche Betriebsauswahl beendet das Onboarding —
     egal ob automatisch (ein Betrieb), per Klick (mehrere) oder ueber
     den Mail-Link. coalesce: einmal gesetzt, nie wieder verschoben. */
  if v_treffer = 1 then
    update public.user_profiles
       set onboarding_completed_at = coalesce(onboarding_completed_at, pg_catalog.now())
     where id = p_user_id;
  end if;

  return v_treffer = 1;
end;
$$;

revoke all on function public.apply_google_location_selection(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_google_location_selection(uuid, uuid, boolean)
  to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════ */
do $$
declare v_def text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_profiles'
                    and column_name = 'onboarding_completed_at') then
    raise exception '[onboarding] Spalte fehlt';
  end if;
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_google_location_selection';
  if position('onboarding_completed_at' in v_def) = 0 then
    raise exception '[onboarding] apply_google_location_selection setzt den Abschluss nicht';
  end if;
  if position('pg_advisory_xact_lock' in v_def) = 0 then
    raise exception '[onboarding] Advisory-Lock beim Neuanlegen verloren';
  end if;
  if exists (select 1 from public.user_profiles where onboarding_completed_at is null
                and created_at < pg_catalog.now() - interval '1 minute') then
    raise exception '[onboarding] Bestandsprofile ohne Abschluss uebrig';
  end if;
  raise notice '[onboarding] in Ordnung — Spalte, Bestand, Funktion';
end $$;

commit;
