// src/App.js
// S&I Wedding Marketing - Hauptseite für siwedding.de
import React, { useEffect, Suspense } from 'react';
import { PUBLIC_PACKAGES } from './lib/pricing';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import styled, { createGlobalStyle, keyframes } from 'styled-components';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ErrorBoundary from './components/shared/ErrorBoundary';

// ============================================
// MARKETING COMPONENTS
// ============================================
import MarketingNav from './components/marketing/MarketingNav';
import MarketingHero from './components/marketing/MarketingHero';
import MarketingFooter from './components/marketing/MarketingFooter';
import PricingSection from './components/marketing/PricingSection';
import ThemeShowcase from './components/marketing/ThemeShowcase';
import ContactSection from './components/marketing/ContactSection';
import HowItWorksSection from './components/marketing/HowItWorksSection';
import USPSection from './components/marketing/USPSection';
import DemoWedding from './components/marketing/DemoWedding';
// FoundersIntro, AboutSection, WhyUsSection und ComponentsShowcase sind
// bewusst nicht mehr auf der Homepage — siehe Kommentar bei den Sections.
import FinalCTA from './components/marketing/FinalCTA';
import PromoBanner from './components/marketing/PromoBanner';
import BotanicalLeaves from './components/marketing/BotanicalLeaves';
import AnimatedSection from './components/marketing/AnimatedSection';
import StickyDemoBar from './components/marketing/StickyDemoBar';
import CTABand from './components/marketing/CTABand';
import FAQSection from './components/marketing/FAQSection';

// Modern Theme
import ModernOverride from './components/marketing/ModernOverride';

// ============================================
// SHARED / STANDALONE PAGES
// ============================================
import CookieConsent from './components/shared/CookieConsent';
import { ABTestProvider } from './context/ABTestContext';
import useScrollDepth from './hooks/useScrollDepth';
import SEOHead from './components/shared/SEOHead';

// ============================================
// LAZY IMPORTS (must come after all regular imports)
// Blog & Legal Pages werden nur auf eigenen Routes gebraucht
// → Code-Splitting reduziert das Initial-Bundle der Homepage
// ============================================
const ModernParallaxPage = React.lazy(() => import('./components/marketing/ModernParallaxPage'));
const BlogPage = React.lazy(() => import('./components/blog/BlogPage'));
const BlogArticle = React.lazy(() => import('./components/blog/BlogArticle'));
const ImpressumPage = React.lazy(() => import('./components/shared/ImpressumPage'));
const DatenschutzPage = React.lazy(() => import('./components/shared/DatenschutzPage'));
const KooperationenPage = React.lazy(() => import('./pages/KooperationenPage'));
const HochzeitsdatumFinder = React.lazy(() => import('./components/tools/HochzeitsdatumFinder'));
const BudgetRechner = React.lazy(() => import('./components/tools/BudgetRechner'));
const QuizGenerator = React.lazy(() => import('./components/tools/QuizGenerator'));

// ============================================
// GOOGLE FONTS - Alle Fonts für alle Themes (werden in Theme-Previews gebraucht)
// ============================================
// GOOGLE FONTS
// Fonts werden jetzt via public/index.html geladen
// (Critical Fonts blockierend, Theme-Fonts async)
// → siehe index.html für Details
// ============================================

// ============================================
// GLOBAL STYLES
// ============================================
const GlobalStyles = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  
  html {
    scroll-behavior: smooth;
  }
  
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    overflow-x: hidden;
    background: #FFFFFF;
  }
  
  ::selection {
    background: #C41E3A;
    color: #FFFFFF;
  }
  
  /* Scroll margin for anchor links */
  [id] {
    scroll-margin-top: 100px;
  }

  /* Mobile: Reduce section padding to minimize scrolling */
  @media (max-width: 768px) {
    section {
      padding-top: clamp(2.5rem, 6vh, 4rem) !important;
      padding-bottom: clamp(2.5rem, 6vh, 4rem) !important;
    }
  }

  /* iOS-Zoom verhindern: Felder < 16px lassen Safari beim Fokus reinzoomen.
     Betrifft v.a. die Tool-Seiten (Quiz, Datum-Finder) mit 14–15px Inputs.
     !important schlägt die element-spezifischen styled-components-Klassen. */
  @media (max-width: 768px) {
    input:not([type='checkbox']):not([type='radio']):not([type='range']),
    textarea,
    select {
      font-size: 16px !important;
    }
  }

  /* Backstop gegen horizontales Auslaufen (zusätzlich zu body overflow-x) */
  html {
    overflow-x: hidden;
  }
  img, video {
    max-width: 100%;
    height: auto;
  }
  svg {
    max-width: 100%;
  }

  /* Nutzer mit "Bewegung reduzieren" (OS-Einstellung): Animationen entschärfen.
     Ändert NICHT das Standardverhalten – nur für Leute, die es aktiv wünschen. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

// ============================================
// MARKETING PAGE
// ============================================
function MarketingPage() {
  const { currentTheme, isLoading } = useTheme();
  
  // Scroll-Tiefe für A/B-Test tracken
  useScrollDepth();
  
  useEffect(() => {
    document.title = 'S&I. wedding — Premium Hochzeitswebsites';
  }, []);

  const isModern = currentTheme === 'modern';

  // Service statt Product: S&I. verkauft kein Self-Service-Tool, sondern die
  // persönliche Erstellung einer Hochzeitswebsite. Product mit Versand- und
  // Rückgaberichtlinie war für eine Dienstleistung semantisch falsch und stand
  // im Widerspruch zur Positionierung.
  // Preise kommen aus PUBLIC_PACKAGES (lib/pricing.js) — keine zweite
  // Preiswahrheit im Schema.
  const serviceSchema = {
    '@type': 'Service',
    '@id': 'https://www.sarahiver.com/#service',
    name: 'Individuelle Premium-Hochzeitswebsite',
    serviceType: 'Individuelle Erstellung einer Hochzeitswebsite',
    description: 'S&I. gestaltet und erstellt individuelle Hochzeitswebsites als persönliche Dienstleistung: gemeinsame Designabstimmung, Einrichtung, Prüfung und Go-Live. Auf Wunsch übernehmen wir den kompletten Aufbau inklusive Inhaltspflege.',
    url: 'https://www.sarahiver.com/',
    image: 'https://res.cloudinary.com/si-weddings/image/upload/v1770798416/si_og_image_nx5blq.png',
    // referenziert die Organization aus dem Prerender-Graph statt eine
    // zweite Entität anzulegen
    provider: { '@id': 'https://www.sarahiver.com/#organization' },
    areaServed: [
      { '@type': 'Country', name: 'Deutschland' },
      { '@type': 'Country', name: 'Österreich' },
      { '@type': 'Country', name: 'Schweiz' },
    ],
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceUrl: 'https://www.sarahiver.com/#contact',
    },
    offers: PUBLIC_PACKAGES.map(pkg => ({
      '@type': 'Offer',
      name: pkg.name,
      description: pkg.tagline,
      price: String(pkg.price),
      priceCurrency: 'EUR',
      priceValidUntil: '2027-12-31',
      availability: 'https://schema.org/InStock',
      url: 'https://www.sarahiver.com/#pricing',
      seller: { '@id': 'https://www.sarahiver.com/#organization' },
    })),
  };

  return (
    <AppWrapper>
      <SEOHead
        title="Premium-Hochzeitswebsite individuell erstellen lassen | S&I."
        description="Individuelle Hochzeitswebsites mit persönlicher Betreuung. S&I. gestaltet und erstellt eure Hochzeitswebsite als Premium-Service ab 990 €."
        path="/"
        schema={serviceSchema}
        keywords={['Hochzeitswebsite', 'Hochzeitswebsite erstellen', 'Wedding Website', 'digitale Hochzeitseinladung', 'RSVP Hochzeit', 'Premium Hochzeitswebsite', 'Hochzeitswebsite Hamburg']}
      />
      <LoadingOverlay $show={isLoading} $theme={currentTheme}>
        <LoadingLogo>S&I.</LoadingLogo>
        <LoadingText>Laden...</LoadingText>
      </LoadingOverlay>
      
      <BotanicalLeaves />
      <MarketingNav />

      {isModern ? (
        <Suspense fallback={<div style={{ height: '100vh', background: '#fff' }} />}>
          <ModernParallaxPage />
        </Suspense>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════
              ZIELARCHITEKTUR DER LANDINGPAGE (Sep 2026)

              01 Hero · 02 Design Collection · 03 Produkt · 04 Pricing
              05 Echte Geschichten · 06 Prozess · 07 FAQ · 08 Anfrage
              09 Final CTA · Footer

              Bewusst entfernt bzw. integriert:
              - FoundersIntro + AboutSection → nicht mehr auf der Homepage
              - WhyUsSection → die USPs stecken in Produkt und Prozess
              - ComponentsShowcase → Funktionen gehören in den Produktkontext,
                nicht in einen eigenen Feature-Trichter
              Die Komponenten bleiben im Repo, nur nicht mehr auf der Homepage.
              ═══════════════════════════════════════════════════════════ */}

          {/* 01 EMOTION */}
          <MarketingHero />

          {/* 02 STIL — acht Designwelten */}
          <AnimatedSection>
            <ThemeShowcase />
          </AnimatedSection>

          {/* 03 PRODUKT — großes Mockup, Funktionen im Kontext */}
          <AnimatedSection delay={100}>
            <USPSection />
          </AnimatedSection>
          <CTABand />

          {/* 04 PREIS */}
          <AnimatedSection delay={100}>
            <PromoBanner />
            <PricingSection />
          </AnimatedSection>

          {/* 05 DEMO-HOCHZEIT — Lea & Ben, ausdrücklich als Demo-Paar */}
          <AnimatedSection delay={50}>
            <DemoWedding />
          </AnimatedSection>

          {/* 06 PROZESS */}
          <AnimatedSection delay={100}>
            <HowItWorksSection />
          </AnimatedSection>

          {/* 07 FAQ */}
          <AnimatedSection delay={50}>
            <FAQSection />
          </AnimatedSection>

          {/* 08 ANFRAGE */}
          <AnimatedSection delay={100}>
            <ContactSection />
          </AnimatedSection>
          {/* Kooperationen stand hier zwischen Formular und Abschluss und
              richtete sich an Dienstleister statt an Paare — jetzt unter
              /kooperationen, verlinkt im Footer. */}

          {/* 09 ABSCHLUSS */}
          <FinalCTA />
          <MarketingFooter />
          <StickyDemoBar />
        </>
      )}
    </AppWrapper>
  );
}

// ============================================
// MAIN APP WITH THEME PROVIDER
// ============================================
function MainApp() {
  // Fonts werden statisch in index.html geladen (kein JS-Overhead)
  return (
    <MarketingPage />
  );
}

// ============================================
// HASH-SCROLL-HANDLER
// Scrollt zuverlässig zu #hash-Zielen — auch wenn die Sektion erst nach dem
// React-Render existiert (SPA-Problem: der Browser-Anchor-Jump kommt zu früh).
// Deckt ab: Blog-CTAs (/#contact), Tool-CTAs, Demo-Overlay
// (siwedding.de → sarahiver.com/#contact) und externe Deep-Links.
// ============================================
function ScrollToHashHandler() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace('#', '');
    let attempts = 0;
    let cancelled = false;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      } else if (attempts < 50) { // bis ~5s warten (lazy Sections)
        attempts += 1;
        setTimeout(tryScroll, 100);
      }
    };
    setTimeout(tryScroll, 150); // React Zeit zum Rendern geben
    return () => { cancelled = true; };
  }, [location.pathname, location.hash]);
  return null;
}

// ============================================
// APP WITH ROUTER
// ============================================
function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ABTestProvider>
          <Router>
            <GlobalStyles />
            <ScrollToHashHandler />
            <Routes>
              {/* Main Marketing Page */}
              <Route path="/" element={<MainApp />} />

              {/* Lazy-loaded Routes (Code-Splitting für besseren Initial-Bundle) */}
              <Route path="/blog" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#fff' }} />}>
                  <BlogPage />
                </Suspense>
              } />
              <Route path="/blog/:slug" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#fff' }} />}>
                  <BlogArticle />
                </Suspense>
              } />

              {/* Kostenlose Tools (Linkable Assets) */}
              <Route path="/hochzeitsdatum-finder" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FAF6EF' }} />}>
                  <HochzeitsdatumFinder />
                </Suspense>
              } />
              <Route path="/hochzeitsbudget-rechner" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FAF6EF' }} />}>
                  <BudgetRechner />
                </Suspense>
              } />
              <Route path="/embed/hochzeitsbudget-rechner" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FAF6EF' }} />}>
                  <BudgetRechner embed />
                </Suspense>
              } />
              <Route path="/embed/hochzeitsdatum-finder" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FAF6EF' }} />}>
                  <HochzeitsdatumFinder embed />
                </Suspense>
              } />
              <Route path="/embed/brautpaar-quiz" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FAF6EF' }} />}>
                  <QuizGenerator embed />
                </Suspense>
              } />
              <Route path="/brautpaar-quiz" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FAF6EF' }} />}>
                  <QuizGenerator />
                </Suspense>
              } />

              {/* Kooperationen — bewusst eigene Seite, nicht im Homepage-Funnel */}
              <Route path="/kooperationen" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#fff' }} />}>
                  <KooperationenPage />
                </Suspense>
              } />

              {/* Legal Pages */}
              <Route path="/impressum" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#fff' }} />}>
                  <ImpressumPage />
                </Suspense>
              } />
              <Route path="/datenschutz" element={
                <Suspense fallback={<div style={{ minHeight: '100vh', background: '#fff' }} />}>
                  <DatenschutzPage />
                </Suspense>
              } />

              {/* Fallback - redirect to home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
              {/* DSGVO Cookie Banner */}
              <CookieConsent />
            </Router>
          </ABTestProvider>
        </ThemeProvider>
      </ErrorBoundary>
  );
}

export default App;

// ============================================
// STYLED COMPONENTS
// ============================================
const AppWrapper = styled.div`
  min-height: 100vh;
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const LoadingOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: ${p => p.$show ? 1 : 0};
  visibility: ${p => p.$show ? 'visible' : 'hidden'};
  transition: opacity 0.3s ease, visibility 0.3s ease;
  background: ${p => p.$theme === 'neon' ? '#0a0a0f' : '#FFFFFF'};
`;

const LoadingLogo = styled.div`
  font-family: 'Roboto', sans-serif;
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.06em;
  background: #000000;
  color: #FFFFFF;
  padding: 12px 24px;
  margin-bottom: 30px;
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const LoadingText = styled.p`
  font-size: 0.9rem;
  letter-spacing: 0.1em;
  color: rgba(0,0,0,0.5);
  font-family: 'Inter', sans-serif;
  animation: ${pulse} 1.5s ease-in-out infinite;
`;
