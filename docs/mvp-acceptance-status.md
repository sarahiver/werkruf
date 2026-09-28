# MVP-Abnahmestatus (Bestandsaufnahme 28.09.2026)

Ein grüner Unit-Test oder Build ersetzt weder die Datenbank- noch die
End-to-End-Abnahme. Insbesondere sind Staging und Produktion ohne direkten,
lesenden Datenbanknachweis als **unbestätigt** zu behandeln.

| Priorität | Aufgabe | Status | Nachweis | Offener Schritt |
| --------- | ------- | ------ | -------- | --------------- |
| P0.1 | RLS, Spaltengrants, Tokens und Definer-Funktionen | blockiert | Read-only-Prüfung in `supabase/tests/customer_isolation_audit.sql`; Pooler-DNS war nicht auflösbar | SQL im Zielprojekt ausführen und Ausgabe prüfen |
| P0.2 | pgTAP-Zwei-Nutzer-Isolation | blockiert | `supabase/tests/customer_isolation.sql` ist vorbereitet, aber nicht ausgeführt | Gegen isolierte lokale DB oder freigegebenes Staging ausführen |
| P0.2 | Zwei echte Supabase-Sitzungen und fremde Edge-IDs | blockiert | Test prüft beide Richtungen sowie fremde Account-, Location-, Review- und Reply-IDs | Mit Staging-URL und Test-Secrets ausführen |
| P0.3 | Backup, Migration, Nachkontrolle, Restore | implementiert | `docs/customer-isolation-release-plan.md` | Staging-Abnahme und ausdrückliche Produktionsfreigabe |
| P1.1 | Registrierung, Bestätigung, Login, Session-Restore | implementiert | zentraler Post-Auth-Zielentscheid und Auth-Verhaltenstests | Echte Provider-/E-Mail-E2E-Abnahme in Staging |
| P1.2 | Zweistufiges GBP OAuth | implementiert | Single-use Confirm, Sessionbindung, Callback-Bereinigung | Berechtigungen und Quota in Google Cloud/Staging verifizieren |
| P1.3 | Erster Standortimport | implementiert | idempotentes Queueing, begrenztes Polling sowie eigener Leer- und Fehlerzustand | Worker mit Test-Google-Konto in Staging abnehmen |
| P1.4 | Autorisierte Betriebsauswahl | implementiert | serverseitige Besitzprüfung und persistiertes `selected_at` | Session-Test und Reload-E2E in Staging ausführen |
| P1.5 | Score, Aufgaben und Listen nur für ausgewählten Betrieb | implementiert | Summary, Latest Reviews, Bewertungsliste, Fotos und Sync-Aktion verwenden die persistierte Auswahl | Mit zwei Betrieben und realen synchronisierten Daten abnehmen |
| P2 | Öffentliche Places-Berechtigung/PDF-Versprechen entfernen | blockiert | Landingpage nutzt den Registrierungsweg; alte Infrastruktur bleibt ungeroutet | Desktop-/Mobile-Sichtprüfung in deploybarer Umgebung |

## Externe Blocker

* Es liegt weder ein freigegebener Staging-Zugang noch ein nachprüfbarer
  Produktions-Datenbankzugang vor. Deshalb sind Migrationen in beiden
  Umgebungen nicht als angewendet bestätigt.
* Google-Cloud-Projekt, OAuth-Testkonto und Quota-Konsole sind nicht zugänglich.
  Die bekannte Freigabe/Quota 300 kann daher nicht unabhängig bestätigt werden.
* Es wurden keine produktiven Migrationen, Deployments, Secret-Änderungen,
  Profiländerungen oder Kundenmails ausgeführt.

## MVP-Blocker

* Migrationshistorie und tatsächliches Zielschema sind noch nicht durch den
  Read-only-Audit nachgewiesen.
* pgTAP, Zwei-Sitzungs-Test und der vollständige Kundenflow wurden mangels
  erreichbarer Staging-Umgebung und Test-Secrets nicht ausgeführt.
* Account Management, Business Information und Reviews API wurden noch nicht
  mit einem freigegebenen Google-Testkonto verifiziert.
* GitHub CI kann ohne Repository-Remote beziehungsweise GitHub-Anmeldung in
  dieser Arbeitsumgebung nicht als erfolgreich bestätigt werden.

## Nach MVP

* Komfortabler Wechsel zwischen mehreren bereits autorisierten Betrieben. Für
  den MVP erfolgt die verbindliche Auswahl auf der Google-Profil-Seite.
* Weiterführende Reporting- und PDF-Funktionen; das vorhandene Legal-Gate
  bleibt bis zu einer separaten Freigabe geschlossen.
