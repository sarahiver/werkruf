import { clearPublicFunnel, loadPublicFunnel, savePublicFunnel } from './publicFunnel';

describe('public funnel hand-off', () => {
  afterEach(clearPublicFunnel);

  it('preserves the selected company for Signup and an OAuth return to Onboarding', () => {
    const data = { email: 'moin@example.de', result: { placeId: 'place-1', name: 'Müller GmbH', score: 72 } };
    savePublicFunnel(data);
    expect(loadPublicFunnel()).toEqual({ email: data.email, result: { placeId: 'place-1', name: 'Müller GmbH', dataSource: 'manual' } });
  });

  it('does not persist additional Google Places content', () => {
    savePublicFunnel({ result: { placeId: 'p', name: 'Firma', dataSource: 'google', rating: 4.8,
      reviewCount: 99, address: 'Straße', website: 'https://example.test', score: 90 } });
    expect(loadPublicFunnel().result).toEqual({ placeId: 'p', name: 'Firma', dataSource: 'google' });
  });

  it('handles unavailable storage data without breaking navigation', () => {
    sessionStorage.setItem('werkruf_public_funnel', '{broken');
    expect(loadPublicFunnel()).toBeNull();
  });
});
