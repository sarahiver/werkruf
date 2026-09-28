export const PUBLIC_FUNNEL_KEY = 'werkruf_public_funnel';

export function savePublicFunnel(data) {
  if (typeof window === 'undefined') return;
  // Google Maps content is not persisted here. Place IDs are explicitly
  // cacheable; the name is required for the user's hand-off and is kept only
  // in this tab's session. Rating, reviews, address and website are omitted.
  const result = data?.result ? {
    placeId: data.result.placeId || '',
    name: data.result.name || '',
    dataSource: data.result.dataSource || 'manual',
  } : null;
  try { window.sessionStorage.setItem(PUBLIC_FUNNEL_KEY, JSON.stringify({ email: data?.email || '', result })); } catch (_) {}
}

export function loadPublicFunnel() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(window.sessionStorage.getItem(PUBLIC_FUNNEL_KEY)) || null; } catch (_) { return null; }
}

export function clearPublicFunnel() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(PUBLIC_FUNNEL_KEY); } catch (_) {}
}
