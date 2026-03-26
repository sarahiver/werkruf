import ProGate from '../../components/dashboard/ProGate';
import React from 'react';
import styled, { keyframes } from 'styled-components';
import { FileText, Download, CheckCircle } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import { FahrplanDownloadButton } from '../../templates/FahrplanPDF';

const fadeUp = keyframes`from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}`;

const Page = styled.div`animation: ${fadeUp} .4s ease both;`;

const PageTitle = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.4rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

const PageSub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); margin-bottom: 28px;
`;

const Card = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 22px; margin-bottom: 16px;
  animation: ${fadeUp} .4s ease ${({ $d }) => $d || '0s'} both;
`;

const CardTitle = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.05rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 6px;
`;

const CardSub = styled.p`
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted); margin-bottom: 16px; line-height: 1.5;
`;

const DocumentRow = styled.div`
  display: flex; align-items: center; gap: 16px;
  padding: 14px 16px;
  background: var(--color-bg);
  border-radius: var(--radius-card);
  margin-bottom: 10px;
`;

const DocIcon = styled.div`
  width: 40px; height: 40px; border-radius: var(--radius-button);
  background: var(--color-primary);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-accent); flex-shrink: 0;
`;

const DocInfo = styled.div`flex: 1; min-width: 0;`;
const DocTitle = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .9rem; color: var(--color-primary);
`;
const DocDesc = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-top: 2px;
`;

const ComingSoonBadge = styled.span`
  display: inline-block;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-body); font-weight: 600;
  font-size: .68rem; letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 8px; border-radius: var(--radius-button);
`;

export default function DashboardReporting() {
  const { profile } = useAuthContext();
  const industry     = useIndustry();
  const companyName  = profile?.company_name;

  return (
    <ProGate feature="Reporting">
    <Page>
      <PageTitle>Reporting</PageTitle>
      <PageSub>Dokumente, Berichte und dein persönlicher Fahrplan.</PageSub>

      {/* Fahrplan Download */}
      <Card $d="0s" style={{ borderTop: '4px solid var(--color-accent)' }}>
        <CardTitle>Sichtbarkeits-Fahrplan</CardTitle>
        <CardSub>
          Dein persönlicher 3-Phasen-Plan als PDF — was passiert wann und was wir von dir brauchen.
        </CardSub>

        <DocumentRow>
          <DocIcon><FileText size={18} /></DocIcon>
          <DocInfo>
            <DocTitle>
              Fahrplan_{companyName?.replace(/[^a-zA-Z0-9]/g, '_') || 'Betrieb'}.pdf
            </DocTitle>
            <DocDesc>
              Deckblatt · 3 Phasen · Checkliste · Dein Score: {profile?.visibility_score ?? '—'}/100
            </DocDesc>
          </DocInfo>
          {companyName ? (
            <FahrplanDownloadButton industry={industry} profile={profile} />
          ) : (
            <ComingSoonBadge>Erst Betrieb verknüpfen</ComingSoonBadge>
          )}
        </DocumentRow>
      </Card>

      {/* Monthly Reports — Coming Soon */}
      <Card $d=".1s">
        <CardTitle>Monatliche Reports</CardTitle>
        <CardSub>
          Automatische PDF-Reports mit Sichtbarkeits-Entwicklung, Klickzahlen und Bewertungsübersicht.
        </CardSub>
        <DocumentRow>
          <DocIcon style={{ background: 'var(--color-bg)', color: '#A0ADB8' }}>
            <FileText size={18} />
          </DocIcon>
          <DocInfo>
            <DocTitle style={{ color: '#A0ADB8' }}>Report — März 2026</DocTitle>
            <DocDesc>Wird nach Aktivierung automatisch erstellt</DocDesc>
          </DocInfo>
          <ComingSoonBadge>PRO-Feature</ComingSoonBadge>
        </DocumentRow>
      </Card>

    </Page>
    </ProGate>
  );
}
