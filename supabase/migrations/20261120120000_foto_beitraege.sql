/*
 * Foto → Google-Beitrag (19.11.2026).
 *
 * Der Betrieb waehlt ein ueber WERKRUF hochgeladenes Foto, bekommt auf
 * Wunsch einen Textvorschlag (KI, nur Vorschlag), prueft/aendert ihn und
 * veroeffentlicht ihn selbst als Google-Beitrag mit diesem Foto.
 *
 * Diese Tabelle haelt nur Versuche und Ergebnis — Status, Googles
 * name/state, den veroeffentlichten Text. Keine Tokens, kein KI-Rohtext.
 * Die Sperre: je Foto hoechstens ein laufender oder veroeffentlichter
 * Beitrag (Doppelklick, zweites Fenster).
 *
 * Schreiben nur service_role (google-business); der Kunde liest nur die
 * eigenen Zeilen.
 */
create table if not exists public.photo_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  location_id      uuid not null references public.google_locations(id) on delete cascade,
  photo_id         uuid not null references public.business_photos(id) on delete cascade,
  summary_snapshot text not null check (length(summary_snapshot) between 1 and 1500),
  vorschlag_genutzt boolean not null default false,
  status           text not null default 'publishing' check (status in ('publishing', 'published', 'failed', 'rejected')),
  google_post_name text,
  google_state     text,
  error_code       text,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
comment on table public.photo_posts is 'Foto-Beitraege: Veroeffentlichungsversuche (Status, Googles name/state, veroeffentlichter Text). Kein Payload, keine Tokens.';

create index if not exists photo_posts_user_idx on public.photo_posts (user_id, created_at desc);
create unique index if not exists photo_posts_ein_aktiver
  on public.photo_posts (user_id, photo_id)
  where status in ('publishing', 'published');

alter table public.photo_posts enable row level security;
revoke all on table public.photo_posts from public, anon, authenticated;
grant select on table public.photo_posts to authenticated;
drop policy if exists photo_posts_own on public.photo_posts;
create policy photo_posts_own on public.photo_posts for select to authenticated using (user_id = auth.uid());
grant all on table public.photo_posts to service_role;

/* ═══ Selbstpruefung ═══ */
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.photo_posts'::regclass) then
    raise exception '[foto-beitraege] RLS aus';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.photo_posts', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.photo_posts', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.photo_posts', 'SELECT') then
    raise exception '[foto-beitraege] Client darf schreiben oder anon lesen';
  end if;
  raise notice '[foto-beitraege] in Ordnung';
end $$;
