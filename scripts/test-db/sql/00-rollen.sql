-- 00-rollen.sql
--
-- Die Rollen, die Supabase mitbringt und die Migrationen voraussetzen.
--
-- WARUM DAS HIER STEHT
--
-- Jede Migration endet mit Rechtevergabe:
--
--   revoke all on function ... from public, anon, authenticated;
--   grant execute on function ... to service_role;
--
-- Ohne diese Rollen scheitert jede einzelne davon. Sie gehoeren nicht
-- in die Baseline, weil pg_dump mit --no-privileges und --schema=public
-- gelaufen ist: Rollen sind Cluster-Objekte, keine Schemaobjekte.
--
-- Das ist deshalb kein Ersatz fuer Produktionsschema, sondern die
-- Umgebung, in der es ueberhaupt erst ladbar ist.
--
-- Wiederholbar.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  /* Besitzt in Supabase das auth-Schema. */
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;

  /* Fuehrt in Supabase die Migrationen aus. */
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then
    create role postgres login superuser;
  end if;
end $$;
