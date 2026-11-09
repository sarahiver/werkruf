import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams, Navigate } from 'react-router-dom';
import HomePage from '../pages/HomePage';
import { istCodeForm, merkeEmpfehlung, EMPFEHLUNG_HINWEIS } from '../utils/empfehlung';

/*
 * WP10 — /empfehlen/<code>
 *
 * Rendert die normale Startseite plus einen kurzen Hinweis. Der Code
 * wird ueber die Edge Function geprueft (GET /referral/lookup, ohne
 * Login, nur ja/nein — kein Name, keine ID) und bei Gueltigkeit 30
 * Tage gemerkt. Ungueltig → Startseite ohne Hinweis, kein Fehler.
 * Kein Signup-Zwang. Kein anon-RPC in der Datenbank (Kanon).
 */

async function codeGueltig(code) {
  const base = process.env.REACT_APP_SUPABASE_URL;
  if (!base || typeof fetch !== 'function') return false;
  const response = await fetch(`${base}/functions/v1/google-business/referral/lookup?code=${encodeURIComponent(code)}`, {
    headers: { apikey: process.env.REACT_APP_SUPABASE_ANON_KEY },
  });
  const payload = await response.json().catch(() => null);
  return response.ok && payload?.valid === true;
}

/* Der oeffentliche Header ist position: fixed (72px, transparent ueber
   dem Hero). Ein Band im normalen Fluss laege dahinter — deshalb
   ebenfalls fixiert, direkt unter der Navigation, eine Ebene darunter. */
const Band = styled.div`
  position: fixed; top: 72px; left: 0; right: 0; z-index: 99;
  background: #FFF7ED; border-bottom: 1px solid #FED7AA;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .12);
  padding: 10px 16px; text-align: center;
  font-family: var(--font-body); font-size: .88rem; line-height: 1.4; color: var(--color-text);
  strong { display: block; color: var(--color-primary); }
`;

export default function EmpfehlungsHinweis() {
  const { code } = useParams();
  const [gueltig, setGueltig] = useState(null);

  useEffect(() => {
    let aktiv = true;
    if (!istCodeForm(code)) { setGueltig(false); return undefined; }
    (async () => {
      let ok = false;
      try { ok = await codeGueltig(code); } catch { ok = false; }
      if (!aktiv) return;
      setGueltig(ok);
      if (ok) merkeEmpfehlung(code);
    })();
    return () => { aktiv = false; };
  }, [code]);

  if (!istCodeForm(code)) return <Navigate to="/" replace />;

  return (
    <>
      {gueltig && (
        <Band data-testid="empfehlungs-hinweis" role="status">
          <strong>{EMPFEHLUNG_HINWEIS.titel}</strong>
          {EMPFEHLUNG_HINWEIS.text}
        </Band>
      )}
      <HomePage />
    </>
  );
}
