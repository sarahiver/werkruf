import React from 'react';
import GlobalStyle from './components/GlobalStyle';
import Header from './components/Header';
import Hero from './components/Hero';
import SmartCheck from './components/SmartCheck';
import Features from './components/Features';
import LeadForm from './components/LeadForm';
import Footer from './components/Footer';

function App() {
  return (
    <>
      <GlobalStyle />
      <Header />
      <main>
        <Hero />
        <SmartCheck />
        <Features />
        <LeadForm />
      </main>
      <Footer />
    </>
  );
}

export default App;
