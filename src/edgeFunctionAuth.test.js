/**
 * Jede Edge Function ohne Gateway-Pruefung muss den Aufrufer selbst
 * pruefen.
 *
 * ═══════════════════════════════════════════════════════════════
 * ANLASS
 * ═══════════════════════════════════════════════════════════════
 *
 * 21.10.2026: Das Edge-Function-Gateway weist ES256-Tokens ab
 * (supabase/supabase#42244, offen). Sechs Functions standen auf
 * verify_jwt = true und lieferten 401, bevor ihr Code lief — fuer
 * jeden Nutzer mit frischem Token: Admin, KI-Antworten, Checkout,
 * Kundenportal, Kontoloeschung, Foto-Upload.
 *
 * Der Workaround ist verify_jwt = false. Das ist nur dann keine
 * Luecke, wenn die Function den Nutzer SELBST prueft. Dieser Test
 * haelt genau diese Bedingung fest: Wer kuenftig eine Function
 * anlegt und verify_jwt = false setzt, ohne im Code zu pruefen, faellt
 * hier durch — und nicht erst im Audit.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS ALS PRUEFUNG GILT
 * ═══════════════════════════════════════════════════════════════
 *
 *   auth.getUser( / requireUser(   Sitzung des Aufrufers beim Auth-
 *                                  Server pruefen — kennt ES256
 *   requireWorkerSecret( / X-Worker-Secret
 *                                  Cron- und Service-Aufrufe
 *   constructEvent                 Stripe-Signatur (Webhook)
 *
 * Bewusst oeffentliche Functions stehen in OEFFENTLICH, mit dem
 * Grund. Eine Function dort braucht einen anderen Schutz — Origin,
 * Turnstile, Rate-Limit — und der Eintrag zwingt dazu, ihn zu nennen.
 */
import fs from 'fs';
import path from 'path';

const WURZEL = path.resolve(__dirname, '..');
const CONFIG = fs.readFileSync(path.join(WURZEL, 'supabase/config.toml'), 'utf8');
const FUNKTIONEN = path.join(WURZEL, 'supabase/functions');

const PRUEFUNG = /auth\.getUser\(|requireUser\(|requireWorkerSecret\(|X-Worker-Secret|constructEvent/;

/* Oeffentlich erreichbar, mit anderem Schutz. */
const OEFFENTLICH = {
  'smartcheck-lead':        'Funnel-Formular fuer Unangemeldete: Origin-Pruefung, Turnstile, check_rate_limit je IP und E-Mail',
  'request-profile-report': 'Oeffentlicher Profil-Report: Origin-Pruefung (403 origin_not_allowed), Turnstile-Siteverify, consume_profile_report_limit je IP+E-Mail (429)',
};

function verifyJwtAus(config) {
  const ergebnis = {};
  const regex = /\[functions\.([a-z0-9-]+)\]\s*\n((?:(?!\[functions\.)[^\n]*\n?)*)/g;
  let m;
  while ((m = regex.exec(config)) !== null) {
    const block = m[2];
    const v = /verify_jwt\s*=\s*(true|false)/.exec(block);
    ergebnis[m[1]] = v ? v[1] === 'true' : null;
  }
  return ergebnis;
}

const konfig = verifyJwtAus(CONFIG);
const vorhandene = fs.readdirSync(FUNKTIONEN)
  .filter((n) => fs.existsSync(path.join(FUNKTIONEN, n, 'index.ts')));

describe('Edge Functions — Gateway aus heisst: selbst pruefen', () => {
  it('kennt jede Function in config.toml (sonst gilt Supabases Vorgabe, nicht unsere)', () => {
    const fehlend = vorhandene.filter((n) => !(n in konfig));
    expect(fehlend).toEqual([]);
  });

  it.each(vorhandene)('%s: prueft den Aufrufer im Code oder steht begruendet in OEFFENTLICH', (name) => {
    const quelle = fs.readFileSync(path.join(FUNKTIONEN, name, 'index.ts'), 'utf8');
    const prueftSelbst = PRUEFUNG.test(quelle);
    const oeffentlich = Object.prototype.hasOwnProperty.call(OEFFENTLICH, name);

    if (konfig[name] === false) {
      expect(prueftSelbst || oeffentlich).toBe(true);
    }
    /* Wer in OEFFENTLICH steht, darf NICHT zusaetzlich getUser rufen —
       sonst ist der Eintrag falsch oder die Function hat sich
       gewandelt, und der Grund daneben stimmt nicht mehr. */
    if (oeffentlich) {
      expect(prueftSelbst).toBe(false);
    }
  });

  it('die sechs vom 21.10.2026 stehen auf false UND pruefen selbst', () => {
    for (const name of [
      'admin-ops', 'generate-review-reply', 'create-checkout-session',
      'create-portal-session', 'delete-account', 'cloudinary-sign-upload',
    ]) {
      expect(konfig[name]).toBe(false);
      const quelle = fs.readFileSync(path.join(FUNKTIONEN, name, 'index.ts'), 'utf8');
      expect(PRUEFUNG.test(quelle)).toBe(true);
    }
  });
});
