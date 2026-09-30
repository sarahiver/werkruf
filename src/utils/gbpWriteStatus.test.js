/**
 * Schreibfluss zu Google: Rückvergleich und die drei Zustände.
 *
 * Anlass: Beim End-to-End-Test musste im Google-Unternehmensprofil
 * zusätzlich manuell auf „Speichern" geklickt werden, damit die
 * Änderung als ausstehend erschien. WERKRUF meldete trotzdem Erfolg —
 * `confirmed: true` war fest verdrahtet und bedeutete nur, dass HTTP
 * nicht geworfen hat.
 *
 * Geprüft werden hier die reine Vergleichslogik und die Ableitung des
 * Zustands. Der tatsächliche Google-Aufruf lässt sich nur gegen ein
 * echtes Profil prüfen.
 */
import { stimmtUeberein, alsZeit, alsDatum } from './gbpHours';

const fenster = (tag, auf, zu) => ({
  openDay: tag, closeDay: tag,
  openTime: alsZeit(auf), closeTime: alsZeit(zu),
});

describe('Rückvergleich nach dem Schreiben', () => {
  it('erkennt den gesendeten Stand wieder', () => {
    const gesendet = { periods: [fenster('WEDNESDAY', '09:00', '16:30')] };
    expect(stimmtUeberein('regularHours', gesendet, gesendet)).toBe(true);
  });

  it('ist unempfindlich gegen Googles Schreibweise', () => {
    /* Google lässt `minutes: 0` weg. Ohne Normalisierung meldete jeder
       erfolgreiche Schreibvorgang eine Abweichung. */
    const gesendet = { periods: [fenster('WEDNESDAY', '09:00', '16:30')] };
    const vonGoogle = { periods: [{
      openDay: 'WEDNESDAY', closeDay: 'WEDNESDAY',
      openTime: { hours: 9 }, closeTime: { hours: 16, minutes: 30 },
    }] };
    expect(stimmtUeberein('regularHours', gesendet, vonGoogle)).toBe(true);
  });

  it('ist unempfindlich gegen die Reihenfolge', () => {
    const a = { periods: [fenster('MONDAY', '09:00', '17:00'), fenster('TUESDAY', '09:00', '17:00')] };
    const b = { periods: [fenster('TUESDAY', '09:00', '17:00'), fenster('MONDAY', '09:00', '17:00')] };
    expect(stimmtUeberein('regularHours', a, b)).toBe(true);
  });

  it('erkennt eine Abweichung', () => {
    /* Der Fall aus dem End-to-End-Test: 16:30 gesendet, Google führt
       weiterhin 17:00. */
    const gesendet = { periods: [fenster('WEDNESDAY', '09:00', '16:30')] };
    const gelesen  = { periods: [fenster('WEDNESDAY', '09:00', '17:00')] };
    expect(stimmtUeberein('regularHours', gesendet, gelesen)).toBe(false);
  });

  it('erkennt ein fehlendes Zeitfenster', () => {
    const gesendet = { periods: [fenster('MONDAY', '09:00', '17:00'), fenster('TUESDAY', '09:00', '17:00')] };
    const gelesen  = { periods: [fenster('MONDAY', '09:00', '17:00')] };
    expect(stimmtUeberein('regularHours', gesendet, gelesen)).toBe(false);
  });

  it('vergleicht Sonderzeiten samt geschlossen-Kennzeichen', () => {
    const zu = { specialHourPeriods: [{ startDate: alsDatum('2026-12-25'), closed: true }] };
    const offen = { specialHourPeriods: [{
      startDate: alsDatum('2026-12-25'),
      openTime: alsZeit('10:00'), closeTime: alsZeit('14:00'),
    }] };
    expect(stimmtUeberein('specialHours', zu, zu)).toBe(true);
    expect(stimmtUeberein('specialHours', zu, offen)).toBe(false);
  });

  it('vergleicht weitere Zeiten', () => {
    const a = [{ hoursTypeKey: 'PICKUP', periods: [fenster('MONDAY', '10:00', '16:00')] }];
    expect(stimmtUeberein('moreHours', a, a)).toBe(true);
    expect(stimmtUeberein('moreHours', a,
      [{ hoursTypeKey: 'DELIVERY', periods: [fenster('MONDAY', '10:00', '16:00')] }])).toBe(false);
  });

  it('meldet null, wo keine Normalisierung existiert', () => {
    /* null heisst „nicht prüfbar", nicht „stimmt nicht". Nur ein
       ausdrückliches false ist ein Befund. */
    expect(stimmtUeberein('websiteUri', 'https://a.example', 'https://b.example')).toBeNull();
    expect(stimmtUeberein('profile.description', 'alt', 'neu')).toBeNull();
  });

  it('behandelt fehlende Seiten nicht als Übereinstimmung', () => {
    expect(stimmtUeberein('regularHours',
      { periods: [fenster('MONDAY', '09:00', '17:00')] }, undefined)).toBe(false);
    expect(stimmtUeberein('regularHours',
      { periods: [fenster('MONDAY', '09:00', '17:00')] }, { periods: [] })).toBe(false);
  });
});

/*
 * Die Zustandsableitung liegt in der Edge Function. Hier wird die
 * Regel selbst geprüft, damit sie nicht unbemerkt kippt.
 */
function leiteStatusAb({ weichtAb, pendingFelder, geaenderteFelder }) {
  const stehtAn = geaenderteFelder.some(
    (f) => pendingFelder.some((p) => p.split('.')[0] === f));
  return weichtAb ? 'not_submitted'
    : stehtAn ? 'submitted_pending'
    : 'submitted_no_pending';
}

describe('Die drei Schreibzustände', () => {
  it('meldet submitted_pending, wenn Google das Feld prüft', () => {
    expect(leiteStatusAb({
      weichtAb: false, pendingFelder: ['regularHours'], geaenderteFelder: ['regularHours'],
    })).toBe('submitted_pending');
  });

  it('erkennt ein Feld auch über seinen Unterpfad', () => {
    /* Google nennt in pendingMask mitunter `profile.description`. */
    expect(leiteStatusAb({
      weichtAb: false, pendingFelder: ['profile.description'], geaenderteFelder: ['profile'],
    })).toBe('submitted_pending');
  });

  it('meldet submitted_no_pending bei unmittelbarer Übernahme', () => {
    /* Der Stand stimmt, aber Google führt nichts als ausstehend.
       Vermutlich sofort übernommen — „veröffentlicht" behaupten wir
       trotzdem nicht. */
    expect(leiteStatusAb({
      weichtAb: false, pendingFelder: [], geaenderteFelder: ['regularHours'],
    })).toBe('submitted_no_pending');
  });

  it('ignoriert ein pendingMask zu einem anderen Feld', () => {
    expect(leiteStatusAb({
      weichtAb: false, pendingFelder: ['phoneNumbers'], geaenderteFelder: ['regularHours'],
    })).toBe('submitted_no_pending');
  });

  it('meldet not_submitted, wenn der Stand abweicht', () => {
    /* Kein Erfolg. Genau der Fall, den `confirmed: true` bisher
       verschluckt hat. */
    expect(leiteStatusAb({
      weichtAb: true, pendingFelder: [], geaenderteFelder: ['regularHours'],
    })).toBe('not_submitted');
  });

  it('meldet auch dann not_submitted, wenn etwas ausstehend ist', () => {
    /* Eine Abweichung wiegt schwerer: Steht etwas anderes an, während
       unser Stand nicht stimmt, ist die Einreichung nicht belegt. */
    expect(leiteStatusAb({
      weichtAb: true, pendingFelder: ['regularHours'], geaenderteFelder: ['regularHours'],
    })).toBe('not_submitted');
  });
});

describe('Quelltext des Schreibpfads', () => {
  const quelle = require('fs').readFileSync(
    'supabase/functions/google-business/index.ts', 'utf8');

  it('setzt nirgends validateOnly', () => {
    /* validateOnly=true würde nur validieren und nichts ändern.
       Geprüft wird die VERWENDUNG, nicht das Wort — in den
       Erläuterungen kommt es vor, im Code nicht. */
    const ohneKommentare = quelle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(ohneKommentare).not.toMatch(/validateOnly/);
  });

  it('wertet die PATCH-Antwort aus', () => {
    expect(quelle).toMatch(/const patchAntwort = await client\.updateLocation/);
  });

  it('ruft getGoogleUpdated nach dem Schreiben auf', () => {
    const posPatch = quelle.indexOf('const patchAntwort = await client.updateLocation');
    const posUpdated = quelle.indexOf('client.getGoogleUpdated(location.location_resource_name)', posPatch);
    expect(posUpdated).toBeGreaterThan(posPatch);
  });

  it('wertet pendingMask aus, nicht diffMask', () => {
    expect(quelle).toMatch(/const stehtAn = felder\.some/);
    expect(quelle).toMatch(/pendingFelder/);
  });

  it('verdrahtet confirmed nicht mehr fest ohne Prüfung', () => {
    expect(quelle).toMatch(/const status = weichtAb \? 'not_submitted'/);
    expect(quelle).toMatch(/throw new GbpError\('google_validation'/);
  });

  it('sendet wiederholte Parameter einzeln, nicht kommaverbunden', () => {
    /* categories:batchGet erwartet names=a&names=b. Ein
       kommaverbundener String kam bei Google als EIN Kategoriename an —
       der Aufruf scheiterte, und die Oberfläche zeigte „Es ist ein
       Fehler aufgetreten". */
    expect(quelle).toMatch(/if \(Array\.isArray\(value\)\)/);
    expect(quelle).toMatch(/url\.searchParams\.append\(key/);
    /* names wird als Liste übergeben, nicht gejoint. */
    expect(quelle).not.toMatch(/names: names\.join/);
  });

  it('zeigt Prüfmeldungen dem Kunden, statt sie zu maskieren', () => {
    /* bad_request steht nicht in SAFE_MESSAGES. Alle Prüfmeldungen
       wurden dadurch zu „Es ist ein Fehler aufgetreten" — wahr, aber
       nutzlos. */
    expect(quelle).toMatch(/readonly anzeigbar: boolean/);
    expect(quelle).toMatch(/this\.anzeigbar\n?\s*\? this\.message/);
    expect(quelle).toMatch(/Google kennt die Kategorie.*\n?.*anzeigbar: true/);
  });

  it('macht nur Prüfmeldungen sichtbar, nicht jeden Fehler', () => {
    /* Interne Fehlertexte können Aufbau und Daten verraten. Der
       Standard bleibt die allgemeine Meldung. */
    expect(quelle).toMatch(/this\.anzeigbar = options\.anzeigbar === true/);
    expect(quelle).toMatch(/SAFE_MESSAGES\[this\.code\] \?\? GENERIC_MESSAGE/);
  });

  it('meldet einen lokalen Speicherfehler NICHT als Fehlschlag', () => {
    /* Der Fehler vom 30.09.: Fehlt die Spalte google_pending_mask,
       schlug das lokale Speichern fehl — NACHDEM Google die Änderung
       angenommen hatte. Der Kunde las „Nicht gespeichert" und hätte es
       erneut versucht, mit derselben Folge. */
    expect(quelle).toMatch(/lokalGespeichert: !error/);
    expect(quelle).toMatch(/Die Änderung ist bei Google angekommen/);
  });

  it('kommt ohne die Spalte google_pending_mask zurecht', () => {
    /* Solange die Migration nicht eingespielt ist, wird ohne sie
       gespeichert. Der übrige Stand ist wichtiger als die Maske. */
    expect(quelle).toMatch(/pending_mask_spalte_fehlt/);
    expect(quelle).toMatch(/if \(error && \/google_pending_mask\/\.test/);
  });

  it('prüft gesendete Kategorien gegen Google', () => {
    /* Eine manipulierte Kategorie darf nicht durchgehen. Geprüft wird
       über categories.batchGet — was Google nicht kennt, kommt dort
       nicht zurück. Eine Formatprüfung auf „gcid:" wäre leicht zu
       erfüllen und bewiese nichts. */
    expect(quelle).toMatch(/location\.category_rejected/);
    expect(quelle).toMatch(/\.batchGetCategories\(namen/);
  });

  it('winkt Kategorien nicht durch, wenn die Prüfung scheitert', () => {
    /* Sonst wäre eine unbekannte Kategorie genau dann erfolgreich,
       wenn Google gerade nicht antwortet. */
    const abschnitt = quelle.slice(
      quelle.indexOf('if (patch.categories)'),
      quelle.indexOf('Fuenfte Stufe'));
    expect(abschnitt).toMatch(/throw new GbpError\('google_api_error'/);
  });

  it('prüft moreHours-Arten gegen die Kategorie-Metadaten', () => {
    expect(quelle).toMatch(/location\.more_hours_rejected/);
    expect(quelle).toMatch(/const erlaubt = await erlaubteZeitarten/);
  });

  it('speichert pendingMask getrennt von diffMask', () => {
    expect(quelle).toMatch(/google_pending_mask: pendingFelder/);
  });

  it('protokolliert ohne Werte, nur Feldnamen', () => {
    /* Keine Tokens, keine Inhalte — nur welche Felder Google
       zurückgab. */
    expect(quelle).toMatch(/patchAntwortFelder: Object\.keys/);
  });
});
