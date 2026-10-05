/**
 * Mail-Links einlösen.
 *
 * Geprüft wird, was sich ohne laufende Instanz prüfen lässt: dass der
 * GET-Pfad nichts verbraucht, dass kein Grund nach aussen dringt, und
 * dass der Klartext nirgends protokolliert wird.
 */
const fs = require('fs');

const GB   = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');
const MAIL = fs.readFileSync('supabase/functions/send-email/index.ts', 'utf8');

function rumpfVon(quelle, signatur) {
  const start = quelle.indexOf(signatur);
  if (start === -1) return '';
  let tiefe = 0, i = quelle.indexOf('{', start);
  const anfang = i;
  for (; i < quelle.length; i++) {
    if (quelle[i] === '{') tiefe++;
    else if (quelle[i] === '}') { tiefe--; if (tiefe === 0) break; }
  }
  return quelle.slice(anfang, i + 1);
}

const EINLOESEN = rumpfVon(GB, 'async function handleActionLink');
const ERZEUGEN  = rumpfVon(MAIL, 'async function ergaenzeMailLinks');

describe('Der GET-Pfad verbraucht nichts', () => {
  it('ruft resolve auf, nicht consume', () => {
    /* Mailprovider und Virenscanner öffnen den Link automatisch, oft
       mehrfach. Ein verbrauchendes GET macht ihn tot, bevor der
       Empfänger klickt. */
    expect(EINLOESEN).toMatch(/rpc\('resolve_action_token'/);
    expect(EINLOESEN).not.toMatch(/consume_action_token/);
  });

  it('schreibt nichts in die Datenbank', () => {
    expect(EINLOESEN).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
  });

  it('löst keine Engine-Bewertung und keine Mail aus', () => {
    expect(EINLOESEN).not.toMatch(/evaluateUser|enqueue_email|sync\//);
  });
});

describe('Die Route ist öffentlich', () => {
  it('verlangt keinen Bearer-Token', () => {
    /* Der Empfänger ist nicht eingeloggt — genau das ist der Punkt. */
    expect(EINLOESEN).not.toMatch(/requireUser/);
  });

  it('verlangt kein Worker-Secret', () => {
    expect(EINLOESEN).not.toMatch(/requireWorkerSecret/);
  });

  it('wird vor der regulären Routenauflösung behandelt', () => {
    expect(GB).toMatch(/if \(routeName === 'a' && sub\)/);
  });
});

describe('Kein Grund dringt nach aussen', () => {
  it('leitet bei jedem Fehlerfall auf dieselbe Seite', () => {
    /* „Abgelaufen" verriete, dass es den Token gab. */
    const ziele = [...EINLOESEN.matchAll(/abweisungsZiel\('([^']+)'\)/g)]
      .map((m) => m[1]);
    expect(ziele.length).toBeGreaterThanOrEqual(4);
    expect(GB).toMatch(/function abweisungsZiel/);
  });

  it('protokolliert den Grund, statt ihn zu zeigen', () => {
    expect(EINLOESEN).toMatch(/log\.warn\('action_link_invalid'[\s\S]*?reason/);
  });

  it('nimmt den Zielpfad aus dem Token, nicht aus der URL', () => {
    /* Ein Link, der ?to=... mitführt und das glaubt, lässt sich
       umschreiben. */
    expect(EINLOESEN).toMatch(/ergebnis\.targetPath/);
    expect(EINLOESEN).not.toMatch(/searchParams\.get\('(to|redirect|next)'\)/);
  });

  it('prüft das Ziel erneut, bevor es weiterleitet', () => {
    expect(EINLOESEN).toMatch(/if \(!zielErlaubt\(zielPfad\)\)/);
  });

  it('leitet mit 302 weiter, nicht mit 301', () => {
    /* Ein dauerhafter Redirect landete im Browsercache — und der
       Token steht in der Adresse. */
    expect(EINLOESEN).toMatch(/, 302\)/);
    expect(EINLOESEN).not.toMatch(/, 301\)/);
  });
});

describe('Anmeldung ohne Passwort', () => {
  it('nutzt Supabase statt eines eigenen JWT', () => {
    /* Ein selbst signiertes Token müsste Laufzeit, Rotation und
       Widerruf selbst verwalten — ein Fehler darin wäre ein
       Generalschlüssel. */
    expect(EINLOESEN).toMatch(/auth\.admin\.generateLink/);
    expect(EINLOESEN).not.toMatch(/jwt\.sign|SignJWT|createJWT/);
  });

  it('kommt ohne Sitzung trotzdem ans Ziel', () => {
    /* Scheitert der Magic Link, landet der Besucher auf der Zielseite
       und meldet sich regulär an. Schlechter, aber nicht kaputt. */
    expect(EINLOESEN).toMatch(/catch \(err\)/);
    expect(EINLOESEN).toMatch(/let ziel =/);
  });
});

describe('Ratenbegrenzung', () => {
  it('begrenzt nach Token, nicht nach Adresse', () => {
    /* Dieselbe Mail wird von mehreren Scannern desselben Providers
       geöffnet, oft aus derselben IP. Eine Begrenzung pro IP träfe
       den Empfänger mit. */
    expect(EINLOESEN).toMatch(/check_rate_limit/);
    expect(EINLOESEN).toMatch(/action_link:\$\{hash/);
  });

  it('lässt genug Aufrufe für Scanner zu', () => {
    const treffer = /p_limit: (\d+)/.exec(EINLOESEN);
    expect(treffer).not.toBeNull();
    expect(Number(treffer[1])).toBeGreaterThanOrEqual(30);
  });
});

describe('Token-Erzeugung in der Mail', () => {
  it('speichert nur den Hash', () => {
    expect(ERZEUGEN).toMatch(/p_token_hash:\s+hash/);
    /* Der Klartext geht in die URL, nicht in die Datenbank. */
    expect(ERZEUGEN).not.toMatch(/p_token_hash:\s+klartext/);
  });

  it('protokolliert den Klartext nicht', () => {
    const protokolle = [...ERZEUGEN.matchAll(/console\.\w+\(([\s\S]*?)\)\);/g)]
      .map((m) => m[1]);
    for (const p of protokolle) {
      expect(p).not.toMatch(/klartext/);
    }
  });

  it('bindet den Token an Nutzer, Standort und Empfehlung', () => {
    expect(ERZEUGEN).toMatch(/p_user_id:\s+userId/);
    expect(ERZEUGEN).toMatch(/p_location_id:/);
    expect(ERZEUGEN).toMatch(/p_event_id:/);
  });

  it('prüft das Ziel vor dem Erzeugen', () => {
    expect(ERZEUGEN).toMatch(/zielErlaubt\(e\.actionUrl\)/);
  });

  it('fällt bei einem Fehler auf den regulären Pfad zurück', () => {
    /* Eine Mail ohne Links wäre schlimmer als eine mit Anmeldung. */
    expect(ERZEUGEN).toMatch(/return e;/);
    expect(ERZEUGEN).toMatch(/token_failed|token_error/);
  });

  it('erzeugt je Aufgabe einen eigenen Token', () => {
    /* Ein Token für alle Links wäre ein Generalschlüssel für die
       ganze Mail. */
    expect(ERZEUGEN).toMatch(/events\.map\(async \(e\)/);
  });
});
