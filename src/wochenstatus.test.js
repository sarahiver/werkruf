/**
 * WP6 — Wochenstatus: „Alles geprueft" darf nicht luegen.
 *
 *   T1–T5   Zustandsableitung (real)
 *   T6–T9   Mail-Faelle A–E (reale HTML-Bausteine + Verdrahtung)
 *   T10–T13 Unveraendertes: CTA, max. 3 Aufgaben, Sofort- und
 *           Inaktivitaetsmail
 */
import fs from 'fs';
import path from 'path';
import {
  leiteWochenstatusAb, wasPassiertIst, passiertHtml, wochenstatusHtml, GEPRUEFT, SYNC_ALT_AB_STUNDEN,
} from './utils/wochenstatus';
import { baueGoogleWoche, googleWocheHtml } from './utils/googlePerformance';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const gesund = { connectionStatus: 'active', lastSyncedAt: '2026-11-09T06:00:00Z', syncAgeHours: 2.5, openCount: 0, dueCount: 0 };

describe('T1–T5 — Zustandsableitung', () => {
  it('T1: keine Aufgaben, alles gesund → ok_no_actions', () => {
    expect(leiteWochenstatusAb({ check: gesund, actions: [], weeklyState: 'all_clear' }))
      .toMatchObject({ state: 'ok_no_actions', quiet: false });
  });

  it('T2: Verbindung kaputt → connection_problem, auch mit Aufgaben, auch bei frischem Sync', () => {
    for (const status of ['needs_reauth', 'revoked', 'disconnected', 'pending', 'none', undefined]) {
      const r = leiteWochenstatusAb({ check: { ...gesund, connectionStatus: status }, actions: [{ title: 'x' }] });
      expect(r.state).toBe('connection_problem');
    }
  });

  it('T3: Abgleich alt oder nie → data_incomplete, kein ok', () => {
    expect(leiteWochenstatusAb({ check: { ...gesund, syncAgeHours: SYNC_ALT_AB_STUNDEN + 1 }, actions: [] }).state).toBe('data_incomplete');
    expect(leiteWochenstatusAb({ check: { ...gesund, syncAgeHours: null, lastSyncedAt: null }, actions: [] }).state).toBe('data_incomplete');
    expect(leiteWochenstatusAb({ check: { ...gesund, syncAgeHours: 'kaputt' }, actions: [] }).state).toBe('data_incomplete');
    /* genau an der Grenze ist noch frisch */
    expect(leiteWochenstatusAb({ check: { ...gesund, syncAgeHours: SYNC_ALT_AB_STUNDEN }, actions: [] }).state).toBe('ok_no_actions');
  });

  it('T4: Performance fehlt, Kernchecks gesund → ok_no_actions bleibt moeglich (Performance ist kein Kriterium)', () => {
    const r = leiteWochenstatusAb({ check: gesund, actions: [], weeklyState: 'all_clear', performance: { status: 'keine_daten' } });
    expect(r.state).toBe('ok_no_actions');
  });

  it('T5: eine Aufgabe offen → actions_open, nie „nichts zu tun"', () => {
    expect(leiteWochenstatusAb({ check: gesund, actions: [{ title: 'Bewertung beantworten' }] }).state).toBe('actions_open');
    expect(leiteWochenstatusAb({ check: { ...gesund, dueCount: 1 }, actions: [] })).toMatchObject({ state: 'actions_open', quiet: false });
    /* offen, aber nicht faellig: actions_open mit quiet */
    expect(leiteWochenstatusAb({ check: { ...gesund, openCount: 3 }, actions: [], weeklyState: 'quiet_week' }))
      .toMatchObject({ state: 'actions_open', quiet: true });
  });

  it('ohne check-Fakten (Payload vor der Migration) → kein „Alles geprueft"', () => {
    expect(leiteWochenstatusAb({ actions: [] }).state).toBe('connection_problem');
    expect(leiteWochenstatusAb({}).state).toBe('connection_problem');
    expect(leiteWochenstatusAb(undefined).state).toBe('connection_problem');
  });
});

describe('Was passiert ist', () => {
  it('nur, was war — keine Nullen', () => {
    expect(wasPassiertIst({ reviewsNew: 0, repliesPublished: 0, tasksCompleted: 0 })).toBeNull();
    expect(wasPassiertIst(undefined)).toBeNull();
    expect(wasPassiertIst({ reviewsNew: 2, negativeNew: 1, repliesPublished: 1, tasksCompleted: 3 })).toEqual([
      '2 neue Bewertungen — davon 1 eine mit höchstens 2 Sternen',
      '1 Antwort veröffentlicht',
      '3 Aufgaben erledigt',
    ]);
    expect(wasPassiertIst({ reviewsNew: 1 })).toEqual(['1 neue Bewertung']);
  });
  it('HTML: Liste nur mit Inhalt', () => {
    expect(passiertHtml(null)).toBe('');
    const html = passiertHtml(['2 neue Bewertungen']);
    expect(html).toContain('DIESE WOCHE PASSIERT');
    expect(html).toContain('<li>2 neue Bewertungen</li>');
    expect(html).not.toMatch(/>0 /);
  });
});

/* ── Mail-Faelle ── */
const perfOk = {
  status: 'ok', zeitraum: { von: '2026-10-27', bis: '2026-11-02' }, vorzeitraum: { von: '2026-10-20', bis: '2026-10-26' },
  aktuell: { CALL_CLICKS: { summe: 7, tage: 7 }, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: { summe: 900, tage: 7 } },
  vorher:  { CALL_CLICKS: { summe: 5, tage: 7 }, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: { summe: 800, tage: 7 } },
};
/* So setzt die Vorlage die Bausteine zusammen (gleiche Reihenfolge). */
function baueMail({ performance, check, actions, weeklyState }) {
  const status = leiteWochenstatusAb({ check, actions, weeklyState });
  const vor = status.state === 'connection_problem' || status.state === 'data_incomplete';
  const statusBlock = wochenstatusHtml(status);
  return googleWocheHtml(baueGoogleWoche(performance))
    + (vor ? statusBlock : '')
    + (actions.length > 0 ? `<table data-block="aufgaben">${actions.map((a) => `<tr><td>${a.title}</td></tr>`).join('')}</table>` : (vor ? '' : statusBlock));
}

describe('T6–T9 — die Mail schweigt nie und luegt nie', () => {
  it('T6 / Fall A: Performance + Aufgaben → beide sichtbar, kein Alles-geprueft', () => {
    const html = baueMail({ performance: perfOk, check: gesund, actions: [{ title: 'Bewertung beantworten' }] });
    expect(html).toContain('data-google-woche="ok"');
    expect(html).toContain('data-block="aufgaben"');
    expect(html).not.toContain('Alles geprüft');
  });
  it('T7 / Fall B: Performance + keine Aufgaben → Zahlen + Alles geprueft mit der echten Pruefliste', () => {
    const html = baueMail({ performance: perfOk, check: gesund, actions: [], weeklyState: 'all_clear' });
    expect(html).toContain('data-google-woche="ok"');
    expect(html).toContain('Alles geprüft ✓');
    expect(html).toContain('data-state="ok_no_actions"');
    GEPRUEFT.forEach((g) => expect(html).toContain(g.replace(/&/g, '&amp;')));
    /* nichts behaupten, was nicht geprueft wird */
    expect(html).not.toMatch(/komplettes Google-Profil|Beiträge|Fragen & Antworten|Mitbewerber/);
  });
  it('T8 / Fall C+D: keine Performance → kein Performance-Block, keine 0-Zahlen; ohne Aufgaben Alles geprueft', () => {
    const c = baueMail({ performance: { status: 'keine_daten' }, check: gesund, actions: [{ title: 'Fotos' }] });
    expect(c).not.toContain('DEINE GOOGLE-WOCHE');
    expect(c).toContain('data-block="aufgaben"');
    const d = baueMail({ performance: { status: 'keine_daten' }, check: gesund, actions: [], weeklyState: 'all_clear' });
    expect(d).not.toContain('DEINE GOOGLE-WOCHE');
    expect(d).toContain('Alles geprüft ✓');
    expect(d).not.toMatch(/>0</);
    expect(d.length).toBeGreaterThan(100);
  });
  it('T9 / Fall E: Verbindung kaputt → Verbindungsaktion, kein Alles-geprueft — mit und ohne Aufgaben', () => {
    const ohne = baueMail({ performance: perfOk, check: { ...gesund, connectionStatus: 'needs_reauth' }, actions: [] });
    expect(ohne).toContain('Google-Verbindung erneuern');
    expect(ohne).toContain('data-state="connection_problem"');
    expect(ohne).not.toContain('Alles geprüft');
    const mit = baueMail({ performance: perfOk, check: { ...gesund, connectionStatus: 'revoked' }, actions: [{ title: 'x' }] });
    expect(mit).toContain('Google-Verbindung erneuern');
    expect(mit).toContain('data-block="aufgaben"');
    expect(mit.indexOf('connection_problem')).toBeLessThan(mit.indexOf('data-block="aufgaben"'));
    expect(mit).not.toContain('Alles geprüft');
  });
  it('T3 in der Mail: alte Daten → keine Vollstaendigkeitsbehauptung', () => {
    const html = baueMail({ performance: perfOk, check: { ...gesund, syncAgeHours: 100 }, actions: [] });
    expect(html).toContain('Daten nicht aktuell');
    expect(html).not.toContain('Alles geprüft');
  });
  it('quiet: offene, nicht faellige Aufgaben → „Nichts Neues", nie „nichts offen"', () => {
    const html = baueMail({ performance: perfOk, check: { ...gesund, openCount: 2 }, actions: [], weeklyState: 'quiet_week' });
    expect(html).toContain('Nichts Neues diese Woche');
    expect(html).toContain('data-state="actions_open-quiet"');
    expect(html).not.toContain('Alles geprüft');
  });
});

describe('Verdrahtung in send-email', () => {
  const mail = lies('../supabase/functions/send-email/index.ts');
  const weekly = mail.slice(mail.indexOf("case 'weekly_summary'"), mail.indexOf("case 'weekly_report'"));

  it('die Vorlage entscheidet nicht selbst — sie ruft leiteWochenstatusAb und rendert dessen Ergebnis', () => {
    expect(mail).toMatch(/import \{\s*leiteWochenstatusAb, wasPassiertIst, passiertHtml, wochenstatusHtml,\s*\} from '\.\.\/\.\.\/\.\.\/src\/utils\/wochenstatus\.js'/);
    expect(weekly).toMatch(/const wochenstatus = leiteWochenstatusAb\(\{\s*check: data\.check \?\? undefined, actions: engineAufgaben, weeklyState: zustand,\s*\}\)/);
    expect(weekly).toMatch(/const statusBlock = wochenstatusHtml\(wochenstatus\)/);
    expect(weekly).toMatch(/passiertHtml\(wasPassiertIst\(data\.happened\)\)/);
    /* der alte Satz ohne Pruefung ist weg */
    expect(weekly).not.toContain('Aktuell ist keine Aufgabe offen. WERKRUF beobachtet dein Profil weiter.');
    expect(weekly).not.toMatch(/Alles geprüft/);
  });

  it('Anatomie: Google-Woche → passiert → Kacheln → Befund → Status/Aufgaben → Profilwert', () => {
    const i = (s) => weekly.indexOf(s);
    expect(i('googleWoche +')).toBeGreaterThan(0);
    expect(i('googleWoche +')).toBeLessThan(i('passiert +'));
    expect(i('passiert +')).toBeLessThan(i('tiles(['));
    expect(i('tiles([')).toBeLessThan(i('insightBox('));
    expect(i('insightBox(')).toBeLessThan(i('(statusVorAufgaben ? statusBlock : \'\')'));
    expect(i('actionList(')).toBeLessThan(i('healthBox('));
  });

  it('C2 — ohne Aufgaben steht der Status an der Stelle der Aufgaben; mit Verbindungs-/Datenproblem davor — nie keins von beidem', () => {
    /* Beide Zweige im Quelltext der Vorlage: statusBlock entweder vor den
       Aufgaben (Problem) oder statt der Aufgaben (keine Aufgaben). */
    expect(weekly).toMatch(/\(engineAufgaben\.length > 0\s*\?\s*actionList\([\s\S]*?\)\s*:\s*\(statusVorAufgaben \? '' : statusBlock\)\)/);
    expect(weekly).toMatch(/const statusVorAufgaben = wochenstatus\.state === 'connection_problem' \|\| wochenstatus\.state === 'data_incomplete'/);
    /* und in der Zusammenstellung selbst: fuer jeden Zustand ist der Status genau einmal da */
    for (const check of [gesund, { ...gesund, connectionStatus: 'needs_reauth' }, { ...gesund, syncAgeHours: 200 }]) {
      for (const actions of [[], [{ title: 'x' }]]) {
        const html = baueMail({ performance: perfOk, check, actions, weeklyState: 'all_clear' });
        const treffer = (html.match(/data-block="wochenstatus"/g) || []).length;
        const problem = check.connectionStatus !== 'active' || check.syncAgeHours > 72;
        expect(treffer).toBe(problem || actions.length === 0 ? 1 : 0);
      }
    }
  });

  it('Ueberschrift sagt nicht „nichts zu tun", wenn nicht geprueft werden konnte', () => {
    expect(weekly).toMatch(/wochenstatus\.state === 'connection_problem' \? 'die Google-Verbindung braucht dich\.'/);
    expect(weekly).toMatch(/wochenstatus\.state === 'data_incomplete' \? 'die Daten sind nicht aktuell\.'/);
    expect(weekly).toMatch(/\$\{escapeHtml\(headline\)\}/);
  });

  it('T10 — CTA und Token-Weg unveraendert: ein Knopf auf /dashboard, ergaenzeMailLinks weiter aktiv', () => {
    expect(weekly).toContain("url: `${brand.appUrl}/dashboard`");
    expect((weekly.match(/url:/g) || []).length).toBe(1);
    expect(mail).toMatch(/async function ergaenzeMailLinks/);
    expect(mail).toMatch(/rpc\('create_action_token'/);
  });

  it('T11 — hoechstens drei Aufgaben: die Vorlage schneidet nicht selbst, die Quelle liefert 3', () => {
    const migration = lies('../supabase/migrations/20261109140000_wochenstatus_fp_cockpit.sql');
    expect(migration).toMatch(/'actions',\s+public\.top_recommendations_for_email\(v_row\.user_id, 3\)/);
    expect(weekly).not.toMatch(/slice\(0, [4-9]\)/);
  });

  it('T12/T13 — Sofort- und Inaktivitaetsmail unveraendert: kein Wochenstatus, kein passiert', () => {
    const kritisch = mail.slice(mail.indexOf("case 'critical_review_alert'"), mail.indexOf("case 'critical_review_free'"));
    const inaktiv  = mail.slice(mail.indexOf("case 'inactivity_reminder'"), mail.indexOf("case 'weekly_summary'"));
    for (const block of [kritisch, inaktiv]) {
      expect(block).not.toMatch(/wochenstatus|Wochenstatus|passiertHtml|googleWoche/);
    }
    expect(kritisch).toMatch(/payload\.ctaUrl/);
  });

  it('Payload-Quelle: schedule_communications liefert happened und check — und WP5 performance bleibt', () => {
    const migration = lies('../supabase/migrations/20261109140000_wochenstatus_fp_cockpit.sql');
    const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.schedule_communications'));
    expect(fn).toMatch(/'happened',\s+v_happened/);
    expect(fn).toMatch(/'check',\s+v_check/);
    expect(fn).toMatch(/'reviewsNew',\s+\(v_happened ->> 'reviewsNew'\)::integer/);
    expect(fn).toMatch(/'performance',\s+public\.weekly_performance_for_mail\(/);
    /* keine neue Vorlage */
    const vorlagen = [...migration.matchAll(/enqueue_email\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(vorlagen).toEqual(['critical_review_alert', 'inactivity_reminder', 'weekly_summary']);
  });
});
