import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import {
  CreditCard, ExternalLink, CheckCircle,
  AlertTriangle, User, Building, Loader
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';
import supabase from '../../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

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
  color: var(--color-text-muted); margin-bottom: 18px; line-height: 1.5;
`;

/* Plan badge */
const PlanRow = styled.div`
  display: flex; align-items: center;
  justify-content: space-between; flex-wrap: wrap; gap: 12px;
`;

const PlanInfo = styled.div``;

const PlanBadge = styled.span`
  display: inline-flex; align-items: center; gap: 6px;
  background: ${({ $plan }) =>
    $plan === 'pro'   ? 'rgba(var(--color-accent-rgb),.1)' :
    $plan === 'trial' ? '#E8F5E9' : 'var(--color-bg)'};
  color: ${({ $plan }) =>
    $plan === 'pro'   ? 'var(--color-accent)' :
    $plan === 'trial' ? '#1E7E34' : 'var(--color-text-muted)'};
  border: 1px solid ${({ $plan }) =>
    $plan === 'pro'   ? 'rgba(var(--color-accent-rgb),.3)' :
    $plan === 'trial' ? '#A5D6A7' : 'var(--color-border)'};
  font-family: var(--font-body); font-weight: 700;
  font-size: .72rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 4px 10px; border-radius: var(--radius-button);
`;

const PlanName = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .95rem; color: var(--color-primary); margin-top: 6px;
`;

const PlanDetail = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-top: 2px;
`;

/* Portal Button */
const PortalBtn = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px;
  background: var(--color-primary); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .88rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover:not(:disabled) { filter: brightness(1.15); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const ErrorBanner = styled.div`
  padding: 10px 14px; background: #FDECEA;
  border-left: 3px solid #D93025; border-radius: var(--radius-card);
  font-family: var(--font-body); font-size: .82rem; color: #D93025;
  margin-top: 12px;
`;

/* Profile info */
const InfoGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  @media(max-width:560px){grid-template-columns:1fr;}
`;

const InfoItem = styled.div`
  padding: 12px 14px;
  background: var(--color-bg);
  border-radius: var(--radius-card);
`;

const InfoLabel = styled.p`
  font-family: var(--font-body); font-size: .7rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted); margin-bottom: 4px;
`;

const InfoValue = styled.p`
  font-family: var(--font-body); font-weight: 600;
  font-size: .9rem; color: var(--color-primary);
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardSettings() {
  const { user, profile }     = useAuthContext();
  const { brand, pricing }    = useIndustry();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError,   setPortalError]   = useState('');

  const plan              = profile?.plan || 'free';
  const hasStripeCustomer = !!profile?.stripe_customer_id;

  const trialEndsDate = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const trialEnds     = trialEndsDate
    ? trialEndsDate.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;
  const daysLeft = trialEndsDate
    ? Math.max(0, Math.ceil((trialEndsDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const trialUrgent = daysLeft !== null && daysLeft <= 5;

  const planLabels = {
    free:  'Kostenloser Plan',
    trial: `${pricing.trialDays} Tage Gratis-Test`,
    pro:   `${pricing.productName}`,
  };

  /* ── Delete Account (GDPR Right to be Forgotten) ── */
  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Konto wirklich löschen?\n\n' +
      '• Alle deine Daten werden gelöscht\n' +
      '• Dein Abo wird sofort gekündigt\n' +
      '• Dein Google Business Profil bleibt erhalten\n\n' +
      'Diese Aktion kann nicht rückgängig gemacht werden.'
    );
    if (!confirmed) return;

    // Second confirmation
    const confirmed2 = window.confirm('Bist du absolut sicher? Alle Daten werden unwiderruflich gelöscht.');
    if (!confirmed2) return;

    setPortalLoading(true);
    setPortalError('');
    try {
      const { data, error } = await supabase.functions.invoke('delete-account');
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      // User is deleted — redirect to homepage
      window.location.href = '/';
    } catch (err) {
      setPortalError('Fehler beim Löschen: ' + err.message);
      setPortalLoading(false);
    }
  };

  /* ── Open Stripe Customer Portal ── */
  const handlePortal = async () => {
    setPortalLoading(true);
    setPortalError('');
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session');
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setPortalError(err.message || 'Portal konnte nicht geöffnet werden.');
    }
    setPortalLoading(false);
  };

  return (
    <Page>
      <PageTitle>Einstellungen</PageTitle>
      <PageSub>Dein Profil, Abo und Zahlungsdetails.</PageSub>

      {/* ── PLAN & BILLING ── */}
      <Card $d="0s" style={{ borderTop: '4px solid var(--color-accent)' }}>
        <CardTitle>Abo & Abrechnung</CardTitle>
        <CardSub>Verwalte dein Abo, ändere den Tarif oder kündige jederzeit.</CardSub>

        {plan === 'trial' && daysLeft !== null && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontFamily: 'var(--font-body)', fontSize: '.72rem',
              color: 'var(--color-text-muted)', marginBottom: 6,
            }}>
              <span>Trial-Fortschritt</span>
              <span style={{ color: trialUrgent ? '#D93025' : 'var(--color-text-muted)', fontWeight: 700 }}>
                {daysLeft} von {pricing.trialDays} Tagen übrig
              </span>
            </div>
            <div style={{
              height: 6, background: 'var(--color-border)',
              borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.max(4, (daysLeft / pricing.trialDays) * 100)}%`,
                background: trialUrgent ? '#D93025' : 'var(--color-accent)',
                borderRadius: 3, transition: 'width .5s ease',
              }} />
            </div>
          </div>
        )}
        <PlanRow>
          <PlanInfo>
            <PlanBadge $plan={plan}>
              {plan === 'pro' && <CheckCircle size={11} />}
              {plan === 'trial' && <CheckCircle size={11} />}
              {plan === 'free' && <AlertTriangle size={11} />}
              {plan === 'pro' ? 'Aktiv' : plan === 'trial' ? 'Test-Phase' : 'Free'}
            </PlanBadge>
            <PlanName>{planLabels[plan] || plan}</PlanName>
            {plan === 'trial' && trialEnds && (
              <PlanDetail style={{ color: trialUrgent ? '#D93025' : undefined }}>
                {daysLeft === 0
                  ? 'Test ist heute abgelaufen'
                  : daysLeft <= 5
                    ? `⚠ Nur noch ${daysLeft} Tag${daysLeft === 1 ? '' : 'e'} — endet am ${trialEnds}`
                    : `Endet am ${trialEnds} (${daysLeft} Tage)`
                }
              </PlanDetail>
            )}
            {plan === 'free' && (
              <PlanDetail>Kein aktives Abo — jetzt upgraden</PlanDetail>
            )}
            {plan === 'pro' && profile?.stripe_subscription_status && (
              <PlanDetail>Status: {profile.stripe_subscription_status}</PlanDetail>
            )}
          </PlanInfo>

          <div>
            {hasStripeCustomer ? (
              <>
                <PortalBtn onClick={handlePortal} disabled={portalLoading}>
                  {portalLoading
                    ? <><Loader size={15} className="spin" />Wird geöffnet…</>
                    : <><CreditCard size={15} />Abo & Zahlungen verwalten <ExternalLink size={13} /></>
                  }
                </PortalBtn>
                <p style={{
                  fontFamily: 'var(--font-body)', fontSize: '.72rem',
                  color: '#A0ADB8', marginTop: 6
                }}>
                  Öffnet das sichere Stripe-Portal
                </p>
              </>
            ) : (
              <PortalBtn
                onClick={() => window.location.href = '/dashboard'}
                style={{ background: 'var(--color-accent)' }}
              >
                <CreditCard size={15} />
                Jetzt upgraden
              </PortalBtn>
            )}
            {portalError && <ErrorBanner>{portalError}</ErrorBanner>}
          </div>
        </PlanRow>
      </Card>

      {/* ── ACCOUNT INFO ── */}
      <Card $d=".08s">
        <CardTitle>Account</CardTitle>
        <CardSub>Deine Anmeldedaten und Betriebsinformationen.</CardSub>

        <InfoGrid>
          <InfoItem>
            <InfoLabel>E-Mail</InfoLabel>
            <InfoValue>{user?.email || '—'}</InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel>Betrieb</InfoLabel>
            <InfoValue>{profile?.company_name || '—'}</InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel>Stadt</InfoLabel>
            <InfoValue>{profile?.city || '—'}</InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel>Branche</InfoLabel>
            <InfoValue>{profile?.industry_key || brand.key}</InfoValue>
          </InfoItem>
          {profile?.setup_fee_paid && (
            <InfoItem style={{ background: '#E8F5E9', border: '1px solid #A5D6A7' }}>
              <InfoLabel>Setup</InfoLabel>
              <InfoValue style={{ color: '#1E7E34', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={14} /> Bezahlt
              </InfoValue>
            </InfoItem>
          )}
        </InfoGrid>
      </Card>

      {/* ── DANGER ZONE ── */}
      <Card $d=".16s" style={{ borderColor: '#FFCDD2' }}>
        <CardTitle style={{ color: '#D93025' }}>Konto löschen</CardTitle>
        <CardSub>
          Dein Konto und alle Daten werden dauerhaft gelöscht.
          Dein Google Business Profil bleibt davon unberührt — es gehört dir.
        </CardSub>
        <PortalBtn
          style={{ background: 'none', border: '1px solid #D93025', color: '#D93025' }}
          onClick={handleDeleteAccount}
          disabled={portalLoading}
        >
          Konto & alle Daten löschen (DSGVO)
        </PortalBtn>
        {portalError && <ErrorBanner style={{ marginTop: 10 }}>{portalError}</ErrorBanner>}
      </Card>
    </Page>
  );
}
