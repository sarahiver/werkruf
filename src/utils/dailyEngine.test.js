/**
 * Täglicher Engine-Lauf.
 *
 * Anlass: Die Engine lief nur als Nebenwirkung eines Abgleichs. Eine
 * Regel, deren Wahrheit sich durch Zeit ändert — review.drought,
 * health.declined, ablaufende Cooldowns — feuerte damit nie.
 *
 * Geprüft wird hier, was sich ohne laufende Instanz prüfen lässt: dass
 * der Lauf keinen Google-Abgleich und keine Mail auslöst, und dass der
 * Cronjob richtig aufgebaut ist.
 */
const fs = require('fs');

const FUNKTION = fs.readFileSync(
  'supabase/functions/google-business/index.ts', 'utf8');
const MIGRATION = fs.readFileSync(
  'supabase/migrations/20261005100000_daily_engine_evaluation.sql', 'utf8');

/** Den Rumpf einer Funktion ausschneiden. */
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

describe('Der Lauf gleicht nichts ab', () => {
  const rumpf = rumpfVon(FUNKTION, 'async function handleEvaluateAll');

  it('ruft keinen Abgleich auf', () => {
    /* Das ist kein Daten-Abgleich, sondern eine Neubewertung des
       vorhandenen Datenstands. Ein taeglicher Google-Abgleich ueber
       alle Betriebe waere eine ganz andere Last — und bei Googles
       Kontingenten riskant. */
    expect(rumpf).not.toMatch(/syncLocations|syncReviews|syncMedia/);
    expect(rumpf).not.toMatch(/enqueueSyncJob|sync\/run|sync\/schedule/);
  });

  it('ruft keine Google-API auf', () => {
    expect(rumpf).not.toMatch(/createGbpClient|GBP_BUSINESS_INFO_API|googleapis/);
  });

  it('verschickt keine Mail', () => {
    expect(rumpf).not.toMatch(/enqueue_email|send-email|schedule_weekly/);
  });

  it('ruft den vorhandenen Orchestrator auf, statt eigene Logik zu bauen', () => {
    /* Keine zweite Schleife ueber Betriebe im Cron-Pfad — die
       Standortlogik liegt in evaluateUser. */
    expect(rumpf).toMatch(/await evaluateUser\(userId, log\)/);
    expect(rumpf).not.toMatch(/google_locations/);
  });
});

describe('Fehler halten den Lauf nicht auf', () => {
  const rumpf = rumpfVon(FUNKTION, 'async function handleEvaluateAll');

  it('fängt Fehler je Nutzer ab', () => {
    /* Ein Nutzer, der scheitert, darf die uebrigen nicht blockieren. */
    expect(rumpf).toMatch(/catch \(err\) \{/);
    expect(rumpf).toMatch(/failed\+\+/);
  });

  it('zählt Fehler, statt sie zu verschlucken', () => {
    expect(rumpf).toMatch(/log\.error\('evaluate_failed'/);
  });

  it('summiert auch gescheiterte Umfänge', () => {
    /* evaluateUser faengt Standortfehler selbst ab und meldet sie als
       `failed` — die Summe gehoert in die Antwort, sonst sieht ein
       Lauf mit drei kaputten Betrieben erfolgreich aus. */
    expect(rumpf).toMatch(/scopesFailed\s*\+=/);
  });
});

describe('Der Lauf ist beurteilbar', () => {
  const rumpf = rumpfVon(FUNKTION, 'async function handleEvaluateAll');

  it('liefert Kennzahlen, nicht nur eine Anzahl', () => {
    /* "evaluated: 42" sagt nicht, ob dabei etwas entstanden ist. */
    for (const feld of ['created', 'updated', 'resolved',
                        'scopesEvaluated', 'scopesFailed', 'durationMs']) {
      expect(rumpf).toMatch(new RegExp(feld));
    }
  });

  it('protokolliert den Abschluss', () => {
    expect(rumpf).toMatch(/evaluate_all_done/);
  });
});

describe('Zugriffsschutz', () => {
  const rumpf = rumpfVon(FUNKTION, 'async function handleEvaluateAll');

  it('verlangt das Worker-Secret', () => {
    expect(rumpf).toMatch(/requireWorkerSecret\(request\)/);
  });

  it('nimmt keine Nutzer-ID aus dem Aufruf', () => {
    /* Der Lauf bestimmt die Nutzer selbst — eine uebergebene ID waere
       ein Weg, fremde Daten auswerten zu lassen. */
    expect(rumpf).not.toMatch(/body\.userId|searchParams\.get\('userId'\)/);
  });
});

describe('Cronjob', () => {
  it('läuft einmal täglich', () => {
    expect(MIGRATION).toMatch(/'30 4 \* \* \*'/);
  });

  it('entfernt einen vorhandenen Job vor dem Anlegen', () => {
    /* Ohne das stuende die Bewertung nach jedem Einspielen einmal mehr
       auf dem Plan. */
    expect(MIGRATION).toMatch(/cron\.unschedule\('engine-daily'\)/);
    expect(MIGRATION).toMatch(/cron\.schedule\(\s*'engine-daily'/);
  });

  it('trägt das Secret nicht im Befehlstext', () => {
    /* Der Befehl steht in cron.job und ist damit lesbar. */
    expect(MIGRATION).toMatch(/from vault\.decrypted_secrets/);
    expect(MIGRATION).not.toMatch(/'X-Worker-Secret',\s*'[A-Za-z0-9]/);
  });

  it('ruft evaluate-all auf, nicht einen Abgleichpfad', () => {
    expect(MIGRATION).toMatch(/events\/evaluate-all/);
    expect(MIGRATION).not.toMatch(/sync\/run|sync\/schedule/);
  });

  it('räumt genug Zeit für einen vollständigen Lauf ein', () => {
    const treffer = /timeout_milliseconds := (\d+)/.exec(MIGRATION);
    expect(treffer).not.toBeNull();
    expect(Number(treffer[1])).toBeGreaterThanOrEqual(120000);
  });

  it('läuft vor der Wochenmail', () => {
    /* comm-weekly steht auf 0 7 * * 1. Liefe die Bewertung danach,
       enthielte die Montagsmail den Stand vom Vortag. */
    const stunde = Number(/'30 (\d+) \* \* \*'/.exec(MIGRATION)[1]);
    expect(stunde).toBeLessThan(7);
  });
});
