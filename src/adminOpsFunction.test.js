/**
 * Der Sicherheitsvertrag der admin-ops Edge Function (H3).
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS DIESE DATEI PRÜFT UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Nur Struktur: ruft die Function die Regeln auf, benutzt sie die
 * bestehenden Serverfunktionen, schreibt sie ein Audit, und fehlt
 * alles, was nicht hineingehört.
 *
 * Was WIRKLICH entschieden wird — wer darf, welche Aktionen es gibt,
 * welche Parameter gültig sind, wie der Snapshot aussieht — prüft
 * src/adminOps.test.js, und zwar durch Aufrufen. Deshalb stehen die
 * Regeln in src/utils/adminOps.js und nicht hier: eine Deno-Function
 * ist in diesem Repo nicht ausführbar (`deno check` scheitert, weil
 * esm.sh über den Proxy nicht erreichbar ist).
 *
 * ── Warum diese Datei umgeschrieben wurde ──
 *
 * Sie hielt den Vertrag der Vorfassung fest, unter anderem
 * `healthScore` und `openActions` in der Kundenliste. Genau die sind
 * in H3 verschwunden: sie entstanden aus EINEM
 * compute_health_score-RPC PRO KUNDE, bei 100 Kunden also 100 RPCs je
 * Seitenaufbau — das, was H3 §43 verbietet. Diese Zahlen stehen
 * jetzt in der Detailansicht, die einen Kunden lädt.
 *
 * Ein Test, der einen Vertrag festhält, muss fallen, wenn der
 * Vertrag sich absichtlich ändert. Er wurde rot, und das war richtig.
 *
 * ── Kommentare werden entfernt ──
 *
 * In H2.2 hat ein Textmuster dreimal einen Kommentar getroffen statt
 * Code — einmal mit dem Ergebnis, dass ein behobener Befund unbemerkt
 * blieb. Diese Datei prüft deshalb den Quelltext OHNE Kommentare.
 */
import fs from 'fs';
import path from 'path';

const wurzel = process.cwd();

const ohneKommentare = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

const FUNKTION = ohneKommentare(
  fs.readFileSync(path.join(wurzel, 'supabase/functions/admin-ops/index.ts'), 'utf8'),
);
const REGELN = ohneKommentare(
  fs.readFileSync(path.join(wurzel, 'src/utils/adminOps.js'), 'utf8'),
);

describe('Aufrufer und Rolle', () => {
  it('lässt Supabase das JWT prüfen', () => {
    expect(FUNKTION).toContain('caller.auth.getUser()');
  });

  it('entscheidet über die geteilte Regel und nicht selbst', () => {
    /* §50-Gegenprobe: wird der Aufruf von pruefeAnfrage entfernt,
       fällt dieser Test — und damit auch der Schutz, den er
       beschreibt. */
    expect(FUNKTION).toMatch(
      /import \{[\s\S]*?pruefeAnfrage[\s\S]*?\} from '\.\.\/\.\.\/\.\.\/src\/utils\/adminOps\.js'/);
    expect(FUNKTION).toMatch(/pruefeAnfrage\(\{/);
    expect(FUNKTION).toMatch(/if \(!urteil\.erlaubt\)/);
  });

  it('prüft app_metadata und nirgends user_metadata', () => {
    /* Die Rolle wird serverseitig gesetzt. user_metadata ist vom
       Client schreibbar und darf nirgends in der Kette vorkommen. */
    expect(REGELN).toContain("app_metadata?.role === 'admin'");
    expect(FUNKTION).not.toMatch(/user_metadata/);
    expect(REGELN).not.toMatch(/authUser\?\.user_metadata/);
  });

  it('holt den Service-Role-Client erst NACH dem Urteil', () => {
    /* Reihenfolge im Quelltext. Stünde der Service-Role-Client
       vorher, wäre ein vergessenes return der Unterschied zwischen
       403 und vollem Datenbankzugriff. */
    const beiUrteil = FUNKTION.indexOf('if (!urteil.erlaubt)');
    const beiService = FUNKTION.indexOf('SUPABASE_SERVICE_ROLE_KEY');
    expect(beiUrteil).toBeGreaterThan(-1);
    expect(beiService).toBeGreaterThan(-1);
    expect(beiUrteil).toBeLessThan(beiService);
  });
});

describe('die Aktionen', () => {
  it('hat für jede Aktion der Allowlist genau einen Handler', () => {
    const { ADMIN_AKTIONEN } = require('./utils/adminOps');
    const faelle = (FUNKTION.match(/case '([a-z_]+)':/g) || [])
      .map((z) => z.replace(/case '|':/g, ''));

    expect(faelle.sort()).toEqual(Object.keys(ADMIN_AKTIONEN).sort());
  });

  it('benutzt die bestehenden Serverfunktionen statt eigener Updates (§19)', () => {
    expect(FUNKTION).toMatch(/rpc\('set_founding_partner'/);
    expect(FUNKTION).toMatch(/rpc\('clear_founding_partner'/);
    expect(FUNKTION).toMatch(/rpc\('enqueue_sync_job'/);
  });

  it('schreibt nirgends selbst in user_profiles (§50-Gegenprobe)', () => {
    /* Der Befund, den §50 ausdrücklich sehen will: ein direktes
       plan-Update statt der Serverfunktion macht diesen Test rot.
       set_founding_partner setzt plan UND
       founding_partner_since/-note zusammen; ein Update auf plan
       allein würde den Plan ohne das Datum setzen, und dann wäre
       nicht mehr feststellbar, seit wann jemand dabei ist. */
    expect(FUNKTION).not.toMatch(/from\('user_profiles'\)[\s\S]{0,300}\.update\(/);
    expect(FUNKTION).not.toMatch(/\.update\(\{[\s\S]{0,200}plan/);
  });

  it('reiht Sync über die Queue ein und schreibt nicht in sync_jobs', () => {
    /* §11: bestehende Queue- und Lock-Mechanik. Ein direktes Insert
       umgeht claim_sync_jobs und damit den Schutz gegen zwei
       Worker auf demselben Job. */
    expect(FUNKTION).not.toMatch(/from\('sync_jobs'\)[\s\S]{0,200}\.insert\(/);
  });

  it('hat keine generische Datenbank- oder SQL-Schnittstelle (§26)', () => {
    expect(FUNKTION).not.toMatch(/execute_sql|\bquery:\s*|rpc\(\s*[a-zA-Z_]+\s*[,)]/);
    expect(FUNKTION).not.toMatch(/from\(\s*[a-zA-Z_]+\s*\)/);
  });

  it('hat keine destruktive Aktion (§45)', () => {
    expect(FUNKTION).not.toMatch(/\.delete\(\)/);
    expect(FUNKTION).not.toMatch(/auth\.admin\.deleteUser/);
    expect(FUNKTION).not.toMatch(/truncate|drop table/i);
  });

  it('schreibt nichts bei Google oder Stripe (§12, §18)', () => {
    /* Gelesen werden darf: §17 verlangt die Stripe-Spalten in der
       Anzeige, und die stehen in user_profiles. Verboten ist der
       Weg zu Stripe und zu Google selbst.

       Der erste Entwurf dieser Zusage prüfte /stripe/i gegen den
       ganzen Quelltext und wurde rot — an
       `stripe_subscription_status`, also an genau der Spalte, die
       der Auftrag sehen will. Eine Prüfung, die das Lesen verbietet,
       prüft das Falsche. */
    expect(FUNKTION).not.toMatch(/mybusiness|googleapis\.com/);
    expect(FUNKTION).not.toMatch(/api\.stripe\.com|new Stripe\(|STRIPE_SECRET_KEY/);
    expect(FUNKTION).not.toMatch(/esm\.sh\/stripe/);
  });
});

describe('Scope der Aktionen (§36, §50)', () => {
  const rumpf = (name, bis) => {
    const anfang = FUNKTION.indexOf(`async function ${name}`);
    const ende = FUNKTION.indexOf(`async function ${bis}`);
    expect(anfang).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(anfang);
    return FUNKTION.slice(anfang, ende);
  };

  it('schränkt jede Abfrage im Sync-Pfad auf diesen Kunden ein', () => {
    /* §50-Gegenprobe: "Sync: User-Scope entfernen → Test rot."

       Der erste Entwurf dieser Datei prüfte den Scope nur im
       Snapshot. Die Gegenprobe — .eq('user_id', userId) aus der
       Kontoabfrage in stosseSyncAn entfernen — blieb deshalb grün.
       Das war die unangenehme Art von Lücke: der Test behauptete
       einen Schutz, den er nicht prüfte.

       Jetzt wird jeder Zweig geprüft, der mit einer user_id
       arbeitet. */
    const sync = rumpf('stosseSyncAn', 'setzeFoundingPartner');
    const abfragen = sync.match(/admin\n?\s*\.from\('[a-z_]+'\)/g) || [];
    const eingeschraenkt = sync.match(/\.eq\('user_id', userId\)/g) || [];

    expect(abfragen.length).toBeGreaterThanOrEqual(2);
    expect(eingeschraenkt.length).toBe(abfragen.length);
  });

  it('reiht den Job mit der user_id des Kunden ein', () => {
    const sync = rumpf('stosseSyncAn', 'setzeFoundingPartner');
    expect(sync).toMatch(/p_user_id: userId/);
    /* Und mit dem Konto dieses Kunden, nicht mit einem beliebigen. */
    expect(sync).toMatch(/p_account_id: konto\.id/);
  });

  it('nimmt keinen fremden Standort stillschweigend an', () => {
    /* Ein locationId, das dem Kunden nicht gehört, muss abgewiesen
       werden — nicht durch den eigenen ersetzt. Das wäre eine stille
       Umdeutung, und der Admin würde glauben, er habe den
       angegebenen Standort synchronisiert. */
    const sync = rumpf('stosseSyncAn', 'setzeFoundingPartner');
    expect(sync).toMatch(/standort_gehoert_nicht_zum_kunden/);
    expect(sync).toMatch(/aktive\.find\(\(s\) => s\.id === gewuenscht\)/);
  });

  it('schränkt beide Founding-Partner-Pfade auf die id ein', () => {
    const setzen = rumpf('setzeFoundingPartner', 'entzieheFoundingPartner');
    expect(setzen).toMatch(/\.eq\('id', userId\)/);
    expect(setzen).toMatch(/p_user_id: userId/);

    const entziehen = FUNKTION.slice(FUNKTION.indexOf('async function entzieheFoundingPartner'));
    expect(entziehen).toMatch(/\.eq\('id', userId\)/);
    expect(entziehen).toMatch(/p_user_id: userId/);
  });
});

describe('Audit (§22)', () => {
  it('schreibt in die bestehende Tabelle audit_logs', () => {
    expect(FUNKTION).toMatch(/from\('audit_logs'\)\s*\.insert\(/);
    expect(FUNKTION).toMatch(/baueAuditEintrag/);
  });

  it('auditiert jede schreibende Aktion, auch den Fehlschlag', () => {
    const { ADMIN_AKTIONEN } = require('./utils/adminOps');
    const schreibend = Object.entries(ADMIN_AKTIONEN)
      .filter(([, regel]) => regel.schreibt)
      .map(([name]) => name);

    schreibend.forEach((aktion) => {
      /* Mindestens zwei Audit-Aufrufe je schreibender Aktion: einer
         für Erfolg, mindestens einer für den Fehlschlag. */
      const treffer = FUNKTION.match(new RegExp(`aktion: '${aktion}'`, 'g')) || [];
      expect(treffer.length).toBeGreaterThanOrEqual(2);
    });

    expect(FUNKTION).toMatch(/erfolg: false/);
    expect(FUNKTION).toMatch(/erfolg: true/);
  });
});

describe('keine Geheimnisse (§23)', () => {
  it('liest keine Tokentabellen', () => {
    expect(FUNKTION).not.toMatch(/from\('oauth_tokens'\)/);
    expect(FUNKTION).not.toMatch(/from\('action_tokens'\)/);
    expect(FUNKTION).not.toMatch(/from\('action_auth_states'\)/);
  });

  it('gibt kein vollständiges Auth-Objekt heraus (§41)', () => {
    /* Aus auth.users darf die Mailadresse heraus, nicht das Objekt. */
    expect(FUNKTION).toMatch(/user\?\.email/);
    expect(FUNKTION).not.toMatch(/authUser: authUser\.data/);
    expect(FUNKTION).not.toMatch(/\.\.\.authUser/);
  });

  it('protokolliert ohne Geheimnisse', () => {
    expect(FUNKTION).not.toMatch(/console\.log\([^)]*SERVICE_ROLE/);
    expect(FUNKTION).not.toMatch(/console\.log\([^)]*authHeader/);
  });
});

describe('keine Vollabfrage (§42, §43)', () => {
  it('lädt in der Liste keine Scores pro Kunde', () => {
    const liste = FUNKTION.slice(
      FUNKTION.indexOf('async function listeKunden'),
      FUNKTION.indexOf('async function supportZustand'),
    );
    expect(liste.length).toBeGreaterThan(200);
    expect(liste).not.toMatch(/compute_health_score|werkruf_score_location/);
  });

  it('begrenzt listUsers statt 1000 Nutzer zu holen', () => {
    expect(FUNKTION).not.toMatch(/perPage: 1000/);
    expect(FUNKTION).toMatch(/perPage: 200/);
  });

  it('lädt den Snapshot für genau einen Kunden', () => {
    /* Nur der Snapshot-Rumpf, nicht alles dahinter: der erste
       Entwurf schnitt bis zum Dateiende und zählte die Abfragen der
       Aktionen mit, darunter das audit_logs-Insert ohne eq. Der
       Test wurde rot und hatte recht — die Zusage war falsch
       formuliert, nicht der Code. */
    const anfang = FUNKTION.indexOf('async function supportZustand');
    const ende = FUNKTION.indexOf('async function auditiere');
    expect(anfang).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(anfang);

    const snapshot = FUNKTION.slice(anfang, ende);

    /* Jede Tabellenabfrage im Snapshot ist auf diesen Kunden
       eingeschränkt. Eine ohne eq wäre ein Leck über alle Kunden. */
    const abfragen = snapshot.match(/admin\.from\('[a-z_]+'\)/g) || [];
    const eingeschraenkt = snapshot.match(/\.eq\('(user_id|id)', userId\)/g) || [];
    expect(abfragen.length).toBeGreaterThan(3);
    expect(eingeschraenkt.length).toBe(abfragen.length);
  });
});
