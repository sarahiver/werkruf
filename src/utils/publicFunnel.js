export const PUBLIC_FUNNEL_KEY = 'werkruf_public_funnel';

export function savePublicFunnel(data) {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(PUBLIC_FUNNEL_KEY, JSON.stringify(data)); } catch (_) {}
}

export function loadPublicFunnel() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(window.sessionStorage.getItem(PUBLIC_FUNNEL_KEY)) || null; } catch (_) { return null; }
}

export function clearPublicFunnel() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(PUBLIC_FUNNEL_KEY); } catch (_) {}
}
