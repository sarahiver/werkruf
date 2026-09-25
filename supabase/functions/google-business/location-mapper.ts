export interface GoogleLocationForPersistence {
  title?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    postalCode?: string;
    regionCode?: string;
  };
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  websiteUri?: string;
  categories?: {
    primaryCategory?: { name?: string; displayName?: string };
    additionalCategories?: Array<{ name?: string; displayName?: string }>;
  };
  regularHours?: unknown;
  specialHours?: unknown;
  moreHours?: unknown[];
  serviceArea?: unknown;
  profile?: { description?: string };
  serviceItems?: unknown[];
  attributes?: unknown[];
  metadata?: Record<string, unknown> & { placeId?: string };
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
    google_profile: {
      phoneNumbers: location.phoneNumbers ?? null,
      storefrontAddress: location.storefrontAddress ?? null,
      categories: location.categories ?? null,
      regularHours: location.regularHours ?? null,
      specialHours: location.specialHours ?? null,
      moreHours: location.moreHours ?? [],
      serviceArea: location.serviceArea ?? null,
      profile: location.profile ?? null,
      serviceItems: location.serviceItems ?? [],
      attributes: location.attributes ?? [],
      metadata: location.metadata ?? null,
    },
  };
}
