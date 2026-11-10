# Admin Akquise + Brevo-Tracking (WP16)

Manuelle Founding-Partner-Akquise aus dem bestehenden Admin (`/admin`, Abschnitt **Akquise**).

```
Lead manuell anlegen → personalisieren → Mail-Vorschau → bewusst EINZELN senden
→ Brevo-Zustell-/Öffnungs-/Klickereignisse sehen → Vertriebsstatus manuell pflegen
→ Antwort/Interesse manuell markieren → später Founding Partner über die bestehende Admin-Aktion
```

Kein autonomer Vertrieb, kein Scraping, kein Bulk, kein Follow-up, keine KI, kein CRM, kein Postfach-Zugriff.

## Datenmodell

**`public.leads`** (Baseline, erweitert — `leads.status` unangetastet, SmartCheck/`claim_own_lead()`/Kontolöschung laufen weiter):

| neu | Bedeutung |
|---|---|
| `website`, `google_profile_url` | Stammdaten (http(s)-URL) |
| `personalized_sentence` | von Hand geschriebener Satz für die Mail (≤ 600) |
| `acquisition_status` | **Vertriebsstatus** `neu\|vorbereitet\|angeschrieben\|interesse\|kein_interesse\|founding_partner\|zurueckgestellt`; `NULL` = nicht in der Akquise |
| `acquisition_note`, `acquisition_status_changed_at`, `last_outreach_at`, `updated_at` | |

Akquise-Leads haben `source = 'admin_akquise'`, `status = 'new'`. Registriert sich der Betrieb später mit derselben E-Mail, greift `claim_own_lead()` wie bisher (`status → converted`); der Vertriebsstatus bleibt eigenständig. Das Admin-Detail zeigt den `leadStatus` mit an.

**`outreach_messages`** — ein Datensatz je bewusstem Einzelversand: `lead_id`, `subject`, `personalized_sentence_snapshot`, `to_email_snapshot`, `delivery_mode (production|test)`, `status (queued|sent|failed)`, `email_queue_id` (→ `email_queue`, on delete set null), `provider_message_id` (Brevo-Message-ID, Kopie beim Versand), `link_token_hash` (SHA-256 des opaken Link-Tokens), `idempotency_key`, `created_by`, `sent_at`, `failed_at`, `error_code`.

**`outreach_email_events`** — append-only Historie je Nachricht: `provider (brevo|werkruf)`, `event_type`, `fingerprint`, `occurred_at`. Ereignisarten: `sent delivered first_open opened clicked soft_bounce hard_bounce blocked spam unsubscribed error presentation_clicked cta_viewed cta_clicked`. Keine IP, kein User-Agent, keine Adresse, kein Roh-Payload. Überlebt das 90-Tage-Pruning der `email_queue`.

## Vertriebsstatus vs. Mail-Ereignis

Zwei Welten, strikt getrennt:

- **Mail-Ereignisse** sind technische Historie. **Nichts** in Migration, Trigger oder Edge Function setzt `acquisition_status` aus einem Brevo-Ereignis (die Migration prüft das im Selbstcheck: `[wp16] Brevo-Trigger beruehrt Vertriebsstatus`).
- **Vertriebsstatus** wird manuell gesetzt (Admin, jeder Wert erlaubt, auditiert). Zwei fachliche Automatiken, beide nur aufwärts:
  - Versand: `NULL/neu/vorbereitet → angeschrieben`
  - CTA-POST „Ja, Interesse": `NULL/neu/vorbereitet/angeschrieben/zurueckgestellt → interesse`. Niemals aus `interesse`, `kein_interesse` oder `founding_partner` heraus.
- Ein verspätetes `opened`/`delivered`/`clicked` kann `founding_partner` oder `interesse` nicht verändern (getestet T39–T44).
- `opened`, `clicked`, `delivered` sind **keine** Statuswerte (Check-Constraint).

## Mailvorlage

Produktvorgabe (Betreff `Darf ich {BETRIEB} als WERKRUF Founding Partner einladen?`, Text siehe `fpMailAbsaetze` in `src/utils/akquise.js`). Absätze sind Daten; Plaintext und HTML werden daraus gebaut und tragen denselben Inhalt. Lead-Felder und der personalisierte Satz werden HTML-escaped; Links sind serverseitig erzeugte Token-Links, nie Lead-Eingabe.

Eine Abweichung von der Vorgabe, bewusst: „In der **angehängten** Kurz-Präsentation…" wurde zu „In der Kurz-Präsentation siehst du auf 1 Blick…" + Link, weil die Präsentation per **Link** gemessen wird (§18) und WP16 kein Attachment anhängt. Keine neuen Claims ergänzt.

Absender: bestehender WERKRUF-Absender `WERKRUF <info@werkruf.com>` (send-email `BRANDS.handwerk`). Vorlage `founding_partner_outreach` (Check-Constraint `email_queue_template_check`, TS-Union, `render()`-Fall — Paritätstest `mailVorlagenParitaet.test.js`).

## Preview / Send

admin-ops-Aktionen (Allowlist in `src/utils/adminOps.js`, Admin-JWT `app_metadata.role=admin`):

| Aktion | schreibt | Parameter | Audit |
|---|---|---|---|
| `acquisition_list` | nein | status, suche, limit | — |
| `acquisition_lead_detail` | nein | leadId | — |
| `acquisition_preview` | nein | leadId | — |
| `acquisition_lead_create` | ja | lead | `admin.acquisition_lead_created` |
| `acquisition_lead_update` | ja | leadId, lead | `admin.acquisition_lead_updated` |
| `acquisition_set_status` | ja | leadId, status, note | `admin.acquisition_status_changed` |
| `acquisition_send` | ja (Bestätigung) | leadId, idempotencyKey | `admin.acquisition_email_sent` |

Versand (`akquiseSenden`): Lead aus der DB laden → Token (32 Zufallsbytes, base64url) → Links → `acquisition_outreach_begin` (Idempotenz-Key → dieselbe Nachricht; Sperre; höchstens eine `queued` je Lead; Rate-Schutz 20/h; `enqueue_email` mit **Adresse aus der Lead-Zeile**, `user_id = null`) → Audit **ohne Token**. Der Worker (`send-email`, pg_cron) rendert und sendet; `finish_email` setzt `sent`/`failed`, der Trigger `outreach_sync_from_queue` überträgt das in `outreach_messages` + Historie.

UI: kein One-Click aus der Liste. Lead öffnen → „Mail-Vorschau" (Empfänger, Absender, Betreff, Text, Satz, Präsentationslink, CTA) → „Mail senden" → „Ja, jetzt an … senden". Knopf während des Requests gesperrt; der Idempotenz-Key entsteht beim Öffnen der Vorschau.

## Brevo-Korrelation und Webhook

Unverändert WP6: `POST send-email/brevo-webhook?secret=…` → `normalisierePayload` → `record_delivery_event(messageId, event, at)` → `communication_delivery_events` (unique `provider_message_id, event, event_at` = idempotent, unbekannte Message-ID ignoriert, Payload nicht geloggt). Korrelation **nur** über `email_queue.provider_id` = Brevo `messageId` aus der Versandantwort — nie über die Adresse.

Neu: Trigger `outreach_copy_delivery_event` kopiert Ereignisse von Vorlage `founding_partner_outreach` in `outreach_email_events` (`opened` → beim ersten Mal `first_open`, danach `opened`; `sent` kommt aus dem Queue-Trigger). Produktmails werden nicht berührt (Trigger-`WHEN`). `unsubscribed` wird jetzt normalisiert und gespeichert (für Produktmails nur Historie, `delivery_status` unberührt).

Brevo-Einstellung: Öffnungs- und Klick-Tracking für transaktionale Mails muss im Brevo-Konto aktiv sein (wie für WP6). Kein neuer Webhook, kein neuer Endpoint.

## Open-Tracking — Einschränkung

„Öffnung erkannt" = ein geladenes Tracking-Pixel. Apple Mail Privacy, Proxys und Scanner erzeugen Opens ohne Menschen. Deshalb: `first_open` = erster erkannter Zeitpunkt; weitere Opens ergänzen nur die Historie; KPI „Öffnung erkannt" zählt **Leads mit ≥ 1 Open**, nicht Opens. Nie „gelesen".

## Links, Scanner-Schutz

| URL (werkruf.com) | Function | Wirkung |
|---|---|---|
| `GET /p/fp/<token>` | `google-business/p/fp/<token>` | `presentation_clicked` in die Historie, `302` auf die PDF. **Kein** Status. |
| `GET /founding-partner/<token>` | `google-business/fp/<token>` | Seite „Interesse? [Ja, Interesse]", `cta_viewed`. **Kein** Status. |
| `POST /founding-partner/<token>/interesse` | `google-business/fp/<token>/interesse` | `cta_clicked` (einmal je Nachricht) + Status → `interesse` (nur aufwärts). |
| `GET …/interesse` | | `405` — ein Scanner folgt Links, schickt aber kein Formular ab. |

Token: opaque, nicht erratbar, gebunden an die Nachricht, keine PII im Pfad; in der DB nur der SHA-256. Unbekannt/ungültig → `404`, ohne Unterscheidung. Kein TTL (die Präsentation darf lange klickbar bleiben); Widerruf = Zeile löschen. Vercel-Rewrites in `vercel.json`.

**Präsentation:** `WERKRUF_Founding_Partner_Praesentation_v2.pdf` liegt **nicht** im Repo. Ablage: `public/downloads/WERKRUF_Founding_Partner_Praesentation_v2.pdf` (Vercel liefert sie unter `https://werkruf.com/downloads/…`). Abweichender Ort → Secret `FP_PRESENTATION_URL` in `google-business`. Bis die Datei liegt, endet der Link in 404 — das Ereignis wird trotzdem gezählt.

## Hard Bounce / Suppression

Sperre ist **abgeleitet** (`acquisition_block_reason(lead)`): existiert für irgendeine Nachricht des Leads ein Ereignis `hard_bounce`, `blocked`, `spam` oder `unsubscribed`, ist der Lead gesperrt. Server lehnt `acquisition_outreach_begin` mit `gesperrt` ab; UI zeigt „Lead ist für weiteren Mailversand gesperrt: …" und keinen Sendeknopf. Kein Status wird dafür mutiert, nichts muss zurückgesetzt werden. `soft_bounce`/`failed` sperren nicht — manueller Neuversand möglich; die Queue wiederholt technische Fehler wie bisher (3 Versuche), endgültige (`brevo_400`) nicht.

Abmeldung: Die Vorlage enthält keinen Abmeldelink (Brevo bietet für transaktionale Mails keinen automatischen). Technisch umgesetzt ist: `unsubscribed`-Ereignis → Lead gesperrt → keine erneute Mail aus dem Admin. Das ist eine technische Beschreibung, keine Rechtsberatung.

## Testmodus

`EMAIL_DELIVERY_MODE=test` + `EMAIL_TEST_RECIPIENT` wirken im Worker für **alle** Vorlagen, also auch hier. admin-ops liest denselben Modus: Band „Testmodus" oben, Vorschau nennt den Testempfänger, Bestätigungsknopf sagt „an den Testempfänger senden", Nachricht trägt `delivery_mode = 'test'`, Liste zeigt „(Test)". Der Lead bleibt fachlich Lead, Korrelation und Ereignisse sind testbar.

## Security / RLS

- Akquise ist Admin-only: Lesen/Schreiben nur über `admin-ops` (Admin-JWT serverseitig geprüft, Parameter-Whitelist, Audit). Keine neuen Client-RPCs, keine Client-Writes; `outreach_*`-Tabellen ohne Rechte für `anon`/`authenticated`, RLS an ohne Policy. Alle `acquisition_*`-Funktionen nur `service_role` (Selbstcheck in der Migration).
- `leads`: bestehende Policy `Admins can read leads` bleibt; der Browser liest `leads` im Admin weiterhin nur für Setup-Aufträge, Akquise-Daten kommen aus `acquisition_overview()`.
- IDOR: Client schickt `leadId`; Adresse, Betrieb, Satz kommen aus der DB. `provider_message_id`, Zähler und IDs sind nicht editierbar (`acquisition_lead_update` liest nur fachliche Schlüssel).
- HTML-Escaping serverseitig; Links serverseitig; Token nie im Audit/Log.

## Manueller Smoke (nach Merge/Deploy, nur mit eigener E-Mail)

1. `EMAIL_DELIVERY_MODE=test`, `EMAIL_TEST_RECIPIENT=<eigene Adresse>` (Supabase Secrets) · `send-email`, `admin-ops`, `google-business` deployen · Vercel-Deploy
2. Admin → Akquise → „Lead anlegen" (eigene E-Mail), Satz eintragen
3. „Mail-Vorschau": Empfänger, Betreff, Satz, Links; Band „Testmodus"
4. „Mail senden" → „Ja, jetzt an den Testempfänger senden" → „Testversand eingereiht"
5. Worker-Lauf abwarten (Cron) → Historie „Gesendet", Liste „letzter Versand"
6. Brevo-Webhook liefert `delivered` → „Zugestellt"; Mail öffnen → „Öffnung erkannt"
7. Präsentationslink klicken → „Präsentation geklickt" (PDF, sobald abgelegt)
8. CTA-Seite öffnen (GET) → Status bleibt `angeschrieben`
9. „Ja, Interesse" klicken → Status `interesse`, Historie „Interesse bestätigt"
10. Mail erneut öffnen → Status bleibt `interesse`
11. Bounce-Pfad: nur per Test (`akquise.test.sql` Block F) — keine echte Bounce-Adresse anschreiben
12. Testmodus erst nach Abnahme entfernen

Prüfen in SQL: `select company_name, acquisition_status, last_outreach_at from leads where acquisition_status is not null;` · `select * from outreach_email_events order by occurred_at;`

## Tests

- `src/akquise.test.js` (31): Modul, Allowlist, admin-ops/send-email/google-business/vercel (Quelltext), Migration (Trennung/Sperre), UI (Vorschau → Bestätigung → ein Versand, Testmodus, Sperre, Historie, Anlegen).
- `supabase/tests/akquise.test.sql`: T1–T4 Lead-Kanon (SmartCheck, claim_own_lead, Statuswerte, Löschung), Rechte mit RLS-Wirkung, Lead-CRUD, Versand/Idempotenz/Race, Queue-Sync, Brevo-Ereignisse (first_open, Duplikat, unbekannt, Sperren, Status unberührt, founding_partner/interesse stabil), Link-Ereignisse (GET ≠ Interesse, POST idempotent, Scanner), Übersicht/KPI/Detail, WP6-Regression, Rate-Schutz, Löschkaskaden.
- Gegenproben C1–C12 jeweils rot → wiederhergestellt → grün.
