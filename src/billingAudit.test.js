/*
 * Billing: der Ist-Zustand, festgeschrieben (Paket H2.1, §27).
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS DIESE DATEI IST
 * ═══════════════════════════════════════════════════════════════
 *
 * H2.1 war ein Audit: messen, nicht umbauen. Diese Datei hält fest,
 * was am 13.10.2026 gemessen wurde — damit es nicht unbemerkt
 * verrutscht, bevor die Entscheidungen aus dem Bericht getroffen
 * sind (docs/h2-1-billing-audit.md).
 *
 * Keine Wunschlogik. Jede Zusage hier beschreibt, was der Code HEUTE
 * tut, auch wo der Bericht das als Befund führt. Wo eine Zusage den
 * Befund festschreibt, steht das im Kommentar dabei.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER NICHT GEPRÜFT WIRD
 * ═══════════════════════════════════════════════════════════════
 *
 * Rechte auf Datenbankfunktionen. Der Produktionsdump im Repo ist mit
 * `--no-privileges` erzeugt (docs/testing/baseline-luecken.md §3):
 * Welche Rechte Produktion vergeben hat, steht nirgends im Repo, und
 * die Testdatenbank zeigt nur die PostgreSQL-Vorgaben plus die
 * Migrationen. Eine Zusage darüber wäre hier eine Behauptung über
 * eine Datenbank, die dieser Test nicht sieht.
 *
 * Deshalb prüft diese Datei bei update_user_plan nur, was im Repo
 * steht — und der Bericht nennt die Abfrage, mit der die Rechtefrage
 * in Produktion in zehn Sekunden geklärt ist.
 */
import fs from 'fs';
import path from 'path';

const wurzel = path.resolve(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

const CHECKOUT = lies('supabase/functions/create-checkout-session/index.ts');
const WEBHOOK  = lies('supabase/functions/stripe-webhook/index.ts');
const PORTAL   = lies('supabase/functions/create-portal-session/index.ts');
const REGEL    = lies('src/utils/subscription.js');

describe('A — Checkout: wie ein Abo heute startet', () => {

  it('übergibt 30 Testtage ausdrücklich an Stripe', () => {
    /* Der Kern des „30 Tage gratis"-Versprechens. Es hängt NICHT an
       der Price-Konfiguration im Stripe-Dashboard: Die Function setzt
       trial_period_days selbst. Fällt diese Zusage, wird am ersten Tag
       abgebucht, während die Oberfläche 30 freie Tage verspricht. */
    expect(CHECKOUT).toMatch(/const TRIAL_DAYS = 30;/);
    expect(CHECKOUT).toMatch(/trial_period_days: TRIAL_DAYS/);
  });

  it('prüft den konfigurierten Preis vor der Session', () => {
    /* Fail closed: Stimmen Betrag, Währung, Intervall oder
       Test/Live-Modus nicht, entsteht keine Session. Damit ist „49 €
       pro Monat" aus dem Repo belegt, obwohl die Price-ID extern
       liegt. */
    expect(CHECKOUT).toMatch(/prices\.retrieve\(priceId\)/);
    expect(CHECKOUT).toMatch(/unit_amount !== 4900/);
    expect(CHECKOUT).toMatch(/currency !== 'eur'/);
    expect(CHECKOUT).toMatch(/recurring\?\.interval !== 'month'/);
    expect(CHECKOUT).toMatch(/livemode !== usesLiveSecret/);
  });

  it('kennt genau einen Plan', () => {
    /* Die Oberfläche spricht an einer Stelle von quarterly/annual
       (useCheckout-Kommentar); die Function nimmt nur monthly und
       antwortet sonst mit 400. */
    expect(CHECKOUT).toMatch(/const VALID_PLANS: PlanKey\[\] = \['monthly'\];/);
  });

  it('lässt kein zweites Abo neben einem laufenden entstehen', () => {
    expect(CHECKOUT).toMatch(/const aktiveZustaende = \['active', 'trialing', 'past_due'\];/);
    expect(CHECKOUT).toMatch(/409/);
  });

  it('setzt die Metadaten auf Session UND Subscription', () => {
    /* Ohne die Subscription-Metadaten findet der Webhook den Nutzer
       nicht und ein gekündigtes Abo behielte den Zugang. */
    expect(CHECKOUT).toMatch(/subscription_data: \{\s*\n\s*metadata: sharedMetadata/);
  });

  it('erlaubt Gutscheincodes', () => {
    /* Befund, nicht Wunsch: Rabattcodes sind offen, und welche
       existieren, steht nur in Stripe. */
    expect(CHECKOUT).toMatch(/allow_promotion_codes: true/);
  });

  it('enthält keine Steuerkonfiguration', () => {
    /* Befund: automatic_tax ist nicht gesetzt, im Repo gibt es keine
       Umsatzsteuerbehandlung. Was Stripe daraus macht, ist extern. */
    expect(CHECKOUT).not.toMatch(/automatic_tax|tax_id_collection/);
  });
});

describe('F — Webhook: Event → Wirkung', () => {

  it('behandelt genau fünf Events', () => {
    /* Zweimal mein Fehler, bevor das stimmte: `case '…': {` liess
       customer.subscription.created weg (teilt die Klammer mit
       `updated`), und ohne Ausschnitt zaehlte dieselbe Suche die
       Stripe-STATUS aus mapStatusToPlan mit. Deshalb: nur der
       Ereignis-switch. */
    const anfang = WEBHOOK.indexOf('switch (event.type) {');
    const schalter = WEBHOOK.slice(anfang, WEBHOOK.indexOf('default:', anfang));
    const faelle = [...schalter.matchAll(/case '([a-z_.]+)':/g)].map((m) => m[1]);

    expect(anfang).toBeGreaterThan(-1);

    expect(new Set(faelle)).toEqual(new Set([
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ]));
  });

  it('behandelt Refund und Trial-Ende NICHT', () => {
    /* Befund (§16, §18): charge.refunded und
       customer.subscription.trial_will_end laufen in den
       default-Zweig und werden nur protokolliert. */
    expect(WEBHOOK).not.toMatch(/charge\.refunded|credit_note|trial_will_end/);
    expect(WEBHOOK).toMatch(/Nicht behandelt: \$\{event\.type\}/);
  });

  it.each([
    ['active', 'pro'],
    ['trialing', 'pro'],
    ['past_due', 'pro'],
  ])('%s → plan %s (Zugang bleibt)', (status, plan) => {
    const abbildung = WEBHOOK.slice(WEBHOOK.indexOf('function mapStatusToPlan'));
    expect(abbildung).toMatch(new RegExp(`case '${status}':\\s*(//[^\\n]*\\n\\s*)?return '${plan}'`));
  });

  it('nimmt bei canceled, unpaid und incomplete_expired den Plan weg', () => {
    const abbildung = WEBHOOK.slice(WEBHOOK.indexOf('function mapStatusToPlan'));
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'incomplete', 'paused']) {
      expect(abbildung).toMatch(new RegExp(`case '${status}':`));
    }
    expect(abbildung).toMatch(/return 'free'/);
  });

  it('liest den aktuellen Abo-Zustand aus Stripe, statt dem Event zu glauben', () => {
    /* Gegen Reihenfolgeprobleme: Ein verspätetes `created` kann so
       keinen Zugang wiederherstellen. */
    expect(WEBHOOK).toMatch(/await stripe\.subscriptions\.retrieve\(eventSub\.id\)/);
  });

  it('verlangt die Signatur und liest den Rohtext', () => {
    expect(WEBHOOK).toMatch(/constructEventAsync\(body, signature, webhookSecret\)/);
    expect(WEBHOOK).toMatch(/const body\s+= await req\.text\(\)/);
    /* Kein Dev-Modus, der ungeprüftes JSON annimmt. */
    expect(WEBHOOK).not.toMatch(/JSON\.parse\(body\)/);
  });

  it('wehrt Doppelzustellungen über stripe_events ab', () => {
    expect(WEBHOOK).toMatch(/from\('stripe_events'\)\s*\n\s*\.insert\(\{ id: event\.id/);
    expect(WEBHOOK).toMatch(/'23505'/);
    expect(WEBHOOK).toMatch(/duplicate: true/);
    /* Und gibt den Anspruch bei einem Fehler wieder frei, damit
       Stripes Wiederholung durchkommt. */
    expect(WEBHOOK).toMatch(/\.delete\(\)\.eq\('id', event\.id\)\.is\('processed_at', null\)/);
  });

  it('schreibt plan nur an einer Stelle und schützt founding_partner', () => {
    /* Die Wirkung prüft src/entitlementGates.test.js; hier die
       Struktur: updateProfile ist der Engpass. */
    const koerper = WEBHOOK.slice(
      WEBHOOK.indexOf('async function updateProfile('),
      WEBHOOK.indexOf('serve(async (req)'));

    expect(koerper).toMatch(/'plan' in zuSchreiben/);
    expect(koerper).toMatch(/data\?\.plan === 'founding_partner'/);
    expect(koerper).toMatch(/if \(leseFehler\) throw leseFehler/);
  });

  it('setzt bei fehlgeschlagener Zahlung nur den Status, nicht den Plan', () => {
    /* Befund: past_due behält damit Pro-Zugang — Produktentscheidung,
       siehe Bericht I. */
    const zweig = WEBHOOK.slice(WEBHOOK.indexOf("case 'invoice.payment_failed'"));
    expect(zweig).toMatch(/\{ stripe_subscription_status: 'past_due' \}/);
    expect(zweig).not.toMatch(/plan:\s*'/);
  });

  it('dedupliziert die payment_failed-Mail über die Event-ID', () => {
    expect(WEBHOOK).toMatch(/p_dedupe_key: `payment_failed:\$\{event\.id\}`/);
  });

  it('prüft vor der payment_failed-Mail den Plan — Befund geschlossen', () => {
    /* ── Umgedreht am 14.10.2026 ──

       Der H2.1-Befund (§17) war: die Mail hängt am Stripe-Kunden,
       nicht am Plan, und ein Founding Partner mit laufendem Altabo
       kann sie bekommen. Geschlossen in H2.2 D.

       Die alte Fassung prüfte
         expect(zweig).not.toMatch(/…|plan/)
       und wurde durch die Korrektur rot — richtig so.

       Was wirklich entschieden wird und an welcher Stelle, prüft
       src/paymentFailedFoundingPartner.test.js. Hier steht nur, dass
       der Zweig den Plan überhaupt kennt. */
    /* indexOf ohne Startpunkt fand das `default:` aus
       mapStatusToPlan weiter oben und schnitt einen leeren Abschnitt
       aus — der Test war damit gruen, ohne etwas zu lesen. */
    const anfang = WEBHOOK.indexOf("case 'invoice.payment_failed'");
    expect(anfang).toBeGreaterThan(-1);
    const zweig = WEBHOOK.slice(anfang, WEBHOOK.indexOf('default:', anfang));
    expect(zweig).toMatch(/enqueue_email/);
    expect(zweig).toMatch(/darfZahlungsmahnung/);
  });
});

describe('M — Portal: wer es öffnen darf', () => {

  it('verlangt nur eine Sitzung und eine stripe_customer_id', () => {
    /* Befund: kein Planvergleich. Ein Founding Partner mit
       Stripe-Historie kann das Portal öffnen. */
    expect(PORTAL).toMatch(/select\('stripe_customer_id'\)/);
    expect(PORTAL).not.toMatch(/plan/);
    expect(PORTAL).toMatch(/Kein aktives Abo gefunden/);
  });

  it('schickt den Nutzer danach in die Einstellungen zurück', () => {
    expect(PORTAL).toMatch(/return_url: `\$\{siteUrl\}\/dashboard\/einstellungen`/);
  });
});

describe('E / R — der tote trial-Plan', () => {
  const MIGRATION = lies('supabase/migrations/20261013090000_founding_partner_und_consent.sql');

  it('lässt der Constraint trial nicht zu', () => {
    /* Gemessen in supabase/tests/entitlement.test.sql, Abschnitt 2.
       Hier die Quelle dazu. */
    const constraint = /check \(plan = any \(array\[([^\]]*)\]\)\)/.exec(MIGRATION);
    expect(constraint).not.toBeNull();

    const werte = [...constraint[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(werte)).toEqual(new Set(['free', 'starter', 'pro', 'founding_partner']));
    /* Nur die Werteliste, nicht die ganze Datei: Die Migration
       erwaehnt 'trial' in den Kommentaren, und das soll sie. */
    expect(werte).not.toContain('trial');
  });

  it('hält den trial-Zweig in der Zugriffsregel trotzdem vor', () => {
    /* Befund, kein Wunsch: Der Zweig ist tot, steht aber in JS und SQL
       noch — ihn zu entfernen ist eine eigene Entscheidung, und dann
       an beiden Stellen. */
    expect(REGEL).toMatch(/plan === 'trial'/);
    expect(lies('supabase/migrations/20261013130000_operative_mails_plangate.sql'))
      .toMatch(/v_p\.plan = 'trial'/);
  });

  it('nennt update_user_plan nirgends als Aufrufer', () => {
    /* Befund: Die Funktion existiert in der Datenbank, erlaubt
       'trial' und 'cancelled' — zwei Werte, die der Constraint
       ablehnt — und wird von keiner Zeile im Repo aufgerufen.

       Diese Zusage fällt, sobald jemand sie benutzt. Dann gehört die
       Rechtefrage aus dem Bericht (Abschnitt N) zuerst geklärt.

       ── Korrektur vom 14.10.2026 ──

       Die erste Fassung behauptete im Kommentar "Nur echte Aufrufe,
       keine Erwähnung im Kommentar" und prüfte den Dateitext
       unverändert. Aufgefallen ist das, als
       20261014120000_execute_rechte_kanonisch.sql in ihrem Kopf die
       Wirkungsprobe aus der Produktionsmessung zitiert:

         select public.update_user_plan('0000…0000'::uuid, 'free');

       Der Test wurde rot und meldete eine Migration als Aufrufer, die
       die Funktion gerade zumacht. Falschmeldung, aber die richtige
       Art davon: die Behauptung im Kommentar war schlicht nicht
       eingelöst. Seitdem werden SQL- und JS-Kommentare vorher
       entfernt. */
    const ohneKommentare = (text) => text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*--.*$/gm, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

    const treffer = [];
    const suche = (verzeichnis) => {
      for (const eintrag of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
        const p = `${verzeichnis}/${eintrag.name}`;
        if (eintrag.isDirectory()) { suche(p); continue; }
        if (!/\.(js|ts|sql)$/.test(eintrag.name)) continue;
        if (p.includes('/schema/') || eintrag.name === 'billingAudit.test.js') continue;
        const inhalt = ohneKommentare(lies(p));
        if (/(rpc\(['"]update_user_plan|perform public\.update_user_plan|select public\.update_user_plan)/.test(inhalt)) {
          treffer.push(p);
        }
      }
    };
    suche('src');
    suche('supabase/functions');
    suche('supabase/migrations');

    expect(treffer).toEqual([]);
  });
});

describe('L — was die Oberfläche verspricht', () => {
  /* Seit dem 16.10.2026 besteht die Preisoberfläche aus zwei Dateien:
     pages/Pricing.js bringt den Kopf, components/Preis.js die
     Preiskarte mit den Trial-Aussagen. Geprüft wird die Summe — sonst
     wäre dieser Test grün, weil der Satz in die andere Datei gewandert
     ist, und das ist genau die Irrtumsrichtung, vor der der Kommentar
     unten warnt. */
  const PRICING  = `${lies('src/pages/Pricing.js')}\n${lies('src/components/Preis.js')}`;
  const SETTINGS = lies('src/pages/dashboard/DashboardSettings.js');

  it('nennt die Testtage aus der Branchenkonfiguration', () => {
    expect(lies('src/config/industryConfig.js')).toMatch(/trialDays:\s+30/);
    expect(PRICING).toMatch(/\{pricing\.trialDays\} Tage kostenlos/);
  });

  it('verspricht auf der Preisseite keine kartenfreie Testphase mehr — Befund geschlossen', () => {
    /* ── Umgedreht am 14.10.2026, und zwar zweimal ──

       Der H2.1-Befund war ein Widerspruch: die Preisseite sagte, für
       die Testphase sei keine Karte nötig, und Stripe Checkout im
       Modus 'subscription' verlangt ohne
       payment_method_collection: 'if_required' eine Zahlungsmethode.
       Geschlossen in H2.2 E — der Satz ist korrigiert, der Checkout
       absichtlich nicht angefasst (§26).

       Die erste Korrektur dieser Zusage war selbst falsch: sie
       prüfte den ROHEN Dateitext, und die korrigierte Preisseite
       zitierte den alten Satz in einem Kommentar. Der Test blieb
       deshalb grün, obwohl der Befund behoben war — die
       unangenehmste Richtung, in die ein Test irren kann. Jetzt
       werden Kommentare vorher entfernt, und die Preisseite zitiert
       den Satz nicht mehr.

       Was die Seite stattdessen sagt, prüft
       src/kreditkartenZusage.test.js. */
    const ausgabe = PRICING
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');

    expect(ausgabe).not.toMatch(/keine Kreditkarte/i);
    expect(ausgabe).toMatch(/wird nichts abgebucht/);

    /* Die Ursache bleibt, als Befund: ändert sich das, ist die alte
       Zusage wieder wahr und diese Prüfung anzupassen. */
    expect(CHECKOUT).not.toMatch(/payment_method_collection/);
  });

  it('zeigt einem Betrieb ohne Stripe-Kunden den Upgrade-Knopf', () => {
    /* Das gilt weiter — fuer free. Dass es auch Founding Partner traf,
       war der Befund aus Bericht L; geschlossen in H2.2 C. */
    expect(SETTINGS).toMatch(/hasStripeCustomer \? \(/);
    expect(SETTINGS).toMatch(/Jetzt upgraden/);
  });

  it('kennt inzwischen ein Etikett für founding_partner — Befund geschlossen', () => {
    /* ── Umgedreht am 14.10.2026 ──

       Diese beiden Zusagen hielten den H2.1-Befund fest: die
       Einstellungsseite kannte founding_partner nicht, zeigte deshalb
       den Rohwert als Plannamen und den Upgrade-Knopf samt Preis.

       H2.2 C hat das geschlossen. Die alte Fassung pruefte

         expect(SETTINGS).not.toMatch(/isFoundingPartner|founding_partner/)

       und wurde durch die Korrektur rot — richtig so: ein Test, der
       einen Befund festhaelt, MUSS fallen, wenn der Befund behoben
       ist. Sonst wuerde er die Behebung verhindern.

       Was die Darstellung wirklich tut, prueft nicht dieser Test,
       sondern src/pages/dashboard/foundingPartnerSettings.test.js an
       der gerenderten Seite. Hier steht nur, dass die Datei den Fall
       ueberhaupt kennt. */
    expect(SETTINGS).toMatch(/isFoundingPartner/);

    const etiketten = SETTINGS.slice(SETTINGS.indexOf('const planLabels'),
                                     SETTINGS.indexOf('};', SETTINGS.indexOf('const planLabels')));
    expect(etiketten).toMatch(/free:/);
    expect(etiketten).toMatch(/pro:/);
    expect(etiketten).toMatch(/founding_partner:\s+'Founding Partner'/);

    /* ── Hier stand kurz eine Zusage zu viel ──

       Der erste Entwurf dieser Korrektur prueefte zusaetzlich

         expect(SETTINGS).not.toMatch(/Lifetime|Für immer kostenlos/i)

       und wurde rot: die Datei enthaelt diese Worte, naemlich in dem
       Kommentar, der erklaert, warum sie NICHT verwendet werden.

       Ein Quelltext-Muster kann Kommentar und Ausgabe nicht
       unterscheiden. Die Zusage steht deshalb dort, wo sie
       hingehoert: in foundingPartnerSettings.test.js, gegen die
       gerenderte Seite. Dasselbe gilt in dieser Datei fuer alles,
       was der Nutzer am Ende sehen soll — hier wird nur belegt, was
       im Code VORHANDEN ist, nie was er anzeigt. */
  });
});

describe('R — doppelte und tote Oberflächen', () => {

  it('hat zwei Preisseiten, von denen nur eine verdrahtet ist', () => {
    /* Befund: src/Pricing.js und src/pages/Pricing.js existieren
       beide mit eigenem Checkout-Aufruf; App.js bindet nur die
       zweite ein. Wer die falsche ändert, ändert nichts. */
    expect(fs.existsSync(path.join(wurzel, 'src/Pricing.js'))).toBe(true);
    expect(fs.existsSync(path.join(wurzel, 'src/pages/Pricing.js'))).toBe(true);

    const app = lies('src/App.js');
    expect(app).toMatch(/import Pricing\s+from '\.\/pages\/Pricing'/);
    expect(app).not.toMatch(/from '\.\/Pricing'/);
  });

  it('rendert die beiden Preis-Modals nirgends', () => {
    /* GhostSetupModal verspricht eine „Setup-Fee", die der Checkout
       seit dem 11.09. nicht mehr kennt (Path B gestrichen). */
    const quellen = ['src/App.js', 'src/pages/dashboard/DashboardHome.js',
                     'src/pages/dashboard/DashboardSettings.js',
                     'src/pages/dashboard/DashboardGoogleBusiness.js',
                     'src/pages/Pricing.js'];
    for (const datei of quellen) {
      const inhalt = lies(datei);
      expect(inhalt).not.toMatch(/GhostSetupModal|PathAPricingModal/);
    }
    expect(lies('src/components/dashboard/GhostSetupModal.js')).toMatch(/Setup-Fee/);
    /* Die Kopfzeile der Function erwaehnt STRIPE_PRICE_SETUP_FEE
       ausdruecklich als gestrichen — geprueft wird deshalb, dass sie
       nicht GELESEN wird. */
    expect(CHECKOUT).not.toMatch(/env\.get\('STRIPE_PRICE_SETUP_FEE'\)/);
  });
});
