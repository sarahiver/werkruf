/*
 * SmartCheck: Erfolg nur nach bestaetigter Speicherung (Paket H1).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE TESTS EXISTIEREN
 * ═══════════════════════════════════════════════════════════════
 *
 * Der alte Pfad war:
 *
 *   try { await supabase.from('leads').insert([...]); }
 *   catch(e) { console.error(e); }
 *   setPhase('sent');
 *
 * Drei Fehler, und der dritte ist der, den kein Test gefunden haette,
 * der nur auf "wird insert aufgerufen" prueft: der Supabase-Client
 * WIRFT bei einem Datenbankfehler nicht, er gibt { error } zurueck.
 * Der catch fing nie etwas. Es sah nach Fehlerbehandlung aus.
 *
 * Diese Datei prueft deshalb nicht, ob ein Aufruf passiert, sondern
 * was der Besucher am Ende SIEHT. Ein Test, der den Aufruf zaehlt,
 * waere beim alten Code gruen gewesen.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER NICHT GEPRUEFT WIRD
 * ═══════════════════════════════════════════════════════════════
 *
 * Dass RLS den direkten anon-Insert verweigert — das ist eine Aussage
 * ueber die Datenbank und steht in supabase/tests/smartcheckLead.test.sql.
 * Ein Jest-Test mit gemocktem Client koennte es nur behaupten.
 *
 * Rate-Limit und Validierung sitzen in der Edge Function; sie werden
 * hier ueber die Antwortcodes geprueft, nicht in ihrer Mechanik.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* ── Der Client wird gemockt, nicht die Komponente ──

   mockInvoke bekommt je Test eine andere Antwort. Wichtig: die Form der
   Antwort ist die ECHTE Form von supabase.functions.mockInvoke —
   bei 4xx/5xx ist data null und der Rumpf steckt in
   error.context als Response. Wer das anders mockt, testet seinen
   eigenen Mock. */
const mockInvoke = jest.fn();
jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: {
    functions: { invoke: (...args) => mockInvoke(...args) },
    /* from() ist absichtlich eine Falle: ruft die Komponente es doch
       noch auf, soll der Test laut scheitern und nicht still
       durchlaufen. */
    from: () => { throw new Error('SmartCheck darf nicht mehr direkt in die Datenbank schreiben'); },
  },
}));

/* Places-Autocomplete und die Google-Abfrage sind nicht Gegenstand
   dieser Tests. Beide werden durch das Minimum ersetzt, das die
   Komponente braucht, um in den Zustand "result" zu kommen. */
jest.mock('react-google-places-autocomplete', () => ({
  __esModule: true,
  default: ({ selectProps }) => (
    <button
      type="button"
      onClick={() => selectProps.onChange({
        label: 'Muster Sanitaer GmbH',
        value: { place_id: 'ChIJ_test_place_id_1234567890' },
      })}
    >
      Betrieb waehlen
    </button>
  ),
}));

/* ── window.google statt Modul-Mock ──

   fetchPlaceDetails ist KEIN Import, sondern in SmartCheck.js:26 lokal
   definiert und ruft window.google.maps.places.PlacesService. Ein
   jest.mock auf ein Modul geht daran vorbei — der erste Entwurf dieser
   Datei hat genau das versucht und scheiterte daran, dass die
   Komponente nach dem fehlgeschlagenen Abruf zurueck in den
   Suchzustand faellt (SmartCheck.js:388).

   Deshalb wird hier der Browser gestellt, nicht ein Modul. Damit
   laeuft der echte Codepfad der Komponente. */
const mockGetDetails = jest.fn();

function googleStellen() {
  window.google = {
    maps: {
      places: {
        PlacesService: function () { return { getDetails: mockGetDetails }; },
        PlacesServiceStatus: { OK: 'OK' },
      },
    },
  };
}

import SmartCheck from './SmartCheck';

const PLACE_DETAILS = {
  name: 'Muster Sanitaer GmbH',
  rating: 3.4,
  user_ratings_total: 12,
  website: null,
  address_components: [{ long_name: 'Hamburg', types: ['locality'] }],
};

/* Bringt die Komponente in den Zustand, in dem das E-Mail-Feld steht,
   und traegt eine Adresse ein. Danach fehlt nur der Klick. */
async function bisZumFormular() {
  mockGetDetails.mockImplementation((_anfrage, rueckruf) => rueckruf(PLACE_DETAILS, 'OK'));
  render(<SmartCheck />);
  fireEvent.click(screen.getByText('Betrieb waehlen'));

  /* Die Scan-Animation laeuft ueber Timer; auf das Formular warten
     statt eine Dauer zu raten. */
  const feld = await screen.findByPlaceholderText('deine@email.de', {}, { timeout: 10000 });
  fireEvent.change(feld, { target: { value: 'kunde@beispiel.de' } });
  return feld;
}

/* Baut eine Antwort in der Form, die mockInvoke bei einem Fehlerstatus
   wirklich liefert. */
const fehlerAntwort = (status, koerper) => ({
  data: null,
  error: Object.assign(new Error('FunctionsHttpError'), {
    context: new Response(JSON.stringify(koerper), {
      status, headers: { 'content-type': 'application/json' },
    }),
  }),
});

/* Ohne diesen Schluessel rendert SmartCheck statt des Suchfeldes ein
   Banner ("REACT_APP_GOOGLE_PLACES_API_KEY fehlt in .env", SmartCheck.js:537)
   und der Mock wird nie erreicht. Gefunden beim ersten Lauf dieser
   Datei — der Test scheiterte an "Betrieb waehlen nicht gefunden",
   nicht an der Komponente. */
process.env.REACT_APP_GOOGLE_PLACES_API_KEY = 'test-key';

beforeEach(() => {
  process.env.REACT_APP_GOOGLE_PLACES_API_KEY = 'test-key';
  mockInvoke.mockReset();
  mockGetDetails.mockReset();
  googleStellen();
  jest.useFakeTimers({ advanceTimers: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SmartCheck — Erfolg nur nach echter Speicherung', () => {

  it('zeigt Erfolg, wenn der Server stored: true bestaetigt', async () => {
    mockInvoke.mockResolvedValue({ data: { stored: true, leadId: 'abc' }, error: null });
    await bisZumFormular();

    fireEvent.click(screen.getByText(/Report anfordern/i));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    const [name, optionen] = mockInvoke.mock.calls[0];
    expect(name).toBe('smartcheck-lead');

    /* Die Nutzlast muss die Felder tragen, die der Endpunkt validiert —
       insbesondere placeId, die NICHT in result steht, sondern in der
       Auswahl. Genau das war beim Umbau die Fehlerquelle. */
    expect(optionen.body).toMatchObject({
      email: 'kunde@beispiel.de',
      companyName: 'Muster Sanitaer GmbH',
      city: 'Hamburg',
      placeId: 'ChIJ_test_place_id_1234567890',
    });

    expect(await screen.findByText(/Befund ist unterwegs|unterwegs|erhalten/i)).toBeInTheDocument();
  });

  /* ── Der Kern: kein Fake-Success ── */

  it.each([
    ['storage_failed', 500, /nicht speichern/i],
    ['rate_limited', 429, /zu viele Anfragen/i],
    ['invalid_email', 422, /E-Mail-Adresse/i],
    ['missing_company', 422, /konnte nicht übernommen/i],
  ])('zeigt bei %s KEINEN Erfolg, sondern einen Fehler', async (code, status, muster) => {
    mockInvoke.mockResolvedValue(fehlerAntwort(status, { error: code }));
    await bisZumFormular();

    fireEvent.click(screen.getByText(/Report anfordern/i));

    expect(await screen.findByText(muster)).toBeInTheDocument();
    /* Das Erfolgsfeld darf nicht erscheinen. */
    expect(screen.queryByText(/Befund ist unterwegs/i)).not.toBeInTheDocument();
    /* Und der Knopf muss wieder benutzbar sein — §8: Retry moeglich. */
    /* closest('button'), weil der Text in einem Kind des Knopfes steht. */
    expect(screen.getByText(/Report anfordern/i).closest('button')).not.toBeDisabled();
  });

  it('zeigt keinen Erfolg, wenn die Antwort stored nicht bestaetigt', async () => {
    /* Status 200, aber ohne stored: true. Der Fall, den ein Test
       uebersieht, der nur auf den HTTP-Status schaut. */
    mockInvoke.mockResolvedValue({ data: { leadId: 'abc' }, error: null });
    await bisZumFormular();

    fireEvent.click(screen.getByText(/Report anfordern/i));

    expect(await screen.findByText(/nicht speichern/i)).toBeInTheDocument();
    expect(screen.queryByText(/Befund ist unterwegs/i)).not.toBeInTheDocument();
  });

  it('zeigt keinen Erfolg, wenn die Verbindung scheitert (kein JSON im Fehler)', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('FunctionsFetchError'), { context: undefined }),
    });
    await bisZumFormular();

    fireEvent.click(screen.getByText(/Report anfordern/i));

    expect(await screen.findByText(/nicht speichern/i)).toBeInTheDocument();
    expect(screen.queryByText(/Befund ist unterwegs/i)).not.toBeInTheDocument();
  });

  it('behandelt einen doppelten Submit als Erfolg, nicht als Fehler', async () => {
    /* Der Endpunkt antwortet bei einem Lead, der binnen einer Stunde
       schon eingetragen wurde, mit stored: true + duplicate: true.
       Fuer den Besucher ist das ein Erfolg — sein Lead IST da. */
    mockInvoke.mockResolvedValue({
      data: { stored: true, duplicate: true, leadId: 'abc' }, error: null,
    });
    await bisZumFormular();

    fireEvent.click(screen.getByText(/Report anfordern/i));

    expect(await screen.findByText(/Befund ist unterwegs|unterwegs|erhalten/i)).toBeInTheDocument();

    /* Ohne diese Zeile besteht der Test auch den alten Code: der zeigte
       IMMER Erfolg, und "Erfolg" allein unterscheidet nicht zwischen
       "gespeichert" und "behauptet". Gegengeprueft am 13.10.2026 —
       vorher war dies einer von zwei Tests, die gegen den alten
       handleSubmit gruen blieben. */
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('prueft die E-Mail, bevor der Server gefragt wird', async () => {
    await bisZumFormular();
    const feld = screen.getByPlaceholderText('deine@email.de');
    fireEvent.change(feld, { target: { value: 'keine-mail' } });

    fireEvent.click(screen.getByText(/Report anfordern/i));

    expect(await screen.findByText(/gültige E-Mail/i)).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
