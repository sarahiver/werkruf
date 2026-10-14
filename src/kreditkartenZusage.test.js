/**
 * Die Kreditkarten-Zusage auf der Preisseite (H2.2 E).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Die aktive Preisseite versprach:
 *
 *   „Keine Kreditkarte für die Testphase erforderlich."
 *
 * Das ist falsch. Stripe Checkout im Modus 'subscription' verlangt
 * eine Zahlungsmethode, solange payment_method_collection nicht auf
 * 'if_required' steht, und create-checkout-session setzt das nicht
 * (gemessen am 13.10.2026, H2.1 Bericht B). Der Kunde klickte auf
 * eine Zusage und landete eine Seite später bei der Kartenabfrage.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS DIESER TEST SICHERT, UND WAS ER NICHT KANN
 * ═══════════════════════════════════════════════════════════════
 *
 * Er sichert, dass die Zusage in der AKTIVEN Oberfläche nicht
 * wiederkommt — und er nennt die Bedingung, unter der sie
 * zurückkommen DARF: wenn create-checkout-session
 * payment_method_collection: 'if_required' setzt, ist sie wahr. Dann
 * ist dieser Test zu ändern, nicht zu löschen.
 *
 * Was er nicht kann: beweisen, dass Stripe eine Karte verlangt. Das
 * entscheidet Stripe, nicht dieses Repo. Belegt wird deshalb die
 * Ursache im eigenen Code (die fehlende Option), nicht das Verhalten
 * des Anbieters.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM NUR DIE AKTIVE SEITE
 * ═══════════════════════════════════════════════════════════════
 *
 * src/Pricing.js existiert ebenfalls, mit demselben Satz, und ist
 * nicht verdrahtet — App.js bindet src/pages/Pricing.js ein. Diese
 * Doppelung steht in H2.2 §32 ausdrücklich auf der
 * Nicht-anfassen-Liste. Sie bleibt also stehen, und dieser Test hält
 * fest, dass sie toter Code ist: fällt die Zusage hier, war es keine
 * Nachlässigkeit, sondern eine Entscheidung.
 */
import fs from 'fs';
import path from 'path';

const wurzel = process.cwd();
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

const AKTIV    = lies('src/pages/Pricing.js');
const APP      = lies('src/App.js');
const CHECKOUT = lies('supabase/functions/create-checkout-session/index.ts');

/* Kommentare weg, bevor Textzusagen geprüft werden.

   Nicht aus Ordnungsliebe: die korrigierte Datei ZITIERT den alten
   Satz in dem Kommentar, der erklärt, warum er weg ist. Ein
   Quelltextmuster kann Kommentar und Ausgabe nicht unterscheiden —
   genau daran ist in diesem Paket schon ein Test (billingAudit) und
   eine Migrationsprüfung gescheitert. */
const ohneKommentare = (text) => text
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

describe('aktive Preisseite', () => {
  const ausgabe = ohneKommentare(AKTIV);

  it('ist die verdrahtete Seite', () => {
    /* Ohne diese Zusage prüfte der Test vielleicht die tote Datei. */
    expect(APP).toMatch(/import Pricing\s+from '\.\/pages\/Pricing'/);
    expect(APP).not.toMatch(/from '\.\/Pricing'/);
  });

  it('verspricht nicht mehr, dass keine Kreditkarte nötig ist', () => {
    expect(ausgabe).not.toMatch(/keine Kreditkarte/i);
    expect(ausgabe).not.toMatch(/ohne Kreditkarte/i);
    expect(ausgabe).not.toMatch(/keine Zahlungsdaten/i);
    expect(ausgabe).not.toMatch(/ohne Zahlungsdaten/i);
  });

  it('sagt stattdessen, was wirklich passiert', () => {
    expect(ausgabe).toMatch(/Zahlungsdaten werden beim Start hinterlegt/);
    expect(ausgabe).toMatch(/wird nichts abgebucht/);
  });

  it('nennt die Testtage aus der Konfiguration, nicht als Zahl im Text', () => {
    /* 30 ist konfiguriert (industryConfig trialDays) und steht in
       create-checkout-session als TRIAL_DAYS. Eine dritte,
       handgeschriebene 30 würde beim nächsten Wechsel übersehen. */
    expect(ausgabe).toMatch(/\{pricing\.trialDays\} Tagen wird nichts abgebucht/);
  });

  it('behält die wahren Trial-Zusagen', () => {
    /* Die Gegenprobe: korrigiert werden sollte eine falsche Aussage,
       nicht die ganze Kommunikation. 30 Tage ohne Abbuchung sind
       wahr — trial_period_days: 30 steht in der Checkout-Function. */
    expect(ausgabe).toMatch(/\{pricing\.trialDays\} Tage kostenlos/);
    expect(CHECKOUT).toMatch(/TRIAL_DAYS\s*=\s*30/);
  });
});

describe('die Bedingung, unter der die Zusage wieder wahr wäre', () => {
  it('belegt, dass der Checkout keine Zahlungsmethode freistellt', () => {
    /* Das ist die Ursache, nicht eine Vermutung über Stripe. Steht
       hier eines Tages payment_method_collection: 'if_required',
       darf die Zusage zurück — dann ist dieser Test anzupassen, und
       zwar bewusst. */
    expect(CHECKOUT).not.toMatch(/payment_method_collection/);
  });
});

describe('die zweite, tote Preisseite', () => {
  it('existiert weiter und ist nicht eingebunden', () => {
    /* §32: nicht anfassen. Festgehalten, damit die verbliebene
       falsche Zusage dort nicht als Nachlässigkeit gelesen wird —
       und damit auffällt, falls die Datei jemals verdrahtet wird. */
    expect(fs.existsSync(path.join(wurzel, 'src/Pricing.js'))).toBe(true);
    expect(ohneKommentare(lies('src/Pricing.js'))).toMatch(/Keine Kreditkarte/);
    expect(APP).not.toMatch(/from '\.\/Pricing'/);
  });
});
