# Feiertags-Kalender (WP9)

Zwei Wochen vor einem gesetzlichen Feiertag erinnert WERKRUF den
Betrieb, wenn bei Google für diesen Tag keine Sonderöffnungszeit
hinterlegt ist. Der Betrieb entscheidet mit einem Klick: geschlossen,
reguläre Zeiten übernehmen, andere Zeiten. Keine Kalender-App, kein
Personalplaner — nur Google-`specialHours`.

## 1. Feiertagsquelle — `src/utils/feiertage.js`

Eine Datei, geteilt zwischen Jest und der Edge Function. Keine externe
API, keine Tabelle: deutsche gesetzliche Feiertage sind deterministisch.

- **Fest:** Neujahr, Heilige Drei Könige (BW BY ST), Frauentag (BE MV),
  Tag der Arbeit, Mariä Himmelfahrt (SL), Weltkindertag (TH), Tag der
  Deutschen Einheit, Reformationstag (BB HB HH MV NI SN ST SH TH),
  Allerheiligen (BW BY NW RP SL), 1./2. Weihnachtstag.
- **Beweglich** (aus dem Ostersonntag, Meeus/Butcher): Karfreitag (−2),
  Ostermontag (+1), Christi Himmelfahrt (+39), Pfingstmontag (+50),
  Fronleichnam (+60; BW BY HE NW RP SL). Buß- und Bettag (SN): Mittwoch
  vor dem 23.11.
- Jedes Objekt: `{ id, name, date:{year,month,day}, iso, regions[], nationwide }`.

### Teilregionale Feiertage — bewusst nicht (§28)

Nicht erzeugt, weil aus Standortdaten nicht sicher bestimmbar:
Fronleichnam in Sachsen/Thüringen (nur Gemeinden), Augsburger
Friedensfest (Stadt Augsburg), Mariä Himmelfahrt in Bayern
(überwiegend katholische Gemeinden). Kein False Positive; wer dort
schließt, hinterlegt die Sonderzeit wie bisher im Editor.

## 2. Bundesland

Quelle ausschließlich `storefrontAddress.administrativeArea` (plus
`regionCode = DE`), normalisiert über eine Alias-Tabelle
(ausgeschrieben, ohne Umlaute, englisch, Kürzel: „Hamburg", „NRW",
„Thueringen", „Lower Saxony" …). Unbekannt → `confidence: unknown` →
**nur bundesweite Feiertage**. Kein Raten aus Ort, PLZ oder Firmenname.
Keine Nutzeraufgabe „Bundesland ergänzen".

## 3. Fenster und Priorität

`today ≥ holiday − 14 && today ≤ holiday`. 14–8 Tage: **medium**; 7–0
Tage: **high**. Nie critical, kein Sofortalarm — Dashboard und
Wochenmail (unter den max. 3 Aufgaben). Am Feiertag selbst bleibt die
Aufgabe (0 Tage), am Tag danach ist sie weg.

Jahreswechsel: das Fenster erzeugt beide berührten Jahre — am 20.12.
steht Neujahr des Folgejahres drin.

## 4. „Erledigt"

Ein `specialHours`-Eintrag, dessen Zeitraum (`startDate..endDate`) den
Tag abdeckt — egal ob geschlossen, abweichend oder ausdrücklich
regulär. WERKRUF bewertet nicht, ob geschlossen werden sollte.
**Reguläre Zeiten allein reichen nicht.**

## 5. Engine

Kontext (Migration `20261110150000`): `hours = { regularPeriods,
specialHourPeriods, storefrontAddress, reliable }` aus
`google_profile`. `reliable` = synchronisiert und regularHours
vorhanden — sonst keine Empfehlung aus Unwissen.

Regel `profile.holiday_hours_missing` (Klasse `problem`, capability
`profile.write`): ein Subjekt je offenem Feiertag, `subject_id` =
deterministische UUID aus (Standort, Datum) — stabil über die Tage, also
ein Event je Feiertag und Standort; Prioritätswechsel aktualisiert das
Event. Nach dem Feiertag oder mit Sonderzeit liefert die Regel nichts →
`resolve_stale_events` schließt es. Keine manuellen „completed".

Copy: „Weihnachten vorbereiten — Für den 25. Dezember sind bei Google
noch keine Sonderöffnungszeiten hinterlegt. 2 Min. [Öffnungszeiten
festlegen]". Keine Aussage „du musst geschlossen haben".

## 6. Action Flow

Aufgabe → bestehender Action-Token-Weg (`/einstieg` wählt den Betrieb)
→ `/dashboard/google?holiday=YYYY-MM-DD` → `FeiertagDialog` über der
Profilverwaltung: Feiertagsname, Datum, Bundesland; „Wie habt ihr an
diesem Tag geöffnet?" → Geschlossen / Reguläre Öffnungszeiten übernehmen
(zeigt die Zeiten des Wochentags) / Andere Öffnungszeiten (Zeitfenster,
Vorprüfung mit `pruefeSonderzeiten` aus `gbpHours`). Kein Feiertag für
dieses Bundesland → Hinweis, kein Formular. Free sieht den Dialog, kann
nicht schreiben.

## 7. Schreibweg — `POST location/holiday-hours`

Body `{ locationId, date, mode, hours? }`. Kein Feld, keine
`updateMask` vom Client. Server:

1. `requireUser`, `requirePaidAccess`, `loadOwnLocation`
2. Datum gültig, in `[heute, heute+14]`
3. `feiertagAm(date, bundesland)` — gesetzlicher Feiertag für diesen
   Standort (oder bundesweit), sonst 400
4. `baueSonderzeit()`: Einträge des Tages ersetzen, andere behalten;
   `regulaer` nimmt die Perioden des Wochentags, ohne → geschlossen
5. **derselbe Schreibweg wie der Editor:** `fuehreLocationUpdateAus`
   mit `{ specialHours }` → `pruefeAlles` (Dauer, Überschneidung,
   geschlossen neben Zeiten), PATCH, Zurücklesen, pendingMask
6. Audit `holiday_hours.updated` { locationId, holidayId, date, mode }

## 8. WP8-Interaktion (§49)

Der eigene Edit erscheint bei Google zunächst in `pendingMask`. WP8
führt das als `changeType: pending` (`profile.edit_pending`, low) —
„Deine Änderung wird von Google noch geprüft", **nicht** „Google zeigt
andere Sonderöffnungszeiten". Ist der Edit live, sind Inhaber- und
Consumer-Sicht gleich → kein Diff. Getestet.

## 9. Deployment

1. Migration `20261110150000_feiertags_kalender.sql` (Actions) —
   `NOTICE [wp9] in Ordnung`. Nur der Kontextbauer; keine Tabelle,
   kein Cron.
2. Function `google-business` — automatisch beim Merge.
3. Frontend — automatisch.

Ohne Migration liefert der Kontext kein `hours` → `reliable: false` →
die Regel schweigt (kein Fehler).

## 10. Smoke

1. Migration anwenden, Deploy abwarten.
2. Standort mit `administrativeArea` (z. B. Hamburg).
3. Nächster Feiertag > 14 Tage: nach `engine-daily` (04:30) oder
   `events/evaluate` keine Aufgabe.
4. Innerhalb 14 Tage (oder Testdatum: in der Testdatenbank
   `specialHours` leeren und Kontext prüfen): Aufgabe
   „<Feiertag> vorbereiten" auf der Übersicht, medium; ab 7 Tagen high.
5. CTA → `/dashboard/google?holiday=…` → richtiger Betrieb, Name, Datum.
6. „Geschlossen" → Google-PATCH `submitted_pending`/`_no_pending`,
   Audit `holiday_hours.updated`, lokaler Stand enthält den Eintrag.
7. Nächster Engine-Lauf → Aufgabe resolved.
8. Anderer Feiertag mit „Andere Öffnungszeiten" (ungültig → Hinweis vor
   dem Senden).
9. Zwei Standorte (HH/BY) → Reformationstag nur HH, Allerheiligen nur BY.
10. Free → Dialog ohne Knopf; `location/holiday-hours` → 402/403.
11. Montagsmail: Aufgabe unter den drei, kein eigener Block in „Was
    passiert ist".
12. WP8: nach dem Setzen zeigt der Wächter höchstens „wird geprüft",
    keine externe Änderung.
13. WP5–WP8 Smoke grün.
