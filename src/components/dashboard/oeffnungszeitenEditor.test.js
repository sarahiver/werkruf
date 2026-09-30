/**
 * Öffnungszeiten-Editor.
 *
 * Der Schwerpunkt liegt auf der Anforderung, dass beim Speichern
 * nichts verlorengeht: Google ersetzt regularHours, specialHours und
 * moreHours jeweils als Ganzes, also darf nur der geänderte Block
 * überhaupt mitgeschickt werden.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

import { alsZeit, alsDatum, TAGE } from '../../utils/gbpHours';

const OeffnungszeitenEditor = require('./OeffnungszeitenEditor').default;

const fenster = (openDay, auf, closeDay, zu) => ({
  openDay, closeDay, openTime: alsZeit(auf), closeTime: alsZeit(zu),
});

const standort = (profil = {}, metadata = {}) => ({
  id: 'loc-1',
  google_profile: {
    regularHours: {
      periods: [
        fenster('MONDAY', '08:00', 'MONDAY', '17:00'),
        fenster('TUESDAY', '08:00', 'TUESDAY', '17:00'),
      ],
    },
    specialHours: {
      specialHourPeriods: [{ startDate: alsDatum('2026-12-25'), closed: true }],
    },
    moreHours: [{ hoursTypeKey: 'PICKUP', periods: [fenster('MONDAY', '10:00', 'MONDAY', '16:00')] }],
    metadata: { hasVoiceOfMerchant: true, ...metadata },
    ...profil,
  },
});

const tippe = (feld, wert) => fireEvent.change(feld, { target: { value: wert } });
const klicke = async (knopf) => { await act(async () => { fireEvent.click(knopf); }); };

const speichern = () => screen.getByRole('button', { name: /Bei Google speichern|Wird übermittelt/i });

const onSave = jest.fn();
beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue({ confirmed: true, updateMask: 'regularHours' });
});

describe('Anzeige', () => {
  it('zeigt alle sieben Wochentage', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
      .forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
  });

  it('füllt bestehende Zeiten vor', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByLabelText('Montag Öffnung 1')).toHaveValue('08:00');
    expect(screen.getByLabelText('Montag Schließung 1')).toHaveValue('17:00');
  });

  it('kennzeichnet Tage ohne Zeiten als geschlossen', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    // Mi bis So haben keine Zeiten.
    expect(screen.getAllByText('Geschlossen').length).toBeGreaterThanOrEqual(5);
  });

  it('zeigt durchgehend geöffnet als solches an', () => {
    const l = standort({ regularHours: { periods: [fenster('MONDAY', '00:00', 'MONDAY', '00:00')] } });
    render(<OeffnungszeitenEditor location={l} onSave={onSave} />);
    expect(screen.getByText('Durchgehend geöffnet')).toBeInTheDocument();
  });

  it('zeigt bestehende Sonderöffnungszeiten', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByLabelText('Sondertag 1 Datum')).toHaveValue('2026-12-25');
  });

  it('sperrt den Knopf, solange nichts geändert wurde', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    expect(speichern()).toBeDisabled();
  });
});

describe('Bearbeiten', () => {
  it('überträgt eine geänderte Zeit', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];
    expect(aenderungen.regularHours.periods[0].closeTime).toEqual({ hours: 18, minutes: 0 });
  });

  it('setzt bei über Mitternacht automatisch den Folgetag', async () => {
    /* Dem Kunden zu überlassen, den Schließtag umzustellen, wäre eine
       Fehlerquelle, die er nicht durchschauen kann. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '02:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];
    expect(aenderungen.regularHours.periods[0].closeDay).toBe('TUESDAY');
  });

  it('fügt ein zweites Zeitfenster am selben Tag hinzu', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '12:00');
    await klicke(screen.getAllByRole('button', { name: /Fenster/ })[0]);

    expect(screen.getByLabelText('Montag Öffnung 2')).toBeInTheDocument();
  });

  it('entfernt ein Zeitfenster', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Montag Zeitfenster 1 entfernen'));

    expect(screen.queryByLabelText('Montag Öffnung 1')).not.toBeInTheDocument();
  });
});

describe('Nichts geht verloren', () => {
  it('schickt beim Ändern der regulären Zeiten KEINE specialHours mit', async () => {
    /* Der Kern der Anforderung. Google ersetzt specialHours als
       Ganzes — würde das Feld mitgeschickt, hinge alles daran, dass
       der Editor es vollständig gefüllt hat. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];

    expect(Object.keys(aenderungen)).toEqual(['regularHours']);
    expect(aenderungen).not.toHaveProperty('specialHours');
    expect(aenderungen).not.toHaveProperty('moreHours');
  });

  it('schickt beim Ändern der Sonderzeiten KEINE regularHours mit', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Sondertag 1 Datum'), '2026-12-26');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];

    expect(Object.keys(aenderungen)).toEqual(['specialHours']);
  });

  it('löst ohne Änderung gar keinen Schreibzugriff aus', async () => {
    /* Der Knopf ist gesperrt — aber auch ein erzwungener Aufruf darf
       nichts senden, denn baueZeitAenderungen liefert ein leeres
       Objekt. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    expect(speichern()).toBeDisabled();
    await klicke(speichern());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sendet nach dem Hin- und Zurückändern eines Werts nichts', async () => {
    /* Der Vergleich arbeitet auf Werten, nicht auf „wurde angefasst". */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    expect(speichern()).not.toBeDisabled();

    tippe(screen.getByLabelText('Montag Schließung 1'), '17:00');
    expect(speichern()).toBeDisabled();
  });

  it('überträgt die vollständige Woche, nicht nur den geänderten Tag', async () => {
    /* regularHours nimmt Google nur als Ganzes — ein Teilobjekt
       löschte die übrigen Tage. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];
    expect(aenderungen.regularHours.periods).toHaveLength(2);
    expect(aenderungen.regularHours.periods[1].openDay).toBe('TUESDAY');
  });
});

describe('Validierung vor dem Senden', () => {
  it('beanstandet eine Überschneidung und sperrt den Knopf', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '12:00');
    await klicke(screen.getAllByRole('button', { name: /Fenster/ })[0]);
    tippe(screen.getByLabelText('Montag Öffnung 2'), '11:00');

    expect(screen.getByText(/Google würde sie ablehnen/)).toBeInTheDocument();
    expect(speichern()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('beanstandet ein Zeitfenster ohne Dauer', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '08:00');

    expect(screen.getByText(/kein Zeitfenster/)).toBeInTheDocument();
    expect(speichern()).toBeDisabled();
  });

  it('nimmt über Mitternacht reichende Zeiten an', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '02:00');

    expect(screen.queryByText(/Google würde sie ablehnen/)).not.toBeInTheDocument();
    expect(speichern()).not.toBeDisabled();
  });
});

describe('Kein Feststecken', () => {
  const ganztags = () => standort({
    regularHours: { periods: TAGE.map((t) => fenster(t.key, '00:00', t.key, '00:00')) },
  });

  it('bietet bei durchgehend geöffnet einen Weg zu festen Zeiten', () => {
    /* Vorher war der Tag eine Sackgasse: keine Eingabefelder, kein Weg
       zurück, nur ein X, das wie „löschen" aussah. */
    render(<OeffnungszeitenEditor location={ganztags()} onSave={onSave} />);
    expect(screen.getByLabelText('Montag auf feste Zeiten umstellen')).toBeInTheDocument();
  });

  it('stellt von durchgehend auf feste Zeiten um', async () => {
    render(<OeffnungszeitenEditor location={ganztags()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Montag auf feste Zeiten umstellen'));

    expect(screen.getByLabelText('Montag Öffnung 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Montag Öffnung 1')).not.toHaveValue('00:00');
  });

  it('nennt das X bei durchgehend geöffnet beim Namen', () => {
    /* „Montag schließen" statt „Zeitfenster entfernen" — es tut etwas
       anderes als bei festen Zeiten. */
    render(<OeffnungszeitenEditor location={ganztags()} onSave={onSave} />);
    expect(screen.getByLabelText('Montag schließen')).toBeInTheDocument();
  });

  it('kommt von leeren Öffnungszeiten aus zu festen Zeiten', async () => {
    /* Der Ausgangszustand eines frisch verbundenen Betriebs:
       regularHours ist null. */
    const leer = { id: 'loc-1', google_profile: { metadata: { hasVoiceOfMerchant: true } } };
    render(<OeffnungszeitenEditor location={leer} onSave={onSave} />);

    await klicke(screen.getAllByRole('button', { name: /Zeiten/ })[0]);
    expect(screen.getByLabelText('Montag Öffnung 1')).toBeInTheDocument();
  });
});

describe('Aktionsleiste', () => {
  it('sagt, warum nicht gespeichert werden kann', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByText('Keine Änderungen.')).toBeInTheDocument();
  });

  it('nennt die zu übermittelnden Blöcke verständlich', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');

    expect(screen.getByText(/Zu übermitteln: Reguläre Öffnungszeiten/)).toBeInTheDocument();
    /* Nicht „regularHours" — das ist ein Feldname, kein Deutsch. */
    expect(screen.queryByText(/regularHours/)).not.toBeInTheDocument();
  });

  it('begründet die Sperre bei ungültigen Angaben', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '08:00');

    expect(screen.getByText(/Google würde sie ablehnen/)).toBeInTheDocument();
    expect(speichern()).toBeDisabled();
  });
});

describe('Weitere Zeiten blockieren nicht', () => {
  it('lässt sich speichern, obwohl moreHours unvollständig ist', async () => {
    /* Der Fehler vom 30.09.: Ein Eintrag ohne hoursTypeKey im
       Google-Profil sperrte den Speicherknopf — mit einer Meldung über
       „markierte Angaben", obwohl nichts markiert war und nichts
       markiert werden konnte. Für „Weitere Zeiten" gibt es bis Paket C
       keine Eingabemaske. */
    const l = standort({ moreHours: [{}] });
    render(<OeffnungszeitenEditor location={l} onSave={onSave} />);

    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    expect(speichern()).not.toBeDisabled();

    await klicke(speichern());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('lässt sich speichern, obwohl moreHours einen kaputten Eintrag hat', () => {
    const l = standort({ moreHours: [{ periods: [{ openDay: 'MONDAY' }] }] });
    render(<OeffnungszeitenEditor location={l} onSave={onSave} />);

    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    expect(speichern()).not.toBeDisabled();
  });

  it('überträgt moreHours dabei nicht', async () => {
    const l = standort({ moreHours: [{}] });
    render(<OeffnungszeitenEditor location={l} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).not.toHaveProperty('moreHours');
  });

  it('meldet nur Fehler, die auch sichtbar sind', () => {
    /* Der eigentliche Konstruktionsfehler: eine Sperrmeldung über
       „markierte Angaben", ohne dass etwas markiert ist. */
    const l = standort({ moreHours: [{}] });
    render(<OeffnungszeitenEditor location={l} onSave={onSave} />);

    expect(screen.queryByText(/Google würde sie ablehnen/)).not.toBeInTheDocument();
    expect(screen.getByText('Keine Änderungen.')).toBeInTheDocument();
  });
});

describe('Sonder- und Feiertagszeiten', () => {
  it('nennt den Bereich verständlich und erklärt ihn', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByText(/Sonder- & Feiertagszeiten/)).toBeInTheDocument();
    expect(screen.getByText(/Feiertage, Betriebsferien oder einzelne Tage/)).toBeInTheDocument();
  });

  it('lässt ein beliebiges künftiges Datum wählen', () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    const feld = screen.getByLabelText('Sondertag 1 Datum');

    expect(feld).toHaveAttribute('type', 'date');
    /* Keine Einschränkung auf bestimmte Tage — Feiertage liegen im
       ganzen Jahr. */
    expect(feld).not.toHaveAttribute('min');
    expect(feld).not.toHaveAttribute('max');

    tippe(feld, '2027-10-03');
    expect(feld).toHaveValue('2027-10-03');
  });

  it('schaltet einen Feiertag auf individuelle Zeiten', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));

    expect(screen.getByLabelText('Sondertag 1 Öffnung 1')).toBeInTheDocument();
    expect(screen.queryByText('Ganztägig geschlossen')).not.toBeInTheDocument();
  });

  it('entfernt beim Umschalten auf geschlossen die Uhrzeiten', async () => {
    /* Google lehnt geschlossen MIT Uhrzeiten ab — sie nur auszublenden
       reichte nicht. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));
    tippe(screen.getByLabelText('Sondertag 1 Öffnung 1'), '09:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const offen = onSave.mock.calls[0][1].specialHours.specialHourPeriods[0];
    expect(offen.closed).toBeFalsy();

    onSave.mockClear();
    await klicke(screen.getByRole('button', { name: 'Geschlossen' }));
    expect(screen.queryByLabelText('Sondertag 1 Öffnung 1')).not.toBeInTheDocument();
    expect(screen.getByText('Ganztägig geschlossen')).toBeInTheDocument();
  });

  it('erlaubt MEHRERE Zeitfenster an einem Sondertag', async () => {
    /* Googles Hilfe beschreibt das ausdrücklich — etwa 10:00–16:00
       und 17:00–18:00 am 26. Dezember. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));
    await klicke(screen.getByLabelText('Sondertag 1 Zeitfenster hinzufügen'));

    expect(screen.getByLabelText('Sondertag 1 Öffnung 2')).toBeInTheDocument();
  });

  it('überträgt beide Zeitfenster eines Tages', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));
    tippe(screen.getByLabelText('Sondertag 1 Öffnung 1'), '10:00');
    tippe(screen.getByLabelText('Sondertag 1 Schließung 1'), '16:00');
    await klicke(screen.getByLabelText('Sondertag 1 Zeitfenster hinzufügen'));
    tippe(screen.getByLabelText('Sondertag 1 Öffnung 2'), '17:00');
    tippe(screen.getByLabelText('Sondertag 1 Schließung 2'), '18:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const perioden = onSave.mock.calls[0][1].specialHours.specialHourPeriods;
    expect(perioden).toHaveLength(2);
    expect(perioden.every((p) => p.startDate.day === 25)).toBe(true);
  });

  it('beanstandet sich überschneidende Zeitfenster am selben Tag', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));
    tippe(screen.getByLabelText('Sondertag 1 Schließung 1'), '16:00');
    await klicke(screen.getByLabelText('Sondertag 1 Zeitfenster hinzufügen'));
    tippe(screen.getByLabelText('Sondertag 1 Öffnung 2'), '15:00');

    expect(screen.getByText(/Google würde sie ablehnen/)).toBeInTheDocument();
    expect(speichern()).toBeDisabled();
  });

  it('fügt einen weiteren Sondertag hinzu', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: /^\s*Sondertag\s*$/ }));

    expect(screen.getByLabelText('Sondertag 2 Datum')).toBeInTheDocument();
  });

  it('entfernt einen ganzen Sondertag', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Sondertag 1 entfernen'));

    expect(screen.queryByLabelText('Sondertag 1 Datum')).not.toBeInTheDocument();
    expect(screen.getByText(/Noch keine Sonder- oder Feiertagszeiten/)).toBeInTheDocument();
  });
});

describe('Weitere Zeiten vor Paket C', () => {
  it('wird NICHT als bearbeitbar dargestellt', () => {
    /* moreHours hat noch keine Eingabemaske — die zulässigen Typen
       kommen erst über categories.batchGet. Ein Feld als bearbeitbar
       zu zeigen, für das es keine Maske gibt, wäre ein Versprechen,
       das die Oberfläche nicht einlöst. */
    const { istBearbeitbar } = require('../../utils/gbpFieldModel');
    const p = istBearbeitbar('moreHours', standort());

    expect(p.erlaubt).toBe(false);
    expect(p.code).toBe('noch_nicht_umgesetzt');
    expect(p.grund).toMatch(/abhängig von Kategorie/);
  });

  it('steht nicht in den serverseitig schreibbaren Pfaden', () => {
    const { schreibbarePfade } = require('../../utils/gbpFieldModel');
    expect(schreibbarePfade()).not.toContain('moreHours');
  });

  it('wird ohne Änderung nicht übertragen', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).not.toHaveProperty('moreHours');
  });
});

describe('Rückmeldung', () => {
  it('behauptet keine Veröffentlichung', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    const meldung = await screen.findByText(/An Google übermittelt/i);
    expect(meldung.closest('div')).toHaveTextContent(/Veröffentlichung noch überprüfen/i);
  });

  it('stellt eine Antwort ohne confirmed nicht als Erfolg dar', async () => {
    onSave.mockResolvedValue({ confirmed: false });
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/nicht bestätigt/i);
  });

  it('zeigt einen API-Fehler dauerhaft', async () => {
    onSave.mockRejectedValue(new Error('Google hat die Zeiten abgelehnt.'));
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    tippe(screen.getByLabelText('Montag Schließung 1'), '18:00');
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/abgelehnt/);
  });
});

describe('Sperren aus dem Feldmodell', () => {
  it('sperrt alles ohne Voice of Merchant', () => {
    render(<OeffnungszeitenEditor
      location={standort({}, { hasVoiceOfMerchant: false })} onSave={onSave} />);

    expect(screen.getByLabelText('Montag Öffnung 1')).toBeDisabled();
    expect(screen.getByLabelText('Sondertag 1 Datum')).toBeDisabled();
    expect(speichern()).toBeDisabled();
  });

  it('nennt den Grund', () => {
    render(<OeffnungszeitenEditor
      location={standort({}, { hasVoiceOfMerchant: false })} onSave={onSave} />);
    expect(screen.getAllByText(/nicht veröffentlicht/i).length).toBeGreaterThan(0);
  });

  it('sperrt Sonderzeiten ohne reguläre Zeiten', () => {
    /* Google lehnt specialHours ohne regularHours ab. */
    const l = { id: 'loc-1', google_profile: { metadata: { hasVoiceOfMerchant: true } } };
    render(<OeffnungszeitenEditor location={l} onSave={onSave} />);
    expect(screen.getByText(/zuerst .Reguläre Öffnungszeiten/)).toBeInTheDocument();
  });
});
