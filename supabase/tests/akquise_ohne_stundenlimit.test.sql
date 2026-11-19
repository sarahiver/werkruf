-- Akquise ohne Stundenlimit: 25 Mail-1-Versände direkt hintereinander gehen
-- durch; die übrigen Schutzprüfungen bleiben wirksam.
--
--   scripts/test-db/run.sh akquise_ohne

\set ON_ERROR_STOP on

create or replace function pg_temp.lead(p_n int) returns uuid language sql as $$
  select public.acquisition_lead_create('00000000-0000-4000-8000-00000000ad01',
    jsonb_build_object('company_name', 'Betrieb ' || p_n, 'email', 'b' || p_n || '@example.test',
                       'google_profile_finding', 'Du hast 7 Bewertungen.', 'finding_type', 'wenige_bewertungen'))
$$;
create or replace function pg_temp.mail1(p_lead uuid, p_key text) returns jsonb language plpgsql as $$
declare v text;
begin
  v := public.acquisition_assign_subject_variant(p_lead);
  return public.acquisition_outreach_send('00000000-0000-4000-8000-00000000ad01', p_lead, p_key, 'outreach_erstkontakt',
    'Deine Google-Bewertungen', 'production', jsonb_build_object('variante', v, 'text', 'Moin'));
end $$;

begin;
select test.basis();
do $$
declare i int; v uuid; r jsonb; v_erster uuid;
begin
  for i in 1..25 loop
    v := pg_temp.lead(i);
    if i = 1 then v_erster := v; end if;
    r := pg_temp.mail1(v, 'key-l-' || lpad(i::text, 10, '0'));
    assert (r ->> 'ok')::boolean, format('L1: Versand %s abgelehnt: %s', i, r);
  end loop;
  assert (select count(*) from public.outreach_messages where created_at > now() - interval '1 hour') = 25, 'L1: nicht 25 Nachrichten';

  /* L2 — Schutz bleibt: derselbe Schlüssel → dieselbe Nachricht; zweiter Versand an denselben Lead → läuft bereits */
  r := pg_temp.mail1(v_erster, 'key-l-0000000001');
  assert (r ->> 'reused')::boolean, format('L2: Idempotenz %s', r);
  r := pg_temp.mail1(v_erster, 'key-l-neu0000001');
  assert r ->> 'reason' = 'laeuft_bereits', format('L2: zweiter Versand %s', r);
  assert (select count(*) from public.outreach_messages) = 25, 'L2: zusaetzliche Nachricht';
end $$;
rollback;
