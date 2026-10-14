# H2.2 — Abschlussbericht

Stand: 14.10.2026. Paket H2.2, Schritte A bis F.

Auftrag war ausdrücklich kein Aufräumpaket: nur echte
Security-/Access-P0, Founding Partner, die unmittelbar falsch
behandelt werden, und falsche Produktversprechen vor dem ersten
zahlenden Kunden.

---

## 1. Was gemacht wurde

| Schritt | Inhalt | Zustand |
| --- | --- | --- |
| A | EXECUTE-Rechte in Produktion gemessen, 46 offene Funktionen klassifiziert | **gemessen** |
| B | Schreibseite geschlossen (`20261014120000`) + Policy-Test | **in Produktion angewandt** |
| B+ | Leseseite geschlossen (`20261014130000`) + A/B-Isolationstest | **in Produktion angewandt** |
| C | Founding-Partner-Einstellungen | geliefert, **nicht deployt** |
| D | `payment_failed` für Founding Partner gesperrt | geliefert, **nicht deployt** |
| E | falscher Kreditkarten-Text korrigiert | geliefert, **nicht deployt** |
| F | Stripe-Dashboard-Prüfliste | geliefert, **Prüfung offen** |

Dokumente: `docs/h2-2-security-audit.md` (A, B, Leseseite),
`docs/h2-2-founding-partner.md` (C, D, E),
`docs/operations/stripe-dashboard-mvp.md` (F),
`docs/operations/lesezugriff-diagnose.sql`.

## 2. Der Sicherheitsstand, in Produktion gemessen

Vorher und nachher, am 14.10.2026 im SQL-Editor abgelesen:

| Gruppe | vorher | nachher |
| --- | --- | --- |
| `definer` + `volatile`, für PUBLIC ausführbar | **46** | **0** |
| dito, für `anon` | 46 | 0 |
| dito, für `authenticated` | 51 | 3 |
| `definer` + `stable`, für PUBLIC | **14** | **0** |
| dito, für `authenticated` | 9 | 2 |
| `service_role` erreicht | alle | alle |
| Rümpfe mit Eigentumsprüfung | 0 | 8 |

Die fünf verbliebenen Client-RPCs sind die, die das Frontend wirklich
ruft: `accept_terms`, `claim_own_lead`, `touch_dashboard_visit`,
`events_feed`, `werkruf_score_location`. Die beiden Letzteren prüfen
seit der Leseseite-Migration `auth.uid()` im Rumpf.

Wirkungsproben in Produktion: `anon` → `update_user_plan` und
`anon` → `compute_health_score` ergeben beide
`permission denied for function`.

Vorher war beides erfolgreich. `update_user_plan` konnte den Plan
jedes Nutzers auf `free` oder `pro` setzen, ohne Aufrufer im Repo;
`compute_health_score` gab fremde Score-Daten an den öffentlich
ausgelieferten anon-Key heraus.

## 3. Prüfbarkeit

| | |
| --- | --- |
| Jest | 1091 Tests in 71 Suites grün |
| SQL-Abnahmen | 27 Dateien, 0 rot |
| `CI=true npm run build` | `Compiled successfully.` |
| neue Testdateien | 6 |
| Gegenproben, die nachweislich rot werden | 9 |

Die Gegenproben im Einzelnen, weil ein grüner Test ohne sie nichts
aussagt:

| Eingriff | Ergebnis |
| --- | --- |
| Datenbank ohne `20261014120000` | `securityDefinerPrivileges.test.sql` rot, listet 48 |
| neue offene Funktion angelegt + `grant … to anon` | Migration bricht ab und nennt sie |
| `grant execute … to anon` im Test | Policy-Abfrage findet ihn |
| Datenbank ohne `20261014130000` | `lesezugriffIsolation.test.sql` rot in Abschnitt B |
| Eigentumsprüfung aus einem Rumpf entfernt | A liest B, Abschnitt F meldet es |
| Rümpfe auf CRLF + `BEGIN` groß | alte Suche trifft nicht, neue trifft |
| `foundingPartner = false` erzwungen | 5 von 10 UI-Fällen rot |
| `payment_failed`-Gate verschoben / entfernt | je 2 Fälle rot |
| alte Kreditkarten-Zusage zurück | 4 Fälle rot, in zwei Dateien |

## 4. Was dieses Paket über das Prüfen gelernt hat

Vier Mal in diesem Paket hat ein Textmuster einen **Kommentar**
getroffen statt Code oder Ausgabe:

1. meine Erkennung des `when others`-Handlers brach bei
   `previous_location_health` ab — dort steht der Ausdruck in einem
   Kommentar, der erklärt, warum er nicht verwendet wird
2. `billingAudit` wurde rot, weil die Einstellungsseite „Lifetime" im
   Kommentar nennt, der verbietet, es zu schreiben
3. `billingAudit` blieb **grün nach der Behebung**, weil die
   korrigierte Preisseite den alten falschen Satz wörtlich zitierte
4. ein Fehlalarm bei `update_user_plan`: die Migration zitiert in
   ihrem Kopf die Wirkungsprobe aus der Produktionsmessung

Fall 3 ist der schlimme. Kein Fehlalarm, sondern Schweigen: der Test,
der den Befund festhielt, hätte fallen müssen und tat es nicht. Wäre
nur der grüne Gesamtlauf angesehen worden, wäre der Widerspruch
„Befund behoben, Befund-Test grün" nie aufgefallen.

Konsequenz, überall umgesetzt: wo es um das geht, was der Nutzer
sieht, prüfen die neuen Tests die **gerenderte Ausgabe**. Wo ein
Quelltextmuster unvermeidlich ist (Reihenfolge im Webhook), werden
Kommentare vorher entfernt und jede Schnittgrenze einzeln belegt.

Dazu zwei weitere Funde, die nur durch Gegenproben sichtbar wurden:

- **Der Handler, der die Härtung verschluckte.** Zwei Lesefunktionen
  enden mit `exception when others then return jsonb_build_object(…)`.
  Die eingefügte Eigentumsprüfung warf 42501 — und der Handler machte
  daraus ein freundliches JSON. Die Selbstprüfung der Migration war
  grün, der A/B-Test nicht.
- **Die zu enge Suche.** Der erste Lauf der Leseseite-Migration brach
  in Produktion für alle sechs plpgsql-Funktionen ab. Ursache nicht
  geraten, sondern nachgebaut: CRLF und `BEGIN` in Großschreibung. Die
  Migration hat dabei nichts verändert — fail closed hat gehalten.

## 5. Restpunkte

### 5.1 Was du noch tun musst

| # | Aufgabe | warum |
| --- | --- | --- |
| 1 | C, D, E pushen; `stripe-webhook` neu deployen | sonst wirkt nichts davon |
| 2 | Migrationsverlauf nachziehen | beide Migrationen liefen im SQL-Editor, stehen also nicht in `supabase_migrations.schema_migrations` und gelten weiter als offen |
| 3 | F-Prüfliste im Stripe-Dashboard abgehen | fünf Seiten, lesend |
| 4 | Entscheidung: Stripes Fehlzahlungs-Mail an oder aus | sonst zwei Mails zum selben Vorgang |
| 5 | Fremdaccount-Smoke, G2 Betriebs-Smoke, Mail-Smoke | seit H1 offen, nur mit echten Konten möglich |

### 5.2 Bekannte Lücken, bewusst nicht in H2.2 (§32)

Refund-Handler, `invoice.paid`, verspätetes `deleted`, tote
`trial`-Pfade, `starter`, GhostSetupModal, PathAPricingModal, die
zweite Preisseite, Entflechtung der Trial-Spalten,
Kündigungsbestätigung, Dunning-Engine, Stripe-Steuerlogik.

### 5.3 Neu gefunden, kein P0, nicht behoben

- `compute_location_health_score` gibt im `when others`-Zweig
  weiterhin `sqlerrm` an den Aufrufer zurück. Für 42501 nicht mehr,
  für andere Fehler schon — interne Fehlertexte im Client.
- Die zwei toten `sync_events`-Überladungen sind geschlossen, nicht
  gelöscht (so entschieden).
- `assert_eigener_zugriff` schützt acht Funktionen. Eine neunte, die
  jemand später mit `p_user_id` anlegt, hat die Prüfung nicht
  automatisch — der Policy-Test fängt nur das fehlende Grant, nicht
  die fehlende Prüfung im Rumpf.

---

## 6. Go / No-Go

Getrennt bewertet, weil die beiden Fragen verschiedene Risiken haben.

### 6.1 Founding Partner einladen

**Go — nach Schritt 1 und 2 aus 5.1.**

Begründung:

- Die beiden Access-P0 sind in Produktion geschlossen und gemessen.
  Das war der Blocker.
- Founding Partner werden in den Einstellungen richtig dargestellt,
  mit zehn Tests gegen die gerenderte Seite. **Setzt den Deploy von C
  voraus** — vorher sieht ein Founding Partner weiterhin „Free" und
  „Jetzt upgraden".
- Sie bekommen keine Zahlungsaufforderung mehr. **Setzt den Deploy von
  D voraus.**
- Ihr Zugang hängt nicht an Stripe (`founding_partner` steht vor dem
  Stripe-Zweig), und der Webhook überschreibt ihren Plan nicht.
- Stripe muss für sie überhaupt nicht konfiguriert sein. Die
  F-Prüfliste ist für Founding Partner **kein** Blocker.

Was dabei bewusst in Kauf genommen wird: ein Founding Partner mit
aktivem Altabo zahlt weiter, bis er oder du es bei Stripe beendest.
Die Oberfläche benennt diesen Zustand jetzt, löst ihn aber nicht
automatisch.

### 6.2 Ersten zahlenden Kunden annehmen

**No-Go, solange 5.1 Punkt 3 nicht erledigt ist.**

Der Blocker ist nicht Code, sondern eine einzige Unbekannte:

> Ist in Stripe die Trial-Ende-Erinnerung aktiv?

Ist sie aus, bekommt ein Kunde im 30-Tage-Trial von **niemandem** eine
Vorwarnung und sieht die 49 € zum ersten Mal auf dem Kontoauszug.
WERKRUF schickt keine — `schedule_lifecycle_emails` filtert auf
`plan = 'trial'`, einen Wert, den der Constraint ablehnt. Die Funktion
läuft, findet nichts und meldet Erfolg.

Zweiter Punkt derselben Liste, nicht ganz so dringend, aber teuer:
steht in den Retry-Einstellungen „Leave the subscription past-due",
behält ein Nichtzahler dauerhaft den vollen Zugang, weil `past_due` in
`PAID_STATUSES` steht.

Dritter Punkt: der Kündigungsmodus im Portal. Bei `immediately`
verliert der Kunde den Zugang mitten im bezahlten Monat, und eine
Rückerstattung gibt es im Code nicht.

Alle drei sind in 15 Minuten im Dashboard ablesbar
(`docs/operations/stripe-dashboard-mvp.md`, Abschnitt 4). Danach ist
die Frage entweder beantwortet oder in wenigen Klicks erledigt — und
dann ist aus meiner Sicht auch hier Go.

Was ich **nicht** als Blocker zähle, obwohl es offen ist: die fehlende
Kündigungsbestätigung, der fehlende Refund-Pfad und `invoice.paid`.
Alle drei betreffen Fälle nach der ersten Zahlung und sind mit einem
einzelnen Kunden von Hand beherrschbar. Als Dauerzustand nicht.

---

## 7. Was in H2.2 nicht passiert ist

- keine Migration von mir angewandt, kein Deploy
- keine Stripe-Konfiguration geändert, kein Webhook ausgelöst, keine
  Stripe-Mail verschickt
- keine echte Kundenmail
- kein fremder Nutzer verändert
- keine bestehende Migration editiert
- keine fachliche Logik in den acht gehärteten Funktionen geändert:
  eine Zeile davor, bei zwei zusätzlich eine im Fehlerzweig
- `payment_method_collection` nicht gesetzt
- kein neues Billing-System, keine Dunning-Engine, keine neuen
  Lifecycle-Mails
