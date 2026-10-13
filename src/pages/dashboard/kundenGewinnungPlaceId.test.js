/*
 * Kunden-Gewinnung: die Place-ID kommt aus dem OAuth-Standort.
 * (Paket H1, §48)
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRUEFT WIRD UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════
 *
 * ausgewaehlterStandort.test.js prueft die Auswahlregel als reine
 * Funktion. Diese Datei prueft, was die SEITE daraus macht:
 *
 *   - benutzt sie den Standort und nicht mehr profile.google_place_id
 *   - zeigt sie bei zwei Betrieben nicht den Link eines beliebigen
 *   - traegt der QR-Code dieselbe Adresse wie der Link
 *   - greift der Legacy-Wert nur ohne jeden Standort
 *
 * Der letzte Punkt ist der, den eine Quelltextpruefung nicht fangen
 * koennte: dass ein Profilwert NICHT gewinnt, obwohl er da ist.
 *
 * ProGate wird durchgelassen (Mock). Dass Founding Partner es
 * passieren, prueft src/utils/entitlement.test.js an der Regel
 * selbst — ein hier gemocktes Gate wuerde darueber nichts sagen.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

const mockStandort = jest.fn();
jest.mock('../../hooks/useAusgewaehlterStandort', () => ({
  __esModule: true,
  useAusgewaehlterStandort: () => mockStandort(),
}));

/* Der Client wird von keinem Pfad dieser Seite gebraucht — alle Hooks
   sind gemockt. Er muss trotzdem weg, weil der Modulgraph ihn
   mitzieht und createClient ohne REACT_APP_SUPABASE_URL wirft.
   Hausmuster: usePlacesAnalysis.test.js:5. */
jest.mock('../../supabaseClient', () => ({ __esModule: true, default: { from: jest.fn() } }));

const mockProfil = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => ({ profile: mockProfil(), user: { id: 'u1' } }),
}));

jest.mock('../../hooks/useBetriebsname', () => ({
  __esModule: true,
  useBetriebsname: () => ({ name: 'Sanitaer Mueller', loading: false }),
}));

/* ProGate durchlassen: diese Datei prueft die Place-ID, nicht das
   Entitlement. */
jest.mock('../../components/dashboard/ProGate', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

/* qrcode.react zeichnet ein SVG — hier genuegt der Wert, den es
   bekommt, denn genau der wird gedruckt. */
jest.mock('qrcode.react', () => ({
  __esModule: true,
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import DashboardKundenGewinnung from './DashboardKundenGewinnung';

const STANDORT_A = { id: 'loc-a', place_id: 'ChIJ_aaa_aaaaaaaaaa', title: 'Sanitaer Mueller' };
const STANDORT_B = { id: 'loc-b', place_id: 'ChIJ_bbb_bbbbbbbbbb', title: 'Mueller Heizung' };

const LINK = (id) => `https://search.google.com/local/writereview?placeid=${id}`;

beforeEach(() => {
  mockStandort.mockReset();
  mockProfil.mockReset();
  mockProfil.mockReturnValue({ company_name: 'Firma Mueller', google_place_id: null });
});

describe('§11 Place-ID aus dem OAuth-Standort', () => {

  it('baut den Bewertungslink aus standort.place_id', () => {
    mockStandort.mockReturnValue({
      standort: STANDORT_A, grund: 'ausgewaehlt', anzahl: 1, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByDisplayValue(LINK('ChIJ_aaa_aaaaaaaaaa'))).toBeInTheDocument();
  });

  it('nimmt den Standort, auch wenn das Profil eine andere Place-ID traegt', () => {
    /* §12: kein globaler Place-ID-Fallback auf Profilebene. Der
       Legacy-Wert darf den echten Standort nicht ueberschreiben —
       sonst zeigt der QR-Code auf den Betrieb aus der Registrierung,
       waehrend die Kennzahlen daneben den ausgewaehlten zeigen. */
    mockProfil.mockReturnValue({
      company_name: 'Firma Mueller', google_place_id: 'ChIJ_LEGACY_alt_wert',
    });
    mockStandort.mockReturnValue({
      standort: STANDORT_A, grund: 'ausgewaehlt', anzahl: 1, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByDisplayValue(LINK('ChIJ_aaa_aaaaaaaaaa'))).toBeInTheDocument();
    expect(screen.queryByDisplayValue(LINK('ChIJ_LEGACY_alt_wert'))).not.toBeInTheDocument();
  });

  it('traegt der QR-Code dieselbe Adresse wie der Link', () => {
    mockStandort.mockReturnValue({
      standort: STANDORT_A, grund: 'ausgewaehlt', anzahl: 1, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', LINK('ChIJ_aaa_aaaaaaaaaa'));
  });
});

describe('§12 Multi-Location', () => {

  it('zeigt bei zwei Betrieben ohne Auswahl keinen Link', () => {
    mockStandort.mockReturnValue({
      standort: null, grund: 'ohne_auswahl', anzahl: 2, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByText(/Welchen Betrieb meinst du/i)).toBeInTheDocument();
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
  });

  it.each([
    ['Standort A', STANDORT_A],
    ['Standort B', STANDORT_B],
  ])('folgt der Auswahl: %s', (_name, standort) => {
    mockStandort.mockReturnValue({
      standort, grund: 'ausgewaehlt', anzahl: 2, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByDisplayValue(LINK(standort.place_id))).toBeInTheDocument();
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', LINK(standort.place_id));
  });
});

describe('§13 Legacy-Wert nur als Rueckfall', () => {

  it('greift, wenn es ueberhaupt keinen Standort gibt', () => {
    mockProfil.mockReturnValue({
      company_name: 'Firma Mueller', google_place_id: 'ChIJ_LEGACY_alt_wert',
    });
    mockStandort.mockReturnValue({
      standort: null, grund: 'keine', anzahl: 0, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByDisplayValue(LINK('ChIJ_LEGACY_alt_wert'))).toBeInTheDocument();
    /* Kein stilles Mischen: die Seite sagt, woher der Link kommt. */
    expect(screen.getByText(/stammt noch aus deiner Anmeldung/i)).toBeInTheDocument();
  });

  it('greift NICHT, wenn ein Standort ohne place_id existiert', () => {
    /* Der heikle Fall. Ein Standort ist da, aber Google hat keine
       Kennung geliefert — etwa weil das Profil noch nicht bestaetigt
       ist. Wuerde der Legacy-Wert hier greifen, bekaeme der Kunde
       einen Link auf einen ANDEREN Betrieb und wuesste es nicht. */
    mockProfil.mockReturnValue({
      company_name: 'Firma Mueller', google_place_id: 'ChIJ_LEGACY_alt_wert',
    });
    mockStandort.mockReturnValue({
      standort: { id: 'loc-x', place_id: null, title: 'Neu' },
      grund: 'ausgewaehlt', anzahl: 1, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(LINK('ChIJ_LEGACY_alt_wert'))).not.toBeInTheDocument();
    expect(screen.getByText(/noch keine Kennung geliefert/i)).toBeInTheDocument();
  });
});

describe('Zustaende', () => {

  it('zeigt beim Laden keinen falschen Zustand', () => {
    mockStandort.mockReturnValue({
      standort: null, grund: null, anzahl: 0, loading: true, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByText(/Einen Moment/i)).toBeInTheDocument();
    /* Nicht "Betrieb noch nicht verknüpft" — das waere eine Diagnose
       waehrend die Daten noch unterwegs sind. */
    expect(screen.queryByText(/noch nicht verknüpft/i)).not.toBeInTheDocument();
  });

  it('bittet ohne Standort und ohne Legacy-Wert um die Verbindung', () => {
    mockStandort.mockReturnValue({
      standort: null, grund: 'keine', anzahl: 0, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.getByText(/noch nicht verknüpft/i)).toBeInTheDocument();
    expect(screen.getByText(/Google-Unternehmensprofil in der Übersicht/i)).toBeInTheDocument();
  });

  it('benutzt keinen englischen Jargon in der Einleitung', () => {
    /* §58. Vorher stand dort "Teile deinen Link und watch your rating
       climb." */
    mockStandort.mockReturnValue({
      standort: STANDORT_A, grund: 'ausgewaehlt', anzahl: 1, loading: false, fehler: false,
    });

    render(<DashboardKundenGewinnung />);

    expect(screen.queryByText(/watch your rating/i)).not.toBeInTheDocument();
  });
});
