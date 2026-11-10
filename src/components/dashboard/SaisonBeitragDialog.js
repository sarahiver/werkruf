import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Megaphone, Loader, Check, RotateCcw } from 'lucide-react';
import supabase from '../../supabaseClient';
import { useAuthContext } from '../../context/AuthContext';
import { hasPaidAccess } from '../../utils/subscription';
import { BEITRAG_MAX_ZEICHEN, pruefeBeitragstext, BEITRAG_GRUND_TEXT, statusText } from '../../utils/saisonBeitraege';

/*
 * WP15 — „<Saison>-Beitrag vorbereiten" (geoeffnet ueber die Aufgabe:
 * /dashboard/google?season=<key>&year=<jahr>).
 *
 * Kein Client-Saisonwissen: Fenster, Vorschlagstext und „schon
 * veroeffentlicht?" kommen vom Server (location/seasonal-post-preview).
 * Der Nutzer prueft den Text, passt ihn an, klickt. Der Server baut
 * den Google-Request (parent, topicType STANDARD) — der Client schickt
 * nur locationId, seasonKey, seasonYear, eventId, summary.
 *
 * PROCESSING heisst „an Google uebermittelt", nicht „live".
 */

const Card = styled.div`
  background: var(--color-white); border: 2px solid var(--color-accent);
  border-radius: var(--radius-card); padding: 22px 24px; margin-bottom: 20px;
`;
const Titel = styled.h2`
  display: flex; align-items: center; gap: 10px; margin: 0 0 6px;
  font-family: var(--font-display); font-weight: var(--heading-weight); font-size: 1.05rem;
  color: var(--color-primary); text-transform: var(--text-transform);
  svg { color: var(--color-accent); }
`;
const Warum = styled.p` margin: 0 0 14px; font-family: var(--font-body); font-size: .88rem; line-height: 1.6; color: var(--color-text); strong { display: block; color: var(--color-text-muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; } `;
const Area = styled.textarea`
  width: 100%; min-height: 150px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: 10px;
  font-family: var(--font-body); font-size: .92rem; line-height: 1.55; color: var(--color-text); resize: vertical;
`;
const Zeile = styled.div` display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px; `;
const Zaehler = styled.span` font-family: var(--font-body); font-size: .78rem; color: ${(p) => (p.$warn ? '#D93025' : 'var(--color-text-muted)')}; margin-left: auto; `;
const Knopf = styled.button`
  padding: 10px 16px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: white; border: 1px solid var(--color-primary);
  font-family: var(--font-body); font-size: .88rem; font-weight: 600; display: inline-flex; align-items: center; gap: 7px;
  &:disabled { opacity: .55; cursor: default; }
  &.ghost { background: var(--color-white); color: var(--color-text); border-color: var(--color-border); }
`;
const Status = styled.p` margin: 12px 0 0; font-family: var(--font-body); font-size: .88rem; display: flex; align-items: center; gap: 6px; color: ${(p) => (p.$ok ? '#1E7B45' : p.$warn ? '#B45309' : 'var(--color-text)')}; `;
const Fehler = styled.p` margin: 10px 0 0; font-family: var(--font-body); font-size: .82rem; color: #D93025; `;
const Hinweis = styled.p` margin: 10px 0 0; font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted); `;

async function rufeLocation(pfad, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Session');
  const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/location/${pfad}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const m = payload?.error?.message || '';
    const e = new Error(BEITRAG_GRUND_TEXT[m] || m || 'Das hat nicht geklappt.'); e.code = payload?.error?.code || m; e.retryable = payload?.error?.retryable; throw e;
  }
  return payload;
}

export default function SaisonBeitragDialog({ location, seasonKey, seasonYear, eventId = null, onDone }) {
  const { profile } = useAuthContext();
  const [vorschau, setVorschau] = useState(null);   // { ok, season, vorschlag, bisheriger } | { ok:false, reason }
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    let aktiv = true;
    if (!location?.id || !seasonKey) return undefined;
    (async () => {
      try {
        const p = await rufeLocation('seasonal-post-preview', { locationId: location.id, seasonKey, ...(seasonYear ? { seasonYear: Number(seasonYear) } : {}) });
        if (!aktiv) return;
        setVorschau(p);
        if (p?.ok) setText(p.bisheriger?.status === 'rejected' || p.bisheriger?.status === 'failed' ? (p.bisheriger.text || p.vorschlag) : p.vorschlag || '');
      } catch (e) { if (aktiv) setVorschau({ ok: false, reason: e.code || 'fehler', text: e.message }); }
    })();
    return () => { aktiv = false; };
  }, [location?.id, seasonKey, seasonYear]);

  if (!hasPaidAccess(profile)) return null;   // Seite steht ohnehin hinter ProGate; Server blockt zusaetzlich
  if (!vorschau) return <Card data-testid="saison-dialog"><Hinweis>Vorschlag wird geladen …</Hinweis></Card>;
  if (!vorschau.ok) {
    return (
      <Card data-testid="saison-dialog">
        <Titel><Megaphone size={18} /> Saisonaler Beitrag</Titel>
        <Hinweis data-testid="saison-keine">{vorschau.reason === 'keine_saison' ? BEITRAG_GRUND_TEXT.keine_saison : (vorschau.text || 'Der Vorschlag konnte nicht geladen werden.')}</Hinweis>
      </Card>
    );
  }

  const { season, vorschlag, bisheriger } = vorschau;
  const pruefung = pruefeBeitragstext(text);
  const zeichen = [...(text || '')].length;
  const schonVeroeffentlicht = bisheriger?.status === 'published' && !ergebnis;
  const bereit = pruefung.ok && !laeuft && !schonVeroeffentlicht && !ergebnis?.ok;

  const veroeffentlichen = async () => {
    setFehler(''); setLaeuft(true);
    try {
      const r = await rufeLocation('seasonal-post', { locationId: location.id, seasonKey: season.key, seasonYear: season.jahr, eventId, summary: text });
      setErgebnis(r);
      onDone?.(r);
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(false); }
  };

  const status = ergebnis
    ? statusText(ergebnis.googleState, ergebnis.status)
    : (bisheriger ? statusText(bisheriger.googleState, bisheriger.status) : null);

  return (
    <Card data-testid="saison-dialog">
      <Titel><Megaphone size={18} /> {season.aufgabe}</Titel>
      <Warum><strong>Warum jetzt?</strong>{season.warum}</Warum>

      {schonVeroeffentlicht ? (
        <Status $ok data-testid="saison-status"><Check size={16} /> {status}</Status>
      ) : (
        <>
          <label htmlFor="saison-text" style={{ fontFamily: 'var(--font-body)', fontSize: '.78rem', color: 'var(--color-text-muted)' }}>Beitragstext</label>
          <Area id="saison-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={BEITRAG_MAX_ZEICHEN + 200} data-testid="saison-text" disabled={laeuft || Boolean(ergebnis?.ok)} />
          <Zeile>
            <Knopf type="button" className="ghost" onClick={() => setText(vorschlag || '')} disabled={laeuft || text === vorschlag} data-testid="saison-original">
              <RotateCcw size={14} /> Original wiederherstellen
            </Knopf>
            <Zaehler $warn={zeichen > BEITRAG_MAX_ZEICHEN} data-testid="saison-zaehler">{zeichen} / {BEITRAG_MAX_ZEICHEN}</Zaehler>
          </Zeile>
          {!pruefung.ok && text && <Fehler data-testid="saison-textfehler">{BEITRAG_GRUND_TEXT[pruefung.grund]}</Fehler>}
          <Zeile>
            <Knopf type="button" onClick={veroeffentlichen} disabled={!bereit} data-testid="saison-veroeffentlichen">
              {laeuft ? <><Loader size={15} className="spin" /> Wird übermittelt …</> : 'Auf Google veröffentlichen'}
            </Knopf>
          </Zeile>
          {status && <Status $ok={Boolean(ergebnis?.ok)} $warn={Boolean(ergebnis && !ergebnis.ok)} data-testid="saison-status">{ergebnis?.ok && <Check size={16} />} {status}</Status>}
          {fehler && <Fehler role="alert" data-testid="saison-fehler">{fehler}</Fehler>}
          <Hinweis>WERKRUF veröffentlicht nur, wenn du hier klickst. Der Beitrag erscheint als normaler Google-Beitrag ohne Angebot und ohne Bild.</Hinweis>
        </>
      )}
    </Card>
  );
}
