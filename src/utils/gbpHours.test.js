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

  it('lässt 24:00 zu', () => {
    /* Die Referenz: „Valid values are 00:00-24:00, where 24:00
       represents midnight at the end of the specified day field."
       Eine frühere Fassung wies es ab — damit liess sich ein
       Sondertag bis Mitternacht gar nicht eintragen. */
    expect(alsZeit('24:00')).toEqual({ hours: 24, minutes: 0 });
  });

  it('weist unmögliche Zeiten ab', () => {
    expect(alsZeit('24:30')).toBeNull();
    expect(alsZeit('25:00')).toBeNull();
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

describe('Sonder- und Feiertagszeiten', () => {
  const P = (start, ende, auf, zu, geschlossen) => ({
    startDate: alsDatum(start),
    ...(ende ? { endDate: alsDatum(ende) } : {}),
    ...(auf ? { openTime: alsZeit(auf) } : {}),
    ...(zu ? { closeTime: alsZeit(zu) } : {}),
    ...(geschlossen ? { closed: true } : {}),
  });

  describe('Googles eigene Beispiele aus der Referenz', () => {
    it('nimmt an: 23.11., 08:00–18:00', () => {
      expect(pruefeSonderzeiten([P('2015-11-23', null, '08:00', '18:00')])).toEqual([]);
    });

    it('nimmt an: mit gleichem Enddatum', () => {
      expect(pruefeSonderzeiten([P('2015-11-23', '2015-11-23', '08:00', '18:00')])).toEqual([]);
    });

    it('nimmt an: 23.→24.11., 13:00–11:59', () => {
      expect(pruefeSonderzeiten([P('2015-11-23', '2015-11-24', '13:00', '11:59')])).toEqual([]);
    });

    it('lehnt ab: 13:00–11:59 ohne Enddatum', () => {
      const f = pruefeSonderzeiten([P('2015-11-23', null, '13:00', '11:59')]);
      expect(f).toHaveLength(1);
      expect(f[0].meldung).toMatch(/Folgetag/);
    });

    it('lehnt ab: 23.→24.11., 13:00–12:00', () => {
      /* 12:00 ist eine Minute zu spät — Google lässt bis 11:59. */
      expect(pruefeSonderzeiten([P('2015-11-23', '2015-11-24', '13:00', '12:00')])).toHaveLength(1);
    });

    it('lehnt ab: 23.→25.11. (mehr als ein Tag)', () => {
      const f = pruefeSonderzeiten([P('2015-11-23', '2015-11-25', '08:00', '18:00')]);
      expect(f[0].meldung).toMatch(/höchstens bis zum Folgetag/);
    });
  });

  describe('Feiertage', () => {
    it('nimmt einen geschlossenen Feiertag an', () => {
      expect(pruefeSonderzeiten([P('2026-12-25', null, null, null, true)])).toEqual([]);
    });

    it('nimmt einen Feiertag mit individuellen Zeiten an', () => {
      expect(pruefeSonderzeiten([P('2026-12-24', null, '08:00', '12:00')])).toEqual([]);
    });

    it('nimmt MEHRERE Zeitfenster am selben Tag an', () => {
      /* Googles Hilfe: „To add multiple sets of hours for the date".
         Eine frühere Fassung lehnte doppelte Daten pauschal ab und
         machte geteilte Feiertagszeiten damit unmöglich. */
      expect(pruefeSonderzeiten([
        P('2026-12-26', null, '10:00', '16:00'),
        P('2026-12-26', null, '17:00', '18:00'),
      ])).toEqual([]);
    });

    it('nimmt mehrere verschiedene Sondertage an', () => {
      expect(pruefeSonderzeiten([
        P('2026-12-24', null, '08:00', '12:00'),
        P('2026-12-25', null, null, null, true),
        P('2026-12-26', null, null, null, true),
        P('2026-10-03', null, null, null, true),
      ])).toEqual([]);
    });

    it('nimmt einen Sondertag bis 24:00 an', () => {
      expect(pruefeSonderzeiten([P('2026-12-31', null, '18:00', '24:00')])).toEqual([]);
    });
  });

  describe('Widersprüche', () => {
    it('lehnt geschlossen MIT Uhrzeiten ab', () => {
      const f = pruefeSonderzeiten([{
        startDate: alsDatum('2026-12-25'), closed: true,
        openTime: alsZeit('08:00'), closeTime: alsZeit('12:00'),
      }]);
      expect(f).toHaveLength(1);
      expect(f[0].feld).toBe('closed');
    });

    it('lehnt denselben Tag einmal geschlossen und einmal mit Zeiten ab', () => {
      const f = pruefeSonderzeiten([
        P('2026-12-25', null, null, null, true),
        P('2026-12-25', null, '10:00', '16:00'),
      ]);
      expect(f.some((x) => x.meldung.includes('geschlossen und einmal mit Zeiten'))).toBe(true);
    });

    it('lehnt denselben Tag zweimal geschlossen ab', () => {
      const f = pruefeSonderzeiten([
        P('2026-12-25', null, null, null, true),
        P('2026-12-25', null, null, null, true),
      ]);
      expect(f.some((x) => x.meldung.includes('mehrfach als geschlossen'))).toBe(true);
    });

    it('lehnt sich überschneidende Zeitfenster am selben Tag ab', () => {
      const f = pruefeSonderzeiten([
        P('2026-12-26', null, '10:00', '16:00'),
        P('2026-12-26', null, '15:00', '18:00'),
      ]);
      expect(f.some((x) => x.meldung.includes('Überschneidet sich'))).toBe(true);
    });

    it('lehnt ein Enddatum vor dem Startdatum ab', () => {
      const f = pruefeSonderzeiten([P('2026-12-24', '2026-12-23', '08:00', '12:00')]);
      expect(f[0].feld).toBe('endDate');
    });

    it('lehnt einen Eintrag ohne Datum ab', () => {
      expect(pruefeSonderzeiten([{ openTime: alsZeit('08:00') }])[0].feld).toBe('startDate');
    });

    it('lehnt fehlende Uhrzeiten bei geöffnetem Tag ab', () => {
      const f = pruefeSonderzeiten([{ startDate: alsDatum('2026-12-24') }]);
      expect(f[0].meldung).toMatch(/als geschlossen markieren/);
    });
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

  it('übergeht einen völlig leeren Eintrag', () => {
    /* Google liefert bei manchen Profilen Platzhalter zurück. Ein
       Fehler dafür wäre nichts, was der Kunde beheben könnte. */
    expect(pruefeWeitereZeiten([{}])).toEqual([]);
    expect(pruefeWeitereZeiten([null])).toEqual([]);
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
