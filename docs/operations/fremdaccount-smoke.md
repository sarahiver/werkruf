# Fremdaccount-Smoke

Ablaufplan für den Abschluss-Smoke aus H1 §59, mit dem Betriebs-Smoke aus
G2 DoD 15 (§43) und dem Mail-Smoke (§44).

**Stand: nicht durchgeführt.** Dieser Test braucht einen fremden
Google-Account mit einem echten Unternehmensprofil und einen Menschen, der
klickt. Er lässt sich nicht automatisieren und wurde hier nicht ausgeführt —
weder ganz noch teilweise. Was geprüft ist, steht in
`docs/fremdkundenfaelle-a-g.md`, Spalte „Belegart".

---

## Warum er nötig ist

Jede Zusage der Testsuite hat dieselbe Form: *wenn* die Daten so aussehen,
*dann* verhält sich das Produkt so. Keine davon beweist, was Google in einer
bestimmten Lage tatsächlich liefert. Genau das soll dieser Durchlauf zeigen —
und zwar an einem Betrieb, der nie Teil der Entwicklung war.

§59 ist dabei ausdrücklich: **nicht** die bestehenden S&I.- oder
WERKRUF-Konten. Die haben historische Sonderdaten, und genau deren Fehlen ist
die Frage von H1.

---

## Vorher einstellen

| | Was | Warum |
|---|---|---|
| 1 | `EMAIL_DELIVERY_MODE=test` setzen, solange der Versand geprüft wird | Keine echten Kundenmails (§44: keine unnötigen Testmails an echte Kunden) |
| 2 | Alle vier H1-Migrationen eingespielt: `20261013110000`, `120000`, `130000`, `140000` — und `20261013090000` davor | Ohne `090000` fehlen die Consent-Spalten, ohne `140000` der Weg dorthin |
| 3 | Edge Functions deployt (Push auf `main` genügt) | Automatische Auswahl und `account.no_locations` leben dort |
| 4 | `PUBLIC_REPORT_ALLOWED_ORIGINS` enthält die Produktionsdomain | Sonst weist der SmartCheck-Endpunkt den eigenen Funnel ab |
| 5 | Eine zweite Mailadresse bereit (Gmail **und** Outlook, falls möglich) | §44 |

**Nicht** tun: globalen Produktionssync starten, künstliche Produktionsdaten
anlegen, fremde Nutzer verändern.

---

## Ablauf

Jeder Schritt hat eine Beobachtung *und* einen Beleg in der Datenbank. Die
Abfragen sind lesend, bis auf die ausdrücklich gekennzeichneten.

### 1 — Signup

Fremde Adresse, `/signup`, E-Mail und Passwort.

```sql
select id, email, created_at, email_confirmed_at
  from auth.users where email = '<fremde-adresse>';
```

Erwartet: Zeile vorhanden, `email_confirmed_at` noch leer, Bestätigungsmail
unterwegs.

### 2 — Consent

Link aus der Mail öffnen → `/onboarding`. Haken setzen, erst dann ist der
Knopf aktiv.

```sql
select plan, accepted_terms_version, accepted_terms_at
  from public.user_profiles where id = '<user-id>';
```

Erwartet: `accepted_terms_version = 'datenschutz-2026-09'`,
`accepted_terms_at` gesetzt, `plan = 'free'`.

**Gegenprobe dazu** (zeigt die Härtung): Im Browser, als dieser Nutzer
angemeldet, in der Konsole

```js
await supabase.from('user_profiles')
  .update({ accepted_terms_at: '2020-01-01' }).eq('id', '<user-id>');
```

Erwartet: Fehler, und `accepted_terms_at` unverändert.

### 3 — free

Vor dem Freischalten: `/dashboard/fotos`, `/dashboard/kunden-gewinnung` und
`/dashboard/reporting` öffnen.

Erwartet: Bezahlschranke, kein weisser Bildschirm, kein Durchblitzen von
Inhalten. Auf `/dashboard` steht „Die Mails gehören zum Pro-Zugang".

### 4 — Founding Partner setzen

Im SQL Editor (**schreibend**, bewusst von Hand):

```sql
select public.set_founding_partner('<user-id>', 'Fremdaccount-Smoke H1');
```

Erwartet: Zeitpunkt zurück, `plan = 'founding_partner'`. Dieselben drei Seiten
wie in Schritt 3 öffnen — jetzt ohne Schranke. Der Hinweis zu den Mails auf
`/dashboard` ist weg.

### 5 — Google OAuth

`/dashboard/google` → verbinden. **Zwei Durchläufe**, in dieser Reihenfolge:

1. Zugriff bei Google **ablehnen** → Fall F. Erwartet: „Du hast den Zugriff
   bei Google abgebrochen …", Zustand bleibt „nicht verbunden".
2. Zugriff erteilen → weiter mit Schritt 6.

```sql
select status, provider_email, connected_at, last_error_code
  from public.google_accounts where user_id = '<user-id>';
```

### 6 — Location

Nach dem Verbinden wird der Standortimport eingereiht.

```sql
select job_type, status, finished_at, error_code
  from public.sync_jobs where user_id = '<user-id>' order by created_at desc limit 5;

select id, title, place_id, selected_at, is_primary, last_synced_at
  from public.google_locations where user_id = '<user-id>';
```

Erwartet, je Fall:

| Fall | Erwartung |
|---|---|
| genau ein Standort | `selected_at` ist **automatisch** gesetzt (Migration `20261013110000`), `is_primary = true` |
| mehrere Standorte | **kein** `selected_at`; Dashboard fragt „Welchen Betrieb möchtest du ansehen?" |
| kein Standort (B/D/G) | Import `succeeded`, Liste leer; Dashboard: „Noch kein Betrieb verbunden" |

Bei genau einem Standort ist das der Kern des Pakets: Der Kunde darf **nicht**
an „Zu diesem Betrieb wechseln" hängen bleiben.

### 7 — Sync und Engine

Ohne auf einen Montag zu warten, gezielt anstossen (§43). Der Cron-Weg, nicht
die Altlast:

```sql
select public.schedule_all_syncs();          -- schreibend: reiht Jobs ein
```

Dann den Worker laufen lassen (oder den nächsten `*/5`-Lauf abwarten) und
bewerten:

```sql
select count(*), max(created_at) from public.google_reviews where user_id = '<user-id>';
select type, priority, lifecycle, location_id, created_at
  from public.events where user_id = '<user-id>' order by priority desc;
```

Erwartet: Bei einem verbundenen Betrieb mit Bewertungen entstehen Events; bei
0 Standorten genau einer, `account.no_locations`, mit `location_id is null`.

### 8 — Dashboard

`/dashboard` öffnen.

Erwartet: Score passt zu den Daten (nicht 0 bei einem frischen Betrieb ohne
Bewertungen — dann steht dort der Grund), Betriebsname ist der Google-Name,
„Was war los" zeigt die echten Zahlen, „Deine nächsten Schritte" zeigt die
Engine-Aufgaben in deren Reihenfolge.

### 9 — Weekly und Alert

```sql
select public.schedule_communications('all');   -- schreibend: reiht Mails ein
select template, to_email, status, scheduled_for, payload ->> 'weeklyState'
  from public.email_queue where user_id = '<user-id>' order by created_at desc;
```

Erwartet: `blocked = 0` im Rückgabewert (der Betrieb ist Founding Partner),
und je nach Wochentag eine `weekly_summary`. Für den Alert eine echte
1-Stern-Bewertung abwarten oder den Fall auslassen und als offen vermerken —
**keine künstliche Bewertung in Produktion anlegen.**

**Gegenprobe zum Plan-Gate:** `clear_founding_partner('<user-id>')`, dann
`schedule_communications('all')` erneut. Erwartet: `blocked = 1`, keine neue
Zeile in `email_queue`. Danach wieder `set_founding_partner`.

### 10 — Mail-Smoke (§44)

Mit `EMAIL_DELIVERY_MODE=test` prüfen, dass die Mail erzeugt wird; für den
echten Zustellweg an die eigene Zweitadresse senden lassen.

| | Prüfen |
|---|---|
| Zustellung | landet im Postfach, nicht im Spam (Gmail **und** Outlook, falls möglich) |
| Absender | korrekt, nicht `noreply@` aus einer Fremddomain |
| Reply-To | gesetzt und erreichbar |
| Links | führen auf die Produktionsdomain, kein `localhost`, kein Token in der Adresszeile |
| Mobil | lesbar auf dem Handy |

### 11 — Action Link und Aktion

Den Link aus der Mail auf dem Handy öffnen, ohne angemeldet zu sein.

Erwartet: Anmeldung, danach genau die Aufgabe aus der Mail — und der **richtige
Betrieb** ist ausgewählt (das ist der Fix aus Migration `20261013120000`; bei
mehreren Betrieben war der Wechsel vorher still gescheitert).

```sql
select id, title, selected_at from public.google_locations where user_id = '<user-id>';
```

Dann die Aktion ausführen (Antwort freigeben oder Angabe ändern) und prüfen,
dass sie bei Google ankommt.

---

## Ergebnistabelle

Zum Ausfüllen während des Durchlaufs. Jede Zeile bekommt eine der vier
Belegarten aus `docs/fremdkundenfaelle-a-g.md`.

| Schritt | Ergebnis | Belegart | Bemerkung |
|---|---|---|---|
| 1 Signup | | | |
| 2 Consent | | | |
| 3 free | | | |
| 4 Founding Partner | | | |
| 5 OAuth abgelehnt (F) | | | |
| 5 OAuth erteilt | | | |
| 6 Location (welcher Fall A–G?) | | | |
| 7 Sync + Engine | | | |
| 8 Dashboard | | | |
| 9 Weekly / Alert | | | |
| 9 Gegenprobe Plan-Gate | | | |
| 10 Mail | | | |
| 11 Action Link | | | |

---

## Wenn kein geeigneter Betrieb verfügbar ist

§59 erlaubt das ausdrücklich: bis zum technisch möglichen Punkt testen und den
Rest offen kennzeichnen. Ohne fremdes Google-Profil bleiben die Schritte 5–8
und 11 offen; 1–4 und 9–10 sind auch ohne Google durchführbar.

Nicht behaupten, etwas real getestet zu haben, wenn nur ein Mock lief.
