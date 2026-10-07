/**
 * Regel für null Bewertungen und Recommendation-Klassen.
 *
 * Anlass: Ein frisch verbundener Betrieb mit null Bewertungen fiel
 * durch alle Raster. `review.drought` verlangt `daysSinceNewest !==
 * null` — ohne eine einzige Bewertung gibt es kein „seit wann".
 */
const fs = require('fs');

const GB = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');

/** Den Block einer Regel ausschneiden. */
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

describe('Die Lücke bei null Bewertungen', () => {
  it('review.drought greift dort nicht', () => {
    /* Das ist der Grund für die neue Regel — nicht ein Versehen in
       drought, sondern ihre Bedingung. */
    expect(regel('review.drought')).toMatch(/daysSinceNewest !== null/);
  });

  it('review.response_rate_low ebenfalls nicht', () => {
    /* responseRate ist null, wenn es keine Bewertungen gibt. */
    expect(regel('review.response_rate_low')).toMatch(/responseRate !== null/);
  });

  it('die neue Regel greift genau dort', () => {
    expect(regel('review.none_yet')).toMatch(/facts\.reviews\.total === 0/);
  });
});

describe('Unbekannt ist nicht null', () => {
  const R = regel('review.none_yet');
  const FACTS = (() => {
    const a = GB.indexOf('function buildFacts');
    return a === -1 ? '' : GB.slice(a, GB.indexOf('const zahlVerlaesslich', a) + 600);
  })();

  it('verlangt eine verlässliche Zahl', () => {
    /* `total` entsteht mit einem Rückfall auf Null — fehlende Daten
       werden dort zu einer Null. Ohne diese zweite Bedingung würde die
       Regel bei einem gescheiterten Abgleich „Erste Bewertungen
       einsammeln" empfehlen, obwohl der Betrieb hundert hat. */
    expect(R).toMatch(/facts\.reviews\.zahlVerlaesslich && facts\.reviews\.total === 0/);
  });

  it('prüft, ob der Kontext die Zahl geliefert hat', () => {
    expect(FACTS).toMatch(/typeof reviews\?\.total === 'number'/);
  });

  it('prüft, ob der Standort aufgelöst ist', () => {
    /* Ein Kontoumfang liefert gar kein reviews-Objekt. */
    expect(FACTS).toMatch(/locationResolved !== false/);
  });

  it('prüft, ob der Abgleich gescheitert ist', () => {
    /* Der liefert ein Objekt, aber mit veralteten Daten. */
    expect(FACTS).toMatch(/ctx\.syncFailed !== true/);
  });

  it('nennt beide Fakten als Quelle', () => {
    expect(R).toMatch(/sourceFacts: \['reviews\.total', 'reviews\.zahlVerlaesslich'\]/);
  });
});

describe('Die neue Regel', () => {
  const R = regel('review.none_yet');

  it('existiert und ist aktiv', () => {
    expect(R).toMatch(/status: 'active'/);
  });

  it('nennt eine konkrete Handlung', () => {
    expect(R).toMatch(/Erste Bewertungen einsammeln/);
  });

  it('verspricht nur, was bereitliegt', () => {
    /* Kein Versprechen über Rankings oder Umsatz. */
    expect(R).toMatch(/Bewertungslink und QR-Code liegen im Dashboard bereit/);
    expect(R).not.toMatch(/mehr Umsatz|besseres Ranking|Platz 1|garantiert/i);
  });

  it('empfiehlt nichts Regelwidriges', () => {
    /* Keine gekauften Bewertungen, keine Freunde, keine Anreize. */
    expect(R).not.toMatch(/kaufen|Freunde|Familie|Gutschein|Rabatt|Prämie/i);
  });

  it('misst die Anzahl, nicht den Schnitt', () => {
    /* Um Bewertungen zu bitten erhöht die Zahl. Der Durchschnitt
       ließe eine Regel schlecht aussehen, die genau das tut, was sie
       soll. */
    expect(R).toMatch(/impactMetric: 'reviews\.totalCount'/);
  });

  it('nennt einen realistischen Aufwand', () => {
    const m = /estimatedMinutes: (\d+)/.exec(R);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(0);
    expect(Number(m[1])).toBeLessThanOrEqual(15);
  });

  it('führt irgendwohin', () => {
    expect(R).toMatch(/actionUrl: '\/dashboard\//);
  });

  it('trägt hohe Sicherheit', () => {
    /* Die Regel ist trivial: null Bewertungen sind null Bewertungen. */
    const m = /confidence: ([\d.]+)/.exec(R);
    expect(Number(m[1])).toBeGreaterThanOrEqual(0.8);
  });
});

describe('Die Klassifizierung', () => {
  const KLASSEN = (() => {
    const a = GB.indexOf('const REGEL_KLASSE');
    return a === -1 ? '' : GB.slice(a, GB.indexOf('};', a) + 2);
  })();

  it('ordnet kaputte Zustände als Problem ein', () => {
    for (const r of ['connection.missing', 'connection.lost',
                     'review.negative_unanswered', 'reply.publish_failed']) {
      expect(KLASSEN).toMatch(new RegExp(`'${r.replace('.', '\\.')}':\\s+'problem'`));
    }
  });

  it('ordnet Lücken als Wachstum ein', () => {
    for (const r of ['review.none_yet', 'profile.photos_missing',
                     'profile.incomplete', 'review.drought']) {
      expect(KLASSEN).toMatch(new RegExp(`'${r.replace('.', '\\.')}':\\s+'growth'`));
    }
  });

  it('deckt alle zwölf Regeln ab', () => {
    const ids = [...GB.matchAll(/^    id: '([a-z._]+)',$/gm)].map((m) => m[1]);
    const zugeordnet = [...KLASSEN.matchAll(/'([a-z._]+)':/g)].map((m) => m[1]);

    for (const id of ids) {
      expect(zugeordnet).toContain(id);
    }
  });

  it('fällt auf growth zurück', () => {
    /* Eine Wachstumsaufgabe fälschlich als Problem zu melden wäre
       Alarmismus; umgekehrt geht nur Dringlichkeit verloren. */
    expect(GB).toMatch(/if \(!klasse\)[\s\S]{0,200}return 'growth'/);
  });

  it('protokolliert eine Regel ohne Zuordnung', () => {
    /* Der Rückfall soll nicht stillschweigend greifen: Eine neue Regel
       ohne Eintrag ist ein Versehen, nicht eine Entscheidung. */
    expect(GB).toMatch(/regel_ohne_klasse/);
  });

  it('erfindet keine Marktdaten', () => {
    /* opportunity ist vorbereitet, nicht benutzt. Solange keine
       Mitbewerberdaten vorliegen, darf keine Mail so etwas
       behaupten. */
    /* Nur Zuordnungen prüfen, nicht die Typdeklaration — dort steht
       'opportunity' als Möglichkeit, und das ist richtig so. */
    const zuordnungen = [...KLASSEN.matchAll(/':\s+'(\w+)'/g)].map((m) => m[1]);
    expect(zuordnungen).not.toContain('opportunity');
    expect(zuordnungen.length).toBeGreaterThan(5);
  });

  it('kennt opportunity als Möglichkeit', () => {
    expect(GB).toMatch(/'problem' \| 'growth' \| 'opportunity'/);
  });
});

describe('Die Klasse erreicht die Datenbank', () => {
  it('wird in toEventRows durchgereicht', () => {
    expect(GB).toMatch(/recommendationClass: klasseFuer\(r\.ruleId\)/);
  });
});
