# SMS-Bewertungsanfrage (WP14)

Ein Betrieb schickt nach einem echten Kundenkontakt **manuell eine
einzelne** Bewertungsanfrage per SMS: Vorname + Mobilnummer + Betrieb →
Nachricht prüfen → senden. Kein Autopilot, kein CRM, keine Listen,
keine Serien, kein Bulk, kein WhatsApp.

## Provider — Brevo Transactional SMS

Wiederverwendet: dasselbe Brevo-Konto wie für E-Mail (`BREVO_API_KEY`,
`BREVO_WEBHOOK_SECRET`, bestehender AVV, EU-Anbieter). Kein zweiter
Provider, kein neues Konto.

- Endpoint: `POST https://api.brevo.com/v3/transactionalSMS/send`
  (das ältere `/transactionalSMS/sms` ist laut Brevo-Changelog
  deprecated).
- Body: `sender: "WERKRUF"` (alphanumerisch ≤ 11 Zeichen), `recipient`
  (E.164 ohne „+“), `content`, `type: "transactional"`,
  `tag: "review_request"`, `webUrl` (Delivery-Callback je Nachricht).
- Antwort: `{ messageId }` → `provider_message_id`.
- **Kosten:** Brevo rechnet SMS in Credits je Zielland ab. Der Preis
  pro SMS nach Deutschland steht im Brevo-Konto (SMS-Credits) und wird
  hier nicht geschätzt. Eine Anfrage sind in der Regel **1–2 Segmente**
  (GSM-7; der Google-Link ist ~80 Zeichen). Im Produkt gibt es keine
  Pakete/Abrechnung — Pro-Feature mit interner Fair-Use-Grenze.

## Secrets (nur serverseitig, Supabase Edge Function Secrets)

| Secret | Pflicht | Zweck |
|---|---|---|
| `BREVO_API_KEY` | ja (vorhanden) | Versand |
| `SMS_WEBHOOK_SECRET` | ja (WP14.2) | Delivery-Webhook-Prüfung und `webUrl` je SMS. Fehlt es, geht die SMS trotzdem raus, aber ohne Delivery-Callback (Status bleibt `sent`). |
| `SMS_PHONE_PEPPER` | empfohlen | eigener HMAC-Pepper für `phone_hash`; übergangsweise Fallback auf `SMS_WEBHOOK_SECRET`. **Nie** `BREVO_WEBHOOK_SECRET` (WP14.2: SMS ist vom Mail-Webhook-Secret entkoppelt). |
| `SMS_DELIVERY_MODE` | optional | `production` (Default) oder `test` |
| `SMS_TEST_RECIPIENT` | bei `test` | E.164-Nummer, an die im Testmodus **jede** SMS geht |

Nichts davon im Frontend; kein `REACT_APP_*`.

## Datenminimierung

Tabelle `review_sms_requests`: `user_id`, `location_id`, **`phone_hash`**
(HMAC-SHA256 der E.164-Nummer), `provider`, `provider_message_id`,
`status`, `segment_count`, `error_code`, Zeitstempel. **Keine
Telefonnummer, kein Name** — die Selbstprüfung der Migration bricht ab,
wenn eine Klartext-Spalte auftaucht. Audit (`review_request.sms_sent/
sms_failed`) trägt nur `locationId`, `providerMessageId`, `status`,
`segments`/`errorCode`. Logs enthalten weder Nummer noch Payload; die
Brevo-Fehlertexte werden nicht ungefiltert geloggt (können die Nummer
enthalten). Der Webhook-Payload (enthält `to`) wird nur auf
`messageId`/`event` gelesen.

Löschung: `user_id → auth.users ON DELETE CASCADE` (keine Waisen),
`location_id → google_locations ON DELETE SET NULL`.

## Mobilnummer (serverseitig, `src/utils/mobilnummer.js`)

Akzeptiert `0171…`, `+49 171…`, `+49 (0)171…`, `0049171…`, mit
Leerzeichen/Klammern/Bindestrich/Schrägstrich. Ergebnis E.164 `+49…`.
Abgelehnt: Festnetz (nicht 015/016/017), ausländische Nummern (nur
`+49` — Mobil/Festnetz wäre sonst nicht zuverlässig unterscheidbar),
Nummern ohne führende 0, falsche Länge (nationale Nummer 10–11
Ziffern), Buchstaben. Der Client nutzt dieselbe Funktion nur für die
frühe Rückmeldung; die Wahrheit ist der Server.

## Bewertungslink — ein Generator

`src/utils/bewertungslink.js`: `https://search.google.com/local/writereview?placeid=<place_id>`
aus `google_locations.place_id`. Client (Link, QR) und der Redirect der
Edge Function nutzen dieselbe Funktion. Ohne `place_id`: kein Versand, UI
„Für diesen Betrieb ist noch kein Bewertungslink verfügbar.“

## Kurzer Link `werkruf.com/b/<code>` (WP14.2)

**Zweck: SMS-Länge, nicht Tracking.** Der Google-Link (~80 Zeichen) drückte
typische Anfragen ins zweite GSM-7-Segment; der kurze Link (7 Zeichen,
`[A-Za-z0-9]`, opak, nicht sequenziell, nicht aus IDs ableitbar) hält sie
in einem. Beispiel Maximilian / Elektrotechnik Müller GmbH: alt 2 Segmente
→ neu 1. Sehr lange Betriebsnamen können weiterhin 2 ergeben — das UI
zeigt die echte Zahl, keine „immer 1 SMS“-Behauptung.

- Tabelle `review_short_links(location_id, code unique, active, created_at,
  revoked_at)`: **ein aktiver, stabiler Code je Standort**, nicht je SMS.
  Speichert **nur** `location_id` — keine URL, keine `place_id`; die
  Selbstprüfung bricht sonst ab. `ON DELETE CASCADE` zum Standort.
- Erzeugung nur serverseitig beim Versand/Preview: `requireUser →
  requirePaidAccess → loadOwnLocation → ensure_review_short_link(user,
  location)` (prüft Besitz erneut). Preview und Versand nutzen exakt
  denselben Code — eine Wahrheit.
- Redirect: `GET /b/<code>` → `review_short_link_place_id(code)` (nur bei
  aktivem Code, nicht gelöschtem Standort, vorhandener `place_id`) →
  `bewertungsLink(place_id)` → **302**. Sonst **404 ohne Inhalt**: keine
  IDs, kein Name, keine `place_id` in einer Antwort. Kein DB-Write pro
  Klick, kein Klick-Tracking. Header `no-store`, `no-referrer`, `noindex`.
- Hosting: `vercel.json` schreibt `werkruf.com/b/:code` per Rewrite auf die
  Edge Function `google-business/b/:code` um (Proxy; der 302 wird
  durchgereicht, die App lädt nicht). SPA-Fallback `/(.*) → /index.html`
  bleibt explizit erhalten.
- Fachlich getrennt von WP10 (`/empfehlen/<code>`, `referral_codes`).
- **QR-Code unverändert**: nutzt weiterhin den direkten Google-Link.
  Umstellung wäre möglich (gleicher Redirect), ist aber kein Teil von
  WP14.2 — ein gedruckter QR ist langlebig; ein Shortlink-QR hinge an
  der Verfügbarkeit von werkruf.com.

## Vorlage (fest, nicht editierbar) — neutral seit WP14.2

> Hallo {Vorname}, danke für deinen Auftrag bei {Betrieb}. Teile gern
> deine Erfahrung bei Google: https://werkruf.com/b/{code}

Vorher stand „Wenn du zufrieden warst, …“ — das selektiert implizit
zufriedene Kunden und widerspricht „kein Gating, gleicher Weg für alle“.
Die Vorlage ist jetzt neutral; gewählt wurde die kürzere der beiden
Varianten, weil sie typische Anfragen sicher in einem Segment hält.

Vorname (1–40 Zeichen, nur Buchstaben) vom Betrieb, Betriebsname aus
`google_locations.title`, Code aus `review_short_links` — alles vom
Server. **Kein Incentive, keine Sternevorgabe, kein Gating in beide
Richtungen.** `textErlaubt()` prüft gegen: „5 Sterne“/„bei 5 Sternen“;
„unzufrieden“/„nicht zufrieden“; **positive Selektion** („wenn du/Sie
zufrieden“, „wenn alles gepasst/gut war“, „wenn du/Sie uns empfehlen“,
„positive/gute Bewertung“); Gutschein/Rabatt/Bonus/Prämie; „antworte
erst uns“. Der Server verweigert sonst.

Segmente: GSM-7 (inkl. Umlaute/ß) 160 bzw. 153 je Teil, UCS-2 70/67.
Das UI zeigt „1 SMS“ / „2 SMS-Segmente“ aus der Server-Vorschau.

## Access

Pro und Founding Partner: ja. Free: Seite hinter ProGate, Server
`requirePaidAccess` (402) **und** `review_sms_pruefen` prüft
`has_paid_access` erneut (`kein_zugang`). `locationId` muss dem Nutzer
gehören (`loadOwnLocation` inkl. Kontoprüfung; `review_sms_anlegen`
prüft erneut) — fremd → 404.

## Rate-Limit und Dedupe (SQL, `review_sms_pruefen`)

- **5 Versuche / 10 Minuten** und **30 / 24 Stunden** je Account.
  Versuche inkl. fehlgeschlagener zählen (Missbrauch zählt). Bei Limit:
  „Kurz warten …“ / „Tageslimit … erreicht“ (HTTP 429).
- **Dedupe:** gleicher Account + gleicher `phone_hash` innerhalb 24 h mit
  Status `queued/sent/delivered` → blockiert („An diese Nummer ging
  heute schon eine Bewertungsanfrage“, HTTP 409). **Account-weit**, nicht
  je Standort: ein Kunde ist eine Person; zwei Betriebe desselben
  Inhabers dürfen ihn nicht zweimal am Tag anschreiben (T24).
  `failed` zählt nicht → erneuter Versuch erlaubt (T25).

## Pause (WP13)

Betriebsferien blockieren den manuellen Versand **nicht** — die Pause
betrifft WERKRUFs automatische Kommunikation; eine bewusst ausgelöste
SMS ist etwas anderes. Die Route ruft `is_account_paused` nicht auf
(T36, Gegenprobe C10).

## Provider-Status / Lifecycle

`queued → sent → delivered | failed`, nur vorwärts.
- `sent`: Brevo hat `messageId` geliefert.
- `failed`: Brevo-Fehler (`brevo_<status>`, `brevo_netz`,
  `brevo_ohne_message_id`) oder `nicht_konfiguriert`. Kein automatischer
  Retry — der Betrieb kann es erneut versuchen (Dedupe lässt das zu).
- Webhook `POST /google-business/review-request/sms-webhook?secret=<SMS_WEBHOOK_SECRET>`
  (als `webUrl` je Nachricht mitgegeben; eigenes Secret seit WP14.2 — ein
  geloggter `webUrl` gefährdet nicht mehr das Mail-Webhook-Secret):
  Brevo schickt das Statusfeld als **`msg_status`** (nicht `event` wie beim
  Mail-Webhook): `delivered` → `delivered`;
  `hard_bounce/soft_bounce/blocked/bl/rejected/rej/skip/unsubscribed/error` →
  `failed`; `sent/accepted/replied` → ignoriert; alles andere ignoriert. Nur bekannte `messageId`; idempotent;
  rückwärts nie. Kein „gelesen“ — SMS hat keine Open-Metrik.

## UI

`/dashboard/kunden-gewinnung` (Seite „Mehr Bewertungen“, hinter ProGate):
Sektion **„Bewertung per SMS anfragen“** — Hinweis „Bitte nur an
Kundinnen und Kunden senden, die tatsächlich bei dir waren und bei denen
du die Nummer für diesen Kontakt verwenden darfst.“, Felder Vorname /
Mobilnummer / Betrieb (nur bei mehreren), Server-Vorschau, Segmente,
„SMS senden“ → „SMS wurde gesendet.“, Formular geleert. Keine
Rechtsgarantie, keine Lese-Behauptung.

## Admin

Support-Snapshot: `smsBewertungsanfragen { gesamt, gesendet, zugestellt,
fehlgeschlagen, letzte }` — nur Zähler, keine Nummer (die Tabelle hat
keine).

## Product Truth Cleanup

`PricingCard.js`: „Bewertungs-Autopilot“ und „Monatliches PDF-Reporting“
entfernt (zusätzlich zu „Wettbewerber-Monitoring“ aus #50). Kein
Ersatzclaim; „SMS-Bewertungsanfrage“ wurde **nicht** eingetragen (die
Karte wird derzeit nicht gerendert). Hinweis: die **gastro/beauty**-
Blöcke in `industryConfig.js` führen „Bewertungs-Autopilot“ weiterhin —
dort als „nicht live, vor Markenstart abgleichen“ dokumentiert (Stand
16.10.), unverändert gelassen.

## Manuelle Schritte (Iver)

1. Brevo → SMS: Credits laden / SMS-Kanal aktivieren (falls noch nicht).
   Der Sender „WERKRUF“ (alphanumerisch) braucht in DE keine
   Registrierung; falls Brevo eine Absender-Verifizierung verlangt,
   dort bestätigen.
2. Secrets (Supabase → Edge Functions → Secrets): `BREVO_API_KEY` ist
   da; **neu `SMS_WEBHOOK_SECRET`** (zufällig, z. B. 32+ Zeichen) und
   **`SMS_PHONE_PEPPER`** (eigenes zufälliges Secret); für den ersten Test
   `SMS_DELIVERY_MODE=test` + `SMS_TEST_RECIPIENT=+49…` (eigene Nummer),
   danach `SMS_DELIVERY_MODE` entfernen oder auf `production`.
   Erwartete Secrets nach WP14.2: `BREVO_API_KEY`, `SMS_WEBHOOK_SECRET`,
   `SMS_PHONE_PEPPER`, `SMS_DELIVERY_MODE`, `SMS_TEST_RECIPIENT`.
   `BREVO_WEBHOOK_SECRET` bleibt nur für den Mail-Webhook.
3. Kein Webhook im Brevo-Dashboard nötig — `webUrl` wird je Nachricht
   mitgeschickt.
3b. Vercel übernimmt `vercel.json` beim nächsten Deploy; danach
   `https://werkruf.com/b/<code>` im Browser prüfen → 302 auf
   `search.google.com/local/writereview?placeid=…`.
4. Migration läuft über Actions → Apply Supabase migrations
   (`NOTICE [wp14] in Ordnung`); Functions `google-business`, `admin-ops`
   deployen automatisch; Vercel ggf. „Promote to Production“.

## Smoke

1. Migration angewendet, Secrets gesetzt (Testmodus), Functions deployed.
2. Pro-Testuser → Mehr Bewertungen → Sektion sichtbar, Einwilligungshinweis.
3. Standort auswählen (bei mehreren).
4. Vorname + eigene Mobilnummer eingeben → Vorschau zeigt Name, Betrieb, **`werkruf.com/b/<code>`**, neutrale Copy (kein „zufrieden“), „1 SMS“/„2 SMS-Segmente“.
5. „SMS senden“ → „SMS wurde gesendet.“; Formular leer.
6. SMS kommt an (Testmodus: an `SMS_TEST_RECIPIENT`), Absender WERKRUF.
7. Kurzer Link öffnet den Google-Bewertungsdialog des richtigen Betriebs; `werkruf.com/b/zzzzzzz` → 404; zweiter Standort → anderer Code.
8. `review_sms_requests`: Zeile `sent` mit `provider_message_id`; nach Zustellung `delivered` (Webhook mit `SMS_WEBHOOK_SECRET`; mit dem alten `BREVO_WEBHOOK_SECRET` allein → 401).
9. Gleiche Nummer erneut → „heute schon eine Bewertungsanfrage“.
10. Andere Nummer → erlaubt.
11. Sechste SMS in 10 Minuten → Kurzzeitlimit.
12. Free-Testuser → ProGate; direkter `POST /review-request/sms` → 402.
13. Fremde `locationId` → 404.
14. Betriebsferien aktiv → Versand trotzdem möglich.
15. Admin → Support → Zähler sichtbar, keine Nummer.
16. Audit: `review_request.sms_sent` ohne Nummer.
17. `SMS_DELIVERY_MODE` auf `production` → Testlauf mit eigener Nummer als Kunde.
18. PricingCard ohne die zwei Claims.
