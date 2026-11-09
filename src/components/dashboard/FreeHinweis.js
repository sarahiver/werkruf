import React from 'react';
import styled from 'styled-components';
import { ArrowRight, Eye } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useCheckout } from '../../hooks/useCheckout';
import { hatteSchonAbo } from '../../utils/subscription';
import { FREE_HINWEIS, proCtaText } from '../../utils/freeUmfang';
import { PRO_FEATURES } from './ProGate';

/*
 * Free-Hinweis auf der Uebersicht (WP7 §7).
 *
 * Steht dort, wo fuer Pro die Aufgabenliste steht. Kein Redesign,
 * keine Landingpage: ein Kasten, der sagt, was Free ist, was Pro
 * dazugibt, und ein Knopf. Sachlich — Free ist ein Rueckfallzustand,
 * kein Verkaufsgespraech.
 */

const Kasten = styled.section`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 22px 24px;
  margin-bottom: 20px;
`;

const Kopf = styled.div`
  display: flex; align-items: center; gap: 10px;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; color: var(--color-primary);
  text-transform: var(--text-transform);
  margin-bottom: 8px;
  svg { color: var(--color-accent); }
`;

const Text = styled.p`
  font-family: var(--font-body); font-size: .9rem; line-height: 1.6;
  color: var(--color-text); margin-bottom: 14px;
`;

const Liste = styled.ul`
  list-style: none; margin: 0 0 18px; padding: 0;
  display: grid; gap: 6px;
  font-family: var(--font-body); font-size: .85rem; color: var(--color-text-muted);
  li::before { content: '•'; color: var(--color-accent); margin-right: 8px; }
`;

const Zeile = styled.div`
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
`;

const Knopf = styled.button`
  padding: 11px 18px;
  background: var(--color-accent); color: white; border: none;
  border-radius: var(--radius-button); cursor: pointer;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .9rem; letter-spacing: .05em; text-transform: var(--text-transform);
  display: inline-flex; align-items: center; gap: 8px;
  &:disabled { opacity: .6; cursor: not-allowed; }
`;

const Preis = styled.span`
  font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted);
`;

const Fehler = styled.p`
  margin-top: 10px; color: #B3261E; font-family: var(--font-body); font-size: .8rem;
`;

export default function FreeHinweis({ preis = 49 }) {
  const { profile } = useAuthContext();
  const { startCheckout, loading, error } = useCheckout();
  const hatteAbo = hatteSchonAbo(profile);

  const upgrade = () => startCheckout({
    plan: 'monthly',
    path: 'optimisation',
    companyName: profile?.company_name || '',
    industryKey: profile?.industry_key || 'handwerk',
    returnPath: '/dashboard',
  });

  return (
    <Kasten data-testid="free-hinweis" aria-label="Free-Modus">
      <Kopf><Eye size={18} /> {FREE_HINWEIS.titel}</Kopf>
      <Text>{FREE_HINWEIS.text}</Text>
      <Liste>
        {PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}
      </Liste>
      <Zeile>
        <Knopf type="button" onClick={upgrade} disabled={loading}>
          {loading ? 'Weiterleitung zu Stripe…' : <>{proCtaText(hatteAbo)} <ArrowRight size={15} /></>}
        </Knopf>
        <Preis>
          {hatteAbo
            ? `${preis} € / Monat · monatlich kündbar`
            : `30 Tage gratis, danach ${preis} € / Monat · monatlich kündbar`}
        </Preis>
      </Zeile>
      {error && <Fehler role="alert">{error}</Fehler>}
    </Kasten>
  );
}
