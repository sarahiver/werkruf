/**
 * delete-account — Reihenfolge und Abbruchregeln, am Quelltext geprüft
 *
 * Die Function läuft in Deno; Jest kann sie nicht ausführen. Was sich
 * aber am Quelltext festnageln lässt, sind die Reihenfolge der Schritte
 * und die Abbruchregeln aus WP1 (22.10.2026):
 *
 *   1. Token wird serverseitig geprüft (Service-Role getUser).
 *   2. Stripe: erst retrieve (schon canceled?), dann cancel; ein Fehler
 *      kehrt zurück, BEVOR irgendetwas anderes passiert.
 *   3. deleteUser kommt nach Stripe, Google und Cloudinary.
 *   4. Schlägt deleteUser fehl: Stoerfall mit Stripe-Bezug, Antwort
 *      deleted: false — niemals ok: true.
 *   5. Die Abschiedsmail wird NACH deleteUser eingereiht, mit
 *      p_user_id: null.
 *   6. Keine Secrets in Logs: kein Token, kein Stripe-Key.
 */
import fs from 'fs';
import path from 'path';

const quelle = fs.readFileSync(
  path.resolve(__dirname, '../supabase/functions/delete-account/index.ts'), 'utf8');
const pos = (muster) => {
  const i = quelle.search(muster);
  if (i < 0) throw new Error(`nicht gefunden: ${muster}`);
  return i;
};
/* Nur der Handler-Teil, nicht die Kopfkommentare. */
const handler = quelle.slice(quelle.indexOf('serve(async'));
const hpos = (muster) => {
  const i = handler.search(muster);
  if (i < 0) throw new Error(`nicht im Handler: ${muster}`);
  return i;
};

describe('delete-account — Reihenfolge', () => {
  it('prüft das Token serverseitig mit dem Service-Role-Client', () => {
    expect(quelle).toMatch(/SUPABASE_SERVICE_ROLE_KEY[\s\S]*?admin\.auth\.getUser\(token\)/);
    expect(quelle).not.toMatch(/SUPABASE_ANON_KEY'\)!?,\s*\{\s*global/);
  });

  it('Stripe: retrieve vor cancel, canceled zählt als Erfolg', () => {
    expect(pos(/subscriptions\.retrieve\(/)).toBeLessThan(pos(/subscriptions\.cancel\(/));
    expect(quelle).toMatch(/status === 'canceled'\) return 'already_cancelled'/);
  });

  it('ein Stripe-Fehler kehrt zurück, bevor Google, Cloudinary, deleteUser oder Mail laufen', () => {
    const stripeAbbruch = hpos(/code: 'stripe_failed'/);
    expect(stripeAbbruch).toBeLessThan(hpos(/googleWiderrufen\(/));
    expect(stripeAbbruch).toBeLessThan(hpos(/cloudinaryLoeschen\(/));
    expect(stripeAbbruch).toBeLessThan(hpos(/auth\.admin\.deleteUser\(/));
    expect(stripeAbbruch).toBeLessThan(hpos(/'account_deleted'/));
    /* und der Abbruch ist ein return, kein weiterlaufen */
    expect(handler).toMatch(/stage: 'stripe'[\s\S]{0,400}return antwort\(/);
  });

  it('deleteUser kommt nach Stripe, Google und Cloudinary', () => {
    const del = hpos(/auth\.admin\.deleteUser\(/);
    expect(hpos(/stripeKuendigen\(/)).toBeLessThan(del);
    expect(hpos(/googleWiderrufen\(/)).toBeLessThan(del);
    expect(hpos(/cloudinaryLoeschen\(/)).toBeLessThan(del);
  });

  /* ── GEGENPROBE ── */
  it('ein deleteUser-Fehler erzeugt einen Stoerfall mit Stripe-Bezug und antwortet deleted: false', () => {
    const block = handler.slice(hpos(/if \(deleteError\)/), hpos(/results\.account = 'deleted'/));
    expect(block).toMatch(/stage: 'database'/);
    expect(block).toMatch(/stripeCancelled/);
    expect(block).toMatch(/deleted: false/);
    expect(block).not.toMatch(/ok: true/);
    /* Der Stoerfall-Eintrag trägt die Stripe-IDs */
    expect(quelle).toMatch(/stripe_customer_id:\s+eintrag\.profil\?\.stripe_customer_id/);
    expect(quelle).toMatch(/stripe_subscription_id:\s+eintrag\.profil\?\.stripe_subscription_id/);
  });

  it('die Abschiedsmail wird NACH deleteUser eingereiht, ohne user_id', () => {
    expect(hpos(/auth\.admin\.deleteUser\(/)).toBeLessThan(hpos(/p_template:\s+'account_deleted'/));
    expect(handler).toMatch(/p_template:\s+'account_deleted'[\s\S]{0,200}p_user_id:\s+null/);
  });

  it('loggt weder Token noch Stripe-Schlüssel', () => {
    const logs = handler.match(/console\.(log|warn|error)\([\s\S]*?\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).not.toMatch(/\btoken\b|authHeader|STRIPE_SECRET_KEY/);
    }
    expect(quelle).toMatch(/sk_\(live\|test\)_/);   // Maskierung vorhanden
  });
});

describe('Einstellungen — kein window.confirm mehr', () => {
  it('die Löschung läuft über KontoLoeschen, nicht über native Dialoge', () => {
    const settings = fs.readFileSync(
      path.resolve(__dirname, 'pages/dashboard/DashboardSettings.js'), 'utf8');
    expect(settings).not.toMatch(/window\.confirm\(/);
    expect(settings).toMatch(/<KontoLoeschen/);
    expect(settings).toMatch(/<AboKuendigenHinweis/);
    /* Reihenfolge: Alternative vor Löschen */
    expect(settings.indexOf('<AboKuendigenHinweis')).toBeLessThan(settings.indexOf('<KontoLoeschen'));
  });
});
