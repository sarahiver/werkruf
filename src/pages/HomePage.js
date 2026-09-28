import React from 'react';
import Hero            from '../components/Hero';
import AnalysisSection from '../components/AnalysisSection';
import Features        from '../components/Features';
import LeadForm        from '../components/LeadForm';
import { usePlacesAnalysis } from '../hooks/usePlacesAnalysis';

export default function HomePage() {
  const {
    phase,
    scanStep,
    result,
    fetchErr,
    selectedPlace,
    runAnalysis,
    runManualAnalysis,
    reset,
    markSent,
  } = usePlacesAnalysis();
  const resetAll = () => {
    reset();
    window.dispatchEvent(new Event('werkruf:reset-place-search'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main>
      <Hero
        onPlaceSelect={runAnalysis}
        fetchErr={fetchErr}
        onNoResults={runManualAnalysis}
      />
      <AnalysisSection
        phase={phase}
        scanStep={scanStep}
        result={result}
        selectedPlace={selectedPlace}
        onReset={resetAll}
        onMarkSent={markSent}
      />
      <Features />
      <LeadForm />
    </main>
  );
}
