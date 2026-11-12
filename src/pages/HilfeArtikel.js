/*
 * Hilfe-Detailseite (/hilfe/:slug). Inhalte: src/config/hilfe.js.
 * Unbekannter Slug → die normale 404-Seite.
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { artikel, setzeWerte, HILFE_GRUPPEN } from '../config/hilfe';
import { useSeitenMeta } from '../hooks/useSeitenMeta';
import NotFound from './NotFound';
import {
  Rahmen, Inhalt, Badge, Titel, Einleitung, Abschnitt, H2, H3, Text, Kasten,
  Fliesstext, HilfeNavigation, HilfeCta, useHilfeWerte,
} from '../components/hilfe/HilfeBausteine';

export const seitenTitel = (a) => `${a.seoTitel} | WERKRUF Hilfe`;

function Seite({ a }) {
  const werte = useHilfeWerte();
  useSeitenMeta({
    titel: seitenTitel(a),
    beschreibung: setzeWerte(a.beschreibung, werte),
    pfad: `/hilfe/${a.slug}`,
  });
  const gruppe = HILFE_GRUPPEN.find((g) => g.key === a.gruppe);

  return (
    <Rahmen>
      <HilfeNavigation aktuell={a.titel} />
      <Inhalt>
        <Badge>{gruppe?.titel ?? 'Hilfe'}</Badge>
        <Titel>{a.titel}</Titel>
        <Einleitung><Fliesstext text={a.einleitung} werte={werte} /></Einleitung>

        {a.abschnitte.map((ab) => (
          <Abschnitt key={ab.titel}>
            <H2>{ab.titel}</H2>
            <Text>
              {ab.schritte && (
                <ol>{ab.schritte.map((t) => <li key={t}><Fliesstext text={t} werte={werte} /></li>)}</ol>
              )}
              {ab.liste && (
                <ul>{ab.liste.map((t) => <li key={t}><Fliesstext text={t} werte={werte} /></li>)}</ul>
              )}
              {(ab.absaetze ?? []).map((t) => <p key={t}><Fliesstext text={t} werte={werte} /></p>)}
            </Text>
          </Abschnitt>
        ))}

        {a.macht && (
          <Kasten>
            <H3>Was WERKRUF macht</H3>
            <Text><ul>{a.macht.map((t) => <li key={t}><Fliesstext text={t} werte={werte} /></li>)}</ul></Text>
          </Kasten>
        )}
        {a.machtNicht && (
          <Kasten $ton="nicht">
            <H3>Was WERKRUF nicht macht</H3>
            <Text><ul>{a.machtNicht.map((t) => <li key={t}><Fliesstext text={t} werte={werte} /></li>)}</ul></Text>
          </Kasten>
        )}

        {a.rechtlich && (
          <Abschnitt>
            <Text>
              <p>
                Verbindlich sind die <Link to="/datenschutz">Datenschutzerklärung</Link> und
                das <Link to="/impressum">Impressum</Link>. Diese Seite ist eine Zusammenfassung
                und keine Rechtsberatung.
              </p>
            </Text>
          </Abschnitt>
        )}

        {a.verwandt?.length > 0 && (
          <Abschnitt>
            <H2>Weiterlesen</H2>
            <Text>
              <ul>
                {a.verwandt.map((slug) => {
                  const v = artikel(slug);
                  return v ? <li key={slug}><Link to={`/hilfe/${slug}`}>{v.titel}</Link></li> : null;
                })}
                <li><Link to="/hilfe">Alle Hilfethemen</Link></li>
              </ul>
            </Text>
          </Abschnitt>
        )}

        {a.cta && <HilfeCta />}
      </Inhalt>
    </Rahmen>
  );
}

/* Layout kommt aus App.js (Header + Footer). Die 404-Seite bringt ihre
   eigene Vollbild-Optik mit und wird deshalb ohne Layout gezeigt —
   genau wie auf der Catch-all-Route. */
export default function HilfeArtikel({ Layout = React.Fragment }) {
  const { slug } = useParams();
  const a = artikel(slug);
  if (!a) return <NotFound />;
  return <Layout><Seite a={a} /></Layout>;
}
