/**
 * Positionierung 12.11.2026 (Reddit-Validierung): Ruf, Vertrauen,
 * Bewertungen statt „Profilpflege"/Local SEO.
 *
 *   H1–H3  Hero: Headline bleibt, Empfehlungs-Subline, Differenzierung
 *          und Checks nur mit echten Funktionen
 *   G1–G3  Nutzenbloecke: Bewertungen & Vertrauen zuerst, Karten
 *          wiederverwendet, keine verlorene Karte
 *   W1–W3  Wahrheit: jede Funktionsaussage hat ihr Gegenstueck im Code
 *   V1     Gegenproben-Raster: verbotene Versprechen tauchen nicht auf
 *   U1     andere Branchen unveraendert
 */
import fs from 'fs';
import path from 'path';
import { getIndustryConfig } from './config/industryConfig';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const hw = getIndustryConfig('handwerk');
const hero = hw.copy.hero;
const gruppen = hw.copy.featureGruppen;
const heroText = [hero.eyebrow, hero.headline, hero.headlineAccent, hero.subline, hero.differenzierung, ...hero.checks].join(' ');
const gruppenText = gruppen.map((g) => [g.titel, g.einleitung, ...g.karten.flatMap((k) => [k.title, k.body, k.tag])].join(' ')).join(' ');

describe('Hero', () => {
  it('H1 — Headline bleibt', () => {
    expect(`${hero.headline} ${hero.headlineAccent}`).toBe('Deine Arbeit ist besser, als dein Profil vermuten lässt.');
  });
  it('H2 — Subline mit Empfehlungs-Logik, nicht absolut', () => {
    expect(hero.subline).toMatch(/^Viele, die dich empfohlen bekommen, schauen trotzdem noch bei Google nach\./);
    expect(hero.subline).toMatch(/zu deinem guten Ruf passt\.$/);
    expect(hero.subline).not.toMatch(/^Wer dich empfohlen bekommt, googelt dich/);
  });
  it('H3 — Differenzierung und Checks: Bewertungen, Antworten, Wochenmail — keine Passivitaet, kein SMS/QR im Hero', () => {
    expect(hero.differenzierung).toMatch(/offene Bewertungen/);
    expect(hero.differenzierung).toMatch(/bereitet Antworten vor/);
    expect(hero.differenzierung).toMatch(/montags in einer kurzen Mail/);
    expect(hero.checks).toEqual([
      'Neue Bewertungen im Blick, schlechte sofort gemeldet',
      'Antwortvorschläge prüfen und freigeben',
      'Montags eine Mail mit dem, was wirklich zählt',
    ]);
    expect(heroText).not.toMatch(/SMS|QR/);
  });
});

describe('Nutzenbloecke', () => {
  it('G1 — Reihenfolge: Bewertungen & Vertrauen → aktiver Auftritt → weniger kuemmern', () => {
    expect(gruppen.map((g) => [g.key, g.titel])).toEqual([
      ['A', 'Bewertungen & Vertrauen'], ['B', 'Ein aktiver Google-Auftritt'], ['C', 'Weniger kümmern müssen'],
    ]);
  });
  it('G2 — alle sieben bisherigen Karten bleiben erhalten, richtig einsortiert', () => {
    expect(gruppen.map((g) => g.karten.map((k) => k.title))).toEqual([
      ['Jede Bewertung beantwortet', 'Schlechte Bewertung? Du weisst es zuerst', 'Mehr Bewertungen bekommen'],
      ['Dein Profil bleibt vollständig', 'Fotos, die auch ankommen'],
      ['Montags eine Mail, mehr nicht', 'Es fällt auf, bevor es dir auffällt'],
    ]);
  });
  it('G3 — „Besser gefunden werden" ist kein Hauptergebnis mehr, Sichtbarkeit nur als Folge', () => {
    expect(gruppen.map((g) => g.titel)).not.toContain('Besser gefunden werden');
    expect(gruppen[1].einleitung).toMatch(/Ein vollständiger, aktueller Auftritt schafft die Grundlage dafür, bei Google überzeugend sichtbar zu sein\./);
    /* kein Ranking-/Sichtbarkeitsversprechen (Mini-Polish 12.11.2026) */
    expect(gruppen[1].einleitung).not.toMatch(/Voraussetzung|überhaupt|gut anzeigen|besser gefunden|Ranking|ganz oben/i);
  });
});

describe('Feature-Truth', () => {
  it('W1 — „Mehr Bewertungen": Link und QR-Code existieren im Dashboard; Versand bleibt beim Betrieb', () => {
    const karte = gruppen[0].karten.find((k) => k.title === 'Mehr Bewertungen bekommen');
    expect(karte.body).toMatch(/Den Link verschickst du selbst/);
    const seite = lies('src/pages/dashboard/DashboardKundenGewinnung.js');
    expect(seite).toMatch(/QRCodeSVG/);
    expect(seite).toMatch(/<ProGate feature="Mehr Bewertungen">/);
  });
  it('W2 — Sofortmeldung bei schlechter Bewertung und Wochenmail existieren', () => {
    expect(lies('supabase/functions/send-email/index.ts')).toMatch(/critical_review_alert/);
    expect(lies('supabase/functions/send-email/index.ts')).toMatch(/weekly_summary/);
  });
  it('W3 — Wochenmail kommt auch ohne Aufgabe („Alles geprueft") → keine „nur wenn"-Aussage', () => {
    expect(lies('src/utils/wochenstatus.js')).toMatch(/ok_no_actions/);
    expect(`${heroText} ${gruppenText}`).not.toMatch(/nur (dann )?(Bescheid|melde)|meldet sich nur/i);
  });
});

describe('Gegenproben-Raster', () => {
  it('V1 — keine verbotenen Versprechen in Hero und Nutzenbloecken', () => {
    const text = `${heroText} ${gruppenText}`;
    expect(text).not.toMatch(/lukrativ|automatisch (mehr|lukrativ)|garantiert|Garantie|mehr Kunden|Ranking|Local SEO/i);
    expect(text).not.toMatch(/Überwachung|überwach/i);
    expect(text).not.toMatch(/musst dich (nicht|gar nicht|nicht mehr) (darum )?kümmern|musst nichts tun/i);
  });
});

describe('Mini-Polish nach PR #66', () => {
  it('P1 — Preisliste ohne „Überwachung", ruhige Formulierung, Umfang gleich', () => {
    const roh = lies('src/config/industryConfig.js');
    expect(roh).toMatch(/'Dein Google-Profil regelmäßig geprüft',/);
    /* Im Handwerk-Verkaufstext (ohne Kommentare) kommt „Überwachung" nicht mehr vor */
    const handwerk = roh.slice(roh.indexOf('handwerk: {'), roh.indexOf('gastro: {')).replace(/\/\*[\s\S]*?\*\//g, '');
    /* Nur das Substantiv: Der Schritt „Überwachen“ in „So funktioniert's“ liegt
       ausserhalb dieses Auftrags (im PR als offener Punkt genannt). */
    expect(handwerk).not.toMatch(/Überwachung/);
  });
  it('P2 — Startkarte im Hero: „täglich" statt „laufend", keine Echtzeit', () => {
    const hero = lies('src/components/Hero.js');
    expect(hero).toMatch(/Danach prüft WERKRUF dein Profil täglich und sagt dir,/);
    expect(hero).not.toMatch(/Profil laufend|rund um die Uhr|ständig|in Echtzeit|Überwachung/i);
  });
  it('P3 — Aussagen aus PR #66 unveraendert', () => {
    expect(hero.subline).toBe('Viele, die dich empfohlen bekommen, schauen trotzdem noch bei Google nach. WERKRUF sorgt dafür, dass dein Auftritt dort zu deinem guten Ruf passt.');
    expect(gruppen.map((g) => g.titel)).toEqual(['Bewertungen & Vertrauen', 'Ein aktiver Google-Auftritt', 'Weniger kümmern müssen']);
  });
});

describe('Andere Branchen', () => {
  it('U1 — GASTRORUF und BEAUTYRUF unveraendert', () => {
    expect(getIndustryConfig('gastro').copy.hero.subline).toBe('Mehr Reservierungen, bessere Bewertungen, volle Abende — automatisch.');
    expect(getIndustryConfig('beauty').copy.hero.subline).toBe('Dein Studio online so präsentieren, dass Neukunden von selbst kommen.');
  });
});
