-- 20260929160000_gbp_api_monitor.sql
--
-- Grundlage fuer das taegliche Google-API-Monitoring (Paket 3).
--
-- Zweck: Erkennen, wenn Google an den von WERKRUF verwendeten
-- Business-Profile-APIs etwas aendert — bevor Kunden davon betroffen
-- sind.
--
-- ZWEI GETRENNTE PRUEFWEGE
--
--   art = 'schema'    Discovery-Dokumente aller acht APIs.
--                     Verglichen wird die Pruefsumme der normalisierten
--                     Struktur. revision wird MITGESPEICHERT, aber
--                     NICHT als alleiniger Grund verwendet, den
--                     Strukturvergleich zu ueberspringen — eine
--                     unveraenderte Revision bei veraenderter Struktur
--                     waere sonst unsichtbar.
--
--   art = 'changelog' Das offizielle Change Log als eigene Quelle.
--                     Notwendig, weil Google My Business v4 nur eine
--                     statische Discovery-Datei mit revision "0" hat:
--                     Deren Pruefsumme erkennt Aenderungen an der
--                     DATEI, nicht an der API.
--
-- Beide fuehren getrennte Snapshots und getrennte Alarmschluessel.
--
-- Diese Migration legt nur Tabellen und Funktionen an. Sie aendert
-- keine Kundendaten, richtet keinen Cronjob ein und verschickt nichts.
-- Das Cron-SQL liegt separat in docs/GBP-API-MONITOR.md.
--
-- Wiederholbar. Laeuft im SQL Editor.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — SCHNAPPSCHUESSE
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.gbp_api_snapshots (
  quelle            text primary key,
  art               text not null check (art in ('schema', 'changelog')),
  quell_url         text not null,
  /* Googles eigene Revisionsnummer. Metadatum, kein Ersatz fuer den
     Strukturvergleich — v4 traegt dauerhaft "0". */
  revision          text,
  pruefsumme        text not null,
  /* Die normalisierte Struktur beziehungsweise die zerlegten
     Change-Log-Eintraege. Grundlage des naechsten Vergleichs. */
  inhalt            jsonb not null,
  erstmals_am       timestamptz not null default now(),
  zuletzt_geprueft  timestamptz not null default now(),
  zuletzt_geaendert timestamptz,
  /* Ausfallzaehlung. Ein fehlgeschlagener Abruf ueberschreibt den
     Snapshot NICHT — er erhoeht nur diesen Zaehler. */
  fehlversuche      integer not null default 0,
  letzter_fehler    text,
  letzter_fehler_am timestamptz
);

alter table public.gbp_api_snapshots enable row level security;

comment on table public.gbp_api_snapshots is
  'Letzter bekannter Stand je Quelle. Ein fehlgeschlagener Abruf aktualisiert nur fehlversuche, niemals inhalt oder pruefsumme.';

/* ═══════════════════════════════════════════════════════════════
   2 — AENDERUNGSHISTORIE
   ═══════════════════════════════════════════════════════════════ */

create table if not exists public.gbp_api_changes (
  id             uuid primary key default gen_random_uuid(),
  quelle         text not null,
  art            text not null check (art in ('schema', 'changelog')),
  /* Signatur ueber Art und Pfad aller Unterschiede. Verhindert, dass
     dieselbe Aenderung bei jedem Lauf erneut gemeldet wird. */
  signatur       text not null,
  stufe          text not null check (stufe in ('kritisch', 'handlungsbedarf', 'information')),
  anzahl         integer not null,
  unterschiede   jsonb not null,
  alte_revision  text,
  neue_revision  text,
  erkannt_am     timestamptz not null default now(),
  gemeldet_am    timestamptz,
  meldung_fehler text
);

create unique index if not exists gbp_api_changes_signatur_uniq
  on public.gbp_api_changes (quelle, signatur);

create index if not exists gbp_api_changes_offen
  on public.gbp_api_changes (erkannt_am desc)
  where gemeldet_am is null;

alter table public.gbp_api_changes enable row level security;

comment on table public.gbp_api_changes is
  'Erkannte Aenderungen. Der eindeutige Index auf (quelle, signatur) sorgt dafuer, dass dieselbe Aenderung nur einmal gemeldet wird; eine SPAETERE Aenderung hat eine andere Signatur und meldet erneut.';

/* ═══════════════════════════════════════════════════════════════
   3 — ERFOLGREICHER ABRUF
   ═══════════════════════════════════════════════════════════════ */

/*
 * Schreibt einen neuen Stand fort und legt bei Unterschieden einen
 * Eintrag in der Historie an.
 *
 * Rueckgabe:
 *   basis      Erster Lauf — Ausgangsbasis angelegt, KEIN Alarm
 *   unveraendert
 *   geaendert  Unterschiede gefunden, Eintrag angelegt
 *   bekannt    Unterschiede gefunden, aber diese Signatur ist bereits
 *              gemeldet
 */
create or replace function public.gbp_monitor_record_success(
  p_quelle       text,
  p_art          text,
  p_quell_url    text,
  p_revision     text,
  p_pruefsumme   text,
  p_inhalt       jsonb,
  p_signatur     text default null,
  p_stufe        text default null,
  p_unterschiede jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vorher public.gbp_api_snapshots%rowtype;
  v_neu    boolean;
  v_id     uuid;
  v_anzahl integer := coalesce(jsonb_array_length(p_unterschiede), 0);
begin
  select * into v_vorher from public.gbp_api_snapshots where quelle = p_quelle;

  /* ── Erster Lauf: Ausgangsbasis, kein Alarm ── */
  if not found then
    insert into public.gbp_api_snapshots
      (quelle, art, quell_url, revision, pruefsumme, inhalt, zuletzt_geaendert)
    values (p_quelle, p_art, p_quell_url, p_revision, p_pruefsumme, p_inhalt, pg_catalog.now());
    return pg_catalog.jsonb_build_object('ergebnis', 'basis', 'gemeldet', false);
  end if;

  /* ── Unveraendert ── */
  if v_vorher.pruefsumme = p_pruefsumme then
    update public.gbp_api_snapshots
       set zuletzt_geprueft = pg_catalog.now(),
           revision         = p_revision,
           fehlversuche     = 0,
           letzter_fehler   = null
     where quelle = p_quelle;
    return pg_catalog.jsonb_build_object('ergebnis', 'unveraendert', 'gemeldet', false);
  end if;

  /* ── Veraendert ── */
  update public.gbp_api_snapshots
     set pruefsumme        = p_pruefsumme,
         inhalt            = p_inhalt,
         revision          = p_revision,
         zuletzt_geprueft  = pg_catalog.now(),
         zuletzt_geaendert = pg_catalog.now(),
         fehlversuche      = 0,
         letzter_fehler    = null
   where quelle = p_quelle;

  if v_anzahl = 0 then
    /* Pruefsumme anders, aber keine benannten Unterschiede — etwa eine
       reine Umsortierung, die die Normalisierung nicht abfaengt. Wird
       fortgeschrieben, aber nicht gemeldet. */
    return pg_catalog.jsonb_build_object('ergebnis', 'geaendert', 'gemeldet', false,
                                         'hinweis', 'Pruefsumme abweichend, keine benannten Unterschiede');
  end if;

  insert into public.gbp_api_changes
    (quelle, art, signatur, stufe, anzahl, unterschiede, alte_revision, neue_revision)
  values (p_quelle, p_art, p_signatur, coalesce(p_stufe, 'information'),
          v_anzahl, p_unterschiede, v_vorher.revision, p_revision)
  on conflict (quelle, signatur) do nothing
  returning id into v_id;

  v_neu := v_id is not null;

  return pg_catalog.jsonb_build_object(
    'ergebnis', case when v_neu then 'geaendert' else 'bekannt' end,
    'gemeldet', false, 'change_id', v_id, 'anzahl', v_anzahl);
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   4 — FEHLGESCHLAGENER ABRUF
   ═══════════════════════════════════════════════════════════════ */

/*
 * Ein Ausfall ist keine API-Aenderung.
 *
 * Diese Funktion fasst den Snapshot NICHT an — weder inhalt noch
 * pruefsumme noch revision. Sie zaehlt nur. Damit kann ein
 * voruebergehender Netzfehler den bekannten Stand nicht zerstoeren und
 * beim naechsten erfolgreichen Lauf auch keine Scheinaenderung
 * ausloesen.
 *
 * Fuer eine Quelle, die noch nie erfolgreich abgerufen wurde, wird ein
 * Platzhalter angelegt — sonst bliebe der Ausfall unsichtbar.
 */
create or replace function public.gbp_monitor_record_failure(
  p_quelle    text,
  p_art       text,
  p_quell_url text,
  p_fehler    text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zaehler integer;
begin
  update public.gbp_api_snapshots
     set fehlversuche      = fehlversuche + 1,
         letzter_fehler    = pg_catalog.left(p_fehler, 500),
         letzter_fehler_am = pg_catalog.now(),
         zuletzt_geprueft  = pg_catalog.now()
   where quelle = p_quelle
  returning fehlversuche into v_zaehler;

  if not found then
    insert into public.gbp_api_snapshots
      (quelle, art, quell_url, pruefsumme, inhalt,
       fehlversuche, letzter_fehler, letzter_fehler_am)
    values (p_quelle, p_art, p_quell_url, '', '{}'::jsonb,
            1, pg_catalog.left(p_fehler, 500), pg_catalog.now());
    v_zaehler := 1;
  end if;

  return v_zaehler;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   5 — OFFENE MELDUNGEN
   ═══════════════════════════════════════════════════════════════ */

create or replace function public.gbp_monitor_pending()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(to_jsonb(c) order by
           case c.stufe when 'kritisch' then 0 when 'handlungsbedarf' then 1 else 2 end,
           c.erkannt_am), '[]'::jsonb)
  from public.gbp_api_changes c
  where c.gemeldet_am is null;
$$;

create or replace function public.gbp_monitor_mark_reported(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer;
begin
  update public.gbp_api_changes
     set gemeldet_am = pg_catalog.now()
   where id = any(p_ids) and gemeldet_am is null;
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   6 — BETRIEBSSICHT UND ALARMANBINDUNG
   ═══════════════════════════════════════════════════════════════ */

create or replace view public.ops_gbp_api_monitor as
select
  s.quelle, s.art, s.revision,
  s.zuletzt_geprueft, s.zuletzt_geaendert,
  s.fehlversuche, s.letzter_fehler,
  pg_catalog.left(s.pruefsumme, 12) as pruefsumme_kurz,
  (select count(*) from public.gbp_api_changes c
    where c.quelle = s.quelle and c.gemeldet_am is null) as offene_meldungen
from public.gbp_api_snapshots s
order by s.fehlversuche desc, s.quelle;

comment on view public.ops_gbp_api_monitor is
  'Zustand des API-Monitorings je Quelle.';

/*
 * Wiederholte Ausfaelle sind ein eigenes Betriebsproblem, kein
 * API-Befund. Drei Fehlversuche in Folge bedeuten bei taeglicher
 * Pruefung: seit drei Tagen kein Stand.
 *
 * Wird von ops_alerts() gelesen — siehe Ergaenzung unten.
 */
create or replace function public.gbp_monitor_failures(p_schwelle integer default 3)
returns table (quelle text, fehlversuche integer, letzter_fehler text, seit timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.quelle, s.fehlversuche, s.letzter_fehler, s.letzter_fehler_am
  from public.gbp_api_snapshots s
  where s.fehlversuche >= p_schwelle
  order by s.fehlversuche desc;
$$;

/* Rechte: alles nur ueber die Service Role, wie bei den uebrigen
   Ops-Funktionen. */
revoke all on function public.gbp_monitor_record_success(text,text,text,text,text,jsonb,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.gbp_monitor_record_failure(text,text,text,text) from public, anon, authenticated;
revoke all on function public.gbp_monitor_pending() from public, anon, authenticated;
revoke all on function public.gbp_monitor_mark_reported(uuid[]) from public, anon, authenticated;
revoke all on function public.gbp_monitor_failures(integer) from public, anon, authenticated;

grant execute on function public.gbp_monitor_record_success(text,text,text,text,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.gbp_monitor_record_failure(text,text,text,text) to service_role;
grant execute on function public.gbp_monitor_pending() to service_role;
grant execute on function public.gbp_monitor_mark_reported(uuid[]) to service_role;
grant execute on function public.gbp_monitor_failures(integer) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════
-- ERGAENZUNG FUER ops_alerts()
-- ═══════════════════════════════════════════════════════════════
--
-- Damit wiederholte Monitoring-Ausfaelle im Betriebsalarm auftauchen,
-- gehoert folgender Abschnitt in ops_alerts() — vor dem return.
-- Bewusst NICHT hier automatisch eingefuegt: ops_alerts() wird an
-- mehreren Stellen gepflegt, und ein blindes create or replace wuerde
-- spaetere Aenderungen ueberschreiben.
--
--   /* ── 9. Monitoring faellt wiederholt aus ── */
--   if to_regclass('public.gbp_api_snapshots') is not null then
--     select count(*), jsonb_agg(to_jsonb(f))
--       into v_count, v_detail
--     from public.gbp_monitor_failures(3) f;
--
--     if coalesce(v_count, 0) > 0 then
--       v_alerts := v_alerts || jsonb_build_object(
--         'key',      'gbp_monitor.stalled',
--         'severity', 'warning',
--         'title',    v_count || ' Monitoring-Quelle(n) seit mindestens 3 Laeufen nicht erreichbar',
--         'detail',   v_detail);
--     end if;
--   end if;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
--   select * from public.ops_gbp_api_monitor;
--   select jsonb_pretty(public.gbp_monitor_pending());
--   select * from public.gbp_monitor_failures(1);
--
-- Historie einer Quelle:
--   select erkannt_am, stufe, anzahl, gemeldet_am
--   from public.gbp_api_changes
--   where quelle = 'businessinformation' order by erkannt_am desc;
