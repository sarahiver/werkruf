import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../../context/AuthContext';

/**
 * Das Tor vor dem Dashboard: ohne Zustimmung kein Produkt.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DAS GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * 22.10.2026, im Admin: ein Konto mit "Zustimmung: fehlt" — und der
 * Nutzer war trotzdem im Dashboard. Die Weiche getPostAuthDestination()
 * schickt zwar jede Anmeldung ohne accepted_terms_at nach /onboarding,
 * aber sie wird nur an drei Stellen GERECHNET: nach /login, nach
 * /signup und auf der Startseite waehrend einer begonnenen
 * Einrichtung. Sie ist eine Umleitung, kein Tor.
 *
 * Wer das Dashboard anders erreicht, kam ohne Zustimmung hinein:
 *   • Mailbestaetigung ueber /bestaetigen → Startseite → Kopf-CTA
 *     "Dashboard"
 *   • Lesezeichen oder direkte Adresse mit bestehender Sitzung
 *   • Tab wieder geoeffnet
 *   • Google-OAuth ohne Absichts-Markierung (anderer Browser)
 *
 * ProtectedRoute prueft nur "angemeldet". Dieses Tor prueft die
 * Zustimmung — an der Route selbst, nicht am Weg dorthin.
 *
 * ═══════════════════════════════════════════════════════════════
 * WANN ES NICHT UMLEITET — UND WARUM DAS ABSICHT IST
 * ═══════════════════════════════════════════════════════════════
 *
 * Umgeleitet wird nur, wenn das Profil GELADEN ist und
 * accepted_terms_at darin fehlt. Drei Zustaende lassen durch:
 *
 *   1. Profil lädt noch (profileLoading, oder noch gar nicht
 *      angestossen — profile ist null, bevor der Effekt in useAuth
 *      ueberhaupt gestartet ist). Hier umzuleiten hiesse, jeden
 *      Nutzer beim ersten Rendern hinauszuwerfen. Dieselbe
 *      Rennbedingung hatte die Support-Seite im ersten Entwurf.
 *   2. Profil nicht lesbar (profileError). Ein Datenbankausfall ist
 *      kein Produktzustand; wer deswegen im Onboarding landet, kann
 *      dort auch nicht zustimmen (dieselbe Datenbank) und steckt
 *      fest. Dieselbe Regel wie in postAuthDestination.
 *   3. Profilzeile fehlt (profile null, nicht ladend, kein Fehler).
 *      Direkt nach der Registrierung, bevor der Trigger durch ist.
 *      Dieser Weg fuehrt ohnehin ueber /signup und die Weiche nach
 *      /onboarding; das Tor muss ihn nicht abfangen. Beim naechsten
 *      Laden steht die Zeile, und dann greift das Tor.
 *
 * Nur das Fehlen zaehlt, nicht die Fassung — siehe
 * postAuthDestination.js, Abschnitt "NUR DAS FEHLEN ZAEHLT".
 */
export function zustimmungErforderlich({ profile, profileLoading, profileError }) {
  if (profileLoading) return false;
  if (profileError) return false;
  if (!profile) return false;
  return !profile.accepted_terms_at;
}

export default function ZustimmungsTor({ children }) {
  const { profile, profileLoading, profileError } = useAuthContext();
  const location = useLocation();

  if (zustimmungErforderlich({ profile, profileLoading, profileError })) {
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }
  return children;
}
