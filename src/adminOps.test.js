/**
 * Admin-Support: Tor, Allowlist, Snapshot, Audit (H3).
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE PRÜFUNGEN ETWAS WERT SIND
 * ═══════════════════════════════════════════════════════════════
 *
 * Sie rufen die Entscheidungen wirklich auf. Das ist der Grund, warum
 * die Regeln in src/utils/adminOps.js stehen und nicht in der Edge
 * Function: eine Deno-Function kann Jest nur als TEXT lesen, und in
 * H2.2 hat genau diese Art Prüfung dreimal einen Kommentar getroffen
 * statt Code — einmal mit dem Ergebnis, dass ein behobener Befund
 * unbemerkt blieb.
 *
 * Hier wird nichts gelesen, sondern ausgeführt.
 *
 * Was diese Datei NICHT prüfen kann: dass die Function die Regeln
 * auch benutzt. Dafür gibt es src/adminOpsFunction.test.js, und das
 * ist bewusst eine getrennte, kleinere Datei — damit niemand die
 * Textprüfungen mit den echten verwechselt.
 */
import {
  ADMIN_AKTIONEN,
  istAdmin,
  pruefeAnfrage,
  baueSupportSnapshot,
  supportAmpel,
  baueAuditEintrag,
  leiteImportZustandAb,
} from './utils/adminOps';

const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const ORT_1 = 'aaaaaaaa-1111-1111-1111-111111111111';
const ORT_2 = 'bbbbbbbb-2222-2222-2222-222222222222';

const admin = { id: 'ad000000-0000-0000-0000-000000000000', app_metadata: { role: 'admin' } };
const kunde = { id: ID_A, app_metadata: {} };

/* ═══════════════════════════════════════════════════════
   A — WER DARF (§34)
   ═══════════════════════════════════════════════════════ */

describe('Admin-Erkennung', () => {
  it('erkennt den Admin an app_metadata', () => {
    expect(istAdmin(admin)).toBe(true);
  });

  it('lässt sich von user_metadata nicht täuschen', () => {
    /* Der wichtigste Fall. user_metadata ist vom Client schreibbar
       (supabase.auth.updateUser), app_metadata nicht. Ein Nutzer, der
       sich selbst zum Admin erklärt, darf nicht durchkommen. */
    const gefaelscht = { id: ID_A, user_metadata: { role: 'admin' }, app_metadata: {} };
    expect(istAdmin(gefaelscht)).toBe(false);
    expect(pruefeAnfrage({ authUser: gefaelscht, aktion: 'list_customers' }).status).toBe(403);
  });

  it('erkennt eine andere Rolle nicht als Admin', () => {
    expect(istAdmin({ id: ID_A, app_metadata: { role: 'support' } })).toBe(false);
    expect(istAdmin({ id: ID_A, app_metadata: { role: 'Admin' } })).toBe(false);
  });

  it('kommt ohne Auth-Objekt klar', () => {
    expect(istAdmin(null)).toBe(false);
    expect(istAdmin(undefined)).toBe(false);
    expect(istAdmin({})).toBe(false);
  });
});

describe('das Tor', () => {
  it('ohne Sitzung 401', () => {
    expect(pruefeAnfrage({ authUser: null, aktion: 'list_customers' }))
      .toMatchObject({ erlaubt: false, status: 401 });
  });

  it('normaler Nutzer 403', () => {
    expect(pruefeAnfrage({ authUser: kunde, aktion: 'list_customers' }))
      .toMatchObject({ erlaubt: false, status: 403 });
  });

  it('Admin 200', () => {
    expect(pruefeAnfrage({ authUser: admin, aktion: 'list_customers' }))
      .toMatchObject({ erlaubt: true, status: 200 });
  });

  it('403 kommt vor 400', () => {
    /* Ein Nicht-Admin soll nicht über Fehlermeldungen herausfinden,
       welche Aktionen es gibt. Unbekannte Aktion + kein Admin = 403,
       nicht 400. */
    const urteil = pruefeAnfrage({ authUser: kunde, aktion: 'execute_sql' });
    expect(urteil.status).toBe(403);
    expect(urteil.fehler).not.toMatch(/Aktion/);
  });

  it('weist jede Aktion ab, die nicht auf der Allowlist steht (§26)', () => {
    for (const aktion of ['execute_sql', 'delete_user', 'update_table', 'refund', '', '__proto__']) {
      const urteil = pruefeAnfrage({ authUser: admin, aktion });
      expect(urteil.erlaubt).toBe(false);
      expect(urteil.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('hat keine destruktive Aktion in der Allowlist (§45)', () => {
    const namen = Object.keys(ADMIN_AKTIONEN).join(' ');
    expect(namen).not.toMatch(/delete|loesch|drop|truncate|purge|refund|cancel_subscription/i);
    expect(Object.keys(ADMIN_AKTIONEN).sort()).toEqual([
      'clear_founding_partner',
      'get_customer_support_state',
      'list_customers',
      /* 21.10.2026: Direkter Draht. Lesen und Statuswechsel — kein
         Loeschen, kein freier Schreibzugriff. */
      'list_support_requests',
      'set_founding_partner',
      'set_support_status',
      'trigger_customer_sync',
    ]);
  });
});

/* ═══════════════════════════════════════════════════════
   B — PARAMETER
   ═══════════════════════════════════════════════════════ */

describe('Parameterprüfung', () => {
  it('verlangt für kundenbezogene Aktionen eine UUID', () => {
    for (const aktion of ['get_customer_support_state', 'trigger_customer_sync',
      'set_founding_partner', 'clear_founding_partner']) {
      expect(pruefeAnfrage({ authUser: admin, aktion, parameter: {} }).status).toBe(400);
      expect(pruefeAnfrage({ authUser: admin, aktion, parameter: { userId: 'nein' } }).status).toBe(400);
      expect(pruefeAnfrage({ authUser: admin, aktion, parameter: { userId: ID_A } }).erlaubt).toBe(true);
    }
  });

  it('begrenzt das Limit serverseitig (§42)', () => {
    const mit = (limit) => pruefeAnfrage({
      authUser: admin, aktion: 'list_customers', parameter: { limit },
    }).parameter.limit;

    expect(mit(undefined)).toBe(25);
    expect(mit(10)).toBe(10);
    expect(mit(5000)).toBe(100);
    expect(mit(-3)).toBe(25);
    expect(mit('viele')).toBe(25);
  });

  it('reduziert auf die erlaubten Parameter', () => {
    /* Das Reduzieren ist der wichtigere Teil: was hier nicht
       durchkommt, erreicht die Datenbank nicht. */
    const urteil = pruefeAnfrage({
      authUser: admin,
      aktion: 'trigger_customer_sync',
      parameter: { userId: ID_A, locationId: ORT_1, plan: 'pro', table: 'user_profiles', sql: 'drop' },
    });
    expect(urteil.erlaubt).toBe(true);
    expect(Object.keys(urteil.parameter).sort()).toEqual(['locationId', 'userId']);
  });

  it('nimmt nur erlaubte Zielpläne beim Entziehen', () => {
    const mit = (plan) => pruefeAnfrage({
      authUser: admin, aktion: 'clear_founding_partner', parameter: { userId: ID_A, plan },
    });
    expect(mit(undefined).parameter.plan).toBe('free');
    expect(mit('free').parameter.plan).toBe('free');
    /* 'pro' wäre eine Zahlungsaussage ohne Zahlung. */
    expect(mit('pro').status).toBe(400);
    expect(mit('founding_partner').status).toBe(400);
    expect(mit('trial').status).toBe(400);
  });

  it('begrenzt Freitext', () => {
    expect(pruefeAnfrage({
      authUser: admin, aktion: 'set_founding_partner',
      parameter: { userId: ID_A, note: 'x'.repeat(501) },
    }).status).toBe(400);

    expect(pruefeAnfrage({
      authUser: admin, aktion: 'list_customers', parameter: { suche: 'x'.repeat(201) },
    }).status).toBe(400);
  });

  it('weist eine fremde locationId nicht hier ab, sondern prüft sie serverseitig', () => {
    /* Bewusst festgehalten: die Formprüfung kann nicht wissen, wem
       ein Standort gehört. Das entscheidet die Function gegen die
       Datenbank — geprüft in adminOpsFunction.test.js. */
    expect(pruefeAnfrage({
      authUser: admin, aktion: 'trigger_customer_sync',
      parameter: { userId: ID_A, locationId: ORT_2 },
    }).erlaubt).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════
   C — SNAPSHOT (§49)
   ═══════════════════════════════════════════════════════ */

const profil = (ueberschreibung = {}) => ({
  id: ID_A,
  company_name: 'Musterbetrieb',
  full_name: 'Iver Beispiel',
  industry_key: 'handwerk',
  created_at: '2026-09-01T10:00:00Z',
  plan: 'free',
  accepted_terms_at: '2026-09-01T10:05:00Z',
  accepted_terms_version: 'datenschutz-2026-09',
  ...ueberschreibung,
});

const kontoAktiv = {
  id: 'cc000000-0000-0000-0000-000000000000',
  status: 'active',
  connected_at: '2026-09-01T11:00:00Z',
  deleted_at: null,
};

const standort = (ueberschreibung = {}) => ({
  id: ORT_1,
  title: 'Musterbetrieb Hamburg',
  locality: 'Hamburg',
  place_id: 'ChIJ_test',
  is_primary: true,
  selected_at: '2026-09-02T09:00:00Z',
  last_synced_at: '2026-10-13T06:00:00Z',
  review_count: 42,
  average_rating: 4.6,
  google_media: [{}, {}, {}],
  deleted_at: null,
  ...ueberschreibung,
});

describe('Snapshot — Entitlement', () => {
  it('zeigt free ohne Zugang', () => {
    const s = baueSupportSnapshot({ profil: profil(), konto: kontoAktiv, standorte: [standort()] });
    expect(s.entitlement).toMatchObject({
      plan: 'free', foundingPartner: false, zugangAktuell: false, operativeMailBerechtigt: false,
    });
  });

  it('zeigt Founding Partner mit Zugang und Datum', () => {
    const s = baueSupportSnapshot({
      profil: profil({
        plan: 'founding_partner',
        founding_partner_since: '2026-10-01T08:00:00Z',
        founding_partner_note: 'Erster Partner',
      }),
      konto: kontoAktiv,
      standorte: [standort()],
    });
    expect(s.entitlement).toMatchObject({
      plan: 'founding_partner',
      foundingPartner: true,
      foundingPartnerSeit: '2026-10-01T08:00:00Z',
      foundingPartnerNotiz: 'Erster Partner',
      zugangAktuell: true,
      operativeMailBerechtigt: true,
    });
  });

  it('zeigt bei Founding Partner BEIDE Wahrheiten (§39)', () => {
    /* Entitlement und Stripe dürfen sich nicht gegenseitig
       überschreiben. Ein Founding Partner mit gekündigtem Altabo ist
       beides gleichzeitig. */
    const s = baueSupportSnapshot({
      profil: profil({
        plan: 'founding_partner',
        stripe_customer_id: 'cus_alt',
        stripe_subscription_id: 'sub_alt',
        stripe_subscription_status: 'canceled',
      }),
      konto: kontoAktiv,
      standorte: [standort()],
    });
    expect(s.entitlement.foundingPartner).toBe(true);
    expect(s.entitlement.zugangAktuell).toBe(true);
    expect(s.billing.stripeStatus).toBe('canceled');
    expect(s.billing.stripeKunde).toBe(true);
  });

  it('zeigt pro mit aktivem Abo', () => {
    const s = baueSupportSnapshot({
      profil: profil({
        plan: 'pro',
        stripe_customer_id: 'cus_pro',
        stripe_subscription_id: 'sub_pro',
        stripe_subscription_status: 'active',
        stripe_current_period_end: '2026-11-14T00:00:00Z',
      }),
      konto: kontoAktiv,
      standorte: [standort()],
    });
    expect(s.entitlement.zugangAktuell).toBe(true);
    expect(s.billing).toMatchObject({
      stripeStatus: 'active', kuendigungGeplant: false, periodeEndet: '2026-11-14T00:00:00Z',
    });
  });

  it('zeigt eine geplante Kündigung', () => {
    const s = baueSupportSnapshot({
      profil: profil({
        plan: 'pro',
        stripe_subscription_id: 'sub_pro',
        stripe_subscription_status: 'active',
        stripe_cancel_at_period_end: true,
        stripe_current_period_end: '2026-11-14T00:00:00Z',
      }),
      konto: kontoAktiv,
      standorte: [standort()],
    });
    expect(s.billing.kuendigungGeplant).toBe(true);
  });

  it('nennt fehlende Zustimmung', () => {
    const s = baueSupportSnapshot({
      profil: profil({ accepted_terms_at: null, accepted_terms_version: null }),
      konto: kontoAktiv,
      standorte: [standort()],
    });
    expect(s.consent).toEqual({ fassung: null, zugestimmtAm: null, liegtVor: false });
    expect(s.ampel.gruende.map((g) => g.grund)).toContain('keine Zustimmung hinterlegt');
  });
});

describe('Snapshot — Google und Standorte', () => {
  it('zeigt eine fehlende Verbindung als solche', () => {
    const s = baueSupportSnapshot({ profil: profil(), konto: null, standorte: [] });
    expect(s.googleAccount).toEqual({ vorhanden: false, status: 'not_connected' });
    expect(s.ampel.stufe).toBe('blockiert');
  });

  it('zeigt needs_reauth als Blocker', () => {
    const s = baueSupportSnapshot({
      profil: profil(),
      konto: { ...kontoAktiv, status: 'needs_reauth', last_error_code: 'invalid_grant', last_error_at: '2026-10-10T07:00:00Z' },
      standorte: [standort()],
    });
    expect(s.googleAccount).toMatchObject({
      status: 'needs_reauth', letzterFehlerCode: 'invalid_grant',
    });
    expect(s.ampel.stufe).toBe('blockiert');
    expect(s.ampel.gruende.map((g) => g.grund)).toContain('Google-Verbindung braucht neue Freigabe');
  });

  it('stellt mehrere Standorte dar und sagt, welcher gewählt ist (§37)', () => {
    const s = baueSupportSnapshot({
      profil: profil(),
      konto: kontoAktiv,
      standorte: [
        standort({ id: ORT_1, title: 'Hamburg', selected_at: null, is_primary: true }),
        standort({ id: ORT_2, title: 'Lübeck', selected_at: '2026-10-05T09:00:00Z', is_primary: false }),
      ],
    });
    expect(s.locations).toHaveLength(2);
    expect(s.locations.filter((l) => l.gewaehlt).map((l) => l.titel)).toEqual(['Lübeck']);
    expect(s.engine.gewaehlterStandort).toBe(ORT_2);
    expect(s.googleAccount.standorteAktiv).toBe(2);
  });

  it('führt gelöschte Standorte getrennt und nicht als aktiv', () => {
    const s = baueSupportSnapshot({
      profil: profil(),
      konto: kontoAktiv,
      standorte: [
        standort(),
        standort({ id: ORT_2, title: 'Alt', deleted_at: '2026-09-20T00:00:00Z' }),
      ],
    });
    expect(s.locations).toHaveLength(1);
    expect(s.locationsGeloescht).toEqual([
      { id: ORT_2, titel: 'Alt', geloeschtAm: '2026-09-20T00:00:00Z' },
    ]);
    expect(s.googleAccount.standorteGeloescht).toBe(1);
  });

  it('zählt Fotos aus google_media und erfindet keine Null', () => {
    const mit = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort()],
    });
    expect(mit.locations[0].fotos).toBe(3);

    const ohne = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort({ google_media: null })],
    });
    /* Nicht geladen heisst unbekannt, nicht "keine Fotos" (§31). */
    expect(ohne.locations[0].fotos).toBeNull();
  });
});

describe('Snapshot — Zero Locations (§9, §38)', () => {
  const ohneStandorte = (jobs = []) => baueSupportSnapshot({
    profil: profil(), konto: kontoAktiv, standorte: [], jobs,
  });

  it('sagt ausdrücklich, dass Google verbunden ist und keine Standorte da sind', () => {
    const s = ohneStandorte();
    expect(s.zeroLocations).not.toBeNull();
    expect(s.zeroLocations.hinweis)
      .toBe('Google verbunden, aber keine verwaltbaren Standorte gefunden');
    expect(s.ampel.stufe).toBe('blockiert');
  });

  it('zeigt den Importzustand und nicht nur "keine Daten"', () => {
    const s = ohneStandorte([
      { id: 'j1', job_type: 'sync_locations', status: 'succeeded', finished_at: '2026-10-13T06:00:00Z' },
    ]);
    expect(s.zeroLocations.importStatus).toBe('succeeded');
    expect(s.zeroLocations.letzterVersuch).toBe('2026-10-13T06:00:00Z');
  });

  it('unterscheidet nie gelaufen von erfolglos von gescheitert', () => {
    expect(ohneStandorte().zeroLocations.importStatus).toBe('none');
    expect(ohneStandorte([{ id: 'j', job_type: 'sync_locations', status: 'queued' }])
      .zeroLocations.importStatus).toBe('running');
    expect(ohneStandorte([{ id: 'j', job_type: 'sync_locations', status: 'failed', error_code: 'gbp_404' }])
      .zeroLocations.importStatus).toBe('failed');
    expect(ohneStandorte([{ id: 'j', job_type: 'sync_locations', status: 'failed', error_code: 'gbp_404' }])
      .zeroLocations.letzterFehler).toBe('gbp_404');
  });

  it('gibt keinen Score 0 und keinen Nullpointer', () => {
    const s = ohneStandorte();
    expect(s.locations).toEqual([]);
    expect(s.engine.gewaehlterStandort).toBeNull();
    expect(s.sync.datenstandBekannt).toBe(false);
    expect(s).not.toHaveProperty('healthScore');
  });

  it('zeigt zeroLocations NICHT bei einem Konto ohne active-Status', () => {
    /* needs_reauth plus keine Standorte ist ein anderer Befund: die
       Verbindung ist das Problem, nicht der Import. */
    const s = baueSupportSnapshot({
      profil: profil(), konto: { ...kontoAktiv, status: 'needs_reauth' }, standorte: [],
    });
    expect(s.zeroLocations).toBeNull();
  });
});

describe('Snapshot — Sync (§10, §31)', () => {
  it('nennt keinen Datenstand, wenn keiner da ist', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv,
      standorte: [standort({ last_synced_at: null })], jobs: [],
    });
    expect(s.sync.letzterErfolg).toBeNull();
    expect(s.sync.datenstandBekannt).toBe(false);
    expect(s.ampel.gruende.map((g) => g.grund)).toContain('noch kein erfolgreicher Datenstand');
  });

  it('nimmt den jüngsten Erfolg aus Jobs und Standorten', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv,
      standorte: [standort({ last_synced_at: '2026-10-13T06:00:00Z' })],
      jobs: [{ id: 'j1', job_type: 'sync_reviews', status: 'succeeded', finished_at: '2026-10-14T06:00:00Z' }],
    });
    expect(s.sync.letzterErfolg).toBe('2026-10-14T06:00:00Z');
    expect(s.sync.datenstandBekannt).toBe(true);
  });

  it('zeigt einen fehlgeschlagenen Sync mit Code und kürzt die Meldung (§24)', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort()],
      jobs: [{
        id: 'j1', job_type: 'sync_reviews', status: 'failed',
        error_code: 'google_reauth_required',
        error_message: 'x'.repeat(900),
        finished_at: '2026-10-14T05:00:00Z',
        attempts: 3, max_attempts: 3,
      }],
    });
    expect(s.sync.fehlgeschlageneJobs).toBe(1);
    expect(s.sync.letzterFehler).toMatchObject({
      code: 'google_reauth_required', am: '2026-10-14T05:00:00Z', art: 'sync_reviews',
    });
    expect(s.sync.letzterFehler.meldung).toHaveLength(300);
    expect(s.ampel.stufe).toBe('aufmerksamkeit');
  });

  it('zählt laufende Jobs', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort()],
      jobs: [
        { id: 'j1', job_type: 'sync_reviews', status: 'running' },
        { id: 'j2', job_type: 'sync_reviews', status: 'queued' },
        { id: 'j3', job_type: 'sync_reviews', status: 'succeeded', finished_at: '2026-10-14T06:00:00Z' },
      ],
    });
    expect(s.sync.laufendeJobs).toBe(2);
  });
});

describe('Snapshot — Engine und Kommunikation (§13, §15)', () => {
  it('zeigt offene Events verdichtet', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort()],
      events: [
        {
          id: 'e1', type: 'reviews.unanswered', category: 'reviews',
          recommendation_class: 'pflicht', priority: 88, lifecycle: 'new',
          location_id: ORT_1, created_at: '2026-10-13T07:00:00Z', in_weekly_email: true,
        },
        { id: 'e2', type: 'profile.photos_missing', category: 'profile', priority: 29, lifecycle: 'seen' },
      ],
    });
    expect(s.engine.offeneEvents).toBe(2);
    expect(s.engine.events[0]).toMatchObject({
      typ: 'reviews.unanswered', klasse: 'pflicht', priority: 88, imWeekly: true, locationId: ORT_1,
    });
  });

  it('zeigt die letzte Mail je Vorlage und den Queue-Zustand', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort()],
      mails: [
        { id: 'm1', template: 'weekly_summary', status: 'sent', to_email: 'chef@betrieb.test', sent_at: '2026-10-13T05:00:00Z' },
        { id: 'm2', template: 'critical_review_alert', status: 'failed', error_code: 'bounce', to_email: 'chef@betrieb.test' },
        { id: 'm3', template: 'weekly_summary', status: 'sent', sent_at: '2026-10-06T05:00:00Z' },
      ],
    });
    expect(s.communications.letzteNachVorlage.weekly_summary)
      .toMatchObject({ status: 'sent', gesendetAm: '2026-10-13T05:00:00Z' });
    expect(s.communications.letzteNachVorlage.critical_review_alert)
      .toMatchObject({ status: 'failed', fehlerCode: 'bounce' });
    expect(s.communications.letzteNachVorlage.connection_broken).toBeNull();
    expect(s.communications.fehlgeschlagen).toBe(1);
    expect(s.communications.letzteMails[0].empfaenger).toBe('chef@betrieb.test');
  });

  it('legt keinen Mailbody offen (§15)', () => {
    const s = baueSupportSnapshot({
      profil: profil(), konto: kontoAktiv, standorte: [standort()],
      mails: [{
        id: 'm1', template: 'weekly_summary', status: 'sent',
        payload: { geheim: 'ganzer Mailtext' }, dedupe_key: 'weekly:2026-41:u1',
      }],
    });
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/ganzer Mailtext/);
    expect(text).not.toMatch(/dedupe/i);
  });
});

describe('Snapshot — keine Geheimnisse (§23, §41)', () => {
  it('nimmt Tokens und Auth-Innereien nicht mit', () => {
    const s = baueSupportSnapshot({
      profil: {
        ...profil(),
        /* So etwas stünde nie in user_profiles — aber wenn die
           Abfrage eines Tages select('*') auf eine andere Tabelle
           macht, soll dieser Test es merken. */
        refresh_token: 'rt_geheim',
        access_token: 'at_geheim',
      },
      authEmail: 'chef@betrieb.test',
      konto: { ...kontoAktiv, confirmation_token: 'ct_geheim' },
      standorte: [standort()],
    });

    const text = JSON.stringify(s);
    expect(text).not.toMatch(/rt_geheim|at_geheim|ct_geheim/);
    expect(text).not.toMatch(/refresh_token|access_token|confirmation_token/);
    /* Die Mailadresse darf (§41). */
    expect(s.user.email).toBe('chef@betrieb.test');
  });

  it('gibt null statt eines leeren Snapshots ohne Profil', () => {
    expect(baueSupportSnapshot({ profil: null })).toBeNull();
    expect(baueSupportSnapshot({})).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════
   D — AMPEL (§32)
   ═══════════════════════════════════════════════════════ */

describe('Support-Ampel', () => {
  it('ist ok, wenn nichts auffällt', () => {
    const s = baueSupportSnapshot({
      profil: profil({ plan: 'pro', stripe_subscription_status: 'active', stripe_subscription_id: 'sub' }),
      konto: kontoAktiv,
      standorte: [standort()],
      jobs: [{ id: 'j', job_type: 'sync_reviews', status: 'succeeded', finished_at: '2026-10-14T06:00:00Z' }],
    });
    expect(s.ampel).toEqual({ stufe: 'ok', gruende: [] });
  });

  it('blockiert gewinnt über Aufmerksamkeit', () => {
    const s = baueSupportSnapshot({
      profil: profil({ accepted_terms_at: null }),
      konto: null,
      standorte: [],
    });
    expect(s.ampel.stufe).toBe('blockiert');
    expect(s.ampel.gruende.length).toBeGreaterThan(1);
  });

  it('nennt past_due als Aufmerksamkeit, nicht als Blocker', () => {
    /* past_due behält Zugang (H2.2 F). Blockiert wäre falsch. */
    const s = baueSupportSnapshot({
      profil: profil({ plan: 'pro', stripe_subscription_id: 'sub', stripe_subscription_status: 'past_due' }),
      konto: kontoAktiv,
      standorte: [standort()],
      jobs: [{ id: 'j', job_type: 'sync_reviews', status: 'succeeded', finished_at: '2026-10-14T06:00:00Z' }],
    });
    expect(s.ampel.stufe).toBe('aufmerksamkeit');
    expect(s.ampel.gruende.map((g) => g.grund)).toContain('Zahlung offen (past_due)');
  });

  it('erfindet keinen eigenen Score', () => {
    const s = baueSupportSnapshot({ profil: profil(), konto: kontoAktiv, standorte: [standort()] });
    expect(supportAmpel(s).stufe).toMatch(/^(ok|aufmerksamkeit|blockiert)$/);
    expect(s.ampel).not.toHaveProperty('punkte');
    expect(s.ampel).not.toHaveProperty('score');
  });
});

/* ═══════════════════════════════════════════════════════
   E — IMPORTREGEL, EINE FUER BEIDE SEITEN
   ═══════════════════════════════════════════════════════ */

describe('leiteImportZustandAb', () => {
  it('kennt die vier Zustände', () => {
    expect(leiteImportZustandAb([], 0).status).toBe('none');
    expect(leiteImportZustandAb([{ status: 'queued' }], 0).status).toBe('running');
    expect(leiteImportZustandAb([{ status: 'running' }], 0).status).toBe('running');
    expect(leiteImportZustandAb([{ status: 'succeeded' }], 2).status).toBe('succeeded');
    expect(leiteImportZustandAb([{ status: 'failed' }], 0).status).toBe('failed');
  });

  it('unterscheidet erfolgreich-ohne-Betriebe von nie gelaufen', () => {
    expect(leiteImportZustandAb([{ status: 'succeeded' }], 0).keineBetriebe).toBe(true);
    expect(leiteImportZustandAb([], 0).keineBetriebe).toBe(false);
    expect(leiteImportZustandAb([{ status: 'succeeded' }], 3).keineBetriebe).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
   F — AUDIT (§22)
   ═══════════════════════════════════════════════════════ */

describe('Audit-Eintrag', () => {
  it('passt auf public.audit_logs und nennt wer, wann, wen, was, Ergebnis', () => {
    const eintrag = baueAuditEintrag({
      aktion: 'set_founding_partner',
      adminId: admin.id,
      userId: ID_B,
      erfolg: true,
      ergebnis: { planVorher: 'free' },
    });

    /* created_at setzt die Datenbank (default now()) — "wann" kommt
       von dort und nicht aus dem Browser. */
    expect(eintrag).toEqual({
      user_id: ID_B,
      actor_type: 'admin',
      actor_id: admin.id,
      action: 'admin.founding_partner_gesetzt',
      entity_type: 'user_profiles',
      entity_id: ID_B,
      metadata: { aktion: 'set_founding_partner', erfolg: true, ergebnis: { planVorher: 'free' } },
    });
  });

  it('protokolliert auch den Fehlschlag', () => {
    const eintrag = baueAuditEintrag({
      aktion: 'trigger_customer_sync',
      adminId: admin.id, userId: ID_B, erfolg: false, fehler: 'kein_google_konto',
    });
    expect(eintrag.metadata).toEqual({
      aktion: 'trigger_customer_sync', erfolg: false, fehler: 'kein_google_konto',
    });
    expect(eintrag.action).toBe('admin.sync_angestossen');
  });

  it('kürzt lange Fehlertexte', () => {
    const eintrag = baueAuditEintrag({
      aktion: 'set_founding_partner', adminId: admin.id, userId: ID_B,
      erfolg: false, fehler: 'y'.repeat(2000),
    });
    expect(eintrag.metadata.fehler).toHaveLength(500);
  });

  it('hat für jede schreibende Aktion einen Audit-Namen', () => {
    Object.entries(ADMIN_AKTIONEN)
      .filter(([, regel]) => regel.schreibt)
      .forEach(([name, regel]) => {
        expect(regel.auditAktion).toMatch(/^admin\./);
        expect(baueAuditEintrag({ aktion: name, adminId: admin.id, userId: ID_B, erfolg: true }).action)
          .toBe(regel.auditAktion);
      });
  });

  it('kennzeichnet die beiden Aktionen, die eine Bestätigung brauchen (§20, §21)', () => {
    expect(ADMIN_AKTIONEN.set_founding_partner.bestaetigung).toBe(true);
    expect(ADMIN_AKTIONEN.clear_founding_partner.bestaetigung).toBe(true);
    expect(ADMIN_AKTIONEN.trigger_customer_sync.bestaetigung).toBeUndefined();
  });
});
