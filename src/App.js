import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

/* Providers */
import { IndustryProvider } from './context/IndustryContext';
import { AuthProvider }     from './context/AuthContext';
import ThemeInjector        from './components/ThemeInjector';
import ProtectedRoute       from './components/auth/ProtectedRoute';

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

/* Dashboard */
import DashboardLayout      from './pages/dashboard/DashboardLayout';
import DashboardHome        from './pages/dashboard/DashboardHome';
import DashboardReporting   from './pages/dashboard/DashboardReporting';
import DashboardSettings    from './pages/dashboard/DashboardSettings';
import Impressum            from './pages/Impressum';
import NotFound             from './pages/NotFound';
import Datenschutz          from './pages/Datenschutz';
import { DashboardPlaceholder } from './pages/dashboard/DashboardPlaceholder';

/* Placeholder for future pages */
const Placeholder = ({ title }) => (
  <div style={{
    padding: '120px 24px', textAlign: 'center',
    fontFamily: 'var(--font-display)', fontSize: '2rem',
    color: 'var(--color-primary)', textTransform: 'var(--text-transform)',
  }}>
    {title} — COMING SOON
  </div>
);

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
    <IndustryProvider>
      <BrowserRouter>
        <AuthProvider>
          <GlobalStyle />
          <ThemeInjector />

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
            <Route path="/forgot-password" element={
              <PublicLayout><Placeholder title="Passwort zurücksetzen" /></PublicLayout>
            } />
            <Route path="/impressum" element={
              <PublicLayout><Impressum /></PublicLayout>
            } />
            <Route path="/datenschutz" element={
              <PublicLayout><Datenschutz /></PublicLayout>
            } />

            {/* ── PROTECTED DASHBOARD ── */}
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }>
              {/* index = /dashboard */}
              <Route index element={<DashboardHome />} />

              {/* Nested routes */}
              <Route path="bewertungen" element={
                <DashboardPlaceholder
                  title="Bewertungen"
                  description="Alle Google-Rezensionen auf einen Blick — mit KI-Antwort-Assistent."
                />
              } />
              <Route path="fotos" element={
                <DashboardPlaceholder
                  title="Fotos"
                  description="Google-Profilbilder verwalten und optimieren."
                />
              } />
              <Route path="reporting" element={<DashboardReporting />} />
              <Route path="einstellungen" element={<DashboardSettings />} />
            </Route>

            {/* 404 */}
            <Route path="*" element={
              <PublicLayout>
                <Placeholder title="404 — Seite nicht gefunden" />
              </PublicLayout>
            } />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </AuthProvider>
      </BrowserRouter>
    </IndustryProvider>
  );
}

export default App;
