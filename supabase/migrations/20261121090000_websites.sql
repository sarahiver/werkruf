/*
 * Website aus dem Google-Profil (Branch feat/website-aus-google-profil).
 *
 * Je Betrieb (google_locations) hoechstens eine Website. Gespeichert
 * wird nur, was der Betrieb selbst festlegt: Farbe, Logo, Titelbild,
 * Texte, Leistungen, ausgeblendete Fotos, Impressum-Angaben. Name,
 * Telefon, Adresse, Oeffnungszeiten, Fotos und Bewertungen liest die
 * Seite bei jedem Aufruf frisch — sie aktualisiert sich mit dem Profil.
 *
 * Rein additiv: neue Tabelle, nichts Bestehendes wird geaendert.
 * Zugriff ausschliesslich service_role (Edge Function `website`). Der
 * Client liest und schreibt nie direkt; die oeffentliche Seite zeigt
 * nur Websites mit status = 'veroeffentlicht'.
 */
create table if not exists public.websites (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  location_id        uuid not null references public.google_locations(id) on delete cascade,
  slug               text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$' and slug !~ '--'),
  status             text not null default 'entwurf' check (status in ('entwurf', 'veroeffentlicht')),
  farbe              text not null default 'marine' check (length(farbe) <= 20),
  logo_url           text check (logo_url is null or length(logo_url) <= 500),
  titelbild_id       uuid references public.business_photos(id) on delete set null,
  slogan             text not null default '' check (length(slogan) <= 140),
  ueber_text         text not null default '' check (length(ueber_text) <= 1200),
  leistungen         jsonb not null default '[]'::jsonb check (jsonb_typeof(leistungen) = 'array' and jsonb_array_length(leistungen) <= 12),
  fotos_aus          jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos_aus) = 'array'),
  kontakt_email      text check (kontakt_email is null or length(kontakt_email) <= 120),
  bewertungen_zeigen boolean not null default true,
  impressum          jsonb not null default '{}'::jsonb check (jsonb_typeof(impressum) = 'object'),
  veroeffentlicht_am timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.websites is 'Website aus dem Google-Profil: Einstellungen des Betriebs. Stammdaten kommen live aus google_locations/business_photos/google_reviews.';

create unique index if not exists websites_location_eindeutig on public.websites (location_id);
create unique index if not exists websites_slug_eindeutig on public.websites (slug);
create index if not exists websites_user_idx on public.websites (user_id);

alter table public.websites enable row level security;
revoke all on table public.websites from public, anon, authenticated;
grant all on table public.websites to service_role;

/* ═══ Selbstpruefung ═══ */
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.websites'::regclass) then
    raise exception '[websites] RLS aus';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.websites', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.websites', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.websites', 'SELECT') then
    raise exception '[websites] Client hat direkten Zugriff';
  end if;
  raise notice '[websites] in Ordnung';
end $$;
