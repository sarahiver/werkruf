import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { Send, RefreshCw, Plus, Mail, AlertTriangle } from 'lucide-react';
import { formatAdminDate } from '../../utils/adminOps';
import {
  AKQUISE_STATUS, AKQUISE_STATUS_TEXT, EREIGNIS_TEXT, SPERR_TEXT, VERSAND_GRUND_TEXT, KPI_DEFINITION,
} from '../../utils/akquise';

/* ─────────────────────────────────────────────────────────────────
   Akquise (WP16) — manuelles Outreach-Cockpit im Admin.

   Lead anlegen → personalisieren → Vorschau → EINE Mail bewusst senden
   → Brevo-Ereignisse sehen → Vertriebsstatus von Hand pflegen.

   Nur ueber admin-ops (Admin-JWT, serverseitig geprueft). Das Bauteil
   kennt keine Tabelle, keine RPC, keine Mailadresse ausser der, die
   der Server zurueckgibt. Mail-Ereignisse und Vertriebsstatus sind
   zwei Spalten — nichts hier leitet das eine aus dem anderen ab.

   Wortlaut: „Öffnung erkannt", nie „gelesen" (src/utils/akquise.js).
───────────────────────────────────────────────────────────────── */

const Kacheln = styled.div`display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); padding: 14px 20px 4px;`;
const Kachel = styled.div`border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 10px 12px; background: var(--color-bg);`;
const KachelWert = styled.p`font-family: var(--font-display); font-weight: 700; font-size: 1.4rem; color: var(--color-primary); margin: 0;`;
const KachelLabel = styled.p`font-family: var(--font-body); font-size: .7rem; color: var(--color-text-muted); margin: 2px 0 0; line-height: 1.35;`;
const Leiste = styled.div`display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 20px;`;
const Eingabe = styled.input`font-family: var(--font-body); font-size: .82rem; padding: 7px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white); min-width: 0; flex: 1 1 180px;`;
const Feld = styled.select`font-family: var(--font-body); font-size: .82rem; padding: 7px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white);`;
const Knopf = styled.button`
  padding: 7px 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-body); font-weight: 700; font-size: .8rem;
  border-radius: var(--radius-button); border: 1px solid var(--color-primary);
  background: var(--color-primary); color: var(--color-white);
  &.ghost { background: var(--color-white); color: var(--color-text); border-color: var(--color-border); font-weight: 600; }
  &.warn { background: #B3261E; border-color: #B3261E; }
  &:disabled { opacity: .55; cursor: default; }
`;
const Liste = styled.div`display: grid; gap: 8px; padding: 6px 20px 16px;`;
const Karte = styled.div`
  border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 12px 14px; background: var(--color-white); cursor: pointer;
  display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.4fr); gap: 10px; align-items: start;
  @media (max-width: 760px) { grid-template-columns: 1fr; }
  &:hover { border-color: var(--color-primary); }
  &[data-offen='true'] { border-color: var(--color-primary); }
`;
const Betrieb = styled.div`font-family: var(--font-body); font-size: .88rem; color: var(--color-text); strong { display: block; } span { font-size: .74rem; color: var(--color-text-muted); word-break: break-word; }`;
const Status = styled.span`
  display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  background: ${({ $s }) => ({ interesse: '#E3F5E8', founding_partner: '#E3F5E8', kein_interesse: '#F2F2F2', angeschrieben: '#E8F0FA', zurueckgestellt: '#FFF4D6' }[$s] || '#F2F2F2')};
  color: ${({ $s }) => ({ interesse: '#1E7E34', founding_partner: '#1E7E34', angeschrieben: '#0B2545', zurueckgestellt: '#8A6D1A' }[$s] || 'var(--color-text)')};
`;
const Signale = styled.div`display: flex; flex-wrap: wrap; gap: 6px 10px; font-family: var(--font-body); font-size: .72rem; color: var(--color-text-muted); span[data-ja='true'] { color: #1E7E34; font-weight: 700; }`;
const Warn = styled.p`display: flex; gap: 6px; align-items: center; font-family: var(--font-body); font-size: .78rem; color: #B3261E; margin: 6px 0 0; font-weight: 600;`;
const Detail = styled.div`grid-column: 1 / -1; border-top: 1px solid var(--color-border); padding-top: 12px; cursor: default; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));`;
const Block = styled.div`border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 12px; background: var(--color-bg);`;
const BlockTitel = styled.h3`font-family: var(--font-body); font-weight: 700; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); margin: 0 0 8px;`;
const Form = styled.div`display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); label { display: grid; gap: 3px; font-family: var(--font-body); font-size: .72rem; color: var(--color-text-muted); } input, textarea, select { font-family: var(--font-body); font-size: .82rem; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white); } textarea { min-height: 64px; resize: vertical; } .breit { grid-column: 1 / -1; }`;
const Historie = styled.ol`list-style: none; margin: 0; padding: 0; font-family: var(--font-body); font-size: .78rem; li { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; border-bottom: 1px dashed var(--color-border); } li span:last-child { color: var(--color-text-muted); white-space: nowrap; }`;
const Vorschau = styled.pre`white-space: pre-wrap; font-family: var(--font-body); font-size: .82rem; line-height: 1.5; background: var(--color-white); border: 1px solid var(--color-border); border-radius: var(--radius-button); padding: 12px; margin: 8px 0 0; max-height: 360px; overflow: auto;`;
const Meldung = styled.p`font-family: var(--font-body); font-size: .8rem; margin: 6px 0 0; color: ${({ $fehler }) => ($fehler ? '#B3261E' : '#1E7E34')};`;
const Leer = styled.div`padding: 24px 20px; font-family: var(--font-body); font-size: .85rem; color: var(--color-text-muted);`;
const Testband = styled.div`margin: 0 20px 6px; padding: 8px 12px; border-radius: var(--radius-button); background: #FFF4D6; color: #8A6D1A; font-family: var(--font-body); font-size: .78rem; font-weight: 700;`;

const fmtZ = (d) => formatAdminDate(d, true);
const LEER_LEAD = { company_name: '', contact_person: '', email: '', trade: '', city: '', website: '', google_profile_url: '', personalized_sentence: '', note: '' };

function neuerIdempotenzKey() {
  try {
    const b = new Uint8Array(16); window.crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch { return `k${Date.now()}${Math.random().toString(16).slice(2)}`; }
}

/**
 * @param {object} props
 * @param {(action: string, params?: object) => Promise<any>} props.rufeAdminOps
 */
export default function Akquise({ rufeAdminOps }) {
  const [daten, setDaten] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState('');
  const [statusFilter, setStatusFilter] = useState('alle');
  const [suche, setSuche] = useState('');
  const [neu, setNeu] = useState(null);                 // Formular Lead anlegen
  const [offen, setOffen] = useState(null);             // leadId
  const [detail, setDetail] = useState(null);
  const [bearbeiten, setBearbeiten] = useState(null);   // Formularwerte
  const [vorschau, setVorschau] = useState(null);
  const [bestaetigen, setBestaetigen] = useState(false);
  const [idemKey, setIdemKey] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState(null);

  const lade = useCallback(async (filter = statusFilter, begriff = suche) => {
    setLaedt(true); setFehler('');
    try { setDaten(await rufeAdminOps('acquisition_list', { status: filter, suche: begriff, limit: 200 })); }
    catch (e) { setFehler(e.message || 'Akquise konnte nicht geladen werden.'); }
    finally { setLaedt(false); }
  }, [rufeAdminOps, statusFilter, suche]);

  useEffect(() => { lade(); }, [lade]);

  const ladeDetail = useCallback(async (leadId) => {
    const d = await rufeAdminOps('acquisition_lead_detail', { leadId });
    setDetail(d);
    const l = d?.lead || {};
    setBearbeiten({
      company_name: l.companyName || '', contact_person: l.contactPerson || '', email: l.email || '', trade: l.trade || '', city: l.city || '',
      website: l.website || '', google_profile_url: l.googleProfileUrl || '', personalized_sentence: l.personalizedSentence || '', note: l.note || '',
    });
  }, [rufeAdminOps]);

  const oeffne = async (leadId) => {
    if (offen === leadId) { setOffen(null); setDetail(null); setVorschau(null); return; }
    setOffen(leadId); setDetail(null); setVorschau(null); setBestaetigen(false); setMeldung(null); setIdemKey(null);
    try { await ladeDetail(leadId); } catch (e) { setMeldung({ text: e.message, fehler: true }); }
  };

  const speichereLead = async () => {
    setLaeuft(true); setMeldung(null);
    try {
      await rufeAdminOps('acquisition_lead_update', { leadId: offen, lead: bearbeiten });
      await ladeDetail(offen); await lade();
      setVorschau(null);
      setMeldung({ text: 'Gespeichert.', fehler: false });
    } catch (e) { setMeldung({ text: e.message, fehler: true }); }
    finally { setLaeuft(false); }
  };

  const legeAn = async () => {
    setLaeuft(true); setMeldung(null);
    try {
      const r = await rufeAdminOps('acquisition_lead_create', { lead: neu });
      setNeu(null); await lade();
      setMeldung({ text: 'Lead angelegt.', fehler: false });
      if (r?.leadId) { setOffen(r.leadId); await ladeDetail(r.leadId); }
    } catch (e) { setMeldung({ text: e.message, fehler: true }); }
    finally { setLaeuft(false); }
  };

  const setzeStatus = async (status) => {
    setLaeuft(true); setMeldung(null);
    try {
      await rufeAdminOps('acquisition_set_status', { leadId: offen, status });
      await ladeDetail(offen); await lade();
    } catch (e) { setMeldung({ text: e.message, fehler: true }); }
    finally { setLaeuft(false); }
  };

  const zeigeVorschau = async () => {
    setLaeuft(true); setMeldung(null); setBestaetigen(false);
    try {
      const v = await rufeAdminOps('acquisition_preview', { leadId: offen });
      setVorschau(v); setIdemKey(neuerIdempotenzKey());
    } catch (e) { setMeldung({ text: e.message, fehler: true }); }
    finally { setLaeuft(false); }
  };

  const sende = async () => {
    if (!idemKey) return;
    setLaeuft(true); setMeldung(null);
    try {
      const r = await rufeAdminOps('acquisition_send', { leadId: offen, idempotencyKey: idemKey });
      if (r?.ok) {
        setMeldung({ text: r.deliveryMode === 'test'
          ? `Testversand eingereiht — geht nur an ${r.testRecipient || 'den Testempfänger'}.`
          : 'Mail eingereiht. Der Versand läuft über die Warteschlange; Zustellung erscheint in der Historie.', fehler: false });
        setVorschau(null); setBestaetigen(false); setIdemKey(null);
        await ladeDetail(offen); await lade();
      } else {
        setMeldung({ text: VERSAND_GRUND_TEXT[r?.code] || `Nicht gesendet (${r?.code || 'abgelehnt'}).`, fehler: true });
        setBestaetigen(false);
      }
    } catch (e) { setMeldung({ text: e.message, fehler: true }); setBestaetigen(false); }
    finally { setLaeuft(false); }
  };

  const leads = daten?.leads || [];
  const kpi = daten?.kpi || {};
  const testmodus = daten?.deliveryMode === 'test';

  return (
    <section data-testid="akquise" style={{ background: 'var(--color-white)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', marginBottom: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', textTransform: 'uppercase', color: 'var(--color-primary)', margin: 0 }}>
          <Mail size={15} style={{ display: 'inline', marginRight: 8, color: 'var(--color-accent)', verticalAlign: 'middle' }} />
          Akquise — {leads.length}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Knopf type="button" className="ghost" onClick={() => { setNeu(neu ? null : { ...LEER_LEAD }); setMeldung(null); }} data-testid="akquise-neu">
            <Plus size={13} /> Lead anlegen
          </Knopf>
          <Knopf type="button" className="ghost" onClick={() => lade()} disabled={laedt} aria-label="Akquise neu laden"><RefreshCw size={13} /> Aktualisieren</Knopf>
        </div>
      </div>

      {testmodus && <Testband data-testid="akquise-testmodus" style={{ marginTop: 10 }}>Testmodus: Mails gehen nur an den Testempfänger (EMAIL_DELIVERY_MODE=test).</Testband>}
      {fehler && <Leer role="alert" style={{ color: '#B3261E' }}>{fehler}</Leer>}

      <Kacheln data-testid="akquise-kpi">
        {[['leads', 'Leads'], ['angeschrieben', 'Angeschrieben'], ['zugestellt', 'Zugestellt'], ['oeffnungErkannt', 'Öffnung erkannt'], ['interesse', 'Interesse'], ['foundingPartner', 'Founding Partner']].map(([k, label]) => (
          <Kachel key={k} title={KPI_DEFINITION[k]}><KachelWert>{kpi[k] ?? '—'}</KachelWert><KachelLabel>{label}</KachelLabel></Kachel>
        ))}
      </Kacheln>

      {neu && (
        <div style={{ padding: '6px 20px 10px' }}>
          <Block>
            <BlockTitel>Neuer Akquise-Lead</BlockTitel>
            <LeadForm werte={neu} setze={setNeu} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Knopf type="button" onClick={legeAn} disabled={laeuft || !neu.company_name.trim() || !neu.email.trim()} data-testid="akquise-anlegen">Lead anlegen</Knopf>
              <Knopf type="button" className="ghost" onClick={() => setNeu(null)}>Abbrechen</Knopf>
            </div>
            {!offen && meldung && <Meldung $fehler={meldung.fehler} role={meldung.fehler ? 'alert' : 'status'}>{meldung.text}</Meldung>}
          </Block>
        </div>
      )}

      <Leiste>
        <Eingabe placeholder="Betrieb, Ansprechpartner oder E-Mail" value={suche} onChange={(e) => setSuche(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lade(statusFilter, e.target.value); }} aria-label="Suche" />
        <Feld value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); lade(e.target.value, suche); }} aria-label="Statusfilter" data-testid="akquise-filter">
          <option value="alle">Alle Status</option>
          {AKQUISE_STATUS.map((s) => <option key={s} value={s}>{AKQUISE_STATUS_TEXT[s]}</option>)}
        </Feld>
      </Leiste>

      {!laedt && leads.length === 0 && !fehler && <Leer>Noch keine Akquise-Leads. „Lead anlegen" startet.</Leer>}

      <Liste>
        {leads.map((l) => {
          const istOffen = offen === l.id;
          return (
            <Karte key={l.id} data-testid="akquise-lead" data-offen={istOffen} onClick={() => !istOffen && oeffne(l.id)}>
              <Betrieb onClick={() => istOffen && oeffne(l.id)}>
                <strong>{l.companyName}</strong>
                <span>{[l.contactPerson, l.email].filter(Boolean).join(' · ')}</span><br />
                <span>{[l.city, l.trade].filter(Boolean).join(' · ')}</span>
              </Betrieb>
              <div>
                <Status $s={l.acquisitionStatus} data-testid="akquise-status">{AKQUISE_STATUS_TEXT[l.acquisitionStatus] || l.acquisitionStatus || '—'}</Status>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                  letzter Versand: {l.lastOutreachAt ? fmtZ(l.lastOutreachAt) : '—'}
                  {l.lastMessage?.deliveryMode === 'test' ? ' (Test)' : ''}
                  {l.lastMessage?.status === 'failed' ? ` · Versandfehler${l.lastMessage.errorCode ? ` (${l.lastMessage.errorCode})` : ''}` : ''}
                </div>
                {l.blockReason && <Warn data-testid="akquise-gesperrt"><AlertTriangle size={13} /> {SPERR_TEXT[l.blockReason] || 'Lead ist für weiteren Mailversand gesperrt.'}</Warn>}
              </div>
              <Signale data-testid="akquise-signale">
                <span data-ja={Boolean(l.deliveredAt)}>Zugestellt{l.deliveredAt ? ` ${fmtZ(l.deliveredAt)}` : ': —'}</span>
                <span data-ja={Boolean(l.firstOpenAt)}>Öffnung erkannt{l.firstOpenAt ? ` ${fmtZ(l.firstOpenAt)}` : ': —'}</span>
                <span data-ja={Boolean(l.presentationClickedAt)}>Präsentation geklickt{l.presentationClickedAt ? ` ${fmtZ(l.presentationClickedAt)}` : ': —'}</span>
                <span data-ja={Boolean(l.ctaClickedAt)}>Interesse bestätigt{l.ctaClickedAt ? ` ${fmtZ(l.ctaClickedAt)}` : ': —'}</span>
              </Signale>

              {istOffen && (
                <Detail onClick={(e) => e.stopPropagation()} data-testid="akquise-detail">
                  {!detail ? <Leer>Lädt …</Leer> : (
                    <>
                      <Block>
                        <BlockTitel>Stammdaten &amp; Personalisierung</BlockTitel>
                        <LeadForm werte={bearbeiten || LEER_LEAD} setze={setBearbeiten} />
                        <Knopf type="button" onClick={speichereLead} disabled={laeuft} style={{ marginTop: 10 }} data-testid="akquise-speichern">Speichern</Knopf>
                      </Block>

                      <Block>
                        <BlockTitel>Vertriebsstatus (manuell)</BlockTitel>
                        <Feld value={detail.lead?.acquisitionStatus || 'neu'} onChange={(e) => setzeStatus(e.target.value)} disabled={laeuft} data-testid="akquise-status-feld">
                          {AKQUISE_STATUS.map((s) => <option key={s} value={s}>{AKQUISE_STATUS_TEXT[s]}</option>)}
                        </Feld>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '.72rem', color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
                          Mail-Ereignisse ändern diesen Status nie. Nur „Ja, Interesse" auf der Interessensseite setzt ihn auf Interesse — und nie zurück.
                          {detail.lead?.leadStatus === 'converted' ? ' Dieser Lead hat sich bereits registriert (Lead-Status converted).' : ''}
                        </p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '.72rem', color: 'var(--color-text-muted)', margin: '6px 0 0' }}>
                          Founding Partner setzt du nach dem Gespräch im Kundenbereich unten (bestehende Admin-Aktion), sobald der Betrieb registriert ist.
                        </p>

                        <BlockTitel style={{ marginTop: 14 }}>Mail</BlockTitel>
                        {detail.lead?.blockReason ? (
                          <Warn data-testid="akquise-versand-gesperrt"><AlertTriangle size={13} /> {SPERR_TEXT[detail.lead.blockReason]}</Warn>
                        ) : (
                          <>
                            {!vorschau && <Knopf type="button" className="ghost" onClick={zeigeVorschau} disabled={laeuft} data-testid="akquise-vorschau"><Mail size={13} /> Mail-Vorschau</Knopf>}
                            {vorschau && (
                              <div data-testid="akquise-vorschau-inhalt">
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '.78rem', color: 'var(--color-text)' }}>
                                  <div><strong>An:</strong> {vorschau.to}{vorschau.toName ? ` (${vorschau.toName})` : ''}</div>
                                  <div><strong>Von:</strong> {vorschau.sender?.name} &lt;{vorschau.sender?.email}&gt;</div>
                                  <div><strong>Betreff:</strong> {vorschau.subject}</div>
                                  <div><strong>Präsentationslink:</strong> {vorschau.presentationUrl}</div>
                                  <div><strong>CTA:</strong> {vorschau.ctaUrl}</div>
                                  {vorschau.deliveryMode === 'test' && <Testband style={{ margin: '8px 0 0' }} data-testid="akquise-vorschau-test">Testversand: geht an {vorschau.testRecipient || 'den Testempfänger'}, nicht an {vorschau.to}.</Testband>}
                                  {!vorschau.personalizedSentence && <Warn><AlertTriangle size={13} /> Kein personalisierter Satz — die Mail geht ohne ihn raus.</Warn>}
                                </div>
                                <Vorschau data-testid="akquise-vorschau-text">{vorschau.text}</Vorschau>
                                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                                  {!bestaetigen ? (
                                    <Knopf type="button" onClick={() => setBestaetigen(true)} disabled={laeuft} data-testid="akquise-senden"><Send size={13} /> Mail senden</Knopf>
                                  ) : (
                                    <>
                                      <Knopf type="button" className="warn" onClick={sende} disabled={laeuft} data-testid="akquise-senden-bestaetigen"><Send size={13} /> {laeuft ? 'Wird gesendet …' : `Ja, jetzt an ${vorschau.deliveryMode === 'test' ? 'den Testempfänger' : vorschau.to} senden`}</Knopf>
                                      <Knopf type="button" className="ghost" onClick={() => setBestaetigen(false)} disabled={laeuft}>Abbrechen</Knopf>
                                    </>
                                  )}
                                  <Knopf type="button" className="ghost" onClick={() => { setVorschau(null); setBestaetigen(false); }} disabled={laeuft}>Vorschau schließen</Knopf>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {meldung && <Meldung $fehler={meldung.fehler} role={meldung.fehler ? 'alert' : 'status'} data-testid="akquise-meldung">{meldung.text}</Meldung>}
                      </Block>

                      <Block>
                        <BlockTitel>Eventhistorie</BlockTitel>
                        {(detail.events || []).length === 0 ? <Leer style={{ padding: 0 }}>Noch keine Ereignisse.</Leer> : (
                          <Historie data-testid="akquise-historie">
                            {detail.events.map((e) => (
                              <li key={e.id}><span>{EREIGNIS_TEXT[e.type] || e.type}</span><span>{fmtZ(e.at)}</span></li>
                            ))}
                          </Historie>
                        )}
                        {(detail.messages || []).length > 0 && (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '.72rem', color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
                            {detail.messages.length} Versand{detail.messages.length === 1 ? '' : 'e'} · zuletzt {detail.messages[0].status === 'queued' ? 'eingereiht' : detail.messages[0].status === 'sent' ? 'gesendet' : 'fehlgeschlagen'}{detail.messages[0].deliveryMode === 'test' ? ' (Test)' : ''}
                          </p>
                        )}
                      </Block>
                    </>
                  )}
                </Detail>
              )}
            </Karte>
          );
        })}
      </Liste>
    </section>
  );
}

function LeadForm({ werte, setze }) {
  const f = (k) => ({ value: werte[k] ?? '', onChange: (e) => setze({ ...werte, [k]: e.target.value }) });
  return (
    <Form>
      <label>Betrieb *<input {...f('company_name')} data-testid="lead-company" /></label>
      <label>Ansprechpartner<input {...f('contact_person')} data-testid="lead-contact" /></label>
      <label>E-Mail *<input type="email" {...f('email')} data-testid="lead-email" /></label>
      <label>Gewerk<input {...f('trade')} /></label>
      <label>Ort<input {...f('city')} /></label>
      <label>Website<input {...f('website')} placeholder="https://…" /></label>
      <label className="breit">Google-Profil-URL<input {...f('google_profile_url')} placeholder="https://…" /></label>
      <label className="breit">Personalisierter Satz (von Hand)<textarea {...f('personalized_sentence')} data-testid="lead-satz" placeholder="Bei euch sind aktuell mehrere Bewertungen unbeantwortet — genau solche Dinge würde WERKRUF automatisch auf dem Schirm behalten." /></label>
      <label className="breit">Notiz<textarea {...f('note')} /></label>
    </Form>
  );
}
