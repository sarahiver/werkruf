import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useLocation, Link } from 'react-router-dom';
import {
  messId, leseConsent, speichereConsent, analysePfad, seitenwechsel,
  CONSENT_OEFFNEN, CONSENT_GEAENDERT,
} from '../utils/analytics';

/*
 * Einwilligungs-Hinweis fuer GA4 + Seitenwechsel-Begleiter.
 *
 *   • erscheint nur, wenn GA4 konfiguriert ist, noch nicht entschieden
 *     wurde und auf dieser Seite ueberhaupt gemessen wuerde — oder wenn
 *     jemand ausdruecklich „Cookie-Einstellungen" oeffnet
 *   • „Ablehnen" und „Zustimmen" sind gleich gross, gleich gestaltet,
 *     auf derselben Ebene; kein Vorhaken, kein Schliessen ohne Wahl
 *   • nicht modal: die Seite bleibt lesbar und bedienbar
 */

const Leiste = styled.div`
  position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 1000;
  max-width: 560px; margin: 0 auto;
  background: var(--color-white, #fff); color: var(--color-text, #1b1b1b);
  border-radius: 12px; padding: 18px 20px;
  box-shadow: 0 10px 30px rgba(11, 37, 69, .22), 0 0 0 1px rgba(11, 37, 69, .08);
  font-family: var(--font-body);
  h2 { font-family: var(--font-body); font-size: .98rem; font-weight: 700; margin: 0 0 6px; color: var(--color-primary, #0b2545); }
  p { font-size: .84rem; line-height: 1.55; margin: 0 0 14px; }
  a { color: var(--color-accent, #c45a00); }
`;
const Knoepfe = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
`;
/* Ein Stil fuer beide Knoepfe — keine Hervorhebung der Zustimmung. */
const Wahl = styled.button`
  padding: 11px 12px; border-radius: var(--radius-button, 8px); cursor: pointer;
  font-family: var(--font-body); font-weight: 700; font-size: .86rem;
  background: var(--color-primary, #0b2545); color: #fff; border: 1px solid var(--color-primary, #0b2545);
  &:focus-visible { outline: 3px solid rgba(242, 140, 40, .6); outline-offset: 2px; }
`;

export default function CookieHinweis() {
  const { pathname } = useLocation();
  const id = messId();
  const [offen, setOffen] = useState(() => Boolean(id) && leseConsent() === null && analysePfad(window.location.pathname) !== null);
  const [ausdruecklich, setAusdruecklich] = useState(false);

  /* Seitenwechsel: GA4 laden/messen nur, wenn erlaubt (analytics.js
     entscheidet und setzt sonst das Abschalt-Flag). */
  useEffect(() => {
    seitenwechsel(pathname);
    if (!ausdruecklich) setOffen(Boolean(id) && leseConsent() === null && analysePfad(pathname) !== null);
  }, [pathname, id, ausdruecklich]);

  useEffect(() => {
    const auf = () => { if (id) { setAusdruecklich(true); setOffen(true); } };
    const geaendert = () => seitenwechsel(window.location.pathname);
    window.addEventListener(CONSENT_OEFFNEN, auf);
    window.addEventListener(CONSENT_GEAENDERT, geaendert);
    return () => { window.removeEventListener(CONSENT_OEFFNEN, auf); window.removeEventListener(CONSENT_GEAENDERT, geaendert); };
  }, [id]);

  if (!offen) return null;
  const waehle = (erteilt) => { speichereConsent(erteilt); setAusdruecklich(false); setOffen(false); };
  const stand = leseConsent();

  return (
    <Leiste role="dialog" aria-modal="false" aria-labelledby="consent-titel" data-testid="consent-hinweis">
      <h2 id="consent-titel">Darf WERKRUF die Nutzung messen?</h2>
      <p>
        Mit deiner Zustimmung nutzen wir Google Analytics, um zu verstehen, welche Seiten besucht
        werden und wo die Registrierung hakt. Dabei setzt Google Cookies und erhält deine
        IP-Adresse; Daten können in die USA übertragen werden. Ohne Zustimmung wird nichts geladen.
        Du kannst deine Wahl jederzeit über „Cookie-Einstellungen" im Seitenfuß ändern.{' '}
        <Link to="/datenschutz">Datenschutzerklärung</Link>
        {stand && <><br /><strong>Aktuell: {stand === 'erteilt' ? 'zugestimmt' : 'abgelehnt'}.</strong></>}
      </p>
      <Knoepfe>
        <Wahl type="button" onClick={() => waehle(false)} data-testid="consent-ablehnen">Ablehnen</Wahl>
        <Wahl type="button" onClick={() => waehle(true)} data-testid="consent-zustimmen">Zustimmen</Wahl>
      </Knoepfe>
    </Leiste>
  );
}
