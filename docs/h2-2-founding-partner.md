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

---

# H2.2 D — `payment_failed` für Founding Partner

## 8. Ist-Zustand

`invoice.payment_failed` im Stripe-Webhook reihte die Mail ein, sobald
ein Profil zur `stripe_customer_id` gefunden wurde — ohne jede
Planprüfung. Ein Founding Partner mit einem Altabo aus seiner
Zahlerzeit konnte damit eine Zahlungsaufforderung für einen Zugang
bekommen, der kostenlos ist.

## 9. Was geändert ist

Gegated wird **die Mail, nicht das Event** — in dieser Reihenfolge:

```text
Profil holen (jetzt mit plan)
  ↓
updateProfile(stripe_subscription_status: 'past_due')   ← bleibt
  ↓
if (!darfZahlungsmahnung(profile)) { log; break; }      ← neu
  ↓
enqueue_email('payment_failed')
```

Warum nicht das Event überspringen: der Zustand bei Stripe bleibt
wahr, auch wenn wir nicht mahnen. Ein übersprungenes Event hieße
`stripe_subscription_status` auf dem alten Wert, eine Lücke in der
Historie — und wenn der Founding-Partner-Status später endet, stünde
in der Datenbank ein Zustand, den Stripe längst widerlegt hat.

Falsch ist nicht die Verarbeitung, sondern die Zahlungsaufforderung.

`src/utils/subscription.js`: neu `darfZahlungsmahnung(profile)`. Eigene
Funktion und nicht `!isFoundingPartner()` an der Aufrufstelle, damit
die Produktentscheidung an einer Stelle steht und einzeln prüfbar ist.
Der Webhook importiert sie aus `src/utils/` — wie `google-business` und
`generate-review-reply` es mit `accessGate.js` tun. Kein viertes
`=== 'founding_partner'`; genau so ist die Zugangsregel vor H1 viermal
entstanden.

Der Dedupe-Key bleibt unberührt. Wird dasselbe Event nach einem
Planwechsel erneut geliefert, greift die Prüfung nicht mehr und die
Mail geht raus — richtig so, denn dann ist der Nutzer kein Founding
Partner mehr.

## 10. Gegenproben

`src/paymentFailedFoundingPartner.test.js`, 14 Fälle.

| Profil | darf gemahnt werden |
| --- | --- |
| `pro` + `sub_...` + `past_due` | ja |
| `free` + `sub_...` + `past_due` | ja |
| `founding_partner` + `past_due` | **nein** |
| `founding_partner` ohne Stripe-Spur | **nein** |
| `founding_partner` × jeder Stripe-Status | **nein** |
| `pro` × jeder Stripe-Status | ja |
| kein Profil / leeres Profil | ja |

Die Zeile „hängt nur am Plan, nicht am Stripe-Status" ist die
Gegenprobe gegen eine naheliegende Fehlimplementierung: ein Gate über
den Stripe-Status (`canceled` → nicht mahnen) würde den zahlenden
Kunden in `past_due` treffen und den Founding Partner in `active`
durchlassen — also genau verkehrt.

Dass `free` gemahnt wird, ist Absicht und nicht dieselbe Frage wie bei
den operativen Mails: dort ist `free` gesperrt (H1 P0 #4), weil die
Handlungsaufforderungen hinter ProGate zeigen. Eine
Zahlungsaufforderung zeigt nirgendwohin, sie informiert.

Zur Stelle im Webhook prüft der Test die Reihenfolge, mit belegten
Schnittgrenzen: jeder Index wird einzeln auf `> -1` geprüft, damit kein
leerer Abschnitt als grün durchgeht. Genau dieser Fehler hat in H2.1
einen Test grün gelassen, der nichts gelesen hat.

**Gegenproben zur Platzierung:**

| Eingriff | Ergebnis |
| --- | --- |
| Gate **vor** `updateProfile` | 2 Fälle rot |
| Gate ganz entfernt | 2 Fälle rot |

---

# H2.2 E — die Kreditkarten-Zusage

## 11. Ist-Zustand

Die aktive Preisseite versprach, für die Testphase sei keine Karte
nötig. Stripe Checkout im Modus `subscription` verlangt eine
Zahlungsmethode, solange `payment_method_collection` nicht auf
`if_required` steht — und `create-checkout-session` setzt das nicht
(gemessen am 13.10.2026). Der Kunde klickte auf eine Zusage und landete
eine Seite später bei der Kartenabfrage.

## 12. Was geändert ist

`src/pages/Pricing.js`, eine Zeile:

```text
Zahlungsdaten werden beim Start hinterlegt — in den ersten
{pricing.trialDays} Tagen wird nichts abgebucht.
```

Die Alternative wäre gewesen, `payment_method_collection: 'if_required'`
zu setzen und die Zusage zu halten. Das ist eine Produktentscheidung
mit Folgen — ohne Karte endet der Trial ohne Zahlung und ohne Übergang
— und §26 schließt Stripe-Umbauten in diesem Paket aus. Korrigiert wird
die Aussage, nicht das Verhalten.

Die übrigen Trial-Zusagen bleiben: „30 Tage kostenlos" ist wahr,
`trial_period_days: 30` steht in der Checkout-Function.

`src/Pricing.js` enthält denselben Satz und ist **nicht verdrahtet**
(`App.js` bindet `src/pages/Pricing.js` ein). §32 stellt die Doppelung
ausdrücklich auf die Nicht-anfassen-Liste; der Test hält fest, dass es
toter Code ist.

## 13. Der unangenehmste Fund dieses Pakets

Die erste Fassung der Korrektur zitierte den alten Satz wörtlich in dem
Kommentar, der erklärt, warum er weg ist. Folge: der H2.1-Audit-Test,
der genau diesen Satz als Befund festhielt, blieb **grün nach der
Behebung**.

Das ist die unangenehmste Richtung, in die ein Test irren kann — nicht
ein Fehlalarm, sondern ein Schweigen. Hätte ich nur den vollen Lauf
angesehen, wäre der Widerspruch „Befund behoben, Befund-Test grün" nie
aufgefallen.

Zwei Konsequenzen, beide umgesetzt:

- die Preisseite zitiert den Satz nicht mehr, sondern beschreibt ihn
- die Prüfung in `billingAudit.test.js` entfernt Kommentare, bevor sie
  Textzusagen prüft, und ist auf den behobenen Zustand gedreht

Dasselbe Muster — ein Textmuster trifft einen Kommentar — ist in diesem
Paket vier Mal aufgetreten: in der Erkennung des `when others`-Handlers,
in `billingAudit` bei „Lifetime", hier, und einmal als Fehlalarm bei
`update_user_plan`. Es ist kein Zufall, sondern die Grenze der Methode:
Quelltextmuster können Kommentar und Ausgabe nicht unterscheiden. Wo es
um das geht, was der Nutzer sieht, prüfen die neuen Tests die
gerenderte Ausgabe.

## 14. Belege D und E

| | |
| --- | --- |
| Jest | 1079 Tests in 70 Suites grün |
| Gegenprobe D (Gate verschoben / entfernt) | je 2 Fälle rot |
| Gegenprobe E (alte Zusage zurück) | 4 Fälle rot, in beiden Dateien |
| SQL-Tests | 27 Dateien, 0 rot |
| `CI=true npm run build` | `Compiled successfully.` |

`deno check` läuft hier nicht (esm.sh ist über den Proxy nicht
erreichbar); das macht CI mit Deno v1.

## 15. Was in D und E nicht passiert ist

- kein Stripe-Aufruf, keine Stripe-Konfiguration, kein Webhook
  ausgelöst, keine Mail verschickt
- `payment_method_collection` **nicht** gesetzt (§26)
- keine Migration, keine Datenänderung
- `src/Pricing.js`, `GhostSetupModal`, `PathAPricingModal` nicht
  angefasst (§32)
- F ist nicht begonnen
