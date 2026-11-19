/**
 * Wahrheit und Funnel der öffentlichen Seiten (P4B).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Der Product-Truth-Audit vom 16.10.2026 fand auf den öffentlichen
 * Seiten sechs Aussagen, die das Produkt nicht einlöst, und zwei
 * Ziele, die es nicht gibt. Alle acht sind behoben. Dieser Test hält
 * fest, dass sie nicht zurückkommen — nicht als Formulierung,
 * sondern als Tatsache.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM KOMMENTARE ENTFERNT WERDEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Die korrigierten Dateien ZITIEREN die falschen Sätze in den
 * Kommentaren, die erklären, warum sie weg sind. Eine reine
 * Textsuche kann Kommentar und Ausgabe nicht unterscheiden — ein
 * Test ohne diesen Filter bliebe rot, obwohl alles richtig ist, oder
 * schlimmer: er bliebe grün, weil jemand die Prüfung entsprechend
 * aufgeweicht hat.
 *
 * Genau daran sind in diesem Projekt schon zwei Prüfungen
 * gescheitert (billingAudit, kreditkartenZusage). Der Filter stammt
 * von dort.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS DIESER TEST NICHT TUT
 * ═══════════════════════════════════════════════════════════════
 *
 * Er friert keinen Marketingtext ein. Geprüft wird, was NICHT
 * behauptet werden darf, und dass die CTAs ein existierendes Ziel
 * haben. Wie der Hero formuliert ist, darf sich jederzeit ändern,
 * ohne dass hier etwas rot wird.
 */
import fs from 'fs';
import path from 'path';

const wurzel = process.cwd();
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

/* Die Dateien, die ein ausgeloggter Besucher tatsächlich zu sehen
   bekommt. Tote Komponenten (SmartCheck, AnalysisSection, LeadForm,
   src/Pricing.js) stehen bewusst NICHT in dieser Liste: Sie sind von
   keiner erreichbaren Datei importiert, und ihr Inhalt ist deshalb
   keine öffentliche Aussage. */
const OEFFENTLICH = [
  'src/pages/HomePage.js',
  'src/pages/Pricing.js',
  'src/components/Header.js',
  'src/components/Hero.js',
  'src/components/Features.js',
  'src/components/ExampleScore.js',
  'src/components/Vergleich.js',
  'src/components/Preis.js',
  'src/components/FAQ.js',
  'src/components/AbschlussCTA.js',
  'src/components/Footer.js',
  'src/components/WerDahinter.js',
  /* 19.11.2026: Was beim Teilen eines Links erscheint (Titel,
     Beschreibung, Vorschaubild), ist genauso öffentliche Aussage —
     dort standen noch „3× mehr Anfragen" und „Mehr Aufträge". */
  'public/index.html',
  'public/og-image.svg',
];

/* Kommentare müssen raus, bevor hier Textmuster geprüft werden: Die
   korrigierten Dateien zitieren in ihren Kommentaren genau die Sätze,
   die entfernt wurden. Ein Test, der den Rohtext liest, findet sie
   wieder und meldet einen Fehler, der nicht existiert.

   Die Reihenfolge ist nicht beliebig. Zuerst stand hier ein eigenes
   Muster für die JSX-Form `{ / * ... * / }`:

       /\{\s*\/\*[\s\S]*?\*\/\s*\}/

   Das war falsch, und zwar still. `[\s\S]*?` ist nur innerhalb des
   Treffers knapp — die Suche nach dem Abschluss `*​/` + `}` läuft
   weiter, bis irgendwo einer kommt. Am 16.10.2026 begann der Treffer
   an der Klammer von `if (pathname === '/') {` im Header und endete
   drei Kommentare später. Alles dazwischen war weg, darunter die
   Zeile `const ctaZiel = isAuthenticated ? ... : '/signup'`. Der
   Test "bietet Ausgeloggten einen Weg zur Registrierung" wurde rot,
   obwohl der Kopf genau das tat.

   Deshalb jetzt: Blockkommentare einzeln entfernen — ein `/*` findet
   immer sein eigenes `*​/`, es gibt nichts zu überspringen. Die
   JSX-Form löst sich dabei von selbst, übrig bleibt `{ }`. */
const ohneKommentare = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')
  .replace(/\{\s*\}/g, ' ');

/* Die aktive Branche. Gastro und Beauty tragen noch die alten
   Behauptungen; sie sind nicht live (ACTIVE_INDUSTRY = 'handwerk')
   und im Dateikopf als ungeprüft markiert. Dieser Test prüft die
   Branche, die ausgeliefert wird. */
const konfigHandwerk = () => {
  const ganz = ohneKommentare(lies('src/config/industryConfig.js'));
  const start = ganz.indexOf('handwerk: {');
  const ende  = ganz.indexOf('gastro: {');
  expect(start).toBeGreaterThan(-1);
  expect(ende).toBeGreaterThan(start);
  return ganz.slice(start, ende);
};

const oeffentlicherText = () =>
  OEFFENTLICH.map((p) => ohneKommentare(lies(p))).join('\n');

describe('keine Funktion, die es nicht gibt', () => {
  it('bewirbt keinen Bewertungs-Autopiloten', () => {
    /* Im Repository existiert dafür keine Zeile Code: kein
       Versanddienst, keine Vorlage, kein Feld für eine
       Endkundenadresse. Backlog HIGH — bis dahin kein Verkaufstext. */
    expect(oeffentlicherText()).not.toMatch(/Autopilot/i);
    expect(konfigHandwerk()).not.toMatch(/Autopilot/i);
  });

  it('verspricht kein monatliches PDF-Reporting', () => {
    expect(oeffentlicherText()).not.toMatch(/Monatliche[sr]?\s+(PDF-)?Report/i);
    expect(konfigHandwerk()).not.toMatch(/Monatliche[sr]?\s+(PDF-)?Report/i);
  });

  it('bewirbt den abgeschalteten Sichtbarkeits-Check nicht mehr', () => {
    const text = oeffentlicherText();
    expect(text).not.toMatch(/Sichtbarkeits-Check/);
    expect(text).not.toMatch(/Profil-Check/);
    expect(text).not.toMatch(/SmartCheck/);
    expect(text).not.toMatch(/Befund als PDF/);
  });

  it('nennt keine automatische Bewertungsanfrage im Dashboard', () => {
    /* Diese stand hinter ProGate — sie wurde also ausgerechnet
       zahlenden Kunden gezeigt. */
    const seite = ohneKommentare(lies('src/pages/dashboard/DashboardKundenGewinnung.js'));
    expect(seite).not.toMatch(/Automatische Bewertungsanfragen/i);
  });

  it('zeigt keine Platzhalterkarte für monatliche Reports', () => {
    const seite = ohneKommentare(lies('src/pages/dashboard/DashboardReporting.js'));
    expect(seite).not.toMatch(/Monatliche Reports/);
    expect(seite).not.toMatch(/Report — \w+ \d{4}/);
  });
});

describe('keine unbelegten Zahlen', () => {
  it('enthält keinen ROI-Rechner mehr', () => {
    const text = oeffentlicherText();
    expect(text).not.toMatch(/upliftFactor/);
    expect(text).not.toMatch(/maxMonthlyRevenue/);
    expect(text).not.toMatch(/roiPct/);
    expect(text).not.toMatch(/sliderDefault/);
  });

  it('hat die ROI-Werte aus der aktiven Branchenkonfiguration entfernt', () => {
    const k = konfigHandwerk();
    expect(k).not.toMatch(/upliftFactor/);
    expect(k).not.toMatch(/avgOrderValue/);
    expect(k).not.toMatch(/maxMonthlyRevenue/);
  });

  it('behauptet weder "3× mehr Anfragen" noch "+30 %"', () => {
    const text = oeffentlicherText();
    expect(text).not.toMatch(/3\s*×\s*mehr/i);
    expect(text).not.toMatch(/\+\s*30\s*%/);
    expect(text).not.toMatch(/9\.120/);
  });

  it('gibt keine Erfolgsgarantie', () => {
    const text = oeffentlicherText();
    expect(text).not.toMatch(/zahlst du nichts/i);
    expect(text).not.toMatch(/garantiert mehr/i);
    expect(text).not.toMatch(/Kein Kleingedrucktes/i);
  });
});

describe('der Preis steht vor der Registrierung', () => {
  it('nennt ihn auf der Landingpage', () => {
    /* Nicht die Zahl 49 im Text, sondern der Weg zur Zahl: Die
       Landingpage bindet die Preissektion ein, und die liest
       monthlyPrice aus der Konfiguration. Eine handgeschriebene 49
       wäre eine zweite Wahrheit. */
    const home = ohneKommentare(lies('src/pages/HomePage.js'));
    expect(home).toMatch(/<Preis\s*\/>/);

    const preis = ohneKommentare(lies('src/components/Preis.js'));
    expect(preis).toMatch(/pricing\.monthlyPrice/);
    expect(preis).toMatch(/pricing\.trialDays/);
  });

  it('nennt ihn auch im Hero, bevor der Besucher klickt', () => {
    const hero = ohneKommentare(lies('src/components/Hero.js'));
    expect(hero).toMatch(/pricing\.monthlyPrice/);
    expect(hero).toMatch(/pricing\.trialDays/);
  });

  it('hält 49 € und 30 Tage an genau einer Stelle', () => {
    const k = konfigHandwerk();
    expect(k).toMatch(/monthlyPrice:\s*49/);
    expect(k).toMatch(/trialDays:\s*30/);
  });
});

describe('alle öffentlichen CTAs haben ein Ziel', () => {
  const ROUTEN = () => {
    const app = lies('src/App.js');
    return [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  };

  it('kennt /signup und /dashboard als Routen', () => {
    const r = ROUTEN();
    expect(r).toContain('/signup');
    expect(r).toContain('/dashboard');
  });

  it('verweist nirgends mehr auf /register', () => {
    /* Diese Route gab es nie. Der Abschluss-CTA der Preisseite zeigte
       darauf und landete auf der Fehlerseite. */
    expect(ROUTEN()).not.toContain('/register');
    expect(oeffentlicherText()).not.toMatch(/['"]\/register['"]/);
  });

  it('verweist nirgends mehr auf den Anker #check', () => {
    /* Das Element mit id="check" steht nur in SmartCheck.js, und die
       Komponente wird nicht gerendert. Vier CTAs zeigten darauf. */
    expect(oeffentlicherText()).not.toMatch(/#check/);
  });

  it('jeder Anker im Kopf hat ein Gegenstück auf der Landingpage', () => {
    const kopf = ohneKommentare(lies('src/components/Header.js'));
    const anker = [...kopf.matchAll(/href="\/#([a-z-]+)"/g)].map((m) => m[1]);
    expect(anker.length).toBeGreaterThan(0);

    const seiten = [
      'src/components/Hero.js', 'src/components/ExampleScore.js',
      'src/components/Features.js', 'src/components/Vergleich.js',
      'src/components/Preis.js', 'src/components/FAQ.js',
      'src/components/AbschlussCTA.js',
    ].map((p) => lies(p)).join('\n');

    anker.forEach((a) => {
      expect(seiten).toMatch(new RegExp(`id="${a}"`));
    });
  });
});

describe('der Kopf kennt den Anmeldezustand', () => {
  const kopf = () => ohneKommentare(lies('src/components/Header.js'));

  it('liest ihn überhaupt', () => {
    expect(kopf()).toMatch(/useAuthContext/);
    expect(kopf()).toMatch(/isAuthenticated/);
  });

  it('zeigt Angemeldeten keinen Einloggen-Knopf', () => {
    /* Vorher stand dort immer "Einloggen" — auch für jemanden, der
       gerade angemeldet war. */
    expect(kopf()).toMatch(/!isAuthenticated\s*&&[\s\S]{0,120}\/login/);
  });

  it('bietet Ausgeloggten einen Weg zur Registrierung', () => {
    /* Vorher gab es im Kopf gar keinen — der einzige Einstieg war der
       Hero-CTA. */
    expect(kopf()).toMatch(/isAuthenticated\s*\?\s*'\/dashboard'\s*:\s*'\/signup'/);
  });
});

describe('Vorschau beim Teilen und Startseite (19.11.2026)', () => {
  it('Titel, Beschreibung und Vorschaubild versprechen keine Aufträge, Sichtbarkeit oder Gratis-Check', () => {
    const kopf = lies('public/index.html');
    const bild = lies('public/og-image.svg');
    for (const t of [kopf, bild]) {
      expect(t).not.toMatch(/Mehr Aufträge/i);
      expect(t).not.toMatch(/Sichtbarkeit steigern|MEHR SICHTBARKEIT/i);
      expect(t).not.toMatch(/3\s*×/);
      expect(t).not.toMatch(/0\s*€\s*<\/text>|für den Check/i);
    }
    expect(kopf).toMatch(/<meta property="og:image"\s+content="https:\/\/werkruf\.com\/og-image\.png"/);
    expect(fs.existsSync(path.join(wurzel, 'public/og-image.png'))).toBe(true);
  });

  it('SMS-Bewertungsanfrage ist gebaut und wird jetzt auch genannt', () => {
    expect(lies('src/components/dashboard/SmsBewertungsanfrage.js')).toMatch(/review-request/);
    expect(konfigHandwerk()).toMatch(/SMS/);
  });

  it('kein „Den Rest macht WERKRUF" — WERKRUF bereitet vor, der Betrieb gibt frei', () => {
    const text = oeffentlicherText() + konfigHandwerk();
    expect(text).not.toMatch(/Den Rest macht/i);
    expect(text).not.toMatch(/Den Rest kannst du vergessen/i);
  });

  it('„Wer dahintersteht" nimmt Name und Kontakt aus derselben Quelle wie das Impressum', () => {
    const w = ohneKommentare(lies('src/components/WerDahinter.js'));
    expect(w).toMatch(/from '\.\.\/config\/anbieter'/);
    expect(w).not.toMatch(/info@werkruf\.com|\+49 176/);   // nichts doppelt hart codiert
    expect(ohneKommentare(lies('src/pages/HomePage.js'))).toMatch(/<WerDahinter \/>/);
  });
});
