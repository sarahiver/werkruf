/*
 * Changelog (/changelog). Einträge: src/config/changelog.js.
 */
import React from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { CHANGELOG, CHANGELOG_KATEGORIEN } from '../config/changelog';
import { artikel } from '../config/hilfe';
import { useSeitenMeta } from '../hooks/useSeitenMeta';
import {
  Rahmen, Inhalt, Badge, Titel, Einleitung, Abschnitt, H2, H3, Text, HilfeNavigation,
} from '../components/hilfe/HilfeBausteine';

export const CHANGELOG_META = Object.freeze({
  titel: 'Changelog: Neu und verbessert bei WERKRUF',
  beschreibung: 'Was sich an WERKRUF geändert hat: neue Funktionen, Verbesserungen und behobene Fehler — kurz und nach Monat sortiert.',
});

const Eintrag = styled.li`
  list-style: none;
  padding: 16px 0; border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: 0; }
`;

const Marke = styled.span`
  display: inline-block; margin-bottom: 6px;
  font-family: var(--font-body); font-weight: 700;
  font-size: .66rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 8px; border-radius: var(--radius-button);
  color: ${(p) => (p.$k === 'neu' ? 'var(--color-accent)' : 'var(--color-primary)')};
  background: ${(p) => (p.$k === 'neu' ? 'rgba(var(--color-accent-rgb), .1)' : 'rgba(0,0,0,.05)')};
`;

const Liste = styled.ul`padding: 0; margin: 0;`;

export default function Changelog() {
  useSeitenMeta({ ...CHANGELOG_META, pfad: '/changelog' });
  return (
    <Rahmen>
      <HilfeNavigation aktuell="Changelog" />
      <Inhalt>
        <Badge>Produkt</Badge>
        <Titel>Changelog</Titel>
        <Einleitung>Was sich an WERKRUF geändert hat — das Neueste oben.</Einleitung>
        {CHANGELOG.map((m) => (
          <Abschnitt key={m.monat}>
            <H2>{m.monat}</H2>
            <Liste>
              {m.eintraege.map((e) => {
                const hilfe = e.hilfe ? artikel(e.hilfe) : null;
                return (
                  <Eintrag key={e.titel}>
                    <Marke $k={e.kategorie}>{CHANGELOG_KATEGORIEN[e.kategorie]}</Marke>
                    <H3>{e.titel}</H3>
                    <Text>
                      <p>
                        {e.text}
                        {hilfe && <> <Link to={`/hilfe/${hilfe.slug}`}>Mehr dazu</Link></>}
                      </p>
                    </Text>
                  </Eintrag>
                );
              })}
            </Liste>
          </Abschnitt>
        ))}
      </Inhalt>
    </Rahmen>
  );
}
