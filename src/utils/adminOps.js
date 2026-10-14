/*
 * Admin-Support: die Regeln, einmal.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE DATEI EXISTIERT
 * ═══════════════════════════════════════════════════════════════
 *
 * H3 gibt dem Support vier Aktionen an die Hand, von denen drei
 * schreiben. Wer darf das, welche Aktionen gibt es, und was ist ein
 * gültiger Parameter — diese drei Fragen stehen hier und nicht in der
 * Edge Function.
 *
 * Der Grund ist derselbe wie bei src/utils/subscription.js: eine
 * Regel, die in einer Deno-Function steht, ist in diesem Repo nicht
 * testbar. `deno check` läuft hier nicht (esm.sh ist über den Proxy
 * nicht erreichbar), und ein Jest-Test könnte die Function nur als
 * TEXT lesen. Genau diese Art Test hat in H2.2 dreimal einen
 * Kommentar getroffen statt Code.
 *
 * Hier ist die Logik reines JavaScript ohne Abhängigkeiten. Jest ruft
 * sie auf; supabase/functions/admin-ops importiert sie über
 * ../../../src/utils/adminOps.js, so wie google-business es mit
 * accessGate.js tut.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER NICHT STEHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Kein Datenbankzugriff, kein fetch, kein Supabase-Client. Diese
 * Datei entscheidet und formt; geholt und geschrieben wird in der
 * Function. Das macht sie testbar und verhindert, dass der
 * Service-Role-Pfad versehentlich ins Frontend-Bundle wandert.
 */

import { hasPaidAccess, isFoundingPartner, wantsOperationalMail } from './subscription.js';

/* ═══════════════════════════════════════════════════════════════
   0 — DARSTELLUNG FUER DIE KUNDENLISTE
   ═══════════════════════════════════════════════════════════════

   Diese drei Funktionen gab es vor H3 schon. Sie standen in dieser
   Datei, und ich habe sie beim Anlegen des H3-Teils versehentlich
   ueberschrieben — aufgefallen ist das, weil die vorhandene Abnahme
   src/utils/adminOps.test.js sofort rot wurde. Sie ist hier die
   Quelle: die vier Zusagen dort beschreiben das Verhalten, und genau
   daran sind die Ruempfe wiederhergestellt.

   Was ich dabei NICHT getan habe: sie verbessern. Eine
   Wiederherstellung, die unterwegs die Logik aendert, ist keine. */

/**
 * Datum fuer die Admin-Tabelle. Unbekannt bleibt unbekannt.
 *
 * Kein Fallback auf "jetzt" und keine 1970er-Daten: ein Strich sagt
 * die Wahrheit, ein erfundenes Datum nicht.
 */
export function formatAdminDate(wert, mitZeit = false) {
  if (!wert) return '—';
  const datum = new Date(wert);
  if (Number.isNaN(datum.getTime())) return '—';

  return datum.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(mitZeit ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/**
 * Das akute Problem eines Kunden, in einem Satz.
 *
 * Reihenfolge ist der Inhalt: eine kaputte Google-Freigabe erzeugt
 * Folgefehler im Sync und in den Mails. Stuende der Sync-Fehler
 * vorne, wuerde der Support das Symptom lesen und die Ursache
 * suchen.
 */
export function getCustomerProblem(kunde) {
  if (kunde?.googleStatus === 'needs_reauth' || kunde?.googleStatus === 'broken') {
    return 'Google muss neu verbunden werden';
  }

  const syncFehler = kunde?.lastSyncError;
  if (syncFehler?.message) {
    return `${syncFehler.jobType || 'Sync'}: ${syncFehler.message}`;
  }
  if (syncFehler?.code) {
    return `${syncFehler.jobType || 'Sync'}: ${syncFehler.code}`;
  }

  if (kunde?.lastMail?.status === 'failed') {
    return `Mail fehlgeschlagen: ${kunde.lastMail.error_code || 'unbekannt'}`;
  }

  return 'Kein akutes Problem erkannt';
}

/**
 * Das Abo-Etikett fuer die Liste.
 *
 * `jetzt` ist injizierbar, damit "Trial aktiv" und "Trial
 * abgelaufen" pruefbar sind, ohne die Systemzeit zu stellen.
 */
export function getSubscriptionLabel(kunde, jetzt = Date.now()) {
  const trialEnde = kunde?.trialEndsAt ? Date.parse(kunde.trialEndsAt) : null;
  if (trialEnde && !Number.isNaN(trialEnde)) {
    return trialEnde > jetzt ? 'Trial aktiv' : 'Trial abgelaufen';
  }

  if (kunde?.plan === 'founding_partner') return 'Founding Partner';
  if (kunde?.stripeStatus) return `Stripe: ${kunde.stripeStatus}`;
  if (kunde?.plan === 'pro') return 'Pro aktiv';
  return 'Kein Abo';
}

/* ═══════════════════════════════════════════════════════════════
   1 — DIE ALLOWLIST
   ═══════════════════════════════════════════════════════════════

   §26 verbietet eine freie Action-Schnittstelle: kein execute_sql,
   kein table/column/value. Erlaubt ist genau, was hier steht.

   `schreibt` entscheidet, ob ein Audit-Eintrag entsteht (§22).
   `bestaetigung` ist ein Hinweis für die Oberfläche, nicht für den
   Server — der Server verlässt sich nie darauf, dass der Client
   gefragt hat. */
export const ADMIN_AKTIONEN = {
  list_customers: {
    schreibt: false,
    parameter: ['suche', 'limit'],
  },
  get_customer_support_state: {
    schreibt: false,
    parameter: ['userId'],
  },
  trigger_customer_sync: {
    schreibt: true,
    parameter: ['userId', 'locationId'],
    auditAktion: 'admin.sync_angestossen',
  },
  set_founding_partner: {
    schreibt: true,
    parameter: ['userId', 'note'],
    auditAktion: 'admin.founding_partner_gesetzt',
    bestaetigung: true,
  },
  clear_founding_partner: {
    schreibt: true,
    parameter: ['userId', 'plan'],
    auditAktion: 'admin.founding_partner_entzogen',
    bestaetigung: true,
  },
};

/* Nach dem Entziehen landet der Betrieb hier. 'free' ist der einzige
   Wert, der fachlich Sinn hat und den user_profiles_plan_check
   erlaubt; 'pro' wäre eine Zahlungsaussage ohne Zahlung. */
const ERLAUBTE_ZIELPLAENE = ['free'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ═══════════════════════════════════════════════════════════════
   2 — WER DARF
   ═══════════════════════════════════════════════════════════════ */

/**
 * Ist dieses Auth-Objekt ein Admin?
 *
 * Ausschliesslich app_metadata. user_metadata ist vom Client
 * schreibbar (supabase.auth.updateUser), app_metadata nicht — dort
 * schreibt nur die Service Role. Ein Nutzer, der sich
 * user_metadata.role = 'admin' setzt, kommt damit nicht weiter.
 *
 * Das ist derselbe Claim, den die RLS-Policies user_profiles_admin_read
 * und leads_admin_read prüfen. Eine Stelle mehr wäre eine Stelle, an
 * der es später auseinanderläuft.
 */
export function istAdmin(authUser) {
  return authUser?.app_metadata?.role === 'admin';
}

/**
 * Das vollständige Tor: Sitzung, Rolle, Aktion, Parameter.
 *
 * Gibt immer ein Urteil zurück und wirft nie — der Aufrufer macht
 * daraus einen HTTP-Status. Reihenfolge ist Absicht:
 *
 *   keine Sitzung      → 401
 *   kein Admin         → 403
 *   unbekannte Aktion  → 400
 *   schlechte Parameter→ 400
 *
 * 403 vor 400: ein Nicht-Admin soll nicht über Fehlermeldungen
 * herausfinden, welche Aktionen es gibt.
 */
/**
 * @typedef {object} Urteil
 * @property {boolean} erlaubt
 * @property {number} status
 * @property {string} [fehler]
 * @property {string} [aktion]
 * @property {Zeile} [regel]
 * @property {Record<string, any>} [parameter]
 */

/**
 * @param {object} eingabe
 * @param {Zeile|null} [eingabe.authUser]
 * @param {string} [eingabe.aktion]
 * @param {Record<string, any>} [eingabe.parameter]
 * @returns {Urteil}
 */
export function pruefeAnfrage({ authUser = null, aktion = '', parameter = {} }) {
  if (!authUser?.id) {
    return { erlaubt: false, status: 401, fehler: 'Nicht angemeldet' };
  }

  if (!istAdmin(authUser)) {
    return { erlaubt: false, status: 403, fehler: 'Kein Zugriff' };
  }

  const regel = Object.prototype.hasOwnProperty.call(ADMIN_AKTIONEN, aktion)
    ? ADMIN_AKTIONEN[aktion]
    : null;

  if (!regel) {
    return { erlaubt: false, status: 400, fehler: 'Unbekannte Aktion' };
  }

  const geprueft = pruefeParameter(aktion, parameter);
  if (geprueft.fehler) {
    return { erlaubt: false, status: 400, fehler: geprueft.fehler };
  }

  return { erlaubt: true, status: 200, aktion, regel, parameter: geprueft.werte };
}

/**
 * Parameter prüfen UND auf das Erlaubte reduzieren.
 *
 * Das Reduzieren ist der wichtigere Teil: was hier nicht
 * durchkommt, erreicht die Datenbank nicht. Ein mitgeschickter
 * `plan: 'pro'` bei trigger_customer_sync fällt damit weg, statt
 * irgendwo unten als Überraschung aufzutauchen.
 */
function pruefeParameter(aktion, roh) {
  const werte = {};

  const userId = roh?.userId;
  const brauchtUser = aktion !== 'list_customers';

  if (brauchtUser) {
    if (typeof userId !== 'string' || !UUID.test(userId)) {
      return { fehler: 'userId fehlt oder ist keine UUID' };
    }
    werte.userId = userId.toLowerCase();
  }

  if (aktion === 'list_customers') {
    const suche = typeof roh?.suche === 'string' ? roh.suche.trim() : '';
    if (suche.length > 200) {
      return { fehler: 'Suchbegriff zu lang' };
    }
    werte.suche = suche;

    /* §42: keine Vollabfrage. Ohne Angabe 25, höchstens 100 — und
       zwar serverseitig, nicht als Vorschlag an den Client. */
    const limit = Number(roh?.limit);
    werte.limit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 25;
  }

  if (aktion === 'trigger_customer_sync') {
    const locationId = roh?.locationId;
    if (locationId !== undefined && locationId !== null) {
      if (typeof locationId !== 'string' || !UUID.test(locationId)) {
        return { fehler: 'locationId ist keine UUID' };
      }
      werte.locationId = locationId.toLowerCase();
    } else {
      werte.locationId = null;
    }
  }

  if (aktion === 'set_founding_partner') {
    const note = roh?.note;
    if (note !== undefined && note !== null) {
      if (typeof note !== 'string' || note.length > 500) {
        return { fehler: 'Notiz muss Text unter 500 Zeichen sein' };
      }
      werte.note = note.trim() || null;
    } else {
      werte.note = null;
    }
  }

  if (aktion === 'clear_founding_partner') {
    const plan = roh?.plan === undefined || roh?.plan === null ? 'free' : roh.plan;
    if (!ERLAUBTE_ZIELPLAENE.includes(plan)) {
      return { fehler: `Zielplan nicht erlaubt: ${String(plan)}` };
    }
    werte.plan = plan;
  }

  return { werte };
}

/* ═══════════════════════════════════════════════════════════════
   3 — DER STANDORTIMPORT, EINE REGEL FUER BEIDE SEITEN
   ═══════════════════════════════════════════════════════════════ */

/**
 * In welchem Zustand ist der Standortimport?
 *
 * Diese Regel stand bis H3 nur in src/hooks/useGoogleBusinessData.js,
 * inline im Hook. Der Admin-Snapshot braucht dieselbe Antwort — und
 * eine zweite, nachgebaute Fassung waere genau das, was in H1 bei der
 * Zugangsregel schiefgegangen ist: vier Kopien, von denen zwei
 * vergessen wurden.
 *
 * Deshalb steht sie jetzt hier, und der Hook importiert sie.
 *
 *   none       noch nie ein Standortimport
 *   running    eingereiht oder laeuft
 *   succeeded  durchgelaufen — auch dann, wenn Google null Betriebe
 *              zurueckgab. Das ist ein Ergebnis, kein fehlender Lauf.
 *   failed     endgueltig gescheitert
 *
 * Abgeleitet wird aus den Jobs und nicht aus einer Ref im Bauteil:
 * eine Ref wird bei jedem Seitenaufbau zurueckgesetzt, und ein
 * erfolgreicher Import, der null Betriebe fand, loeste dadurch bei
 * jedem Reload einen neuen aus.
 *
 * @param {Array} importJobs sync_locations-Jobs, neueste zuerst
 * @param {number} anzahlStandorte aktive, nicht geloeschte Standorte
 */
export function leiteImportZustandAb(importJobs = [], anzahlStandorte = 0) {
  const letzter = importJobs?.[0] ?? null;

  const status = !letzter ? 'none'
    : (letzter.status === 'queued' || letzter.status === 'running') ? 'running'
    : letzter.status === 'succeeded' ? 'succeeded'
    : 'failed';

  return {
    job: letzter,
    status,
    /* Erfolgreich gelaufen, aber Google kennt keine verwaltbaren
       Betriebe. Eigener Zustand, kein Anlass fuer einen neuen
       Versuch. */
    keineBetriebe: letzter?.status === 'succeeded' && anzahlStandorte === 0,
  };
}

/* ═══════════════════════════════════════════════════════════════
   4 — DER SNAPSHOT
   ═══════════════════════════════════════════════════════════════ */

/**
 * Formt die geholten Zeilen zu einer Support-Ansicht.
 *
 * Reine Funktion, kein Datenbankzugriff — deshalb in Jest mit echten
 * Zeilenformen prüfbar, inklusive der Fälle, die in der Praxis weh
 * tun: null Standorte, mehrere Standorte, needs_reauth, kaputter
 * Sync.
 *
 * ── Was NICHT hineingeht (§23, §41) ──
 *
 * Keine OAuth-Tokens, kein Stripe-Secret, keine Action-Tokens, keine
 * vollständigen Auth-Objekte. Die Mailadresse ja, die ist für Support
 * nötig; `stripe_customer_id` nur als ja/nein plus die ID, weil man
 * sie im Stripe-Dashboard braucht.
 */
/**
 * @typedef {Record<string, any>} Zeile
 *   Eine Datenbankzeile, wie PostgREST sie liefert. Absichtlich lose:
 *   diese Funktion liest Felder und erfindet keine Struktur.
 */

/**
 * @param {object} eingabe
 * @param {Zeile|null} [eingabe.profil]
 * @param {string|null} [eingabe.authEmail]
 * @param {Zeile|null} [eingabe.konto]
 * @param {Zeile[]} [eingabe.standorte]
 * @param {Zeile[]} [eingabe.jobs]
 * @param {Zeile[]} [eingabe.mails]
 * @param {Zeile[]} [eingabe.events]
 * @param {Date} [eingabe.jetzt]
 * @returns {Zeile|null}
 */
export function baueSupportSnapshot({
  profil = null,
  authEmail = null,
  konto = null,
  standorte = [],
  jobs = [],
  mails = [],
  events = [],
  jetzt = new Date(),
} = {}) {
  if (!profil?.id) return null;

  const aktiveStandorte = (standorte || []).filter((s) => !s.deleted_at);
  const gewaehlt = aktiveStandorte.find((s) => s.selected_at) || null;

  /* §31: unbekannt ≠ 0 ≠ gesund. Kein Datenstand heisst "noch kein
     erfolgreicher Datenstand", nicht "alles gut". */
  const letzterErfolg = letzterErfolgreicherSync(jobs, aktiveStandorte);

  /* public.sync_runs hat KEIN user_id — es ist die Laufhistorie des
     Workers, nicht die eines Kunden (Spalten: worker_id, trigger,
     claimed, succeeded, failed). Nachgesehen am 14.10.2026. Ein
     "letzter Lauf dieses Kunden" laesst sich daraus nicht lesen, und
     ihn aus dem letzten globalen Lauf abzuleiten waere eine
     erfundene Zuordnung. Quelle ist deshalb ausschliesslich
     sync_jobs. */
  const importJobs = (jobs || []).filter((j) => j.job_type === 'sync_locations');
  const importZustand = leiteImportZustandAb(importJobs, aktiveStandorte.length);

  const googleVerbunden = Boolean(konto) && !konto.deleted_at;
  const keineStandorte = googleVerbunden
    && konto.status === 'active'
    && aktiveStandorte.length === 0;

  const snapshot = {
    user: {
      id: profil.id,
      email: authEmail,
      name: profil.full_name || null,
      unternehmen: profil.company_name || null,
      branche: profil.industry_key || null,
      registriertAm: profil.created_at || null,
    },
    entitlement: {
      plan: profil.plan || 'free',
      foundingPartner: isFoundingPartner(profil),
      foundingPartnerSeit: profil.founding_partner_since || null,
      foundingPartnerNotiz: profil.founding_partner_note || null,
      zugangAktuell: hasPaidAccess(profil, jetzt),
      operativeMailBerechtigt: wantsOperationalMail(profil, jetzt),
    },
    consent: {
      fassung: profil.accepted_terms_version || null,
      zugestimmtAm: profil.accepted_terms_at || null,
      liegtVor: Boolean(profil.accepted_terms_at),
    },
    googleAccount: googleVerbunden
      ? {
        vorhanden: true,
        status: konto.status || 'unbekannt',
        verbundenSeit: konto.connected_at || null,
        letzterFehlerCode: konto.last_error_code || null,
        letzterFehlerAm: konto.last_error_at || null,
        accountId: konto.id || null,
        standorteAktiv: aktiveStandorte.length,
        standorteGeloescht: (standorte || []).length - aktiveStandorte.length,
      }
      : { vorhanden: false, status: konto?.deleted_at ? 'deleted' : 'not_connected' },
    locations: aktiveStandorte.map((s) => ({
      id: s.id,
      titel: s.title || null,
      locality: s.locality || null,
      placeId: s.place_id || null,
      gewaehlt: Boolean(s.selected_at),
      gewaehltAm: s.selected_at || null,
      primaer: Boolean(s.is_primary),
      letzterSync: s.last_synced_at || null,
      bewertungen: zahlOderNull(s.review_count),
      rating: zahlOderNull(s.average_rating),
      /* google_locations hat keine Spalte photo_count. Die Fotos
         stehen in google_media, und genau dort zaehlt sie auch
         compute_location_health_score ('photoSource': 'google_media').
         Ist das Feld nicht geladen, bleibt es null — nicht 0 (§31). */
      fotos: Array.isArray(s.google_media) ? s.google_media.length : null,
    })),
    locationsGeloescht: (standorte || [])
      .filter((s) => s.deleted_at)
      .map((s) => ({ id: s.id, titel: s.title || null, geloeschtAm: s.deleted_at })),
    zeroLocations: keineStandorte
      ? {
        /* §9: Admin darf hier nicht nur "keine Daten" sehen.

           Der Importzustand kommt aus denselben sync_locations-Jobs,
           aus denen das Kundendashboard ihn ableitet — eine Regel,
           zwei Oberflaechen. */
        hinweis: 'Google verbunden, aber keine verwaltbaren Standorte gefunden',
        importStatus: importZustand.status,
        letzterVersuch: importZustand.job?.finished_at
          || importZustand.job?.created_at || null,
        letzterFehler: importZustand.job?.error_code || konto.last_error_code || null,
      }
      : null,
    sync: {
      letzterJob: (jobs || [])[0]?.updated_at || null,
      letzterJobStatus: (jobs || [])[0]?.status || null,
      letzterErfolg,
      datenstandBekannt: Boolean(letzterErfolg),
      laufendeJobs: (jobs || []).filter((j) => j.status === 'running' || j.status === 'queued').length,
      fehlgeschlageneJobs: (jobs || []).filter((j) => j.status === 'failed').length,
      letzterFehler: letzterJobFehler(jobs),
      jobs: (jobs || []).slice(0, 10).map((j) => ({
        id: j.id,
        art: j.job_type,
        status: j.status,
        locationId: j.location_id || null,
        versuche: j.attempts ?? null,
        maxVersuche: j.max_attempts ?? null,
        fehlerCode: j.error_code || null,
        beendetAm: j.finished_at || null,
        aktualisiertAm: j.updated_at || null,
      })),
    },
    engine: {
      offeneEvents: (events || []).length,
      events: (events || []).slice(0, 15).map((e) => ({
        id: e.id,
        typ: e.type,
        kategorie: e.category,
        klasse: e.recommendation_class || null,
        priority: e.priority ?? null,
        lifecycle: e.lifecycle,
        locationId: e.location_id || null,
        erstelltAm: e.created_at || null,
        imWeekly: Boolean(e.in_weekly_email),
        cooldownBis: e.cooldown_until || null,
      })),
      gewaehlterStandort: gewaehlt?.id || null,
    },
    communications: {
      letzteMails: (mails || []).slice(0, 10).map((m) => ({
        id: m.id,
        vorlage: m.template,
        status: m.status,
        empfaenger: m.to_email || null,
        geplantFuer: m.scheduled_for || null,
        gesendetAm: m.sent_at || null,
        versuche: m.attempts ?? null,
        fehlerCode: m.error_code || null,
      })),
      letzteNachVorlage: letzteNachVorlage(mails),
      offeneInQueue: (mails || []).filter((m) => m.status === 'queued' || m.status === 'sending').length,
      fehlgeschlagen: (mails || []).filter((m) => m.status === 'failed').length,
    },
    billing: {
      stripeKunde: Boolean(profil.stripe_customer_id),
      stripeCustomerId: profil.stripe_customer_id || null,
      stripeSubscriptionId: profil.stripe_subscription_id || null,
      stripeStatus: profil.stripe_subscription_status || null,
      kuendigungGeplant: profil.stripe_cancel_at_period_end === true,
      periodeEndet: profil.stripe_current_period_end || null,
      trialEndetAm: profil.trial_ends_at || null,
    },
  };

  snapshot.ampel = supportAmpel(snapshot);
  return snapshot;
}

/**
 * Eine sehr kleine Ampel (§32), ausschliesslich aus Zuständen, die
 * schon da sind. Kein neuer Health-Algorithmus, keine Gewichte.
 *
 * Blockiert heisst: der Kunde bekommt gerade nichts von WERKRUF.
 * Aufmerksamkeit heisst: läuft, aber etwas steht schief.
 */
export function supportAmpel(snapshot) {
  const gruende = [];

  if (!snapshot.googleAccount.vorhanden) {
    gruende.push({ stufe: 'blockiert', grund: 'Google nicht verbunden' });
  } else if (snapshot.googleAccount.status === 'needs_reauth') {
    gruende.push({ stufe: 'blockiert', grund: 'Google-Verbindung braucht neue Freigabe' });
  } else if (snapshot.googleAccount.status === 'broken') {
    gruende.push({ stufe: 'blockiert', grund: 'Google-Verbindung defekt' });
  }

  if (snapshot.zeroLocations) {
    gruende.push({ stufe: 'blockiert', grund: 'keine verwaltbaren Standorte' });
  }

  if (!snapshot.consent.liegtVor) {
    gruende.push({ stufe: 'aufmerksamkeit', grund: 'keine Zustimmung hinterlegt' });
  }

  if (!snapshot.sync.datenstandBekannt) {
    gruende.push({ stufe: 'aufmerksamkeit', grund: 'noch kein erfolgreicher Datenstand' });
  }

  if (snapshot.sync.fehlgeschlageneJobs > 0) {
    gruende.push({ stufe: 'aufmerksamkeit', grund: `${snapshot.sync.fehlgeschlageneJobs} fehlgeschlagene Sync-Jobs` });
  }

  if (snapshot.communications.fehlgeschlagen > 0) {
    gruende.push({ stufe: 'aufmerksamkeit', grund: `${snapshot.communications.fehlgeschlagen} fehlgeschlagene Mails` });
  }

  if (snapshot.billing.stripeStatus === 'past_due') {
    gruende.push({ stufe: 'aufmerksamkeit', grund: 'Zahlung offen (past_due)' });
  }

  const stufe = gruende.some((g) => g.stufe === 'blockiert')
    ? 'blockiert'
    : gruende.length > 0 ? 'aufmerksamkeit' : 'ok';

  return { stufe, gruende };
}

/* ═══════════════════════════════════════════════════════════════
   4 — AUDIT
   ═══════════════════════════════════════════════════════════════ */

/**
 * Der Audit-Eintrag zu einer Admin-Aktion.
 *
 * Passt auf die bestehende Tabelle public.audit_logs — kein zweites
 * Audit-System (§22). actor_type 'admin' ist dort erlaubt
 * (audit_logs_actor_type_check).
 *
 * `ergebnis` gehört mit hinein, auch bei Fehlschlag: ein Audit, das
 * nur Erfolge kennt, verschweigt die interessanten Fälle.
 */
/**
 * @param {object} eingabe
 * @param {string} eingabe.aktion
 * @param {string|null} eingabe.adminId
 * @param {string|null} eingabe.userId
 * @param {boolean} eingabe.erfolg
 * @param {unknown} [eingabe.ergebnis]
 * @param {unknown} [eingabe.fehler]
 * @returns {Zeile}
 */
export function baueAuditEintrag({ aktion, adminId, userId, erfolg, ergebnis = null, fehler = null }) {
  const regel = ADMIN_AKTIONEN[aktion];
  return {
    user_id: userId || null,
    actor_type: 'admin',
    actor_id: adminId || null,
    action: regel?.auditAktion || `admin.${aktion}`,
    entity_type: 'user_profiles',
    entity_id: userId || null,
    metadata: {
      aktion,
      erfolg: Boolean(erfolg),
      ...(ergebnis === null ? {} : { ergebnis }),
      ...(fehler === null ? {} : { fehler: String(fehler).slice(0, 500) }),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   5 — KLEINE HELFER
   ═══════════════════════════════════════════════════════════════ */

function zahlOderNull(wert) {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
}

/**
 * Der letzte erfolgreiche Datenstand.
 *
 * Zwei Quellen, weil keine allein reicht: ein erfolgreicher Job oder
 * ein last_synced_at am Standort. Der Job sagt "wir haben geholt",
 * der Standort sagt "es kam etwas an"; nach einem Pruning der
 * Jobhistorie bleibt nur das Zweite.
 *
 * Fehlen beide, ist die Antwort null — und null bedeutet im Snapshot
 * ausdrücklich "unbekannt", nicht "nie" und nicht "gesund" (§31).
 */
function letzterErfolgreicherSync(jobs, standorte) {
  const kandidaten = [
    ...(jobs || []).filter((j) => j.status === 'succeeded').map((j) => j.finished_at),
    ...(standorte || []).map((s) => s.last_synced_at),
  ].filter(Boolean);

  if (kandidaten.length === 0) return null;
  /* ISO-8601 in UTC sortiert als Text korrekt. Die Spalten sind
     timestamptz und kommen aus PostgREST als ...Z. */
  return kandidaten.sort().reverse()[0];
}

function letzterJobFehler(jobs) {
  const fehler = (jobs || []).find((j) => j.error_code);
  if (!fehler) return null;
  /* §24: brauchbarer Fehler, keine rohe Ausgabe. Code und Zeit
     helfen dem Support; die Meldung kann interne Details tragen und
     wird gekürzt. */
  return {
    code: fehler.error_code,
    am: fehler.finished_at || fehler.updated_at || null,
    art: fehler.job_type || null,
    meldung: typeof fehler.error_message === 'string'
      ? fehler.error_message.slice(0, 300)
      : null,
  };
}

/** Die jeweils letzte Mail je Vorlage — Weekly, Critical, Broken (§15). */
function letzteNachVorlage(mails) {
  const interessant = ['weekly_summary', 'critical_review_alert', 'connection_broken', 'payment_failed'];
  const ergebnis = {};
  interessant.forEach((vorlage) => {
    const treffer = (mails || []).find((m) => m.template === vorlage);
    ergebnis[vorlage] = treffer
      ? {
        status: treffer.status,
        gesendetAm: treffer.sent_at || null,
        geplantFuer: treffer.scheduled_for || null,
        fehlerCode: treffer.error_code || null,
      }
      : null;
  });
  return ergebnis;
}
