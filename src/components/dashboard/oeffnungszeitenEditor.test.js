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

import { alsZeit, alsDatum } from '../../utils/gbpHours';

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

describe('Sonderöffnungszeiten', () => {
  it('schaltet zwischen geschlossen und Uhrzeiten um', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));

    expect(screen.getByLabelText('Sondertag 1 Öffnung')).toBeInTheDocument();
  });

  it('entfernt beim Umschalten auf geschlossen die Uhrzeiten', async () => {
    /* Google lehnt geschlossen MIT Uhrzeiten ab — sie nur auszublenden
       reichte nicht. Deshalb wird hier der gesendete Stand geprüft,
       nicht die Anzeige. */
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);

    // Auf Uhrzeiten umschalten und eine setzen, damit sich etwas ändert.
    await klicke(screen.getByRole('button', { name: 'Zeiten eintragen' }));
    tippe(screen.getByLabelText('Sondertag 1 Öffnung'), '09:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const offen = onSave.mock.calls[0][1].specialHours.specialHourPeriods[0];
    expect(offen.closed).toBe(false);
    expect(offen.openTime).toEqual({ hours: 9, minutes: 0 });

    // Zurück auf geschlossen — die Uhrzeiten müssen verschwinden.
    onSave.mockClear();
    await klicke(screen.getByRole('button', { name: 'Geschlossen' }));
    expect(screen.queryByLabelText('Sondertag 1 Öffnung')).not.toBeInTheDocument();
  });

  it('fügt einen Sondertag hinzu', async () => {
    render(<OeffnungszeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByRole('button', { name: /^\s*Sondertag\s*$/ }));

    expect(screen.getByLabelText('Sondertag 2 Datum')).toBeInTheDocument();
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
