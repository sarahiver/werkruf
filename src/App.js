import React from 'react';
import GlobalStyle from './components/GlobalStyle';
import Header from './components/Header';
import Hero from './components/Hero';
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
        <Features />
        <LeadForm />
      </main>
      <Footer />
    </>
  );
}

export default App;
