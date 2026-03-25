import React from 'react';
import GlobalStyle from './components/GlobalStyle';
import Header from './components/Header';
import Hero from './components/Hero';
import AnalysisSection from './components/AnalysisSection';
import Features from './components/Features';
import LeadForm from './components/LeadForm';
import Footer from './components/Footer';
import { usePlacesAnalysis } from './hooks/usePlacesAnalysis';

function App() {
  const {
    phase,
    scanStep,
    result,
    fetchErr,
    selectedPlace,
    runAnalysis,
    reset,
    markSent,
  } = usePlacesAnalysis();

  return (
    <>
      <GlobalStyle />
      <Header />
      <main>
        {/* Hero passes onPlaceSelect up — triggers scroll + analysis */}
        <Hero
          onPlaceSelect={runAnalysis}
          fetchErr={fetchErr}
        />

        {/* Analysis section is the scroll target */}
        <AnalysisSection
          phase={phase}
          scanStep={scanStep}
          result={result}
          selectedPlace={selectedPlace}
          onReset={reset}
          onMarkSent={markSent}
        />

        <Features />
        <LeadForm />
      </main>
      <Footer />
    </>
  );
}

export default App;
