-- docs/operations/loeschung-blocker.sql
--
-- Alle Hindernisse der Kontolöschung auf einmal — statt eines nach dem anderen
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESE ABFRAGE GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Am 19.10.2026 scheiterte das Löschen eines Nutzers zweimal
-- hintereinander, an zwei verschiedenen Ursachen:
--
--   1. leads_status_check kannte den Wert 'deleted' nicht, den der
--      Trigger anonymise_user_on_delete() schreibt.
--   2. audit_logs trägt einen append-only-Trigger (reject_mutation),
--      während sein Fremdschlüssel auf SET NULL steht. SET NULL ist
--      ein UPDATE — und genau das verbietet der Trigger.
--
-- Beide Male hatte die vorige Messung nur Fremdschlüsselregeln
-- angesehen. Beide Male war der Blocker kein Fremdschlüssel, sondern
-- ein Trigger auf der Tabelle, die mitgelöscht werden sollte.
--
-- Diese Abfrage misst deshalb nicht Regeln einzeln, sondern ihr
-- ZUSAMMENSPIEL: Für jeden Fremdschlüssel wird bestimmt, welche
-- Operation das Löschen des Elternsatzes auf der Kindtabelle
-- auslöst — und ob dort ein Trigger sitzt, der genau diese
-- Operation verbietet.
--
--   ON DELETE SET NULL / SET DEFAULT  →  braucht UPDATE  auf der Kindtabelle
--   ON DELETE CASCADE                 →  braucht DELETE  auf der Kindtabelle
--
-- Sitzt dort ein Trigger für dieselbe Operation, ist das ein
-- möglicher Blocker. Ob er tatsächlich wirft, hängt von seinem
-- Rumpf ab — deshalb heißt die Spalte VERDACHT und nicht BEFUND.
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT
-- ═══════════════════════════════════════════════════════════════
--
-- Ausschließlich lesend. Liest nur den Systemkatalog.
-- Kein insert, update, delete, alter, drop. Eine einzige Anweisung.
-- Rolle postgres. Alles hineinkopieren, einmal Run.
--
-- ═══════════════════════════════════════════════════════════════
-- SO LIEST MAN DAS ERGEBNIS
-- ═══════════════════════════════════════════════════════════════
--
--   A VERDACHT    Hier kann das Löschen scheitern. Jede Zeile prüfen.
--   B TRIGGER     Alle eigenen Trigger, zum Nachschlagen.
--   C FK-GRAPH    Alle Fremdschlüssel mit ihrer Löschregel.

with fk as (
  select
    c.oid,
    c.conname,
    c.conrelid                                   as kind_oid,
    c.conrelid::regclass::text                   as kind,
    c.confrelid::regclass::text                  as elternteil,
    c.confdeltype,
    (select string_agg(a.attname, ', ' order by k.ord)
       from unnest(c.conkey) with ordinality k(attnum, ord)
       join pg_attribute a
         on a.attrelid = c.conrelid and a.attnum = k.attnum) as spalte,
    case c.confdeltype
      when 'n' then 'UPDATE'   -- SET NULL
      when 'd' then 'UPDATE'   -- SET DEFAULT
      when 'c' then 'DELETE'   -- CASCADE
      else          null       -- RESTRICT / NO ACTION: loest nichts aus
    end                                          as braucht_operation
  from pg_constraint c
  where c.contype = 'f'
    and c.connamespace in ('public'::regnamespace, 'auth'::regnamespace)
),
trg as (
  select
    t.tgrelid,
    t.tgname,
    p.proname,
    t.tgenabled,
    (t.tgtype &  8) > 0 as bei_delete,
    (t.tgtype & 16) > 0 as bei_update,
    (t.tgtype &  2) > 0 as vorher
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
),

/* ── A — wo Regel und Trigger sich widersprechen ─────────────── */
verdacht as (
  select
    1 as nr,
    'A VERDACHT'::text as bereich,
    (fk.kind || '.' || fk.spalte)::text as gegenstand,
    ('Loeschen von ' || fk.elternteil || ' braucht ' || fk.braucht_operation
      || ' auf ' || fk.kind
      || ' — dort haengt Trigger ' || trg.tgname
      || ' (' || trg.proname || ')'
      || case when trg.tgenabled = 'D' then ' [deaktiviert, harmlos]' else '' end)::text as wert
  from fk
  join trg
    on  trg.tgrelid = fk.kind_oid
    and ((fk.braucht_operation = 'UPDATE' and trg.bei_update)
      or (fk.braucht_operation = 'DELETE' and trg.bei_delete))
  where fk.braucht_operation is not null
),

/* ── B — alle eigenen Trigger ────────────────────────────────── */
alle_trigger as (
  select
    2 as nr,
    'B TRIGGER'::text as bereich,
    (trg.tgrelid::regclass::text || ' / ' || trg.tgname)::text as gegenstand,
    ('Funktion=' || trg.proname
      || ' | ' || (case when trg.vorher then 'BEFORE' else 'AFTER' end)
      || ' | UPDATE=' || (case when trg.bei_update then 'ja' else 'nein' end)
      || ' | DELETE=' || (case when trg.bei_delete then 'ja' else 'nein' end)
      || ' | aktiv='  || (case when trg.tgenabled = 'D' then 'NEIN' else 'ja' end))::text as wert
  from trg
),

/* ── C — der vollständige Fremdschlüsselgraph ────────────────── */
graph as (
  select
    3 as nr,
    'C FK-GRAPH'::text as bereich,
    (fk.kind || '.' || fk.spalte)::text as gegenstand,
    ('-> ' || fk.elternteil || ' | '
      || case fk.confdeltype
           when 'c' then 'CASCADE (loescht die Zeile)'
           when 'n' then 'SET NULL (aendert die Zeile)'
           when 'd' then 'SET DEFAULT (aendert die Zeile)'
           when 'r' then 'RESTRICT (verhindert das Loeschen)'
           when 'a' then 'NO ACTION (verhindert das Loeschen)'
           else          'unbekannt: ' || fk.confdeltype::text
         end)::text as wert
  from fk
)

select bereich, gegenstand, wert
from (
  select * from verdacht
  union all select * from alle_trigger
  union all select * from graph
) s
order by nr, gegenstand, wert;
