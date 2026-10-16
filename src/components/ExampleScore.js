/**
 * Beispiel-Score fuer die oeffentliche Landingpage.
 *
 * WICHTIG — drei Regeln, die diese Komponente einhalten muss:
 *
 * 1. Die Zahlen sind synthetisch. Es wird KEIN Google-Profil des
 *    Besuchers abgerufen, weder ueber Places noch sonstwie. Die
 *    Landingpage sendet keine Anfrage an Google.
 * 2. Gerechnet wird mit calculateHealthScoreInputs — derselben
 *    kanonischen Funktion, die nach der Verbindung den echten Wert
 *    liefert. Keine zweite Formel, sonst zeigt das Beispiel etwas
 *    anderes als das spaetere Ergebnis.
 * 3. Die Kennzeichnung als Beispiel steht ueber der Zahl, nicht im
 *    Kleingedruckten. Ein Besucher darf keine Sekunde glauben, sein
 *    Profil sei bereits analysiert worden.
 */
import React from 'react';
import styled from 'styled-components';
import { AlertCircle, ArrowRight, Info } from 'lucide-react';
import { calculateHealthScoreInputs, HEALTH_WEIGHTS } from '../utils/healthScore';

/* ─────────────────────────────────────────────
   SYNTHETISCHE DATEN

   Ein erfundener Betrieb mit einem realistischen, nicht perfekten
   Profil. Bewusst nicht 100: Der Score soll zeigen, dass es etwas zu
   tun gibt — das ist der Nutzen, den die Seite erklaert.
───────────────────────────────────────────── */
export const BEISPIEL_BETRIEB = Object.freeze({
  name: 'Beispiel: Dachdeckerei Nordlicht',
  stats: {
    totalReviews:   48,
    unanswered:     5,
    averageRating:  4.6,
    // Feste Zeitspanne statt festem Datum, damit das Beispiel nicht
    // mit der Zeit altert und der Wert stabil bleibt.
    newestReviewAt: new Date(Date.now() - 12 * 864e5).toISOString(),
    photoCount:     3,
  },
  location: {
    primary_phone:    '+49 40 1234567',
    website_uri:      'https://beispiel-dachdeckerei.de',
    locality:         'Hamburg',
    primary_category: null,        // fehlt bewusst
  },
});

const FAKTOR_TEXTE = {
  responseRate: { label: 'Antwortquote',    hinweis: 'Wie viele Bewertungen beantwortet sind' },
  rating:       { label: 'Bewertung',       hinweis: 'Der Durchschnitt aus allen Rezensionen' },
  recency:      { label: 'Aktualität',     hinweis: 'Wie lange die letzte Bewertung zurückliegt' },
  completeness: { label: 'Profilangaben',   hinweis: 'Telefon, Website, Adresse, Kategorie' },
  photos:       { label: 'Fotos',           hinweis: 'Bilder im Unternehmensprofil' },
};

/* ─────────────────────────────────────────────
   ABGELEITETE AUFGABEN

   Dieselbe Logik, nach der die Engine im Dashboard priorisiert:
   der schwaechste Faktor zuerst, gemessen am Anteil der erreichten
   Punkte. Hier nur dargestellt, nicht neu berechnet — die echte
   Priorisierung laeuft serverseitig.
───────────────────────────────────────────── */
const AUFGABEN_TEXTE = {
  responseRate: {
    titel:  'Offene Bewertungen beantworten',
    grund:  'Wer dein Profil öffnet, sieht unbeantwortete Bewertungen sofort — und liest sie anders als beantwortete.',
    nutzen: 'WERKRUF legt zu jeder einen Antwortvorschlag bereit. Veröffentlicht wird nur, was du freigibst.',
  },
  completeness: {
    titel:  'Fehlende Profilangaben ergänzen',
    grund:  'Google spielt unvollständige Profile seltener aus, und wer sie öffnet, findet nicht, was er sucht.',
    nutzen: 'WERKRUF zeigt, welche Angabe fehlt, und überträgt sie nach deiner Freigabe ins Profil.',
  },
  photos: {
    titel:  'Fotos hinzufügen',
    grund:  'Profile ohne Bilder werden seltener angeklickt.',
    nutzen: 'WERKRUF meldet sich, wenn zu wenige hinterlegt sind.',
  },
  rating: {
    titel:  'Bewertungen verbessern',
    grund:  'Der Durchschnitt ist das Erste, was in der Suche auffällt.',
    nutzen: 'WERKRUF zeigt, welche Kritik sich wiederholt.',
  },
  recency: {
    titel:  'Um neue Bewertungen bitten',
    grund:  'Ein Profil ohne frische Bewertungen wirkt auf Suchende älter, als es ist.',
    nutzen: 'Bewertungslink und QR-Code liegen im Dashboard bereit.',
  },
};

/** Schwaechste Faktoren zuerst — nach Anteil der erreichten Punkte. */
export function beispielAufgaben(punkte, anzahl = 3) {
  return Object.entries(punkte)
    .map(([key, erreicht]) => ({
      key,
      erreicht,
      moeglich: HEALTH_WEIGHTS[key],
      anteil:   HEALTH_WEIGHTS[key] ? erreicht / HEALTH_WEIGHTS[key] : 1,
    }))
    .filter((f) => f.anteil < 1)
    .sort((a, b) => a.anteil - b.anteil)
    .slice(0, anzahl);
}

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Section = styled.section`
  background: #f4f5f7;
  padding: 80px 24px;
`;
const Inner = styled.div`max-width: 1050px; margin: 0 auto;`;

const Eyebrow = styled.p`
  font-size: .78rem; font-weight: 800; letter-spacing: 2px;
  text-transform: uppercase; color: var(--color-accent); margin: 0 0 10px;
`;
const H2 = styled.h2`
  font-size: clamp(1.7rem, 3.4vw, 2.5rem); color: var(--color-primary);
  margin: 0 0 14px; line-height: 1.2;
`;
/* Auf dem Telefon rutscht die Einleitung in den Hintergrund: Der
   Score und die Aufgaben sind die Geschichte, die Erklaerung ist der
   Rahmen. Sie bleibt stehen — sie sagt, dass die Zahlen erfunden
   sind — aber sie nimmt weniger Hoehe und weniger Aufmerksamkeit. */
const Lead = styled.p`
  color: #5f6875; line-height: 1.7; max-width: 640px; margin: 0 0 34px;
  @media (max-width: 760px) {
    font-size: .88rem; line-height: 1.6; margin-bottom: 22px;
  }
`;

const Grid = styled.div`
  display: grid; grid-template-columns: 340px 1fr; gap: 32px;
  @media (max-width: 880px) { grid-template-columns: 1fr; }
`;

const Card = styled.div`
  background: #fff; border-radius: var(--radius-card);
  border-top: 5px solid var(--color-accent); padding: 26px;
`;

/* Die Kennzeichnung. Steht ueber der Zahl und ist nicht zu uebersehen. */
const BeispielBanner = styled.div`
  display: flex; align-items: center; gap: 8px;
  background: #fff4e0; border: 1px solid #f0c987; border-radius: 6px;
  padding: 9px 12px; margin-bottom: 18px;
  font-size: .78rem; font-weight: 700; color: #7a5200;
`;

const Betrieb = styled.p`
  font-size: .82rem; color: #66717e; margin: 0 0 4px;
`;
/* Der Score ist auf dem Telefon das Erste, was haengenbleiben soll.
   Deshalb wird er dort GROESSER statt kleiner — entgegen dem Reflex,
   auf kleinen Bildschirmen alles zu verkleinern. Die uebrigen
   Elemente der Karte geben die Hoehe dafuer her. */
const ScoreZahl = styled.div`
  font-size: 3.4rem; font-weight: 900; color: var(--color-primary);
  line-height: 1; margin: 0 0 4px;
  span { font-size: 1.2rem; color: #8a9199; font-weight: 700; }
  @media (max-width: 760px) {
    font-size: 4.2rem;
    span { font-size: 1.3rem; }
  }
`;

/* Sagt in drei Worten, was die Zahl ist. Ohne diese Zeile steht auf
   dem Telefon eine grosse Zahl ohne Begriff — und der Begriff ist
   der, den das ganze Produkt benutzt: WERKRUF Score. */
const ScoreLabel = styled.p`
  font-size: .72rem; font-weight: 800; letter-spacing: .12em;
  text-transform: uppercase; color: var(--color-accent);
  margin: 0 0 2px;
`;

/* Sekundaerdetail: Die Aufschluesselung belegt den Score, sie
   erzaehlt ihn nicht. Auf dem Telefon kompakter, damit die Aufgaben
   darunter frueher sichtbar werden. */
const FaktorZeile = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 10px; padding: 9px 0; border-top: 1px solid #e8e9ec;
  &:first-of-type { border-top: 0; }
  @media (max-width: 760px) { padding: 6px 0; }
`;
const FaktorName = styled.span`
  font-size: .84rem; color: var(--color-primary); font-weight: 600;
  small { display: block; font-weight: 400; color: #8a9199; font-size: .72rem; margin-top: 2px; }
  /* Der erklaerende Halbsatz je Faktor entfaellt auf dem Telefon.
     Er beschreibt, was der Faktor misst — auf einer Breite, auf der
     fuenf solche Halbsaetze die Aufgabenliste aus dem Bild schieben. */
  @media (max-width: 760px) {
    font-size: .8rem;
    small { display: none; }
  }
`;
const FaktorPunkte = styled.span`
  font-size: .84rem; font-weight: 800; white-space: nowrap;
  color: ${p => p.$voll ? '#1e7e34' : '#a66a00'};
`;

/* Auf dem Telefon steht dieser Titel direkt unter der Score-Karte und
   traegt den entscheidenden Satz der Sektion: Aus der Zahl werden
   Aufgaben. Deshalb dort groesser und mit einer Trennlinie darueber —
   gestapelt sah es vorher aus wie eine Fortsetzung der Karte. */
const AufgabenTitel = styled.h3`
  font-size: 1.05rem; color: var(--color-primary); margin: 0 0 4px;
  @media (max-width: 880px) {
    font-size: 1.2rem; margin-top: 26px; padding-top: 22px;
    border-top: 3px solid var(--color-primary);
  }
`;
const AufgabenLead = styled.p`
  font-size: .85rem; color: #66717e; margin: 0 0 18px; line-height: 1.6;
`;
const Aufgabe = styled.div`
  background: #fff; border-radius: var(--radius-card);
  border-left: 4px solid var(--color-accent);
  padding: 16px 18px; margin-bottom: 12px;
`;
const AufgabeKopf = styled.div`
  display: flex; align-items: center; gap: 9px; margin-bottom: 6px;
`;
const Rang = styled.span`
  background: var(--color-accent); color: #fff; font-size: .72rem;
  font-weight: 800; border-radius: 4px; padding: 2px 7px;
`;
const AufgabeTitel = styled.span`
  font-weight: 700; color: var(--color-primary); font-size: .95rem;
`;
const AufgabeText = styled.p`
  font-size: .84rem; color: #5f6875; line-height: 1.6; margin: 0;
  + p { margin-top: 6px; color: #66717e; }
`;

const Nutzen = styled.ul`
  list-style: none; padding: 0; margin: 26px 0 0;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 26px;
  @media (max-width: 680px) { grid-template-columns: 1fr; }
`;
const NutzenPunkt = styled.li`
  display: flex; gap: 9px; align-items: flex-start;
  font-size: .86rem; color: #5f6875; line-height: 1.55;
  svg { flex-shrink: 0; margin-top: 3px; color: var(--color-accent); }
`;

const Fussnote = styled.p`
  font-size: .76rem; color: #8a9199; line-height: 1.6; margin: 28px 0 0;
`;

export default function ExampleScore() {
  /* Kanonische Berechnung — keine zweite Formel. */
  const ergebnis = calculateHealthScoreInputs({
    stats:    BEISPIEL_BETRIEB.stats,
    location: BEISPIEL_BETRIEB.location,
  });

  const aufgaben = beispielAufgaben(ergebnis.points);

  /* Anker heisst seit dem 16.10.2026 "so-gehts" — genau wie der
     Menuepunkt im Kopf. Ein Anker, der anders heisst als der Link
     darauf, faellt erst auf, wenn jemand klickt. */
  return (
    <Section id="so-gehts">
      <Inner>
        <Eyebrow>So funktioniert WERKRUF</Eyebrow>
        <H2>Dein Google-Unternehmensprofil auf einen Blick</H2>
        <Lead>
          WERKRUF prüft laufend, was an deinem Profil Aufmerksamkeit braucht, und
          sortiert die Aufgaben nach Wichtigkeit. Hier siehst du an einem
          erfundenen Betrieb, wie das aussieht.
        </Lead>

        <Grid>
          <Card>
            <BeispielBanner>
              <AlertCircle size={15} />
              Beispiel mit erfundenen Daten
            </BeispielBanner>

            <Betrieb>{BEISPIEL_BETRIEB.name}</Betrieb>
            <ScoreLabel>WERKRUF Score</ScoreLabel>
            <ScoreZahl>{ergebnis.score}<span> / 100</span></ScoreZahl>

            <div style={{ marginTop: 18 }}>
              {Object.entries(ergebnis.points).map(([key, punkte]) => (
                <FaktorZeile key={key}>
                  <FaktorName>
                    {FAKTOR_TEXTE[key].label}
                    <small>{FAKTOR_TEXTE[key].hinweis}</small>
                  </FaktorName>
                  <FaktorPunkte $voll={punkte >= HEALTH_WEIGHTS[key]}>
                    {punkte} / {HEALTH_WEIGHTS[key]}
                  </FaktorPunkte>
                </FaktorZeile>
              ))}
            </div>
          </Card>

          <div>
            <AufgabenTitel>Daraus werden Aufgaben — in dieser Reihenfolge</AufgabenTitel>
            <AufgabenLead>
              Was am wenigsten Punkte bringt, steht oben. So weißt du, womit du
              anfängst, statt eine Liste abzuarbeiten.
            </AufgabenLead>

            {aufgaben.map((faktor, i) => (
              <Aufgabe key={faktor.key}>
                <AufgabeKopf>
                  <Rang>{i + 1}</Rang>
                  <AufgabeTitel>{AUFGABEN_TEXTE[faktor.key].titel}</AufgabeTitel>
                </AufgabeKopf>
                <AufgabeText>{AUFGABEN_TEXTE[faktor.key].grund}</AufgabeText>
                <AufgabeText>{AUFGABEN_TEXTE[faktor.key].nutzen}</AufgabeText>
              </Aufgabe>
            ))}

            <Nutzen>
              <NutzenPunkt><ArrowRight size={15} />Montags eine Zusammenfassung per E-Mail</NutzenPunkt>
              <NutzenPunkt><ArrowRight size={15} />Bei ein- und zwei-Sterne-Bewertungen sofort Bescheid</NutzenPunkt>
              <NutzenPunkt><ArrowRight size={15} />Antwortvorschläge, die du nur freigibst</NutzenPunkt>
              <NutzenPunkt><ArrowRight size={15} />Kein tägliches Nachsehen im Dashboard nötig</NutzenPunkt>
            </Nutzen>
          </div>
        </Grid>

        <Fussnote>
          <Info size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Die Zahlen oben stammen aus einem erfundenen Betrieb. Dein eigener Wert
          entsteht erst, wenn du dein Unternehmensprofil verbindest — dann rechnet
          WERKRUF mit deinen echten Google-Daten. Der Wert beschreibt die
          Vollständigkeit und Pflege deines Profils. Er ist kein Google-Ranking und
          keine Messung deiner Auffindbarkeit.
        </Fussnote>
      </Inner>
    </Section>
  );
}
