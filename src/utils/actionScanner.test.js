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
const path = require('path');

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
       gewählten statt den aus dem Link.

       Hier stand vorher `toMatch(/selected_at/)` plus
       `.eq('user_id', ctx.userId`. Das prüfte den Mechanismus, und
       der Mechanismus war der Fehler: Ein direktes UPDATE auf
       selected_at verletzt bei mehreren Betrieben
       google_locations_one_selected_per_user, weil es die alte
       Auswahl nicht zurücksetzt (gemessen in
       supabase/tests/standortwechsel.test.sql, Abschnitt 1). Der
       Test war grün, während die Umstellung still fehlschlug.

       Jetzt geprüft: dass überhaupt umgestellt wird, über den einen
       dafür gebauten Weg — und dass der Nutzer aus dem geprüften
       Token kommt, nicht aus der Anfrage. */
    expect(POST).toMatch(/rpc\('activate_google_location'/);
    expect(POST).toMatch(/p_user_id: ctx\.userId/);
    expect(POST).not.toMatch(/\.update\(\s*\{\s*selected_at/);
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

describe('Die Zwischenansicht (seit WP16-Fix1 im Frontend: src/pages/ActionLink.js)', () => {
  /* Das Supabase-Gateway liefert HTML von Edge Functions als text/plain
     aus. Die Seite rendert deshalb das Frontend; die Function antwortet
     nur mit JSON (…/info) und Redirects. Die Schutzregeln der Seite
     gelten unveraendert — nur an anderer Stelle. */
  const SEITE = ohneKommentare(fs.readFileSync(path.resolve(__dirname, '../pages/ActionLink.js'), 'utf8'));
  const HELFER = ohneKommentare(fs.readFileSync(path.resolve(__dirname, './tokenSeite.js'), 'utf8'));
  const GBC = ohneKommentare(GB);

  it('die Function liefert fuer /a/ kein HTML mehr', () => {
    expect(GBC).not.toMatch(/function actionSeite|text\/html|<!doctype html>/);
    expect(GBC).toMatch(/'Content-Type': 'application\/json; charset=utf-8'/);
  });

  it('lädt keine externen Ressourcen und kein Analytics', () => {
    expect(SEITE + HELFER).not.toMatch(/https?:\/\/fonts\.|googleapis|cdn\.|analytics|gtag|plausible|sentry/i);
  });

  it('nutzt ein Formular (POST an die Function), keinen Link — Scanner schicken keine Formulare ab', () => {
    expect(SEITE).toMatch(/<form method="POST" action=\{weiterAktion\}/);
    expect(SEITE).toMatch(/const weiterAktion = `\$\{FUNCTIONS_BASE\}\/a\/\$\{encodeURIComponent\(token \?\? ''\)\}\/continue`;/);
    expect(SEITE).not.toMatch(/fetch\([^)]*continue/);
  });

  it('GET der Seite ruft nur …/info ab — keine Mutation, kein continue', () => {
    expect(SEITE).toMatch(/ladeTokenAuskunft\(`\$\{FUNCTIONS_BASE\}\/a\/\$\{encodeURIComponent\(token\)\}\/info`\)/);
    expect(HELFER).toMatch(/method: 'GET'/);
    expect(HELFER).not.toMatch(/method: 'POST'/);
  });

  it('verbietet Indexierung und Referrer; speichert den Token nirgends', () => {
    expect(HELFER).toMatch(/setze\('robots', 'noindex,nofollow'\)/);
    expect(HELFER).toMatch(/setze\('referrer', 'no-referrer'\)/);
    expect(HELFER).toMatch(/referrerPolicy: 'no-referrer'/);
    expect(SEITE + HELFER).not.toMatch(/localStorage|sessionStorage|console\.log|console\.warn/);
  });

  it('Fehler sind neutral: ein Text fuer alle ungueltigen Faelle, Netzfehler getrennt', () => {
    expect(HELFER).toMatch(/ungueltig: 'Dieser Link ist nicht mehr gültig\.'/);
    expect(HELFER).toMatch(/if \(antwort\.status === 404\) return \{ zustand: 'ungueltig' \};/);
    expect(HELFER).toMatch(/if \(!antwort\.ok\) return \{ zustand: 'netz' \};/);
    expect(SEITE).not.toMatch(/abgelaufen|widerrufen|fremd|unbekannt/i);
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
                           GB.indexOf("if (routeName === 'a' && sub)") + 1600);

  it('trennt GET und POST', () => {
    expect(ROUTING).toMatch(/request\.method === 'POST' && weiter/);
    expect(ROUTING).toMatch(/request\.method === 'GET' && !weiter/);
  });

  it('weist GET auf continue ab', () => {
    /* Das wäre der Weg, den Schutz zu umgehen. */
    expect(ROUTING).toMatch(/status: 405/);
  });

  it('WP16-Fix1: alter GET /a/<token> ist ein 302 ins Frontend, /info liefert JSON', () => {
    expect(ROUTING).toMatch(/if \(request\.method === 'GET' && info\) \{\s*return handleActionLinkGet\(request, sub\);/);
    expect(ROUTING).toMatch(/if \(request\.method === 'GET' && !weiter\) \{\s*return leiteZumFrontend\(`\/a\/\$\{encodeURIComponent\(sub\)\}`\);/);
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
