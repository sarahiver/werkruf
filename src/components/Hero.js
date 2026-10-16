import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Link } from 'react-router-dom';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to   { opacity: 1; transform: translateY(0); }
`;
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
`;

/* ─────────────────────────────────────────────
   STYLED — all colors from CSS vars
───────────────────────────────────────────── */
const HeroSection = styled.section`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  position: relative;
  overflow: hidden;
  padding: 120px 24px 80px;
  /* Auf dem Telefon ist der Abschnitt ohnehin höher als ein
     Bildschirm; 200px Innenabstand sind dort reine Höhe. Oben bleibt
     genug für die feste Kopfzeile (72px). */
  @media (max-width: 760px) {
    min-height: 0;
    padding: 96px 20px 44px;
  }
`;

const GridOverlay = styled.div`
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb), 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
  /* Only show for heavy-duty industries */
  display: ${({ $show }) => $show ? 'block' : 'none'};
`;

const AccentBar = styled.div`
  position: absolute;
  top: 0; right: 0;
  width: 5px; height: 100%;
  background: var(--color-accent);
`;

const Inner = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  align-items: center;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: 32px;
  }
`;

const Left = styled.div`
  animation: ${fadeUp} 0.7s ease both;
  @media (max-width: 900px) { order: 1; }
`;

const EyebrowTag = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(var(--color-accent-rgb), 0.12);
  border: 1px solid rgba(var(--color-accent-rgb), 0.35);
  color: var(--color-accent);
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 14px;
  margin-bottom: 22px;
  @media (max-width: 760px) { margin-bottom: 14px; font-size: 0.7rem; }
`;

const Dot = styled.span`
  width: 6px; height: 6px;
  background: var(--color-accent);
  border-radius: 50%;
  display: inline-block;
  animation: ${pulse} 1.5s ease infinite;
`;

/* Die Headline bleibt wörtlich, wie sie ist — sie ist der Haken der
   Seite. Auf sehr schmalen Geräten wird nur der Grad kleiner: Bei
   2.6rem bricht der Satz auf 375px in fünf Zeilen, bei 2.2rem in
   vier. Das sind rund 45px weniger, ohne ein Wort zu streichen, und
   dominant bleibt sie allemal. */
const Headline = styled.h1`
  font-size: clamp(2.6rem, 5vw, 4.2rem);
  line-height: 1.0;
  color: var(--color-white);
  margin-bottom: 8px;
  text-transform: var(--text-transform);
  @media (max-width: 420px) { font-size: 2.2rem; }
`;

const HeadlineAccent = styled.span`
  color: var(--color-accent);
`;

/* Normalschrift statt Versalien, und heller als vorher.

   Die Subline stand bis zum 16.10.2026 in Grossbuchstaben
   (text-transform aus der Branchenkonfiguration). Das trug die alte,
   kurze Fassung gerade noch. Seit sie den Nutzen benennt und ein
   zweiter Satz zur Abgrenzung dazukommt, sind es zwei Absätze
   Versalien — und die liest niemand. Versalien sind die Schrift der
   Überschrift, nicht des Fliesstextes.

   Die Deckkraft steigt von 0.38 auf 0.72: Der wichtigste Satz der
   Seite nach der Überschrift darf nicht aussehen wie eine Fussnote. */
const HeadlineSub = styled.p`
  font-family: var(--font-body);
  font-size: clamp(1rem, 1.5vw, 1.15rem);
  color: rgba(255,255,255,0.72);
  line-height: 1.65;
  margin-bottom: 18px;
  max-width: 34em;
  &:last-of-type { margin-bottom: 32px; }
  @media (max-width: 760px) {
    font-size: 0.97rem; line-height: 1.55;
    margin-bottom: 14px;
    &:last-of-type { margin-bottom: 22px; }
  }
`;

/* Der zweite Absatz — "Du musst dich nicht darum kümmern…" — ist auf
   dem Telefon der dritte Text in Folge, der dasselbe Versprechen in
   anderen Worten gibt. Darunter stehen bereits drei konkrete Punkte,
   die es belegen statt es zu wiederholen.

   Auf dem Telefon entscheidet die Höhe bis zum Knopf; auf dem Desktop
   steht alles ohnehin nebeneinander und kostet nichts. Deshalb nur
   hier ausgeblendet, nicht gelöscht. */
const NurBreit = styled.div`
  @media (max-width: 760px) { display: none; }
`;

const CheckList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const CheckItem = styled.li`
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 0.88rem;
  color: rgba(255,255,255,0.62);
  svg { color: var(--color-accent); flex-shrink: 0; }
`;

/* Search Card */
const Right = styled.div`
  animation: ${fadeUp} 0.7s ease 0.15s both;
  @media (max-width: 900px) { order: 2; }
`;

const SearchCard = styled.div`
  background: var(--color-white);
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 32px 28px 28px;
  @media (max-width: 560px) { padding: 24px 20px 22px; }
`;

const CardTitle = styled.p`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.15rem;
  text-transform: var(--text-transform);
  color: var(--color-primary);
  letter-spacing: var(--letter-spacing);
  margin-bottom: 4px;
`;

/* Erklärender Fliesstext in der Karte: auf dem Telefon weg.

   Was er sagt — Konto anlegen, Profil verbinden, Berechtigung
   widerrufbar — steht dort entweder schon in der Überschrift ("In
   zwei Minuten eingerichtet") oder kurz darunter im Vertrauenssatz.
   Drei Zeilen Erklärung zwischen Überschrift und Knopf schieben den
   Knopf aus dem ersten Bildschirm. */
const CardSub = styled.p`
  font-family: var(--font-body);
  font-size: 0.82rem;
  color: var(--color-text-muted);
  margin-bottom: 20px;
  line-height: 1.5;
  @media (max-width: 760px) { display: none; }
`;

const CtaButton = styled(Link)`
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 16px 20px; margin-top: 6px;
  background: var(--color-accent); color: #fff;
  border-radius: var(--radius-button); text-decoration: none;
  font-weight: 800; font-size: 1rem; line-height: 1.3;
  transition: filter .15s ease;
  &:hover { filter: brightness(1.07); }
`;

/* Der ausführliche Vertrauenshinweis bleibt dem Desktop vorbehalten.
   Auf dem Telefon steht stattdessen die Kurzfassung (KurzHinweis) —
   der Inhalt verschwindet also nicht, er wird kürzer. */
const CtaHinweis = styled.p`
  font-size: .78rem; color: #66717e; line-height: 1.55; margin: 14px 0 0;
  @media (max-width: 760px) { display: none; }
`;

const KurzHinweis = styled.p`
  display: none;
  @media (max-width: 760px) {
    display: block;
    font-size: .76rem; color: #66717e; line-height: 1.5;
    margin: 12px 0 0; text-align: center;
  }
`;

const Anmeldung = styled.p`
  font-size: .82rem; color: #66717e; margin: 16px 0 0;
  padding-top: 14px; border-top: 1px solid var(--color-border);
  @media (max-width: 760px) { margin-top: 12px; padding-top: 10px; }
`;

const AnmeldeLink = styled(Link)`
  color: var(--color-accent); font-weight: 700; text-decoration: underline;
`;

/* Der Preis steht ab dem 16.10.2026 im Hero.
   Vorher nannte ihn keine einzige Stelle der Landingpage — der
   Besucher erfuhr erst nach der Registrierung, dass WERKRUF Geld
   kostet. Das ist der teuerste Moment, um es zu erfahren. */
/* Steht seit dem 16.10.2026 ÜBER dem Knopf, nicht darunter: Erst das
   Angebot lesen, dann drücken. Darunter war sie die Fussnote einer
   Entscheidung, die schon gefallen war. */
const PreisZeile = styled.p`
  font-family: var(--font-body);
  font-size: .9rem; font-weight: 700;
  color: var(--color-primary);
  text-align: center;
  margin: 0 0 14px;
  padding: 10px 12px;
  background: rgba(var(--color-accent-rgb), .08);
  border-radius: var(--radius-button);
  span { color: var(--color-text-muted); font-weight: 400; }
  @media (max-width: 760px) { margin-bottom: 12px; }
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
const Hero = () => {
  const { copy, design, pricing } = useIndustry();
  const { hero: heroCopy } = copy;
  const { isAuthenticated } = useAuthContext();

  /* Ein Ziel, zwei Ausgangslagen. Angemeldete Nutzer landen direkt auf
     der Verbindungsseite, alle anderen bei der Registrierung — von dort
     fuehrt das Onboarding weiter zur selben Seite. */
  const ctaZiel = isAuthenticated ? '/dashboard/google' : '/signup';

  /* Warum "Tage kostenlos testen" und nicht "Google-Profil verbinden":
     Der Knopf muss sagen, worauf man sich einlässt, nicht was im
     zweiten Schritt passiert. "Verbinden" klingt nach Arbeit und nach
     Berechtigung — zwei Hürden auf einmal, bevor der Besucher weiss,
     was es kostet. Für angemeldete Nutzer dreht es sich um: die
     Testphase laeuft schon, offen ist die Verbindung. */
  const ctaText = isAuthenticated
    ? 'Google-Unternehmensprofil verbinden'
    : `Jetzt ${pricing.trialDays} Tage kostenlos testen`;

  return (
    <HeroSection id="hero">
      <GridOverlay $show={design.accentStripePattern} />
      <AccentBar />

      <Inner>
        <Left>
          <EyebrowTag><Dot /> {heroCopy.eyebrow}</EyebrowTag>

          <Headline>
            {heroCopy.headline}<br />
            <HeadlineAccent>{heroCopy.headlineAccent}</HeadlineAccent>
          </Headline>

          <HeadlineSub>{heroCopy.subline}</HeadlineSub>
          {heroCopy.differenzierung && (
            <NurBreit>
              <HeadlineSub style={{ fontWeight: 700 }}>
                {heroCopy.differenzierung}
              </HeadlineSub>
            </NurBreit>
          )}

          <CheckList>
            {heroCopy.checks.map((check, i) => (
              <CheckItem key={i}>
                <CheckCircle size={15} />
                {check}
              </CheckItem>
            ))}
          </CheckList>
        </Left>

        <Right>
          <SearchCard>
            <CardTitle>In zwei Minuten eingerichtet</CardTitle>
            <CardSub>
              Konto anlegen, Google-Profil verbinden — eine Berechtigung, jederzeit
              widerrufbar. Danach prüft WERKRUF dein Profil laufend und sagt dir,
              was zu tun ist.
            </CardSub>

            <PreisZeile>
              {pricing.trialDays} Tage kostenlos{' '}
              <span>· danach {pricing.monthlyPrice} {pricing.currency} / Monat · monatlich kündbar</span>
            </PreisZeile>

            <CtaButton to={ctaZiel}>
              {ctaText}
              <ArrowRight size={18} />
            </CtaButton>

            <CtaHinweis>
              WERKRUF liest dein Unternehmensprofil und schlägt Änderungen vor.
              Veröffentlicht wird nur, was du freigibst. Kein Zugriff auf E-Mails,
              Kontakte oder Dateien.
            </CtaHinweis>

            {/* Dieselbe Zusage, auf einen Satz gebracht. Die
                Berechtigungsfrage ist die häufigste Hürde vor dem
                Klick — sie darf auf dem Telefon nicht wegfallen,
                nur kürzer werden. */}
            <KurzHinweis>
              Eine Berechtigung, jederzeit widerrufbar. Veröffentlicht wird nur,
              was du freigibst.
            </KurzHinweis>

            {!isAuthenticated && (
              <Anmeldung>
                Schon registriert? <AnmeldeLink to="/login">Anmelden</AnmeldeLink>
              </Anmeldung>
            )}
          </SearchCard>
        </Right>

      </Inner>
    </HeroSection>
  );
};

export default Hero;
