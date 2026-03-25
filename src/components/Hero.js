// src/components/Hero.js
// ============================================================
// FIX: Google Places API v1 Migration
//
// Task 2: Field Masking im Autocomplete-Init
//   autocomplete.setFields(['id', 'displayName', 'formattedAddress', 'location', 'addressComponents'])
//   Ohne diese Zeile → alle Felder = undefined → TypeError
//
// Task 4: onPlaceSelected gibt neues Datenformat weiter
//   place.id             (statt place_id)
//   place.displayName    (statt name)
//   place.formattedAddress (statt formatted_address)
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { ArrowRight, MapPin, Search } from 'lucide-react';
import { usePlacesAnalysis } from '../hooks/usePlacesAnalysis';

// ---------------------------------------------------------------------------
// Google Maps Script Loader (singleton)
// ---------------------------------------------------------------------------
let _mapsPromise = null;

function loadGoogleMaps(apiKey) {
  if (_mapsPromise) return _mapsPromise;

  if (window.google?.maps?.places) {
    _mapsPromise = Promise.resolve();
    return _mapsPromise;
  }

  _mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Task 2: 'places' library laden (enthält Autocomplete)
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=de`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => {
      _mapsPromise = null;
      reject(new Error('Google Maps konnte nicht geladen werden'));
    };
    document.head.appendChild(script);
  });

  return _mapsPromise;
}

// ---------------------------------------------------------------------------
// Autocomplete Hook
// ---------------------------------------------------------------------------
function useAutocomplete(inputRef, onPlaceSelected) {
  const autocompleteRef = useRef(null);

  useEffect(() => {
    const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
    if (!inputRef.current || !apiKey) return;

    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !inputRef.current) return;

        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ['establishment', 'geocode'],
          componentRestrictions: { country: ['de', 'at', 'ch'] },
        });

        // ── Task 2: Field Masking ──────────────────────────────────────────
        // KRITISCH: Ohne setFields() → alle place-Properties = undefined
        // v1 Feldnamen: 'id', 'displayName', 'formattedAddress', 'location', 'addressComponents'
        // Classic Fallback (falls alte API aktiv): 'place_id', 'name', 'formatted_address', 'geometry', 'address_components'
        ac.setFields([
          'id',                  // v1 (war: place_id)
          'displayName',         // v1 (war: name)
          'formattedAddress',    // v1 (war: formatted_address)
          'location',            // v1 (war: geometry)
          'addressComponents',   // v1 (war: address_components)
          // Classic Fallbacks (schadet nicht, wird ignoriert wenn v1 aktiv)
          'place_id',
          'name',
          'formatted_address',
          'geometry',
          'address_components',
        ]);

        ac.addListener('place_changed', () => {
          const place = ac.getPlace();

          // ── Task 4: Null-Check vor Weitergabe ──────────────────────────
          if (!place) return;

          // v1: place.id | Classic: place.place_id
          const hasId = place.id || place.place_id;
          if (!hasId) {
            console.warn('[Hero] place ohne ID empfangen – User hat nur Text eingegeben ohne Auswahl');
            return;
          }

          // ── Task 4: Rohe place direkt weitergeben ─────────────────────
          // usePlacesAnalysis.handlePlaceSelected normalisiert die Felder intern.
          // Kein Mapping hier nötig — der Hook übernimmt v1 vs Classic Erkennung.
          onPlaceSelected(place);
        });

        autocompleteRef.current = ac;
      })
      .catch((err) => {
        console.error('[Hero] Google Maps Ladefehler:', err.message);
      });

    return () => {
      cancelled = true;
      if (autocompleteRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [inputRef, onPlaceSelected]);
}

// ---------------------------------------------------------------------------
// Styled Components
// ---------------------------------------------------------------------------
const HeroSection = styled.section`
  min-height: 100vh;
  background: #002C51;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #fff;
`;

const Headline = styled.h1`
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 900;
  text-align: center;
  line-height: 1.1;
  margin-bottom: 16px;
  max-width: 800px;
`;

const Subline = styled.p`
  font-size: 1.125rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.75);
  max-width: 560px;
  margin-bottom: 40px;
`;

const SearchWrapper = styled.div`
  width: 100%;
  max-width: 520px;
  position: relative;
`;

const SearchIcon = styled(Search)`
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #666;
  pointer-events: none;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 16px 16px 16px 48px;
  font-size: 1rem;
  border: none;
  border-radius: 4px;
  background: #fff;
  color: #0A0A0A;
  outline: none;
  box-sizing: border-box;

  &::placeholder {
    color: #999;
  }
`;

const ResultCard = styled.div`
  margin-top: 24px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  padding: 20px 24px;
  max-width: 520px;
  width: 100%;
`;

const ResultName = styled.p`
  font-weight: 700;
  font-size: 1.1rem;
  margin: 0 0 4px;
`;

const ResultAddress = styled.p`
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const CTAButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #FF8C00;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 12px 24px;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #e07d00;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorMsg = styled.p`
  color: #ff6b6b;
  font-size: 0.875rem;
  margin-top: 12px;
`;

// ---------------------------------------------------------------------------
// Hero Component
// ---------------------------------------------------------------------------
export default function Hero() {
  const inputRef = useRef(null);
  const [inputValue, setInputValue] = useState('');

  const { analysisData, isLoading, error, handlePlaceSelected } = usePlacesAnalysis();

  // ── Task 4: Stable callback für useAutocomplete ──────────────────────────
  // onPlaceSelected wird an useAutocomplete weitergegeben.
  // handlePlaceSelected aus dem Hook ist bereits useCallback-stabilisiert.
  const onPlaceSelected = useCallback(
    (place) => {
      // Task 3 & 4: Null-Check hier und im Hook
      if (!place) return;

      // Den place direkt an den Hook übergeben —
      // Normalisierung (place_id → id, name → displayName.text etc.) passiert im Hook.
      handlePlaceSelected(place);
    },
    [handlePlaceSelected]
  );

  // ── Task 2: Autocomplete mit Field Masking initialisieren ─────────────────
  useAutocomplete(inputRef, onPlaceSelected);

  const handleCTA = () => {
    if (!analysisData) return;
    // Weiterleitung zum nächsten Schritt / Analyse-Seite
    console.log('[Hero] CTA clicked with:', analysisData);
    // z.B.: navigate(`/analyse?id=${analysisData.id}`);
  };

  return (
    <HeroSection>
      <Headline>Volle Auftragsbücher?<br />Pick dir die Rosinen.</Headline>
      <Subline>
        Gib deinen Betrieb ein und sieh sofort, wie du im Netz wirklich dastehst.
      </Subline>

      <SearchWrapper>
        <SearchIcon size={18} />
        <SearchInput
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Firma oder Adresse eingeben…"
          aria-label="Betrieb suchen"
        />
      </SearchWrapper>

      {error && <ErrorMsg>⚠️ {error}</ErrorMsg>}

      {/* ── Task 4: Ergebnis aus Hook anzeigen ────────────────────────────── */}
      {analysisData && (
        <ResultCard>
          <ResultName>{analysisData.name}</ResultName>
          <ResultAddress>
            <MapPin size={14} />
            {analysisData.address}
          </ResultAddress>
          <CTAButton onClick={handleCTA} disabled={isLoading}>
            {isLoading ? 'Lädt…' : <>Sichtbarkeit prüfen <ArrowRight size={16} /></>}
          </CTAButton>
        </ResultCard>
      )}
    </HeroSection>
  );
}
