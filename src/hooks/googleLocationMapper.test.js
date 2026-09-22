import { mapGoogleLocationFields } from '../../supabase/functions/google-business/location-mapper';

describe('mapGoogleLocationFields', () => {
  it('maps complete Google Business location data including the primary category display name', () => {
    expect(mapGoogleLocationFields({
      title: 'Werkstatt',
      storefrontAddress: {
        addressLines: ['Werkstraße 1'],
        locality: 'Berlin',
        postalCode: '10115',
        regionCode: 'DE',
      },
      phoneNumbers: { primaryPhone: '+49 30 123456' },
      websiteUri: 'https://example.com',
      categories: {
        primaryCategory: {
          displayName: 'Autowerkstatt',
        },
      },
      metadata: { placeId: 'place-1' },
    })).toEqual({
      title: 'Werkstatt',
      address: 'Werkstraße 1',
      locality: 'Berlin',
      postal_code: '10115',
      region_code: 'DE',
      primary_phone: '+49 30 123456',
      website_uri: 'https://example.com',
      primary_category: 'Autowerkstatt',
      place_id: 'place-1',
    });
  });

  it('persists absent optional Google fields as null', () => {
    expect(mapGoogleLocationFields({})).toEqual({
      title: null,
      address: null,
      locality: null,
      postal_code: null,
      region_code: null,
      primary_phone: null,
      website_uri: null,
      primary_category: null,
      place_id: null,
    });
  });
});
