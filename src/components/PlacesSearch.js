import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { Search, AlertCircle } from 'lucide-react';

const spin = keyframes`to { transform: rotate(360deg); }`;

/* ─────────────────────────────────────────────
   PAC-CONTAINER OVERRIDE
   Injects CSS into <head> to style Google's
   native autocomplete dropdown (.pac-container)
───────────────────────────────────────────── */
const PAC_CSS = `
  .pac-container {
    border: 2px solid #002C51 !important;
    border-top: none !important;
    border-radius: 0 0 4px 4px !important;
    box-shadow: 0 8px 24px rgba(0,44,81,.18) !important;
    font-family: Arial, sans-serif !important;
    margin-top: -2px !important;
    z-index: 99999 !important;
    background: #ffffff !important;
  }
  .pac-item {
    padding: 10px 14px !important;
    font-size: 14px !important;
    border-top: 1px solid #E5EBF0 !important;
    cursor: pointer !important;
    color: #1A1A1A !important;
    line-height: 1.4 !important;
  }
  .pac-item:hover,
  .pac-item-selected {
    background: rgba(0,44,81,.06) !important;
  }
  .pac-item-query {
    font-size: 14px !important;
    font-weight: 600 !important;
    color: #002C51 !important;
    padding-right: 4px !important;
  }
  .pac-matched {
    color: #FF8C00 !important;
    font-weight: 700 !important;
  }
  .pac-icon,
  .pac-icon-marker { display: none !important; }
  .pac-logo::after { display: none !important; }
  .pac-item-description { color: #5A6A7A !important; font-size: 12px !important; }
`;

function injectPacCss() {
  if (document.getElementById('werkruf-pac-css')) return;
  const s = document.createElement('style');
  s.id = 'werkruf-pac-css';
  s.textContent = PAC_CSS;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────
   WAIT FOR GOOGLE
   Polls every 100ms until window.google.maps.places
   is available (script loads async)
───────────────────────────────────────────── */
function waitForGoogle(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places?.Autocomplete) {
      resolve(); return;
    }
    const t0  = Date.now();
    const tid = setInterval(() => {
      if (window.google?.maps?.places?.Autocomplete) {
        clearInterval(tid); resolve();
      } else if (Date.now() - t0 > timeout) {
        clearInterval(tid);
        reject(new Error('Google Maps script timed out after ' + timeout + 'ms'));
      }
    }, 100);
  });
}

/* ─────────────────────────────────────────────
   NORMALISE PLACE
   Converts a raw google.maps.places.PlaceResult
   to a clean, consistent object.
   Handles BOTH legacy (snake_case) AND v1 (camelCase).
───────────────────────────────────────────── */
function normalisePlace(place) {
  if (!place) return null;

  // ID — Autocomplete gives place_id (legacy), v1 gives id
  const placeId = place.id || place.place_id || null;

  // Name — Autocomplete gives name (string), v1 gives displayName.text
  const name =
    (place.displayName && typeof place.displayName === 'object'
      ? place.displayName.text
      : null)
    || (typeof place.name === 'string' ? place.name : null)
    || '';

  // Address — Autocomplete = formatted_address, v1 = formattedAddress
  const address = place.formattedAddress || place.formatted_address || '';

  // Address components — Autocomplete = address_components, v1 = addressComponents
  const addressComponents = place.addressComponents || place.address_components || [];

  // Rating — same in both APIs
  const rating = typeof place.rating === 'number' ? place.rating : 0;

  // Review count — Autocomplete = user_ratings_total, v1 = userRatingCount
  const reviewCount =
    (typeof place.userRatingCount   === 'number' ? place.userRatingCount   : null)
    ?? (typeof place.user_ratings_total === 'number' ? place.user_ratings_total : 0);

  // Website — Autocomplete = website, v1 = websiteUri / websiteURI
  const website    = place.websiteUri || place.websiteURI || place.website || null;
  const hasWebsite = !!website;

  const result = { placeId, name, address, addressComponents, rating, reviewCount, hasWebsite, website };
  console.log('[PlacesSearch] Normalised result:', result);
  return result;
}

/* ─────────────────────────────────────────────
   STYLED COMPONENTS
───────────────────────────────────────────── */
const Wrap = styled.div`
  position: relative;
  width: 100%;
`;

const IconWrap = styled.div`
  position: absolute;
  left: 13px; top: 50%; transform: translateY(-50%);
  color: var(--color-accent);
  display: flex; align-items: center;
  z-index: 2; pointer-events: none;
`;

const SearchInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 13px 42px 13px 42px;
  font-family: var(--font-body, Arial, sans-serif);
  font-size: 1rem;
  color: ${({ $dark }) => $dark ? '#ffffff' : 'var(--color-text, #1A1A1A)'};
  background: ${({ $dark }) => $dark ? 'rgba(255,255,255,.08)' : 'var(--color-bg, #F2F2F2)'};
  border: 2px solid ${({ $dark }) =>
    $dark ? 'rgba(255,255,255,.2)' : 'var(--color-border, #D0D8E0)'};
  border-radius: var(--radius-card, 4px);
  outline: none;
  transition: border-color .2s ease, background .2s ease;

  &:focus {
    border-color: var(--color-accent, #FF8C00);
    background: ${({ $dark }) => $dark ? 'rgba(255,255,255,.13)' : '#ffffff'};
  }
  &::placeholder {
    color: ${({ $dark }) => $dark ? 'rgba(255,255,255,.38)' : '#A0ADB8'};
  }
  &:disabled {
    opacity: .55;
    cursor: not-allowed;
  }
`;

const SpinnerEl = styled.div`
  position: absolute;
  right: 13px; top: 50%; transform: translateY(-50%);
  width: 15px; height: 15px;
  border: 2px solid rgba(var(--color-accent-rgb, 255,140,0), .3);
  border-top-color: var(--color-accent, #FF8C00);
  border-radius: 50%;
  animation: ${spin} .75s linear infinite;
`;

const ClearBtn = styled.button`
  position: absolute;
  right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  padding: 4px; line-height: 1;
  font-size: 15px;
  color: ${({ $dark }) => $dark ? 'rgba(255,255,255,.4)' : '#A0ADB8'};
  &:hover { color: ${({ $dark }) => $dark ? '#ffffff' : 'var(--color-primary, #002C51)'}; }
`;

const FallbackRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px;
`;

const FallbackTrigger = styled.button`
  background: none; border: none; padding: 0; cursor: pointer;
  font-family: var(--font-body, Arial, sans-serif);
  font-size: .82rem;
  color: var(--color-text-muted, #5A6A7A);
  text-decoration: underline;
  text-underline-offset: 2px;
  display: flex; align-items: center; gap: 5px;
  transition: color .15s;
  &:hover { color: var(--color-accent, #FF8C00); }
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function PlacesSearch({
  onSelect,
  onNoResults,
  placeholder = 'Betrieb suchen…',
  dark = false,
  style,
}) {
  const inputRef        = useRef(null);
  const acRef           = useRef(null);
  const latestQuery     = useRef('');

  const [ready,        setReady]        = useState(false);
  const [initError,    setInitError]    = useState(false);
  const [query,        setQuery]        = useState('');
  const [showFallback, setShowFallback] = useState(false);

  /* ── Init Autocomplete once Google is ready ── */
  useEffect(() => {
    let mounted = true;
    injectPacCss();

    waitForGoogle()
      .then(() => {
        if (!mounted || !inputRef.current) return;

        try {
          const ac = new window.google.maps.places.Autocomplete(
            inputRef.current,
            {
              // Legacy field names only — Autocomplete widget does NOT
              // support v1 camelCase fields (displayName, formattedAddress etc.)
              // Those are only for the new PlaceAutocompleteElement / Place class
              fields: [
                'place_id',
                'name',
                'formatted_address',
                'address_components',
                'rating',
                'user_ratings_total',
                'website',
                'geometry',
              ],
              types:                ['establishment'],
              componentRestrictions: { country: 'de' },
            }
          );

          ac.addListener('place_changed', () => {
            try {
              const raw = ac.getPlace();
              console.log('[PlacesSearch] Raw place_changed:', raw);

              const placeId = raw?.id || raw?.place_id;

              if (!raw || !placeId) {
                // User pressed Enter without selecting from list
                if (latestQuery.current.length >= 2) setShowFallback(true);
                return;
              }

              const result = normalisePlace(raw);
              console.log('[PlacesSearch] Normalised:', result);

              setShowFallback(false);
              setQuery(result.name);
              if (onSelect) onSelect(result);

            } catch (err) {
              console.error('[PlacesSearch] place_changed error:', err);
              setShowFallback(true);
            }
          });

          acRef.current = ac;
          setReady(true);

        } catch (err) {
          console.error('[PlacesSearch] Autocomplete init error:', err);
          setInitError(true);
        }
      })
      .catch(err => {
        if (!mounted) return;
        console.warn('[PlacesSearch] waitForGoogle failed:', err.message);
        setInitError(true);
      });

    return () => {
      mounted = false;
      try {
        if (acRef.current && window.google?.maps?.event) {
          window.google.maps.event.clearInstanceListeners(acRef.current);
        }
      } catch (_) {}
    };
  }, [onSelect]);

  /* ── Input tracking ── */
  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);
    latestQuery.current = val;
    if (showFallback && val.length === 0) setShowFallback(false);
  }, [showFallback]);

  /* ── Blur: show fallback if typed but didn't select ── */
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      const place = acRef.current?.getPlace?.();
      const hasValidPlace = !!(place?.id || place?.place_id);
      if (!hasValidPlace && latestQuery.current.length >= 3) {
        setShowFallback(true);
      }
    }, 300);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    latestQuery.current = '';
    setShowFallback(false);
    if (inputRef.current) inputRef.current.value = '';
    if (onSelect) onSelect(null);
  }, [onSelect]);

  const handleFallbackClick = useCallback(() => {
    setShowFallback(false);
    if (onNoResults) onNoResults();
  }, [onNoResults]);

  /* ── Render ── */
  const placeholderText = initError
    ? '⚠ Google Maps nicht verfügbar'
    : ready
      ? placeholder
      : 'Wird geladen…';

  return (
    <>
      <Wrap style={style}>
        <IconWrap aria-hidden="true">
          <Search size={16} />
        </IconWrap>

        <SearchInput
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholderText}
          disabled={!ready || initError}
          $dark={dark}
          onChange={handleChange}
          onBlur={handleBlur}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          aria-label="Betrieb suchen"
        />

        {!ready && !initError && <SpinnerEl />}
        {ready && query && (
          <ClearBtn
            $dark={dark}
            onClick={handleClear}
            type="button"
            aria-label="Eingabe löschen"
          >
            ✕
          </ClearBtn>
        )}
      </Wrap>

      {showFallback && (
        <FallbackRow>
          <AlertCircle size={13} color="var(--color-text-muted, #5A6A7A)" />
          <FallbackTrigger
            type="button"
            onClick={handleFallbackClick}
          >
            Betrieb nicht gefunden? Hier manuell eintragen.
          </FallbackTrigger>
        </FallbackRow>
      )}
    </>
  );
}
