/**
 * WP8 — Profil-Diff-Alarm (der Waechter).
 *
 *   T1–T6    Normalisierung
 *   T13–T17  Herkunft / Status
 *   T19–T20  Geschlossen-Status
 *   T23/T26  Prioritaet → Kanal; Wochenmail nimmt Profilaenderungen auf
 *   Mail     Copy der Sofortmeldung
 *   §9/§10   Sync-Integration und Fehlerverhalten (Quelltext)
 *   §21      Patch-Sicherheit: Server bestimmt Feld und Wert (Quelltext)
 *   Bauteil  Profil-Waechter: Werte, Status, Pro/Free
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  normalisiereTelefon, normalisiereUrl, normalisiereKategorie, normalisiereAdresse,
  berechneDiffs, diffFingerabdruck, bestimmeHerkunft, maskeTrifft, DIFF_FELDER, FELD_PFADE,
  diffUeberschrift, formatWert, ablehnungsText, GESCHLOSSEN,
} from './utils/profilDiff';
import { wasPassiertIst, GEPRUEFT } from './utils/wochenstatus';

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

const MERCHANT = {
  name: 'locations/1',
  title: 'S&I Bau',
  phoneNumbers: { primaryPhone: '040 123456', additionalPhones: [] },
  websiteUri: 'https://www.si-bau.de/',
  openInfo: { status: 'OPEN' },
  storefrontAddress: { addressLines: ['Große Freiheit 82'], postalCode: '22767', locality: 'Hamburg', regionCode: 'DE' },
  categories: {
    primaryCategory: { name: 'categories/gcid:general_contractor', displayName: 'Bauunternehmen' },
    additionalCategories: [{ name: 'categories/gcid:roofing_contractor', displayName: 'Dachdecker' }, { name: 'categories/gcid:plumber', displayName: 'Klempner' }],
  },
  regularHours: { periods: [
    { openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 17 } },
    { openDay: 'TUESDAY', openTime: { hours: 8 }, closeDay: 'TUESDAY', closeTime: { hours: 17 } },
  ] },
};
const diff = (consumer, diffMask, pendingMask = null, extended = null) =>
  berechneDiffs({ merchant: MERCHANT, consumer, diffMask, pendingMask, extended });

describe('T1–T6 — Normalisierung', () => {
  it('T1 — Telefon in anderem Format → kein Diff', () => {
    expect(normalisiereTelefon('040 123456')).toBe('+4940123456');
    expect(normalisiereTelefon('+49 40 123456')).toBe('+4940123456');
    expect(normalisiereTelefon('0049-40-123456')).toBe('+4940123456');
    expect(normalisiereTelefon('(040) 12 34 56')).toBe('+4940123456');
    expect(normalisiereTelefon(null)).toBeNull();
    expect(diff({ phoneNumbers: { primaryPhone: '+49 40 12 34 56' } }, 'phoneNumbers')).toEqual([]);
  });
  it('T2 — URL mit/ohne Slash, www, Schema → kein Diff; Query zaehlt', () => {
    expect(normalisiereUrl('https://www.si-bau.de/')).toBe('si-bau.de');
    expect(normalisiereUrl('http://si-bau.de')).toBe('si-bau.de');
    expect(normalisiereUrl('HTTPS://SI-BAU.DE/Leistungen/')).toBe('si-bau.de/Leistungen');
    expect(diff({ websiteUri: 'si-bau.de' }, 'websiteUri')).toEqual([]);
    expect(diff({ websiteUri: 'https://si-bau.de/?utm=x' }, 'websiteUri')).toHaveLength(1);
  });
  it('T3 — Kategorie: gleiche ID, anderes Label → kein Diff', () => {
    expect(normalisiereKategorie({ name: 'categories/gcid:plumber', displayName: 'Klempner' })).toBe('categories/gcid:plumber');
    const c = { categories: { primaryCategory: { name: 'categories/gcid:general_contractor', displayName: 'General Contractor' } } };
    expect(diff(c, 'categories')).toEqual([]);
    /* andere Reihenfolge der Nebenkategorien → kein Diff */
    const c2 = { categories: { additionalCategories: [{ name: 'categories/gcid:plumber' }, { name: 'categories/gcid:roofing_contractor' }] } };
    expect(diff(c2, 'categories')).toEqual([]);
    /* andere ID → Diff */
    const c3 = { categories: { primaryCategory: { name: 'categories/gcid:plumber', displayName: 'Bauunternehmen' } } };
    expect(diff(c3, 'categories').map((d) => d.fieldPath)).toEqual(['categories.primaryCategory']);
  });
  it('T4 — Hours gleiche Semantik, andere Reihenfolge → kein Diff; andere Zeit → Diff', () => {
    const vertauscht = { regularHours: { periods: [MERCHANT.regularHours.periods[1], MERCHANT.regularHours.periods[0]] } };
    expect(diff(vertauscht, 'regularHours')).toEqual([]);
    const anders = { regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }, MERCHANT.regularHours.periods[1]] } };
    const d = diff(anders, 'regularHours');
    expect(d).toHaveLength(1); expect(d[0].prio).toBe('mittel');
  });
  it('Adresse: Leerzeichen und Groß/Klein des Landes → kein Diff; andere Zeile → Diff', () => {
    expect(normalisiereAdresse({ addressLines: ['  Große  Freiheit 82 '], postalCode: ' 22767', locality: 'Hamburg', regionCode: 'de' }))
      .toEqual(normalisiereAdresse(MERCHANT.storefrontAddress));
    expect(diff({ storefrontAddress: { addressLines: ['Große Freiheit 82'], postalCode: '22767', locality: 'Hamburg', regionCode: 'de' } }, 'storefrontAddress')).toEqual([]);
    expect(diff({ storefrontAddress: { addressLines: ['Reeperbahn 1'], postalCode: '22767', locality: 'Hamburg', regionCode: 'DE' } }, 'storefrontAddress')).toHaveLength(1);
  });
  it('T5/T6 — echte Telefon-/Website-Aenderung → Diff, kritisch, Werte roh fuer die Anzeige', () => {
    const d = diff({ phoneNumbers: { primaryPhone: '+4940999999' }, websiteUri: 'https://andere.de' }, 'phoneNumbers,websiteUri');
    expect(d.map((x) => x.fieldPath).sort()).toEqual(['phoneNumbers.primaryPhone', 'websiteUri']);
    expect(d.every((x) => x.prio === 'kritisch' && x.changeType === 'changed' && x.origin === 'unknown')).toBe(true);
    const tel = d.find((x) => x.fieldPath === 'phoneNumbers.primaryPhone');
    expect(tel.merchantValue).toBe('040 123456'); expect(tel.consumerValue).toBe('+4940999999');
  });
  it('Fehlendes Feld in der Consumer-Sicht heisst "wie Merchant", nicht "leer"', () => {
    expect(diff({ websiteUri: 'https://andere.de' }, 'websiteUri').map((x) => x.fieldPath)).toEqual(['websiteUri']);
    expect(diff(null, null)).toEqual([]);
    expect(berechneDiffs({ merchant: null, consumer: {}, diffMask: 'title' })).toEqual([]);
  });
  it('Fingerabdruck: gleicher Zustand gleich, anderer Consumer-Wert anders (Basis der Idempotenz)', () => {
    const a = diff({ phoneNumbers: { primaryPhone: '+4940999' } }, 'phoneNumbers')[0];
    const b = diff({ phoneNumbers: { primaryPhone: '+49 40 999' } }, 'phoneNumbers')[0];
    const c = diff({ phoneNumbers: { primaryPhone: '+4940888' } }, 'phoneNumbers')[0];
    expect(diffFingerabdruck(a)).not.toBe(diffFingerabdruck(c));
    /* roher Wert unterscheidet sich zwar, aber das ist die Anzeige — der
       Fingerabdruck haengt am rohen Consumer-Wert; die DB-Idempotenz
       haengt daran, dass Google denselben String liefert. Hier nur:
       deterministisch. */
    expect(diffFingerabdruck(a)).toBe(diffFingerabdruck(diff({ phoneNumbers: { primaryPhone: '+4940999' } }, 'phoneNumbers')[0]));
    expect(typeof diffFingerabdruck(b)).toBe('string');
  });
});

describe('T13–T17 — Herkunft und Status', () => {
  it('T13 — pendingMask → pending, kein "Google hat geaendert"', () => {
    const d = diff(null, null, 'phoneNumbers');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ fieldPath: 'phoneNumbers.primaryPhone', changeType: 'pending', origin: 'pending', consumerValue: null });
    expect(diffUeberschrift(d[0])).toBe('Telefonnummer: Deine Änderung wird von Google noch geprüft.');
    expect(diffUeberschrift(d[0])).not.toMatch(/Google hat/);
  });
  it('T14 — diffMask ohne Herkunft → neutraler Text', () => {
    const d = diff({ phoneNumbers: { primaryPhone: '+4940999' } }, 'phoneNumbers')[0];
    expect(d.origin).toBe('unknown');
    expect(diffUeberschrift(d)).toBe('Google zeigt eine andere Telefonnummer.');
  });
  it('T15 — UPDATED_BY_GOOGLE → externe Aenderung, klar benannt', () => {
    const ext = { 'phoneNumbers.primaryPhone': { lifecycleStage: 'EDIT_LIFECYCLE_STAGE_UPDATED_BY_GOOGLE', editTime: '2026-11-09T08:00:00Z' } };
    const d = diff({ phoneNumbers: { primaryPhone: '+4940999' } }, 'phoneNumbers', null, ext)[0];
    expect(d).toMatchObject({ origin: 'updated_by_google', changeType: 'changed', googleEditAt: '2026-11-09T08:00:00Z' });
    expect(diffUeberschrift(d)).toBe('Google hat deine Telefonnummer aktualisiert.');
    /* Pfad auf Elternebene wird auch gefunden */
    expect(bestimmeHerkunft({ pfad: 'phoneNumbers.primaryPhone', pendingMask: null, extended: { phoneNumbers: { lifecycleStage: 'EDIT_LIFECYCLE_STAGE_UPDATED_BY_GOOGLE' } } }).origin).toBe('updated_by_google');
  });
  it('T16/T17 — REJECTED → Ablehnung, Grund verstaendlich, kein Enum', () => {
    const ext = { websiteUri: { lifecycleStage: 'EDIT_LIFECYCLE_STAGE_REJECTED', rejectionReason: 'POLICY_VIOLATION' } };
    const d = diff({ websiteUri: 'https://alt.de' }, 'websiteUri', null, ext)[0];
    expect(d).toMatchObject({ origin: 'rejected', changeType: 'rejected', rejectionReason: 'POLICY_VIOLATION' });
    expect(diffUeberschrift(d)).toBe('Website: Google hat deine Änderung nicht übernommen.');
    expect(ablehnungsText('POLICY_VIOLATION')).toMatch(/Richtlinien/);
    expect(ablehnungsText('POLICY_VIOLATION')).not.toMatch(/POLICY_VIOLATION/);
    expect(ablehnungsText('IRGENDWAS_NEUES')).toBeNull();
    expect(ablehnungsText(null)).toBeNull();
  });
  it('T18 — ohne Extended-Daten funktioniert alles (v1-Fallback = extended null)', () => {
    const mit = diff({ phoneNumbers: { primaryPhone: '+4940999' } }, 'phoneNumbers', null, null);
    expect(mit).toHaveLength(1); expect(mit[0].origin).toBe('unknown');
  });
  it('Masken: Elternfeld deckt Unterpfad, Unterpfad deckt Elternfeld', () => {
    expect(maskeTrifft('phoneNumbers', 'phoneNumbers.primaryPhone')).toBe(true);
    expect(maskeTrifft('phoneNumbers.primaryPhone', 'phoneNumbers.primaryPhone')).toBe(true);
    expect(maskeTrifft('categories', 'categories.additionalCategories')).toBe(true);
    expect(maskeTrifft('title', 'phoneNumbers.primaryPhone')).toBe(false);
    expect(maskeTrifft(null, 'title')).toBe(false);
  });
});

describe('T19–T20 — Geschlossen-Status', () => {
  it('T19 — Consumer geschlossen, Merchant offen → kritisch, eigener Typ', () => {
    for (const st of GESCHLOSSEN) {
      const d = diff({ openInfo: { status: st } }, 'openInfo');
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ fieldPath: 'openInfo', prio: 'kritisch', changeType: 'closed_by_google' });
      expect(diffUeberschrift(d[0])).toBe('Google zeigt deinen Betrieb aktuell als geschlossen.');
    }
    expect(formatWert('openInfo', 'CLOSED_TEMPORARILY')).toBe('vorübergehend geschlossen');
  });
  it('T20 — beide geschlossen → kein Diff; beide offen → kein Diff', () => {
    const m = { ...MERCHANT, openInfo: { status: 'CLOSED_TEMPORARILY' } };
    expect(berechneDiffs({ merchant: m, consumer: { openInfo: { status: 'CLOSED_TEMPORARILY' } }, diffMask: 'openInfo' })).toEqual([]);
    expect(diff({ openInfo: { status: 'OPEN' } }, 'openInfo')).toEqual([]);
  });
  it('Consumer offen, Merchant geschlossen → normaler Diff, nicht "closed_by_google"', () => {
    const m = { ...MERCHANT, openInfo: { status: 'CLOSED_TEMPORARILY' } };
    const d = berechneDiffs({ merchant: m, consumer: { openInfo: { status: 'OPEN' } }, diffMask: 'openInfo' });
    expect(d[0].changeType).toBe('changed');
  });
});

describe('T23/T26 — Prioritaet und Wochenmail', () => {
  it('Katalog: kritisch = erreichen/finden; mittel = Zeiten/Nebenkategorien; info = Rest; title nicht patchbar', () => {
    expect(['openInfo', 'phoneNumbers.primaryPhone', 'websiteUri', 'storefrontAddress', 'categories.primaryCategory', 'title']
      .every((p) => DIFF_FELDER[p].prio === 'kritisch')).toBe(true);
    expect(['regularHours', 'specialHours', 'categories.additionalCategories'].every((p) => DIFF_FELDER[p].prio === 'mittel')).toBe(true);
    expect(DIFF_FELDER.title.patch).toBe(false);
    expect(DIFF_FELDER.attributes.prio).toBe('info');
    expect(FELD_PFADE).toContain('openInfo');
  });
  it('T26 — "Was passiert ist" nimmt Profilaenderungen auf — ehrlich je Zustand, hoechstens 4', () => {
    const zeilen = wasPassiertIst({ profileChanges: [
      { label: 'Telefonnummer', changeType: 'changed', origin: 'unknown' },
      { label: 'Website', changeType: 'changed', origin: 'updated_by_google' },
      { label: 'Öffnungszeiten', changeType: 'changed', resolvedAt: '2026-11-08T00:00:00Z' },
      { label: 'Adresse', changeType: 'pending' },
      { label: 'Hauptkategorie', changeType: 'rejected' },
    ] });
    expect(zeilen).toEqual([
      'Google zeigt eine andere Telefonnummer',
      'Google hat deine Website aktualisiert',
      'Öffnungszeiten: öffentlich wieder wie hinterlegt',
      'Adresse: deine Änderung wird von Google noch geprüft',
    ]);
    expect(wasPassiertIst({ profileChanges: [{ changeType: 'closed_by_google' }] })).toEqual(['Google zeigt deinen Betrieb aktuell als geschlossen']);
    expect(wasPassiertIst({ profileChanges: [] })).toBeNull();
    expect(GEPRUEFT.some((z) => /Profil-Wächter/.test(z))).toBe(true);
  });
});

describe('Mail — profile_change_alert', () => {
  const mail = lies('../supabase/functions/send-email/index.ts');
  const block = mail.slice(mail.indexOf("case 'profile_change_alert'"), mail.indexOf("case 'payment_failed'"))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  it('sachlich: hinterlegt vs. oeffentlich, "Pruefen", kein Angstmarketing, Herkunft nur aus diffUeberschrift', () => {
    expect(block).toMatch(/Hinterlegt:/); expect(block).toMatch(/Öffentlich sichtbar:/);
    expect(block).toMatch(/label: 'Prüfen'/);
    expect(block).toMatch(/diffUeberschrift\(/);
    expect(block).not.toMatch(/manipuliert|sofort!|kostet dich Kunden/i);
    expect(block).toMatch(/WERKRUF ändert nichts von selbst/);
  });
  it('Token-Link: Ziel /dashboard/google?betrieb=…&diff=…, Zweck DASHBOARD, kein Access Grant', () => {
    const fn = mail.slice(mail.indexOf('async function ergaenzeProfilDiffLink'), mail.indexOf('function render('));
    expect(fn).toMatch(/\/dashboard\/google\?betrieb=\$\{encodeURIComponent\(locationId\)\}/);
    expect(fn).toMatch(/&diff=\$\{encodeURIComponent\(diffId\)\}/);
    expect(fn).toMatch(/zielErlaubt\(ziel\)/);
    expect(fn).toMatch(/p_purpose:\s+ZWECKE\.DASHBOARD/);
    expect(fn).not.toMatch(/plan|stripe/);
    expect(mail).toMatch(/row\.template === 'profile_change_alert'\s*\?\s*await ergaenzeProfilDiffLink/);
  });
});

describe('§9/§10 — Sync-Integration und Fehlerverhalten (google-business)', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  it('Waechter haengt am bestehenden sync_locations, kein neuer Cron/Jobtyp', () => {
    const start = gb.indexOf('class LocationSyncService');
    const sync = gb.slice(start, gb.indexOf('\nclass ', start + 10));
    expect(sync).toMatch(/pruefeProfilDiff\(client, userId, row\.id as string, location\)/);
    expect(sync).toMatch(/client\.getGoogleUpdated\(merchant\.name\)/);
    expect(sync).toMatch(/rpc\('upsert_profile_diffs'/);
    expect(gb).not.toMatch(/'sync_profile_diffs'/);
    expect(lies('../supabase/migrations/20261110120000_profil_diff_alarm.sql')).not.toMatch(/cron\.schedule/);
  });
  it('T37/T38/T41 — nur reauth_required wird weitergeworfen; andere Fehler je Standort vermerkt', () => {
    const sync = gb.slice(gb.indexOf('const diffZaehler'), gb.indexOf('/* Verschwundene Standorte'));
    expect(sync).toMatch(/if \(err instanceof GbpError && err\.code === 'reauth_required'\) throw err;/);
    expect(sync).toMatch(/diffZaehler\.failed\+\+/);
    expect(sync).toMatch(/for \(const location of locationsByAccount/);
  });
  it('T39/T40 — 429/5xx: der Transport wiederholt (bestehende Logik, nicht neu gebaut)', () => {
    expect(gb).toMatch(/function isQuotaError\(status: number[\s\S]{0,200}status === 429/);
    expect(gb).toMatch(/function isRetryableStatus[\s\S]{0,200}status === 500 \|\| status === 502 \|\| status === 503 \|\| status === 504/);
  });
  it('T18 — v1alpha nur hinter Schalter, jeder Fehler ausser reauth → null', () => {
    const ext = gb.slice(gb.indexOf('async getLocationExtendedOderNull'), gb.indexOf('* Kategoriesuche.'));
    expect(ext).toMatch(/Deno\.env\.get\('GBP_EXTENDED_EDIT_STATUS'\) \?\? 'off'/);
    /* Der catch: reauth wird weitergeworfen, ALLES andere → null.
       Ein throw nach dem Reauth-Check waere ein Alpha-Ausfall ohne
       Fallback (C4). */
    const fang = ext.slice(ext.indexOf('} catch (err) {'), ext.lastIndexOf('}'));
    expect(fang).toMatch(/if \(err instanceof GbpError && err\.code === 'reauth_required'\) throw err;/);
    expect(fang.slice(fang.indexOf('throw err;') + 10)).not.toMatch(/throw/);
    expect(fang.slice(fang.indexOf('throw err;') + 10)).toMatch(/return null;/);
    expect(gb).toMatch(/const GBP_BUSINESS_INFO_API_ALPHA = 'https:\/\/mybusinessbusinessinformation\.googleapis\.com\/v1alpha'/);
  });
  it('openInfo steht in der Read-Mask und wird persistiert', () => {
    expect(lies('../supabase/functions/google-business/google-api-helpers.ts')).toMatch(/'openInfo',\s*\]\.join/);
    expect(lies('../supabase/functions/google-business/location-mapper.ts')).toMatch(/openInfo: location\.openInfo \?\? null/);
  });
  it('Engine: vier Regeln, Subjekt = Diff-ID, Pfad /dashboard/google?diff=', () => {
    for (const id of ['profile.closed_by_google', 'profile.external_change', 'profile.edit_pending', 'profile.edit_rejected']) {
      expect(gb).toMatch(new RegExp(`id: '${id.replace('.', '\\.')}',\\s*status: 'active'`));
    }
    expect(gb).toMatch(/\.map\(\(d\) => \(\{ id: d\.id, type: 'profile_diff', data: \{ \.\.\.d \} \}\)\)/);
    expect(gb).toMatch(/actionUrl: `\/dashboard\/google\?diff=\$\{d\.id\}`/);
    /* closed → critical; pending → low (kein Alarm) */
    const closed = gb.slice(gb.indexOf("id: 'profile.closed_by_google'"), gb.indexOf("id: 'profile.external_change'"));
    expect(closed).toMatch(/priority: 'critical'/);
    const pending = gb.slice(gb.indexOf("id: 'profile.edit_pending'"), gb.indexOf("id: 'profile.edit_rejected'"));
    expect(pending).toMatch(/priority: 'low'/);
  });
});

describe('§21 — Patch-Sicherheit (location/diff-apply)', () => {
  const gb = lies('../supabase/functions/google-business/index.ts');
  const apply = gb.slice(gb.indexOf('async function handleProfileDiffApply'), gb.indexOf('function baueAenderungAusDiff'));
  it('T33 — Pro/FP-Pflicht; T34/T28 — Diff muss dem Nutzer gehoeren und offen sein', () => {
    expect(apply).toMatch(/await requirePaidAccess\(user\.id\)/);
    expect(apply).toMatch(/\.eq\('id', body\.diffId\)\.eq\('user_id', user\.id\)\.is\('resolved_at', null\)/);
    expect(apply).toMatch(/loadOwnLocation\(diff\.location_id as string, user\.id\)/);
  });
  it('T35 — Client bestimmt weder Feld noch Wert; T36 — pending nicht erneut senden; rejected nicht wiederherstellen', () => {
    expect(apply).toMatch(/readJsonBody<\{ diffId\?: string; aktion\?: string \}>/);
    expect(apply).not.toMatch(/body\.fieldPath|body\.changes|body\.value|body\.wert/);
    expect(apply).toMatch(/diff\.change_type === 'pending'/);
    expect(apply).toMatch(/diff\.change_type === 'rejected' && body\.aktion === 'wiederherstellen'/);
    expect(apply).toMatch(/katalog\?\.patch/);
    expect(apply).toMatch(/fuehreLocationUpdateAus\(user, location, changes\)/);
    /* aufgeloest erst NACH dem Schreiben */
    expect(apply.indexOf('fuehreLocationUpdateAus(')).toBeLessThan(apply.indexOf("rpc('resolve_profile_diff'"));
  });
  it('baueAenderungAusDiff: explizit je Feld, Kategorien/Name → null', () => {
    const bau = gb.slice(gb.indexOf('function baueAenderungAusDiff'), gb.indexOf('\n}\n', gb.indexOf('function baueAenderungAusDiff')));
    expect(bau).toMatch(/case 'phoneNumbers\.primaryPhone'/);
    expect(bau).toMatch(/additionalPhones: bisher\.additionalPhones \?\? \[\]/);
    expect(bau).not.toMatch(/case 'title'/);
    expect(bau).not.toMatch(/case 'categories/);
    expect(bau).toMatch(/default:\s*return null;/);
  });
  it('Editor und Diff-Apply teilen denselben Schreibweg', () => {
    expect(gb).toMatch(/return jsonResponse\(request, await fuehreLocationUpdateAus\(user, location, body\.changes\)\);/);
    expect((gb.match(/client\.updateLocation\(/g) || []).length).toBe(1);
    expect(gb).toMatch(/'diff-apply': \{ method: 'POST', handler: handleProfileDiffApply \}/);
  });
});

/* ── Bauteil ── */
let mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
jest.mock('./context/AuthContext', () => ({ useAuthContext: () => ({ profile: mockProfil }) }));
// eslint-disable-next-line import/first
import ProfilWaechter from './components/dashboard/ProfilWaechter';

const ZEILEN = [
  { id: 'd1', field_path: 'phoneNumbers.primaryPhone', prio: 'kritisch', label: 'Telefonnummer', change_type: 'changed', origin: 'unknown',
    merchant_value: '040 123456', consumer_value: '+4940999999', first_seen_at: '2026-11-09T08:00:00Z', rejection_reason: null },
  { id: 'd2', field_path: 'regularHours', prio: 'mittel', label: 'Öffnungszeiten', change_type: 'pending', origin: 'pending',
    merchant_value: { periods: [] }, consumer_value: null, first_seen_at: '2026-11-09T08:00:00Z', rejection_reason: null },
  { id: 'd3', field_path: 'title', prio: 'kritisch', label: 'Unternehmensname', change_type: 'changed', origin: 'updated_by_google',
    merchant_value: 'S&I Bau', consumer_value: 'S&I Bau GmbH', first_seen_at: '2026-11-09T08:00:00Z', rejection_reason: null },
];

describe('Bauteil — Profil-Waechter', () => {
  it('zeigt Feld, beide Werte, Status, seit; Pro sieht die Entscheidung; pending ohne Knopf; title → Google', async () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
    const anwenden = jest.fn(async () => ({ ok: true }));
    render(<ProfilWaechter diffs={ZEILEN} loading={false} error={null} anwenden={anwenden} hervorgehobenId="d1" />);
    expect(screen.getByText('Google zeigt eine andere Telefonnummer.')).toBeInTheDocument();
    expect(screen.getAllByTestId('wert-hinterlegt')[0]).toHaveTextContent('040 123456');
    expect(screen.getAllByTestId('wert-oeffentlich')[0]).toHaveTextContent('+4940999999');
    expect(screen.getAllByText(/Status: öffentlich weicht ab/)).toHaveLength(2); // d1 und d3
    expect(screen.getAllByText(/seit 09\.11\.2026/).length).toBeGreaterThan(0);
    expect(screen.getByText('Öffnungszeiten: Deine Änderung wird von Google noch geprüft.')).toBeInTheDocument();
    expect(screen.getByText(/Nicht erneut einreichen/)).toBeInTheDocument();
    expect(screen.getByText('Google hat deine Unternehmensname aktualisiert.')).toBeInTheDocument();
    expect(screen.getByText(/nur direkt im Google-Unternehmensprofil/)).toBeInTheDocument();
    /* genau ein Diff mit Knoepfen (d1): pending keine, title keine */
    expect(screen.getAllByText('Meinen Wert wiederherstellen')).toHaveLength(1);
    fireEvent.click(screen.getByText('Meinen Wert wiederherstellen'));
    await waitFor(() => expect(anwenden).toHaveBeenCalledWith('d1', 'wiederherstellen'));
    expect(screen.getAllByTestId('profil-diff')).toHaveLength(3);
  });
  it('Free sieht den Zustand, aber keine Knoepfe (§22)', () => {
    mockProfil = { plan: 'free', stripe_subscription_status: 'canceled', stripe_subscription_id: 'sub' };
    render(<ProfilWaechter diffs={[ZEILEN[0]]} loading={false} error={null} anwenden={jest.fn()} />);
    expect(screen.getByText('Google zeigt eine andere Telefonnummer.')).toBeInTheDocument();
    expect(screen.queryByText('Meinen Wert wiederherstellen')).toBeNull();
    expect(screen.getByTestId('waechter-free')).toHaveTextContent('gehört zu WERKRUF Pro');
  });
  it('ohne offene Diffs: nichts; Fehler sichtbar', () => {
    const { container } = render(<ProfilWaechter diffs={[]} loading={false} error={null} anwenden={jest.fn()} />);
    expect(container.firstChild).toBeNull();
    render(<ProfilWaechter diffs={[]} loading={false} error="RLS" anwenden={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('RLS');
  });
  it('Fehler beim Anwenden wird am Diff gezeigt', async () => {
    mockProfil = { plan: 'pro', stripe_subscription_status: 'active' };
    render(<ProfilWaechter diffs={[ZEILEN[0]]} loading={false} error={null} anwenden={jest.fn(async () => { throw new Error('Google hat die Änderung nicht übernommen.'); })} />);
    fireEvent.click(screen.getByText('Öffentliche Angabe übernehmen'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nicht übernommen'));
  });
});
