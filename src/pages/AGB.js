/*
 * Allgemeine Geschäftsbedingungen.
 *
 * ═══════════════════════════════════════════════════════════════
 * ENTWURF — ANWALTLICH NICHT GEPRÜFT
 * ═══════════════════════════════════════════════════════════════
 *
 * Diese Fassung wurde am 15.10.2026 aus dem tatsächlichen Verhalten
 * des Produkts geschrieben, nicht aus einem Mustertext: Preis,
 * Testphase, Kündigungsweg, KI-Entwürfe und die Google-Abhängigkeit
 * entsprechen dem, was der Code tut.
 *
 * Sie ist KEINE Rechtsberatung und nicht geprüft. §§ 305 ff. BGB
 * stellen an AGB strenge Anforderungen; eine unwirksame Klausel ist
 * schlechter als keine. Vor dem ersten zahlenden Kunden gehört der
 * Text durch eine anwaltliche Prüfung.
 *
 * Offene Punkte, die nur der Anbieter entscheiden kann, stehen im
 * Text als [ECKIGE KLAMMER] — sie müssen vor Veröffentlichung
 * gefüllt oder gestrichen werden.
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM DIE ZAHLEN AUS DER KONFIGURATION KOMMEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Preis und Testdauer stehen nicht als Text in dieser Datei, sondern
 * kommen aus industryConfig. Ein Rechtstext, der 49 € behauptet,
 * während die Preisseite 59 € zeigt, ist ein Widerspruch im eigenen
 * Angebot — genau die Klasse Fehler, die H2.2 beim
 * Kreditkarten-Text gefunden hat.
 */

import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { useIndustry } from '../context/IndustryContext';

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
  color: var(--color-primary); margin-bottom: 12px;
  /* "Geschaeftsbedingungen" ist ein Wort und passt auf einem Telefon
     nicht in eine Zeile. Ohne Trennung schob es die ganze Seite 39px
     nach rechts und erzeugte waagerechtes Scrollen. lang="de" steht
     in index.html, also trennt der Browser richtig. */
  overflow-wrap: break-word;
  hyphens: auto;
`;

const Stand = styled.p`
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted);
  margin-bottom: 40px; padding-bottom: 20px;
  border-bottom: 2px solid var(--color-border);
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
  margin-bottom: 10px;
`;

const UL = styled.ul`
  font-family: var(--font-body); font-size: .92rem;
  color: var(--color-text); line-height: 1.75;
  margin: 0 0 10px; padding-left: 20px;
  li { margin-bottom: 5px; }
`;

const A = styled.a`
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

const IntLink = styled(Link)`
  color: var(--color-accent); text-decoration: none;
  &:hover { text-decoration: underline; }
`;

export default function AGB() {
  const { pricing } = useIndustry();
  const preis = `${pricing.monthlyPrice} ${pricing.currency}`;
  const tage  = pricing.trialDays;

  return (
    <Wrap>
      <Back to="/">← Zurück zur Startseite</Back>
      <Badge>Rechtliches</Badge>
      <Title>Allgemeine Geschäftsbedingungen</Title>
      <Stand>Stand: Oktober 2026 · Fassung agb-datenschutz-2026-10</Stand>

      <Section>
        <H2>§ 1 Anbieter und Geltungsbereich</H2>
        <P>
          Anbieter von WERKRUF ist Iver Bohnes (geb. Gentz), Große Freiheit 82, 22767 Hamburg
          (nachfolgend „Anbieter"). Die vollständigen Angaben stehen im{' '}
          <IntLink to="/impressum">Impressum</IntLink>.
        </P>
        <P>
          Diese Bedingungen gelten für alle Verträge über die Nutzung der Software WERKRUF
          zwischen dem Anbieter und seinen Kunden.
        </P>
        <P>
          <strong>Das Angebot richtet sich ausschließlich an Unternehmer im Sinne des § 14 BGB</strong>,
          also an Gewerbetreibende und Freiberufler, die den Vertrag in Ausübung ihrer
          gewerblichen oder selbständigen beruflichen Tätigkeit schließen. Ein Vertragsschluss
          mit Verbrauchern ist nicht vorgesehen.
        </P>
        <P>
          Abweichende oder ergänzende Bedingungen des Kunden werden nicht Vertragsbestandteil,
          auch wenn der Anbieter ihnen nicht ausdrücklich widerspricht.
        </P>
      </Section>

      <Section>
        <H2>§ 2 Gegenstand des Vertrags</H2>
        <P>
          WERKRUF ist eine Software, die der Kunde über den Browser nutzt (Software as a
          Service). Sie wird nicht überlassen, sondern für die Vertragsdauer zur Nutzung
          bereitgestellt.
        </P>
        <P>Die Software bietet im Wesentlichen:</P>
        <UL>
          <li>
            Anbindung des Google-Unternehmensprofils des Kunden über dessen eigenes
            Google-Konto und Abgleich der dort hinterlegten Daten
          </li>
          <li>
            Auswertung des Profilzustands und Ermittlung von Handlungsempfehlungen samt
            einer Kennzahl zum Profilzustand
          </li>
          <li>
            Übersicht über Bewertungen sowie Erstellung von Antwortentwürfen mit
            Unterstützung künstlicher Intelligenz
          </li>
          <li>Wiederkehrende Zusammenfassungen und Hinweise per E-Mail</li>
        </UL>
        <P>
          Der Funktionsumfang entspricht dem bei Vertragsschluss auf der Website
          beschriebenen Stand. Der Anbieter darf die Software weiterentwickeln; eine
          Minderung des vertraglich geschuldeten Funktionsumfangs ist davon nicht umfasst.
        </P>
      </Section>

      <Section>
        <H2>§ 3 Vertragsschluss und Konto</H2>
        <P>
          Die Darstellung auf der Website ist kein bindendes Angebot. Der Kunde gibt mit
          Abschluss des Bestellvorgangs ein Angebot ab; der Vertrag kommt mit der
          Freischaltung des Zugangs zustande.
        </P>
        <P>
          Der Kunde ist verpflichtet, bei der Registrierung zutreffende Angaben zu machen
          und seine Zugangsdaten vor dem Zugriff Dritter zu schützen. Ein Konto ist nicht
          übertragbar.
        </P>
      </Section>

      <Section>
        <H2>§ 4 Testphase</H2>
        <P>
          Neukunden können WERKRUF {tage} Tage lang kostenfrei testen. Die Testphase beginnt
          mit dem Abschluss des Bestellvorgangs.
        </P>
        <P>
          <strong>Die Zahlungsdaten werden bereits zu Beginn der Testphase hinterlegt.</strong>{' '}
          In den ersten {tage} Tagen wird nichts abgebucht. Kündigt der Kunde nicht vor Ablauf
          der Testphase, geht das Vertragsverhältnis in ein kostenpflichtiges Abonnement nach
          § 5 über, ohne dass es einer weiteren Erklärung bedarf.
        </P>
        <P>
          Je Kunde besteht Anspruch auf eine Testphase.
        </P>
      </Section>

      <Section>
        <H2>§ 5 Preise und Zahlung</H2>
        <P>
          Die Nutzung kostet {preis} je Abrechnungszeitraum von einem Monat. Maßgeblich ist
          der auf der Preisseite ausgewiesene Preis bei Vertragsschluss.
        </P>
        <P>
          <strong>
            Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer berechnet.
          </strong>{' '}
          Der genannte Betrag ist der Endbetrag; es kommt keine Umsatzsteuer hinzu, und in
          Rechnungen wird keine ausgewiesen.
        </P>
        <P>
          Die Abrechnung erfolgt monatlich im Voraus über den Zahlungsdienstleister Stripe
          Payments Europe, Ltd. Der Kunde hinterlegt dort ein Zahlungsmittel; die
          Zahlungsdaten werden nicht vom Anbieter gespeichert.
        </P>
        <P>
          Rechnungen werden elektronisch bereitgestellt. Der Kunde kann sie jederzeit über das
          Kundenportal abrufen.
        </P>
        <P>
          Kommt der Kunde mit der Zahlung in Verzug, darf der Anbieter den Zugang nach
          erfolgloser Zahlungsaufforderung sperren. Weitergehende gesetzliche Ansprüche
          bleiben unberührt.
        </P>
      </Section>

      <Section>
        <H2>§ 6 Laufzeit und Kündigung</H2>
        <P>
          Der Vertrag läuft auf unbestimmte Zeit und kann von beiden Seiten mit einer Frist
          von einem Tag zum Ende des jeweiligen Abrechnungszeitraums gekündigt werden. Eine
          Mindestlaufzeit besteht nicht.
        </P>
        <P>
          Der Kunde kündigt über die Abo-Verwaltung in seinem Konto. Die Kündigung wird zum
          Ende des bereits bezahlten Zeitraums wirksam; bis dahin bleibt der Zugang bestehen.
          Eine Erstattung bereits gezahlter Beträge für den laufenden Zeitraum erfolgt nicht.
        </P>
        <P>
          Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt beiderseits
          unberührt.
        </P>
        <P>
          Nach Vertragsende werden die Daten des Kunden gelöscht. Das Google-Unternehmensprofil
          des Kunden bleibt davon unberührt — es gehört ihm und liegt bei Google.
        </P>
      </Section>

      <Section>
        <H2>§ 7 Mitwirkung des Kunden</H2>
        <P>
          WERKRUF arbeitet mit den Daten des Google-Unternehmensprofils des Kunden. Der Kunde
          stellt sicher, dass er über die erforderlichen Rechte an diesem Profil verfügt und
          erteilt die für den Abgleich nötige Berechtigung über sein eigenes Google-Konto.
          Er kann diese Berechtigung jederzeit widerrufen; der Funktionsumfang ist dann
          eingeschränkt.
        </P>
        <P>
          Für Inhalte, die der Kunde über WERKRUF veröffentlicht — insbesondere Antworten auf
          Bewertungen — ist er selbst verantwortlich.
        </P>
      </Section>

      <Section>
        <H2>§ 8 Leistungen Dritter</H2>
        <P>
          Wesentliche Funktionen von WERKRUF setzen Schnittstellen Dritter voraus,
          insbesondere die von Google bereitgestellten Schnittstellen zum
          Unternehmensprofil. Der Anbieter hat auf deren Verfügbarkeit, Umfang und
          Nutzungsbedingungen keinen Einfluss.
        </P>
        <P>
          Ändert, beschränkt oder beendet ein Dritter seine Schnittstelle, kann der betroffene
          Teil der Leistung entfallen. Der Anbieter wird den Kunden darüber unterrichten. Ein
          solcher Wegfall berechtigt beide Seiten zur Kündigung nach § 6.
        </P>
      </Section>

      <Section>
        <H2>§ 9 Verfügbarkeit</H2>
        <P>
          Der Anbieter bemüht sich um eine hohe Verfügbarkeit, schuldet jedoch keine
          bestimmte Verfügbarkeitsquote. Wartungsarbeiten, Störungen beim Hostinganbieter
          und Ausfälle von Schnittstellen Dritter können zu Unterbrechungen führen.
        </P>
        <P>
          Planbare Wartungsfenster wird der Anbieter nach Möglichkeit ankündigen und in
          nutzungsarme Zeiten legen.
        </P>
      </Section>

      <Section>
        <H2>§ 10 Von künstlicher Intelligenz erzeugte Inhalte</H2>
        <P>
          WERKRUF erstellt Antwortentwürfe auf Bewertungen mit Unterstützung künstlicher
          Intelligenz. <strong>Diese Entwürfe sind Vorschläge.</strong> Sie werden erst
          veröffentlicht, wenn der Kunde sie freigibt.
        </P>
        <P>
          Der Anbieter übernimmt keine Gewähr für die inhaltliche Richtigkeit, Angemessenheit
          oder rechtliche Zulässigkeit eines Entwurfs. Die Prüfung vor der Veröffentlichung
          obliegt dem Kunden.
        </P>
        <P>
          Gleiches gilt für Handlungsempfehlungen und Kennzahlen: Sie beruhen auf
          automatisierter Auswertung und sind keine Zusicherung eines bestimmten Erfolgs,
          insbesondere keiner bestimmten Platzierung in Suchergebnissen.
        </P>
      </Section>

      <Section>
        <H2>§ 11 Nutzungsrechte</H2>
        <P>
          Der Kunde erhält für die Vertragsdauer ein einfaches, nicht übertragbares Recht,
          WERKRUF im vertraglich vorgesehenen Umfang für eigene geschäftliche Zwecke zu
          nutzen.
        </P>
        <P>
          Nicht gestattet sind insbesondere die Weitergabe des Zugangs an Dritte, die
          Bereitstellung der Leistung für Dritte sowie automatisierte Massenabfragen, die
          über die übliche Nutzung hinausgehen.
        </P>
        <P>
          An den Daten, die der Kunde einbringt oder die aus seinem Unternehmensprofil
          stammen, erwirbt der Anbieter keine Rechte, die über die zur Leistungserbringung
          erforderliche Verarbeitung hinausgehen.
        </P>
      </Section>

      <Section>
        <H2>§ 12 Haftung</H2>
        <P>
          Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei
          Verletzung von Leben, Körper oder Gesundheit sowie nach dem Produkthaftungsgesetz.
        </P>
        <P>
          Bei einfacher Fahrlässigkeit haftet der Anbieter nur für die Verletzung einer
          wesentlichen Vertragspflicht, deren Erfüllung die ordnungsgemäße Durchführung des
          Vertrags überhaupt erst ermöglicht und auf deren Einhaltung der Kunde regelmäßig
          vertrauen darf. In diesem Fall ist die Haftung auf den vertragstypischen,
          vorhersehbaren Schaden begrenzt.
        </P>
        <P>
          Für den Verlust von Daten haftet der Anbieter nur in dem Umfang, der bei
          ordnungsgemäßer und regelmäßiger Datensicherung durch den Kunden entstanden wäre.
        </P>
        <P>Eine weitergehende Haftung ist ausgeschlossen.</P>
      </Section>

      <Section>
        <H2>§ 13 Datenschutz</H2>
        <P>
          Welche personenbezogenen Daten zu welchem Zweck verarbeitet werden, steht in der{' '}
          <IntLink to="/datenschutz">Datenschutzerklärung</IntLink>.
        </P>
        <P>
          Soweit der Anbieter personenbezogene Daten im Auftrag des Kunden verarbeitet,
          gilt der <IntLink to="/avv">Vertrag zur Auftragsverarbeitung</IntLink> nach
          Art. 28 DSGVO. Er ist Anlage zu diesen Bedingungen und wird mit deren Annahme
          Vertragsbestandteil. Dort stehen auch die eingesetzten
          Unterauftragsverarbeiter und die technischen und organisatorischen Maßnahmen.
        </P>
        <P>
          Eine gesonderte Unterschrift ist nach Art. 28 Abs. 9 DSGVO nicht erforderlich. Wer
          eine unterschriebene Fassung für die eigene Dokumentation benötigt, erhält sie auf
          Anfrage unter <A href="mailto:info@werkruf.com">info@werkruf.com</A>.
        </P>
      </Section>

      <Section>
        <H2>§ 14 Änderungen dieser Bedingungen</H2>
        <P>
          Der Anbieter kann diese Bedingungen ändern, wenn dies zur Anpassung an eine
          geänderte Rechtslage, an höchstrichterliche Rechtsprechung oder an veränderte
          technische Gegebenheiten erforderlich ist und den Kunden nicht unangemessen
          benachteiligt.
        </P>
        <P>
          Änderungen werden dem Kunden mindestens sechs Wochen vor Wirksamwerden in Textform
          mitgeteilt. Widerspricht der Kunde nicht innerhalb von sechs Wochen, gelten die
          Änderungen als angenommen; auf diese Folge wird in der Mitteilung gesondert
          hingewiesen. Im Fall des Widerspruchs kann jede Seite zum Wirksamwerden der
          Änderung kündigen.
        </P>
      </Section>

      <Section>
        <H2>§ 15 Schlussbestimmungen</H2>
        <P>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des
          UN-Kaufrechts.
        </P>
        <P>
          Ist der Kunde Kaufmann, juristische Person des öffentlichen Rechts oder
          öffentlich-rechtliches Sondervermögen, ist Hamburg ausschließlicher Gerichtsstand
          für alle Streitigkeiten aus diesem Vertrag.
        </P>
        <P>
          Sollte eine Bestimmung unwirksam sein, bleibt die Wirksamkeit der übrigen
          Bestimmungen unberührt.
        </P>
        <P>
          Fragen zu diesen Bedingungen:{' '}
          <A href="mailto:info@werkruf.com">info@werkruf.com</A>
        </P>
      </Section>
    </Wrap>
  );
}
