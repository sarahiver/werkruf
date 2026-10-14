# Stripe-Dashboard — was für den MVP geprüft werden muss

Stand: 14.10.2026. Paket H2.2 F.

## 0. Was dieses Dokument ist und was nicht

Es ist eine **Prüfliste**, keine Zustandsbeschreibung.

Ich kann das Stripe-Konto von WERKRUF nicht lesen. Keine Zeile hier
behauptet, eine Einstellung sei aktiv oder inaktiv. Was hier steht:
wo im Dashboard nachzusehen ist, welcher Zustand für den MVP gewollt
ist, und was eine abweichende Einstellung im WERKRUF-Code auslöst.

Geändert wurde nichts — H2.2 §35 verbietet mir das ausdrücklich, und
§26 schließt Stripe-Umbauten in diesem Paket aus.

Die drei Themen sind getrennt, weil sie an verschiedenen Stellen im
Dashboard liegen und unterschiedliche Folgen haben.

## 0.1 Was der WERKRUF-Code tut — die Grundlage für alles unten

Gelesen am 14.10.2026 in `supabase/functions/stripe-webhook/index.ts`
und `src/utils/subscription.js`.

`mapStatusToPlan` übersetzt den Stripe-Status in den WERKRUF-Plan:

| Stripe-Status | WERKRUF-Plan | Zugang |
| --- | --- | --- |
| `active`, `trialing`, `past_due` | `pro` | ja |
| `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, `paused` | `free` | nein |

`founding_partner` wird dabei nie überschrieben (`updateProfile`
streicht `plan` für diese Nutzer).

Verarbeitet werden genau fünf Events:
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed`. Alles andere wird protokolliert und
verworfen — **`invoice.paid` und Rückerstattungen also auch**.

Der Checkout läuft im Modus `subscription` mit
`trial_period_days: 30` und ohne `collection_method`, also mit der
Vorgabe `charge_automatically`.

---

# 1. Trial-Ende und anstehende Rechnung

## 1.1 Wo nachsehen

Dashboard → **Settings → Billing → Subscriptions and emails**
(`dashboard.stripe.com/settings/billing/automatic`), Abschnitt
**Email notifications and customer management**:

- „Send a reminder email 7 days before a free trial ends"
- „Send emails about upcoming renewals"

Der Vorlauf der Renewal-Mail steht auf derselben Seite unter
**Prevent failed payments → Upcoming renewal events**.

## 1.2 Gewünschter MVP-Zustand

| Einstellung | MVP | Begründung |
| --- | --- | --- |
| Trial-Ende-Erinnerung | **an** | WERKRUF schickt keine. Siehe 1.3. |
| Upcoming renewal | **an** | zweite Chance, die erste Abbuchung nicht als Überraschung zu erleben |
| Link-Ziel der Mails | Stripe-hosted page | der Kunde kann die Karte ohne Login ändern; eine eigene Seite dafür gibt es nicht |

## 1.3 Warum das kein Komfortthema ist

WERKRUF hat zwei Mailvorlagen für diesen Moment —
`trial_reminder` (7 Tage vorher) und `trial_ended`. Beide sind
**unerreichbar**, und zwar nachweisbar:

`schedule_lifecycle_emails()` sucht Empfänger mit

```sql
where p.plan = 'trial'
  and p.trial_ends_at between now() + interval '6 days'
                          and now() + interval '8 days'
```

`user_profiles_plan_check` erlaubt aber nur
`free`, `starter`, `pro`, `founding_partner`. Der Wert `trial` kann
in der Spalte nicht stehen. Die Funktion läuft, findet null Zeilen
und meldet Erfolg.

**Folge, wenn die Stripe-Erinnerung aus ist:** ein Kunde im Trial
bekommt von niemandem eine Vorwarnung und sieht die 49 € zum ersten
Mal auf dem Kontoauszug. Das ist kein Darstellungsfehler, sondern eine
Rückbuchung mit Ansage.

Nachtrag zur Vollständigkeit: Stripe verschickt diese Mails in einer
Sandbox nicht — außer an Adressen der verifizierten Domain oder an
Teammitglieder. Ein Test im Sandbox-Modus, der keine Mail zeigt, ist
also kein Befund.

## 1.4 Die Alternative, die wir NICHT gebaut haben

`customer.subscription.trial_will_end` (3 Tage vorher) würde eine
eigene Mail erlauben. Der Webhook behandelt dieses Event nicht, und
H2.2 §26 verbietet neue Lifecycle-Mails in diesem Paket. Steht hier
als Option, nicht als Plan.

---

# 2. Smart Retries, Dunning-Dauer und das Ende der Fahnenstange

## 2.1 Wo nachsehen

Dashboard → **Billing → Revenue recovery → Retries**
(`dashboard.stripe.com/revenue_recovery/retries`).

Dort stehen drei Dinge: ob Smart Retries an sind, über welchen
Zeitraum und wie oft wiederholt wird, und — das Wichtigste — was
passiert, **wenn alle Versuche gescheitert sind**.

Die Mail bei Fehlversuch liegt eine Seite weiter: **Billing → Revenue
recovery → Emails** (`dashboard.stripe.com/revenue_recovery/emails`),
„Send emails when card payments fail".

## 2.2 Gewünschter MVP-Zustand

| Einstellung | MVP | Begründung |
| --- | --- | --- |
| Smart Retries | **an** | Stripes Empfehlung ist 8 Versuche in 2 Wochen; eigene Regeln bringen vor dem ersten Kunden nichts |
| Dauer | **2 Wochen** | deckt sich mit dem Zugang, der in `past_due` weiterläuft |
| nach dem letzten Versuch | **Cancel the subscription** | siehe 2.3 — das ist der Punkt, an dem eine falsche Einstellung Geld kostet |
| Mail bei Fehlversuch (Stripe) | **aus** | WERKRUF schickt eine eigene; siehe 2.4 |

## 2.3 Was die vier Endzustände im WERKRUF-Code auslösen

Stripe bietet vier Verhaltensweisen, wenn die Wiederholungen
erschöpft sind. Mit der Tabelle aus 0.1 ergibt das:

| Stripe-Einstellung | Status danach | WERKRUF-Plan | Was real passiert |
| --- | --- | --- | --- |
| **Cancel the subscription** | `canceled` | `free` | Zugang endet. Gewollt. |
| Mark the subscription as unpaid | `unpaid` | `free` | Zugang endet ebenfalls, aber Stripe erzeugt weiter Rechnungen im Entwurf — Buchhaltungsmüll ohne Nutzen |
| **Leave the subscription past-due** | `past_due` | `pro` | **Der Kunde behält den vollen Zugang, unbegrenzt, ohne zu zahlen.** `past_due` steht in `PAID_STATUSES` |
| Pause the subscription | `paused` | `free` | Zugang endet, Stripe stellt die Rechnungsstellung ein; eine Wiederaufnahme müsste WERKRUF behandeln, tut es nicht |

Die dritte Zeile ist der Grund, warum dieser Punkt in F steht.
„Leave past-due" ist eine plausibel klingende, kundenfreundliche
Einstellung — und mit unserer Zugangsregel bedeutet sie Gratiszugang
auf Dauer. Dass `past_due` Zugang behält, ist eine bewusste
Produktentscheidung (eine abgelehnte Karte soll nicht sofort
aussperren), aber sie trägt nur, solange Stripe irgendwann wirklich
beendet.

## 2.4 Zwei Mails für denselben Vorgang

WERKRUF schickt bei `invoice.payment_failed` eine eigene Mail:
„Zahlung fehlgeschlagen — bitte Zahlungsmethode aktualisieren", mit
Knopf auf `/dashboard/einstellungen`, von dort ins Portal. Seit H2.2 D
erreicht sie Founding Partner nicht mehr.

Ist zusätzlich Stripes „Send emails when card payments fail" an,
bekommt der Kunde **zwei** Mails zum selben Fehlversuch, in zwei
Gestaltungen, mit zwei verschiedenen Wegen zur Kartenänderung.

| Variante | dafür | dagegen |
| --- | --- | --- |
| nur WERKRUF (Empfehlung) | eine Stimme, eigenes Branding, Dedupe über `email_queue`, respektiert `EMAIL_DELIVERY_MODE` | Weg zur Karte führt über Login und Portal |
| nur Stripe | Kartenänderung ohne Login, Stripe-gehostet | keine eigene Gestaltung, taucht in `email_queue` nicht auf, und wir erfahren nicht, ob sie ankam |
| beide | — | Doppelmail; die unprofessionellste der drei Varianten |

Das ist eine Produktentscheidung, keine technische. Ich empfehle
Variante 1 und habe keine davon umgesetzt.

---

# 3. Kündigungsmodus im Customer Portal

## 3.1 Wo nachsehen

Dashboard → **Settings → Billing → Customer portal**
(`dashboard.stripe.com/settings/billing/portal`), Abschnitt
**Cancellation management**.

Technisch ist das `features.subscription_cancel` der
Portal-Konfiguration, mit `enabled` und `mode`
(`at_period_end` oder `immediately`).

## 3.2 Gewünschter MVP-Zustand

| Einstellung | MVP | Begründung |
| --- | --- | --- |
| Cancel subscription | **an** | „jederzeit kündbar" steht auf der Preisseite. Ohne diese Einstellung ist das eine falsche Zusage |
| mode | **`at_period_end`** | siehe 3.3 — nur dieser Modus passt zur bestehenden Oberfläche |
| Cancellation reason | an | kostet nichts, sagt etwas |
| Switch plan / Update quantities | aus | es gibt genau ein Produkt |

## 3.3 Warum `at_period_end` und nicht `immediately`

Das ist der Fall, in dem WERKRUF-Code und Stripe-Einstellung
zusammenpassen müssen, und beide Richtungen sind im Repo sichtbar.

**Bei `at_period_end`** schickt Stripe
`customer.subscription.updated` mit `cancel_at_period_end: true`. Der
Status bleibt `active`. Der Webhook schreibt
`stripe_cancel_at_period_end` und `stripe_current_period_end`, und die
Einstellungsseite zeigt:

```text
Gekündigt — Zugang bis 14. November 2026
```

Diese Anzeige existiert bereits (`isCancellationScheduled`,
`DashboardSettings.js`). Sie ist für genau diesen Modus gebaut.

**Bei `immediately`** schickt Stripe `customer.subscription.deleted`.
Der Plan fällt sofort auf `free`, der Zugang endet mitten im bezahlten
Monat. Drei Folgen:

1. Der Kunde verliert Zugang, für den er bezahlt hat. Eine
   Rückerstattung gibt es nicht — der Webhook behandelt
   `charge.refunded` und `credit_note.*` nicht (H2.1, in §32
   ausdrücklich als nicht zu behebend vermerkt).
2. Die Anzeige „Gekündigt — Zugang bis …" wird nie erreicht; der
   Nutzer sieht ohne Übergang die Free-Darstellung samt Upgrade-Knopf.
3. Die Spalten `stripe_cancel_at_period_end` und
   `stripe_current_period_end` bleiben ungenutzt.

Keine davon ist ein Absturz. Alle drei sind Enttäuschungen, und die
erste ist eine, bei der der Kunde zu Recht schreibt.

## 3.4 Was auch bei richtiger Einstellung offen bleibt

Eine Kündigungsbestätigung per Mail gibt es nicht — nicht von
WERKRUF (keine Vorlage) und nur dann von Stripe, wenn in den
E-Mail-Einstellungen „canceled subscriptions" aktiv ist. Steht in §32
auf der Nicht-in-H2.2-Liste. Hier als bekannte Lücke notiert, nicht
als Aufgabe.

---

# 4. Prüfliste zum Abhaken

Alles lesend, nichts davon ändert etwas, solange nicht gespeichert
wird.

| # | Seite | Was ablesen |
| --- | --- | --- |
| 1 | Settings → Billing → Subscriptions and emails | Trial-Erinnerung an? Renewal-Mail an? Vorlauf in Tagen? Link-Ziel? |
| 2 | Billing → Revenue recovery → Retries | Smart Retries an? Dauer? **Verhalten nach dem letzten Versuch?** |
| 3 | Billing → Revenue recovery → Emails | „Send emails when card payments fail" an oder aus? |
| 4 | Settings → Billing → Customer portal | Kündigung erlaubt? Modus `at_period_end` oder `immediately`? |
| 5 | Settings → Emails | Werden Quittungen und Kündigungsbestätigungen verschickt? |

Punkt 2, dritte Spalte, ist der einzige, bei dem eine falsche
Einstellung dauerhaft Geld kostet. Punkt 1 ist der, bei dem ein Kunde
sich zu Recht überrascht fühlt.

## 5. Quellen

Die Dashboard-Pfade und Standardwerte sind am 14.10.2026 in der
Stripe-Dokumentation nachgelesen, nicht aus dem Gedächtnis
geschrieben:

- Kundenmails und ihre Schalter:
  https://docs.stripe.com/billing/revenue-recovery/customer-emails
- Trial-Erinnerung, Zeitpunkt und Sandbox-Verhalten:
  https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance
- Smart Retries, Dauer und die vier Endzustände:
  https://docs.stripe.com/billing/revenue-recovery/smart-retries
- Portal-Einstellungen und Vorgaben:
  https://docs.stripe.com/customer-management/configure-portal
- `features.subscription_cancel.mode`:
  https://docs.stripe.com/api/customer_portal/configurations/object

Was Stripe an seiner Oberfläche umbenennt, kann sich ändern. Die
Beschreibung in der Spalte „Was ablesen" ist deshalb wichtiger als der
exakte Menütext.
