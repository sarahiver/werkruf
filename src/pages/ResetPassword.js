import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import supabase from '../supabaseClient';
import { useAuthContext } from '../context/AuthContext';
import { useIndustry } from '../context/IndustryContext';

const Page = styled.main`min-height:100vh;background:var(--color-primary);display:flex;align-items:center;justify-content:center;padding:32px 20px;`;
const Card = styled.section`width:100%;max-width:460px;background:white;border-top:5px solid var(--color-accent);border-radius:var(--radius-card);padding:40px;`;
const Logo = styled(Link)`display:block;text-align:center;color:var(--color-primary);font-family:var(--font-display);font-weight:900;text-decoration:none;letter-spacing:.08em;`;
const Title = styled.h1`margin:12px 0 8px;text-align:center;color:var(--color-primary);font-size:1.8rem;`;
const Copy = styled.p`margin:0 0 24px;text-align:center;color:var(--color-text-muted);font-family:var(--font-body);line-height:1.6;`;
const Label = styled.label`display:block;margin:14px 0 7px;color:var(--color-primary);font:600 .78rem var(--font-body);text-transform:uppercase;letter-spacing:.08em;`;
const Input = styled.input`width:100%;padding:12px 14px;border:2px solid var(--color-border);border-radius:var(--radius-card);font:inherit;`;
const Button = styled.button`width:100%;margin-top:18px;padding:14px;border:0;border-radius:var(--radius-button);background:var(--color-accent);color:white;font-family:var(--font-display);font-weight:700;cursor:pointer;&:disabled{opacity:.55;cursor:not-allowed;}`;
const Banner = styled.div`margin:18px 0;padding:12px 14px;border-left:3px solid ${({ $ok }) => $ok ? '#1e7e34' : '#d93025'};background:${({ $ok }) => $ok ? '#edf8f0' : '#fdecea'};color:${({ $ok }) => $ok ? '#17652b' : '#b3261e'};font: .84rem/1.5 var(--font-body);`;

function linkError() {
  const values = new URLSearchParams(`${window.location.search}&${window.location.hash.replace(/^#/, '')}`);
  return values.get('error_description') || values.get('error');
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const { brand } = useIndustry();
  const { user, loading: authLoading, recoveryMode, completePasswordRecovery } = useAuthContext();
  const callbackError = useMemo(linkError, []);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const validRecovery = Boolean(user && recoveryMode && !callbackError);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) return setError('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
    if (password !== confirmation) return setError('Die Passwörter stimmen nicht überein.');
    setSaving(true);
    let updateError;
    try {
      ({ error: updateError } = await supabase.auth.updateUser({ password }));
    } catch (requestError) {
      updateError = requestError;
    } finally {
      setSaving(false);
    }
    if (updateError) {
      setError('Das Passwort konnte nicht geändert werden. Der Link ist möglicherweise abgelaufen.');
      return;
    }
    completePasswordRecovery();
    setSuccess(true);
    window.setTimeout(() => navigate('/dashboard', { replace: true }), 900);
  };

  return <Page><Card>
    <Logo to="/">{brand.logo}</Logo>
    <Title>Neues Passwort setzen</Title>
    {authLoading && <Copy role="status">Recovery-Link wird geprüft…</Copy>}
    {!authLoading && !validRecovery && <>
      <Banner role="alert">Dieser Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.</Banner>
      <Button type="button" onClick={() => navigate('/forgot-password')}>Neuen Link anfordern</Button>
    </>}
    {!authLoading && validRecovery && !success && <>
      <Copy>Wähle ein neues Passwort mit mindestens 8 Zeichen.</Copy>
      {error && <Banner role="alert">{error}</Banner>}
      <form onSubmit={submit} noValidate>
        <Label htmlFor="new-password">Neues Passwort</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        <Label htmlFor="confirm-password">Passwort bestätigen</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
        <Button disabled={saving}>{saving ? 'Wird gespeichert…' : 'Passwort speichern'}</Button>
      </form>
    </>}
    {success && <Banner role="status" $ok>Dein Passwort wurde geändert. Du wirst zum Dashboard weitergeleitet.</Banner>}
  </Card></Page>;
}
