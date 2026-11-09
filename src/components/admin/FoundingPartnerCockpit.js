import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { Users, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { formatAdminDate } from '../../utils/adminOps';
import {
  ZAHLUNGSBEREITSCHAFT, labelZahlungsbereitschaft, kpiKacheln,
  aktiveWochenText, zustellungText, oeffnungText,
} from '../../utils/fpCockpit';

/* ─────────────────────────────────────────────────────────────────
   Founding-Partner-Cockpit (WP6)

   Nur fuer Admins sichtbar: Admin.js rendert das Bauteil erst nach
   isAdmin, und jeder Aufruf geht ueber admin-ops, das die Rolle
   serverseitig prueft (app_metadata.role = 'admin'). Das Bauteil
   selbst kennt keine Tabelle und keine RPC.

   Zahlen: fp_cockpit_overview() / fp_cockpit_detail(). Texte:
   src/utils/fpCockpit.js — dort steht, warum „Oeffnung erkannt" und
   nicht „gelesen", und warum „neue Bewertungen" statt „QR-Bewertungen".
───────────────────────────────────────────────────────────────── */

const Kacheln = styled.div`
  display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  padding: 14px 20px 4px;
`;
const Kachel = styled.div`
  border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 10px 12px;
  background: var(--color-bg);
`;
const KachelWert = styled.p`
  font-family: var(--font-display); font-weight: 700; font-size: 1.4rem; color: var(--color-primary); margin: 0;
`;
const KachelLabel = styled.p`
  font-family: var(--font-body); font-size: .7rem; color: var(--color-text-muted); margin: 2px 0 0; line-height: 1.35;
`;
const Hinweis = styled.p`
  font-family: var(--font-body); font-size: .66rem; color: #8A6D1A; margin: 4px 0 0; line-height: 1.3;
`;
const Table = styled.table`width: 100%; border-collapse: collapse;`;
const Th = styled.th`
  padding: 10px 14px; text-align: left; font-family: var(--font-body); font-size: .68rem;
  text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border); background: var(--color-bg);
`;
const Td = styled.td`
  padding: 10px 14px; font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text); border-bottom: 1px solid var(--color-border); vertical-align: top;
`;
const Tr = styled.tr`
  cursor: pointer;
  &:hover td { background: rgba(var(--color-primary-rgb),.02); }
`;
const Ton = styled.span`
  font-weight: 700;
  color: ${({ $ton }) => ($ton === 'gruen' ? '#1E7E34' : $ton === 'rot' ? '#B3261E' : $ton === 'gelb' ? '#A66A00' : 'var(--color-text)')};
`;
const Detail = styled.div`
  padding: 14px 20px 18px; border-top: 1px solid var(--color-border); background: var(--color-bg);
`;
const Bloecke = styled.div`
  display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
`;
const Block = styled.div`
  border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 12px; background: var(--color-white);
`;
const BlockTitel = styled.h3`
  font-family: var(--font-body); font-weight: 700; font-size: .7rem; text-transform: uppercase;
  letter-spacing: .08em; color: var(--color-text-muted); margin: 0 0 8px;
`;
const Zeile = styled.div`
  display: flex; justify-content: space-between; gap: 10px; font-family: var(--font-body);
  font-size: .8rem; padding: 2px 0; color: var(--color-text);
  span:first-child { color: var(--color-text-muted); }
  span:last-child { font-weight: 700; text-align: right; word-break: break-word; }
`;
const Feld = styled.select`
  font-family: var(--font-body); font-size: .82rem; padding: 6px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white);
`;
const Notiz = styled.textarea`
  width: 100%; min-height: 64px; margin-top: 8px; padding: 8px 10px;
  font-family: var(--font-body); font-size: .82rem; line-height: 1.45;
  border: 1px solid var(--color-border); border-radius: var(--radius-button); resize: vertical;
`;
const Knopf = styled.button`
  margin-top: 8px; padding: 7px 12px; cursor: pointer;
  font-family: var(--font-body); font-weight: 700; font-size: .8rem;
  border-radius: var(--radius-button); border: 1px solid var(--color-primary);
  background: var(--color-primary); color: var(--color-white);
  &:disabled { opacity: .55; cursor: default; }
`;
const Leer = styled.div`
  padding: 24px 20px; font-family: var(--font-body); font-size: .85rem; color: var(--color-text-muted);
`;
const Meldung = styled.p`
  font-family: var(--font-body); font-size: .8rem; margin: 6px 0 0;
  color: ${({ $fehler }) => ($fehler ? '#B3261E' : '#1E7E34')};
`;

const fmt  = (d) => formatAdminDate(d);
const fmtZ = (d) => formatAdminDate(d, true);

/**
 * @param {object} props
 * @param {(action: string, params?: object) => Promise<any>} props.rufeAdminOps
 */
export default function FoundingPartnerCockpit({ rufeAdminOps }) {
  const [daten, setDaten]       = useState(null);
  const [laedt, setLaedt]       = useState(true);
  const [fehler, setFehler]     = useState('');
  const [offen, setOffen]       = useState(null);     // userId
  const [detail, setDetail]     = useState(null);
  const [detailLaedt, setDetailLaedt] = useState(false);
  const [intent, setIntent]     = useState('unbekannt');
  const [notiz, setNotiz]       = useState('');
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung]   = useState(null);     // { text, fehler }

  const lade = useCallback(async () => {
    setLaedt(true); setFehler('');
    try {
      setDaten(await rufeAdminOps('fp_cockpit_overview'));
    } catch (e) {
      setFehler(e.message || 'Cockpit konnte nicht geladen werden.');
    } finally {
      setLaedt(false);
    }
  }, [rufeAdminOps]);

  useEffect(() => { lade(); }, [lade]);

  const oeffne = async (userId) => {
    if (offen === userId) { setOffen(null); setDetail(null); return; }
    setOffen(userId); setDetail(null); setDetailLaedt(true); setMeldung(null);
    try {
      const antwort = await rufeAdminOps('fp_cockpit_detail', { userId });
      const p = antwort?.partner ?? null;
      setDetail(p);
      setIntent(p?.feedback?.paymentIntent ?? 'unbekannt');
      setNotiz(p?.feedback?.note ?? '');
    } catch (e) {
      setMeldung({ text: e.message || 'Detail konnte nicht geladen werden.', fehler: true });
    } finally {
      setDetailLaedt(false);
    }
  };

  const speichere = async () => {
    if (!offen) return;
    setSpeichert(true); setMeldung(null);
    try {
      await rufeAdminOps('set_fp_feedback', { userId: offen, paymentIntent: intent, note: notiz });
      setMeldung({ text: 'Gespeichert.', fehler: false });
      /* Liste aktualisieren, damit „Ja zu 49 €" oben stimmt. */
      await lade();
    } catch (e) {
      setMeldung({ text: e.message || 'Speichern fehlgeschlagen.', fehler: true });
    } finally {
      setSpeichert(false);
    }
  };

  const partner = daten?.partners ?? [];
  const kacheln = kpiKacheln(daten?.kpis);

  return (
    <section data-testid="fp-cockpit" style={{ background: 'var(--color-white)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', marginBottom: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', textTransform: 'uppercase', color: 'var(--color-primary)', margin: 0 }}>
          <Users size={15} style={{ display: 'inline', marginRight: 8, color: 'var(--color-accent)', verticalAlign: 'middle' }} />
          Founding Partner — {partner.length}
        </h2>
        <button type="button" onClick={lade} disabled={laedt} aria-label="Cockpit neu laden"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: '.8rem', padding: '6px 12px', borderRadius: 'var(--radius-button)', cursor: 'pointer' }}>
          <RefreshCw size={13} /> Aktualisieren
        </button>
      </div>

      {fehler && <Leer role="alert" style={{ color: '#B3261E' }}>{fehler}</Leer>}

      {!fehler && (
        <Kacheln data-testid="fp-kpis">
          {kacheln.map((k) => (
            <Kachel key={k.key} data-kpi={k.key}>
              <KachelWert>{k.wert}</KachelWert>
              <KachelLabel>{k.label}</KachelLabel>
              {k.hinweis && <Hinweis>{k.hinweis}</Hinweis>}
            </Kachel>
          ))}
        </Kacheln>
      )}

      {!fehler && !laedt && partner.length === 0 && (
        <Leer>Noch kein Founding Partner. Setzen über die Support-Ansicht eines Kunden („Founding Partner setzen").</Leer>
      )}

      {!fehler && partner.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <Th>Betrieb</Th>
                <Th>Seit</Th>
                <Th>Google</Th>
                <Th>Letzte Montagsmail</Th>
                <Th>Öffnung</Th>
                <Th>Aufgaben 7 / 30 T.</Th>
                <Th>Wochen aktiv</Th>
                <Th>Antworten 30 T.</Th>
                <Th>Action-Links 30 T.</Th>
                <Th>49 €?</Th>
                <Th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {partner.map((p) => {
                const z = zustellungText(p.lastWeeklyMail);
                return (
                  <Tr key={p.userId} onClick={() => oeffne(p.userId)} data-testid="fp-zeile" data-user={p.userId}>
                    <Td>
                      <strong>{p.companyName || '—'}</strong>
                      <div style={{ fontSize: '.72rem', color: 'var(--color-text-muted)' }}>{p.fullName || ''}{p.fullName && p.email ? ' · ' : ''}{p.email || ''}</div>
                    </Td>
                    <Td>{fmt(p.foundingPartnerSince)}</Td>
                    <Td>
                      {p.googleConnected
                        ? <Ton $ton="gruen">verbunden</Ton>
                        : <Ton $ton="rot">{p.connectionStatus === 'needs_reauth' || p.connectionStatus === 'revoked' ? 'erneuern' : 'nicht verbunden'}</Ton>}
                      <div style={{ fontSize: '.72rem', color: 'var(--color-text-muted)' }}>
                        {p.locationCount} {Number(p.locationCount) === 1 ? 'Betrieb' : 'Betriebe'} · Sync {fmtZ(p.lastGoogleSyncAt)}
                      </div>
                    </Td>
                    <Td>
                      <Ton $ton={z.ton}>{z.wert}</Ton>
                      <div style={{ fontSize: '.72rem', color: 'var(--color-text-muted)' }}>{p.lastWeeklyMail?.sentAt ? fmtZ(p.lastWeeklyMail.sentAt) : '—'}</div>
                    </Td>
                    <Td style={{ fontSize: '.78rem' }}>{oeffnungText(p.lastWeeklyMail, fmt)}</Td>
                    <Td>{p.tasksCompleted7d} / {p.tasksCompleted30d}</Td>
                    <Td>{aktiveWochenText(p.activeWeeks4)}</Td>
                    <Td>{p.repliesPublished30d}</Td>
                    <Td>{p.actionLinks30d}{p.lastActionLinkAt ? <div style={{ fontSize: '.72rem', color: 'var(--color-text-muted)' }}>zuletzt {fmt(p.lastActionLinkAt)}</div> : null}</Td>
                    <Td><Ton $ton={p.feedback?.paymentIntent === 'ja' ? 'gruen' : p.feedback?.paymentIntent === 'nein' ? 'rot' : 'neutral'}>{labelZahlungsbereitschaft(p.feedback?.paymentIntent)}</Ton></Td>
                    <Td>{offen === p.userId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {offen && (
        <Detail data-testid="fp-detail">
          {detailLaedt && <Leer>Lade Details …</Leer>}
          {!detailLaedt && detail && (
            <Bloecke>
              <Block>
                <BlockTitel>Betriebe</BlockTitel>
                {(detail.locations ?? []).length === 0 && <Zeile><span>—</span><span>kein Betrieb verbunden</span></Zeile>}
                {(detail.locations ?? []).map((l) => (
                  <div key={l.locationId} style={{ marginBottom: 8 }} data-testid="fp-betrieb">
                    <Zeile><span>{l.title || 'Betrieb'}{l.selected ? ' (gewählt)' : ''}</span><span>{l.locality || ''}</span></Zeile>
                    <Zeile><span>Sync</span><span>{fmtZ(l.lastSyncedAt)}</span></Zeile>
                    <Zeile><span>Aufgaben offen / erledigt 30 T.</span><span>{l.tasksOpen} / {l.tasksCompleted30d}</span></Zeile>
                    <Zeile><span>Antworten veröffentlicht 30 T.</span><span>{l.repliesPublished30d}</span></Zeile>
                    <Zeile><span>neue Bewertungen 30 T.</span><span>{l.newReviews30d}</span></Zeile>
                    <Zeile><span>Action-Links 30 T.</span><span>{l.actionLinks30d}</span></Zeile>
                  </div>
                ))}
                <Zeile><span>Konto-Aufgaben erledigt 30 T.</span><span>{detail.accountTasksCompleted30d ?? 0}</span></Zeile>
                <Zeile><span>letzte Anmeldung</span><span>{fmtZ(detail.lastSignInAt)}</span></Zeile>
              </Block>

              <Block>
                <BlockTitel>Montagsmails (letzte 4)</BlockTitel>
                {(detail.weeklyMails ?? []).length === 0 && <Zeile><span>—</span><span>noch keine</span></Zeile>}
                {(detail.weeklyMails ?? []).map((m) => {
                  const z = zustellungText(m);
                  return (
                    <div key={m.emailId} style={{ marginBottom: 6 }} data-testid="fp-mail">
                      <Zeile><span>{fmt(m.createdAt)}</span><Ton $ton={z.ton}>{z.wert}</Ton></Zeile>
                      <Zeile><span>Öffnung</span><span style={{ fontWeight: 400 }}>{oeffnungText(m, fmtZ)}</span></Zeile>
                      {m.clickedAt && <Zeile><span>Klick</span><span>{fmtZ(m.clickedAt)}</span></Zeile>}
                    </div>
                  );
                })}
                <Hinweis>Öffnung = technisch erkanntes Open-Ereignis, kein Beweis fürs Lesen.</Hinweis>
              </Block>

              <Block data-testid="fp-feedback">
                <BlockTitel>Würde 49 € zahlen?</BlockTitel>
                <Feld value={intent} onChange={(e) => setIntent(e.target.value)} aria-label="Zahlungsbereitschaft">
                  {ZAHLUNGSBEREITSCHAFT.map((z) => <option key={z.wert} value={z.wert}>{z.label}</option>)}
                </Feld>
                <Notiz value={notiz} onChange={(e) => setNotiz(e.target.value)} maxLength={2000}
                  placeholder="Notiz — z. B. ‚Montagsmail findet er stark', ‚braucht mehrere Standorte'" aria-label="Notiz" />
                <Knopf type="button" onClick={speichere} disabled={speichert}>{speichert ? 'Speichert …' : 'Speichern'}</Knopf>
                {detail.feedback?.updatedAt && <Hinweis>zuletzt geändert {fmtZ(detail.feedback.updatedAt)}</Hinweis>}
                {meldung && <Meldung $fehler={meldung.fehler} role={meldung.fehler ? 'alert' : 'status'}>{meldung.text}</Meldung>}
              </Block>
            </Bloecke>
          )}
          {!detailLaedt && !detail && meldung && <Meldung $fehler role="alert">{meldung.text}</Meldung>}
        </Detail>
      )}
    </section>
  );
}
