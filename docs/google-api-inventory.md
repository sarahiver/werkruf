# Google-Business-Profile-APIs — Bestandsaufnahme

Stand: 29. September 2026

Diese Datei hält fest, was **tatsächlich gegen Google geprüft** wurde.
Die vollständige, maschinell erzeugte Inventur entsteht mit
`scripts/google-api-inventory.mjs` — siehe „Erzeugung".

---

## Erzeugung

```bash
node scripts/google-api-inventory.mjs           # schreibt docs/google-api-inventory.generated.{json,md}
node scripts/google-api-inventory.mjs --check   # nur Erreichbarkeit, Exit 1 bei Ausfall
```

Ruft ausschließlich öffentliche, unauthentifizierte Discovery-Dokumente
ab. Keine Kundendaten, keine Schreibzugriffe, keine Anmeldedaten.

**Braucht ausgehenden Netzzugriff auf `*.googleapis.com`.** In der
Umgebung, in der diese Datei entstand, war der geblockt (HTTP 403 vom
Egress-Proxy). Das Skript hat den Ausfall als „nicht erreichbar"
vermerkt, statt eine leere Inventur zu erfinden — das ist zugleich der
Testfall „Quelle nicht erreichbar". Ausführen lokal, in CI oder über die
Monitoring-Function.

---

## Geprüfte Quellen

Ergebnis des Workflow-Laufs vom 29.09.2026, 11:06 UTC:

| API | Spezifikation abrufbar | Revision | Methoden | Felder |
|---|---|---|---|---|
| My Business Business Information v1 | ja | `20260928` | 15 | 155 |
| My Business Account Management v1 | ja | `20260928` | 16 | 43 |
| My Business Place Actions v1 | ja | `20260928` | 6 | 14 |
| My Business Notifications v1 | ja | `20260928` | 2 | 3 |
| Business Profile Performance v1 | ja | `20260928` | 3 | 24 |
| My Business Verifications v1 | ja | `20260928` | 6 | 56 |
| My Business Lodging v1 | ja | `20260928` | 3 | 591 |
| **Google My Business v4** | **nein**, HTTP 404 | — | — | — |

Sieben der acht sind unauthentifiziert erreichbar und liefern gültiges
JSON mit `revision`-Feld. **Dieses Feld ist der billigste
Änderungsfilter für das Monitoring** — ändert es sich nicht, hat sich am
Dokument nichts geändert.

### Sonderfall Google My Business v4

Der von Google dokumentierte Endpunkt
`https://mybusiness.googleapis.com/$discovery/rest?version=v4`
antwortet mit **404**. Das ist kein neues Problem — es ist seit Jahren
gemeldet, und die Dokumentationsseite nennt die URL trotzdem.

Google veröffentlicht stattdessen eine **statische Beispieldatei**:
`https://developers.google.com/static/my-business/samples/mybusiness_google_rest_v4p9.json`

Sie ist abrufbar (geprüft 29.09.2026), hat aber zwei Einschränkungen:

| | |
|---|---|
| `revision` | `"0"` — **kein Änderungssignal**. Der billige Vorabfilter entfällt für diese API |
| Aktualität | Älter als die Referenzdokumentation. Es fehlen unter anderem Felder auf `accounts.locations.reviews` |

**Wirkung auf Paket 3:** Für v4 reicht der Prüfsummenvergleich der
statischen Datei nicht. Dort muss zusätzlich der offizielle Change Log
herangezogen werden. Das ist ausgerechnet die API, über die WERKRUF
Bewertungen, Antworten und Medien abwickelt — also die mit dem höchsten
Änderungsrisiko für den Produktivbetrieb.

---

## Befunde mit unmittelbarer Wirkung

### 1. Felder, die Google nur als Ganzes annimmt

Schema `PhoneNumbers`: Bei Aktualisierungen müssen beide Felder gesetzt
sein; Clients dürfen primäre und zusätzliche Nummern nicht einzeln über
die Änderungsmaske aktualisieren.

Schema `Categories`: Dieselbe Einschränkung für Haupt- und
Zusatzkategorien.

**Wirkung:** `updateMask=phoneNumbers.primaryPhone` ist unzulässig.
Beim Ändern der Hauptnummer müssen die vorhandenen `additionalPhones`
mitgeschickt werden, sonst löscht das Speichern sie.

Umgesetzt als `WHOLE_OBJECT_ONLY_FIELDS` in `google-api-helpers.ts`;
Unterpfade dieser Felder werden serverseitig verworfen statt
stillschweigend erweitert.

`Profile` ist nicht betroffen — es hat nur `description`.

### 2. „Google prüft" ist über die API abbildbar

| Feld | Schema | Bedeutung |
|---|---|---|
| `metadata.hasPendingEdits` | `Location.Metadata` | Mindestens eine Eigenschaft ist im Zustand „Bearbeitung ausstehend" |
| `pendingMask` | `GoogleUpdatedLocation` | Felder, für die der Inhaber eine Änderung eingereicht hat, die noch nicht auf Maps und in der Suche veröffentlicht ist |

Damit ist Zustand 3 aus Teil 1.2 abbildbar — über `pendingMask`,
abgerufen per `locations.getGoogleUpdated`.

**Die Warnung der Spezifikation ist berechtigt:** `diffMask` ist etwas
anderes. Es nennt Felder, in denen die Verbraucheransicht von den
Angaben des Inhabers abweicht — von Google oder Nutzern erzeugte
Unterschiede, nicht den Freigabestatus eigener Einreichungen.

Zustand 4 („veröffentlicht") liefert die API weiterhin **nicht**
zuverlässig. Das Verschwinden aus `pendingMask` ist ein Indiz, kein
Nachweis.

### 3. Weitere ungenutzte Zustandsfelder

| Feld | Bedeutung |
|---|---|
| `metadata.hasVoiceOfMerchant` | Siehe Korrektur unten — ohne Voice of Merchant werden **Änderungen nicht live**, das Profil bleibt aber sichtbar |
| `metadata.canDelete`, `canModifyServiceList`, `canHaveFoodMenus`, `canHaveBusinessCalls` | Welche Bearbeitungen für diesen Standort erlaubt sind |
| `metadata.mapsUri`, `newReviewUri` | Direktlinks — `newReviewUri` ist der Bewertungslink, den WERKRUF sonst selbst baut |
| `openInfo.status` | `OPEN`, `CLOSED_PERMANENTLY`, `CLOSED_TEMPORARILY` |
| `metadata.duplicateLocation` | Dublettenwarnung |

### 3b. Korrektur zu `hasVoiceOfMerchant`

Eine frühere Fassung dieser Datei behauptete, ohne Voice of Merchant
erscheine das Profil nicht öffentlich. **Das ist falsch.**

Die Referenz zu `locations.getVoiceOfMerchantState` sagt:

> Indicates whether the location is in good standing and has control
> over the business on Google. Any edits made to the location will
> propagate to Maps after passing the review phase.

Und zum benachbarten Feld `hasBusinessAuthority`:

> Indicates whether the location has the authority (ownership) over the
> business on Google. If true, another location cannot take over and
> become the dominant listing on Maps. However, edits will not become
> live unless Voice of Merchant is gained.

Richtig ist also:

| | |
|---|---|
| `hasVoiceOfMerchant = false` | **Änderungen werden nicht veröffentlicht.** Über die Sichtbarkeit des Eintrags selbst sagt das Feld nichts |
| `hasBusinessAuthority` | Eigentum am Eintrag — verhindert, dass ein anderer Eintrag dominant wird. Reicht allein nicht, damit Änderungen live gehen |

**Wirkung für WERKRUF:** Der Zustand erklärt den Fall „Speichern war
erfolgreich, auf Maps passiert nichts" — unabhängig von `pendingMask`.
Beide zusammen ergeben erst ein vollständiges Bild.

**Wichtig:** `getVoiceOfMerchantState` gehört zur **Verifications API**
(`mybusinessverifications.googleapis.com`), nicht zur Business
Information API. Das ist eine eigene API, die in der Cloud Console
freigeschaltet sein muss. `metadata.hasVoiceOfMerchant` in Business
Information ist nur das Kennzeichen; die Begründung und die nächsten
Schritte (`verify`, `waitForVoiceOfMerchant`, `resolveOwnershipConflict`,
`complyWithGuidelines`) liefert ausschließlich die Verifications API.

### 4. Bereits veraltet

`metadata.canOperateLocalPost` trägt `deprecated: true` — wird nicht
mehr befüllt und künftig entfernt.

---

## Business Information API

Schreibbar über `locations.patch` mit `updateMask`: `storefrontAddress`,
`websiteUri`, `regularHours`, `specialHours`, `moreHours`, `serviceArea`,
`serviceItems`, `categories`, `phoneNumbers`, `profile`, `openInfo`,
`labels`, `storeCode`, `adWordsLocationExtensions`, `relationshipData`,
`title`, `latlng` (nur freigegebene Clients).

Nur lesbar: `name`, `metadata.*`; `languageCode` ist unveränderlich.

| Zweck | Methode |
|---|---|
| Attribute lesen | `locations.getAttributes` |
| Attribute schreiben | `locations.updateAttributes` mit `attributeMask` |
| Attribute wie öffentlich sichtbar | `locations.attributes.getGoogleUpdated` |
| Verfügbare Attribute | `attributes.list` |
| Kategorien suchen | `categories.list` |
| Kategorien nachschlagen | `categories.batchGet` |
| Ketten | `chains.search`, `chains.get` |
| Google-Ansicht | `locations.getGoogleUpdated` |

**Für Bereich C und D der Spezifikation:** `categories.batchGet` mit
`view=FULL` liefert je Kategorie sowohl `serviceTypes` als auch
`moreHoursTypes`. Beides ist dynamisch abrufbar — fest
einprogrammierte Listen sind weder nötig noch zulässig.

`attributes.list` nimmt entweder `parent` (konkreter Standort) oder
`categoryName` + `regionCode`. Für WERKRUF ist `parent` der richtige
Weg: weniger Aufrufe, exakt passende Ergebnisse.

---

## Account Management API

| Zweck | Methode | schreibend |
|---|---|---|
| Konten auflisten | `accounts.list` | — |
| Konto lesen | `accounts.get` | — |
| Konto umbenennen | `accounts.patch` (nur `accountName`) | ja |
| Administratoren | `accounts.admins.*`, `locations.admins.*` | ja |
| Einladungen | `accounts.invitations.list/accept/decline` | ja |
| Standort übertragen | `locations.transfer` | ja |

Für Bereich L relevant: `Account.role`, `permissionLevel`,
`verificationState`, `vettedState`.

**Einschätzung:** Administratoren- und Einladungsverwaltung gehört nicht
ins Kundendashboard. Wer darüber fremde Personen zum Google-Konto
einladen oder Standorte übertragen kann, bekommt eine Angriffsfläche,
die kein Handwerksbetrieb braucht. Die eigene Rolle lesend anzuzeigen
ist dagegen sinnvoll.

---

## Nicht über die API verfügbar

| Element | Status |
|---|---|
| Fragen und Antworten | API am **03.11.2025 eingestellt**. Keine Implementierung. Ein Nachfolger fiele dem Monitoring über den Verzeichnisabgleich auf |
| Veröffentlichungsstatus einer Einreichung | Nicht zuverlässig — siehe Befund 2 |
| Produkte | Nicht in der Business Information API. Vor einer Umsetzung klären, ob überhaupt eine offizielle API existiert |
| Speisekarten | `metadata.canHaveFoodMenus` zeigt nur die Eignung, nicht die Pflege |

---

## Welche APIs WERKRUF tatsächlich aufruft

Geprüft durch Suche nach dem Dienst-Hostnamen in
`supabase/functions/google-business/`:

| Dienst | Im Code | Wofür |
|---|---|---|
| `mybusinessaccountmanagement.googleapis.com` | **ja** | Konten auflisten |
| `mybusinessbusinessinformation.googleapis.com` | **ja** | Standorte, Profilfelder |
| `mybusiness.googleapis.com` (v4) | **ja** | Bewertungen, Antworten, Medien |
| `mybusinessplaceactions.googleapis.com` | nein | — |
| `mybusinessnotifications.googleapis.com` | nein | — |
| `businessprofileperformance.googleapis.com` | nein | — |
| `mybusinessverifications.googleapis.com` | nein | — |
| `mybusinesslodging.googleapis.com` | nein | — |

**Korrektur einer früheren Berichtsfassung:** Der erste Lauf meldete für
Place Actions „6 von 6 in WERKRUF". Das war falsch. Der Abgleich suchte
nach Pfadteilen wie `locations`, `accounts` oder `get` — und die stehen
in jedem Google-Code. Der Abgleich prüft jetzt zuerst, ob der
Dienst-Hostname überhaupt im Quelltext vorkommt, und danach nur noch auf
markante Bezeichner.

Die Spalte heißt im Bericht deshalb **„vermutlich in WERKRUF"**. Sie
bleibt eine Textsuche, keine Analyse. Belegt sind allein die drei Hosts
oben.

---

## Google-Cloud-Freigaben

### Zwei Dinge, die nicht dasselbe sind

| | Discovery-Dokument | API-Aufruf |
|---|---|---|
| Was | Die öffentliche Spezifikation | Die tatsächliche Nutzung |
| URL | `https://<dienst>.googleapis.com/$discovery/rest?version=…` | `https://<dienst>.googleapis.com/v1/…` |
| Anmeldung | **keine** | OAuth mit `business.manage` |
| Abhängig von der Cloud-Freigabe | **nein** | **ja** |
| Womit prüfbar | Skript, Workflow, Monitoring | nur mit echtem Token gegen ein echtes Konto |

**Daraus folgt:** Ob eine Discovery-URL erreichbar ist, sagt **nichts**
darüber, ob die API im Cloud-Projekt aktiviert ist. Und umgekehrt.

**Korrektur einer früheren Aussage:** Der HTTP 403, den das Skript in
der Entwicklungsumgebung bekam, stammte vom **Egress-Proxy der
Sandbox**, nicht von Google. Derselbe Abruf über einen anderen Weg
lieferte HTTP 200. Ein solcher 403 beweist weder, dass die API
deaktiviert ist, noch dass die Quelle unerreichbar wäre — er beweist
nur, dass diese eine Umgebung nicht hinausdarf.

### Erforderliche Aktivierungen

Alle folgenden müssen einzeln in der Cloud Console aktiviert werden.
Google dokumentiert das ausdrücklich — sowohl für die Business
Information API als auch für die Verifications API heißt es, sie müsse
über die Cloud Console freigeschaltet werden.

| API | Dienstname | Von WERKRUF benötigt für | Status |
|---|---|---|---|
| Account Management | `mybusinessaccountmanagement` | Konten und Standortzuordnung | **aktiv**, Quota 300/min (Screenshot 28.09.) |
| Business Information | `mybusinessbusinessinformation` | Standorte, Profilfelder, Attribute, Kategorien | ungeprüft |
| Google My Business v4 | `mybusiness` | Bewertungen, Antworten, Medien, Beiträge | ungeprüft |
| Verifications | `mybusinessverifications` | Voice of Merchant, Verifizierungsstatus | ungeprüft |
| Place Actions | `mybusinessplaceactions` | Terminbuchung, Bestell-Links | ungeprüft |
| Notifications | `mybusinessnotifications` | Pub/Sub-Benachrichtigungen | ungeprüft |
| Performance | `businessprofileperformance` | Kennzahlen, Suchbegriffe | ungeprüft |
| Lodging | `mybusinesslodging` | nur Beherbergung — für Handwerk nicht relevant | nicht nötig |

Die ersten drei ruft WERKRUF heute auf (siehe Abschnitt oben). Die
übrigen wären erst nötig, wenn die entsprechenden Dashboard-Bereiche
gebaut werden.

„Ungeprüft" heißt hier: Es liegt kein Nachweis vor. Nicht, dass die API
deaktiviert wäre.

### Wie der Status festgestellt wird

**Nicht** über das Discovery-Dokument. Zwei Wege:

1. **Cloud Console** → APIs & Dienste → Aktivierte APIs. Steht die API
   dort mit einer Quota größer null, ist sie freigeschaltet.
2. **Authentifizierter Funktionstest** — ein echter Aufruf mit
   gültigem Token gegen ein verbundenes Konto. Ein `403` mit
   `SERVICE_DISABLED` heißt: nicht aktiviert. Ein `403` mit
   `PERMISSION_DENIED` oder eine Quota von 0 heißt: aktiviert, aber
   ohne GBP-Zugang.

Der Funktionstest ist der einzige Nachweis, dass eine API tatsächlich
nutzbar ist. Er gehört **nicht** in den Inventur-Workflow: Dieser läuft
ohne Anmeldedaten und darf keine bekommen.

---

## Offene Prüfpunkte

1. **Sechs ungeprüfte Discovery-Dokumente** — erster Skriptlauf mit
   Netzzugriff.
2. **Welche APIs sind im Cloud-Projekt aktiviert?** Siehe Tabelle oben.
   Nur über die Console oder einen authentifizierten Funktionstest
   feststellbar — nicht über das Discovery-Dokument.
3. **Voice of Merchant der verbundenen Betriebe** — `locations.get` mit
   `readMask=metadata` liefert das Kennzeichen; die Begründung und die
   nächsten Schritte kommen aus `getVoiceOfMerchantState` der
   Verifications API.

---

## Verifikationsstand

| Prüfung | Art |
|---|---|
| businessinformation erreichbar, Revision `20260927` | **gegen Google geprüft** |
| accountmanagement erreichbar, Revision `20260927` | **gegen Google geprüft** |
| `PhoneNumbers`/`Categories` nur als Ganzes änderbar | **aus dem Schema belegt** |
| `pendingMask`, `hasPendingEdits` vorhanden | **aus dem Schema belegt** |
| `canOperateLocalPost` veraltet | **aus dem Schema belegt** |
| Normalisierung, Prüfsumme, Ausfallbehandlung | lokal ausgeführt |
| Übrige sechs APIs | **ungeprüft** |
| Schreibzugriff mit korrigierter Maske | **ungeprüft gegen Google** |
| Bedeutung von `hasVoiceOfMerchant` | **aus der offiziellen Referenz belegt** |
| Cloud-Aktivierung außer Account Management | **ungeprüft** — braucht Console oder Funktionstest |
| Sieben Discovery-Dokumente abrufbar, Revision `20260928` | **im Workflow ausgeführt** |
| v4-Discovery-Endpunkt liefert 404 | **im Workflow ausgeführt** |
| Statische v4-Datei abrufbar, revision `0` | **gegen Google geprüft** |
| Drei von acht Diensten im WERKRUF-Code | **im Quelltext geprüft** |
