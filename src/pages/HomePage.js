import React, { useEffect } from 'react';
import Hero         from '../components/Hero';
import ExampleScore from '../components/ExampleScore';
import Features     from '../components/Features';
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
    </main>
  );
}
