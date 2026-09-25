import { LOCATION_READ_MASK, sanitizeLocationPatch } from '../../supabase/functions/google-business/google-api-helpers';

describe('Google Business location API helpers', () => {
  it('requests every MVP profile field explicitly', () => {
    for (const field of ['phoneNumbers', 'regularHours', 'specialHours', 'moreHours', 'serviceArea', 'profile', 'serviceItems', 'metadata']) {
      expect(LOCATION_READ_MASK.split(',')).toContain(field);
    }
  });

  it('builds a minimal, deterministic updateMask and rejects unsupported fields', () => {
    expect(sanitizeLocationPatch({ title: 'must stay read-only', websiteUri: 'https://werkruf.de', phoneNumbers: { primaryPhone: '+49 30 1' } }))
      .toEqual({
        patch: { websiteUri: 'https://werkruf.de', phoneNumbers: { primaryPhone: '+49 30 1' } },
        updateMask: 'phoneNumbers,websiteUri',
      });
  });

  it('keeps explicit null so supported fields can be cleared', () => {
    expect(sanitizeLocationPatch({ websiteUri: null })).toEqual({ patch: { websiteUri: null }, updateMask: 'websiteUri' });
  });
});
