# H2.1 — Billing-Audit

Stand: 13. Oktober 2026. Struktur nach §29 des H2.1-Auftrags.

**Audit, kein Umbau.** Für diesen Bericht wurde kein Billing-Code geändert,
keine Migration in Produktion ausgeführt, keine Stripe-Konfiguration angefasst
und keine Mail verschickt. Ergänzt wurden ausschließlich Audit-Tests, die den
heutigen Ist-Zustand festschreiben (§27) — `src/billingAudit.test.js` und ein
Abschnitt in `supabase/tests/operativeMails.test.sql`.

Jeder Punkt wurde gegen den aktuellen `main` gemessen, nicht aus dem
H1-Bericht übernommen. **Eine Aussage aus H1 war falsch und ist unten
korrigiert** (B).

Leitprinzip des Auftrags: *Erst beweisen, welches Billing WERKRUF heute
tatsächlich hat.*

---

## Das Wichtigste zuerst

Ein Befund steht über allem anderen, weil er das Billing als Ganzes
aushebeln könnte — und weil er in zehn Sekunden entscheidbar ist.

**`public.update_user_plan(uuid, text, timestamptz)`** ist `SECURITY DEFINER`,
nimmt eine **fremde** `user_id` an, prüft **kein** Eigentum und setzt
`plan = 'pro'`. In der Testdatenbank ist sie für `anon` **und**
`authenticated` ausführbar — gemessen:

```
update_user_plan | anon: true | authenticated: true | service_role: true
update_user_plan(<user>, 'pro')  → durchgelaufen, plan jetzt: pro
update_user_plan(<user>, 'trial')     → check_violation (23514)
update_user_plan(<user>, 'cancelled') → check_violation (23514)
```

Wäre das in Produktion so, dann gilt: Wer den öffentlichen anon-Key hat — er
liegt in jedem Browser-Bundle — kann über
`POST /rest/v1/rpc/update_user_plan` jedem Konto `plan = 'pro'` geben oder
einem zahlenden Kunden `free` setzen. `hasPaidAccess` prüft `plan` und gibt
daraufhin vollen Zugang, inklusive Google-Schreibrechte.

**Aus dem Repo ist das für Produktion NICHT belegbar.** Der
Produktionsdump (`supabase/schema/production-baseline-2026-09-22.sql`) ist mit
`--no-privileges` erzeugt; er enthält null GRANT-Zeilen. Das ist in
`docs/testing/baseline-luecken.md` §3 bereits als bekannte Lücke dokumentiert:
*„Welche Rechte Produktion wirklich vergeben hat, steht nirgends im Repo."*

Was sich sagen lässt: PostgreSQL vergibt beim `CREATE FUNCTION` automatisch
`EXECUTE` an `PUBLIC`, und für diese Funktion enthält das Repo keinen Revoke.
Dasselbe gilt für **46** weitere `SECURITY DEFINER`-Funktionen mit
Schreibwirkung, die in der Testdatenbank für `anon` offen sind — darunter
`purge_unconfirmed_accounts`, `retract_reply`, `enqueue_sync_job`,
`sync_events`, `check_rate_limit`, `prune_email_queue`.

**Die Abfrage, die es klärt** (lesend, Supabase SQL Editor):

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.provolatile = 'v'
   and (has_function_privilege('anon', p.oid, 'execute')
     or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1;
```

Kommt `update_user_plan` mit `anon = true` oder `authenticated = true` zurück,
ist es der erste Punkt vor allem anderen. Ich habe nichts daran geändert —
§26 verbietet Umbau in diesem Paket, und das hier wäre einer.

---

## A. Checkout heute

```
ProGate / /pricing / Einstellungen
   → useCheckout.startCheckout({ plan: 'monthly', … })
   → Edge Function create-checkout-session   (JWT nötig)
       · Plan prüfen            nur 'monthly', sonst 400
       · Preis prüfen           Stripe-Price gegen 4900 / eur / month /
                                recurring / livemode — sonst 500
       · Doppelabo verhindern   active|trialing|past_due → 409
       · Kunde holen/anlegen    stripe_customer_id wird gespeichert
       · Session anlegen        mode subscription, trial_period_days 30,
                                Metadaten auf Session UND Subscription,
                                allow_promotion_codes
   → Stripe Checkout (extern)
   → /dashboard?checkout=success  → Banner pollt bis zu 8× das Profil
   → Webhook schreibt den Zustand
```

**Vier Einstiegspunkte** in der Oberfläche: `ProGate.js:142`,
`src/pages/Pricing.js:471`, `DashboardSettings.js:314` — und
`src/Pricing.js:289`, das **nirgends verdrahtet** ist (R). Alle vier rufen
dieselbe Function mit `plan: 'monthly'`.

**Erstes Geld:** nach 30 Tagen, mit der ersten Rechnung. Vorher wird keine
Zahlung eingezogen (`trial_period_days: 30`).

**Zugang vor dem Checkout:** nein, der Checkout ist die Voraussetzung. Aber
`handle_new_user` setzt bei jeder Registrierung `trial_started_at = now()` und
`trial_ends_at = now() + 30 Tage` — **ohne** Zugang (gemessen, siehe D). Die
Spalten sind also gefüllt, bevor irgendetwas bezahlt wurde.

## B. 30-Tage-Versprechen

```
Versprechen korrekt — mit einem falschen Zusatz
```

**Korrektur zu H1:** Mein H1-Bericht führte unter „Restpunkte" das
30-Tage-Versprechen als *unbelegt* und *vollständig von der
Stripe-Konfiguration abhängig*. **Das war falsch.** Die Function setzt
`trial_period_days: 30` selbst, und der Kopfkommentar sagt ausdrücklich, dass
das 2026-09-11 genau deshalb geändert wurde („Vorher konnte sofort abgebucht
werden, waehrend Frontend und Mail '30 Tage kostenlos' versprechen"). Ich hatte
das in H1 nicht gemessen, sondern aus `plan = 'trial'` geschlossen — ein
Fehlschluss von der Planspalte auf die Stripe-Konfiguration.

| UI-Stelle | Versprechen | im Repo belegt? | extern abhängig? |
|---|---|---|---|
| `industryConfig.js:210` u. a. | `trialDays: 30`, „Jetzt 30 Tage gratis testen" | ja | nein |
| `pages/Pricing.js:311,319,457,520` | „30 Tage kostenlos" | ja | nein |
| `PricingCard.js:251,258` | „30 Tage gratis testen · dann 49 €" | ja | Preis: Price-ID extern, Betrag aber geprüft |
| `ProGate.js:161,177` | „Starte deinen kostenlosen 30-Tage-Test" | ja | nein |
| `DashboardSettings.js:331` | „30 Tage kostenlos — danach 49 € / Monat" | ja | nein |
| `PathAPricingModal.js:110` | „30 Tage kostenlos testen" | ja | **Komponente wird nicht gerendert** |
| `GhostSetupModal.js:279` | „Einmalige Setup-Fee + 30 Tage Software gratis" | **nein** | **Komponente wird nicht gerendert; Path B ist gestrichen** |
| `pages/Pricing.js:478` | **„Keine Kreditkarte für die Testphase erforderlich."** | **nein — falsch** | nein |

**Der eine falsche Satz:** Stripe Checkout im Modus `subscription` verlangt
eine Zahlungsmethode, solange `payment_method_collection: 'if_required'` nicht
gesetzt ist — und die Function setzt es nicht (geprüft). Der Kunde liest „keine
Kreditkarte" und wird im nächsten Schritt nach einer gefragt. Das ist der
einzige nachweislich falsche Satz im Billing-Text.

## C. Datenmodell

| Spalte | wer schreibt | wann | Quelle | wird gelesen von |
|---|---|---|---|---|
| `plan` | Webhook `updateProfile`; `set_`/`clear_founding_partner`; Spaltenvorgabe `'free'`; **`update_user_plan` (ohne Aufrufer)** | subscription.created/updated/deleted | `mapStatusToPlan(sub.status)` | `hasPaidAccess`, `has_paid_access`, ProGate, DashboardSettings |
| `stripe_customer_id` | Checkout-Function; Webhook (checkout.completed, subscription.*) | Kundenanlage, Events | Stripe | Portal-Function, Checkout, delete-account, Einstellungen |
| `stripe_subscription_id` | Webhook subscription.* | Events | Stripe | Zugriffsregel (nur auf Vorhandensein), delete-account |
| `stripe_subscription_status` | Webhook subscription.* und `invoice.payment_failed` (`'past_due'`) | Events | Stripe | Zugriffsregel (entscheidend), Checkout (Doppelabo), Einstellungen, Banner |
| `trial_started_at` | **`handle_new_user`** (`now()`); Webhook (`sub.trial_start`) | Registrierung; Events | gemischt | nur `admin-ops` (Anzeige) |
| `trial_ends_at` | **`handle_new_user`** (`now() + 30d`); Webhook (`sub.trial_end`, sonst `null`) | Registrierung; Events | gemischt | Zugriffsregel (nur im toten `trial`-Zweig), Einstellungen (Fortschritt), `admin-ops` |
| `stripe_cancel_at_period_end` | Webhook subscription.* / deleted (`false`) | Events | Stripe | `isCancellationScheduled` → Einstellungen |
| `stripe_current_period_end` | Webhook subscription.* / deleted | Events | Stripe | nur Einstellungen (Datum im Kündigungshinweis) |
| `founding_partner_since` / `_note` | `set_`/`clear_founding_partner` | manuell | du | nichts im Produkt (Historie) |
| `accepted_terms_version` / `_at` | `record_terms_acceptance` über `accept_terms` | Onboarding | Server | `getPostAuthDestination`, Onboarding |

Zwei Dinge fallen auf: `trial_started_at`/`trial_ends_at` haben **zwei**
Schreiber mit verschiedener Bedeutung (Registrierung vs. Stripe-Trial), und
`trial_started_at` wird außerhalb der Admin-Ansicht nirgends gelesen.

## D. Wahrheitstabelle Access

Gemessen mit `public.has_paid_access()` in der Testdatenbank (Dump + alle
Migrationen). Die JS-Fassung `hasPaidAccess` liefert für dieselben Fälle
dieselben Werte — das hält `src/utils/planGateSql.test.js` fest, indem es die
Matrix aus der SQL-Abnahme einliest und in JavaScript nachrechnet.

| plan | stripe status | Zugang | warum |
|---|---|---:|---|
| `free` | – | **nein** | kein Plan, keine Stripe-Spur |
| `pro` | – | **ja** | Altbestand-Zweig: `plan = 'pro'` |
| `pro` | `trialing` | **ja** | Stripe-Zweig, `trialing` ∈ bezahlt |
| `pro` | `active` | **ja** | Stripe-Zweig |
| `pro` | `past_due` | **ja** | Stripe-Zweig — Produktentscheidung, siehe I |
| `pro` | `unpaid` | **nein** | Stripe-Zweig, nicht in der Liste |
| `pro` | `canceled` | **nein** | dito |
| `pro` | `incomplete` | **nein** | dito |
| `pro` | `incomplete_expired` | **nein** | dito |
| `pro` | `paused` | **nein** | dito |
| `founding_partner` | – | **ja** | erster Zweig, vor Stripe |
| `founding_partner` | `canceled` | **ja** | erster Zweig gewinnt (§23) |
| `starter` | – | **nein** | im Constraint erlaubt, von keinem Code gesetzt |
| `free` | `active` | **ja** | **Stripe entscheidet, nicht das Etikett** |
| `free`, `trial_ends_at` in 20 Tagen | – | **nein** | der Zustand jedes neuen Kontos |
| `trial` | `trialing` | **technisch unmöglich** | Constraint lehnt den Wert ab (E) |

Die letzten drei Zeilen sind die interessanten: Ein `free`-Etikett mit aktivem
Abo hat Zugang (richtig — Stripe ist die Wahrheit über Geld), ein frisch
registriertes Konto hat trotz gesetzter Trial-Spalten keinen, und `plan =
'trial'` kann nicht existieren.

## E. Trial — kann er real entstehen?

**Als Stripe-Zustand: ja. Als `plan = 'trial'`: nein.**

```
CHECK (plan = ANY (ARRAY['free','starter','pro','founding_partner']))
```

Gemessen: `update_user_plan(<user>, 'trial')` → `check_violation (23514)`.
Dasselbe für `'cancelled'`. Die Funktion erlaubt in ihrer eigenen Prüfung vier
Werte, von denen zwei der Constraint ablehnt — und sie hat **keinen Aufrufer**
im Repo (geprüft über alle `.js`, `.ts`, `.sql` außer dem Schema-Dump).

Der Trial läuft deshalb vollständig über Stripe:
`status = 'trialing'` + `trial_ends_at` aus `sub.trial_end`, Plan `'pro'`.
`mapStatusToPlan` kommentiert das ausdrücklich.

Tote Pfade, die daran hängen: siehe R.

## F. Webhooks

Fünf Events, gemessen über den Ereignis-`switch`:

| Stripe Event | Handler | DB-Änderung | plan? | status? | Mail? |
|---|---|---|---|---|---|
| `checkout.session.completed` | ja | nur `stripe_customer_id` | **nein** | **nein** | nein (bewusst; Willkommensmail hängt am Auth-Trigger) |
| `customer.subscription.created` | ja | plan, customer, sub-id, status, trial_started/ends, cancel_at_period_end, current_period_end | ja | ja | nein |
| `customer.subscription.updated` | ja | dito | ja | ja | nein |
| `customer.subscription.deleted` | ja | plan `'free'`, status `'canceled'`, cancel_at_period_end `false`, trial_ends_at `null` | ja | ja | nein |
| `invoice.payment_failed` | ja | **nur** `status = 'past_due'` | nein | ja | `payment_failed`, dedupe `payment_failed:<event.id>` |
| `invoice.paid` / `payment_succeeded` | **nein** | – | – | – | – |
| `charge.refunded`, `credit_note.*` | **nein** | – | – | – | – |
| `customer.subscription.trial_will_end` | **nein** | – | – | – | – |

Nicht behandelte Events landen im `default`-Zweig und werden nur protokolliert.

**Statusabbildung** (`mapStatusToPlan`): `active`, `trialing`, `past_due` →
`'pro'`; `canceled`, `unpaid`, `incomplete_expired`, `incomplete`, `paused`,
alles andere → `'free'`.

**Sicherheit (§23):** Signatur ist Pflicht — fehlt `STRIPE_WEBHOOK_SECRET`,
antwortet die Function 500; fehlt der Header, 400; schlägt
`constructEventAsync` fehl, 400. Der Rohtext wird vor dem Parsen gelesen
(`await req.text()`), es gibt keinen `JSON.parse(body)`-Pfad und keinen
Dev-Modus.

**Idempotenz (§10):** Einfügen in `public.stripe_events` mit der Event-ID als
Primärschlüssel ist der Anspruch.

| Fall | Verhalten |
|---|---|
| Erstzustellung | Insert gelingt → Handler läuft → `processed_at` wird gesetzt → 200 |
| Wiederholung nach Erfolg | `23505`, `processed_at` gesetzt → 200 `{duplicate:true}`, Handler läuft nicht |
| Wiederholung während der Verarbeitung | `23505`, `processed_at` leer → **409**, Stripe wiederholt |
| Handler-Fehler | Anspruch wird freigegeben (`delete … where processed_at is null`) → 500 → Stripe wiederholt und kommt durch |
| Reihenfolge `created`/`updated` | **abgesichert**: der Handler holt die Subscription frisch aus Stripe (`subscriptions.retrieve`), ein verspätetes Event stellt keinen Zugang wieder her |
| Reihenfolge `deleted` | **nicht abgesichert**: dieser Zweig nimmt `event.data.object`. Ein verspätetes `deleted` nach einem neuen Abo setzt `plan = 'free'`, `status = 'canceled'` — siehe R |

Belegende Tests: `src/billingAudit.test.js` (Abschnitt F),
`src/stripeSubscriptionMigration.test.js` (Ereignistabelle und ihre Rechte),
`src/entitlementGates.test.js` (der Founding-Partner-Guard in `updateProfile`).

## G. Founding Partner — Stripe-Schutz

**Vollständig für `plan`. Nicht vorhanden für Mails und Oberfläche.**

Der Engpass ist `updateProfile`: Enthält das Update einen `plan`, wird vorher
der bestehende Plan gelesen; steht dort `founding_partner`, wird `plan` aus dem
Update entfernt (mit Protokollzeile `plan_nicht_ueberschrieben`). Ein Lesefehler
führt zu `throw` — nicht zu einem blinden Schreiben.

| Fall | heutiges Verhalten |
|---|---|
| 1 ehemaliger Zahler → Founding Partner | Zugang bleibt; `hasPaidAccess` prüft `founding_partner` **vor** Stripe |
| 2 später `customer.subscription.deleted` | Stripe-Spalten werden aktualisiert, **`plan` bleibt** `founding_partner` |
| 3 `invoice.payment_failed` | setzt nur `status = 'past_due'` — kein `plan` im Update, Guard gar nicht nötig; **die Mail geht trotzdem raus** (I, K) |
| 4 verspätetes altes Event | `created`/`updated` lesen den Live-Zustand; `plan` ist ohnehin geschützt |
| 5 neues aktives Abo | Stripe-Spalten werden gesetzt, `plan` bleibt `founding_partner`; Zugang ohnehin ja |

Nicht geschützt: Die **Einstellungsseite** behandelt Founding Partner wie
`free` (L), und die `payment_failed`-Mail fragt keinen Plan (K).

## H. Kündigung

Der normale Weg führt über das Stripe-Kundenportal. **Ob dort „zum
Periodenende" oder „sofort" gekündigt wird, ist eine Portal-Einstellung in
Stripe und aus dem Repo nicht belegbar** (Q). Der Code ist auf
„zum Periodenende" ausgelegt: Er speichert `cancel_at_period_end` und zeigt es
an.

Szenario `active`, Kündigung heute, `current_period_end` in 20 Tagen:

| Tag | Zustand in der DB | Was der Nutzer erlebt |
|---|---|---|
| 0 | `subscription.updated` → `cancel_at_period_end = true`, status bleibt `active`, plan bleibt `pro` | Zugang unverändert; Einstellungen zeigen „Gekündigt — Zugang bis <Datum>" |
| 19 | unverändert | Zugang unverändert, derselbe Hinweis |
| 20 | Stripe beendet das Abo → `customer.subscription.deleted` → plan `free`, status `canceled` | Zugang endet; ProGate schließt; Weekly/Alerts hören auf |
| 21 | unverändert | `free`-Zustand; Einstellungen zeigen „Kein aktives Abo — jetzt upgraden" |

**Mail zur Kündigung: keine.** Weder eine Bestätigung noch ein Hinweis vor dem
Ende. Was Stripe selbst verschickt, ist eine Stripe-Einstellung (Q).

Sofort-Kündigung gibt es an genau einer Stelle: `delete-account` ruft
`stripe.subscriptions.cancel(...)` beim Löschen des Kontos.

## I. Payment Failure — `past_due` / `unpaid`

```
active → invoice.payment_failed → status past_due, plan bleibt pro
```

| Frage | Antwort, gemessen |
|---|---|
| Behält der Nutzer Pro-Zugang? | **Ja** — `past_due` ist in `PAID_STATUSES`, und `mapStatusToPlan` lässt `plan = 'pro'` |
| Wie lange? | So lange Stripe `past_due` meldet. Die Dauer bestimmen Stripes Smart Retries — **extern** (Q) |
| Grace Period im Code? | **Keine.** Es gibt keine Frist, keinen Zähler, keine Sperre nach n Tagen |
| Wann wird wirklich gesperrt? | Erst wenn Stripe `unpaid`, `canceled` oder `incomplete_expired` meldet — dann `plan = 'free'` und kein Zugang |
| Mail? | `payment_failed` je fehlgeschlagener Rechnung, dedupliziert über die Event-ID |

**Das ist als Produktentscheidung zu lesen, nicht als Bug:** Zugang halten,
während die Mahnung läuft. Der Kommentar im Code sagt es so
(`// Zugang halten, Mahnung laeuft`). Was fehlt, ist die Entscheidung, *wie
lange* — die liegt heute vollständig bei Stripes Retry-Einstellung.

`unpaid`, `incomplete`, `incomplete_expired`, `paused` (§15): alle vier sind in
`mapStatusToPlan` aufgeführt und führen zu `plan = 'free'` und keinem Zugang —
auch die, die in keiner Fixture vorkommen. Gemessen in D.

## J. Refund

**Nichts passiert.** Es gibt keinen Handler für `charge.refunded`,
`charge.refund.updated` oder `credit_note.*`; die Wörter kommen im Repo nicht
vor. Folge:

- Die Subscription wird **nicht** beendet (ein Refund beendet sie in Stripe
  auch nicht von sich aus).
- Der Zugang bleibt, solange der Status `active` ist.
- `plan` ändert sich nicht.
- Es gibt keinen eigenen Status und keine Audit-Spur in WERKRUF.

Erstattest du im Stripe-Dashboard und kündigst zusätzlich, greift der normale
`deleted`-Pfad. Erstattest du nur, weiß WERKRUF nichts davon.

## K. Lifecycle Mails — was existiert wirklich

Nicht aus Dateinamen abgeleitet, sondern dreifach geprüft: Vorlage, Planung,
Aufrufer — und ob der gefilterte Zustand entstehen kann.

| Mail | Vorlage | Planung | Aufrufer | Zustand erreichbar? | Fazit |
|---|---|---|---|---|---|
| `trial_reminder` (7 Tage vorher) | ja, `send-email:585` | ja, `schedule_lifecycle_emails` | ja, Cron `mail-schedule` täglich 08:00 | **nein** — filtert `plan = 'trial'` | **wird nie verschickt** |
| `trial_ended` | ja, `:599` | ja, dito | ja | **nein** — dito | **wird nie verschickt** |
| `connection_broken` | ja, `:611` | ja, dito | ja | ja | läuft, an **alle** Pläne |
| `payment_failed` | ja, `:679` | nein — direkt im Webhook | Stripe-Event | ja | läuft, **ohne Planprüfung** |
| `weekly_summary` | ja, `:722` | `schedule_communications` | Cron `comm-weekly` | ja | nur berechtigte Pläne (H1) |
| `critical_review_alert` | ja, `:637` | dito | Cron `comm-alerts` | ja | dito |
| `inactivity_reminder` | ja, `:690` | dito | dito | ja | dito |
| `welcome` | ja, `:573` | Auth-Trigger | Bestätigung der Adresse | ja | läuft |
| Kündigungsbestätigung | **nein** | – | – | – | existiert nicht |
| Trial-Ende-Ankündigung über Stripe | – | – | `trial_will_end` **nicht behandelt** | – | existiert nicht |

**Der Trial endet also ohne jede Ankündigung aus WERKRUF**, und die erste
Abbuchung kommt unangekündigt. Was Stripe selbst verschickt, ist eine
Stripe-Einstellung (Q).

§17 im Detail: Die `payment_failed`-Mail wird vom Webhook eingereiht, sobald
Stripe eine fehlgeschlagene Rechnung meldet. Sie findet den Nutzer über
`stripe_customer_id`, **prüft keinen Plan** und dedupliziert über die
Event-ID. Damit kann sie einen **Founding Partner** mit laufendem Altabo
erreichen und einen `free`-Nutzer, der gerade von `unpaid` heruntergestuft
wurde. Der Link führt auf `/dashboard/einstellungen`.

## L. UI / ProGate — was wird versprochen

| Stelle | Inhalt |
|---|---|
| Preis | 49 € / Monat, aus `industryConfig.pricing.monthlyPrice`; Betrag wird im Checkout gegen Stripe geprüft |
| Trial-Text | „30 Tage gratis/kostenlos" an sechs Stellen, konsistent mit `trial_period_days: 30` |
| Kündigung | „jederzeit kündbar"; bei gekündigtem Abo „Gekündigt — Zugang bis <Datum>" |
| aktueller Plan | `planLabels`: `free` → „Kostenloser Plan", `pro` → Produktname, `trial` → „30 Tage Gratis-Test" (toter Wert) |
| Stripe-Status | wird bei `plan = 'pro'` im Klartext angezeigt („Status: past_due") |
| Abo verwalten | ja, Stripe-Portal — Knopf erscheint, sobald eine `stripe_customer_id` existiert |
| Trial-Fortschrittsbalken | nur bei `status = 'trialing'` oder `plan = 'trial'` — ein `free`-Konto sieht ihn **nicht**, obwohl `trial_ends_at` gesetzt ist |

**Was ein Founding Partner sieht — drei Befunde:**

1. `planLabels` kennt `founding_partner` nicht → `PlanName` zeigt den
   **Rohwert „founding_partner"**.
2. `PlanBadge` hat keine Variante dafür; die Badge-Beschriftung fällt auf
   „Free" zurück (`isTrial ? … : plan === 'pro' ? 'Aktiv' : 'Free'`).
3. Ohne `stripe_customer_id` — der Normalfall für einen neu aufgenommenen
   Founding Partner — zeigt die Seite **„Jetzt upgraden"** samt „30 Tage
   kostenlos — danach 49 € / Monat". Genau das, was §20 ausschließt:
   *„Founding Partner darf nicht zu Stripe-Checkout gedrängt werden."*

`ProGate` selbst ist korrekt: `hasPaidAccess` lässt Founding Partner durch,
also sehen sie die Bezahlschranke nie. Der Widerspruch steckt nur in der
Einstellungsseite.

## M. Customer Portal

`create-portal-session` erzeugt eine `billingPortal.sessions`-Session mit
`return_url` auf `/dashboard/einstellungen`.

| Wer | Verhalten |
|---|---|
| angemeldet mit `stripe_customer_id` | Portal öffnet — **kein Planvergleich** |
| `free` ohne `customer_id` | 400 „Kein aktives Abo gefunden." |
| `canceled` mit `customer_id` | Portal öffnet (Rechnungen, neues Abo) |
| Founding Partner **ohne** Stripe-Historie | sieht stattdessen „Jetzt upgraden" (L) |
| Founding Partner **mit** Stripe-Historie | Portal öffnet; er könnte dort ein Abo starten, obwohl er kostenlos dabei ist |

Welche Funktionen das Portal anbietet — Kündigung, Tarifwechsel, Zahlungsmittel
— ist eine Stripe-Einstellung (Q).

## N. Security — wer darf Billing-Felder schreiben

**Über die Tabelle: niemand im Browser.** Gemessen
(`supabase/tests/entitlement.test.sql`, Abschnitt 1): `authenticated` und
`anon` haben **kein** UPDATE auf `plan`, `stripe_customer_id`,
`stripe_subscription_id`, `stripe_subscription_status`,
`stripe_current_period_end`, `stripe_cancel_at_period_end`,
`trial_started_at`, `trial_ends_at`, `founding_partner_since`,
`founding_partner_note`, `accepted_terms_version`, `accepted_terms_at`.
Gegenprobe im selben Test: `full_name`, `company_name`, `city` sind schreibbar.
Grund: Migration 20260928160000 vergibt Schreibrechte als **Spaltenliste**, und
eine Whitelist wächst nicht mit.

**Über Funktionen: offene Frage, siehe „Das Wichtigste zuerst".** Der Weg um
die Spaltenrechte herum ist `update_user_plan`, und ob er in Produktion offen
steht, ist aus dem Repo nicht belegbar.

RLS ist hier nicht die Verteidigung: Alle genannten Funktionen sind
`SECURITY DEFINER` und umgehen RLS per Definition. Was zählt, sind die
`EXECUTE`-Rechte.

## O. Kommunikation — Status-Matrix

Gemessen: Weekly, Critical Alert und Abwesenheitserinnerung hängen an
`wants_operational_mail` = `has_paid_access` (H1, geprüft in
`operativeMails.test.sql`). `payment_failed` und `connection_broken` prüfen
keinen Plan.

| Zustand | Weekly | Critical Alert | `payment_failed` | `connection_broken` |
|---|---:|---:|---:|---:|
| `free` (kein Abo) | nein | nein | nur mit Stripe-Kunde und fehlgeschlagener Rechnung | **ja** |
| `trialing` (plan `pro`) | ja | ja | ja | ja |
| `active` | ja | ja | ja | ja |
| `past_due` (plan `pro`) | **ja** | **ja** | ja (der Auslöser) | ja |
| `unpaid` (plan `free`) | nein | nein | **ja** | ja |
| `canceled` (plan `free`) | nein | nein | praktisch nein (keine Rechnungen mehr) | ja |
| `founding_partner` | ja | ja | **ja, wenn ein Altabo scheitert** | ja |

Die zwei bemerkenswerten Zeilen: `past_due` bekommt weiter die vollen
operativen Mails (konsequent — der Zugang besteht ja), und `unpaid`/Founding
Partner bekommen eine Zahlungsaufforderung, obwohl sie keine operativen Mails
mehr bzw. nie bekommen.

## P. Tests — was ist wirklich belegt

| Aussage | Beleg | Stand |
|---|---|---|
| Zugriffsregel über alle Plan/Status-Kombinationen | `src/utils/entitlement.test.js`, `supabase/tests/operativeMails.test.sql` (21 Fälle + Neukonto) | getestet |
| SQL- und JS-Fassung sagen dasselbe | `src/utils/planGateSql.test.js` (liest die SQL-Matrix und rechnet sie in JS nach) | getestet |
| `founding_partner` wird vom Webhook nicht überschrieben | `src/entitlementGates.test.js`, `src/billingAudit.test.js` (F) | getestet |
| Checkout setzt 30 Trialtage und prüft den Preis | `src/billingAudit.test.js` (A) | **neu in H2.1** |
| Webhook behandelt genau fünf Events, Signatur Pflicht, Idempotenz | `src/billingAudit.test.js` (F) | **neu in H2.1** |
| `past_due` behält den Plan | `src/billingAudit.test.js` (F) | **neu in H2.1** |
| `plan = 'trial'` ist nicht setzbar | `supabase/tests/entitlement.test.sql` (2) | getestet |
| `update_user_plan` hat keinen Aufrufer | `src/billingAudit.test.js` (E/R) | **neu in H2.1** |
| Billing-Spalten sind für den Client gesperrt | `supabase/tests/entitlement.test.sql` (1) | getestet |
| Stripe-Ereignistabelle ist für Browserrollen gesperrt | `src/stripeSubscriptionMigration.test.js` | getestet |
| Zwei Preisseiten, nur eine verdrahtet; Modals toter Code | `src/billingAudit.test.js` (R) | **neu in H2.1** |
| „Keine Kreditkarte" steht da und ist nicht gedeckt | `src/billingAudit.test.js` (L) | **neu in H2.1** |
| Kündigungsablauf Tag 0 → 21 | — | **ungetestet** (braucht Stripe) |
| Idempotenz unter echter Wiederholung | — | **ungetestet** (braucht Stripe-Replay) |
| `trial_will_end`, Refund, `invoice.paid` | — | **ungetestet, weil nicht implementiert** |
| Rechte auf Datenbankfunktionen in Produktion | — | **nicht belegbar aus dem Repo** |

Zu jedem neuen Test wurde eine Mutation gefahren (§28): Trial auf 0 und
Preisprüfung entfernt → 2 rot; Founding-Partner-Guard, Idempotenz-Freigabe und
`payment_failed`-Plan verbogen → 4 rot; `trial_ends_at` gibt Zugang → der neue
SQL-Abschnitt rot. Danach jeweils wieder grün.

Beim Schreiben dieser Tests sind mir vier eigene Fehler unterlaufen, die erst
die rote Ausgabe gezeigt hat: ein `case`-Muster, das gestapelte Zweige
übersprang; ein `indexOf` ohne Startpunkt, das einen leeren Ausschnitt las und
damit grün war, ohne etwas zu prüfen; ein zu breites `not.toMatch(/'trial'/)`,
das die Kommentare der Migration traf; und ein `SETUP_FEE`-Muster, das die
Kopfzeile traf statt den Lesezugriff. Alle vier korrigiert und im Testtext
vermerkt.

## Q. Produktionsabhängigkeiten — aus dem Repo nicht beweisbar

| Was | Wo es liegt | Folge, wenn es anders ist |
|---|---|---|
| `STRIPE_PRICE_MONTHLY` | Function-Secret | Zeigt auf einen anderen Preis → Checkout antwortet 500, weil Betrag/Währung/Intervall geprüft werden. **Fail closed, also harmlos** |
| `STRIPE_SECRET_KEY` test vs. live | Function-Secret | Modusabweichung wird geprüft → 500 |
| `STRIPE_WEBHOOK_SECRET` | Function-Secret | Fehlt er, antwortet der Webhook 500 und verarbeitet nichts |
| Trial am Stripe-Price | Stripe-Dashboard | Der Code überschreibt es mit 30 Tagen; keine Verdopplung |
| Smart Retries / Dunning-Dauer | Stripe-Dashboard | Bestimmt allein, **wie lange** `past_due` dauert — und damit, wie lange ein Nichtzahler Zugang behält |
| Kundenportal: Kündigung sofort oder zum Periodenende | Stripe-Dashboard | Bestimmt, ob H's Tabelle stimmt |
| Stripe-eigene Mails (Rechnung, Trial-Ende, Zahlungserinnerung) | Stripe-Dashboard | Sind sie aus, erfährt der Kunde vom Trial-Ende **nirgends** |
| Umsatzsteuer | Stripe-Dashboard | Im Repo gibt es keine Steuerbehandlung (`automatic_tax` nicht gesetzt) und keine Steuerangabe am Preis |
| Gutscheincodes | Stripe-Dashboard | `allow_promotion_codes: true` — welche gelten, steht nur dort |
| **EXECUTE-Rechte aller Datenbankfunktionen** | Produktions-DB | Siehe „Das Wichtigste zuerst". Der Dump im Repo ist `--no-privileges` |

## R. Widersprüche und tote Pfade — vollständig

**Widersprüche**

1. **„Keine Kreditkarte für die Testphase erforderlich."** (`pages/Pricing.js:478`)
   gegen Stripe Checkout im Modus `subscription` ohne
   `payment_method_collection`. Der einzige nachweislich falsche Satz.
2. **Founding Partner auf der Einstellungsseite**: Rohwert „founding_partner",
   Badge „Free", und „Jetzt upgraden" samt 30-Tage-Versprechen (L).
3. **`update_user_plan`** erlaubt vier Werte, von denen der Constraint zwei
   ablehnt — und schreibt `plan` ohne Eigentumsprüfung (N).
4. **`payment_failed`-Mail ohne Planprüfung**, während alle anderen operativen
   Mails seit H1 gegated sind (K, O).
5. **`trial_ends_at` hat zwei Bedeutungen**: 30 Tage ab Registrierung
   (`handle_new_user`) und Stripe-Trial-Ende (Webhook). Der erste Wert gibt
   keinen Zugang, steht aber in derselben Spalte.
6. **Zwei Preisseiten**: `src/Pricing.js` und `src/pages/Pricing.js`, beide mit
   eigenem Checkout-Aufruf; nur die zweite ist in `App.js` verdrahtet.
7. **`useCheckout`** dokumentiert `'monthly' | 'quarterly' | 'annual'`, die
   Function kennt nur `monthly`.

**Tote Pfade**

8. `plan = 'trial'` — vom Constraint abgelehnt (E).
9. `plan = 'cancelled'` — in `update_user_plan` erlaubt, vom Constraint
   abgelehnt.
10. `update_user_plan` selbst — kein Aufrufer im Repo.
11. `schedule_lifecycle_emails`, Schleifen 1 und 2 — filtern auf
    `plan = 'trial'`, finden nie eine Zeile. Vorlagen `trial_reminder` und
    `trial_ended` existieren und werden nie benutzt (K).
12. `planLabels.trial` und der Trial-Fortschrittsbalken für `plan = 'trial'` in
    den Einstellungen.
13. `GhostSetupModal` — verspricht eine Setup-Fee, die der Checkout seit dem
    11.09. nicht mehr kennt; die Komponente wird nirgends gerendert.
14. `PathAPricingModal` — wird nirgends gerendert.
15. `trial_started_at` — zweimal geschrieben, nur in `admin-ops` gelesen.
16. `starter` — im Constraint erlaubt, von keinem Code gesetzt.

**Offene Reihenfolgefrage**

17. Ein verspätetes `customer.subscription.deleted` kann ein **neueres** Abo
    plattmachen: Kunde kündigt, schließt neu ab (nach `canceled` erlaubt der
    Checkout das), das alte `deleted` kommt verzögert an → `plan = 'free'`,
    `status = 'canceled'`. Die `created`/`updated`-Zweige sind dagegen
    abgesichert, dieser nicht.

---

# Definition of Done — die dreizehn Fragen

| # | Frage | Antwort |
|---|---|---|
| 1 | Gibt es heute wirklich 30 Tage Trial? | **Ja.** `trial_period_days: 30` wird von der Checkout-Function gesetzt, nicht von Stripe geerbt |
| 2 | Wann entsteht Pro-Zugang? | Mit `customer.subscription.created/updated` und Status `trialing`, `active` oder `past_due` → `plan = 'pro'`. Also unmittelbar nach dem Checkout, nicht erst nach der ersten Zahlung |
| 3 | Wann endet Pro-Zugang? | Wenn Stripe `canceled`, `unpaid`, `incomplete`, `incomplete_expired` oder `paused` meldet. Bei Kündigung zum Periodenende: mit `customer.subscription.deleted` am Periodenende |
| 4 | Was passiert bei Kündigung? | `cancel_at_period_end = true`, Zugang und Mails laufen weiter, Einstellungen zeigen das Enddatum; am Periodenende Plan `free`. Keine Mail von WERKRUF |
| 5 | Was passiert bei `past_due`? | Status `past_due`, **Plan bleibt `pro`**, Zugang bleibt, `payment_failed`-Mail. Keine Frist im Code — die Dauer bestimmt Stripes Retry-Einstellung |
| 6 | Was passiert bei `unpaid`? | `plan = 'free'`, Zugang weg, operative Mails hören auf; eine `payment_failed`-Mail kann noch kommen |
| 7 | Was passiert bei Refund? | **Nichts.** Kein Handler, keine Statusänderung, kein Audit-Eintrag |
| 8 | Kann `plan = trial` heute real existieren? | **Nein.** Constraint lehnt ab, gemessen (`23514`) |
| 9 | Welche Lifecycle-Mails werden wirklich verschickt? | `welcome`, `connection_broken`, `payment_failed`, `weekly_summary`, `critical_review_alert`, `inactivity_reminder`. **Nicht**: `trial_reminder`, `trial_ended` (toter Filter), Kündigungsbestätigung (existiert nicht) |
| 10 | Kann Stripe einen Founding Partner überschreiben? | **Den Plan nicht** — `updateProfile` schützt ihn an der einzigen Schreibstelle. Stripe-Spalten und die `payment_failed`-Mail schon |
| 11 | Welche Zustände haben Weekly/Alerts? | `trialing`, `active`, `past_due`, `founding_partner`, `pro` ohne Stripe. Nicht `free`, `unpaid`, `canceled`, `incomplete*`, `paused`, `starter` |
| 12 | Welche Aussagen sind nur extern prüfbar? | Preis-ID, Retry-Dauer, Portal-Kündigungsmodus, Stripe-eigene Mails, Umsatzsteuer, Gutscheine — und die EXECUTE-Rechte der Datenbankfunktionen (Q) |
| 13 | Welche fünf Punkte blockieren einen zahlenden Kunden? | Siehe unten |

---

# Entscheidungsvorschlag

Noch kein Code. Nur die Einordnung.

## Für Founding Partner relevant?

```
JA
```

Drei Punkte, alle ohne Stripe-Bezug:

1. **Die Rechtefrage aus „Das Wichtigste zuerst".** Steht
   `update_user_plan` offen, kann ein Fremder einem Founding Partner `free`
   setzen und ihm den Zugang nehmen. Erst prüfen, dann entscheiden.
2. **Die Einstellungsseite behandelt ihn wie `free`** — Rohwert
   „founding_partner", Badge „Free", „Jetzt upgraden" mit
   30-Tage-Versprechen. Das ist der erste Eindruck genau der Kunden, die du
   persönlich gewinnst (§20).
3. **Die `payment_failed`-Mail kann ihn erreichen**, wenn sein Altabo
   scheitert — eine Zahlungsaufforderung an jemanden, der kostenlos dabei ist.

Nicht relevant für Founding Partner: Trial, Kündigung, Refund, Preis,
Portal — sie zahlen nicht.

## Vor dem ersten zahlenden Kunden zwingend

Fünf Punkte, in dieser Reihenfolge:

1. **EXECUTE-Rechte klären und, falls offen, schließen.** Ein kostenloser
   Pro-Zugang über einen öffentlichen RPC macht jede Abrechnung
   gegenstandslos. Eine lesende Abfrage entscheidet; der Fix wäre ein
   `revoke execute … from public, anon, authenticated` — aber das ist Umbau
   und gehört in ein eigenes Paket.
2. **Trial-Ende ankündigen.** Heute läuft der Trial still aus und die erste
   Abbuchung kommt unangekündigt. Entweder `trial_will_end` behandeln oder
   Stripes eigene Mail einschalten — Letzteres ist eine Einstellung, kein
   Code.
3. **„Keine Kreditkarte für die Testphase erforderlich." entfernen oder wahr
   machen.** Entweder der Satz geht raus, oder
   `payment_method_collection: 'if_required'` kommt rein — was aber heißt,
   dass am Trial-Ende keine Zahlungsmethode vorliegt. Produktentscheidung,
   nicht Textkorrektur.
4. **Portal-Kündigungsmodus und Retry-Dauer in Stripe festlegen und
   dokumentieren.** Beides bestimmt heute allein, was ein zahlender Kunde
   erlebt — und beides steht nirgends im Repo.
5. **Preis- und Vertragsangaben prüfen lassen.** 49 € ohne Steuerangabe,
   keine Nutzungsbedingungen, keine Kündigungsbestätigung. Das ist eine
   rechtliche Frage, die ich nicht beurteilen kann; sie gehört vor die erste
   Abrechnung, nicht danach.

## Später nach MVP

- Refund behandeln (J) — mindestens als Audit-Eintrag.
- Das verspätete `deleted`-Event absichern (R17), wie es `created`/`updated`
  schon sind.
- Grace Period für `past_due` ausdrücklich entscheiden, statt sie Stripe zu
  überlassen (I).
- Tote Pfade entfernen: `trial`, `cancelled`, `update_user_plan`, die beiden
  Trial-Mails, `GhostSetupModal`, `PathAPricingModal`, `src/Pricing.js`,
  `starter` (R8–R16). Ein Aufräumpaket, kein Einzelfix.
- `trial_ends_at` entflechten: Registrierungsdatum und Stripe-Trial-Ende in
  einer Spalte sind zwei Bedeutungen (R5).
- Kündigungsbestätigung und Zahlungserinnerung als eigene Mails, falls
  gewollt.
- `invoice.paid` behandeln, um die Erholung aus `past_due` nicht allein aus
  `subscription.updated` zu schließen.
