import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { ANBIETER, vollerName, telefonHref } from '../config/anbieter';
import { messId, leseConsent, oeffneConsentEinstellungen } from '../utils/analytics';

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
  /* "Datenschutzerklaerung" ist ein Wort und passt auf einem Telefon
     nicht in eine Zeile. Ohne Trennung schob es die ganze Seite 43px
     nach rechts und erzeugte waagerechtes Scrollen. lang="de" steht
     in index.html, also trennt der Browser richtig. */
  overflow-wrap: break-word;
  hyphens: auto;
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

const Code = styled.code`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .85em; background: var(--color-bg);
  padding: 1px 5px; border-radius: 3px;
`;

const A = styled.a`
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

/* Interner Verweis. Als react-router-Link, nicht als <a href>, sonst
   laedt der Browser die Anwendung neu. */
const IntLink = styled(Link)`
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

const UL = styled.ul`
  font-family: var(--font-body); font-size: .92rem; color: var(--color-text);
  line-height: 1.7; margin: 0 0 10px 20px;
  li { margin-bottom: 4px; }
`;

const EinstellungsKnopf = styled.button`
  font-family: var(--font-body); font-weight: 700; font-size: .88rem;
  padding: 9px 14px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: #fff; border: 1px solid var(--color-primary);
  margin: 4px 0 10px;
`;

const InfoBox = styled.div`
  background: var(--color-bg);
  border-left: 3px solid var(--color-accent);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  padding: 14px 18px; margin: 12px 0;
`;

/* Externer Link, immer mit noopener. */
function Ext({ href, children }) {
  return <A href={href} target="_blank" rel="noopener noreferrer">{children || href}</A>;
}

/*
 * Datenschutzerklaerung — abgeleitet aus dem produktiven Datenfluss
 * (Stand November 2026). Nicht aufgenommen sind Dienste, die nur im
 * Repository liegen und von keiner erreichbaren Seite benutzt werden
 * (oeffentliche Places-Auswertung/PDF-Bericht mit Cloudflare Turnstile,
 * seit 28.09.2026 abgeschaltet). Wird so ein Weg wieder eingeschaltet,
 * muss er hier ergaenzt werden.
 */
export default function Datenschutz() {
  const a = ANBIETER;
  const ga = messId();
  const stand = leseConsent();

  return (
    <Wrap>
      <Back to="/">← Zurück zur Startseite</Back>
      <Badge>Rechtliches</Badge>
      <Title>Datenschutzerklärung</Title>

      <Section>
        <H2>1. Verantwortlicher</H2>
        <InfoBox>
          <P style={{ margin: 0 }}>
            {vollerName(a)} — {a.angebot}<br />
            {a.strasse}, {a.plz} {a.ort}<br />
            Telefon: <A href={telefonHref(a.telefon)}>{a.telefon}</A><br />
            E-Mail: <A href={`mailto:${a.email}`}>{a.email}</A>
          </P>
        </InfoBox>
        <P>
          Ein Datenschutzbeauftragter ist nicht bestellt, weil die gesetzlichen Voraussetzungen
          dafür nicht vorliegen. Für alle Fragen zum Datenschutz erreichen Sie uns unter der
          oben genannten E-Mail-Adresse.
        </P>
      </Section>

      <Section>
        <H2>2. Überblick</H2>
        <P>
          WERKRUF ist ein Werkzeug, mit dem Betriebe ihr Google-Unternehmensprofil pflegen. Wir
          verarbeiten personenbezogene Daten, wenn Sie die Website aufrufen, ein Kundenkonto
          anlegen und nutzen, mit uns Kontakt aufnehmen oder wenn wir Sie als Betrieb geschäftlich
          ansprechen. Welche Daten, wofür, auf welcher Rechtsgrundlage und wie lange, steht in den
          folgenden Abschnitten.
        </P>
        <P>
          Rechtsgrundlagen sind insbesondere Art. 6 Abs. 1 lit. a DSGVO (Einwilligung), lit. b
          (Vertrag und vorvertragliche Maßnahmen), lit. c (rechtliche Pflicht) und lit. f
          (berechtigtes Interesse) sowie für den Zugriff auf Ihr Endgerät § 25 TDDDG.
        </P>
      </Section>

      <Section>
        <H2>3. Aufruf der Website und Hosting</H2>
        <P>
          Die Website und die Anwendung werden von der <strong>Vercel Inc.</strong>, 340 S Lemon
          Ave #4133, Walnut, CA 91789, USA, ausgeliefert. Beim Aufruf verarbeitet Vercel
          technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse,
          Referrer, Browser und Betriebssystem. Das ist erforderlich, um die Seite auszuliefern und
          ihren sicheren Betrieb zu gewährleisten (Art. 6 Abs. 1 lit. f DSGVO). Vercel ist für uns
          als Auftragsverarbeiter tätig. Datenschutzhinweise von Vercel:{' '}
          <Ext href="https://vercel.com/legal/privacy-policy" />
        </P>
        <P>
          Die Schriften der Website werden von unserem eigenen Server ausgeliefert; dabei werden
          keine Daten an Dritte übertragen.
        </P>
        <P>
          Einige kurze Adressen leitet Vercel an unsere Serverfunktionen bei Supabase weiter
          (Abschnitt 4): <Code>werkruf.com/b/…</Code> (Weiterleitung zum Google-Bewertungsformular
          eines Betriebs) und <Code>werkruf.com/p/fp/…</Code> (Präsentation für Founding Partner).
          Die Kurzadresse <Code>/b/…</Code> wird dabei nicht gezählt.
        </P>
      </Section>

      <Section>
        <H2>4. Datenbank, Anmeldung und Serverfunktionen (Supabase)</H2>
        <P>
          Kundenkonten, Anmeldung, Datenbank und serverseitige Funktionen betreibt die{' '}
          <strong>Supabase Inc.</strong>, 970 Toa Payoh North, Singapur, für uns als
          Auftragsverarbeiter. Die Datenbank liegt in der Europäischen Union (Frankfurt am Main).
          Ein Zugriff aus Drittländern durch Betriebspersonal von Supabase ist nicht
          ausgeschlossen; Grundlage sind Standardvertragsklauseln. Datenschutzhinweise:{' '}
          <Ext href="https://supabase.com/privacy" />
        </P>
        <P>
          Serverfunktionen schreiben technische Protokolle (Zeitpunkt, Ergebnis, Fehlercode). Wir
          achten darauf, dass darin keine Zugangsdaten, Einmal-Links, Telefonnummern oder Inhalte
          von Nachrichten stehen.
        </P>
      </Section>

      <Section>
        <H2>5. Kundenkonto</H2>
        <H3>Registrierung und Anmeldung</H3>
        <P>
          Für ein Kundenkonto verarbeiten wir Ihre E-Mail-Adresse und ein Passwort (bei uns nur als
          Hash gespeichert) oder — wenn Sie „Mit Google anmelden" wählen — die von Google
          übermittelte Kennung, E-Mail-Adresse und den Namen Ihres Google-Kontos. Dazu kommen die
          Angaben, die Sie im Konto hinterlegen (z. B. Betriebsname, Branche), sowie Zeitpunkt und
          Fassung der akzeptierten Nutzungsbedingungen als Nachweis. Rechtsgrundlage ist Art. 6
          Abs. 1 lit. b DSGVO, für den Nachweis lit. c und f.
        </P>
        <P>
          Bei „Mit Google anmelden" ist die <strong>Google Ireland Limited</strong>, Gordon House,
          Barrow Street, Dublin 4, Irland, für die Anmeldung bei Google selbst verantwortlich.
          Diese Anmeldung ist unabhängig von der Verknüpfung Ihres Unternehmensprofils
          (Abschnitt 8).
        </P>
        <H3>Empfehlungen</H3>
        <P>
          Kommen Sie über einen Empfehlungslink (<Code>/empfehlen/…</Code>), merkt sich Ihr Browser
          den Empfehlungscode bis zur Registrierung. Bei der Registrierung ordnen wir Ihr Konto dem
          empfehlenden Konto zu, um die Empfehlung abzurechnen (Art. 6 Abs. 1 lit. b und f DSGVO).
        </P>
        <H3>Konto löschen</H3>
        <P>
          Sie können Ihr Konto in den Einstellungen selbst löschen. Dabei werden Ihre Kontodaten,
          die verknüpften Google-Zugriffsmerkmale, Ihre hochgeladenen Fotos und Ihre Inhalte
          gelöscht und ein laufendes Abonnement beendet. Was wir aus gesetzlichen Gründen aufbewahren
          müssen (z. B. Rechnungsdaten nach Handels- und Steuerrecht, in der Regel sechs bis zehn
          Jahre), sperren wir für jede andere Verwendung.
        </P>
      </Section>

      <Section>
        <H2>6. Speicher im Browser und Cookies</H2>
        <P>
          Ohne Ihre Einwilligung legen wir nur ab, was für den von Ihnen gewünschten Dienst
          unbedingt erforderlich ist (§ 25 Abs. 2 Nr. 2 TDDDG). Dabei handelt es sich nicht um
          Cookies, sondern um Einträge im Speicher Ihres Browsers:
        </P>
        <UL>
          <li><Code>sb-…-auth-token</Code> — Ihre Anmeldung (bis zur Abmeldung)</li>
          <li><Code>werkruf_consent_v1</Code> — Ihre Entscheidung zur Webanalyse, ohne Bezug zu Ihrer Person</li>
          <li><Code>werkruf.referral</Code> — ein Empfehlungscode bis zur Registrierung (Abschnitt 5)</li>
          <li>
            Kurzlebige Merker für die laufende Sitzung (<Code>werkruf_onboarding_absicht</Code>,{' '}
            <Code>werkruf_public_funnel</Code>, <Code>werkruf.password-recovery</Code>,{' '}
            <Code>werkruf.sitzung-verwaist</Code>) — werden beim Schließen des Tabs gelöscht
          </li>
        </UL>
        <P>
          Cookies setzt erst Google Analytics, und nur mit Ihrer Einwilligung (Abschnitt 7).
        </P>
      </Section>

      <Section>
        <H2>7. Webanalyse mit Google Analytics 4</H2>
        <P>
          Mit Ihrer Einwilligung nutzen wir Google Analytics 4 der <strong>Google Ireland
          Limited</strong>, Gordon House, Barrow Street, Dublin 4, Irland. Wir wollen verstehen,
          welche Seiten besucht werden und an welcher Stelle der Weg von der Registrierung über die
          Google-Verbindung bis zum Abonnement abbricht.
        </P>
        <P>
          <strong>Ohne Einwilligung wird Google Analytics nicht geladen</strong> und es geht keine
          Anfrage an Google. Erst nach Ihrer Zustimmung lädt Ihr Browser das Skript; Google setzt
          dann die Cookies <Code>_ga</Code> und <Code>_ga_…</Code> (Laufzeit bis zu zwei Jahre) und
          erhält Ihre IP-Adresse. Nach Angaben von Google speichert Google Analytics 4 IP-Adressen
          nicht.
        </P>
        <P>
          Wir haben die Messung eingeschränkt: Google-Signale und Werbefunktionen sind
          ausgeschaltet. Übermittelt werden nur die aufgerufene Seite ohne Zusatzangaben in der
          Adresse, die Herkunftsseite nur als Domain sowie diese Schritte ohne weitere Angaben zu
          Ihrer Person: Registrierung begonnen (mit der Angabe E-Mail oder Google), Registrierung
          abgeschlossen, Google-Verbindung begonnen und hergestellt, Bezahlvorgang begonnen (mit
          dem gewählten Tarif) und abgeschlossen. Keine Namen, keine E-Mail-Adressen, keine
          Kennungen aus unserer Datenbank. Auf Seiten, die über persönliche Links aus E-Mails
          erreicht werden, auf Anmelde- und Bestätigungsseiten sowie im Verwaltungsbereich findet
          keine Messung statt.
        </P>
        <P>
          Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG).
          Google kann Daten in die USA übertragen; Google LLC ist nach dem EU-US Data Privacy
          Framework zertifiziert (Angemessenheitsbeschluss der EU-Kommission). Die Daten werden in
          Google Analytics nach 14 Monaten gelöscht. Datenschutzhinweise:{' '}
          <Ext href="https://policies.google.com/privacy" />
        </P>
        <P>
          <strong>Widerruf:</strong> Sie können Ihre Einwilligung jederzeit mit Wirkung für die
          Zukunft widerrufen — über „Cookie-Einstellungen" im Seitenfuß
          {ga ? ' oder hier' : ''}. Beim Widerruf stoppt die Messung sofort und die
          Analyse-Cookies werden gelöscht.
        </P>
        {ga && (
          <>
            <EinstellungsKnopf type="button" onClick={oeffneConsentEinstellungen} data-testid="datenschutz-consent">
              Einstellungen zur Webanalyse ändern
            </EinstellungsKnopf>
            <P style={{ fontSize: '.84rem', color: 'var(--color-text-muted)' }}>
              Aktueller Stand in diesem Browser: {stand === 'erteilt' ? 'zugestimmt' : stand === 'abgelehnt' ? 'abgelehnt' : 'noch nicht entschieden'}.
            </P>
          </>
        )}
      </Section>

      <Section>
        <H2>8. Verknüpfung Ihres Google-Unternehmensprofils</H2>
        <P>
          Wenn Sie in Ihrem Kundenkonto Ihr Google-Unternehmensprofil verknüpfen, verarbeiten wir
          die dafür notwendigen Daten Ihres Google-Kontos. Anbieter ist die Google Ireland Limited.
        </P>
        <P>
          <strong>Zweck und Umfang:</strong> Die Verknüpfung erfolgt über OAuth 2.0. Wir fordern
          ausschließlich die Berechtigung „Google Unternehmensprofil verwalten"
          (<Code>business.manage</Code>) an. Damit pflegen wir in Ihrem Auftrag Profilangaben wie
          Öffnungszeiten, Leistungen und Beschreibungen, rufen Bewertungen ab und beantworten sie und
          lesen Kennzahlen zur Sichtbarkeit aus. Ein Zugriff auf Ihre E-Mails, Kontakte, Kalender
          oder Dateien findet nicht statt und ist mit dieser Berechtigung technisch nicht möglich.
        </P>
        <P>
          <strong>Gespeicherte Daten:</strong> Google-Konto-Kennung, E-Mail-Adresse des verknüpften
          Kontos, erteilte Berechtigungen sowie Zugriffs- und Aktualisierungstoken. Die Token werden
          vor dem Speichern mit AES-256-GCM verschlüsselt; der Schlüssel liegt getrennt von der
          Datenbank. Dazu kommen die Daten aus Ihrem Unternehmensprofil, soweit sie für die Leistung
          nötig sind (Profilangaben, Bewertungen mit Antworten, Kennzahlen).
        </P>
        <P>
          <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO. Die Verknüpfung ist
          freiwillig; ohne sie stehen die profilbezogenen Funktionen nicht zur Verfügung.
        </P>
        <P>
          <strong>Speicherdauer und Widerruf:</strong> Die Token speichern wir, solange die
          Verknüpfung besteht. Sie können sie im Dashboard jederzeit trennen — die Token werden dann
          bei Google widerrufen und bei uns gelöscht. Ebenso können Sie den Zugriff in Ihrem
          Google-Konto unter <Ext href="https://myaccount.google.com/permissions" /> entziehen.
        </P>
        <P>
          <strong>Verwendung von Google-Nutzerdaten:</strong> Die Nutzung und Weitergabe der über
          die Google-APIs erhaltenen Daten erfolgt im Einklang mit der{' '}
          <Ext href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</Ext>{' '}
          einschließlich der Anforderungen zur eingeschränkten Verwendung (Limited Use). Wir
          verwenden diese Daten ausschließlich für die von Ihnen beauftragten Funktionen. Keine
          Weitergabe an Dritte zu deren Zwecken, keine Nutzung für Werbung, kein Training
          allgemeiner KI-Modelle. Eine Einsichtnahme durch Menschen erfolgt nur mit Ihrer
          ausdrücklichen Einwilligung, zu Sicherheitszwecken, zur Erfüllung gesetzlicher Pflichten
          oder in zusammengefasster, anonymisierter Form. Weitergegeben werden Bewertungsdaten
          allein zur Erstellung von Antwortentwürfen an den in Abschnitt 10 genannten
          Auftragsverarbeiter.
        </P>
      </Section>

      <Section>
        <H2>9. Betriebssuche (Google Maps Platform)</H2>
        <P>
          Wo Sie im Kundenkonto Ihren Betrieb über eine Suche auswählen, lädt Ihr Browser in diesem
          Moment die Places-Bibliothek der Google Maps Platform (Google Ireland Limited). Dabei
          erhält Google Ihre IP-Adresse und die eingegebenen Suchbegriffe. Auf anderen Seiten wird
          die Bibliothek nicht geladen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (die Suche
          ist Teil der von Ihnen genutzten Funktion). Eine Übertragung in die USA ist möglich; Google
          LLC ist nach dem EU-US Data Privacy Framework zertifiziert. Datenschutzhinweise:{' '}
          <Ext href="https://policies.google.com/privacy" />
        </P>
      </Section>

      <Section>
        <H2>10. Antwortentwürfe für Bewertungen (Anthropic)</H2>
        <P>
          Auf Ihren Wunsch erstellt WERKRUF Entwürfe für Antworten auf Google-Bewertungen. Dafür
          übermitteln wir Sternbewertung, Bewertungstext und den angezeigten Namen der bewertenden
          Person an die <strong>Anthropic PBC</strong>, San Francisco, USA, als
          Auftragsverarbeiter. Anthropic erzeugt daraus einen Textvorschlag; veröffentlicht wird nur,
          was Sie freigeben. Eine Verwendung der Daten zum Training von Modellen ist vertraglich
          ausgeschlossen. Grundlage der Übermittlung in die USA sind Standardvertragsklauseln
          (<Ext href="https://www.anthropic.com/legal/data-processing-addendum">anthropic.com/legal/data-processing-addendum</Ext>).
          Für die Bewertungen selbst sind wir Auftragsverarbeiter des Betriebs (Abschnitt 17).
        </P>
      </Section>

      <Section>
        <H2>11. Fotos (Cloudinary)</H2>
        <P>
          Fotos, die Sie für Ihr Unternehmensprofil hochladen, speichert und liefert die{' '}
          <strong>Cloudinary Ltd.</strong>, 111 W Evelyn Ave, Sunnyvale, CA 94086, USA, für uns als
          Auftragsverarbeiter aus. Übertragen werden die Bilddateien und technische Metadaten.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO; Grundlage der Übermittlung in die USA sind
          Standardvertragsklauseln. Beim Löschen eines Fotos oder Ihres Kontos werden die Dateien
          auch bei Cloudinary gelöscht. Datenschutzhinweise:{' '}
          <Ext href="https://cloudinary.com/privacy" />
        </P>
      </Section>

      <Section>
        <H2>12. E-Mails (Brevo)</H2>
        <P>
          Unsere E-Mails verschickt die <strong>Brevo SAS</strong> (vormals Sendinblue), 106
          boulevard Haussmann, 75008 Paris, Frankreich, für uns als Auftragsverarbeiter. Das sind
          Nachrichten zu Ihrem Konto (z. B. Bestätigung, Willkommen, Zahlungshinweise,
          Kontolöschung), die wöchentliche Status-Mail mit Aufgaben für Ihr Profil, Hinweise zu
          kritischen Bewertungen und zu Änderungen an Ihrem Profil, Erinnerungen sowie einzelne
          geschäftliche Ansprachen (Abschnitt 16). Verarbeitet werden E-Mail-Adresse, Name
          bzw. Betriebsname und Inhalt der Nachricht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b
          DSGVO, für Ansprachen lit. f. Datenschutzhinweise:{' '}
          <Ext href="https://www.brevo.com/de/legal/privacypolicy/" />
        </P>
        <P>
          <strong>Zustellung, Öffnung und Klicks:</strong> Brevo meldet uns, ob eine E-Mail
          zugestellt, geöffnet (über ein unsichtbares Zählbild) oder ein Link darin aufgerufen wurde,
          sowie Abweisungen und Abmeldungen. Wir speichern davon nur die Art des Ereignisses und den
          Zeitpunkt, keine IP-Adresse und kein Gerät. Wir nutzen das, um Zustellprobleme zu erkennen,
          keine E-Mails an unerreichbare Adressen zu schicken und die Wirkung unserer Nachrichten
          einzuschätzen (Art. 6 Abs. 1 lit. f DSGVO). Sie können dem jederzeit widersprechen
          (Abschnitt 19); eine Öffnung lässt sich zudem verhindern, indem Ihr E-Mail-Programm Bilder
          nicht automatisch lädt.
        </P>
        <P>
          <strong>Persönliche Links:</strong> Links in der Status-Mail und in Ansprachen enthalten
          eine zufällige Kennung, damit wir die Aktion ohne erneute Anmeldung der richtigen Nachricht
          zuordnen können. Bei uns ist davon nur ein Prüfwert gespeichert, nicht die Kennung
          selbst. Die Links sind nur begrenzte Zeit gültig.
        </P>
      </Section>

      <Section>
        <H2>13. Bewertungsanfragen per SMS (Brevo)</H2>
        <P>
          Betriebe können ihren Kundinnen und Kunden über WERKRUF eine SMS mit der Bitte um eine
          Google-Bewertung schicken. Die Mobilnummer gibt der Betrieb ein; Versender ist Brevo SAS
          (Abschnitt 12). Wir speichern die Nummer nicht im Klartext, sondern nur einen
          verschlüsselten Prüfwert, um Doppelversand zu verhindern, sowie Status und Zeitpunkt.
          Verantwortlich für diesen Versand ist der Betrieb; wir handeln als Auftragsverarbeiter
          (Abschnitt 17). Wer eine solche SMS erhalten hat, wendet sich mit Anliegen bitte an den
          Betrieb.
        </P>
      </Section>

      <Section>
        <H2>14. Zahlungen (Stripe)</H2>
        <P>
          Abonnements wickelt die <strong>Stripe Payments Europe, Ltd.</strong>, 1 Grand Canal
          Street Lower, Grand Canal Dock, Dublin, Irland, ab. Bezahlvorgang und
          Rechnungsverwaltung finden auf Seiten von Stripe statt; Ihre Zahlungsdaten (z. B.
          Kartennummer) erhält nur Stripe. Wir erhalten und speichern eine Kundenkennung, Tarif,
          Status und Laufzeit des Abonnements sowie die Rechnungsangaben. Rechtsgrundlage ist Art. 6
          Abs. 1 lit. b DSGVO, für die Aufbewahrung von Rechnungen lit. c. Stripe kann Daten auch in
          die USA übertragen; Stripe, Inc. ist nach dem EU-US Data Privacy Framework zertifiziert.
          Datenschutzhinweise: <Ext href="https://stripe.com/de/privacy" />
        </P>
      </Section>

      <Section>
        <H2>15. Kontakt und Support</H2>
        <P>
          Wenn Sie uns per E-Mail, Telefon oder über das Support-Formular im Kundenkonto schreiben,
          verarbeiten wir Ihre Angaben und die Nachricht, um Ihr Anliegen zu bearbeiten (Art. 6
          Abs. 1 lit. b oder f DSGVO). Für eine Support-Anfrage kann ein Administrator mit Ihrem
          Einverständnis die Einstellungen Ihres Kontos einsehen. Die Nachrichten löschen wir, wenn
          sie erledigt sind und keine Aufbewahrungspflicht besteht.
        </P>
      </Section>

      <Section>
        <H2>16. Geschäftliche Ansprache von Betrieben</H2>
        <P>
          Wir sprechen Handwerksbetriebe einzeln an, um sie als frühe Kunden („Founding Partner")
          zu gewinnen. Dafür verarbeiten wir öffentlich zugängliche geschäftliche Angaben aus
          Branchenverzeichnissen, von Websites und aus Google-Unternehmensprofilen: Betriebsname,
          Gewerk, Ort, geschäftliche E-Mail-Adresse, Telefon, Website, gegebenenfalls Name eines
          öffentlich genannten Ansprechpartners sowie einen von uns formulierten Satz zum
          öffentlichen Profil. Zu jeder Nachricht speichern wir Versand, Zustellung, Öffnung, den
          Aufruf der Präsentation und eine Rückmeldung über den Knopf „Ja, Interesse".
        </P>
        <P>
          Rechtsgrundlage ist unser berechtigtes Interesse, unser Angebot Betrieben vorzustellen,
          für die es passt (Art. 6 Abs. 1 lit. f DSGVO). Wer nicht mehr angesprochen werden möchte,
          kann jederzeit widersprechen — eine kurze Antwort genügt. Wir schicken dann keine weitere
          Ansprache und behalten nur, was nötig ist, damit es dabei bleibt. Angaben zu Betrieben,
          bei denen eine Zusammenarbeit nicht zustande kommt, löschen wir, sobald wir sie dafür
          nicht mehr benötigen.
        </P>
      </Section>

      <Section>
        <H2>17. Auftragsverarbeitung für unsere Kunden</H2>
        <P>
          Für die Daten unserer Kunden — der Betriebe, die WERKRUF nutzen — sind wir selbst
          verantwortlich; dafür gelten die Abschnitte oben. Daneben verarbeiten wir Daten{' '}
          <strong>im Auftrag</strong> der Betriebe: Bewertungen, die Kundinnen und Kunden über das
          Google-Unternehmensprofil eines Betriebs abgeben, die Antworten darauf und die
          Bewertungsanfragen per SMS. Über diese Daten entscheidet der Betrieb; wir sind insoweit
          Auftragsverarbeiter nach Art. 28 DSGVO. Einzelheiten, beteiligte Unterauftragsverarbeiter
          und technische Maßnahmen stehen im{' '}
          <IntLink to="/avv">Vertrag zur Auftragsverarbeitung</IntLink>. Anfragen von Betroffenen
          dazu leiten wir an den jeweiligen Betrieb weiter.
        </P>
      </Section>

      <Section>
        <H2>18. Empfänger und Übermittlung in Drittländer</H2>
        <P>
          Empfänger Ihrer Daten sind die in den Abschnitten 3 bis 16 genannten Dienstleister,
          jeweils nur im beschriebenen Umfang. Eine Übermittlung in ein Land außerhalb der EU
          erfolgt nur, wenn dort ein Angemessenheitsbeschluss gilt (für zertifizierte US-Unternehmen
          das EU-US Data Privacy Framework) oder Standardvertragsklauseln vereinbart sind. Auf
          Anfrage stellen wir Ihnen eine Kopie der Garantien zur Verfügung.
        </P>
      </Section>

      <Section>
        <H2>19. Ihre Rechte</H2>
        <UL>
          <li>Auskunft über Ihre Daten (Art. 15 DSGVO)</li>
          <li>Berichtigung (Art. 16), Löschung (Art. 17) und Einschränkung der Verarbeitung (Art. 18)</li>
          <li>Datenübertragbarkeit (Art. 20)</li>
          <li>Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3)</li>
          <li>Beschwerde bei einer Aufsichtsbehörde (Art. 77), für uns zuständig:{' '}
            <Ext href={a.aufsichtsbehoerdeDatenschutz.url}>{a.aufsichtsbehoerdeDatenschutz.name}</Ext>
          </li>
        </UL>
        <InfoBox>
          <P style={{ margin: 0 }}>
            <strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Soweit wir Daten auf Grundlage
            berechtigter Interessen verarbeiten (Art. 6 Abs. 1 lit. f), können Sie aus Gründen, die
            sich aus Ihrer besonderen Situation ergeben, jederzeit widersprechen. Einer Verarbeitung
            zur Direktwerbung — dazu gehört die geschäftliche Ansprache in Abschnitt 16 — können Sie
            jederzeit ohne Begründung widersprechen; wir verarbeiten Ihre Daten dann nicht mehr zu
            diesem Zweck. Eine E-Mail an <A href={`mailto:${a.email}`}>{a.email}</A> genügt.
          </P>
        </InfoBox>
      </Section>

      <Section>
        <H2>20. Speicherdauer, Pflicht zur Bereitstellung, automatisierte Entscheidungen</H2>
        <P>
          Wir speichern Daten, solange es für den jeweiligen Zweck nötig ist, und löschen sie
          danach, soweit keine gesetzliche Aufbewahrungspflicht besteht; Besonderheiten stehen in
          den Abschnitten oben. Die Bereitstellung Ihrer Daten ist weder gesetzlich noch
          vertraglich vorgeschrieben; ohne die für ein Konto nötigen Angaben können wir es aber nicht
          einrichten. Eine automatisierte Entscheidungsfindung einschließlich Profiling nach
          Art. 22 DSGVO findet nicht statt.
        </P>
      </Section>

      <P style={{ color: 'var(--color-text-muted)', fontSize: '.8rem', marginTop: 40 }}>
        Stand: November 2026
      </P>
    </Wrap>
  );
}
