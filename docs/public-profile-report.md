# Öffentlicher PDF-Profilbericht: Freigabe und Betrieb

## Verbindliches Google-Terms-Gate

Der Repository-Stand enthält weder die Google-Cloud-Projekt-ID noch das Rechnungsland oder den
konkret akzeptierten Vertrag. Damit lässt sich nicht belastbar entscheiden, ob für das eingesetzte
Projekt die allgemeinen oder die EWR-spezifischen Google Maps Platform Bedingungen gelten. Auch
die Zulässigkeit, Places-Inhalte in einem eigenständigen PDF dauerhaft zu speichern und an Dritte
weiterzugeben, ist ohne diese Vertragszuordnung und eine rechtliche Prüfung nicht hinreichend
geklärt.

Deshalb bleibt der produktive Endpunkt geschlossen, bis `PUBLIC_REPORT_GOOGLE_TERMS_APPROVED=true`
und `PUBLIC_REPORT_BILLING_COUNTRY` gesetzt sind. Die Freigabe muss Projekt-ID, Billing Account,
Rechnungsland, anwendende Terms-Fassung, Places-Produkt und die erlaubten Felder dokumentieren.
Place IDs sind getrennt von sonstigen Places-Inhalten zu beurteilen. Nutzereingaben (E-Mail) und
eigene WERKRUF-Auswertungen bleiben ebenfalls getrennt; eine eigene Auswertung macht die
zugrundeliegenden Google-Inhalte nicht automatisch frei weitergebbar.

Zulässige Alternative bei negativer oder offener Prüfung: PDF nur aus ausdrücklich vom Nutzer
eingegebenen Angaben erstellen oder Profildaten erst nach einer Google-Business-Profile-OAuth-
Autorisierung des Verwalters verarbeiten. Ein manueller Firmenname erzeugt nie einen Score.

Zu prüfende Primärquellen (Abruf im Build-Netz war am 28.09.2026 durch HTTP 403 blockiert):

- https://cloud.google.com/maps-platform/terms
- https://cloud.google.com/maps-platform/terms/maps-service-terms
- https://developers.google.com/maps/documentation/places/web-service/policies

## Architektur und Status

`request-profile-report` validiert E-Mail, Place ID und Branchenwert, prüft CAPTCHA und ein
atomisches Stundenlimit, lädt Places-Daten mit einem serverseitigen Schlüssel erneut und verwendet
den bestehenden `calculateProfileScore`. Danach werden Lead und Antrag verknüpft, ein zweiseitiges
PDF erzeugt, für 24 Stunden in einem privaten Bucket gespeichert und über `enqueue_email` in die
bestehende Queue gestellt. Die Queue enthält nur die Objekt-Referenz, niemals PDF-Bytes.

Statusfolge: `accepted` → `pdf_generating` → `pdf_created` → `email_queued` →
`provider_accepted`; `delivered` darf ausschließlich ein verifizierter Provider-Webhook setzen.
Fehler tragen nur Phase und Fehlercode. Der Worker validiert MIME-Type, Größe und PDF-Signatur,
lädt privat mit Service Role und übergibt Base64 als Brevo-Anhang. Für die erste Abnahme müssen
`EMAIL_DELIVERY_MODE=test` und `EMAIL_TEST_RECIPIENT` gesetzt sein.

Die Migration wird nicht automatisch ausgeführt. Vor Anwendung muss insbesondere die
E-Mail-Härtungsmigration `20260923120000_email_delivery_mvp.sql` in der Zielumgebung nachgewiesen
werden. Ein täglicher Ops-Job muss abgelaufene Bucket-Objekte und alte Rate-Limit-Zeilen löschen.
