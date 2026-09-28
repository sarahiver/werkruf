# Öffentlicher Funnel: Google Places und Report-Status

## Aktuelle Integration

Der Browser lädt die **Maps JavaScript API** einmalig aus `public/index.html`
mit `libraries=places`, deutscher Sprache und Region DE. `PlacesSearch` wartet
auf `google.maps.places.Autocomplete`, beschränkt Vorschläge auf deutsche
Betriebe (`establishment`) und fordert nur die im Funnel verwendeten Felder an.
Das Widget liefert dabei bereits Place Details; `PlacesService.getDetails` ist
weiterhin der kompatible Fallback für ältere Aufrufer.

Die Integration verwendet bewusst das Legacy-Autocomplete-Widget. Für ein
bestehendes Google-Cloud-Projekt, in dem das Widget verfügbar ist, ist keine
Migration nötig. Google stellt das Widget neuen Kunden seit dem 1. März 2025
nicht mehr bereit. Wenn das Produktionsprojekt danach neu angelegt wurde oder
Google die Legacy-Freigabe beendet, muss separat auf
`PlaceAutocompleteElement` migriert und dessen Browser-/Barrierefreiheits-
Verhalten abgenommen werden. Eine Mischung beider APIs im Funnel ist zu
vermeiden.

## Google-Cloud-Konfiguration für `werkruf.com`

1. Abrechnung für das Projekt aktivieren.
2. **Maps JavaScript API** und **Places API** aktivieren. Für eine spätere
   Migration zusätzlich **Places API (New)** aktivieren; das allein stellt das
   aktuelle Legacy-Widget nicht um.
3. `REACT_APP_GOOGLE_PLACES_API_KEY` beim Production-Build setzen.
4. Den Key als Browser-Key auf HTTP-Referrer beschränken, mindestens auf
   `https://werkruf.com/*` und `https://www.werkruf.com/*`; Preview-/Local-
   Domains nur gezielt ergänzen.
5. Die API-Beschränkung des Keys auf Maps JavaScript API und Places API setzen.
6. In Google Cloud nach dem Deployment erfolgreiche Requests sowie
   `RefererNotAllowedMapError`, `ApiNotActivatedMapError`, Quoten- und
   Abrechnungsfehler kontrollieren.

Bei nicht verfügbarem Script bleibt die manuelle Eingabe nutzbar. Eine
ausgewählte Google-Firma wird normalisiert; Place ID, Name, Adresse, Rating,
Rezensionszahl und Website werden übernommen. Die spätere Berechtigung zur
Verwaltung wird dadurch **nicht** behauptet: Sie wird erst über die bestehende
Google-Business-OAuth-Verbindung nachgewiesen.

## Datenaussagen und bekannte Produktlücke

Rating, Rezensionszahl, Website und Adresse sind öffentliche Google-Daten. Der
Sichtbarkeits-Score wird von WERKRUF berechnet. Die Zahl unbeantworteter
Rezensionen ist lediglich eine klar bezeichnete Schätzung. Der Funnel führt
keine Wettbewerbersuche und keine belastbare Umsatzverlustrechnung aus.

Der öffentliche Check speichert derzeit nur den Lead und die Analyse. Er ruft
keinen Mail-Endpunkt auf, erzeugt kein PDF und hängt kein vierseitiges Dokument
an. Die vorhandene `visibility_report`-Mailvorlage und der Fahrplan-Download im
authentifizierten Dashboard ändern diese Lücke nicht. Deshalb verspricht der
öffentliche Funnel bis zur Implementierung einer serverseitigen, beobachtbaren
Queue inklusive PDF-Erzeugung und Zustellstatus keinen PDF-Versand.
