# Kundenisolation: Abnahme- und Releaseplan

## Nachweisstatus

- **Codeprüfung:** abgeschlossen. Die ursprüngliche Migration schützt Profilspalten nicht und der Security-Definer `touch_dashboard_visit(uuid)` akzeptiert im Baseline-Schema eine fremde Nutzer-ID. Die Korrekturmigration behebt beides; die Standortmigration bindet die Auswahl zusätzlich an Nutzer und aktives Google-Konto.
- **Lokaler/Staging-Test:** vorbereitet in `supabase/tests/customer_isolation.sql`, aber in dieser Arbeitsumgebung nicht ausgeführt (keine lokale Supabase-Instanz; der konfigurierte Pooler war per DNS nicht erreichbar).
- **Zwei echte Sitzungen:** als ausführbarer REST-/Edge-Akzeptanztest in `supabase/tests/customer_isolation_sessions.mjs` vorbereitet, aber ohne freigegebene Staging-URL und Test-Secrets nicht ausgeführt. Dieser Status ist ausdrücklich **nicht bestanden**.
- **Staging-Migrationsstand:** blockiert/unbestätigt. Ein GitHub-Deploy oder vorhandene Dateien im Repository gelten nicht als Nachweis.
- **Produktion:** nicht bestätigt. Es wurde ausschließlich ein lesender, fehlgeschlagener Verbindungsversuch unternommen. Keine Migration oder Datenänderung wurde ausgeführt.

## Read-only Inventur vor Freigabe

Ohne direkten Datenbankzugang im Supabase SQL Editor exakt
`supabase/tests/customer_isolation_audit.sql` ausführen und die vollständige
Ausgabe als Release-Artefakt sichern. Das Skript läuft in einer Read-only-
Transaktion und prüft Migrationshistorie, RLS, sämtliche relevante Policies,
Profil-Spaltenrechte, fehlende Browserrechte auf `oauth_tokens` sowie Definer-
und ACL-Eigenschaften der sensiblen RPCs.

Alternativ mit einem autorisierten Read-only-Zugang die folgenden Kataloge
exportieren und mit allen drei Migrationen vergleichen:

```sql
begin read only;
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public';
select table_name, grantee, privilege_type
from information_schema.role_table_grants where table_schema = 'public';
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants where specific_schema = 'public';
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
rollback;
```

Zusätzlich den tatsächlichen Supabase-Migrationsstand erfassen (Tabellenname je
CLI-Version vorab im Katalog verifizieren):

```sql
begin read only;
select version, name
from supabase_migrations.schema_migrations
where version in ('20260928143000', '20260928160000', '20260928170000')
order by version;
rollback;
```

Es müssen exakt alle drei Versionen in dieser Reihenfolge vorhanden sein. Diese
Abfrage ist getrennt in Staging und Produktion auszuführen und ihr Ergebnis als
Release-Artefakt abzulegen.

Die Ausgabe darf keine Grants auf `oauth_tokens` für `anon` oder `authenticated`, keine zusätzliche permissive Profil-UPDATE-Policy und keine öffentlich ausführbare tokenlesende Funktion enthalten.

## Staging-Ablauf

1. Point-in-time Backup beziehungsweise Staging-Snapshot erstellen und Wiederherstellung testen.
2. Migrationen in Versionsreihenfolge anwenden: `20260928143000_google_customer_isolation.sql`, `20260928160000_customer_isolation_hardening.sql`, danach `20260928170000_google_location_selection.sql`.
3. `psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/customer_isolation.sql` ausführen. Das Skript läuft in einer Transaktion und rollt alle Testdaten zurück.
4. Mit ausschließlich synthetischen Staging-Konten den echten Session-Test ausführen: `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:isolation:sessions`. Fremde IDs müssen leere Ergebnismengen beziehungsweise 403/404 liefern. Das Skript löscht die Auth-Nutzer abschließend; vor dem Lauf dennoch einen Snapshot anlegen.
5. Ergänzend Edge-Endpunkte für Location-Update und Medien mit eigenen und fremden IDs prüfen. Der automatisierte Session-Test deckt bereits Standortauswahl, Sync-Trigger und Reply-Update ab. Fremde IDs müssen 404 liefern und dürfen keine Jobs erzeugen.
6. Registrierung, Profilbearbeitung, Benachrichtigungseinstellungen, Foto-CRUD, OAuth-Confirm und einen Sync mit Test-Google-Konto prüfen.
7. Erst nach vollständig grüner Staging-Abnahme Produktionsfreigabe erteilen.

## Produktionsausführung

1. Wartungsfenster ankündigen; aktuellen Datenbank-Backup-/PITR-Zeitpunkt dokumentieren.
2. Read-only-Inventur erneut ausführen und gegen die freigegebene Staging-Ausgabe diffen.
3. Alle laut Inventur noch nicht vorhandenen Migrationen ausschließlich in der Reihenfolge `20260928143000_google_customer_isolation.sql`, `20260928160000_customer_isolation_hardening.sql`, `20260928170000_google_location_selection.sql` über den normalen Supabase-Migrationsprozess anwenden. Keine SQL-Editor-Einzeländerungen.
4. Unmittelbar danach Katalogabfragen sowie zwei bereits vorbereitete synthetische Produktiv-Testkonten prüfen. Keine realen Kunden- oder Google-Daten verändern.
5. Auth, Dashboard, OAuth-Status und Worker-Metriken beobachten. Bei Fehlern keine Policies ad hoc lockern.

## Wiederherstellung

Bevorzugt wird PITR auf den dokumentierten Zeitpunkt. Falls nur die Korrekturmigration zurückgenommen werden muss, müssen die vorherigen Grants, Policies und die frühere RPC-Definition **aus dem unmittelbar zuvor exportierten Katalogzustand** in einer eigenen, geprüften Down-Migration rekonstruiert werden. Ein pauschales `disable row level security` oder breite Grants an `authenticated` sind ausdrücklich kein zulässiger Rollback. Bei einem Dashboard-Ausfall bleibt die Datenbank geschlossen (fail closed), während die Anwendung zurückgerollt wird.
