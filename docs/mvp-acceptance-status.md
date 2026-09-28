# MVP-Abnahmestatus (Bestandsaufnahme 28.09.2026)

Ein grüner Unit-Test oder Build ersetzt weder die Datenbank- noch die
End-to-End-Abnahme. Insbesondere sind Staging und Produktion ohne direkten,
lesenden Datenbanknachweis als **unbestätigt** zu behandeln.

| Priorität | Aufgabe | Status | Nachweis | Offener Schritt |
| --------- | ------- | ------ | -------- | --------------- |
| P0.1 | RLS, Spaltengrants, Tokens und Definer-Funktionen | implementiert | Drei geordnete Migrationen und Katalogabfragen im Releaseplan | Katalogexport und Migrationshistorie in Staging/Produktion prüfen |
| P0.2 | pgTAP-Zwei-Nutzer-Isolation | implementiert | `supabase/tests/customer_isolation.sql` | Gegen isolierte lokale DB oder freigegebenes Staging ausführen |
| P0.2 | Zwei echte Supabase-Sitzungen und fremde Edge-IDs | implementiert | `supabase/tests/customer_isolation_sessions.mjs` | Mit synthetischen Staging-Konten ausführen; derzeit keine Secrets/Freigabe |
| P0.3 | Backup, Migration, Nachkontrolle, Restore | implementiert | `docs/customer-isolation-release-plan.md` | Staging-Abnahme und ausdrückliche Produktionsfreigabe |
| P1.1 | Registrierung, Bestätigung, Login, Session-Restore | implementiert | zentraler Post-Auth-Zielentscheid und Auth-Verhaltenstests | Echte Provider-/E-Mail-E2E-Abnahme in Staging |
| P1.2 | Zweistufiges GBP OAuth | implementiert | Single-use Confirm, Sessionbindung, Callback-Bereinigung | Berechtigungen und Quota in Google Cloud/Staging verifizieren |
| P1.3 | Erster Standortimport | implementiert | idempotentes Queueing, begrenztes Browser-Polling, getrennte Fehlerzustände | Worker mit Test-Google-Konto in Staging abnehmen |
| P1.4 | Autorisierte Betriebsauswahl | implementiert | serverseitige Besitzprüfung und persistiertes `selected_at` | Session-Test und Reload-E2E in Staging ausführen |
| P1.5 | Score und Aufgaben nur für ausgewählten Betrieb | implementiert | Standortgefilterte Review-, Reply-, Job- und Aktualitätsabfragen | Mit zwei Betrieben und realen synchronisierten Daten abnehmen |
| P2 | Öffentliche Places-Berechtigung/PDF-Versprechen entfernen | implementiert | Landingpage nutzt den Registrierungsweg; alte Infrastruktur bleibt ungeroutet | Desktop-/Mobile-Sichtprüfung in deploybarer Umgebung |

## Externe Blocker

* Es liegt weder ein freigegebener Staging-Zugang noch ein nachprüfbarer
  Produktions-Datenbankzugang vor. Deshalb sind Migrationen in beiden
  Umgebungen nicht als angewendet bestätigt.
* Google-Cloud-Projekt, OAuth-Testkonto und Quota-Konsole sind nicht zugänglich.
  Die bekannte Freigabe/Quota 300 kann daher nicht unabhängig bestätigt werden.
* Es wurden keine produktiven Migrationen, Deployments, Secret-Änderungen,
  Profiländerungen oder Kundenmails ausgeführt.
