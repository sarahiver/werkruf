/**
 * Einrichtungsfortschritt — ehrliche Anzeige statt erfundener Prozente
 *
 * ═══════════════════════════════════════════════════════════════
 * ANLASS
 * ═══════════════════════════════════════════════════════════════
 *
 * Im UX-Durchgang am 20.10.2026 standen drei Dinge gleichzeitig auf
 * dem Bildschirm eines frisch verbundenen Kunden:
 *
 *   1. "Einrichtung läuft" — abgeleitet aus syncState === 'never',
 *      also aus "noch nie etwas erfolgreich". Das ist Abwesenheit,
 *      nicht Bewegung.
 *   2. Nach 120 s rot: "Das Laden deiner Betriebe dauert
 *      ungewöhnlich lange." Zwei Minuten später waren beide Betriebe
 *      da. Der Job war nie kaputt — die Seite war ungeduldiger als
 *      der Worker-Takt von fünf Minuten.
 *   3. "Ein älterer Auftrag steht noch offen — sie bestimmen den
 *      Status oben nicht." Grammatisch kaputt, und inhaltlich eine
 *      Störungsmeldung über den planmäßigen Betrieb.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRUEFT WIRD — UND WARUM GEGENPROBEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Ein Test, der nur prüft, dass der Balken DA ist, wäre wertlos: Ein
 * Balken, der immer animiert, bestünde ihn. Die tragenden Prüfungen
 * sind deshalb die umgekehrten —
 *
 *   • kein animierter Balken, wenn nichts in Arbeit ist
 *   • keine Prozentzahl, auch nicht als aria-valuenow
 *   • keine Fehlermeldung an der alten Zwei-Minuten-Grenze
 *   • keine Stalled-Zeile während der Einrichtung
 */
import React from 'react';
import { render, act, screen, fireEvent } from '@testing-library/react';

import EinrichtungsFortschritt, {
  leiteEinrichtungAb, formatiereDauer, LANGSAM_AB_MS,
} from '../../components/dashboard/gb/EinrichtungsFortschritt';

/* ─────────────────────────────────────────────────────────────
   TEIL 1 — die reine Ableitung
   ───────────────────────────────────────────────────────────── */

const basis = {
  verbunden: true,
  importStatus: 'running',
  importJobStatus: 'queued',
  keineBetriebe: false,
  anzahlStandorte: 0,
  lastSyncedAt: null,
  laufenderJob: null,
  begonnenAm: '2026-10-20T13:00:00Z',
  jetzt: Date.parse('2026-10-20T13:00:30Z'),
};

describe('leiteEinrichtungAb — wann die Einrichtung überhaupt läuft', () => {
  it('läuft während des Standortimports', () => {
    expect(leiteEinrichtungAb(basis).aktiv).toBe(true);
  });

  it('läuft NICHT ohne verbundenes Konto', () => {
    /* Der alte Fehler: syncState === 'never' zeigte "Einrichtung
       läuft" auch dann, wenn gar kein Google-Konto verbunden war und
       folglich nichts laufen konnte. */
    expect(leiteEinrichtungAb({ ...basis, verbunden: false }).aktiv).toBe(false);
  });

  it('ist beendet, sobald der erste Abgleich erfolgreich war', () => {
    expect(leiteEinrichtungAb({
      ...basis, anzahlStandorte: 2, lastSyncedAt: '2026-10-20T13:05:00Z',
    }).aktiv).toBe(false);
  });

  it('ist beendet, wenn Google keine verwaltbaren Betriebe kennt', () => {
    /* Null Betriebe ist ein ERGEBNIS. Dafür steht der EmptyState auf
       der Seite, nicht ein weiterlaufender Balken. */
    expect(leiteEinrichtungAb({
      ...basis, importStatus: 'succeeded', keineBetriebe: true,
    }).aktiv).toBe(false);
  });

  it('ist beendet, wenn der Import gescheitert ist', () => {
    expect(leiteEinrichtungAb({ ...basis, importStatus: 'failed' }).aktiv).toBe(false);
  });
});

describe('leiteEinrichtungAb — Bewegung nur, wenn sich etwas bewegt', () => {
  it('meldet inArbeit, solange der Import läuft', () => {
    expect(leiteEinrichtungAb(basis).inArbeit).toBe(true);
  });

  /* ── GEGENPROBE, die den Balken ehrlich hält ── */
  it('meldet KEINE Arbeit, wenn kein Auftrag offen ist', () => {
    const e = leiteEinrichtungAb({
      ...basis,
      importStatus: 'succeeded',
      importJobStatus: 'succeeded',
      anzahlStandorte: 2,
      laufenderJob: null,
    });
    expect(e.aktiv).toBe(true);        // Bewertungen fehlen noch
    expect(e.inArbeit).toBe(false);    // aber es läuft gerade nichts
  });

  it('erkennt einen laufenden Bewertungsjob nach der Standortauswahl', () => {
    expect(leiteEinrichtungAb({
      ...basis,
      importStatus: 'succeeded', importJobStatus: 'succeeded',
      anzahlStandorte: 2,
      laufenderJob: { id: 'j', status: 'running' },
    }).inArbeit).toBe(true);
  });

  it('unterscheidet eingereiht von laufend', () => {
    expect(leiteEinrichtungAb({ ...basis, importJobStatus: 'queued' }).wartetAufWorker).toBe(true);
    expect(leiteEinrichtungAb({ ...basis, importJobStatus: 'running' }).wartetAufWorker).toBe(false);
  });
});

describe('leiteEinrichtungAb — Phasen folgen Tatsachen', () => {
  it('hakt Betriebe erst ab, wenn welche da sind', () => {
    const ohne = leiteEinrichtungAb(basis).schritte;
    expect(ohne.find((s) => s.id === 'konto').zustand).toBe('fertig');
    expect(ohne.find((s) => s.id === 'betriebe').zustand).toBe('aktiv');
    expect(ohne.find((s) => s.id === 'bewertungen').zustand).toBe('wartet');

    const mit = leiteEinrichtungAb({
      ...basis, importStatus: 'succeeded', anzahlStandorte: 2,
    }).schritte;
    expect(mit.find((s) => s.id === 'betriebe').zustand).toBe('fertig');
    expect(mit.find((s) => s.id === 'bewertungen').zustand).toBe('aktiv');
  });
});

describe('leiteEinrichtungAb — langsam erst, wenn es wirklich langsam ist', () => {
  it('gilt innerhalb der Taktung nicht als langsam', () => {
    /* Fünf Minuten Worker-Takt sind die Erklärung, nicht die
       Ausnahme. Eine Meldung hier wäre genau der Fehler vom 20.10. */
    const kurzVorSchwelle = leiteEinrichtungAb({
      ...basis,
      jetzt: Date.parse(basis.begonnenAm) + LANGSAM_AB_MS - 1000,
    });
    expect(kurzVorSchwelle.langsam).toBe(false);
  });

  it('gilt jenseits der Schwelle als langsam und nennt die Dauer', () => {
    const danach = leiteEinrichtungAb({
      ...basis,
      jetzt: Date.parse(basis.begonnenAm) + LANGSAM_AB_MS + 30000,
    });
    expect(danach.langsam).toBe(true);
    expect(formatiereDauer(danach.dauerMs)).toBe('6:30');
  });

  it('kommt ohne Startzeitpunkt ohne Dauer aus', () => {
    const e = leiteEinrichtungAb({ ...basis, begonnenAm: null });
    expect(e.dauerMs).toBeNull();
    expect(e.langsam).toBe(false);
    expect(formatiereDauer(e.dauerMs)).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 2 — die Darstellung
   ───────────────────────────────────────────────────────────── */

describe('EinrichtungsFortschritt — der Balken behauptet keine Strecke', () => {
  it('ist ein progressbar OHNE Prozentwert', () => {
    render(<EinrichtungsFortschritt einrichtung={leiteEinrichtungAb(basis)} />);
    const balken = screen.getByRole('progressbar');

    /* Das ist der Kern. aria-valuenow wäre eine Zahl, und eine Zahl
       hätten wir geraten: Der Standortimport ist EIN Job ohne
       Teilschritte. Ohne valuenow meldet der Screenreader
       "beschäftigt" statt eines erfundenen Fortschritts. */
    expect(balken).not.toHaveAttribute('aria-valuenow');
    expect(balken).toHaveAttribute('aria-busy', 'true');
  });

  it('meldet aria-busy false, wenn nichts in Arbeit ist', () => {
    render(<EinrichtungsFortschritt einrichtung={leiteEinrichtungAb({
      ...basis, importStatus: 'succeeded', importJobStatus: 'succeeded',
      anzahlStandorte: 2, laufenderJob: null,
    })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'false');
  });

  it('nennt bei eingereihtem Auftrag die Fünf-Minuten-Taktung', () => {
    render(<EinrichtungsFortschritt einrichtung={leiteEinrichtungAb(basis)} />);
    expect(screen.getByText(/alle fünf Minuten/i)).toBeInTheDocument();
    /* Kein "einen Moment" mehr: Das war die Formulierung, nach der
       der Kunde vier Minuten lang auf nichts gewartet hat. */
    expect(screen.queryByText(/dauert einen Moment/i)).not.toBeInTheDocument();
  });

  it('sagt beim laufenden Job, dass gerade geholt wird', () => {
    render(<EinrichtungsFortschritt einrichtung={leiteEinrichtungAb({
      ...basis, importJobStatus: 'running',
    })} />);
    expect(screen.getByText(/von Google geholt/i)).toBeInTheDocument();
  });

  it('nennt jenseits der Schwelle die Dauer, ohne einen Fehler zu behaupten', () => {
    render(<EinrichtungsFortschritt einrichtung={leiteEinrichtungAb({
      ...basis, jetzt: Date.parse(basis.begonnenAm) + LANGSAM_AB_MS + 30000,
    })} />);
    expect(screen.getByText(/seit 6:30/i)).toBeInTheDocument();
    expect(screen.getByText(/läuft im Hintergrund weiter/i)).toBeInTheDocument();
    /* Entscheidend: kein Fehlerwort. Ein wartender Auftrag ist keine
       Störung. */
    expect(screen.queryByText(/fehlgeschlagen|Fehler|ungewöhnlich/i)).not.toBeInTheDocument();
  });

  it('zeigt die drei Phasen mit ihrem Zustand', () => {
    const { container } = render(
      <EinrichtungsFortschritt einrichtung={leiteEinrichtungAb(basis)} />,
    );
    expect(container.querySelector('[data-schritt="konto"]')).toHaveAttribute('data-zustand', 'fertig');
    expect(container.querySelector('[data-schritt="betriebe"]')).toHaveAttribute('data-zustand', 'aktiv');
    expect(container.querySelector('[data-schritt="bewertungen"]')).toHaveAttribute('data-zustand', 'wartet');
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 3 — im Dashboard
   ───────────────────────────────────────────────────────────── */

jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
jest.mock('../../hooks/useGoogleBusinessData', () => ({
  useGoogleBusinessData: jest.fn(),
}));
/* Veraenderbar, damit der Fall "gar nicht verbunden" pruefbar ist.
   Der Name muss mit "mock" beginnen — sonst verweigert Jest den
   Zugriff aus der hochgezogenen Fabrik. */
let mockVerbindung = { isConnected: true, loading: false, busy: false, error: null, connect: jest.fn() };
jest.mock('../../hooks/useGoogleBusiness', () => ({
  __esModule: true,
  useGoogleBusiness: () => mockVerbindung,
  default: () => mockVerbindung,
}));
/* 23.10.2026 (WP2): Die Seite liest jetzt das Profil fuer den
   Onboarding-Zustand. Hier ein Bestandskunde — Einrichtung
   abgeschlossen —, damit kein Auto-Start und kein Sprung ins
   Dashboard die bestehenden Pruefungen beeinflusst. */
/* Die Seite ruft seit WP2 useNavigate() fuer den Sprung ins
   Dashboard nach der Einrichtung. Diese Tests rendern ohne Router. */
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuthContext: () => ({
    profile: { id: 'u1', onboarding_completed_at: '2026-10-01T00:00:00Z' },
    profileLoading: false, profileError: null, refreshProfile: jest.fn(),
  }),
}));
jest.mock('../../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF' } }),
}));
jest.mock('../../components/dashboard/GoogleBusinessConnect', () => ({
  __esModule: true, default: () => null,
}));

const { useGoogleBusinessData } = require('../../hooks/useGoogleBusinessData');
const DashboardGoogleBusiness = require('./DashboardGoogleBusiness').default;

const refresh = jest.fn();
const triggerSync = jest.fn(() => Promise.resolve({}));

const standort = (id, titel) => ({
  id, title: titel, locality: 'Hamburg',
  selected_at: '2026-10-20T13:00:00Z', is_primary: true,
  last_synced_at: '2026-10-20T13:00:00Z', google_media: [],
});

function zustand(ueberschreibung = {}) {
  return {
    locations: [],
    stats: { totalReviews: 0, averageRating: null, unanswered: 0, distribution: {}, newestReviewAt: null, photoCount: 0 },
    replyCounts: { draft: 0, approved: 0, published: 0, failed: 0 },
    lastSyncedAt: null, latestJob: null, lastFailedJob: null,
    failedJobHistory: [], stalledJobs: [], runningJob: null,
    locationImport: { status: 'running', job: { id: 'imp', status: 'queued', created_at: new Date().toISOString() }, keineBetriebe: false },
    loading: false, refreshing: false, error: null,
    reload: jest.fn(), refresh, triggerSync,
    refreshJobStatus: jest.fn(), updateLocation: jest.fn(), selectLocation: jest.fn(),
    ...ueberschreibung,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  refresh.mockClear(); triggerSync.mockClear();
  triggerSync.mockImplementation(() => Promise.resolve({}));
  mockVerbindung = { isConnected: true, loading: false, busy: false, error: null, connect: jest.fn() };
});
afterEach(() => {
  jest.runOnlyPendingTimers(); jest.useRealTimers(); jest.clearAllMocks();
});

const vorspulen = (ms) => act(() => { jest.advanceTimersByTime(ms); });

describe('Dashboard — der Fortschritt ersetzt die alte Statuszeile', () => {
  it('zeigt während der Einrichtung die Fortschrittskarte', () => {
    useGoogleBusinessData.mockReturnValue(zustand());
    render(<DashboardGoogleBusiness />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Einrichtung läuft')).toBeInTheDocument();
  });

  it('zeigt sie NICHT, wenn der erste Abgleich durch ist', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [standort('l1', 'WERKRUF')],
      lastSyncedAt: '2026-10-20T13:05:00Z',
      locationImport: { status: 'succeeded', job: { id: 'imp', status: 'succeeded' }, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(/automatisch aktualisiert/i)).toBeInTheDocument();
  });

  it('zeigt ohne verbundenes Konto überhaupt keinen Status', () => {
    /* Gegenprobe zu meiner eigenen Annahme: Ich hielt es für möglich,
       dass "Einrichtung läuft" auch ohne Verbindung erscheint, weil
       syncState dann 'never' ist. Stimmt nicht — die Seite kehrt
       vorher mit der Verbinden-Karte zurück. Der Test hält das fest,
       damit ein späterer Umbau des frühen Returns nicht unbemerkt
       eine Statusmeldung über ein nicht verbundenes Konto erzeugt. */
    mockVerbindung = { isConnected: false, loading: false, busy: false, error: null, connect: jest.fn() };
    useGoogleBusinessData.mockReturnValue(zustand({
      locationImport: { status: 'none', job: null, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Einrichtung läuft')).not.toBeInTheDocument();
    expect(screen.queryByText(/Noch kein Abgleich/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/automatisch aktualisiert/i)).not.toBeInTheDocument();
  });

  it('läuft weiter, solange nach den Betrieben die Bewertungen fehlen', () => {
    /* Betriebe sind da, der erste Bewertungsabgleich steht aus. Das
       ist noch Einrichtung, auch wenn der Standortimport durch ist. */
    useGoogleBusinessData.mockReturnValue(zustand({
      locations: [standort('l1', 'WERKRUF')],
      lastSyncedAt: null,
      locationImport: { status: 'succeeded', job: { id: 'imp', status: 'succeeded' }, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);
    expect(screen.getByText('Einrichtung läuft')).toBeInTheDocument();
  });
});

describe('Dashboard — die Stalled-Zeile schweigt während der Einrichtung', () => {
  const zweiOffene = [
    { id: 'a', status: 'queued', created_at: '2026-10-20T13:00:00Z' },
  ];

  it('erscheint nicht, solange die Einrichtung läuft', () => {
    /* Ein zweiter offener Auftrag ist während der Einrichtung der
       Normalfall — Erstimport und stündlicher Scheduler. Dem Kunden
       in seiner ersten Minute als Störung gemeldet zu werden, war
       der Fehler. */
    useGoogleBusinessData.mockReturnValue(zustand({ stalledJobs: zweiOffene }));
    render(<DashboardGoogleBusiness />);
    expect(screen.queryByText(/älterer Auftrag steht noch offen/i)).not.toBeInTheDocument();
  });

  it('erscheint danach, und zwar grammatisch richtig', () => {
    useGoogleBusinessData.mockReturnValue(zustand({
      stalledJobs: zweiOffene,
      locations: [standort('l1', 'WERKRUF')],
      lastSyncedAt: '2026-10-20T13:05:00Z',
      locationImport: { status: 'succeeded', job: { id: 'imp', status: 'succeeded' }, keineBetriebe: false },
    }));
    render(<DashboardGoogleBusiness />);
    /* Vorher: "Ein älterer Auftrag steht noch offen — SIE bestimmen" */
    expect(screen.getByText(/er bestimmt den Status oben nicht/i)).toBeInTheDocument();
  });
});

describe('Dashboard — nach erschöpfter Geduld kein Fehler, sondern ein Knopf', () => {
  it('bietet erst am Ende "Jetzt nachsehen" an — und reiht dabei keinen Job ein', () => {
    useGoogleBusinessData.mockReturnValue(zustand());
    render(<DashboardGoogleBusiness />);

    /* Vorher nicht da: Solange die Seite selbst nachfragt, braucht
       niemand einen Knopf. */
    vorspulen(120000);
    expect(screen.queryByText(/Jetzt nachsehen/i)).not.toBeInTheDocument();

    /* 10 × 3 s + 15 × 10 s + 30 × 30 s = 1.080 s */
    vorspulen(1000000);
    expect(screen.getByText(/Jetzt nachsehen/i)).toBeInTheDocument();

    const vorher = refresh.mock.calls.length;
    fireEvent.click(screen.getByText(/Jetzt nachsehen/i));
    expect(refresh.mock.calls.length).toBe(vorher + 1);

    /* Der entscheidende Unterschied zum am 29.09. entfernten Knopf
       "Jetzt abgleichen": Dieser liest nur, er stößt nichts an.
       Keine Google-Quota, kein neuer Job. */
    expect(triggerSync).not.toHaveBeenCalled();
  });
});
