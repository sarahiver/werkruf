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

const H3 = styled.h3`
  font-family: var(--font-body); font-weight: 700;
  font-size: .92rem; color: var(--color-primary);
  margin: 14px 0 6px;
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

const InfoBox = styled.div`
  background: var(--color-bg);
  border-left: 3px solid var(--color-accent);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  padding: 14px 18px; margin: 12px 0;
`;

export default function Datenschutz() {
  return (
    <Wrap>
      <Back to="/">← Zurück zur Startseite</Back>
      <Badge>Rechtliches</Badge>
      <Title>Datenschutzerklärung</Title>

      <Section>
        <H2>1. Datenschutz auf einen Blick</H2>
        <H3>Allgemeine Hinweise</H3>
        <P>
          Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren
          personenbezogenen Daten passiert, wenn Sie diese Website besuchen. Personenbezogene
          Daten sind alle Daten, mit denen Sie persönlich identifiziert werden können.
        </P>

        <H3>Datenerfassung auf dieser Website</H3>
        <P>
          <strong>Wer ist verantwortlich für die Datenerfassung auf dieser Website?</strong><br />
          Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber:
          Iver Gentz, Große Freiheit 82, 22767 Hamburg, E-Mail: hallo@werkruf.de
        </P>
        <P>
          <strong>Wie erfassen wir Ihre Daten?</strong><br />
          Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen — z. B. durch
          Eingabe in ein Kontaktformular oder bei der Registrierung. Andere Daten werden automatisch
          beim Besuch der Website durch unsere IT-Systeme erfasst (technische Daten wie Browser,
          Betriebssystem, Uhrzeit des Seitenaufrufs).
        </P>
        <P>
          <strong>Wofür nutzen wir Ihre Daten?</strong><br />
          Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu
          gewährleisten. Andere Daten können zur Analyse Ihres Nutzerverhaltens verwendet werden.
        </P>
        <P>
          <strong>Welche Rechte haben Sie bezüglich Ihrer Daten?</strong><br />
          Sie haben jederzeit das Recht, unentgeltlich Auskunft über Herkunft, Empfänger und Zweck
          Ihrer gespeicherten personenbezogenen Daten zu erhalten. Sie haben außerdem ein Recht,
          die Berichtigung oder Löschung dieser Daten zu verlangen. Für weitere Fragen zum
          Datenschutz können Sie sich jederzeit an uns wenden.
        </P>
      </Section>

      <Section>
        <H2>2. Hosting</H2>
        <P>
          Diese Website wird bei <strong>Vercel Inc.</strong> gehostet. Anbieter ist die
          Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, USA.
        </P>
        <P>
          Vercel verarbeitet Daten auf Servern in verschiedenen Regionen. Weitere Informationen
          finden Sie in der Datenschutzerklärung von Vercel:{' '}
          <A href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
            https://vercel.com/legal/privacy-policy
          </A>
        </P>
      </Section>

      <Section>
        <H2>3. Allgemeine Hinweise und Pflichtinformationen</H2>
        <H3>Datenschutz</H3>
        <P>
          Der Betreiber dieser Seiten nimmt den Schutz Ihrer persönlichen Daten sehr ernst. Wir
          behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen
          Datenschutzvorschriften sowie dieser Datenschutzerklärung.
        </P>

        <H3>Hinweis zur verantwortlichen Stelle</H3>
        <InfoBox>
          <P style={{ margin: 0 }}>
            Iver Gentz<br />
            Große Freiheit 82, 22767 Hamburg<br />
            Telefon: +49 176 66631237<br />
            E-Mail: <A href="mailto:hallo@werkruf.de">hallo@werkruf.de</A>
          </P>
        </InfoBox>

        <H3>Speicherdauer</H3>
        <P>
          Soweit innerhalb dieser Datenschutzerklärung keine speziellere Speicherdauer genannt
          wurde, verbleiben Ihre personenbezogenen Daten bei uns, bis der Zweck für die
          Datenverarbeitung entfällt. Wenn Sie ein berechtigtes Löschersuchen geltend machen oder
          eine Einwilligung zur Datenverarbeitung widerrufen, werden Ihre Daten gelöscht, sofern
          wir keine anderen rechtlich zulässigen Gründe für die Speicherung haben.
        </P>

        <H3>Widerruf Ihrer Einwilligung zur Datenverarbeitung</H3>
        <P>
          Viele Datenverarbeitungsvorgänge sind nur mit Ihrer ausdrücklichen Einwilligung möglich.
          Sie können eine bereits erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit
          der bis zum Widerruf erfolgten Datenverarbeitung bleibt vom Widerruf unberührt.
        </P>

        <H3>Recht auf Datenübertragbarkeit</H3>
        <P>
          Sie haben das Recht, Daten, die wir auf Grundlage Ihrer Einwilligung oder in Erfüllung
          eines Vertrags automatisiert verarbeiten, an sich oder an einen Dritten in einem gängigen,
          maschinenlesbaren Format aushändigen zu lassen.
        </P>

        <H3>Auskunft, Löschung und Berichtigung</H3>
        <P>
          Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf
          unentgeltliche Auskunft über Ihre gespeicherten personenbezogenen Daten, deren Herkunft
          und Empfänger und den Zweck der Datenverarbeitung und ggf. ein Recht auf Berichtigung
          oder Löschung dieser Daten. Hierzu sowie zu weiteren Fragen zum Thema personenbezogene
          Daten können Sie sich jederzeit an uns wenden.
        </P>

        <H3>Beschwerderecht bei der zuständigen Aufsichtsbehörde</H3>
        <P>
          Im Falle von Verstößen gegen die DSGVO steht den Betroffenen ein Beschwerderecht bei
          einer Aufsichtsbehörde zu. Zuständige Aufsichtsbehörde für Hamburg ist:{' '}
          <A href="https://www.datenschutz-hamburg.de" target="_blank" rel="noopener noreferrer">
            Der Hamburgische Beauftragte für Datenschutz und Informationsfreiheit
          </A>
        </P>
      </Section>

      <Section>
        <H2>4. Datenerfassung auf dieser Website</H2>

        <H3>Cookies</H3>
        <P>
          Unsere Website verwendet funktionale Cookies, die für den Betrieb der Website erforderlich
          sind (z. B. für die Anmeldung). Wir setzen keine Tracking-Cookies ohne Ihre Einwilligung.
        </P>

        <H3>Server-Log-Dateien</H3>
        <P>
          Der Provider der Seiten erhebt und speichert automatisch Informationen in sogenannten
          Server-Log-Dateien, die Ihr Browser automatisch übermittelt. Dies sind: Browsertyp und
          Browserversion, verwendetes Betriebssystem, Referrer URL, Hostname des zugreifenden
          Rechners, Uhrzeit der Serveranfrage, IP-Adresse.
        </P>
        <P>
          Diese Daten werden nicht mit anderen Datenquellen zusammengeführt. Rechtsgrundlage
          ist Art. 6 Abs. 1 lit. f DSGVO.
        </P>

        <H3>Kontaktformular</H3>
        <P>
          Wenn Sie uns per Kontaktformular Anfragen zukommen lassen, werden Ihre Angaben aus dem
          Anfrageformular inklusive der von Ihnen dort angegebenen Kontaktdaten zum Zweck der
          Bearbeitung der Anfrage und für den Fall von Anschlussfragen bei uns gespeichert. Diese
          Daten geben wir nicht ohne Ihre Einwilligung weiter. Rechtsgrundlage ist Art. 6 Abs. 1
          lit. b DSGVO.
        </P>

        <H3>Registrierung auf dieser Website</H3>
        <P>
          Sie können sich auf dieser Website registrieren, um zusätzliche Funktionen zu nutzen.
          Die eingegebenen Daten verwenden wir nur zum Zweck der Nutzung des jeweiligen Angebots,
          für das Sie sich registriert haben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
        </P>
      </Section>

      <Section>
        <H2>5. Analyse-Tools und Werbung</H2>

        <H3>Google Analytics</H3>
        <P>
          Diese Website nutzt Google Analytics zur Analyse der Websitenutzung. Anbieter ist
          Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland.
        </P>
        <P>
          Google Analytics verwendet Cookies. Die durch den Cookie erzeugten Informationen über
          Ihre Benutzung dieser Website werden an einen Server von Google in den USA übertragen
          und dort gespeichert. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
        </P>
        <P>
          Sie können die Speicherung der Cookies durch eine entsprechende Einstellung Ihrer
          Browser-Software verhindern. Weitere Informationen:{' '}
          <A href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            https://policies.google.com/privacy
          </A>
        </P>
      </Section>

      <Section>
        <H2>6. Zahlungsanbieter</H2>

        <H3>Stripe</H3>
        <P>
          Für die Abwicklung von Zahlungen nutzen wir den Dienst Stripe. Anbieter ist die
          Stripe, Inc., 510 Townsend Street, San Francisco, CA 94103, USA.
        </P>
        <P>
          Wenn Sie einen Kauf tätigen, werden Ihre Zahlungsdaten (Name, Kartennummer, Ablaufdatum,
          CVC) von Stripe verarbeitet. Ihre Zahlungsdaten gelangen nicht in unsere Datenbank.
          Weitere Informationen:{' '}
          <A href="https://stripe.com/de/privacy" target="_blank" rel="noopener noreferrer">
            https://stripe.com/de/privacy
          </A>
        </P>
      </Section>

      <Section>
        <H2>7. Drittanbieter-Dienste</H2>

        <H3>Supabase</H3>
        <P>
          Wir nutzen Supabase zur Datenbankverarbeitung und Nutzerauthentifizierung. Anbieter ist
          Supabase Inc., 970 Toa Payoh North, Singapur. Rechenzentrum: EU (Frankfurt). Weitere
          Informationen:{' '}
          <A href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">
            https://supabase.com/privacy
          </A>
        </P>

        <H3>Google Places API</H3>
        <P>
          Wir nutzen die Google Places API zur Unternehmenssuche. Anbieter ist Google Ireland
          Limited, Gordon House, Barrow Street, Dublin 4, Irland. Weitere Informationen:{' '}
          <A href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            https://policies.google.com/privacy
          </A>
        </P>

        <H3>Brevo (E-Mail-Versand)</H3>
        <P>
          Wir nutzen Brevo (ehemals Sendinblue) für den transaktionalen E-Mail-Versand. Anbieter
          ist Sendinblue SAS, 55 rue d'Amsterdam, 75008 Paris, Frankreich. Weitere Informationen:{' '}
          <A href="https://www.brevo.com/de/legal/privacypolicy/" target="_blank" rel="noopener noreferrer">
            https://www.brevo.com/de/legal/privacypolicy/
          </A>
        </P>
      </Section>

      <P style={{ color: 'var(--color-text-muted)', fontSize: '.8rem', marginTop: 40 }}>
        Stand: März 2026
      </P>
    </Wrap>
  );
}
