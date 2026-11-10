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

## Links, Scanner-Schutz (Stand WP16-Fix1)

**Warum Fix1:** Das Supabase-Gateway liefert HTML-Antworten von Edge Functions auf `*.supabase.co` als `text/plain` mit `Content-Security-Policy: default-src 'none'; sandbox` aus. Seiten aus Functions rendern deshalb nicht mehr — das traf `/founding-partner/<token>` (WP16) **und** die Aufgaben-Links `/a/<token>` der Wochenmails. Seit Fix1 rendert das Frontend die Seiten; die Function liefert nur noch JSON und Redirects.

| Browser-URL (werkruf.com) | Wer rendert | Function-Aufruf | Wirkung |
|---|---|---|---|
| `GET /p/fp/<token>` | Vercel-Rewrite → Function | `GET …/p/fp/<token>` | `presentation_clicked` in die Historie, `302` auf die PDF. **Kein** Status. |
| `GET /founding-partner/<token>` | **React** (`FoundingPartnerInteresse.js`) | `GET …/fp/<token>/info` → JSON `{valid}` | `cta_viewed` (nur Historie). **Kein** Status. |
| Button „Ja, Interesse" | `<form method="POST">` direkt an die Function | `POST …/fp/<token>/interesse` | `cta_clicked` (einmal je Nachricht) + Status → `interesse` (nur aufwärts); Antwort `302 → /founding-partner/<token>?danke=1` |
| `GET /a/<token>` | **React** (`ActionLink.js`) | `GET …/a/<token>/info` → JSON `{valid,title,businessName,effort,done}` | zeigt nur an; prüft Rate-Limit und Token, verbraucht nichts |
| Button „Weiter zu WERKRUF" | `<form method="POST">` an die Function | `POST …/a/<token>/continue` | wie bisher: opened, Betrieb umstellen, Magic-Link, `302`; Abweisung = `302 → /a/<token>?status=ungueltig\|erledigt` |
| alte Mail-Links direkt auf `…supabase.co/…/a/<token>` bzw. `…/fp/<token>` | Function | `GET` | `302` ins Frontend (`werkruf.com/a/<token>` bzw. `/founding-partner/<token>`), Token bleibt im Pfad, nichts geprüft oder verbraucht |
| `GET …/interesse`, `GET …/continue` | Function | | `405` — ein Scanner folgt Links, schickt aber kein Formular ab |

Neue Wochenmail-Links zeigen auf `https://werkruf.com/a/<token>` (`send-email`, `ACTION_LINK_BASIS` = `APP_URL`, Default `https://www.werkruf.com`).

Frontend-Regeln (`src/utils/tokenSeite.js`): Token nur aus der URL, kein localStorage, kein Log, kein Analytics; `robots noindex,nofollow`, `referrer no-referrer`; Fehler neutral („Dieser Link ist nicht mehr gültig.") ohne Unterscheidung von unbekannt/abgelaufen/widerrufen/fremd; Netzwerkfehler getrennt („Die Seite konnte gerade nicht geladen werden…").

Token: opaque, nicht erratbar, gebunden an die Nachricht, keine PII im Pfad; in der DB nur der SHA-256. Unbekannt/ungültig → `404` (Info) bzw. Redirect mit `status=ungueltig`. Kein TTL für den Präsentationslink; Widerruf = Zeile löschen. Vercel-Rewrites nur noch für `/b/*` und `/p/fp/*` — `/a/*` und `/founding-partner/*` rendert die SPA.

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
- Fix1: `src/tokenSeiten.test.js` (16: Action Page, Founding Partner, alte Links, Mail-Links, Architektur), `src/utils/actionScanner.test.js` auf die Frontend-Seite umgestellt; Gegenproben Fix1 C1–C7 rot → grün.

---

# Lead-Import + Lead-Inbox + Admin-Bereiche (WP16.1)

## Admin-Bereiche

`/admin` ist keine lange Seite mehr. Fünf Bereiche, immer genau einer sichtbar, adressierbar über `?bereich=` (Reload und Deep Link funktionieren, unbekannter Wert → Übersicht):

| URL | Inhalt | lädt |
|---|---|---|
| `/admin` | Übersicht: Kennzahlen, Handlungsbedarf | Kundenliste (50), Setup-Leads, offene Anfragen, Akquise-KPI (`acquisition_list` limit 1) |
| `/admin?bereich=akquise` | Akquise: Lead anlegen, CSV importieren, Liste, Detail, Vorschau/Senden | `acquisition_list` |
| `/admin?bereich=kunden` | Direkter Draht, Kunde finden, Support-Ansicht | `list_customers`, `list_support_requests` |
| `/admin?bereich=founding-partner` | FP-Cockpit (unverändert) | `fp_cockpit_overview` |
| `/admin?bereich=setup` | offene Setup-Aufträge aus dem SmartCheck | `leads` |

Die Navigation ist eine Link-Liste (`aria-current="page"`, Tastatur, Mittelklick). Zurück/Vor im Browser wechselt den Bereich.

## Ein Importpfad

```
CSV im Admin ─┐
              ├─ bereiteImportVor()  (Lead-Kanon pruefeLeadEingabe, serverseitig)
Inbox (API) ──┘     └─ acquisition_import_rows(mode, channel, source, import_id, rows)
```

`acquisition_import_rows` (nur `service_role`) entscheidet je Zeile:

| Status | Bedeutung | wird angelegt |
|---|---|---|
| `new` | neu | ja (nur bei `commit`) |
| `duplicate` | E-Mail existiert schon (Groß/Klein, Leerzeichen egal; gelöschte Leads zählen nicht) | nein, `leadId` = bestehender Lead |
| `duplicate_in_import` | gleiche E-Mail weiter oben in derselben Datei | nein |
| `possible_duplicate` | gleiche Website (Host ohne `www`/Protokoll/Pfad) oder gleiches Google-Profil wie ein bestehender Lead | nein — bei Bedarf einzeln über „Lead anlegen" |
| `invalid` | Pflichtfeld fehlt, E-Mail/URL ungültig, Text zu lang | nein |

Bei geteilten Plattformen (facebook.com, instagram.com, google.com, g.page, business.site, jimdo, wix, linktr.ee, gelbeseiten.de, myhammer.de, xing.com, linkedin.com …) zählt die volle Adresse inkl. Pfad, nicht nur der Host.

Regeln:
- **Nur neue Leads.** Bestehende Leads werden nie geändert, kein Upsert.
- Angelegt mit `status='new'`, `acquisition_status='neu'`, `source='akquise_import'` (CSV) bzw. `'akquise_inbox'`, `acquisition_import_id`, `acquisition_source` (Spalte `source` der Liste, sonst `csv` bzw. die Inbox-Quelle).
- **Kein Versand, kein Status außer „neu", kein Founding Partner.** Angeschrieben wird weiter einzeln über Vorschau → Senden.
- **Idempotent:** dieselbe Import-ID (je Kanal + Quelle) ein zweites Mal → `reused: true`, gespeichertes Ergebnis, nichts doppelt.
- Commits laufen nacheinander (Advisory-Lock), damit zwei gleichzeitige Importe dieselbe Mail nicht beide als neu anlegen.
- Höchstens 1000 Zeilen je Import. Gespeichert wird nur die Batch-Zeile mit Zählern (`acquisition_imports`), nie die CSV.

## CSV

Kopfzeile (Vorlage im Import-Dialog herunterladbar):

```
company_name,contact_person,email,phone,trade,city,website,google_profile_url,personalized_sentence,note,source,import_status,imported_at,werkruf_lead_id
```

Pflicht: `company_name`, `email`. `import_status`, `imported_at`, `werkruf_lead_id` werden gelesen und ignoriert (Arbeitsspalten der externen Liste). Unbekannte Spalten werden angezeigt und ignoriert. Komma oder Semikolon, UTF-8 (BOM ok), Anführungszeichen mit Komma/Zeilenumbruch darin ok, höchstens 2 MB.

Ablauf: Datei wählen → **Vorschau** (nichts gespeichert; Zusammenfassung, Reiter Alle | Neu | Dubletten | Prüfen | Fehler, Problemzeilen zuerst) → „N Leads importieren" → Ergebnis → „Neue Leads anzeigen" (Liste gefiltert auf diesen Import).

## Externe Lead-Inbox

```
POST https://<projekt>.supabase.co/functions/v1/admin-ops/acquisition-inbox
X-Werkruf-Import-Secret: <ACQUISITION_IMPORT_SECRET>
Content-Type: application/json

{
  "source": "chatgpt_recherche",            // a-z 0-9 _ -, 2–40
  "externalImportId": "recherche-2026-11-10", // 4–120, je Lauf eindeutig (Idempotenz)
  "mode": "commit",                          // optional, "preview" prüft nur
  "rows": [
    { "company_name": "Elektro Krause GmbH", "email": "info@elektro-krause.de",
      "city": "Kiel", "website": "https://elektro-krause.de",
      "personalized_sentence": "…" }
  ]
}
```

Antwort (200):

```json
{ "ok": true, "mode": "commit", "reused": false, "importId": "<uuid>",
  "counts": { "rows": 1, "new": 1, "duplicate": 0, "duplicateInImport": 0, "possibleDuplicate": 0, "invalid": 0 },
  "rows": [ { "i": 1, "status": "new", "grund": null, "leadId": "<uuid>", "companyName": "Elektro Krause GmbH", "email": "info@elektro-krause.de" } ] }
```

`rows[].status` und `rows[].leadId` gehören in `import_status` / `werkruf_lead_id` der externen Liste. Fehler: 503 Secret nicht gesetzt (oder kürzer als 16 Zeichen) — die Inbox ist dann aus, nie offen; 401 Secret fehlt/falsch; 400 Payload ungültig; 500 „Import fehlgeschlagen" (Details nur im Function-Log). Jeder Commit steht im Audit (`system.acquisition_inbox_import`, ohne Zeileninhalte). Das Secret wird nie geloggt.

Einrichtung: Supabase → Edge Functions → Secrets → `ACQUISITION_IMPORT_SECRET` = langer Zufallswert (mind. 32 Zeichen empfohlen). Nur an das aufrufende System geben.
