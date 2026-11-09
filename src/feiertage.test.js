/**
 * WP9 — Feiertags-Kalender.
 *
 *   T1–T6    Feiertagsquelle (fest, beweglich, regional, unbekannt, Jahreswechsel)
 *   T7–T11   Zeitfenster
 *   T12–T16  Sonderzeiten
 *   T17–T20  Multi-Location
 *   T25      Prioritaet nach Abstand (Regel)
 *   T31–T37  Dialog
 *   T38–T41  Server (Quelltext)
 *   §49      WP8-Interaktion: eigener Edit → pending, kein externer Diff
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ostersonntag, feiertageImJahr, feiertageImFenster, feiertagAm, giltFuer, bundeslandAusAdresse,
  offeneFeiertage, hatSonderzeitFuer, baueSonderzeit, feiertagSubjektId, alsIso, wochentag,
  FENSTER_TAGE, DRINGEND_AB_TAGEN, LAND_CODES,
} from './utils/feiertage';
import { berechneDiffs } from './utils/profilDiff';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const D = (y, m, d) => ({ year: y, month: m, day: d });
const HH = { administrativeArea: 'Hamburg', regionCode: 'DE' };
const BY = { administrativeArea: 'Bayern', regionCode: 'DE' };

describe('T1–T6 — Feiertagsquelle', () => {
  it('T1 — bundesweite feste Feiertage', () => {
    const f = feiertageImJahr(2026);
    const iso = (id) => f.find((x) => x.id === id)?.iso;
    expect(iso('neujahr')).toBe('2026-01-01');
    expect(iso('tag_der_arbeit')).toBe('2026-05-01');
    expect(iso('tag_der_einheit')).toBe('2026-10-03');
    expect(iso('erster_weihnachtstag')).toBe('2026-12-25');
    expect(iso('zweiter_weihnachtstag')).toBe('2026-12-26');
    expect(f.filter((x) => x.nationwide)).toHaveLength(9);
  });
  it('T2 — bewegliche Feiertage aus Ostern (mehrere Jahre)', () => {
    expect(alsIso(ostersonntag(2025))).toBe('2025-04-20');
    expect(alsIso(ostersonntag(2026))).toBe('2026-04-05');
    expect(alsIso(ostersonntag(2027))).toBe('2027-03-28');
    expect(alsIso(ostersonntag(2028))).toBe('2028-04-16');
    const f27 = feiertageImJahr(2027);
    const iso = (id) => f27.find((x) => x.id === id)?.iso;
    expect(iso('karfreitag')).toBe('2027-03-26');
    expect(iso('ostermontag')).toBe('2027-03-29');
    expect(iso('christi_himmelfahrt')).toBe('2027-05-06');
    expect(iso('pfingstmontag')).toBe('2027-05-17');
    expect(iso('fronleichnam')).toBe('2027-05-27');
    expect(feiertageImJahr(2026).find((x) => x.id === 'buss_und_bettag').iso).toBe('2026-11-18');
  });
  it('T3/T4 — regional nur im richtigen Bundesland', () => {
    const ref = feiertageImJahr(2026).find((x) => x.id === 'reformationstag');
    expect(giltFuer(ref, 'HH')).toBe(true);
    expect(giltFuer(ref, 'BY')).toBe(false);
    const aller = feiertageImJahr(2026).find((x) => x.id === 'allerheiligen');
    expect(giltFuer(aller, 'BY')).toBe(true);
    expect(giltFuer(aller, 'HH')).toBe(false);
    expect(feiertagAm('2026-10-31', 'HH')?.id).toBe('reformationstag');
    expect(feiertagAm('2026-10-31', 'BY')).toBeNull();
    expect(feiertagAm('2026-11-01', 'BY')?.id).toBe('allerheiligen');
    expect(feiertagAm('2026-07-14', 'BY')).toBeNull();
  });
  it('T5 — unbekannte Region → nur bundesweite', () => {
    expect(bundeslandAusAdresse({ administrativeArea: 'Hamburg' })).toMatchObject({ code: 'HH', confidence: 'known' });
    expect(bundeslandAusAdresse({ administrativeArea: 'Schleswig-Holstein' }).code).toBe('SH');
    expect(bundeslandAusAdresse({ administrativeArea: 'Baden-Württemberg' }).code).toBe('BW');
    expect(bundeslandAusAdresse({ administrativeArea: 'NRW' }).code).toBe('NW');
    expect(bundeslandAusAdresse({ administrativeArea: 'Thueringen' }).code).toBe('TH');
    expect(bundeslandAusAdresse({ administrativeArea: 'Irgendwo' })).toMatchObject({ code: null, confidence: 'unknown' });
    expect(bundeslandAusAdresse(null)).toMatchObject({ code: null, confidence: 'unknown' });
    expect(bundeslandAusAdresse({ administrativeArea: 'Hamburg', regionCode: 'AT' }).code).toBeNull();
    const o = offeneFeiertage({ heute: D(2026, 10, 20), adresse: { addressLines: ['x'] }, specialHourPeriods: [] });
    expect(o.map((x) => x.id)).toEqual([]); // Reformationstag/Allerheiligen ohne Land: nichts
    expect(giltFuer(feiertageImJahr(2026).find((x) => x.id === 'reformationstag'), null)).toBe(false);
    expect(LAND_CODES).toHaveLength(16);
  });
  it('T6 — Jahreswechsel: Neujahr des Folgejahres im Fenster', () => {
    const o = offeneFeiertage({ heute: D(2026, 12, 20), adresse: HH, specialHourPeriods: [] });
    expect(o.map((x) => x.iso)).toEqual(['2026-12-25', '2026-12-26', '2027-01-01']);
    expect(feiertageImFenster({ von: D(2026, 12, 28), bis: D(2027, 1, 10), landCode: 'BY' }).map((x) => x.id)).toEqual(['neujahr', 'heilige_drei_koenige']);
  });
  it('Teilregionale Feiertage werden bewusst nicht erzeugt (§28)', () => {
    const ids = feiertageImJahr(2026).map((x) => x.id);
    expect(ids).not.toContain('augsburger_friedensfest');
    expect(feiertagAm('2026-08-15', 'BY')).toBeNull();   // Mariä Himmelfahrt BY: gemeindeabhängig
    expect(feiertagAm('2026-08-15', 'SL')?.id).toBe('mariae_himmelfahrt');
    expect(feiertagAm('2026-06-04', 'SN')).toBeNull();   // Fronleichnam SN: nur Gemeinden
    expect(feiertagAm('2026-06-04', 'NW')?.id).toBe('fronleichnam');
  });
});

describe('T7–T11 — Zeitfenster', () => {
  const weihnachten = (heute, sh = []) => offeneFeiertage({ heute, adresse: BY, specialHourPeriods: sh }).find((x) => x.iso === '2026-12-25');
  it('T7 — 15 Tage vorher → nichts', () => { expect(weihnachten(D(2026, 12, 10))).toBeUndefined(); });
  it('T8 — 14 Tage vorher → Aufgabe, nicht dringend', () => { expect(weihnachten(D(2026, 12, 11))).toMatchObject({ tageBis: 14, dringend: false }); });
  it('T9 — 7 Tage vorher → dringend', () => { expect(weihnachten(D(2026, 12, 18))).toMatchObject({ tageBis: 7, dringend: true }); expect(weihnachten(D(2026, 12, 19)).dringend).toBe(true); expect(weihnachten(D(2026, 12, 17)).dringend).toBe(false); });
  it('T10 — am Feiertag → noch Aufgabe (0 Tage, dringend)', () => { expect(weihnachten(D(2026, 12, 25))).toMatchObject({ tageBis: 0, dringend: true }); });
  it('T11 — Tag danach → nichts mehr', () => { expect(weihnachten(D(2026, 12, 26))).toBeUndefined(); });
  it('Konstanten', () => { expect(FENSTER_TAGE).toBe(14); expect(DRINGEND_AB_TAGEN).toBe(7); });
});

describe('T12–T16 — Sonderzeiten', () => {
  const heute = D(2026, 12, 15);
  it('T12 — keine specialHours → Aufgabe', () => {
    expect(offeneFeiertage({ heute, adresse: HH, specialHourPeriods: [] }).map((x) => x.iso)).toEqual(['2026-12-25', '2026-12-26']);
  });
  it('T13 — geschlossen eingetragen → keine Aufgabe fuer den Tag', () => {
    const sh = [{ startDate: D(2026, 12, 25), closed: true }];
    expect(offeneFeiertage({ heute, adresse: HH, specialHourPeriods: sh }).map((x) => x.iso)).toEqual(['2026-12-26']);
  });
  it('T14 — abweichende Zeiten → keine Aufgabe', () => {
    const sh = [{ startDate: D(2026, 12, 25), openTime: { hours: 10 }, closeTime: { hours: 14 } }];
    expect(hatSonderzeitFuer(sh, '2026-12-25')).toBe(true);
  });
  it('T15 — explizit regulaere Zeiten → keine Aufgabe (WERKRUF bewertet nicht)', () => {
    const sh = [{ startDate: D(2026, 12, 25), openTime: { hours: 8 }, closeTime: { hours: 17 } }];
    expect(offeneFeiertage({ heute, adresse: HH, specialHourPeriods: sh }).map((x) => x.iso)).toEqual(['2026-12-26']);
  });
  it('T16 — specialHours fuer anderen Tag → Aufgabe bleibt; mehrtaegiger Zeitraum deckt ab', () => {
    const sh = [{ startDate: D(2026, 12, 24), closed: true }];
    expect(hatSonderzeitFuer(sh, '2026-12-25')).toBe(false);
    const ferien = [{ startDate: D(2026, 12, 24), endDate: D(2026, 12, 27), closed: true }];
    expect(hatSonderzeitFuer(ferien, '2026-12-25')).toBe(true);
    expect(hatSonderzeitFuer(null, '2026-12-25')).toBe(false);
  });
  it('C3 — regularHours allein reichen nie', () => {
    /* Weihnachten 2026 ist ein Freitag; regulär Fr 8–17 → trotzdem Aufgabe */
    expect(wochentag(D(2026, 12, 25))).toBe('FRIDAY');
    expect(offeneFeiertage({ heute, adresse: HH, specialHourPeriods: [] }).some((x) => x.iso === '2026-12-25')).toBe(true);
  });
  it('baueSonderzeit: geschlossen / regulaer / andere — ersetzt nur den Tag', () => {
    const bisher = [{ startDate: D(2026, 12, 24), closed: true }, { startDate: D(2026, 12, 25), openTime: { hours: 9 }, closeTime: { hours: 12 } }];
    const regel = [{ openDay: 'FRIDAY', openTime: { hours: 8 }, closeTime: { hours: 17 } }, { openDay: 'MONDAY', openTime: { hours: 8 }, closeTime: { hours: 12 } }];
    const zu = baueSonderzeit({ datum: D(2026, 12, 25), modus: 'geschlossen', regularPeriods: regel, bisherige: bisher });
    expect(zu).toEqual([{ startDate: D(2026, 12, 24), closed: true }, { startDate: D(2026, 12, 25), closed: true }]);
    const reg = baueSonderzeit({ datum: D(2026, 12, 25), modus: 'regulaer', regularPeriods: regel, bisherige: [] });
    expect(reg).toEqual([{ startDate: D(2026, 12, 25), openTime: { hours: 8 }, closeTime: { hours: 17 } }]);
    /* Sonntag regulär geschlossen → geschlossen */
    expect(baueSonderzeit({ datum: D(2026, 12, 27), modus: 'regulaer', regularPeriods: regel, bisherige: [] })).toEqual([{ startDate: D(2026, 12, 27), closed: true }]);
    const andere = baueSonderzeit({ datum: D(2026, 12, 25), modus: 'andere', regularPeriods: regel, bisherige: [], fenster: [{ openTime: { hours: 10, minutes: 0 }, closeTime: { hours: 13, minutes: 30 } }] });
    expect(andere).toEqual([{ startDate: D(2026, 12, 25), openTime: { hours: 10, minutes: 0 }, closeTime: { hours: 13, minutes: 30 } }]);
    expect(baueSonderzeit({ datum: D(2026, 12, 25), modus: 'andere', regularPeriods: [], bisherige: [], fenster: [] })).toBeNull();
    expect(baueSonderzeit({ datum: D(2026, 12, 25), modus: 'unsinn', regularPeriods: [], bisherige: [] })).toBeNull();
  });
});

describe('T17–T20 — Multi-Location', () => {
  const heute = D(2026, 10, 20);
  it('T17/T18/T19 — Hamburg Reformationstag, Bayern Allerheiligen, keine Vermischung', () => {
    expect(offeneFeiertage({ heute, adresse: HH, specialHourPeriods: [] }).map((x) => x.id)).toEqual(['reformationstag']);
    expect(offeneFeiertage({ heute, adresse: BY, specialHourPeriods: [] }).map((x) => x.id)).toEqual(['allerheiligen']);
  });
  it('T20 — gleicher Feiertag je Standort eigenes Subjekt, stabil ueber Tage', () => {
    const a = feiertagSubjektId('loc-a', '2026-12-25'), b = feiertagSubjektId('loc-b', '2026-12-25');
    expect(a).not.toBe(b);
    expect(a).toBe(feiertagSubjektId('loc-a', '2026-12-25'));
    /* Festgepinnt: dieselbe Eingabe ergibt heute, morgen und in Deno
       dieselbe ID. Aendert sich das, erzeugt die Engine taeglich neue
       Events (C4). */
    expect(a).toBe('aa0997c5-dfe8-87c3-be29-a1097e52c8f5');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('Regel in der Engine (Quelltext) — T25/T28, Klasse, Subjekt', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  const rule = gb.slice(gb.indexOf("id: 'profile.holiday_hours_missing'"), gb.indexOf("id: 'profile.photos_missing'"));
  it('medium/high nach Abstand, nie critical; Subjekt deterministisch; Pfad mit holiday=', () => {
    expect(rule).toMatch(/priority: h\.dringend \? 'high' : 'medium'/);
    expect(rule).not.toMatch(/'critical'/);
    expect(rule).toMatch(/id: feiertagSubjektId\(facts\.holidays\.locationId \?\? 'konto', h\.iso\)/);
    expect(rule).toMatch(/actionUrl: `\/dashboard\/google\?holiday=\$\{h\.iso\}`/);
    expect(rule).toMatch(/when: \(\{ facts \}\) => facts\.holidays\.reliable && facts\.holidays\.open\.length > 0/);
    expect(rule).not.toMatch(/geschlossen haben|musst/);
  });
  it('Klasse problem; Fakten aus ctx.hours; reliable verlangt Sync + regularHours', () => {
    expect(gb).toMatch(/'profile\.holiday_hours_missing': 'problem'/);
    expect(gb).toMatch(/if \(!h \|\| h\.reliable !== true\) return \{ reliable: false, locationId, open: \[\] \};/);
    expect(gb).toMatch(/offeneFeiertage\(\{\s*heute, adresse: h\.storefrontAddress \?\? null, specialHourPeriods: h\.specialHourPeriods \?\? \[\],\s*\}\)/);
  });
  it('T28 — kein Sofortalarm: Kanal 1b kennt den Typ nicht', () => {
    const mig = lies('../supabase/migrations/20261110120000_profil_diff_alarm.sql');
    const kanal = mig.slice(mig.indexOf('KANAL 1b'), mig.indexOf('KANAL 2'));
    expect(kanal).not.toMatch(/holiday/);
    expect(lies('../supabase/migrations/20261110150000_feiertags_kalender.sql')).not.toMatch(/enqueue_email|immediate_alert|cron\.schedule/);
  });
});

describe('T38–T41 — Server location/holiday-hours (Quelltext)', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  const h = gb.slice(gb.indexOf('async function handleHolidayHours'), gb.indexOf('* Aus Feldpfad und (roh gespeichertem) Wert'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  it('T36/T37 — eigener Standort, Pro/FP; T41 — keine updateMask/Feld vom Client', () => {
    expect(h).toMatch(/await requirePaidAccess\(user\.id\)/);
    expect(h).toMatch(/loadOwnLocation\(body\.locationId, user\.id\)/);
    expect(h).toMatch(/readJsonBody<\{ locationId\?: string; date\?: string; mode\?: string; hours\?: unknown \}>/);
    expect(h).not.toMatch(/body\.updateMask|body\.changes|body\.fieldPath/);
    expect(h).toMatch(/fuehreLocationUpdateAus\(user, location, \{ specialHours: \{ specialHourPeriods: neue \} \}\)/);
  });
  it('T38/T39 — nur gesetzlicher Feiertag fuer DIESEN Standort, im Fenster', () => {
    expect(h).toMatch(/const land = bundeslandAusAdresse\(adresse\);/);
    expect(h).toMatch(/const feiertag = feiertagAm\(body\.date as string, land\.code\);/);
    expect(h).toMatch(/if \(!feiertag\) \{/);
    expect(h).toMatch(/if \(abstand < 0 \|\| abstand > FENSTER_TAGE\)/);
  });
  it('T40 — ungueltige Zeit: eigene Formpruefung, dann gbpHours im Schreibweg', () => {
    expect(h).toMatch(/Bitte gültige Zeitfenster angeben/);
    const core = gb.slice(gb.indexOf('async function fuehreLocationUpdateAus'), gb.indexOf('async function handleProfileDiffApply'));
    expect(core).toMatch(/pruefeAlles\(\{/);
    expect(h).not.toMatch(/pruefeAlles|pruefeSonderzeiten/);
  });
  it('Audit holiday_hours.updated mit locationId, holidayId, date, mode', () => {
    expect(h).toMatch(/action: 'holiday_hours\.updated'/);
    expect(h).toMatch(/metadata: \{ locationId: location\.id, holidayId: feiertag\.id, date: feiertag\.iso, mode: body\.mode/);
    expect(h).not.toMatch(/email|phone/);
    expect(gb).toMatch(/'holiday-hours': \{ method: 'POST', handler: handleHolidayHours \}/);
  });
});

describe('§49 — WP8-Interaktion: eigener Sonderzeit-Edit ist pending, kein externer Diff', () => {
  it('pendingMask specialHours → changeType pending, kein "Google zeigt andere"', () => {
    const merchant = { specialHours: { specialHourPeriods: [{ startDate: D(2026, 12, 25), closed: true }] } };
    const d = berechneDiffs({ merchant, consumer: null, diffMask: null, pendingMask: 'specialHours' });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ fieldPath: 'specialHours', changeType: 'pending', origin: 'pending' });
    /* pending ist kein Alarm: Engine-Regel edit_pending hat priority low */
    const gb = lies('../supabase/functions/google-business/index.ts');
    const pending = gb.slice(gb.indexOf("id: 'profile.edit_pending'"), gb.indexOf("id: 'profile.edit_rejected'"));
    expect(pending).toMatch(/priority: 'low'/);
  });
  it('Consumer traegt den Edit bereits (live) → kein Diff', () => {
    const sh = { specialHourPeriods: [{ startDate: D(2026, 12, 25), closed: true }] };
    expect(berechneDiffs({ merchant: { specialHours: sh }, consumer: { specialHours: sh }, diffMask: 'specialHours', pendingMask: null })).toEqual([]);
  });
});

/* ── Dialog ── */
let mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
jest.mock('./context/AuthContext', () => ({ useAuthContext: () => ({ profile: mockProfil }) }));
// eslint-disable-next-line import/first
import FeiertagDialog from './components/dashboard/FeiertagDialog';

const LOC = {
  id: 'loc-1', title: 'S&I',
  google_profile: {
    storefrontAddress: { addressLines: ['Große Freiheit 82'], locality: 'Hamburg', administrativeArea: 'Hamburg', regionCode: 'DE' },
    regularHours: { periods: [{ openDay: 'FRIDAY', openTime: { hours: 8 }, closeTime: { hours: 17 } }] },
    specialHours: { specialHourPeriods: [] },
  },
};

describe('T31–T37 — Dialog', () => {
  it('T32 — richtiger Feiertag, Datum, Bundesland; T33 — Geschlossen sendet mode geschlossen', async () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
    const onSave = jest.fn(async () => ({ status: 'submitted_pending' }));
    render(<FeiertagDialog location={LOC} iso="2026-12-25" onSave={onSave} />);
    expect(screen.getByText('1. Weihnachtstag')).toBeInTheDocument();
    expect(screen.getByTestId('feiertag-datum')).toHaveTextContent('Freitag, 25. Dezember 2026 · Hamburg');
    expect(screen.getByText(/Wie habt ihr an diesem Tag geöffnet/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Öffnungszeiten festlegen'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ locationId: 'loc-1', date: '2026-12-25', mode: 'geschlossen', hours: undefined }));
    expect(await screen.findByRole('status')).toHaveTextContent('geschlossen');
  });
  it('T34 — Regulaere Zeiten uebernehmen zeigt die Zeiten des Wochentags und sendet mode regulaer', async () => {
    const onSave = jest.fn(async () => ({}));
    render(<FeiertagDialog location={LOC} iso="2026-12-25" onSave={onSave} />);
    expect(screen.getByText(/\(08:00–17:00\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Reguläre Öffnungszeiten übernehmen/));
    fireEvent.click(screen.getByText('Öffnungszeiten festlegen'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mode: 'regulaer' })));
  });
  it('T35 — Andere Zeiten: ungueltig (zu vor auf) wird vor dem Senden gestoppt, gueltig gesendet', async () => {
    const onSave = jest.fn(async () => ({}));
    render(<FeiertagDialog location={LOC} iso="2026-12-25" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Andere Öffnungszeiten'));
    fireEvent.change(screen.getByLabelText('Öffnung 1'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Schließung 1'), { target: { value: '13:00' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Öffnungszeiten festlegen')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Schließung 1'), { target: { value: '18:00' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('Öffnungszeiten festlegen'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'andere', hours: [{ openTime: { hours: 14, minutes: 0 }, closeTime: { hours: 18, minutes: 0 } }],
    })));
  });
  it('T37 — Free sieht den Dialog, kann nicht schreiben', () => {
    mockProfil = { plan: 'free', stripe_subscription_status: 'canceled', stripe_subscription_id: 's' };
    render(<FeiertagDialog location={LOC} iso="2026-12-25" onSave={jest.fn()} />);
    expect(screen.queryByText('Öffnungszeiten festlegen')).toBeNull();
    expect(screen.getByTestId('feiertag-free')).toHaveTextContent('WERKRUF Pro');
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
  });
  it('Kein Feiertag fuer dieses Bundesland → Hinweis, kein Formular (T39 UI-Seite)', () => {
    render(<FeiertagDialog location={LOC} iso="2026-11-01" onSave={jest.fn()} />);
    expect(screen.getByTestId('feiertag-dialog')).toHaveAttribute('data-status', 'kein-feiertag');
    expect(screen.getByText(/in Hamburg kein gesetzlicher Feiertag/)).toBeInTheDocument();
    expect(screen.queryByText('Öffnungszeiten festlegen')).toBeNull();
  });
  it('Schon gesetzt → Hinweis, Formular bleibt zum Ersetzen', () => {
    const loc = { ...LOC, google_profile: { ...LOC.google_profile, specialHours: { specialHourPeriods: [{ startDate: D(2026, 12, 25), closed: true }] } } };
    render(<FeiertagDialog location={loc} iso="2026-12-25" onSave={jest.fn()} />);
    expect(screen.getByTestId('feiertag-gesetzt')).toBeInTheDocument();
    expect(screen.getByText('Öffnungszeiten festlegen')).toBeInTheDocument();
  });
  it('Fehler vom Server sichtbar; ungueltiges Datum rendert nichts', async () => {
    render(<FeiertagDialog location={LOC} iso="2026-12-25" onSave={jest.fn(async () => { throw new Error('Google hat die Änderung nicht übernommen.'); })} />);
    fireEvent.click(screen.getByText('Öffnungszeiten festlegen'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nicht übernommen'));
    const { container } = render(<FeiertagDialog location={LOC} iso="kaputt" onSave={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it('T31 — Seite: ?holiday= oeffnet den Dialog fuer den gewaehlten Betrieb, Hook sendet an location/holiday-hours', () => {
    const page = lies('pages/dashboard/DashboardGoogleBusiness.js');
    expect(page).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\('holiday'\)/);
    expect(page).toMatch(/<FeiertagDialog\s+location=\{ausgewaehlterStandort\}\s+iso=\{feiertagIso\}\s+onSave=\{setzeFeiertag\}/);
    const hook = lies('hooks/useGoogleBusinessData.js');
    expect(hook).toMatch(/google-business\/location\/holiday-hours`/);
    expect(hook).toMatch(/body: JSON\.stringify\(\{ locationId, date, mode, hours \}\)/);
  });
});
