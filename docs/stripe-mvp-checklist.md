# Stripe-MVP: geprüfter Sollzustand und Testablauf

## Behobene MVP-Befunde

- Ein fehlgeschlagener Webhook blieb bisher als unverarbeitete Event-ID stehen;
  jede Stripe-Wiederholung wurde danach fälschlich als erfolgreiches Duplikat
  quittiert. Fehlgeschlagene Claims werden nun freigegeben, erfolgreiche
  Duplikate bleiben idempotent.
- Datenbankfehler beim Schreiben des Profilstatus wurden ignoriert und das
  Event trotzdem als verarbeitet markiert. Profil- und Abschlussupdates werden
  jetzt geprüft und führen bei Fehlern zu einem Stripe-Retry.
- Subscription-Events können außerhalb der Reihenfolge ankommen. Für
  `created`/`updated` wird deshalb der aktuelle Subscription-Stand bei Stripe
  gelesen, bevor Zugang gewährt wird.
- `cancel_at_period_end` und das Periodenende wurden nicht persistiert. Dadurch
  konnte das Produkt eine vorgemerkte Kündigung nicht korrekt erklären.
- Die Client-Paywall prüfte nur `plan`; abgelaufene Legacy-Trials blieben damit
  unbegrenzt offen. Außerdem waren Bewertungen gar nicht von `ProGate`
  umschlossen und die kostenpflichtigen Antwort-Endpunkte hatten keine
  serverseitige Abo-Prüfung.
- Checkout hatte keine harte Zuordnung über `client_reference_id` und prüfte
  nicht, ob Secret und Price aus demselben Stripe-Modus stammen. Der bestehende
  Price wird nun auf Test/Live-Modus, 49 EUR und Monatsintervall validiert.
- Nach Checkout wartete die Oberfläche nicht auf den asynchronen Webhook. Sie
  pollt nun den Profilstatus und zeigt Erfolg, Abbruch oder Verzögerung an.
- Das Portal akzeptierte auch andere HTTP-Methoden, ignorierte Profilfehler und
  hatte eine abweichende Fallback-Domain. Es arbeitet jetzt ausschließlich per
  authentifiziertem POST und verlangt eine explizite `SITE_URL`.

## Persistierter Vertragszustand

`user_profiles` ist die Projektion des Stripe-Zustands für das Produkt:

| Feld | Quelle | Bedeutung |
|---|---|---|
| `stripe_customer_id` | Checkout / Webhook | Stripe-Kunde des Supabase-Users |
| `stripe_subscription_id` | `customer.subscription.*` | aktuelles Abo |
| `stripe_subscription_status` | `customer.subscription.*` | unveränderter Stripe-Status |
| `stripe_cancel_at_period_end` | `customer.subscription.updated` | Kündigung vorgemerkt |
| `stripe_current_period_end` | `customer.subscription.*` | Ende des bezahlten Zugangs |
| `plan` | aus Stripe-Status abgeleitet | `trial`, `pro` oder `free` |

Zugang besteht bei `trialing`, `active` und während der MVP-Mahnfrist bei
`past_due`. `canceled`, `unpaid`, `paused`, `incomplete` und
`incomplete_expired` sperren Paid-Funktionen. Bei einer vorgemerkten Kündigung
bleibt der Stripe-Status bis zum Periodenende aktiv; erst das
`customer.subscription.deleted`-Event setzt `free`.

## Notwendige Konfiguration

Test und Live dürfen niemals gemischt werden. Für einen Testlauf werden
ausschließlich folgende Testwerte gesetzt:

- `STRIPE_SECRET_KEY=sk_test_…`
- `STRIPE_WEBHOOK_SECRET=whsec_…` des **Test-Mode-Endpunkts**
- `STRIPE_PRICE_MONTHLY=price_…` eines aktiven, wiederkehrenden Testpreises:
  EUR 49,00, monatlich
- `SITE_URL` auf die tatsächlich getestete HTTPS-Deployment-URL

Checkout validiert Modus, Währung, Betrag und Intervall des vorhandenen Price.
Die Function legt weder Product noch Price an. Für Live werden alle drei
Stripe-Werte gemeinsam gegen ihre Live-Gegenstücke ausgetauscht. Ein
Test-Price mit Live-Key (oder umgekehrt) wird abgewiesen.

Vor dem Function-Deploy muss die Migration
`20260923070000_stripe_subscription_mvp.sql` kontrolliert und bewusst auf das
Testprojekt angewendet werden. Sie wird nicht automatisch ausgeführt.

## Manueller End-to-End-Test im Stripe Test Mode

1. In einem Supabase-Testprojekt die Migration anwenden und die drei Functions
   `create-checkout-session`, `stripe-webhook` und `create-portal-session`
   deployen. JWT bleibt für Checkout/Portal an und für den Webhook aus.
2. Im Stripe Test Mode einen monatlichen EUR-Price über 49,00 € auswählen und
   dessen bestehende ID als `STRIPE_PRICE_MONTHLY` setzen. Kein Product anlegen.
3. Den Webhook-Endpunkt auf die fünf Events konfigurieren:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted` und
   `invoice.payment_failed`.
4. Einen neuen Supabase-Nutzer registrieren, E-Mail bestätigen, anmelden und
   prüfen, dass sein Profil noch keine Stripe-IDs enthält.
5. Im Paywall- oder Einstellungs-CTA Checkout starten. In Stripe prüfen:
   `client_reference_id`, Session-, Subscription- und Customer-Metadaten müssen
   alle dieselbe Supabase-User-ID enthalten.
6. Checkout mit Stripes erfolgreicher Testkarte `4242 4242 4242 4242`, einem
   zukünftigen Datum und beliebiger CVC abschließen. Es darf keine echte
   Zahlung ausgelöst werden.
7. Auf der Rückkehrseite den Freischaltungsstatus beobachten. In
   `user_profiles` müssen Customer-ID, Subscription-ID, Status `trialing`,
   `plan=trial`, Trial-Ende, Periodenende und `cancel_at_period_end=false`
   stehen. Paid-Seiten müssen zugänglich sein.
8. Dasselbe Webhook-Event im Stripe Dashboard erneut senden. Die zweite
   Zustellung muss HTTP 200 mit `duplicate=true` liefern und darf das Profil
   nicht verändern. In `stripe_events` existiert genau eine verarbeitete Zeile.
9. Einen Function-/Datenbankfehler in einem **separaten Testprojekt** simulieren
   und erneut senden. Nach einem 5xx darf keine unverarbeitete Claim-Zeile den
   nächsten Versuch blockieren; die spätere Zustellung muss erfolgreich sein.
10. Das Customer Portal aus den Einstellungen öffnen. Es muss dem Customer des
    eingeloggten Users gehören und nach `/dashboard/einstellungen`
    zurückführen.
11. Im Portal „zum Periodenende kündigen“ wählen. Nach
    `customer.subscription.updated` müssen Status und Zugang aktiv bleiben,
    `stripe_cancel_at_period_end=true` sein und das Ende im UI erscheinen.
12. Das Periodenende ausschließlich mit einer Stripe Test Clock oder über ein
    isoliertes Test-Abo simulieren. Nach `customer.subscription.deleted` müssen
    `plan=free` und Status `canceled` stehen; Paid-Seiten und serverseitige
    Antwort-Endpunkte müssen gesperrt sein.
13. Für den Zahlungsausfall eine Stripe-Testmethode aus der offiziellen
    Testkartenliste verwenden. `invoice.payment_failed` muss `past_due` setzen;
    Zugang bleibt während der MVP-Mahnfrist bestehen. Wenn Stripe später
    `unpaid` oder `canceled` meldet, muss der Zugang enden.

## Regressionen, die vor Live geprüft werden

- Die Tabelle `stripe_events` existiert tatsächlich im Zielprojekt.
- Webhook-Signaturen mit falschem Secret werden mit HTTP 400 abgewiesen.
- Checkout und Portal ohne gültiges Supabase-JWT werden abgewiesen.
- Ein zweiter Checkout bei `active`, `trialing` oder `past_due` wird verhindert.
- Fehlerantworten geben keine Stripe- oder Datenbankinternas an den Browser aus.
- Live-Konfiguration erst nach vollständig bestandenem Testlauf setzen.
