-- fingerprint.sql
--
-- Der strukturelle Fingerabdruck einer Datenbank.
--
-- ═══════════════════════════════════════════════════════════════
-- WOZU
-- ═══════════════════════════════════════════════════════════════
--
-- Nach einem Restore ist die Frage nicht "sind die Tabellen wieder
-- da". Die Frage ist, ob dieselbe Datenbank dasteht. Der alte Dump
-- haette "22 Tabellen" gemeldet und dabei jeden Primaerschluessel,
-- jeden Fremdschluessel, jeden Index, jeden Trigger und jede Policy
-- verloren — und niemand haette es an einer Tabellenzahl gesehen.
--
-- Diese Abfrage schreibt deshalb nicht Zahlen, sondern NAMEN: jede
-- Zeile ein Objekt. Zwei Fingerabdruecke lassen sich mit diff
-- vergleichen, und der Unterschied benennt sich selbst.
--
-- ═══════════════════════════════════════════════════════════════
-- AUFRUF
-- ═══════════════════════════════════════════════════════════════
--
--   psql "$URL" -Atf scripts/backup/fingerprint.sql > abdruck.txt
--
-- Und vergleichen:
--
--   diff quelle.txt restore.txt
--
-- Leerer diff heisst: strukturell identisch.
--
-- WAS BEWUSST NICHT DRIN STEHT
--
-- Zeilenzahlen. Zwischen Dump und Restore liegt Zeit; in der Quelle
-- kommen Zeilen hinzu, im Restore nicht. Ein Fingerabdruck, der
-- deshalb jedes Mal abweicht, wird nicht gelesen. Datenmengen prueft
-- restore.sh separat und mit Toleranz.
--
-- Auch nicht drin: Objekte der von Supabase verwalteten Schemas
-- ausser auth.users. Sie gehoeren nicht WERKRUF, aendern sich ohne
-- unser Zutun und wuerden den diff verrauschen.

\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

/*
 * Cron getrennt, hinter dynamischem SQL.
 *
 * cron.job existiert in einer frisch wiederhergestellten Datenbank
 * nicht zwingend — pg_cron ist eine Extension, und ob sie da ist,
 * ist selbst ein Befund. Stuende die Abfrage direkt im UNION, wuerde
 * die GANZE Datei an einem fehlenden cron-Schema scheitern, und man
 * saehe keinen einzigen anderen Unterschied mehr.
 *
 * Fehlt pg_cron, gibt die Funktion eine Zeile aus, die genau das
 * sagt. Der diff zeigt dann den Verlust, statt zu schweigen.
 */
create or replace function pg_temp.cron_abdruck()
returns setof text
language plpgsql
as $$
begin
  if pg_catalog.to_regclass('cron.job') is null then
    return next 'cron|(pg_cron nicht vorhanden)';
    return;
  end if;

  return query execute $q$
    select 'cron|' || jobname
           || '|' || schedule
           || '|' || case when active then 'aktiv' else 'INAKTIV' end
           || '|' || coalesce(substring(regexp_replace(command, '\s+', ' ', 'g')
                                        from 'functions/v1/[^'' ]*'), '-')
      from cron.job
  $q$;
end $$;

-- ── Schemas ──
--
-- Die Liste ist aus Produktion abgelesen (12.10.2026):
--
--   public               32 Tabellen   WERKRUF
--   auth                 27 Tabellen   Supabase Auth — die Anmeldungen
--   storage               8
--   net, cron             je 2
--   supabase_functions    2            Datenbank-Webhooks
--   realtime              2
--   vault                 1
--   extensions, graphql, graphql_public  0
--
-- Der alte Export lief mit --schema=public und hat damit die 27
-- auth-Tabellen weggelassen. Ein Restore daraus haette alle
-- Kundendaten und keine einzige Anmeldung.
select 'schema|' || nspname
  from pg_namespace
 where nspname in ('public', 'auth', 'cron', 'net', 'vault', 'storage',
                   'extensions', 'supabase_functions', 'realtime',
                   'graphql', 'graphql_public')
union all

-- ── Tabellen der Supabase-Schemas, nur namentlich ──
-- Keine Spaltenpruefung: diese Schemas gehoeren Supabase und aendern
-- sich ohne unser Zutun. Dass sie DA sind, ist die Aussage.
select 'fremdtabelle|' || n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('auth', 'storage', 'supabase_functions', 'vault', 'net')
   and c.relkind = 'r'
union all

-- ── Tabellen und Spalten ──
-- Spaltenweise, weil eine fehlende Spalte genauso schlimm ist wie
-- eine fehlende Tabelle und auf Tabellenebene unsichtbar bliebe.
-- not null und Default stehen mit drin: G1 hing an genau diesen
-- beiden Eigenschaften.
select 'spalte|' || c.table_schema || '.' || c.table_name || '.' || c.column_name
       || '|' || c.data_type
       || '|' || c.is_nullable
       || '|' || coalesce(c.column_default, '-')
  from information_schema.columns c
 where c.table_schema = 'public'
    or (c.table_schema = 'auth' and c.table_name = 'users')
union all

-- ── Sichten ──
select 'sicht|' || schemaname || '.' || viewname
  from pg_views where schemaname = 'public'
union all

-- ── Funktionen, mit Signatur ──
-- Der Name allein genuegt nicht: top_recommendations_for_email(uuid)
-- und (uuid, integer) sind verschiedene Funktionen, und genau solche
-- Ueberladungen haben in diesem Projekt schon Verwirrung erzeugt.
select 'funktion|' || n.nspname || '.' || p.proname
       || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
       || '|' || case p.prosecdef when true then 'definer' else 'invoker' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
union all

-- ── Constraints: Primaer-, Fremd-, Unique-, Check ──
select 'constraint|' || n.nspname || '.' || r.relname || '|' || c.conname
       || '|' || c.contype::text
       || '|' || pg_catalog.pg_get_constraintdef(c.oid)
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
 where n.nspname in ('public', 'auth')
union all

-- ── Indizes, mit Definition ──
-- Die Definition, nicht nur der Name: ein partieller Index ohne sein
-- WHERE ist ein anderer Index. In G1 hing enqueue_sync_job() genau
-- daran.
select 'index|' || schemaname || '.' || tablename || '|' || indexname
       || '|' || indexdef
  from pg_indexes
 where schemaname in ('public', 'auth')
union all

-- ── Trigger ──
select 'trigger|' || n.nspname || '.' || r.relname || '|' || t.tgname
       || '|' || case t.tgenabled when 'O' then 'aktiv' else t.tgenabled::text end
  from pg_trigger t
  join pg_class r on r.oid = t.tgrelid
  join pg_namespace n on n.oid = r.relnamespace
 where n.nspname in ('public', 'auth') and not t.tgisinternal
union all

-- ── Row Level Security: Schalter ──
-- Getrennt von den Policies, weil beides unabhaengig verloren gehen
-- kann. Eine Tabelle mit Policies und ausgeschaltetem RLS ist offen.
select 'rls|' || n.nspname || '.' || r.relname
       || '|' || case when r.relrowsecurity then 'enabled' else 'DISABLED' end
       || '|' || case when r.relforcerowsecurity then 'forced' else 'not-forced' end
  from pg_class r join pg_namespace n on n.oid = r.relnamespace
 where n.nspname = 'public' and r.relkind = 'r'
union all

-- ── Policies, vollstaendig ──
-- Mit Rollen und Ausdruecken. Ein Policy-Name allein sagt nichts
-- darueber, wen sie durchlaesst.
select 'policy|' || schemaname || '.' || tablename || '|' || policyname
       || '|' || cmd
       || '|' || coalesce(array_to_string(roles, ','), '-')
       || '|' || coalesce(qual, '-')
       || '|' || coalesce(with_check, '-')
  from pg_policies
 where schemaname in ('public', 'auth')
union all

-- ── Sequenzen und Identity-Spalten ──
-- recommendation_events.id ist bigint NOT NULL ohne Default, weil
-- pg_dump die Sequenz getrennt schreibt. Dieser Teil fehlte im alten
-- Dump. Hier steht beides.
select 'sequenz|' || sequence_schema || '.' || sequence_name
  from information_schema.sequences
 where sequence_schema = 'public'
union all
select 'identity|' || n.nspname || '.' || r.relname || '.' || a.attname
       || '|' || a.attidentity::text
  from pg_attribute a
  join pg_class r on r.oid = a.attrelid
  join pg_namespace n on n.oid = r.relnamespace
 where n.nspname = 'public' and a.attidentity <> '' and a.attnum > 0
union all

-- ── Rechte auf Tabellen ──
-- --no-privileges im alten Pfad hiess: nach einem Restore weiss
-- niemand mehr, was anon und authenticated durften. Bei einem Produkt
-- mit RLS ist das die halbe Sicherheitsarchitektur.
select 'recht|' || table_schema || '.' || table_name
       || '|' || grantee || '|' || privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
union all

-- ── Rechte auf Funktionen ──
select 'recht-fkt|' || routine_schema || '.' || routine_name
       || '|' || grantee || '|' || privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public'
   and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
union all

-- ── Cron-Jobs ──
-- Der zweite Befund der MVP-Gegenanalyse: ein Restore kann Schema und
-- Daten vollstaendig wiederherstellen und ein Produkt erzeugen, das
-- nichts mehr tut. Deshalb gehoeren die Jobs in den Fingerabdruck.
--
-- Der Befehlstext wird gekuerzt und nicht vollstaendig verglichen: er
-- enthaelt URLs und Vault-Verweise, und ein Zeilenumbruch mehr waere
-- ein Unterschied ohne Bedeutung. Verglichen wird, welche Edge
-- Function ein Job aufruft — das ist die Aussage, auf die es ankommt.
select * from pg_temp.cron_abdruck()

order by 1;
