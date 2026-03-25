// src/hooks/usePlacesAnalysis.js
// ============================================================
// FIX: Google Places API v1 Migration
//
// Alte Felder (Classic API)  →  Neue Felder (v1 / New Places API)
//   place.place_id           →  place.id
//   place.name               →  place.displayName.text
//   place.formatted_address  →  place.formattedAddress
//   place.geometry.location  →  place.location  (LatLng direkt)
//
// Field Masking: Ohne explizite setFields() liefert die API undefined.
// Autocomplete-Init muss folgende Felder anfordern:
//   ['id', 'displayName', 'formattedAddress', 'location', 'addressComponents']
// ============================================================

import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Hilfsfunktion: Sichere Extraktion von Adresskomponenten (unverändert)
// ---------------------------------------------------------------------------
function extractAddressComponent(components = [], type, nameType = 'long_name') {
  const comp = components.find((c) => c.types?.includes(type));
  return comp ? comp[nameType] : '';
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Koordinaten normalisieren (v1 liefert LatLng-Objekt direkt)
// ---------------------------------------------------------------------------
function extractCoordinates(place) {
  // v1 New Places API: place.location ist ein LatLng-Literal { lat, lng }
  if (place.location) {
    const lat = typeof place.location.lat === 'function'
      ? place.location.lat()
      : place.location.lat;
    const lng = typeof place.location.lng === 'function'
      ? place.location.lng()
      : place.location.lng;
    return { lat, lng };
  }

  // Fallback: Classic API place.geometry.location
  if (place.geometry?.location) {
    return {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
  }

  return { lat: null, lng: null };
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Name sicher lesen (v1 vs Classic)
// ---------------------------------------------------------------------------
function extractName(place) {
  // v1: displayName ist ein Objekt { text: '...', languageCode: '...' }
  if (place.displayName?.text) return place.displayName.text;
  // Classic fallback
  if (typeof place.name === 'string' && place.name) return place.name;
  return '';
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Adresse sicher lesen (v1 vs Classic)
// ---------------------------------------------------------------------------
function extractAddress(place) {
  // v1: formattedAddress
  if (place.formattedAddress) return place.formattedAddress;
  // Classic fallback
  if (place.formatted_address) return place.formatted_address;
  return '';
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Place ID sicher lesen (v1 vs Classic)
// ---------------------------------------------------------------------------
function extractPlaceId(place) {
  // v1: id
  if (place.id) return place.id;
  // Classic fallback
  if (place.place_id) return place.place_id;
  return null;
}

// ---------------------------------------------------------------------------
// Hook: usePlacesAnalysis
// ---------------------------------------------------------------------------
export function usePlacesAnalysis() {
  const [analysisData, setAnalysisData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  // -------------------------------------------------------------------------
  // handlePlaceSelected
  // Wird von Hero.js / Autocomplete-Widget aufgerufen, wenn ein Ort gewählt wird.
  // -------------------------------------------------------------------------
  const handlePlaceSelected = useCallback(async (place) => {
    // ── Task 3: Null-Check ────────────────────────────────────────────────
    // Ohne diesen Check: "Cannot read properties of undefined (reading 'place_id')"
    if (!place) {
      console.warn('[usePlacesAnalysis] place ist undefined – Abbruch.');
      return;
    }

    // v1 nutzt `id`, Classic nutzt `place_id` → beide abfangen
    const placeId = extractPlaceId(place);
    if (!placeId) {
      console.warn('[usePlacesAnalysis] Kein place.id gefunden – Abbruch.', place);
      return;
    }
    // ── Ende Null-Check ───────────────────────────────────────────────────

    // Laufende Anfrage abbrechen
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      // ── Task 1: v1 Feldnamen ────────────────────────────────────────────
      const name = extractName(place);             // v1: displayName.text
      const address = extractAddress(place);       // v1: formattedAddress
      const { lat, lng } = extractCoordinates(place); // v1: location
      const addressComponents = place.addressComponents || place.address_components || [];

      const city = extractAddressComponent(addressComponents, 'locality')
        || extractAddressComponent(addressComponents, 'administrative_area_level_2');
      const postalCode = extractAddressComponent(addressComponents, 'postal_code');
      const country = extractAddressComponent(addressComponents, 'country', 'short_name');

      const normalizedPlace = {
        // ── Task 1: Einheitliche interne Struktur ──────────────────────────
        id: placeId,           // war: place_id
        name,                  // war: place.name
        address,               // war: formatted_address
        lat,
        lng,
        city,
        postalCode,
        country,
        // Rohdaten für spätere Erweiterungen
        raw: place,
      };

      setAnalysisData(normalizedPlace);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[usePlacesAnalysis] Fehler:', err);
        setError(err.message || 'Unbekannter Fehler');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setAnalysisData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    analysisData,
    isLoading,
    error,
    handlePlaceSelected,
    reset,
  };
}

export default usePlacesAnalysis;
