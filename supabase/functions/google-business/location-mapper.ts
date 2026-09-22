export interface GoogleLocationForPersistence {
  title?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    postalCode?: string;
    regionCode?: string;
  };
  phoneNumbers?: { primaryPhone?: string };
  websiteUri?: string;
  categories?: {
    primaryCategory?: { displayName?: string };
  };
  metadata?: { placeId?: string };
}

/** Maps the Business Information API response to google_locations columns. */
export function mapGoogleLocationFields(location: GoogleLocationForPersistence) {
  const address = location.storefrontAddress;

  return {
    title: location.title ?? null,
    address: address?.addressLines?.join(', ') ?? null,
    locality: address?.locality ?? null,
    postal_code: address?.postalCode ?? null,
    region_code: address?.regionCode ?? null,
    primary_phone: location.phoneNumbers?.primaryPhone ?? null,
    website_uri: location.websiteUri ?? null,
    primary_category: location.categories?.primaryCategory?.displayName ?? null,
    place_id: location.metadata?.placeId ?? null,
  };
}
