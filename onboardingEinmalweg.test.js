/**
 * Der Neukundenpfad als EIN Weg.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS AM 19.10.2026 GEMESSEN WURDE
 * ═══════════════════════════════════════════════════════════════
 *
 * Ein neuer Nutzer klickt "Testphase starten", meldet sich bei
 * Google an — und landet auf der oeffentlichen Startseite. Einzige
 * sichtbare Aenderung: der Kopf-CTA springt von "Jetzt loslegen" auf
 * "Dashboard". Danach musste er selbst ins Dashboard, auf "Mein
 * Profil", und das Google-Konto ein zweites Mal verbinden.
 *
 * Die Weiche getPostAuthDestination() haette ihn richtig geleitet.
 * Sie wird aber nur von Signup.js und Login.js aufgerufen, und keine
 * davon ist montiert, wenn der Ruecksprung auf "/" endet.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRUEFT WIRD
 * ═══════════════════════════════════════════════════════════════
 *
 * Geprueft wird Verhalten, nicht Beschriftung. Die Pruefungen folgen
 * T1–T9 und den Gegenproben des Auftrags.
 *
 * Der schwierigste Teil ist nicht, dass der Weg funktioniert —
 * sondern dass er NICHT greift, wo er nicht soll: beim normalen
 * Login eines bestehenden Kunden, nach einer Ablehnung bei Google,
 * und ein zweites Mal.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('./context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('./utils/postAuthDestination', () => ({ getPostAuthDestination: jest.fn() }));

const { useAuthContext }        = require('./context/AuthContext');
const { getPostAuthDestination } = require('./utils/postAuthDestination');
const OnboardingWeiche = require('./components/auth/OnboardingWeiche').default;
const {
  setzeOnboardingAbsicht, hatOnboardingAbsicht, absichtDarfStarten,
  vermerkeVersuch, loescheOnboardingAbsicht, darfAutoStarten,
  ABSICHT_SCHLUESSEL,
} = require('./utils/onboardingAbsicht');

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  useAuthContext.mockReturnValue({ isAuthenticated: true });
  getPostAuthDestination.mockResolvedValue('/onboarding');
});

/* Zeigt an, wo der Router gerade steht — so laesst sich eine
   Weiterleitung pruefen, ohne navigate zu verspotten. */
const Sichtbar = ({ name }) => <div>SEITE:{name}</div>;

const zeige = (start) => render(
  <MemoryRouter initialEntries={[start]}>
    <OnboardingWeiche />
    <Routes>
      <Route path="/"            element={<Sichtbar name="start" />} />
      <Route path="/pricing"     element={<Sichtbar name="preise" />} />
      <Route path="/onboarding"  element={<Sichtbar name="onboarding" />} />
      <Route path="/dashboard"   element={<Sichtbar name="dashboard" />} />
      <Route path="/dashboard/google" element={<Sichtbar name="verbinden" />} />
      <Route path="/success"     element={<Sichtbar name="success" />} />
    </Routes>
  </MemoryRouter>,
);

/* ═══════════════════════════════════════════════════════════════
   T1 — neuer Nutzer, Auth erfolgreich
   ═══════════════════════════════════════════════════════════════ */

describe('T1 — der Flow kehrt nicht auf die oeffentliche Startseite zurueck', () => {
  it('schickt einen angemeldeten Nutzer mit Absicht von / weiter', async () => {
    setzeOnboardingAbsicht();
    zeige('/');
    expect(await screen.findByText('SEITE:onboarding')).toBeInTheDocument();
  });

  it('holt ihn auch von einer anderen oeffentlichen Seite ab', async () => {
    setzeOnboardingAbsicht();
    zeige('/pricing');
    expect(await screen.findByText('SEITE:onboarding')).toBeInTheDocument();
  });

  it('folgt dem Ziel der Weiche, statt es selbst zu bestimmen', async () => {
    /* Zustimmung liegt schon vor, Google fehlt noch — dann ist die
       Verbindungsseite richtig, nicht das Onboarding. */
    getPostAuthDestination.mockResolvedValue('/dashboard/google');
    setzeOnboardingAbsicht();
    zeige('/');
    expect(await screen.findByText('SEITE:verbinden')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════
   T7 + Gegenprobe — normaler Login darf nichts ausloesen
   ═══════════════════════════════════════════════════════════════ */

describe('T7 — ohne Absicht passiert nichts', () => {
  it('laesst einen angemeldeten Nutzer ohne Absicht auf der Startseite', async () => {
    zeige('/');
    expect(screen.getByText('SEITE:start')).toBeInTheDocument();
    await waitFor(() => expect(getPostAuthDestination).not.toHaveBeenCalled());
  });

  it('laesst einen ausgeloggten Besucher mit Absicht in Ruhe', async () => {
    /* Die Absicht allein genuegt nicht. Ohne Sitzung ist niemand da,
       den man weiterleiten koennte. */
    useAuthContext.mockReturnValue({ isAuthenticated: false });
    setzeOnboardingAbsicht();
    zeige('/');
    expect(screen.getByText('SEITE:start')).toBeInTheDocument();
    await waitFor(() => expect(getPostAuthDestination).not.toHaveBeenCalled());
  });

  it('fasst Seiten mit eigenem Zweck nicht an', async () => {
    /* /success traegt die Rueckkehr von Stripe. Wer hier umleitet,
       verschluckt die Bestaetigung eines bezahlten Abos. */
    setzeOnboardingAbsicht();
    zeige('/success');
    expect(screen.getByText('SEITE:success')).toBeInTheDocument();
    await waitFor(() => expect(getPostAuthDestination).not.toHaveBeenCalled());
  });
});

/* ═══════════════════════════════════════════════════════════════
   Gegenprobe — kann daraus eine Schleife werden?
   ═══════════════════════════════════════════════════════════════ */

describe('keine Weiterleitungsschleife', () => {
  it('leitet nicht auf die Seite, auf der man schon steht', async () => {
    /* Der gefaehrliche Fall: Die Weiche nennt genau den aktuellen
       Pfad. Ohne Sperre riefe navigate() sich selbst auf. */
    getPostAuthDestination.mockResolvedValue('/');
    setzeOnboardingAbsicht();
    zeige('/');
    await waitFor(() => expect(getPostAuthDestination).toHaveBeenCalled());
    expect(screen.getByText('SEITE:start')).toBeInTheDocument();
  });

  it('rechnet je Pfad hoechstens einmal', async () => {
    setzeOnboardingAbsicht();
    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <OnboardingWeiche />
        <Routes><Route path="/" element={<Sichtbar name="start" />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(getPostAuthDestination).toHaveBeenCalledTimes(1));
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <OnboardingWeiche />
        <Routes><Route path="/" element={<Sichtbar name="start" />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(getPostAuthDestination).toHaveBeenCalledTimes(1));
  });

  it('bleibt stehen, wenn die Weiche ausfaellt', async () => {
    /* Ein Ausfall darf nicht geraten werden. Stehenbleiben ist der
       alte Zustand — unbequem, aber nicht kaputt. */
    getPostAuthDestination.mockRejectedValue(new Error('Netz weg'));
    setzeOnboardingAbsicht();
    zeige('/');
    await waitFor(() => expect(getPostAuthDestination).toHaveBeenCalled());
    expect(screen.getByText('SEITE:start')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════
   T5 + T8 + Leitplanken — der Absichtsspeicher selbst
   ═══════════════════════════════════════════════════════════════ */

describe('die Onboarding-Absicht', () => {
  it('erlaubt genau einen selbst gestarteten Versuch', () => {
    setzeOnboardingAbsicht();
    expect(absichtDarfStarten()).toBe(true);
    vermerkeVersuch();
    /* T5: Nach einer Ablehnung bei Google kommt der Nutzer hierher
       zurueck. Ein zweiter Auto-Start waere die Schleife. */
    expect(absichtDarfStarten()).toBe(false);
    /* T8: Auch ein doppelt geoeffneter Callback startet nichts mehr. */
    expect(absichtDarfStarten()).toBe(false);
  });

  it('ist nach dem Loeschen weg — Leitplanke 1', () => {
    setzeOnboardingAbsicht();
    expect(hatOnboardingAbsicht()).toBe(true);
    loescheOnboardingAbsicht();
    expect(hatOnboardingAbsicht()).toBe(false);
    expect(absichtDarfStarten()).toBe(false);
    expect(window.sessionStorage.getItem(ABSICHT_SCHLUESSEL)).toBeNull();
  });

  it('verfaellt nach einer halben Stunde', () => {
    /* Ein Tab kann tagelang offen liegen. Eine Absicht von heute
       Morgen soll heute Abend keinen Google-Dialog mehr oeffnen. */
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, JSON.stringify({
      gesetztAm: Date.now() - (31 * 60 * 1000),
      versuche: 0,
    }));
    expect(hatOnboardingAbsicht()).toBe(false);
    expect(absichtDarfStarten()).toBe(false);
  });

  it('gibt einem erneuten Klick einen frischen Versuch', () => {
    /* Wer bewusst noch einmal "Testphase starten" klickt, meint es
       ernst — und darf nicht an einem verbrauchten Zaehler haengen. */
    setzeOnboardingAbsicht();
    vermerkeVersuch();
    expect(absichtDarfStarten()).toBe(false);
    setzeOnboardingAbsicht();
    expect(absichtDarfStarten()).toBe(true);
  });

  it('haelt Schrott im Speicher aus', () => {
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, 'kein json');
    expect(hatOnboardingAbsicht()).toBe(false);
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, JSON.stringify({ versuche: 0 }));
    expect(hatOnboardingAbsicht()).toBe(false);
  });

  it('startet nur bei Schrott im Speicher nicht', () => {
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, '{');
    expect(absichtDarfStarten()).toBe(false);
  });

  it('wirft nicht, wenn der Speicher gesperrt ist', () => {
    /* Privater Modus, blockierte Seitendaten, Vorschau: dort wirft
       schon das Lesen. Dann gibt es keine Absicht — und der alte Weg
       mit einem Klick mehr greift. */
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('gesperrt'); },
    });
    expect(() => setzeOnboardingAbsicht()).not.toThrow();
    expect(() => hatOnboardingAbsicht()).not.toThrow();
    expect(() => loescheOnboardingAbsicht()).not.toThrow();
    expect(hatOnboardingAbsicht()).toBe(false);
    if (original) Object.defineProperty(window, 'sessionStorage', original);
  });
});

/* ═══════════════════════════════════════════════════════════════
   T2 / T5 / T6 / T7 — die vier Sperren des Auto-Starts
   ═══════════════════════════════════════════════════════════════

   darfAutoStarten() ist die Entscheidung, die
   DashboardGoogleBusiness vor jedem selbst gestarteten OAuth
   trifft. Jede Sperre deckt einen Fall ab, der schon einmal
   schiefgegangen ist — deshalb hier einzeln und nicht als Ganzes. */

describe('darfAutoStarten', () => {
  const ruhe = {
    laeuft: false, beschaeftigt: false, verbunden: false,
    fehler: null, callbackFehler: false,
  };

  it('T2 — startet mit Absicht, wenn nichts dagegen spricht', () => {
    setzeOnboardingAbsicht();
    expect(darfAutoStarten(ruhe)).toBe(true);
  });

  it('T7 — startet ohne Absicht nie', () => {
    /* Der wichtigste Fall: Ein bestehender Kunde meldet sich an, um
       seine Bewertungen zu lesen. Er darf keinen Google-Dialog
       vorgesetzt bekommen. */
    expect(darfAutoStarten(ruhe)).toBe(false);
  });

  it('T6 — startet nicht, wenn Google schon verbunden ist', () => {
    setzeOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, verbunden: true })).toBe(false);
  });

  it('T5 — startet nach einem abgelehnten Ruecksprung nicht erneut', () => {
    /* Leitplanke 3: Nach oauth_denied hat der Nutzer bei Google Nein
       gesagt. Die Karte zeigt den Fehler und einen Knopf; den Klick
       macht er selbst. */
    setzeOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, callbackFehler: true })).toBe(false);
  });

  it('T5 — startet nicht, solange ein Fehler auf der Karte steht', () => {
    setzeOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, fehler: 'Zugriff abgebrochen' })).toBe(false);
  });

  it('startet nicht, solange der Status noch geladen wird', () => {
    /* Sonst waere der Start geraten: Ob schon eine Verbindung
       besteht, steht zu diesem Zeitpunkt noch nicht fest. */
    setzeOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, laeuft: true })).toBe(false);
  });

  it('startet nicht, solange schon etwas laeuft', () => {
    setzeOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, beschaeftigt: true })).toBe(false);
  });

  it('startet kein zweites Mal — Leitplanke 2', () => {
    setzeOnboardingAbsicht();
    expect(darfAutoStarten(ruhe)).toBe(true);
    vermerkeVersuch();
    expect(darfAutoStarten(ruhe)).toBe(false);
  });

  it('startet nach dem Loeschen der Absicht nicht mehr — Leitplanke 1', () => {
    setzeOnboardingAbsicht();
    loescheOnboardingAbsicht();
    expect(darfAutoStarten(ruhe)).toBe(false);
  });
});
