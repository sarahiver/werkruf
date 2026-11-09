import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Share2, Copy, Check } from 'lucide-react';
import supabase from '../../supabaseClient';
import { useAuthContext } from '../../context/AuthContext';
import { isFoundingPartner } from '../../utils/subscription';
import { WEITEREMPFEHLEN, empfehlungsUrl, empfehlungsZahlen } from '../../utils/empfehlung';

/*
 * WP10 — Einstellungen: „WERKRUF weiterempfehlen".
 *
 * Code UND Zahlen kommen vom Server (google-business /referral/code →
 * nur der eigene Code, nur mit verbundenem Betrieb, nur Zaehler; der
 * Nutzer steht im JWT, nicht im Request). Kein Client-RPC (Kanon).
 * Nichts davon ist Verkauf: ein Link, ein Kopierknopf, echte Zahlen.
 */

async function ladeEigenenCode() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');
  const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/referral/code`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Empfehlungslink konnte nicht geladen werden.');
  return payload;
}

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
const Text = styled.p` margin: 0 0 14px; font-family: var(--font-body); font-size: .88rem; line-height: 1.6; color: var(--color-text); `;
const LinkZeile = styled.div` display: flex; gap: 8px; align-items: center; flex-wrap: wrap; `;
const LinkFeld = styled.input`
  flex: 1; min-width: 240px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: 8px;
  font-family: var(--font-body); font-size: .85rem; color: var(--color-text); background: #FAFAFA;
`;
const Knopf = styled.button`
  padding: 9px 14px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: white; border: 1px solid var(--color-primary);
  font-family: var(--font-body); font-size: .85rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
  &.ghost { background: var(--color-white); color: var(--color-text); border-color: var(--color-border); }
`;
const Zahlen = styled.div`
  display: flex; gap: 18px; flex-wrap: wrap; margin-top: 14px;
  font-family: var(--font-body); font-size: .82rem; color: var(--color-text-muted);
  strong { color: var(--color-text); }
`;
const Hinweis = styled.p` margin: 10px 0 0; font-family: var(--font-body); font-size: .8rem; color: var(--color-text-muted); `;

export default function Weiterempfehlen() {
  const { profile } = useAuthContext();
  const fp = isFoundingPartner(profile);
  const [code, setCode] = useState(null);
  const [eligible, setEligible] = useState(null);
  const [summary, setSummary] = useState(null);
  const [kopiert, setKopiert] = useState(false);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let aktiv = true;
    (async () => {
      if (!supabase?.auth) return;
      let c;
      try { c = await ladeEigenenCode(); } catch (e) { if (aktiv) setFehler(e.message); return; }
      if (!aktiv) return;
      setCode(c?.code ?? null); setEligible(Boolean(c?.eligible));
      setSummary(c?.summary ?? null);
    })();
    return () => { aktiv = false; };
  }, []);

  const url = code ? empfehlungsUrl(code) : '';
  const z = empfehlungsZahlen(summary);

  const kopieren = async () => {
    try { await navigator.clipboard.writeText(url); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }
    catch { /* Fallback: Feld ist markierbar */ }
  };
  const teilen = async () => {
    try { await navigator.share({ title: 'WERKRUF', text: 'Ich nutze WERKRUF für mein Google-Profil — über diesen Link bekommen wir beide einen Monat kostenlos.', url }); }
    catch { /* abgebrochen */ }
  };

  return (
    <Card data-testid="weiterempfehlen">
      <Titel><Share2 size={18} /> {WEITEREMPFEHLEN.titel}</Titel>
      <Text>{WEITEREMPFEHLEN.text}</Text>
      {fp && <Hinweis data-testid="weiterempfehlen-fp" style={{ marginTop: 0, marginBottom: 12 }}>{WEITEREMPFEHLEN.fp}</Hinweis>}
      {fehler && <Hinweis role="alert">{fehler}</Hinweis>}
      {eligible === false && <Hinweis data-testid="weiterempfehlen-nicht">{WEITEREMPFEHLEN.nichtBerechtigt}</Hinweis>}
      {code && (
        <LinkZeile>
          <LinkFeld readOnly value={url} aria-label="Dein Empfehlungslink" onFocus={(e) => e.target.select()} data-testid="empfehlungslink" />
          <Knopf type="button" onClick={kopieren}>{kopiert ? <><Check size={14} /> Kopiert</> : <><Copy size={14} /> Link kopieren</>}</Knopf>
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <Knopf type="button" className="ghost" onClick={teilen}><Share2 size={14} /> Teilen</Knopf>
          )}
        </LinkZeile>
      )}
      {code && summary && (
        <Zahlen data-testid="empfehlungszahlen">
          <span><strong>{z.eingeladen}</strong> {z.eingeladen === 1 ? 'Kollege eingeladen' : 'Kollegen eingeladen'}</span>
          <span><strong>{z.nutzenPro}</strong> {z.nutzenPro === 1 ? 'davon nutzt Pro' : 'davon nutzen Pro'}</span>
          {!fp && <span><strong>{z.gratisMonate}</strong> {z.gratisMonate === 1 ? 'Gratis-Monat verdient' : 'Gratis-Monate verdient'}{z.wartend > 0 ? ` (${z.wartend} wartet auf dein nächstes Abo)` : ''}</span>}
        </Zahlen>
      )}
    </Card>
  );
}
