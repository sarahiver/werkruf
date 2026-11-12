/*
 * Bausteine für Hilfe-Center und Changelog: Rahmen, Navigation,
 * Fließtext mit internen Links, CTA. Optik aus den bestehenden
 * Rechts-/Hilfeseiten (CSS-Variablen der Branche), keine neue Gestaltung.
 */
import React from 'react';
import styled from 'styled-components';
import { Link, NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useIndustry } from '../../context/IndustryContext';
import { useAuthContext } from '../../context/AuthContext';
import { HILFE_GRUPPEN, HILFE_ARTIKEL, setzeWerte } from '../../config/hilfe';
import { TARIFE, JAHRES_ERSPARNIS_CENTS } from '../../utils/tarife';

const euro = (cents) => `${(cents / 100).toLocaleString('de-DE')} €`;

/** Werte für {platzhalter} — Preise aus tarife.js, Testphase aus der Branche. */
export function useHilfeWerte() {
  const { pricing } = useIndustry();
  return {
    preisMonat: euro(TARIFE.monthly.betragCents),
    preisJahr: euro(TARIFE.yearly.betragCents),
    ersparnis: euro(JAHRES_ERSPARNIS_CENTS),
    trialTage: pricing.trialDays,
  };
}

/* ── Rahmen ─────────────────────────────────────────────────────── */
export const Rahmen = styled.div`
  max-width: 1080px; margin: 0 auto;
  padding: 104px 24px 112px;
  display: grid; gap: 48px;
  grid-template-columns: 220px minmax(0, 1fr);
  @media (max-width: 899px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px; padding: 92px 16px 88px;
  }
`;

export const Inhalt = styled.article`max-width: 720px; min-width: 0;`;

export const Badge = styled.div`
  display: inline-block;
  background: rgba(var(--color-accent-rgb), .1);
  border: 1px solid rgba(var(--color-accent-rgb), .25);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .7rem; letter-spacing: .12em; text-transform: uppercase;
  padding: 4px 10px; border-radius: var(--radius-button);
  margin-bottom: 14px;
`;

export const Titel = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: clamp(1.7rem, 4vw, 2.4rem); line-height: 1.15;
  text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 12px;
`;

export const Einleitung = styled.p`
  font-family: var(--font-body); font-size: 1.02rem;
  color: var(--color-text-muted); line-height: 1.7;
  margin-bottom: 32px; padding-bottom: 20px;
  border-bottom: 2px solid var(--color-border);
`;

export const Abschnitt = styled.section`margin-bottom: 30px;`;

export const H2 = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.12rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 12px;
`;

export const H3 = styled.h3`
  font-family: var(--font-body); font-weight: 700; font-size: .95rem;
  color: var(--color-primary); margin-bottom: 6px;
`;

export const Text = styled.div`
  font-family: var(--font-body); font-size: .95rem;
  color: var(--color-text); line-height: 1.7;
  p { margin-bottom: 10px; }
  ul, ol { padding-left: 1.3em; margin-bottom: 10px; }
  li { margin-bottom: 6px; padding-left: 2px; }
  a { color: var(--color-accent); text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
`;

export const Kasten = styled.div`
  border: 1px solid var(--color-border);
  border-left: 3px solid ${(p) => (p.$ton === 'nicht' ? 'var(--color-text-muted)' : 'var(--color-accent)')};
  border-radius: var(--radius-card, 8px);
  padding: 16px 20px; margin-bottom: 16px;
  background: var(--color-surface, #fff);
`;

/* ── Fließtext: [Text](/pfad) → interner Link ───────────────────── */
const LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

export function Fliesstext({ text, werte }) {
  const roh = setzeWerte(text, werte);
  const teile = [];
  let letzte = 0;
  let m;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(roh))) {
    if (m.index > letzte) teile.push(roh.slice(letzte, m.index));
    teile.push(<Link key={m.index} to={m[2]}>{m[1]}</Link>);
    letzte = m.index + m[0].length;
  }
  if (letzte < roh.length) teile.push(roh.slice(letzte));
  return <>{teile}</>;
}

/* ── Navigation ─────────────────────────────────────────────────── */
const NavDesktop = styled.nav`
  position: sticky; top: 96px; align-self: start;
  @media (max-width: 899px) { display: none; }
`;

const NavGruppe = styled.div`
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--color-text-muted); margin: 18px 0 6px;
`;

const NavPunkt = styled(NavLink)`
  display: block;
  font-family: var(--font-body); font-size: .86rem; line-height: 1.35;
  color: var(--color-text); text-decoration: none;
  padding: 6px 10px; margin-left: -10px;
  border-left: 2px solid transparent;
  border-radius: 0 var(--radius-button) var(--radius-button) 0;
  &:hover { color: var(--color-accent); }
  &.active {
    color: var(--color-primary); font-weight: 700;
    border-left-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), .08);
  }
`;

const NavMobil = styled.details`
  display: none;
  @media (max-width: 899px) { display: block; }
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  background: var(--color-surface, #fff);
  summary {
    list-style: none; cursor: pointer;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 14px;
    font-family: var(--font-body); font-size: .9rem; font-weight: 700;
    color: var(--color-primary);
  }
  summary::-webkit-details-marker { display: none; }
  &[open] summary svg { transform: rotate(180deg); }
  > div { padding: 0 14px 12px 24px; }
`;

function NavListe() {
  return (
    <>
      <NavPunkt to="/hilfe" end>Übersicht</NavPunkt>
      {HILFE_GRUPPEN.map((g) => (
        <div key={g.key}>
          <NavGruppe>{g.titel}</NavGruppe>
          {HILFE_ARTIKEL.filter((a) => a.gruppe === g.key).map((a) => (
            <NavPunkt key={a.slug} to={`/hilfe/${a.slug}`}>{a.titel}</NavPunkt>
          ))}
        </div>
      ))}
      <NavGruppe>Produkt</NavGruppe>
      <NavPunkt to="/changelog">Changelog</NavPunkt>
    </>
  );
}

export function HilfeNavigation({ aktuell }) {
  return (
    <>
      <NavDesktop aria-label="Hilfethemen"><NavListe /></NavDesktop>
      {/* key: beim Seitenwechsel wieder zugeklappt */}
      <NavMobil key={aktuell}>
        <summary>
          <span>Hilfethemen{aktuell ? ` · ${aktuell}` : ''}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <nav aria-label="Hilfethemen (mobil)"><div><NavListe /></div></nav>
      </NavMobil>
    </>
  );
}

/* ── Abschluss: CTA ─────────────────────────────────────────────── */
const CtaBox = styled.div`
  margin-top: 40px; padding: 22px 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  background: rgba(var(--color-accent-rgb), .06);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px;
  font-family: var(--font-body); font-size: .95rem; color: var(--color-text);
`;

const CtaLink = styled(Link)`
  display: inline-block;
  background: var(--color-accent); color: #fff;
  font-family: var(--font-body); font-weight: 700; font-size: .9rem;
  padding: 11px 20px; border-radius: var(--radius-button);
  text-decoration: none;
  &:hover { filter: brightness(1.05); }
`;

export function HilfeCta() {
  const { isAuthenticated } = useAuthContext();
  const { trialTage } = useHilfeWerte();
  if (isAuthenticated) {
    return (
      <CtaBox>
        <span>Direkt ausprobieren?</span>
        <CtaLink to="/dashboard">Zum Dashboard</CtaLink>
      </CtaBox>
    );
  }
  return (
    <CtaBox>
      <span>{trialTage} Tage kostenlos testen. Danach monatlich kündbar.</span>
      <CtaLink to="/signup">Kostenlos testen</CtaLink>
    </CtaBox>
  );
}
