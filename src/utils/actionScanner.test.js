/**
 * Scannerfestigkeit der Mail-Links.
 *
 * Anlass: Bis zum 05.10.2026 erzeugte der GET-Pfad sofort einen
 * Supabase-Anmeldelink und leitete darauf weiter. Ein Mailscanner, der
 * dem Redirect folgt, hätte den Anmeldelink aufgerufen, bevor der
 * Empfänger die Mail öffnet — der Link wäre verbraucht, der Kunde
 * klickte ins Leere.
 */
const fs = require('fs');

const GB = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');

/*
 * Den Rumpf einer Funktion ausschneiden.
 *
 * Ab der oeffnenden Klammer NACH der Parameterliste und dem
 * Rueckgabetyp — sonst findet die naive Suche bei
 * `: Promise<{ ok: false }>` die Klammer des Typs und liefert ihn
 * statt des Rumpfes.
 */
function rumpfVon(quelle, signatur) {
  const start = quelle.indexOf(signatur);
  if (start === -1) return '';

  /* Hinter der Parameterliste beginnen. */
  let i = quelle.indexOf('(', start);
  let runde = 0;
  for (; i < quelle.length; i++) {
    if (quelle[i] === '(') runde++;
    else if (quelle[i] === ')') { runde--; if (runde === 0) { i++; break; } }
  }

  /* Die naechste geschweifte Klammer, die eine Zeile beendet oder
     allein steht, ist der Rumpf — nicht ein Typ in derselben Zeile. */
  const rest = quelle.slice(i);
  const treffer = /\{\s*\n/.exec(rest);
  if (!treffer) return '';

  const anfang = i + treffer.index;
  let tiefe = 0, j = anfang;
  for (; j < quelle.length; j++) {
    if (quelle[j] === '{') tiefe++;
    else if (quelle[j] === '}') { tiefe--; if (tiefe === 0) break; }
  }
  return quelle.slice(anfang, j + 1);
}

/*
 * Kommentare entfernen.
 *
 * Sonst findet eine Prüfung wie „kein signInWithOtp" den Begriff im
 * Kommentar, der genau das erklärt — und schlägt an, obwohl der Code
 * sauber ist.
 */
const ohneKommentare = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '');

const GET   = ohneKommentare(rumpfVon(GB, 'async function handleActionLinkGet'));
const POST  = ohneKommentare(rumpfVon(GB, 'async function handleActionLinkPost'));
const PRUEF = ohneKommentare(rumpfVon(GB, 'async function pruefeActionToken'));

describe('GET startet keine Anmeldung', () => {
  it('ruft generateLink nicht auf', () => {
    /* Der Kernpunkt. Ein Scanner, der dem Redirect folgt, hätte den
       Anmeldelink vor dem Empfänger verbraucht. */
    expect(GET).not.toMatch(/generateLink/);
  });

  it('leitet nicht weiter', () => {
    expect(GET).not.toMatch(/Response\.redirect|status:\s*30[128]/);
  });

  it('verbraucht den Token nicht', () => {
    expect(GET).not.toMatch(/consume_action_token/);
  });

  it('setzt kein opened', () => {
    /* Beim GET wäre es der Scanner, der die Empfehlung "geöffnet"
       hätte. */
    expect(GET).not.toMatch(/record_recommendation_action/);
    expect(GET).not.toMatch(/'opened'/);
  });

  it('ändert den ausgewählten Betrieb nicht', () => {
    expect(GET).not.toMatch(/selected_at/);
  });

  it('schreibt nichts', () => {
    expect(GET).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
  });

  it('liest nur, was die Seite anzeigt', () => {
    /* Betriebsname und Aufgabe — mehr erfährt niemand, der einen
       fremden Link in die Hand bekommt. */
    expect(GET).toMatch(/\.from\('google_locations'\)/);
    expect(GET).toMatch(/\.from\('events'\)/);
  });
});

describe('POST startet die Anmeldung', () => {
  it('ruft generateLink auf', () => {
    expect(POST).toMatch(/auth\.admin\.generateLink/);
  });

  it('verschickt keine zweite Mail', () => {
    /* signInWithOtp verschickte eine Mail, die niemand bestellt hat. */
    expect(POST).not.toMatch(/signInWithOtp/);
    expect(POST.length).toBeGreaterThan(500);
  });

  it('baut kein eigenes JWT', () => {
    expect(POST).not.toMatch(/jwt\.sign|SignJWT|createJWT/);
  });

  it('prüft den Token erneut, statt dem GET zu vertrauen', () => {
    /* Zwischen GET und POST können Minuten liegen. */
    expect(POST).toMatch(/await pruefeActionToken\(token, request, log\)/);
  });

  it('prüft den Zustand der Empfehlung erneut', () => {
    expect(POST).toMatch(/completed.*dismissed.*resolved.*expired|lifecycle/s);
  });

  it('meldet opened erst hier', () => {
    expect(POST).toMatch(/'opened'/);
  });

  it('stellt den Betrieb um', () => {
    /* Sonst zeigte das Dashboard nach dem Einstieg den zuletzt
       gewählten statt den aus dem Link. */
    expect(POST).toMatch(/selected_at/);
    expect(POST).toMatch(/\.eq\('user_id', ctx\.userId/);
  });

  it('leitet mit 302 weiter, nicht 301', () => {
    expect(POST).toMatch(/status: 302/);
    expect(POST).not.toMatch(/status: 301/);
  });

  it('weist eine fremde Herkunft ab', () => {
    expect(POST).toMatch(/request\.headers\.get\('origin'\)/);
  });
});

describe('Kopfzeilen', () => {
  /* Vom Beginn der Kopfzeilen bis zur schliessenden Klammer. */
  const H = (() => {
    const a = GB.indexOf('const ACTION_HEADERS');
    return a === -1 ? '' : GB.slice(a, GB.indexOf('};', a) + 2);
  })();

  it('verhindert Zwischenspeicherung', () => {
    /* Eine gespeicherte Seite mit Token im Pfad überlebt den Besuch. */
    expect(H).toMatch(/'Cache-Control': 'no-store/);
  });

  it('verhindert Referrer-Weitergabe', () => {
    /* Ohne das schickt der Browser die volle Adresse — Token
       inklusive — an jedes Ziel. */
    expect(H).toMatch(/'Referrer-Policy': 'no-referrer'/);
  });

  it('verbietet das Einbetten', () => {
    expect(H).toMatch(/'X-Frame-Options': 'DENY'/);
    expect(H).toMatch(/frame-ancestors 'none'/);
  });

  it('lädt nichts von aussen', () => {
    /* Jede externe Ressource bekäme den Referer und damit den Token. */
    expect(H).toMatch(/default-src 'none'/);
  });

  it('beschränkt das Formularziel', () => {
    expect(H).toMatch(/form-action 'self'/);
  });

  it('setzt die Kopfzeilen auch beim Weiterleiten', () => {
    expect(POST).toMatch(/'Cache-Control': 'no-store/);
    expect(POST).toMatch(/'Referrer-Policy': 'no-referrer'/);
  });
});

describe('Die Zwischenansicht', () => {
  /* actionSeite gibt ein Template-Literal zurueck — die geschweiften
     Klammern darin verwirren rumpfVon. Deshalb von der Signatur bis
     zur naechsten Funktion schneiden. */
  const SEITE = (() => {
    const a = GB.indexOf('function actionSeite');
    return a === -1 ? '' : GB.slice(a, GB.indexOf('function actionAbweisung', a));
  })();

  it('lädt keine externen Ressourcen', () => {
    expect(SEITE).not.toMatch(/https?:\/\/fonts\.|googleapis|cdn\.|analytics/);
  });

  it('bindet Formate ein statt zu verlinken', () => {
    expect(SEITE).toMatch(/<style>/);
    expect(SEITE).not.toMatch(/<link[^>]+stylesheet/);
  });

  it('enthält kein Skript', () => {
    expect(SEITE).not.toMatch(/<script/);
  });

  it('nutzt ein Formular, keinen Link', () => {
    /* Scanner folgen Links; ein Formular schicken sie nicht ab. */
    expect(SEITE).toMatch(/<form method="POST"/);
  });

  it('maskiert eingesetzte Werte', () => {
    expect(SEITE).toMatch(/hEsc\(/);
  });

  it('verbietet Indexierung', () => {
    expect(SEITE).toMatch(/noindex,nofollow/);
  });
});

describe('Ratenbegrenzung', () => {
  it('begrenzt nach Token und nach Adresse', () => {
    expect(PRUEF).toMatch(/action_link:/);
    expect(PRUEF).toMatch(/action_ip:/);
  });

  it('lässt für eine geteilte Adresse mehr zu als für einen Token', () => {
    /* Hinter einer Adresse kann ein ganzes Unternehmen oder ein
       Mailprovider stecken. */
    const token = Number(/action_link:[\s\S]*?p_limit: (\d+)/.exec(PRUEF)[1]);
    const ip    = Number(/action_ip:[\s\S]*?p_limit: (\d+)/.exec(PRUEF)[1]);
    expect(ip).toBeGreaterThan(token);
  });
});

describe('Routing', () => {
  const ROUTING = GB.slice(GB.indexOf("if (routeName === 'a' && sub)"),
                           GB.indexOf("if (routeName === 'a' && sub)") + 900);

  it('trennt GET und POST', () => {
    expect(ROUTING).toMatch(/request\.method === 'POST' && weiter/);
    expect(ROUTING).toMatch(/request\.method === 'GET' && !weiter/);
  });

  it('weist GET auf continue ab', () => {
    /* Das wäre der Weg, den Schutz zu umgehen. */
    expect(ROUTING).toMatch(/status: 405/);
  });
});

describe('Keine Geheimnisse im Protokoll', () => {
  const alle = GET + POST + PRUEF;

  it('protokolliert weder Token noch Anmeldelink', () => {
    const zeilen = [...alle.matchAll(/log\.\w+\([^)]*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const z of zeilen) {
      expect(z).not.toMatch(/\btoken\b(?!Id)/);
      expect(z).not.toMatch(/action_link\b|magicLink|properties/);
    }
  });

  it('protokolliert nur Kennungen und Zustände', () => {
    expect(alle).toMatch(/tokenId:/);
  });
});
