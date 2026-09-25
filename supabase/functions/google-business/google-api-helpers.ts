export const LOCATION_READ_MASK = [
  'name', 'title', 'phoneNumbers', 'websiteUri', 'storefrontAddress',
  'categories', 'regularHours', 'specialHours', 'moreHours', 'serviceArea',
  'profile', 'serviceItems', 'metadata',
].join(',');

export const EDITABLE_LOCATION_FIELDS = new Set([
  'phoneNumbers', 'websiteUri', 'regularHours', 'specialHours', 'moreHours',
  'serviceArea', 'profile', 'serviceItems', 'categories',
]);

/** Reject mass assignment and derive the smallest possible Google updateMask. */
export function sanitizeLocationPatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (EDITABLE_LOCATION_FIELDS.has(key) && value !== undefined) patch[key] = value;
  }
  return { patch, updateMask: Object.keys(patch).sort().join(',') };
}
