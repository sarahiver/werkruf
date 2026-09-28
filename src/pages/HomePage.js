import React, { useState } from 'react';
import Hero            from '../components/Hero';
import AnalysisSection from '../components/AnalysisSection';
import Features        from '../components/Features';
import LeadForm        from '../components/LeadForm';
import { usePlacesAnalysis } from '../hooks/usePlacesAnalysis';

export default function HomePage() {
  const [searchResetKey, setSearchResetKey] = useState(0);
  const {
    phase,
    scanStep,
    result,
    fetchErr,
    selectedPlace,
    runAnalysis,
    runManualAnalysis,
    reset,
  } = usePlacesAnalysis();
  const resetAll = () => {
    reset();
    setSearchResetKey(key => key + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main>
      <Hero
        onPlaceSelect={runAnalysis}
        fetchErr={fetchErr}
        onNoResults={runManualAnalysis}
        searchResetKey={searchResetKey}
      />
      <AnalysisSection
        phase={phase}
        scanStep={scanStep}
        result={result}
        selectedPlace={selectedPlace}
        onReset={resetAll}
      />
      <Features />
      <LeadForm />
    </main>
  );
}
