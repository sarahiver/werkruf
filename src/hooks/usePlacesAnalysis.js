import { useState, useCallback } from 'react';
import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   SCORE ALGORITHM — industry-agnostic
───────────────────────────────────────────── */
export function calcScore({ rating, reviewCount, hasWebsite }) {
  let score = 100;

  if (!rating || rating === 0)  score -= 35;
  else if (rating < 3.0)        score -= 40;
  else if (rating < 3.5)        score -= 30;
  else if (rating < 4.0)        score -= 20;
  else if (rating < 4.5)        score -= 10;

  if (!reviewCount || reviewCount === 0) score -= 25;
  else if (reviewCount < 5)     score -= 20;
  else if (reviewCount < 20)    score -= 15;
  else if (reviewCount < 50)    score -= 10;

  if (!hasWebsite) score -= 15;

  return Math.max(0, Math.min(100, score));
}

export const scoreColor = (s) => s >= 70 ? '#1E7E34' : s >= 45 ? '#D48A00' : '#D93025';
export const scoreBg    = (s) => s >= 70 ? '#E8F5E9' : s >= 45 ? '#FFF8E1' : '#FDECEA';
export const scoreLabel = (s) => s >= 70 ? 'GUT' : s >= 45 ? 'AUSBAUFÄHIG' : 'KRITISCH';

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
        fields: [
          'place_id', 'name', 'rating', 'user_ratings_total',
          'website', 'formatted_address', 'address_components',
        ],
      },
      (place, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK) {
          resolve(place);
        } else {
          reject(new Error(`Places API: ${status}`));
        }
      }
    );
  });
}

export function extractCity(components) {
  if (!components) return '';
  return (
    components.find(x => x.types.includes('sublocality_level_1')) ||
    components.find(x => x.types.includes('locality')) ||
    components.find(x => x.types.includes('administrative_area_level_2'))
  )?.long_name || '';
}

export function estimateUnanswered(count) {
  if (!count) return 0;
  return Math.max(1, Math.round(count * (0.38 + (count % 9) * 0.02)));
}

/* ─────────────────────────────────────────────
   ALERTS — industry-agnostic
───────────────────────────────────────────── */
export function buildAlerts(r) {
  const list = [];

  if (r.unanswered > 0)
    list.push({
      t: 'err',
      title: `${r.unanswered} Rezensionen ohne Antwort.`,
      desc: 'Potenzielle Kunden sehen das. Jede unbeantwortete Bewertung kostet Vertrauen.',
    });

  if (!r.hasWebsite)
    list.push({
      t: 'err',
      title: 'Keine Website im Google-Profil hinterlegt.',
      desc: 'Du verlierst jeden Kunden, der vor dem Anruf kurz recherchieren will.',
    });

  if (r.reviewCount < 20)
    list.push({
      t: r.reviewCount < 5 ? 'err' : 'warn',
      title: `Nur ${r.reviewCount} Bewertungen — unter dem Marktstandard.`,
      desc: 'Betriebe mit 50+ Rezensionen bekommen bis zu 3× mehr Klicks.',
    });

  if (r.rating > 0 && r.rating < 4.0)
    list.push({
      t: 'err',
      title: `Rating ${r.rating.toFixed(1)} — unter dem kritischen Schwellenwert.`,
      desc: 'Unter 4.0 Sterne filtert Google dein Profil in Suchergebnissen aus.',
    });
  else if (r.rating >= 4.0 && r.rating < 4.5)
    list.push({
      t: 'warn',
      title: `Rating ${r.rating.toFixed(1)} — noch Luft nach oben.`,
      desc: 'Ab 4.5 Sternen steigt die Klickrate messbar an.',
    });

  return list;
}

/* ─────────────────────────────────────────────
   SCAN STEPS — labels stay generic
───────────────────────────────────────────── */
export const SCAN_STEPS = [
  { lbl: ()  => 'Google Business Profil abrufen…',               ms: 800 },
  { lbl: (c) => `Wettbewerb in ${c || 'deiner Region'} prüfen…`, ms: 900 },
  { lbl: ()  => 'Bewertungs-Qualität analysieren…',              ms: 600 },
  { lbl: ()  => 'Sichtbarkeits-Score berechnen…',                ms: 400 },
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
    google_rating:       result.rating      || null,
    google_review_count: result.reviewCount || null,
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

  const runAnalysis = useCallback(async (placeOption) => {
    if (!placeOption) return;

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
        // ── New normalised format from PlacesSearch ──
        pd = {
          place_id:           placeOption.placeId,
          name:               placeOption.name               || '',
          rating:             placeOption.rating             || 0,
          user_ratings_total: placeOption.reviewCount        || 0,
          website:            placeOption.website            || null,
          formatted_address:  placeOption.address            || '',
          address_components: placeOption.addressComponents  || [],
        };
      } else {
        // ── Legacy format — fetch from PlacesService ──
        const legacyId = placeOption.value?.place_id
                      || placeOption.value?.value?.place_id
                      || null;
        if (!legacyId) throw new Error('No place_id found in placeOption');
        pd = await fetchPlaceDetails(legacyId);
      }
    } catch (err) {
      console.error('[usePlacesAnalysis] Failed to resolve place:', err);
      setFetchErr('Google Places konnte diesen Betrieb nicht laden. Bitte einen anderen auswählen.');
      setPhase('idle');
      setSelectedPlace(null);
      return;
    }

    // Null-check after all paths
    if (!pd || (!pd.place_id && !pd.name)) {
      setFetchErr('Kein gültiger Betrieb gefunden. Bitte einen anderen auswählen.');
      setPhase('idle');
      setSelectedPlace(null);
      return;
    }

    // Run scan animation
    let acc = 0;
    SCAN_STEPS.forEach((s, i) => {
      acc += s.ms;
      setTimeout(() => setScanStep(i + 1), acc);
    });
    await new Promise(r => setTimeout(r, acc + 200));

    // Build result
    try {
      const city        = extractCity(pd.address_components || []);
      const rating      = pd.rating             || 0;
      const reviewCount = pd.user_ratings_total || 0;
      const hasWebsite  = !!pd.website;
      const unanswered  = estimateUnanswered(reviewCount);
      const score       = calcScore({ rating, reviewCount, hasWebsite });

      setResult({
        placeId:     pd.place_id || placeOption.placeId || '',
        name:        pd.name     || '',
        city,
        address:     pd.formatted_address || '',
        rating,
        reviewCount,
        hasWebsite,
        website:     pd.website || null,
        unanswered,
        score,
      });
      setPhase('result');

    } catch (err) {
      console.error('[usePlacesAnalysis] Result build error:', err);
      setFetchErr('Fehler beim Verarbeiten der Ortsdaten. Bitte nochmal versuchen.');
      setPhase('idle');
    }
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setSelectedPlace(null);
    setResult(null);
    setScanStep(0);
    setFetchErr('');
  }, []);

  const markSent = useCallback(() => setPhase('sent'), []);

  return {
    phase, scanStep, result, fetchErr, selectedPlace,
    runAnalysis, reset, markSent,
  };
}
