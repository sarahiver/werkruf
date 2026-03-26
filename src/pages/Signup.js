import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Chrome } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';
import supabase from '../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Page = styled.div`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex; align-items: center; justify-content: center;
  padding: 80px 24px;
  position: relative; overflow: hidden;
`;

const GridBg = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb),.04) 1px, transparent 1px);
  background-size: 44px 44px;
`;

const Card = styled.div`
  background: var(--color-white);
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 48px 44px;
  max-width: 480px; width: 100%;
  animation: ${fadeUp} .5s ease both;
  @media(max-width:560px){padding:32px 24px;}
`;

const LogoLink = styled(Link)`
  display: block; text-align: center;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.5rem; letter-spacing: .08em; text-transform: var(--text-transform);
  color: var(--color-primary); text-decoration: none;
  margin-bottom: 8px;
`;

const Headline = styled.h1`
  font-size: clamp(1.6rem, 3vw, 2rem);
  text-transform: var(--text-transform);
  color: var(--color-primary);
  text-align: center; margin-bottom: 6px;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text-muted); text-align: center;
  margin-bottom: 32px; line-height: 1.5;
`;

/* Pre-fill banner */
const PrefillBanner = styled.div`
  background: rgba(var(--color-accent-rgb), .08);
  border: 1px solid rgba(var(--color-accent-rgb), .25);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 10px 14px; margin-bottom: 20px;
`;

const PrefillText = styled.p`
  font-family: var(--font-body); font-size: .8rem;
  color: var(--color-text-muted); line-height: 1.4;
  strong { color: var(--color-primary); font-weight: 700; }
`;

/* Google Button */
const GoogleBtn = styled.button`
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 13px 20px;
  background: var(--color-white);
  color: var(--color-text);
  font-family: var(--font-body); font-weight: 600; font-size: .95rem;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-button);
  cursor: pointer; transition: border-color .2s, box-shadow .2s;
  &:hover { border-color: var(--color-primary); box-shadow: 0 2px 8px rgba(var(--color-primary-rgb),.1); }
`;

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

const Divider = styled.div`
  display: flex; align-items: center; gap: 12px;
  margin: 20px 0;
`;

const DivLine = styled.div`flex:1; height:1px; background:var(--color-border);`;
const DivText = styled.span`
  font-family: var(--font-body); font-size: .75rem;
  color: #A0ADB8; white-space: nowrap;
`;

/* Form fields */
const Field = styled.div`margin-bottom: 16px;`;
const Label = styled.label`
  display: block; font-family: var(--font-body); font-weight: 600;
  font-size: .75rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--color-primary); margin-bottom: 6px;
`;

const InputWrap = styled.div`position: relative;`;

const Input = styled.input`
  width: 100%; padding: 12px 15px 12px ${({ $icon }) => $icon ? '42px' : '15px'};
  border: 2px solid ${({ $err }) => $err ? '#E53E3E' : 'var(--color-border)'};
  background: ${({ $err }) => $err ? '#FFF5F5' : 'var(--color-bg)'};
  color: var(--color-text); font-family: var(--font-body); font-size: .95rem;
  outline: none; border-radius: var(--radius-card);
  transition: border-color .2s;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
  &::placeholder { color: #A0ADB8; }
`;

const InputIcon = styled.div`
  position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
  color: #A0ADB8; display: flex; align-items: center;
`;

const TogglePass = styled.button`
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: #A0ADB8; display: flex; align-items: center;
  &:hover { color: var(--color-primary); }
`;

const ErrText = styled.p`
  font-family: var(--font-body); font-size: .75rem;
  color: #E53E3E; margin-top: 4px;
`;

const SubmitBtn = styled.button`
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px;
  background: ${({ disabled }) => disabled ? 'rgba(var(--color-accent-rgb),.5)' : 'var(--color-accent)'};
  color: white; font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: .07em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button);
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  transition: filter .2s, transform .1s; margin-top: 4px;
  &:hover:not(:disabled) { filter: brightness(.9); transform: translateY(-1px); }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const ErrorBanner = styled.div`
  padding: 11px 14px; background: #FDECEA;
  border-left: 3px solid #D93025; border-radius: var(--radius-card);
  font-family: var(--font-body); font-size: .83rem; color: #D93025;
  margin-bottom: 16px;
`;

const SwitchText = styled.p`
  font-family: var(--font-body); font-size: .83rem;
  color: var(--color-text-muted); text-align: center; margin-top: 20px;
  a { color: var(--color-accent); font-weight: 600; text-decoration: none;
      &:hover { text-decoration: underline; } }
`;

const TermsNote = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: #A0ADB8; text-align: center; margin-top: 12px; line-height: 1.5;
  a { color: var(--color-text-muted); }
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Signup() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isAuthenticated, signInGoogle, signUpEmail } = useAuthContext();
  const { brand, pricing } = useIndustry();

  // Pre-fill from SmartCheck success flow
  const prefillEmail  = location.state?.prefillEmail  || '';
  const prefillResult = location.state?.result        || null;

  const [email,    setEmail]    = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [fieldErr, setFieldErr] = useState({});

  // Already logged in → go to dashboard
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const validate = () => {
    const e = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Gültige E-Mail eingeben';
    if (!password || password.length < 8) e.password = 'Mindestens 8 Zeichen';
    return e;
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    const fe = validate();
    if (Object.keys(fe).length) { setFieldErr(fe); return; }
    setFieldErr({}); setError(''); setLoading(true);

    /* Meta passed to Supabase — handle_new_user trigger picks this up */
    const meta = {
      industry_key:    brand.key,
      google_place_id: prefillResult?.placeId   || null,
      company_name:    prefillResult?.name       || null,
      visibility_score:prefillResult?.score      || null,
    };

    const { error: signUpErr } = await signUpEmail(email, password, meta);

    if (signUpErr) {
      // Email already registered → try cross-linking lead data then redirect to login
      if (signUpErr.message?.includes('already registered')) {
        setError('Diese E-Mail ist bereits registriert. Bitte melde dich an.');
      } else {
        setError(signUpErr.message || 'Registrierung fehlgeschlagen.');
      }
      setLoading(false);
      return;
    }

    /* Cross-check: link existing lead data to new profile */
    await linkLeadToProfile(email, prefillResult);

    setLoading(false);
    // Supabase sends confirmation email — redirect to a "check your email" state
    navigate('/onboarding', {
      state: { justSignedUp: true, email },
      replace: true,
    });
  };

  const handleGoogleSignup = async () => {
    setError('');
    setLoading(true);
    await signInGoogle();
    // Redirect happens automatically via Supabase OAuth callback
  };

  return (
    <Page>
      <GridBg />
      <Card>
        <LogoLink to="/">{brand.logo}</LogoLink>

        <Headline>Konto erstellen</Headline>
        <Sub>
          {pricing.trialDays} Tage kostenlos — danach{' '}
          {pricing.monthlyPrice}{pricing.currency} / Monat. Jederzeit kündbar.
        </Sub>

        {/* Pre-fill banner from SmartCheck */}
        {prefillEmail && prefillResult && (
          <PrefillBanner>
            <PrefillText>
              Wir haben deine Analyse für <strong>{prefillResult.name}</strong> gespeichert —
              nach dem Signup direkt im Dashboard verfügbar.
            </PrefillText>
          </PrefillBanner>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {/* Google OAuth — primary */}
        <GoogleBtn type="button" onClick={handleGoogleSignup} disabled={loading}>
          <GoogleIcon />
          Mit Google fortfahren
        </GoogleBtn>

        <Divider>
          <DivLine /><DivText>oder mit E-Mail</DivText><DivLine />
        </Divider>

        {/* Email + Password */}
        <form onSubmit={handleEmailSignup} noValidate>
          <Field>
            <Label>E-Mail</Label>
            <InputWrap>
              <InputIcon><Mail size={16} /></InputIcon>
              <Input
                type="email" $icon $err={!!fieldErr.email}
                value={email}
                onChange={e => { setEmail(e.target.value); setFieldErr(p => ({...p, email: ''})); }}
                placeholder="deine@email.de"
                autoComplete="email"
              />
            </InputWrap>
            {fieldErr.email && <ErrText>{fieldErr.email}</ErrText>}
          </Field>

          <Field>
            <Label>Passwort</Label>
            <InputWrap>
              <InputIcon><Lock size={16} /></InputIcon>
              <Input
                type={showPass ? 'text' : 'password'}
                $icon $err={!!fieldErr.password}
                value={password}
                onChange={e => { setPassword(e.target.value); setFieldErr(p => ({...p, password: ''})); }}
                placeholder="Mindestens 8 Zeichen"
                autoComplete="new-password"
              />
              <TogglePass type="button" onClick={() => setShowPass(!showPass)}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </TogglePass>
            </InputWrap>
            {fieldErr.password && <ErrText>{fieldErr.password}</ErrText>}
          </Field>

          <SubmitBtn type="submit" disabled={loading}>
            {loading
              ? <><span className="spin" style={{ display:'inline-block', width:16, height:16, border:'2px solid rgba(255,255,255,.4)', borderTopColor:'white', borderRadius:'50%' }} />Wird registriert…</>
              : <>Konto erstellen <ArrowRight size={16} /></>
            }
          </SubmitBtn>
        </form>

        <SwitchText>
          Bereits registriert? <Link to="/login" state={location.state}>Einloggen</Link>
        </SwitchText>

        <TermsNote>
          Mit der Registrierung stimmst du unseren{' '}
          <a href="/datenschutz">Datenschutzbestimmungen</a> zu.
        </TermsNote>
      </Card>
    </Page>
  );
}

/* ─────────────────────────────────────────────
   CROSS-LINK: existing lead → new profile
───────────────────────────────────────────── */
async function linkLeadToProfile(email, result) {
  if (!email) return;
  try {
    // Get the newly created user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Find existing lead with same email
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lead && !result) return;

    // Merge lead data into profile
    const updates = {
      ...(lead?.google_place_id     && { google_place_id:      lead.google_place_id }),
      ...(lead?.google_rating       && { google_rating:         lead.google_rating }),
      ...(lead?.google_review_count && { google_review_count:   lead.google_review_count }),
      ...(lead?.visibility_score    && { visibility_score:      lead.visibility_score }),
      ...(lead?.company_name        && { company_name:           lead.company_name }),
      ...(lead?.city                && { city:                   lead.city }),
      ...(lead?.industry_key        && { industry_key:           lead.industry_key }),
      // Override with fresh result data if available
      ...(result?.placeId    && { google_place_id:    result.placeId }),
      ...(result?.rating     && { google_rating:       result.rating }),
      ...(result?.reviewCount && { google_review_count: result.reviewCount }),
      ...(result?.score      && { visibility_score:    result.score }),
      ...(result?.name       && { company_name:        result.name }),
      ...(result?.city       && { city:                result.city }),
    };

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', user.id);

      // Mark lead as converted
      if (lead?.id) {
        await supabase
          .from('leads')
          .update({ status: 'converted' })
          .eq('id', lead.id);
      }
    }
  } catch (err) {
    console.error('Lead cross-link failed:', err);
    // Non-blocking — don't throw
  }
}
