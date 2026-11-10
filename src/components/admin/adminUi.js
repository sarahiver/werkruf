import React from 'react';
import styled from 'styled-components';

/* ─────────────────────────────────────────────────────────────────
   Gemeinsame Admin-Bausteine (WP16.1).

   Vier Ebenen statt lauter gleich gewichteter Kaesten:
     1  Bereichskopf   Titel + Untertitel + Aktionen
     2  KPI            kompakte Zahlen, Erklaerung im title
     3  Arbeitsflaeche eine weisse Flaeche je Aufgabe
     4  Detail         ruhig, ohne eigene Rahmen
   Marke bleibt: Dunkelblau, Orange, graue Arbeitsflaeche.
───────────────────────────────────────────────────────────────── */

const KopfZeile = styled.header`
  display: flex; align-items: flex-end; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap;
  margin: 0 0 18px;
`;
const Titel = styled.h1`
  font-family: var(--font-display); font-weight: 800; font-size: 1.55rem; line-height: 1.2;
  color: var(--color-primary); margin: 0;
`;
const Untertitel = styled.p`
  font-family: var(--font-body); font-size: .86rem; color: var(--color-text-muted); margin: 4px 0 0;
`;
const Aktionen = styled.div`display: flex; gap: 8px; flex-wrap: wrap;`;

export function BereichKopf({ titel, untertitel = null, children = null, testid = undefined }) {
  return (
    <KopfZeile data-testid={testid}>
      <div style={{ minWidth: 0 }}>
        <Titel>{titel}</Titel>
        {untertitel && <Untertitel>{untertitel}</Untertitel>}
      </div>
      {children && <Aktionen>{children}</Aktionen>}
    </KopfZeile>
  );
}

export const KpiReihe = styled.div`
  display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  margin: 0 0 20px;
`;
const KpiKarte = styled.div`
  background: var(--color-white); border-radius: 10px; padding: 12px 14px;
  box-shadow: 0 1px 0 rgba(11, 37, 69, .06), 0 0 0 1px rgba(11, 37, 69, .06);
  border-top: 3px solid ${({ $ton }) => ({ warn: '#D93025', gut: '#1E7E34', akzent: 'var(--color-accent)' }[$ton] || 'transparent')};
`;
const KpiWert = styled.p`
  font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; line-height: 1.1; margin: 0;
  color: ${({ $ton }) => ($ton === 'warn' ? '#B42318' : 'var(--color-primary)')};
`;
const KpiLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem; letter-spacing: .02em; color: var(--color-text-muted); margin: 3px 0 0;
`;

export function Kpi({ wert, label, titel = undefined, ton = null, testid = undefined }) {
  return (
    <KpiKarte $ton={ton} title={titel} data-testid={testid}>
      <KpiWert $ton={ton}>{wert ?? '—'}</KpiWert>
      <KpiLabel>{label}</KpiLabel>
    </KpiKarte>
  );
}

/* Ebene 3 — Arbeitsflaeche */
export const Flaeche = styled.section`
  background: var(--color-white); border-radius: 12px; margin: 0 0 18px;
  box-shadow: 0 0 0 1px rgba(11, 37, 69, .07);
`;
export const FlaecheKopf = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 14px 18px; border-bottom: 1px solid rgba(11, 37, 69, .07);
  h2 { font-family: var(--font-body); font-weight: 700; font-size: .95rem; color: var(--color-primary); margin: 0; }
`;

/* Knoepfe — eine Familie */
export const Knopf = styled.button`
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; cursor: pointer;
  font-family: var(--font-body); font-weight: 700; font-size: .8rem; line-height: 1.2;
  border-radius: var(--radius-button); border: 1px solid var(--color-primary);
  background: var(--color-primary); color: var(--color-white); white-space: nowrap;
  &.akzent { background: var(--color-accent); border-color: var(--color-accent); }
  &.ghost { background: var(--color-white); color: var(--color-text); border-color: var(--color-border); font-weight: 600; }
  &.warn { background: #B42318; border-color: #B42318; }
  &:disabled { opacity: .55; cursor: default; }
  &:focus-visible { outline: 3px solid rgba(242, 140, 40, .55); outline-offset: 2px; }
`;

/* Status-Chips — eine Familie */
const CHIP = {
  neutral: ['#F1F3F5', '#3B4652'], info: ['#E8F0FA', '#0B2545'], gut: ['#E3F5E8', '#1E6B34'],
  warn: ['#FFF4D6', '#7A5A00'], schlecht: ['#FDECEC', '#B42318'],
};
export const Chip = styled.span`
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
  font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  background: ${({ $ton }) => (CHIP[$ton] || CHIP.neutral)[0]};
  color: ${({ $ton }) => (CHIP[$ton] || CHIP.neutral)[1]};
`;

export const Leer = styled.div`
  padding: 22px 18px; font-family: var(--font-body); font-size: .86rem; color: var(--color-text-muted);
`;

/* Tabelle, die auf schmalen Bildschirmen zu Karten wird (kein Abschneiden):
   jede <td> traegt data-label, das unter 900px als Beschriftung erscheint
   (gleiche Grenze wie die Akquise-Liste; bei 768 px passten sechs Spalten nicht). */
export const ResponsiveTabelle = styled.table`
  width: 100%; border-collapse: collapse;
  th { padding: 10px 14px; text-align: left; font-family: var(--font-body); font-size: .7rem; font-weight: 700;
       text-transform: uppercase; letter-spacing: .07em; color: var(--color-text-muted); border-bottom: 1px solid rgba(11,37,69,.08); }
  td { padding: 11px 14px; font-family: var(--font-body); font-size: .84rem; color: var(--color-text);
       border-bottom: 1px solid rgba(11,37,69,.06); vertical-align: top; }
  tbody tr:hover td { background: rgba(11, 37, 69, .02); }
  @media (max-width: 899px) {
    thead { display: none; }
    tr { display: block; padding: 10px 14px; border-bottom: 1px solid rgba(11,37,69,.08); }
    td { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border: 0; text-align: right; }
    td::before { content: attr(data-label); font-size: .72rem; color: var(--color-text-muted); text-align: left; flex: 0 0 auto; }
    td[data-label=''] { justify-content: flex-start; }
    td[data-label='']::before { content: none; }
  }
`;
