/**
 * Founding Partner in den Einstellungen (H2.2 C).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * H2.1 hat gemessen, was ein Founding Partner auf dieser Seite sah:
 *
 *   Badge     Free
 *   PlanName  founding_partner        (planLabels hatte keinen
 *                                      Eintrag, also der rohe
 *                                      Spaltenwert aus der Datenbank)
 *   CTA       Jetzt upgraden
 *   Fusszeile 30 Tage kostenlos — danach 49 € / Monat
 *
 * Vier falsche Aussagen auf einmal, gegenüber genau den Nutzern, die
 * als erste an WERKRUF geglaubt haben. Und mit einem
 * stripe_subscription_status 'trialing' aus einer früheren
 * Zahlerzeit zusätzlich die Trial-Fortschrittsleiste.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRÜFT WIRD UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Geprüft wird die gerenderte Seite, nicht der Quelltext. Ein Test,
 * der nach dem String 'founding_partner' in der Datei sucht, wäre
 * auch dann grün, wenn die Bedingung nie greift.
 *
 * Die fünf Fälle sind die aus §17 des Auftrags. Die beiden letzten
 * (pro, free) sind die Gegenprobe: die Founding-Partner-Darstellung
 * darf die bestehende Darstellung nicht verändert haben.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

import DashboardSettings from './DashboardSettings';

/* ── Mocks ──

   react-scripts setzt resetMocks: true. Jede Implementierung muss
   deshalb in beforeEach gesetzt werden, nicht in der Factory — sonst
   ist sie beim zweiten Test weg. Das hat in H1 schon einmal eine
   halbe Stunde gekostet (mailVersprechen.test.js). */
const mockProfil = { aktuell: null };

jest.mock('../../context/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));
jest.mock('../../hooks/useBetriebsname', () => ({
  useBetriebsname: jest.fn(),
}));
jest.mock('../../context/IndustryContext', () => ({
  useIndustry: jest.fn(),
}));
jest.mock('../../hooks/useCheckout', () => ({
  useCheckout: jest.fn(),
}));
jest.mock('../../components/dashboard/NotificationSettings', () => () => null);
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { functions: { invoke: jest.fn() } },
}));

const { useAuthContext }   = require('../../context/AuthContext');
const { useBetriebsname }  = require('../../hooks/useBetriebsname');
const { useIndustry }      = require('../../context/IndustryContext');
const { useCheckout }      = require('../../hooks/useCheckout');

const startCheckout = jest.fn();

beforeEach(() => {
  useAuthContext.mockImplementation(() => ({
    user:    { id: 'u1', email: 'chef@betrieb.test' },
    profile: mockProfil.aktuell,
  }));
  useBetriebsname.mockImplementation(() => ({ googleName: 'Musterbetrieb' }));
  useIndustry.mockImplementation(() => ({
    brand:   { name: 'WERKRUF' },
    pricing: { trialDays: 30, productName: 'WERKRUF Pro', monthly: 49 },
  }));
  useCheckout.mockImplementation(() => ({
    startCheckout, loading: false, error: '',
  }));
});

const zeige = (profile) => {
  mockProfil.aktuell = profile;
  return render(<DashboardSettings />);
};

/* Alles, was ein Founding Partner NICHT sehen darf. Einmal
   definiert, in allen drei Founding-Fällen geprüft — sonst prüft der
   dritte Fall versehentlich weniger als der erste. */
const darfNichtErscheinen = () => {
  /* queryAllByText und nicht queryByText: queryByText wirft, wenn
     MEHRERE Treffer da sind, und die Meldung sieht dann aus wie ein
     Testfehler statt wie ein Befund. Null Treffer ist die Aussage. */
  const keiner = (muster) =>
    expect(screen.queryAllByText(muster)).toHaveLength(0);

  keiner(/jetzt upgraden/i);
  keiner(/danach 49/i);
  keiner(/Tage kostenlos/i);
  keiner(/Trial-Fortschritt/i);
  keiner(/Tagen übrig/i);
  keiner('Free');
  /* Der rohe Spaltenwert. Genau das stand vorher als Planname da. */
  keiner('founding_partner');
  /* §14: kein Versprechen, das wir nicht halten können. */
  keiner(/lifetime/i);
  keiner(/für immer kostenlos/i);
};

describe('founding_partner ohne Stripe', () => {
  it('nennt den Plan richtig, zeigt das Founding-Badge und keine Upgrade-CTA', () => {
    zeige({ plan: 'founding_partner', company_name: 'Musterbetrieb' });

    expect(screen.getByText('Founding Partner', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Founding Partner', { selector: 'p' })).toBeInTheDocument();
    expect(
      screen.getByText('Kostenlos, solange du Teil des Founding-Partner-Programms bist.'),
    ).toBeInTheDocument();
    darfNichtErscheinen();
  });

  it('bietet kein Stripe-Portal an', () => {
    /* §16: nicht zum Portal drängen. Ohne Stripe-Kunde gibt es dort
       ohnehin nichts — ein Knopf dahin wäre eine Sackgasse. */
    zeige({ plan: 'founding_partner' });
    expect(screen.queryAllByText(/Abo & Zahlungen verwalten/i)).toHaveLength(0);
    expect(screen.queryAllByText(/Altes Abo bei Stripe/i)).toHaveLength(0);
  });
});

describe('founding_partner mit gekündigtem Stripe-Abo', () => {
  it('bleibt bei der Founding-Darstellung', () => {
    /* §15: Die Stripe-Historie gewinnt nicht. Vor H1 hätte der
       Stripe-Zweig hier 'canceled' ausgewertet und den Nutzer wie
       einen Free-Nutzer behandelt. */
    zeige({
      plan: 'founding_partner',
      stripe_customer_id: 'cus_alt',
      stripe_subscription_id: 'sub_alt',
      stripe_subscription_status: 'canceled',
    });

    expect(screen.getByText('Founding Partner', { selector: 'span' })).toBeInTheDocument();
    darfNichtErscheinen();
  });

  it('bietet das Portal nicht als "Abo verwalten" an', () => {
    zeige({
      plan: 'founding_partner',
      stripe_customer_id: 'cus_alt',
      stripe_subscription_status: 'canceled',
    });
    expect(screen.queryAllByText(/Abo & Zahlungen verwalten/i)).toHaveLength(0);
  });
});

describe('founding_partner mit stripe_customer_id', () => {
  it('zeigt keine Trial- oder Upgrade-Werbung', () => {
    /* Der unangenehmste Fall: trial_ends_at und ein
       trialing-Status aus der Zahlerzeit. Vorher erschien dadurch die
       Fortschrittsleiste samt "x von 30 Tagen übrig" — ein Ablauf,
       den es für diesen Zugang nicht gibt. */
    zeige({
      plan: 'founding_partner',
      stripe_customer_id: 'cus_alt',
      stripe_subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() + 3 * 864e5).toISOString(),
    });

    expect(screen.getByText('Founding Partner', { selector: 'span' })).toBeInTheDocument();
    darfNichtErscheinen();
    expect(screen.queryAllByText(/Test-Phase/i)).toHaveLength(0);
  });

  it('benennt ein noch laufendes Altabo statt es zu übergehen', () => {
    /* §16: "Wenn ein aktives Altabo parallel existiert, dokumentiere
       den Zustand statt ihn still zu ignorieren." Hier wird gerade
       Geld abgebucht für einen Zugang, der kostenlos ist. */
    zeige({
      plan: 'founding_partner',
      stripe_customer_id: 'cus_alt',
      stripe_subscription_id: 'sub_alt',
      stripe_subscription_status: 'active',
    });

    expect(screen.getByText(/Bei Stripe läuft noch ein Abo/i)).toBeInTheDocument();
    expect(screen.getByText(/brauchst du dafür nicht/i)).toBeInTheDocument();
    expect(screen.getByText(/Altes Abo bei Stripe prüfen/i)).toBeInTheDocument();
    /* Auch hier keine Zahlungsaufforderung. */
    darfNichtErscheinen();
  });

  it('schweigt über Stripe, wenn dort nichts mehr läuft', () => {
    /* Gegenprobe zum Fall darüber: ohne aktives Abo gibt es nichts zu
       melden, und eine Warnung ohne Anlass ist auch eine falsche
       Aussage. */
    zeige({
      plan: 'founding_partner',
      stripe_customer_id: 'cus_alt',
      stripe_subscription_status: 'canceled',
    });
    expect(screen.queryAllByText(/Bei Stripe läuft noch ein Abo/i)).toHaveLength(0);
  });
});

describe('Gegenprobe: pro und free bleiben unverändert', () => {
  it('zeigt pro weiterhin als aktiv mit Portal', () => {
    zeige({
      plan: 'pro',
      stripe_customer_id: 'cus_pro',
      stripe_subscription_id: 'sub_pro',
      stripe_subscription_status: 'active',
    });

    expect(screen.getByText('Aktiv')).toBeInTheDocument();
    expect(screen.getByText('WERKRUF Pro')).toBeInTheDocument();
    expect(screen.getByText(/Abo & Zahlungen verwalten/i)).toBeInTheDocument();
    expect(screen.queryAllByText('Founding Partner')).toHaveLength(0);
  });

  it('zeigt free weiterhin die Upgrade-Darstellung', () => {
    zeige({ plan: 'free' });

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Kostenloser Plan')).toBeInTheDocument();
    expect(screen.getByText(/Kein aktives Abo/i)).toBeInTheDocument();
    /* Der Knopf, nicht die Textzeile: "Kein aktives Abo — jetzt
       upgraden" trifft dasselbe Muster, und getByText wirft bei zwei
       Treffern. */
    expect(screen.getByRole('button', { name: /Jetzt upgraden/i })).toBeInTheDocument();
    expect(screen.getByText(/danach 49/i)).toBeInTheDocument();
    expect(screen.queryAllByText('Founding Partner')).toHaveLength(0);
  });

  it('zeigt der Test-Phase weiterhin die Fortschrittsleiste', () => {
    /* Die Leiste soll nicht verschwinden — sie soll nur nicht bei
       einem Founding Partner erscheinen. Ohne diese Prüfung wäre eine
       Haertung, die sie überall abschaltet, auch grün. */
    zeige({
      plan: 'pro',
      stripe_customer_id: 'cus_t',
      stripe_subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    });

    expect(screen.getByText(/Trial-Fortschritt/i)).toBeInTheDocument();
    expect(screen.getByText(/Tagen übrig/i)).toBeInTheDocument();
    expect(screen.getByText('Test-Phase')).toBeInTheDocument();
  });
});
