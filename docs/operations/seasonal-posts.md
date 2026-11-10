# Saison-Beiträge (WP15)

WERKRUF erkennt einen saisonalen Moment (Weihnachten, Jahreswechsel, Ostern, Sommer, Heizsaison), legt dem Betrieb **eine** Aufgabe mit einem vorbereiteten, neutralen Beitragstext vor. Der Betrieb prüft, passt an, klickt. Erst dann sendet WERKRUF einen **STANDARD Local Post** (Text, ohne Angebot/CTA/Bild) an den eigenen Google-Standort.

**WERKRUF postet niemals ungefragt.** Es gibt keinen Zeitplan, keine Wiederholung, kein KI-generiertes Wording.

## Was der Nutzer sieht

1. Dashboard „Nächste Schritte" / Wochenmail: „Weihnachtsbeitrag vorbereiten" (growth, low → medium kurz vor Fensterende, nie critical, keine Sofortmail).
2. Klick → `/dashboard/google?season=weihnachten&year=2026` → Karte mit Vorlage, Textfeld, Zähler, „Original wiederherstellen", „Auf Google veröffentlichen".
3. Nach dem Klick: **„Beitrag wurde an Google übermittelt."** — Google liefert bei `create` normalerweise `PROCESSING`. Das ist nicht „live". Nur bei `LIVE` steht „veröffentlicht".
4. Google lehnt ab (`REJECTED`) → sichtbar, Text anpassen, erneut veröffentlichen. Die Aufgabe bleibt offen.

Free-Nutzer: Karte wird nicht gerendert (ProGate), Server antwortet 402, SQL antwortet `kein_zugang`.

## Saisonkatalog (`src/utils/saisonBeitraege.js`)

| Key | Fenster | dringend ab | gilt für |
|---|---|---|---|
| `weihnachten` | 01.12.–23.12. | 7 Tage vor Ende | alle |
| `jahreswechsel` | 27.12.–06.01. (Saisonjahr = Jahr des 27.12.) | 4 | alle |
| `ostern` | 14 Tage vor Ostersonntag bis Ostersonntag | 5 | alle |
| `sommer` | 15.06.–15.07. | 7 | alle |
| `heizsaison` | 15.09.–31.10. | 10 | nur Google-Kategorie aus `HEIZUNGS_KATEGORIEN` (gcid), nie aus dem Firmennamen |

Alles deterministisch, `heute` wird injiziert. Kein `?date=`-Override, kein Produktionsdatum verbiegen. Vorlagen enthalten den Google-Titel des Betriebs und nichts, was `VERBOTENE_BEITRAGSMUSTER` trifft (Rabatt/%, €/Preis, Notdienst/24h, freie Termine/Termin sichern, Garantie). Vom Nutzer editierter Text wird nur auf Länge (20–1500 Zeichen) geprüft.

## Datenfluss

```
Engine (google-business, buildFacts)
  seasons.open = offeneSaisons(heute, primaryCategory)
                 minus context.seasonalPosts (publishing|published)
  → Regel content.seasonal_post → ein Event je (Standort, Saison, Jahr)
    subject_id = deterministischeUuid("season:<locationId>:<key>:<jahr>")

Dialog (SaisonBeitragDialog.js)
  POST location/seasonal-post-preview {locationId, seasonKey, seasonYear}
  POST location/seasonal-post         {locationId, seasonKey, seasonYear, eventId?, summary}

Server (handleSeasonalPostPublish)
  requireUser → requirePaidAccess → loadOwnLocation → Saison HEUTE offen
  → pruefeBeitragstext → seasonal_post_begin (Sperre)
  → Google v4 POST accounts/…/locations/…/localPosts {languageCode, summary, topicType: STANDARD}
  → seasonal_post_finish published|rejected|failed
  → record_recommendation_action(completed) nur bei published
  → audit seasonal_post.publish_started / .published / .failed
```

Der Client liefert **nie** parent, Resource-Namen, topicType, Token oder API-URL. Fehlt `eventId`, findet der Server das offene Event über die subject_id selbst.

## Datenbank (`20261113090000_saison_beitraege.sql`)

- `seasonal_posts`: `status ∈ draft|publishing|published|failed|rejected`, `google_state`, `google_post_name`, `summary_snapshot` (1–1500), `error_code`, `engine_event_id` (on delete set null). Kein Google-Payload, keine Tokens.
- Partieller Unique-Index `seasonal_posts_one_active (user_id, location_id, season_key, season_year) where status in ('publishing','published')` — Doppelklick und Race verlieren in SQL, `failed`/`rejected` sperren nicht, nächstes Jahr ist frei.
- RPCs nur `service_role`: `seasonal_post_begin` (→ `{ok,id}` | `kein_zugang` | `bereits_veroeffentlicht` | `laeuft_bereits`; fremder Standort/Event → 42501), `seasonal_post_finish` (nur aus `publishing`), `seasonal_post_state_update` (`REJECTED` nachtragen).
- RLS: `authenticated` liest nur eigene Zeilen, schreibt nie.
- `build_location_evaluation_context` liefert `seasonalPosts` (publishing/published) für die Dedupe der Regel.

## Google API

`https://mybusiness.googleapis.com/v4/{parent}/localPosts` (`accounts.locations.localPosts.create`). Nicht von der 2023-Abschaltung betroffen (nur `reportInsights`). Antwort-`state`: `LIVE | PROCESSING | REJECTED`. Scope `business.manage` ist bereits erteilt; keine neue API muss aktiviert werden.

Fehlerklassen bleiben die bestehenden: 401/403 → `reauth_required` (409), 429 → `rate_limited`, 5xx → `google_api_error` (502), 400 → `google_validation`. Kein automatischer Retry — der Nutzer klickt erneut.

## Betrieb

- Betriebsferien (WP13) blockieren das manuelle Veröffentlichen **nicht**; Engine/Wochenmail folgen weiter den Pause-Regeln.
- Admin-Support-Snapshot: „Saison-Beiträge: n übermittelt · m fehlgeschlagen · zuletzt <saison> <jahr> (<status>/<state>)" — ohne Beitragstext.
- Prüfen in SQL: `select season_key, season_year, status, google_state, error_code, created_at from seasonal_posts where user_id = '<uuid>' order by created_at desc;`
- Ein Post mit `status = published` und `google_state = PROCESSING` ist normal; Google schaltet meist binnen Minuten auf LIVE. WERKRUF pollt nicht; `seasonal_post_state_update` steht für einen späteren Sync bereit.

## Tests

- Jest `src/saisonBeitraege.test.js` (T1–T39, Admin, D1–D6): Fenster, Jahreswechsel, Ostern, Heizkategorie, Subjekt, Regel, Vorlagen, Textprüfung, Statuswortlaut, Zugang/Ownership/Client-Felder (Quelltext), Provider (Endpoint, STANDARD, PROCESSING≠live, REJECTED, Fehlerklassen), Idempotenz, Dialog.
- SQL `supabase/tests/saison_beitraege.test.sql`: Free/Pro/FP, fremder Standort/Event 42501, Formchecks, Sperre, Race am Index, finish/state_update, Kontext, sync_events/completed, Rechte, Löschkaskaden.
- Gegenproben C1–C10 (Fenster weg, Dedupe weg, Free weg, Ownership weg, Client-parent, OFFER, Rabatt-Vorlage, PROCESSING=live, Sperre weg, Dashboard rechnet selbst) werden jeweils rot.

## Ausdrücklich nicht in WP15

Social Media, KI-Texte, Zeitplanung/Scheduling, Wiederholung, Angebote/Offer-Posts, Bilder/CTA, automatisches Posten, Bulk über mehrere Standorte, Status-Polling.
