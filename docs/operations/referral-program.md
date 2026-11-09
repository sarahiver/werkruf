# Empfehlungslink und Referral-Bonus (WP10)

Ein Kunde empfiehlt WERKRUF mit seinem persönlichen Link. Wird der
Geworbene zahlender Pro-Kunde, bekommen **beide einen Monat
kostenlos**. Kein Affiliate, keine Provision, keine Auszahlung —
eine Gutschrift auf die nächste Rechnung, sonst nichts.

## 1. Produktregel

- Belohnung erst bei **echter Conversion**: erste Stripe-Rechnung mit
  `amount_paid > 0` (Event `invoice.paid`). Signup, Trial-Start,
  `checkout.session.completed` und 0-€-Rechnungen zählen nicht.
- Beide Seiten je **ein Monatsbetrag** = der **reguläre Monatsbetrag
  der Subscription-Price** (`price.unit_amount`, Währung aus der Price).
  **Nicht** der Betrag der ersten Rechnung: mit Promotion-Code wäre
  `amount_paid` z. B. 2.450 Cent — „ein Monat kostenlos“ sind aber
  4.900. `invoice.paid` mit `amount_paid > 0` bestätigt nur die echte
  Conversion; die Höhe kommt aus der Subscription.
- Der Trial des Geworbenen bleibt unverändert (WP7-Regel
  `entscheideTrial` unangetastet). Kein zweiter Trial über Referral.
- Keine Namen: der Geworbene sieht nur „Du wurdest von einem
  WERKRUF-Nutzer eingeladen“; der Werber sieht Zähler, keine
  Personen.

## 2. Eligibility — wer bekommt einen Link

`ensure_referral_code(uuid)`: ein Link entsteht erst, wenn der Account
mindestens einen aktiven Google-Standort hat (`google_locations`,
`deleted_at is null`). Pro, Founding Partner und Free (ehemalige
Kunden kennen das Produkt) dürfen empfehlen; ein frischer Account ohne
Betrieb bekommt `{ eligible: false, reason: 'kein_standort' }` und in
den Einstellungen den Satz „Deinen persönlichen Link bekommst du,
sobald ein Google-Betrieb verbunden ist.“

## 3. Code

- Tabelle `referral_codes`: ein Code je Nutzer, `^[A-Za-z0-9]{10}$`,
  aus `md5(gen_random_uuid()…)` → Base64 → alphanumerisch gekürzt.
  Keine UUID, keine Mail, nichts aus der User-ID (Test T2, Gegenprobe
  C7).
- Widerruf (`revoke_referral_code`): `active=false`, der Link ist tot;
  der nächste Aufruf erzeugt einen neuen Code. Bestehende Referrals
  hängen an `referral_code_id`, nicht am Text — sie bleiben.
- URL: `https://werkruf.com/empfehlen/<code>`.

## 4. Kein Client-RPC — der Kanon

Die Rechte-Kanon-Migrationen (`20261014120000`, `20261014130000`)
lassen `anon`/`authenticated` genau fünf Definer-RPCs. WP10 fügt
**keinen** hinzu. Alle WP10-Funktionen sind `service_role`-only; der
Client spricht mit der Edge Function `google-business`:

| Route | Auth | Tut |
|---|---|---|
| `GET /referral/code` | JWT (`requireUser`) | `ensure_referral_code(user)` + `referral_summary_for(user)` → `{ code, eligible, reason, summary }` |
| `POST /referral/revoke` | JWT | `revoke_referral_code(user)`, Audit `referral.code_revoked` |
| `GET /referral/lookup?code=` | öffentlich | Formprüfung, dann `referral_code_gueltig(code)` → `{ valid }` — nur ja/nein |

Der Nutzer kommt immer aus dem JWT, nie aus Body oder Query. Kein
`requirePaidAccess` auf diesen Routen (Eligibility ist der Standort,
nicht das Abo). RLS auf den drei Tabellen bleibt als zweite Schicht
(eigene Zeilen lesbar, nichts schreibbar); der Client nutzt sie nicht.

## 5. Zuordnung beim Signup (serverseitig)

1. Landingpage `/empfehlen/<code>` → Lookup → bei `valid` wird der Code
   30 Tage in `localStorage` (`werkruf.referral`) gemerkt. **First
   wins** auch hier: ein späterer Link überschreibt nicht.
2. `Signup.js` gibt `meta.referral_code` an `supabase.auth.signUp`
   mit. Das ist nur ein *Hinweis* — gewährt nichts.
3. Trigger `on_user_profile_created_referral` (AFTER INSERT auf
   `user_profiles`) liest `raw_user_meta_data->>'referral_code'`,
   prüft aktiven Code, schließt Selbst-Empfehlung aus und legt
   `referrals(status='signed_up')` an. Kein oder ungültiger Code →
   nichts, still.
4. `referred_user_id` ist `unique` → ein Nutzer hat höchstens ein
   Referral (first valid wins). Der Trigger läuft nur bei INSERT —
   bestehende Nutzer werden nie nachträglich zugeordnet (T9).
5. Selbst-Empfehlung: Check-Constraint `referrals_kein_selbst` **und**
   Trigger-Ausschluss. Ohne den Trigger-Ausschluss würde der
   Constraint das Signup selbst abbrechen (Gegenprobe C1).

Warum `localStorage` und kein httpOnly-Cookie: WERKRUF ist eine SPA
ohne eigenen HTTP-Server vor dem Frontend; die Edge Functions laufen
auf einer anderen Domain. Der Träger ist manipulierbar — die Wahrheit
entsteht ausschließlich im Trigger.

## 6. Conversion — `invoice.paid`

`stripe-webhook` behandelt `invoice.paid`:

- Relevanz: `customer`, `subscription`, `amount_paid > 0`
  (`istEchteConversion` in `src/utils/referralBetrag.js`). Sonst
  `ignored` (Trial-Rechnung, Einmalzahlung).
- Profil über `stripe_customer_id`; dann **erst** prüfen, ob für diesen
  Kunden ein Referral (`signed_up` oder `converted`) existiert — sonst
  endet der Pfad hier, ohne Stripe-Aufruf.
- Noch `signed_up` → **Monatsbetrag bestimmen**:
  `stripe.subscriptions.retrieve(subId)` → genau ein Item mit
  `price.type = recurring`, `interval = month`, `interval_count = 1`,
  `quantity = 1`, `unit_amount > 0` → `amountCents = unit_amount`,
  `currency = price.currency` (`monatsbetragAusSubscription`). Nicht
  eindeutig (kein/mehrere Monatspreise, Jahrespreis, Menge ≠ 1) →
  `handlerError` → 500 → Stripe stellt erneut zu; **nichts** wird
  konvertiert, kein Reward entsteht, kein Fallback auf `amount_paid`,
  keine feste Cent-Heuristik.
- `referral_mark_converted(user, invoice_id, amountCents, currency)`:
  nur `signed_up → converted` (`converted_invoice_id unique`); Werber
  gelöscht → `invalid`; legt **genau zwei** `referral_rewards`
  (`unique(referral_id, beneficiary)`) mit diesem Betrag an, Werber mit
  Plan `founding_partner` → `not_applicable`.
- Danach — und ebenso bei jeder **erneuten** Zustellung, wenn das
  Referral schon `converted` ist — `referral_rewards_pending_for_referral`
  → `wendeRewardsAn` (§7). Zweite Rechnung: `kein_offenes_referral`,
  keine neuen Rewards; `stripe_events` (Event-ID PK) ist die erste
  Idempotenzschicht.
- `invoice.paid` ändert **nie** den Plan.

## 7. Reward — Stripe Customer Balance, retryfähig

`wendeRewardsAn()` im Webhook, aufgerufen nach `invoice.paid` (auch
bei Wiederzustellung) und bei `customer.subscription.created`:

- Für jedes `pending` Reward mit Stripe-Kunde und Plan ≠ FP:
  1. `stripe.customers.listBalanceTransactions(customer, {limit: 100})`
     — gibt es schon eine Gutschrift mit `metadata.werkruf_reward_id =
     reward.id`? Dann wird **diese** wiederverwendet, keine neue Buchung.
  2. Sonst `createBalanceTransaction(customer, { amount: -amount_cents,
     currency, metadata: { werkruf_reward_id } })` mit
     **`idempotencyKey: werkruf-referral-reward-<reward.id>`**.
  3. **Erst nach Stripe-Erfolg** → `referral_reward_set_status(id,
     'applied', cbtxn_id)` (löscht `last_error`) + Audit
     `referral.reward_applied`.
- Stripe verrechnet das Guthaben automatisch mit der nächsten Rechnung —
  ein Monatsbetrag = ein Monat gratis, stapelbar, ohne Coupon, ohne
  Trial-Verlängerung, ohne Rückerstattung.
- **Stripe-Fehler (Timeout, 429, 5xx, Netz) sind nicht terminal.** Der
  Reward bleibt `pending`; `referral_reward_versuch_notieren` schreibt
  `attempt_count`, `last_attempt_at`, `last_error`; der Webhook meldet
  `handlerError` → Claim in `stripe_events` freigegeben → 500 → Stripe
  stellt das Event erneut zu (bis zu 3 Tage) → derselbe Reward wird mit
  demselben Key erneut versucht. Weitere Retry-Pfade: jede weitere
  `invoice.paid` dieses Geworbenen (Referral `converted`, Rewards
  `pending` → werden angewendet) und `customer.subscription.created`
  des Werbers. Kein Cron, kein Job-System.
- `failed` bleibt im Constraint, wird vom Webhook aber nicht mehr
  gesetzt; terminal sind nur fachliche Zustände: `not_applicable` (FP
  zum Zeitpunkt der Conversion), `invalid` (FP beim Anwenden,
  Nutzer gelöscht).
- Statuswechsel nur aus `pending` (T8/T25): ein zweiter `applied`
  ändert nichts, die Stripe-ID bleibt; `applied` wird nie erneut
  angewendet.
- **Founding Partner als Werber**: `not_applicable` — nie eine
  Gutschrift, nie `trial_end`; der Geworbene bekommt seinen Bonus
  trotzdem.
- **Free-Werber** (gekündigt): Reward `pending`, kein Versuch, kein
  Verfall. Neues Abo (`customer.subscription.created`) → Nachholung.

### Stripe-Konfiguration — nur dokumentiert, nicht ausgeführt

Nichts in Stripe wird von WERKRUF angelegt oder geändert (kein Coupon,
kein Product, kein Price). Genau ein Dashboard-Schritt ist nötig:

> **Developers → Webhooks → Endpunkt `stripe-webhook` → Events
> hinzufügen → `invoice.paid`.** Fehlt das Event, kommt es nie an,
> und kein Referral wird je `converted`. Prüfbar im Webhook-Log
> (Event-Typ `invoice.paid`, Antwort `200`) und in `stripe_events`.

## 8. Idempotenz — fünf Schichten

1. `stripe_events(id)` PK — jedes Stripe-Event einmal; bei
   Handler-Fehler wird der Claim freigegeben, damit der Retry läuft.
2. `referral_mark_converted` wechselt nur `signed_up → converted`;
   `converted_invoice_id unique`.
3. `referral_rewards unique(referral_id, beneficiary)` — nie ein
   drittes Reward.
4. Stripe-Idempotency-Key = Reward-ID — derselbe Key liefert dieselbe
   Transaktion zurück (24 h). Deckt „Stripe ok, DB-Update scheiterte“:
   der Retry bekommt dieselbe Transaktion und setzt dann `applied`.
5. Metadata-Suche `werkruf_reward_id` in den Balance-Transaktionen des
   Kunden — greift auch jenseits der 24 h des Keys. Nie ein Doppelcredit.

## 9. Fraud-Schutz

- Self-Referral: Constraint + Trigger (§5).
- Mehrfach-Accounts: ein Referral pro Geworbenem (unique), Belohnung
  nur bei bezahlter Rechnung — ein Trial-Account kostet den Angreifer
  Geld, bevor etwas gutgeschrieben wird.
- Code allein gewährt nichts; kein Rabatt an der Kasse, kein
  Trial-Bonus.
- Code nicht ableitbar, Lookup liefert nur `valid`.
- Werber-Reward nur bei Plan ≠ FP und nur per Stripe-Guthaben —
  keine Auszahlung möglich.

## 10. Account-Löschung

FKs bewusst **nicht** alles kaskadierend (Billing-Historie bleibt):

- `referral_codes.user_id` → cascade (Code weg).
- `referrals.referrer_user_id` / `referred_user_id` → `set null`;
  Trigger: Geworbener weg und `signed_up` → `invalid`; `converted`
  bleibt.
- `referral_rewards.user_id` → `set null`; `pending` → `invalid`,
  `applied` bleibt (es wurde verdient und gebucht).
- `referral_rewards.referral_id` → cascade (Ledger hängt am Referral,
  das selbst nie kaskadiert gelöscht wird).

## 11. Support (Admin)

`admin-ops` Support-Snapshot lädt `referrals` (als Werber oder
Geworbener) und `referral_rewards` des Kunden; `baueSupportSnapshot`
liefert `empfehlungen: { geworbenVon, geworben[], rewards[] }`. Block
„Empfehlungen“ in `Admin.js` (`support-empfehlungen`). Keine
Massenabfrage, keine Mails.

## 12. Tests

- `src/empfehlung.test.js` (16): Codeform, Intent 30 Tage/first wins,
  Zahlen, Signup/Landing-Quelltext, Webhook-Regeln (nur `invoice.paid`
  > 0, Balance + Idempotency-Key, FP, Free-Nachholung, Trial-Schutz),
  Einstellungen-Komponente, Kanon (kein Client-RPC, Nutzer aus JWT,
  Lookup nur boolean).
- `src/referralBetrag.test.js` (17): Monatsbetrag aus der Price (T1,
  Rabattfall T2, 0 € T3, unklar T4, Währung T5), Retry (T6–T9: pending
  bleibt, gleicher Key, Metadata-Wiederverwendung, Stripe vor DB,
  applied nie erneut), FP/Free (T10/T11), Conversion (T12–T15).
- `supabase/tests/referral_reward_retry.test.sql`: Versuch notieren,
  Erfolg löscht Fehler, applied unveränderlich, pending_for_referral,
  Rechte.
- `supabase/tests/empfehlungslink.test.sql`: T1/T2/T3/T36 Code, T6–T10
  Zuordnung (inkl. Selbst-Empfehlung über Signup-Pfad), T13–T25
  Conversion/Rewards/Statuswechsel, T17 FP, T18 Free, T32–T35 Rechte
  (Wirkung unter `set local role`), Löschung.
- Gegenproben (alle rot, dann Original wieder grün): C1 Trigger-
  Selbstschutz weg, C1b Constraint weg, C2 `referred_user_id` nicht
  unique, C3 Betrag 0 konvertiert, C4 Wiederholung erzeugt Rewards,
  C5 FP bekommt Gutschrift, C6 Free-Reward verfällt, C7 Code aus
  User-ID, C8/C8b anon liest / RLS zu weit, C9 Reward-Unique weg, C10
  Werber-Löschung kaskadiert, C12/C13 Client-RPC für authenticated/anon,
  Webhook: Trial-Rechnung konvertiert, Idempotency-Key ohne Reward-ID,
  FP-Gutschrift, `checkout.session.completed` konvertiert.

## 13. Smoke-Test (nach Deploy, Test-Modus)

1. Pro-Kunde A mit Standort → Einstellungen → Karte „WERKRUF
   weiterempfehlen“ zeigt Link `…/empfehlen/<10 Zeichen>`.
2. Link kopieren; Zahlen: 0 eingeladen, 0 Pro, 0 Gratis-Monate.
3. Inkognito: Link öffnen → Startseite mit Band „Du wurdest … eingeladen“.
4. Falscher Code `/empfehlen/ZZZZZZZZZZ` → Startseite ohne Band.
5. Inkognito: Signup als B → `referrals` hat Zeile A→B `signed_up`.
6. A: Zahlen zeigen „1 Kollege eingeladen“, 0 Pro, 0 Gratis-Monate.
7. B: Trial läuft normal (30 Tage, WP7-Regel). `referral_rewards` leer.
8. B: Checkout (Stripe Test) → `checkout.session.completed` → kein
   Reward, Status bleibt `signed_up`.
9. Stripe Test-Uhr oder `invoice.paid` mit `amount_paid > 0` → Referral
   `converted`, zwei Rewards `applied` mit `amount_cents = 4900`, Audit
   `referral.converted` (mit `rewardAmountCents`, `priceId`) + 2×
   `referral.reward_applied`.
9b. Variante mit Promotion-Code (Test-Modus, z. B. 50 %): `amount_paid`
   2450 → Rewards trotzdem **4900**.
10. Stripe: Kunde A und Kunde B haben je ein negatives Customer
    Balance in Höhe des regulären Monatsbetrags (−49,00 €).
11. A: „1 davon nutzt Pro“, „1 Gratis-Monat verdient“.
12. Webhook-Event erneut senden (Stripe „Resend“) → keine neuen
    Rewards, keine zweite Balance-Transaktion.
13. Zweite Rechnung von B → nichts Neues.
14. C (Founding Partner) wirbt D → D zahlt → D hat Guthaben, C hat
    `not_applicable`, keine Balance-Transaktion für C.
15. E (Free, gekündigt) wirbt F → F zahlt → E-Reward `pending`; E
    schließt neues Abo → Reward `applied` beim
    `customer.subscription.created`.
16. B löschen → Referral bleibt `converted`, A-Reward bleibt `applied`.
17. G (ohne Standort): Einstellungen zeigen Hinweis statt Link.
18. H meldet sich ohne Link an → keine `referrals`-Zeile.
19. Kein Link eines Nutzers enthält dessen UUID oder Mail.
20. Admin → Support → Kunde A → Block „Empfehlungen“ zeigt Referral
    und Rewards.
21. `select proname from pg_proc where proname like 'referral%' or
    proname in ('ensure_referral_code','revoke_referral_code')` —
    keine davon für `anon`/`authenticated` ausführbar.

## 14. Deploy-Reihenfolge

1. Migrationen `20261111090000_empfehlungslink.sql` und
   `20261111120000_referral_reward_retry.sql` (Actions → Apply Supabase
   migrations). Selbstprüfungen `[wp10] in Ordnung`, `[wp10-retry] in
   Ordnung`.
2. Functions `google-business`, `stripe-webhook`, `admin-ops`
   (automatisch beim Merge).
3. Frontend (Vercel, ggf. „Promote to Production“).
4. Stripe-Dashboard: `invoice.paid` am Webhook-Endpunkt aktivieren (§7).
5. Smoke-Test §13 im Test-Modus.
