/*
 * Der letzte Abschnitt der Landingpage.
 *
 * Er ersetzt die Leiste, die bis zum 16.10.2026 am Ende der
 * Leistungen stand: „Bereit, die falschen Kunden loszuwerden?" mit
 * einem Knopf auf #check. Beides war falsch — der Satz, weil WERKRUF
 * mehr gute Anfragen verspricht und nicht weniger Kunden, und der
 * Knopf, weil das Ziel seit dem 28.09.2026 nicht mehr existiert.
 *
 * Diese Sektion hat genau eine Aufgabe: den Besucher, der bis hierher
 * gelesen hat, in den Funnel zu lassen. Deshalb ein Ziel, ein Knopf,
 * und darunter die drei Zahlen, die die Entscheidung tragen.
 */
import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';
import { useAuthContext } from '../context/AuthContext';

const Section = styled.section`
  background: var(--color-primary);
  padding: 92px 24px;
  position: relative; overflow: hidden;
`;

const Streifen = styled.div`
  position: absolute; top: 0; left: 0; right: 0; height: 5px;
  background: repeating-linear-gradient(
    90deg,
    var(--color-accent) 0px, var(--color-accent) 20px,
    transparent 20px, transparent 80px
  );
  display: ${({ $show }) => ($show ? 'block' : 'none')};
`;

const Inner = styled.div`max-width: 760px; margin: 0 auto; text-align: center;`;

const Titel = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.8rem, 4.2vw, 2.9rem);
  text-transform: var(--text-transform);
  color: var(--color-white); line-height: 1.08;
  margin-bottom: 18px;
  overflow-wrap: break-word; hyphens: auto;
`;

const Akzent = styled.span`color: var(--color-accent);`;

const Text = styled.p`
  font-family: var(--font-body); font-size: 1.02rem;
  color: rgba(255,255,255,0.65); line-height: 1.7;
  max-width: 560px; margin: 0 auto 36px;
`;

const Cta = styled(Link)`
  display: inline-flex; align-items: center; gap: 10px;
  padding: 18px 36px;
  background: var(--color-accent); color: var(--color-white);
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.15rem; letter-spacing: 0.06em;
  text-transform: var(--text-transform);
  text-decoration: none;
  border-radius: var(--radius-button);
  transition: filter 0.2s;
  &:hover { filter: brightness(0.92); }
`;

const Zahlen = styled.p`
  font-family: var(--font-body); font-size: 0.86rem;
  color: rgba(255,255,255,0.45);
  margin-top: 18px; line-height: 1.7;
`;

export default function AbschlussCTA() {
  const { pricing, design, brand } = useIndustry();
  const { isAuthenticated } = useAuthContext();

  const ziel = isAuthenticated ? '/dashboard' : '/signup';

  return (
    <Section id="start">
      <Streifen $show={design.topStripe} />
      <Inner>
        <Titel>
          Dein Betrieb verdient einen Google-Auftritt,<br />
          der <Akzent>so professionell wirkt wie deine Arbeit.</Akzent>
        </Titel>
        <Text>
          {brand.name} behält ihn im Blick und sagt dir, was zu tun ist.
          Den Rest kannst du vergessen.
        </Text>

        <Cta to={ziel}>
          {isAuthenticated
            ? 'Zum Dashboard'
            : `${pricing.trialDays} Tage kostenlos testen`}
          <ArrowRight size={20} />
        </Cta>

        <Zahlen>
          {pricing.trialDays} Tage kostenlos · danach {pricing.monthlyPrice}{' '}
          {pricing.currency} {pricing.priceLabel} · monatlich kündbar ·
          keine Einrichtungsgebühr
        </Zahlen>
      </Inner>
    </Section>
  );
}
