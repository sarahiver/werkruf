# Google-Leistungsdaten (WP5)

Woher die Zahlen in „Deine Google-Woche" kommen, wie sie gespeichert
und zusammengerechnet werden, und was passiert, wenn Google nicht
liefert.

## Quelle

Business Profile Performance API v1,
`GET https://businessprofileperformance.googleapis.com/v1/locations/{id}:fetchMultiDailyMetricsTimeSeries`.

| | |
|---|---|
| Listing-ID | `google_locations.location_resource_name` (`locations/123…`) — nicht Place-ID, nicht UUID |
| OAuth-Scope | `business.manage`, derselbe wie bisher; keine neue Berechtigung beim Kunden |
| Aktivierung | Die API muss im Google-Cloud-Projekt aktiviert sein (APIs & Dienste → Bibliothek → „Business Profile Performance API"). Ohne sie: `performance_api_disabled`, siehe unten |

Metriken (nur aktuelle, keine veralteten):

```
CALL_CLICKS                          → Anrufe
WEBSITE_CLICKS                       → Website-Klicks
BUSINESS_DIRECTION_REQUESTS          → Routenanfragen
BUSINESS_IMPRESSIONS_DESKTOP_MAPS    ┐
BUSINESS_IMPRESSIONS_DESKTOP_SEARCH  │ → Aufrufe (Summe der vier)
BUSINESS_IMPRESSIONS_MOBILE_MAPS     │
BUSINESS_IMPRESSIONS_MOBILE_SEARCH   ┘
```

Nicht abgerufen: `BUSINESS_CONVERSATIONS`, `BUSINESS_FOOD_ORDERS`
(veraltet), `MESSAGING_CLICKS` (kein Messaging im Produkt; im CHECK der
Tabelle zugelassen), Suchbegriffe (`searchkeywords` — Datenminimierung,
nicht Teil von WP5).

## Speicherung

`public.google_performance_daily` — eine Zeile je Standort, Metrik und
Tag.

```
location_id  → google_locations (on delete cascade)
user_id      → auth.users       (on delete cascade)
metric, date, value (bigint ≥ 0), fetched_at, created_at, updated_at
PK (location_id, metric, date)
```

Der Primärschlüssel ist die Idempotenz: Der Worker schreibt per Upsert
(`onConflict: location_id,metric,date`). Derselbe Sync zehnmal ergibt
dieselben Zeilen; eine nachträgliche Korrektur von Google überschreibt
den Tageswert.

RLS aktiv, keine Policies, keine Rechte für `anon`/`authenticated`.
Nur `service_role` liest und schreibt. Ein Dashboard bekäme später eine
eigene Policy — nicht beiläufig.

Zustand am Standort: `google_locations.performance_synced_at`
(letzter Erfolg) und `performance_error_code` (letzter Fehler, null
nach Erfolg).

### Null ist nicht „keine Daten"

Google lässt `value` weg, wenn der Wert 0 ist — der Tag steht aber in
`datedValues`. Das wird als Zeile mit `value = 0` gespeichert. Ein Tag,
der in `datedValues` fehlt, hat keine Zeile. Die Mail unterscheidet
beides: Zeilen mit 0 → „0 Anrufe"; keine Zeilen → „liegen noch keine
Daten vor".

## Sync

Jobtyp `sync_insights` in `sync_jobs` (Jobtyp, Dedupe und CHECK gibt es
seit der Baseline). Ein Job je Standort — damit blockiert weder ein
Fehler die Bewertungs-/Profil-/Foto-Syncs, noch ein Standort den
anderen.

| | |
|---|---|
| Planung | `schedule_performance_syncs(p_age = '22 hours')`, aufgerufen von `google-business/sync/schedule` nach `schedule_all_syncs` — im bestehenden stündlichen `gbp-schedule`, kein neuer Cron |
| Ausführung | `gbp-worker` (alle 15 Min), Handler `sync_insights` → `PerformanceSyncService.syncLocation` |
| Zeitraum | letzte **14 Tage** bis gestern (UTC), rollierend — Google liefert verzögert und korrigiert nachträglich |
| Erstlauf | **90 Tage**, wenn der Standort noch keine Zeile hat. Ein Aufruf, dieselbe Quota wie 14 Tage |
| Priorität | 120 — hinter Bewertungen (100) und Standorten (50) |
| Quota | ein Aufruf je Standort und Tag |

## Fehlerverhalten

| Google | Code | Verbindung | Job |
|---|---|---|---|
| 401 (zweimal, nach Token-Refresh) | `reauth_required` | `needs_reauth` — wie bei allen Jobtypen, im Transport | aufgegeben |
| 403 „has not been used in project / is disabled / SERVICE_DISABLED" | `performance_api_disabled` | **unberührt** | 3 Versuche (1, 4, 9 Min), dann failed; `ops_alerts` §5 (sync.exhausted) meldet; `google_locations.performance_error_code` trägt den Code |
| 403 sonst | `insufficient_scope` | unberührt | 3 Versuche, dann failed |
| 404 | `not_found` | unberührt | 3 Versuche, dann failed |
| 429 / 5xx / Netz | `rate_limited` / `google_api_error` | unberührt | Transport-Retry mit Backoff, dann Scheduler-Retry |
| Parser | — | unberührt | unbekannte Metriken übersprungen und geloggt, kaputte Werte verworfen |

`performance_api_disabled` wird am Wortlaut erkannt
(`deutetAufDeaktivierteApi` in `googlePerformance.js`), weil Google
keinen eigenen Statuscode dafür hat. Ein echtes Berechtigungsproblem
(„The caller does not have permission") bleibt `insufficient_scope`.

Bewusst **nicht** in der Sofort-Aufgabe-Liste des Workers
(`reauth_required`, `not_connected`): Diese Liste spiegelt sich in
`AUFGEGEBEN_CODES` des Dashboards und bedeutet dort „der Kunde muss neu
verbinden". Eine nicht aktivierte API ist Sache des Betreibers. Drei
billige 403 je Standort und Tag sind der Preis dafür, dass kein Kunde
eine falsche Handlungsaufforderung sieht.

**Dashboard**: `useGoogleBusinessData` blendet `sync_insights`-Jobs aus
der Abgleich-Karte aus. Ein gescheiterter Leistungsdaten-Job stellt die
Karte nicht auf „Letzter Abgleich fehlgeschlagen". Das ist die einzige
Frontend-Änderung in WP5 und kein Redesign — ohne sie hätte WP5 eine
Regression in der Karte erzeugt.

Logs enthalten Standort, Modus, Zeitraum, Zeilen-/Metrikzahl, Dauer
und Fehlerklasse. Keine Tokens, keine Google-Rohantwort.

## Aggregation

Summen entstehen an genau einer Stelle: `performance_summary(location,
von, bis)` → `{ METRIC: { summe, tage } }`, nur Metriken mit Zeilen.

**Woche** — `weekly_performance_for_mail(location, now)`:

- Berichtswoche = jüngste Kalenderwoche Mo–So (Europe/Berlin) mit
  Zeilen an allen sieben Tagen: die direkt vergangene, sonst die
  davor. Grund: Google hängt 2–5 Tage hinterher; „letzte Woche: 7
  Anrufe" mit drei fehlenden Tagen wäre falsch.
- Vorperiode = die sieben Tage vor der Berichtswoche.
- Status `ok` / `unvollstaendig` (Zeilen da, aber keine der beiden
  Wochen komplett) / `keine_daten` (kein einziger Wert).

**Monat** — `monthly_performance(location, monat)`: Kalendermonat plus
Vormonat, `tage` vs. `kalendertage` sagt, ob er komplett ist.
Vorbereitet für die Rechnungsmail; WP5 baut keine Mail dafür.

**Zusammenführung und Vergleich** — `src/utils/googlePerformance.js`
(von Deno und Jest gleich geladen): Aufrufe aus den vier
Impressions-Metriken; Vergleichsregeln `12 → 15 = +3 (+25 %)`,
`5 → 0 = −5 (−100 %)`, `0 → 5 = +5` (kein Prozent aus Null),
`0 → 0 = unverändert`, Vorperiode unbekannt = „kein Vergleich". Nie
Infinity, nie NaN. Eine Kennzahl ohne Metrik fehlt — statt 0.

## Mail

Block „DEINE GOOGLE-WOCHE · 27.10.–02.11." in `weekly_summary`, vor
den Bewertungskacheln. Payload-Schlüssel `performance` aus
`schedule_communications`. Keine zweite Mail, keine neue Vorlage.

```
DEINE GOOGLE-WOCHE · 27.10.–02.11.
1.240 Aufrufe        +240 (+24 %) · Vorwoche 1.000
7 Anrufe             unverändert  · Vorwoche 7
18 Website-Klicks    −2 (−10 %)   · Vorwoche 20
12 Routenanfragen    +12          · Vorwoche 0
```

`keine_daten` → kein Block, die Mail sieht aus wie vor WP5.
`unvollstaendig` → „Für diesen Zeitraum liegen noch keine
Google-Leistungsdaten vor." Keine Nullen, keine technischen Meldungen.
Keine Aussagen über Kunden, Aufträge oder Umsatz — die API misst
Interaktionen.

## Deployment

```
1. Migration 20261109120000_performance_zahlen.sql anwenden
   (Actions → Apply Supabase migrations)
2. Edge Functions google-business und send-email deployen
   (deploy.yml bei Push auf main)
3. Performance API im Cloud-Projekt aktivieren — ohne sie laufen die
   Jobs in performance_api_disabled
4. Kein Cron ändern: gbp-schedule plant, gbp-worker arbeitet
```

Reihenfolge egal für die Sicherheit: Function vor Migration → der
Planer loggt `not_migrated` und plant nur Bewertungen/Standorte; die
Mail hat keinen `performance`-Schlüssel und zeigt keinen Block.
Migration vor Function → Jobs werden geplant, der alte Worker meldet
`no_handler` bis zum Deploy; `finish_sync_job` wiederholt sie.

## Smoke

1. Cloud Console: Performance API aktiv.
2. Migration angewendet (NOTICE `[wp5] in Ordnung`).
3. Functions deployt.
4. Konto mit zwei Standorten, verbunden.
5. `select public.schedule_performance_syncs();` → `insightJobs: 2`.
6. Nächsten Worker-Lauf abwarten (≤ 15 Min) oder `sync/run` anstoßen.
7. `select location_id, count(*), min(date), max(date) from
   google_performance_daily group by 1;` → beide Standorte, ~90 Tage,
   getrennt.
8. `select count(*) from (select location_id, metric, date from
   google_performance_daily group by 1,2,3 having count(*) > 1) d;` → 0.
9. `update google_locations set performance_synced_at = null;` und
   Schritte 5–8 wiederholen → gleiche Zeilenzahl (Idempotenz).
10. `select jsonb_pretty(public.weekly_performance_for_mail(
    '<location_id>'));` → `status: ok`, plausible Summen.
11. `EMAIL_DELIVERY_MODE=test`: Montagsmail erzeugen, Block prüfen,
    Zahlen gegen die Leistungsübersicht im Google-Unternehmensprofil
    plausibilisieren (Google rundet und verzögert — Größenordnung,
    nicht Cent).
12. Übrige Mail-Inhalte unverändert (Kacheln, Befund, Aufgaben,
    Profilwert, ein Knopf).
13. Performance API in der Console kurz deaktivieren, Standort mit
    `performance_synced_at = null`, Planen + Worker → Job `failed`,
    `error_code = performance_api_disabled`,
    `google_locations.performance_error_code = performance_api_disabled`,
    `google_accounts.status` bleibt `active`. API wieder aktivieren.
14. Reviews/Profile/Photos-Syncs laufen weiter (`sync_jobs` nach
    `job_type`).

## Tests

- `src/googlePerformance.test.js` — Parser, Vergleich,
  Zusammenführung, Mail-HTML, Verdrahtung (36 Tests)
- `supabase/tests/performanceZahlen.test.sql` — Speicherung, Isolation,
  Rechte, Woche/Vorwoche, Rückfall-Woche, Monat, Planung, Payload,
  Löschung
