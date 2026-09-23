# MVP-Prüfung: E-Mail- und Notification-Flow

Stand: 23. September 2026. Bei dieser Prüfung wurden keine Migrationen
ausgeführt und keine E-Mails versendet.

## Produktive Auslöser

| Mail | Auslöser | Deduplizierung |
|---|---|---|
| Welcome | Trigger `on_user_confirmed_send_welcome` bei erstmaliger E-Mail-Bestätigung; alternativ authentifizierte Route `/send-email/enqueue` | `welcome:<user-id>` |
| 1–2-Sterne-Warnung | `/send-email/plan` → `schedule_communications('immediate_alert')`; Basis sind noch nicht als `notification` zugestellte Review-Events | Queue-Dedupe plus Zustellmarkierung am Event |
| Weekly Digest | `/send-email/weekly` → `schedule_weekly_summaries`; der allgemeine Montagsplaner kann denselben Digest ebenfalls vorsehen | `weekly_summary:<user-id>:<week-start>` |
| Trial-Erinnerung / Trial-Ende / Verbindungsabbruch | `/send-email/schedule` → `schedule_lifecycle_emails` | fachlicher Schlüssel je User und Anlass/Zeitraum |
| Inaktivität | `/send-email/plan` → `schedule_communications` | User und ISO-Woche |
| Fehlgeschlagene Zahlung | Stripe-Event `invoice.payment_failed` | `payment_failed:<stripe-event-id>` |
| Betriebsalarm | `/ops-alert`, direkt über Brevo und bewusst unabhängig von der Queue | serverseitige Cooldown-Markierung erst nach erfolgreichem Versand |

Die veralteten direkten Functions `send-welcome-email` und
`check-trial-emails` liegen nicht im Repository und dürfen in Supabase weder
als Function/Webhook noch als Cronjob aktiv sein. Der Stripe-Webhook sendet
keine Mail mehr direkt über Brevo.

## Fehler- und Datenschutzverhalten

* `enqueue_email` lehnt leere oder syntaktisch ungültige Adressen ab. Planer
  überspringen Nutzer ohne Auth-E-Mail. Der öffentliche Welcome-Endpunkt
  antwortet bei einer Session ohne Adresse mit HTTP 400.
* Netzwerkfehler sowie Brevo 429/5xx werden mit Backoff erneut versucht.
  Permanente 4xx-Fehler werden endgültig als `failed` abgelegt. Code und
  gekürzte Providerantwort bleiben an der Queue-Zeile nachvollziehbar.
* Laufende Jobs werden atomar mit `FOR UPDATE SKIP LOCKED` übernommen.
  Hängende Jobs können durch `release_stuck_emails` wieder freigegeben werden.
* Aktive Versandpfade protokollieren Queue-/User-/Event-IDs, Status und
  Fehlercodes, aber keine Kunden-E-Mail-Adresse und keinen Mailinhalt.
* `EMAIL_DELIVERY_MODE=test` erzwingt `EMAIL_TEST_RECIPIENT` und ersetzt bei
  `send-email` und `ops-alert` jeden Empfänger. Ohne expliziten Testmodus bleibt
  das bisherige Produktionsverhalten kompatibel.

## Vor dem manuellen Rollout

1. In `email_queue` nach mehrfach vorhandenen `dedupe_key`-Werten suchen. Die
   Migration bricht absichtlich ab, solange Dubletten existieren.
2. Migration `20260923120000_email_delivery_mvp.sql` erst nach Review manuell
   anwenden; sie wurde bei dieser Prüfung nicht ausgeführt.
3. In Supabase Database Webhooks prüfen, dass kein `auth.users`-Webhook die
   alte Function `send-welcome-email` aufruft.
4. In `cron.job` prüfen, dass weder `check-trial-emails` noch mehrere Jobs für
   dieselbe Route aktiv sind. Für den Digest genau einen Weg wählen; der
   gemeinsame Dedupe-Key schützt zusätzlich gegen Doppelversand.
5. In einer Staging-Umgebung `EMAIL_DELIVERY_MODE=test` und eine kontrollierte
   `EMAIL_TEST_RECIPIENT` setzen. Welcome, schlechte Bewertung, Weekly Digest,
   Zahlungsfehler, 429/500 und Netzwerkfehler ausschließlich dort testen.
6. In `email_queue` Statuswechsel `queued → sending → sent` sowie Retry und
   endgültiges `failed` kontrollieren. Danach `/ops-alert` zuerst mit
   `{"dryRun":true}` prüfen.
7. Erst nach erfolgreicher Staging-Abnahme in Produktion
   `EMAIL_DELIVERY_MODE=production`, Brevo-Key, verifizierte Absenderdomains,
   `ADMIN_EMAIL` und Cron-Worker-Secret gegenprüfen.
