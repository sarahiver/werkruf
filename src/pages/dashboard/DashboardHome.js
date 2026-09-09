import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  CheckCircle, AlertTriangle, Link2, Clock, ArrowRight,
  RefreshCw, Activity, TrendingUp, Star, MessageSquare,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { useDashboardBriefing } from '../../hooks/useDashboardBriefing';
import { useHealthScore } from '../../hooks/useHealthScore';
import {
  Page, PageTitle, PageSub, Card, SectionTitle,
  StatusBanner, Recommendation, HealthCard, Insight,
  SkeletonList, ErrorState, EmptyState,
  PrimaryBtn, GhostBtn, Spinner, formatRelative,
} from '../../components/dashboard/gb/GbUi';

/* ─────────────────────────────────────────────
   DashboardHome — die Aktionszentrale

   Das Dashboard ist nicht mehr der Einstieg. Der Einstieg ist die
   Wochenmail; hierher kommt jemand, um etwas zu erledigen. Die Seite
   zeigt deshalb dasselbe wie die Mail — nur mit Knöpfen daneben.

   Vier Fragen, in dieser Reihenfolge:

     1. Ist alles in Ordnung?     → Statusleiste
     2. Was ist passiert?          → Wochenrückblick, gedeutet
     3. Was soll ich tun?          → Empfehlungen mit Nutzen und Aufwand
     4. Wie steht mein Profil da?  → Gesundheitswert mit Aufschlüsselung

   Keine nackten Zahlen. Jede Kennzahl steht neben einem Satz, der
   sagt, was sie bedeutet — sonst ist das Lesen Arbeit für den Nutzer,
   und genau die soll das Produkt abnehmen.
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

const Caption = styled.p`
  font-family: var(--font-body); font-size: .76rem;
  color: var(--color-text-muted); margin-top: 10px;
  display: flex; align-items: center; gap: 6px;
`;

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
    status, actions, nextAction,
    isConnected, lastSyncedAt, runningJob,
    locations, stats, replyCounts,
    loading, error, reload,
  } = useDashboardBriefing();

  const health = useHealthScore({ stats, locations, replyCounts, loading });

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
      <PageSub>Dasselbe wie in deiner Wochenmail — hier mit Knöpfen daneben.</PageSub>

      {/* ═══ 1. IST ALLES IN ORDNUNG? ═══
          Zustand und die eine nächste Handlung stehen zusammen. Wer
          den Satz liest, hat den Knopf schon im Blick. */}
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

      {/* ═══ 2. WAS IST PASSIERT? ═══
          Der Wochenrückblick. Jede Zahl mit einem Satz daneben — eine
          Zahl allein ist eine Aufgabe für den Leser. */}
      {isConnected && !loading && stats && (
        <>
          <SectionTitle><Activity size={15} /> Was war los</SectionTitle>
          <Card>
            <Insight
              value={stats.totalReviews}
              text={stats.totalReviews === 0
                ? 'Noch keine Bewertungen. Der Bewertungslink hilft, die ersten zu bekommen.'
                : <>Bewertungen insgesamt.{' '}
                    {stats.unanswered === 0
                      ? <>Alle beantwortet — <strong>das sieht jeder, der dein Profil öffnet</strong>.</>
                      : <>Davon <strong>{stats.unanswered} ohne Antwort</strong>.</>}
                  </>}
            />

            <Insight
              value={stats.averageRating ? stats.averageRating.toFixed(1) : '—'}
              accent={stats.averageRating >= 4.2 ? '#1E7E34'
                : stats.averageRating >= 3.5 ? '#D48A00' : '#D93025'}
              text={!stats.averageRating
                ? 'Noch kein Durchschnitt — dafür braucht es die erste Bewertung.'
                : stats.averageRating >= 4.5
                  ? 'Durchschnitt. Damit liegst du über dem, was Suchende erwarten.'
                  : stats.averageRating >= 4.0
                    ? 'Durchschnitt. Solide — jede neue gute Bewertung hebt ihn weiter.'
                    : 'Durchschnitt. Wer zwischen mehreren Betrieben wählt, achtet darauf.'}
            />

            <Insight
              value={replyCounts.published}
              text={replyCounts.published === 0
                ? 'Noch keine Antwort veröffentlicht.'
                : <>{replyCounts.published === 1 ? 'Antwort steht' : 'Antworten stehen'} öffentlich
                    unter deinen Bewertungen.</>}
            />

            {locations.length > 1 && (
              <Insight
                value={locations.length}
                text="Standorte werden überwacht. Der Umschalter im Profil zeigt sie einzeln."
              />
            )}
          </Card>

          <Caption>
            {runningJob
              ? <><Spinner size={12} /> Abgleich läuft gerade</>
              : <><RefreshCw size={12} /> Stand: {formatRelative(lastSyncedAt)}</>}
          </Caption>
        </>
      )}

      {/* ═══ 3. WAS SOLL ICH TUN? ═══
          Empfehlungen mit Nutzen und Aufwand. Ohne beides kann niemand
          entscheiden, ob sich eine Sache jetzt lohnt. */}
      {loading ? (
        <SkeletonList count={2} height={96} />
      ) : actions.length > 0 ? (
        <>
          <SectionTitle><AlertTriangle size={15} /> Was du tun solltest</SectionTitle>
          <Card>
            {actions.map((item) => (
              <Recommendation
                key={item.id}
                severity={item.severity}
                title={item.title}
                detail={item.detail}
                benefit={item.benefit}
                effort={item.effort}
                benefitIcon={<TrendingUp size={11} />}
                effortIcon={<Clock size={11} />}
              >
                <GhostBtn as={Link} to={item.ctaTo} style={{ textDecoration: 'none' }}>
                  {item.ctaLabel} <ArrowRight size={13} />
                </GhostBtn>
              </Recommendation>
            ))}
          </Card>
        </>
      ) : isConnected ? (
        <EmptyState
          title="Nichts zu tun"
          text={`Alle Bewertungen sind beantwortet und dein Profil ist aktuell. ${brand.name} meldet sich, sobald sich etwas ändert — du musst hier nicht nachsehen.`}
        />
      ) : null}

      {/* ═══ 4. WIE STEHT MEIN PROFIL DA? ═══
          Der Gesundheitswert kommt zuletzt: Er ist eine Einordnung,
          keine Handlung. Wer schon weiß, was zu tun ist, braucht ihn
          nicht — wer sich orientieren will, findet ihn. */}
      {isConnected && (
        <>
          <SectionTitle><Star size={15} /> Zustand deines Profils</SectionTitle>
          <HealthCard
            loading={loading}
            score={health.score}
            level={health.level}
            headline={health.headline}
            summary={health.summary}
            factors={health.factors}
          />
          <Caption>
            <MessageSquare size={12} />
            Berechnet aus deinen Google-Daten: Antwortquote, Bewertung, Aktualität,
            Vollständigkeit und Fotos. Keine geschätzten Werte.
          </Caption>

          <QuietLink to="/dashboard/google">
            Profil und Standorte ansehen <ArrowRight size={14} />
          </QuietLink>
        </>
      )}

      {/* ═══ NOCH NICHT VERBUNDEN ═══
          Kein zweiter Handlungsaufruf — der steht oben. Hier nur, was
          danach passiert, damit der Klick nicht ins Ungewisse führt. */}
      {!isConnected && !loading && (
        <>
          <SectionTitle><Link2 size={15} /> Was nach dem Verbinden passiert</SectionTitle>
          <Card>
            <Recommendation
              severity="info"
              title="Du bekommst montags eine Mail"
              detail="Was in der Woche passiert ist, und ob etwas zu tun ist. War nichts, steht das auch so drin."
            />
            <Recommendation
              severity="info"
              title="Bei schlechten Bewertungen meldet sich WERKRUF sofort"
              detail={`Mit fertigem Antwortvorschlag. Veröffentlicht wird nur, was du freigibst.`}
            />
            <Recommendation
              severity="info"
              title="Probleme melden sich von selbst"
              detail="Reisst die Verbindung ab oder ändert Google deine Angaben, erfährst du es — ohne nachzusehen."
            />
          </Card>
        </>
      )}
    </Page>
  );
}
