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

const ERZEUGEN = rumpfVon(MAIL, 'async function ergaenzeMailLinks');

/*
 * Der Einloesepfad wird seit Paket D6.1 in actionScanner.test.js
 * geprueft.
 *
 * handleActionLink ist dort in drei Teile zerfallen:
 *
 *   pruefeActionToken      Ratenbegrenzung und Token, veraendert nichts
 *   handleActionLinkGet    zeigt nur die Zwischenansicht
 *   handleActionLinkPost   startet die Anmeldung nach einem Klick
 *
 * Die Zusicherungen dieser Datei — kein consume beim GET, keine
 * Gruende nach aussen, kein offener Redirect, Ratenbegrenzung — gelten
 * weiterhin und stehen jetzt dort, wo sie zum jeweiligen Teil passen.
 *
 * Hier bleibt, was die Mailseite betrifft: Token-Erzeugung und
 * Vorlage.
 */

describe('Die Vorlage nennt den richtigen Betrieb', () => {
  const WOCHE = (() => {
    const start = MAIL.indexOf("case 'weekly_summary': {");
    return start === -1 ? '' : MAIL.slice(start, MAIL.indexOf("case 'weekly_report'", start));
  })();

  it('bevorzugt den Standortnamen vor dem Registrierungsnamen', () => {
    /* Bei zwei Betrieben stand im Betreff "Ruhige Woche bei Firma
       Rolf Müller Sanitär und Heizungstechnik", während die Mail von
       S&I handelte. */
    expect(WOCHE).toMatch(/data\.locationTitle \|\| data\.companyName/);
  });

  it('nutzt diesen Namen im Betreff', () => {
    expect(WOCHE).toMatch(/Ruhige Woche bei ' \+ escapeHtml\(betriebsname\)/);
  });

  it('hat einen neutralen Rückfall', () => {
    expect(WOCHE).toMatch(/'deinem Betrieb'/);
  });
});

describe('Die Vorlage rendert das produktive Feld', () => {
  const WOCHE = (() => {
    const start = MAIL.indexOf("case 'weekly_summary': {");
    return start === -1 ? '' : MAIL.slice(start, MAIL.indexOf("case 'weekly_report'", start));
  })();

  it('liest actions, nicht nur engineEvents', () => {
    /* schedule_communications legt die Aufgaben unter `actions` ab.
       Bis zum 05.10. las dieser Block nur `engineEvents` — ein Feld
       aus weekly_payload_for, das im produktiven Pfad nicht vorkommt.
       Die Mail enthielt deshalb keine Aufgaben: kein Fehler, nur eine
       leere Liste. */
    expect(WOCHE).toMatch(/data\.actions/);
  });

  it('liest beide Feldnamen für den Aufwand', () => {
    /* Das produktive Payload nennt es `minutes`, das andere
       `estimatedMinutes`. */
    expect(WOCHE).toMatch(/e\.minutes/);
    expect(WOCHE).toMatch(/e\.estimatedMinutes/);
  });

  it('liest beide Schreibweisen des Ziels', () => {
    expect(WOCHE).toMatch(/e\.action_url/);
    expect(WOCHE).toMatch(/e\.actionUrl/);
  });

  it('bevorzugt den Token-Link vor dem regulären Pfad', () => {
    /* mailLink zuerst — sonst stünde der Token-Link im Payload und
       die Mail nutzte trotzdem den Login-Pfad. */
    expect(WOCHE).toMatch(/e\.mailLink \?\? e\.action_url/);
  });
});

describe('Wiederholter Versand', () => {
  it('erzeugt den Token im Worker, nicht beim Einreihen', () => {
    /* Dokumentiert, wo der Link entsteht: Die Queue-Zeile trägt den
       internen Pfad, der Token-Link kommt erst beim Rendern dazu. */
    expect(MAIL).toMatch(/row\.template === 'weekly_summary'\s*\?\s*await ergaenzeMailLinks/);
  });

  it('verlässt sich auf das Widerrufen beim Anlegen', () => {
    /* Ein gescheiterter Versand wird wiederholt, und jeder Versuch
       erzeugt neue Tokens. create_action_token widerruft dabei die
       vorherigen desselben Zwecks — es bleibt immer genau einer
       gültig. Zeilen sammeln sich an, aktive Tokens nicht. */
    expect(ERZEUGEN).toMatch(/rpc\('create_action_token'/);
    expect(ERZEUGEN).toMatch(/p_event_id:/);
    expect(ERZEUGEN).toMatch(/p_purpose:/);
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
    /* Beide Schreibweisen — das echte Payload nutzt action_url. */
    expect(ERZEUGEN).toMatch(/zielErlaubt\(roh\)/);
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
