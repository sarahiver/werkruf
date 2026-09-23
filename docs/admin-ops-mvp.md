# Admin/Ops-MVP – Betriebsprüfung

Stand: 23. September 2026

## Ergebnis und minimale Änderung

Die für den Kundensupport notwendigen Zustände werden bereits gespeichert. Deshalb ist **keine
Datenbankmigration notwendig**. Der Admin-Browser darf die sensiblen Betriebs- und Auth-Daten
jedoch nicht direkt lesen. Die Edge Function `admin-ops` prüft deshalb die serververwaltete
`app_metadata.role`, liest mit der Service Role ausschließlich die benötigten Felder und liefert
eine pro Kunde zusammengefasste, nur lesbare Diagnose.

Der Admin zeigt Unternehmen, Auth-E-Mail, Plan und Stripe-Status, Trial-Ende,
Google-Verbindungsstatus, letzten erfolgreichen Location-/Review-Sync, letzten Syncfehler samt
Zeitpunkt, aktuellen Health Score, Reviewzahl, offene Actions sowie die letzte Queue-Mail. Eine
priorisierte Klartextdiagnose beantwortet, warum der Kunde gerade nicht funktioniert.

## Gefundene Ops-Lücken

1. Der bisherige Admin las nur `user_profiles` und Leads. Auth-E-Mail, Google-Konto,
   Sync-Queue, Mail-Queue und Actions waren nicht sichtbar.
2. `google_place_id` im Profil war kein belastbarer Verbindungsstatus; maßgeblich ist
   `google_accounts.status` inklusive `needs_reauth`, `revoked` und `disconnected`.
3. Fehler werden bereits ausreichend gespeichert: `sync_jobs.error_code/error_message`,
   `google_accounts.last_error_code/last_error_at`, `email_queue.error_code/error_message` und
   `sync_runs.error_code/error_message`. Sie waren nur nicht kundenzentriert zugänglich.
4. Globale Cron-/HTTP-Ausfälle sind über `ops_alerts()`, `cron.job_run_details`, pg_net-Antworten
   und `sync_runs` nachvollziehbar. Der bestehende unabhängige `ops-alert` ist wichtig, weil ein
   Alarm über die defekte Mail-Queue sich nicht selbst melden könnte.
5. Der aktuelle Zustand der installierten Produktions-Crons liegt nicht im Repository und muss
   nach Deployment read-only geprüft werden. Diese Änderung startet und verändert keine Jobs.
6. Die Admin-Liste ist bewusst auf 100 Kunden und 1.000 letzte Queue-Einträge begrenzt. Das ist
   für den MVP angemessen; bei Wachstum braucht die Ansicht serverseitige Pagination.

## Erwartete aktive Scheduler

| Aufgabe | Zweck | Erwartung |
|---|---|---|
| Sync-Scheduler | `schedule_all_syncs()` füllt `sync_jobs` | aktiv, regelmäßig |
| Sync-Worker | Google-Jobs abarbeiten und `sync_runs` schreiben | aktiv, regelmäßig |
| Mail-Scheduler | `schedule_lifecycle_emails()` (und geplante Kommunikation) | genau ein Lifecycle-Pfad |
| Mail-Worker | `email_queue` senden, Fehler/Wiederholungen speichern | aktiv, regelmäßig |
| Sync-Maintenance | hängende Jobs/Runs lösen und alte Daten bereinigen | aktiv |
| Weekly Summary | Snapshots und Wochenmails erzeugen | wöchentlich |
| Ops Alert | `ops_alerts()` unabhängig prüfen und direkt alarmieren | alle 15 Minuten |
| OAuth-State Cleanup | abgelaufene OAuth-States entfernen | aktiv |

`check-trial-emails` darf nicht parallel zu `schedule_lifecycle_emails()` laufen, sonst drohen
doppelte Erinnerungen. In Produktion read-only prüfen:

```sql
select jobname, schedule, active from cron.job order by jobname;
select * from public.ops_cron_failures(60);
select jsonb_pretty(public.ops_alerts());
select * from public.ops_placeholder_check();
```

## Manuelle Admin-Abnahme

1. Als Nutzer ohne `app_metadata.role=admin` `/admin` und die Function aufrufen: Zugriff wird
   abgelehnt.
2. Als Admin `/admin` öffnen: Kundenname und Auth-E-Mail stimmen.
3. Einen aktiven, einen nicht verbundenen und – falls vorhanden – einen `needs_reauth`-Kunden
   vergleichen; Badge und Diagnose müssen den gespeicherten Status erklären.
4. Letzten erfolgreichen Sync und letzten Fehler mit `sync_jobs`/`google_locations` read-only
   gegenprüfen.
5. Health Score, Reviewzahl und offene Actions mit dem Kundendashboard vergleichen.
6. Je eine gesendete, wartende und fehlgeschlagene Mail prüfen; Vorlage, Status, Zeitpunkt und
   Fehlergrund müssen sichtbar sein.
7. Netzwerkfehler beim Laden simulieren: Der Admin zeigt eine verständliche Fehlermeldung und
   „Aktualisieren“ lädt erneut.
