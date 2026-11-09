# Free-Downgrade und Pro-Wiedereinstieg (WP7)

> **Free zeigt dir den Zustand. Pro hilft dir, ihn laufend zu verbessern.**

Free ist kein Tarif, den wir bewerben. Es ist der Zustand nach Trial-
oder Pro-Ende: der Account bleibt, die Google-Verbindung bleibt, der
Score bleibt sichtbar — und eine neue kritische Bewertung darf den
Kunden zurückholen.

## 1. Eine Access-Wahrheit

| Ebene | Funktion | Datei |
|---|---|---|
| Frontend | `hasPaidAccess()`, `accessTier()` | `src/utils/subscription.js` |
| Edge Functions | `leseAccess()` → importiert dieselbe Datei | `src/utils/accessGate.js` |
| SQL (Mail-Gates) | `has_paid_access()`, `access_tier()` | Migrationen 20261013130000, 20261110090000 |

`accessTier(profile)` → `founding_partner` \| `pro` \| `free`.
Invariante (getestet): `hasPaidAccess(p) === (accessTier(p) !== 'free')`.

### Statusregeln

| Zustand | Stufe | Warum |
|---|---|---|
| `plan = 'founding_partner'` | **founding_partner** | vor allem anderen — Stripe egal, auch bei `canceled` |
| `trialing` | pro | |
| `active` | pro | |
| `active` + `cancel_at_period_end = true`, Periode läuft | **pro** | bezahlt bis Periodenende; Free kommt erst mit `customer.subscription.deleted` |
| `past_due` | pro | bewusste Dunning-Entscheidung (Stripe mahnt); unverändert aus H2.2 |
| `canceled` (nach Periodenende) | free | |
| Trial abgelaufen ohne Zahlung (`canceled`) | free | |
| `unpaid`, `incomplete`, `incomplete_expired`, `paused` | free | kein Lockout — Free-Dashboard funktioniert |
| kein Profil | free | |

Der Client erfindet Access nie aus Stripe-Feldern; er liest das Profil
und wendet dieselbe Funktion an.

## 2. Was Free sieht und was nicht

**Free (lesen):** Übersicht mit WERKRUF-Score und Zustandsbanner,
Betrieb + Google-Verbindungsstatus (`/dashboard/google`), Einstellungen
(Abo, Konto, Löschung). Pfadliste: `FREE_PFADE` in `src/utils/freeUmfang.js`.

**Pro (gegated, Client UND Server):**

| Funktion | Client-Gate | Server-Gate |
|---|---|---|
| Bewertungen, Antwortvorschläge, Veröffentlichen | `ProGate` an `/dashboard/bewertungen` | `requirePaidAccess` in `replies/update|approve|retract`; `leseAccess` in `generate-review-reply` |
| Fotos | `ProGate` | `media/create|delete` |
| Profil bearbeiten (Öffnungszeiten, Attribute) | – | `location/update`, `attributes/update` |
| Mehr Bewertungen (QR/Link) | `ProGate` | kein Schreibweg |
| Priorisierte Aufgaben | Übersicht zeigt Free den Statushinweis statt der Liste | – |
| Wochenmail, Abwesenheitserinnerung | – | `wants_operational_mail()` in `schedule_communications` |

Die Übersicht zeigt Free im Banner nur dann einen „Erledigen"-Knopf,
wenn das Ziel frei erreichbar ist (Verbindung erneuern, Betrieb wählen).

## 3. Kündigung: nichts geht verloren

Der Stripe-Webhook schreibt bei `customer.subscription.deleted` nur
`user_profiles.plan = 'free'`, `stripe_subscription_status = 'canceled'`,
`stripe_cancel_at_period_end = false`, `trial_ends_at = null`. Nichts
sonst. Google-Verbindung, Standorte, Bewertungen, Events, Tokens
bleiben (SQL-Test T11–T14). Kontolöschung ist weiter die bewusste
Funktion aus WP1.

Einstellungen bei `cancel_at_period_end`:
> Pro endet am 12. Dezember 2026. Danach nutzt du WERKRUF kostenlos im
> Free-Modus weiter — Profil und Score bleiben sichtbar.

Datum aus `stripe_current_period_end`. Kündigung zurücknehmen geht im
Stripe-Portal (bestehender Flow, keine eigene API).

## 4. Sync und Engine im Free-Modus

**Läuft weiter für Free** (gemessen, nicht angenommen): alle
Sync-Planer (`schedule_all_syncs`, `schedule_review_syncs`,
`schedule_performance_syncs`) filtern nach `google_accounts.status =
'active'`, nicht nach Plan. Standort/Profil, Bewertungen und
Performance werden weiter geholt. Die Engine (`engine-daily`,
`evaluate-all`) bewertet alle Konten.

Warum auch Performance: ein eigener Pro-Filter im Planer wäre eine
zweite Access-Regel an einer Stelle, die heute keine kennt; die
Google-Last ist 7 Anfragen je Standort und Tag. Sollte Quota je ein
Thema werden, ist `schedule_performance_syncs` die eine Stelle.

**Keine Aufgabenlawine beim Wiedereinstieg:** Events haben
`expires_at`/`resolved_at`; die Übersicht zeigt `events_feed` mit
`lifecycle in (new, seen, opened)` und Limit — also nur, was jetzt
gilt. Was Google inzwischen erledigt hat, ist `resolved`.

## 5. Kritische Bewertung als Wiedereinstieg

Die **eine** Ausnahme von „Free bekommt keine operative Mail".

```
Review-Sync → Engine: review.negative_unanswered (1–2 ★, unbeantwortet)
→ plan_communications(): immediate_alert, send=true      ← dieselbe Regel wie Pro
→ schedule_communications():
     Pro/FP  → critical_review_alert   („Jetzt antworten")
     Free    → critical_review_free    („Bewertung ansehen & mit Pro antworten")
→ mark_events_delivered(ids, 'notification')             ← derselbe Dedupe
→ send-email: ergaenzeSofortmailLink() → Action-Token    ← derselbe Token-Weg
→ Link → /einstieg → /dashboard/bewertungen?betrieb=…&review=…
→ ProGate (Free) mit Kontext → „Pro wieder aktivieren"
→ Checkout (returnPath) → Erfolg → zurück zur Bewertung
```

Kein zweites `rating <= 2`, kein zweiter Dedupe, keine zweite
Frequenzregel: Dedupe-Key `critical_free:<user>:<location>:<Stunde>`,
Vermerk `delivered.notification` am Event. Dieselbe Bewertung alarmiert
genau einmal (SQL T30).

Der Action-Token ist Navigation und Auth-Handoff, kein Access Grant:
`/einstieg` prüft Nutzer, Standort und Zielpfad — keinen Plan — und
setzt keinen. Hinter dem Link entscheidet `ProGate`, und jeder
Schreibweg prüft serverseitig `requirePaidAccess` (Jest §34, Gegenprobe C5/C9).

Mail-Copy: nennt Free, nennt 49 €/Monat, kein Trial-Versprechen, keine
Frist, kein „kostet dich Kunden".

Nicht geändert: `weekly_summary`, `inactivity_reminder` bleiben Pro/FP
(SQL T28/T29); `connection_broken` ging schon immer an alle.

## 6. Checkout: kein zweiter Gratis-Test

Vor WP7 bekam **jeder** Checkout `trial_period_days: 30`. Cancel/Rejoin
= beliebig viele freie Monate.

Jetzt (`src/utils/checkoutRegeln.js` → `entscheideTrial()`):

1. Stripe-Historie des Customers: `subscriptions.list({status: 'all', limit: 1})`
   → irgendeine Subscription je existiert → **0 Tage**.
2. Profil: `stripe_subscription_id` oder `-status` gesetzt → **0 Tage**.
3. Sonst **30 Tage**.

`trial_period_days` wird bei 0 gar nicht gesetzt. Deshalb darf am
Stripe-Price **kein** Trial konfiguriert sein (prüfen: Stripe →
Products → WERKRUF Pro → Price → „Free trial" leer). Die Function gibt
`trialTage` zurück; Oberfläche (`ProGate`, `FreeHinweis`, Einstellungen)
zeigt per `hatteSchonAbo()` dieselbe Unterscheidung: „30 Tage gratis
testen" vs. „Pro wieder aktivieren · 49 € / Monat".

## 7. Return-Flow

`ProGate` schickt `returnPath = pathname + search`. Die Function
validiert (`sichererRueckkehrpfad`: führender `/`, kein `//`, kein
Schema, kein Backslash, kein `javascript:`/`data:`, nur
`/dashboard[/…]`, ≤ 512 Zeichen) und baut
`success_url = /dashboard?checkout=success&session_id=…&zurueck=<pfad>`.
`DashboardLayout` wartet die Freischaltung ab (Profil-Polling bis
`hasPaidAccess`), prüft `zurueck` **erneut** und leitet dann weiter.
Externe URLs fallen auf `/dashboard` (Jest T23, Gegenprobe C8).

## 8. Support-Ansicht

Block „Billing" zeigt jetzt `Zugang: Free | Pro | Founding Partner`
(aus `accessTier()`), dazu wie bisher Status, Kündigung geplant,
Periodenende.

## 9. Deployment

1. Migration `20261110090000_free_downgrade_reentry.sql` (Actions →
   Apply Supabase migrations) — erwartet `NOTICE [wp7] in Ordnung`.
   Ändert: `access_tier()`, Template-Constraint, `schedule_communications`.
2. Functions `send-email`, `create-checkout-session` — automatisch
   durch den Deploy-Workflow beim Merge.
3. Frontend (Vercel) — automatisch; Production-Badge prüfen.
4. Stripe-Dashboard (nur prüfen, nichts anlegen): am Price kein Trial;
   Customer Portal erlaubt Kündigung „at period end" (bestehend).

Reihenfolge: Migration **vor** Merge-Deploy ist nicht nötig —
`send-email` toleriert die neue Vorlage erst nach der Migration (vorher
reiht `schedule_communications` sie nicht ein), und
`create-checkout-session` braucht keine DB-Änderung. Sicherer ist
trotzdem: Migration zuerst.

## 10. Smoke (manuell, Stripe-Testmodus)

**A — Pro kündigen:** Test-Pro aktiv → Einstellungen → Portal →
Kündigung zum Periodenende → App neu laden → Pro bleibt, Einstellungen
zeigen „Pro endet am …" → Google-Verbindung unverändert.

**B — Periodenende:** Stripe-Testclock oder Subscription im Dashboard
sofort beenden → Webhook `customer.subscription.deleted` → eingeloggt
bleiben → Dashboard lädt → Übersicht zeigt Score + „Du nutzt WERKRUF
Free." → `/dashboard/bewertungen` zeigt Gate „Pro wieder aktivieren"
(kein 30 Tage) → kein Re-Onboarding.

**C — Free-Alarm:** mit `EMAIL_DELIVERY_MODE=test` eine 1-★-Bewertung
über den Review-Sync hereinholen (oder Event `review.negative_unanswered`
in der Testdatenbank anlegen) → `schedule_communications('immediate_alert')`
→ `freeAlerts: 1`, Zeile `critical_review_free` → zweiter Lauf: 0 →
Mail-Link öffnen → Bewertungsseite mit Gate, Editor nicht erreichbar.

**D — Upgrade:** Gate → „Pro wieder aktivieren" → Checkout zeigt
**49 € sofort, keinen Trial** → Testkarte → Rückkehr auf
`/dashboard/bewertungen?betrieb=…&review=…` → Editor offen → Google
weiter verbunden.

**E — Founding Partner:** FP mit `canceled` Stripe → Dashboard voll,
keine Upgrade-Aufforderung, Sofortmeldung bleibt `critical_review_alert`.

## 11. Nicht Teil von WP7

Free-Navigation-Umbau, neue Tarife, Jahresabo, Lifecycle-Marketing für
Free, Review-Link-Tracking, Stripe-Konfiguration. `past_due`-Strategie
unverändert.
