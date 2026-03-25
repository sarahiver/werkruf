import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { Search, AlertCircle } from 'lucide-react';

const spin = keyframes`to { transform: rotate(360deg); }`;

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Wrap = styled.div`position: relative;`;

const SearchIconWrap = styled.div`
  position: absolute; left: 13px; top: 19px;
  color: var(--color-accent); display: flex; align-items: center;
  z-index: 5; pointer-events: none;
`;

const StyledInput = styled.input`
  width: 100%;
  padding: 13px 40px 13px 40px;
  border: 2px solid ${({ $dark }) => $dark ? 'rgba(255,255,255,.2)' : 'var(--color-border)'};
  background: ${({ $dark }) => $dark ? 'rgba(255,255,255,.08)' : 'var(--color-bg)'};
  color: ${({ $dark }) => $dark ? 'white' : 'var(--color-text)'};
  font-family: var(--font-body); font-size: 1rem;
  outline: none; border-radius: var(--radius-card);
  transition: border-color .2s, background .2s;
  box-sizing: border-box;

  &:focus {
    border-color: var(--color-accent);
    background: ${({ $dark }) => $dark ? 'rgba(255,255,255,.13)' : 'var(--color-white)'};
  }
  &::placeholder {
    color: ${({ $dark }) => $dark ? 'rgba(255,255,255,.4)' : '#A0ADB8'};
  }
`;

const Spinner = styled.div`
  position: absolute; right: 13px; top: 19px;
  width: 16px; height: 16px;
  border: 2px solid rgba(var(--color-accent-rgb), .3);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: ${spin} .7s linear infinite;
`;

const ClearBtn = styled.button`
  position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; padding: 4px;
  color: ${({ $dark }) => $dark ? 'rgba(255,255,255,.45)' : '#A0ADB8'};
  font-size: 14px; line-height: 1;
  &:hover { color: ${({ $dark }) => $dark ? 'white' : 'var(--color-primary)'}; }
`;

/* Fallback trigger — shown after typing with no results */
const FallbackRow = styled.div`
  margin-top: 8px;
  display: flex; align-items: center; gap: 6px;
`;

const FallbackBtn = styled.button`
  background: none; border: none; cursor: pointer; padding: 0;
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted);
  text-decoration: underline; text-underline-offset: 2px;
  display: flex; align-items: center; gap: 5px;
  transition: color .2s;
  &:hover { color: var(--color-accent); }
`;

/* Override Google's pac-container to match our theme */
const GlobalPacStyle = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .pac-container {
        border: 2px solid var(--color-primary, #002C51) !important;
        border-top: none !important;
        border-radius: 0 0 4px 4px !important;
        box-shadow: 0 8px 24px rgba(0,44,81,.15) !important;
        font-family: var(--font-body, Arial, sans-serif) !important;
        margin-top: -2px;
        z-index: 10000 !important;
      }
      .pac-item {
        padding: 10px 14px !important;
        font-size: 14px !important;
        border-top: 1px solid #E5EBF0 !important;
        cursor: pointer !important;
        color: #1A1A1A !important;
      }
      .pac-item:hover, .pac-item-selected {
        background: rgba(0,44,81,.05) !important;
      }
      .pac-item-query {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: var(--color-primary, #002C51) !important;
      }
      .pac-matched { color: var(--color-accent, #FF8C00) !important; }
      .pac-icon { display: none !important; }
      .pac-logo::after { display: none !important; }
    `;
    style.id = 'pac-overrides';
    if (!document.getElementById('pac-overrides')) {
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById('pac-overrides');
      if (el) el.remove();
    };
  }, []);
  return null;
};

/* ─────────────────────────────────────────────
   WAIT FOR GOOGLE HELPER
   Polls until window.google.maps.places is ready
   (script loads async — may not be ready on mount)
───────────────────────────────────────────── */
function waitForGoogle(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }
    const start    = Date.now();
    const interval = setInterval(() => {
      if (window.google?.maps?.places) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('Google Maps timed out'));
      }
    }, 100);
  });
}

/* ─────────────────────────────────────────────
   COMPONENT

   Props:
     onSelect(result)    result = { placeId, name, address,
                                    rating, reviewCount,
                                    hasWebsite, website,
                                    addressComponents }
     onNoResults()       called when user has typed ≥3 chars
                         and the dropdown shows nothing
     placeholder         string
     dark                bool  (for hero dark background)
     style               optional style override
───────────────────────────────────────────── */
export default function PlacesSearch({
  onSelect,
  onNoResults,
  placeholder,
  dark = false,
  style,
}) {
  const inputRef      = useRef(null);
  const autocompleteRef = useRef(null);
  const [ready,       setReady]       = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [query,       setQuery]       = useState('');
  const [showFallback,setShowFallback]= useState(false);

  /* ─────────────────────────────────────────────
     1. Wait for Google → init Autocomplete widget
  ───────────────────────────────────────────── */
  useEffect(() => {
    let destroyed = false;

    waitForGoogle()
      .then(() => {
        if (destroyed || !inputRef.current) return;

        /* new google.maps.places.Autocomplete
           Uses the same input element — Google renders
           its own dropdown (.pac-container) */
        const ac = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types:                ['establishment'],
            componentRestrictions:{ country: 'de' },
            language:             'de',
            // Field masking in constructor (legacy format)
            fields: [
              'place_id', 'name', 'formatted_address',
              'address_components', 'rating', 'user_ratings_total',
              'website', 'geometry',
            ],
          }
        );

        // Also call setFields explicitly for v1 API (CamelCase)
        // This ensures field masking works regardless of API version
        if (typeof ac.setFields === 'function') {
          ac.setFields([
            'id', 'displayName', 'formattedAddress',
            'location', 'addressComponents',
            'rating', 'userRatingCount', 'websiteURI',
            // legacy names in same call — Google ignores unknown ones
            'place_id', 'name', 'formatted_address',
            'address_components', 'user_ratings_total', 'website',
          ]);
        }

        /* ── place_changed: user selected a suggestion ── */
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          console.log('[PlacesSearch] Raw place object:', place);

          // Null-check: no valid place selected (e.g. user pressed Enter)
          const placeId = place?.id || place?.place_id;
          if (!place || !placeId) {
            setShowFallback(true);
            return;
          }

          setShowFallback(false);
          setLoading(false);

          // Normalise — v1 CamelCase + legacy snake_case, take whichever exists
          const normalised = {
            placeId:           placeId,
            name:              place.displayName?.text
                            || place.name
                            || '',
            address:           place.formattedAddress
                            || place.formatted_address
                            || '',
            rating:            place.rating || 0,
            reviewCount:       place.userRatingCount
                            || place.user_ratings_total
                            || 0,
            hasWebsite:        !!(place.websiteURI || place.website),
            website:           place.websiteURI
                            || place.website
                            || null,
            addressComponents: place.addressComponents
                            || place.address_components
                            || [],
          };

          console.log('[PlacesSearch] Normalised result:', normalised);
          if (onSelect) onSelect(normalised);
        });

        autocompleteRef.current = ac;
        setReady(true);
      })
      .catch(err => {
        console.warn('[PlacesSearch] Google Maps not available:', err.message);
      });

    return () => {
      destroyed = true;
      // Clean up Google listener
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []); // run once on mount

  /* ─────────────────────────────────────────────
     2. Track query for fallback trigger
  ───────────────────────────────────────────── */
  const handleInput = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);
    // Hide fallback while user is typing again
    if (showFallback) setShowFallback(false);
    // Show fallback hint if long enough query but no selection yet
    // Google fires place_changed on selection — if user clears or types
    // and blurs without selecting, we show fallback after blur
  }, [showFallback]);

  const handleBlur = useCallback(() => {
    // Small delay so place_changed fires first
    setTimeout(() => {
      if (query.length >= 3 && !autocompleteRef.current?.getPlace()?.place_id
          && !autocompleteRef.current?.getPlace()?.id) {
        setShowFallback(true);
      }
    }, 400);
  }, [query]);

  const handleClear = useCallback(() => {
    setQuery('');
    setShowFallback(false);
    if (inputRef.current) inputRef.current.value = '';
    if (onSelect) onSelect(null);
  }, [onSelect]);

  const handleFallback = useCallback(() => {
    setShowFallback(false);
    if (onNoResults) onNoResults();
  }, [onNoResults]);

  return (
    <>
      <GlobalPacStyle />
      <Wrap style={style}>
        <SearchIconWrap>
          <Search size={17} />
        </SearchIconWrap>

        <StyledInput
          ref={inputRef}
          type="text"
          placeholder={ready ? (placeholder || 'Betrieb suchen…') : 'Karte wird geladen…'}
          disabled={!ready}
          $dark={dark}
          onInput={handleInput}
          onBlur={handleBlur}
          autoComplete="off"
          spellCheck="false"
        />

        {loading && <Spinner />}
        {!loading && query && (
          <ClearBtn $dark={dark} onClick={handleClear} type="button">✕</ClearBtn>
        )}
      </Wrap>

      {/* Fallback — shown when typing yields no selection */}
      {showFallback && (
        <FallbackRow>
          <AlertCircle size={13} color="var(--color-text-muted)" />
          <FallbackBtn onClick={handleFallback} type="button">
            Betrieb nicht gefunden? Hier manuell eintragen.
          </FallbackBtn>
        </FallbackRow>
      )}
    </>
  );
}
