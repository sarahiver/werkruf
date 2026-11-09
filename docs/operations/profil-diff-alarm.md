# Profil-Diff-Alarm — der Wächter (WP8)

WERKRUF vergleicht täglich, was der Betrieb bei Google hinterlegt hat
(Inhaber-Sicht), mit dem, was Google öffentlich zeigt (Consumer-Sicht).
Weicht etwas ab, wird es ehrlich benannt, gespeichert, als Aufgabe
geführt, bei kritischen Feldern sofort gemeldet — und der Betrieb
entscheidet, was passiert. **WERKRUF ändert nie etwas von selbst.**

## 1. Google API

| Zweck | Endpoint | Stabilität |
|---|---|---|
| Inhaber-Sicht | `GET v1/locations/{id}` (`readMask`) | v1, Hauptpfad |
| Öffentliche Sicht | `GET v1/locations/{id}:getGoogleUpdated` (`readMask`) → `location`, `diffMask`, `pendingMask` | v1, Hauptpfad |
| Attribute | `GET v1/locations/{id}/attributes` | v1 |
| Herkunft je Feld | `GET v1alpha/locations/{id}:getExtended` → Lifecycle (`…_UPDATED_BY_GOOGLE`, `…_PENDING`, `…_REJECTED`), `editTime`, `rejectionReason` | **v1alpha, nur ergänzend** |

`readMask` (`LOCATION_READ_MASK`, `google-api-helpers.ts`): name, title,
phoneNumbers, websiteUri, storefrontAddress, categories, regularHours,
specialHours, moreHours, serviceArea, profile, serviceItems, metadata,
**openInfo** (neu in WP8 — vorher war ein öffentlich „geschlossener"
Betrieb unsichtbar).

**v1alpha-Kapselung:** `GbpApiClient.getLocationExtendedOderNull()`
läuft nur mit Function-Secret `GBP_EXTENDED_EDIT_STATUS=on` (Standard:
aus). Jeder Fehler außer `reauth_required` → `null` → Herkunft bleibt
`unknown`, Texte bleiben neutral. Das Produkt funktioniert ohne Alpha
vollständig; mit Alpha werden die Texte präziser („Google hat deine
Telefonnummer aktualisiert", „Google hat deine Änderung nicht
übernommen" + Grund).

## 2. Sync-Integration

Kein neuer Cron, kein neuer Jobtyp. `sync_locations` (täglich je Konto,
`LocationSyncService.syncAccount`) holt nach dem Profil-Upsert je
Standort `:getGoogleUpdated` (+ optional `:getExtended`), berechnet die
Diffs (`src/utils/profilDiff.js`, geteilt mit Jest) und schreibt sie
über `upsert_profile_diffs()`.

Fehlerverhalten (§10):

| Fehler | Wirkung |
|---|---|
| 401 / `invalid_grant` → `reauth_required` | wird weitergeworfen, bestehende Reauth-Logik (betrifft das Konto) |
| 403 (`insufficient_scope`), 404, Alpha nicht freigeschaltet | je Standort `failed++`, Log `profile_diff_failed`, **kein** `needs_reauth`, andere Standorte laufen weiter |
| 429 / 5xx | Transport wiederholt (bestehend: `isQuotaError`, `isRetryableStatus`) |

Der Profil-Sync selbst ist zu diesem Zeitpunkt bereits geschrieben —
ein Wächter-Fehler verliert nie Profildaten.

## 3. Normalisierung (`src/utils/profilDiff.js`)

| Feld | Vergleich |
|---|---|
| `phoneNumbers.primaryPhone` | nur Ziffern, `00`→`+`, nationale `0`→`+49` |
| `websiteUri` | ohne Schema/`www.`, Host klein, ohne Schluss-Slash, ohne Fragment; Query bleibt |
| `categories.*` | stabile ID (`categories/gcid:…`), nie Anzeigename; Nebenkategorien sortiert |
| `storefrontAddress` | Zeilen getrimmt/whitespace-normalisiert, PLZ/Ort/Land (upper) |
| `regularHours`/`specialHours` | strukturell über `zeitfensterGeaendert`/`sonderzeitenGeaendert` (gbpHours.js) |
| `openInfo` | nur `status`; `UNSPECIFIED` = unbekannt |
| `serviceArea` | tief sortiert |
| `attributes` | `attributeId → sortierte Werte` |

Fehlt ein Feld in der Consumer-Sicht, heißt das „wie Inhaber", nicht
„leer" — verglichen wird nur, wenn die `diffMask` den Pfad (oder ein
Kind) nennt oder die Consumer-Sicht einen Wert trägt.

## 4. Datenmodell — `google_profile_diffs`

Ein Datensatz je (Standort, Feld, **Zustand**): `fingerprint` =
(fieldPath, Consumer-Wert, changeType). `first_seen_at`/`last_seen_at`,
`resolved_at`/`resolved_by` (`sync`, `accepted`, `restored`). Unique:
höchstens ein offener Diff je (Standort, Feld). RLS: Inhaber liest
eigene; schreiben nur `service_role`.

`upsert_profile_diffs(user, location, diffs)` — idempotent (§7):

```
Mo  Telefon 040 123 ≠ 040 999   → new        (1 Zeile, Event)
Di  gleich                       → same       (last_seen_at, keine Zeile, kein Event)
Mi  Consumer wieder 040 123      → resolved   (resolved_by = sync; Event wird stale)
Do  Consumer 040 888             → new        (neue Zeile, neues Event)
```

Ein offener Diff, dessen Consumer-Wert sich ändert, wird geschlossen
(`sync`) und neu angelegt — Historie bleibt (§28).

## 5. Engine-Events

Quelle: `build_location_evaluation_context().profileDiffs`. Subjekt =
Diff-ID → Engine-Identität `(user, location, type, subject_id)` trägt
Dedupe und Resolution (`resolve_stale_events`). Kein eigener Dedupe.

| Event | Wann | Priorität | Kanal |
|---|---|---|---|
| `profile.closed_by_google` | Consumer `CLOSED_*`, Inhaber nicht | critical (90+) | Dashboard, Weekly, **Sofortmeldung** |
| `profile.external_change` | kritisches Feld weicht ab (Telefon, Website, Adresse, Hauptkategorie, Name) | critical | Dashboard, Weekly, **Sofortmeldung** |
| `profile.external_change` | mittleres Feld (Öffnungszeiten, Sonderzeiten, Nebenkategorien) | medium | Dashboard, Weekly |
| `profile.edit_pending` | eigene Änderung in `pendingMask` | low | Dashboard |
| `profile.edit_rejected` | Extended-API: REJECTED | medium | Dashboard, Weekly |
| (info: serviceArea, Attribute) | – | kein Event; nur Tabelle | – |

Klasse: alle `problem` (REGEL_KLASSE).

## 6. Mail

**Sofortmeldung** `profile_change_alert` — `plan_communications()` Kanal
1b: Events `profile.external_change`/`profile.closed_by_google` mit
`priority ≥ 80`, nicht gemeldet, je Standort eine Meldung; Vermerk
`delivered.notification`. Pro/FP only — die WP7-Free-Ausnahme bleibt
auf `critical_review_alert` beschränkt (Selbstprüfung in der Migration).

> **Google zeigt eine andere Telefonnummer — S&I**
> bei S&I ist aktuell öffentlich eine andere Angabe sichtbar als die von dir hinterlegte.
> **Telefonnummer** · Hinterlegt: 040 123456 · Öffentlich sichtbar: **040 987654**
> Im Dashboard siehst du beide Werte nebeneinander und entscheidest … WERKRUF ändert nichts von selbst.
> [Prüfen]

Überschrift je Herkunft (`diffUeberschrift`): pending → „Deine Änderung
wird von Google noch geprüft." · rejected → „Google hat deine Änderung
nicht übernommen." · updated_by_google → „Google hat deine X
aktualisiert." · unknown → „Google zeigt eine andere X." · closed →
„Google zeigt deinen Betrieb aktuell als geschlossen."

**Wochenmail:** `weekly_happened().profileChanges` → „Was passiert ist"
(max. 4 Zeilen, je Zustand ehrlich formuliert, aufgelöste als
„öffentlich wieder wie hinterlegt"). Prüfliste „Alles geprüft" nennt
den Wächter.

**Link:** Action-Token (Zweck `dashboard`) →
`/dashboard/google?betrieb=<id>&diff=<id>` → Betrieb wird gewählt,
Seite hebt den Diff hervor. Der Token ist Navigation, kein Zugriffsrecht.

## 7. Dashboard

`/dashboard/google` → Block „Google zeigt aktuell eine andere Angabe"
(`ProfilWaechter`), vor der Profilverwaltung: je Diff Überschrift,
Hinterlegt / Öffentlich sichtbar, Status, seit. Pending: kein Knopf,
Hinweis „nicht erneut einreichen". Rejected: Grund (übersetzt, kein
Enum), nur „Übernehmen". Name/Einzugsgebiet/Attribute: Link zu Google.

Pro/FP: „Meinen Wert wiederherstellen" / „Öffentliche Angabe übernehmen".
Free: sieht den Zustand, Hinweis „gehört zu WERKRUF Pro".

Der rohe Badge „Google-Änderung: phoneNumbers" im Stammdaten-Editor ist
entfallen (ersetzt durch den Wächter).

## 8. Accept / Restore — `POST location/diff-apply`

Body: `{ diffId, aktion: 'uebernehmen' | 'wiederherstellen' }`. **Kein
Feld, kein Wert vom Client.** Server:

1. `requireUser`, `requirePaidAccess` (Pro/FP)
2. Diff laden mit `user_id = auth` und `resolved_at is null`
3. `loadOwnLocation(diff.location_id, user)`
4. Katalog `DIFF_FELDER[fieldPath].patch` muss `true` sein. `false`
   (title, Kategorien, serviceArea, attributes) → UI zeigt nur den
   Hinweis „nur direkt im Google-Unternehmensprofil“, keine Knöpfe;
   Server weist ab. Kategorien: im Diff liegt der Anzeigename, Google
   braucht die stabile ID — kein Mapping, kein Raten.
5. `pending` → abgelehnt (Google rät von Re-Submit ab); `rejected` +
   `wiederherstellen` → abgelehnt
6. `baueAenderungAusDiff()` — explizit je Feld; phoneNumbers ergänzt
   `additionalPhones` aus dem Stand (Google: beide zusammen)
7. **derselbe Schreibweg wie der Editor:** `fuehreLocationUpdateAus()`
   (Feldmodell, Sperren je Betrieb, Zeitenprüfung, PATCH, Zurücklesen,
   pendingMask, Audit)
8. erst danach `resolve_profile_diff(…, 'accepted'|'restored')`

Kein Auto-Revert (§20). Audit `profile_diff.accepted`/`.restored`.

## 9. Support-Ansicht

Block „Profil-Wächter — n offen": Betrieb · Feld · Status · kritisch ·
seit (aus `google_profile_diffs`, lesend).

## 10. Deployment

1. Migration `20261110120000_profil_diff_alarm.sql` (Actions) —
   `NOTICE [wp8] in Ordnung`.
2. Functions `google-business`, `send-email`, `admin-ops` — automatisch
   beim Merge (Deploy-Workflow).
3. Frontend — automatisch; Production-Badge prüfen.
4. Optional: Secret `GBP_EXTENDED_EDIT_STATUS=on`, wenn die v1alpha
   Business Information API für das Projekt freigeschaltet ist. Ohne:
   alles läuft, Herkunft neutral.

Reihenfolge: Migration **vor** dem Functions-Deploy ist wichtig —
`sync_locations` ruft `upsert_profile_diffs`; ohne Migration vermerkt
der Wächter `failed` je Standort (Profil-Sync bleibt intakt).

## 11. Smoke (§44)

1. Migration anwenden, Deploy abwarten.
2. Nächster `gbp-schedule`-Lauf (stündlich) reiht `sync_locations` ein,
   wenn der letzte > 24 h her ist — oder im Dashboard „Jetzt abgleichen".
3. `select * from google_profile_diffs;` → bei unverändertem Profil
   leer; `sync_jobs.result → profileDiffs.checked = Standorte, failed = 0`.
4. In Google Business Profile einen Testwert ändern, der eine
   Abweichung erzeugt (z. B. Website über einen Nutzervorschlag — oder
   die Inhaber-Website im WERKRUF-Editor ändern und beobachten, dass
   Google sie als `pending` führt).
5. Sync → Diff erscheint (Tabelle, Dashboard-Block, Event im Feed).
6. Kritisch → `email_queue` `profile_change_alert` (Test-Modus
   `EMAIL_DELIVERY_MODE=test`); mittel → nur Weekly.
7. Zweiter Sync → keine zweite Mail, `same++`.
8. Änderung bei Google zurücknehmen → Sync → `resolved_by = sync`, Event
   verschwindet aus dem Feed.
9. Pending: eigene Änderung im Editor → Block zeigt „wird geprüft", kein
   Knopf.
10. Free-Nutzer: Block sichtbar, keine Knöpfe; `location/diff-apply`
    → 402/403.
11. Pro: „Meinen Wert wiederherstellen" → Google-PATCH, Diff
    `restored`, Audit.
12. Fremde `diffId` → 404.
13. WP5–WP7 Smoke weiterhin grün (Performance, Wochenmail, Free/Pro).
