/*
 * „Wer dahintersteht" — ein kurzer Abschnitt auf der Startseite.
 *
 * Warum: Betriebe und Innungen schauen vor einer Antwort zuerst auf
 * werkruf.com. Bis hier sagte die Seite nirgends, wer WERKRUF macht —
 * der Name stand nur im Impressum. Ein Einzelanbieter wirkt nicht
 * kleiner, wenn er sich zeigt, sondern erreichbarer.
 *
 * Nur Tatsachen: Name, Ort, direkter Kontakt (aus config/anbieter.js,
 * derselben Quelle wie das Impressum). Keine erfundenen Kundenzahlen,
 * Zitate oder Gründungsgeschichten.
 *
 * Nur fuer die Handwerks-Marke; andere Branchen (Gastro/Beauty) sind
 * nicht live und bekommen den Abschnitt nicht.
 */
import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { Mail, Phone } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';
import { ANBIETER, telefonHref } from '../config/anbieter';

const Section = styled.section`
  background: var(--color-white);
  border-top: 1px solid var(--color-border);
  padding: 72px 24px;
`;
const Inner = styled.div`max-width: 660px; margin: 0 auto;`;
const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 12px;
`;
const Titel = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.7rem, 3.6vw, 2.3rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.08;
  margin-bottom: 18px;
  overflow-wrap: break-word; hyphens: auto;
`;
const Text = styled.p`
  font-family: var(--font-body); font-size: 1rem; line-height: 1.7;
  color: var(--color-text); margin: 0 0 14px;
`;
const Kontakt = styled.div`
  display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 20px;
  a {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: var(--font-body); font-weight: 600; font-size: .95rem;
    color: var(--color-primary); text-decoration: none;
    overflow-wrap: anywhere;
    svg { color: var(--color-accent); flex-shrink: 0; }
    &:hover { color: var(--color-accent); }
  }
`;
const Klein = styled.p`
  font-family: var(--font-body); font-size: .82rem; line-height: 1.6;
  color: var(--color-text-muted); margin: 18px 0 0;
  a { color: inherit; text-decoration: underline; }
`;

export default function WerDahinter() {
  const { key } = useIndustry();
  if (key !== 'handwerk') return null;
  const a = ANBIETER;
  return (
    <Section id="wer-dahinter" data-testid="wer-dahinter">
      <Inner>
        <Eyebrow>Wer dahintersteht</Eyebrow>
        <Titel>Gebaut in Hamburg — von jemandem, den du erreichst.</Titel>
        <Text>
          Ich bin {a.name} und entwickle {a.angebot} selbst, in {a.ort}. Kein Konzern, kein
          Callcenter: Wenn du eine Frage hast oder etwas nicht so funktioniert, wie es soll,
          landest du direkt bei mir.
        </Text>
        <Text>
          {a.angebot} ist neu und wird laufend besser. Was sich zuletzt geändert hat, steht
          im <Link to="/changelog" style={{ color: 'var(--color-primary)' }}>Changelog</Link>.
        </Text>
        <Kontakt>
          <a href={`mailto:${a.email}`}><Mail size={17} /> {a.email}</a>
          <a href={telefonHref(a.telefon)}><Phone size={17} /> {a.telefon}</a>
        </Kontakt>
        <Klein>Anbieter und Anschrift: <Link to="/impressum">Impressum</Link></Klein>
      </Inner>
    </Section>
  );
}
