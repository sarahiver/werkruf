/**
 * Vercel-Function api/website.js: setzt text/html, leitet Slug und
 * Pfad sauber weiter, faellt bei Fehlern auf eine neutrale Seite zurueck.
 */
const handler = require('../api/website.js');

function antwort() {
  const r = { headers: {}, statusCode: 0, body: '' };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}

afterEach(() => { delete global.fetch; });

it('liefert die Seite als HTML mit Cache und Schutz-Headern', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ status: 200, html: '<!doctype html><h1>Krause</h1>' }) }));
  const res = antwort();
  await handler({ method: 'GET', url: '/api/website?slug=elektro-krause&pfad=impressum' }, res);
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/functions\/v1\/website\/seite\?slug=elektro-krause&pfad=%2Fimpressum$/);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(res.headers['cache-control']).toMatch(/s-maxage=300/);
  expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  expect(res.body).toContain('<h1>Krause</h1>');
});

it('fragt bei ungültigem Slug gar nicht erst nach', async () => {
  global.fetch = jest.fn();
  const res = antwort();
  await handler({ method: 'GET', url: '/api/website?slug=../../etc&pfad=' }, res);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(404);
});

it('gibt 404 weiter und 503, wenn die Quelle nicht antwortet', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ status: 404, html: null }) }));
  let res = antwort();
  await handler({ method: 'GET', url: '/api/website?slug=gibt-es-nicht' }, res);
  expect(res.statusCode).toBe(404);

  global.fetch = jest.fn(async () => { throw new Error('netz'); });
  res = antwort();
  await handler({ method: 'GET', url: '/api/website?slug=elektro-krause' }, res);
  expect(res.statusCode).toBe(503);
  expect(res.headers['cache-control']).toBe('no-store');
});

it('lehnt andere Methoden als GET ab', async () => {
  const res = antwort();
  await handler({ method: 'POST', url: '/api/website?slug=elektro-krause' }, res);
  expect(res.statusCode).toBe(405);
});
