/*
 * Zugriffsgate fuer Edge Functions — eine Regel, zwei Laufzeiten.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE DATEI EXISTIERT
 * ═══════════════════════════════════════════════════════════════
 *
 * requirePaidAccess stand vor H1 zweimal im Repo:
 *
 *   supabase/functions/google-business/index.ts:622
 *   supabase/functions/generate-review-reply/index.ts:858
 *
 * Normalisiert verglichen waren beide identisch — bis auf einen
 * Zeilenumbruch vor .maybeSingle(). Es war also kein Driftproblem,
 * sondern ein Vergessensproblem, und es wurde zweimal vergessen:
 *
 *   handleAttributesUpdate (google-business/index.ts:6926) ruft nur
 *   requireUser und schreibt dann bei Google (client.updateAttributes,
 *   :6949). Kein Gate.
 *
 *   handleActionLinkPost (google-business/index.ts:6377) prueft den
 *   Plan nirgends und gibt einen Supabase-Magic-Link aus (:6495).
 *   Da action_token_ziel_ok pauschal /dashboard/% erlaubt und
 *   /dashboard/google kein ProGate hat, fuehrt ein alter Link einen
 *   free-Nutzer auf eine Oberflaeche mit Schreib-Editoren.
 *
 * Eine dritte Kopie haette das nicht besser gemacht. Deshalb hier
 * eine Datei, die beide Functions importieren.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIE REGEL NICHT HIER STEHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Sie steht in src/utils/subscription.js, und diese Datei importiert
 * sie. Grund: das Frontend entscheidet dieselbe Frage (ProGate), und
 * zwei Formulierungen derselben Regel in zwei Sprachen driften
 * irgendwann auseinander — dann sperrt die Oberflaeche jemanden aus,
 * den der Server durchlaesst, oder umgekehrt.
 *
 * Das Muster ist im Repo etabliert: google-business importiert
 * src/utils/actionToken.js, request-profile-report importiert
 * src/utils/visibilityScore.js. Es wurde fuer Access nur nicht
 * benutzt.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS DIESE DATEI NICHT TUT
 * ═══════════════════════════════════════════════════════════════
 *
 * Sie wirft keinen Fehler selbst. Die beiden Functions haben eigene
 * Fehlerklassen (GbpError, ReplyError) mit eigener
 * HTTP-Abbildung — eine gemeinsame Klasse haette eine der beiden
 * umbauen muessen, und §57 sagt: kleinstmoeglicher Fix.
 *
 * Stattdessen liefert sie eine Antwort, und der Aufrufer entscheidet,
 * wie er sie meldet.
 */

import { hasPaidAccess, isFoundingPartner } from './subscription.js';

/* ── Warum hier keine Typschnittstelle mehr steht ──

   Der erste Entwurf lag unter supabase/functions/_shared/ und
   beschrieb den Supabase-Client mit einer eigenen Schnittstelle.
   Die musste PromiseLike statt Promise verwenden, weil der
   PostgrestBuilder ein Thenable ohne catch() und finally() ist —
   mit Promise lehnte deno check den echten Client ab (TS2345,
   gemessen am 13.10.2026).

   Die Datei liegt jetzt in src/utils/, wo das Repo geteilten Code
   zwischen Frontend und Edge Functions ohnehin haelt: actionToken.js,
   visibilityScore.js, gbpFieldModel.js und gbpHours.js werden von
   dort aus den Functions importiert. Damit entfaellt die
   Schnittstelle — und die Frage, ob "supabase functions deploy" ein
   Verzeichnis mit Unterstrich als Function behandeln wuerde. Eine
   Annahme weniger.

   Die Spalten, die die Regel braucht. Als Konstante, damit die
   beiden Aufrufer nicht je eine eigene Liste pflegen — eine
   vergessene Spalte wuerde die Regel still verfaelschen. */
export const ACCESS_SPALTEN =
  'plan, trial_ends_at, stripe_subscription_id, stripe_subscription_status';

/**
 * @typedef {object} AccessErgebnis
 * @property {boolean} erlaubt
 * @property {boolean} founding Nur fuer Protokoll und Auswertung, nie fuer die Entscheidung.
 * @property {'kein_profil'|'founding_partner'|'stripe'|'plan'|'abgelaufen'} grund
 *   Warum nicht — fuer das Protokoll, nicht fuer den Kunden.
 */


/**
 * Liest das Profil und wendet die Regel an.
 *
 * Wirft bei einem LESEFEHLER — nicht bei fehlendem Zugang. Ein
 * Datenbankfehler darf nicht als "kein Zugang" durchgehen und auch
 * nicht als "Zugang": beides waere geraten. Der Aufrufer bekommt die
 * Exception und meldet sie als internen Fehler.
 */
export async function leseAccess(db, userId) {
  const { data, error } = await db
    .from('user_profiles')
    .select(ACCESS_SPALTEN)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`access_lesefehler: ${String(error?.message ?? error)}`);
  }

  if (!data) {
    /* Kein Profil. Das ist kein Zugang, aber auch kein Betrug —
       direkt nach der Registrierung kann die Zeile noch fehlen
       (useAuth.js behandelt das als Normalfall). */
    return { erlaubt: false, founding: false, grund: 'kein_profil' };
  }

  const founding = isFoundingPartner(data);
  const erlaubt = hasPaidAccess(data);

  let grund = 'plan';
  if (founding) grund = 'founding_partner';
  else if (data.stripe_subscription_id || data.stripe_subscription_status) grund = 'stripe';
  else if (data.plan === 'trial') grund = 'abgelaufen';

  return { erlaubt, founding, grund };
}

/**
 * Wie leseAccess, gibt aber nur das Urteil zurueck.
 *
 * Fuer Aufrufer, die nur gaten und nichts protokollieren wollen.
 */
export async function darfBezahltes(db, userId) {
  return (await leseAccess(db, userId)).erlaubt;
}
