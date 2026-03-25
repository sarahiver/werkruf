import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

const Page = styled.div`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex; align-items: center; justify-content: center;
  padding: 80px 24px; position: relative; overflow: hidden;
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
  padding: 48px 44px; max-width: 480px; width: 100%;
  animation: ${fadeUp} .5s ease both;
  @media(max-width:560px){padding:32px 24px;}
`;

const LogoLink = styled(Link)`
  display: block; text-align: center;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.5rem; letter-spacing: .08em; text-transform: var(--text-transform);
  color: var(--color-primary); text-decoration: none; margin-bottom: 8px;
`;

const Headline = styled.h1`
  font-size: clamp(1.6rem, 3vw, 2rem);
  text-transform: var(--text-transform);
  color: var(--color-primary); text-align: center; margin-bottom: 6px;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .88rem;
  color: var(--color-text-muted); text-align: center; margin-bottom: 32px;
`;

const GoogleBtn = styled.button`
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 13px 20px;
  background: var(--color-white); color: var(--color-text);
  font-family: var(--font-body); font-weight: 600; font-size: .95rem;
  border: 2px solid var(--color-border); border-radius: var(--radius-button);
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

const Divider = styled.div`display:flex;align-items:center;gap:12px;margin:20px 0;`;
const DivLine = styled.div`flex:1;height:1px;background:var(--color-border);`;
const DivText = styled.span`font-family:var(--font-body);font-size:.75rem;color:#A0ADB8;white-space:nowrap;`;

const Field = styled.div`margin-bottom:16px;`;
const Label = styled.label`
  display:block;font-family:var(--font-body);font-weight:600;
  font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--color-primary);margin-bottom:6px;
`;
const InputWrap = styled.div`position:relative;`;
const Input = styled.input`
  width:100%;padding:12px 15px 12px ${({ $icon }) => $icon?'42px':'15px'};
  border:2px solid ${({ $err }) => $err?'#E53E3E':'var(--color-border)'};
  background:${({ $err }) => $err?'#FFF5F5':'var(--color-bg)'};
  color:var(--color-text);font-family:var(--font-body);font-size:.95rem;
  outline:none;border-radius:var(--radius-card);transition:border-color .2s;
  &:focus{border-color:var(--color-primary);background:var(--color-white);}
  &::placeholder{color:#A0ADB8;}
`;
const InputIcon = styled.div`
  position:absolute;left:13px;top:50%;transform:translateY(-50%);
  color:#A0ADB8;display:flex;align-items:center;
`;
const TogglePass = styled.button`
  position:absolute;right:12px;top:50%;transform:translateY(-50%);
  background:none;border:none;cursor:pointer;color:#A0ADB8;display:flex;align-items:center;
  &:hover{color:var(--color-primary);}
`;
const ErrText = styled.p`font-family:var(--font-body);font-size:.75rem;color:#E53E3E;margin-top:4px;`;

const ForgotLink = styled(Link)`
  display:block;text-align:right;font-family:var(--font-body);
  font-size:.78rem;color:var(--color-text-muted);margin-top:-8px;margin-bottom:16px;
  text-decoration:none;
  &:hover{color:var(--color-accent);}
`;

const SubmitBtn = styled.button`
  width:100%;display:flex;align-items:center;justify-content:center;gap:8px;
  padding:14px;
  background:${({ disabled }) => disabled?'rgba(var(--color-accent-rgb),.5)':'var(--color-accent)'};
  color:white;font-family:var(--font-display);font-weight:var(--heading-weight);
  font-size:1rem;letter-spacing:.07em;text-transform:var(--text-transform);
  border:none;border-radius:var(--radius-button);
  cursor:${({ disabled }) => disabled?'not-allowed':'pointer'};
  transition:filter .2s,transform .1s;margin-top:4px;
  &:hover:not(:disabled){filter:brightness(.9);transform:translateY(-1px);}
`;

const ErrorBanner = styled.div`
  padding:11px 14px;background:#FDECEA;
  border-left:3px solid #D93025;border-radius:var(--radius-card);
  font-family:var(--font-body);font-size:.83rem;color:#D93025;margin-bottom:16px;
`;

const SwitchText = styled.p`
  font-family:var(--font-body);font-size:.83rem;
  color:var(--color-text-muted);text-align:center;margin-top:20px;
  a{color:var(--color-accent);font-weight:600;text-decoration:none;&:hover{text-decoration:underline;}}
`;

export default function Login() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isAuthenticated, signInGoogle, signInEmail } = useAuthContext();
  const { brand } = useIndustry();

  const from = location.state?.from?.pathname || '/dashboard';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [fieldErr, setFieldErr] = useState({});

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, navigate, from]);

  const validate = () => {
    const e = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Gültige E-Mail eingeben';
    if (!password) e.password = 'Passwort eingeben';
    return e;
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    const fe = validate();
    if (Object.keys(fe).length) { setFieldErr(fe); return; }
    setFieldErr({}); setError(''); setLoading(true);

    const { error: err } = await signInEmail(email, password);
    if (err) {
      setError('E-Mail oder Passwort falsch.');
      setLoading(false);
    }
    // on success: onAuthStateChange fires → navigate happens via useEffect
  };

  const handleGoogleLogin = async () => {
    setError(''); setLoading(true);
    await signInGoogle();
  };

  return (
    <Page>
      <GridBg />
      <Card>
        <LogoLink to="/">{brand.logo}</LogoLink>
        <Headline>Willkommen zurück</Headline>
        <Sub>Meld dich an, um zu deinem Dashboard zu gelangen.</Sub>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <GoogleBtn type="button" onClick={handleGoogleLogin} disabled={loading}>
          <GoogleIcon />
          Mit Google einloggen
        </GoogleBtn>

        <Divider><DivLine /><DivText>oder mit E-Mail</DivText><DivLine /></Divider>

        <form onSubmit={handleEmailLogin} noValidate>
          <Field>
            <Label>E-Mail</Label>
            <InputWrap>
              <InputIcon><Mail size={16} /></InputIcon>
              <Input type="email" $icon $err={!!fieldErr.email}
                value={email} placeholder="deine@email.de"
                onChange={e => { setEmail(e.target.value); setFieldErr(p => ({...p, email:''})); }}
                autoComplete="email" />
            </InputWrap>
            {fieldErr.email && <ErrText>{fieldErr.email}</ErrText>}
          </Field>

          <Field>
            <Label>Passwort</Label>
            <InputWrap>
              <InputIcon><Lock size={16} /></InputIcon>
              <Input type={showPass ? 'text' : 'password'} $icon $err={!!fieldErr.password}
                value={password} placeholder="Dein Passwort"
                onChange={e => { setPassword(e.target.value); setFieldErr(p => ({...p, password:''})); }}
                autoComplete="current-password" />
              <TogglePass type="button" onClick={() => setShowPass(!showPass)}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </TogglePass>
            </InputWrap>
            {fieldErr.password && <ErrText>{fieldErr.password}</ErrText>}
          </Field>

          <ForgotLink to="/forgot-password">Passwort vergessen?</ForgotLink>

          <SubmitBtn type="submit" disabled={loading}>
            {loading
              ? <><span style={{ display:'inline-block',width:16,height:16,border:'2px solid rgba(255,255,255,.4)',borderTopColor:'white',borderRadius:'50%',animation:`${spin} .8s linear infinite` }} />Einloggen…</>
              : <>Einloggen <ArrowRight size={16} /></>
            }
          </SubmitBtn>
        </form>

        <SwitchText>
          Noch kein Konto? <Link to="/signup" state={location.state}>Kostenlos registrieren</Link>
        </SwitchText>
      </Card>
    </Page>
  );
}
