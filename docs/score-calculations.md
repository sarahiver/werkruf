# Score-Berechnungen

## WERKRUF Score (kanonisch)

Der Wert heißt gegenüber Kunden **WERKRUF Score** — nicht „Google Ranking Score"
und nicht „Sichtbarkeit bei Google".

> Der WERKRUF Score zeigt den Zustand deines Google-Profils anhand der Daten, die
> WERKRUF tatsächlich messen kann. Er ist kein Google-Ranking.

`public.compute_location_health_score(user_id, location_id)` ist die kanonische
Berechnung. `public.compute_health_score(user_id)` bleibt als Einstieg erhalten,
wählt den Standort und delegiert.

### Standortbezug

Der Score gehört **immer zu genau einem Google-Standort**. Verbindlich, und in
SQL wie im Browser identisch:

| Lage | Verhalten |
| --- | --- |
| genau ein aktiver Standort | dieser, auch ohne Auswahl |
| mehrere mit Auswahl | der über `selected_at` gewählte |
| mehrere ohne gültige Auswahl | **kein Score** — nicht 0, nicht geraten |

Eine 0 wäre falsch: Sie sieht aus wie ein schlechter Betrieb. Stattdessen liefert
die Funktion `score: null` mit `grund: 'kein_standort'`.

Bis zum 30.09.2026 nahm die Berechnung den primären beziehungsweise ältesten
Standort und filterte die Bewertungen **gar nicht** nach Standort. Bei zwei
Betrieben ergab das einen Wert, der zu keinem von beiden gehörte.

### Faktoren

| Faktor | Datenquelle | Gewichtung |
| --- | --- | ---: |
| Antwortquote | `google_reviews.is_answered` **dieses Standorts** | 30 |
| Durchschnittsbewertung | `google_reviews.star_rating` dieses Standorts, linear 3,0–5,0 | 25 |
| Aktualität | neuestes `google_reviews.google_created_at` dieses Standorts | 20 |
| Profilangaben | Telefon, Website, Ort und Kategorie dieses Standorts | 15 |
| Fotos | `google_locations.google_media` dieses Standorts, fünf als Zielwert | 10 |

**Zur Fotoquelle:** Maßgeblich ist der tatsächliche Google-Medienstand des
Standorts, nicht die lokale Upload-Historie in `business_photos`. Letztere hängt
am Nutzer und enthält auch Bilder, die nie bei Google gelandet sind. Seit dem
30.09.2026 trägt `business_photos` zwar einen `location_id`, dieser dient aber
der Upload-Historie und dem Löschen — nicht dem Score.

### Score-Fassung

`SCORE_VERSION` wird von SQL und Browser mitgeliefert, derzeit **1**.

Die Funktionen aus den Paketen A bis C — Kategorien, Attribute, weitere Zeiten —
fließen bewusst **nicht** ein. Eine Formel heimlich zu erweitern hieße, dass der
Wert von gestern und der von heute verschiedene Dinge messen, ohne dass es jemand
merkt. Eine spätere Erweiterung erhöht die Nummer; alte und neue Werte dürfen
dann nicht als unmittelbar vergleichbar dargestellt werden.

`src/utils/healthScore.js` ist der deterministische Browser-Spiegel dieser
Berechnung. `useHealthScore` ergänzt ausschließlich Texte und Handlungsoptionen.
Die Google-Business-Decision-Engine übernimmt Score und Faktorwerte direkt aus
dem von `compute_health_score()` gelieferten Evaluation-Context; sie berechnet
keinen zweiten Health-Score.

## Die beiden Werte nicht verwechseln

| | WERKRUF Score | Visibility-Score |
| --- | --- | --- |
| Wer | eingeloggte Kunden | öffentlicher SmartCheck |
| Quelle | verbundenes Google-Konto | Places-Daten ohne Verbindung |
| Bezug | ein Standort | ein gesuchter Betrieb |
| Formel | 30/25/20/15/10 | siehe unten |
| Gespeichert in | Snapshots, `compute_location_health_score` | `user_profiles.visibility_score` |

`user_profiles.visibility_score` darf **keine Empfehlung im eingeloggten
Dashboard steuern**. Bis zum 30.09.2026 tat er das in `useDashboardBriefing` —
zwei verschiedene Messungen als dieselbe behandelt, und bei mehreren Betrieben
zusätzlich betriebsunabhängig.

## Öffentlicher Visibility-Score

Der öffentliche SmartCheck hat einen anderen Zweck und bleibt fachlich separat:
Er kann ohne Login nur Google-Places-Daten (Bewertung, Bewertungsanzahl und
Website) sehen. Er startet bei 100 und zieht entsprechend festen Schwellen bis
zu 40, 25 und 15 Punkte ab. Die gemeinsame Implementierung liegt in
`src/utils/visibilityScore.js` und wird sowohl vom SmartCheck als auch von den
Onboarding-/Profil-Flows verwendet.

`user_profiles.visibility_score` speichert dieses öffentliche Ergebnis. Die
Admin-Ansicht mittelt lediglich gespeicherte Visibility-Scores und stellt keine
weitere Score-Berechnung dar. Weekly Snapshots, E-Mails und
`get_health_score()` beziehen dagegen den kanonischen eingeloggten Health-Score
aus `compute_health_score()`.
