import React from 'react';
import { useAuthContext } from '../context/AuthContext';
import supabase from '../supabaseClient';

/**
 * Welcher Standort gilt gerade?
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESEN HOOK GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Frage wurde bis H1 an drei Stellen VERSCHIEDEN beantwortet:
 *
 *   useGoogleBusinessData.js:99
 *     loadedLocations.find(l => l.selected_at) ?? null
 *
 *   useBetriebsname.js:61
 *     .not('selected_at', 'is', null).maybeSingle()
 *
 *   werkruf_score_location (SQL, 20260930120000:63-73)
 *     bei genau einem aktiven Standort DIESEN,
 *     sonst den mit selected_at, neuester zuerst
 *
 * Die SQL-Fassung ist die einzige mit der Ein-Standort-Abkuerzung —
 * und genau die fehlt den beiden JS-Fassungen. Zusammen mit einem
 * zweiten Befund wird daraus ein Fehler, den jeder neue Fremdkunde
 * trifft:
 *
 *   NICHTS setzt selected_at nach dem Erstimport.
 *   ensurePrimary (google-business/index.ts:2789) setzt is_primary,
 *   nicht selected_at.
 *
 * Ein Betrieb mit genau einem Standort hat also selected_at = NULL,
 * bis er selbst klickt. In dieser Zeit sagt SQL "das ist dein
 * Standort" und JS sagt "kein Standort ausgewaehlt". Das Dashboard
 * zeigt leere Kennzahlen, und /dashboard/kunden-gewinnung zeigte
 * "Betrieb noch nicht verknüpft" — obwohl Google korrekt verbunden
 * ist.
 *
 * ═══════════════════════════════════════════════════════════════
 * ZWEI REGELN, UND WARUM DAS KEIN FEHLER IST
 * ═══════════════════════════════════════════════════════════════
 *
 * Mein erster Entwurf hielt die SQL-Regel fuer die richtige und die
 * JS-Regeln fuer eine Divergenz, die man beseitigt. Das war falsch,
 * und die Gegenprobe hat es gezeigt: zwei bestehende Tests schreiben
 * die strenge Regel ausdruecklich fest
 *
 *   googleBusinessHealthFlow.test.js:112
 *     'does not calculate business metrics before a location is
 *      selected'   — mit EINEM Standort und selected_at = null
 *
 *   useBetriebsname.test.js:124
 *     prueft, dass die Abfrage .not('selected_at','is',null) enthaelt
 *
 * Und die Annahme, auf die ich den Umbau gestuetzt hatte — ein
 * Kunde mit genau einem Standort KOENNE nicht auswaehlen — ist
 * widerlegt: DashboardGoogleBusiness.js:355 rendert den Knopf "Zu
 * diesem Betrieb wechseln" fuer jeden nicht ausgewaehlten Standort,
 * auch den einzigen. Er muss einmal klicken, er haengt nicht fest.
 *
 * Damit sind es zwei Antworten auf zwei verschiedene Fragen:
 *
 *   werkruf_score_location (SQL)   "fuer welchen Standort rechne ich
 *                                   einen Score?" — bei genau einem
 *                                   diesen, denn ein Score ist besser
 *                                   als keiner
 *
 *   dieser Hook (JS)               "welchen Betrieb verwaltet WERKRUF
 *                                   laut Kunde?" — nur der, den er
 *                                   bestaetigt hat
 *
 * Der Bewertungslink gehoert zur zweiten Frage. §11 des Auftrags sagt
 * es wortwoertlich: selectedLocation.place_id. Ein QR-Code wird
 * gedruckt und auf Rechnungen geklebt — dafuer will man die
 * Bestaetigung, nicht die Vermutung.
 *
 * Deshalb implementiert dieser Hook die STRENGE Regel. Die
 * SQL-Funktion bleibt unveraendert; der Unterschied ist ab hier
 * dokumentiert statt unbemerkt.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM EIN EIGENER HOOK UND NICHT useGoogleBusinessData
 * ═══════════════════════════════════════════════════════════════
 *
 * Dieselbe Begruendung wie bei useBetriebsname, und dort steht sie
 * ausgeschrieben: der volle Hook laedt Bewertungen, Auftraege und
 * Medien mit. Fuer eine Place-ID waere das verschwenderisch, und die
 * Seiten, die sie brauchen, haben mit Google-Daten sonst nichts zu
 * tun.
 *
 * Das ist KEINE zweite Standortauswahl (§57) — es wird nichts
 * gesetzt, nur gelesen. Die Auswahl selbst bleibt
 * select_google_location (RPC) und selected_at.
 *
 * @returns {{
 *   standort: {id: string, place_id: string|null, title: string|null}|null,
 *   grund: 'ausgewaehlt'|'ohne_auswahl'|'keine'|null,
 *   anzahl: number,
 *   loading: boolean,
 *   fehler: boolean
 * }}
 */
export function useAusgewaehlterStandort() {
  const { user } = useAuthContext();
  const [zustand, setZustand] = React.useState({
    standort: null, grund: null, anzahl: 0, loading: true, fehler: false,
  });

  React.useEffect(() => {
    if (!user?.id) {
      setZustand({ standort: null, grund: null, anzahl: 0, loading: false, fehler: false });
      return undefined;
    }

    let abgebrochen = false;

    (async () => {
      try {
        /* Alle aktiven Standorte, nicht nur der ausgewaehlte: die
           Ein-Standort-Abkuerzung braucht die Anzahl. Es sind
           typisch einer bis drei Zeilen. */
        const { data, error } = await supabase
          .from('google_locations')
          .select('id, place_id, title, selected_at')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .order('selected_at', { ascending: false, nullsFirst: false });

        if (abgebrochen) return;
        if (error) throw error;

        const aktive = data ?? [];
        setZustand({ ...waehle(aktive), loading: false, fehler: false });
      } catch (err) {
        /* Fail closed: kein Standort statt eines geratenen. Ein
           falscher Bewertungslink wird gedruckt. */
        console.error('[useAusgewaehlterStandort]', err?.code ?? err?.message ?? err);
        if (!abgebrochen) {
          setZustand({ standort: null, grund: null, anzahl: 0, loading: false, fehler: true });
        }
      }
    })();

    return () => { abgebrochen = true; };
  }, [user?.id]);

  return zustand;
}

/**
 * Die Regel, ohne React — damit sie testbar ist, ohne einen
 * Datenbankclient zu mocken.
 *
 * STRENG: nur ein Standort mit selected_at gilt. Bewusst anders als
 * werkruf_score_location (SQL), siehe Kopf dieser Datei.
 *
 * @param {Array<{id: string, place_id?: string|null, title?: string|null, selected_at?: string|null}>} aktive
 *   Standorte mit deleted_at IS NULL
 */
export function waehle(aktive) {
  const liste = Array.isArray(aktive) ? aktive : [];

  if (liste.length === 0) {
    return { standort: null, grund: 'keine', anzahl: 0 };
  }

  /* Nur eine ausdrueckliche Auswahl zaehlt — auch beim einzigen
     Standort. Siehe Kopf dieser Datei: das ist die Regel, die das
     Dashboard und useBetriebsname schon benutzen, und die §11
     verlangt.

     Der Unique-Index google_locations_one_selected_per_user
     (20260929090000:51-55) laesst hoechstens eine Auswahl zu; die
     Sortierung nach selected_at absteigend ist die Absicherung
     dagegen, dass der Index jemals verschwindet. */
  const gewaehlt = liste
    .filter((l) => l.selected_at)
    .sort((a, b) => String(b.selected_at).localeCompare(String(a.selected_at)))[0];

  if (gewaehlt) {
    return { standort: gewaehlt, grund: 'ausgewaehlt', anzahl: liste.length };
  }

  /* Standorte da, aber keiner bestaetigt. Die Seite soll den Kunden
     bitten zu waehlen — nicht behaupten, es gebe keinen Betrieb. */
  return { standort: null, grund: 'ohne_auswahl', anzahl: liste.length };
}

export default useAusgewaehlterStandort;
