import React from 'react';
import styled from 'styled-components';
import { TARIFE, JAHRES_ERSPARNIS_MONATE } from '../utils/tarife';

/*
 * WP13 — Auswahl des Abrechnungsintervalls vor dem Checkout.
 *
 * Zwei Knoepfe, kein Toggle-Theater. Der Wert ist der Tarif-Key
 * ('monthly' | 'yearly'), den der Server auf die Price-ID mappt. Hier
 * steht kein Preis, der nicht in src/utils/tarife.js steht.
 */

const Wahl = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;
  @media (max-width: 420px) { grid-template-columns: 1fr; }
`;
const Option = styled.button`
  text-align: left; padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 2px solid ${(p) => (p.$aktiv ? 'var(--color-accent)' : 'var(--color-border)')};
  background: ${(p) => (p.$aktiv ? '#FFF7ED' : 'var(--color-white)')};
  font-family: var(--font-body); color: var(--color-text);
  strong { display: block; font-size: .95rem; color: var(--color-primary); }
  small  { display: block; font-size: .75rem; color: var(--color-text-muted); margin-top: 2px; }
`;

export default function TarifWahl({ value = 'monthly', onChange, disabled = false }) {
  return (
    <Wahl role="radiogroup" aria-label="Abrechnung" data-testid="tarifwahl">
      <Option type="button" role="radio" aria-checked={value === 'monthly'} $aktiv={value === 'monthly'}
        disabled={disabled} onClick={() => onChange?.('monthly')} data-testid="tarif-monthly">
        <strong>{TARIFE.monthly.preisText}</strong>
        <small>monatlich kündbar</small>
      </Option>
      <Option type="button" role="radio" aria-checked={value === 'yearly'} $aktiv={value === 'yearly'}
        disabled={disabled} onClick={() => onChange?.('yearly')} data-testid="tarif-yearly">
        <strong>{TARIFE.yearly.preisText}</strong>
        <small>{JAHRES_ERSPARNIS_MONATE} Monate geschenkt · jährlich kündbar</small>
      </Option>
    </Wahl>
  );
}
