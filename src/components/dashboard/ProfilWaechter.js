import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { ShieldAlert, Clock, Check, RotateCcw, ExternalLink } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { hasPaidAccess } from '../../utils/subscription';
import {
  DIFF_FELDER, formatWert, diffUeberschrift, ablehnungsText,
} from '../../utils/profilDiff';

/*
 * WP8 — Profil-Waechter auf der Google-Seite.
 *
 * Zeigt je offenem Diff: Feld, hinterlegter Wert, oeffentlich
 * sichtbarer Wert, Status, seit wann. Und — fuer Pro — die beiden
 * Entscheidungen: "Übernehmen" (Googles Wert wird meiner) oder
 * "Meinen Wert wiederherstellen". Pending: kein Knopf. Rejected: nur
 * Hinweis plus Editor. Felder ohne Schreibweg (Name): Link zu Google.
 *
 * Free sieht den Zustand (Score/Profilzustand sind Free), nicht die
 * Knoepfe — und der Server prueft das ohnehin.
 */

const Kasten = styled.section`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-left: 4px solid ${(p) => (p.$kritisch ? '#B3261E' : 'var(--color-accent)')};
  border-radius: var(--radius-card);
  padding: 18px 20px;
  margin-bottom: 20px;
`;

const Kopf = styled.div`
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; color: var(--color-primary); text-transform: var(--text-transform);
  svg { color: ${(p) => (p.$kritisch ? '#B3261E' : 'var(--color-accent)')}; }
`;

const Zeile = styled.div`
  border-top: 1px solid var(--color-border);
  padding: 12px 0;
  display: grid; gap: 6px;
  &.hervor { background: #FFF7ED; margin: 0 -20px; padding: 12px 20px; border-radius: 6px; }
`;

const Titel = styled.div`
  font-family: var(--font-body); font-weight: 700; font-size: .92rem; color: var(--color-text);
`;

const Werte = styled.dl`
  margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px;
  font-family: var(--font-body); font-size: .85rem;
  dt { color: var(--color-text-muted); }
  dd { margin: 0; color: var(--color-text); word-break: break-word; }
`;

const Meta = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
  font-family: var(--font-body); font-size: .76rem; color: var(--color-text-muted);
`;

const Knoepfe = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;
`;

const Knopf = styled.button`
  padding: 7px 12px; border-radius: var(--radius-button); cursor: pointer;
  font-family: var(--font-body); font-size: .8rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--color-border); background: var(--color-white); color: var(--color-text);
  &.primaer { background: var(--color-primary); color: white; border-color: var(--color-primary); }
  &:disabled { opacity: .55; cursor: not-allowed; }
`;

const Hinweis = styled.p`
  margin: 0; font-family: var(--font-body); font-size: .8rem; color: var(--color-text-muted);
`;

const Fehler = styled.p`
  margin: 4px 0 0; font-family: var(--font-body); font-size: .8rem; color: #B3261E;
`;

const STATUS_TEXT = {
  changed: 'öffentlich weicht ab',
  closed_by_google: 'öffentlich als geschlossen',
  pending: 'in Prüfung bei Google',
  rejected: 'von Google abgelehnt',
};

function seit(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ProfilWaechter({ diffs, loading, error, anwenden, hervorgehobenId = null }) {
  const { profile } = useAuthContext();
  const istPro = hasPaidAccess(profile);
  const [laufend, setLaufend] = useState(null);
  const [fehler, setFehler] = useState({});
  const hervorRef = useRef(null);

  useEffect(() => {
    if (hervorRef.current && typeof hervorRef.current.scrollIntoView === 'function') {
      hervorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [hervorgehobenId, diffs.length]);

  if (loading) return null;
  if (error) {
    return <Kasten data-testid="profil-waechter"><Hinweis role="alert">Profil-Wächter: {error}</Hinweis></Kasten>;
  }
  if (!diffs || diffs.length === 0) return null;

  const kritisch = diffs.some((d) => d.prio === 'kritisch' && d.change_type !== 'pending');

  const handle = async (d, aktion) => {
    setLaufend(`${d.id}:${aktion}`); setFehler((f) => ({ ...f, [d.id]: null }));
    try { await anwenden(d.id, aktion); }
    catch (e) { setFehler((f) => ({ ...f, [d.id]: e.message })); }
    finally { setLaufend(null); }
  };

  return (
    <Kasten data-testid="profil-waechter" $kritisch={kritisch} aria-label="Profil-Wächter">
      <Kopf $kritisch={kritisch}><ShieldAlert size={18} /> Google zeigt aktuell eine andere Angabe</Kopf>
      <Hinweis style={{ marginBottom: 6 }}>
        WERKRUF vergleicht täglich, was du hinterlegt hast, mit dem, was Google öffentlich zeigt. Geändert wird nur, was du hier entscheidest.
      </Hinweis>
      {diffs.map((roh) => {
        const d = {
          id: roh.id, fieldPath: roh.field_path, prio: roh.prio, label: roh.label,
          changeType: roh.change_type, origin: roh.origin,
          merchantValue: roh.merchant_value, consumerValue: roh.consumer_value,
          firstSeenAt: roh.first_seen_at, rejectionReason: roh.rejection_reason,
        };
        const katalog = DIFF_FELDER[d.fieldPath];
        const pending = d.changeType === 'pending';
        const rejected = d.changeType === 'rejected';
        const patchbar = Boolean(katalog?.patch) && !pending;
        const grund = ablehnungsText(d.rejectionReason);
        const hervor = hervorgehobenId && hervorgehobenId === d.id;
        return (
          <Zeile key={d.id} data-testid="profil-diff" data-prio={d.prio} data-status={d.changeType}
            className={hervor ? 'hervor' : ''} ref={hervor ? hervorRef : null}>
            <Titel>{diffUeberschrift(d)}</Titel>
            {!pending && (
              <Werte>
                <dt>Hinterlegt</dt><dd data-testid="wert-hinterlegt">{formatWert(d.fieldPath, d.merchantValue)}</dd>
                <dt>Öffentlich sichtbar</dt><dd data-testid="wert-oeffentlich">{formatWert(d.fieldPath, d.consumerValue)}</dd>
              </Werte>
            )}
            {rejected && grund && <Hinweis>{grund}</Hinweis>}
            <Meta>
              <span>Status: {STATUS_TEXT[d.changeType] ?? d.changeType}</span>
              {d.firstSeenAt && <span><Clock size={11} style={{ verticalAlign: '-1px' }} /> seit {seit(d.firstSeenAt)}</span>}
              {d.origin === 'unknown' && !pending && <span>Herkunft nicht bestimmbar</span>}
            </Meta>
            {pending && <Hinweis>Nicht erneut einreichen — Google prüft deine Änderung gerade.</Hinweis>}
            {!pending && istPro && patchbar && !rejected && (
              <Knoepfe>
                <Knopf className="primaer" type="button" disabled={laufend !== null}
                  onClick={() => handle(d, 'wiederherstellen')}>
                  <RotateCcw size={13} /> {laufend === `${d.id}:wiederherstellen` ? 'Wird gesendet…' : 'Meinen Wert wiederherstellen'}
                </Knopf>
                <Knopf type="button" disabled={laufend !== null}
                  onClick={() => handle(d, 'uebernehmen')}>
                  <Check size={13} /> {laufend === `${d.id}:uebernehmen` ? 'Wird gesendet…' : 'Öffentliche Angabe übernehmen'}
                </Knopf>
              </Knoepfe>
            )}
            {!pending && istPro && patchbar && rejected && (
              <Knoepfe>
                <Knopf type="button" disabled={laufend !== null} onClick={() => handle(d, 'uebernehmen')}>
                  <Check size={13} /> Öffentliche Angabe übernehmen
                </Knopf>
                <Hinweis>Deinen Wert erneut zu senden würde Google erneut ablehnen — korrigiere ihn unten im Editor.</Hinweis>
              </Knoepfe>
            )}
            {!pending && istPro && !patchbar && (
              <Hinweis>
                {katalog?.label ?? 'Diese Angabe'} lässt sich nur direkt im Google-Unternehmensprofil ändern.{' '}
                <a href="https://business.google.com/" target="_blank" rel="noreferrer">Bei Google öffnen <ExternalLink size={11} style={{ verticalAlign: '-1px' }} /></a>
              </Hinweis>
            )}
            {!pending && !istPro && (
              <Hinweis data-testid="waechter-free">Übernehmen oder wiederherstellen gehört zu WERKRUF Pro.</Hinweis>
            )}
            {fehler[d.id] && <Fehler role="alert">{fehler[d.id]}</Fehler>}
          </Zeile>
        );
      })}
    </Kasten>
  );
}
