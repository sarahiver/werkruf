import React from 'react';
import styled, { keyframes, css } from 'styled-components';
import { AlertTriangle, Inbox, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

/* ─────────────────────────────────────────────
   GB-UI

   Geteilte Bausteine für die Google-Business-Seiten. Liegen bewusst
   in einer Datei: es sind Primitive, keine Features, und verteilt auf
   zehn Dateien würde man sie beim Ändern nicht mehr finden.

   Alles nutzt ausschliesslich die CSS-Variablen aus dem ThemeInjector
   und funktioniert damit unverändert unter WERKRUF, GASTRORUF und
   BEAUTYRUF.
───────────────────────────────────────────── */

export const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
export const spin   = keyframes`to{transform:rotate(360deg)}`;
const shimmer       = keyframes`0%{background-position:-380px 0}100%{background-position:380px 0}`;

/* ── Seitengerüst ── */

export const Page = styled.div`animation: ${fadeUp} .4s ease both;`;

export const PageTitle = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.5rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

export const PageSub = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text-muted); margin-bottom: 24px; line-height: 1.6;
`;

export const SectionTitle = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin: 26px 0 12px;
  display: flex; align-items: center; gap: 8px;
`;

export const Card = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 18px;
`;

/* ── Kennzahlen ──
   auto-fit statt fester Spaltenzahl: die Kacheln ordnen sich auf dem
   Handy von selbst um, ohne Media Query. ── */

export const StatsRow = styled.div`
  display: grid; gap: 12px; margin-bottom: 8px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
`;

const StatBox = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-left: 3px solid ${({ $accent }) => $accent || 'var(--color-accent)'};
  border-radius: var(--radius-card);
  padding: 16px 18px;
`;

const StatNum = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.6rem; color: var(--color-primary); line-height: 1.1;
  display: flex; align-items: baseline; gap: 4px;
`;

const StatUnit = styled.span`font-size: .9rem; color: var(--color-text-muted);`;

const StatLabel = styled.p`
  font-family: var(--font-body); font-size: .74rem;
  color: var(--color-text-muted); text-transform: uppercase;
  letter-spacing: .08em; margin-top: 4px;
`;

const StatHint = styled.p`
  font-family: var(--font-body); font-size: .76rem;
  color: var(--color-text-muted); margin-top: 6px; line-height: 1.4;
`;

export function StatCard({ value, unit, label, hint, accent, loading }) {
  if (loading) return <SkeletonBlock $h={92} />;
  return (
    <StatBox $accent={accent}>
      <StatNum>{value}{unit && <StatUnit>{unit}</StatUnit>}</StatNum>
      <StatLabel>{label}</StatLabel>
      {hint && <StatHint>{hint}</StatHint>}
    </StatBox>
  );
}

/* ── Ladezustände ──
   Skelette statt Spinner: die Seite springt beim Eintreffen der Daten
   nicht, weil der Platz schon reserviert ist. ── */

export const SkeletonBlock = styled.div`
  height: ${({ $h }) => $h || 60}px;
  border-radius: var(--radius-card);
  background: linear-gradient(90deg,
    var(--color-bg) 0%, rgba(0,0,0,.04) 50%, var(--color-bg) 100%);
  background-size: 760px 100%;
  animation: ${shimmer} 1.3s linear infinite;
`;

export const SkeletonList = ({ count = 3, height = 96 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {Array.from({ length: count }, (_, i) => <SkeletonBlock key={i} $h={height} />)}
  </div>
);

export const Spinner = styled(RefreshCw)`animation: ${spin} .9s linear infinite;`;

/* ── Fehler- und Leerzustände ── */

const StateBox = styled.div`
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 10px; padding: 34px 24px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-white);
`;

const StateTitle = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .95rem; text-transform: var(--text-transform);
  color: var(--color-primary);
`;

const StateText = styled.p`
  font-family: var(--font-body); font-size: .84rem;
  color: var(--color-text-muted); line-height: 1.6; max-width: 420px;
`;

export const GhostBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px; background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border); border-radius: var(--radius-button);
  font-family: var(--font-body); font-size: .8rem; cursor: pointer;
  transition: border-color .2s, color .2s;
  &:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
  &:disabled { opacity: .5; cursor: not-allowed; }
`;

export const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px; background: var(--color-accent); color: #fff;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .82rem; letter-spacing: .05em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover:not(:disabled) { filter: brightness(.9); }
  &:disabled { opacity: .55; cursor: not-allowed; }
`;

/**
 * Fehleranzeige mit Wiederholmöglichkeit.
 *
 * Zeigt bewusst nur die aufbereitete Meldung, nie den rohen Fehler —
 * Postgres- und Google-Texte gehören ins Log, nicht ins Dashboard.
 */
export function ErrorState({ message, onRetry, busy }) {
  return (
    <StateBox>
      <AlertTriangle size={22} color="#D93025" />
      <StateTitle>Das hat nicht geklappt</StateTitle>
      <StateText>{message || 'Die Daten konnten nicht geladen werden.'}</StateText>
      {onRetry && (
        <GhostBtn onClick={onRetry} disabled={busy}>
          {busy ? <Spinner size={14} /> : <RefreshCw size={14} />} Erneut versuchen
        </GhostBtn>
      )}
    </StateBox>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <StateBox>
      <Inbox size={22} color="var(--color-text-muted)" />
      <StateTitle>{title}</StateTitle>
      {text && <StateText>{text}</StateText>}
      {action}
    </StateBox>
  );
}

/* ── Sterne ── */

const StarRow = styled.div`display: inline-flex; gap: 1px; line-height: 1;`;

const Star = styled.span`
  font-size: ${({ $size }) => $size || 14}px;
  color: ${({ $filled }) => ($filled ? '#F5A623' : 'var(--color-border)')};
`;

export function StarRating({ value, size }) {
  return (
    <StarRow aria-label={`${value} von 5 Sternen`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} $filled={s <= value} $size={size}>★</Star>
      ))}
    </StarRow>
  );
}

/** Farbcode nach Bewertung — durchgängig auf allen Seiten. */
export const ratingColor = (rating) =>
  rating >= 4 ? '#1E7E34' : rating === 3 ? '#D48A00' : '#D93025';

/* ── Etiketten ── */

export const Badge = styled.span`
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-body); font-size: .7rem; font-weight: 700;
  letter-spacing: .05em; text-transform: uppercase;
  padding: 3px 9px; border-radius: var(--radius-button);
  ${({ $variant }) => {
    switch ($variant) {
      case 'success': return css`background:#E8F5E9;color:#1E7E34;`;
      case 'warning': return css`background:#FFF4E0;color:#A66A00;`;
      case 'danger':  return css`background:#FDECEA;color:#B3261E;`;
      case 'info':    return css`background:rgba(var(--color-accent-rgb),.12);color:var(--color-accent);`;
      default:        return css`background:var(--color-bg);color:var(--color-text-muted);`;
    }
  }}
`;

/* ── Filterleiste ── */

export const Toolbar = styled.div`
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  margin-bottom: 16px;
`;

export const SearchWrap = styled.div`
  position: relative; flex: 1 1 240px; min-width: 0;
  svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
        color: var(--color-text-muted); pointer-events: none; }
`;

export const SearchInput = styled.input`
  width: 100%; padding: 9px 12px 9px 34px;
  border: 1px solid var(--color-border); border-radius: var(--radius-button);
  background: var(--color-white); color: var(--color-text);
  font-family: var(--font-body); font-size: .86rem;
  &:focus { outline: none; border-color: var(--color-accent); }
  &::placeholder { color: var(--color-text-muted); }
`;

export const Select = styled.select`
  padding: 9px 12px; border: 1px solid var(--color-border);
  border-radius: var(--radius-button); background: var(--color-white);
  color: var(--color-text); font-family: var(--font-body); font-size: .86rem;
  cursor: pointer;
  &:focus { outline: none; border-color: var(--color-accent); }
`;

/* ── Blätterleiste ── */

const PagerBar = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 18px; flex-wrap: wrap;
`;

const PagerInfo = styled.p`
  font-family: var(--font-body); font-size: .8rem; color: var(--color-text-muted);
`;

const PagerBtns = styled.div`display: flex; gap: 8px;`;

/**
 * Seitenweise Navigation.
 *
 * Bewusst nur Vor/Zurück statt nummerierter Seiten: bei tausenden
 * Bewertungen ist eine Seitenliste weder bedienbar noch nützlich,
 * und die exakte Gesamtzahl kostet bei jeder Abfrage ein COUNT.
 */
export function Pagination({ page, pageSize, total, onChange, busy }) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to   = Math.min((page + 1) * pageSize, total);
  const last = Math.max(Math.ceil(total / pageSize) - 1, 0);

  if (total <= pageSize) return null;

  return (
    <PagerBar>
      <PagerInfo>{from}–{to} von {total}</PagerInfo>
      <PagerBtns>
        <GhostBtn onClick={() => onChange(page - 1)} disabled={busy || page === 0}>
          <ChevronLeft size={14} /> Zurück
        </GhostBtn>
        <GhostBtn onClick={() => onChange(page + 1)} disabled={busy || page >= last}>
          Weiter <ChevronRight size={14} />
        </GhostBtn>
      </PagerBtns>
    </PagerBar>
  );
}

/* ── Formatierung ── */

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('de-DE',
    { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('de-DE',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** "vor 3 Stunden" — für Sync-Zeitpunkte aussagekräftiger als ein Datum. */
export function formatRelative(value) {
  if (!value) return 'noch nie';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1)  return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24)   return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}
