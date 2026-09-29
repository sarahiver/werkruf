/**
 * Struktur „Google-Profil verwalten" und der umgezogene Editor.
 *
 * Der zweite Teil ist der wichtigere: Er belegt, dass die vier
 * Sicherheitskorrekturen vom 29.09. den Umzug überstanden haben.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('../../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF' } }),
}));

const GoogleProfilVerwalten = require('./GoogleProfilVerwalten').default;
const StammdatenEditor = require('./StammdatenEditor').default;

const standort = (metadata = {}, profil = {}) => ({
  id: 'loc-1',
  title: 'WERKRUF',
  primary_phone: '+49 40 1234567',
  website_uri: 'https://werkruf.com',
  google_profile: {
    profile: { description: 'Alte Beschreibung' },
    phoneNumbers: { primaryPhone: '+49 40 1234567', additionalPhones: ['+49 40 7654321'] },
    regularHours: { periods: [] },
    metadata: { hasVoiceOfMerchant: true, canModifyServiceList: true, ...metadata },
    ...profil,
  },
});

const tippe = (feld, wert) => fireEvent.change(feld, { target: { value: wert } });
const klicke = async (knopf) => { await act(async () => { fireEvent.click(knopf); }); };

describe('Unternavigation', () => {
  it('zeigt alle Bereiche als Reiter', () => {
    render(<GoogleProfilVerwalten location={standort()} />);
    ['Unternehmensinformationen', 'Öffnungszeiten', 'Kategorien und Attribute',
     'Leistungen', 'Bilder und Medien', 'Bewertungen', 'Profilstatus']
      .forEach((t) => expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument());
  });

  it('öffnet Unternehmensinformationen zuerst', () => {
    render(<GoogleProfilVerwalten location={standort()} />);
    expect(screen.getByRole('button', { name: /Unternehmensinformationen/ }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('wechselt den Bereich beim Klick', async () => {
    render(<GoogleProfilVerwalten location={standort()} />);
    await klicke(screen.getByRole('button', { name: /Öffnungszeiten/ }));

    expect(screen.getByRole('heading', { name: 'Öffnungszeiten' })).toBeInTheDocument();
    expect(screen.getByText(/Reguläre Öffnungszeiten/)).toBeInTheDocument();
  });

  it('nennt ohne ausgewählten Betrieb keinen Bereich', () => {
    render(<GoogleProfilVerwalten location={null} />);
    expect(screen.getByText(/Wähle oben einen Betrieb/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Öffnungszeiten/ })).not.toBeInTheDocument();
  });

  it('kennzeichnet gesperrte Felder mit Begründung', () => {
    render(<GoogleProfilVerwalten location={standort()} />);
    expect(screen.getByText('Unternehmensname')).toBeInTheDocument();
    expect(screen.getByText(/Namensänderungen nimmt Google/)).toBeInTheDocument();
  });

  it('warnt einmal oben statt an jedem Feld, wenn Voice of Merchant fehlt', () => {
    render(<GoogleProfilVerwalten location={standort({ hasVoiceOfMerchant: false })} />);

    const warnung = screen.getByRole('status');
    expect(warnung).toHaveTextContent(/Kontrolle über dieses Profil noch nicht bestätigt/);
    expect(warnung).toHaveTextContent(/nicht veröffentlicht/);
  });

  it('bindet den Inhalt eines Bereichs ein', () => {
    render(
      <GoogleProfilVerwalten
        location={standort()}
        bereiche={{ stammdaten: <p>Eigener Inhalt hier</p> }}
      />,
    );
    expect(screen.getByText('Eigener Inhalt hier')).toBeInTheDocument();
  });

  it('sagt bei Bereichen ohne Inhalt, dass sie noch nicht eingerichtet sind', async () => {
    render(<GoogleProfilVerwalten location={standort()} />);
    await klicke(screen.getByRole('button', { name: /Bilder und Medien/ }));
    expect(screen.getByText(/noch nicht eingerichtet/)).toBeInTheDocument();
  });
});

describe('Umgezogener Editor — Sicherheitskorrekturen', () => {
  const onSave = jest.fn();

  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue({ confirmed: true, updateMask: 'profile.description' });
  });

  const beschreibung = () => screen.getByLabelText(/Unternehmensbeschreibung/i);
  const telefon      = () => screen.getByLabelText(/Telefonnummer/i);
  const speichern    = () => screen.getByRole('button', { name: /Bei Google speichern|Wird übermittelt/i });

  it('sendet nur tatsächlich geänderte Felder', async () => {
    render(<StammdatenEditor location={standort()} onSave={onSave} />);
    tippe(beschreibung(), 'Neue Beschreibung');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];
    expect(Object.keys(aenderungen)).toEqual(['profile.description']);
  });

  it('schickt phoneNumbers als GANZES Objekt und erhält additionalPhones', async () => {
    /* Der Datenverlust vom 29.09.: Google verlangt beide Unterfelder
       gemeinsam; ein Unterpfad hätte die Zweitnummern gelöscht. */
    render(<StammdatenEditor location={standort()} onSave={onSave} />);
    tippe(telefon(), '+49 40 999');
    await klicke(speichern());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, aenderungen] = onSave.mock.calls[0];

    expect(Object.keys(aenderungen)).toContain('phoneNumbers');
    expect(Object.keys(aenderungen)).not.toContain('phoneNumbers.primaryPhone');
    expect(aenderungen.phoneNumbers.additionalPhones).toEqual(['+49 40 7654321']);
  });

  it('behauptet keine Veröffentlichung', async () => {
    render(<StammdatenEditor location={standort()} onSave={onSave} />);
    tippe(beschreibung(), 'Neu');
    await klicke(speichern());

    const rueckmeldung = (await screen.findByText(/An Google übermittelt/i)).closest('div');
    expect(rueckmeldung).toHaveTextContent(/Veröffentlichung noch überprüfen/i);
    expect(rueckmeldung).not.toHaveTextContent(/Von Google bestätigt/i);
  });

  it('stellt eine Antwort ohne confirmed nicht als Erfolg dar', async () => {
    onSave.mockResolvedValue({ confirmed: false });
    render(<StammdatenEditor location={standort()} onSave={onSave} />);
    tippe(beschreibung(), 'Nicht bestätigt');
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/nicht bestätigt/i);
  });

  it('zeigt einen API-Fehler dauerhaft', async () => {
    onSave.mockRejectedValue(new Error('Google hat die Nummer abgelehnt.'));
    render(<StammdatenEditor location={standort()} onSave={onSave} />);
    tippe(telefon(), 'keine-nummer');
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/abgelehnt/);
  });
});

describe('Umgezogener Editor — neue Sperrprüfung', () => {
  const onSave = jest.fn(() => Promise.resolve({ confirmed: true, updateMask: 'x' }));
  beforeEach(() => { onSave.mockClear(); onSave.mockResolvedValue({ confirmed: true, updateMask: 'x' }); });

  it('sperrt alle Felder ohne Voice of Merchant', () => {
    render(<StammdatenEditor location={standort({ hasVoiceOfMerchant: false })} onSave={onSave} />);

    expect(screen.getByLabelText(/Telefonnummer/i)).toBeDisabled();
    expect(screen.getByLabelText(/^Website$/i)).toBeDisabled();
    expect(screen.getByLabelText(/Unternehmensbeschreibung/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Bei Google speichern/i })).toBeDisabled();
  });

  it('nennt den Grund am Feld, nicht nur durch Ausgrauen', () => {
    render(<StammdatenEditor location={standort({ hasVoiceOfMerchant: false })} onSave={onSave} />);
    expect(screen.getAllByText(/nicht veröffentlicht/i).length).toBeGreaterThan(0);
  });

  it('lässt bearbeitbare Felder offen', () => {
    render(<StammdatenEditor location={standort()} onSave={onSave} />);
    expect(screen.getByLabelText(/Telefonnummer/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/Unternehmensbeschreibung/i)).not.toBeDisabled();
  });
});
