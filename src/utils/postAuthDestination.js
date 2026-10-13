import supabase from '../supabaseClient';

/**
 * Wohin nach der Anmeldung?
 *
 * ═══════════════════════════════════════════════════════════════
 * ZWEI FRAGEN, IN DIESER REIHENFOLGE
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. Liegt eine Zustimmung vor?   → sonst /onboarding
 *   2. Ist Google verbunden?        → /dashboard oder /dashboard/google
 *
 * Die erste Frage steht vorn, weil die Zustimmung vor der Benutzung
 * kommt und nicht danach.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIESE WEICHE NOETIG IST
 * ═══════════════════════════════════════════════════════════════
 *
 * Der Haken steht in /onboarding — der einzigen Stelle, die beide
 * Registrierungswege (E-Mail-Bestaetigung und Google OAuth) erreichen
 * und auf der eine geprüfte Sitzung vorliegt.
 *
 * Diese Funktion schickte aber jede Anmeldung direkt ins Dashboard.
 * Wer das Onboarding abbrach und sich spaeter neu anmeldete, kam
 * damit ohne Eintrag ins Produkt — der Haken war einmal da und
 * danach nie wieder.
 *
 * ═══════════════════════════════════════════════════════════════
 * NUR DAS FEHLEN ZAEHLT, NICHT DIE FASSUNG
 * ═══════════════════════════════════════════════════════════════
 *
 * Geprueft wird ausschliesslich, ob accepted_terms_at gesetzt ist.
 * accepted_terms_version wird nicht einmal GELESEN — die Abfrage
 * holt die Spalte nicht.
 *
 * Das ist Absicht und der Kern der Entscheidung: Eine Weiche, die
 * Versionen vergleicht, ist eine Re-Consent-Architektur. Dann wuerde
 * jede neue Fassung alle Nutzer erneut durch das Onboarding schicken,
 * und aus einer Textaenderung entstuende eine Produktsperre. Wer
 * zugestimmt hat, hat zugestimmt — auch wenn die Fassung inzwischen
 * eine andere ist.
 *
 * Dass die Spalte hier fehlt, ist deshalb keine Ungenauigkeit,
 * sondern die Zusage. Ein Test haelt sie fest.
 *
 * Bestehende Konten haben keinen Eintrag und laufen damit einmal
 * durch /onboarding. Das ist die bewusste Folge, nicht ein
 * Nebeneffekt: Die Zustimmung wird fuer den Altbestand einmalig
 * eingeholt und danach nie wieder.
 *
 * @param fallback Ziel, wenn der Verbindungsstatus nicht zu holen ist
 */
export async function getPostAuthDestination(fallback = '/dashboard/google') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return '/login';

  if (await zustimmungFehlt(session)) return '/onboarding';

  try {
    const response = await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/status`,
      { headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      } },
    );
    if (!response.ok) return fallback;
    const payload = await response.json();
    return payload?.connected ? '/dashboard' : '/dashboard/google';
  } catch {
    // Never bounce an authenticated user to a public route on a status outage.
    return fallback;
  }
}

/**
 * Fehlt die Zustimmung?
 *
 * Nur `accepted_terms_at`, siehe Kopf dieser Datei.
 *
 * Ein Ausfall fuehrt NICHT ins Onboarding: Eine fehlende Zustimmung
 * ist ein Produktzustand, ein gescheiterter Lesezugriff ein Ausfall.
 * Wer wegen eines Datenbankfehlers im Onboarding landet, kann dort
 * auch nicht zustimmen (dieselbe Datenbank) und steckt fest. Dann
 * lieber weiterarbeiten lassen und beim naechsten Mal fragen — der
 * Eintrag fehlt ohnehin schon, es wird durch das Warten nichts
 * schlechter.
 */
async function zustimmungFehlt(session) {
  const id = session?.user?.id;
  /* Ohne Kennung ist es nicht entscheidbar — und keine Entscheidung
     ist besser als eine geratene. */
  if (!id) return false;

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('accepted_terms_at')
      .eq('id', id)
      /* Ein fehlendes Profil ist kein Fehler: direkt nach der
         Registrierung ist die Zeile womoeglich noch nicht da. Dann
         gibt es auch keine Zustimmung. */
      .maybeSingle();

    if (error) {
      console.warn('[postAuthDestination] Zustimmung nicht lesbar', error.code ?? error.message);
      return false;
    }

    return !data?.accepted_terms_at;
  } catch (err) {
    console.warn('[postAuthDestination]', err?.code ?? err?.message ?? err);
    return false;
  }
}
