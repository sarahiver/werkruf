/*
 * Hilfe — Startseite des Hilfe-Centers (/hilfe).
 *
 * Seit 12.11.2026: Ablauf in vier Schritten, Themen-Übersicht mit
 * Links auf die Detailseiten (Inhalte: src/config/hilfe.js), darunter
 * wie bisher Kontakt und häufige Fragen.
 *
 * Kontakt bleibt hier, weil Stripe im Checkout und im Kundenportal
 * eine Support-Adresse verlangt und diese Seite zusätzlich nennt,
 * WANN eine Antwort kommt. Bewusst kein Kontaktformular.
 *
 * Korrigiert am 12.11.2026: Die Antwort „Was passiert mit meinen Daten,
 * wenn ich kündige?" sagte „werden gelöscht". Tatsächlich wechselt das
 * Konto nach der Kündigung in den Free-Modus und bleibt erhalten
 * (docs/operations/free-downgrade.md); Löschen ist ein eigener Schritt.
 */

import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { Mail, Clock, ArrowRight } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';
import { useSeitenMeta } from '../hooks/useSeitenMeta';
import { HILFE_GRUPPEN, HILFE_ARTIKEL, HILFE_ABLAUF, setzeWerte } from '../config/hilfe';
import {
  Rahmen, Inhalt, Badge, Titel, Einleitung, H2, HilfeNavigation, HilfeCta, useHilfeWerte,
} from '../components/hilfe/HilfeBausteine';

const Karte = styled.a`
  display: flex; align-items: flex-start; gap: 14px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-card, 8px);
  padding: 20px 22px; margin-bottom: 14px;
  text-decoration: none; transition: border-color .2s ease;
  &:hover { border-color: var(--color-accent); }
`;

const KarteStatisch = styled.div`
  display: flex; align-items: flex-start; gap: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  padding: 20px 22px; margin-bottom: 40px;
`;

const Icon = styled.div`
  flex: 0 0 auto; color: var(--color-accent); margin-top: 2px;
`;

const KarteTitel = styled.div`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; color: var(--color-primary); margin-bottom: 4px;
`;

const KarteText = styled.div`
  font-family: var(--font-body); font-size: .9rem;
  color: var(--color-text); line-height: 1.65;
`;

const Section = styled.section`margin-bottom: 32px;`;


const Frage = styled.div`
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: 0; }
`;

const FrageTitel = styled.div`
  font-family: var(--font-body); font-weight: 700; font-size: .92rem;
  color: var(--color-primary); margin-bottom: 5px;
`;

const Antwort = styled.div`
  font-family: var(--font-body); font-size: .9rem;
  color: var(--color-text); line-height: 1.7;
  a { color: var(--color-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

const Schritte = styled.ol`
  list-style: none; padding: 0; margin: 0 0 44px;
  display: grid; gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); }
`;

const Schritt = styled(Link)`
  display: flex; gap: 14px; height: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  background: var(--color-surface, #fff);
  padding: 16px 18px; text-decoration: none;
  transition: border-color .2s ease;
  &:hover { border-color: var(--color-accent); }
`;

const Nummer = styled.span`
  flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(var(--color-accent-rgb), .12); color: var(--color-accent);
  font-family: var(--font-display); font-weight: 700; font-size: .85rem;
`;

const Themen = styled.div`
  display: grid; gap: 28px 32px; margin-bottom: 48px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); }
`;

const ThemenLink = styled(Link)`
  display: block; padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  text-decoration: none;
  font-family: var(--font-body); font-size: .92rem; font-weight: 600;
  color: var(--color-primary);
  span { display: block; font-weight: 400; font-size: .84rem; color: var(--color-text-muted); line-height: 1.5; margin-top: 2px; }
  &:hover { color: var(--color-accent); }
`;

const GruppenTitel = styled.h3`
  font-family: var(--font-body); font-weight: 700;
  font-size: .72rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--color-text-muted); margin-bottom: 4px;
`;

const MAIL = 'info@werkruf.com';

export const HILFE_START_META = Object.freeze({
  titel: 'Hilfe: So funktioniert WERKRUF | WERKRUF',
  beschreibung: 'Von der Anmeldung bis zur ersten Empfehlung: Google-Verbindung, Bewertungen, Antwortvorschläge, Wochenmail, Preise und Datenschutz bei WERKRUF kurz erklärt.',
});

export default function Hilfe() {
  const { pricing } = useIndustry();
  const werte = useHilfeWerte();
  const tage  = pricing.trialDays;
  const preis = `${pricing.monthlyPrice} ${pricing.currency}`;
  useSeitenMeta({ ...HILFE_START_META, pfad: '/hilfe' });

  return (
    <Rahmen>
      <HilfeNavigation aktuell="Übersicht" />
      <Inhalt>
      <Badge>Hilfe</Badge>
      <Titel>So funktioniert WERKRUF</Titel>
      <Einleitung>
        Von der Anmeldung bis zur ersten Empfehlung: Hier findest du die wichtigsten Schritte
        und Funktionen kurz erklärt.
      </Einleitung>

      <H2>In vier Schritten</H2>
      <Schritte>
        {HILFE_ABLAUF.map((s, i) => (
          <li key={s.slug}>
            <Schritt to={`/hilfe/${s.slug}`}>
              <Nummer aria-hidden="true">{i + 1}</Nummer>
              <div>
                <KarteTitel>{s.titel}</KarteTitel>
                <KarteText>{s.text}</KarteText>
              </div>
            </Schritt>
          </li>
        ))}
      </Schritte>

      <H2>Alle Themen</H2>
      <Themen>
        {HILFE_GRUPPEN.map((g) => (
          <section key={g.key} aria-labelledby={`gruppe-${g.key}`}>
            <GruppenTitel id={`gruppe-${g.key}`}>{g.titel}</GruppenTitel>
            {HILFE_ARTIKEL.filter((a) => a.gruppe === g.key).map((a) => (
              <ThemenLink key={a.slug} to={`/hilfe/${a.slug}`}>
                {a.titel} <ArrowRight size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} />
                <span>{setzeWerte(a.beschreibung, werte)}</span>
              </ThemenLink>
            ))}
          </section>
        ))}
        <section aria-labelledby="gruppe-produkt">
          <GruppenTitel id="gruppe-produkt">Neu bei WERKRUF</GruppenTitel>
          <ThemenLink to="/changelog">
            Changelog <ArrowRight size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} />
            <span>Was sich an WERKRUF zuletzt geändert hat.</span>
          </ThemenLink>
        </section>
      </Themen>

      <H2>Kontakt</H2>
      <Karte href={`mailto:${MAIL}`}>
        <Icon><Mail size={20} /></Icon>
        <div>
          <KarteTitel>{MAIL}</KarteTitel>
          <KarteText>
            Schreib einfach, was nicht klappt. Wenn du den Namen deines Betriebs dazuschreibst,
            können wir direkt nachsehen.
          </KarteText>
        </div>
      </Karte>

      <KarteStatisch>
        <Icon><Clock size={20} /></Icon>
        <div>
          <KarteTitel>Antwort werktags innerhalb von 24 Stunden</KarteTitel>
          <KarteText>
            Montag bis Freitag. Am Wochenende kann es länger dauern — dringende Störungen
            sehen wir trotzdem.
          </KarteText>
        </div>
      </KarteStatisch>

      <Section>
        <H2>Häufige Fragen</H2>

        <Frage>
          <FrageTitel>Wie lange kann ich testen, und was passiert danach?</FrageTitel>
          <Antwort>
            {tage} Tage kostenlos. Die Zahlungsdaten hinterlegst du zu Beginn, abgebucht wird
            in diesen {tage} Tagen nichts. Danach läuft das Abo für {preis} im Monat weiter,
            wenn du nicht vorher kündigst.
          </Antwort>
        </Frage>

        <Frage>
          <FrageTitel>Wie kündige ich?</FrageTitel>
          <Antwort>
            In den Einstellungen unter „Abo &amp; Zahlungen verwalten". Die Kündigung wird zum
            Ende des bezahlten Zeitraums wirksam — bis dahin kannst du WERKRUF normal
            weiternutzen. Das Monatsabo ist jeden Monat kündbar, das Jahresabo zum Ende des
            bezahlten Jahres.
          </Antwort>
        </Frage>

        <Frage>
          <FrageTitel>Warum braucht WERKRUF Zugriff auf mein Google-Profil?</FrageTitel>
          <Antwort>
            Ohne die Verbindung gibt es nichts auszuwerten: Bewertungen, Öffnungszeiten, Fotos
            und Kategorien liegen bei Google. Du erteilst den Zugriff über dein eigenes
            Google-Konto und kannst ihn jederzeit wieder entziehen. Welche Berechtigung das genau
            ist: <Link to="/hilfe/google-rechte">Google-Rechte</Link>.
          </Antwort>
        </Frage>

        <Frage>
          <FrageTitel>Verändert WERKRUF etwas an meinem Google-Profil ohne mich?</FrageTitel>
          <Antwort>
            Nein. Antworten auf Bewertungen sind Entwürfe, bis du sie freigibst. Was
            veröffentlicht wird, entscheidest du.
          </Antwort>
        </Frage>

        <Frage>
          <FrageTitel>Was passiert mit meinen Daten, wenn ich kündige?</FrageTitel>
          <Antwort>
            Nichts geht verloren: Dein Konto wechselt in den kostenlosen Modus, Google-Verbindung,
            Score und Profilstand bleiben erhalten. Wenn du dein Konto ganz löschen möchtest, geht
            das in den Einstellungen. Dein Google-Unternehmensprofil bleibt in jedem Fall
            unberührt — es gehört dir und liegt bei Google. Mehr dazu unter{' '}
            <Link to="/hilfe/preise-und-kuendigung">Preise und Kündigung</Link> und in der{' '}
            <Link to="/datenschutz">Datenschutzerklärung</Link>.
          </Antwort>
        </Frage>

        <Frage>
          <FrageTitel>Ich bekomme keine E-Mails von WERKRUF.</FrageTitel>
          <Antwort>
            Sieh zuerst im Spam-Ordner nach und nimm {MAIL} in dein Adressbuch auf. Welche
            Mails du bekommst, stellst du im Dashboard unter den Benachrichtigungen ein.
            Hilft beides nicht, schreib uns.
          </Antwort>
        </Frage>
      </Section>

      <Section>
        <H2>Rechtliches</H2>
        <Antwort>
          <Link to="/agb">Allgemeine Geschäftsbedingungen</Link> ·{' '}
          <Link to="/datenschutz">Datenschutzerklärung</Link> ·{' '}
          <Link to="/impressum">Impressum</Link>
        </Antwort>
      </Section>
      <HilfeCta />
      </Inhalt>
    </Rahmen>
  );
}
