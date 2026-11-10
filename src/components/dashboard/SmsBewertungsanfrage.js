import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { MessageSquare, Loader, Check } from 'lucide-react';
import supabase from '../../supabaseClient';
import { normalisiereMobilnummer, MOBIL_GRUND_TEXT } from '../../utils/mobilnummer';
import { bereinigeVorname, smsSegmente, EINWILLIGUNG_HINWEIS, VERSAND_GRUND_TEXT } from '../../utils/smsBewertung';

/*
 * WP14 — „Bewertung per SMS anfragen".
 *
 * Bewusst manuell: Vorname + Mobilnummer + (bei mehreren) Betrieb →
 * Vorschau → senden. Kein Autopilot, keine Listen, kein editierbarer
 * Text. Der Client schickt nur locationId, vorname, telefon; Betrieb,
 * Link und Text kommen vom Server (google-business /review-request).
 * Nummer und Name werden hier nicht gespeichert — nach dem Senden ist
 * das Formular leer.
 *
 * Die Seite steht hinter ProGate (Free sieht die Bezahlschranke);
 * der Server blockt Free zusaetzlich (402).
 */

const Card = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 22px 24px; grid-column: 1 / -1;
`;
const Titel = styled.h2`
  display: flex; align-items: center; gap: 10px; margin: 0 0 6px;
  font-family: var(--font-display); font-weight: var(--heading-weight); font-size: 1.05rem;
  color: var(--color-primary); text-transform: var(--text-transform);
  svg { color: var(--color-accent); }
`;
const Text = styled.p` margin: 0 0 12px; font-family: var(--font-body); font-size: .88rem; line-height: 1.6; color: var(--color-text); `;
const Hinweis = styled.p`
  margin: 0 0 14px; padding: 10px 12px; border-left: 3px solid var(--color-accent); background: var(--color-bg);
  font-family: var(--font-body); font-size: .8rem; line-height: 1.55; color: var(--color-text);
`;
const Zeile = styled.div` display: grid; grid-template-columns: 1fr 1fr; gap: 10px; @media (max-width: 560px) { grid-template-columns: 1fr; } `;
const Feld = styled.label`
  display: flex; flex-direction: column; gap: 4px; font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted);
  input, select { padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-body); font-size: .92rem; color: var(--color-text); background: var(--color-white); }
`;
const Vorschau = styled.pre`
  margin: 12px 0 6px; padding: 12px 14px; border-radius: 10px; background: #F4F7FA; border: 1px solid var(--color-border);
  font-family: var(--font-body); font-size: .86rem; line-height: 1.55; color: var(--color-text); white-space: pre-wrap; word-break: break-word;
`;
const Klein = styled.p` margin: 0 0 12px; font-family: var(--font-body); font-size: .76rem; color: var(--color-text-muted); `;
const Knopf = styled.button`
  padding: 10px 16px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: white; border: 1px solid var(--color-primary);
  font-family: var(--font-body); font-size: .88rem; font-weight: 600; display: inline-flex; align-items: center; gap: 7px;
  &:disabled { opacity: .55; cursor: default; }
`;
const Fehler = styled.p` margin: 10px 0 0; font-family: var(--font-body); font-size: .82rem; color: #D93025; `;
const Erfolg = styled.p` margin: 10px 0 0; font-family: var(--font-body); font-size: .85rem; color: #1E7B45; display: flex; align-items: center; gap: 6px; `;

async function rufeReviewRequest(pfad, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');
  const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/review-request/${pfad}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const m = payload?.error?.message || '';
    const grund = /^nummer_(\w+)$/.exec(m)?.[1];
    const text = (grund && MOBIL_GRUND_TEXT[grund]) || VERSAND_GRUND_TEXT[m] || payload?.error?.message || 'Das hat nicht geklappt.';
    const e = new Error(text); e.code = m; throw e;
  }
  return payload;
}

/**
 * @param {{ standorte: Array<{id: string, title?: string|null, place_id?: string|null}>, vorausgewaehlt?: string|null }} props
 */
export default function SmsBewertungsanfrage({ standorte = [], vorausgewaehlt = null }) {
  const [locationId, setLocationId] = useState(vorausgewaehlt || standorte[0]?.id || '');
  const [vorname, setVorname] = useState('');
  const [telefon, setTelefon] = useState('');
  const [vorschau, setVorschau] = useState(null);     // { text, segments } | { reason }
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const [erfolg, setErfolg] = useState(false);

  useEffect(() => { if (vorausgewaehlt) setLocationId(vorausgewaehlt); }, [vorausgewaehlt]);

  /* Vorschau vom Server — derselbe Text, der gesendet wird. */
  useEffect(() => {
    let aktiv = true;
    if (!locationId) { setVorschau(null); return undefined; }
    const t = setTimeout(async () => {
      try {
        const p = await rufeReviewRequest('sms-preview', { locationId, vorname: bereinigeVorname(vorname) || 'Vorname' });
        if (aktiv) setVorschau(p);
      } catch (e) { if (aktiv) setVorschau({ ok: false, reason: e.code || 'fehler' }); }
    }, 250);
    return () => { aktiv = false; clearTimeout(t); };
  }, [locationId, vorname]);

  const nummer = normalisiereMobilnummer(telefon);
  const nameOk = Boolean(bereinigeVorname(vorname));
  const linkFehlt = vorschau && vorschau.ok === false && vorschau.reason === 'kein_link';
  const bereit = Boolean(locationId) && nameOk && nummer.ok && vorschau?.ok && !laeuft;

  const senden = async () => {
    setFehler(''); setErfolg(false);
    if (!nummer.ok) { setFehler(MOBIL_GRUND_TEXT[nummer.grund]); return; }
    setLaeuft(true);
    try {
      await rufeReviewRequest('sms', { locationId, vorname, telefon });
      setErfolg(true); setVorname(''); setTelefon('');
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(false); }
  };

  const seg = vorschau?.ok ? vorschau.segments ?? smsSegmente(vorschau.text).segmente : null;

  return (
    <Card data-testid="sms-bewertungsanfrage">
      <Titel><MessageSquare size={18} /> Bewertung per SMS anfragen</Titel>
      <Text>Nach dem Auftrag: Vorname und Mobilnummer eingeben, Nachricht prüfen, senden. Der Kunde bekommt deinen Google-Bewertungslink.</Text>
      <Hinweis data-testid="sms-einwilligung">{EINWILLIGUNG_HINWEIS}</Hinweis>

      <Zeile>
        <Feld>Vorname
          <input value={vorname} onChange={(e) => setVorname(e.target.value)} maxLength={40} placeholder="z. B. Thomas" data-testid="sms-vorname" />
        </Feld>
        <Feld>Mobilnummer
          <input value={telefon} onChange={(e) => setTelefon(e.target.value)} inputMode="tel" placeholder="0171 1234567" data-testid="sms-telefon" />
        </Feld>
        {standorte.length > 1 && (
          <Feld>Betrieb
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} data-testid="sms-betrieb">
              {standorte.map((s) => <option key={s.id} value={s.id}>{s.title || 'Betrieb'}</option>)}
            </select>
          </Feld>
        )}
      </Zeile>

      {linkFehlt && <Fehler data-testid="sms-kein-link">{VERSAND_GRUND_TEXT.kein_link}</Fehler>}
      {vorschau?.ok && (
        <>
          <Vorschau data-testid="sms-vorschau">{vorschau.text}</Vorschau>
          {Number.isInteger(seg) && seg > 0 && (
            <Klein data-testid="sms-segmente">{seg === 1 ? '1 SMS' : `${seg} SMS-Segmente`}</Klein>
          )}
        </>
      )}

      <Knopf type="button" onClick={senden} disabled={!bereit} data-testid="sms-senden">
        {laeuft ? <><Loader size={15} className="spin" /> Wird gesendet…</> : 'SMS senden'}
      </Knopf>
      {telefon && !nummer.ok && nummer.grund !== 'leer' && <Fehler role="alert" data-testid="sms-nummer-fehler">{MOBIL_GRUND_TEXT[nummer.grund]}</Fehler>}
      {fehler && <Fehler role="alert" data-testid="sms-fehler">{fehler}</Fehler>}
      {erfolg && <Erfolg data-testid="sms-erfolg"><Check size={16} /> SMS wurde gesendet.</Erfolg>}
    </Card>
  );
}
