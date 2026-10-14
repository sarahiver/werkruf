# H3 — Support-Minimum

Stand: 14.10.2026.

Leitfrage war: kann ein echter Kunde Support bekommen, ohne dass der
Betreiber dafür in den SQL-Editor springt? H3 baut dafür kein
Admin-Produkt — es erweitert das vorhandene.

---

## A. Admin vorher

Es gab schon mehr, als es von außen aussah.

| Baustein | Zustand vor H3 |
| --- | --- |
| `/admin`-Route, `src/components/auth/AdminRoute.js` | vorhanden, prüft `app_metadata.role === 'admin'` — **nur im Frontend** |
| `src/pages/Admin.js` (358 Zeilen) | Kundenliste, Setup-Leads, Kennzahlen |
| `supabase/functions/admin-ops/index.ts` (95 Zeilen) | **ein** POST ohne Parameter, serverseitige Adminprüfung, dann Service Role |
| `src/utils/adminOps.js` | `formatAdminDate`, `getCustomerProblem`, `getSubscriptionLabel` |
| RLS `user_profiles_admin_read`, `leads_admin_read` | Admin darf diese beiden Tabellen direkt aus dem Browser lesen |
| `public.audit_logs` | vorhanden, `actor_type` erlaubt `'admin'`, Helfer `writeAuditLog` in google-business |
| `set_founding_partner`, `clear_founding_partner` | vorhanden, nur `service_role` |
| `enqueue_sync_job` + Worker | vorhanden |

Was fehlte: **jede Aktion**. Kein Founding-Partner-Wechsel, kein
Sync, keine Suche, keine Detailansicht, kein Audit einer
Admin-Handlung.

Und ein Befund, der gleich mitkorrigiert wurde: `admin-ops` rief
`compute_health_score` **einmal pro Kunde** auf — bei 100 Kunden also
100 RPCs je Seitenaufbau, dazu `listUsers({ perPage: 1000 })`. Genau
das, was §43 verbietet.

### Ein eigener Fehler, offen protokolliert

Beim Anlegen des H3-Teils habe ich `src/utils/adminOps.js`
**überschrieben** und damit die drei bestehenden
Darstellungsfunktionen gelöscht. Aufgefallen ist das sofort, weil die
vorhandene Abnahme `src/utils/adminOps.test.js` rot wurde — vier
Zusagen, die genau diese Funktionen beschreiben.

Sie sind daraus wiederhergestellt, unverändert in der Logik. Der
Grund, warum es passieren konnte: meine Inventur hat nach `admin`,
`admin-ops` und `ops` gesucht, aber nicht nach der Datei, die ich
selbst anlegen wollte. Die Lehre ist nicht „vorsichtiger sein",
sondern: **vor jedem Write prüfen, ob die Datei existiert.**

---

## B. Admin-Auth

Derselbe Claim an drei Stellen, und das ist Absicht, keine Dopplung:

| Stelle | Prüfung | verbindlich? |
| --- | --- | --- |
| `AdminRoute.js` | `app_metadata.role === 'admin'` | nein — Kosmetik, verhindert nur das Rendern |
| `admin-ops` → `pruefeAnfrage()` | dto., serverseitig | **ja** |
| RLS `user_profiles_admin_read` | `auth.jwt() -> 'app_metadata' ->> 'role'` | **ja**, in Postgres |

`app_metadata` ist der Punkt. Es ist vom Client **nicht** schreibbar —
dort schreibt nur die Service Role. `user_metadata` dagegen setzt sich
jeder Nutzer selbst über `supabase.auth.updateUser`. Deshalb kommt
`user_metadata` in der ganzen Kette nicht vor, und ein Test hält das
fest.

Die Reihenfolge in der Function ist ebenfalls geprüft: der
Service-Role-Client wird erst **nach** dem Urteil erzeugt. Stünde er
davor, wäre ein vergessenes `return` der Unterschied zwischen 403 und
vollem Datenbankzugriff.

| Fall | Antwort |
| --- | --- |
| kein JWT | 401 |
| normaler Nutzer | 403 |
| `user_metadata.role = 'admin'` gefälscht | 403 |
| Admin, unbekannte Aktion | 400 |
| Admin, erlaubte Aktion | 200 |

403 kommt vor 400: ein Nicht-Admin soll nicht über Fehlermeldungen
herausfinden, welche Aktionen es gibt.

---

## C. Kundensuche

Ein Feld, serverseitig. Gesucht wird nach

- **User-ID** — eine UUID wird direkt erkannt, der schnellste Weg,
  wenn eine ID aus einem Log kommt
- **Unternehmensname** — `ilike`, Prozent- und Unterstrich-Zeichen im
  Suchbegriff werden maskiert
- **Standortname** — über `google_locations.title`
- **E-Mail** — aus `auth.users`, das per PostgREST nicht filterbar ist;
  deshalb `listUsers` mit `perPage: 200` statt der vorherigen 1000

Das Limit ist **serverseitig** begrenzt (ohne Angabe 25, höchstens
100). Kein Browser-Filter über eine Vollabfrage — ein Test prüft, dass
der Suchbegriff an den Server geht.

---

## D. Support Snapshot

Ein Aufruf, ein Kunde, neun Blöcke:

```text
user · entitlement · consent · googleAccount · locations
sync · engine · communications · billing   (+ ampel)
```

Sieben gezielte Abfragen parallel, alle auf diese `user_id`
eingeschränkt — geprüft wird das nicht nach Augenmaß, sondern durch
Zählen: so viele `.eq('user_id'|'id', userId)` wie Tabellenabfragen.

Geformt wird in `baueSupportSnapshot()` — einer reinen Funktion ohne
Datenbankzugriff. Deshalb ist sie in Jest mit echten Zeilenformen
prüfbar, inklusive der Fälle, die weh tun.

Nicht im Snapshot (§23, §41): keine OAuth-Tokens, kein
Stripe-Secret, keine Action-Tokens, kein Mailbody, kein Dedupe-Key,
kein vollständiges Auth-Objekt. Aus `auth.users` kommt ausschließlich
die Mailadresse. Ein Test schmuggelt `refresh_token` und
`confirmation_token` in die Eingabezeilen und verlangt, dass sie in
der Ausgabe nicht vorkommen.

---

## E. Google

Sichtbar: `vorhanden`, Status (`active`, `needs_reauth`, `broken`,
`deleted`, `not_connected`), verbunden seit, letzter Fehlercode mit
Zeitpunkt, Account-ID, Anzahl aktiver und gelöschter Standorte.

Keine Tokens, keine Scopes, kein Bestätigungstoken.

`needs_reauth` und `broken` setzen die Ampel auf **blockiert** — und
in der Diagnosezeile gewinnt die kaputte Freigabe über
Folgefehler im Sync. Stünde der Sync-Fehler vorne, würde der Support
das Symptom lesen und die Ursache suchen.

---

## F. Locations

Pro Standort: Name, Ort, `place_id`, gewählt (mit Zeitpunkt), primär,
letzter Sync, Bewertungen, Rating, Fotos.

**Multi-Location** (§37): keine Annahme „ein User = ein Betrieb". Die
Tabelle listet alle, und genau einer ist als `gewählt` markiert — das
ist derselbe Wert, den die Engine benutzt. Gelöschte Standorte stehen
getrennt, nicht als aktive.

**Zero-Locations** (§9, §38): bei `Google aktiv + 0 Standorte` steht
nicht „keine Daten", sondern

```text
Google verbunden, aber keine verwaltbaren Standorte gefunden
Import: succeeded · letzter Versuch 13.10.2026 06:00
```

Der Importzustand kommt aus denselben `sync_locations`-Jobs, aus denen
das Kundendashboard ihn ableitet. Diese Regel stand bis H3 **inline im
Hook** `useGoogleBusinessData.js`; sie steht jetzt einmal in
`adminOps.js`, und der Hook importiert sie. Eine nachgebaute zweite
Fassung wäre genau der Fehler, der in H1 bei der Zugangsregel vier
Kopien erzeugt hat.

Vier Zustände, auseinandergehalten: `none` (nie gelaufen), `running`,
`succeeded` (auch mit null Betrieben — das ist ein Ergebnis), `failed`.

Und: kein Score 0, kein Nullpointer. Fotos ohne geladenes
`google_media` sind `null`, nicht `0`.

---

## G. Sync

| Angabe | Quelle |
| --- | --- |
| letzter erfolgreicher Datenstand | jüngster Wert aus erfolgreichen Jobs **und** `last_synced_at` der Standorte |
| letzter Job + Status | `sync_jobs`, neueste zuerst |
| laufend / fehlgeschlagen | Zählung über `sync_jobs` |
| letzter Fehler | Code, Art, Zeit, Meldung auf 300 Zeichen gekürzt |
| die letzten 10 Jobs | verdichtet, nicht alle Logs |

**`public.sync_runs` wird nicht benutzt** — die Tabelle hat kein
`user_id`. Sie ist die Laufhistorie des Workers (`worker_id`,
`trigger`, `claimed`, `succeeded`, `failed`), nicht die eines Kunden.
Einen „letzten Lauf dieses Kunden" daraus abzuleiten wäre eine
erfundene Zuordnung. Nachgesehen am 14.10.2026.

§31 durchgehalten: kein Datenstand heißt
`datenstandBekannt: false` und in der Oberfläche **„noch kein
erfolgreicher Datenstand"** — nicht „—" und nicht „alles gut".

---

## H. Sync-Aktion

Ein Knopf, `trigger_customer_sync`, und zwar über
`public.enqueue_sync_job` — dieselbe Queue und dieselbe Lock-Mechanik
wie jeder andere Sync. Kein direkter Funktionsaufruf, der parallel zum
Worker läuft; ein Test verbietet ein `insert` in `sync_jobs`.

Standortwahl: der übergebene Standort, sonst der gewählte, sonst der
einzige. Gehört die übergebene `locationId` dem Kunden **nicht**, wird
abgewiesen (`standort_gehoert_nicht_zum_kunden`) — nicht
stillschweigend der eigene genommen. Das wäre eine Umdeutung, und der
Admin würde glauben, er habe den angegebenen Standort synchronisiert.

Gibt es keinen Standort, wird ein `sync_locations`-Job eingereiht. Das
ist der Zero-Locations-Fall, und dort ist ein Standortimport die
richtige Antwort.

Ergebnis in der Oberfläche: `Job eingereiht · sync_reviews · Job-ID …`
oder ein Code wie `kein_google_konto`.

---

## I. Engine

Sichtbar: Anzahl offener Events und die ersten 15 verdichtet — Typ,
Kategorie, `recommendation_class`, `priority`, `lifecycle`,
`location_id`, erstellt, im Weekly, Cooldown.

Quelle bleibt die Decision Engine; H3 berechnet nichts nach.

### Keine „Engine neu bewerten"-Aktion — und warum das richtig ist

§14 erlaubt sie nur, wenn ein sicherer vorhandener Weg existiert. Es
gibt keinen:

- `evaluateUser()` lebt in `google-business` und ist über
  `POST /events/evaluate` erreichbar — aber an `requireUser()`
  gebunden, also an den **eingeloggten** Nutzer. Ein Admin-Pfad dorthin
  müsste neu gebaut werden.
- Der Sync-Worker hat einen `evaluate`-Job-Handler. Der ist **toter
  Code**: `sync_jobs_job_type_check` erlaubt nur `sync_locations`,
  `sync_reviews`, `sync_insights`, `publish_reply`, `update_profile`,
  `refresh_token`. Ein Job mit `job_type = 'evaluate'` lässt sich nicht
  einfügen.

Gebraucht wird sie auch nicht: der `sync_reviews`-Handler ruft nach
erfolgreichem Sync selbst `evaluateUser()`. Der Sync-Knopf bewertet die
Engine also mit, und die Antwort sagt das (`engineWirdNeuBewertet`).

Der tote `evaluate`-Handler bleibt stehen — ihn zu entfernen oder den
Constraint zu erweitern ist eine eigene Entscheidung, nicht H3.

---

## J. Kommunikation

Sichtbar: Queue-Zustand (in Queue, fehlgeschlagen), die letzten 10
Mails verdichtet (Vorlage, Status, Empfänger, geplant, gesendet,
Versuche, Fehlercode) und die **jeweils letzte Mail je Vorlage** für
`weekly_summary`, `critical_review_alert`, `connection_broken`,
`payment_failed` — „nie", wenn es keine gibt.

Dazu `operativeMailBerechtigt` im Entitlement-Block, aus
`wantsOperationalMail()` und damit aus der bestehenden Access-Logik
(§40). Keine zweite Regel.

**Kein Mailbody, kein Dedupe-Key** (§15). Ein Test schmuggelt beides in
die Eingabe und verlangt, dass es in der Ausgabe fehlt.

**Keine „nochmal senden"-Schaltfläche** (§16). Es gibt keinen
bestehenden Retry, den man sicher anstoßen könnte, ohne den
Dedupe-Schutz zu umgehen — also gibt es den Knopf nicht. Sichtbar ist
der Status, und das ist die Zusage.

---

## K. Billing

Nur lesend (§17): `stripeKunde` ja/nein, Customer-ID,
Subscription-ID, Status, Kündigung geplant, Periodenende,
Trial-Ende.

Keine Zahlungsmittel, kein Secret, keine Rechnungsdetails. Keine
Aktion — kein Refund, kein Cancel, kein Preiswechsel (§18). Ein Test
verbietet `api.stripe.com`, `new Stripe(` und `STRIPE_SECRET_KEY` in
der Function.

§39 ausdrücklich geprüft: bei einem Founding Partner mit
Stripe-Historie stehen **beide** Wahrheiten da — Entitlement
`founding_partner` mit Zugang, daneben Stripe `canceled`. Keines
überschreibt das andere.

---

## L. Founding Partner

Über `set_founding_partner` und `clear_founding_partner`, nicht über
ein Update auf `user_profiles.plan`. Der Grund ist nicht Formalismus:
die RPC setzt `plan` **und** `founding_partner_since`/`-note`
zusammen. Ein direktes Update auf `plan` würde den Plan ohne das Datum
setzen, und danach wäre nicht mehr feststellbar, seit wann jemand
dabei ist.

Ein Test verbietet in der Function jedes `update` auf `user_profiles`
— das ist die §50-Gegenprobe, und sie greift.

Der Weg in der Oberfläche (§20, §21): **kein Ein-Klick-Toggle.** Der
erste Klick öffnet eine Bestätigung mit Name, E-Mail, aktuellem Plan
und der Folge:

```text
Iver Beispiel
chef@betrieb.test

Aktuell: free

→ Als Founding Partner freischalten. Der Zugang wird kostenlos
  und hängt nicht mehr an Stripe.
```

Beim Entziehen stehen die Konsequenzen da: operative Mails hören auf,
Pro-Aktionen werden gesperrt. Zielplan ist `free` und nur `free` —
`pro` wäre eine Zahlungsaussage ohne Zahlung, und der Server weist es
mit 400 ab.

---

## M. Audit

In die bestehende `public.audit_logs`, kein zweites System (§22).
`actor_type = 'admin'` ist dort erlaubt.

| Feld | Inhalt |
| --- | --- |
| wer | `actor_id` = Admin-User-ID, `actor_type = 'admin'` |
| wann | `created_at`, Vorgabe `now()` — aus der Datenbank, nicht aus dem Browser |
| welcher Nutzer | `user_id` und `entity_id` |
| welche Aktion | `admin.sync_angestossen`, `admin.founding_partner_gesetzt`, `admin.founding_partner_entzogen` |
| Ergebnis | `metadata.erfolg` plus `ergebnis` oder `fehler` (auf 500 Zeichen gekürzt) |

Auch der **Fehlschlag** wird protokolliert. Ein Audit, das nur Erfolge
kennt, verschweigt die interessanten Fälle. Ein Test verlangt für jede
schreibende Aktion mindestens zwei Audit-Stellen im Code.

Ein Ausfall des Audits verschluckt die Aktion nicht, wird aber
protokolliert (`audit_fehlgeschlagen`).

---

## N. Security

Warum ein normaler Nutzer nichts davon erreicht:

1. **Die API.** `pruefeAnfrage()` gibt 403, bevor der
   Service-Role-Client überhaupt erzeugt wird. Geprüft wird
   `app_metadata`, das der Client nicht schreiben kann.
2. **Die Oberfläche.** `/admin` liegt hinter `AdminRoute`, und die
   Seite rendert ohne `isAdmin` nichts und holt keine Daten. Das ist
   kein Schutz, sondern Hygiene — der Schutz ist Punkt 1.
3. **Die Datenbank.** H3 hat **keine Migration** und **keine neuen
   Rechte**. Kein `grant`, kein neues Objekt, keine gelockerte Policy.
   Die H2.2-Härtung ist unberührt: `definer+volatile` 82/PUBLIC 0,
   `definer+stable` 29/PUBLIC 0, unverändert nach H3.
4. **Keine freie Schnittstelle** (§26). Fünf Aktionen in einer
   Allowlist, Parameter geprüft **und reduziert**: ein mitgeschickter
   `plan: 'pro'` bei `trigger_customer_sync` fällt weg, statt unten als
   Überraschung aufzutauchen. Kein `execute_sql`, kein
   table/column/value.
5. **Nichts Destruktives** (§45). Kein Löschen, kein Queue-Leeren,
   keine Stripe- und keine Google-Schreibaktion. Tests verbieten
   `.delete()`, `deleteUser`, `googleapis.com` und die Stripe-Wege.

Der Snapshot läuft bewusst über die Function und nicht über neue
Client-Grants (§28, §29) — weniger Clientrechte, eine konsistente
Darstellung.

---

## O. Tests

| | |
| --- | --- |
| Jest | **1181 Tests in 73 Suites grün** |
| davon neu für H3 | 99 in 4 Dateien |
| SQL-Abnahmen | 27 Dateien, 0 rot |
| `CI=true npm run build` | `Compiled successfully.` |

Wo die Prüfungen liegen und warum:

| Datei | prüft | Art |
| --- | --- | --- |
| `src/adminOps.test.js` | Tor, Allowlist, Parameter, Snapshot, Ampel, Audit-Form | **ruft die Funktionen auf** |
| `src/pages/adminSupport.test.js` | die gerenderte Seite, Suche, Bestätigungen | **rendert** |
| `src/adminOpsFunction.test.js` | benutzt die Function die Regeln, Scope, Verbote | Struktur, **ohne Kommentare** |
| `src/utils/adminOps.test.js` | die drei Darstellungsfunktionen | vorhanden, unverändert |

Dass die Regeln in `src/utils/adminOps.js` stehen und nicht in der
Edge Function, ist der Grund, warum die erste Spalte echte Prüfungen
enthält: die Function selbst lässt sich hier nicht ausführen, und ein
Test könnte sie nur als Text lesen. In H2.2 hat genau diese Art
Prüfung dreimal einen Kommentar getroffen statt Code — einmal mit dem
Ergebnis, dass ein behobener Befund unbemerkt blieb. Die
Strukturprüfungen entfernen deshalb vorher die Kommentare.

### Gegenproben (§50) — alle vier greifen

| Eingriff | Ergebnis |
| --- | --- |
| Admin-Check in `pruefeAnfrage` ausgehängt | **3 Tests rot** |
| direktes `plan`-Update statt `set_founding_partner` | **2 Tests rot** |
| `.eq('user_id', userId)` aus dem Sync-Pfad entfernt (Konto **oder** Standorte) | **1 Test rot** |
| Admin-Seite rendert ohne `isAdmin` | **1 Test rot** |

Die dritte verdient eine Anmerkung. Sie blieb beim ersten Versuch
**grün**: meine Strukturprüfung zählte den Scope nur im Snapshot, nicht
in den Aktionen. Der Test behauptete also einen Schutz, den er nicht
prüfte — die unangenehmste Art von Lücke. Jetzt wird jeder Zweig
geprüft, der mit einer `user_id` arbeitet, und beide Varianten des
Eingriffs werden rot.

### Was `deno check` in CI gefunden hat — und wie ich es künftig vorher sehe

Die erste Fassung der Function hatte **28 Typfehler**, gemeldet von
`deno check` in CI. Ich hatte im Bericht geschrieben, dass ich das hier
nicht prüfen kann (`deno` erreicht `deno.land` und `esm.sh` über den
Proxy nicht — nachgeprüft: „unsuccessful tunnel"). Das stimmt, war
aber die falsche Schlussfolgerung: **prüfen kann ich trotzdem, nur
anders.**

`npx tsc` liegt im Projekt, und die echten supabase-js-Typen liegen in
`node_modules`. Mit einer `tsconfig`, die die Remote-URLs über `paths`
auf das lokale Paket und auf kleine Stubs für `serve` und `Stripe`
zeigt, meldet `tsc` dieselben Fehler mit denselben Codes in denselben
Zeilen. Damit war die Rückmeldung von CI reproduzierbar — und die
Korrektur prüfbar statt geraten: 28 → 17 → 0.

Die vier Ursachen, weil sie sich wiederholen werden:

| Ursache | Wirkung |
| --- | --- |
| `data.user as typeof authUser`, während die Variable noch `null` ist | TS2352 „Conversion of type 'User' to type 'null'", danach eine Kette von `never`-Fehlern |
| `select(KONSTANTE)` statt eines Zeichenketten-Literals | postgrest-js kann den Zeilentyp nicht ableiten → `GenericStringError`, **zehn** Meldungen aus einer Zeile |
| Standardwerte `= null` in einer JS-Funktion ohne JSDoc | TypeScript leitet den Parametertyp als `null` ab, und jeder echte Wert ist „not assignable to type 'null \| undefined'" |
| Rückgabe-Union aus einer JS-Datei | kein Narrowing über `if (!urteil.erlaubt)`, also `parameter` dauerhaft „possibly undefined" |

Behoben durch: eine eigene `Aufrufer`-Schnittstelle statt des Casts,
das Literal im `select`, JSDoc-Typen in `adminOps.js` und einen
ausdrücklichen Fallback für `parameter`. Keine `any`, kein
`@ts-ignore`, kein `!` an der kritischen Stelle.

Gegengeprüft nach der Korrektur: beide geänderten Functions
(`admin-ops` und `stripe-webhook`) melden 0 Fehler, und die vier
§50-Gegenproben greifen weiterhin.

### Zwei Fehler, die die Tests gefunden haben

- **Drei falsche Spaltenannahmen.** `sync_runs.user_id`,
  `google_locations.photo_count` und ein Import-Status am
  `google_accounts` — alle drei gibt es nicht. Gefunden durch
  Nachsehen im Katalog, bevor etwas gebaut wurde.
- **Ein UI-Fehler.** Nach einer Aktion lud der Snapshot neu und löschte
  dabei die Erfolgsmeldung („Job eingereiht, Job-ID …" war eine
  Millisekunde sichtbar). Gefunden von `adminSupport.test.js`, nicht
  beim Lesen. Laden und Öffnen sind jetzt getrennt.

---

## P. Dateien

**Neu**

```text
src/adminOps.test.js
src/pages/adminSupport.test.js
docs/h3-support-minimum.md
```

**Geändert**

```text
src/utils/adminOps.js                     H3-Teil ergänzt, drei Funktionen wiederhergestellt
supabase/functions/admin-ops/index.ts     Action-Allowlist, Snapshot, Audit
src/pages/Admin.js                        Suche, Support-Ansicht, Aktionen
src/adminOpsFunction.test.js              auf den neuen Vertrag gedreht
src/hooks/useGoogleBusinessData.js        benutzt die geteilte Importregel
```

**Keine Migration.** H3 ändert kein Schema, keine Rechte, keine Policy.

---

## Q. Deployment

Ich deploye nicht (§52). Zu tun:

1. **Pushen.** Alle sechs Dateien oben.
2. **`admin-ops` neu deployen.** Supabase → Edge Functions →
   admin-ops → Code ersetzen → Deploy. **Verify JWT: AN** (der Aufruf
   kommt aus dem eingeloggten Admin-UI).
3. **Frontend deployen** (normaler Weg).
4. **Prüfen, dass du `app_metadata.role = 'admin'` hast.** Ohne diesen
   Claim bekommst du 403 — korrekt, aber überraschend. Zu setzen über
   die Service Role; ein vorhandener Admin merkt es daran, dass
   `/admin` bisher funktioniert hat.

Zu beachten: die Reihenfolge ist unkritisch. Ein Body ohne `action`
wird als `list_customers` behandelt, damit zwischen Function- und
Frontend-Deploy nichts leer bleibt.

### Support-Smoke (§48) — bei dir, mit einem Testnutzer

```text
Admin findet Nutzer        → Suche nach E-Mail
→ sieht Google-Verbindung  → Block "Google-Verbindung"
→ sieht Location           → Standort-Tabelle, "gewählt"
→ sieht letzten Sync       → Block "Datenstand / Sync"
→ setzt Founding Partner   → Bestätigung, dann ausführen
→ stößt Sync an            → "Job eingereiht · Job-ID …"
→ sieht Job                → Block "Datenstand / Sync", laufend ≥ 1
→ sieht Engine             → Block "Engine"
→ sieht Mailstatus         → Block "Kommunikation"
→ entzieht Founding Partner→ Bestätigung mit Folgen, dann ausführen
→ Audit vollständig        → select action, actor_id, metadata
                             from audit_logs where actor_type = 'admin'
                             order by created_at desc limit 10;
```

Kein echter Google-Write nötig. Der Sync holt Daten, er schreibt
nichts.

---

## R. Restpunkte vor MVP-Freeze

Nur echte Blocker:

1. **Deployment von H2.2 C/D/E und H3** — geliefert, nicht aktiv.
2. **Migrationsverlauf nachziehen** für `20261014120000` und
   `20261014130000`. Beide liefen im SQL-Editor, gelten im Workflow
   also weiter als offen.
3. **Die F-Prüfliste im Stripe-Dashboard** (`docs/operations/stripe-dashboard-mvp.md`).
   Der Blocker ist die Trial-Ende-Erinnerung: ist sie aus, warnt
   niemand vor der ersten Abbuchung.
4. **Die drei Smokes aus H1** — Fremdaccount, G2 Betrieb, Mail. Nur
   mit echten Konten möglich.

Kein Blocker, aber notiert:

- `compute_location_health_score` gibt im `when others`-Zweig weiterhin
  `sqlerrm` an den Aufrufer zurück.
- Der tote `evaluate`-Job-Handler und der Constraint, der ihn
  unerreichbar macht.
- Kein Retry für fehlgeschlagene Mails im Admin (§16, bewusst).
- Keine Kündigungsbestätigung, kein Refund-Pfad, kein `invoice.paid`
  (H2.2 §32, bewusst).

---

## Go / No-Go

### Support-Minimum

**GO.**

Die zwanzig Punkte der Definition of Done sind erfüllt: Kunde finden,
Status ohne SQL sehen, Plan und Founding-Partner-Status, Consent,
Google-Verbindung, Locations inklusive Multi und Zero, letzter Sync und
Fehler, gezielter Sync, Engine, Mailstatus, Billing lesend, Founding
Partner sicher setzen und entziehen, auditiert, kein Zugriff für
normale Nutzer, keine generische DB-Schnittstelle, nichts
Destruktives, G2/H2-Security unverändert, Regression grün.

Mit einer Einschränkung, die kein Mangel ist, sondern eine
Entscheidung: **keine „Engine neu bewerten"-Aktion**, weil es keinen
sicheren vorhandenen Weg gibt und der Sync sie mitnimmt (Abschnitt I).

Diese Einschätzung gilt **nach dem Deploy aus Q**. Vorher ist im
Produktivsystem nichts davon da.

### MVP-Freeze

**NO-GO, bis R.1 bis R.3 erledigt sind.**

Nicht wegen H3 — der Teil ist fertig und geprüft. Sondern weil
„Freeze" heißt: keine neuen Funktionen mehr, nur noch Deployment,
Konfiguration, ein End-to-End-Smoke und Blockerfixes. Drei der vier
Restpunkte sind genau das, und einer davon kann einen zahlenden Kunden
unmittelbar treffen (die Trial-Ende-Mail).

Sind R.1 bis R.3 durch, ist aus meiner Sicht **GO für den Freeze** —
und R.4, die drei Smokes, ist dann die erste Freeze-Aufgabe und nicht
mehr Entwicklung.
