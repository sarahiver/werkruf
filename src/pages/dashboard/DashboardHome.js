import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  CheckCircle, AlertTriangle, Link2, Clock, ArrowRight,
  RefreshCw, Star,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { useDashboardBriefing } from '../../hooks/useDashboardBriefing';
import {
  Page, PageTitle, PageSub, Card, SectionTitle,
  StatusBanner, ActionItem, MetricStrip,
  SkeletonList, ErrorState, EmptyState,
  PrimaryBtn, GhostBtn, Spinner, ratingColor, formatRelative,
} from '../../components/dashboard/gb/GbUi';

/* ─────────────────────────────────────────────
   DashboardHome — die Lagebesprechung

   Diese Seite beantwortet drei Fragen, in dieser Reihenfolge:

     1. Wie steht mein Betrieb da?        → Statusleiste, ganz oben
     2. Was braucht meine Aufmerksamkeit? → Liste, direkt darunter
     3. Was mache ich als Nächstes?       → EIN Knopf, in der Statusleiste

   Vorher zeigte die Seite Kacheln: Score, Kennzahlen, Betriebskarte,
   Verbindungskarte, Onboarding-Formular. Alles gleich gross, alles
   gleich wichtig — und der Nutzer musste selbst schliessen, was
   daraus folgt. Genau diese Arbeit nimmt ein Dashboard ab, oder es
   ist keins.

   Details liegen weiterhin auf den Unterseiten. Diese Seite
   wiederholt sie nicht, sie verweist.
───────────────────────────────────────────── */

const Greeting = styled.p`
  font-family: var(--font-body); font-size: .84rem;
  color: var(--color-text-muted); margin-bottom: 3px;
`;

const QuietLink = styled(Link)`
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-body); font-size: .84rem; font-weight: 700;
  color: var(--color-accent); text-decoration: none; margin-top: 14px;
  &:hover { text-decoration: underline; }
`;

const StripCaption = styled.p`
  font-family: var(--font-body); font-size: .76rem;
  color: var(--color-text-muted); margin-top: 8px;
  display: flex; align-items: center; gap: 6px;
`;

/* Icon je Zustand. Die Farbe kommt aus der Statusleiste selbst —
   hier nur die Form, damit beides nicht auseinanderläuft. */
const STATUS_ICONS = {
  ok:       <CheckCircle size={20} />,
  warning:  <Clock size={20} />,
  critical: <AlertTriangle size={20} />,
  setup:    <Link2 size={20} />,
  error:    <AlertTriangle size={20} />,
};

export default function DashboardHome() {
  const { profile } = useAuthContext();
  const { brand } = useIndustry();
  const {
    status, actions, nextAction, metrics,
    isConnected, lastSyncedAt, runningJob,
    loading, error, reload,
  } = useDashboardBriefing();

  const firstName = (profile?.full_name || '').split(' ')[0];
  const company   = profile?.company_name;

  if (error) {
    return (
      <Page>
        <PageTitle>Übersicht</PageTitle>
        <ErrorState message={error} onRetry={reload} busy={loading} />
      </Page>
    );
  }

  return (
    <Page>
      <Greeting>
        {firstName ? `Moin ${firstName}` : 'Moin'}
        {company ? ` — ${company}` : ''}
      </Greeting>
      <PageTitle>Übersicht</PageTitle>
      <PageSub>Was seit deinem letzten Besuch passiert ist, und was ansteht.</PageSub>

      {/* ═══ FRAGE 1 UND 3 ═══
          Zustand und nächste Handlung stehen zusammen. Wer den Satz
          liest, hat den Knopf schon im Blick — kein Suchen, kein
          Scrollen. */}
      <StatusBanner
        level={status.level}
        headline={status.headline}
        detail={status.detail}
        icon={STATUS_ICONS[status.level]}
        action={nextAction && (
          <PrimaryBtn as={Link} to={nextAction.ctaTo} style={{ textDecoration: 'none' }}>
            {nextAction.ctaLabel} <ArrowRight size={15} />
          </PrimaryBtn>
        )}
      />

      {/* ═══ FRAGE 2 ═══
          Nur wenn es tatsächlich etwas gibt. Eine leere Liste unter
          der Überschrift "Braucht deine Aufmerksamkeit" wäre eine
          Behauptung, die sich selbst widerspricht. */}
      {loading ? (
        <SkeletonList count={2} height={78} />
      ) : actions.length > 0 ? (
        <>
          <SectionTitle>
            <AlertTriangle size={15} /> Braucht deine Aufmerksamkeit
          </SectionTitle>
          <Card>
            {actions.map((item) => (
              <ActionItem
                key={item.id}
                severity={item.severity}
                title={item.title}
                detail={item.detail}
              >
                <GhostBtn as={Link} to={item.ctaTo} style={{ textDecoration: 'none' }}>
                  {item.ctaLabel} <ArrowRight size={13} />
                </GhostBtn>
              </ActionItem>
            ))}
          </Card>
        </>
      ) : isConnected ? (
        <EmptyState
          title="Nichts zu tun"
          text={`Alle Bewertungen sind beantwortet und dein Profil ist aktuell. ${brand.name} meldet sich, sobald sich etwas ändert.`}
        />
      ) : null}

      {/* ═══ HINTERGRUND ═══
          Kennzahlen kommen zuletzt und schmal. Sie beantworten keine
          der drei Fragen — sie bestätigen die Antwort. Wer sie
          braucht, findet sie; wer nicht, überliest sie. */}
      {isConnected && (
        <>
          <SectionTitle><Star size={15} /> Zahlen</SectionTitle>
          <MetricStrip
            loading={loading}
            items={[
              {
                label: 'Bewertung',
                value: metrics.rating ? metrics.rating.toFixed(1) : '—',
                accent: metrics.rating ? ratingColor(Math.round(metrics.rating)) : undefined,
              },
              { label: 'Bewertungen', value: metrics.reviews },
              {
                label: 'Offen',
                value: metrics.unanswered,
                accent: metrics.unanswered > 0 ? '#A66A00' : '#1E7E34',
              },
              { label: 'Beantwortet', value: metrics.published },
            ]}
          />

          <StripCaption>
            {runningJob ? (
              <><Spinner size={12} /> Abgleich läuft gerade</>
            ) : (
              <><RefreshCw size={12} /> Zuletzt abgeglichen {formatRelative(lastSyncedAt)}</>
            )}
          </StripCaption>

          <QuietLink to="/dashboard/google">
            Profil und Standorte ansehen <ArrowRight size={14} />
          </QuietLink>
        </>
      )}

      {/* ═══ NOCH NICHT VERBUNDEN ═══
          Kein zweiter Aufruf zum Handeln — der steht schon oben in der
          Statusleiste. Hier nur, was danach passiert, damit der Klick
          nicht ins Ungewisse führt. */}
      {!isConnected && !loading && (
        <>
          <SectionTitle><Link2 size={15} /> Was nach dem Verbinden passiert</SectionTitle>
          <Card>
            <ActionItem
              severity="info"
              title="Bewertungen landen im Dashboard"
              detail={`Zu jeder neuen Bewertung legt ${brand.name} einen Antwortvorschlag bereit. Veröffentlicht wird nur, was du freigibst.`}
            />
            <ActionItem
              severity="info"
              title="Lücken werden sichtbar"
              detail="Fehlende Öffnungszeiten, Fotos oder Leistungen erscheinen als Aufgabe — mit einem Knopf daneben."
            />
            <ActionItem
              severity="info"
              title="Probleme melden sich von selbst"
              detail="Reisst die Verbindung ab oder scheitert eine Veröffentlichung, erfährst du es hier und per E-Mail."
            />
          </Card>
        </>
      )}
    </Page>
  );
}
