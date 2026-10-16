/*
 * Häufige Fragen auf der Landingpage.
 *
 * Sieben Fragen, die vor einer Kaufentscheidung wirklich gestellt
 * werden. Sie stehen ausführlicher auf /hilfe — diese Sektion
 * verdoppelt die Seite nicht, sie nimmt die Fragen vorweg, die sonst
 * zum Abbruch führen: Was darf WERKRUF bei Google? Veröffentlicht es
 * etwas ohne mich? Was passiert nach der Kündigung?
 *
 * Alles aufgeklappt statt in Akkordeons. Begründung: Eine zugeklappte
 * Antwort wird nicht gelesen, und bei sieben kurzen Antworten spart
 * das Zuklappen nichts, was den zusätzlichen Klick wert wäre.
 *
 * Die Inhalte stehen in industryConfig unter copy.faq.
 */
import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { useIndustry } from '../context/IndustryContext';

const Section = styled.section`
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
  padding: 84px 24px;
`;

/* 820px waren auf einem 1280er-Bildschirm eine lange, dünne Spalte in
   einem weiten leeren Feld. 660px lesen sich besser (rund 75 Zeichen
   je Zeile) und lassen den Block als Block wirken statt als Rest. */
const Inner = styled.div`max-width: 660px; margin: 0 auto;`;

/* Die Fragen stehen jetzt in einem gemeinsamen Rahmen. Vorher waren
   es freistehende Zeilen mit Trennlinien — zusammenhanglos auf einer
   breiten, hellen Fläche. */
const Block = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 4px 28px;
  @media (max-width: 620px) { padding: 2px 18px; }
`;

const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 12px;
`;

const Titel = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.9rem, 4vw, 2.6rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.06;
  margin-bottom: 28px;
  overflow-wrap: break-word; hyphens: auto;
`;

/* Dichter als vorher: 22px auf 16px, und die Linie trennt nur noch
   zwischen den Einträgen, nicht oben und unten zusätzlich zum
   Rahmen. */
const Eintrag = styled.div`
  padding: 16px 0;
  border-top: 1px solid var(--color-border);
  &:first-of-type { border-top: none; }
`;

/* Die Frage bekommt den Akzentstrich, den sonst nur Karten tragen —
   so liest sie sich als eigenes Element und nicht als Fliesstext mit
   fetter erster Zeile. */
const Frage = styled.h3`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; letter-spacing: 0.02em;
  text-transform: var(--text-transform);
  color: var(--color-primary);
  margin-bottom: 6px; padding-left: 14px;
  border-left: 3px solid var(--color-accent);
`;

const Antwort = styled.p`
  font-family: var(--font-body); font-size: 0.92rem;
  color: var(--color-text-muted); line-height: 1.68;
  padding-left: 17px;
`;

const Weiter = styled.p`
  font-family: var(--font-body); font-size: 0.9rem;
  color: var(--color-text-muted); line-height: 1.7;
  margin-top: 22px; text-align: center;
  a { color: var(--color-accent); font-weight: 700; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export default function FAQ() {
  const { copy } = useIndustry();
  const fragen = copy.faq;
  /* Die Adresse kommt aus der Konfiguration, damit sie nicht an einer
     achten Stelle gepflegt werden muss. */
  const mail = copy.footer?.email ?? 'info@werkruf.com';

  if (!Array.isArray(fragen) || !fragen.length) return null;

  return (
    <Section id="faq">
      <Inner>
        <Eyebrow>Bevor du dich entscheidest</Eyebrow>
        <Titel>Häufige Fragen</Titel>

        <Block>
          {fragen.map((f) => (
            <Eintrag key={f.frage}>
              <Frage>{f.frage}</Frage>
              <Antwort>{f.antwort}</Antwort>
            </Eintrag>
          ))}
        </Block>

        <Weiter>
          Etwas anderes auf dem Herzen? Weitere Antworten stehen in der{' '}
          <Link to="/hilfe">Hilfe</Link> — oder schreib einfach an{' '}
          <a href={`mailto:${mail}`}>{mail}</a>. Es antwortet ein Mensch,
          werktags innerhalb von 24 Stunden.
        </Weiter>
      </Inner>
    </Section>
  );
}
