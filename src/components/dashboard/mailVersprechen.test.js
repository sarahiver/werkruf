/*
 * Was WERKRUF einem free-Betrieb über Mails sagt (Paket H1, P0 #4).
 *
 * ═══════════════════════════════════════════════════════════════
 * DIE ANDERE HÄLFTE DESSELBEN VERSPRECHENS
 * ═══════════════════════════════════════════════════════════════
 *
 * P0 #4 sperrt operative Mails für free — eine Mail „Jetzt antworten",
 * die auf eine Bezahlschranke führt, ist ein gebrochenes Versprechen.
 *
 * Damit entsteht sofort das umgekehrte: Zwei Stellen in der
 * Oberfläche kündigten diese Mails ohne jede Einschränkung an.
 *
 *   /dashboard             „Du bekommst montags eine Mail"
 *   /dashboard/einstellungen  Schalter für Wochenmail und
 *                             Sofortmeldungen
 *
 * Erst eine Mail versprechen, die nicht kommt, und dann eine
 * schicken, die nicht hilft — das ist dieselbe Unehrlichkeit in zwei
 * Richtungen. Diese Datei hält beide Stellen fest.
 *
 * Geprüft wird die Anzeige, nicht die Regel: Dass wantsOperationalMail
 * richtig entscheidet, steht in src/utils/entitlement.test.js, und
 * dass die SQL-Fassung dasselbe sagt, in src/utils/planGateSql.test.js.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

/* react-scripts setzt resetMocks: true — Implementierungen werden vor
   jedem Test geloescht. Deshalb wird die Abfragekette in beforeEach
   gesetzt und nicht in der Fabrik; sonst gibt from() undefined
   zurueck (erst so herausgefunden, als der Test rot war). */
const mockFrom = jest.fn();
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { from: (...a) => mockFrom(...a) },
}));

const leereAbfrage = () => ({
  select: () => ({
    eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    /* Seit 21.10.2026 liegt auf der Uebersicht der Direkte Draht; der
       liest fuer Founding Partner support_requests mit order().limit().
       Hier leer — diese Suite prueft Mails, nicht Support. */
    order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
  }),
});

const mockProfil = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => ({
    profile: mockProfil(), user: { id: 'u1' },
    profileLoading: false, profileError: null, refreshProfile: jest.fn(),
  }),
}));

/* Der Briefing-Hook zieht Verbindung, Daten und Engine mit. Für diese
   Datei zählt nur: nicht verbunden, denn nur dann rendert der Block
   „Was nach dem Verbinden passiert". */
const mockBriefing = jest.fn();
jest.mock('../../hooks/useDashboardBriefing', () => ({
  __esModule: true,
  useDashboardBriefing: () => mockBriefing(),
}));

jest.mock('../../hooks/useBetriebsname', () => ({
  __esModule: true,
  useBetriebsname: () => ({ name: 'Sanitaer Mueller', loading: false }),
}));

jest.mock('../../hooks/useHealthScore', () => ({
  __esModule: true,
  useHealthScore: () => ({ score: null, level: 'loading', factors: [], summary: '', headline: '' }),
}));

jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}));

import DashboardHome from '../../pages/dashboard/DashboardHome';
import NotificationSettings from './NotificationSettings';

const NICHT_VERBUNDEN = {
  status: { level: 'setup', headline: 'Noch nicht eingerichtet', detail: 'x' },
  actions: [], nextAction: null,
  healthScore: { score: null, level: 'loading', factors: [] },
  feedLaedt: false, feedFehler: null, feedNeuLaden: jest.fn(),
  standortAuswahlNoetig: false, ohneBetrieb: null, datenstand: null,
  melde: { gesehen: jest.fn(), geoeffnet: jest.fn(), weggeklickt: jest.fn() },
  isConnected: false, lastSyncedAt: null, runningJob: null,
  locations: [], stats: null, replyCounts: { published: 0 },
  loading: false, error: null, reload: jest.fn(),
};

beforeEach(() => {
  mockProfil.mockReset();
  mockBriefing.mockReset();
  mockFrom.mockReset();
  mockFrom.mockImplementation(leereAbfrage);
  mockBriefing.mockReturnValue(NICHT_VERBUNDEN);
});

describe('Übersicht: „Du bekommst montags eine Mail"', () => {

  it('schränkt das Versprechen für free ein', () => {
    mockProfil.mockReturnValue({ plan: 'free' });

    render(<DashboardHome />);

    expect(screen.getByText(/Du bekommst montags eine Mail/)).toBeInTheDocument();
    expect(screen.getByText(/gehören zum Pro-Zugang/)).toBeInTheDocument();
  });

  it('nennt dabei, was ohne Pro trotzdem kommt', () => {
    /* Sonst liest es sich wie "ohne Pro erfährst du nichts" — und das
       wäre falsch: connection_broken geht weiter an alle
       (Produktentscheidung 13.10.2026). */
    mockProfil.mockReturnValue({ plan: 'free' });

    render(<DashboardHome />);

    expect(screen.getByText(/Verbindung abgerissen ist, erfährst du in jedem Fall/))
      .toBeInTheDocument();
  });

  it.each([
    ['pro', { plan: 'pro' }],
    ['founding_partner', { plan: 'founding_partner' }],
    ['Etikett free, Abo aktiv', {
      plan: 'free', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active',
    }],
  ])('schränkt es für %s nicht ein', (_name, profil) => {
    mockProfil.mockReturnValue(profil);

    render(<DashboardHome />);

    expect(screen.getByText(/Du bekommst montags eine Mail/)).toBeInTheDocument();
    expect(screen.queryByText(/gehören zum Pro-Zugang/)).not.toBeInTheDocument();
  });
});

describe('Einstellungen: die Schalter für Mails', () => {

  it('sagt einem free-Betrieb, dass die Einstellung noch nicht greift', async () => {
    mockProfil.mockReturnValue({ plan: 'free' });

    render(<NotificationSettings />);

    expect(await screen.findByText(/greifen aber erst mit dem/)).toBeInTheDocument();
    /* Und die Schalter bleiben da — die Einstellung wird gespeichert
       und gilt, sobald der Zugang kommt. Sie zu verstecken hiesse,
       dem Kunden eine Entscheidung wegzunehmen. */
    expect(screen.getByText('Wochenmail, montags')).toBeInTheDocument();
  });

  it('zeigt dem Zahler keinen Hinweis', async () => {
    mockProfil.mockReturnValue({ plan: 'pro' });

    render(<NotificationSettings />);

    expect(await screen.findByText('Wochenmail, montags')).toBeInTheDocument();
    expect(screen.queryByText(/greifen aber erst mit dem/)).not.toBeInTheDocument();
  });

  it('zeigt dem Founding Partner keinen Hinweis', async () => {
    mockProfil.mockReturnValue({ plan: 'founding_partner' });

    render(<NotificationSettings />);

    expect(await screen.findByText('Wochenmail, montags')).toBeInTheDocument();
    expect(screen.queryByText(/greifen aber erst mit dem/)).not.toBeInTheDocument();
  });

  it('benutzt dieselbe Regel wie der Versand', () => {
    /* Keine zweite Vorstellung davon, wer Mails bekommt. Eine
       Quelltextprüfung, weil ein gemockter Hinweis darüber nichts
       sagen würde. */
    const fs = require('fs');
    const quelle = fs.readFileSync(
      'src/components/dashboard/NotificationSettings.js', 'utf8');

    expect(quelle).toMatch(/wantsOperationalMail/);
    expect(quelle).not.toMatch(/plan === 'pro'/);
    expect(quelle).not.toMatch(/'active',\s*'trialing'/);
  });
});
