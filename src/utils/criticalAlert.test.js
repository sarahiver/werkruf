/**
 * Sofortmeldungen zu kritischen Bewertungen.
 *
 * Anlass: Bis zum 05.10.2026 bündelte plan_communications nutzerweit.
 * Bei zwei Betrieben entstand eine Mail mit Bewertungen aus beiden,
 * dem Registrierungsnamen als Betriebsname und einem Dedupe-Schlüssel
 * ohne Standort — zwei Betriebe in derselben Stunde kollidierten, und
 * die zweite Meldung fiel still aus.
 */
const fs = require('fs');

const MAIL = fs.readFileSync('supabase/functions/send-email/index.ts', 'utf8');
const MIG  = fs.readFileSync(
  'supabase/migrations/20261005220000_location_scoped_critical_review_alerts.sql', 'utf8');

const VORLAGE = (() => {
  const a = MAIL.indexOf("case 'critical_review_alert': {");
  return a === -1 ? '' : MAIL.slice(a, MAIL.indexOf("case 'payment_failed'", a));
})();

describe('Die Vorlage nennt den betroffenen Betrieb', () => {
  it('liest den Standortnamen', () => {
    /* companyName trägt seit E1 den Google-Namen des betroffenen
       Standorts, nicht den aus der Registrierung. */
    expect(VORLAGE).toMatch(/payload\.locationTitle \|\| payload\.companyName/);
  });

  it('setzt ihn in den Betreff', () => {
    /* Ein Nutzer mit zwei Betrieben bekommt womöglich zwei Mails in
       derselben Stunde — ohne Namen sähen sie im Postfach identisch
       aus. */
    expect(VORLAGE).toMatch(/betrieb \? ` — \$\{betrieb\}` : ''/);
  });

  it('kommt ohne Namen zurecht', () => {
    expect(VORLAGE).toMatch(/payload\.companyName \|\| ''/);
  });

  it('zählt die Bewertungen aus dem Payload', () => {
    expect(VORLAGE).toMatch(/Number\(payload\.count \?\? 1\)/);
  });
});

describe('Die Gruppierung', () => {
  it('erfolgt nach Standort', () => {
    expect(MIG).toMatch(/group by e\.location_id/);
  });

  it('nimmt Bewertungen ohne Standort nicht mit', () => {
    /* Sie einem Betrieb zuzuschlagen wäre geraten. */
    expect(MIG).toMatch(/and e\.location_id is not null/);
  });

  it('nutzt die gemeinsame Freigabe', () => {
    /* Statt einer eigenen candidate-Prüfung. */
    expect(MIG).toMatch(/public\.rule_freigegeben\(e\.rule_status\)/);
  });

  it('gibt den Standort in der Entscheidung mit', () => {
    /* Sonst müsste schedule_communications ihn erraten. */
    expect(MIG).toMatch(/'locationId', v_gruppe\.location_id/);
  });

  it('hängt nicht an der Dashboard-Auswahl', () => {
    /* Eine Bewertung bei WERKRUF muss als WERKRUF-Mail kommen, auch
       wenn im Dashboard S&I ausgewählt ist. */
    const immediate = MIG.slice(MIG.indexOf('KANAL 1'), MIG.indexOf('KANAL 2'));
    expect(immediate).not.toMatch(/werkruf_score_location/);
  });
});

describe('Der Dedupe-Schlüssel', () => {
  it('enthält den Standort', () => {
    /* Ohne ihn kollidierten zwei Betriebe in derselben Stunde. */
    expect(MIG).toMatch(/'critical_alert:' \|\| v_row\.user_id \|\| ':' \|\|[\s\S]{0,120}locationId/);
  });
});

describe('Der Betriebsname im Payload', () => {
  it('kommt aus dem betroffenen Standort', () => {
    expect(MIG).toMatch(/from public\.google_locations l[\s\S]{0,120}v_decision ->> 'locationId'/);
  });

  it('fällt auf den Registrierungsnamen zurück', () => {
    expect(MIG).toMatch(/v_row\.company_name, 'dein Betrieb'/);
  });

  it('behält den Registrierungsnamen getrennt', () => {
    expect(MIG).toMatch(/'accountName',\s+v_row\.company_name/);
  });
});

describe('Was unverändert bleibt', () => {
  it('meldet nur ungemeldete Bewertungen', () => {
    expect(MIG).toMatch(/not \(e\.delivered \? 'notification'\)/);
  });

  it('behält den Lebenszyklus', () => {
    /* new und seen. `opened` löst keine neue Meldung aus — der Kunde
       hat die Empfehlung dann bereits gesehen. */
    expect(MIG).toMatch(/e\.lifecycle in \('new', 'seen'\)/);
  });

  it('behält die Eventtypen', () => {
    expect(MIG).toMatch(/review\.negative_unanswered/);
    expect(MIG).toMatch(/reviews\.negative_batch/);
  });

  it('bündelt weiterhin innerhalb eines Standorts', () => {
    /* Drei Bewertungen für S&I ergeben eine Mail, nicht drei. */
    expect(MIG).toMatch(/count\(\*\)\s+as anzahl/);
  });
});
