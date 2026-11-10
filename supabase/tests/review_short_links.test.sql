-- WP14.2 — Kurzer Bewertungslink: Datenbankseite.
--
--   scripts/test-db/run.sh review_short_links
--
--   T7   gueltiger Code → place_id des Standorts (Redirect baut daraus den Google-Link)
--   T8   unbekannter Code → null
--   T9   widerrufener Code → null
--   T10  geloeschter Standort → null (soft) / Zeile weg (hard, cascade)
--   T11  Standort ohne place_id → null
--   T12  Code opak: 7 Zeichen [A-Za-z0-9], nicht aus IDs ableitbar
--   T13  gleicher Standort → gleicher aktiver Code
--   T14  zwei Standorte → verschiedene Codes
--   T15  fremder Nutzer kann keinen Code erzeugen
--   Rechte: nur service_role

\set ON_ERROR_STOP on

begin;
select test.basis();
select test.fremder();
do $$
declare
  v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v_si uuid := test.id('standort_si'); v_wr uuid := test.id('standort_werkruf');
  c1 text; c2 text; c3 text; v_ok boolean; f text;
begin
  update public.google_locations set place_id = 'ChIJ_SI_PlaceId_0123456789' where id = v_si;
  update public.google_locations set place_id = null where id = v_wr;

  /* T12/T13 — opak, stabil */
  c1 := public.ensure_review_short_link(v_a, v_si);
  assert c1 ~ '^[A-Za-z0-9]{7}$', format('T12: Codeform %s', c1);
  assert position(substr(replace(v_si::text, '-', ''), 1, 5) in c1) = 0 and position(substr(replace(v_a::text, '-', ''), 1, 5) in c1) = 0, 'T12: Code traegt ID-Fragment';
  assert c1 <> 'ChIJ_SI' and position('ChIJ' in c1) = 0, 'C2: place_id als Code';
  c2 := public.ensure_review_short_link(v_a, v_si);
  assert c1 = c2, 'T13: zweiter Aufruf anderer Code';
  assert (select count(*) from public.review_short_links where location_id = v_si) = 1, 'T13: zweite Zeile';

  /* T7 — Lookup liefert place_id, nichts sonst */
  assert public.review_short_link_place_id(c1) = 'ChIJ_SI_PlaceId_0123456789', 'T7: Lookup';
  /* T8 */
  assert public.review_short_link_place_id('zzzzzzz') is null, 'T8: unbekannt liefert etwas';
  assert public.review_short_link_place_id(null) is null, 'T8: null';

  /* T14 — zweiter Standort (ohne place_id → Code moeglich, Lookup aber null = T11) */
  c3 := public.ensure_review_short_link(v_a, v_wr);
  assert c3 <> c1, 'T14: gleicher Code fuer zwei Standorte';
  assert public.review_short_link_place_id(c3) is null, 'T11: Standort ohne place_id redirectet';
  update public.google_locations set place_id = 'ChIJ_WR_PlaceId' where id = v_wr;
  assert public.review_short_link_place_id(c3) = 'ChIJ_WR_PlaceId', 'T11b: nach place_id aufloesbar';

  /* T9 — widerrufen */
  update public.review_short_links set active = false, revoked_at = now() where code = c1;
  assert public.review_short_link_place_id(c1) is null, 'T9: widerrufener Code aufloesbar';
  c2 := public.ensure_review_short_link(v_a, v_si);
  assert c2 <> c1 and public.review_short_link_place_id(c2) is not null, 'T9b: kein neuer Code nach Widerruf';

  /* T10 — soft delete → null; hard delete → cascade */
  update public.google_locations set deleted_at = now() where id = v_si;
  assert public.review_short_link_place_id(c2) is null, 'T10: geloeschter Standort aufloesbar';
  delete from public.google_locations where id = v_si;
  assert (select count(*) from public.review_short_links where location_id = v_si) = 0, 'T10: Waisen';

  /* T15 — fremder Nutzer */
  v_ok := false;
  begin perform public.ensure_review_short_link(v_b, v_wr); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'T15: fremder Nutzer erzeugte Code';

  /* Rechte */
  foreach f in array array['public.review_short_code_zufall()', 'public.ensure_review_short_link(uuid,uuid)', 'public.review_short_link_place_id(text)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  assert not pg_catalog.has_table_privilege('authenticated', 'public.review_short_links', 'SELECT'), 'Rechte: authenticated liest Links';
  set local role anon;
  v_ok := false;
  begin perform public.review_short_link_place_id(c3); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'Rechte: anon konnte Lookup ausfuehren';
  reset role;
end $$;
rollback;

select '[wp14.2] review_short_links: alle Abschnitte bestanden' as ergebnis;
