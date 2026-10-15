-- 20261012110000_fehlende_objekte.sql
--
-- Drei Objekte, die es nur in Produktion gab.
--
-- ═══════════════════════════════════════════════════════════════
-- WOHER DIESE DEFINITIONEN KOMMEN
-- ═══════════════════════════════════════════════════════════════
--
-- Aus Produktion, ausgelesen am 12.10.2026 mit
-- information_schema.columns, pg_constraint, pg_indexes und
-- pg_get_functiondef. Nicht abgeleitet, nicht geraten.
--
-- Das ist der Unterschied zur Fassung, die bis heute in
-- scripts/test-db/sql/20-baseline-luecken.sql stand: dort hatte ich
-- die Spalten aus den Funktionsrümpfen erschlossen und Typen und
-- Defaults erfunden. Als Testkruecke ging das durch. Es war an einer
-- Stelle falsch, und die haette gezaehlt:
--
--   sync_locks fehlte locked_by — eine NOT-NULL-Spalte ohne Default.
--   release_lock(p_name, p_worker) vergleicht darauf. Jedes
--   try_acquire_lock() haette in einer so gebauten Datenbank
--   geworfen.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM SIE NICHT IM REPO STANDEN
-- ═══════════════════════════════════════════════════════════════
--
-- Die Baseline vom 22.09. enthaelt beide Tabellen nicht, wohl aber
-- die Funktionen, die darauf zugreifen. Weil pg_dump mit
-- check_function_bodies = false laedt, fiel das nie auf. Entstanden
-- sind sie von Hand im SQL-Editor, nach dem Dump.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DAS NICHT NUR ORDNUNG IST
-- ═══════════════════════════════════════════════════════════════
--
--   gbp-maintenance  alle 15 Minuten
--     → run_sync_maintenance()
--     → prune_rate_limits()
--     → delete from public.rate_limits
--
-- Eine aus dem Repo aufgebaute Datenbank haette den Job, die
-- Funktion und nicht die Tabelle. Der Fehler landete viermal pro
-- Stunde in cron.job_run_details, wo niemand hinsieht.
--
-- sync_locks traegt die Sperren von try_acquire_lock() und
-- release_lock(), also der Sync-Worker.
--
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — public.rate_limits
   ═══════════════════════════════════════════════════════════════

   Gelesen aus Produktion:

     key           text        NOT NULL              (Primaerschluessel)
     window_start  timestamptz NOT NULL default now()
     request_count integer     NOT NULL default 0
     updated_at    timestamptz NOT NULL default now()

   Weitere Constraints: keine.
   Indizes: rate_limits_pkey (key), rate_limits_window_idx (window_start).

   Benutzt von public.check_rate_limit(p_key, p_limit, p_window) und
   public.prune_rate_limits(p_keep). */

create table if not exists public.rate_limits (
  key           text        not null,
  window_start  timestamptz not null default now(),
  request_count integer     not null default 0,
  updated_at    timestamptz not null default now(),
  constraint rate_limits_pkey primary key (key)
);

create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

comment on table public.rate_limits is
  'Zaehlfenster der Ratenbegrenzung. Bis 12.10.2026 nur in Produktion, von Hand angelegt; Definition dort abgelesen.';

/* ═══════════════════════════════════════════════════════════════
   2 — public.sync_locks
   ═══════════════════════════════════════════════════════════════

   Gelesen aus Produktion:

     name        text        NOT NULL              (Primaerschluessel)
     locked_by   text        NOT NULL
     locked_at   timestamptz NOT NULL default now()
     expires_at  timestamptz NOT NULL

   Weitere Constraints: keine. Index: sync_locks_pkey (name).

   locked_by ohne Default ist Absicht: wer die Sperre haelt, muss der
   Aufrufer sagen. release_lock(p_name, p_worker) gibt sie nur frei,
   wenn beides zusammenpasst — sonst koennte ein Worker die Sperre
   eines anderen aufheben. */

create table if not exists public.sync_locks (
  name       text        not null,
  locked_by  text        not null,
  locked_at  timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint sync_locks_pkey primary key (name)
);

comment on table public.sync_locks is
  'Sperren der Sync-Worker. Bis 12.10.2026 nur in Produktion, von Hand angelegt; Definition dort abgelesen.';

/* ═══════════════════════════════════════════════════════════════
   3 — RECHTE
   ═══════════════════════════════════════════════════════════════

   HIER STEHT EINE ANNAHME, und sie ist als solche benannt.
   Die Baseline entstand mit --no-privileges; welche Rechte Produktion
   auf diesen zwei Tabellen wirklich vergeben hat, steht nirgends.

   Gesetzt wird daher das Muster, dem jede andere interne Tabelle
   dieses Projekts folgt — etwa action_tokens und
   action_auth_states: nichts fuer anon und authenticated, alles fuer
   service_role, RLS an.

   Das ist die sichere Richtung, nicht die bequeme. Beide Tabellen
   werden ausschliesslich von SECURITY-DEFINER-Funktionen angefasst;
   ein Client hat dort nichts zu suchen. Sollte Produktion es anders
   halten, zeigt es der erste vollstaendige Schemaexport — und dann
   gilt der Export, nicht diese Datei.

   RLS an ohne Policy heisst: verweigert alles. Fuer eine Tabelle, an
   die nur service_role geht, ist das richtig — service_role umgeht
   RLS. */

alter table public.rate_limits enable row level security;
alter table public.sync_locks  enable row level security;

revoke all on public.rate_limits from anon, authenticated;
revoke all on public.sync_locks  from anon, authenticated;

grant all on public.rate_limits to service_role;
grant all on public.sync_locks  to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — public.gbp_monitor_ist_laufzeit
   ═══════════════════════════════════════════════════════════════

   Wortgleich aus pg_get_functiondef in Produktion.

   WOFUER
   Der Cron-Job gbp-api-monitor ist auf 30 5,6 * * * eingeplant —
   zwei Termine, ausgefuehrt aber nur, wenn diese Funktion zustimmt.
   7 Uhr Berlin ist im Winter 06:00 UTC und im Sommer 05:00 UTC; der
   zweite Termin ist der Nachholversuch nach einer Zeitumstellung.
   Die Entscheidung braucht eine Zeitzonenrechnung, die cron nicht
   kann — daher diese Funktion und nicht einfach ein anderer
   Zeitplan.

   Die Defaults gehoeren zur Signatur, auch wenn der Jobbefehl beide
   Werte ausdruecklich mitgibt. Ohne sie waere es eine andere
   Funktion, und der Inventarvergleich wuerde anschlagen. */

create or replace function public.gbp_monitor_ist_laufzeit(
  p_stunde integer default 7,
  p_zone   text    default 'Europe/Berlin'::text
)
returns boolean
language sql
stable
as $$
  select extract(hour from (now() at time zone p_zone)) = p_stunde;
$$;

comment on function public.gbp_monitor_ist_laufzeit is
  'Laeuft der API-Monitor jetzt? Zeitfenster in Ortszeit, weil cron nur UTC kennt. Bis 12.10.2026 nur in Produktion.';

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Stehen die drei Objekte?
--   select to_regclass('public.rate_limits'), to_regclass('public.sync_locks');
--   select public.gbp_monitor_ist_laufzeit(7, 'Europe/Berlin');
--
-- Tut der Wartungsjob wieder, was er soll?
--   select public.run_sync_maintenance();
--   → enthaelt prunedRateLimits, wirft nicht mehr.
--
-- WAS DIESE MIGRATION NICHT LOEST
--
-- Der Inventarvergleich vom 12.10. hat ausserdem gefunden:
--
--   8 Sichten    nur in Produktion
--   14 Trigger   nur in Produktion
--
-- Darunter audit_logs_immutable und rec_events_immutable, die
-- Aenderungen an Protokollzeilen verhindern, sowie sanitize_profile
-- und neun set_updated_at-Trigger.
--
-- Die sind NICHT von Hand gebaut — sie sind dem abgeschnittenen
-- Baseline-Dump zum Opfer gefallen, der vor dem Trigger- und dem
-- restlichen Sichtenteil endet. Sie 22-mal hier abzuschreiben waere
-- der falsche Weg: der richtige ist ein vollstaendiger Schemaexport,
-- der sie alle mitbringt. Siehe docs/operations/backup-restore.md,
-- Abschnitt "Die alte Baseline".
