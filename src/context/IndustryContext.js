import React, { createContext, useContext, useMemo } from 'react';
import {
  ACTIVE_INDUSTRY,
  DOMAIN_MAP,
  INDUSTRIES,
  getIndustryConfig,
} from '../config/industryConfig';

/* ─────────────────────────────────────────────
   DOMAIN DETECTION
   Priority:
   1. ?industry=xxx URL param (dev/preview override)
   2. window.location.hostname lookup in DOMAIN_MAP
   3. ACTIVE_INDUSTRY from industryConfig.js
───────────────────────────────────────────── */
function detectIndustryKey() {
  // 1. URL param override (e.g. ?industry=gastro for Vercel preview)
  try {
    const params = new URLSearchParams(window.location.search);
    const param = params.get('industry');
    if (param && INDUSTRIES[param]) return param;
  } catch (_) {}

  // 2. Hostname lookup
  try {
    const host = window.location.hostname.replace(/^www\./, '');
    if (DOMAIN_MAP[host]) return DOMAIN_MAP[host];
    // Subdomain check: gastro.werkruf.de → gastro
    const subdomain = host.split('.')[0];
    if (INDUSTRIES[subdomain]) return subdomain;
  } catch (_) {}

  // 3. Static fallback from config
  return ACTIVE_INDUSTRY;
}

/* ─────────────────────────────────────────────
   CONTEXT
───────────────────────────────────────────── */
const IndustryContext = createContext(null);

export function IndustryProvider({ children }) {
  const config = useMemo(() => {
    const key = detectIndustryKey();
    return getIndustryConfig(key);
  }, []); // Evaluated once at mount — domain doesn't change mid-session

  return (
    <IndustryContext.Provider value={config}>
      {children}
    </IndustryContext.Provider>
  );
}

/* ─────────────────────────────────────────────
   HOOK — use anywhere in the component tree
   
   const industry = useIndustry();
   const { colors, copy, pricing, places } = useIndustry();
───────────────────────────────────────────── */
export function useIndustry() {
  const ctx = useContext(IndustryContext);
  if (!ctx) {
    throw new Error('useIndustry must be used inside <IndustryProvider>');
  }
  return ctx;
}

/* ─────────────────────────────────────────────
   CONVENIENCE HOOKS
───────────────────────────────────────────── */
export function useIndustryColors()  { return useIndustry().colors;  }
export function useIndustryPricing() { return useIndustry().pricing; }
export function useIndustryCopy()    { return useIndustry().copy;    }
export function useIndustryPlaces()  { return useIndustry().places;  }
export function useIndustryDesign()  { return useIndustry().design;  }
export function useIndustryBrand()   { return useIndustry().brand;   }

export default IndustryContext;
