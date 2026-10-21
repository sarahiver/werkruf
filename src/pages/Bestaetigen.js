/**
 * Zwischenseite für den Bestätigungslink aus der Registrierungsmail.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM ES DIESE SEITE GIBT
 * ═══════════════════════════════════════════════════════════════
 *
 * 21.10.2026, Outlook-Durchgang: Der Link aus der Bestätigungsmail
 * warf den Nutzer auf /login statt ins Onboarding. Mit Gmail am
 * selben Morgen hatte er funktioniert.
 *
 * Ursache laut Supabase-Dokumentation (Auth → Email Templates →
 * Limitations → Email prefetching): Sicherheitsscanner wie Safe Links
 * in Microsoft Defender rufen Links in eingehenden Mails vorab auf.
 * {{ .ConfirmationURL }} ist ein EINMAL-Link — nach dem Aufruf durch
 * den Scanner ist er verbraucht, und der Mensch, der ihn danach
 * klickt, bekommt "Token has expired or is invalid".
 *
 * Das trifft nicht nur outlook.com. Jede Firmen-Mail hinter Microsoft
 * 365 hat denselben Scanner — und das ist bei Handwerksbetrieben der
 * Normalfall, nicht die Ausnahme.
 *
 * ═══════════════════════════════════════════════════════════════
 * DIE LÖSUNG
 * ═══════════════════════════════════════════════════════════════
 *
 * Die Mail verlinkt nicht mehr auf den Einmal-Link, sondern hierher:
 *
 *   {{ .SiteURL }}/bestaetigen?confirmation_url={{ .ConfirmationURL }}
 *
 * Ein Scanner lädt diese Seite — und das ist harmlos. Der echte Link
 * steckt in einem Knopf, und verbraucht wird erst, was ein Mensch
 * klickt. Das ist Supabases "Option 2: custom link with a button",
 * wörtlich aus der Dokumentation.
 *
 * DESHALB KEIN AUTOMATISCHES WEITERLEITEN. Ein Scanner, der JavaScript
 * ausführt, würde einem Auto-Redirect folgen und den Link genauso
 * verbrauchen. Der Knopf ist der ganze Punkt.
 *
 * ═══════════════════════════════════════════════════════════════
 * SICHERHEIT: KEIN OFFENER REDIRECT
 * ═══════════════════════════════════════════════════════════════
 *
 * Eine Seite, die auf einen beliebigen Wert aus der Adresszeile
 * verlinkt, ist ein offener Redirect — und steht dann auf werkruf.com,
 * mit WERKRUF-Logo, "Nur noch ein Klick" und einem Knopf, der
 * irgendwohin führt. Ein Phishing-Geschenk.
 *
 * Darum wird der Link nur dann in den Knopf gesetzt, wenn er
 *   1. eine gültige https-Adresse ist,
 *   2. auf GENAU den Ursprung unseres Supabase-Projekts zeigt und
 *   3. den Pfad /auth/v1/verify trägt.
 * Alles andere bekommt keinen Knopf, sondern einen Hinweis.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM NICHT URLSearchParams.get('confirmation_url')
 * ═══════════════════════════════════════════════════════════════
 *
 * Der Einmal-Link hat selbst Parameter: ?token=…&type=signup&
 * redirect_to=…. Steht er unkodiert in unserer Adresse, zerlegt
 * URLSearchParams ihn an jedem "&" — und get() lieferte nur den Teil
 * bis zum ersten. Deshalb wird alles ab "confirmation_url=" roh
 * genommen. Ist der Wert kodiert angekommen, holt decodeURIComponent
 * ihn zurück; ist er es nicht, ändert der Aufruf nichts.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { MailCheck, ArrowRight, AlertTriangle } from 'lucide-react';

const PARAMETER = 'confirmation_url=';

/**
 * Liest und prüft den Bestätigungslink aus dem Query-String.
 *
 * Reine Funktion, exportiert für die Tests — vor allem für die
 * Gegenproben, die fremde Ziele abweisen.
 *
 * @param search      location.search, inklusive führendem "?"
 * @param supabaseUrl REACT_APP_SUPABASE_URL
 * @returns { url } oder { fehler }
 */
export function leseBestaetigungsLink(search, supabaseUrl) {
  const roh = String(search ?? '');
  const anfang = roh.indexOf(PARAMETER);
  if (anfang === -1) return { fehler: 'fehlt' };

  let wert = roh.slice(anfang + PARAMETER.length);
  try { wert = decodeURIComponent(wert); } catch { /* unkodiert lassen */ }
  if (!wert) return { fehler: 'fehlt' };

  let ziel;
  try { ziel = new URL(wert); } catch { return { fehler: 'ungueltig' }; }

  let erlaubt;
  try { erlaubt = new URL(supabaseUrl ?? ''); } catch { return { fehler: 'konfiguration' }; }

  if (ziel.protocol !== 'https:')          return { fehler: 'fremd' };
  if (ziel.origin !== erlaubt.origin)       return { fehler: 'fremd' };
  if (ziel.pathname !== '/auth/v1/verify')  return { fehler: 'fremd' };

  return { url: ziel.toString() };
}

/* ── Darstellung ── */

const Seite = styled.main`
  min-height: 100vh; background: var(--color-primary);
  display: flex; align-items: center; justify-content: center;
  padding: 80px 24px;
`;

const Karte = styled.div`
  max-width: 480px; width: 100%; text-align: center;
  background: var(--color-white); border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card); padding: 44px 40px;
  @media (max-width: 560px) { padding: 32px 24px; }
`;

const Marke = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.3rem; letter-spacing: .08em; text-transform: var(--text-transform);
  color: var(--color-primary); margin: 0 0 22px;
`;

const Symbol = styled.div`
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(var(--color-accent-rgb), .12); color: var(--color-accent);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 18px;
  &[data-warnung="true"] { background: #FDECEA; color: #B3261E; }
`;

const Titel = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.5rem; color: var(--color-primary); margin: 0 0 10px;
`;

const Text = styled.p`
  font-family: var(--font-body); font-size: .95rem; line-height: 1.65;
  color: var(--color-text-muted); margin: 0 0 26px;
`;

/* Ein echtes <a href>, kein <Link>: Das Ziel liegt auf dem
   Supabase-Host, nicht in dieser App. */
const Knopf = styled.a`
  font-family: var(--font-body); font-size: 1rem; font-weight: 700;
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--color-accent); color: #fff; text-decoration: none;
  border-radius: 7px; padding: 14px 28px;
  &:hover { opacity: .92; }
`;

const Klein = styled.p`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.6;
  color: var(--color-text-muted); margin: 22px 0 0;
  a { color: var(--color-primary); }
`;

export default function Bestaetigen() {
  const { search } = useLocation();
  const ergebnis = leseBestaetigungsLink(search, process.env.REACT_APP_SUPABASE_URL);

  if (ergebnis.url) {
    return (
      <Seite>
        <Karte>
          <Marke>WERKRUF</Marke>
          <Symbol aria-hidden="true"><MailCheck size={26} /></Symbol>
          <Titel>Nur noch ein Klick</Titel>
          <Text>
            Bestätige deine E-Mail-Adresse. Danach geht es direkt mit der
            Einrichtung deines Betriebs weiter.
          </Text>
          <Knopf href={ergebnis.url} data-testid="bestaetigen-knopf">
            E-Mail-Adresse bestätigen <ArrowRight size={18} />
          </Knopf>
          <Klein>
            Du hast dich nicht bei WERKRUF angemeldet? Dann schließe diese
            Seite einfach. Ohne Bestätigung entsteht kein Konto.
          </Klein>
        </Karte>
      </Seite>
    );
  }

  /* Kein gültiger Link. Bewusst kein Detail dazu, WARUM — ein
     Angreifer, der hier fremde Ziele ausprobiert, soll nichts darüber
     lernen, was abgewiesen wurde. */
  return (
    <Seite>
      <Karte>
        <Marke>WERKRUF</Marke>
        <Symbol aria-hidden="true" data-warnung="true"><AlertTriangle size={26} /></Symbol>
        <Titel>Dieser Link ist unvollständig</Titel>
        <Text>
          Öffne den Bestätigungslink bitte direkt aus der E-Mail, die wir
          dir geschickt haben. Falls das nicht klappt, registriere dich
          einfach noch einmal — du bekommst dann eine neue Mail.
        </Text>
        <Klein>
          Fragen? Schreib an <a href="mailto:info@werkruf.com">info@werkruf.com</a>.
        </Klein>
      </Karte>
    </Seite>
  );
}
