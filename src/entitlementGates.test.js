/*
 * Sitzen die Gates wirklich an den Schreibpfaden? (Paket H1, §19)
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM EINE QUELLTEXTPRUEFUNG
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Zugriffsregel ist in einer Datei (src/utils/subscription.js).
 * Das war aber nie das Problem: die beiden alten requirePaidAccess-
 * Kopien waren Byte fuer Byte gleich. Das Problem war, dass zwei
 * Schreibpfade sie nicht AUFGERUFEN haben —
 *
 *   handleAttributesUpdate (google-business/index.ts:6926) schrieb
 *   bei Google, ohne zu gaten.
 *
 * Eine Regel zu zentralisieren hilft dagegen nicht. Was hilft, ist
 * eine Pruefung, die faellt, wenn ein Schreibpfad das Gate nicht
 * ruft. Dafuer muss der Quelltext gelesen werden — ein Test, der die
 * Functions importiert und mockt, umgeht genau das, was er pruefen
 * soll.
 *
 * Dieselbe Bauart wie scripts/check-view-security.sh: die Ursache
 * pruefen, nicht die Wirkung, weil die Wirkung sich in einer
 * Testumgebung nicht herstellen laesst.
 *
 * ═══════════════════════════════════════════════════════════════
 * UND WARUM DAS KEIN WIDERSPRUCH ZU §29 IST
 * ═══════════════════════════════════════════════════════════════
 *
 * §29 verbietet, SICHERHEIT ueber Textmuster zu DEFINIEREN — etwa
 * "eine Policy muss uid() enthalten". Daran ist die RLS-Pruefung in
 * G2 dreimal gescheitert.
 *
 * Hier wird nichts definiert. Die Regel steht in JavaScript und wird
 * in entitlement.test.js an ihrer Wirkung geprueft. Diese Datei
 * prueft nur, ob sie an den richtigen Stellen aufgerufen wird — eine
 * strukturelle Aussage ueber den Quelltext, und Quelltext ist das
 * einzige, woran man sie ablesen kann.
 */

import fs from 'fs';
import path from 'path';

const wurzel = path.resolve(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

const GOOGLE = 'supabase/functions/google-business/index.ts';
const REPLY  = 'supabase/functions/generate-review-reply/index.ts';
const REGEL  = 'src/utils/subscription.js';
const GETEILT = 'src/utils/accessGate.js';

/* Die Handler, die bei Google schreiben oder einen Pro-Inhalt
   erzeugen. Diese Liste ist eine Erwartung — und das ist hier
   richtig, weil "welcher Handler schreibt bei Google" eine
   fachliche Aussage ist, die kein Katalog hergibt.

   Wer einen Handler hinzufuegt, der bei Google schreibt, muss ihn
   hier eintragen. Vergisst er es, faellt dieser Test nicht — aber
   der Test unten ("kein ungegateter Google-Write") schon, denn der
   sucht nach Schreibaufrufen statt nach Namen. */
const SCHREIBHANDLER = [
  'handleLocationUpdate',
  'handleMediaCreate',
  'handleReplyUpdate',
  'handleReplyApprove',
  'handleReplyRetract',
  'handleAttributesUpdate',
];

/** Schneidet den Rumpf einer Funktion heraus: von ihrer Deklaration
 *  bis zur naechsten Deklaration auf derselben Ebene. */
function rumpf(quelle, name) {
  const start = quelle.indexOf(`async function ${name}(`);
  if (start === -1) return null;
  const rest = quelle.slice(start + 1);
  const naechste = rest.search(/\nasync function |\nfunction /);
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

describe('§19 Zugriffsgates sitzen an den Schreibpfaden', () => {
  const google = lies(GOOGLE);

  test.each(SCHREIBHANDLER)('%s ruft requirePaidAccess', (name) => {
    const koerper = rumpf(google, name);
    expect(koerper).not.toBeNull();
    expect(koerper).toMatch(/requirePaidAccess\(/);
  });

  it('gated jeden Google-Schreibaufruf, der direkt in einem Handler steht', () => {
    /* Sucht die Schreibaufrufe des Google-Clients und prueft, in
       welcher Funktion sie stehen. So faellt ein NEUER Handler auf,
       auch wenn niemand ihn in SCHREIBHANDLER eingetragen hat.

       ── Warum nur handle*-Funktionen ──

       Der erste Entwurf prueffte JEDEN Schreibaufruf und meldete

         readJsonSafe<T> → client.deleteReviewReply(

       Das war eine falsche Zuordnung, nicht ein Befund: der Aufruf
       steht in Zeile 2589 in einer KLASSENMETHODE

         async retract(replyId: string, userId: string): Promise<void>

       und mein "letzte async function davor" fand die naechste
       freistehende Funktion weiter oben. Die Service-Schicht gated
       auch nicht selbst — sie wird von handleReplyRetract gerufen,
       und dort sitzt das Gate (Zeile 5810).

       Das ist auch die richtige Ebene: gegated wird an der
       HTTP-Grenze, einmal je Anfrage, nicht in jeder Methode, die
       unterwegs etwas schreibt. Deshalb zaehlen hier nur Aufrufe,
       die DIREKT in einem handle*-Handler stehen. */
    const schreibmuster = /\bclient\.(create|update|patch|delete)[A-Za-z]*\(/g;
    const ungegated = [];

    for (const treffer of google.matchAll(schreibmuster)) {
      const davor = google.slice(0, treffer.index);
      const letzte = davor.lastIndexOf('async function ');
      if (letzte === -1) continue;
      const name = davor.slice(letzte + 'async function '.length).split('(')[0].trim();
      if (!name.startsWith('handle')) continue;   // Service-Schicht, s. oben
      const koerper = rumpf(google, name);
      if (koerper && !/requirePaidAccess\(/.test(koerper)) {
        ungegated.push(`${name} → ${treffer[0]}`);
      }
    }

    expect(ungegated).toEqual([]);
  });
});

describe('§19 Die Regel steht nur an einer Stelle', () => {
  it('schreibt die Stripe-Statusliste nicht mehr in den Edge Functions aus', () => {
    /* Die drei Status standen vor H1 in beiden Functions als
       Literal. Wer sie dort wieder hinschreibt, hat die Regel
       kopiert statt sie zu benutzen. */
    for (const datei of [GOOGLE, REPLY]) {
      const quelle = lies(datei);
      expect(quelle).not.toMatch(/'active',\s*'trialing',\s*'past_due'/);
    }
  });

  it('bezieht beide Functions das Gate aus src/utils/accessGate.js', () => {
    for (const datei of [GOOGLE, REPLY]) {
      expect(lies(datei)).toMatch(/from '\.\.\/\.\.\/\.\.\/src\/utils\/accessGate\.js'/);
    }
  });

  it('bezieht accessGate.js die Regel aus src/utils/subscription.js', () => {
    const geteilt = lies(GETEILT);
    expect(geteilt).toMatch(/from '\.\/subscription\.js'/);
    /* Und formuliert sie nicht selbst nach. */
    expect(geteilt).not.toMatch(/'active',\s*'trialing',\s*'past_due'/);
  });
});

describe('§23 founding_partner wird vor dem Stripe-Zweig geprueft', () => {
  it('steht in subscription.js vor der Stripe-Abfrage', () => {
    /* Die Wirkung prueft entitlement.test.js. Hier geht es um die
       Eigenschaft, die man beim Umbauen verliert, ohne dass ein
       Wirkungstest es unbedingt zeigt: ein spaeterer Entwickler, der
       die Zweige umsortiert, weil "Stripe ist die Wahrheit",
       bekommt hier eine Begruendung statt eines roten Tests ohne
       Erklaerung. */
    const quelle = lies(REGEL);
    const founding = quelle.indexOf("plan === 'founding_partner'");
    const stripe = quelle.indexOf('stripe_subscription_id ||');

    expect(founding).toBeGreaterThan(-1);
    expect(stripe).toBeGreaterThan(-1);
    expect(founding).toBeLessThan(stripe);
  });
});

describe('§18 Kein Sonderfall nach Identitaet', () => {
  it('entscheidet Zugang nirgends ueber user_id oder E-Mail', () => {
    const verdaechtig = [
      /user\.id\s*===\s*['"][0-9a-f]{8}-/i,
      /user_id\s*===\s*['"][0-9a-f]{8}-/i,
      /\bemail\s*===\s*['"][^'"]+@/i,
    ];

    for (const datei of [GOOGLE, REPLY, REGEL, GETEILT,
                         'src/components/dashboard/ProGate.js']) {
      const quelle = lies(datei);
      for (const muster of verdaechtig) {
        expect(quelle).not.toMatch(muster);
      }
    }
  });
});

describe('Webhook schreibt founding_partner nicht zu', () => {
  it('liest den bestehenden plan, bevor es plan schreibt', () => {
    const quelle = lies('supabase/functions/stripe-webhook/index.ts');
    /* Der Guard sitzt in updateProfile — der einzigen Stelle, durch
       die beide plan-Schreibpfade laufen. */
    const start = quelle.indexOf('async function updateProfile(');
    expect(start).toBeGreaterThan(-1);
    const koerper = quelle.slice(start, quelle.indexOf('\nasync function ', start + 1));

    expect(koerper).toMatch(/'plan' in /);
    expect(koerper).toMatch(/founding_partner/);
    expect(koerper).toMatch(/select\('plan'\)/);
  });
});
