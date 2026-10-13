/**
 * Die Kontoregel „kein verwaltbarer Betrieb" (Paket H1, P0 #5).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM EINE QUELLTEXTPRUEFUNG
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Engine laeuft in Deno und holt ihre Fakten aus Postgres. Sie
 * hier zu importieren und zu mocken hiesse, meinen Mock zu pruefen.
 * Dieselbe Bauart und dieselbe Begruendung wie
 * src/utils/recommendationClass.test.js, das die Regel
 * review.none_yet so prueft.
 *
 * Geprueft wird, was man am Quelltext ablesen kann und was beim
 * Umbauen verloren geht:
 *
 *   dass die Regel existiert, aktiv ist und am Konto haengt
 *   dass sie drei Bedingungen hat — und welche
 *   dass "unbekannt" nicht wie "null Betriebe" behandelt wird
 *   dass sie Google keinen Grund in den Mund legt (§32)
 *   dass die Automatik die bestehende Auswahl benutzt (§57)
 *
 * Was hier NICHT geprueft werden kann, steht woanders:
 *   die Wirkung der Automatik   supabase/tests/autoAuswahl.test.sql
 *   der Dashboard-Zustand       src/hooks/briefingKeineBetriebe.test.js
 *   der Score ohne Betrieb      src/hooks/scoreOhneStandort.test.js
 */
const fs = require('fs');

const GB = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');

/** Den Block einer Regel ausschneiden (wie recommendationClass.test.js). */
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

/** Den Rumpf einer freistehenden Funktion oder Methode ausschneiden. */
function rumpf(kopf) {
  const start = GB.indexOf(kopf);
  if (start === -1) return '';
  const rest = GB.slice(start + kopf.length);
  const naechste = rest.search(/\n  (private |public )?async \w+\(|\nasync function |\nfunction /);
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

const R = regel('account.no_locations');

describe('Die Regel existiert und haengt am Konto', () => {

  it('ist vorhanden und aktiv', () => {
    expect(R).not.toBe('');
    expect(R).toMatch(/status: 'active'/);
  });

  it('steht in KONTO_REGELN', () => {
    /* Sonst wuerde sie je Betrieb erzeugt — und bei null Betrieben
       gar nicht, weil es dann keinen Betriebsumfang gibt. Die Regel
       waere wirkungslos. */
    const menge = GB.slice(GB.indexOf('const KONTO_REGELN'),
                           GB.indexOf('function istKontoRegel'));
    expect(menge).toMatch(/'account\.no_locations'/);
  });

  it('ist als Problem eingeordnet, nicht als Wachstum', () => {
    /* growth-Aufgaben rotieren. Diese nicht: Ohne Betrieb ist das
       Produkt wirkungslos, naechste Woche genauso. */
    const klassen = GB.slice(GB.indexOf('const REGEL_KLASSE'),
                             GB.indexOf('};', GB.indexOf('const REGEL_KLASSE')));
    expect(klassen).toMatch(/'account\.no_locations':\s+'problem'/);
  });

  it('laesst sich nicht wegklicken', () => {
    /* Wegklicken aendert den Zustand nicht — danach gibt es weiterhin
       nichts zu zeigen. */
    expect(R).toMatch(/isDismissable: false/);
    expect(R).toMatch(/priority: 'critical'/);
  });
});

describe('Die Bedingung', () => {

  it('verlangt eine bestehende Verbindung', () => {
    /* Ohne Verbindung sagt connection.missing es schon. Zwei
       Empfehlungen fuer denselben Zustand sind eine zu viel. */
    expect(R).toMatch(/facts\.connection\.exists/);
  });

  it('verlangt eine intakte Verbindung', () => {
    /* Bei needs_reauth oder revoked gilt connection.lost — die leere
       Liste ist dann eine Folge, keine eigene Aussage. */
    expect(R).toMatch(/facts\.connection\.status === 'active'/);
  });

  it('feuert auf die Zahl 0, nicht auf „falsy"', () => {
    /* Der Kern. `!facts.account.locationCount` waere bei null
       ebenfalls wahr — und null heisst unbekannt. Die Regel wuerde
       dann "keine Betriebe gefunden" behaupten, weil eine Zahl
       fehlte. */
    expect(R).toMatch(/facts\.account\.locationCount === 0/);
    expect(R).not.toMatch(/!facts\.account\.locationCount/);
  });
});

describe('Unbekannt ist nicht null', () => {

  it('traegt buildFacts die Kontozahl von aussen herein', () => {
    /* Der Kontext liefert sie nicht. Sie kommt aus derselben
       Abfrage, mit der evaluateUser die Umfaenge bestimmt — sonst
       koennte die Regel "keine Betriebe" behaupten, waehrend
       daneben Betriebsumfaenge laufen. */
    expect(GB).toMatch(/function buildFacts\(ctx: EvaluationContext, kontoStandorte: number \| null\)/);
    expect(GB).toMatch(/locationCount: typeof kontoStandorte === 'number' \? kontoStandorte : null/);
  });

  it('gibt evaluateUser bei einer kaputten Standortabfrage null weiter', () => {
    /* Scheitert die Abfrage, ist die Liste leer — und eine leere
       Liste sieht aus wie "null Betriebe". Dann waere ein
       Datenbankfehler eine Produktaussage. */
    expect(GB).toMatch(/const kontoStandorte = locationResult\.error \? null : locations\.length/);
    expect(GB).toMatch(/log\.warn\('locations_unreadable'/);
  });

  it('haelt account.locationCount von profile.locationCount getrennt', () => {
    /* profile.locationCount zaehlt die Standorte IM UMFANG — im
       Kontoumfang null, und das ist fuer die Betriebsregeln richtig.
       Wer die Kontoregel darauf stuetzte, bekaeme sie bei jedem
       Konto. */
    expect(GB).toMatch(/locationCount: ctx\.locations\.length/);
    expect(R).not.toMatch(/facts\.profile\.locationCount/);
  });

  it('reicht die Zahl durch evaluateScope hindurch', () => {
    expect(GB).toMatch(/kontoStandorte: number \| null,\n\): Promise</);
    expect(GB).toMatch(/buildFacts\(kontext as EvaluationContext, kontoStandorte\)/);
    expect(GB).toMatch(/evaluateScope\(userId, locationId, thresholds, log, kontoStandorte\)/);
  });
});

describe('§32 Kein erfundener Grund', () => {

  it('sagt ausdruecklich, dass Google den Grund nicht liefert', () => {
    /* Die API gibt eine leere Liste zurueck. Alles andere waere
       geraten. */
    expect(R).toMatch(/sagt Google uns nicht/);
  });

  it('nennt die zwei pruefbaren Ursachen als Moeglichkeit', () => {
    expect(R).toMatch(/anderen Google-Konto/);
    expect(R).toMatch(/Inhaber oder Administrator/);
    expect(R).toMatch(/Das passiert meist/);
  });

  it('behauptet nichts ueber Ranking oder Umsatz', () => {
    expect(R).not.toMatch(/Ranking|Umsatz|Platz 1|garantiert|%/i);
  });

  it('fuehrt irgendwohin', () => {
    expect(R).toMatch(/actionUrl: '\/dashboard\/google'/);
  });

  it('nennt die Fakten, auf die sie sich stuetzt', () => {
    expect(R).toMatch(/sourceFacts: \['account\.locationCount', 'connection\.status'\]/);
  });
});

describe('§57 Die Automatik benutzt die bestehende Auswahl', () => {
  const koerper = rumpf('private async ensureSelection(userId: string): Promise<string | null> {');

  it('ruft die Datenbankfunktion, statt selbst zu waehlen', () => {
    expect(koerper).toMatch(/rpc\('auto_select_single_location'/);
    /* Keine zweite Auswahllogik: kein eigenes Schreiben von
       selected_at, keine eigene Zaehlung. */
    expect(koerper).not.toMatch(/selected_at:/);
    expect(koerper).not.toMatch(/\.update\(/);
  });

  it('haelt den Sync nicht auf, wenn sie scheitert', () => {
    /* Die Standorte sind geschrieben. Die Auswahl holt der naechste
       Lauf nach — ein Fehler hier darf den Import nicht entwerten. */
    expect(koerper).toMatch(/if \(error\)/);
    expect(koerper).toMatch(/log\.warn\('auto_select_failed'/);
    expect(koerper).not.toMatch(/throw/);
  });

  it('laeuft nach jedem Standort-Sync', () => {
    const sync = GB.slice(GB.indexOf('await this.ensurePrimary(userId);'));
    expect(sync.slice(0, 600)).toMatch(/await this\.ensureSelection\(userId\)/);
  });

  it('haelt im Ergebnis fest, wenn sie etwas geaendert hat', () => {
    /* Eine Zustandsaenderung, die der Kunde nicht ausgeloest hat,
       gehoert ins Protokoll. */
    expect(GB).toMatch(/autoSelectedLocationId: string \| null;/);
    expect(GB).toMatch(/autoSelectedLocationId: ausgewaehlt/);
  });

  it('entscheidet nichts ueber die Identitaet des Nutzers', () => {
    /* §18. Die Automatik gilt fuer jeden Betrieb mit genau einem
       Standort — nicht fuer eine Liste von Konten. */
    const migration = fs.readFileSync(
      'supabase/migrations/20261013110000_auto_auswahl_einzelstandort.sql', 'utf8');
    expect(migration).not.toMatch(/user_id\s*=\s*'[0-9a-f]{8}-/i);
    expect(migration).not.toMatch(/email/i);
  });
});
