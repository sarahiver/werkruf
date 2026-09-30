/**
 * WERKRUF Score: Standortbezug und Fassung.
 *
 * Anlass: useHealthScore verwendete locations?.[0] — bei zwei Betrieben
 * kamen die Bewertungen vom ausgewählten, die Profilangaben vom ersten
 * der Liste. Ein Wert aus zwei Betrieben.
 */
import { renderHook } from '@testing-library/react';

import { useHealthScore } from './useHealthScore';
import { SCORE_VERSION, HEALTH_WEIGHTS } from '../utils/healthScore';

/* `??` wäre hier falsch: Es behandelt ein ausdrücklich gesetztes null
   wie „nicht angegeben" und setzte den Vorgabewert — die Felder wären
   nie leer. Deshalb mit `in` prüfen. */
const standort = (id, titel, gewaehlt, felder = {}) => ({
  id, title: titel,
  selected_at: gewaehlt ? '2026-09-30T08:00:00Z' : null,
  primary_phone:    'phone'  in felder ? felder.phone  : '+49 40 1',
  website_uri:      'web'    in felder ? felder.web    : 'https://x.example',
  locality:         'ort'    in felder ? felder.ort    : 'Hamburg',
  primary_category: 'kat'    in felder ? felder.kat    : 'gcid:web_designer',
  google_media:     'medien' in felder ? felder.medien : [],
});

const stats = (ueberschreibung = {}) => ({
  totalReviews: 4, averageRating: 5, unanswered: 0,
  distribution: {}, newestReviewAt: new Date().toISOString(),
  photoCount: 5, ...ueberschreibung,
});

const rechne = (props) => renderHook(() => useHealthScore({
  stats: stats(), replyCounts: {}, loading: false, ...props,
})).result.current;

describe('Standortbezug', () => {
  it('nimmt bei genau einem Standort diesen', () => {
    const e = rechne({ locations: [standort('a', 'S&I.', false)] });
    expect(e.locationId).toBe('a');
    expect(e.score).toBeGreaterThan(0);
  });

  it('nimmt bei mehreren den AUSGEWÄHLTEN, nicht den ersten', () => {
    /* Genau der Fehler: locations[0] war WERKRUF, ausgewählt war S&I. */
    const e = rechne({
      locations: [standort('werkruf', 'WERKRUF', false), standort('si', 'S&I.', true)],
    });
    expect(e.locationId).toBe('si');
    expect(e.locationTitle).toBe('S&I.');
  });

  it('liefert ohne Auswahl bei mehreren Standorten KEINEN Score', () => {
    /* Raten wäre schlimmer als nichts zu zeigen. */
    const e = rechne({
      locations: [standort('a', 'S&I.', false), standort('b', 'WERKRUF', false)],
    });
    expect(e.score).toBeNull();
    expect(e.level).toBe('kein_standort');
    expect(e.locationId).toBeNull();
  });

  it('liefert keine 0, wenn kein Standort bestimmbar ist', () => {
    /* Eine 0 sähe aus wie ein schlechter Betrieb. */
    const e = rechne({
      locations: [standort('a', 'A', false), standort('b', 'B', false)],
    });
    expect(e.score).not.toBe(0);
    expect(e.score).toBeNull();
  });

  it('wechselt den Wert, wenn die Auswahl wechselt', () => {
    const vollstaendig = rechne({
      locations: [standort('a', 'A', true), standort('b', 'B', false, { phone: null, web: null })],
    });
    const unvollstaendig = rechne({
      locations: [standort('a', 'A', false), standort('b', 'B', true, { phone: null, web: null })],
    });

    expect(vollstaendig.score).toBeGreaterThan(unvollstaendig.score);
  });

  it('mischt keine Daten zweier Betriebe', () => {
    /* Der ausgewählte hat keine Profilangaben — der andere schon.
       Der Score muss die Lücken des ausgewählten zeigen. */
    const e = rechne({
      locations: [
        standort('voll', 'Voll', false),
        standort('leer', 'Leer', true, { phone: null, web: null, ort: null, kat: null }),
      ],
    });
    const vollstaendigkeit = e.factors.find((f) => f.id === 'completeness');
    expect(vollstaendigkeit.points).toBe(0);
  });
});

describe('Score-Fassung', () => {
  it('liefert die Fassung mit', () => {
    expect(rechne({ locations: [standort('a', 'A', false)] }).scoreVersion)
      .toBe(SCORE_VERSION);
  });

  it('behält die Gewichte aus der Dokumentation', () => {
    /* Die Funktionen aus den Paketen A bis C fliessen bewusst NICHT
       ein. Eine Formel heimlich zu erweitern hiesse, dass der Wert von
       gestern und der von heute verschiedene Dinge messen. */
    expect(HEALTH_WEIGHTS).toEqual({
      responseRate: 30, rating: 25, recency: 20, completeness: 15, photos: 10,
    });
    const summe = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(summe).toBe(100);
  });
});

describe('Keine Vermischung mit dem öffentlichen SmartCheck', () => {
  const fs = require('fs');

  it('verwendet visibility_score nicht im Briefing', () => {
    /* Der visibility_score stammt aus dem öffentlichen SmartCheck —
       andere Formel, ohne verbundenes Google-Konto, betriebsunabhängig.
       Er darf im eingeloggten Dashboard keine Empfehlung steuern. */
    const quelle = fs.readFileSync('src/hooks/useDashboardBriefing.js', 'utf8');
    const ohneKommentare = quelle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(ohneKommentare).not.toMatch(/visibility_score/);
  });

  it('verwendet locations[0] nicht mehr für den Score', () => {
    const quelle = fs.readFileSync('src/hooks/useHealthScore.js', 'utf8');
    expect(quelle).not.toMatch(/const location = locations\?\.\[0\]/);
    expect(quelle).toMatch(/selected_at/);
  });
});
