import { clearPublicFunnel, loadPublicFunnel, savePublicFunnel } from './publicFunnel';

describe('public funnel hand-off', () => {
  afterEach(clearPublicFunnel);

  it('preserves the selected company for Signup and an OAuth return to Onboarding', () => {
    const data = { email: 'moin@example.de', result: { placeId: 'place-1', name: 'Müller GmbH', score: 72 } };
    savePublicFunnel(data);
    expect(loadPublicFunnel()).toEqual(data);
  });

  it('handles unavailable storage data without breaking navigation', () => {
    sessionStorage.setItem('werkruf_public_funnel', '{broken');
    expect(loadPublicFunnel()).toBeNull();
  });
});
