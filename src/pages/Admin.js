import React, { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { Users, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import supabase from '../supabaseClient';
import { formatAdminDate, getCustomerProblem, getSubscriptionLabel } from '../utils/adminOps';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

const Page = styled.div`
  min-height: 100vh; background: var(--color-bg);
  padding: 0;
`;

const TopBar = styled.div`
  background: var(--color-primary);
  border-bottom: 3px solid var(--color-accent);
  padding: 16px 32px;
  display: flex; align-items: center; justify-content: space-between;
`;

const Logo = styled.p`
  font-family: var(--font-display); font-weight: 900;
  font-size: 1rem; letter-spacing: 3px; text-transform: uppercase; color: white;
`;

const AdminBadge = styled.span`
  background: rgba(var(--color-accent-rgb),.2);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 8px; border-radius: var(--radius-button);
`;

const SignOutBtn = styled.button`
  display: flex; align-items: center; gap: 6px;
  background: none; border: 1px solid rgba(255,255,255,.2);
  color: rgba(255,255,255,.6); font-family: var(--font-body); font-size: .82rem;
  padding: 6px 14px; border-radius: var(--radius-button); cursor: pointer;
  &:hover { color: white; border-color: rgba(255,255,255,.4); }
`;

const Inner = styled.div`
  max-width: 1200px; margin: 0 auto; padding: 32px 24px;
`;

const StatsGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px; margin-bottom: 32px;
`;

const StatCard = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 20px;
  border-left: 4px solid ${({ $color }) => $color || 'var(--color-accent)'};
  animation: ${fadeUp} .4s ease ${({ $d }) => $d || '0s'} both;
`;

const StatNum = styled.p`
  font-family: var(--font-display); font-weight: 900;
  font-size: 2.2rem; line-height: 1;
  color: ${({ $c }) => $c || 'var(--color-primary)'};
`;

const StatLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted); margin-top: 6px;
`;

const Section = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); margin-bottom: 20px;
  animation: ${fadeUp} .4s ease .1s both;
`;

const SectionHead = styled.div`
  padding: 16px 20px; border-bottom: 1px solid var(--color-border);
  display: flex; align-items: center; justify-content: space-between;
`;

const SectionTitle = styled.h2`
  font-family: var(--font-display); font-weight: 700;
  font-size: 1rem; text-transform: uppercase; color: var(--color-primary);
`;

const RefreshBtn = styled.button`
  display: flex; align-items: center; gap: 6px;
  background: none; border: 1px solid var(--color-border);
  color: var(--color-text-muted); font-family: var(--font-body); font-size: .8rem;
  padding: 6px 12px; border-radius: var(--radius-button); cursor: pointer;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const Table = styled.table`width: 100%; border-collapse: collapse;`;
const Th = styled.th`
  padding: 12px 16px; text-align: left;
  font-family: var(--font-body); font-size: .72rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
`;
const Td = styled.td`
  padding: 12px 16px;
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text); border-bottom: 1px solid var(--color-border);
`;
const Tr = styled.tr`&:hover td { background: rgba(var(--color-primary-rgb),.02); }`;

const PlanBadge = styled.span`
  display: inline-block;
  background: ${({ $plan }) =>
    $plan === 'pro'   ? 'rgba(var(--color-accent-rgb),.1)' :
    $plan === 'trial' ? '#E8F5E9' : 'var(--color-bg)'};
  color: ${({ $plan }) =>
    $plan === 'pro'   ? 'var(--color-accent)' :
    $plan === 'trial' ? '#1E7E34' : 'var(--color-text-muted)'};
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .08em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 3px;
`;

const ScoreDot = styled.span`
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: ${({ $s }) => $s >= 70 ? '#1E7E34' : $s >= 45 ? '#D48A00' : '#D93025'};
  margin-right: 6px;
`;

const Empty = styled.div`
  padding: 40px; text-align: center;
  font-family: var(--font-body); font-size: .88rem; color: var(--color-text-muted);
`;

const Status = styled.span`
  display: inline-block; padding: 3px 7px; border-radius: 4px; font-size: .72rem; font-weight: 700;
  color: ${({ $ok }) => $ok ? '#1E7E34' : '#B42318'};
  background: ${({ $ok }) => $ok ? '#E8F5E9' : '#FDECEC'};
`;

const Reason = styled.div`
  max-width: 260px; color: ${({ $ok }) => $ok ? 'var(--color-text-muted)' : '#B42318'};
  font-size: .76rem; line-height: 1.35; white-space: normal;
`;

const SpinIcon = styled(RefreshCw)`animation: ${spin} .8s linear infinite;`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Admin() {
  const { isAdmin, signOut, loading: authLoading } = useAuthContext();
  const navigate          = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [leads,    setLeads]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const loadData = async () => {
    setRefreshing(true);
    setLoadError('');
    try {
      const [opsResult, leadsResult] = await Promise.all([
        supabase.functions.invoke('admin-ops', { body: {} }),
        supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (opsResult.error) throw opsResult.error;
      if (leadsResult.error) throw leadsResult.error;
      setCustomers(opsResult.data?.customers || []);
      setLeads(leadsResult.data || []);
    } catch (err) {
      console.error('Admin load error:', err);
      setLoadError('Die Admin-Daten konnten nicht geladen werden. Bitte versuche es erneut.');
      setCustomers([]);
      setLeads([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (authLoading || !isAdmin) return null;

  // Stats
  const total      = customers.length;
  const proUsers   = customers.filter(p => p.plan === 'pro').length;
  const trialUsers = customers.filter(p => p.trialEndsAt && new Date(p.trialEndsAt) > new Date()).length;
  const mrr        = proUsers * 49;
  const withBiz    = customers.filter(p => p.googleStatus === 'active').length;
  const avgScore   = customers.filter(p => p.healthScore !== null).length
    ? Math.round(customers.filter(p => p.healthScore !== null).reduce((s, p) => s + p.healthScore, 0) / customers.filter(p => p.healthScore !== null).length)
    : 0;
  const setupLeads = leads.filter(l => l.needs_manual_setup && l.status === 'new').length;

  const fmt = (d) => formatAdminDate(d);

  return (
    <Page>
      <TopBar>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo>WERKRUF</Logo>
          <AdminBadge>Admin</AdminBadge>
        </div>
        <SignOutBtn onClick={async () => { await signOut(); navigate('/'); }}>
          <LogOut size={14} /> Abmelden
        </SignOutBtn>
      </TopBar>

      <Inner>
        {loadError && <Empty>{loadError}</Empty>}
        {/* Stats */}
        <StatsGrid>
          <StatCard $color="var(--color-accent)" $d="0s">
            <StatNum>{total}</StatNum>
            <StatLabel>Registrierte User</StatLabel>
          </StatCard>
          <StatCard $color="#1E7E34" $d=".05s">
            <StatNum $c="#1E7E34">{proUsers}</StatNum>
            <StatLabel>PRO User</StatLabel>
          </StatCard>
          <StatCard $color="#D48A00" $d=".1s">
            <StatNum $c="#D48A00">{trialUsers}</StatNum>
            <StatLabel>Trial User</StatLabel>
          </StatCard>
          <StatCard $color="var(--color-primary)" $d=".15s">
            <StatNum>{mrr}€</StatNum>
            <StatLabel>MRR (geschätzt)</StatLabel>
          </StatCard>
          <StatCard $color="var(--color-accent)" $d=".2s">
            <StatNum>{withBiz}</StatNum>
            <StatLabel>Mit GMB verknüpft</StatLabel>
          </StatCard>
          <StatCard $color={avgScore >= 70 ? '#1E7E34' : '#D93025'} $d=".25s">
            <StatNum $c={avgScore >= 70 ? '#1E7E34' : '#D93025'}>{avgScore}</StatNum>
            <StatLabel>Ø Score</StatLabel>
          </StatCard>
          {setupLeads > 0 && (
            <StatCard $color="#D93025" $d=".3s">
              <StatNum $c="#D93025">{setupLeads}</StatNum>
              <StatLabel>Offene Setup-Aufträge</StatLabel>
            </StatCard>
          )}
        </StatsGrid>

        {/* Users Table */}
        <Section>
          <SectionHead>
            <SectionTitle>
              <Users size={15} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              User ({total})
            </SectionTitle>
            <RefreshBtn onClick={loadData} disabled={refreshing}>
              {refreshing ? <SpinIcon size={13} /> : <RefreshCw size={13} />}
              Aktualisieren
            </RefreshBtn>
          </SectionHead>

          {loading ? (
            <Empty><SpinIcon size={20} style={{ margin: '0 auto', display: 'block' }} /></Empty>
          ) : customers.length === 0 ? (
            <Empty>Keine User gefunden.</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Betrieb</Th>
                    <Th>Plan / Abo</Th>
                    <Th>Google / Sync</Th>
                    <Th>Health</Th>
                    <Th>Reviews / Actions</Th>
                    <Th>Letzte Mail</Th>
                    <Th>Diagnose</Th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(p => {
                    const problem = getCustomerProblem(p);
                    const healthy = problem === 'Kein akutes Problem erkannt';
                    return (
                      <Tr key={p.id}>
                        <Td>
                          <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                            {p.companyName || '—'}
                          </div>
                          <div style={{ fontSize: '.75rem', color: 'var(--color-text-muted)' }}>
                            {p.email || 'Keine E-Mail'} · seit {fmt(p.createdAt)}
                          </div>
                        </Td>
                        <Td>
                          <PlanBadge $plan={p.plan}>{p.plan || 'free'}</PlanBadge>
                          <div style={{ marginTop: 5, fontSize: '.75rem' }}>{getSubscriptionLabel(p)}</div>
                          {p.trialEndsAt && <div style={{ fontSize: '.7rem', color: 'var(--color-text-muted)' }}>Trial bis {fmt(p.trialEndsAt)}</div>}
                        </Td>
                        <Td>
                          <Status $ok={p.googleStatus === 'active'}>{p.googleStatus === 'active' ? 'Aktiv' : p.googleStatus.replaceAll('_', ' ')}</Status>
                          <div style={{ marginTop: 5, fontSize: '.7rem', color: 'var(--color-text-muted)' }}>Sync: {formatAdminDate(p.lastGoogleSyncAt, true)}</div>
                        </Td>
                        <Td>{p.healthScore !== null ? <><ScoreDot $s={p.healthScore} />{p.healthScore}</> : '—'}</Td>
                        <Td><strong>{p.reviewCount}</strong> Reviews<br /><span style={{ fontSize: '.75rem' }}>{p.openActions} offen</span></Td>
                        <Td>{p.lastMail ? <><Status $ok={p.lastMail.status === 'sent'}>{p.lastMail.status}</Status><div style={{ marginTop: 5, fontSize: '.7rem' }}>{p.lastMail.template}<br />{formatAdminDate(p.lastMail.sent_at || p.lastMail.updated_at, true)}</div></> : '—'}</Td>
                        <Td><Reason $ok={healthy}>{problem}{p.lastSyncError?.at && <><br />{formatAdminDate(p.lastSyncError.at, true)}</>}</Reason></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Section>

        {/* Setup Leads */}
        {leads.filter(l => l.needs_manual_setup && l.status === 'new').length > 0 && (
          <Section>
            <SectionHead>
              <SectionTitle>
                <AlertTriangle size={15} style={{ display: 'inline', marginRight: 8, color: '#D93025', verticalAlign: 'middle' }} />
                Offene Setup-Aufträge ({setupLeads})
              </SectionTitle>
            </SectionHead>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Betrieb</Th>
                    <Th>E-Mail</Th>
                    <Th>Branche</Th>
                    <Th>Eingetragen am</Th>
                  </tr>
                </thead>
                <tbody>
                  {leads.filter(l => l.needs_manual_setup && l.status === 'new').map(l => (
                    <Tr key={l.id}>
                      <Td style={{ fontWeight: 700, color: '#D93025' }}>{l.company_name}</Td>
                      <Td>{l.email || '—'}</Td>
                      <Td>{l.industry_key || 'handwerk'}</Td>
                      <Td>{fmt(l.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Section>
        )}
      </Inner>
    </Page>
  );
}
