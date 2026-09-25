import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Mail } from 'lucide-react';
import supabase from '../supabaseClient';
import { useIndustry } from '../context/IndustryContext';

const Page = styled.main`min-height:100vh;background:var(--color-primary);display:flex;align-items:center;justify-content:center;padding:32px 20px;`;
const Card = styled.section`width:100%;max-width:460px;background:white;border-top:5px solid var(--color-accent);border-radius:var(--radius-card);padding:40px;`;
const Logo = styled(Link)`display:block;text-align:center;color:var(--color-primary);font-family:var(--font-display);font-weight:900;text-decoration:none;letter-spacing:.08em;`;
const Title = styled.h1`margin:12px 0 8px;text-align:center;color:var(--color-primary);font-size:1.8rem;`;
const Copy = styled.p`margin:0 0 24px;text-align:center;color:var(--color-text-muted);font-family:var(--font-body);line-height:1.6;`;
const Label = styled.label`display:block;margin-bottom:7px;color:var(--color-primary);font:600 .78rem var(--font-body);text-transform:uppercase;letter-spacing:.08em;`;
const InputRow = styled.div`position:relative;svg{position:absolute;left:13px;top:13px;color:#82909d;}`;
const Input = styled.input`width:100%;padding:12px 14px 12px 42px;border:2px solid var(--color-border);border-radius:var(--radius-card);font:inherit;`;
const Button = styled.button`width:100%;margin-top:16px;padding:14px;border:0;border-radius:var(--radius-button);background:var(--color-accent);color:white;font-family:var(--font-display);font-weight:700;cursor:pointer;&:disabled{opacity:.55;cursor:not-allowed;}`;
const Banner = styled.div`margin-bottom:18px;padding:12px 14px;border-left:3px solid ${({ $error }) => $error ? '#d93025' : '#1e7e34'};background:${({ $error }) => $error ? '#fdecea' : '#edf8f0'};color:${({ $error }) => $error ? '#b3261e' : '#17652b'};font: .84rem/1.5 var(--font-body);`;
const Back = styled(Link)`display:block;margin-top:20px;text-align:center;color:var(--color-text-muted);font: .82rem var(--font-body);`;

const NEUTRAL_SUCCESS = 'Wenn ein Konto zu dieser E-Mail existiert, haben wir einen Link zum Zurücksetzen gesendet.';

function isEnumerationError(error) {
  return /user not found|email not found|not registered/i.test(error?.message || '');
}

export default function ForgotPassword() {
  const { brand } = useIndustry();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }
    setLoading(true);
    let resetError;
    try {
      ({ error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      }));
    } catch (requestError) {
      resetError = requestError;
    } finally {
      setLoading(false);
    }
    if (resetError && !isEnumerationError(resetError)) {
      setError('Der Link konnte gerade nicht angefordert werden. Bitte versuche es später erneut.');
      return;
    }
    setMessage(NEUTRAL_SUCCESS);
  };

  return <Page><Card>
    <Logo to="/">{brand.logo}</Logo>
    <Title>Passwort zurücksetzen</Title>
    <Copy>Gib deine E-Mail-Adresse ein. Wir senden dir einen zeitlich begrenzten Reset-Link.</Copy>
    {message && <Banner role="status">{message}</Banner>}
    {error && <Banner role="alert" $error>{error}</Banner>}
    <form onSubmit={submit} noValidate>
      <Label htmlFor="reset-email">E-Mail</Label>
      <InputRow><Mail size={17}/><Input id="reset-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></InputRow>
      <Button disabled={loading}>{loading ? 'Wird gesendet…' : 'Reset-Link senden'}</Button>
    </form>
    <Back to="/login">Zurück zum Login</Back>
  </Card></Page>;
}

export { NEUTRAL_SUCCESS };
