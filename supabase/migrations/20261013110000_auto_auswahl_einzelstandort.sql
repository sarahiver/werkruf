-- ═══════════════════════════════════════════════════════════════
-- H1 P0 #5 — Automatische Auswahl bei genau EINEM Betrieb
-- ═══════════════════════════════════════════════════════════════
--
-- BEFUND
--
-- Nach dem Erstimport setzt NICHTS selected_at. ensurePrimary
-- (google-business/index.ts) setzt is_primary, nicht selected_at.
-- Damit steht ein frisch verbundener Betrieb mit genau einem Standort
-- auf selected_at = NULL, bis er selbst klickt — und waehrend dieser
-- Zeit widersprechen sich zwei Antworten auf dieselbe Frage:
--
--   werkruf_score_location (SQL)   nimmt bei genau einem Standort
--                                  diesen   → es gibt einen Score
--   useAusgewaehlterStandort (JS)  verlangt selected_at
--                                  → "kein Betrieb ausgewaehlt"
--
-- Fuer den Kunden heisst das: Kennzahlen da, Bewertungslink nicht.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE PRODUKTENTSCHEIDUNG, AUSGESCHRIEBEN
-- ═══════════════════════════════════════════════════════════════
--
-- Es gab zwei vertretbare Wege, und die Entscheidung ist bewusst
-- gefallen (nicht beilaeufig im Code):
--
--   a) Bei genau einem Standort automatisch auswaehlen.
--   b) Auch beim einzigen Standort eine Bestaetigung verlangen.
--
-- Gewaehlt ist (a), mit zwei Bedingungen:
--
--   NUR bei genau einem aktiven Standort.
--   Eine bestehende Auswahl wird NIE ueberschrieben.
--
-- Begruendung: Bei einem Standort gibt es nichts zu entscheiden. Eine
-- Rueckfrage mit genau einer moeglichen Antwort ist keine
-- Bestaetigung, sondern eine Huerde — und genau die Huerde, an der ein
-- Fremdkunde haengen bleibt ("Zu diesem Betrieb wechseln", ohne zu
-- verstehen, warum).
--
-- Bei ZWEI oder mehr Standorten bleibt es bei der Bestaetigung. Dort
-- ist die Auswahl eine echte Entscheidung: Der Bewertungslink wird
-- gedruckt und auf Rechnungen geklebt. Einen davon zu raten waere
-- schlimmer als zu fragen.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM KEINE NEUE AUSWAHLLOGIK
-- ═══════════════════════════════════════════════════════════════
--
-- Diese Funktion entscheidet nur, OB ausgewaehlt wird. Das Auswaehlen
-- selbst macht unveraendert select_google_location
-- (20260929090000) — mit Eigentumspruefung, Advisory-Lock, getrenntem
-- Zuruecksetzen und Setzen. Eine zweite Auswahlimplementierung waere
-- genau die Divergenz, die dieses Paket beseitigt.
--
-- Nebenwirkung, ausdruecklich gewollt: select_google_location setzt
-- auch is_primary. Bei genau einem Standort ist das derselbe Standort,
-- den ensurePrimary ohnehin setzt.
--
-- Wiederholbar. Laeuft im SQL Editor. Aendert von sich aus keine
-- Daten — erst ein Aufruf tut das.

begin;

create or replace function public.auto_select_single_location(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_anzahl  integer;
  v_erfolg  boolean;
begin
  if p_user_id is null then
    return null;
  end if;

  /* Gleichzeitige Laeufe serialisieren — zwei Standort-Syncs
     desselben Nutzers koennten sonst beide auswaehlen wollen.
     Derselbe Schluessel wie in select_google_location, damit sich
     beide Wege gegenseitig sehen. Der Lock ist transaktionsgebunden
     und wiedereintrittsfaehig: der spaetere Aufruf von
     select_google_location holt ihn ohne zu warten. */
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  /* ── 1. Eine bestehende Auswahl wird nie ueberschrieben ──
     Geloeschte Standorte zaehlen hier nicht: Deren selected_at ist
     fuer das Produkt unsichtbar (der Unique-Index und jede Abfrage
     filtern deleted_at is null). Eine alte Auswahl auf einem
     verschwundenen Betrieb darf den verbliebenen nicht blockieren. */
  if exists (
    select 1 from public.google_locations
     where user_id = p_user_id
       and deleted_at is null
       and selected_at is not null
  ) then
    return null;
  end if;

  /* ── 2. Nur bei genau einem aktiven Standort ──
     Bei mehreren entscheidet der Kunde. Bei keinem gibt es nichts
     auszuwaehlen. */
  select count(*) into v_anzahl
    from public.google_locations
   where user_id = p_user_id and deleted_at is null;

  if v_anzahl <> 1 then
    return null;
  end if;

  select id into v_id
    from public.google_locations
   where user_id = p_user_id and deleted_at is null;

  /* ── 3. Auswaehlen ueber den bestehenden Weg ──
     select_google_location prueft zusaetzlich, dass der Standort
     ueber ein aktives Google-Konto desselben Nutzers laeuft. Faellt
     die Pruefung durch, bleibt es bei keiner Auswahl — und das ist
     richtig: ohne aktives Konto ist der Standort nicht verwaltbar. */
  v_erfolg := public.select_google_location(v_id, p_user_id);

  if v_erfolg then
    return v_id;
  end if;

  return null;
end;
$$;

revoke all on function public.auto_select_single_location(uuid) from public, anon, authenticated;
grant execute on function public.auto_select_single_location(uuid) to service_role;

comment on function public.auto_select_single_location(uuid) is
  'Waehlt den einzigen aktiven Betrieb eines Nutzers automatisch aus. Nur bei genau einem Standort, und nie ueber eine bestehende Auswahl hinweg. Gibt die ausgewaehlte id zurueck, sonst NULL.';

/* ── Selbstpruefung ──
   Keine Datenaenderung: nur die Rechte und die Signatur. Eine
   Wirkungspruefung steht in supabase/tests/autoAuswahl.test.sql, wo
   Testdaten angelegt und wieder zurueckgerollt werden koennen. */
do $$
declare
  v_oid oid;
begin
  select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'auto_select_single_location';

  if v_oid is null then
    raise exception 'auto_select_single_location fehlt nach der Migration';
  end if;

  if not pg_catalog.has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'service_role darf auto_select_single_location nicht ausfuehren';
  end if;

  if pg_catalog.has_function_privilege('anon', v_oid, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'auto_select_single_location ist fuer anon oder authenticated ausfuehrbar';
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG IN PRODUKTION (lesend, ausser dem Aufruf selbst)
-- ═══════════════════════════════════════════════════════════════
--
-- 1 — Wen betrifft es heute? Nutzer mit genau einem aktiven Standort
--     und ohne Auswahl:
--
--   select user_id, count(*) as standorte
--     from public.google_locations
--    where deleted_at is null
--    group by user_id
--   having count(*) = 1
--      and count(selected_at) = 0;
--
-- 2 — Fuer einen davon aufrufen (setzt selected_at):
--
--   select public.auto_select_single_location('<user-uuid>');
--
--   Erwartet: die uuid des Standorts.
--
-- 3 — Zweiter Aufruf:
--
--   select public.auto_select_single_location('<user-uuid>');
--
--   Erwartet: NULL — es gibt jetzt eine Auswahl, und die wird nicht
--   angetastet.
--
-- 4 — Gegenprobe bei mehreren Standorten ohne Auswahl:
--
--   select public.auto_select_single_location('<user-uuid-mit-zwei>');
--
--   Erwartet: NULL, und keine Zeile mit selected_at.
