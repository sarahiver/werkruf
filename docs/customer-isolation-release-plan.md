# Kundenisolation: Abnahme- und Releaseplan

## Nachweisstatus

- **Codeprüfung:** abgeschlossen. Die ursprüngliche Migration schützt Profilspalten nicht und der Security-Definer `touch_dashboard_visit(uuid)` akzeptiert im Baseline-Schema eine fremde Nutzer-ID. Die Korrekturmigration behebt beides.
- **Lokaler/Staging-Test:** vorbereitet in `supabase/tests/customer_isolation.sql`, aber in dieser Arbeitsumgebung nicht ausgeführt (keine lokale Supabase-Instanz; der konfigurierte Pooler war per DNS nicht erreichbar).
- **Produktion:** nicht bestätigt. Es wurde ausschließlich ein lesender, fehlgeschlagener Verbindungsversuch unternommen. Keine Migration oder Datenänderung wurde ausgeführt.

## Read-only Inventur vor Freigabe

Mit einem autorisierten Read-only-Zugang die folgenden Kataloge exportieren und mit beiden Migrationen vergleichen:

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

Die Ausgabe darf keine Grants auf `oauth_tokens` für `anon` oder `authenticated`, keine zusätzliche permissive Profil-UPDATE-Policy und keine öffentlich ausführbare tokenlesende Funktion enthalten.

## Staging-Ablauf

1. Point-in-time Backup beziehungsweise Staging-Snapshot erstellen und Wiederherstellung testen.
2. Migrationen in Versionsreihenfolge anwenden: zuerst `20260928143000_google_customer_isolation.sql`, dann `20260928160000_customer_isolation_hardening.sql`.
3. `psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/customer_isolation.sql` ausführen. Das Skript läuft in einer Transaktion und rollt alle Testdaten zurück.
4. Mit echten Supabase-Sessions der Nutzer A und B zusätzlich REST-Aufrufe gegen PostgREST durchführen. Fremde IDs müssen leere Ergebnismengen beziehungsweise 403 liefern.
5. Edge-Endpunkte für Location-Update, Medien, Sync-Trigger und Replies mit eigenen und fremden IDs prüfen. Fremde IDs müssen 404 liefern und dürfen keine Jobs erzeugen.
6. Registrierung, Profilbearbeitung, Benachrichtigungseinstellungen, Foto-CRUD, OAuth-Confirm und einen Sync mit Test-Google-Konto prüfen.
7. Erst nach vollständig grüner Staging-Abnahme Produktionsfreigabe erteilen.

## Produktionsausführung

1. Wartungsfenster ankündigen; aktuellen Datenbank-Backup-/PITR-Zeitpunkt dokumentieren.
2. Read-only-Inventur erneut ausführen und gegen die freigegebene Staging-Ausgabe diffen.
3. Beide noch nicht in Produktion vorhandenen Migrationen ausschließlich über den normalen Supabase-Migrationsprozess anwenden. Keine SQL-Editor-Einzeländerungen.
4. Unmittelbar danach Katalogabfragen sowie zwei bereits vorbereitete synthetische Produktiv-Testkonten prüfen. Keine realen Kunden- oder Google-Daten verändern.
5. Auth, Dashboard, OAuth-Status und Worker-Metriken beobachten. Bei Fehlern keine Policies ad hoc lockern.

## Wiederherstellung

Bevorzugt wird PITR auf den dokumentierten Zeitpunkt. Falls nur die Korrekturmigration zurückgenommen werden muss, müssen die vorherigen Grants, Policies und die frühere RPC-Definition **aus dem unmittelbar zuvor exportierten Katalogzustand** in einer eigenen, geprüften Down-Migration rekonstruiert werden. Ein pauschales `disable row level security` oder breite Grants an `authenticated` sind ausdrücklich kein zulässiger Rollback. Bei einem Dashboard-Ausfall bleibt die Datenbank geschlossen (fail closed), während die Anwendung zurückgerollt wird.
