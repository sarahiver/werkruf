import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/dashboard/DashboardGoogleBusiness.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'src/components/dashboard/GoogleBusinessConnect.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/google-business/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260928170000_google_location_selection.sql'), 'utf8');

describe('authorised Google location selection', () => {
  it('uses one OAuth hook instance so a confirmation token is redeemed once', () => {
    expect(dashboard).toMatch(/googleBusiness = useGoogleBusiness\(\)/);
    expect(connect).not.toMatch(/useGoogleBusiness/);
    expect(dashboard.match(/<GoogleBusinessConnect googleBusiness=\{googleBusiness\}/g)).toHaveLength(2);
    expect(fs.readFileSync(path.join(root, 'src/hooks/useGoogleBusiness.js'), 'utf8')).toMatch(/confirmationRequests = new Map/);
  });

  it('imports locations and asks the customer to select from them', () => {
    expect(dashboard).toMatch(/triggerSync\(null\)/);
    /* Die Ueberschrift ist seit dem 29.09. abhaengig von der Anzahl:
       bei mehreren Betrieben 'Betrieb auswählen', bei genau einem
       'Verwalteter Betrieb'. Die Auswahl selbst ist jetzt dauerhaft
       erreichbar und nicht mehr an !selected_at gebunden. */
    expect(dashboard).toMatch(/Betrieb auswählen/);
    expect(dashboard).toMatch(/Verwalteter Betrieb/);
    expect(dashboard).toMatch(/handleSelectLocation\(location\.id\)/);
  });

  it('keeps the location switcher reachable after a business was chosen', () => {
    /* Der Fehler: Die Karte hing an !locations.some(l => l.selected_at)
       und verschwand nach der ersten Auswahl — ein Wechsel war dann
       unmoeglich. */
    expect(dashboard).not.toMatch(/!locations\.some\(\(location\) => location\.selected_at\)/);
  });

  it('offers no customer-facing sync button at all', () => {
    /* Produktentscheidung vom 29.09.2026: Der Kunde stoesst keine
       Synchronisierung mehr an. Der Scheduler plant stuendlich, der
       Worker arbeitet alle fuenf Minuten ab.

       Vorher stand hier eine Zusicherung auf triggerSync(selectedLocation) —
       der betriebsspezifische Abgleich, der den Sammelabgleich ueber
       Promise.all(locations.map(...)) abgeloest hatte. Beide sind nun
       hinfaellig. */
    expect(dashboard).not.toMatch(/Promise\.all\(locations\.map/);
    expect(dashboard).not.toMatch(/Jetzt abgleichen<\/GhostBtn>|>\s*Jetzt abgleichen/);
    expect(dashboard).not.toMatch(/const handleSync\s*=/);
  });

  it('keeps the one-time first import after connecting', () => {
    /* §6: Der Erstimport bleibt — sonst wartet ein frisch verbundener
       Kunde bis zum naechsten stuendlichen Scheduler-Lauf. */
    expect(dashboard).toMatch(/triggerSync\(null\)/);
    expect(dashboard).toMatch(/locationImport\.status !== 'none'/);
  });

  it('selects only a location belonging to the authenticated account', () => {
    expect(edge).toMatch(/loadOwnLocation\(locationId, user\.id\)/);
    expect(edge).toMatch(/select_google_location/);
    expect(migration).toMatch(/join public\.google_accounts a on a\.id = l\.account_id/);
    expect(migration).toMatch(/l\.user_id = p_user_id[\s\S]*a\.user_id = p_user_id/);
    expect(migration).toMatch(/grant execute[\s\S]*to service_role/);
  });
});
