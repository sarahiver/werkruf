import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

/* Industry system */
import { IndustryProvider } from './context/IndustryContext';
import ThemeInjector        from './components/ThemeInjector';

/* Shell */
import GlobalStyle from './components/GlobalStyle';
import Header      from './components/Header';
import Footer      from './components/Footer';

/* Pages */
import HomePage from './pages/HomePage';
import Pricing  from './pages/Pricing';

/* Placeholder pages */
const Placeholder = ({ title }) => (
  <div style={{
    padding: '120px 24px', textAlign: 'center',
    fontFamily: 'var(--font-display)', fontSize: '2rem',
    color: 'var(--color-primary)', textTransform: 'var(--text-transform)',
  }}>
    {title} — COMING SOON
  </div>
);

function App() {
  return (
    /*
      IndustryProvider reads the domain/URL and provides
      the correct config to all children via context.
      
      ThemeInjector (render-less) writes CSS custom properties
      to :root so all styled-components can use var(--color-*)
    */
    <IndustryProvider>
      <BrowserRouter>
        <GlobalStyle />
        <ThemeInjector />
        <Header />
        <Routes>
          <Route path="/"         element={<HomePage />} />
          <Route path="/pricing"  element={<Pricing />} />
          <Route path="/register" element={<Placeholder title="Registrierung" />} />
          <Route path="/login"    element={<Placeholder title="Login" />} />
          <Route path="/impressum"   element={<Placeholder title="Impressum" />} />
          <Route path="/datenschutz" element={<Placeholder title="Datenschutz" />} />
        </Routes>
        <Footer />
      </BrowserRouter>
    </IndustryProvider>
  );
}

export default App;
