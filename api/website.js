/*
 * Vercel-Function: oeffentliche Website eines Betriebs.
 *
 *   werkruf.com/seite/<slug>[/impressum|/datenschutz]
 *     → vercel.json schreibt auf /api/website?slug=…&pfad=… um
 *     → holt {status, html} von der Supabase-Function `website/seite`
 *     → antwortet mit text/html
 *
 * Warum nicht direkt per Rewrite auf Supabase (wie /b/<code>): Supabase
 * liefert HTML aus Functions als text/plain aus. Diese Datei setzt nur
 * den richtigen Content-Type und Cache-Header — die Seite selbst baut
 * src/utils/website.js in der Edge Function.
 *
 * CommonJS ohne Abhaengigkeiten, damit Vercel nichts bundeln muss.
 */
const SUPABASE_URL = (process.env.REACT_APP_SUPABASE_URL || 'https://kueoozsfkevmncucrdjd.supabase.co').replace(/\/$/, '');

const FEHLERSEITE = (titel) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titel}</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;color:#1d232a"><h1>${titel}</h1><p>Diese Seite gibt es nicht (mehr).</p></body></html>`;

function sende(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https://res.cloudinary.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.end(html);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end();
  }
  const q = new URL(req.url, 'http://x').searchParams;
  const slug = String(q.get('slug') || '').toLowerCase();
  const rest = String(q.get('pfad') || '').replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return sende(res, 404, FEHLERSEITE('Seite nicht gefunden'), 'public, max-age=60');

  let daten;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/website/seite?slug=${encodeURIComponent(slug)}&pfad=${encodeURIComponent(`/${rest}`)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`status_${r.status}`);
    daten = await r.json();
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'api/website', event: 'quelle_nicht_erreichbar' }));
    return sende(res, 503, FEHLERSEITE('Gerade nicht erreichbar'), 'no-store');
  }
  if (!daten || typeof daten.html !== 'string') return sende(res, 404, FEHLERSEITE('Seite nicht gefunden'), 'public, max-age=60');
  /* 5 Minuten am Rand zwischenspeichern: Aenderungen im Dashboard sind
     spaetestens dann sichtbar; bei einem Ausfall der Quelle bleibt die
     letzte Fassung bis zu einem Tag stehen. */
  return sende(res, daten.status === 404 ? 404 : 200, daten.html, daten.status === 404 ? 'public, max-age=60' : 'public, s-maxage=300, stale-while-revalidate=86400');
};
