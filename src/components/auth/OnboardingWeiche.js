import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../context/AuthContext';
import { getPostAuthDestination } from '../../utils/postAuthDestination';
import { onboardingOffen } from '../../utils/onboardingAbsicht';

/**
 * Das Auffangnetz.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DAS GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * Am 19.10.2026 gemessen: Ein neuer Nutzer klickt "Testphase
 * starten", meldet sich bei Google an — und landet auf der
 * oeffentlichen Startseite. Die einzige sichtbare Aenderung ist der
 * Kopf-CTA, der von "Jetzt loslegen" auf "Dashboard" springt.
 *
 * Die Weiche getPostAuthDestination() haette ihn richtig geleitet.
 * Sie wird aber nur von Signup.js und Login.js aufgerufen, und keine
 * der beiden ist montiert, wenn der Rueckweg auf "/" endet. Also
 * rechnet niemand das Ziel aus, und der Nutzer bleibt stehen.
 *
 * Dass er dort landet, ist Konfiguration: signInGoogle setzt
 * redirectTo auf /onboarding, und Supabase nimmt das nur an, wenn
 * die Adresse unter Authentication → URL Configuration → Redirect
 * URLs steht. Sonst nimmt es stillschweigend die Site URL.
 *
 * Diese Komponente repariert die Konfiguration nicht — sie macht die
 * Anwendung unabhaengig davon. Eine Einstellung in einem fremden
 * Dashboard, die lautlos auf die Startseite zurueckfaellt, darf
 * keinen Kunden kosten.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM NUR MIT ABSICHT
 * ═══════════════════════════════════════════════════════════════
 *
 * Ohne diese Bedingung wuerde jeder angemeldete Nutzer, der die
 * Startseite oeffnet, ins Dashboard geworfen. Jemand, der nur die
 * Preise nachlesen will, kaeme nicht mehr auf die oeffentliche
 * Seite.
 *
 * Mit Absicht greift es genau einmal: waehrend einer begonnenen
 * Einrichtung. Danach ist die Absicht geloescht und diese Komponente
 * tut nichts mehr.
 *
 * 23.10.2026 (WP2): Die Absicht kommt aus dem Profil
 * (onboarding_completed_at IS NULL), nicht mehr aus dem
 * sessionStorage. Grund: Der Bestaetigungslink der E-Mail-
 * Registrierung oeffnet einen neuen Tab — dort gab es keine Absicht,
 * und der Nutzer blieb auf / stehen. Jetzt gilt sie in jedem Tab.
 * Bestandsprofile sind in der Datenbank als fertig markiert, deshalb
 * greift die Weiche fuer sie nie.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES NICHT KREISEN KANN
 * ═══════════════════════════════════════════════════════════════
 *
 * Drei Sperren, unabhaengig voneinander:
 *
 *   1. Nur auf einer Handvoll oeffentlicher Seiten. /signup und
 *      /login stehen NICHT dabei — die rufen die Weiche selbst auf,
 *      und zwei Aufrufe wuerden einander ins Gehege kommen.
 *   2. Ein Ziel, das dem aktuellen Pfad entspricht, wird verworfen.
 *      Ohne das koennte navigate() auf sich selbst zeigen.
 *   3. Je Pfad wird hoechstens einmal gerechnet. Kommt der Nutzer
 *      spaeter bewusst zurueck, ist die Absicht ohnehin weg.
 */

/*
 * Wo ein gestrandeter Nutzer abgeholt wird.
 *
 * Bewusst eine Liste und kein Muster wie "alles ausser /dashboard":
 * /success traegt die Rueckkehr von Stripe, /reset-password einen
 * einmaligen Token. Beide duerfen nicht umgeleitet werden, und bei
 * einem Muster faellt so etwas erst auf, wenn es weh tut.
 */
const OEFFENTLICHE_SEITEN = [
  '/', '/pricing', '/impressum', '/datenschutz', '/agb', '/avv', '/hilfe',
];

export default function OnboardingWeiche() {
  const { isAuthenticated, profile, profileLoading, profileError } = useAuthContext();
  const offen = onboardingOffen({ profile, profileLoading, profileError });
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const schonGeprueft = React.useRef(new Set());

  React.useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (!OEFFENTLICHE_SEITEN.includes(pathname)) return undefined;
    if (!offen) return undefined;
    if (schonGeprueft.current.has(pathname)) return undefined;

    schonGeprueft.current.add(pathname);

    let abgebrochen = false;
    getPostAuthDestination()
      .then((ziel) => {
        if (abgebrochen) return;
        /* Sperre 2: niemals auf sich selbst zeigen. */
        if (!ziel || ziel === pathname) return;
        navigate(ziel, { replace: true });
      })
      .catch(() => {
        /* Ein Ausfall der Weiche laesst den Nutzer stehen, wo er ist.
           Das ist der alte Zustand — unbequem, aber nicht kaputt. Ihn
           stattdessen zu raten waere schlechter. */
      });

    return () => { abgebrochen = true; };
  }, [isAuthenticated, offen, pathname, navigate]);

  return null;
}
