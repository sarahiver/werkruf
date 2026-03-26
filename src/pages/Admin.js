import React, { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { Users, TrendingUp, CreditCard, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import supabase from '../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

// Admin email whitelist — add yours
const ADMIN_EMAILS = ['ivergentz@gmail.com'];

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

const SpinIcon = styled(RefreshCw)`animation: ${spin} .8s linear infinite;`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Admin() {
  const { user, signOut } = useAuthContext();
  const navigate          = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [leads,    setLeads]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Guard — admin only
  const isAdmin = ADMIN_EMAILS.includes(user?.email);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (!isAdmin) { navigate('/dashboard'); return; }
    loadData();
  }, [user]);

  const loadData = async () => {
    setRefreshing(true);
    try {
      const [{ data: p }, { data: l }] = await Promise.all([
        supabase.from('user_profiles').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      setProfiles(p || []);
      setLeads(l || []);
    } catch (err) {
      console.error('Admin load error:', err);
    }
    setLoading(false);
    setRefreshing(false);
  };

  if (!isAdmin) return null;

  // Stats
  const total      = profiles.length;
  const proUsers   = profiles.filter(p => p.plan === 'pro').length;
  const trialUsers = profiles.filter(p => p.plan === 'trial').length;
  const mrr        = proUsers * 49;
  const withBiz    = profiles.filter(p => p.google_place_id).length;
  const avgScore   = profiles.filter(p => p.visibility_score).length
    ? Math.round(profiles.filter(p => p.visibility_score).reduce((s, p) => s + p.visibility_score, 0) / profiles.filter(p => p.visibility_score).length)
    : 0;
  const setupLeads = leads.filter(l => l.needs_manual_setup && l.status === 'new').length;

  const fmt = (d) => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }) : '—';
  const daysLeft = (d) => {
    if (!d) return null;
    const days = Math.ceil((new Date(d) - Date.now()) / 86400000);
    return days;
  };

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
          ) : profiles.length === 0 ? (
            <Empty>Keine User gefunden.</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Betrieb</Th>
                    <Th>Plan</Th>
                    <Th>Score</Th>
                    <Th>Trial endet</Th>
                    <Th>Setup</Th>
                    <Th>Registriert</Th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map(p => {
                    const days = daysLeft(p.trial_ends_at);
                    return (
                      <Tr key={p.id}>
                        <Td>
                          <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                            {p.company_name || '—'}
                          </div>
                          <div style={{ fontSize: '.75rem', color: 'var(--color-text-muted)' }}>
                            {p.city || ''}
                          </div>
                        </Td>
                        <Td><PlanBadge $plan={p.plan}>{p.plan || 'free'}</PlanBadge></Td>
                        <Td>
                          {p.visibility_score !== null ? (
                            <>
                              <ScoreDot $s={p.visibility_score} />
                              {p.visibility_score}
                            </>
                          ) : '—'}
                        </Td>
                        <Td>
                          {days !== null ? (
                            <span style={{ color: days <= 3 ? '#D93025' : days <= 7 ? '#D48A00' : 'inherit', fontWeight: days <= 3 ? 700 : 400 }}>
                              {days <= 0 ? 'Abgelaufen' : `${days} Tage`}
                            </span>
                          ) : '—'}
                        </Td>
                        <Td>{p.setup_fee_paid ? '✓ Bezahlt' : '—'}</Td>
                        <Td>{fmt(p.created_at)}</Td>
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
