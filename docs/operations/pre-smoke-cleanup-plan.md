---
title: "Phase 0A — Nutzer- und Dateninventur"
subtitle: "Bereinigungsplan vor dem MVP-E2E-Smoke · WERKRUF"
date: "19.10.2026"
---

# Vorab: was dieses Dokument ist und was nicht

Es ist der Plan. Es ist **keine Messung**.

Alles, was hier über die Struktur steht, ist aus dem Repository
abgeleitet — Migrationen, Schema-Dump, Edge Functions, RLS-Policies.
Alles, was über den **Inhalt** der Produktionsdatenbank zu sagen wäre,
kann ich von hier aus nicht sehen. Dafür liegen zwei lesende
Abfragedateien bereit; ihre Ergebnisse entscheiden, welche Variante am
Ende richtig ist.

Es wurde nichts verändert, nichts gelöscht, nichts deployt.

---

# A. Nutzerbestand

Nicht aus dem Repository ermittelbar. Liefert **Abfrage 1** in
`docs/operations/pre-smoke-inventur.sql`.

Was aus den bisherigen Messungen dieser Session bekannt ist:

| Adresse | Belegt durch | Zustand |
|---|---|---|
| `iverbohnes@gmail.com` | `auth.users`-Auszug | bestätigt |
| `ivergentz@gmail.com` | `auth.users`-Auszug | bestätigt |

`test-empfaenger@example.invalid` tauchte in `email_queue` auf, ist
aber nur Mailempfänger, kein Nutzer. Ob weitere Konten existieren,
beantwortet erst Abfrage 1 — sie listet **alle** Zeilen aus
`auth.users`, nicht nur die beiden gesuchten.

Abfrage 1 liest die Admin-Rolle aus `raw_app_meta_data`. Das ist die
Quelle, die das Produkt tatsächlich auswertet (siehe Abschnitt
„Admin-Rechte" weiter unten) — `user_metadata` wird bewusst nicht
gelesen.

---

# B. Abhängige Daten je Nutzer

## B.1 Die Abhängigkeitskette

Aus dem Schema abgeleitet, nicht geraten. `user_profiles.id` **ist**
die Auth-User-ID; eine eigene Spalte `user_id` gibt es dort nicht.

```
auth.users.id
│
├── user_profiles.id                         1:1, PK = auth user id
│     └── business_photos.profile_id
│
├── google_accounts.user_id
│     ├── google_locations.account_id (+ user_id)
│     │     ├── google_reviews.location_id   (+ user_id, account_id)
│     │     ├── review_replies.location_id   (+ user_id)
│     │     └── action_tokens.location_id    → CASCADE (belegt)
│     └── oauth_tokens.account_id (+ user_id)
│
├── events.user_id
│     └── action_tokens.event_id             → CASCADE (belegt)
│
├── action_tokens.user_id                    → CASCADE (belegt)
│     └── action_auth_states.token_id        → CASCADE (belegt)
├── action_auth_states.user_id               → CASCADE (belegt)
│
├── ai_usage_log.user_id
├── audit_logs.user_id                       nullable
├── email_queue.user_id                      nullable
├── google_oauth_states.user_id
├── notification_preferences.user_id
├── recommendation_events.user_id
├── sync_jobs.user_id                        nullable
├── review_replies.user_id
└── weekly_snapshots.user_id
```

**Nicht am Nutzer, sondern an der E-Mail-Adresse:**

```
leads.email        ← keine Spalte user_id, keine Fremdschlüssel
```

**Ohne jeden Nutzerbezug** (eine Nutzerbereinigung erreicht sie nicht
und darf sie nicht erreichen):

```
sync_runs · engine_thresholds · engine_versions · ops_alert_log
ops_alert_mutes · gbp_category_metadata · gbp_api_snapshots
gbp_api_changes · rate_limits · sync_locks · stripe_events
profile_report_rate_limits
```

`profile_report_requests` hängt indirekt: `lead_id → leads` und
`queue_id → email_queue`, beide mit **SET NULL**.

## B.2 Wie viele Zeilen wirklich hängen

Beantwortet **Abfrage 3**. Sie sucht sich die Tabellen selbst aus dem
Systemkatalog, statt einer gepflegten Liste zu folgen — eine Liste
altert still, der Katalog nicht. Im Trockenlauf fand sie 16 Tabellen.

---

# C. Risiken

Sieben Befunde. Die ersten drei hängen zusammen und sind der Grund,
warum dieser Plan mit *messen* beginnt und nicht mit *löschen*.

## C.1 Der eingecheckte Schema-Dump ist abgeschnitten — BEFUND

`supabase/schema/production-baseline-2026-09-22.sql`, 133.926 Bytes,
endet mitten im Satz:

```sql
    min(created_at) F
```

Kein Semikolon, keine schließende Klammer. `pg_dump` schreibt
Constraints, Indizes, Trigger und RLS-Policies **nach** Tabellen und
Views — die Datei bricht innerhalb der Views ab. Entsprechend enthält
sie:

| Objektart | Anzahl im Dump |
|---|---|
| FUNCTION | 71 |
| TABLE | 22 |
| VIEW | 14 (letzte unvollständig) |
| **ADD CONSTRAINT** | **0** |
| **CREATE TRIGGER** | **0** |
| **CREATE POLICY** | **0** |

Die Fremdschlüsselregeln der 22 Kerntabellen stehen also **nirgends im
Repository**. Die einzigen belegbaren Regeln sind 7 Fremdschlüssel aus
Migrationen, und die betreffen ausschließlich Tabellen, die nach dem
22.09.2026 entstanden sind (`action_tokens`, `action_auth_states`,
`profile_report_requests`).

Wer aus diesem Repo auf Kaskadenverhalten schließt, schließt aus einer
Lücke.

## C.2 „kaskadiert" ist ein Kommentar, keine Messung

`supabase/functions/delete-account/index.ts`:

```ts
// 3. Supabase-Nutzer loeschen (kaskadiert in alle Tabellen)   ← Z 6
/* ── 4. Nutzer loeschen (kaskadiert) ── */                    ← Z 118
await supabaseAdmin.auth.admin.deleteUser(user.id);            ← Z 119
```

„in alle Tabellen" ist die Behauptung. Die zweite Quelle im Repo,
`anonymise_user_on_delete()`, nennt namentlich **drei**:

```sql
-- business_photos cascade via FK ON DELETE CASCADE
-- user_profiles  cascade via FK ON DELETE CASCADE
-- ai_usage_log   cascade via FK ON DELETE CASCADE
```

Dreizehn weitere nutzergebundene Tabellen werden nicht erwähnt,
darunter `google_reviews` und `review_replies` — die einzigen, die
**personenbezogene Daten Dritter** enthalten, nämlich Namen und
Freitexte der Kunden des Betriebs.

Kaskadiert es dort nicht, bleiben diese Daten nach jeder Kontolöschung
liegen: ohne Zweck, ohne Verantwortlichen, ohne Rechtsgrundlage. Das
wäre nicht nur ein falscher Vertragstext in AVV § 12, sondern ein
eigenständiger Datenschutzverstoß.

**Das ist kein Testproblem. Das ist ein Produktbefund, der vor dem
ersten echten Kunden geklärt sein muss — unabhängig davon, welche
Bereinigungsvariante wir wählen.**

## C.3 Der anonymisierende Trigger ist nicht belegt angehängt

`anonymise_user_on_delete()` existiert als Funktion im Dump. Das
zugehörige `CREATE TRIGGER` liegt im abgeschnittenen Teil. Ob die
Funktion überhaupt feuert, und ob `BEFORE` oder `AFTER DELETE`, ist im
Repo nicht prüfbar.

Nebenbei: Die Funktion **löscht Leads nicht, sie überschreibt sie**.
Nach einer Kontolöschung bleibt die Lead-Zeile mit Firmenname, Gewerk,
Stadt und Sichtbarkeitswert bestehen; nur E-Mail, Name und Telefon
werden ersetzt. Für die Inventur heißt das: Ein scheinbar „sauberer"
Zustand kann eine anonymisierte Altzeile verbergen. Abfrage 7 sucht
deshalb zusätzlich nach `deleted@werkruf.com`.

## C.4 `leads` hängt an der E-Mail, nicht am Nutzer

Keine Spalte `user_id`, kein Fremdschlüssel. Eine Bereinigung nach
`user_id` — wie sie jede naheliegende Cleanup-Abfrage machen würde —
übersieht diese Tabelle vollständig. Deshalb steht sie in der
Inventur gesondert.

## C.5 `delete-account` löscht nur das eigene Konto

```ts
const { data: { user } } = await supabase.auth.getUser();   // aus dem JWT
await supabaseAdmin.auth.admin.deleteUser(user.id);         // genau dieser
```

Es gibt keinen Parameter für einen fremden Nutzer. Um
`ivergentz@gmail.com` über diesen Pfad zurückzusetzen, musst **du dich
als dieser Nutzer anmelden** und die Löschung in der Oberfläche
auslösen. Von einem Admin-Konto aus geht es über diesen Weg nicht.

Zwei Nebenwirkungen, die beide **außerhalb der Datenbank** passieren:

- **Stripe:** ein laufendes Abo wird gekündigt (`subscriptions.cancel`)
- **Cloudinary:** alle Fotos des Profils werden einzeln zerstört

Beides sind echte Schreibzugriffe auf externe Systeme. Sie gehören in
die Kategorie EXTERNAL und nicht in einen Nebensatz.

## C.6 Consent hängt an `user_profiles`

`accepted_terms_version` und `accepted_terms_at` sind Spalten von
`user_profiles` (Migration vom 13.10.2026). Es gibt keine
Consent-Historientabelle.

Daraus folgt direkt: **Ein echter „Consent wie beim ersten Login"
-Zustand ist ohne Löschen der Profilzeile nicht herstellbar.** Die
Alternative wäre ein `UPDATE … SET accepted_terms_version = null` —
und das ist genau das, was dein Auftrag unter §12 ausschließt
(„Nicht heimlich Consentdaten manipulieren, nur um den Test zu
vereinfachen"). Dieser Punkt entscheidet die Variantenwahl mit.

## C.7 Es gibt keinen Produktpfad, um jemanden zum Admin zu machen

`supabase/functions/admin-ops/index.ts` kennt genau fünf Aktionen:

```
list_customers · get_customer_support_state · trigger_customer_sync
set_founding_partner · clear_founding_partner
```

Kein `set_admin`, kein `delete_user`. Die Admin-Rolle muss im
Supabase-Dashboard gesetzt werden (EXTERNAL) — und zwar in
`app_metadata`, nicht in `user_metadata`.

---

# Admin-Rechte: wie das System sie erkennt

Einheitlich, an vier Stellen gemessen:

| Ort | Prüfung |
|---|---|
| `src/utils/authRoles.js` | `user?.app_metadata?.role === 'admin'` |
| `src/utils/authorization.js` | `user?.app_metadata?.role === 'admin'` |
| `src/utils/adminOps.js` | `authUser?.app_metadata?.role === 'admin'` |
| RLS-Policies (2 Migrationen) | `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'` |

`src/utils/adminOps.js` begründet die Wahl ausdrücklich:

> Ausschliesslich app_metadata. user_metadata ist vom Client schreibbar
> (supabase.auth.updateUser), app_metadata nicht — dort [...] wer
> user_metadata.role = 'admin' setzt, kommt damit nicht weiter.

**Wichtig für die Durchführung:** Die RLS-Policies lesen die Rolle aus
dem **JWT**, nicht aus der Tabelle. Ein frisch gesetztes
`app_metadata.role` wirkt erst, nachdem das Token erneuert wurde — in
der Praxis: abmelden und neu anmelden. Die Migration vom 22.09.2026
sagt das selbst: *„has app_metadata.role = 'admin' and has refreshed
their JWT"*. Wer das übersieht, misst eine funktionierende
Rechtevergabe als Fehler.

---

# D. Empfohlener Zielzustand

## `iverbohnes@gmail.com` — Admin

| Merkmal | Ziel | Prüfbar durch |
|---|---|---|
| `app_metadata.role` | `admin` | Abfrage 1 |
| `user_profiles` | **behalten** | Abfrage 1 |
| `plan` | `free` | Abfrage 2 |
| `google_accounts` | 0 | Abfrage 3, 4 |
| `google_locations` | 0 | Abfrage 3, 4 |
| ausgewählter Standort | keiner | Abfrage 4 |
| Founding Partner | nein | Abfrage 2 |
| offene Events | 0 | Abfrage 6 |

Die Profilzeile bleibt. Mehrere Dashboard- und Admin-Ansichten lesen
`user_profiles` ohne Null-Behandlung; ein Admin ohne Profil wäre ein
künstlicher Fehlerfall, der nichts belegt.

## `ivergentz@gmail.com` — Kunden-Testaccount

| Merkmal | Ziel | Prüfbar durch |
|---|---|---|
| `app_metadata.role` | **nicht** `admin` | Abfrage 1 |
| `google_accounts` | 0 **vor** dem Smoke | Abfrage 3, 4 |
| `google_locations` | 0 **vor** dem Smoke | Abfrage 3, 4 |
| `plan` | `free` | Abfrage 2 |
| Founding Partner | nein, `founding_partner_since` null | Abfrage 2 |
| Stripe in der DB | keine Altlast | Abfrage 2 |
| Consent | kein Altbestand | Abfrage 2 |
| offene Events | 0 | Abfrage 6 |
| operative Mails | 0 | Abfrage 5 |
| Action Tokens | 0 | Abfrage 3 |

Ein Hinweis zur Formulierung im Auftrag: `founding_partner` ist **kein
Boolean**. Seit dem 13.10.2026 ist es ein Wert der Spalte `plan`:

```sql
check (plan = any (array['free','starter','pro','founding_partner']))
```

„Nicht Founding Partner" heißt also: `plan <> 'founding_partner'`
**und** `founding_partner_since is null`. Der saubere Weg, das zu
ändern, ist die vorhandene RPC `clear_founding_partner` — nicht ein
direktes UPDATE auf `plan`.

---

# E. Bereinigungsstrategie

## E.1 Die drei Varianten im Vergleich

Bewertet für `ivergentz@gmail.com`.

| Kriterium | A — Nutzer behalten, Daten bereinigen | B — löschen und neu registrieren | C — neue Testadresse |
|---|---|---|---|
| Auth-Reinheit | mittel: `auth.users`-Zeile bleibt mit altem `created_at`, `confirmed_at` | **hoch**: echter Signup inkl. Bestätigungsmail | hoch |
| Google OAuth | Verbindung muss einzeln gelöst werden | fällt mit dem Konto weg | kein Altbestand |
| Consent | **nur durch verbotenes UPDATE rücksetzbar** (C.6) | sauber: entsteht beim Onboarding neu | sauber |
| Stripe | DB-Felder bleiben, müssen von Hand geleert werden | `delete-account` kündigt das Abo (EXTERNAL) | kein Altbestand |
| Mail | operative Zeilen löschbar, `sent` ist Historie | Historie geht mit, falls kaskadiert | kein Altbestand |
| Events | löschbar | gehen mit, falls kaskadiert | kein Altbestand |
| Testrealismus | **niedrig** — der Kernpfad Signup → Bestätigung → Onboarding wird nicht durchlaufen | **hoch** | hoch |
| Risiko | gering, aber viele Einzelschritte | **hängt vollständig an C.2** | gering |
| Besonderes | — | prüft nebenbei `delete-account`, das noch nie gemessen wurde | zweites Postfach nötig; Altkonto bleibt als Müll in Produktion |

Zu C, weil es naheliegt und oft falsch eingeschätzt wird: Die
WERKRUF-Anmeldeadresse und das Google-Konto sind **unabhängig**. Man
kann sich mit `kunde-test@…` registrieren und anschließend per OAuth
das Google-Konto `ivergentz@gmail.com` mit den Profilen WERKRUF und
S&I verbinden. C scheitert also nicht an Google. Es scheitert daran,
dass ein zusätzliches Postfach gebraucht wird und das Altkonto
unbereinigt in Produktion liegen bleibt — der Zustand, den wir gerade
beseitigen wollen.

## E.2 Empfehlung

**Variante B — aber erst nach der Messung aus C.2.**

Die Begründung in einem Satz: B ist die einzige Variante, die den
Consent-Zustand erzeugt, ohne ihn zu fälschen (C.6), und die einzige,
die den wichtigsten Kundenpfad — Registrierung, Bestätigungsmail,
Onboarding — tatsächlich durchläuft statt ihn zu überspringen.

Der Vorbehalt ist ernst gemeint: **Kaskadiert die Löschung nicht, ist B
schlechter als A.** Dann bleiben verwaiste Zeilen in bis zu 13
Tabellen zurück, der Account ist nicht sauber, und der Smoke startet
auf einem Trümmerfeld, das zudem schwer zu finden ist.

Deshalb die Reihenfolge:

```
1  loeschung-beleg.sql       →  kaskadiert es?       (lesend)
2  pre-smoke-inventur.sql    →  was liegt da?        (lesend)
3  erst dann entscheiden
```

Fällt Schritt 1 positiv aus → **B**.

Fällt Schritt 1 negativ aus → das ist ein Produktbefund mit
Datenschutzrelevanz, der ohnehin vor dem ersten Kunden behoben werden
muss. Für den Smoke dann **A** als Zwischenlösung, mit der
ausdrücklichen Einschränkung, dass Signup und Consent darin nicht
mitgeprüft werden.

In beiden Fällen gilt G2 §39: gemeldet, bevor repariert.

---

# F. Schritte, getrennt nach Wirkung

## READ ONLY — jetzt auszuführen

| # | Was | Datei | Wirkung |
|---|---|---|---|
| R1 | Kaskadenregeln, verwaiste Zeilen, Tabellen ohne Kontoweg | `docs/operations/loeschung-beleg.sql` | keine |
| R2 | Nutzerbestand und abhängige Daten, 8 Abfragen | `docs/operations/pre-smoke-inventur.sql` | keine |

Beide im **Supabase SQL Editor** ausführen, Rolle `postgres`
(`auth.users` ist für andere Rollen nicht lesbar). Die Abfragen
einzeln markieren und mit Strg+Enter starten, sonst zeigt der Editor
nur das Ergebnis der jeweils letzten.

Beide Dateien sind nachweislich lesend: kein `insert`, `update`,
`delete`, `alter`, `drop`, `truncate`, `create`, `grant`, `revoke` —
mit einer Gegenprobe geprüft, die ein eingeschmuggeltes `delete`
gefunden hätte.

`pre-smoke-inventur.sql` wurde vor der Übergabe gegen eine lokale
PostgreSQL-16-Instanz laufen gelassen, deren Schema aus dem
eingecheckten Baseline-Dump plus der Migration vom 13.10.2026 gebaut
war. Alle acht Abfragen liefen fehlerfrei. Gegenprobe zur Tokenregel:
In die Testdaten wurde ein erkennbarer Tokenwert geschrieben; er
taucht in der gesamten Ausgabe der acht Abfragen **nicht** auf,
während eine direkte Abfrage ihn sehr wohl zeigt. Die Regel
„nie Tokenwerte ausgeben" ist damit gemessen, nicht behauptet.

## WRITE — erst nach deiner Freigabe

Noch nicht geliefert, absichtlich. Welche Schritte nötig sind, hängt
am Ergebnis von R1 und R2. Die Form steht schon fest und folgt deinem
§15: jede Abfrage einzeln, vorher benannt was sie verändert, in einer
Transaktion, mit `RETURNING`, gegen eine **vorher aus R2 abgelesene**
UUID — kein Wildcard-Delete, keine Löschung auf Verdacht.

Grobe Erwartung, damit du den Umfang einschätzen kannst:

- Variante B: im Wesentlichen **ein** Schritt (`delete-account` aus der
  Oberfläche), danach Neuregistrierung
- Variante A: etwa acht bis zwölf Einzelschritte über die in B.1
  genannten Tabellen, plus die Sonderfälle `leads` und `email_queue`

## EXTERNAL — außerhalb der Datenbank, nur von dir

| # | Wo | Was | Warum es hierher gehört |
|---|---|---|---|
| E1 | Supabase Dashboard → Authentication → Users | `app_metadata.role = "admin"` bei `iverbohnes@gmail.com` setzen | Es gibt keinen Produktpfad dafür (C.7) |
| E2 | WERKRUF | nach E1 abmelden und neu anmelden | RLS liest die Rolle aus dem JWT, nicht aus der Tabelle |
| E3 | Stripe Dashboard | echten Zustand zu `stripe_customer_id` aus Abfrage 2 ablesen | DB-Zustand und Stripe-Realzustand können auseinanderlaufen |
| E4 | `myaccount.google.com` → Sicherheit → Apps von Drittanbietern | **vor** dem Smoke: WERKRUF-Zugriff entziehen | Sonst überspringt die erneute OAuth-Freigabe den Zustimmungsbildschirm und der Smoke prüft nicht, was er zu prüfen glaubt |

E4 ist der Punkt, der am leichtesten untergeht. Google merkt sich eine
erteilte Freigabe. Wird sie nicht entzogen, läuft der zweite
OAuth-Durchlauf still durch — und der Teil des Kundenpfads, an dem in
der Praxis am meisten schiefgeht, bleibt ungetestet.

---

# §16 — Gegenproben zu jedem Vorschlag

| Frage | Antwort |
|---|---|
| Kann die Bereinigung den Admin beschädigen? | Nur wenn seine `user_profiles`-Zeile entfernt wird. Der Zielzustand behält sie ausdrücklich. |
| Kann sie einen anderen Nutzer treffen? | Nur über ein Wildcard-Delete. Deshalb §15: jede Abfrage mit geprüfter UUID. Abfrage 3 zeigt in `zeilen_gesamt`, ob eine Tabelle dem Zielnutzer allein gehört. |
| Kann sie Google-Daten verändern? | **Nein.** Keine der Bereinigungen ruft die Google-API schreibend auf. Profile, Bewertungen, Fotos, Öffnungszeiten und Kategorien bleiben unberührt — bereinigt werden nur WERKRUF-interne Zuordnungen. E4 entzieht eine Freigabe, verändert aber keine Profildaten. |
| Kann sie Stripe verändern? | **Ja, in Variante B.** `delete-account` kündigt ein laufendes Abo. Deshalb E3 vorher. |
| Kann sie Audit-Historie vernichten? | Ja, wenn `email_queue`-Zeilen mit `status = 'sent'` gelöscht werden. Abfrage 5 trennt operativ von Historie genau deshalb. |
| Kann sie Fremdschlüsselreste hinterlassen? | **Das ist die offene Frage** — siehe C.1 und C.2. Genau das misst R1. |
| Kann sie Cloudinary-Daten zerstören? | Ja, in Variante B: alle Fotos des Profils. Nicht im Auftrag erwähnt, deshalb hier genannt. |

---

# §17 — Abschlussprüfung nach der späteren Durchführung

`PRE-SMOKE CLEANUP = PASS` gilt erst, wenn eine erneute Ausführung von
`pre-smoke-inventur.sql` zeigt:

**Admin `iverbohnes@gmail.com`**

```
Abfrage 1    admin_rolle = admin
Abfrage 3    google_accounts = 0, google_locations = 0
```

**Kunde `ivergentz@gmail.com`**

```
Abfrage 1    admin_rolle = —
Abfrage 2    plan <> founding_partner, founding_partner_since = null
Abfrage 3    google_accounts = 0, google_locations = 0, action_tokens = 0
Abfrage 5    keine Zeile mit art = OPERATIV
Abfrage 6    keine Zeile mit zustand = OFFEN
```

Zusätzlich `loeschung-beleg.sql`, Abschnitt 2: **verwaiste Zeilen = 0
in jeder Zeile.** Ist das nicht der Fall, hat die Bereinigung Reste
hinterlassen, und zwar genau die, die C.2 als Risiko benennt.

---

# Was jetzt zu tun ist

1. `loeschung-beleg.sql` im Supabase SQL Editor ausführen
2. `pre-smoke-inventur.sql` im Supabase SQL Editor ausführen, acht
   Abfragen einzeln
3. Ergebnisse herschicken

Danach entscheiden wir die Variante und ich liefere die schreibenden
Schritte — einzeln, benannt, mit geprüfter UUID.

**Bis dahin wurde nichts verändert und es wird nichts verändert.**
