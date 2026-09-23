# Stripe-MVP-Abnahme — Testprojekt und Stripe Test Mode

> **Sicherheitsrahmen:** Ausschließlich ein Supabase-Testprojekt und Stripe
> **Test mode** verwenden. Keine Live-Secrets, keine Live-Karten, kein
> Production-Deployment. Die Migration wird erst in Schritt 1 bewusst im
> Testprojekt ausgeführt.

## Schnellnavigation

1. [Migration ausführen](#1-migration-ausführen)
2. [Edge Functions deployen](#2-edge-functions-deployen)
3. [Test-Secrets setzen](#3-test-secrets-setzen)
4. [Webhook konfigurieren](#4-webhook-konfigurieren)
5. [Testuser anlegen](#5-testuser-anlegen)
6. [Checkout durchführen](#6-checkout-durchführen)
7. [Profilstatus prüfen](#7-profilstatus-prüfen)
8. [Webhook erneut zustellen](#8-webhook-erneut-zustellen)
9. [Customer Portal testen](#9-customer-portal-testen)
10. [Kündigung zum Periodenende testen](#10-kündigung-zum-periodenende-testen)
11. [`customer.subscription.deleted` testen](#11-customersubscriptiondeleted-testen)
12. [`invoice.payment_failed` testen](#12-invoicepayment_failed-testen)

## Vorbedingungen

- Eine HTTPS-Test-URL der App, z. B. `https://test.example.invalid`.
- Ein bestehender Stripe-Test-Price: **49,00 EUR**, wiederkehrend, monatlich.
- Das Supabase-Testprojekt ist bereits mit dem WERKRUF-Basisschema initialisiert.
  Prüfen unter **Table Editor**: `public.user_profiles` muss vorhanden sein.
  Ein leeres Supabase-Projekt ist nicht ausreichend; diese Datei ist bewusst
  nur eine inkrementelle Stripe-Migration und legt keine Anwendungstabellen an.
- Die Migration wurde vor dieser Abnahme noch nicht gegen Produktion ausgeführt.

## 1. Migration ausführen

- **Klicken:** Supabase-Testprojekt → **SQL Editor** → **New query**.
- **Eingeben (Vorprüfung):**
  ```sql
  select to_regclass('public.user_profiles') as user_profiles;
  ```
- **Erwartet (Vorprüfung):** `public.user_profiles`. Kommt `null`, **nicht** mit
  der Stripe-Migration fortfahren. Zuerst das WERKRUF-Basisschema in dieses
  Testprojekt klonen beziehungsweise über den vorgesehenen Projekt-Setup-Prozess
  initialisieren. Keinesfalls ersatzweise eine leere `user_profiles`-Tabelle
  anlegen: Signup, RLS und die übrigen Profilspalten würden weiterhin fehlen.
- **Eingeben:** vollständigen Inhalt von
  `supabase/migrations/20260923070000_stripe_subscription_mvp.sql`; dann **Run**.
- **Erwartet:** Erfolg ohne Resultset. Unter **Table Editor** existiert
  `stripe_events` mit `id`, `type`, `received_at`, `processed_at`,
  `error_message`. `user_profiles` hat ausschließlich die zwei neuen Spalten
  `stripe_cancel_at_period_end` und `stripe_current_period_end`. Im Browser mit
  `anon`/`authenticated` ist `stripe_events` weder les- noch schreibbar.

## 2. Edge Functions deployen

- **Klicken:** Terminal/CI des Testprojekts öffnen; nicht den Production-Deploy
  starten.
- **Eingeben:**
  ```bash
  supabase functions deploy create-checkout-session --project-ref <TEST_REF>
  supabase functions deploy create-portal-session --project-ref <TEST_REF>
  supabase functions deploy stripe-webhook --project-ref <TEST_REF> --no-verify-jwt
  supabase functions deploy generate-review-reply --project-ref <TEST_REF>
  supabase functions deploy google-business --project-ref <TEST_REF> --no-verify-jwt
  ```
- **Erwartet:** alle fünf Deployments erfolgreich. Checkout, Portal und
  Review-Reply verlangen JWT; der Stripe-Webhook nicht. Google Business prüft
  Nutzer beziehungsweise Worker innerhalb der Function.

## 3. Test-Secrets setzen

- **Klicken:** Supabase-Testprojekt → **Edge Functions** → **Secrets**.
- **Eingeben:**
  - `STRIPE_SECRET_KEY=sk_test_…`
  - `STRIPE_PRICE_MONTHLY=price_…` des bestehenden 49-EUR-Monatspreises
  - `SITE_URL=https://<TEST-APP>`
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` des
    Testprojekts, sofern die Plattform sie nicht automatisch bereitstellt
  - `STRIPE_WEBHOOK_SECRET` erst nach Schritt 4
- **Erwartet:** keine Werte beginnen mit `sk_live_`; Checkout lehnt einen Price
  mit falschem Modus, Betrag, Währung oder Intervall ab.

## 4. Webhook konfigurieren

- **Klicken:** Stripe Dashboard → Schalter **Test mode** aktivieren →
  **Developers** → **Webhooks** → **Add endpoint**.
- **Eingeben:** Endpoint
  `https://<TEST_REF>.supabase.co/functions/v1/stripe-webhook`; Events:
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`.
- **Danach:** Endpoint öffnen → **Signing secret** anzeigen; dessen `whsec_…`
  als `STRIPE_WEBHOOK_SECRET` in den Supabase-Test-Secrets speichern.
- **Erwartet:** Endpoint ist im Test Mode aktiv. Ein Test mit falscher Signatur
  liefert HTTP 400; nur Stripe-signierte Requests werden verarbeitet.

## 5. Testuser anlegen

- **Klicken:** Test-App → **Konto erstellen** → E-Mail bestätigen → Onboarding;
  alternativ Supabase → **Authentication** → **Users** → **Add user**.
- **Eingeben:** ausschließlich eine Testadresse, z. B.
  `stripe-mvp+<timestamp>@example.com`, und ein Testpasswort.
- **Erwartet:** genau eine `user_profiles`-Zeile; vor Checkout sind
  `stripe_customer_id`, `stripe_subscription_id` und
  `stripe_subscription_status` leer.

## 6. Checkout durchführen

- **Klicken:** Test-App → gesperrte PRO-Funktion oder **Einstellungen** →
  **Jetzt upgraden**.
- **Eingeben:** Stripe-Testkarte `4242 4242 4242 4242`, ein zukünftiges Datum,
  beliebige CVC und Postleitzahl. Keine echte Karte verwenden.
- **Erwartet:** Stripe zeigt 49,00 EUR/Monat und den konfigurierten Trial; danach
  Rückkehr zu `/dashboard?checkout=success…`. Die App zeigt zunächst
  „wird freigeschaltet“ und danach „Abo ist aktiv“. In Stripe haben Customer,
  Checkout Session und Subscription dieselbe `supabase_user_id`; zusätzlich
  entspricht `client_reference_id` der Supabase-User-ID.

## 7. Profilstatus prüfen

- **Klicken:** Supabase-Testprojekt → **Table Editor** → `user_profiles` →
  Filter `id = <TEST_USER_UUID>`.
- **Eingeben:** nur den Filter; nichts manuell ändern.
- **Erwartet:** `stripe_customer_id=cus_…`, `stripe_subscription_id=sub_…`,
  `stripe_subscription_status=trialing`, `plan=trial`, Trial- und Periodenende
  gesetzt, `stripe_cancel_at_period_end=false`. PRO-Funktionen sind freigeschaltet.

## 8. Webhook erneut zustellen

- **Klicken:** Stripe Test Mode → **Developers** → **Webhooks** → Testendpoint
  → erfolgreiches `customer.subscription.created` → **Resend**.
- **Eingeben:** keine Änderungen am Payload.
- **Erwartet:** HTTP 200 mit `duplicate=true`; Profilwerte bleiben identisch;
  `stripe_events` enthält für diese Stripe-Event-ID genau eine Zeile mit
  gesetztem `processed_at`.

## 9. Customer Portal testen

- **Klicken:** Test-App → **Einstellungen** →
  **Abo & Zahlungen verwalten**.
- **Eingeben:** nichts.
- **Erwartet:** Stripe Test Customer Portal öffnet den Customer des Testusers;
  Rückkehrlink führt exakt zu `/dashboard/einstellungen`. Ein User ohne
  `stripe_customer_id` erhält eine sichtbare Fehlermeldung statt eines Redirects.

## 10. Kündigung zum Periodenende testen

- **Klicken:** Test Customer Portal → **Cancel plan** → Kündigung zum Ende des
  Abrechnungszeitraums bestätigen.
- **Eingeben:** optionalen Stripe-Test-Kündigungsgrund.
- **Erwartet:** `customer.subscription.updated` liefert HTTP 200;
  `stripe_cancel_at_period_end=true`, Status bleibt `trialing` oder `active`,
  `plan` und PRO-Zugang bleiben bestehen. Einstellungen zeigen
  „Gekündigt — Zugang bis <Datum>“.

## 11. `customer.subscription.deleted` testen

- **Klicken:** Stripe Test Mode → Subscription des Testusers → Kündigung über
  eine **Test Clock** bis zum Periodenende fortschreiben; alternativ nur bei
  einem wegwerfbaren Testabo **Cancel now**. Niemals ein Live-Abo verwenden.
- **Eingeben:** Test Clock bis nach `current_period_end` vorspulen.
- **Erwartet:** Webhook HTTP 200; anschließend `plan=free`,
  `stripe_subscription_status=canceled`, `stripe_cancel_at_period_end=false`.
  PRO-Seiten zeigen die Paywall; KI-Generierung und Reply-Änderung/-Freigabe
  antworten serverseitig mit HTTP 402.

## 12. `invoice.payment_failed` testen

- **Klicken:** Für ein separates Testabo Stripe Test Mode → Test Customer →
  Zahlungsmethode auf eine von Stripe dokumentierte fehlschlagende
  Test-Zahlungsmethode ändern; Rechnung im Test Mode erneut versuchen.
- **Eingeben:** ausschließlich eine Stripe-Test-Zahlungsmethode; keine echte
  Kartennummer. Danach das erzeugte `invoice.payment_failed` unter
  **Developers** → **Webhooks** öffnen.
- **Erwartet:** Webhook HTTP 200 und
  `stripe_subscription_status=past_due`. Der MVP gewährt während der Mahnfrist
  weiter Zugang und weist auf die Aktualisierung der Zahlungsmethode hin.
  Erst ein späterer Stripe-Status `unpaid` oder `canceled` setzt `plan=free`
  und sperrt den Zugang.
