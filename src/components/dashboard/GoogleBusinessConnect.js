import React from 'react';
import styled, { keyframes } from 'styled-components';
import {
  Link2, CheckCircle, AlertTriangle, Loader, RefreshCw, Unlink, Shield,
} from 'lucide-react';
import { useIndustry } from '../../context/IndustryContext';
import { useGoogleBusiness } from '../../hooks/useGoogleBusiness';

/* ─────────────────────────────────────────────
   GoogleBusinessConnect

   Ersetzt das "In Kürze verfügbar"-Modal aus DashboardHome.
   Drei Zustände: nicht verbunden / verbunden / Verbindung kaputt.

   Styling folgt dem bestehenden Design-System (CSS-Variablen aus
   ThemeInjector) und funktioniert damit ohne Änderung auch unter
   GASTRORUF und BEAUTYRUF.
───────────────────────────────────────────── */

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

const Card = styled.div`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-left: 4px solid ${({ $state }) =>
    $state === 'connected' ? '#1E7E34' : $state === 'broken' ? '#D93025' : 'var(--color-accent)'};
  border-radius: var(--radius-card);
  padding: 22px;
  margin-bottom: 18px;
  animation: ${fadeUp} .4s ease both;
`;

const Head = styled.div`display:flex;align-items:flex-start;gap:14px;margin-bottom:14px;`;

const IconWrap = styled.div`
  width: 42px; height: 42px; flex-shrink: 0;
  border-radius: var(--radius-card);
  background: ${({ $state }) =>
    $state === 'connected' ? '#E8F5E9' : $state === 'broken' ? '#FDECEA' : 'rgba(var(--color-accent-rgb), .1)'};
  color: ${({ $state }) =>
    $state === 'connected' ? '#1E7E34' : $state === 'broken' ? '#D93025' : 'var(--color-accent)'};
  display: flex; align-items: center; justify-content: center;
`;

const Title = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.1rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px; line-height: 1.2;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); line-height: 1.6;
`;

const Account = styled.p`
  font-family: var(--font-body); font-size: .85rem; font-weight: 700;
  color: var(--color-primary); margin-top: 6px;
  word-break: break-all;
`;

const Banner = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px; margin-bottom: 14px;
  border-radius: var(--radius-card);
  background: ${({ $type }) => ($type === 'error' ? '#FDECEA' : '#E8F5E9')};
  color:      ${({ $type }) => ($type === 'error' ? '#B3261E' : '#1E7E34')};
  font-family: var(--font-body); font-size: .82rem; line-height: 1.5;
`;

const BenefitList = styled.ul`
  list-style: none; margin: 0 0 18px; padding: 0;
  display: grid; gap: 8px;
`;

const Benefit = styled.li`
  display: flex; align-items: flex-start; gap: 8px;
  font-family: var(--font-body); font-size: .84rem;
  color: var(--color-text); line-height: 1.5;
  svg { color: var(--color-accent); flex-shrink: 0; margin-top: 2px; }
`;

const Actions = styled.div`display:flex;gap:10px;flex-wrap:wrap;align-items:center;`;

const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 20px;
  background: var(--color-accent); color: #fff;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .85rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover:not(:disabled) { filter: brightness(.9); }
  &:disabled { opacity: .6; cursor: not-allowed; }
`;

const GhostBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 16px;
  background: transparent; color: var(--color-text-muted);
  border: 1px solid var(--color-border); border-radius: var(--radius-button);
  font-family: var(--font-body); font-size: .8rem; cursor: pointer;
  transition: border-color .2s, color .2s;
  &:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
  &:disabled { opacity: .5; cursor: not-allowed; }
`;

const Spinner = styled(Loader)`animation: ${spin} .8s linear infinite;`;

const Privacy = styled.p`
  display: flex; align-items: flex-start; gap: 7px;
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--color-border);
  font-family: var(--font-body); font-size: .74rem;
  color: var(--color-text-muted); line-height: 1.5;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const Skeleton = styled.div`
  height: 130px; border-radius: var(--radius-card);
  background: var(--color-bg); margin-bottom: 18px;
`;

export default function GoogleBusinessConnect() {
  const { brand } = useIndustry();
  const {
    activeConnection, brokenConnection, isConnected, needsReauth,
    loading, busy, error, notice, connect, disconnect,
  } = useGoogleBusiness();

  if (loading) return <Skeleton />;

  const state = isConnected ? 'connected' : needsReauth ? 'broken' : 'idle';
  const connection = activeConnection || brokenConnection;

  const handleDisconnect = () => {
    const confirmed = window.confirm(
      'Verbindung zu Google trennen? Automatische Profil-Updates und Bewertungs-Antworten werden danach eingestellt.',
    );
    if (confirmed) disconnect(connection.id);
  };

  return (
    <Card $state={state}>
      <Head>
        <IconWrap $state={state}>
          {state === 'connected' ? <CheckCircle size={20} />
            : state === 'broken' ? <AlertTriangle size={20} />
            : <Link2 size={20} />}
        </IconWrap>
        <div>
          <Title>
            {state === 'connected' ? 'Google-Profil verbunden'
              : state === 'broken' ? 'Verbindung unterbrochen'
              : 'Google-Profil verbinden'}
          </Title>
          <Sub>
            {state === 'connected'
              ? `${brand.name} kann dein Google Business Profil jetzt automatisch pflegen.`
              : state === 'broken'
                ? 'Der Zugriff wurde bei Google widerrufen oder ist abgelaufen. Bis zur Erneuerung pausieren alle automatischen Aktualisierungen.'
                : `Verbinde dein Google Business Profil — danach übernimmt ${brand.name} Optimierung, Bewertungsantworten und Monitoring.`}
          </Sub>
          {connection?.googleAccountEmail && (
            <Account>{connection.googleAccountEmail}</Account>
          )}
        </div>
      </Head>

      {error  && <Banner $type="error"><AlertTriangle size={15} />{error}</Banner>}
      {notice && <Banner $type="ok"><CheckCircle size={15} />{notice}</Banner>}

      {state === 'idle' && (
        <BenefitList>
          <Benefit><CheckCircle size={14} />Öffnungszeiten, Leistungen und Beschreibung bleiben automatisch aktuell</Benefit>
          <Benefit><CheckCircle size={14} />Bewertungen landen direkt im Dashboard — inklusive Antwortvorschlag</Benefit>
          <Benefit><CheckCircle size={14} />Sichtbarkeits-Kennzahlen kommen aus deinem echten Profil statt aus Schätzungen</Benefit>
        </BenefitList>
      )}

      <Actions>
        {state === 'connected' ? (
          <>
            <GhostBtn onClick={() => connect(connection.id)} disabled={busy}>
              {busy ? <Spinner size={14} /> : <RefreshCw size={14} />} Berechtigungen erneuern
            </GhostBtn>
            <GhostBtn onClick={handleDisconnect} disabled={busy}>
              <Unlink size={14} /> Trennen
            </GhostBtn>
          </>
        ) : (
          <PrimaryBtn onClick={() => connect(connection?.id || null)} disabled={busy}>
            {busy ? <Spinner size={16} /> : <Link2 size={16} />}
            {state === 'broken' ? 'Neu verbinden' : 'Mit Google verbinden'}
          </PrimaryBtn>
        )}
      </Actions>

      <Privacy>
        <Shield size={13} />
        Wir fordern ausschliesslich die Berechtigung zur Verwaltung deines Google
        Business Profils an — kein Zugriff auf E-Mails, Kontakte oder Dateien.
        Die Freigabe kannst du jederzeit hier oder in deinem Google-Konto widerrufen.
      </Privacy>
    </Card>
  );
}
