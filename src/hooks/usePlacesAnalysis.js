import { useState, useCallback, useRef } from 'react';
import supabase from '../supabaseClient';
import { calculateVisibilityScore, calculateProfileScore } from '../utils/visibilityScore';

export {
  calculateVisibilityScore as calcScore,
  scoreBg,
  scoreColor,
  scoreLabel,
} from '../utils/visibilityScore';

/* ─────────────────────────────────────────────
   SCORE ALGORITHM — industry-agnostic
───────────────────────────────────────────── */
const calcScore = calculateVisibilityScore;

/* ─────────────────────────────────────────────
   GOOGLE PLACES — getDetails
───────────────────────────────────────────── */
export function fetchPlaceDetails(placeId) {
  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error('Google Maps JS API nicht geladen'));
      return;
    }
    const svc = new window.google.maps.places.PlacesService(
      document.createElement('div')
    );
    svc.getDetails(
      {
        placeId,
        // Legacy field names — PlacesService uses snake_case
        // These map to v1 names: place_id→id, name→displayName.text,
        // formatted_address→formattedAddress, address_components→addressComponents,
        // user_ratings_total→userRatingCount, website→websiteUri
        fields: [
          'place_id', 'name', 'rating', 'user_ratings_total',
          'website', 'formatted_address', 'address_components',
        ],
      },
      (place, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK) {
          // Normalise to unified format immediately
          resolve(normaliseLegacyPlace(place));
        } else {
          reject(new Error(`Places API: ${status}`));
        }
      }
    );
  });
}

/* ─────────────────────────────────────────────
   NORMALISE PLACE
   Converts legacy PlacesService result to a
   consistent internal format used everywhere.

   Legacy → Internal mapping:
     place_id           → placeId
     name               → name
     formatted_address  → formattedAddress  (camelCase)
     address_components → addressComponents (camelCase)
     user_ratings_total → userRatingCount   (v1 name)
     website            → websiteUri        (v1 name)
     rating             → rating            (unchanged)
───────────────────────────────────────────── */
export function normaliseLegacyPlace(place) {
  if (!place) return null;
  return {
    // ID — use placeId as canonical name
    placeId:           place.id || place.place_id || null,
    // Keep place_id for backward compat with runAnalysis pd.place_id
    place_id:          place.id || place.place_id || null,
    // Name — support both v1 (displayName.text) and legacy (name string)
    name:              place.displayName?.text
                    || (typeof place.name === 'string' ? place.name : null)
                    || '',
    // Address
    formattedAddress:  place.formattedAddress || place.formatted_address || '',
    formatted_address: place.formattedAddress || place.formatted_address || '',
    // Address components
    addressComponents: place.addressComponents || place.address_components || [],
    address_components:place.addressComponents || place.address_components || [],
    // Rating
    rating:            typeof place.rating === 'number' ? place.rating : null,
    ratingAvailable:   typeof place.rating === 'number',
    // Review count — v1 = userRatingCount, legacy = user_ratings_total
    userRatingCount:   typeof place.userRatingCount === 'number' ? place.userRatingCount :
                       typeof place.user_ratings_total === 'number' ? place.user_ratings_total : null,
    user_ratings_total:typeof place.userRatingCount === 'number' ? place.userRatingCount :
                       typeof place.user_ratings_total === 'number' ? place.user_ratings_total : null,
    reviewCountAvailable: typeof place.userRatingCount === 'number' || typeof place.user_ratings_total === 'number',
    // Website — v1 = websiteUri, legacy = website
    websiteUri:        place.websiteUri || place.websiteURI || place.website || null,
    website:           place.websiteUri || place.websiteURI || place.website || null,
    websiteAvailable:  Object.prototype.hasOwnProperty.call(place, 'websiteUri') ||
                       Object.prototype.hasOwnProperty.call(place, 'websiteURI') ||
                       Object.prototype.hasOwnProperty.call(place, 'website'),
  };
}

export function extractCity(components) {
  if (!components || !Array.isArray(components) || components.length === 0) return '';
  try {
    // Each component can have types as array (legacy) or similar
    const find = (type) => components.find(x =>
      Array.isArray(x.types) && x.types.includes(type)
    );
    // v1: longText, legacy: long_name
    const comp = find('sublocality_level_1') || find('locality') || find('administrative_area_level_2');
    return comp?.longText || comp?.long_name || '';
  } catch (_) {
    return '';
  }
}

/* ─────────────────────────────────────────────
   ALERTS — industry-agnostic
───────────────────────────────────────────── */
export function buildAlerts(r) {
  const list = [];

  if (r.dataSource === 'manual') return [{
    t: 'warn',
    title: 'Kein Google-Eintrag ausgewählt.',
    desc: 'Es sind keine öffentlichen Google-Profildaten verfügbar. Nach der Registrierung kannst du das Profil per Google OAuth nachweisen und verbinden.',
  }];

  if (r.websiteAvailable && !r.hasWebsite)
    list.push({
      t: 'err',
      title: 'Keine Website im Google-Profil hinterlegt.',
      desc: 'Ergänze eine verlässliche Zielseite, damit Interessierte weitere Informationen finden.',
    });

  if (r.reviewCountAvailable && r.reviewCount > 0 && r.reviewCount < 5)
    list.push({
      t: r.reviewCount < 5 ? 'err' : 'warn',
      title: `${r.reviewCount} öffentliche Rezension${r.reviewCount === 1 ? '' : 'en'}.`,
      desc: 'Bitte zufriedene Kundschaft um ehrliches Feedback, ohne Anreize oder Vorgaben.',
    });

  if (r.ratingAvailable && r.rating < 4.0)
    list.push({
      t: 'err',
      title: `Öffentliche Bewertung: ${r.rating.toFixed(1)} von 5.`,
      desc: 'Eine niedrigere Bewertung kann die Entscheidung potenzieller Kunden beeinflussen.',
    });
  list.push({ t: 'info', title: 'Antwortquote nach Profilverknüpfung prüfen.', desc: 'Öffentliche Places-Daten enthalten keine verlässliche tatsächliche Antwortquote.' });

  return list.slice(0, 3);
}

/* ─────────────────────────────────────────────
   SCAN STEPS — labels stay generic
───────────────────────────────────────────── */
export const SCAN_STEPS = [
  { lbl: ()  => 'Ausgewählte Google-Daten übernehmen…', ms: 150 },
  { lbl: ()  => 'Öffentlichen Profil-Score berechnen…', ms: 150 },
];

/* ─────────────────────────────────────────────
   SUPABASE LEAD SAVE
   Includes industry_key for attribution tracking
───────────────────────────────────────────── */
export async function saveLeadToSupabase({ email, result, industryKey }) {
  const { error } = await supabase.from('leads').insert([{
    company_name:        result.name,
    contact_person:      '-',
    phone:               '-',
    city:                result.city,
    email,
    source:              'smart_check',
    status:              'new',
    industry_key:        industryKey || 'handwerk',   // ← NEW
    google_place_id:     result.placeId     || null,
    visibility_score:    result.score       || null,
  }]);
  if (error) throw error;
}

/*
  SQL — run once in Supabase SQL Editor:

  ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS industry_key        TEXT DEFAULT 'handwerk',
    ADD COLUMN IF NOT EXISTS google_place_id     TEXT,
    ADD COLUMN IF NOT EXISTS google_rating        NUMERIC(3,1),
    ADD COLUMN IF NOT EXISTS google_review_count  INTEGER,
    ADD COLUMN IF NOT EXISTS visibility_score     INTEGER;

  CREATE INDEX IF NOT EXISTS leads_industry_key_idx ON leads(industry_key);
*/


/* ─────────────────────────────────────────────
   MANUAL LEAD SAVE
   For businesses not found in Google Places.
   Sets visibility_score = 0, needs_manual_setup = true.
───────────────────────────────────────────── */
export async function saveManualLead({ companyName, trade, email, industryKey, userId }) {
  const { error } = await supabase.from('leads').insert([{
    company_name:        companyName,
    contact_person:      '-',
    phone:               '-',
    email:               email || null,
    trade:               trade || null,
    source:              'manual_onboarding',
    status:              'new',
    industry_key:        industryKey || 'handwerk',
    visibility_score:    0,
    needs_manual_setup:  true,
  }]);
  if (error) throw error;

  // If user is logged in, also update their profile
  if (userId) {
    await supabase.from('user_profiles').update({
      company_name:     companyName,
      visibility_score: 0,
      industry_key:     industryKey || 'handwerk',
    }).eq('id', userId);
  }
}

/*
  SQL — run in Supabase SQL Editor:

  ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS needs_manual_setup BOOLEAN DEFAULT false;

  CREATE INDEX IF NOT EXISTS leads_manual_setup_idx
    ON leads(needs_manual_setup) WHERE needs_manual_setup = true;
*/

/* ─────────────────────────────────────────────
   HOOK
   Takes industryPlacesConfig so Hero can pass
   the correct Google Places types/filters
───────────────────────────────────────────── */
export function usePlacesAnalysis() {
  const [phase,         setPhase]         = useState('idle');
  const [scanStep,      setScanStep]      = useState(0);
  const [result,        setResult]        = useState(null);
  const [fetchErr,      setFetchErr]      = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const requestRef = useRef(0);

  const runAnalysis = useCallback(async (placeOption) => {
    if (!placeOption) return;
    const requestId = ++requestRef.current;

    setSelectedPlace(placeOption);
    setPhase('scanning');
    setScanStep(0);
    setFetchErr('');

    /* ── NORMALISE INPUT ────────────────────────────────────────
       New PlacesSearch delivers a normalised object:
         { placeId, name, address, rating, reviewCount,
           hasWebsite, website, addressComponents }

       Legacy format (old library):
         { label, value: { place_id, ... } }
    ─────────────────────────────────────────────────────────── */
    let pd = null;

    try {
      if (placeOption.placeId) {
        // ── Normalised format from PlacesSearch (already processed) ──
        // Map to internal pd format using canonical field names
        pd = normaliseLegacyPlace({
          place_id:           placeOption.placeId,
          name:               placeOption.name,
          rating:             placeOption.rating,
          user_ratings_total: placeOption.reviewCount,
          website:            placeOption.website,
          formatted_address:  placeOption.address,
          address_components: placeOption.addressComponents,
        });
      } else {
        // ── Legacy format — fetch full details from PlacesService ──
        const legacyId = placeOption.value?.place_id
                      || placeOption.value?.value?.place_id
                      || null;
        if (!legacyId) throw new Error('No place_id found in placeOption');
        pd = await fetchPlaceDetails(legacyId); // already normalised inside
      }
    } catch (err) {
      console.error('[usePlacesAnalysis] Failed to resolve place:', err);
      setFetchErr('Google Places konnte diesen Betrieb nicht laden. Bitte einen anderen auswählen.');
      if (requestId !== requestRef.current) return;
      setPhase('error');
      setSelectedPlace(null);
      return;
    }

    // Null-check — pd must have at minimum a name or id
    if (!pd || (!pd.placeId && !pd.name)) {
      setFetchErr('Kein gültiger Betrieb gefunden. Bitte einen anderen auswählen.');
      setPhase('error');
      setSelectedPlace(null);
      return;
    }

    // Run scan animation
    let acc = 0;
    SCAN_STEPS.forEach((s, i) => {
      acc += s.ms;
      setTimeout(() => { if (requestId === requestRef.current) setScanStep(i + 1); }, acc);
    });
    await new Promise(r => setTimeout(r, acc + 200));

    // Build result
    try {
      // Use canonical field names (set by normaliseLegacyPlace)
      const city        = extractCity(pd.addressComponents || pd.address_components || []);
      if (requestId !== requestRef.current) return;
      const rating      = pd.rating;
      const reviewCount = pd.userRatingCount;
      const hasWebsite  = !!(pd.websiteUri         || pd.website);
      const scoreResult = calculateProfileScore({ rating, reviewCount, hasWebsite,
        ratingAvailable: pd.ratingAvailable, reviewCountAvailable: pd.reviewCountAvailable,
        websiteAvailable: pd.websiteAvailable });

      setResult({
        placeId:     pd.placeId  || pd.place_id || placeOption.placeId || '',
        name:        pd.name     || '',
        city,
        address:     pd.formattedAddress || pd.formatted_address || '',
        rating,
        reviewCount,
        hasWebsite,
        website:     pd.websiteUri || pd.website || null,
        ratingAvailable: pd.ratingAvailable,
        reviewCountAvailable: pd.reviewCountAvailable,
        websiteAvailable: pd.websiteAvailable,
        score: scoreResult.score,
        scoreCriteria: scoreResult.criteria,
        dataSource: 'google',
      });
      setPhase('result');

    } catch (err) {
      console.error('[usePlacesAnalysis] Result build error:', err);
      setFetchErr('Fehler beim Verarbeiten der Ortsdaten. Bitte nochmal versuchen.');
      setPhase('error');
    }
  }, []);

  const runManualAnalysis = useCallback((companyName) => {
    const name = companyName?.trim();
    if (!name) {
      setFetchErr('Bitte gib einen Firmennamen ein.');
      return;
    }
    setSelectedPlace({ name, manual: true });
    setFetchErr('');
    setResult({
      placeId: '', name, city: '', address: '', rating: null,
      reviewCount: null, hasWebsite: null, website: null,
      ratingAvailable: false, reviewCountAvailable: false, websiteAvailable: false,
      scoreCriteria: [], score: null, dataSource: 'manual',
    });
    setPhase('result');
  }, []);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setPhase('idle');
    setSelectedPlace(null);
    setResult(null);
    setScanStep(0);
    setFetchErr('');
  }, []);

  const markSent = useCallback(() => setPhase('sent'), []);

  return {
    phase, scanStep, result, fetchErr, selectedPlace,
    runAnalysis, runManualAnalysis, reset, markSent,
  };
}
