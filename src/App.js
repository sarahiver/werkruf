import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LinkAbgelaufen from './pages/LinkAbgelaufen';
import Bestaetigen    from './pages/Bestaetigen';
import Einstieg from './pages/Einstieg';

/* Providers */
import { IndustryProvider } from './context/IndustryContext';
import { AuthProvider }     from './context/AuthContext';
import ThemeInjector        from './components/ThemeInjector';
import ProtectedRoute       from './components/auth/ProtectedRoute';
import AdminRoute           from './components/auth/AdminRoute';
import OnboardingWeiche     from './components/auth/OnboardingWeiche';
import Fehlergrenze         from './components/Fehlergrenze';

/* Global shell */
import GlobalStyle from './components/GlobalStyle';
import Header      from './components/Header';
import Footer      from './components/Footer';

/* Public pages */
import HomePage  from './pages/HomePage';
import Pricing   from './pages/Pricing';
import Success   from './pages/Success';
import Signup    from './pages/Signup';
import Login     from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword  from './pages/ResetPassword';

/* Dashboard */
import DashboardLayout      from './pages/dashboard/DashboardLayout';
import DashboardHome        from './pages/dashboard/DashboardHome';
import DashboardSettings       from './pages/dashboard/DashboardSettings';
import DashboardBewertungen    from './pages/dashboard/DashboardBewertungen';
import DashboardGoogleBusiness from './pages/dashboard/DashboardGoogleBusiness';
import DashboardFotos          from './pages/dashboard/DashboardFotos';
import DashboardKundenGewinnung from './pages/dashboard/DashboardKundenGewinnung';
import ProGate                 from './components/dashboard/ProGate';
import Impressum            from './pages/Impressum';
import AGB                  from './pages/AGB';
import AVV                  from './pages/AVV';
import Hilfe                from './pages/Hilfe';
import NotFound             from './pages/NotFound';
import Onboarding           from './pages/Onboarding';
import Admin                from './pages/Admin';
import Datenschutz          from './pages/Datenschutz';

/* ─────────────────────────────────────────────
   Shell wrapper — Header + Footer only on
   public pages, not inside the Dashboard
───────────────────────────────────────────── */
function PublicLayout({ children }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}

function App() {
  return (
    /*
      Provider order:
      1. IndustryProvider — detects domain → loads brand/colors/copy
      2. BrowserRouter    — routing
      3. AuthProvider     — Supabase session (needs to be inside Router
                           so auth redirects work)
      4. ThemeInjector    — writes CSS vars from industry config to :root
    */
    /*
      Die Fehlergrenze liegt GANZ AUSSEN — ausserhalb der Provider.
      Laege sie innerhalb, koennte ein Fehler in IndustryProvider oder
      AuthProvider an ihr vorbei den ganzen Baum abraeumen. Sie braucht
      dafuer bewusst nichts von dem, was die Provider liefern: keine
      Theme-Variablen, kein Router, keine styled-components.
      Siehe components/Fehlergrenze.js.
    */
    <Fehlergrenze>
    <IndustryProvider>
      <BrowserRouter>
        <AuthProvider>
          <GlobalStyle />
          <ThemeInjector />
          {/* Faengt einen angemeldeten Nutzer auf, dessen Rueckweg von
              Google auf einer oeffentlichen Seite endete. Greift nur
              bei begonnener Einrichtung — siehe OnboardingWeiche. */}
          <OnboardingWeiche />

          <Routes>
            {/* ── PUBLIC ── */}
            <Route path="/" element={
              <PublicLayout><HomePage /></PublicLayout>
            } />
            <Route path="/pricing" element={
              <PublicLayout><Pricing /></PublicLayout>
            } />
            <Route path="/success" element={<Success />} />
            <Route path="/signup"  element={<Signup />} />
            <Route path="/login"   element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/impressum" element={
              <PublicLayout><Impressum /></PublicLayout>
            } />
            <Route path="/datenschutz" element={
              <PublicLayout><Datenschutz /></PublicLayout>
            } />
            <Route path="/agb" element={
              <PublicLayout><AGB /></PublicLayout>
            } />
            {/* Anlage zu den AGB (§ 13). Eigene Seite, weil der Kunde
                sie fuer seine eigene Dokumentation verlinken muss. */}
            <Route path="/avv" element={
              <PublicLayout><AVV /></PublicLayout>
            } />
            <Route path="/hilfe" element={
              <PublicLayout><Hilfe /></PublicLayout>
            } />

            {/* ── PROTECTED DASHBOARD ── */}
            {/* Mail-Link nicht mehr gueltig. Oeffentlich — der
                Besucher ist per Definition nicht angemeldet. */}
            <Route path="/link-abgelaufen" element={<LinkAbgelaufen />} />

            {/* Zwischenseite fuer den Bestaetigungslink aus der
                Registrierungsmail. Oeffentlich und OHNE OnboardingWeiche
                — der Besucher hat noch keine Sitzung. Traegt den
                Einmal-Link als Knopf, damit Mail-Scanner (Microsoft Safe
                Links) ihn nicht vor dem Menschen verbrauchen. Siehe
                pages/Bestaetigen.js. */}
            <Route path="/bestaetigen" element={<Bestaetigen />} />

            {/* Uebergabe nach der Anmeldung ueber einen Mail-Link.
                Prueft serverseitig, ob die Sitzung zum Link passt. */}
            <Route path="/einstieg" element={<Einstieg />} />

            <Route path="/dashboard" element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }>
              {/* index = /dashboard */}
              <Route index element={<DashboardHome />} />

              {/* Nested routes */}
              <Route path="google" element={<DashboardGoogleBusiness />} />
              <Route path="bewertungen" element={
                <ProGate feature="Bewertungen"><DashboardBewertungen /></ProGate>
              } />
              <Route path="fotos" element={<DashboardFotos />} />
              <Route path="kunden-gewinnung" element={<DashboardKundenGewinnung />} />
              {/* "Entwicklung"/Reporting am 21.10.2026 aus dem Produkt
                  genommen — siehe NAV_ITEMS in DashboardLayout. Wer die
                  Adresse als Lesezeichen hat, landet auf der Uebersicht
                  statt auf einer leeren Seite oder einem 404. */}
              <Route path="reporting" element={<Navigate to="/dashboard" replace />} />
              <Route path="einstellungen" element={<DashboardSettings />} />
            </Route>

            {/* ── STANDALONE (ohne PublicLayout) ── */}
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />

            {/* ── 404 ──
                 Muss die LETZTE Route bleiben. Vorher standen hier zwei
                 Catch-all-Routen; die erste gewann, weshalb NotFound nie
                 gerendert wurde und stattdessen der Platzhalter mit
                 "COMING SOON" erschien. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </IndustryProvider>
    </Fehlergrenze>
  );
}

export default App;
