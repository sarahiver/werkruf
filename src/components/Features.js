import React from 'react';
import styled from 'styled-components';
import { Target, Users, Clock, TrendingUp, Shield, Zap } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';

const ICONS = [Target, Users, Clock, TrendingUp, Shield, Zap];

const Section = styled.section`
  background: var(--color-bg);
  padding: 100px 24px;
  position: relative;
  overflow: hidden;
`;

const TopStripe = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0; height: 5px;
  background: repeating-linear-gradient(
    90deg,
    var(--color-primary) 0px, var(--color-primary) 60px,
    var(--color-accent) 60px, var(--color-accent) 80px
  );
  display: ${({ $show }) => $show ? 'block' : 'none'};
`;

const Inner = styled.div`max-width: 1200px; margin: 0 auto;`;

const SectionHeader = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 32px;
  margin-bottom: 64px;
  @media (max-width: 700px) { grid-template-columns: 1fr; }
`;

const Eyebrow = styled.p`
  font-family: var(--font-body);
  font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 12px;
`;

const Title = styled.h2`
  font-size: clamp(2rem, 4vw, 3rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.05;
`;

const TitleAccent = styled.span`color: var(--color-accent);`;

const HeaderNote = styled.p`
  font-family: var(--font-body); font-size: 0.95rem;
  color: var(--color-text-muted); max-width: 280px; line-height: 1.65;
  @media (max-width: 700px) { max-width: 100%; }
`;

/* Die Spaltenzahl folgt der Kartenzahl.

   Das Raster hat 2px Abstand auf einem grauen Grund — so entsteht die
   Trennlinie zwischen den Karten. Bei fest drei Spalten und nur zwei
   Karten bleibt die dritte Zelle als grauer Block stehen. Mit
   $spalten füllt jede Gruppe ihre Reihe aus. */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(${({ $spalten }) => $spalten ?? 3}, 1fr);
  gap: 2px;
  background: var(--color-border);
  @media (max-width: 900px) { grid-template-columns: 1fr 1fr; }
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;

const Card = styled.div`
  background: var(--color-white);
  padding: 40px 32px;
  position: relative;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  border-radius: var(--radius-card);

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    background: var(--color-accent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s ease;
  }

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(var(--color-primary-rgb), 0.12);
    z-index: 1;
  }

  &:hover::before { transform: scaleX(1); }
`;

/* CardNum ist am 16.10.2026 entfallen: Die Nummerierung 01–06 stammte
   aus der flachen Liste. Innerhalb von drei Gruppen hätte sie bei
   jeder Gruppe wieder bei 01 begonnen oder durchgezählt — beides
   erzeugt eine Ordnung, die es nicht gibt. */

const IconWrap = styled.div`
  width: 50px; height: 50px;
  background: var(--color-primary);
  border-radius: var(--radius-button);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 18px;
  color: var(--color-accent);
`;

const CardTitle = styled.h3`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.4rem;
  text-transform: var(--text-transform);
  color: var(--color-primary);
  margin-bottom: 10px;
`;

const CardBody = styled.p`
  font-family: var(--font-body); font-size: 0.92rem;
  color: var(--color-text-muted); line-height: 1.7; margin-bottom: 18px;
`;

const CardTag = styled.span`
  display: inline-block;
  background: rgba(var(--color-accent-rgb), 0.1);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 4px 10px;
  border-radius: var(--radius-button);
`;

/* ─────────────────────────────────────────────
   GRUPPENKOPF

   Jede der drei Gruppen bekommt eine eigene Überschrift. Sie benennt
   das Ergebnis, nicht die Funktion — "Besser gefunden werden" statt
   "Profilpflege".
───────────────────────────────────────────── */
const Gruppe = styled.div`
  & + & { margin-top: 72px; }
`;

const GruppenKopf = styled.div`
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 32px; align-items: end; margin-bottom: 28px;
  padding-bottom: 18px;
  border-bottom: 3px solid var(--color-primary);
  @media (max-width: 760px) { grid-template-columns: 1fr; gap: 10px; }
`;

const GruppenTitel = styled.h3`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: clamp(1.5rem, 3vw, 2.1rem);
  text-transform: var(--text-transform);
  color: var(--color-primary);
  line-height: 1.1;
  overflow-wrap: break-word;
  hyphens: auto;
`;

const GruppenText = styled.p`
  font-family: var(--font-body); font-size: 0.95rem;
  color: var(--color-text-muted); line-height: 1.7;
`;

/* ─────────────────────────────────────────────
   VERTRAUENSSTREIFEN

   Einwände, keine Vorteile. Deshalb schmal, ruhig und am Ende —
   nicht als vierte Kachelreihe, die mit den Ergebnissen um
   Aufmerksamkeit konkurriert.
───────────────────────────────────────────── */
const Vertrauen = styled.div`
  margin-top: 72px;
  background: var(--color-primary);
  border-radius: var(--radius-card);
  padding: 32px 40px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;
  @media (max-width: 760px) { grid-template-columns: 1fr; gap: 24px; padding: 28px 24px; }
`;

const VertrauenTitel = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; letter-spacing: 0.04em;
  text-transform: var(--text-transform);
  color: var(--color-white); margin-bottom: 6px;
`;

const VertrauenText = styled.p`
  font-family: var(--font-body); font-size: 0.86rem;
  color: rgba(255,255,255,0.6); line-height: 1.65;
`;

/**
 * Leistungen, gruppiert nach drei Ergebnissen.
 *
 * Der Abschluss-CTA ist am 16.10.2026 hier verschwunden. Er lautete
 * "Jetzt Sichtbarkeits-Check machen →" und zeigte auf #check — ein
 * Anker, den es seit dem 28.09.2026 nicht mehr gibt. Damit endete die
 * Landingpage auf einem Knopf ohne Ziel. Der Abschluss steht jetzt in
 * einer eigenen Sektion am Seitenende, nach Vergleich, Preis und FAQ.
 *
 * Fällt `featureGruppen` in der Branchenkonfiguration, greift die alte
 * flache Liste. Gastro und Beauty tragen sie noch.
 */
const Features = () => {
  const { copy, design } = useIndustry();
  const gruppen   = copy.featureGruppen;
  const vertrauen = copy.vertrauen;

  /* Rückfall für Branchen ohne Gruppen. */
  if (!Array.isArray(gruppen)) {
    const flach = copy.features ?? [];
    return (
      <Section id="leistungen">
        <TopStripe $show={design.topStripe} />
        <Inner>
          <SectionHeader>
            <div>
              <Eyebrow>Was du davon hast</Eyebrow>
              <Title>Digital. <TitleAccent>Hart.</TitleAccent><br />Auf den Punkt.</Title>
            </div>
          </SectionHeader>
          <Grid>
            {flach.map((f, i) => {
              const Icon = ICONS[i % ICONS.length];
              return (
                <Card key={f.num ?? i}>
                  <IconWrap><Icon size={22} /></IconWrap>
                  <CardTitle>{f.title}</CardTitle>
                  <CardBody>{f.body}</CardBody>
                  {f.tag && <CardTag>{f.tag}</CardTag>}
                </Card>
              );
            })}
          </Grid>
        </Inner>
      </Section>
    );
  }

  let ikone = 0;

  return (
    <Section id="leistungen">
      <TopStripe $show={design.topStripe} />
      <Inner>
        {/* Die USP-Zeile.

            Sie steht hier und nicht in einer eigenen Sektion: Der
            Satz gehört an die Stelle, an der der Besucher fragt "was
            habe ich davon" — und er ersetzt einen Titel, der nur die
            Gliederung beschrieb ("Drei Ergebnisse. Kein
            Schnickschnack."). Das kostet keine zusätzliche Höhe.

            Er sagt bewusst NICHT "keine Agentur". Diese Abgrenzung
            steht schon im Vertrauensstreifen und im Vergleich; ein
            drittes Mal wäre sie das Hauptargument, und das ist sie
            nicht. Das Hauptargument ist die abgenommene laufende
            Aufmerksamkeit — deshalb zwei Sätze: was du tust, was
            WERKRUF tut. */}
        <SectionHeader>
          <div>
            <Eyebrow>Was du davon hast</Eyebrow>
            <Title>
              Du arbeitest.<br />
              <TitleAccent>WERKRUF behält dein Profil im Blick.</TitleAccent>
            </Title>
          </div>
          <HeaderNote>
            Es meldet sich, wenn etwas zu tun ist — und sonst nicht. Alles,
            was hier steht, ist gebaut und in Betrieb.
          </HeaderNote>
        </SectionHeader>

        {gruppen.map((g) => (
          <Gruppe key={g.key}>
            <GruppenKopf>
              <div>
                <Eyebrow>{g.eyebrow}</Eyebrow>
                <GruppenTitel>{g.titel}</GruppenTitel>
              </div>
              <GruppenText>{g.einleitung}</GruppenText>
            </GruppenKopf>

            <Grid $spalten={g.karten.length}>
              {g.karten.map((f) => {
                const Icon = ICONS[ikone++ % ICONS.length];
                return (
                  <Card key={f.title}>
                    <IconWrap><Icon size={22} /></IconWrap>
                    <CardTitle>{f.title}</CardTitle>
                    <CardBody>{f.body}</CardBody>
                    {f.tag && <CardTag>{f.tag}</CardTag>}
                  </Card>
                );
              })}
            </Grid>
          </Gruppe>
        ))}

        {Array.isArray(vertrauen) && (
          <Vertrauen>
            {vertrauen.map((v) => (
              <div key={v.title}>
                <VertrauenTitel>{v.title}</VertrauenTitel>
                <VertrauenText>{v.body}</VertrauenText>
              </div>
            ))}
          </Vertrauen>
        )}
      </Inner>
    </Section>
  );
};

export default Features;
