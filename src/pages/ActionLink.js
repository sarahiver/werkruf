/**
 * /a/:token — Seite zu einem Aufgaben-Link aus einer WERKRUF-Mail (WP16-Fix1).
 *
 * Vorher lieferte die Edge Function diese Seite als HTML. Das Supabase-
 * Gateway liefert HTML von *.supabase.co inzwischen als text/plain aus —
 * deshalb rendert jetzt das Frontend, und die Function antwortet nur noch
 * mit JSON (GET …/a/<token>/info) und einem Redirect (POST …/continue).
 *
 * Das Formular sendet per POST direkt an die Function. Ein Scanner folgt
 * Links, er schickt kein Formular ab: Ansehen ist kostenlos, Weiter kostet
 * einen Klick — wie bisher.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import styled from 'styled-components';
import { ArrowRight, Clock, CheckCircle } from 'lucide-react';
import { FUNCTIONS_BASE, TEXT, istTokenForm, ladeTokenAuskunft, setzeTokenSeitenMeta } from '../utils/tokenSeite';

const Seite = styled.main`min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: 40px 20px;`;
const Karte = styled.div`max-width: 480px; width: 100%; text-align: center; background: #fff; border: 1px solid var(--color-border); border-radius: 12px; padding: 36px 32px;`;
const Marke = styled.p`font-family: var(--font-body); font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); margin: 0 0 18px;`;
const Betrieb = styled.p`font-family: var(--font-body); font-size: .84rem; color: var(--color-text-muted); margin: 0 0 6px;`;
const Titel = styled.h1`font-family: var(--font-display); font-size: 1.25rem; color: var(--color-primary); margin: 0 0 10px; line-height: 1.35;`;
const Text = styled.p`font-family: var(--font-body); font-size: .9rem; line-height: 1.6; color: var(--color-text-muted); margin: 0 0 22px;`;
const Knopf = styled.button`
  font-family: var(--font-body); font-size: .95rem; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px; background: var(--color-primary); color: #fff;
  border: 0; border-radius: 7px; padding: 13px 24px; &:hover { opacity: .9; } &:disabled { opacity: .55; cursor: default; }
`;
const LinkKnopf = styled(Link)`
  font-family: var(--font-body); font-size: .92rem; font-weight: 600; display: inline-flex; align-items: center; gap: 7px;
  background: var(--color-primary); color: #fff; text-decoration: none; border-radius: 7px; padding: 12px 22px; &:hover { opacity: .9; }
`;
const Fuss = styled.p`font-family: var(--font-body); font-size: .76rem; color: #8A929C; margin: 22px 0 0; line-height: 1.5;`;
const Symbol = styled.div`width: 52px; height: 52px; border-radius: 50%; background: #F4F5F7; color: var(--color-text-muted); display: flex; align-items: center; justify-content: center; margin: 0 auto 18px;`;

export default function ActionLink() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const status = params.get('status');                    // ungueltig | erledigt (Rueckkehr vom POST)
  const [zustand, setZustand] = useState('laedt');          // laedt | ok | ungueltig | netz | erledigt
  const [daten, setDaten] = useState(null);
  const [sendet, setSendet] = useState(false);

  useEffect(() => setzeTokenSeitenMeta(), []);

  useEffect(() => {
    let aktiv = true;
    if (status === 'ungueltig') { setZustand('ungueltig'); return undefined; }
    if (status === 'erledigt') { setZustand('erledigt'); return undefined; }
    if (!istTokenForm(token)) { setZustand('ungueltig'); return undefined; }
    (async () => {
      const r = await ladeTokenAuskunft(`${FUNCTIONS_BASE}/a/${encodeURIComponent(token)}/info`);
      if (!aktiv) return;
      if (r.zustand === 'ok') { setDaten(r.daten); setZustand(r.daten.done ? 'erledigt' : 'ok'); } else setZustand(r.zustand);
    })();
    return () => { aktiv = false; };
  }, [token, status]);

  const weiterAktion = `${FUNCTIONS_BASE}/a/${encodeURIComponent(token ?? '')}/continue`;

  return (
    <Seite>
      <Karte data-testid="action-link" data-zustand={zustand}>
        <Marke>WERKRUF</Marke>

        {zustand === 'laedt' && <Text>Einen Moment …</Text>}

        {zustand === 'netz' && (
          <>
            <Titel>Kurz hakt es.</Titel>
            <Text role="alert">{TEXT.netz}</Text>
            <Knopf type="button" onClick={() => window.location.reload()}>Erneut versuchen</Knopf>
          </>
        )}

        {zustand === 'ungueltig' && (
          <>
            <Symbol><Clock size={24} /></Symbol>
            <Titel>{TEXT.ungueltig}</Titel>
            <Text>{TEXT.ungueltigHinweis}</Text>
            <LinkKnopf to="/dashboard">Zum Dashboard <ArrowRight size={15} /></LinkKnopf>
          </>
        )}

        {zustand === 'erledigt' && (
          <>
            <Symbol><CheckCircle size={24} /></Symbol>
            {daten?.businessName && <Betrieb>{daten.businessName}</Betrieb>}
            <Titel>{TEXT.erledigt}</Titel>
            <Text>{TEXT.erledigtHinweis}</Text>
            <LinkKnopf to="/dashboard">Zum Dashboard <ArrowRight size={15} /></LinkKnopf>
          </>
        )}

        {zustand === 'ok' && daten && (
          <>
            {daten.businessName && <Betrieb>{daten.businessName}</Betrieb>}
            <Titel>{daten.title || 'Weiter zu deinem Dashboard'}</Titel>
            {daten.effort && <Text>{daten.effort}</Text>}
            {/* POST direkt an die Function: sie meldet die Aufgabe als geoeffnet,
                stellt den Betrieb um und leitet per 302 in die Anmeldung. */}
            <form method="POST" action={weiterAktion} onSubmit={() => setSendet(true)} data-testid="action-form">
              <Knopf type="submit" disabled={sendet}>{sendet ? 'Einen Moment …' : 'Weiter zu WERKRUF'} <ArrowRight size={15} /></Knopf>
            </form>
          </>
        )}

        <Fuss>Dieser Link wurde dir per E-Mail zugeschickt und gilt eine Woche.</Fuss>
      </Karte>
    </Seite>
  );
}
