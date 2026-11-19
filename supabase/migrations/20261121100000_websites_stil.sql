/*
 * Website: Stil (Meister / Modern / Kraeftig).
 *
 * Rein additiv: eine Spalte mit Standardwert. 20261121090000_websites.sql
 * ist bereits angewendet und wird nicht veraendert.
 */
alter table public.websites
  add column if not exists stil text not null default 'meister'
  check (stil in ('meister', 'modern', 'kraeftig'));

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'websites' and column_name = 'stil') then
    raise exception '[websites_stil] Spalte fehlt';
  end if;
  raise notice '[websites_stil] in Ordnung';
end $$;
