/**
 * Regel für fehlende Öffnungszeiten.
 *
 * Anlass: Der Evaluation Context hat die Öffnungszeiten nie gelesen,
 * obwohl der Sync sie seit jeher abfragt und speichert. WERKRUF
 * konnte die Lücke deshalb nicht erkennen.
 */
const fs = require('fs');

const GB  = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');
const MIG = fs.readFileSync(
  'supabase/migrations/20261009100000_opening_hours_context.sql', 'utf8');

function regel(id) {
  const start = GB.indexOf(`id: '${id}'`);
  if (start === -1) return '';
  const anfang = GB.lastIndexOf('{', start);
  let tiefe = 0, i = anfang;
  for (; i < GB.length; i++) {
    if (GB[i] === '{') tiefe++;
    else if (GB[i] === '}') { tiefe--; if (tiefe === 0) break; }
  }
  return GB.slice(anfang, i + 1);
}

describe('Die Daten lagen schon da', () => {
  const MAPPER = fs.readFileSync(
    'supabase/functions/google-business/location-mapper.ts', 'utf8');
  const HELPERS = fs.readFileSync(
    'supabase/functions/google-business/google-api-helpers.ts', 'utf8');

  it('der Sync fragt regularHours ab', () => {
    expect(HELPERS).toMatch(/'regularHours'/);
  });

  it('der Mapper speichert sie in google_profile', () => {
    expect(MAPPER).toMatch(/regularHours: location\.regularHours \?\? null/);
  });

  it('der Mapper schreibt den Schlüssel immer', () => {
    /* Auch als null — das unterscheidet „Google lieferte nichts" von
       „wir haben nie gefragt". Darauf beruht die Verlässlichkeit. */
    expect(MAPPER).toMatch(/regularHours:[^,]*\?\? null/);
  });

  it('der Kontext liest sie jetzt', () => {
    expect(MIG).toMatch(/'openingHours',/);
    expect(MIG).toMatch(/google_profile -> 'regularHours'/);
  });
});

describe('Fehlend ist nicht unbekannt', () => {
  const R = regel('profile.opening_hours_missing');

  it('die Regel verlangt beides', () => {
    expect(R).toMatch(
      /facts\.openingHours\.reliable && !facts\.openingHours\.present/);
  });

  it('verlässlich heißt: synchronisiert', () => {
    expect(MIG).toMatch(/v_loc\.last_synced_at is not null/);
  });

  it('verlässlich heißt: Schlüssel vorhanden', () => {
    expect(MIG).toMatch(/google_profile \? 'regularHours'/);
  });

  it('verlässlich heißt: Abgleich nicht gescheitert', () => {
    expect(MIG).toMatch(/status = 'failed'[\s\S]{0,120}24 hours/);
  });

  it('NULL gilt als nicht vorhanden, nicht als unbekannt', () => {
    /* Ohne coalesce wird der Vergleich NULL statt false, und `!present`
       greift nie — genau im häufigsten Fall. */
    expect(MIG).toMatch(/'present', coalesce\(/);
    expect(MIG).toMatch(/'reliable', coalesce\(/);
  });

  it('nennt beide Fakten als Quelle', () => {
    expect(R).toMatch(
      /sourceFacts: \['openingHours\.present', 'openingHours\.reliable'\]/);
  });
});

describe('Was present nicht prüft', () => {
  it('nur das Vorhandensein von Perioden', () => {
    expect(MIG).toMatch(/jsonb_array_length\([\s\S]{0,80}'periods'\) > 0/);
  });

  it('keine Bewertung der Tage oder Zeiten', () => {
    const block = MIG.slice(MIG.indexOf("'openingHours',"),
                            MIG.indexOf("'syncFailed',"));
    expect(block).not.toMatch(/MONDAY|SATURDAY|weekday|plausib/i);
  });

  it('Sonderzeiten zählen nicht', () => {
    const block = MIG.slice(MIG.indexOf("'openingHours',"),
                            MIG.indexOf("'syncFailed',"));
    expect(block).not.toMatch(/specialHours/);
  });
});

describe('Die Regel selbst', () => {
  const R = regel('profile.opening_hours_missing');

  it('existiert und ist aktiv', () => {
    expect(R).toMatch(/status: 'active'/);
  });

  it('nennt eine konkrete Handlung', () => {
    expect(R).toMatch(/Öffnungszeiten ergänzen/);
  });

  it('zeigt auf den Editor, den es wirklich gibt', () => {
    /* OeffnungszeitenEditor liegt unter /dashboard/google und schreibt
       regularHours zu Google zurück — geprüft, nicht angenommen. */
    expect(R).toMatch(/actionUrl: '\/dashboard\/google'/);
  });

  it('nennt einen realistischen Aufwand', () => {
    const m = /estimatedMinutes: (\d+)/.exec(R);
    expect(Number(m[1])).toBeGreaterThan(0);
    expect(Number(m[1])).toBeLessThanOrEqual(10);
  });

  it('ist eine Wachstumsaufgabe, kein Problem', () => {
    expect(GB).toMatch(/'profile\.opening_hours_missing': 'growth'/);
  });

  it('liegt unter den kritischen Stufen', () => {
    expect(R).toMatch(/priority: 'medium'/);
  });

  it('behauptet nichts über Mitbewerber', () => {
    expect(R).not.toMatch(/Mitbewerber|Konkurren|vergleichbare Betriebe/i);
  });

  it('bewertet die Zeiten nicht', () => {
    /* Nur den Code prüfen: Der Kommentar der Regel nennt genau diese
       Begriffe, um zu erklären, was sie NICHT tut. */
    const ohneKommentare = R
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');

    expect(ohneKommentare).not.toMatch(/zu kurz|ungewöhnlich|Samstag|sollte.*offen/i);
    expect(ohneKommentare.length).toBeGreaterThan(400);
  });
});

describe('Das Faktum erreicht die Engine', () => {
  it('ist typisiert, nicht any', () => {
    expect(GB).toMatch(/openingHours: \{ present: boolean; reliable: boolean \}/);
  });

  it('kommt aus dem Kontext', () => {
    expect(GB).toMatch(/present:\s+oeffnung\?\.present === true/);
    expect(GB).toMatch(/reliable: oeffnung\?\.reliable === true/);
  });

  it('fällt bei älterem Kontext auf unbekannt zurück', () => {
    /* Ein Kontext ohne das Feld darf nicht zu „fehlt" werden. */
    expect(GB).toMatch(/openingHours\?: \{ present\?: boolean; reliable\?: boolean \}/);
  });
});
