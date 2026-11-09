# Zurückgestellte Arbeitspakete

Stand: 9. November 2026. Hier stehen Pakete, die nach Ist-Messung
**bewusst nicht gebaut** wurden — mit dem Grund und der Bedingung, unter
der sie wieder aufgenommen werden. Produktclaims zu diesen Themen gibt
es im Code nicht (geprüft: `PricingCard.js`, `ProGate.js`, `SmartCheck.js`,
`industryConfig.js`).

---

## WP11 Mitbewerber-Ereignisse — deferred

**Idee:** Veränderung im lokalen Umfeld erkennen (überholt bei Bewertungen,
neuer Betrieb, Review-Surge) → Event → Dashboard und Wochenmail.

**Messung (09.11.2026):**
- Es gibt **keine Mitbewerberdaten** im System — keine Tabelle, kein
  Sync, kein Feld (Code, 66 Migrationen, Docs durchsucht).
- Die Google-Business-Profile-APIs liefern **nur eigene Standorte**;
  einen Endpunkt für fremde Profile gibt es nicht.
- Die einzige Quelle für fremde Betriebe mit Bewertungszahl/Rating wäre
  die **Places API (New)** (Nearby/Text Search, kostenpflichtig je Call) —
  eine **neue externe Datenquelle mit laufenden Kosten**.
- Ein Vorher/Nachher-Vergleich setzt voraus, dass Bewertungszahl und
  Rating fremder Betriebe **über Wochen gespeichert** werden. Nach den
  Google Maps Platform Service Terms sind nur Place IDs (unbefristet)
  und Koordinaten (30 Tage) cachebar; für sonstige Places-Inhalte ist
  die Speicherung im Repo bereits als **freigabepflichtig** markiert
  (`docs/public-profile-report.md`, Gate `PUBLIC_REPORT_GOOGLE_TERMS_APPROVED`
  — produktiv nicht gesetzt).
- Nur mit Place IDs wäre allein `competitor.new_nearby` baubar — zu dünn
  für ein eigenes Paket.

**Entscheidung:** kein halbes Competitor-Produkt. Nichts gebaut: keine
Snapshots, kein Nearby Search, kein Ranking, keine Review-Vergleiche,
keine neuen API-Kosten.

**Wieder aufnehmen, wenn:** Datenquelle **und** Nutzung geklärt sind —
Rechtsfreigabe für Speicherung/Vergleich von Places-Inhalten im konkreten
Cloud-Projekt/Rechnungsland, Places-Billing aktiv, Kosten je Standort
akzeptiert. Grobe Call-Zahl bei 1 Nearby Search je Standort und Woche:
10 Kunden ≈ 12/Woche, 100 ≈ 120/Woche, 1.000 ≈ 1.200/Woche.

**Produktwahrheit:** „Wettbewerber-Monitoring“ aus `PricingCard.js` und
der Schein-Schritt „Wettbewerb in <Stadt> prüfen…“ sowie „Inkl.
Wettbewerber-Analyse“ aus `SmartCheck.js` entfernt (09.11.2026; beide
Komponenten werden aktuell nicht gerendert, der Claim stand aber im Code).
`ProGate.js` hatte „Wettbewerber-Check“ schon am 23.10. gestrichen.

---

## WP12 Fragen & Antworten — deferred

**Idee:** Google-Fragen am eigenen Profil überwachen → unbeantwortete
Frage erkennen → Antwortvorschlag → Aufgabe im Engine-Feed.

**Messung (09.11.2026, offizielle Google-Quelle):**
- Geprüfte Datenquelle: **My Business Q&A API**
  (`mybusinessqanda.googleapis.com/v1`, Scope `business.manage`; alte
  Pfade `mybusiness.googleapis.com/v4/…/questions`).
- Offizieller Change-Log der API
  (https://developers.google.com/my-business/content/qanda/change-log):
  - 2025-09-15: „On November 3, 2025, we will be discontinuing the My
    Business Q&A API“
  - **2025-11-03: „The My Business Q&A API was discontinued on November 3,
    2025. You can no longer read or post questions and answers using the
    API.“** Die Notification-Typen `NEW_QUESTION`, `NEW_ANSWER`,
    `UPDATED_QUESTION`, `UPDATED_ANSWER` sind ebenfalls deprecated.
- Die v4-Discovery (Inventur vom 29.09.2026) listet die alten
  `accounts.locations.questions.*`-Methoden noch — das Discovery-Dokument
  beschreibt die Oberfläche, nicht die Verfügbarkeit; die alten IDs werden
  laut Change-Log seit 2024-09-16 abgelehnt, der Dienst ist seit
  2025-11-03 abgeschaltet.
- Die Places API (New) liefert keine Fragen & Antworten.
- Ergebnis: **weder Lesen noch Schreiben** ist offiziell möglich
  (Fall C aus dem Auftrag).

**Entscheidung:** nichts gebaut. Ausdrücklich **nicht** als Ersatz:
Scraping, HTML-Parsing von Google Maps, Browserautomation, undokumentierte
Endpunkte, Zweckentfremdung von Places-Daten.

**Wieder aufnehmen, wenn:** Google eine offizielle, dokumentierte
Schnittstelle für Fragen & Antworten am eigenen Profil anbietet. Der
`gbp-api-monitor` beobachtet den GBP-Change-Log und meldet Einträge mit
Abschaltungs- oder Einführungswortlaut.

**Produktwahrheit:** Die Wochenmail nennt Fragen & Antworten bereits
ausdrücklich als **nicht geprüft** (`wochenstatus.js`, Test
`wochenstatus.test.js`). Kein Claim zu entfernen.
