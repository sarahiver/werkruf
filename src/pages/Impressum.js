import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { ANBIETER, vollerName, telefonHref } from '../config/anbieter';

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
  const a = ANBIETER;
  return (
    <Wrap>
      <Back to="/">← Zurück zur Startseite</Back>
      <Badge>Rechtliches</Badge>
      <Title>Impressum</Title>

      <Section>
        <H2>Angaben gemäß § 5 DDG</H2>
        <P>
          {vollerName(a)}<br />
          {a.angebot}<br />
          {a.strasse}<br />
          {a.plz} {a.ort}<br />
          {a.land}
        </P>
      </Section>

      <Section>
        <H2>Kontakt</H2>
        <P>
          Telefon: <A href={telefonHref(a.telefon)}>{a.telefon}</A><br />
          E-Mail: <A href={`mailto:${a.email}`}>{a.email}</A>
        </P>
      </Section>

      <Section>
        <H2>Umsatzsteuer</H2>
        {a.ustIdNr ? (
          <P>Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz: {a.ustIdNr}</P>
        ) : a.kleinunternehmer ? (
          <P>
            Gemäß § 19 Umsatzsteuergesetz wird keine Umsatzsteuer berechnet und daher auch nicht in
            Rechnungen ausgewiesen.
          </P>
        ) : null}
        {a.wirtschaftsIdNr && <P>Wirtschafts-Identifikationsnummer: {a.wirtschaftsIdNr}</P>}
      </Section>

      <Section>
        <H2>Inhaltlich verantwortlich gemäß § 18 Abs. 2 MStV</H2>
        <P>
          {a.inhaltlichVerantwortlich}<br />
          {a.strasse}<br />
          {a.plz} {a.ort}
        </P>
      </Section>

      <Section>
        <H2>Verbraucherstreitbeilegung</H2>
        <P>
          Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </P>
      </Section>

      <Section>
        <H2>Haftung für Inhalte</H2>
        <P>
          Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen
          Gesetzen verantwortlich. Für übermittelte oder gespeicherte fremde Informationen sind wir
          nach Maßgabe der §§ 7 bis 10 DDG verantwortlich und nicht verpflichtet, diese zu
          überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit
          hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen
          nach den allgemeinen Gesetzen bleiben unberührt; eine Haftung besteht insoweit erst ab
          Kenntnis einer konkreten Rechtsverletzung. Bei Bekanntwerden entsprechender
          Rechtsverletzungen entfernen wir diese Inhalte umgehend.
        </P>
      </Section>

      <Section>
        <H2>Haftung für Links</H2>
        <P>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
          Einfluss haben. Für diese fremden Inhalte übernehmen wir keine Gewähr; verantwortlich ist
          stets der jeweilige Anbieter oder Betreiber der Seiten. Bei Bekanntwerden von
          Rechtsverletzungen entfernen wir derartige Links umgehend.
        </P>
      </Section>

      <Section>
        <H2>Urheberrecht</H2>
        <P>
          Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
          dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art
          der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen der schriftlichen
          Zustimmung des Rechteinhabers.
        </P>
      </Section>

      <P style={{ color: 'var(--color-text-muted)', fontSize: '.8rem', marginTop: 40 }}>
        Stand: November 2026
      </P>
    </Wrap>
  );
}
