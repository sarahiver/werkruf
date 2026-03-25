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
    setSelectedPlace(placeOption);
    setPhase('scanning');
    setScanStep(0);
    setFetchErr('');

    const fetchPromise = fetchPlaceDetails(
      placeOption.value.place_id
    ).catch(() => null);

    let acc = 0;
    SCAN_STEPS.forEach((s, i) => {
      acc += s.ms;
      setTimeout(() => setScanStep(i + 1), acc);
    });

    const [pd] = await Promise.all([
      fetchPromise,
      new Promise(r => setTimeout(r, acc + 200)),
    ]);

    if (!pd) {
      setFetchErr(
        'Google Places konnte diesen Betrieb nicht laden. ' +
        'Bitte einen anderen auswählen.'
      );
      setPhase('idle');
      setSelectedPlace(null);
      return;
    }

    const city        = extractCity(pd.address_components);
    const rating      = pd.rating || 0;
    const reviewCount = pd.user_ratings_total || 0;
    const hasWebsite  = !!pd.website;
    const unanswered  = estimateUnanswered(reviewCount);
    const score       = calcScore({ rating, reviewCount, hasWebsite });

    setResult({
      placeId: pd.place_id,
      name:    pd.name,
      city,
      address: pd.formatted_address || '',
      rating,
      reviewCount,
      hasWebsite,
      website: pd.website || null,
      unanswered,
      score,
    });

    setPhase('result');
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
