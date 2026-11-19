-- Foto-Beitraege: Sperre je Foto, Kunde liest nur eigene Zeilen, schreibt nie.
--   scripts/test-db/run.sh fotoBeitraege
\set ON_ERROR_STOP on

begin;
select test.basis();
do $$
declare v_a uuid := test.id('user_a'); v_loc uuid := test.id('standort_werkruf'); v_foto uuid; ok boolean;
begin
  insert into public.business_photos (profile_id, cloudinary_url, public_id)
  values (v_a, 'https://res.cloudinary.com/x/image/upload/a.jpg', 'a') returning id into v_foto;

  /* P1 — ein aktiver Beitrag je Foto */
  insert into public.photo_posts (user_id, location_id, photo_id, summary_snapshot) values (v_a, v_loc, v_foto, 'Text eins ist lang genug.');
  begin
    insert into public.photo_posts (user_id, location_id, photo_id, summary_snapshot) values (v_a, v_loc, v_foto, 'Text zwei ist lang genug.');
    ok := false;
  exception when unique_violation then ok := true; end;
  assert ok, 'P1: zweiter aktiver Beitrag fuer dasselbe Foto';
  /* fehlgeschlagen sperrt nicht */
  update public.photo_posts set status = 'failed' where photo_id = v_foto;
  insert into public.photo_posts (user_id, location_id, photo_id, summary_snapshot) values (v_a, v_loc, v_foto, 'Neuer Versuch nach Fehler.');
  assert (select count(*) from public.photo_posts where photo_id = v_foto) = 2, 'P1: neuer Versuch nach failed blockiert';
end $$;
rollback;

/* P2 — Rechte */
do $$
begin
  assert pg_catalog.has_table_privilege('authenticated', 'public.photo_posts', 'SELECT'), 'P2: authenticated darf eigene nicht lesen';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.photo_posts', 'INSERT'), 'P2: authenticated darf schreiben';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.photo_posts', 'UPDATE'), 'P2: authenticated darf aendern';
  assert not pg_catalog.has_table_privilege('anon', 'public.photo_posts', 'SELECT'), 'P2: anon darf lesen';
  assert (select relrowsecurity from pg_class where oid = 'public.photo_posts'::regclass), 'P2: RLS aus';
end $$;
