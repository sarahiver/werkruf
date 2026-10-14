# H2.2 C — Founding Partner in den Einstellungen

Stand: 14.10.2026. Reine Oberflächenänderung, kein Billing-Umbau.

## 1. Ist-Zustand, aus H2.1 gemessen

Ein Founding Partner sah auf `/dashboard/einstellungen`:

| Stelle | Anzeige | warum |
| --- | --- | --- |
| Badge | `Free` | `isTrial ? 'Test-Phase' : plan === 'pro' ? 'Aktiv' : 'Free'` — `founding_partner` fällt in den letzten Zweig |
| Planname | `founding_partner` | `planLabels[plan] \|\| plan` — kein Eintrag, also der rohe Spaltenwert |
| CTA | `Jetzt upgraden` | `hasStripeCustomer` ist false, also der Checkout-Zweig |
| Fußzeile | `30 Tage kostenlos — danach 49 € / Monat` | derselbe Zweig |
| zusätzlich | Trial-Fortschrittsleiste, „x von 30 Tagen übrig" | wenn `stripe_subscription_status = 'trialing'` aus der Zahlerzeit stehengeblieben ist |

Vier falsche Aussagen gegenüber genau den Nutzern, die als erste an
WERKRUF geglaubt haben. Der Zugang kostet nichts, läuft nicht ab und
hängt nicht an Stripe.

## 2. Was geändert ist

`src/pages/dashboard/DashboardSettings.js`:

- `foundingPartner` wird **vor** allem ausgewertet, was Stripe liest —
  dieselbe Reihenfolge wie in `hasPaidAccess`, und aus demselben
  Grund: die ersten Founding Partner werden bestehende Nutzer sein und
  tragen Stripe-Spuren (§15)
- `isTrial` ist für einen Founding Partner immer false → keine
  Fortschrittsleiste, kein „Test-Phase"
- Badge: `Founding Partner` mit Häkchen, eigene Farbvariante statt der
  grauen Free-Variante
- `planLabels.founding_partner = 'Founding Partner'`
- Detailzeile: **„Kostenlos, solange du Teil des
  Founding-Partner-Programms bist."** Nicht „Lifetime free", nicht
  „Für immer kostenlos" (§14) — das Programm kann enden, und ein
  Versprechen, das wir nicht halten können, wäre genau die Art
  falscher Zusage, die H2.2 schließen soll
- Kartenuntertitel: „Dein Zugang im Founding-Partner-Programm." statt
  „Verwalte dein Abo, ändere den Tarif oder kündige jederzeit."
- rechte Spalte: kein Upgrade-Knopf, keine Preiszeile, kein
  prominentes „Abo & Zahlungen verwalten" (§16)

`src/utils/subscription.js`: neu `hatAktivesStripeAltabo(profile)`.
Entscheidet keinen Zugang und löst keine Zahlung aus — sie macht einen
Zustand sichtbar.

## 3. Das aktive Altabo (§16)

„Wenn ein aktives Altabo parallel existiert, dokumentiere den Zustand
statt ihn still zu ignorieren."

Der Unterschied, auf den es ankommt, ist nicht „hat eine
`stripe_customer_id`", sondern „hat einen Status aus
`active`/`trialing`/`past_due`". Ein Founding Partner mit
gekündigtem Abo zahlt nichts mehr; da gibt es nichts zu melden, und
eine Warnung ohne Anlass wäre selbst eine falsche Aussage. Läuft
dagegen noch eine Subscription, wird gerade Geld abgebucht für einen
Zugang, der kostenlos ist.

Nur in diesem Fall erscheint:

```text
Bei Stripe läuft noch ein Abo (Status: active).
Dein Zugang ist als Founding Partner kostenlos — dieses Abo brauchst
du dafür nicht.
[ Altes Abo bei Stripe prüfen ]
```

Der Knopf führt ins bestehende Portal. Keine neue Stripe-Zahlung, kein
Migrationsfeature (§16 verbietet beides ausdrücklich).

## 4. Tests

`src/pages/dashboard/foundingPartnerSettings.test.js`, zehn Fälle
gegen die **gerenderte** Seite. Ein Test, der nach dem String
`founding_partner` in der Datei sucht, wäre auch dann grün, wenn die
Bedingung nie greift.

| Fall (§17) | prüft |
| --- | --- |
| `founding_partner` ohne Stripe | Badge, Planname, Wortlaut, keine Upgrade-CTA |
| dito | kein Portal-Knopf |
| + `canceled` Stripe | Founding-Darstellung gewinnt |
| dito | Portal nicht als „Abo verwalten" |
| + `stripe_customer_id` und `trialing` | keine Trial- oder Upgrade-Werbung, kein „Test-Phase" |
| + aktives Altabo | Zustand wird benannt, Portal als „Altes Abo prüfen" |
| + `canceled` | schweigt über Stripe — Gegenprobe zur Zeile darüber |
| `pro` | unverändert: „Aktiv", Produktname, Portal |
| `free` | unverändert: „Free", „Kein aktives Abo", Upgrade-Knopf, Preiszeile |
| `pro` + `trialing` | Fortschrittsleiste erscheint weiterhin |

Die letzten drei sind die Gegenprobe in der anderen Richtung: eine
Härtung, die die Leiste überall abschaltet oder `free` die
Upgrade-Darstellung nimmt, wäre sonst auch grün.

**Gegenprobe zur Änderung selbst:** mit `foundingPartner = false`
erzwungen gehen 5 der 10 Fälle rot, die drei Unverändert-Fälle bleiben
grün. Der Test misst also die Änderung und nicht sich selbst.

## 5. Zwei umgedrehte Zusagen in `billingAudit.test.js`

Zwei H2.1-Tests hielten den Befund fest („kennt kein Etikett für
`founding_partner`", `not.toMatch(/isFoundingPartner/)`). Sie wurden
durch die Korrektur rot — richtig so: ein Test, der einen Befund
festhält, muss fallen, wenn der Befund behoben ist, sonst verhindert
er die Behebung. Beide sind jetzt auf den behobenen Zustand gedreht,
mit Verweis auf die gerenderte Prüfung.

Dabei noch ein eigener Fehler: der erste Entwurf prüfte zusätzlich
`SETTINGS` gegen `/Lifetime|Für immer kostenlos/i` — und wurde rot,
weil die Datei diese Worte enthält, nämlich in dem Kommentar, der
erklärt, warum sie nicht verwendet werden. Ein Quelltextmuster kann
Kommentar und Ausgabe nicht unterscheiden. Die Zusage steht jetzt dort,
wo sie hingehört: gegen die gerenderte Seite.

## 6. Belege

| | |
| --- | --- |
| Jest | 1058 Tests in 68 Suites grün |
| Gegenprobe UI | `foundingPartner = false` → 5 von 10 rot |
| SQL-Tests | 27 Dateien, 0 rot |
| `CI=true npm run build` | `Compiled successfully.` |

## 7. Was nicht passiert ist

- kein Stripe-Aufruf, keine Stripe-Konfiguration, kein Webhook
- keine Migration, keine Datenänderung
- `ProGate` nicht angefasst (§32)
- keine Kündigungsbestätigung, keine Dunning-Logik, kein
  Stripe-Migrationsfeature (§16, §32)
- `GhostSetupModal`, `PathAPricingModal` und die zweite Preisseite
  nicht angefasst (§32)
- D bis F sind nicht begonnen
