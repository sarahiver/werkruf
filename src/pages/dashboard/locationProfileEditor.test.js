/**
 * Regressionstests fuer den Profil-Editor (Paket 1, 29.09.2026).
 *
 * Vier Fehler, die hier abgesichert werden:
 *   1. Beim Speichern gingen ALLE Felder raus, auch unveraenderte.
 *   2. updateMask war zu grob ("profile" statt "profile.description"),
 *      wodurch Google das ganze profile-Objekt ersetzte.
 *   3. load() nach dem Speichern setzte loading = true, der Editor
 *      wurde durch ein Skeleton ersetzt und verlor seine Rueckmeldung.
 *   4. "Von Google bestaetigt" behauptete eine Veroeffentlichung, die
 *      die API gar nicht meldet.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('../../hooks/useGoogleBusinessData', () => ({ useGoogleBusinessData: jest.fn() }));
jest.mock('../../hooks/useGoogleBusiness', () => ({
  __esModule: true,
  useGoogleBusiness: () => ({ isConnected: true, loading: false }),
  default: () => ({ isConnected: true, loading: false }),
}));
jest.mock('../../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF' } }),
}));
jest.mock('../../components/dashboard/GoogleBusinessConnect', () => ({
  __esModule: true, default: () => null,
}));

const { useGoogleBusinessData } = require('../../hooks/useGoogleBusinessData');
const DashboardGoogleBusiness = require('./DashboardGoogleBusiness').default;

const STANDORT = 'loc-werkruf';

const standort = (ueberschreibungen = {}) => ({
  id: STANDORT,
  title: 'WERKRUF',
  locality: 'Hamburg',
  selected_at: '2026-09-29T08:00:00Z',
  is_primary: true,
  last_synced_at: '2026-09-29T09:00:00Z',
  primary_phone: '+49 40 1234567',
  website_uri: 'https://werkruf.com',
  google_profile: {
    profile: { description: 'Alte Beschreibung' },
    phoneNumbers: { primaryPhone: '+49 40 1234567', additionalPhones: ['+49 40 7654321'] },
  },
  google_media: [],
  ...ueberschreibungen,
});

const updateLocation = jest.fn();

function zustand(location = standort()) {
  return {
    locations: [location],
    stats: { totalReviews: 3, averageRating: 4.5, unanswered: 0, distribution: {}, newestReviewAt: null, photoCount: 0 },
    replyCounts: { draft: 0, approved: 0, published: 0, failed: 0 },
    lastSyncedAt: '2026-09-29T09:00:00Z',
    latestJob: null, lastFailedJob: null,
    failedJobHistory: [], stalledJobs: [],
    locationImport: { status: 'succeeded', job: null, keineBetriebe: false },
    loading: false, refreshing: false, error: null,
    reload: jest.fn(), refresh: jest.fn(), triggerSync: jest.fn(() => Promise.resolve({})),
    refreshJobStatus: jest.fn(), updateLocation, selectLocation: jest.fn(),
  };
}

const ANGENOMMEN = (maske) => ({ confirmed: true, updateMask: maske, location: {} });

beforeEach(() => {
  updateLocation.mockReset();
  updateLocation.mockResolvedValue(ANGENOMMEN('profile.description'));
  useGoogleBusinessData.mockReturnValue(zustand());
});

/* user-event liegt hier in Version 13 vor — dort gibt es setup() noch
   nicht. fireEvent ist versionsunabhaengig und reicht fuer diese
   Faelle vollstaendig. */
const tippe = (feld, wert) => fireEvent.change(feld, { target: { value: wert } });
const klicke = async (knopf) => { await act(async () => { fireEvent.click(knopf); }); };

const beschreibungsfeld = () => screen.getByLabelText(/Unternehmensbeschreibung/i);
const telefonfeld       = () => screen.getByLabelText(/Telefonnummer/i);
const websitefeld       = () => screen.getByLabelText(/^Website$/i);
const speichern         = () => screen.getByRole('button', { name: /Bei Google speichern|Wird übermittelt/i });

describe('Nur geaenderte Felder uebertragen', () => {
  it('sendet bei geaenderter Beschreibung ausschliesslich profile.description', async () => {
    render(<DashboardGoogleBusiness />);

    tippe(beschreibungsfeld(), 'Neue Beschreibung');
    await klicke(speichern());

    await waitFor(() => expect(updateLocation).toHaveBeenCalledTimes(1));
    const [, aenderungen] = updateLocation.mock.calls[0];

    expect(Object.keys(aenderungen)).toEqual(['profile.description']);
    expect(aenderungen['profile.description']).toBe('Neue Beschreibung');
  });

  it('laesst Telefon und Website unberuehrt, wenn sie nicht geaendert wurden', async () => {
    render(<DashboardGoogleBusiness />);

    tippe(beschreibungsfeld(), 'Nur die Beschreibung');
    await klicke(speichern());

    await waitFor(() => expect(updateLocation).toHaveBeenCalled());
    const [, aenderungen] = updateLocation.mock.calls[0];

    const schluessel = Object.keys(aenderungen);
    expect(schluessel).not.toContain('websiteUri');
    expect(schluessel).not.toContain('phoneNumbers');
  });

  it('verwendet Punktpfade statt ganzer Objekte', async () => {
    /* Der eigentliche Datenverlust: updateMask=profile ersetzt bei
       Google das GESAMTE profile-Objekt. Genauso loescht
       updateMask=phoneNumbers die additionalPhones. */
    render(<DashboardGoogleBusiness />);

    tippe(telefonfeld(), '+49 40 999');
    await klicke(speichern());

    await waitFor(() => expect(updateLocation).toHaveBeenCalled());
    const [, aenderungen] = updateLocation.mock.calls[0];

    /* Object.keys statt toHaveProperty: Jest deutet einen Punkt im
       Namen als Pfad, "phoneNumbers.primaryPhone" waere dort also ein
       verschachtelter Zugriff statt eines Schluessels. */
    /* Korrektur vom 29.09. nach Auswertung des Discovery-Dokuments:
       phoneNumbers darf NICHT als Unterpfad geschickt werden — Google
       verlangt das ganze Objekt. Die vorhandenen additionalPhones
       muessen deshalb mitgehen, sonst loescht das Speichern sie. */
    const schluessel = Object.keys(aenderungen);
    expect(schluessel).toContain('phoneNumbers');
    expect(schluessel).not.toContain('phoneNumbers.primaryPhone');
    expect(schluessel).not.toContain('profile');
    expect(aenderungen.phoneNumbers.primaryPhone).toBe('+49 40 999');
    expect(aenderungen.phoneNumbers.additionalPhones).toEqual(['+49 40 7654321']);
  });

  it('uebertraegt mehrere Aenderungen gemeinsam, aber nur die geaenderten', async () => {
    render(<DashboardGoogleBusiness />);

    tippe(websitefeld(), 'https://neu.example');
    tippe(beschreibungsfeld(), 'Auch neu');
    await klicke(speichern());

    await waitFor(() => expect(updateLocation).toHaveBeenCalled());
    const [, aenderungen] = updateLocation.mock.calls[0];

    expect(Object.keys(aenderungen).sort()).toEqual(['profile.description', 'websiteUri']);
  });

  it('sperrt den Knopf, solange nichts geaendert wurde', () => {
    render(<DashboardGoogleBusiness />);
    expect(speichern()).toBeDisabled();
    expect(updateLocation).not.toHaveBeenCalled();
  });
});

describe('Zustandsdarstellung', () => {
  it('behauptet keine Veroeffentlichung, sondern nur die Uebermittlung', async () => {
    render(<DashboardGoogleBusiness />);

    tippe(beschreibungsfeld(), 'Neue Beschreibung');
    await klicke(speichern());

    const rueckmeldung = (await screen.findByText(/An Google übermittelt/i)).closest('div');

    expect(rueckmeldung).toHaveTextContent(/Veröffentlichung noch überprüfen/i);
    /* Gezielt die Rueckmeldung, nicht die ganze Seite: "Veröffentlicht"
       steht dort auch als Kennzahl der Antwort-Pipeline. */
    expect(rueckmeldung).not.toHaveTextContent(/Von Google bestätigt/i);
    expect(rueckmeldung).not.toHaveTextContent(/\bveröffentlicht\b/i);
  });

  it('haelt Formular und Rueckmeldung nach dem Speichern sichtbar', async () => {
    render(<DashboardGoogleBusiness />);

    tippe(beschreibungsfeld(), 'Bleibt stehen');
    await klicke(speichern());

    await screen.findByText(/An Google übermittelt/i);
    // Das Formular darf nicht durch ein Skeleton ersetzt worden sein.
    expect(beschreibungsfeld()).toBeInTheDocument();
    expect(beschreibungsfeld()).toHaveValue('Bleibt stehen');
  });

  it('zeigt einen API-Fehler dauerhaft und verstaendlich', async () => {
    updateLocation.mockRejectedValue(
      Object.assign(new Error('Google hat die Telefonnummer abgelehnt.'), { code: 'invalid_argument' }));
    render(<DashboardGoogleBusiness />);

    tippe(telefonfeld(), 'keine-nummer');
    await klicke(speichern());

    const meldung = await screen.findByRole('alert');
    expect(meldung).toHaveTextContent(/Nicht gespeichert/i);
    expect(meldung).toHaveTextContent(/Telefonnummer abgelehnt/i);
    expect(screen.queryByText(/An Google übermittelt/i)).not.toBeInTheDocument();
  });

  it('stellt eine Antwort ohne confirmed NICHT als Erfolg dar', async () => {
    updateLocation.mockResolvedValue({ confirmed: false, updateMask: 'profile.description' });
    render(<DashboardGoogleBusiness />);

    tippe(beschreibungsfeld(), 'Nicht bestätigt');
    await klicke(speichern());

    expect(await screen.findByRole('alert')).toHaveTextContent(/nicht bestätigt/i);
    expect(screen.queryByText(/An Google übermittelt/i)).not.toBeInTheDocument();
  });

  it('nennt die tatsaechlich uebermittelten Felder aus der Serverantwort', async () => {
    updateLocation.mockResolvedValue(ANGENOMMEN('profile.description,websiteUri'));
    render(<DashboardGoogleBusiness />);

    tippe(beschreibungsfeld(), 'X');
    await klicke(speichern());

    expect(await screen.findByText(/profile\.description, websiteUri/)).toBeInTheDocument();
  });
});
