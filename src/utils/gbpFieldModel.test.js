/**
 * Feldmodell der Google-Profilverwaltung.
 *
 * Prüft die echten Funktionen aus src/utils/gbpFieldModel.js —
 * dieselben, aus denen sowohl die Oberfläche als auch die Edge Function
 * ihre Regeln beziehen.
 */
import {
  BEREICHE, FELDER, SCHREIBART, VORAUSSETZUNG,
  schreibbarePfade, nurGanzeObjekte, unterpfadErlaubt,
  feldNachPfad, felderImBereich,
  istBearbeitbar, bereichFuerStandort, bereicheMitStatus, baueAenderungen,
} from './gbpFieldModel';

/** Standort mit allem erlaubt. */
const offen = (metadata = {}) => ({
  id: 'loc-1',
  google_profile: {
    phoneNumbers: { primaryPhone: '+49 40 1', additionalPhones: ['+49 40 2'] },
    regularHours: { periods: [] },
    metadata: { hasVoiceOfMerchant: true, canModifyServiceList: true, ...metadata },
  },
});

describe('Modellaufbau', () => {
  it('ordnet jedes Feld einem bekannten Bereich zu', () => {
    const keys = BEREICHE.map((b) => b.key);
    FELDER.forEach((f) => expect(keys).toContain(f.bereich));
  });

  it('vergibt jeden Pfad nur einmal', () => {
    const pfade = FELDER.map((f) => f.pfad);
    expect(new Set(pfade).size).toBe(pfade.length);
  });

  it('gibt jedem Feld eine gültige Schreibart', () => {
    const arten = Object.values(SCHREIBART);
    FELDER.forEach((f) => expect(arten).toContain(f.art));
  });

  it('begründet jedes Feld, das nur als Ganzes geht', () => {
    FELDER.filter((f) => f.art === SCHREIBART.GANZ)
      .forEach((f) => expect(f.ganzGrund).toBeTruthy());
  });

  it('begründet jedes gesperrte und jedes nur lesbare Feld', () => {
    FELDER.filter((f) => f.art === SCHREIBART.LESEN)
      .forEach((f) => expect(f.lesenGrund).toBeTruthy());
    FELDER.filter((f) => f.art === SCHREIBART.GESPERRT)
      .forEach((f) => expect(f.gesperrtGrund).toBeTruthy());
  });
});

describe('Abgeleitete Listen für den Server', () => {
  it('führt phoneNumbers und categories als nur-ganz', () => {
    /* Belegt aus dem Discovery-Dokument: Google verlangt beide
       Unterfelder gemeinsam. Ein Unterpfad wäre ungültig. */
    expect(nurGanzeObjekte()).toEqual(expect.arrayContaining(['phoneNumbers', 'categories']));
  });

  it('erlaubt profile.description als Unterpfad', () => {
    /* Profile hat nur dieses eine Unterfeld — der Punktpfad ist
       gleichbedeutend mit dem ganzen Objekt. */
    expect(unterpfadErlaubt()).toContain('profile.description');
  });

  it('führt moreHours jetzt als schreibbar', () => {
    /* Bis Paket C stand es als „noch nicht umgesetzt" drin. Jetzt gibt
       es eine Eingabemaske — die Verfügbarkeit hängt an der
       Kategorie, nicht mehr am Stand der Umsetzung. */
    expect(schreibbarePfade()).toContain('moreHours');
    expect(nurGanzeObjekte()).toContain('moreHours');
  });

  it('nimmt gesperrte und nur lesbare Felder aus den schreibbaren heraus', () => {
    const schreibbar = schreibbarePfade();
    expect(schreibbar).not.toContain('title');        // Produktentscheidung
    expect(schreibbar).not.toContain('name');         // von Google vergeben
    expect(schreibbar).not.toContain('languageCode'); // unveränderlich
    expect(schreibbar).not.toContain('metadata');
  });

  it('führt phoneNumbers NICHT als Unterpfad', () => {
    /* Genau dieser Fehler stand am 29.09. im Server. */
    expect(unterpfadErlaubt()).not.toContain('phoneNumbers.primaryPhone');
    expect(unterpfadErlaubt()).not.toContain('categories.primaryCategory');
  });
});

describe('Unternehmensname bleibt gesperrt', () => {
  it('lässt title nicht bearbeiten, mit erkennbarem Grund', () => {
    const p = istBearbeitbar('title', offen());
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('nicht_in_werkruf');
    expect(p.grund).toMatch(/Google-Unternehmensprofil/);
  });

  it('unterscheidet Produktentscheidung von API-Schranke', () => {
    /* Für den Kunden zwei verschiedene Auskünfte: "Google gibt das
       nicht frei" und "wir machen das absichtlich nicht". */
    expect(istBearbeitbar('title', offen()).code).toBe('nicht_in_werkruf');
    expect(istBearbeitbar('name', offen()).code).toBe('nur_lesbar');
  });
});

describe('Betriebsspezifische Prüfung', () => {
  it('erlaubt ein Feld bei vollständigen Rechten', () => {
    expect(istBearbeitbar('websiteUri', offen()).erlaubt).toBe(true);
  });

  it('sperrt alles ohne Voice of Merchant', () => {
    const p = istBearbeitbar('websiteUri', offen({ hasVoiceOfMerchant: false }));
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('keine_voice_of_merchant');
    /* Die Begründung muss den Kern nennen: übermittelt, aber nicht
       veröffentlicht. */
    expect(p.grund).toMatch(/nicht veröffentlicht/i);
  });

  it('sperrt Leistungen, wenn Google es für diesen Betrieb untersagt', () => {
    const p = istBearbeitbar('serviceItems', offen({ canModifyServiceList: false }));
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('voraussetzung_fehlt');
    expect(VORAUSSETZUNG.SERVICE_LIST).toBe('canModifyServiceList');
  });

  it('sperrt Sonderöffnungszeiten ohne reguläre Öffnungszeiten', () => {
    const ohneRegular = offen();
    delete ohneRegular.google_profile.regularHours;
    const p = istBearbeitbar('specialHours', ohneRegular);
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('abhaengigkeit_fehlt');
    expect(p.grund).toMatch(/Öffnungszeiten/);
  });

  it('erlaubt Sonderöffnungszeiten, sobald reguläre gesetzt sind', () => {
    expect(istBearbeitbar('specialHours', offen()).erlaubt).toBe(true);
  });

  it('behandelt fehlende Metadaten nicht als Sperre', () => {
    /* Ein Standort, der noch nie synchronisiert wurde, hat keine
       metadata. Alles zu sperren wäre falsch — Google sagt nichts
       Gegenteiliges. */
    expect(istBearbeitbar('websiteUri', { id: 'x', google_profile: {} }).erlaubt).toBe(true);
    expect(istBearbeitbar('websiteUri', {}).erlaubt).toBe(true);
    expect(istBearbeitbar('websiteUri', null).erlaubt).toBe(true);
  });

  it('weist ein unbekanntes Feld ab', () => {
    const p = istBearbeitbar('gibtEsNicht', offen());
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('unbekannt');
  });
});

describe('Kategorieabhängige Verfügbarkeit (Paket C)', () => {
  const MIT_TYPEN = { moreHoursTypes: [{ hoursTypeId: 'PICKUP', displayName: 'Abholung' }] };
  const OHNE_TYPEN = { moreHoursTypes: [] };
  const GESCHEITERT = { abrufErfolgreich: false };

  it('sperrt nicht, solange die Metadaten noch fehlen', () => {
    /* Ohne Metadaten sähe sonst jedes Feld gesperrt aus, solange sie
       laden. */
    expect(istBearbeitbar('moreHours', offen()).erlaubt).toBe(true);
    expect(istBearbeitbar('moreHours', offen(), null).erlaubt).toBe(true);
  });

  it('gibt moreHours frei, wenn Google Typen liefert', () => {
    expect(istBearbeitbar('moreHours', offen(), MIT_TYPEN).erlaubt).toBe(true);
  });

  it('unterscheidet „keine Typen" von „gesperrt"', () => {
    const p = istBearbeitbar('moreHours', offen(), OHNE_TYPEN);
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('fuer_kategorie_nicht_verfuegbar');
    expect(p.grund).toMatch(/bietet Google keine weiteren Öffnungszeiten/);
  });

  it('unterscheidet „Abruf gescheitert" von „keine Typen"', () => {
    /* Der wichtigste Unterschied: Google sagt nichts, oder wir konnten
       nicht nachsehen. Beides als „keine Optionen" zu zeigen wäre
       falsch. */
    const p = istBearbeitbar('moreHours', offen(), GESCHEITERT);
    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('metadaten_fehlen');
    expect(p.grund).toMatch(/nicht von Google geladen/);
    expect(p.code).not.toBe('fuer_kategorie_nicht_verfuegbar');
  });

  it('kennt vier unterscheidbare Zustände', () => {
    /* bearbeitbar, nur lesbar, für diesen Betrieb nicht verfügbar,
       in WERKRUF nicht vorgesehen. */
    expect(istBearbeitbar('websiteUri', offen()).code).toBeNull();
    expect(istBearbeitbar('name', offen()).code).toBe('nur_lesbar');
    expect(istBearbeitbar('moreHours', offen(), OHNE_TYPEN).code)
      .toBe('fuer_kategorie_nicht_verfuegbar');
    expect(istBearbeitbar('title', offen()).code).toBe('nicht_in_werkruf');
  });

  it('gibt Metadaten an die Bereichsübersicht weiter', () => {
    const mit = bereichFuerStandort('oeffnungszeiten', offen(), MIT_TYPEN);
    const ohne = bereichFuerStandort('oeffnungszeiten', offen(), OHNE_TYPEN);

    expect(mit.find((f) => f.pfad === 'moreHours').erlaubt).toBe(true);
    expect(ohne.find((f) => f.pfad === 'moreHours').erlaubt).toBe(false);
  });

  it('zählt Bereiche je nach Metadaten unterschiedlich', () => {
    const mit = bereicheMitStatus(offen(), MIT_TYPEN).find((b) => b.key === 'oeffnungszeiten');
    const ohne = bereicheMitStatus(offen(), OHNE_TYPEN).find((b) => b.key === 'oeffnungszeiten');

    expect(mit.felderBearbeitbar).toBeGreaterThan(ohne.felderBearbeitbar);
  });

  it('verwirft moreHours beim Aufbereiten, wenn keine Typen verfügbar sind', () => {
    const { nutzlast, verworfen } = baueAenderungen(
      [{ pfad: 'moreHours', wert: [{ hoursTypeKey: 'PICKUP' }] }],
      offen(), OHNE_TYPEN,
    );
    expect(nutzlast).toEqual({});
    expect(verworfen[0].pfad).toBe('moreHours');
  });

  it('nimmt moreHours an, wenn Typen verfügbar sind', () => {
    const { nutzlast } = baueAenderungen(
      [{ pfad: 'moreHours', wert: [{ hoursTypeKey: 'PICKUP' }] }],
      offen(), MIT_TYPEN,
    );
    expect(nutzlast.moreHours).toEqual([{ hoursTypeKey: 'PICKUP' }]);
  });
});

describe('Bereiche für die Navigation', () => {
  it('zählt bearbeitbare Felder je Bereich', () => {
    const stamm = bereicheMitStatus(offen()).find((b) => b.key === 'stammdaten');
    expect(stamm.felderGesamt).toBeGreaterThan(0);
    expect(stamm.felderBearbeitbar).toBeLessThan(stamm.felderGesamt); // title, name, languageCode
  });

  it('zeigt ohne Voice of Merchant null bearbeitbare Felder', () => {
    bereicheMitStatus(offen({ hasVoiceOfMerchant: false }))
      .filter((b) => b.ausFeldmodell)
      .forEach((b) => expect(b.felderBearbeitbar).toBe(0));
  });

  it('kennzeichnet Bereiche ohne eigene Felder', () => {
    const bewertungen = bereicheMitStatus(offen()).find((b) => b.key === 'bewertungen');
    expect(bewertungen.ausFeldmodell).toBe(false);
  });

  it('liefert je Feld Zustand und Begründung', () => {
    const felder = bereichFuerStandort('stammdaten', offen());
    const titel = felder.find((f) => f.pfad === 'title');
    expect(titel.erlaubt).toBe(false);
    expect(titel.grund).toBeTruthy();
    expect(titel.label).toBe('Unternehmensname');
  });
});

describe('Änderungen aufbereiten', () => {
  it('führt ganze Objekte mit dem Bestand zusammen', () => {
    /* Der Datenverlust vom 29.09.: Beim Ändern der Hauptnummer gingen
       die additionalPhones verloren. */
    const { nutzlast } = baueAenderungen(
      [{ pfad: 'phoneNumbers', wert: { primaryPhone: '+49 40 999' } }],
      offen(),
    );
    expect(nutzlast.phoneNumbers.primaryPhone).toBe('+49 40 999');
    expect(nutzlast.phoneNumbers.additionalPhones).toEqual(['+49 40 2']);
  });

  it('übernimmt Unterpfade unverändert', () => {
    const { nutzlast } = baueAenderungen(
      [{ pfad: 'profile.description', wert: 'Neu' }], offen());
    expect(nutzlast).toEqual({ 'profile.description': 'Neu' });
  });

  it('verwirft gesperrte Felder mit Begründung', () => {
    const { nutzlast, verworfen } = baueAenderungen(
      [{ pfad: 'title', wert: 'Neuer Name' },
       { pfad: 'websiteUri', wert: 'https://x.example' }],
      offen(),
    );
    expect(Object.keys(nutzlast)).toEqual(['websiteUri']);
    expect(verworfen).toHaveLength(1);
    expect(verworfen[0].pfad).toBe('title');
    expect(verworfen[0].grund).toBeTruthy();
  });

  it('verwirft alles ohne Voice of Merchant', () => {
    const { nutzlast, verworfen } = baueAenderungen(
      [{ pfad: 'websiteUri', wert: 'https://x.example' }],
      offen({ hasVoiceOfMerchant: false }),
    );
    expect(nutzlast).toEqual({});
    expect(verworfen).toHaveLength(1);
  });

  it('lässt null durch, damit Felder geleert werden können', () => {
    const { nutzlast } = baueAenderungen(
      [{ pfad: 'websiteUri', wert: null }], offen());
    expect(nutzlast).toEqual({ websiteUri: null });
  });
});

describe('Hilfsfunktionen', () => {
  it('findet ein Feld über seinen Pfad', () => {
    expect(feldNachPfad('websiteUri').label).toBe('Website');
    expect(feldNachPfad('gibtEsNicht')).toBeNull();
  });

  it('filtert Felder nach Bereich', () => {
    felderImBereich('oeffnungszeiten')
      .forEach((f) => expect(f.bereich).toBe('oeffnungszeiten'));
    expect(felderImBereich('oeffnungszeiten').map((f) => f.pfad))
      .toEqual(expect.arrayContaining(['regularHours', 'specialHours', 'moreHours']));
  });
});
