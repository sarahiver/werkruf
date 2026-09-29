import React from 'react';
import { useAuthContext } from '../context/AuthContext';
import supabase from '../supabaseClient';

/**
 * Welcher Name gehört ins Dashboard?
 *
 * Zwei Namen existieren nebeneinander, und das ist bei Handwerksbetrieben
 * eher die Regel als die Ausnahme:
 *
 *   user_profiles.company_name   der Registrierungsname
 *                                „Firma Rolf Müller Sanitär und
 *                                Heizungstechnik"
 *
 *   google_locations.title       der Name im Google-Unternehmensprofil
 *                                „Sanitär Müller"
 *
 * Bis zum 29.09.2026 zeigte das Dashboard an fünf Stellen den ersten
 * und auf der Google-Seite den zweiten. Das sah aus, als vermischten
 * sich Daten zweier Betriebe — und war der Anlass für diesen Hook.
 *
 * ENTSCHEIDUNG: Der Google-Name gewinnt, sobald ein Betrieb ausgewählt
 * ist. Er ist der, den Kunden auf Maps und in der Suche sehen, und
 * darum geht es im Produkt. Der Registrierungsname bleibt für
 * Rechnungen, Anrede und den Stripe-Datensatz zuständig — dort ist er
 * richtig und wird nicht angetastet.
 *
 * Bewusst eine eigene, schmale Abfrage statt useGoogleBusinessData:
 * Der Name wird auf Seiten gebraucht, die mit Google-Daten sonst nichts
 * zu tun haben. Der volle Hook lädt Bewertungen, Aufträge und
 * Medien mit — für eine Überschrift wäre das verschwenderisch.
 *
 * @returns {{
 *   name: string|null,          was anzuzeigen ist
 *   herkunft: 'google'|'registrierung'|null,
 *   rechnungsname: string|null, immer der Registrierungsname
 *   googleName: string|null,    null, wenn kein Betrieb ausgewählt ist
 *   loading: boolean
 * }}
 */
export function useBetriebsname() {
  const { user, profile } = useAuthContext();
  const [googleName, setGoogleName] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.id) { setGoogleName(null); setLoading(false); return undefined; }

    let abgebrochen = false;

    (async () => {
      try {
        /* Nur der ausgewaehlte Betrieb. Ohne diesen Filter stuenden bei
           mehreren verwalteten Profilen beliebige Namen da — genau die
           Verwechslung, die dieser Hook beheben soll. */
        const { data, error } = await supabase
          .from('google_locations')
          .select('title')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .not('selected_at', 'is', null)
          .maybeSingle();

        if (abgebrochen) return;
        if (error) throw error;
        setGoogleName(data?.title?.trim() || null);
      } catch (err) {
        /* Ein Fehler hier darf die Seite nicht aufhalten. Ohne
           Google-Namen greift der Registrierungsname — schlechter,
           aber nicht falsch. */
        console.error('[useBetriebsname]', err?.code ?? err?.message ?? err);
        if (!abgebrochen) setGoogleName(null);
      } finally {
        if (!abgebrochen) setLoading(false);
      }
    })();

    return () => { abgebrochen = true; };
  }, [user?.id]);

  const rechnungsname = profile?.company_name?.trim() || null;

  return {
    name: googleName ?? rechnungsname,
    herkunft: googleName ? 'google' : (rechnungsname ? 'registrierung' : null),
    rechnungsname,
    googleName,
    loading,
  };
}

export default useBetriebsname;
