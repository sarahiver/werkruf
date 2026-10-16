import React, { useEffect } from 'react';
import Hero         from '../components/Hero';
import ExampleScore from '../components/ExampleScore';
import Features     from '../components/Features';
import Vergleich    from '../components/Vergleich';
import Preis        from '../components/Preis';
import FAQ          from '../components/FAQ';
import AbschlussCTA from '../components/AbschlussCTA';
import { clearPublicFunnel } from '../utils/publicFunnel';

/**
 * Oeffentliche Landingpage.
 *
 * Seit dem 28.09.2026 ohne oeffentliche Places-Auswertung und ohne
 * PDF-Anforderung. Der Weg fuehrt vom Beispiel-Score direkt zur
 * Registrierung und von dort zur autorisierten Google-Verbindung.
 *
 * Bewusst NICHT mehr eingebunden, aber im Repository erhalten:
 *   - components/AnalysisSection.js   oeffentlicher Places-Score
 *   - components/LeadForm.js          PDF-Anforderung mit Turnstile
 *   - hooks/usePlacesAnalysis.js      wird weiterhin im Onboarding und
 *                                     im Dashboard verwendet
 *
 * Die PDF-Infrastruktur im Backend bleibt vollstaendig bestehen. Sie
 * ist von hier aus nicht mehr erreichbar; das Legal-Gate in
 * request-profile-report bleibt unabhaengig davon geschlossen.
 *
 * ═══════════════════════════════════════════════════════════════
 * AUFBAU SEIT DEM 16.10.2026
 * ═══════════════════════════════════════════════════════════════
 *
 *   Hero          Was ist das, was bringt es, was kostet es
 *   ExampleScore  Wie es arbeitet — an einem Beispiel
 *   Features      Drei Ergebnisse, darunter die Funktionen
 *   Vergleich     Selbst machen, Agentur oder WERKRUF
 *   Preis         49 €, einmal und deutlich
 *   FAQ           Die sieben Fragen vor der Entscheidung
 *   AbschlussCTA  Ein Ziel, derselbe Weg wie im Hero
 *
 * Vorher waren es drei Abschnitte, der Preis kam darin nicht vor, und
 * die Seite endete auf einem Knopf ohne Ziel. Jeder Abschnitt hat
 * jetzt genau eine Aufgabe, und alle CTAs führen auf denselben Pfad:
 * angemeldet ins Dashboard, sonst zur Registrierung.
 */
export default function HomePage() {
  /* Altlasten aus dem alten Funnel entfernen.
     In sessionStorage koennen placeId und Name einer frueheren
     oeffentlichen Auswahl liegen. Das Onboarding wertet sie aus und
     wuerde sonst einen Schritt ueberspringen, den es jetzt nicht mehr
     gibt. Neue Eintraege entstehen nicht mehr. */
  useEffect(() => { clearPublicFunnel(); }, []);

  return (
    <main>
      <Hero />
      <ExampleScore />
      <Features />
      <Vergleich />
      <Preis />
      <FAQ />
      <AbschlussCTA />
    </main>
  );
}
