import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import {
  CreditCard, ExternalLink, CheckCircle,
  AlertTriangle, Loader
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useBetriebsname } from '../../hooks/useBetriebsname';
import { useIndustry } from '../../context/IndustryContext';
import { useCheckout } from '../../hooks/useCheckout';
import KontoLoeschen, { AboKuendigenHinweis } from '../../components/dashboard/KontoLoeschen';
import NotificationSettings from '../../components/dashboard/NotificationSettings';
import supabase from '../../supabaseClient';
import {
  isCancellationScheduled,
  isFoundingPartner,
  hatAktivesStripeAltabo,
} from '../../utils/subscription';

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
    $plan === 'pro'              ? 'rgba(var(--color-accent-rgb),.1)' :
    $plan === 'trial'            ? '#E8F5E9' :
    $plan === 'founding_partner' ? 'rgba(var(--color-accent-rgb),.12)' : 'var(--color-bg)'};
  color: ${({ $plan }) =>
    $plan === 'pro'              ? 'var(--color-accent)' :
    $plan === 'trial'            ? '#1E7E34' :
    $plan === 'founding_partner' ? 'var(--color-accent)' : 'var(--color-text-muted)'};
  border: 1px solid ${({ $plan }) =>
    $plan === 'pro'              ? 'rgba(var(--color-accent-rgb),.3)' :
    $plan === 'trial'            ? '#A5D6A7' :
    $plan === 'founding_partner' ? 'rgba(var(--color-accent-rgb),.35)' : 'var(--color-border)'};
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

const InfoHinweis = styled.p`
  font-family: var(--font-body); font-size: .72rem; line-height: 1.45;
  color: var(--color-text-muted); margin: 3px 0 0;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardSettings() {
  const { user, profile }     = useAuthContext();
  /* Google-Name vor Registrierungsname — siehe hooks/useBetriebsname.js. */
  const { googleName }        = useBetriebsname();
  const { brand, pricing }    = useIndustry();
  const [portalLoading, setPortalLoading] = useState(false);

  /* Neukunden-Weg zu Stripe.
     Stand vorher auf window.location.href = '/dashboard' — ein
     Platzhalter, der nie ersetzt wurde. Der Knopf fuehrte also von der
     Einstellungsseite zurueck aufs Dashboard, ohne dass irgendetwas
     passierte. */
  const {
    startCheckout,
    loading: checkoutLoading,
    error:   checkoutError,
  } = useCheckout();
  const [portalError,   setPortalError]   = useState('');

  const plan = profile?.plan || 'free';

  /* ── Founding Partner gewinnt (H2.2 §15) ──

     Vor dieser Aenderung sah ein Founding Partner hier:

       Badge     Free
       PlanName  founding_partner       (planLabels hatte keinen Eintrag,
                                         also der rohe Spaltenwert)
       CTA       Jetzt upgraden
       Fusszeile 30 Tage kostenlos — danach 49 € / Monat

     Und mit einem stripe_subscription_status 'trialing' aus seiner
     Zeit als Zahler zusaetzlich die Trial-Fortschrittsleiste samt
     "x von 30 Tagen uebrig". Alles vier falsch: sein Zugang kostet
     nichts, laeuft nicht ab und haengt nicht an Stripe.

     Deshalb steht die Abfrage VOR allem, was Stripe liest — genau wie
     in hasPaidAccess, und aus demselben Grund: die ersten Founding
     Partner werden bestehende Nutzer sein und tragen Stripe-Spuren. */
  const foundingPartner  = isFoundingPartner(profile);
  const stripeAltaboAktiv = hatAktivesStripeAltabo(profile);

  const isTrial = !foundingPartner
    && (profile?.stripe_subscription_status === 'trialing' || plan === 'trial');
  const hasStripeCustomer = !!profile?.stripe_customer_id;

  const trialEndsDate = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const trialEnds     = trialEndsDate
    ? trialEndsDate.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;
  const daysLeft = trialEndsDate
    ? Math.max(0, Math.ceil((trialEndsDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const trialUrgent = daysLeft !== null && daysLeft <= 5;
  const cancellationScheduled = isCancellationScheduled(profile);
  const periodEnd = profile?.stripe_current_period_end
    ? new Date(profile.stripe_current_period_end).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'long', year: 'numeric',
      })
    : null;

  const planLabels = {
    free:              'Kostenloser Plan',
    trial:             `${pricing.trialDays} Tage Gratis-Test`,
    pro:               `${pricing.productName}`,
    /* Nicht "Lifetime free" und nicht "Für immer kostenlos" (§14).
       Das Programm kann enden; ein Versprechen, das wir nicht halten
       koennen, waere genau die Art falscher Zusage, die H2.2
       schliessen soll. */
    founding_partner:  'Founding Partner',
  };

  /* Konto loeschen: seit 22.10.2026 (WP1) in
     components/dashboard/KontoLoeschen.js — eigener Dialog statt
     window.confirm, mit vollstaendiger Folgenliste und
     Tipp-Bestaetigung. Die Abo-Alternative steht davor. */

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
        <CardSub>
          {foundingPartner
            ? 'Dein Zugang im Founding-Partner-Programm.'
            : 'Verwalte dein Abo, ändere den Tarif oder kündige jederzeit.'}
        </CardSub>

        {isTrial && daysLeft !== null && (
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
            <PlanBadge $plan={isTrial ? 'trial' : plan}>
              {(plan === 'pro' || plan === 'trial' || foundingPartner) && <CheckCircle size={11} />}
              {plan === 'free' && <AlertTriangle size={11} />}
              {foundingPartner
                ? 'Founding Partner'
                : isTrial ? 'Test-Phase' : plan === 'pro' ? 'Aktiv' : 'Free'}
            </PlanBadge>
            <PlanName>
              {isTrial ? `${pricing.trialDays} Tage Gratis-Test` : (planLabels[plan] || plan)}
            </PlanName>
            {foundingPartner && (
              <PlanDetail>
                Kostenlos, solange du Teil des Founding-Partner-Programms bist.
              </PlanDetail>
            )}
            {isTrial && trialEnds && (
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
            {cancellationScheduled && (
              <PlanDetail style={{ color: '#D48A00', fontWeight: 700 }}>
                Gekündigt — Zugang bis {periodEnd || 'zum Ende des Abrechnungszeitraums'}
              </PlanDetail>
            )}
          </PlanInfo>

          <div>
            {/* ── Founding Partner: kein Upgrade, kein Preis, kein Druck ──

                §16 ist eine Produktentscheidung, nicht eine
                Darstellungsfrage: Founding Partner sollen nicht zum
                Portal oder zum Upgrade gedraengt werden. Ein Knopf
                "Abo & Zahlungen verwalten" bei jemandem, der kein Abo
                hat, ist genau dieser Druck — und er fuehrt zu einem
                Portal, in dem es nichts zu verwalten gibt.

                Eine Ausnahme, und die ist der Grund, warum hier nicht
                einfach nichts steht: laeuft parallel noch ein aktives
                Altabo, wird gerade Geld abgebucht fuer einen Zugang,
                der kostenlos ist. Das wird benannt und verlinkt, statt
                es stillschweigend zu uebergehen. */}
            {foundingPartner ? (
              stripeAltaboAktiv ? (
                <>
                  <PlanDetail style={{ color: '#D48A00', fontWeight: 700, marginTop: 0 }}>
                    Bei Stripe läuft noch ein Abo (Status:{' '}
                    {profile?.stripe_subscription_status}).
                  </PlanDetail>
                  <PlanDetail>
                    Dein Zugang ist als Founding Partner kostenlos — dieses Abo
                    brauchst du dafür nicht.
                  </PlanDetail>
                  <PortalBtn
                    onClick={handlePortal}
                    disabled={portalLoading}
                    style={{ marginTop: 8 }}
                  >
                    {portalLoading
                      ? <><Loader size={15} className="spin" />Wird geöffnet…</>
                      : <><CreditCard size={15} />Altes Abo bei Stripe prüfen <ExternalLink size={13} /></>
                    }
                  </PortalBtn>
                </>
              ) : null
            ) : hasStripeCustomer ? (
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
              <>
                <PortalBtn
                  /* Fest auf 'monthly': kommuniziert werden derzeit nur
                     die 49 EUR pro Monat. Sobald Quartal und Jahr
                     beworben werden, gehoert hier eine Auswahl hin oder
                     ein Verweis auf /pricing. */
                  onClick={() => startCheckout({
                    plan:        'monthly',
                    companyName: profile?.company_name || '',
                    industryKey: profile?.industry_key || 'handwerk',
                  })}
                  disabled={checkoutLoading}
                  style={{ background: 'var(--color-accent)' }}
                >
                  {checkoutLoading
                    ? <><Loader size={15} className="spin" />Weiterleitung zu Stripe…</>
                    : <><CreditCard size={15} />Jetzt upgraden</>
                  }
                </PortalBtn>
                <p style={{
                  fontFamily: 'var(--font-body)', fontSize: '.72rem',
                  color: '#A0ADB8', marginTop: 6
                }}>
                  30 Tage kostenlos — danach 49 € / Monat, jederzeit kündbar
                </p>
                {checkoutError && <ErrorBanner>{checkoutError}</ErrorBanner>}
              </>
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
          {/* Beide Namen, jeder mit seiner Herkunft.
              Sie weichen bei Handwerksbetrieben oft voneinander ab —
              „Firma Rolf Müller Sanitär und Heizungstechnik" im
              Gewerbeschein, „Sanitär Müller" bei Google. Nur einen zu
              zeigen, führte zu der Verwechslung vom 29.09. */}
          <InfoItem>
            <InfoLabel>Rechnungsname</InfoLabel>
            <InfoValue>{profile?.company_name || '—'}</InfoValue>
            <InfoHinweis>Für Rechnungen und Anrede. Nicht öffentlich.</InfoHinweis>
          </InfoItem>
          {googleName && (
            <InfoItem>
              <InfoLabel>Google-Unternehmensprofil</InfoLabel>
              <InfoValue>{googleName}</InfoValue>
              <InfoHinweis>Dieser Name steht im Dashboard und ist der, den Kunden sehen.</InfoHinweis>
            </InfoItem>
          )}
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
      {/* Benachrichtigungen — die Gegenseite zum proaktiven Melden.
          Steht vor dem Löschbereich, weil sie öfter gebraucht wird. */}
      <NotificationSettings />

      {/* ── ABO KUENDIGEN (Alternative) → KONTO LOESCHEN ──
          Reihenfolge ist Absicht: Wer nur nicht mehr zahlen will,
          soll den milderen Weg zuerst sehen. */}
      <AboKuendigenHinweis
        sichtbar={!foundingPartner && hasStripeCustomer && !cancellationScheduled
          && ['active', 'trialing', 'past_due'].includes(profile?.stripe_subscription_status)}
        periodeEndet={periodEnd}
        onPortal={handlePortal}
        laeuft={portalLoading}
      />
      <KontoLoeschen
        aboAktiv={!!profile?.stripe_subscription_id
          && ['active', 'trialing', 'past_due'].includes(profile?.stripe_subscription_status)}
        foundingPartner={foundingPartner}
        email={user?.email}
      />
    </Page>
  );
}
