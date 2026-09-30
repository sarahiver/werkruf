/**
 * Weitere Öffnungszeiten.
 *
 * Schwerpunkt: Die Arten stammen ausschließlich von Google, und die
 * drei Zustände — Typen vorhanden, keine vorhanden, Abruf gescheitert —
 * werden unterschieden.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

import { alsZeit } from '../../utils/gbpHours';

const metadaten = { wert: null };
jest.mock('../../hooks/useGoogleCategories', () => ({
  useKategorieMetadaten: () => metadaten.wert,
}));

const WeitereZeitenEditor = require('./WeitereZeitenEditor').default;

const fenster = (tag, auf, zu) => ({
  openDay: tag, closeDay: tag, openTime: alsZeit(auf), closeTime: alsZeit(zu),
});

const standort = (profil = {}) => ({
  id: 'loc-1',
  google_profile: {
    categories: { primaryCategory: { name: 'gcid:plumber', displayName: 'Klempner' } },
    metadata: { hasVoiceOfMerchant: true },
    ...profil,
  },
});

const MIT_TYPEN = {
  moreHoursTypes: [
    { hoursTypeId: 'PICKUP', displayName: 'Abholung' },
    { hoursTypeId: 'DELIVERY', displayName: 'Lieferung' },
  ],
  laeuft: false, abrufGescheitert: false,
};

const tippe = (feld, wert) => fireEvent.change(feld, { target: { value: wert } });
const klicke = async (el) => { await act(async () => { fireEvent.click(el); }); };
const speichern = () => screen.getByRole('button', { name: /Bei Google speichern|Wird übermittelt/i });

const onSave = jest.fn();
beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue({ confirmed: true, status: 'submitted_pending' });
  metadaten.wert = MIT_TYPEN;
});

describe('Die drei Zustände', () => {
  it('zeigt einen Ladehinweis, solange Google gefragt wird', () => {
    metadaten.wert = { moreHoursTypes: null, laeuft: true, abrufGescheitert: false };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByText(/werden von Google geladen/i)).toBeInTheDocument();
  });

  it('sagt klar, wenn Google für die Kategorie keine Arten kennt', () => {
    metadaten.wert = { moreHoursTypes: [], laeuft: false, abrufGescheitert: false };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByText(/bietet Google keine weiteren Öffnungszeiten an/i))
      .toBeInTheDocument();
  });

  it('behauptet bei gescheitertem Abruf NICHT, dass es keine gibt', () => {
    /* Der wichtigste Unterschied: „Google kennt keine" und „wir
       konnten nicht nachsehen" sind verschiedene Auskünfte. */
    metadaten.wert = { moreHoursTypes: null, laeuft: false, abrufGescheitert: true };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);

    expect(screen.getByText(/konnten gerade nicht von Google geladen werden/i))
      .toBeInTheDocument();
    expect(screen.getByText(/heißt nicht, dass es keine gibt/i)).toBeInTheDocument();
    expect(screen.queryByText(/bietet Google keine weiteren/i)).not.toBeInTheDocument();
  });

  it('verweist ohne Hauptkategorie auf diese', () => {
    const ohne = { id: 'loc-1', google_profile: { metadata: { hasVoiceOfMerchant: true } } };
    render(<WeitereZeitenEditor location={ohne} onSave={onSave} />);
    expect(screen.getByText(/Setze zuerst eine Hauptkategorie/i)).toBeInTheDocument();
  });
});

describe('Arten stammen von Google', () => {
  it('zeigt genau die gelieferten Arten mit Anzeigenamen', () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByLabelText('Abholung aktivieren')).toBeInTheDocument();
    expect(screen.getByLabelText('Lieferung aktivieren')).toBeInTheDocument();
  });

  it('erfindet keine weiteren Arten', () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    /* Nichts, was Google nicht geliefert hat. */
    expect(screen.queryByLabelText(/Drive-Through aktivieren/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Happy Hour aktivieren/i)).not.toBeInTheDocument();
  });

  it('zeigt bei einer anderen Kategorie andere Arten', () => {
    metadaten.wert = {
      moreHoursTypes: [{ hoursTypeId: 'DRIVE_THROUGH', displayName: 'Drive-through' }],
      laeuft: false, abrufGescheitert: false,
    };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);

    expect(screen.getByLabelText('Drive-through aktivieren')).toBeInTheDocument();
    expect(screen.queryByLabelText('Abholung aktivieren')).not.toBeInTheDocument();
  });
});

describe('Benennung', () => {
  it('bevorzugt den übersetzten Namen vor dem englischen', () => {
    /* MoreHoursType hat beide Felder. Eine frühere Fassung las den
       englischen zuerst — dadurch stand im deutschen Dashboard
       „Drive through" statt „Durchfahrt". */
    metadaten.wert = {
      moreHoursTypes: [{
        hoursTypeId: 'DRIVE_THROUGH',
        displayName: 'Drive through',
        localizedDisplayName: 'Durchfahrt',
      }],
      laeuft: false, abrufGescheitert: false,
    };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);

    expect(screen.getByLabelText('Durchfahrt aktivieren')).toBeInTheDocument();
    expect(screen.queryByLabelText('Drive through aktivieren')).not.toBeInTheDocument();
  });

  it('nimmt den englischen Namen, wenn kein übersetzter kommt', () => {
    metadaten.wert = {
      moreHoursTypes: [{ hoursTypeId: 'PICKUP', displayName: 'Pickup' }],
      laeuft: false, abrufGescheitert: false,
    };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByLabelText('Pickup aktivieren')).toBeInTheDocument();
  });

  it('erklärt die Zeitart in eigenen Worten', () => {
    /* Googles Namen sind knapp: „Access" heisst nicht „Zugang zum
       Laden". Die Erläuterung stammt von WERKRUF und steht neben dem
       Namen, nicht an dessen Stelle. */
    metadaten.wert = {
      moreHoursTypes: [{ hoursTypeId: 'ACCESS', localizedDisplayName: 'Zugang' }],
      laeuft: false, abrufGescheitert: false,
    };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);

    expect(screen.getByText('Zugang')).toBeInTheDocument();
    expect(screen.getByText(/Gelände oder Gebäude zugänglich/)).toBeInTheDocument();
  });

  it('erfindet keine Erläuterung für unbekannte Arten', () => {
    metadaten.wert = {
      moreHoursTypes: [{ hoursTypeId: 'GANZ_NEUE_ART', localizedDisplayName: 'Neue Art' }],
      laeuft: false, abrufGescheitert: false,
    };
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);

    expect(screen.getByLabelText('Neue Art aktivieren')).toBeInTheDocument();
  });
});

describe('Hinterlegte Arten, die nicht zur Kategorie passen', () => {
  const mitAltlast = () => standort({
    moreHours: [{ hoursTypeKey: 'HAPPY_HOUR', periods: [fenster('MONDAY', '17:00', '19:00')] }],
  });

  it('sperrt das Speichern NICHT mit einem unsichtbaren Fehler', () => {
    /* Der Fehler vom 30.09.: Die Leiste meldete „Bitte zuerst die
       markierten Angaben korrigieren", während nichts markiert war und
       nichts markiert werden konnte. */
    render(<WeitereZeitenEditor location={mitAltlast()} onSave={onSave} />);
    expect(screen.queryByText(/Google würde sie ablehnen/)).not.toBeInTheDocument();
  });

  it('benennt sie sichtbar', () => {
    render(<WeitereZeitenEditor location={mitAltlast()} onSave={onSave} />);
    expect(screen.getByText(/passt nicht zu deiner Unternehmenskategorie/i)).toBeInTheDocument();
    expect(screen.getByText('HAPPY_HOUR')).toBeInTheDocument();
  });

  it('lässt sie entfernen', async () => {
    render(<WeitereZeitenEditor location={mitAltlast()} onSave={onSave} />);
    await klicke(screen.getByLabelText('HAPPY_HOUR entfernen'));

    expect(screen.queryByText('HAPPY_HOUR')).not.toBeInTheDocument();
    expect(speichern()).not.toBeDisabled();
  });

  it('zählt mehrere richtig', () => {
    const l = standort({
      moreHours: [
        { hoursTypeKey: 'HAPPY_HOUR', periods: [] },
        { hoursTypeKey: 'KITCHEN', periods: [] },
      ],
    });
    render(<WeitereZeitenEditor location={l} onSave={onSave} />);
    expect(screen.getByText(/2 hinterlegte Zeitarten passen/i)).toBeInTheDocument();
  });
});

describe('Bearbeiten', () => {
  it('blendet Zeiten erst nach dem Aktivieren ein', async () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    expect(screen.queryByLabelText(/Abholung Montag Öffnung/)).not.toBeInTheDocument();

    await klicke(screen.getByLabelText('Abholung aktivieren'));
    expect(screen.getByLabelText('Abholung Montag Zeiten hinzufügen')).toBeInTheDocument();
  });

  it('trägt Zeiten für einen Tag ein', async () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(screen.getByLabelText('Abholung Montag Zeiten hinzufügen'));

    expect(screen.getByLabelText('Abholung Montag Öffnung 1')).toHaveValue('09:00');
  });

  it('erlaubt mehrere Zeitfenster pro Tag', async () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(screen.getByLabelText('Abholung Montag Zeiten hinzufügen'));
    tippe(screen.getByLabelText('Abholung Montag Schließung 1'), '12:00');
    await klicke(screen.getByLabelText('Abholung Montag Fenster hinzufügen'));

    expect(screen.getByLabelText('Abholung Montag Öffnung 2')).toBeInTheDocument();
  });

  it('setzt bei über Mitternacht den Folgetag', async () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(screen.getByLabelText('Abholung Montag Zeiten hinzufügen'));
    tippe(screen.getByLabelText('Abholung Montag Schließung 1'), '02:00');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];
    expect(aenderungen.moreHours[0].periods[0].closeDay).toBe('TUESDAY');
  });

  it('übernimmt die Validierung aus Paket B', async () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(screen.getByLabelText('Abholung Montag Zeiten hinzufügen'));
    tippe(screen.getByLabelText('Abholung Montag Schließung 1'), '12:00');
    await klicke(screen.getByLabelText('Abholung Montag Fenster hinzufügen'));
    tippe(screen.getByLabelText('Abholung Montag Öffnung 2'), '11:00');

    expect(screen.getByText(/Google würde sie ablehnen/)).toBeInTheDocument();
    expect(speichern()).toBeDisabled();
  });
});

describe('Speichern', () => {
  it('sendet nur moreHours, keine anderen Zeitfelder', async () => {
    const l = standort({
      regularHours: { periods: [fenster('MONDAY', '08:00', '17:00')] },
      specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 25 }, closed: true }] },
    });
    render(<WeitereZeitenEditor location={l} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];

    expect(Object.keys(aenderungen)).toEqual(['moreHours']);
    expect(aenderungen).not.toHaveProperty('regularHours');
    expect(aenderungen).not.toHaveProperty('specialHours');
  });

  it('sendet ohne Änderung nichts', () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    expect(speichern()).toBeDisabled();
    expect(screen.getByText('Keine Änderungen.')).toBeInTheDocument();
  });

  it('meldet bei pendingMask, dass Google prüft', async () => {
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(speichern());

    expect(await screen.findByText(/An Google übermittelt/i)).toBeInTheDocument();
    expect(screen.getByText(/Google prüft die Änderung/i)).toBeInTheDocument();
  });

  it('behauptet ohne pendingMask keine Veröffentlichung', async () => {
    onSave.mockResolvedValue({ confirmed: true, status: 'submitted_no_pending' });
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(speichern());

    expect(await screen.findByText(/Veröffentlichung noch überprüfen/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Veröffentlicht/)).not.toBeInTheDocument();
  });

  it('stellt not_submitted als Fehler dar', async () => {
    onSave.mockResolvedValue({ confirmed: true, status: 'not_submitted' });
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/nicht übernommen/i);
  });

  it('zeigt einen API-Fehler dauerhaft', async () => {
    onSave.mockRejectedValue(new Error('Google hat die Zeiten abgelehnt.'));
    render(<WeitereZeitenEditor location={standort()} onSave={onSave} />);
    await klicke(screen.getByLabelText('Abholung aktivieren'));
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/abgelehnt/);
  });
});

describe('Sperre', () => {
  it('sperrt alles ohne Voice of Merchant', () => {
    const l = standort({ metadata: { hasVoiceOfMerchant: false } });
    render(<WeitereZeitenEditor location={l} onSave={onSave} />);

    expect(screen.getByLabelText('Abholung aktivieren')).toBeDisabled();
    expect(speichern()).toBeDisabled();
    expect(screen.getAllByText(/nicht veröffentlicht/i).length).toBeGreaterThan(0);
  });
});
