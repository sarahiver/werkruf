# Wochenstatus und Founding-Partner-Cockpit (WP6)

Zwei Dinge, die zusammengehören: Die Montagsmail sagt jede Woche
ehrlich, was WERKRUF geprüft hat und was passiert ist — und das
Cockpit im Admin zeigt, ob die Founding Partner davon etwas haben.

## 1. Montagsmail: „Alles geprüft" statt Stille

### Aufbau (feste Reihenfolge)

1. **Deine Google-Woche** (WP5, nur wenn Zahlen da sind)
2. **Was passiert ist** — neue Bewertungen, veröffentlichte Antworten,
   erledigte Aufgaben der letzten 7 Tage. Nur Zeilen mit Inhalt, keine
   Nullen. Fehlt alles: Block fehlt.
3. Kacheln (Bewertungen, offene Antworten, Profilwert)
4. Befund
5. **Aufgaben** (max. 3) **oder Wochenstatus** — nie keins von beidem
6. Profilwert

### Der Wochenstatus

Entscheidung in `src/utils/wochenstatus.js` → `leiteWochenstatusAb()`,
aus `weekly_check_facts()` (Datenbank) plus Aufgabenliste.

| Zustand | Wann | Was die Mail sagt |
|---|---|---|
| `connection_problem` | Google-Konto nicht `active` | „Google-Verbindung erneuern" — Headline „die Google-Verbindung braucht dich." Steht **vor** den Aufgaben |
| `data_incomplete` | letzter Abgleich > 72 h oder nie | „Daten nicht aktuell" — Headline „die Daten sind nicht aktuell." Steht vor den Aufgaben |
| `actions_open` (fällig) | Aufgaben in der Mail oder `dueCount > 0` | Aufgabenliste |
| `actions_open` (quiet) | offene, nicht fällige Aufgaben | „Nichts Neues diese Woche" |
| `ok_no_actions` | aktiv, Abgleich frisch, nichts offen | **„Alles geprüft ✓"** mit der Prüfliste |

Die Prüfliste (`GEPRUEFT`) nennt nur, was WERKRUF tatsächlich prüft:
Bewertungen und Antwortentwürfe · Pflichtangaben (Telefon, Website,
Adresse, Kategorie) · Öffnungszeiten · Fotos · Google-Verbindung und
Datenabgleich. Nichts darüber hinaus — keine „Beiträge", keine
„Mitbewerber".

Ohne `check` im Payload (Mail, die vor der Migration eingereiht wurde)
gibt es kein „Alles geprüft" — der Zustand fällt auf
`connection_problem` zurück, weil nicht geprüft werden konnte.

### Nebenbefund behoben

`assessWeek()` las `reviewsNew`, `repliesPublished`, `lowestNewRating`,
`newestReviewAt` aus dem Payload — die Produktions-Payload hat sie nie
gesetzt. Seit WP6 füllt `weekly_happened()` diese Felder; die Mail
sieht also zum ersten Mal „2 neue Bewertungen" statt immer 0.

## 2. Cockpit (Admin → Founding Partner)

Nur `app_metadata.role === 'admin'`, geprüft in `admin-ops`
(`pruefeAnfrage`, 401/403). Die Seite rendert das Cockpit nur nach
`isAdmin`; der Schutz ist aber die Function, nicht die Oberfläche.
Alle Zahlen kommen aus zwei RPCs, die nur `service_role` ausführen darf:
`fp_cockpit_overview()`, `fp_cockpit_detail(user_id)`.

### KPIs und ihre Definition

| KPI | Definition | Ehrlichkeitshinweis |
|---|---|---|
| Founding Partner | `user_profiles.plan = 'founding_partner'` | |
| Montagsmails zugestellt (28 T) | `email_queue.delivery_status = 'delivered'`, Vorlage `weekly_summary` | „—" ohne Webhook |
| Öffnungsrate (28 T) | zugestellt **und** `first_opened_at` gesetzt / zugestellt | Öffnung = Tracking-Pixel geladen. Apple Mail Privacy lädt vorab, Outlook blockt. **Nie „gelesen"** — immer „Öffnung erkannt" |
| ≥ 1 erledigte Aufgabe (7 T) | FPs mit `events.lifecycle = 'completed'` in 7 Tagen | `resolved` (Zustand verschwunden) zählt nicht |
| neue Google-Bewertungen (30 T) | `google_reviews`, alle Quellen | **QR-/Bewertungslink ist nicht messbar** — er führt direkt zu Google (`search.google.com/local/writereview`), ohne Zwischenseite. Die Zahl ist ein Ersatz, kein Beleg |
| Ja zu 49 € | `founding_partner_feedback.payment_intent = 'ja'` | manuell vom Admin eingetragen |

Je Partner zusätzlich: Verbindung, letzter Sync, letzte Montagsmail
(Zustellung, Öffnung erkannt n×), Action-Links (nur **bewusst
konsumiert** — `consumed_at`; ein Mail-Scanner, der den Link lädt, zählt
nicht), erledigte Aufgaben 7/30 T, Wochen aktiv (0–4), veröffentlichte
Antworten (nur `published`, kein Draft), letzte Anmeldung (Beginn der
Sitzung, nicht „letzter Besuch").

Detail (Klick auf die Zeile): dieselben Zahlen **je Betrieb**,
Konto-Aufgaben getrennt, letzte 4 Montagsmails, Feld „Zahlungsbereitschaft"
(unbekannt / Ja / eher ja / eher nein / Nein) mit Notiz. Speichern geht
über `set_fp_feedback` (Allowlist, Audit `admin.fp_feedback_gesetzt`);
die RPC lehnt Nicht-FPs ab (`kein_founding_partner`).

## 3. Brevo-Webhook einrichten (Zustellung und Öffnung)

Ohne Webhook zeigt das Cockpit „—" bei Zustellung/Öffnung und sagt
warum. Nichts behauptet 0 %.

**Secret setzen** (Supabase → Edge Functions → Secrets):

```
BREVO_WEBHOOK_SECRET=<zufällig, ≥ 32 Zeichen, z. B. openssl rand -hex 24>
```

Ohne Secret antwortet die Route 503 und speichert nichts.

**Webhook in Brevo** (Transactional → Settings → Webhooks → Add):

```
URL:     https://<project-ref>.supabase.co/functions/v1/send-email/brevo-webhook?secret=<BREVO_WEBHOOK_SECRET>
Events:  Delivered, Opened (unique), Clicked, Hard bounce, Soft bounce, Blocked, Spam
```

Nicht nötig: Sent/Request, Deferred, Unsubscribed. „Opened" statt
„First opening" ist auch möglich — Mehrfach-Opens werden gezählt
(`open_count`), ohne die Mail doppelt zu zählen.

Alternativ zum Query-Parameter: Header `X-Werkruf-Webhook-Secret`.

**Was gespeichert wird** (`communication_delivery_events`): Message-ID,
Ereignisart, Zeitpunkt, Zuordnung zur Mail. **Nicht**: IP, User-Agent,
Empfängeradresse, Link, Inhalt. Zuordnung ausschließlich über
`email_queue.provider_id` = Brevo-`messageId` aus der Versandantwort;
unbekannte IDs werden gezählt und verworfen.

Idempotent über `(provider_message_id, event, event_at)`: Brevo-Retries
erzeugen `duplicate`, keine zweite Zeile.

**Prüfen:** Nach einer Montagsmail in Brevo → Logs → die Mail → Events;
dann `select delivery_status, first_opened_at, open_count from
email_queue where template = 'weekly_summary' order by created_at desc
limit 5;`. Function-Logs zeigen `brevo_webhook` mit Zählern
(`recorded`, `duplicate`, `unknown_message`, `ignored`, `failed`).

## 4. Deploy-Reihenfolge

1. Migration `20261109140000_wochenstatus_fp_cockpit.sql`
   (Actions → Apply Supabase migrations). Selbstprüfung am Ende:
   `NOTICE [wp6] in Ordnung`.
2. Functions `send-email` und `admin-ops` deployen.
3. Frontend (Vercel) — Admin-Seite mit Cockpit.
4. `BREVO_WEBHOOK_SECRET` setzen, Webhook in Brevo anlegen (Abschnitt 3).
5. Smoke: Admin öffnen → Cockpit lädt, Partnerzeile aufklappen,
   Zahlungsbereitschaft setzen → `audit_logs` hat `admin.fp_feedback_gesetzt`.
   Als normaler Nutzer: `/admin` leer, `admin-ops` mit `fp_cockpit_overview`
   → 403. Nach der nächsten Montagsmail: Wochenstatus-Block sichtbar,
   Zustellereignis im Cockpit.

Reihenfolge ist wichtig: `send-email` ohne Migration würde
`weekly_happened` nicht finden — die Function toleriert fehlende
`happened`/`check` im Payload, aber die neue Mail-Logik kommt erst mit
beidem zusammen.

## 5. Was WP6 bewusst nicht tut

- Kein Lesebeweis: „Öffnung erkannt" ist technisch, kein Verhalten.
- Kein Klick-Tracking auf dem Bewertungslink — der geht direkt zu
  Google. Eine Zwischenseite wäre messbar, kostet aber jeden
  Kunden einen Klick mehr; nicht Teil von WP6.
- Kein Aufgaben-Zwang: „Alles geprüft" ist eine Mail ohne CTA-Druck,
  mit einem Knopf „Dashboard öffnen".
- Keine automatische FP-Aufnahme, kein Plan-/Stripe-Eingriff aus dem Cockpit.

## Tests

```
CI=true npx react-scripts test --watchAll=false src/wochenstatus.test.js src/zustellEreignisse.test.js src/fpCockpit.test.js
bash scripts/test-db/run.sh wochenstatusFpCockpit
```

Gegenproben (jeweils rot, wenn man es kaputt macht): C1 Verbindungs-
status ignorieren → T2/T9 rot · C2 Statusblock ohne Aufgaben entfernen →
C2 rot · C3 Rate gegen gesendet statt zugestellt → T18 rot · C4 Unique
auf Ereignissen aufweichen → T31 rot · C5 `authenticated` darf Cockpit →
Migration verweigert sich · C6 Draft-Antworten zählen → C6 rot · C7
Nicht-FP im Cockpit → T16 rot · C8 Kunde setzt eigenen 49-€-Status →
Migration verweigert sich.
