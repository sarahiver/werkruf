/**
 * /founding-partner/:token — Interessensseite aus der Founding-Partner-Mail (WP16, Fix1).
 *
 * GET zeigt nur an (die Function registriert dabei hoechstens das technische
 * Ereignis cta_viewed). Erst das Formular — POST direkt an die Function —
 * setzt cta_clicked und den Vertriebsstatus auf „interesse" (nur aufwaerts,
 * idempotent). Die Function antwortet mit 302 hierher zurueck (?danke=1).
 */
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { Check } from 'lucide-react';
import { FUNCTIONS_BASE, TEXT, istTokenForm, ladeTokenAuskunft, setzeTokenSeitenMeta } from '../utils/tokenSeite';

const Seite = styled.main`min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: 40px 20px;`;
const Karte = styled.div`max-width: 480px; width: 100%; background: #fff; border: 1px solid var(--color-border); border-radius: 12px; padding: 36px 32px;`;
const Marke = styled.p`font-family: var(--font-body); font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); margin: 0 0 18px;`;
const Titel = styled.h1`font-family: var(--font-display); font-size: 1.25rem; color: var(--color-primary); margin: 0 0 10px; line-height: 1.35;`;
const Text = styled.p`font-family: var(--font-body); font-size: .95rem; line-height: 1.6; color: var(--color-text); margin: 0 0 20px;`;
const Knopf = styled.button`
  font-family: var(--font-body); font-size: .95rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
  background: var(--color-primary); color: #fff; border: 0; border-radius: 7px; padding: 13px 24px; &:hover { opacity: .9; } &:disabled { opacity: .55; cursor: default; }
`;
const Fuss = styled.p`font-family: var(--font-body); font-size: .76rem; color: #8A929C; margin: 22px 0 0; line-height: 1.5;`;

export default function FoundingPartnerInteresse() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const danke = params.get('danke') === '1';
  const status = params.get('status');
  const [zustand, setZustand] = useState(danke ? 'danke' : 'laedt');   // laedt | ok | danke | ungueltig | netz
  const [sendet, setSendet] = useState(false);

  useEffect(() => setzeTokenSeitenMeta(), []);

  useEffect(() => {
    let aktiv = true;
    if (danke) { setZustand('danke'); return undefined; }
    if (status === 'ungueltig' || !istTokenForm(token)) { setZustand('ungueltig'); return undefined; }
    (async () => {
      const r = await ladeTokenAuskunft(`${FUNCTIONS_BASE}/fp/${encodeURIComponent(token)}/info`);
      if (aktiv) setZustand(r.zustand);
    })();
    return () => { aktiv = false; };
  }, [token, danke, status]);

  const interesseAktion = `${FUNCTIONS_BASE}/fp/${encodeURIComponent(token ?? '')}/interesse`;

  return (
    <Seite>
      <Karte data-testid="fp-interesse" data-zustand={zustand}>
        <Marke>WERKRUF Founding Partner</Marke>

        {zustand === 'laedt' && <Text>Einen Moment …</Text>}

        {zustand === 'netz' && (
          <>
            <Titel>Kurz hakt es.</Titel>
            <Text role="alert">{TEXT.netz}</Text>
            <Knopf type="button" onClick={() => window.location.reload()}>Erneut versuchen</Knopf>
          </>
        )}

        {zustand === 'ungueltig' && (
          <>
            <Titel>{TEXT.ungueltig}</Titel>
            <Text>Wenn du Interesse an WERKRUF als Founding Partner hast, antworte einfach kurz auf die E-Mail.</Text>
          </>
        )}

        {zustand === 'danke' && (
          <>
            <Titel><Check size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} />Danke — Interesse ist notiert.</Titel>
            <Text>Ich melde mich persönlich bei dir. Du musst jetzt nichts weiter tun.</Text>
            <Fuss>Iver Bohnes · WERKRUF</Fuss>
          </>
        )}

        {zustand === 'ok' && (
          <>
            <Titel>Interesse?</Titel>
            <Text>Als Founding Partner nutzt du WERKRUF dauerhaft kostenlos und gibst mir kurz Rückmeldung, was hilft und was nervt. Ein Klick genügt — ich melde mich dann persönlich.</Text>
            {/* Nur der POST setzt Interesse. Scanner folgen Links, sie schicken keine Formulare ab. */}
            <form method="POST" action={interesseAktion} onSubmit={() => setSendet(true)} data-testid="fp-form">
              <Knopf type="submit" disabled={sendet} data-testid="fp-ja">{sendet ? 'Einen Moment …' : 'Ja, Interesse'}</Knopf>
            </form>
            <Fuss>Mit dem Klick bestätigst du nur dein Interesse. Es wird nichts eingerichtet und nichts abgeschlossen.</Fuss>
          </>
        )}
      </Karte>
    </Seite>
  );
}
