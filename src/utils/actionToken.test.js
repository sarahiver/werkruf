/**
 * Action-Tokens.
 *
 * Schwerpunkt: Der Klartext steht nirgends in der Datenbank, das
 * Auflösen verändert nichts, und ein Link kann nicht zu einer fremden
 * Domain führen.
 */
/*
 * jsdom kennt kein globales `crypto`. Deno und jeder Browser haben es;
 * hier wird Nodes eigene Umsetzung eingehängt, damit getestet wird,
 * was tatsächlich läuft — und nicht eine Nachbildung.
 */
if (typeof globalThis.crypto === 'undefined'
    || typeof globalThis.crypto.subtle === 'undefined') {
  // eslint-disable-next-line global-require
  const { webcrypto } = require('crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto, configurable: true, writable: true,
  });
}

/* TextEncoder fehlt in jsdom ebenfalls. */
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line global-require
  const { TextEncoder, TextDecoder } = require('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

/* btoa gibt es in Node erst ab 16 global — zur Sicherheit. */
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
}

import {
  erzeugeToken, hashe, sichtPlausibelAus, zielErlaubt,
  zweckErlaubt, ZWECKE, abweisung, BESUCHER_MELDUNG, laufzeitIntervall,
} from './actionToken';

describe('Erzeugen', () => {
  it('liefert Klartext und Hash getrennt', async () => {
    const { klartext, hash } = await erzeugeToken();

    expect(typeof klartext).toBe('string');
    expect(typeof hash).toBe('string');
    /* Der Hash darf den Klartext nicht enthalten. */
    expect(hash).not.toContain(klartext);
  });

  it('erzeugt genug Zufall', async () => {
    const { klartext } = await erzeugeToken();
    /* 32 Byte base64url → 43 Zeichen. */
    expect(klartext.length).toBeGreaterThanOrEqual(42);
  });

  it('erzeugt jedes Mal einen anderen', async () => {
    const viele = await Promise.all(
      Array.from({ length: 50 }, () => erzeugeToken()));
    const eindeutig = new Set(viele.map((t) => t.klartext));

    expect(eindeutig.size).toBe(50);
  });

  it('nutzt nur URL-sichere Zeichen', async () => {
    for (let i = 0; i < 20; i++) {
      const { klartext } = await erzeugeToken();
      /* Kein +, / oder = — die müssten in der URL kodiert werden und
         überleben manche Mailprogramme nicht. */
      expect(klartext).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(klartext)).toBe(klartext);
    }
  });
});

describe('Hash', () => {
  it('ist für denselben Klartext stabil', async () => {
    const { klartext, hash } = await erzeugeToken();
    /* Sonst fände das Nachschlagen den Token nie — und der Fehler
       sähe aus wie „Token nicht gefunden". */
    expect(await hashe(klartext)).toBe(hash);
  });

  it('ergibt 64 Hex-Zeichen', async () => {
    expect(await hashe('irgendwas')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unterscheidet sich bei einem geänderten Zeichen', async () => {
    const a = await hashe('TokenAAAA');
    const b = await hashe('TokenAAAB');
    expect(a).not.toBe(b);
  });

  it('ist nicht umkehrbar', async () => {
    const { klartext, hash } = await erzeugeToken();
    /* Wer die Tabelle liest, kann daraus keinen gültigen Link bauen. */
    expect(hash).not.toContain(klartext.slice(0, 8));
  });
});

describe('Zielprüfung', () => {
  it('erlaubt interne Dashboard-Pfade', () => {
    expect(zielErlaubt('/dashboard')).toBe(true);
    expect(zielErlaubt('/dashboard/fotos')).toBe(true);
    expect(zielErlaubt('/dashboard/bewertungen?id=1')).toBe(true);
  });

  it('weist fremde Domains ab', () => {
    expect(zielErlaubt('https://evil.example')).toBe(false);
    expect(zielErlaubt('http://evil.example/dashboard')).toBe(false);
  });

  it('weist protokollrelative Ziele ab', () => {
    /* Der Fall, den man übersieht: Beginnt mit „/", führt aber zu
       einer fremden Domain. Ein offener Redirect unter der Domain von
       WERKRUF sieht für den Empfänger besonders vertrauenswürdig aus. */
    expect(zielErlaubt('//evil.example')).toBe(false);
    expect(zielErlaubt('//evil.example/dashboard')).toBe(false);
  });

  it('weist Schema-Tricks ab', () => {
    expect(zielErlaubt('javascript:alert(1)')).toBe(false);
    expect(zielErlaubt('data:text/html,<script>')).toBe(false);
    expect(zielErlaubt('/dashboard\\..\\admin')).toBe(false);
  });

  it('weist Pfade ausserhalb des Dashboards ab', () => {
    expect(zielErlaubt('/admin')).toBe(false);
    expect(zielErlaubt('/api/internal')).toBe(false);
    expect(zielErlaubt('/')).toBe(false);
  });

  it('weist Unsinn ab', () => {
    expect(zielErlaubt('')).toBe(false);
    expect(zielErlaubt(null)).toBe(false);
    expect(zielErlaubt(undefined)).toBe(false);
    expect(zielErlaubt(42)).toBe(false);
  });
});

describe('Zwecke', () => {
  it('kennt nur festgelegte Zwecke', () => {
    expect(zweckErlaubt(ZWECKE.EVENT_OEFFNEN)).toBe(true);
    expect(zweckErlaubt(ZWECKE.DASHBOARD)).toBe(true);
  });

  it('weist erfundene Zwecke ab', () => {
    /* Ein Tippfehler soll nicht stillschweigend einen neuen Zweck
       erfinden. */
    expect(zweckErlaubt('event.oepnen')).toBe(false);
    expect(zweckErlaubt('admin.alles')).toBe(false);
    expect(zweckErlaubt('')).toBe(false);
  });
});

describe('Abweisung', () => {
  it('sagt bei jedem Grund dasselbe', () => {
    const gruende = ['not_found', 'expired', 'revoked', 'location_mismatch'];
    const meldungen = gruende.map((g) => abweisung(g).body.message);

    /* „Abgelaufen" verriete, dass der Token existierte. */
    expect(new Set(meldungen).size).toBe(1);
    expect(meldungen[0]).toBe(BESUCHER_MELDUNG);
  });

  it('antwortet immer mit 200', () => {
    /* Ein 404 unterschiede erkennbar zwischen „gab es nie" und „gibt
       es nicht mehr". */
    expect(abweisung('not_found').status).toBe(200);
    expect(abweisung('expired').status).toBe(200);
  });

  it('nennt den Grund nur fürs Protokoll', () => {
    const a = abweisung('expired');
    expect(a.body.reason).toBe('expired');
    /* Die sichtbare Meldung enthält ihn nicht. */
    expect(a.body.message).not.toContain('expired');
    expect(a.body.message).not.toMatch(/abgelaufen|gelöscht|fremd/i);
  });

  it('zeigt den Weg ins Dashboard', () => {
    /* Kein Trost, sondern der Ausweg: Dort liegt dieselbe Aufgabe. */
    expect(BESUCHER_MELDUNG).toMatch(/Dashboard/);
  });
});

describe('Laufzeit', () => {
  it('gilt sieben Tage', () => {
    expect(laufzeitIntervall()).toBe('7 days');
  });

  it('deckelt übertriebene Angaben', () => {
    /* Ein Token, der Monate gilt, ist kein Token mehr. */
    expect(laufzeitIntervall(365)).toBe('30 days');
  });

  it('fällt bei Unsinn auf die Vorgabe zurück', () => {
    expect(laufzeitIntervall(0)).toBe('7 days');
    expect(laufzeitIntervall(-5)).toBe('7 days');
    expect(laufzeitIntervall('viel')).toBe('7 days');
  });
});

describe('Vorprüfung', () => {
  it('erkennt echte Tokens', async () => {
    const { klartext } = await erzeugeToken();
    expect(sichtPlausibelAus(klartext)).toBe(true);
  });

  it('weist offensichtlichen Unsinn ab', () => {
    expect(sichtPlausibelAus('kurz')).toBe(false);
    expect(sichtPlausibelAus('a'.repeat(200))).toBe(false);
    expect(sichtPlausibelAus(null)).toBe(false);
    expect(sichtPlausibelAus('hat leerzeichen drin ok')).toBe(false);
  });
});

describe('Quelltext', () => {
  const quelle = require('fs').readFileSync('src/utils/actionToken.js', 'utf8');

  it('gibt den Klartext nicht in ein Protokoll', () => {
    expect(quelle).not.toMatch(/console\.(log|warn|error)\([^)]*klartext/);
  });

  it('verwendet kryptografischen Zufall', () => {
    /* Math.random ist vorhersagbar. */
    expect(quelle).toMatch(/crypto\.getRandomValues/);
    expect(quelle).not.toMatch(/Math\.random/);
  });
});
