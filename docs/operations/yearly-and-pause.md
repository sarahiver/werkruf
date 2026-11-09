# Jahresabo und Betriebsferien-Pause (WP13)

Zwei getrennte Funktionen, ein PR: ein zweites Abrechnungsintervall
(490 € / Jahr) und eine Kommunikationspause für Betriebsferien. Die
Pause berührt die Abrechnung nicht.

---

## Teil 1 — Jahresabo

### Preise

| Tarif-Key | Intervall | Betrag | ENV | Anzeige |
|---|---|---|---|---|
| `monthly` | month | 4.900 Cent | `STRIPE_PRICE_MONTHLY` | 49 € / Monat |
| `yearly`  | year  | 49.000 Cent | `STRIPE_PRICE_YEARLY` | 490 € / Jahr |

12 × 49 € = 588 €; Jahrespreis 490 €; **Ersparnis 98 € = „2 Monate
geschenkt“**. Kommuniziert wird die exakte Zahl, kein Prozent
(`src/utils/tarife.js`: `JAHRES_ERSPARNIS_CENTS`, `JAHRES_ERSPARNIS_MONATE`).

Keine Price-ID steht im Code. `tarife.js` beschreibt, wie die Price
auszusehen hat; der Checkout prüft die hinterlegte Price dagegen
(`pricePasstZuTarif`: Betrag, `eur`, `recurring`, Intervall,
`interval_count 1`, Live-/Testmodus) und bricht sonst ab — fail closed.

### Checkout (`create-checkout-session`)

- Client sendet `plan: 'monthly' | 'yearly'` (bestehendes Feld) oder
  `billingInterval`. **Server** mappt auf die ENV (`tarifAusEingabe`).
  Eine Price-ID vom Client wird nie angenommen; ungültiger Wert → 400.
- Metadaten auf Session und Subscription: `plan_type`, `billing_interval`.
- Audit: `subscription.billing_interval_selected`.
- Aufrufer mit Intervallwahl (`TarifWahl`): ProGate, Settings. Landing
  (`Preis.js`, `Pricing.js`) zeigt beide Preise; der CTA führt zu Signup
  bzw. Dashboard, die Wahl fällt im Checkout.

### Trial

WP7 unverändert: `entscheideTrial` kennt den Tarif nicht. Neuer Nutzer →
30 Tage, bei monthly wie yearly; ehemaliger Abonnent (Stripe-Historie
oder Profil) → 0 Tage, bei beiden. Jahresabo kann den Trial-Schutz nicht
umgehen (Test T5–T8, Gegenprobe C3).

### Billing Truth

Stripe ist Source of Truth. Der Webhook spiegelt bei
`customer.subscription.created/updated` das Intervall aus
`subscription.items.data[].price.recurring.interval` nach
`user_profiles.stripe_billing_interval` (`'month' | 'year'`, sonst null —
nie geraten, nie aus Metadaten). Settings zeigen daraus:

- monatlich: `49 € / Monat · Nächste Abrechnung: <stripe_current_period_end>`
- jährlich: `490 € / Jahr · Verlängert sich am: <stripe_current_period_end>`
- Trial: `Danach 49 € / Monat` bzw. `Danach 490 € / Jahr`
- Founding Partner: unverändert „Kostenlos, solange …“ — kein Intervall,
  kein Portal-Druck.

### Plan-Wechsel

Kein eigenes Upgrade/Downgrade, keine Proration-Logik. Bestehendes Abo →
`create-portal-session` (Stripe Customer Portal) ist der kanonische Weg.
Checkout bei aktivem Abo antwortet weiterhin 409.

### Referral (WP10) + Jahresabo

„Ein Monat kostenlos“ ist ein Monat des **regulären Monatsplans**. Bei
einer Jahres-Subscription hat `monatsbetragAusSubscription` kein
Monats-Item → der Webhook holt `STRIPE_PRICE_MONTHLY` aus ENV und nimmt
dessen `unit_amount` (4.900). Nie 1/12 des Jahrespreises, nie 49.000.
Ohne ENV → „nicht ermittelbar“ → Stripe-Retry, kein falscher Reward
(Test T13/T14, Gegenprobe C4). Ein vorhandener Balance-Credit wird von
Stripe regulär mit der Jahresrechnung verrechnet — kein Sonderfall.

### Stripe-Dashboard — manuell (Iver)

1. **Produkt WERKRUF Pro → neue Price: 490,00 € / Jahr, recurring,
   interval year, EUR.** Test- und Live-Modus getrennt.
2. Price-ID als `STRIPE_PRICE_YEARLY` in den Supabase-Function-Secrets
   setzen (Test und Production). `STRIPE_PRICE_MONTHLY` bleibt.
3. Customer Portal (Settings → Billing → Customer portal) prüfen:
   - Produktwechsel erlaubt, beide Prices (monthly, yearly) in der Liste
   - Proration-Verhalten wie gewünscht (Stripe-Default: anteilig)
   - Kündigung weiterhin „zum Periodenende“
4. **Keine bestehenden Prices löschen.** Die alte Monats-Price ist die
   Basis für den Referral-Bonus und für alle laufenden Abos.

Nichts davon tut der Code; WERKRUF legt in Stripe nichts an.

---

## Teil 2 — Betriebsferien-Pause

### Semantik

> Betriebsferien pausieren WERKRUFs operative Kommunikation — nicht die
> Abrechnung.

Pause ist ein **Kommunikationszustand**, kein Datenzustand und keine
Billing-Pause. Copy sagt das („Dein Abo und die Abrechnung laufen dabei
normal weiter.“) und meidet „Abo pausieren“, „Zahlung pausieren“,
„keine Kosten“.

### Datenmodell

`user_profiles`: `pause_from date`, `pause_until date` (inklusiv,
Kalendertage Europe/Berlin), `pause_reason text`. Constraint: beide
null oder beide gesetzt, `until >= from`, `until − from <= 56`.
Account-weit — mehrere Standorte teilen die Pause; standortbezogene
Ferien sind bewusst nicht Teil von WP13.

**Maximal 56 Tage (8 Wochen):** längste übliche Betriebsferien im
Handwerk sind Sommer (3–4 Wochen) und Weihnachten/Neujahr (2–3 Wochen);
8 Wochen deckt beides mit Reserve und verhindert „für immer pausiert“.

### Die eine Wahrheit

`is_account_paused(user, now)` (SQL, service_role) —
`(now at time zone 'Europe/Berlin')::date between pause_from and pause_until`.
Dieselbe Regel im Client: `istPausiert()` in `src/utils/betriebsferien.js`.
**Kein Cron**: nach `pause_until` ist das Konto von selbst wieder aktiv.

### Was ruht, was läuft

| ruht | läuft weiter |
|---|---|
| Wochenmail (`weekly_email`) — inkl. WP9-Feiertagserinnerung, die darin reist | kritische Sofortmeldungen (`immediate_alert`: kritische Bewertung, kritische Profiländerung prio ≥ 80) |
| Abwesenheitserinnerung (`inactivity_reminder`) | `connection_broken`, `trial_reminder`, `trial_ended`, `payment_failed`, `consent_reminder`, `support_reply` |
| | Google-Sync, Performance-Sync, Engine-Auswertung |
| | Dashboard inkl. Tasks (nichts wird resolved) |
| | Stripe-Abrechnung |

Umgesetzt in `plan_communications` (eine Fassung, WP8-Kopie + drei
Zeilen): `v_pausiert` → Kanal 2 und 3 antworten
`send=false, reason='Betriebsferien — normale Kommunikation pausiert'`;
Kanal 1 kennt die Variable nicht. Rückgabe trägt `paused`.

### Schreibpfad (Kanon: kein Client-RPC)

| Route (google-business) | Auth | Tut |
|---|---|---|
| `POST /account/pause` `{ von, bis }` | JWT + `requirePaidAccess` | `pruefePause` → `account_pause_set(user, from, until)` (prüft erneut `has_paid_access`, nicht rückwirkend, from ≤ until, ≤ 56 Tage) → Audit `account.pause_started` |
| `POST /account/pause-end` | JWT | `account_pause_end(user)` → Audit `account.pause_ended` |

Free: kein Knopf (`Betriebsferien` rendert nichts) **und** Server 402.

### UI

- Settings → Karte „Betriebsferien“: Erklärung, Von/Bis, „WERKRUF
  pausieren“; aktiv/geplant: Zeitraum + „Pause beenden“.
- Dashboard oben (`PauseHinweis`): „WERKRUF ist bis 03.01.2027 pausiert.
  Normale Aufgaben und Wochenmails ruhen. Kritische Hinweise bleiben
  aktiv. [Pause beenden]“ — nur während der Pause.
- Admin Support-Snapshot: Abrechnung (monatlich/jährlich), Betriebsferien
  (pausiert bis / geplant / nein).

---

## Tests

- `src/jahresaboPause.test.js` (27): T1–T4 Mapping/400/keine Price-ID,
  T5–T8 Trial, T9–T11 Billing Truth + FP, T12–T15 Referral, T16–T20
  Pause-Regeln, T27/T28 zeitbasiert, T29/T30 UI, Mail-Gate-Quelle,
  Admin, Audit.
- `supabase/tests/jahresabo_betriebsferien.test.sql`: Intervall-Check,
  T16–T20 (Pro/FP/Free/Grenzen/Constraint), T21–T24 Wirkung in
  `plan_communications` (weekly + inactivity ruhen, zwei Sofortalarme
  bleiben), T27/T28, Multi-Location + Nachbar, Rechte.
- Angepasst: `billingAudit.test.js` (zwei Pläne, Price-Prüfung in
  `tarife.js`), `freeDowngrade.test.js` (Preis erscheint auch in der
  Tarifwahl), `empfehlung.test.js` (Slice-Grenze).

## Gegenproben (alle rot → Original grün)

C1 yearly → monthly-ENV · C2 Price-ID vom Client · C3 yearly zweiter
Trial · C4 Jahresabo → 490 € Reward · C5 Pause unterdrückt critical · C6
Pause fasst Sync an · C7 Pause ohne Ende (Client + Constraint) · C8 Free
darf Pause (Client, Server-Gate, SQL) · C9 Pause-Ende nicht zeitbasiert

## Deploy-Reihenfolge

1. Stripe: Jahres-Price anlegen, `STRIPE_PRICE_YEARLY` als Secret (Test + Prod).
2. Merge → Migration `20261112090000_jahresabo_betriebsferien.sql`
   (`NOTICE [wp13] in Ordnung`).
3. Functions `create-checkout-session`, `stripe-webhook`,
   `google-business`, `admin-ops` (automatisch).
4. Frontend (Vercel, ggf. „Promote to Production“).
5. Customer Portal prüfen (oben).

Ohne `STRIPE_PRICE_YEARLY` antwortet der Checkout bei `yearly` mit 500
„Preis nicht konfiguriert“; monthly läuft unverändert.

## Smoke — Jahresabo (Test-Modus)

1. `STRIPE_PRICE_YEARLY` gesetzt.
2. Neuer Testuser → Dashboard → ProGate/Settings: Tarifwahl zeigt 49 € / Monat und 490 € / Jahr (2 Monate geschenkt).
3. „Jährlich“ wählen → Checkout.
4. Stripe-Checkout zeigt 490,00 € / Jahr.
5. 30 Tage Trial sichtbar.
6. Nach Abschluss: `user_profiles.stripe_billing_interval = 'year'`, `plan`, `trial_ends_at` gesetzt.
7. Settings: „Danach 490 € / Jahr“; nach Trial-Ende „490 € / Jahr · Verlängert sich am …“.
8. „Abo & Zahlungen verwalten“ öffnet das Portal; Wechsel monthly ↔ yearly sichtbar.
9. Ehemaliger Nutzer wählt yearly → kein Trial (`trial_grund` in Metadaten).
10. Referral-Kette mit yearly-Geworbenem → Rewards **4.900**, nicht 49.000; Audit `referral.converted` mit `priceId` der Monats-Price.

## Smoke — Pause

1. Pro-Kunde → Settings → Betriebsferien.
2. Von heute bis +14 Tage → „WERKRUF pausieren“.
3. Dashboard zeigt den Hinweis oben; Tasks weiterhin sichtbar.
4. `select public.plan_communications('<user>')` → `paused: true`, `weekly_email`/`inactivity_reminder` `send: false` mit Grund „Betriebsferien …“.
5. Kritisches Testevent (`review.negative_unanswered`, prio 95) → `immediate_alert send: true`.
6. `schedule_communications('weekly_email')` am Montag → keine Mail für diesen Kunden.
7. Sync-Jobs laufen weiter (`sync_jobs` neue Einträge), Engine-Events entstehen weiter.
8. Zweiter Standort desselben Accounts → ebenfalls keine Wochenmail.
9. Nachbar-Account → Wochenmail normal.
10. „Pause beenden“ → Hinweis verschwindet, `plan_communications` wieder normal.
11. Free-Testuser → keine Karte; `POST /account/pause` → 402.
12. Audit: `account.pause_started`, `account.pause_ended`.
