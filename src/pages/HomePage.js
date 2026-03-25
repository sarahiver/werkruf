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
    reset,
    markSent,
  } = usePlacesAnalysis();

  return (
    <main>
      <Hero
        onPlaceSelect={runAnalysis}
        fetchErr={fetchErr}
      />
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
  );
}
