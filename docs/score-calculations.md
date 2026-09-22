# Score-Berechnungen

## Eingeloggter Health-Score (kanonisch)

`public.compute_health_score(user_id)` im autoritativen Produktions-Snapshot ist
die kanonische Berechnung. Sie arbeitet ausschließlich mit aktiven Google-
Bewertungen, dem primären (sonst ältesten) aktiven Google-Standort und den in
`business_photos` gespeicherten Bildern.

| Faktor | Datenquelle | Gewichtung |
| --- | --- | ---: |
| Antwortquote | `google_reviews.is_answered` | 30 |
| Durchschnittsbewertung | `google_reviews.star_rating`, linear 3,0–5,0 | 25 |
| Aktualität | neuestes `google_reviews.google_created_at` | 20 |
| Profilangaben | Telefon, Website, Ort und Kategorie eines Standorts | 15 |
| Fotos | `business_photos`, fünf als Zielwert | 10 |

`src/utils/healthScore.js` ist der deterministische Browser-Spiegel dieser
Berechnung. `useHealthScore` ergänzt ausschließlich Texte und Handlungsoptionen.
Die Google-Business-Decision-Engine übernimmt Score und Faktorwerte direkt aus
dem von `compute_health_score()` gelieferten Evaluation-Context; sie berechnet
keinen zweiten Health-Score.

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
