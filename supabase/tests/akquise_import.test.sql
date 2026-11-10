-- WP16.1 — Lead-Import (CSV + Inbox): Datenbankseite.
--
--   scripts/test-db/run.sh akquise_import
--
--   A  Preview schreibt nichts; Commit legt nur new an (Status neu, Herkunft)
--   B  Dedupe: Mail (case-insensitive), in der Datei, Website-Host, geteilte
--      Plattform-Hosts, Google-Profil, geloeschte Leads, bestehender Lead unveraendert
--   C  Idempotenz: gleicher Import → reused, nichts doppelt; neuer Import → Dubletten
--   D  Ungueltige Zeilen nie angelegt; Grenzen (1000, Modus, Kanal, Quelle)
--   E  Inbox-Kanal: Herkunft, created_by null; KEINE Mail, KEIN Status ausser neu
--   F  Lead-Kanon: SmartCheck-Insert und claim_own_lead mit importiertem Lead
--   G  Uebersicht: Filter je Import, kpi.neu
--   H  Rechte; Race-Schutz (Advisory-Lock)

\set ON_ERROR_STOP on

create or replace function pg_temp.als(p_user uuid) returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', p_user);
end $$;
/* Zeile wie aus bereiteImportVor */
create or replace function pg_temp.z(p_i int, p_firma text, p_mail text, p_extra jsonb default '{}'::jsonb, p_fehler text default null) returns jsonb language sql as $$
  select jsonb_build_object('i', p_i,
    'werte', case when p_fehler is null then jsonb_build_object('company_name', p_firma, 'email', p_mail) || p_extra end,
    'quelle', p_extra ->> 'source', 'fehler', p_fehler)
$$;
create or replace function pg_temp.imp(p_mode text, p_id text, p_rows jsonb, p_channel text default 'csv', p_source text default 'csv') returns jsonb language sql as $$
  select public.acquisition_import_rows(p_mode, p_channel, p_source, p_id, p_rows, case when p_channel = 'csv' then '00000000-0000-4000-8000-00000000ad01'::uuid end)
$$;

/* ═══ A — Preview schreibt nichts; Commit nur new ═══ */
begin;
do $$
declare r jsonb; v_leads int; v_imps int; v_rows jsonb; rec record;
begin
  v_rows := jsonb_build_array(
    pg_temp.z(2, 'Elektro Krause', 'info@krause.de', '{"city":"Kiel","contact_person":"Jens","personalized_sentence":"Satz","source":"chatgpt_recherche"}'),
    pg_temp.z(3, 'Dach Hansen', 'hansen@dach.de'),
    pg_temp.z(4, 'Kaputt', null, '{}', 'E-Mail ist ungültig'));
  select count(*) into v_leads from public.leads; select count(*) into v_imps from public.acquisition_imports;

  /* T38 Preview schreibt nichts */
  r := pg_temp.imp('preview', 'csv-test-a-0001', v_rows);
  assert (r -> 'counts' ->> 'new')::int = 2 and (r -> 'counts' ->> 'invalid')::int = 1 and (r -> 'counts' ->> 'rows')::int = 3, format('A preview: %s', r);
  assert r ->> 'importId' is null, 'A: Preview hat Batch-ID';
  assert (select count(*) from public.leads) = v_leads, 'C2: Preview schrieb leads';
  assert (select count(*) from public.acquisition_imports) = v_imps, 'C2: Preview schrieb acquisition_imports';

  /* Commit schreibt nur new */
  r := pg_temp.imp('commit', 'csv-test-a-0001', v_rows);
  assert (r -> 'counts' ->> 'new')::int = 2 and r ->> 'importId' is not null and (r ->> 'reused')::boolean = false, format('A commit: %s', r);
  assert (select count(*) from public.leads) = v_leads + 2, 'A: nicht genau 2 Leads';
  select * into rec from public.leads where email = 'info@krause.de';
  assert rec.status = 'new' and rec.acquisition_status = 'neu' and rec.source = 'akquise_import' and rec.acquisition_import_id = (r ->> 'importId')::uuid, 'A: Felder';
  assert rec.city = 'Kiel' and rec.contact_person = 'Jens' and rec.personalized_sentence = 'Satz' and rec.acquisition_source = 'chatgpt_recherche' and rec.phone = '-', 'A: Werte';
  assert (select acquisition_source from public.leads where email = 'hansen@dach.de') = 'csv', 'A: Quelle Fallback';
  /* leadId je Zeile fuer das Zurueckschreiben (werkruf_lead_id) */
  assert (select count(*) from jsonb_array_elements(r -> 'rows') x where x ->> 'status' = 'new' and x ->> 'leadId' is not null) = 2, 'A: leadId fehlt';
  select * into rec from public.acquisition_imports where id = (r ->> 'importId')::uuid;
  assert rec.row_count = 3 and rec.new_count = 2 and rec.invalid_count = 1 and rec.committed_at is not null and rec.channel = 'csv', 'A: Batch-Zaehler';
end $$;
rollback;

/* ═══ B — Dedupe ═══ */
begin;
do $$
declare r jsonb; v_alt uuid; v_vorher jsonb; v_nachher jsonb; st text;
begin
  /* Bestand: ein Lead mit Website und Google-Profil, ein geloeschter, ein Facebook-Lead */
  insert into public.leads (company_name, contact_person, phone, email, source, status, website, google_profile_url, acquisition_status)
  values ('Bestand GmbH', 'Alt', '-', 'Chef@Bestand.DE', 'admin_akquise', 'new', 'https://www.bestand.de/kontakt', 'https://maps.google.com/?cid=123', 'angeschrieben')
  returning id into v_alt;
  insert into public.leads (company_name, contact_person, phone, email, source, status, website)
  values ('Geloescht', '-', '-', 'deleted@werkruf.com', 'smart_check', 'deleted', 'https://geloescht.de');
  insert into public.leads (company_name, contact_person, phone, email, source, status, website, acquisition_status)
  values ('FB Betrieb', '-', '-', 'fb@betrieb.de', 'admin_akquise', 'new', 'https://facebook.com/fbbetrieb', 'neu');
  select to_jsonb(l) - 'updated_at' into v_vorher from public.leads l where id = v_alt;

  r := pg_temp.imp('commit', 'csv-test-b-0001', jsonb_build_array(
    pg_temp.z(2, 'Bestand Neu', '  CHEF@bestand.de ', '{"note":"darf nichts ueberschreiben","city":"Anders"}'),   -- Mail-Dublette (Gross/Klein, Leerzeichen)
    pg_temp.z(3, 'Zwilling A', 'zwilling@x.de'),
    pg_temp.z(4, 'Zwilling B', 'ZWILLING@x.de'),                                  -- in der Datei doppelt
    pg_temp.z(5, 'Gleiche Website', 'andere@mail.de', '{"website":"http://bestand.de"}'),   -- Host-Match
    pg_temp.z(6, 'Gleiches Google', 'noch@andere.de', '{"google_profile_url":"maps.google.com/?cid=123/"}'),
    pg_temp.z(7, 'Anderer FB', 'fb2@betrieb.de', '{"website":"https://www.facebook.com/anderer"}'),   -- geteilter Host, anderer Pfad → neu
    pg_temp.z(8, 'Gleicher FB', 'fb3@betrieb.de', '{"website":"facebook.com/fbbetrieb/"}'),         -- gleiche volle URL → pruefen
    pg_temp.z(9, 'War geloescht', 'neu@geloescht.de', '{"website":"https://geloescht.de"}')       -- geloeschte Leads zaehlen nicht
  ));
  for st in select x ->> 'status' from jsonb_array_elements(r -> 'rows') x order by (x ->> 'i')::int loop null; end loop;
  assert (select string_agg(x ->> 'status', ',' order by (x ->> 'i')::int) from jsonb_array_elements(r -> 'rows') x)
       = 'duplicate,new,duplicate_in_import,possible_duplicate,possible_duplicate,new,possible_duplicate,new',
         format('B: %s', (select string_agg(x ->> 'status', ',' order by (x ->> 'i')::int) from jsonb_array_elements(r -> 'rows') x));
  assert (select x ->> 'leadId' from jsonb_array_elements(r -> 'rows') x where (x ->> 'i')::int = 2) = v_alt::text, 'B: Dublette ohne Verweis auf bestehenden Lead';
  /* bestehender Lead unveraendert */
  select to_jsonb(l) - 'updated_at' into v_nachher from public.leads l where id = v_alt;
  assert v_nachher = v_vorher, 'C4: bestehender Lead veraendert';
  assert (select count(*) from public.leads where lower(btrim(email)) = 'chef@bestand.de') = 1, 'B: Dublette angelegt';
  assert (select count(*) from public.leads where email in ('andere@mail.de', 'noch@andere.de', 'fb3@betrieb.de')) = 0, 'B: moegliche Dublette angelegt';
  assert (select count(*) from public.leads where email in ('zwilling@x.de', 'fb2@betrieb.de', 'neu@geloescht.de')) = 3, 'B: neue nicht angelegt';
  /* Normalisierung */
  assert public.acquisition_website_key('HTTPS://WWW.Bestand.de:443/a?b=1#c') = 'host:bestand.de', 'B: Host-Normalisierung';
  assert public.acquisition_website_key('https://facebook.com/x') <> public.acquisition_website_key('https://facebook.com/y'), 'B: Facebook-Hosts gleich gewertet';
  assert public.acquisition_google_key('https://www.Google.com/maps/place/X/') = public.acquisition_google_key('google.com/maps/place/x'), 'B: Google-Normalisierung';
  assert public.acquisition_website_key('') is null and public.acquisition_google_key(null) is null, 'B: leer';
end $$;
rollback;

/* ═══ C — Idempotenz ═══ */
begin;
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb; v_rows jsonb; v_n int;
begin
  v_rows := jsonb_build_array(pg_temp.z(2, 'Eins', 'eins@x.de'), pg_temp.z(3, 'Zwei', 'zwei@x.de'));
  r1 := pg_temp.imp('commit', 'csv-test-c-0001', v_rows);
  select count(*) into v_n from public.leads;
  /* Doppelklick / Wiederholung: gleiche Import-ID */
  r2 := pg_temp.imp('commit', 'csv-test-c-0001', v_rows);
  assert (r2 ->> 'reused')::boolean and r2 ->> 'importId' = r1 ->> 'importId' and (r2 -> 'counts' ->> 'new')::int = 2, format('C: %s', r2);
  assert (select count(*) from public.leads) = v_n, 'C: zweiter Commit legte an';
  assert (select count(*) from public.acquisition_imports where external_import_id = 'csv-test-c-0001') = 1, 'C: Batch doppelt';
  /* Neuer Import mit denselben Zeilen: alles Dubletten */
  r3 := pg_temp.imp('commit', 'csv-test-c-0002', v_rows);
  assert (r3 -> 'counts' ->> 'new')::int = 0 and (r3 -> 'counts' ->> 'duplicate')::int = 2, format('C: neuer Import %s', r3);
  assert (select count(*) from public.leads) = v_n, 'C: Dubletten angelegt';
  /* Gleiche Import-ID, anderer Kanal → eigener Batch (Inbox ≠ CSV) */
  r3 := pg_temp.imp('commit', 'csv-test-c-0001', jsonb_build_array(pg_temp.z(1, 'Drei', 'drei@x.de')), 'inbox', 'chatgpt_recherche');
  assert (r3 ->> 'reused')::boolean = false and (r3 -> 'counts' ->> 'new')::int = 1, 'C: Kanaltrennung';
end $$;
rollback;

/* ═══ D — Ungueltig, Grenzen ═══ */
begin;
do $$
declare r jsonb; v_ok boolean; v_n int; v_viele jsonb;
begin
  select count(*) into v_n from public.leads;
  r := pg_temp.imp('commit', 'csv-test-d-0001', jsonb_build_array(
    pg_temp.z(2, 'X', null, '{}', 'E-Mail ist ungültig'),
    jsonb_build_object('i', 3, 'werte', jsonb_build_object('company_name', '', 'email', 'a@b.de')),        -- zweite Verteidigung: Firma leer
    jsonb_build_object('i', 4, 'werte', jsonb_build_object('company_name', 'Y', 'email', 'kaputt')),       -- zweite Verteidigung: Mail
    jsonb_build_object('i', 5, 'werte', to_jsonb('unsinn'::text))));
  assert (r -> 'counts' ->> 'invalid')::int = 4 and (r -> 'counts' ->> 'new')::int = 0, format('D: %s', r);
  assert (select count(*) from public.leads) = v_n, 'D: Ungueltige angelegt';
  assert (select x ->> 'grund' from jsonb_array_elements(r -> 'rows') x where (x ->> 'i')::int = 3) = 'Betrieb (company_name) fehlt', 'D: Grund';

  select jsonb_agg(pg_temp.z(g, 'B' || g, 'b' || g || '@x.de')) into v_viele from generate_series(1, 1001) g;
  v_ok := false; begin perform pg_temp.imp('preview', 'csv-test-d-0002', v_viele); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'D: 1001 Zeilen angenommen';
  v_ok := false; begin perform pg_temp.imp('upsert', 'csv-test-d-0003', '[]'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'D: Modus upsert angenommen';
  v_ok := false; begin perform pg_temp.imp('commit', 'csv-test-d-0004', '[]', 'mail'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'D: Kanal mail angenommen';
  v_ok := false; begin perform pg_temp.imp('commit', 'csv-test-d-0005', '[]', 'inbox', 'Böse Quelle!'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'D: Quelle mit Sonderzeichen angenommen';
  v_ok := false; begin perform pg_temp.imp('commit', 'x', '[]'); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'D: Import-ID zu kurz angenommen';
end $$;
rollback;

/* ═══ E — Inbox: nur Leads, keine Mail, kein anderer Status ═══ */
begin;
do $$
declare r jsonb; v_q int; v_m int; v_e int;
begin
  select count(*) into v_q from public.email_queue; select count(*) into v_m from public.outreach_messages; select count(*) into v_e from public.outreach_email_events;
  r := pg_temp.imp('commit', 'recherche-2026-11-10', jsonb_build_array(pg_temp.z(1, 'Inbox Betrieb', 'inbox@betrieb.de', '{"personalized_sentence":"Recherche-Satz"}')), 'inbox', 'chatgpt_recherche');
  assert (r -> 'counts' ->> 'new')::int = 1, format('E: %s', r);
  assert (select source from public.leads where email = 'inbox@betrieb.de') = 'akquise_inbox', 'E: source';
  assert (select acquisition_source from public.leads where email = 'inbox@betrieb.de') = 'chatgpt_recherche', 'E: Herkunft';
  assert (select created_by from public.acquisition_imports where id = (r ->> 'importId')::uuid) is null, 'E: created_by';
  /* C6: keine Mail, kein Versand, keine Ereignisse */
  assert (select count(*) from public.email_queue) = v_q and (select count(*) from public.outreach_messages) = v_m and (select count(*) from public.outreach_email_events) = v_e, 'C6: Import erzeugte Mail/Versand';
  assert (select acquisition_status from public.leads where email = 'inbox@betrieb.de') = 'neu' and (select last_outreach_at from public.leads where email = 'inbox@betrieb.de') is null, 'E: Status nicht neu';
end $$;
rollback;

/* ═══ F — Lead-Kanon: SmartCheck + claim_own_lead ═══ */
begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); r jsonb; v_lead uuid;
begin
  /* T4 SmartCheck-Weg schreibt weiter wie bisher */
  insert into public.leads (company_name, contact_person, phone, email, source, status, industry_key, visibility_score)
  values ('Smart', '-', '-', 'smart@check.de', 'smart_check', 'new', 'handwerk', 50);
  /* importierter Lead fuer die Mail eines Nutzers → claim greift wie bei jedem Lead */
  r := pg_temp.imp('commit', 'csv-test-f-0001', jsonb_build_array(pg_temp.z(2, 'Claim Betrieb', 'user_a@example.test', '{"city":"Kiel"}')));
  v_lead := ((r -> 'rows' -> 0) ->> 'leadId')::uuid;
  update public.user_profiles set city = null where id = v_a;
  perform pg_temp.als(v_a);
  assert public.claim_own_lead(), 'T4: claim_own_lead false';
  assert (select status from public.leads where id = v_lead) = 'converted', 'T4: Lead nicht converted';
  assert (select acquisition_status from public.leads where id = v_lead) = 'neu', 'T4: claim aenderte Vertriebsstatus';
  /* SmartCheck-Lead danach unberuehrt, wird von Imports als Dublette erkannt */
  r := pg_temp.imp('preview', 'csv-test-f-0002', jsonb_build_array(pg_temp.z(2, 'Smart', 'SMART@check.de')));
  assert (r -> 'rows' -> 0) ->> 'status' = 'duplicate', 'F: SmartCheck-Lead nicht als Dublette erkannt';
end $$;
rollback;

/* ═══ G — Uebersicht: Importfilter, kpi.neu ═══ */
begin;
do $$
declare r jsonb; ov jsonb;
begin
  insert into public.leads (company_name, contact_person, phone, email, source, status, acquisition_status)
  values ('Manuell', '-', '-', 'manuell@x.de', 'admin_akquise', 'new', 'angeschrieben');
  r := pg_temp.imp('commit', 'csv-test-g-0001', jsonb_build_array(pg_temp.z(2, 'Imp A', 'impa@x.de'), pg_temp.z(3, 'Imp B', 'impb@x.de')));
  ov := public.acquisition_overview(null, null, 100, (r ->> 'importId')::uuid);
  assert jsonb_array_length(ov -> 'leads') = 2, format('G: Importfilter %s', jsonb_array_length(ov -> 'leads'));
  assert (ov -> 'leads' -> 0 ->> 'importId') = r ->> 'importId' and (ov -> 'leads' -> 0 ->> 'acquisitionSource') = 'csv', 'G: Felder';
  ov := public.acquisition_overview(null, null, 100, null);
  assert jsonb_array_length(ov -> 'leads') = 3 and (ov -> 'kpi' ->> 'neu')::int = 2 and (ov -> 'kpi' ->> 'leads')::int = 3, format('G: kpi %s', ov -> 'kpi');
  /* WP16-Aufruf mit benannten Parametern ohne p_import_id funktioniert weiter */
  ov := public.acquisition_overview(p_status => 'angeschrieben', p_suche => null, p_limit => 10);
  assert jsonb_array_length(ov -> 'leads') = 1, 'G: alter Aufruf';
end $$;
rollback;

/* ═══ H — Rechte, Race-Schutz ═══ */
begin;
do $$
declare f text; v_def text;
begin
  foreach f in array array['public.acquisition_import_rows(text,text,text,text,jsonb,uuid)', 'public.acquisition_overview(text,text,integer,uuid)'] loop
    assert not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'), format('Rechte: authenticated darf %s', f);
    assert not pg_catalog.has_function_privilege('anon', f, 'EXECUTE'), format('Rechte: anon darf %s', f);
    assert pg_catalog.has_function_privilege('service_role', f, 'EXECUTE'), format('Rechte: service_role darf %s nicht', f);
  end loop;
  assert not pg_catalog.has_table_privilege('authenticated', 'public.acquisition_imports', 'SELECT'), 'Rechte: authenticated liest acquisition_imports';
  assert not pg_catalog.has_table_privilege('anon', 'public.acquisition_imports', 'INSERT'), 'Rechte: anon schreibt acquisition_imports';
  select pg_get_functiondef('public.acquisition_import_rows(text,text,text,text,jsonb,uuid)'::regprocedure) into v_def;
  assert position('pg_advisory_xact_lock' in v_def) > 0, 'Race: kein Advisory-Lock';
  assert position('on conflict (channel, source, external_import_id) do nothing' in v_def) > 0, 'Race: kein Batch-Unique';
end $$;
rollback;

select '[wp16.1] akquise_import.test.sql in Ordnung' as ergebnis;
