/*
 * Fremdkundenfälle A–G (Paket H1, §35).
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS DIESE DATEI IST — UND WAS SIE NICHT IST
 * ═══════════════════════════════════════════════════════════════
 *
 * §35 verlangt für sieben Lagen eines fremden Betriebs je fünf
 * Antworten: UI-Zustand, Score, Engine, Mail, nächste Aktion,
 * MVP-fähig. Die Matrix steht in docs/fremdkundenfaelle-a-g.md.
 *
 * Hier wird der Teil davon geprüft, der sich OHNE Google herstellen
 * lässt — die Zustände, die unsere eigenen Einheiten aus den Daten
 * ableiten. §36 verlangt, das klar zu trennen; diese Datei ist
 * deshalb ausdrücklich die Spalte „automatisierter Test" der Matrix
 * und nicht mehr.
 *
 * Was hier NICHT bewiesen wird:
 *
 *   dass Google in Fall B wirklich eine leere Liste liefert
 *   dass OAuth in Fall F wirklich 'oauth_denied' zurückgibt
 *   dass eine unverifizierte Location in Fall E wirklich ohne
 *   placeId kommt
 *
 * Das sind Aussagen über Google, und die stehen erst nach dem
 * Fremdaccount-Smoke fest (docs/operations/fremdaccount-smoke.md).
 * Geprüft wird: WENN die Daten so aussehen, DANN sagt das Produkt
 * das Richtige.
 *
 * ═══════════════════════════════════════════════════════════════
 * DER WICHTIGSTE BEFUND DIESER ANALYSE
 * ═══════════════════════════════════════════════════════════════
 *
 * B, D und G sind für uns EIN Zustand. Google liefert in allen drei
 * Fällen dasselbe — eine leere Liste:
 *
 *   B  Profil existiert, das Konto darf es nicht verwalten
 *   D  es gibt überhaupt kein Unternehmensprofil
 *   G  OAuth erfolgreich, aber 0 Locations
 *
 * Drei verschiedene Ursachen, ein beobachtbarer Zustand. Das Produkt
 * darf deshalb nicht behaupten, es kenne den Grund — und genau das
 * wird unten geprüft.
 */
import { renderHook } from '@testing-library/react';

jest.mock('./supabaseClient', () => ({ __esModule: true, default: { from: jest.fn() } }));

import { waehle } from './hooks/useAusgewaehlterStandort';
import { useHealthScore } from './hooks/useHealthScore';
import { messageForCode } from './hooks/useGoogleBusiness';
import { istBearbeitbar } from './utils/gbpFieldModel';

const fs = require('fs');
const GB = fs.readFileSync('supabase/functions/google-business/index.ts', 'utf8');

/* Ein Standort, wie der Sync ihn schreibt. */
const standort = (eigen = {}) => ({
  id: 'loc-a', title: 'Sanitaer Mueller', selected_at: null,
  place_id: 'ChIJ_aaa', primary_phone: '+49 40 1', website_uri: 'https://x.example',
  locality: 'Hamburg', primary_category: 'gcid:plumber', google_media: [],
  ...eigen,
});

const STATS_MIT = {
  totalReviews: 4, averageRating: 4.6, unanswered: 0, distribution: {},
  newestReviewAt: new Date().toISOString(), photoCount: 5,
};
const STATS_LEER = {
  totalReviews: 0, averageRating: null, unanswered: 0, distribution: {},
  newestReviewAt: null, photoCount: 0,
};

const score = (locations, stats = STATS_LEER) => renderHook(() => useHealthScore({
  stats, locations, replyCounts: {}, loading: false,
})).result.current;

/* Den Block einer Engine-Regel ausschneiden (wie
   src/utils/recommendationClass.test.js). */
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

describe('A — verifiziert und verwaltbar', () => {

  it('gilt als ausgewählter Betrieb und bekommt einen Score', () => {
    const bestaetigt = standort({ selected_at: '2026-10-13T08:00:00Z' });

    expect(waehle([bestaetigt]).grund).toBe('ausgewaehlt');

    const e = score([bestaetigt], STATS_MIT);
    expect(e.score).toBeGreaterThan(0);
    expect(e.locationId).toBe('loc-a');
  });

  it('bekommt den Score auch vor der ersten Bestätigung', () => {
    /* Die Automatik setzt selected_at beim Sync (Migration
       20261013110000); bis dahin gilt die Ein-Standort-Abkürzung der
       Score-Regel. Beide Wege führen zu einem Score — der Kunde
       hängt nicht. */
    expect(score([standort()], STATS_MIT).score).toBeGreaterThan(0);
  });
});

describe('B, D, G — Google liefert nichts, aus drei verschiedenen Gründen', () => {

  it('führen alle drei zum selben Zustand', () => {
    /* Es gibt für uns keine Daten, die sie unterscheiden: In allen
       drei Fällen ist die Standortliste leer. */
    const e = score([]);

    expect(waehle([]).grund).toBe('keine');
    expect(e.score).toBeNull();
    expect(e.level).toBe('keine_betriebe');
  });

  it('erzeugen keinen Score von 0', () => {
    /* Eine 0 sähe aus wie ein schlechter Betrieb — und der Kunde hat
       nichts falsch gemacht. */
    expect(score([]).score).not.toBe(0);
  });

  it('nennen keinen Grund, den Google nicht geliefert hat', () => {
    /* §32. Die Engine-Regel formuliert die zwei prüfbaren Ursachen
       als Möglichkeit und sagt ausdrücklich, dass Google den Grund
       nicht nennt. */
    const R = regel('account.no_locations');

    expect(R).toMatch(/sagt Google uns nicht/);
    expect(R).toMatch(/Das passiert meist/);

    /* Und keine Behauptung, die zwischen B, D und G unterscheiden
       würde. */
    expect(R).not.toMatch(/du hast kein Unternehmensprofil|existiert nicht|gelöscht/i);
  });

  it('bekommen eine nächste Aktion, keine Sackgasse', () => {
    const R = regel('account.no_locations');

    expect(R).toMatch(/actionUrl: '\/dashboard\/google'/);
    expect(R).toMatch(/Zugriff auf dein Unternehmensprofil prüfen/);
  });
});

describe('C — mehrere Locations', () => {

  it('verlangt eine Auswahl, statt eine zu raten', () => {
    const a = standort({ id: 'loc-a', place_id: 'ChIJ_aaa' });
    const b = standort({ id: 'loc-b', place_id: 'ChIJ_bbb', title: 'Mueller Heizung' });

    const w = waehle([a, b]);
    expect(w.standort).toBeNull();
    expect(w.grund).toBe('ohne_auswahl');
    expect(w.anzahl).toBe(2);
  });

  it('zeigt bis dahin keinen Score', () => {
    const e = score([standort({ id: 'loc-a' }), standort({ id: 'loc-b' })], STATS_MIT);

    expect(e.score).toBeNull();
    expect(e.level).toBe('kein_standort');
    expect(e.summary).toMatch(/Wähle einen Betrieb/);
  });

  it('folgt nach der Auswahl genau einem Betrieb', () => {
    const gewaehlt = standort({ id: 'loc-b', place_id: 'ChIJ_bbb', selected_at: '2026-10-13Z' });
    const e = score([standort({ id: 'loc-a' }), gewaehlt], STATS_MIT);

    expect(e.locationId).toBe('loc-b');
  });
});

describe('E — Location vorhanden, aber nicht vollständig', () => {

  it('gilt als Betrieb, auch ohne Google-Kennung', () => {
    /* Auswahl und „hat eine place_id" sind zwei Dinge. Der Betrieb
       wird verwaltet; nur der Bewertungslink geht nicht. */
    const ohneKennung = standort({ place_id: null, selected_at: '2026-10-13Z' });

    const w = waehle([ohneKennung]);
    expect(w.grund).toBe('ausgewaehlt');
    expect(w.standort.place_id).toBeNull();
  });

  it('bekommt einen Score aus den Feldern, die da sind', () => {
    /* Kein Sonderzustand: Die fehlenden Angaben senken den Wert, sie
       löschen ihn nicht. */
    const e = score([standort({ place_id: null, website_uri: null, primary_phone: null })], STATS_MIT);

    expect(e.score).toBeGreaterThan(0);
    expect(e.factors.find((f) => f.id === 'completeness').action).toBe('Angaben ergänzen');
  });

  it('sperrt bei fehlender Bestätigung die Schreibfelder — mit Grund', () => {
    /* Erste Fassung dieser Zusage behauptete, der Verifizierungsstand
       werde nirgends ausgewertet. Falsch, und der Test hat es
       gefangen: istBearbeitbar sperrt bei hasVoiceOfMerchant === false
       JEDES Schreibfeld, mit einem Grund, der die Lage benennt
       (gbpFieldModel.js). Die Oberfläche zeigt ihn einmal oben statt
       zwanzigmal am Feld, und der Server prüft dasselbe noch einmal
       verbindlich (google-business/index.ts, zweite Stufe).

       Für Fall E heisst das: Er IST unterschieden — dort, wo es
       zählt, nämlich beim Schreiben. */
    const ohneVom = { google_profile: { metadata: { hasVoiceOfMerchant: false } } };
    const mitVom  = { google_profile: { metadata: { hasVoiceOfMerchant: true } } };

    const gesperrt = istBearbeitbar('websiteUri', ohneVom);
    expect(gesperrt.erlaubt).toBe(false);
    expect(gesperrt.code).toBe('keine_voice_of_merchant');
    expect(gesperrt.grund).toMatch(/nicht veröffentlicht/);

    /* Gegenprobe: mit Bestätigung ist das Feld offen — die Sperre
       greift nicht pauschal. */
    expect(istBearbeitbar('websiteUri', mitVom).erlaubt).toBe(true);
  });

  it('lässt den Score und die Engine davon unberührt', () => {
    /* Die ehrliche Grenze: Score, Engine und Mails kennen den
       Verifizierungsstand nicht. Der Betrieb bekommt also einen Wert
       und Aufgaben, von denen ein Teil erst nach der Bestätigung
       durch Google wirkt. Das ist für den MVP vertretbar, aber es ist
       eine Lücke und steht als solche in der Matrix. */
    for (const datei of ['src/hooks/useHealthScore.js', 'src/utils/healthScore.js']) {
      expect(fs.readFileSync(datei, 'utf8')).not.toMatch(/VoiceOfMerchant|verif/i);
    }

    /* Nur der Regelkatalog, nicht der Rest der Datei: Die
       Schreibhandler prüfen hasVoiceOfMerchant sehr wohl, und das
       sollen sie. Der erste Entwurf schnitt bis zum Dateiende und
       meldete deshalb einen Treffer, der keiner war. */
    const anfang = GB.indexOf('const RULES: Rule[] = [');
    const engineRegeln = GB.slice(anfang, GB.indexOf('\n];\n', anfang));
    expect(engineRegeln).toMatch(/account\.no_locations/);   // richtiger Ausschnitt
    expect(engineRegeln).not.toMatch(/hasVoiceOfMerchant/);
  });
});

describe('F — OAuth abgebrochen oder Rechte verweigert', () => {

  it.each([
    ['oauth_denied', /abgebrochen/],
    ['insufficient_scope', /nicht alle Berechtigungen/],
    ['missing_refresh_token', /dauerhaften Zugriff/],
  ])('%s wird in Klartext erklärt', (code, muster) => {
    expect(messageForCode(code)).toMatch(muster);
  });

  it('sagt jedem dieser Fälle, was zu tun ist', () => {
    for (const code of ['oauth_denied', 'insufficient_scope', 'missing_refresh_token']) {
      expect(messageForCode(code)).toMatch(/verbinden|Freigabe|Häkchen/);
    }
  });

  it('lässt keinen internen Code ins Dashboard', () => {
    /* Ein unbekannter Code bekommt die generische Meldung — nicht den
       Code selbst. */
    const generisch = messageForCode('irgendwas_internes_42');

    expect(generisch).not.toMatch(/irgendwas_internes_42/);
    expect(generisch).toMatch(/Bitte später noch einmal versuchen/);
  });

  it('bleibt nach einem Abbruch im Zustand „nicht verbunden"', () => {
    /* Kein halber Zustand: Ohne Verbindung gibt es keine Standorte,
       und die Engine sagt connection.missing. */
    expect(regel('connection.missing')).toMatch(/!facts\.connection\.exists/);
    expect(score([]).level).toBe('keine_betriebe');
  });
});

describe('Die Matrix ist vollständig dokumentiert', () => {
  const doku = fs.readFileSync('docs/fremdkundenfaelle-a-g.md', 'utf8');

  it.each(['A', 'B', 'C', 'D', 'E', 'F', 'G'])('Fall %s steht in der Matrix', (fall) => {
    expect(doku).toMatch(new RegExp(`\\|\\s*\\*\\*${fall}\\*\\*`));
  });

  it('beantwortet für jeden Fall die fünf Fragen aus §35', () => {
    for (const frage of ['UI-Zustand', 'Score', 'Engine', 'Mail', 'nächste Aktion', 'MVP-fähig']) {
      expect(doku).toMatch(new RegExp(frage));
    }
  });

  it('trennt automatisierten Test von echtem Smoke (§36)', () => {
    for (const art of ['automatisierter Test', 'Codepfad', 'Fremdaccount-Smoke',
                       'noch nicht reproduzierbar']) {
      expect(doku).toMatch(new RegExp(art));
    }
  });
});
