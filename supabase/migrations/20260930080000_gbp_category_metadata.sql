-- 20260930080000_gbp_category_metadata.sql
--
-- Zwischenspeicher fuer Kategorie-Metadaten aus
-- categories.batchGet?view=FULL.
--
-- WARUM UEBERHAUPT EIN CACHE
--
-- Die Metadaten einer Kategorie — serviceTypes und moreHoursTypes —
-- aendern sich nicht sekuendlich. Sie bei jedem Seitenaufbau neu zu
-- holen kostet Quota und Zeit, ohne dass sich etwas aendert.
--
-- WARUM DER CACHE NICHT DIE WAHRHEIT IST
--
-- Google bestimmt, welche Typen es gibt, und aendert das ohne
-- Vorankuendigung. Der Cache hat deshalb ein Verfallsdatum und wird
-- bei jedem Kategoriewechsel fuer die betroffene Kategorie verworfen.
--
-- DER WICHTIGE UNTERSCHIED
--
-- "Google liefert keine Typen" und "der Abruf ist gescheitert" sind
-- zwei verschiedene Dinge. Ein gescheiterter Abruf darf nicht als
-- leere Liste im Cache landen — sonst zeigt die Oberflaeche dauerhaft
-- "keine weiteren Zeiten verfuegbar", obwohl Google welche haette.
-- Deshalb die Spalte abruf_erfolgreich.
--
-- Die Tabelle enthaelt KEINE Kundendaten: nur oeffentliche
-- Google-Metadaten, die fuer alle Nutzer derselben Kategorie gleich
-- sind. Sie ist deshalb nicht mandantengebunden.
--
-- Wiederholbar. Laeuft im SQL Editor.

begin;

create table if not exists public.gbp_category_metadata (
  /* gcid:plumber — die stabile Google-Kategorie-ID, nicht der
     Anzeigename. Anzeigenamen sind sprachabhaengig und aendern sich. */
  category_name     text not null,
  language_code     text not null,
  region_code       text not null,

  display_name      text,
  service_types     jsonb not null default '[]'::jsonb,
  more_hours_types  jsonb not null default '[]'::jsonb,

  /* Unterscheidet "Google sagt: keine" von "Abruf gescheitert". */
  abruf_erfolgreich boolean not null default true,
  letzter_fehler    text,

  geholt_am         timestamptz not null default now(),
  aktualisiert_am   timestamptz not null default now(),

  primary key (category_name, language_code, region_code)
);

alter table public.gbp_category_metadata enable row level security;

comment on table public.gbp_category_metadata is
  'Zwischenspeicher fuer categories.batchGet?view=FULL. Keine Kundendaten — oeffentliche Google-Metadaten je Kategorie, Sprache und Region.';

comment on column public.gbp_category_metadata.abruf_erfolgreich is
  'false heisst: Der Abruf ist gescheitert. Die leeren Listen sind dann KEIN Befund, sondern ein fehlender Stand.';

create index if not exists gbp_category_metadata_alter
  on public.gbp_category_metadata (geholt_am);

/* ═══════════════════════════════════════════════════════════════
   LESEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Liefert den Stand, wenn er frisch genug ist.
 *
 * Gibt null zurueck, wenn nichts da ist oder der Stand zu alt — dann
 * holt der Aufrufer neu. Ein gescheiterter Abruf wird nach kurzer Zeit
 * erneut versucht, ein erfolgreicher erst nach Ablauf der vollen
 * Frist.
 */
create or replace function public.gbp_category_metadata_get(
  p_category_name text,
  p_language_code text default 'de',
  p_region_code   text default 'DE',
  p_max_alter     interval default '7 days'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(m)
  from public.gbp_category_metadata m
  where m.category_name = p_category_name
    and m.language_code = p_language_code
    and m.region_code   = p_region_code
    and m.geholt_am > pg_catalog.now() - (
      case when m.abruf_erfolgreich then p_max_alter else interval '15 minutes' end
    );
$$;

/* ═══════════════════════════════════════════════════════════════
   SCHREIBEN
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.gbp_category_metadata_put(
  p_category_name    text,
  p_language_code    text,
  p_region_code      text,
  p_display_name     text,
  p_service_types    jsonb,
  p_more_hours_types jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.gbp_category_metadata as m
    (category_name, language_code, region_code, display_name,
     service_types, more_hours_types, abruf_erfolgreich,
     letzter_fehler, geholt_am, aktualisiert_am)
  values
    (p_category_name, p_language_code, p_region_code, p_display_name,
     coalesce(p_service_types, '[]'::jsonb), coalesce(p_more_hours_types, '[]'::jsonb),
     true, null, pg_catalog.now(), pg_catalog.now())
  on conflict (category_name, language_code, region_code) do update
    set display_name      = excluded.display_name,
        service_types     = excluded.service_types,
        more_hours_types  = excluded.more_hours_types,
        abruf_erfolgreich = true,
        letzter_fehler    = null,
        geholt_am         = pg_catalog.now(),
        aktualisiert_am   = pg_catalog.now();
$$;

/*
 * Haelt einen gescheiterten Abruf fest.
 *
 * Ueberschreibt einen vorhandenen erfolgreichen Stand NICHT — ein
 * alter, echter Stand ist besser als eine leere Liste. Vermerkt wird
 * nur der Fehler, damit nicht bei jedem Seitenaufbau erneut versucht
 * wird.
 */
create or replace function public.gbp_category_metadata_fail(
  p_category_name text,
  p_language_code text,
  p_region_code   text,
  p_fehler        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.gbp_category_metadata
     set letzter_fehler = pg_catalog.left(p_fehler, 400),
         aktualisiert_am = pg_catalog.now()
   where category_name = p_category_name
     and language_code = p_language_code
     and region_code   = p_region_code;

  if not found then
    insert into public.gbp_category_metadata
      (category_name, language_code, region_code,
       abruf_erfolgreich, letzter_fehler, geholt_am, aktualisiert_am)
    values (p_category_name, p_language_code, p_region_code,
            false, pg_catalog.left(p_fehler, 400), pg_catalog.now(), pg_catalog.now());
  end if;
end;
$$;

/*
 * Verwirft den Stand einer Kategorie.
 *
 * Wird bei jedem Kategoriewechsel aufgerufen: Danach muessen die
 * abhaengigen Metadaten frisch geholt werden, sonst zeigt die
 * Oberflaeche Typen der alten Kategorie.
 */
create or replace function public.gbp_category_metadata_invalidate(
  p_category_name text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer;
begin
  delete from public.gbp_category_metadata where category_name = p_category_name;
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

/* Rechte: nur Service Role — alle Google-Zugriffe laufen serverseitig. */
revoke all on function public.gbp_category_metadata_get(text,text,text,interval) from public, anon, authenticated;
revoke all on function public.gbp_category_metadata_put(text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.gbp_category_metadata_fail(text,text,text,text) from public, anon, authenticated;
revoke all on function public.gbp_category_metadata_invalidate(text) from public, anon, authenticated;

grant execute on function public.gbp_category_metadata_get(text,text,text,interval) to service_role;
grant execute on function public.gbp_category_metadata_put(text,text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.gbp_category_metadata_fail(text,text,text,text) to service_role;
grant execute on function public.gbp_category_metadata_invalidate(text) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
--   select category_name, display_name, abruf_erfolgreich,
--          jsonb_array_length(more_hours_types) as zeitarten,
--          jsonb_array_length(service_types) as leistungsarten,
--          geholt_am
--   from public.gbp_category_metadata order by geholt_am desc;
--
-- Gescheiterte Abrufe:
--   select * from public.gbp_category_metadata where not abruf_erfolgreich;
