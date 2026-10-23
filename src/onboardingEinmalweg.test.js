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
  onboardingOffen, ABSICHT_SCHLUESSEL,
} = require('./utils/onboardingAbsicht');

/* 23.10.2026 (WP2): Die Absicht kommt aus dem Profil. OFFEN ist ein
   geladenes Profil ohne onboarding_completed_at; FERTIG eines mit. */
const OFFEN  = { isAuthenticated: true, profile: { id: 'u', onboarding_completed_at: null }, profileLoading: false, profileError: null };
const FERTIG = { isAuthenticated: true, profile: { id: 'u', onboarding_completed_at: '2026-10-01T00:00:00Z' }, profileLoading: false, profileError: null };

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  useAuthContext.mockReturnValue(OFFEN);
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

  it('T2/T3 — holt ihn auch OHNE sessionStorage ab (neuer Tab aus der Bestaetigungsmail)', async () => {
    /* Der E-Mail-Weg: Der Bestaetigungslink oeffnet einen neuen Tab.
       Dort gibt es keinen sessionStorage-Eintrag. Die Weiche muss
       trotzdem greifen — das ist der Kern von WP2. */
    window.sessionStorage.clear();
    zeige('/');
    expect(await screen.findByText('SEITE:onboarding')).toBeInTheDocument();
  });

  it('wartet, solange das Profil noch laedt — und wirft niemanden hinaus', async () => {
    useAuthContext.mockReturnValue({ ...OFFEN, profile: null, profileLoading: true });
    zeige('/');
    expect(screen.getByText('SEITE:start')).toBeInTheDocument();
    await waitFor(() => expect(getPostAuthDestination).not.toHaveBeenCalled());
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
    /* Bestandskunde: Profil als fertig markiert. Selbst ein
       liegengebliebener sessionStorage-Eintrag darf nichts ausloesen. */
    useAuthContext.mockReturnValue(FERTIG);
    setzeOnboardingAbsicht();
    zeige('/');
    expect(screen.getByText('SEITE:start')).toBeInTheDocument();
    await waitFor(() => expect(getPostAuthDestination).not.toHaveBeenCalled());
  });

  it('laesst einen ausgeloggten Besucher mit Absicht in Ruhe', async () => {
    /* Die Absicht allein genuegt nicht. Ohne Sitzung ist niemand da,
       den man weiterleiten koennte. */
    useAuthContext.mockReturnValue({ ...OFFEN, isAuthenticated: false });
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

  it('ist nach dem Loeschen weg — der Zaehler faengt neu an, das Profil entscheidet', () => {
    setzeOnboardingAbsicht();
    vermerkeVersuch();
    expect(hatOnboardingAbsicht()).toBe(true);
    expect(absichtDarfStarten()).toBe(false);
    loescheOnboardingAbsicht();
    expect(hatOnboardingAbsicht()).toBe(false);
    expect(window.sessionStorage.getItem(ABSICHT_SCHLUESSEL)).toBeNull();
    /* Kein Eintrag = null Versuche in diesem Tab. Ob ueberhaupt
       gestartet werden darf, sagt onboardingOffen() — siehe
       darfAutoStarten. */
    expect(absichtDarfStarten()).toBe(true);
  });

  it('ein neuer Tab ohne Eintrag darf genau einen Versuch — dann keinen mehr', () => {
    window.sessionStorage.clear();
    expect(absichtDarfStarten()).toBe(true);
    vermerkeVersuch();
    expect(absichtDarfStarten()).toBe(false);
    expect(JSON.parse(window.sessionStorage.getItem(ABSICHT_SCHLUESSEL)).versuche).toBe(1);
  });

  it('verfaellt nach einer halben Stunde', () => {
    /* Ein Tab kann tagelang offen liegen. Eine Absicht von heute
       Morgen soll heute Abend keinen Google-Dialog mehr oeffnen. */
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, JSON.stringify({
      gesetztAm: Date.now() - (31 * 60 * 1000),
      versuche: 0,
    }));
    expect(hatOnboardingAbsicht()).toBe(false);
    /* Verfallen = wie kein Eintrag: ein frischer Versuch. */
    expect(absichtDarfStarten()).toBe(true);
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

  it('wertet unlesbaren Speicher wie keinen Eintrag, aber falsche Typen als Sperre', () => {
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, '{');
    expect(absichtDarfStarten()).toBe(true);
    window.sessionStorage.setItem(ABSICHT_SCHLUESSEL, JSON.stringify({ gesetztAm: Date.now(), versuche: 'x' }));
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
    absichtAktiv: true,
    laeuft: false, beschaeftigt: false, verbunden: false,
    fehler: null, callbackFehler: false,
  };

  it('T2 — startet mit Absicht, wenn nichts dagegen spricht', () => {
    setzeOnboardingAbsicht();
    expect(darfAutoStarten(ruhe)).toBe(true);
  });

  it('T4/T7 — startet ohne offene Einrichtung nie — auch mit freiem Zaehler', () => {
    /* Der wichtigste Fall: Ein bestehender Kunde meldet sich an, um
       seine Bewertungen zu lesen. Er darf keinen Google-Dialog
       vorgesetzt bekommen — egal, was im sessionStorage liegt. */
    setzeOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, absichtAktiv: false })).toBe(false);
    expect(darfAutoStarten({ ...ruhe, absichtAktiv: undefined })).toBe(false);
  });

  it('T6 — startet im neuen Tab (Mail-Weg) ohne sessionStorage genau einmal', () => {
    window.sessionStorage.clear();
    expect(darfAutoStarten(ruhe)).toBe(true);
    vermerkeVersuch();
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

  it('T12 — nach Abschluss (Profil fertig) startet nichts mehr, auch nach Reload mit leerem Speicher', () => {
    loescheOnboardingAbsicht();
    expect(darfAutoStarten({ ...ruhe, absichtAktiv: onboardingOffen(FERTIG) })).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════
   onboardingOffen — die Absicht aus dem Profil
   ═══════════════════════════════════════════════════════════════ */
describe('onboardingOffen', () => {
  it('ist offen nur bei geladenem Profil ohne Abschluss', () => {
    expect(onboardingOffen(OFFEN)).toBe(true);
    expect(onboardingOffen(FERTIG)).toBe(false);
  });

  /* ── GEGENPROBE ── */
  it('ist NICHT offen, solange nichts entschieden ist: ladend, Fehler, keine Zeile, Spalte fehlt', () => {
    expect(onboardingOffen({ profile: null, profileLoading: true,  profileError: null })).toBe(false);
    expect(onboardingOffen({ profile: null, profileLoading: false, profileError: 'kaputt' })).toBe(false);
    expect(onboardingOffen({ profile: null, profileLoading: false, profileError: null })).toBe(false);
    /* Migration noch nicht da: Spalte fehlt im Objekt → nie raten. */
    expect(onboardingOffen({ profile: { id: 'u' }, profileLoading: false, profileError: null })).toBe(false);
  });
});
