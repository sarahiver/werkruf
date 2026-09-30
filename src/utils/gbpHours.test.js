/**
 * Öffnungszeiten: Validierung und Vergleich.
 *
 * Führt die echten Funktionen aus src/utils/gbpHours.js aus —
 * dieselben, die Oberfläche und Edge Function verwenden.
 */
import {
  TAGE, alsText, alsZeit, alsDatum, alsDatumstext,
  istDurchgehend, ueberMitternacht, ueberschneiden,
  pruefeRegulaer, pruefeSonderzeiten, pruefeWeitereZeiten,
  zeitfensterGeaendert, sonderzeitenGeaendert, weitereZeitenGeaendert,
  baueZeitAenderungen, pruefeAlles, hatFehler,
} from './gbpHours';

const fenster = (openDay, auf, closeDay, zu) => ({
  openDay, closeDay,
  openTime: alsZeit(auf), closeTime: alsZeit(zu),
});

const tag = (auf, zu) => fenster('MONDAY', auf, 'MONDAY', zu);

describe('Umwandlung', () => {
  it('kennt sieben Wochentage in der richtigen Reihenfolge', () => {
    expect(TAGE.map((t) => t.kurz)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
  });

  it('wandelt TimeOfDay in Text', () => {
    expect(alsText({ hours: 9, minutes: 0 })).toBe('09:00');
    expect(alsText({ hours: 17, minutes: 30 })).toBe('17:30');
  });

  it('behandelt fehlende Felder als null — wie Google', () => {
    /* Google liefert { hours: 9 } ohne minutes zurück. Ohne diese
       Gleichsetzung sähe jedes Laden wie eine Änderung aus. */
    expect(alsText({ hours: 9 })).toBe('09:00');
    expect(alsText({})).toBe('00:00');
    expect(alsText(null)).toBe('');
  });

  it('liest Text zurück in TimeOfDay', () => {
    expect(alsZeit('09:00')).toEqual({ hours: 9, minutes: 0 });
    expect(alsZeit('9:05')).toEqual({ hours: 9, minutes: 5 });
  });

  it('weist unmögliche Zeiten ab', () => {
    expect(alsZeit('24:00')).toBeNull();
    expect(alsZeit('12:60')).toBeNull();
    expect(alsZeit('Mittag')).toBeNull();
    expect(alsZeit('')).toBeNull();
  });

  it('wandelt Datumsangaben in beide Richtungen', () => {
    expect(alsDatum('2026-12-24')).toEqual({ year: 2026, month: 12, day: 24 });
    expect(alsDatumstext({ year: 2026, month: 12, day: 24 })).toBe('2026-12-24');
    expect(alsDatum('2026-13-01')).toBeNull();
  });
});

describe('Durchgehend geöffnet', () => {
  it('erkennt 00:00 bis 00:00 am selben Tag', () => {
    expect(istDurchgehend(tag('00:00', '00:00'))).toBe(true);
  });

  it('hält gewöhnliche Zeiten nicht dafür', () => {
    expect(istDurchgehend(tag('09:00', '17:00'))).toBe(false);
  });

  it('gilt nicht als über Mitternacht reichend', () => {
    expect(ueberMitternacht(tag('00:00', '00:00'))).toBe(false);
  });
});

describe('Über Mitternacht', () => {
  it('erkennt einen anderen Schließtag', () => {
    expect(ueberMitternacht(fenster('FRIDAY', '20:00', 'SATURDAY', '02:00'))).toBe(true);
  });

  it('erkennt eine Schließzeit vor der Öffnungszeit am selben Tag', () => {
    /* Sieht aus wie ein Tippfehler, ist bei Gastronomie und
       Notdiensten aber normal. */
    expect(ueberMitternacht(tag('22:00', '02:00'))).toBe(true);
  });

  it('hält gewöhnliche Zeiten nicht dafür', () => {
    expect(ueberMitternacht(tag('09:00', '17:00'))).toBe(false);
  });
});

describe('Überschneidungen', () => {
  it('erkennt zwei sich überlappende Fenster am selben Tag', () => {
    expect(ueberschneiden(tag('09:00', '13:00'), tag('12:00', '17:00'))).toBe(true);
  });

  it('lässt aneinandergrenzende Fenster durch', () => {
    /* Vormittag und Nachmittag mit Mittagspause — der häufigste Fall
       bei Handwerksbetrieben. */
    expect(ueberschneiden(tag('08:00', '12:00'), tag('13:00', '17:00'))).toBe(false);
  });

  it('lässt direkt anschließende Fenster durch', () => {
    expect(ueberschneiden(tag('08:00', '12:00'), tag('12:00', '17:00'))).toBe(false);
  });

  it('erkennt eine Überschneidung über Mitternacht hinweg', () => {
    const nacht = fenster('MONDAY', '22:00', 'TUESDAY', '03:00');
    const frueh = fenster('TUESDAY', '02:00', 'TUESDAY', '06:00');
    expect(ueberschneiden(nacht, frueh)).toBe(true);
  });

  it('erkennt eine Überschneidung über den Wochenwechsel', () => {
    /* Sonntagnacht in den Montagmorgen. Ohne Ringbetrachtung bliebe
       das unbemerkt — Google lehnt es trotzdem ab. */
    const sonntag = fenster('SUNDAY', '22:00', 'MONDAY', '04:00');
    const montag  = fenster('MONDAY', '03:00', 'MONDAY', '08:00');
    expect(ueberschneiden(sonntag, montag)).toBe(true);
  });

  it('trennt verschiedene Tage sauber', () => {
    expect(ueberschneiden(tag('09:00', '17:00'),
                          fenster('TUESDAY', '09:00', 'TUESDAY', '17:00'))).toBe(false);
  });
});

describe('Reguläre Öffnungszeiten', () => {
  it('nimmt gültige Zeiten an', () => {
    expect(pruefeRegulaer([
      tag('08:00', '12:00'),
      tag('13:00', '17:00'),
      fenster('TUESDAY', '08:00', 'TUESDAY', '16:00'),
    ])).toEqual([]);
  });

  it('nimmt durchgehend geöffnet an', () => {
    expect(pruefeRegulaer([tag('00:00', '00:00')])).toEqual([]);
  });

  it('nimmt über Mitternacht reichende Zeiten an', () => {
    expect(pruefeRegulaer([fenster('FRIDAY', '18:00', 'SATURDAY', '03:00')])).toEqual([]);
  });

  it('beanstandet ein Fenster ohne Dauer', () => {
    const f = pruefeRegulaer([tag('09:00', '09:00')]);
    expect(f).toHaveLength(1);
    expect(f[0].meldung).toMatch(/kein Zeitfenster/);
    /* Die Meldung muss den Ausweg nennen, nicht nur das Problem. */
    expect(f[0].meldung).toMatch(/00:00 bis 00:00/);
  });

  it('beanstandet fehlende Zeiten', () => {
    const f = pruefeRegulaer([{ openDay: 'MONDAY', closeDay: 'MONDAY' }]);
    expect(f[0].meldung).toMatch(/müssen gesetzt sein/);
  });

  it('beanstandet eine Überschneidung und nennt den Gegenpart', () => {
    const f = pruefeRegulaer([tag('09:00', '13:00'), tag('12:00', '17:00')]);
    expect(f).toHaveLength(1);
    expect(f[0].meldung).toMatch(/Überschneidet sich/);
    expect(f[0].meldung).toMatch(/Montag 09:00/);
  });

  it('kommt mit leerer Eingabe zurecht', () => {
    expect(pruefeRegulaer([])).toEqual([]);
    expect(pruefeRegulaer(null)).toEqual([]);
  });
});

describe('Sonderöffnungszeiten', () => {
  const heiligabend = {
    startDate: alsDatum('2026-12-24'),
    openTime: alsZeit('08:00'), closeTime: alsZeit('12:00'),
  };

  it('nimmt einen gültigen Eintrag an', () => {
    expect(pruefeSonderzeiten([heiligabend])).toEqual([]);
  });

  it('nimmt einen geschlossenen Tag ohne Uhrzeiten an', () => {
    expect(pruefeSonderzeiten([
      { startDate: alsDatum('2026-12-25'), closed: true },
    ])).toEqual([]);
  });

  it('beanstandet geschlossen MIT Uhrzeiten', () => {
    /* Google lehnt die Kombination ab. Eine Oberfläche, die beides
       gleichzeitig anbietet, führt geradewegs hinein. */
    const f = pruefeSonderzeiten([{
      startDate: alsDatum('2026-12-25'), closed: true,
      openTime: alsZeit('08:00'), closeTime: alsZeit('12:00'),
    }]);
    expect(f).toHaveLength(1);
    expect(f[0].feld).toBe('closed');
    expect(f[0].meldung).toMatch(/keine Uhrzeiten/);
  });

  it('beanstandet einen Eintrag ohne Datum', () => {
    expect(pruefeSonderzeiten([{ openTime: alsZeit('08:00') }])[0].feld).toBe('startDate');
  });

  it('beanstandet fehlende Uhrzeiten bei geöffnetem Tag', () => {
    const f = pruefeSonderzeiten([{ startDate: alsDatum('2026-12-24') }]);
    expect(f[0].meldung).toMatch(/als geschlossen markieren/);
  });

  it('beanstandet ein Enddatum vor dem Startdatum', () => {
    const f = pruefeSonderzeiten([{
      startDate: alsDatum('2026-12-24'), endDate: alsDatum('2026-12-23'),
      openTime: alsZeit('08:00'), closeTime: alsZeit('12:00'),
    }]);
    expect(f.some((x) => x.feld === 'endDate')).toBe(true);
  });

  it('beanstandet über Mitternacht ohne Folgetag als Enddatum', () => {
    const f = pruefeSonderzeiten([{
      startDate: alsDatum('2026-12-31'),
      openTime: alsZeit('20:00'), closeTime: alsZeit('02:00'),
    }]);
    expect(f[0].meldung).toMatch(/über Mitternacht/);
    expect(f[0].meldung).toMatch(/Folgetag/);
  });

  it('nimmt über Mitternacht MIT Folgetag an', () => {
    expect(pruefeSonderzeiten([{
      startDate: alsDatum('2026-12-31'), endDate: alsDatum('2027-01-01'),
      openTime: alsZeit('20:00'), closeTime: alsZeit('02:00'),
    }])).toEqual([]);
  });

  it('beanstandet zwei Einträge für denselben Tag', () => {
    const f = pruefeSonderzeiten([heiligabend, { ...heiligabend, closeTime: alsZeit('14:00') }]);
    expect(f.some((x) => x.meldung.includes('bereits einen Eintrag'))).toBe(true);
  });
});

describe('Weitere Zeiten', () => {
  const notdienst = {
    hoursTypeKey: 'ONLINE_SERVICE_HOURS',
    periods: [fenster('MONDAY', '00:00', 'MONDAY', '00:00')],
  };

  it('nimmt einen gültigen Eintrag an', () => {
    expect(pruefeWeitereZeiten([notdienst])).toEqual([]);
  });

  it('beanstandet eine fehlende Art', () => {
    expect(pruefeWeitereZeiten([{ periods: [] }])[0].feld).toBe('hoursTypeKey');
  });

  it('beanstandet eine für die Kategorie unzulässige Art', () => {
    /* Welche Arten möglich sind, sagt categories.batchGet mit
       view=FULL — kategorieabhängig, nicht fest einprogrammiert. */
    const f = pruefeWeitereZeiten([notdienst], ['DRIVE_THROUGH', 'PICKUP']);
    expect(f[0].meldung).toMatch(/nicht vorgesehen/);
  });

  it('nimmt eine zulässige Art an', () => {
    expect(pruefeWeitereZeiten([notdienst], ['ONLINE_SERVICE_HOURS'])).toEqual([]);
  });

  it('beanstandet eine doppelte Art', () => {
    const f = pruefeWeitereZeiten([notdienst, { ...notdienst }]);
    expect(f.some((x) => x.meldung.includes('doppelt'))).toBe(true);
  });

  it('prüft auch die Zeitfenster darin', () => {
    const f = pruefeWeitereZeiten([{
      hoursTypeKey: 'PICKUP',
      periods: [tag('09:00', '13:00'), tag('12:00', '17:00')],
    }]);
    expect(f.some((x) => x.meldung.includes('Überschneidet'))).toBe(true);
  });
});

describe('Vergleich', () => {
  it('erkennt keine Änderung bei gleichen Zeiten', () => {
    const a = [tag('09:00', '17:00')];
    expect(zeitfensterGeaendert(a, [tag('09:00', '17:00')])).toBe(false);
  });

  it('ist unempfindlich gegen die Reihenfolge', () => {
    const a = [tag('09:00', '12:00'), fenster('TUESDAY', '09:00', 'TUESDAY', '12:00')];
    const b = [fenster('TUESDAY', '09:00', 'TUESDAY', '12:00'), tag('09:00', '12:00')];
    expect(zeitfensterGeaendert(a, b)).toBe(false);
  });

  it('ist unempfindlich gegen fehlende minutes', () => {
    /* Google liefert { hours: 9 }, die Oberfläche erzeugt
       { hours: 9, minutes: 0 }. Ohne Normalisierung sähe jedes Laden
       wie eine Änderung aus — und schickte unnötig an Google. */
    const vonGoogle = [{ openDay: 'MONDAY', openTime: { hours: 9 },
                         closeDay: 'MONDAY', closeTime: { hours: 17 } }];
    expect(zeitfensterGeaendert(vonGoogle, [tag('09:00', '17:00')])).toBe(false);
  });

  it('erkennt eine geänderte Zeit', () => {
    expect(zeitfensterGeaendert([tag('09:00', '17:00')], [tag('09:00', '18:00')])).toBe(true);
  });

  it('erkennt ein zusätzliches Fenster', () => {
    expect(zeitfensterGeaendert([tag('09:00', '17:00')],
      [tag('09:00', '12:00'), tag('13:00', '17:00')])).toBe(true);
  });

  it('vergleicht Sonderzeiten samt geschlossen-Kennzeichen', () => {
    const a = [{ startDate: alsDatum('2026-12-25'), closed: true }];
    expect(sonderzeitenGeaendert(a, [{ startDate: alsDatum('2026-12-25'), closed: true }])).toBe(false);
    expect(sonderzeitenGeaendert(a, [{ startDate: alsDatum('2026-12-25'), closed: false }])).toBe(true);
  });

  it('vergleicht weitere Zeiten samt Art', () => {
    const a = [{ hoursTypeKey: 'PICKUP', periods: [tag('09:00', '17:00')] }];
    expect(weitereZeitenGeaendert(a, [{ hoursTypeKey: 'PICKUP', periods: [tag('09:00', '17:00')] }])).toBe(false);
    expect(weitereZeitenGeaendert(a, [{ hoursTypeKey: 'DELIVERY', periods: [tag('09:00', '17:00')] }])).toBe(true);
  });
});

describe('Änderungen aufbereiten', () => {
  const vorher = {
    regularHours: { periods: [tag('09:00', '17:00')] },
    specialHours: { specialHourPeriods: [{ startDate: alsDatum('2026-12-25'), closed: true }] },
    moreHours: [{ hoursTypeKey: 'PICKUP', periods: [tag('10:00', '16:00')] }],
  };

  it('sendet nichts, wenn sich nichts geändert hat', () => {
    expect(baueZeitAenderungen({
      vorher,
      regulaer: [tag('09:00', '17:00')],
      sonder: [{ startDate: alsDatum('2026-12-25'), closed: true }],
      weitere: [{ hoursTypeKey: 'PICKUP', periods: [tag('10:00', '16:00')] }],
    })).toEqual({});
  });

  it('sendet NUR den geänderten Block', () => {
    /* Der Kern der Anforderung: Bestehende Sonderöffnungszeiten dürfen
       beim Speichern der regulären Zeiten nicht verlorengehen. Sie
       stehen in einem anderen Feld und werden gar nicht erst
       mitgeschickt. */
    const a = baueZeitAenderungen({
      vorher,
      regulaer: [tag('08:00', '18:00')],
      sonder: [{ startDate: alsDatum('2026-12-25'), closed: true }],
      weitere: [{ hoursTypeKey: 'PICKUP', periods: [tag('10:00', '16:00')] }],
    });
    expect(Object.keys(a)).toEqual(['regularHours']);
    expect(a).not.toHaveProperty('specialHours');
    expect(a).not.toHaveProperty('moreHours');
  });

  it('schickt jeden geänderten Block als vollständiges Objekt', () => {
    /* Google ersetzt regularHours als Ganzes — ein Teilobjekt würde
       die übrigen Tage löschen. */
    const a = baueZeitAenderungen({
      vorher, regulaer: [tag('08:00', '12:00'), tag('13:00', '18:00')],
    });
    expect(a.regularHours.periods).toHaveLength(2);
  });

  it('lässt eine geleerte Liste durch', () => {
    /* „Alle Sonderzeiten entfernen" muss möglich sein. */
    const a = baueZeitAenderungen({ vorher, sonder: [] });
    expect(a.specialHours).toEqual({ specialHourPeriods: [] });
  });

  it('rührt Blöcke nicht an, die gar nicht übergeben wurden', () => {
    expect(baueZeitAenderungen({ vorher, regulaer: [tag('08:00', '18:00')] }))
      .toEqual({ regularHours: { periods: [tag('08:00', '18:00')] } });
  });
});

describe('Gesamtprüfung', () => {
  it('meldet keinen Fehler bei gültigen Angaben', () => {
    const befund = pruefeAlles({
      regulaer: [tag('09:00', '17:00')],
      sonder: [{ startDate: alsDatum('2026-12-25'), closed: true }],
      weitere: [],
    });
    expect(hatFehler(befund)).toBe(false);
  });

  it('bündelt Fehler aus allen drei Bereichen', () => {
    const befund = pruefeAlles({
      regulaer: [tag('09:00', '09:00')],
      sonder: [{ startDate: alsDatum('2026-12-25'), closed: true, openTime: alsZeit('08:00') }],
      weitere: [{ periods: [] }],
    });
    expect(befund.regulaer).toHaveLength(1);
    expect(befund.sonder).toHaveLength(1);
    expect(befund.weitere).toHaveLength(1);
    expect(hatFehler(befund)).toBe(true);
  });
});
