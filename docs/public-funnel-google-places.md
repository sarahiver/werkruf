# Öffentlicher Funnel: Google-Profil-Check

## Fachliche Abgrenzung

Der öffentliche Check ist **kein Google-Ranking, keine Messung der lokalen
Sichtbarkeit und nicht der kanonische eingeloggte Health Score**. Er nutzt nur
die bei der Betriebsauswahl angeforderten öffentlichen Places-Felder. Der
Health Score und `compute_health_score()` bleiben unverändert und werden erst
nach Registrierung, Google-Business-OAuth und bestätigtem Standort verwendet.

## Abruf, Kosten und Attribution

Das Legacy-Autocomplete-Widget fordert einmalig `place_id`, `name`,
`formatted_address`, `address_components`, `rating`, `user_ratings_total` und
`website` an. Diese Details aus der Auswahl werden wiederverwendet; nur alte
Aufrufer, die ausschließlich eine Place ID liefern, lösen `getDetails` als
Fallback aus. So gibt es im normalen öffentlichen Ablauf keinen doppelten
Details-Abruf.

Google rechnet Place-Details nach den angeforderten Feldern/SKUs ab. Zusätzliche
öffentliche Felder wie `business_status`, `opening_hours` und `types` könnten
einen Status bzw. Öffnungszeiten erklären, verbessern diesen bewusst kleinen
Profilvollständigkeits-Check aber nicht ausreichend, um zusätzliche Requests,
Kosten und UI-Komplexität zu rechtfertigen. Fotos oder Rezensionstexte werden
nicht angefordert. Vor einer Migration auf Places API (New) müssen Field Mask
und aktuelle SKU-Zuordnung erneut geprüft werden.

Offizielle Referenzen:

- [Place Data Fields und SKU-Kategorien](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- [Places API – Policies und Attribution](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Maps JavaScript API – Place Autocomplete](https://developers.google.com/maps/documentation/javascript/legacy/place-autocomplete)
- [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)

Die Google-Auswahl bleibt mit Google-Attribution sichtbar. In eigener
Darstellung werden Google-Daten, WERKRUF-Berechnung und nicht verfügbare Werte
explizit unterschieden.

## Datenzustände

`0` Rezensionen ist ein echter Wert. Ein nicht geliefertes Feld bleibt dagegen
`null` und erhält ein separates `…Available: false`. Ein fehlender Datensatz,
ein unvollständiger API-Response und ein API-Fehler sind damit unterscheidbar:

- manuelle Eingabe: keine öffentlichen Google-Daten, kein Score;
- ausgelassenes Feld: „nicht verfügbar“, kein Malus;
- bestätigter Nullwert: fachlich verarbeitet (insbesondere neues Profil);
- API-Fehler: eigener `error`-Zustand mit erneuter Auswahl/manueller Alternative.

## Endgültige Definition des öffentlichen Scores

Der **vorläufige öffentliche Profil-Score** normalisiert ausschließlich die
verfügbaren Kriterien auf 0–100:

| Kriterium | Gewicht | Punkte |
| --- | ---: | --- |
| öffentliche Bewertung | 45 | ≥4,5: 45; ≥4,0: 36; ≥3,5: 27; ≥3,0: 18; sonst 9 |
| öffentliche Rezensionen | 30 | 0: 24 (neutraler Start); 1–4: 18; 5–19: 22; 20–49: 26; ≥50: 30 |
| Website-Verknüpfung | 25 | vorhanden: 25; bestätigt fehlend: 0 |

Bei null Rezensionen ist eine Bewertung nicht anwendbar und wird aus dem Nenner
entfernt. Nicht gelieferte Felder werden ebenfalls aus Zähler und Nenner
entfernt. Sind keine Kriterien verfügbar, wird kein Score angezeigt. Die
Gewichte priorisieren das sichtbare Vertrauenssignal Bewertung, ohne neue
Profile allein für ihre kurze Historie abzuwerten. Jede Ergebnisansicht zeigt
die tatsächlich verwendeten Kriterien und Teilpunkte.

Die frühere Berechnung startete bei 100 und zog bis zu 35 Punkte für fehlendes
Rating, 25 für null Rezensionen und 15 für eine fehlende Website ab. Ihre
Schwächen: `0` und nicht geliefert waren vermischt, junge Profile erhielten
doppelte Abzüge, der Name „Sichtbarkeits-Score“ suggerierte eine nicht gemessene
Auffindbarkeit, Schwellen wurden als Marktstandard dargestellt, und eine
Antwortlücke wurde aus der Rezensionszahl erfunden. Diese Schätzung ist
entfernt; die echte Antwortquote wird erst autorisiert geprüft.

## Speicherung und Übergabe

Im `sessionStorage` werden für den Hand-off nur E-Mail (falls freiwillig
angegeben), Name, Datenquelle und Place ID gehalten. Rating, Rezensionszahl,
Adresse, Website und öffentlicher Score werden nicht dauerhaft gespeichert.
Google erlaubt Place IDs als Ausnahme von allgemeinen Caching-Beschränkungen;
vor jeder weitergehenden Speicherung muss die zulässige Nutzung gesondert
geklärt werden. Auch Onboarding persistiert keine öffentlichen Bewertungsdaten
als kanonischen Health Score. Eine Places-Auswahl ist nur eine Vorauswahl und
kein Nachweis, dass der Nutzer den Standort verwaltet.

Der primäre CTA führt ohne vorgeschaltete Pflicht-E-Mail und ohne separate
Erfolgsseite direkt zu Signup. Die freiwillige Lead-Erfassung bleibt sekundär
erhalten. Danach folgen Google-Business-OAuth, Standortbestätigung und der
autorisierte Health Score mit priorisierten Aufgaben.
