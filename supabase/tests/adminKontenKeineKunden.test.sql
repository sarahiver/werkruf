-- Admin-Konten sind keine Kunden (19.11.2026).
--
--   scripts/test-db/run.sh adminKonten
--
--   K1  ist_internes_konto(): Rolle admin → true, sonst false, unbekannt → false
--   K2  interne_konten(): genau die Admin-IDs
--   K3  FP-Cockpit: Admin mit Plan founding_partner erscheint weder in der
--       Liste noch in den KPIs; echter FP bleibt
--   K4  Entscheidung ueber die Rolle — dieselbe E-Mail ohne Rolle zaehlt
--   K5  Rechte: nur service_role

\set ON_ERROR_STOP on

begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_b uuid := test.id('user_b'); v jsonb;
begin
  perform test.benutzer('user_b', 'inhaber@example.test', 'Zweitbetrieb GmbH', 'handwerk');
  perform public.set_founding_partner(v_a, 'Test');
  perform public.set_founding_partner(v_b, 'Test');

  /* vorher: zwei FPs */
  v := public.fp_cockpit_overview();
  assert jsonb_array_length(v -> 'partners') = 2 and (v -> 'kpis' ->> 'foundingPartners')::int = 2, format('vorher: %s', v -> 'kpis');

  /* user_a wird Admin */
  update auth.users set raw_app_meta_data = jsonb_build_object('role', 'admin', 'provider', 'email') where id = v_a;

  /* K1 */
  assert public.ist_internes_konto(v_a), 'K1: Admin nicht erkannt';
  assert not public.ist_internes_konto(v_b), 'K1: Kunde als intern erkannt';
  assert not public.ist_internes_konto(gen_random_uuid()), 'K1: unbekanntes Konto intern';
  /* K2 */
  assert (select array_agg(x) from public.interne_konten() x) = array[v_a], 'K2: interne_konten falsch';

  /* K3 */
  v := public.fp_cockpit_overview();
  assert jsonb_array_length(v -> 'partners') = 1, format('K3: %s Partner', jsonb_array_length(v -> 'partners'));
  assert (v -> 'partners' -> 0 ->> 'userId')::uuid = v_b, 'K3: falscher Partner uebrig';
  assert (v -> 'kpis' ->> 'foundingPartners')::int = 1, format('K3: KPI %s', v -> 'kpis');
  /* Konto selbst unveraendert */
  assert (select plan from public.user_profiles where id = v_a) = 'founding_partner', 'K3: Plan geaendert';

  /* K4 — Rolle weg → zaehlt wieder (keine E-Mail-/ID-Regel) */
  update auth.users set raw_app_meta_data = '{}'::jsonb where id = v_a;
  assert jsonb_array_length(public.fp_cockpit_overview() -> 'partners') = 2, 'K4: ohne Rolle nicht wieder sichtbar';
end $$;
rollback;

/* K5 */
do $$
declare f text;
begin
  foreach f in array array['public.ist_internes_konto(uuid)', 'public.interne_konten()'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('K5: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('K5: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('K5: service_role darf %s nicht', f);
  end loop;
end $$;
