-- docs/operations/loeschung-beleg.sql
--
-- Was passiert beim Löschen eines Kontos wirklich?
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESE ABFRAGE
-- ═══════════════════════════════════════════════════════════════
--
-- § 12 des Auftragsverarbeitungsvertrags (/avv) verspricht Löschung.
-- supabase/functions/delete-account/index.ts löscht nachweislich:
--
--   Z 58-71    das Profil wird gelesen
--   Z 63-75    ein laufendes Stripe-Abo wird gekündigt
--   Z 81-111   die Cloudinary-Fotos werden einzeln gelöscht
--   Z 119      auth.admin.deleteUser(user.id)
--
-- Über Z 119 steht im Code der Kommentar "(kaskadiert)". Das ist eine
-- Annahme, keine Messung. google_reviews, review_replies,
-- google_locations, google_accounts und oauth_tokens stammen aus der
-- Zeit vor der Migrationshistorie — ihre Fremdschlüsselregeln stehen
-- in keiner Migration und sind im Repo nicht prüfbar.
--
-- Kaskadiert es nicht, bleiben nach jeder Kontolöschung Bewertungen
-- mit Namen und Freitext der Kunden des Betriebs in der Datenbank
-- liegen. Das wäre nicht nur ein falscher Vertragstext, sondern ein
-- echter Datenschutzverstoß: Daten ohne Zweck, ohne Verantwortlichen
-- und ohne Rechtsgrundlage.
--
-- Diese Abfrage misst beides:
--   Abschnitt 1 — welche Regel an jedem Fremdschlüssel hängt
--   Abschnitt 2 — ob es heute schon verwaiste Zeilen GIBT
--   Abschnitt 3 — welche Tabellen überhaupt keinen Weg zum Konto haben
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT
-- ═══════════════════════════════════════════════════════════════
--
-- Ausschließlich lesend. Kein insert, update, delete, alter, drop.
-- Wiederholbar. Im Supabase SQL Editor ausführen (Rolle postgres —
-- auth.users ist für andere Rollen nicht lesbar).
--
-- Jeden Abschnitt EINZELN markieren und ausführen. Die drei
-- Abschnitte geben unterschiedliche Spalten zurück.


-- ═══════════════════════════════════════════════════════════════
-- ABSCHNITT 1 — WAS PASSIERT LAUT FREMDSCHLÜSSEL
-- ═══════════════════════════════════════════════════════════════
--
-- Jeder Fremdschlüssel, der auf auth.users oder public.user_profiles
-- zeigt, mit seiner Regel für das Löschen des Ziels.
--
-- SO IST ES RICHTIG:  regel = 'CASCADE — wird mitgelöscht'
--
-- Alles andere ist der Befund:
--   NO ACTION / RESTRICT  Das Löschen des Nutzers SCHEITERT, solange
--                         Zeilen hängen. Dann wirft delete-account
--                         einen Fehler und löscht gar nichts.
--   SET NULL              Die Zeile bleibt, verliert aber den Besitzer.
--                         Genau der Fall, den Abschnitt 2 findet.

select
  c.conrelid::regclass::text                       as tabelle,
  (select string_agg(a.attname, ', ' order by k.ord)
     from unnest(c.conkey) with ordinality k(attnum, ord)
     join pg_attribute a
       on a.attrelid = c.conrelid and a.attnum = k.attnum) as spalte,
  c.confrelid::regclass::text                      as zeigt_auf,
  case c.confdeltype
    when 'c' then 'CASCADE — wird mitgelöscht'
    when 'n' then 'SET NULL — Zeile bleibt ohne Besitzer'
    when 'd' then 'SET DEFAULT — Zeile bleibt'
    when 'r' then 'RESTRICT — Löschen des Nutzers scheitert'
    when 'a' then 'NO ACTION — Löschen des Nutzers scheitert'
    /* confdeltype ist "char", nicht text. Ohne Umwandlung ist der
       Verkettungsoperator nicht eindeutig und die Abfrage bricht ab. */
    else          'unbekannt: ' || c.confdeltype::text
  end                                              as regel,
  c.conname                                        as constraint_name
from pg_constraint c
where c.contype = 'f'
  and c.confrelid in (
        'auth.users'::regclass,
        'public.user_profiles'::regclass)
order by
  case c.confdeltype when 'c' then 2 else 1 end,   -- Befunde zuerst
  c.conrelid::regclass::text;


-- ═══════════════════════════════════════════════════════════════
-- ABSCHNITT 2 — GIBT ES HEUTE VERWAISTE ZEILEN?
-- ═══════════════════════════════════════════════════════════════
--
-- Die eigentliche Messung. Abschnitt 1 liest Regeln; dieser
-- Abschnitt zählt Zeilen, deren Besitzer nicht mehr existiert.
--
-- Geprüft wird jede Tabelle in public mit einer uuid-Spalte user_id,
-- dazu user_profiles über ihre Spalte id.
--
-- query_to_xml, weil der Tabellenname erst zur Laufzeit feststeht und
-- eine Abfrage mit variabler Tabelle sonst nicht ohne eine Funktion
-- auskommt. Rein lesend.
--
-- SO IST ES RICHTIG:  verwaiste_zeilen = 0 in jeder Zeile
--
-- Eine Zahl > 0 heißt: Dort liegen Daten eines gelöschten Kontos.
-- Bei google_reviews und review_replies sind das personenbezogene
-- Daten Dritter.

with kandidat as (
  select c.table_name, 'user_id'::text as spalte
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.column_name  = 'user_id'
     and c.data_type    = 'uuid'
     and exists (select 1 from information_schema.tables t
                  where t.table_schema = 'public'
                    and t.table_name   = c.table_name
                    and t.table_type   = 'BASE TABLE')
  union all
  select 'user_profiles', 'id'
)
select
  k.table_name                                     as tabelle,
  k.spalte                                         as besitzerspalte,
  (pg_catalog.xpath('/row/c/text()',
     pg_catalog.query_to_xml(
       format('select count(*) as c from public.%I t'
              ' where t.%I is not null'
              '   and not exists (select 1 from auth.users u where u.id = t.%I)',
              k.table_name, k.spalte, k.spalte),
       false, true, '')))[1]::text::bigint         as verwaiste_zeilen,
  (pg_catalog.xpath('/row/c/text()',
     pg_catalog.query_to_xml(
       format('select count(*) as c from public.%I', k.table_name),
       false, true, '')))[1]::text::bigint         as zeilen_gesamt
from kandidat k
order by 3 desc, 1;


-- ═══════════════════════════════════════════════════════════════
-- ABSCHNITT 3 — TABELLEN OHNE WEG ZUM KONTO
-- ═══════════════════════════════════════════════════════════════
--
-- Eine Tabelle ohne user_id und ohne Fremdschlüssel auf auth.users
-- oder user_profiles kann beim Löschen eines Kontos technisch nicht
-- mitgelöscht werden — niemand weiß, wem die Zeile gehört.
--
-- Das ist nicht automatisch ein Befund: Viele dieser Tabellen
-- enthalten keine personenbezogenen Daten (Protokolle ohne Bezug,
-- Konfiguration, Zählwerke). Die Liste ist zum Durchsehen, nicht
-- zum Abhaken.
--
-- DURCHSEHEN NACH:  enthält diese Tabelle einen Namen, eine
--                   E-Mail-Adresse oder einen Freitext eines Menschen?
--                   Wenn ja, gehört sie in die Löschung.
--
-- Die zweite Spalte hilft dabei: Sie zeigt Spalten, deren Name auf
-- personenbezogene Inhalte hindeutet.

select
  t.table_name                                     as tabelle,
  coalesce(
    (select string_agg(c.column_name, ', ' order by c.ordinal_position)
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name   = t.table_name
        and (c.column_name ~* '(name|mail|phone|telefon|comment|text|body|reviewer|author|adresse|address)')),
    '— keine auffälligen Spalten —')               as verdaechtige_spalten
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type   = 'BASE TABLE'
  and not exists (select 1 from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name   = t.table_name
                     and c.column_name  = 'user_id')
  and t.table_name <> 'user_profiles'
  and not exists (
        select 1 from pg_constraint fk
         where fk.contype  = 'f'
           and fk.conrelid = format('public.%I', t.table_name)::regclass
           and fk.confrelid in ('auth.users'::regclass,
                                'public.user_profiles'::regclass))
order by 1;


-- ═══════════════════════════════════════════════════════════════
-- WIE DAS ERGEBNIS ZU LESEN IST
-- ═══════════════════════════════════════════════════════════════
--
-- FALL A — Abschnitt 1 zeigt überall CASCADE, Abschnitt 2 überall 0
--
--   Der Kommentar im Code stimmt. § 12 des AVV ist durch die
--   Implementierung gedeckt. Nichts zu tun.
--
-- FALL B — Abschnitt 1 zeigt NO ACTION oder RESTRICT
--
--   Dann ist delete-account defekt: auth.admin.deleteUser schlägt
--   fehl, sobald der Nutzer Daten hat. Da der Aufruf in Z 119-120
--   den Fehler wirft, bricht die Function ab — nachdem Stripe
--   gekündigt und die Fotos schon gelöscht wurden. Der Kunde steht
--   dann ohne Abo und ohne Fotos da, hat aber noch ein Konto.
--
--   Das wäre ein Fehler, der beim ersten echten Löschversuch
--   auffällt. Vor dem ersten Kunden prüfen.
--
-- FALL C — Abschnitt 2 zeigt Zahlen > 0
--
--   Es liegen schon verwaiste Daten in der Datenbank. Dann ist vor
--   dem Veröffentlichen des AVV zu klären, welche das sind und ob
--   sie personenbezogen sind.
--
-- In allen Fällen: melden, nicht still reparieren. Eine Änderung an
-- einer Fremdschlüsselregel ist eine Migration und gehört durch den
-- normalen Weg — nicht in den SQL Editor.
