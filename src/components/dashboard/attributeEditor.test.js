/**
 * Attribut-Editor.
 *
 * Schwerpunkt: alle von Google gelieferten Datentypen, unbekannte
 * Typen schreibgeschützt statt verschluckt, und nur tatsächlich
 * geänderte Attribute werden gesendet.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

/* Jest erlaubt in jest.mock nur Variablen mit mock-Praefix. */
/* jest.requireActual im Mock zieht supabaseClient herein, und der
   braucht beim Laden Umgebungsvariablen. */
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));

const mockDaten = { metadaten: [], gesetzt: [], laeuft: false, fehler: null, vollstaendig: true };
const mockSpeichern = jest.fn();

jest.mock('../../hooks/useGoogleAttributes', () => {
  const echt = jest.requireActual('../../hooks/useGoogleAttributes');
  return {
    ...echt,
    useGoogleAttributes: () => ({ ...mockDaten, speichern: mockSpeichern, laden: jest.fn() }),
  };
});

const AttributeEditor = require('./AttributeEditor').default;

const standort = (metadata = {}) => ({
  id: 'loc-1',
  google_profile: { metadata: { hasVoiceOfMerchant: true, ...metadata } },
});

const M = (name, valueType, extra = {}) => ({
  parent: `attributes/${name}`, valueType,
  displayName: extra.displayName ?? name,
  ...extra,
});

const klicke = async (el) => { await act(async () => { fireEvent.click(el); }); };
const waehle = (el, wert) => fireEvent.change(el, { target: { value: wert } });
const knopf = () => screen.getByRole('button', { name: /Bei Google speichern|Wird übermittelt/i });

beforeEach(() => {
  mockSpeichern.mockReset();
  mockSpeichern.mockResolvedValue({ confirmed: true, attributes: [] });
  mockDaten.metadaten = []; mockDaten.gesetzt = [];
  mockDaten.laeuft = false; mockDaten.fehler = null; mockDaten.vollstaendig = true;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('Zustände', () => {
  it('zeigt einen Ladehinweis', () => {
    mockDaten.laeuft = true;
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText(/werden von Google geladen/i)).toBeInTheDocument();
  });

  it('unterscheidet Ladefehler von „keine Eigenschaften"', () => {
    mockDaten.fehler = 'HTTP 503';
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText(/konnten gerade nicht von Google geladen/i)).toBeInTheDocument();
    expect(screen.queryByText(/bietet Google derzeit keine/i)).not.toBeInTheDocument();
  });

  it('sagt klar, wenn Google keine Eigenschaften anbietet', () => {
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText(/bietet Google derzeit keine Eigenschaften an/i)).toBeInTheDocument();
  });

  it('warnt, wenn nicht alle Seiten geladen wurden', () => {
    mockDaten.metadaten = [M('wifi', 'BOOL')];
    mockDaten.vollstaendig = false;
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText(/mehr Eigenschaften, als hier geladen/i)).toBeInTheDocument();
  });
});

describe('Datentypen', () => {
  it('stellt Ja/Nein als Schalter dar', async () => {
    mockDaten.metadaten = [M('wifi', 'BOOL', { displayName: 'WLAN' })];
    render(<AttributeEditor location={standort()} />);

    const feld = screen.getByLabelText('WLAN');
    expect(feld).toHaveAttribute('type', 'checkbox');
    await klicke(feld);
    expect(screen.getByText('Ja')).toBeInTheDocument();
  });

  it('stellt eine Auswahl mit Googles Anzeigenamen dar', () => {
    mockDaten.metadaten = [M('zugang', 'ENUM', {
      displayName: 'Zugang',
      valueMetadata: [
        { value: 'RAMP', displayName: 'Rampe' },
        { value: 'LIFT', displayName: 'Aufzug' },
      ],
    })];
    render(<AttributeEditor location={standort()} />);

    const feld = screen.getByLabelText('Zugang');
    expect(feld.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Rampe' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— keine Angabe —' })).toBeInTheDocument();
  });

  it('stellt eine Mehrfachauswahl dar', () => {
    mockDaten.metadaten = [M('services', 'REPEATED_ENUM', {
      displayName: 'Leistungen',
      valueMetadata: [{ value: 'A', displayName: 'Alpha' }, { value: 'B', displayName: 'Beta' }],
    })];
    render(<AttributeEditor location={standort()} />);

    expect(screen.getByLabelText('Leistungen: Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Leistungen: Beta')).toBeInTheDocument();
  });

  it('stellt eine URL als Textfeld dar', () => {
    mockDaten.metadaten = [M('menu', 'URL', { displayName: 'Speisekarte' })];
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByLabelText('Speisekarte')).toHaveAttribute('type', 'url');
  });
});

describe('Unbekannte Datentypen', () => {
  beforeEach(() => {
    mockDaten.metadaten = [
      M('wifi', 'BOOL', { displayName: 'WLAN' }),
      M('neu', 'GANZ_NEUER_TYP', { displayName: 'Etwas Neues' }),
    ];
  });

  it('zerstört die Seite nicht', () => {
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText('Etwas Neues')).toBeInTheDocument();
    expect(screen.getByLabelText('WLAN')).toBeInTheDocument();
  });

  it('stellt sie schreibgeschützt dar', () => {
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText('nur lesbar')).toBeInTheDocument();
    /* Der Typ steht an zwei Stellen: am Feld und im Hinweis oben.
       Beides ist gewollt. */
    expect(screen.getAllByText(/GANZ_NEUER_TYP/).length).toBeGreaterThan(0);
  });

  it('benennt sie oben, statt sie zu verschlucken', () => {
    render(<AttributeEditor location={standort()} />);
    expect(screen.getByText(/Datentyp.*noch nicht kennt|Datentypen.*noch nicht kennt/))
      .toBeInTheDocument();
  });

  it('protokolliert sie für den Betrieb', () => {
    render(<AttributeEditor location={standort()} />);
    const eintraege = console.warn.mock.calls.map((c) => String(c[0]));
    expect(eintraege.some((e) => e.includes('unbekannter_attributtyp'))).toBe(true);
    expect(eintraege.some((e) => e.includes('GANZ_NEUER_TYP'))).toBe(true);
  });
});

describe('Speichern', () => {
  beforeEach(() => {
    mockDaten.metadaten = [
      M('wifi', 'BOOL', { displayName: 'WLAN' }),
      M('parking', 'BOOL', { displayName: 'Parkplatz' }),
    ];
    mockDaten.gesetzt = [
      { name: 'attributes/wifi', values: [false] },
      { name: 'attributes/parking', values: [true] },
    ];
  });

  it('sendet ohne Änderung nichts', () => {
    render(<AttributeEditor location={standort()} />);
    expect(knopf()).toBeDisabled();
    expect(screen.getByText('Keine Änderungen.')).toBeInTheDocument();
  });

  it('sendet NUR das geänderte Attribut', async () => {
    /* Nicht geänderte Attribute dürfen nicht in der Maske landen —
       sonst schreibt Google sie mit. */
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    await klicke(knopf());

    await waitFor(() => expect(mockSpeichern).toHaveBeenCalled());
    const gesendet = mockSpeichern.mock.calls[0][0];

    expect(gesendet).toHaveLength(1);
    expect(gesendet[0].name).toBe('attributes/wifi');
    expect(gesendet[0].values).toEqual([true]);
  });

  it('sendet mehrere geänderte Attribute zusammen', async () => {
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    await klicke(screen.getByLabelText('Parkplatz'));
    await klicke(knopf());

    await waitFor(() => expect(mockSpeichern).toHaveBeenCalled());
    expect(mockSpeichern.mock.calls[0][0]).toHaveLength(2);
  });

  it('sendet nichts nach Hin- und Zurückändern', async () => {
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    expect(knopf()).not.toBeDisabled();

    await klicke(screen.getByLabelText('WLAN'));
    expect(knopf()).toBeDisabled();
  });

  it('sendet einen unbekannten Typ auch dann nicht mit', async () => {
    mockDaten.metadaten = [...mockDaten.metadaten, M('neu', 'GANZ_NEU', { displayName: 'Neu' })];
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    await klicke(knopf());

    await waitFor(() => expect(mockSpeichern).toHaveBeenCalled());
    expect(mockSpeichern.mock.calls[0][0].map((a) => a.name)).toEqual(['attributes/wifi']);
  });

  it('behauptet keine Veröffentlichung', async () => {
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    await klicke(knopf());

    expect(await screen.findByText(/An Google übermittelt/i)).toBeInTheDocument();
    expect(screen.getByText(/Veröffentlichung noch überprüfen/i)).toBeInTheDocument();
  });

  it('zeigt einen Fehler dauerhaft', async () => {
    mockSpeichern.mockRejectedValue(new Error('Google hat das Attribut abgelehnt.'));
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    await klicke(knopf());

    expect(await screen.findByRole('alert')).toHaveTextContent(/abgelehnt/);
  });

  it('stellt eine Antwort ohne confirmed nicht als Erfolg dar', async () => {
    mockSpeichern.mockResolvedValue({ confirmed: false });
    render(<AttributeEditor location={standort()} />);
    await klicke(screen.getByLabelText('WLAN'));
    await klicke(knopf());

    expect(await screen.findByRole('alert')).toHaveTextContent(/nicht bestätigt/i);
  });
});

describe('Sperre', () => {
  it('sperrt alles ohne Voice of Merchant', () => {
    mockDaten.metadaten = [M('wifi', 'BOOL', { displayName: 'WLAN' })];
    render(<AttributeEditor location={standort({ hasVoiceOfMerchant: false })} />);

    expect(screen.getByLabelText('WLAN')).toBeDisabled();
    expect(knopf()).toBeDisabled();
  });
});
