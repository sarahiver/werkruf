/* Fehlertext fuer Admin-Aufrufe (WP16.1-Fix). */

/* Bei einer Antwort mit Status != 2xx liefert supabase-js nur
   „Edge Function returned a non-2xx status code". Den eigentlichen
   Grund ({ error, code } von admin-ops) traegt error.context (die
   Response). Ohne ihn war z. B. ein fehlgeschlagener CSV-Import nicht
   zu diagnostizieren. Es kommt nur, was admin-ops bewusst ausgibt. */
export async function serverFehlertext(error) {
  const fallback = error?.message || 'Aufruf fehlgeschlagen';
  try {
    const ctx = error?.context;
    if (!ctx || typeof ctx.json !== 'function') return fallback;
    const b = await (typeof ctx.clone === 'function' ? ctx.clone() : ctx).json();
    if (b && typeof b.error === 'string' && b.error) {
      const status = typeof ctx.status === 'number' ? ctx.status : null;
      const code = typeof b.code === 'string' && b.code ? b.code : null;
      const zusatz = [status, code].filter(Boolean).join(', ');
      return zusatz ? `${b.error} (${zusatz})` : b.error;
    }
  } catch { /* kein JSON — Fallback */ }
  return fallback;
}
