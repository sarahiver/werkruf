/*
 * Produktzugang — die eine Regel.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE DATEI DIE WAHRHEIT IST
 * ═══════════════════════════════════════════════════════════════
 *
 * Vor H1 existierte dieselbe Regel viermal:
 *
 *   src/utils/subscription.js                          (Frontend)
 *   supabase/functions/google-business/index.ts:622    (requirePaidAccess)
 *   supabase/functions/generate-review-reply/index.ts:858  (dito)
 *   supabase/functions/stripe-webhook/index.ts:128     (die Umkehrung)
 *
 * Die beiden Edge-Function-Kopien waren Byte fuer Byte gleich bis auf
 * einen Zeilenumbruch — es war also kein Driftproblem, sondern ein
 * VERGESSENSPROBLEM. Und zweimal vergessen worden:
 *
 *   handleAttributesUpdate (google-business/index.ts:6926) hatte kein
 *   Gate und schrieb bei Google.
 *
 *   Der Action-Link-Pfad prueft den Plan nirgends und gibt einen
 *   Magic-Link aus (google-business/index.ts:6495).
 *
 * Ein Mechanismus, der vergessen werden kann, wird vergessen. Deshalb
 * steht die Regel ab jetzt hier, und supabase/functions/_shared/access.ts
 * importiert sie. Das Repo tut das schon an anderer Stelle:
 * google-business importiert src/utils/actionToken.js,
 * request-profile-report importiert src/utils/visibilityScore.js.
 *
 * Kein Rollenframework, keine Feature-Flag-Plattform (§20) — eine
 * Datei, zwei Laufzeiten.
 */

const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Darf dieser Nutzer die bezahlten Funktionen benutzen?
 *
 * Die Reihenfolge der Zweige ist nicht beliebig — sie ist der Kern.
 *
 * 1. founding_partner ZUERST.
 *
 *    Vor H1 stand der Stripe-Zweig vorne, und das haette
 *    founding_partner von Anfang an gebrochen: ein Betrieb, der
 *    FRUEHER einmal eine Subscription hatte, traegt weiter
 *    stripe_subscription_id. Der Stripe-Zweig haette dann
 *    PAID_STATUSES.has('canceled') ausgewertet — false — und dem
 *    Founding Partner den Zugang verweigert, obwohl sein plan
 *    'founding_partner' ist.
 *
 *    Genau dieser Fall ist in §23 des Auftrags beschrieben, und er
 *    ist kein Randfall: die ersten Founding Partner werden
 *    wahrscheinlich bestehende Nutzer sein.
 *
 *    founding_partner ist ausserdem per Definition nicht von Stripe
 *    abhaengig (§17: "Stripe nicht erforderlich"). Ein Entitlement,
 *    das eine Zahlungsquelle befragt, ist keines.
 *
 * 2. Dann Stripe, wenn es eine Spur davon gibt. Der Status bei
 *    Stripe ist die Wahrheit ueber eine Zahlung, nicht das
 *    denormalisierte plan-Etikett.
 *
 * 3. Dann der Altbestand.
 *
 * @param {object|null} profile Zeile aus public.user_profiles
 * @param {Date} now Vergleichszeit, injizierbar fuer Tests
 * @returns {boolean}
 */
export function hasPaidAccess(profile, now = new Date()) {
  if (!profile) return false;

  /* 1 — Founding Partner. Vor allem anderen. */
  if (profile.plan === 'founding_partner') return true;

  /* 2 — Stripe */
  if (profile.stripe_subscription_id || profile.stripe_subscription_status) {
    return PAID_STATUSES.has(profile.stripe_subscription_status);
  }

  /* 3 — Altbestand.
     'trial' ist heute toter Code: user_profiles_plan_check erlaubt
     den Wert nicht (geprueft in Produktion am 13.10.2026). Der Zweig
     bleibt stehen, weil ihn zu entfernen eine eigene Entscheidung
     ist — zusammen mit schedule_lifecycle_emails, das auf
     plan = 'trial' filtert und deshalb nie eine Zeile findet, und
     update_user_plan, das 'trial' erlaubt und damit gegen den
     Constraint laeuft. Drei Stellen, ein Befund, nicht H1. */
  if (profile.plan === 'trial') {
    const trialEnd = profile.trial_ends_at && new Date(profile.trial_ends_at);
    return Boolean(trialEnd && !Number.isNaN(trialEnd.getTime()) && trialEnd > now);
  }

  return profile.plan === 'pro';
}

/**
 * Ist dieser Zugang ein Founding-Partner-Zugang?
 *
 * Fuer Kommunikation und Auswertung, nicht fuer Zugriffsentscheidungen —
 * dort gilt hasPaidAccess. Getrennt, damit niemand auf die Idee
 * kommt, Founding Partner in einer Zahlungsauswertung mitzuzaehlen
 * oder ihnen eine Zahlungserinnerung zu schicken.
 */
export function isFoundingPartner(profile) {
  return profile?.plan === 'founding_partner';
}

/**
 * Hat ein Founding Partner parallel noch ein AKTIVES Stripe-Abo?
 *
 * Der Unterschied zu "hat irgendwann einmal gezahlt" ist der, auf den
 * es ankommt. Ein Founding Partner mit stripe_customer_id und
 * canceled-Abo zahlt nichts mehr; da gibt es nichts zu verwalten und
 * nichts zu melden. Laeuft dagegen noch eine Subscription, wird ihm
 * gerade Geld abgebucht, obwohl sein Zugang kostenlos ist.
 *
 * H2.2 §16: "Wenn ein aktives Altabo parallel existiert, dokumentiere
 * den Zustand statt ihn still zu ignorieren." Genau dafuer ist diese
 * Funktion da — sie entscheidet keinen Zugang und loest keine Zahlung
 * aus, sie macht den Zustand sichtbar.
 *
 * Kein Stripe-Migrationsfeature (§16: ausdruecklich nicht bauen). Die
 * Kuendigung macht der Kunde im Portal oder wir im Stripe-Dashboard.
 */
export function hatAktivesStripeAltabo(profile) {
  if (!isFoundingPartner(profile)) return false;
  return PAID_STATUSES.has(profile?.stripe_subscription_status);
}

/**
 * Laeuft der bezahlte Zugang zum Periodenende aus?
 *
 * Ein Founding Partner kann das nicht: er hat keine Periode. Haette
 * er noch ein stripe_cancel_at_period_end aus seiner Zeit als
 * Zahler, waere die Antwort sonst falsch.
 */
export function isCancellationScheduled(profile) {
  if (isFoundingPartner(profile)) return false;
  return hasPaidAccess(profile) && profile?.stripe_cancel_at_period_end === true;
}

/**
 * Bekommt dieser Nutzer operative Kommunikation — Weekly und
 * Critical Alerts?
 *
 * §25/§26: operative Mails nur fuer pro und founding_partner. Ein
 * free-Nutzer bekommt sie nicht, weil die Handlungsaufforderungen
 * darin auf Seiten hinter ProGate zeigen (/dashboard/bewertungen,
 * /fotos, /kunden-gewinnung). Eine Mail "Jetzt antworten", die auf
 * eine Bezahlschranke fuehrt, ist ein gebrochenes Versprechen.
 *
 * Identisch zu hasPaidAccess — absichtlich als eigener Name, nicht
 * als Alias: "darf er die Funktion benutzen" und "soll er eine Mail
 * bekommen" sind zwei Fragen, die heute dieselbe Antwort haben und
 * morgen auseinandergehen koennen (etwa eine Willkommensserie fuer
 * free). Wer das aendert, aendert dann genau eine Funktion und sieht
 * an ihrem Namen, was er anfasst.
 */
export function wantsOperationalMail(profile, now = new Date()) {
  return hasPaidAccess(profile, now);
}
