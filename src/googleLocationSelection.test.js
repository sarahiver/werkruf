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
    expect(dashboard).toMatch(/Verwalteten Betrieb auswählen/);
    expect(dashboard).toMatch(/handleSelectLocation\(location\.id\)/);
  });

  it('selects only a location belonging to the authenticated account', () => {
    expect(edge).toMatch(/loadOwnLocation\(locationId, user\.id\)/);
    expect(edge).toMatch(/select_google_location/);
    expect(migration).toMatch(/join public\.google_accounts a on a\.id = l\.account_id/);
    expect(migration).toMatch(/l\.user_id = p_user_id[\s\S]*a\.user_id = p_user_id/);
    expect(migration).toMatch(/grant execute[\s\S]*to service_role/);
  });
});
