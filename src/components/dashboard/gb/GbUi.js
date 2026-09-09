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

/* ── Statusleiste ──
   Beantwortet Frage 1 auf einen Blick. Ein Zustand, eine Farbe, ein
   Satz. Bewusst breit und ganz oben: was hier steht, soll man lesen,
   ohne zu scrollen — auch auf dem Handy. ── */

export const STATUS_COLORS = {
  ok:       { fg: '#1E7E34', bg: '#E8F5E9' },
  warning:  { fg: '#A66A00', bg: '#FFF4E0' },
  critical: { fg: '#B3261E', bg: '#FDECEA' },
  setup:    { fg: 'var(--color-accent)', bg: 'rgba(var(--color-accent-rgb), .1)' },
  error:    { fg: '#B3261E', bg: '#FDECEA' },
};

const StatusWrap = styled.div`
  display: flex; align-items: flex-start; gap: 14px;
  padding: 20px 22px; margin-bottom: 20px;
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-left: 4px solid ${({ $level }) => (STATUS_COLORS[$level] || STATUS_COLORS.ok).fg};
  border-radius: var(--radius-card);
  animation: ${fadeUp} .3s ease both;
`;

const StatusIconWrap = styled.div`
  width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: ${({ $level }) => (STATUS_COLORS[$level] || STATUS_COLORS.ok).bg};
  color: ${({ $level }) => (STATUS_COLORS[$level] || STATUS_COLORS.ok).fg};
`;

const StatusHeadline = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.15rem; text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.25;
`;

const StatusDetail = styled.p`
  font-family: var(--font-body); font-size: .86rem; line-height: 1.6;
  color: var(--color-text-muted); margin-top: 4px;
`;

export function StatusBanner({ level, headline, detail, icon, action }) {
  if (level === 'loading') return <SkeletonBlock $h={84} style={{ marginBottom: 20 }} />;

  return (
    <StatusWrap $level={level}>
      <StatusIconWrap $level={level}>{icon}</StatusIconWrap>
      <div style={{ flex: 1, minWidth: 0 }}>
        <StatusHeadline>{headline}</StatusHeadline>
        {detail && <StatusDetail>{detail}</StatusDetail>}
        {action && <div style={{ marginTop: 14 }}>{action}</div>}
      </div>
    </StatusWrap>
  );
}

/* ── Handlungsposten ──
   Frage 2. Jede Zeile: was ist los, warum zählt es, ein Knopf.
   Kein Aufklappen, kein Zwischenschritt — wer hier landet, will
   handeln, nicht navigieren. ── */

const ActionRow = styled.div`
  display: flex; align-items: flex-start; gap: 13px;
  padding: 15px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }

  @media (max-width: 560px) {
    flex-wrap: wrap;
  }
`;

const ActionDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  margin-top: 7px;
  background: ${({ $severity }) => (STATUS_COLORS[$severity] || STATUS_COLORS.warning).fg};
`;

const ActionBody = styled.div`flex: 1; min-width: 0;`;

const ActionTitle = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .9rem;
  color: var(--color-primary); line-height: 1.4;
`;

const ActionDetail = styled.p`
  font-family: var(--font-body); font-size: .82rem; line-height: 1.55;
  color: var(--color-text-muted); margin-top: 3px;
`;

const ActionCta = styled.div`
  flex-shrink: 0;
  @media (max-width: 560px) {
    width: 100%; margin-top: 10px; padding-left: 21px;
  }
`;

export function ActionItem({ severity, title, detail, children }) {
  return (
    <ActionRow>
      <ActionDot $severity={severity} />
      <ActionBody>
        <ActionTitle>{title}</ActionTitle>
        {detail && <ActionDetail>{detail}</ActionDetail>}
      </ActionBody>
      {children && <ActionCta>{children}</ActionCta>}
    </ActionRow>
  );
}

/* ── Gesundheitswert ──
   Zahl plus Aufschlüsselung. Ein Wert ohne Begründung ist eine
   Behauptung; mit Begründung ist er nachvollziehbar — und der Nutzer
   sieht, welcher Hebel der größte ist. ── */

const HealthWrap = styled(Card)`
  padding: 0; overflow: hidden;
`;

const HealthTop = styled.div`
  display: flex; align-items: center; gap: 18px;
  padding: 20px 22px;
  border-bottom: 1px solid var(--color-border);
  @media (max-width: 480px) { flex-direction: column; align-items: flex-start; gap: 12px; }
`;

const HealthRing = styled.div`
  width: 66px; height: 66px; flex-shrink: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  /* conic-gradient statt SVG: ein Ring ohne zusätzliche Abhängigkeit,
     und der Anteil ist direkt ablesbar. */
  background: conic-gradient(
    ${({ $color }) => $color} ${({ $pct }) => $pct}%,
    var(--color-bg) ${({ $pct }) => $pct}%
  );
  position: relative;
  &::after {
    content: ''; position: absolute; inset: 6px;
    background: var(--color-white); border-radius: 50%;
  }
`;

const HealthNum = styled.span`
  position: relative; z-index: 1;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.25rem; color: ${({ $color }) => $color};
`;

const HealthHeadline = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; text-transform: var(--text-transform);
  color: var(--color-primary); line-height: 1.3;
`;

const HealthSummary = styled.p`
  font-family: var(--font-body); font-size: .84rem; line-height: 1.6;
  color: var(--color-text-muted); margin-top: 5px;
`;

const FactorRow = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 22px;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }
`;

const FactorBar = styled.div`
  width: 44px; height: 5px; flex-shrink: 0; margin-top: 6px;
  border-radius: 3px; background: var(--color-bg); overflow: hidden;
  span {
    display: block; height: 100%; border-radius: 3px;
    width: ${({ $pct }) => $pct}%;
    background: ${({ $pct }) => ($pct >= 80 ? '#1E7E34' : $pct >= 40 ? '#D48A00' : '#D93025')};
  }
`;

const FactorLabel = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .84rem;
  color: var(--color-primary);
`;

const FactorVerdict = styled.p`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.55;
  color: var(--color-text-muted); margin-top: 2px;
`;

const HEALTH_COLORS = { good: '#1E7E34', ok: '#D48A00', weak: '#D93025' };

export function HealthCard({ score, level, headline, summary, factors, loading }) {
  if (loading || score === null) return <SkeletonBlock $h={240} />;
  const color = HEALTH_COLORS[level] || HEALTH_COLORS.ok;

  return (
    <HealthWrap>
      <HealthTop>
        <HealthRing $pct={score} $color={color}>
          <HealthNum $color={color}>{score}</HealthNum>
        </HealthRing>
        <div style={{ flex: 1, minWidth: 0 }}>
          <HealthHeadline>{headline}</HealthHeadline>
          <HealthSummary>{summary}</HealthSummary>
        </div>
      </HealthTop>

      {factors.map((factor) => (
        <FactorRow key={factor.id}>
          <FactorBar $pct={factor.max ? Math.round((factor.points / factor.max) * 100) : 0}>
            <span />
          </FactorBar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FactorLabel>{factor.label}</FactorLabel>
            <FactorVerdict>{factor.verdict}</FactorVerdict>
          </div>
        </FactorRow>
      ))}
    </HealthWrap>
  );
}

/* ── Empfehlung ──
   Beantwortet vier Fragen in einer Karte: was ist passiert, warum
   zählt es, was bringt es, wie lange dauert es. Fehlt eine Antwort,
   gehört die Karte nicht aufs Dashboard. ── */

const RecoWrap = styled.div`
  display: flex; align-items: flex-start; gap: 13px;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }
`;

const RecoDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 7px;
  background: ${({ $severity }) => (STATUS_COLORS[$severity] || STATUS_COLORS.warning).fg};
`;

const RecoTitle = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .9rem;
  color: var(--color-primary); line-height: 1.4;
`;

const RecoDetail = styled.p`
  font-family: var(--font-body); font-size: .82rem; line-height: 1.55;
  color: var(--color-text-muted); margin-top: 3px;
`;

const RecoMeta = styled.div`
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px;
`;

const MetaChip = styled.span`
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-body); font-size: .72rem;
  color: var(--color-text-muted);
  background: var(--color-bg); padding: 3px 9px;
  border-radius: var(--radius-button);
  svg { flex-shrink: 0; }
`;

const RecoFoot = styled.div`
  margin-top: 12px;
  @media (max-width: 560px) { width: 100%; }
`;

export function Recommendation({ severity, title, detail, benefit, effort, benefitIcon, effortIcon, children }) {
  return (
    <RecoWrap>
      <RecoDot $severity={severity} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <RecoTitle>{title}</RecoTitle>
        {detail && <RecoDetail>{detail}</RecoDetail>}
        {(benefit || effort) && (
          <RecoMeta>
            {benefit && <MetaChip>{benefitIcon}{benefit}</MetaChip>}
            {effort  && <MetaChip>{effortIcon}{effort}</MetaChip>}
          </RecoMeta>
        )}
        {children && <RecoFoot>{children}</RecoFoot>}
      </div>
    </RecoWrap>
  );
}

/* ── Kennzahl mit Deutung ──
   Eine Zahl ohne Satz daneben ist eine Aufgabe für den Leser. ── */

const InsightWrap = styled.div`
  display: flex; align-items: baseline; gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }
`;

const InsightNum = styled.span`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; color: ${({ $accent }) => $accent || 'var(--color-primary)'};
  flex-shrink: 0; min-width: 46px;
`;

const InsightText = styled.p`
  font-family: var(--font-body); font-size: .84rem; line-height: 1.55;
  color: var(--color-text);
  strong { color: var(--color-primary); }
`;

export function Insight({ value, text, accent }) {
  return (
    <InsightWrap>
      <InsightNum $accent={accent}>{value}</InsightNum>
      <InsightText>{text}</InsightText>
    </InsightWrap>
  );
}

/* ── Kennzahlenleiste ──
   Vier Zahlen in einer Zeile statt vier Kacheln übereinander.
   Kennzahlen sind Hintergrund, keine Handlung — sie bekommen
   entsprechend wenig Platz. ── */

const StripWrap = styled.div`
  display: flex; flex-wrap: wrap;
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

const StripItem = styled.div`
  flex: 1 1 118px; padding: 14px 16px;
  border-right: 1px solid var(--color-border);
  &:last-child { border-right: none; }

  @media (max-width: 560px) {
    flex-basis: 50%;
    &:nth-child(2n) { border-right: none; }
    &:nth-child(-n+2) { border-bottom: 1px solid var(--color-border); }
  }
`;

const StripNum = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.3rem; line-height: 1.1;
  color: ${({ $accent }) => $accent || 'var(--color-primary)'};
`;

const StripLabel = styled.p`
  font-family: var(--font-body); font-size: .7rem;
  color: var(--color-text-muted); text-transform: uppercase;
  letter-spacing: .07em; margin-top: 3px;
`;

export function MetricStrip({ items, loading }) {
  if (loading) return <SkeletonBlock $h={66} />;
  return (
    <StripWrap>
      {items.map((item) => (
        <StripItem key={item.label}>
          <StripNum $accent={item.accent}>{item.value}</StripNum>
          <StripLabel>{item.label}</StripLabel>
        </StripItem>
      ))}
    </StripWrap>
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
