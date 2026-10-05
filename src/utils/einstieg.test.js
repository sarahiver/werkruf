/**
 * Übergabe nach der Anmeldung.
 *
 * Anlass: Nach dem Supabase-Callback war nicht garantiert, dass die
 * entstandene Sitzung zu dem Nutzer gehört, an den der Mail-Link
 * gebunden ist. Ein als B angemeldeter Browser hätte den Betrieb, die
 * Empfehlung und das Ziel von A bekommen.
 */
const fs = require('fs');

const GB  = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');
const SEITE = fs.readFileSync('src/pages/Einstieg.js', 'utf8');

function rumpfVon(quelle, signatur) {
  const start = quelle.indexOf(signatur);
  if (start === -1) return '';
  let i = quelle.indexOf('(', start), runde = 0;
  for (; i < quelle.length; i++) {
    if (quelle[i] === '(') runde++;
    else if (quelle[i] === ')') { runde--; if (runde === 0) { i++; break; } }
  }
  const rest = quelle.slice(i);
  const t = /\{\s*\n/.exec(rest);
  if (!t) return '';
  const anfang = i + t.index;
  let tiefe = 0, j = anfang;
  for (; j < quelle.length; j++) {
    if (quelle[j] === '{') tiefe++;
    else if (quelle[j] === '}') { tiefe--; if (tiefe === 0) break; }
  }
  return quelle.slice(anfang, j + 1);
}

const ohneKommentare = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '');

const EINSTIEG = ohneKommentare(rumpfVon(GB, 'async function handleEinstieg'));
const POST     = ohneKommentare(rumpfVon(GB, 'async function handleActionLinkPost'));

describe('Die Identität kommt aus der Sitzung', () => {
  it('liest den Nutzer über requireUser', () => {
    /* Nicht aus der Adresse, nicht aus dem Rumpf. */
    expect(EINSTIEG).toMatch(/await requireUser\(request\)/);
  });

  it('übergibt die Sitzungskennung an die Prüfung', () => {
    expect(EINSTIEG).toMatch(/p_session_user_id: user\.id/);
  });

  it('nimmt keine Nutzerkennung aus dem Aufruf', () => {
    /* Eine übergebene Kennung wäre der Weg, fremde Daten zu
       bekommen. */
    expect(EINSTIEG).not.toMatch(/body\.userId|body\.email|searchParams\.get\('user/);
  });

  it('ersetzt die Sitzung nicht durch die Dienstkennung', () => {
    /* Service Role prüft, meldet aber niemanden an. */
    expect(EINSTIEG).not.toMatch(/user\.id\s*=|userId\s*=\s*ergebnis/);
  });
});

describe('Nach der Anmeldung wird erneut geprüft', () => {
  it('prüft die Empfehlung gegen den Sitzungsnutzer', () => {
    /* Nicht gegen den Nutzer aus dem Zustand — gegen den, der
       tatsächlich angemeldet ist. */
    expect(EINSTIEG).toMatch(/\.from\('events'\)[\s\S]*?\.eq\('user_id', user\.id\)/);
  });

  it('weist erledigte und abgelaufene Empfehlungen ab', () => {
    expect(EINSTIEG).toMatch(/completed[\s\S]*dismissed[\s\S]*resolved[\s\S]*expired/);
  });

  it('weist Regeln im Probebetrieb ab', () => {
    /* Gleiche Freigabe wie Dashboard und Mail. */
    expect(EINSTIEG).toMatch(/rule_status[\s\S]*?candidate/);
  });

  it('prüft das Eigentum am Betrieb erneut', () => {
    expect(EINSTIEG).toMatch(/\.from\('google_locations'\)[\s\S]*?\.eq\('user_id', user\.id\)/);
    expect(EINSTIEG).toMatch(/\.is\('deleted_at', null\)/);
  });

  it('setzt keinen Betrieb, der nicht mehr gehört', () => {
    expect(EINSTIEG).toMatch(/if \(loc\)/);
  });
});

describe('Das Ziel kommt aus dem Token', () => {
  it('liest targetPath aus dem geprüften Ergebnis', () => {
    expect(EINSTIEG).toMatch(/ergebnis\.targetPath/);
  });

  it('nimmt kein Ziel aus der Adresse', () => {
    expect(EINSTIEG).not.toMatch(/searchParams\.get\('(next|redirect|to)'\)|body\.(next|redirect)/);
  });

  it('prüft das Ziel ein letztes Mal', () => {
    /* Nach Token-Erzeugung, nach Resolve, jetzt noch einmal. */
    expect(EINSTIEG).toMatch(/zielErlaubt\(ziel\)/);
  });

  it('fällt auf das Dashboard zurück', () => {
    expect(EINSTIEG).toMatch(/'\/dashboard'/);
  });
});

describe('Nichts sickert durch', () => {
  it('unterscheidet nach aussen nur zwei Fälle', () => {
    /* user_mismatch, damit die Oberfläche etwas Sinnvolles sagen kann
       — alles andere bleibt ununterscheidbar. */
    /* Nur was tatsaechlich hinter `reason:` steht — nicht jede
       Zeichenkette im Rumpf. 'expired' etwa kommt in der
       Lebenszyklus-Liste vor, ist dort aber kein Grund. */
    const gruende = new Set(
      [...EINSTIEG.matchAll(/reason:\s*([^,\n}]+)/g)]
        .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])));

    expect(gruende).toEqual(new Set(['invalid', 'user_mismatch']));
  });

  it('reicht die inneren Gründe nicht durch', () => {
    /* „abgelaufen" verriete, dass es den Link gab; „bereits benutzt"
       sogar, dass jemand ihn schon geöffnet hat. */
    for (const g of ['expired', 'revoked', 'not_found', 'already_used']) {
      expect(EINSTIEG).not.toMatch(new RegExp(`reason: '${g}'`));
    }
  });

  it('protokolliert weder Zustand noch Token', () => {
    const zeilen = [...EINSTIEG.matchAll(/log\.\w+\([^)]*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const z of zeilen) {
      expect(z).not.toMatch(/\bstate\b/);
      expect(z).not.toMatch(/\btoken\b(?!Id)/);
    }
  });
});

describe('Der Übergabezustand', () => {
  it('entsteht beim Continue, nicht beim Anzeigen', () => {
    expect(POST).toMatch(/rpc\('create_action_auth_state'/);
  });

  it('schickt den rohen Token nicht mit', () => {
    /* Er stünde sonst in der Adresszeile, im Verlauf und im Referer —
       und gilt eine Woche. */
    expect(POST).toMatch(/\/einstieg\?s=\$\{encodeURIComponent\(klartext\)\}/);
    expect(POST).not.toMatch(/\?token=|&token=|action_token=/);
  });

  it('kommt ohne aus, wenn das Anlegen scheitert', () => {
    /* Dann landet der Besucher angemeldet auf dem Ziel, nur ohne die
       erneute Prüfung. Schlechter, aber nicht kaputt. */
    expect(POST).toMatch(/action_state_failed|action_state_error/);
  });
});

describe('Die Übergabeseite', () => {
  it('wartet auf die Sitzung', () => {
    /* Supabase verarbeitet den Anmeldelink asynchron; ohne Warten
       käme die Anfrage ohne Sitzungstoken an. */
    expect(SEITE).toMatch(/supabase\.auth\.getSession\(\)/);
    expect(SEITE).toMatch(/for \(let i = 0; i < \d+/);
  });

  it('schickt das Sitzungstoken mit', () => {
    expect(SEITE).toMatch(/Bearer \$\{sitzung\.access_token\}/);
  });

  it('läuft nur einmal', () => {
    /* Der Zustand gilt einmalig; eine zweite Anfrage durch eine
       Neuzeichnung würde ihn verbrauchen. */
    expect(SEITE).toMatch(/gelaufen\.current/);
  });

  it('ersetzt den Verlaufseintrag', () => {
    /* Sonst landete ein Zurück-Klick wieder hier, auf einem
       verbrauchten Zustand. */
    expect(SEITE).toMatch(/\{ replace: true \}/);
  });

  it('nennt den Fall des falschen Kontos beim Namen', () => {
    expect(SEITE).toMatch(/user_mismatch/);
    expect(SEITE).toMatch(/anderen WERKRUF-Konto/);
  });

  it('verrät nicht, wem der Link gehört', () => {
    expect(SEITE).not.toMatch(/ergebnis\.(userId|email|locationTitle)/);
  });
});
