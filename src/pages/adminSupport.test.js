/**
 * Die Support-Ansicht im Admin (H3).
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRÜFT WIRD
 * ═══════════════════════════════════════════════════════════════
 *
 * Die gerenderte Seite, nicht der Quelltext — und vor allem: dass
 * jede schreibende Aktion über admin-ops geht und erst nach einer
 * Bestätigung, die den Kunden und seine Planlage nennt (§20, §21).
 *
 * Ein Klick, der sofort einen Founding Partner setzt, wäre genau das,
 * was §21 ausschliesst ("Nicht Ein-Klick-Toggle ohne Kontext").
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

import Admin from './Admin';

/* react-scripts setzt resetMocks: true — jede Implementierung muss in
   beforeEach stehen, nicht in der Factory. */
jest.mock('../context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

const { useAuthContext } = require('../context/AuthContext');
const supabase = require('../supabaseClient').default;

const KUNDE_ID = '11111111-1111-1111-1111-111111111111';
const ORT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

const listenZeile = (ueberschreibung = {}) => ({
  id: KUNDE_ID,
  unternehmen: 'Musterbetrieb',
  email: 'chef@betrieb.test',
  plan: 'free',
  stripeStatus: null,
  foundingPartnerSeit: null,
  consentVorhanden: true,
  registriertAm: '2026-09-01T10:00:00Z',
  googleStatus: 'active',
  ...ueberschreibung,
});

const schnappschuss = (ueberschreibung = {}) => ({
  user: {
    id: KUNDE_ID, email: 'chef@betrieb.test', name: 'Iver Beispiel',
    unternehmen: 'Musterbetrieb', branche: 'handwerk', registriertAm: '2026-09-01T10:00:00Z',
  },
  entitlement: {
    plan: 'free', foundingPartner: false, foundingPartnerSeit: null, foundingPartnerNotiz: null,
    zugangAktuell: false, operativeMailBerechtigt: false,
  },
  consent: { fassung: 'datenschutz-2026-09', zugestimmtAm: '2026-09-01T10:05:00Z', liegtVor: true },
  googleAccount: {
    vorhanden: true, status: 'active', verbundenSeit: '2026-09-01T11:00:00Z',
    letzterFehlerCode: null, letzterFehlerAm: null, standorteAktiv: 1, standorteGeloescht: 0,
  },
  locations: [{
    id: ORT_ID, titel: 'Musterbetrieb Hamburg', locality: 'Hamburg', placeId: 'ChIJ_test',
    gewaehlt: true, primaer: true, letzterSync: '2026-10-13T06:00:00Z',
    bewertungen: 42, rating: 4.6, fotos: 3,
  }],
  locationsGeloescht: [],
  zeroLocations: null,
  sync: {
    letzterJob: '2026-10-13T06:00:00Z', letzterJobStatus: 'succeeded',
    letzterErfolg: '2026-10-13T06:00:00Z', datenstandBekannt: true,
    laufendeJobs: 0, fehlgeschlageneJobs: 0, letzterFehler: null, jobs: [],
  },
  engine: { offeneEvents: 0, events: [], gewaehlterStandort: ORT_ID },
  communications: {
    letzteMails: [], offeneInQueue: 0, fehlgeschlagen: 0,
    letzteNachVorlage: {
      weekly_summary: null, critical_review_alert: null,
      connection_broken: null, payment_failed: null,
    },
  },
  billing: {
    stripeKunde: false, stripeCustomerId: null, stripeSubscriptionId: null,
    stripeStatus: null, kuendigungGeplant: false, periodeEndet: null, trialEndetAm: null,
  },
  ampel: { stufe: 'ok', gruende: [] },
  ...ueberschreibung,
});

let aufrufe;

const richteEin = ({ admin = true, snapshot = schnappschuss(), liste = [listenZeile()] } = {}) => {
  aufrufe = [];

  useAuthContext.mockImplementation(() => ({
    isAdmin: admin, signOut: jest.fn(), loading: false,
  }));

  supabase.from.mockImplementation(() => ({
    select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
  }));

  supabase.functions.invoke.mockImplementation((name, { body }) => {
    aufrufe.push({ name, ...body });
    if (body.action === 'list_customers') {
      return Promise.resolve({ data: { customers: liste }, error: null });
    }
    if (body.action === 'get_customer_support_state') {
      return Promise.resolve({ data: { snapshot }, error: null });
    }
    return Promise.resolve({ data: { ok: true, jobId: 'job-1', jobArt: 'sync_reviews' }, error: null });
  });
};

const zeige = async () => {
  await act(async () => { render(<Admin />); });
};

const oeffneSupportAnsicht = async () => {
  await act(async () => { fireEvent.click(screen.getByText('Support-Ansicht')); });
};

describe('Zugang (§33)', () => {
  it('rendert für einen normalen Nutzer nichts', async () => {
    richteEin({ admin: false });
    await zeige();

    expect(screen.queryByText('Kunde finden')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    /* Und holt auch keine Daten — die Oberfläche ist nicht der
       Schutz, aber sie soll es auch nicht versuchen. */
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

describe('Kundensuche (§5)', () => {
  it('lädt beim Öffnen die Liste ohne Suchbegriff', async () => {
    richteEin();
    await zeige();

    expect(aufrufe[0]).toMatchObject({
      name: 'admin-ops', action: 'list_customers', params: { suche: '', limit: 50 },
    });
    expect(screen.getByText('Musterbetrieb')).toBeInTheDocument();
    expect(screen.getByText('chef@betrieb.test')).toBeInTheDocument();
  });

  it('schickt den Suchbegriff an den Server, nicht in den Browser-Filter', async () => {
    /* Entscheidend: gesucht wird serverseitig. Ein Browser-Filter
       über eine Vollabfrage wäre §42 verletzt. */
    richteEin();
    await zeige();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Suche nach/), { target: { value: 'chef@betrieb.test' } });
      fireEvent.click(screen.getByText('Suchen'));
    });

    const suchaufruf = aufrufe.filter((a) => a.action === 'list_customers').pop();
    expect(suchaufruf.params).toMatchObject({ suche: 'chef@betrieb.test', limit: 50 });
  });

  it('sagt es, wenn nichts gefunden wurde', async () => {
    richteEin({ liste: [] });
    await zeige();
    expect(screen.getByText(/Keine Kunden gefunden/)).toBeInTheDocument();
  });
});

describe('Support-Ansicht (§6, §30)', () => {
  it('holt den Snapshot gezielt für diesen Kunden', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();

    expect(aufrufe.find((a) => a.action === 'get_customer_support_state').params)
      .toEqual({ userId: KUNDE_ID });
  });

  it('zeigt Identität, Entitlement, Zustimmung, Google, Sync und Billing', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();

    await waitFor(() => expect(screen.getByText('Identität')).toBeInTheDocument());
    expect(screen.getByText('Entitlement')).toBeInTheDocument();
    /* "Zustimmung" steht zweimal: als Spaltenkopf der Liste und als
       Blocktitel. getByText wirft bei zwei Treffern — die Aussage
       ist "kommt vor", nicht "kommt genau einmal vor". */
    expect(screen.getAllByText('Zustimmung').length).toBeGreaterThan(0);
    expect(screen.getByText('Google-Verbindung')).toBeInTheDocument();
    expect(screen.getByText('Datenstand / Sync')).toBeInTheDocument();
    expect(screen.getByText('Billing (nur lesend)')).toBeInTheDocument();
    expect(screen.getByText('Iver Beispiel')).toBeInTheDocument();
    expect(screen.getByText('datenschutz-2026-09')).toBeInTheDocument();
  });

  it('zeigt den gewählten Standort als gewählt (§8)', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();

    await waitFor(() => expect(screen.getByText('Musterbetrieb Hamburg')).toBeInTheDocument());
    expect(screen.getByText('gewählt')).toBeInTheDocument();
    expect(screen.getByText('ChIJ_test')).toBeInTheDocument();
  });

  it('macht Zero-Locations verständlich (§9, §38)', async () => {
    richteEin({
      snapshot: schnappschuss({
        locations: [],
        googleAccount: {
          vorhanden: true, status: 'active', verbundenSeit: '2026-09-01T11:00:00Z',
          letzterFehlerCode: null, letzterFehlerAm: null, standorteAktiv: 0, standorteGeloescht: 0,
        },
        zeroLocations: {
          hinweis: 'Google verbunden, aber keine verwaltbaren Standorte gefunden',
          importStatus: 'succeeded',
          letzterVersuch: '2026-10-13T06:00:00Z',
          letzterFehler: null,
        },
        ampel: { stufe: 'blockiert', gruende: [{ stufe: 'blockiert', grund: 'keine verwaltbaren Standorte' }] },
      }),
    });
    await zeige();
    await oeffneSupportAnsicht();

    await waitFor(() => expect(
      screen.getByText(/Google verbunden, aber keine verwaltbaren Standorte gefunden/),
    ).toBeInTheDocument());
    expect(screen.getByText(/Import: succeeded/)).toBeInTheDocument();
  });

  it('sagt bei fehlendem Datenstand nicht "alles gut" (§31)', async () => {
    richteEin({
      snapshot: schnappschuss({
        sync: {
          letzterJob: null, letzterJobStatus: null, letzterErfolg: null,
          datenstandBekannt: false, laufendeJobs: 0, fehlgeschlageneJobs: 0,
          letzterFehler: null, jobs: [],
        },
      }),
    });
    await zeige();
    await oeffneSupportAnsicht();

    await waitFor(() => expect(
      screen.getByText('noch kein erfolgreicher Datenstand'),
    ).toBeInTheDocument());
  });

  it('zeigt bei Founding Partner beide Wahrheiten (§39)', async () => {
    richteEin({
      snapshot: schnappschuss({
        entitlement: {
          plan: 'founding_partner', foundingPartner: true,
          foundingPartnerSeit: '2026-10-01T08:00:00Z', foundingPartnerNotiz: null,
          zugangAktuell: true, operativeMailBerechtigt: true,
        },
        billing: {
          stripeKunde: true, stripeCustomerId: 'cus_alt', stripeSubscriptionId: 'sub_alt',
          stripeStatus: 'canceled', kuendigungGeplant: false, periodeEndet: null, trialEndetAm: null,
        },
      }),
    });
    await zeige();
    await oeffneSupportAnsicht();

    await waitFor(() => expect(screen.getByText('founding_partner')).toBeInTheDocument());
    expect(screen.getByText('canceled')).toBeInTheDocument();
    expect(screen.getByText('cus_alt')).toBeInTheDocument();
  });
});

describe('Aktionen (§11, §19, §20, §21)', () => {
  it('stößt den Sync über admin-ops an, mit Kunden- und Standort-Scope', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(screen.getByText('Sichere Aktionen')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText('Jetzt synchronisieren')); });

    const sync = aufrufe.find((a) => a.action === 'trigger_customer_sync');
    expect(sync.params).toEqual({ userId: KUNDE_ID, locationId: ORT_ID });
    expect(screen.getByText(/Job eingereiht · sync_reviews · Job-ID job-1/)).toBeInTheDocument();
  });

  it('setzt Founding Partner NICHT mit einem Klick (§21)', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(screen.getByText('Sichere Aktionen')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Als Founding Partner freischalten'));
    });

    /* Der erste Klick darf nichts ausgelöst haben. */
    expect(aufrufe.find((a) => a.action === 'set_founding_partner')).toBeUndefined();

    /* Stattdessen eine Bestätigung, die den Kunden und seinen Plan
       nennt (§20). */
    expect(screen.getByText('Ja, ausführen')).toBeInTheDocument();
    expect(screen.getAllByText('Iver Beispiel').length).toBeGreaterThan(0);
    expect(screen.getByText(/Aktuell:/)).toBeInTheDocument();
  });

  it('führt erst nach der Bestätigung aus', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(screen.getByText('Sichere Aktionen')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText('Als Founding Partner freischalten')); });
    await act(async () => { fireEvent.click(screen.getByText('Ja, ausführen')); });

    expect(aufrufe.find((a) => a.action === 'set_founding_partner').params)
      .toEqual({ userId: KUNDE_ID });
  });

  it('bricht ab, ohne etwas zu tun', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(screen.getByText('Sichere Aktionen')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText('Als Founding Partner freischalten')); });
    await act(async () => { fireEvent.click(screen.getByText('Abbrechen')); });

    expect(aufrufe.find((a) => a.action === 'set_founding_partner')).toBeUndefined();
    expect(screen.queryByText('Ja, ausführen')).not.toBeInTheDocument();
  });

  it('nennt beim Entziehen die Folgen (§21)', async () => {
    richteEin({
      snapshot: schnappschuss({
        entitlement: {
          plan: 'founding_partner', foundingPartner: true,
          foundingPartnerSeit: '2026-10-01T08:00:00Z', foundingPartnerNotiz: null,
          zugangAktuell: true, operativeMailBerechtigt: true,
        },
      }),
    });
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(screen.getByText('Sichere Aktionen')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText('Founding Partner entziehen')); });

    expect(screen.getByText(/operative Mails hören auf/)).toBeInTheDocument();
    expect(screen.getByText(/Pro-Aktionen werden gesperrt/)).toBeInTheDocument();
    expect(aufrufe.find((a) => a.action === 'clear_founding_partner')).toBeUndefined();
  });

  it('bietet keine Google- oder Stripe-Änderung an (§12, §18, §45)', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(screen.getByText('Sichere Aktionen')).toBeInTheDocument());

    for (const verboten of [
      /öffnungszeiten/i, /bewertung beantworten/i, /foto löschen/i,
      /refund/i, /erstatten/i, /abo kündigen/i, /nutzer löschen/i, /queue leeren/i,
    ]) {
      expect(screen.queryAllByText(verboten)).toHaveLength(0);
    }
  });

  it('sagt, dass die Aktionen protokolliert werden (§22)', async () => {
    richteEin();
    await zeige();
    await oeffneSupportAnsicht();
    await waitFor(() => expect(
      screen.getByText(/in audit_logs protokolliert/),
    ).toBeInTheDocument());
  });
});
