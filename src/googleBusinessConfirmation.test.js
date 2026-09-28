import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, 'hooks/useGoogleBusiness.js'), 'utf8');

describe('two-stage GBP OAuth callback', () => {
  it('redeems gbp=confirm through the authenticated confirmation endpoint', () => {
    expect(source).toMatch(/result === 'confirm'/);
    expect(source).toMatch(/callFunction\('connect\/confirm', \{ method: 'POST', body: \{ token \} \}\)/);
  });
  it('removes every sensitive callback parameter from browser history', () => {
    expect(source).toMatch(/'gbp_token'/);
    expect(source).toMatch(/setSearchParams\(next, \{ replace: true \}\)/);
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*token/);
  });
});
