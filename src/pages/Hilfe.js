/*
 * Hilfe und Kontakt.
 *
 * Diese Seite existiert aus zwei Gründen:
 *
 *   1. Stripe verlangt im Checkout und im Kundenportal eine
 *      Support-Adresse. Ein mailto: tut es auch, aber eine Seite
 *      nennt zusätzlich, WANN eine Antwort kommt — und genau das
 *      entscheidet, ob ein Betrieb sich traut, 49 EUR im Monat zu
 *      binden.
 *
 *   2. Es gab bis zum 15.10.2026 keinen einzigen Weg von der Seite
 *      zu einem Menschen ausser der Mailadresse in der Fusszeile.
 *
 * Bewusst KEIN Kontaktformular: Ein Formular, dessen Mails niemand
 * zuverlaessig liest, ist schlechter als eine Adresse. Hier steht die
 * Adresse, die auch sonst ueberall steht.
 *
 * Bewusst KEINE FAQ mit erfundenen Fragen. Was haeufig gefragt wird,
 * weiss man erst nach den ersten Kunden. Bis dahin stehen hier die
 * Fragen, die der Code selbst beantwortet — Testphase, Kuendigung,
 * Google-Verbindung, Datenloeschung.
 */

import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { Mail, Clock } from 'lucide-react';
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
`;

const Lede = styled.p`
  font-family: var(--font-body); font-size: 1rem;
  color: var(--color-text-muted); line-height: 1.7;
  margin-bottom: 40px; padding-bottom: 20px;
  border-bottom: 2px solid var(--color-border);
`;

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

const H2 = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 16px;
`;

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

const MAIL = 'info@werkruf.com';

export default function Hilfe() {
  const { pricing } = useIndustry();
  const tage  = pricing.trialDays;
  const preis = `${pricing.monthlyPrice} ${pricing.currency}`;

  return (
    <Wrap>
      <Back to="/">← Zurück zur Startseite</Back>
      <Badge>Hilfe</Badge>
      <Title>Hilfe &amp; Kontakt</Title>
      <Lede>
        Eine Frage, ein Problem, ein Wunsch — schreib uns. Hinter WERKRUF steht ein kleines
        Team, keine Hotline mit Warteschleife.
      </Lede>

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
            weiternutzen. Keine Mindestlaufzeit, keine Kündigungsfrist.
          </Antwort>
        </Frage>

        <Frage>
          <FrageTitel>Warum braucht WERKRUF Zugriff auf mein Google-Profil?</FrageTitel>
          <Antwort>
            Ohne die Verbindung gibt es nichts auszuwerten: Bewertungen, Öffnungszeiten, Fotos
            und Kategorien liegen bei Google. Du erteilst den Zugriff über dein eigenes
            Google-Konto und kannst ihn jederzeit wieder entziehen.
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
            Dein Konto und die dazugehörigen Daten werden gelöscht. Dein
            Google-Unternehmensprofil bleibt unberührt — es gehört dir und liegt bei Google.
            Details in der <Link to="/datenschutz">Datenschutzerklärung</Link>.
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
    </Wrap>
  );
}
