import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';

const Wrap = styled.div`
  max-width: 720px; margin: 0 auto;
  padding: 80px 24px 120px;
`;

const Back = styled(Link)`
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted); text-decoration: none;
  margin-bottom: 40px;
  &:hover { color: var(--color-accent); }
`;

const Badge = styled.div`
  display: inline-block;
  background: rgba(var(--color-accent-rgb), .1);
  border: 1px solid rgba(var(--color-accent-rgb), .25);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .7rem; letter-spacing: .12em; text-transform: uppercase;
  padding: 4px 10px; border-radius: var(--radius-button);
  margin-bottom: 14px;
`;

const Title = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 40px;
  border-bottom: 2px solid var(--color-border);
  padding-bottom: 20px;
`;

const Section = styled.section`margin-bottom: 36px;`;

const H2 = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 12px;
`;

const P = styled.p`
  font-family: var(--font-body); font-size: .92rem;
  color: var(--color-text); line-height: 1.75;
  margin-bottom: 8px;
`;

const A = styled.a`
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

export default function Impressum() {
  return (
    <Wrap>
      <Back to="/">← Zurück zur Startseite</Back>
      <Badge>Rechtliches</Badge>
      <Title>Impressum</Title>

      <Section>
        <H2>Angaben gemäß § 5 TMG</H2>
        <P>
          Iver Gentz<br />
          Große Freiheit 82<br />
          22767 Hamburg<br />
          Deutschland
        </P>
      </Section>

      <Section>
        <H2>Kontakt</H2>
        <P>
          Telefon: <A href="tel:+4917666631237">+49 176 66631237</A><br />
          E-Mail: <A href="mailto:hallo@werkruf.de">hallo@werkruf.de</A>
        </P>
      </Section>

      <Section>
        <H2>Umsatzsteuer-ID</H2>
        <P>
          Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:<br />
          <strong>[Bitte deine USt-IdNr. eintragen oder streichen falls nicht vorhanden]</strong>
        </P>
      </Section>

      <Section>
        <H2>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</H2>
        <P>
          Iver Gentz<br />
          Große Freiheit 82<br />
          22767 Hamburg
        </P>
      </Section>

      <Section>
        <H2>Streitschlichtung</H2>
        <P>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
          <A href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
            https://ec.europa.eu/consumers/odr/
          </A>
        </P>
        <P>
          Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </P>
      </Section>

      <Section>
        <H2>Haftung für Inhalte</H2>
        <P>
          Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten
          nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als
          Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
          Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
          Tätigkeit hinweisen.
        </P>
        <P>
          Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den
          allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch
          erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei
          Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend
          entfernen.
        </P>
      </Section>

      <Section>
        <H2>Haftung für Links</H2>
        <P>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
          Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen.
          Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der
          Seiten verantwortlich.
        </P>
      </Section>

      <Section>
        <H2>Urheberrecht</H2>
        <P>
          Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
          dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art
          der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen
          Zustimmung des jeweiligen Autors bzw. Erstellers.
        </P>
      </Section>
    </Wrap>
  );
}
