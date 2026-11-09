import React, { useState } from 'react';
import styled from 'styled-components';
import { Umbrella, Loader } from 'lucide-react';
import supabase from '../../supabaseClient';
import { useAuthContext } from '../../context/AuthContext';
import { hasPaidAccess } from '../../utils/subscription';
import {
  PAUSE_TEXTE, PAUSE_GRUND_TEXT, PAUSE_MAX_TAGE, pruefePause, istPausiert, istPauseGeplant, heuteBerlin,
} from '../../utils/betriebsferien';

/*
 * WP13 — Einstellungen: „Betriebsferien".
 *
 * Nur Pro/FP (Free hat ohnehin keine normalen Pro-Mails — kein Knopf,
 * und der Server blockt ebenfalls). Der Zeitraum geht als YYYY-MM-DD
 * an google-business /account/pause; der Nutzer kommt aus dem JWT.
 * Die Wahrheit steht danach im Profil (pause_from/pause_until) und
 * wird per refreshProfile neu geladen.
 *
 * Kein Billing-Vokabular: Preis und Abrechnung laufen weiter, und das
 * steht hier auch so.
 */

const Card = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 22px 24px; margin-bottom: 20px;
`;
const Titel = styled.h2`
  display: flex; align-items: center; gap: 10px; margin: 0 0 6px;
  font-family: var(--font-display); font-weight: var(--heading-weight); font-size: 1.05rem;
  color: var(--color-primary); text-transform: var(--text-transform);
  svg { color: var(--color-accent); }
`;
const Text = styled.p` margin: 0 0 10px; font-family: var(--font-body); font-size: .88rem; line-height: 1.6; color: var(--color-text); `;
const Klein = styled.p` margin: 6px 0 0; font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted); `;
const Zeile = styled.div` display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin-top: 12px; `;
const Feld = styled.label`
  display: flex; flex-direction: column; gap: 4px; font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted);
  input { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-body); font-size: .9rem; color: var(--color-text); }
`;
const Knopf = styled.button`
  padding: 9px 14px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: white; border: 1px solid var(--color-primary);
  font-family: var(--font-body); font-size: .85rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
  &:disabled { opacity: .6; cursor: default; }
  &.ghost { background: var(--color-white); color: var(--color-text); border-color: var(--color-border); }
`;
const Status = styled.div`
  background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 10px; padding: 12px 14px;
  font-family: var(--font-body); font-size: .88rem; color: var(--color-text);
  strong { color: var(--color-primary); }
`;
const Fehler = styled.p` margin: 8px 0 0; font-family: var(--font-body); font-size: .82rem; color: #D93025; `;

async function rufeAccount(pfad, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');
  const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/account/${pfad}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const grund = /Pause ungueltig: (\w+)/.exec(payload?.error?.message || '')?.[1];
    throw new Error(PAUSE_GRUND_TEXT[grund] || payload?.error?.message || 'Das hat nicht geklappt.');
  }
  return payload;
}

export default function Betriebsferien() {
  const { profile, user, refreshProfile } = useAuthContext();
  const heute = heuteBerlin();
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');

  if (!hasPaidAccess(profile)) return null;   // Free: kein Knopf (§24)

  const aktiv   = istPausiert(profile, heute);
  const geplant = istPauseGeplant(profile, heute);

  const starten = async () => {
    setFehler('');
    const p = pruefePause({ von, bis }, heute);
    if (!p.ok) { setFehler(PAUSE_GRUND_TEXT[p.grund] || 'Zeitraum ungültig.'); return; }
    setLaeuft(true);
    try {
      await rufeAccount('pause', { von, bis });
      await refreshProfile?.(user?.id);
      setVon(''); setBis('');
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(false); }
  };

  const beenden = async () => {
    setFehler(''); setLaeuft(true);
    try {
      await rufeAccount('pause-end');
      await refreshProfile?.(user?.id);
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(false); }
  };

  return (
    <Card data-testid="betriebsferien">
      <Titel><Umbrella size={18} /> {PAUSE_TEXTE.titel}</Titel>
      {(aktiv || geplant) ? (
        <>
          <Status data-testid={aktiv ? 'pause-aktiv' : 'pause-geplant'}>
            <strong>{aktiv ? PAUSE_TEXTE.aktiv(profile.pause_from, profile.pause_until) : PAUSE_TEXTE.geplant(profile.pause_from, profile.pause_until)}</strong>
            <br />{PAUSE_TEXTE.bannerZeile2} {PAUSE_TEXTE.billing}
          </Status>
          <Zeile>
            <Knopf type="button" className="ghost" onClick={beenden} disabled={laeuft} data-testid="pause-beenden">
              {laeuft ? <><Loader size={14} className="spin" /> Moment…</> : PAUSE_TEXTE.beenden}
            </Knopf>
          </Zeile>
        </>
      ) : (
        <>
          <Text>{PAUSE_TEXTE.erklaerung} {PAUSE_TEXTE.kritisch}</Text>
          <Zeile>
            <Feld>Von<input type="date" value={von} min={heute} onChange={(e) => setVon(e.target.value)} data-testid="pause-von" /></Feld>
            <Feld>Bis<input type="date" value={bis} min={von || heute} onChange={(e) => setBis(e.target.value)} data-testid="pause-bis" /></Feld>
            <Knopf type="button" onClick={starten} disabled={laeuft || !von || !bis} data-testid="pause-starten">
              {laeuft ? <><Loader size={14} className="spin" /> Moment…</> : PAUSE_TEXTE.knopf}
            </Knopf>
          </Zeile>
          <Klein>Höchstens {PAUSE_MAX_TAGE} Tage am Stück. {PAUSE_TEXTE.billing}</Klein>
        </>
      )}
      {fehler && <Fehler role="alert">{fehler}</Fehler>}
    </Card>
  );
}

/* Kleiner Hinweis oben im Dashboard, solange die Pause laeuft. */
const Band = styled.div`
  background: #FFF7ED; border-bottom: 1px solid #FED7AA; padding: 10px 16px;
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  font-family: var(--font-body); font-size: .85rem; color: var(--color-text);
  strong { color: var(--color-primary); }
`;
export function PauseHinweis() {
  const { profile, user, refreshProfile } = useAuthContext();
  const [laeuft, setLaeuft] = useState(false);
  if (!istPausiert(profile)) return null;
  const beenden = async () => {
    setLaeuft(true);
    try { await rufeAccount('pause-end'); await refreshProfile?.(user?.id); } catch { /* Settings zeigen den Fehler */ }
    finally { setLaeuft(false); }
  };
  return (
    <Band role="status" data-testid="pause-hinweis">
      <span><strong>{PAUSE_TEXTE.banner(profile.pause_until)}</strong> {PAUSE_TEXTE.bannerZeile2}</span>
      <Knopf type="button" className="ghost" onClick={beenden} disabled={laeuft} style={{ padding: '6px 10px', fontSize: '.8rem' }}>
        {PAUSE_TEXTE.beenden}
      </Knopf>
    </Band>
  );
}
