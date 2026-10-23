/**
 * Begriffssystem — Menü = Seitentitel, „Betrieb“ in der Hauptauswahl (WP3)
 *
 * Keine Exact-Copy-Sperre fuer ganze Seiten. Nur die Stellen, an denen
 * der Kunde sich am 22.10. verlaufen hat: Menuename vs. Seitentitel,
 * und das Wort fuer die Hauptauswahl.
 */
import fs from 'fs';
import path from 'path';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const layout = lies('pages/dashboard/DashboardLayout.js');
const navLabel = (to) => {
  const m = layout.match(new RegExp(`to:\\s*'${to.replace(/\//g, '\\/')}'[^\\n]*label:\\s*'([^']+)'`));
  return m ? m[1] : null;
};
const pageTitles = (p) => [...lies(p).matchAll(/<PageTitle>([^<]+)<\/PageTitle>/g)].map((m) => m[1].trim());

describe('T1 — Menuename = Seitentitel', () => {
  it.each([
    ['/dashboard/google',           'pages/dashboard/DashboardGoogleBusiness.js', 'Dein Google-Profil'],
    ['/dashboard/fotos',            'pages/dashboard/DashboardFotos.js',          'Fotos'],
    ['/dashboard/kunden-gewinnung', 'pages/dashboard/DashboardKundenGewinnung.js','Mehr Bewertungen'],
    ['/dashboard/bewertungen',      'pages/dashboard/DashboardBewertungen.js',    'Bewertungen'],
    ['/dashboard/einstellungen',    'pages/dashboard/DashboardSettings.js',       'Einstellungen'],
    ['/dashboard/support',          'pages/dashboard/DashboardSupport.js',        'Support'],
  ])('%s: Menue und jede Seitenueberschrift heissen „%s“', (to, datei, erwartet) => {
    expect(navLabel(to)).toBe(erwartet);
    const titel = pageTitles(datei);
    expect(titel.length).toBeGreaterThan(0);
    for (const t of titel) expect(t).toBe(erwartet);
  });

  /* ── GEGENPROBE ── */
  it('die alten Namen kommen als Seitentitel nicht mehr vor', () => {
    for (const p of ['pages/dashboard/DashboardGoogleBusiness.js', 'pages/dashboard/DashboardFotos.js', 'pages/dashboard/DashboardKundenGewinnung.js']) {
      expect(lies(p)).not.toMatch(/<PageTitle>(Google Business Profil|Fotos (&amp;|&) Galerie|Kunden-Gewinnung)<\/PageTitle>/);
    }
    expect(layout).not.toMatch(/label:\s*'Dein Profil'/);
  });
});

describe('„Betrieb“ in der Hauptauswahl', () => {
  it('Bewertungsfilter: „Alle Betriebe“, nicht „Alle Standorte“', () => {
    const s = lies('pages/dashboard/DashboardBewertungen.js');
    expect(s).toMatch(/<option value="all">Alle Betriebe<\/option>/);
    expect(s).not.toMatch(/Alle Standorte/);
  });
  it('Google-Profil-Seite: Abschnitte sprechen von Betrieben', () => {
    const s = lies('pages/dashboard/DashboardGoogleBusiness.js');
    expect(s).toMatch(/'Betrieb auswählen'/);
    expect(s).not.toMatch(/<SectionTitle>[^<]*Standorte<\/SectionTitle>/);
    expect(s).not.toMatch(/<PageSub>Standorte,/);
  });
  it('Uebersicht: Hinweis zu mehreren Betrieben nennt den ausgewaehlten', () => {
    const s = lies('pages/dashboard/DashboardHome.js');
    expect(s).not.toMatch(/Standorte werden überwacht/);
    expect(s).toMatch(/Betriebe sind verbunden/);
  });
  it('ProGate nennt die Funktionen wie das Menue', () => {
    const s = lies('components/dashboard/ProGate.js');
    expect(s).not.toMatch(/Kunden-Gewinnung|Foto-Upload & Galerie/);
  });
});
