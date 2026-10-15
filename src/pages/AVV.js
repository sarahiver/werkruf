/*
 * Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
 *
 * ═══════════════════════════════════════════════════════════════
 * ENTWURF — ANWALTLICH NICHT GEPRÜFT
 * ═══════════════════════════════════════════════════════════════
 *
 * Schließt die letzte offene Klammer in § 13 der AGB. Wie die AGB
 * ist dieser Text aus dem gemessenen Verhalten des Codes
 * geschrieben, nicht aus einem Mustertext — jede Angabe in den
 * Anlagen 1 bis 3 ist im Repo nachweisbar:
 *
 *   Anlage 1, Datenarten
 *     google_reviews: star_rating, comment, reviewer_display_name
 *     (siehe src/pages/dashboard/DashboardBewertungen.js und
 *     supabase/functions/generate-review-reply/index.ts Z 599)
 *
 *   Anlage 2, Tokenverschlüsselung
 *     AES-256-GCM, Nutzer-ID als AAD, Schlüsselkennung für Rotation
 *     (supabase/functions/google-business/index.ts Z 503-539)
 *
 *   Anlage 2, Mandantentrennung
 *     RLS auf allen Kundentabellen, oauth_tokens für anon und
 *     authenticated vollständig entzogen
 *     (20260928143000_google_customer_isolation.sql Z 9-56,
 *      20260928160000_customer_isolation_hardening.sql Z 14-20)
 *
 *   Anlage 3, KI-Antworten
 *     api.anthropic.com, Modell claude-haiku-4-5; übermittelt werden
 *     Sterne, Bewertungstext und Name des Bewertenden
 *     (generate-review-reply/index.ts Z 162-164, 469-487)
 *
 *   Anlage 3, Mailversand
 *     api.brevo.com/v3/smtp/email
 *     (supabase/functions/send-email/index.ts Z 76)
 *
 * ═══════════════════════════════════════════════════════════════
 * WARUM STRIPE UND GOOGLE NICHT IN ANLAGE 3 STEHEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Beide tauchen in der Datenschutzerklärung auf, aber nicht als
 * Unterauftragsverarbeiter dieses Vertrags — und das ist Absicht:
 *
 *   Stripe verarbeitet Zahlungsdaten für den Vertrag zwischen
 *   Anbieter und Kunde. Dafür ist der Anbieter selbst
 *   Verantwortlicher, nicht Auftragsverarbeiter des Kunden. Diese
 *   Verarbeitung liegt außerhalb dieses Vertrags.
 *
 *   Google: Das Unternehmensprofil gehört dem Kunden. WERKRUF greift
 *   mit einer Berechtigung zu, die der Kunde selbst erteilt. Google
 *   verarbeitet dort nach dem Vertrag des Kunden mit Google — WERKRUF
 *   ist der Beauftragte, nicht der Auftraggeber.
 *
 * Diese Abgrenzung ist vertretbar, aber nicht unstreitig. Sie gehört
 * ausdrücklich in die anwaltliche Prüfung.
 *
 * ═══════════════════════════════════════════════════════════════
 * EIN PUNKT IST NOCH NICHT GEMESSEN
 * ═══════════════════════════════════════════════════════════════
 *
 * § 12 verspricht Löschung. delete-account löscht Konto, Profil und
 * Cloudinary-Fotos und beendet das Stripe-Abo; der Kommentar in
 * Z 118 behauptet darüber hinaus, das Löschen des Nutzers kaskadiere.
 * Die Tabellen google_reviews, review_replies und oauth_tokens
 * stammen aus der Zeit vor der Migrationshistorie, ihre
 * Fremdschlüsselregeln stehen deshalb in keiner Migration und sind
 * im Repo nicht prüfbar.
 *
 * Solange das nicht gemessen ist, ist § 12 eine Pflicht, aber kein
 * Nachweis. Das Messwerkzeug liegt in
 * docs/operations/loeschung-beleg.sql — lesend, wiederholbar. Vor
 * dem ersten Kunden ausführen.
 */

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
  color: var(--color-primary); margin-bottom: 12px;
  /* "Auftragsverarbeitung" ist ein Wort und passt auf einem Telefon
     nicht in eine Zeile. Ohne Trennung schiebt es die ganze Seite
     nach rechts und erzeugt waagerechtes Scrollen. lang="de" steht
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

const H3 = styled.h3`
  font-family: var(--font-body); font-weight: 700;
  font-size: .92rem; color: var(--color-primary);
  margin: 20px 0 8px;
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

/* Vorbemerkung und Anlagenkopf: abgesetzt, damit sie beim Überfliegen
   nicht als weiterer Paragraph gelesen werden. */
const Kasten = styled.div`
  background: var(--color-surface-alt, rgba(0,0,0,.025));
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-button);
  padding: 18px 20px;
  margin-bottom: 36px;
  p:last-child { margin-bottom: 0; }
`;

const AnlageKopf = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.15rem; text-transform: var(--text-transform);
  color: var(--color-primary);
  margin: 56px 0 14px; padding-top: 28px;
  border-top: 2px solid var(--color-border);
`;

/* Definitionsliste statt Tabelle. Eine Tabelle mit vier Spalten
   erzwingt auf dem Telefon waagerechtes Scrollen; ein Handwerker
   liest das unterwegs. */
const Liste = styled.dl`
  font-family: var(--font-body); font-size: .92rem;
  line-height: 1.7; margin: 0 0 18px;

  dt {
    font-weight: 700; color: var(--color-primary);
    margin-top: 14px;
  }
  dd {
    margin: 2px 0 0; padding-left: 0;
    color: var(--color-text);
  }
  dd + dd { margin-top: 2px; }
  dd span {
    color: var(--color-text-muted);
    font-size: .86rem;
  }
`;

export default function AVV() {
  return (
    <Wrap>
      <Back to="/agb">← Zurück zu den AGB</Back>
      <Badge>Rechtliches</Badge>
      <Title>Vertrag zur Auftragsverarbeitung</Title>
      <Stand>
        Nach Art. 28 DSGVO · Stand: Oktober 2026 · Fassung avv-2026-10 ·
        Anlage zu den <IntLink to="/agb">Allgemeinen Geschäftsbedingungen</IntLink>
      </Stand>

      <Kasten>
        <P>
          <strong>Wer hier wer ist.</strong> Der Kunde entscheidet, welche Daten in WERKRUF
          verarbeitet werden, und ist dafür <strong>Verantwortlicher</strong> im Sinne des
          Art. 4 Nr. 7 DSGVO. Der Anbieter verarbeitet diese Daten nur für den Kunden und nach
          dessen Weisung und ist <strong>Auftragsverarbeiter</strong> nach Art. 4 Nr. 8 DSGVO.
        </P>
        <P>
          <strong>Wie dieser Vertrag zustande kommt.</strong> Er ist Anlage zu den AGB und wird
          mit deren Annahme Vertragsbestandteil. Eine gesonderte Unterschrift ist nicht
          erforderlich; Art. 28 Abs. 9 DSGVO lässt die elektronische Form ausdrücklich zu. Wer
          eine unterschriebene Fassung für die eigene Dokumentation braucht, erhält sie auf
          Anfrage unter{' '}
          <A href="mailto:info@werkruf.com">info@werkruf.com</A>.
        </P>
      </Kasten>

      <Section>
        <H2>§ 1 Gegenstand, Dauer und Rangfolge</H2>
        <P>
          Gegenstand dieses Vertrags ist die Verarbeitung personenbezogener Daten, die der
          Anbieter im Rahmen der Bereitstellung von WERKRUF im Auftrag des Kunden vornimmt.
          Welche Daten das sind, steht in Anlage 1.
        </P>
        <P>
          Der Vertrag beginnt mit dem Hauptvertrag und endet mit ihm. Die Pflichten aus § 12
          (Löschung) bestehen über das Ende hinaus, bis sie erfüllt sind.
        </P>
        <P>
          Bei Widersprüchen zwischen diesem Vertrag und den AGB gilt für Fragen der
          Auftragsverarbeitung dieser Vertrag.
        </P>
      </Section>

      <Section>
        <H2>§ 2 Art, Zweck und Umfang der Verarbeitung</H2>
        <P>
          Der Anbieter verarbeitet die Daten ausschließlich zu dem Zweck, die vertraglich
          vereinbarten Leistungen zu erbringen: das Abrufen und Darstellen von Bewertungen
          des Kunden, das Erstellen von Antwortentwürfen, das Veröffentlichen freigegebener
          Antworten, Auswertungen zur Sichtbarkeit und der Versand von Hinweisen an den
          Kunden.
        </P>
        <P>
          Art und Zweck der Verarbeitung, die Arten der Daten und die Kategorien betroffener
          Personen ergeben sich im Einzelnen aus Anlage 1. Eine Verarbeitung für eigene Zwecke
          des Anbieters findet nicht statt. Insbesondere werden die Daten des Kunden nicht zum
          Trainieren von KI-Modellen verwendet.
        </P>
        <P>
          Die Verarbeitung erfolgt in Mitgliedstaaten der Europäischen Union. Eine
          Verarbeitung in einem Drittland findet nur unter den Voraussetzungen des § 7 statt;
          Anlage 3 weist für jeden Unterauftragsverarbeiter den Ort der Verarbeitung aus.
        </P>
      </Section>

      <Section>
        <H2>§ 3 Weisungen des Kunden</H2>
        <P>
          Der Anbieter verarbeitet die Daten nur im Rahmen dieses Vertrags und nach den
          Weisungen des Kunden. Die Bedienung der Software durch den Kunden gilt als Weisung;
          darüber hinausgehende Weisungen sind in Textform an{' '}
          <A href="mailto:info@werkruf.com">info@werkruf.com</A> zu richten.
        </P>
        <P>
          Hält der Anbieter eine Weisung für rechtswidrig, teilt er dies dem Kunden
          unverzüglich mit. Er darf die Ausführung aussetzen, bis der Kunde sie bestätigt oder
          ändert (Art. 28 Abs. 3 Satz 3 DSGVO).
        </P>
      </Section>

      <Section>
        <H2>§ 4 Pflichten des Anbieters</H2>
        <UL>
          <li>
            Er verpflichtet alle Personen, die Zugang zu den Daten haben, zur Vertraulichkeit
            und unterrichtet sie über die Grenzen der Verarbeitung (Art. 28 Abs. 3 lit. b,
            Art. 29 DSGVO).
          </li>
          <li>
            Er führt ein Verzeichnis aller Verarbeitungen, die er für den Kunden vornimmt
            (Art. 30 Abs. 2 DSGVO), und stellt es dem Kunden auf Anfrage zur Verfügung.
          </li>
          <li>
            Er trifft die in Anlage 2 beschriebenen technischen und organisatorischen
            Maßnahmen und hält sie auf dem Stand der Technik.
          </li>
          <li>
            Er unterrichtet den Kunden unverzüglich, wenn eine Aufsichtsbehörde beim Anbieter
            Ermittlungen aufnimmt, die die Daten des Kunden betreffen könnten.
          </li>
        </UL>
        <P>
          Ein Datenschutzbeauftragter ist nicht benannt. Der Anbieter beschäftigt keine
          zehn Personen ständig mit der automatisierten Verarbeitung personenbezogener Daten;
          die Benennungspflicht nach § 38 Abs. 1 BDSG greift deshalb nicht. Ansprechpartner in
          allen Datenschutzfragen ist Iver Bohnes,{' '}
          <A href="mailto:info@werkruf.com">info@werkruf.com</A>.
        </P>
      </Section>

      <Section>
        <H2>§ 5 Technische und organisatorische Maßnahmen</H2>
        <P>
          Der Anbieter trifft die nach Art. 32 DSGVO erforderlichen Maßnahmen. Sie sind in
          Anlage 2 beschrieben. Maßnahmen dürfen weiterentwickelt werden; das Schutzniveau darf
          dabei nicht unter das bei Vertragsschluss erreichte fallen. Wesentliche Änderungen
          dokumentiert der Anbieter.
        </P>
      </Section>

      <Section>
        <H2>§ 6 Unterauftragsverarbeiter</H2>
        <P>
          Der Kunde stimmt der Beauftragung der in Anlage 3 genannten
          Unterauftragsverarbeiter zu. Mit jedem von ihnen hat der Anbieter Pflichten
          vereinbart, die den Pflichten dieses Vertrags entsprechen (Art. 28 Abs. 4 DSGVO).
        </P>
        <P>
          Einen weiteren Unterauftragsverarbeiter oder den Wechsel eines bestehenden teilt der
          Anbieter dem Kunden mindestens <strong>vier Wochen</strong> vorher in Textform mit.
          Der Kunde kann innerhalb von zwei Wochen nach Zugang aus einem wichtigen
          datenschutzrechtlichen Grund widersprechen. Widerspricht er, und lässt sich die
          Leistung ohne den Unterauftragsverarbeiter nicht in gleicher Weise erbringen, darf
          jede Partei den Hauptvertrag zum Zeitpunkt der geplanten Änderung kündigen.
        </P>
        <P>
          Nicht als Unterauftragsverarbeitung gelten Nebenleistungen, bei denen ein Zugriff auf
          die Daten des Kunden nicht vorgesehen ist, etwa Telekommunikation oder Wartung
          durch den Anbieter selbst.
        </P>
      </Section>

      <Section>
        <H2>§ 7 Übermittlung in Drittländer</H2>
        <P>
          Eine Übermittlung in ein Land außerhalb der Europäischen Union findet nur statt,
          wenn die Voraussetzungen der Art. 44 ff. DSGVO erfüllt sind. Der Anbieter stützt sich
          dabei auf einen Angemessenheitsbeschluss der Europäischen Kommission oder auf die
          Standardvertragsklauseln nach dem Durchführungsbeschluss (EU) 2021/914.
        </P>
        <P>
          Anlage 3 nennt für jeden Unterauftragsverarbeiter den Ort der Verarbeitung und die
          Grundlage der Übermittlung.
        </P>
      </Section>

      <Section>
        <H2>§ 8 Rechte betroffener Personen</H2>
        <P>
          Für die Beantwortung von Anfragen betroffener Personen ist der Kunde zuständig. Der
          Anbieter unterstützt ihn dabei (Art. 28 Abs. 3 lit. e DSGVO), insbesondere bei
          Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung.
        </P>
        <P>
          Wendet sich eine betroffene Person unmittelbar an den Anbieter, leitet er die Anfrage
          unverzüglich an den Kunden weiter und beantwortet sie nicht selbst — es sei denn, der
          Kunde weist ihn dazu an.
        </P>
        <P>
          Der Kunde kann einen großen Teil dieser Anfragen selbst erledigen: Bewertungen und
          Antworten sind im Kundenkonto einsehbar, und über die Einstellungen lässt sich das
          Konto samt Daten löschen.
        </P>
      </Section>

      <Section>
        <H2>§ 9 Verletzungen des Schutzes personenbezogener Daten</H2>
        <P>
          Der Anbieter unterrichtet den Kunden unverzüglich, spätestens{' '}
          <strong>24 Stunden</strong> nach Kenntnis, über jede Verletzung des Schutzes
          personenbezogener Daten, die die Daten des Kunden betrifft. Die Meldung geht an die im
          Kundenkonto hinterlegte E-Mail-Adresse.
        </P>
        <P>Die Meldung enthält, soweit bekannt:</P>
        <UL>
          <li>eine Beschreibung der Art der Verletzung,</li>
          <li>die Kategorien und die ungefähre Zahl der betroffenen Personen und Datensätze,</li>
          <li>die wahrscheinlichen Folgen,</li>
          <li>die ergriffenen oder vorgeschlagenen Maßnahmen.</li>
        </UL>
        <P>
          Die Meldung an die Aufsichtsbehörde nach Art. 33 DSGVO und die Unterrichtung
          betroffener Personen nach Art. 34 DSGVO obliegen dem Kunden. Der Anbieter unterstützt
          ihn dabei.
        </P>
      </Section>

      <Section>
        <H2>§ 10 Unterstützung bei weiteren Pflichten des Kunden</H2>
        <P>
          Der Anbieter unterstützt den Kunden bei der Einhaltung der Art. 32 bis 36 DSGVO
          (Art. 28 Abs. 3 lit. f DSGVO), insbesondere bei einer Datenschutz-Folgenabschätzung
          und bei einer vorherigen Konsultation der Aufsichtsbehörde. Er stellt dafür die
          Angaben zur Verfügung, die nur er kennt.
        </P>
      </Section>

      <Section>
        <H2>§ 11 Nachweise und Kontrollen</H2>
        <P>
          Der Anbieter weist die Einhaltung seiner Pflichten auf Anfrage nach, in der Regel
          durch Auskunft in Textform oder durch Vorlage aktueller Prüfberichte seiner
          Unterauftragsverarbeiter.
        </P>
        <P>
          Genügt das im Einzelfall nicht, kann der Kunde die Einhaltung vor Ort prüfen. Die
          Prüfung ist mit angemessener Frist von mindestens zwei Wochen anzukündigen, darf den
          Betrieb nicht unangemessen beeinträchtigen und findet während der üblichen
          Geschäftszeiten statt. Der Kunde trägt seine Kosten selbst; für den Aufwand des
          Anbieters kann dieser eine angemessene Vergütung verlangen, sofern die Prüfung
          nicht durch einen Verstoß des Anbieters veranlasst ist.
        </P>
      </Section>

      <Section>
        <H2>§ 12 Löschung und Rückgabe</H2>
        <P>
          Nach Beendigung des Hauptvertrags löscht der Anbieter die im Auftrag verarbeiteten
          Daten oder gibt sie zurück — nach Wahl des Kunden, spätestens{' '}
          <strong>30 Tage</strong> nach Vertragsende. Dasselbe gilt, wenn der Kunde die
          Löschung schon während der Vertragslaufzeit verlangt.
        </P>
        <P>
          Der Kunde kann die Löschung jederzeit selbst auslösen: Im Kundenkonto unter
          Einstellungen löscht die Funktion „Konto löschen" das Konto, das Profil und die
          hochgeladenen Fotos und beendet ein laufendes Abonnement.
        </P>
        <P>
          Eine Löschung unterbleibt, soweit eine gesetzliche Aufbewahrungspflicht entgegensteht.
          Betroffen sind davon im Wesentlichen Rechnungs- und Buchungsunterlagen; diese enthalten
          keine Daten aus der Auftragsverarbeitung. Für solche Daten bleibt die Verarbeitung auf
          die Erfüllung der Aufbewahrungspflicht beschränkt.
        </P>
        <P>
          Sicherungskopien werden im Rahmen der üblichen Aufbewahrungszyklen überschrieben. Eine
          gezielte Löschung aus einer bestehenden Sicherung ist technisch nicht möglich; die
          Daten werden dort nicht weiterverarbeitet.
        </P>
      </Section>

      <Section>
        <H2>§ 13 Haftung</H2>
        <P>
          Für die Haftung gelten die Regelungen des Hauptvertrags. Art. 82 DSGVO bleibt
          unberührt; die dort vorgesehene Haftung gegenüber betroffenen Personen lässt sich
          nicht vertraglich beschränken.
        </P>
      </Section>

      <Section>
        <H2>§ 14 Schlussbestimmungen</H2>
        <P>
          Änderungen dieses Vertrags bedürfen der Textform. Das gilt auch für die Änderung
          dieser Klausel.
        </P>
        <P>
          Ist eine Bestimmung unwirksam, bleiben die übrigen wirksam. Die Parteien ersetzen die
          unwirksame Bestimmung durch eine zulässige, die ihrem Zweck am nächsten kommt.
        </P>
        <P>
          Es gilt deutsches Recht. Gerichtsstand ist, soweit gesetzlich zulässig, der Sitz des
          Anbieters.
        </P>
      </Section>

      {/* ═══════════════════ ANLAGE 1 ═══════════════════ */}

      <AnlageKopf>Anlage 1 — Gegenstand der Verarbeitung</AnlageKopf>

      <H3>Kategorien betroffener Personen</H3>
      <UL>
        <li>
          <strong>Kunden und Interessenten des Kunden</strong>, die eine Bewertung über das
          Google Unternehmensprofil des Kunden abgegeben haben
        </li>
        <li>
          <strong>Beschäftigte und Beauftragte des Kunden</strong>, soweit sie das Kundenkonto
          nutzen oder in Bewertungen oder Fotos vorkommen
        </li>
      </UL>

      <H3>Arten personenbezogener Daten</H3>
      <Liste>
        <dt>Bewertungsdaten</dt>
        <dd>
          Angezeigter Name des Bewertenden, Bewertungstext, Sternbewertung, Zeitpunkt,
          Kennung der Bewertung bei Google
        </dd>
        <dd><span>Quelle: Google Unternehmensprofil des Kunden</span></dd>

        <dt>Antwortdaten</dt>
        <dd>Entwürfe und veröffentlichte Antworten auf Bewertungen, Zeitpunkt der Freigabe</dd>

        <dt>Bilddaten</dt>
        <dd>
          Vom Kunden hochgeladene Fotos seines Betriebs samt technischer Metadaten; sie können
          abgebildete Personen enthalten
        </dd>

        <dt>Zugangs- und Kontaktdaten</dt>
        <dd>
          E-Mail-Adresse und Name der Person, die das Kundenkonto nutzt; Kennung des
          verknüpften Google-Kontos; verschlüsselte Zugriffsmerkmale für das
          Unternehmensprofil
        </dd>

        <dt>Betriebsdaten ohne Personenbezug</dt>
        <dd>
          Name, Anschrift, Öffnungszeiten, Kategorien und Sichtbarkeitswerte des Betriebs —
          hier nur erwähnt, weil sie denselben Weg nehmen
        </dd>
      </Liste>

      <H3>Art und Zweck der Verarbeitung</H3>
      <UL>
        <li>Abrufen der Bewertungen aus dem Unternehmensprofil des Kunden und Speichern</li>
        <li>Darstellen und Auswerten im Kundenkonto</li>
        <li>
          Erstellen von Antwortentwürfen durch ein Sprachmodell. Übermittelt werden dafür
          Sternbewertung, Bewertungstext und angezeigter Name. Veröffentlicht wird nur, was
          der Kunde freigibt.
        </li>
        <li>Übertragen freigegebener Antworten und Fotos an das Unternehmensprofil des Kunden</li>
        <li>Versand von Hinweisen an den Kunden zu seinem Konto</li>
      </UL>

      <H3>Besondere Kategorien personenbezogener Daten</H3>
      <P>
        Eine Verarbeitung besonderer Kategorien nach Art. 9 DSGVO ist nicht vorgesehen. Sie ist
        aber nicht ausgeschlossen: Ein Bewertungstext kann Angaben zur Gesundheit oder andere
        sensible Angaben enthalten, ohne dass der Anbieter darauf Einfluss hat. Der Anbieter
        wertet solche Angaben nicht aus und verwendet sie nicht für eigene Zwecke.
      </P>

      {/* ═══════════════════ ANLAGE 2 ═══════════════════ */}

      <AnlageKopf>Anlage 2 — Technische und organisatorische Maßnahmen</AnlageKopf>

      <P>
        Maßnahmen nach Art. 32 DSGVO, Stand Oktober 2026. Beschrieben ist, was eingerichtet
        ist — nicht, was geplant ist.
      </P>

      <H3>1. Vertraulichkeit — Zugangskontrolle</H3>
      <UL>
        <li>
          Die Software ist nur nach Anmeldung nutzbar. Die Anmeldung erfolgt über den
          Authentifizierungsdienst des Datenbankanbieters mit Passwort oder Anmeldelink.
        </li>
        <li>
          Serverseitige Funktionen prüfen das Sitzungsmerkmal bei jedem Aufruf. Eine Umgehung
          durch selbst erzeugte Sitzungsmerkmale ist ausgeschlossen.
        </li>
        <li>
          Anmeldelinks, Einmalkennwörter und Zugriffsmerkmale werden grundsätzlich nicht
          protokolliert — weder vollständig noch in Teilen, aus denen sie sich
          wiederherstellen lassen.
        </li>
      </UL>

      <H3>2. Vertraulichkeit — Zugriffskontrolle und Mandantentrennung</H3>
      <UL>
        <li>
          Jede Tabelle mit Kundendaten ist mit Zugriffsregeln auf Zeilenebene geschützt
          (Row Level Security). Ein Kunde kann technisch nur die Zeilen lesen und ändern, die
          seinem Konto zugeordnet sind.
        </li>
        <li>
          Die Tabelle mit den Zugriffsmerkmalen für das Unternehmensprofil ist für
          Anwendungsrollen vollständig gesperrt. Auch verschlüsselt sind diese Merkmale aus dem
          Browser nicht lesbar.
        </li>
        <li>
          Erweiterte Rechte liegen ausschließlich bei serverseitigen Funktionen. Der Browser
          erhält sie nie.
        </li>
        <li>
          Die Trennung der Mandanten wird durch automatisierte Tests geprüft, die messen, ob ein
          Konto auf fremde Daten zugreifen kann — nicht, ob eine Regel vorhanden ist.
        </li>
      </UL>

      <H3>3. Vertraulichkeit — Verschlüsselung</H3>
      <UL>
        <li>Jede Verbindung zur Software ist transportverschlüsselt (TLS).</li>
        <li>
          Die Zugriffsmerkmale für das Google Unternehmensprofil werden vor dem Speichern mit
          AES-256-GCM verschlüsselt. Die Nutzerkennung geht als zusätzliche authentifizierte
          Angabe in die Verschlüsselung ein, sodass ein Datensatz in einem anderen Konto nicht
          entschlüsselt werden kann. Die Schlüsselkennung wird mitgeführt, damit Schlüssel
          gewechselt werden können.
        </li>
        <li>
          Schlüssel und Zugangsdaten für Fremddienste liegen in einem Geheimnisspeicher, nicht
          im Quelltext und nicht im Klartext in geplanten Aufgaben.
        </li>
        <li>Die Datenbank wird beim Anbieter des Datenbankdienstes verschlüsselt gespeichert.</li>
      </UL>

      <H3>4. Integrität</H3>
      <UL>
        <li>
          Eingaben werden serverseitig geprüft; Datenbankbedingungen verhindern unzulässige
          Zustände auch dann, wenn die Prüfung in der Anwendung umgangen wird.
        </li>
        <li>
          Änderungen am Datenmodell laufen über versionierte Migrationen mit Selbstprüfung: Eine
          Migration, deren Prüfung fällt, wird vollständig zurückgerollt.
        </li>
        <li>
          Vor jeder Übernahme in den Betrieb werden alle Migrationen gegen eine frisch
          aufgebaute Datenbank ausgeführt und die automatisierten Tests durchlaufen.
        </li>
      </UL>

      <H3>5. Verfügbarkeit</H3>
      <UL>
        <li>
          Datenbank und serverseitige Funktionen werden bei einem Anbieter mit redundanter
          Infrastruktur im Rechenzentrum Frankfurt betrieben.
        </li>
        <li>
          Sicherungen der Datenbank erfolgen nach dem Umfang des dort gebuchten
          Leistungspakets: [Sicherungsintervall und Aufbewahrungsdauer bitte eintragen].
        </li>
        <li>
          Fehler in Hintergrundvorgängen werden erfasst und lösen eine Benachrichtigung aus,
          sodass ein Ausfall nicht unbemerkt bleibt.
        </li>
      </UL>

      <H3>6. Trennung</H3>
      <UL>
        <li>
          Betrieb und Entwicklung laufen in getrennten Umgebungen mit getrennten Datenbanken
          und getrennten Zugangsdaten.
        </li>
        <li>
          Für Zahlungen werden Testumgebung und Betrieb getrennt gehalten. Ein Vorgang aus der
          Testumgebung kann im Betrieb nicht wirken.
        </li>
      </UL>

      <H3>7. Organisatorische Maßnahmen</H3>
      <UL>
        <li>
          Der Anbieter wird von einer Person betrieben. Zugang zu den Daten hat ausschließlich
          diese Person. Weitere Beschäftigte werden vor einem Zugang zur Vertraulichkeit
          verpflichtet.
        </li>
        <li>
          Löschungen und Änderungen an Daten im Betrieb erfolgen nur durch die eigene Person
          und nicht automatisiert aus der Entwicklung heraus.
        </li>
        <li>
          Jede Verarbeitung durch einen weiteren Dienst ist in Anlage 3 verzeichnet. Ein neuer
          Dienst wird erst eingesetzt, wenn ein Auftragsverarbeitungsvertrag mit ihm vorliegt.
        </li>
      </UL>

      {/* ═══════════════════ ANLAGE 3 ═══════════════════ */}

      <AnlageKopf>Anlage 3 — Unterauftragsverarbeiter</AnlageKopf>

      <P>
        Genehmigte Unterauftragsverarbeiter nach § 6, Stand Oktober 2026.
      </P>

      <Liste>
        <dt>Supabase Inc.</dt>
        <dd>970 Toa Payoh North, Singapur</dd>
        <dd>Datenbank, Anmeldung, serverseitige Funktionen</dd>
        <dd>
          <span>
            Ort der Verarbeitung: Europäische Union (Frankfurt am Main). Zugriff aus einem
            Drittland durch Betriebspersonal ist nicht ausgeschlossen; Grundlage sind die
            Standardvertragsklauseln.
          </span>
        </dd>

        <dt>Vercel Inc.</dt>
        <dd>340 S Lemon Ave #4133, Walnut, CA 91789, USA</dd>
        <dd>Betrieb der Website und Auslieferung der Anwendung</dd>
        <dd>
          <span>
            Ort der Verarbeitung: USA und weitere Regionen. Grundlage sind die
            Standardvertragsklauseln beziehungsweise ein Angemessenheitsbeschluss, soweit der
            Empfänger zertifiziert ist.
          </span>
        </dd>

        <dt>Anthropic PBC</dt>
        <dd>San Francisco, Kalifornien, USA</dd>
        <dd>
          Erstellen von Antwortentwürfen. Übermittelt werden Sternbewertung, Bewertungstext
          und angezeigter Name des Bewertenden.
        </dd>
        <dd>
          <span>
            Ort der Verarbeitung: USA. Grundlage sind die Standardvertragsklauseln nach dem
            Auftragsverarbeitungsvertrag des Anbieters:{' '}
            <A
              href="https://www.anthropic.com/legal/data-processing-addendum"
              target="_blank"
              rel="noopener noreferrer"
            >
              anthropic.com/legal/data-processing-addendum
            </A>
            . Eine Verwendung der übermittelten Daten zum Trainieren von Modellen ist
            vertraglich ausgeschlossen.
          </span>
        </dd>

        <dt>Brevo SAS (vormals Sendinblue SAS)</dt>
        <dd>106 boulevard Haussmann, 75008 Paris, Frankreich</dd>
        <dd>Versand von E-Mails an den Kunden</dd>
        <dd><span>Ort der Verarbeitung: Europäische Union.</span></dd>

        <dt>Cloudinary Ltd.</dt>
        <dd>111 W Evelyn Ave, Sunnyvale, CA 94086, USA</dd>
        <dd>Speichern und Ausliefern der vom Kunden hochgeladenen Fotos</dd>
        <dd>
          <span>
            Ort der Verarbeitung: USA. Grundlage sind die Standardvertragsklauseln.
          </span>
        </dd>
      </Liste>

      <H3>Nicht Unterauftragsverarbeitung</H3>
      <P>
        Zwei Dienste erscheinen in der <IntLink to="/datenschutz">Datenschutzerklärung</IntLink>,
        gehören aber nicht in diese Anlage:
      </P>
      <UL>
        <li>
          <strong>Stripe</strong> verarbeitet Zahlungsdaten für den Vertrag zwischen Anbieter
          und Kunde. Dafür ist der Anbieter selbst Verantwortlicher — diese Verarbeitung ist
          nicht Auftragsverarbeitung für den Kunden.
        </li>
        <li>
          <strong>Google</strong> betreibt das Unternehmensprofil, das dem Kunden gehört. Der
          Zugriff des Anbieters beruht auf einer Berechtigung, die der Kunde selbst erteilt und
          jederzeit widerrufen kann. Für die Verarbeitung im Unternehmensprofil gilt das
          Verhältnis zwischen Kunde und Google.
        </li>
      </UL>

      <Section style={{ marginTop: 44 }}>
        <H2>Fragen zu diesem Vertrag</H2>
        <P>
          <A href="mailto:info@werkruf.com">info@werkruf.com</A> · Antwort werktags innerhalb
          von 24 Stunden. Eine unterschriebene Fassung für die eigene Dokumentation stellt der
          Anbieter auf Anfrage aus.
        </P>
      </Section>
    </Wrap>
  );
}
