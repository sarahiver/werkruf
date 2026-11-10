import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { Send, RefreshCw, Plus, Mail, AlertTriangle, Upload, X, ArrowLeft, Check, Circle } from 'lucide-react';
import { formatAdminDate } from '../../utils/adminOps';
import {
  AKQUISE_STATUS, AKQUISE_STATUS_TEXT, EREIGNIS_TEXT, SPERR_TEXT, VERSAND_GRUND_TEXT, KPI_DEFINITION,
} from '../../utils/akquise';
import { BereichKopf, Kpi, KpiReihe, Flaeche, FlaecheKopf, Knopf, Chip, Leer } from './adminUi';
import AkquiseImport from './AkquiseImport';

/* ─────────────────────────────────────────────────────────────────
   Akquise (WP16, Arbeitsbereich seit WP16.1).

   Lead anlegen ODER CSV importieren → personalisieren → Vorschau → EINE
   Mail bewusst senden → Brevo-Ereignisse sehen → Vertriebsstatus von Hand.

   Nur ueber admin-ops (Admin-JWT, serverseitig geprueft). Das Bauteil
   kennt keine Tabelle, keine RPC, keine Mailadresse ausser der, die der
   Server zurueckgibt. Mail-Ereignisse und Vertriebsstatus sind zwei
   Dinge — nichts hier leitet das eine aus dem anderen ab.

   Wortlaut: „Öffnung erkannt", nie „gelesen" (src/utils/akquise.js).

   Layout: Liste links, Detail rechts als Panel (ab 1100 px). Schmaler:
   Detail vollbreit statt der Liste, mit „Zurück zur Liste". Die Liste
   springt beim Oeffnen nicht mehr (WP16 klappte den Lead in der Liste auf).
───────────────────────────────────────────────────────────────── */

const Testband = styled.div`margin: 0 0 14px; padding: 9px 12px; border-radius: 8px; background: #FFF4D6; color: #7A5A00; font-family: var(--font-body); font-size: .8rem; font-weight: 700;`;
const Filter = styled.div`display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 12px 18px; border-bottom: 1px solid rgba(11,37,69,.07);`;
const Eingabe = styled.input`font-family: var(--font-body); font-size: .84rem; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white); min-width: 0; flex: 1 1 220px;`;
const Feld = styled.select`font-family: var(--font-body); font-size: .84rem; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white);`;

const Arbeitsflaeche = styled.div`
  display: grid; gap: 18px; align-items: start; grid-template-columns: minmax(0, 1fr);
  @media (min-width: 1100px) { &[data-detail='true'] { grid-template-columns: minmax(0, 1fr) 460px; } }
  @media (max-width: 1099px) { &[data-detail='true'] > [data-rolle='liste'] { display: none; } }
`;

/* Liste: mobil-first Karten (2 Spalten: Name | Status, Rest darunter);
   ab 900 px Tabelle mit sechs Spalten — ausser das Detail ist daneben
   offen (data-kompakt), dann bleibt es bei Karten. */
const SPALTEN = 'minmax(0, 1.5fr) minmax(0, 1.5fr) 132px 118px minmax(0, 1.6fr) 74px';
const ListenKopf = styled.div`
  display: none; grid-template-columns: ${SPALTEN}; gap: 12px; padding: 9px 18px;
  font-family: var(--font-body); font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--color-text-muted);
  border-bottom: 1px solid rgba(11,37,69,.07);
  @media (min-width: 900px) { [data-kompakt='false'] & { display: grid; } }
`;
const Zeilen = styled.ul`list-style: none; margin: 0; padding: 0;`;
const Zeile = styled.li`
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; padding: 12px 18px; cursor: pointer;
  border-bottom: 1px solid rgba(11,37,69,.06); font-family: var(--font-body); font-size: .84rem; color: var(--color-text);
  &:hover { background: rgba(11,37,69,.025); }
  &[data-offen='true'] { background: #FFF8EF; box-shadow: inset 3px 0 0 var(--color-accent); }
  .spalte-kontakt, .spalte-versand, .spalte-signale, .spalte-sperre { grid-column: 1 / -1; }
  .spalte-aktion { display: none; }
  [data-kompakt='true'] & .spalte-kontakt, [data-kompakt='true'] & .spalte-versand { display: none; }
  @media (min-width: 900px) {
    [data-kompakt='false'] & { grid-template-columns: ${SPALTEN}; gap: 12px; }
    [data-kompakt='false'] & > * { grid-row: 1; }
    [data-kompakt='false'] & .spalte-name { grid-column: 1; }
    [data-kompakt='false'] & .spalte-kontakt { grid-column: 2; }
    [data-kompakt='false'] & .spalte-status { grid-column: 3; }
    [data-kompakt='false'] & .spalte-versand { grid-column: 4; }
    [data-kompakt='false'] & .spalte-signale { grid-column: 5; }
    [data-kompakt='false'] & .spalte-aktion { grid-column: 6; display: block; }
    [data-kompakt='false'] & .spalte-sperre { grid-column: 3 / 6; grid-row: 2; }
  }
`;
const Name = styled.div`min-width: 0; strong { display: block; color: var(--color-primary); overflow-wrap: anywhere; } span { font-size: .74rem; color: var(--color-text-muted); }`;
const Kontakt = styled.div`min-width: 0; font-size: .8rem; overflow-wrap: anywhere; span { display: block; color: var(--color-text-muted); font-size: .74rem; }`;
const Klein = styled.div`font-size: .76rem; color: var(--color-text-muted);`;

const SignalListe = styled.div`display: flex; flex-wrap: wrap; gap: 4px 10px;`;
const SignalEl = styled.span`
  display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-body); font-size: .74rem; white-space: nowrap;
  color: ${({ 'data-ja': ja }) => (ja === 'true' ? '#1E6B34' : '#8A929C')}; font-weight: ${({ 'data-ja': ja }) => (ja === 'true' ? 700 : 500)};
`;

const Panel = styled.aside`
  background: var(--color-white); border-radius: 12px; box-shadow: 0 0 0 1px rgba(11,37,69,.07);
  @media (min-width: 1100px) { position: sticky; top: 64px; max-height: calc(100vh - 84px); overflow: auto; }
`;
const PanelKopf = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(11,37,69,.07);
  background: var(--color-white); border-radius: 12px 12px 0 0;
  /* Nur wo das Panel selbst scrollt: Kopf bleibt stehen. Schmal scrollt die
     Seite, dort laege der Kopf sonst unter der sticky Bereichsnavigation. */
  @media (min-width: 1100px) { position: sticky; top: 0; z-index: 2; }
  h2 { font-family: var(--font-display); font-weight: 800; font-size: 1.15rem; color: var(--color-primary); margin: 0 0 4px; overflow-wrap: anywhere; }
`;
const Abschnitt = styled.section`
  padding: 14px 18px; border-bottom: 1px solid rgba(11,37,69,.06);
  &:last-child { border-bottom: 0; }
  h3 { font-family: var(--font-body); font-weight: 700; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); margin: 0 0 10px; }
`;
const Form = styled.div`
  display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  label { display: grid; gap: 3px; font-family: var(--font-body); font-size: .72rem; color: var(--color-text-muted); }
  input, textarea, select { font-family: var(--font-body); font-size: .84rem; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-button); background: var(--color-white); color: var(--color-text); min-width: 0; }
  textarea { min-height: 70px; resize: vertical; }
  .breit { grid-column: 1 / -1; }
`;
const Historie = styled.ol`
  list-style: none; margin: 0; padding: 0; font-family: var(--font-body); font-size: .8rem;
  li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px dashed rgba(11,37,69,.08); }
  li span:last-child { color: var(--color-text-muted); white-space: nowrap; }
`;
const Vorschau = styled.pre`white-space: pre-wrap; font-family: var(--font-body); font-size: .82rem; line-height: 1.5; background: #F7F8FA; border-radius: 8px; padding: 12px; margin: 8px 0 0; max-height: 340px; overflow: auto;`;
const Meldung = styled.p`font-family: var(--font-body); font-size: .8rem; margin: 8px 0 0; color: ${({ $fehler }) => ($fehler ? '#B42318' : '#1E7E34')};`;
const Warn = styled.p`display: flex; gap: 6px; align-items: center; font-family: var(--font-body); font-size: .8rem; color: #B42318; margin: 6px 0 0; font-weight: 600;`;
const Info = styled.p`font-family: var(--font-body); font-size: .74rem; color: var(--color-text-muted); margin: 8px 0 0; line-height: 1.5;`;
const MetaZeile = styled.div`display: flex; justify-content: space-between; gap: 10px; font-family: var(--font-body); font-size: .8rem; padding: 3px 0; span:first-child { color: var(--color-text-muted); } span:last-child { font-weight: 600; text-align: right; }`;

const fmtZ = (d) => formatAdminDate(d, true);
const LEER_LEAD = { company_name: '', contact_person: '', email: '', trade: '', city: '', website: '', google_profile_url: '', personalized_sentence: '', note: '' };
const STATUS_TON = { interesse: 'gut', founding_partner: 'gut', angeschrieben: 'info', zurueckgestellt: 'warn', kein_interesse: 'neutral', neu: 'neutral', vorbereitet: 'neutral' };

function neuerIdempotenzKey() {
  try {
    const b = new Uint8Array(16); window.crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch { return `k${Date.now()}${Math.random().toString(16).slice(2)}`; }
}

/* Vier kompakte Signale. Haken = erkannt, Kreis = noch nicht. Farbe
   unterstuetzt, Text traegt (auch ohne Farbe lesbar). */
function Signale({ lead }) {
  const s = [
    ['Zugestellt', 'Zugestellt', lead.deliveredAt],
    ['Öffnung', 'Öffnung erkannt (kein Lesebeweis)', lead.firstOpenAt],
    ['Präsentation', 'Präsentation geklickt', lead.presentationClickedAt],
    ['Interesse', 'Interesse bestätigt', lead.ctaClickedAt],
  ];
  return (
    <SignalListe data-testid="akquise-signale">
      {s.map(([kurz, lang, zeit]) => (
        <SignalEl key={kurz} data-ja={zeit ? 'true' : 'false'} title={zeit ? `${lang}: ${fmtZ(zeit)}` : `${lang}: noch nicht`} aria-label={zeit ? `${lang} ${fmtZ(zeit)}` : `${lang}: noch nicht`}>
          {zeit ? <Check size={12} /> : <Circle size={10} />} {kurz}
        </SignalEl>
      ))}
    </SignalListe>
  );
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
  const [importFilter, setImportFilter] = useState(null);      // importId nach „Neue Leads anzeigen"
  const [neu, setNeu] = useState(null);                         // Formular Lead anlegen
  const [importOffen, setImportOffen] = useState(false);
  const [offen, setOffen] = useState(null);                     // leadId
  const [detail, setDetail] = useState(null);
  const [bearbeiten, setBearbeiten] = useState(null);
  const [vorschau, setVorschau] = useState(null);
  const [bestaetigen, setBestaetigen] = useState(false);
  const [idemKey, setIdemKey] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState(null);

  /* Gesucht wird beim Absenden (Enter), nicht bei jedem Tastendruck. */
  const [sucheAktiv, setSucheAktiv] = useState('');
  const holeListe = useCallback(async (filter, begriff, imp) => {
    setLaedt(true); setFehler('');
    try {
      setDaten(await rufeAdminOps('acquisition_list', { status: filter, suche: begriff, limit: 200, ...(imp ? { importId: imp } : {}) }));
    } catch (e) { setFehler(e.message || 'Akquise konnte nicht geladen werden.'); }
    finally { setLaedt(false); }
  }, [rufeAdminOps]);
  const lade = () => holeListe(statusFilter, sucheAktiv, importFilter);

  useEffect(() => { holeListe(statusFilter, sucheAktiv, importFilter); }, [holeListe, statusFilter, sucheAktiv, importFilter]);

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
    if (offen === leadId) return;
    setOffen(leadId); setDetail(null); setVorschau(null); setBestaetigen(false); setMeldung(null); setIdemKey(null);
    /* Schmal ersetzt das Detail die Liste — dorthin scrollen, sonst steht man mitten im Nichts. */
    try { if (window.innerWidth < 1100) window.requestAnimationFrame(() => document.querySelector('[data-testid="akquise-detail"]')?.scrollIntoView?.({ block: 'start' })); } catch { /* jsdom */ }
    try { await ladeDetail(leadId); } catch (e) { setMeldung({ text: e.message, fehler: true }); }
  };
  const schliesse = () => { setOffen(null); setDetail(null); setVorschau(null); setBestaetigen(false); setMeldung(null); setIdemKey(null); };

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
          : 'Mail eingereiht. Der Versand läuft über die Warteschlange (bis zu 30 Minuten); Zustellung erscheint in der Historie.', fehler: false });
        setVorschau(null); setBestaetigen(false); setIdemKey(null);
        await ladeDetail(offen); await lade();
      } else {
        setMeldung({ text: VERSAND_GRUND_TEXT[r?.code] || `Nicht gesendet (${r?.code || 'abgelehnt'}).`, fehler: true });
        setBestaetigen(false);
      }
    } catch (e) { setMeldung({ text: e.message, fehler: true }); setBestaetigen(false); }
    finally { setLaeuft(false); }
  };

  const zeigeImport = (importId) => {
    setImportOffen(false); setStatusFilter('alle'); setSuche(''); setSucheAktiv(''); setImportFilter(importId); schliesse();
  };

  const leads = daten?.leads || [];
  const kpi = daten?.kpi || {};
  const testmodus = daten?.deliveryMode === 'test';
  const offenerLead = leads.find((l) => l.id === offen) || null;

  return (
    <div data-testid="akquise">
      <BereichKopf titel="Akquise" untertitel="Founding-Partner-Akquise — einzeln, bewusst, ohne Automatik." testid="akquise-kopf">
        <Knopf type="button" className="akzent" onClick={() => { setNeu(neu ? null : { ...LEER_LEAD }); setImportOffen(false); setMeldung(null); }} data-testid="akquise-neu">
          <Plus size={13} /> Lead anlegen
        </Knopf>
        <Knopf type="button" className="ghost" onClick={() => { setImportOffen(!importOffen); setNeu(null); }} data-testid="akquise-import-oeffnen" aria-expanded={importOffen}>
          <Upload size={13} /> CSV importieren
        </Knopf>
        <Knopf type="button" className="ghost" onClick={() => lade()} disabled={laedt} aria-label="Akquise neu laden"><RefreshCw size={13} /> Aktualisieren</Knopf>
      </BereichKopf>

      {testmodus && <Testband data-testid="akquise-testmodus">Testmodus: Mails gehen nur an den Testempfänger (EMAIL_DELIVERY_MODE=test).</Testband>}

      <KpiReihe data-testid="akquise-kpi">
        {[['leads', 'Leads'], ['angeschrieben', 'Angeschrieben'], ['zugestellt', 'Zugestellt'], ['oeffnungErkannt', 'Öffnung erkannt'], ['interesse', 'Interesse'], ['foundingPartner', 'Founding Partner']].map(([k, label]) => (
          <Kpi key={k} wert={kpi[k] ?? '—'} label={label} titel={KPI_DEFINITION[k]} ton={k === 'interesse' && kpi[k] > 0 ? 'gut' : null} />
        ))}
      </KpiReihe>

      {neu && (
        <Flaeche data-testid="akquise-neu-form">
          <FlaecheKopf><h2>Neuer Akquise-Lead</h2><Knopf type="button" className="ghost" onClick={() => setNeu(null)}><X size={13} /> Abbrechen</Knopf></FlaecheKopf>
          <div style={{ padding: '14px 18px 16px' }}>
            <LeadForm werte={neu} setze={setNeu} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Knopf type="button" onClick={legeAn} disabled={laeuft || !neu.company_name.trim() || !neu.email.trim()} data-testid="akquise-anlegen">Lead anlegen</Knopf>
            </div>
            {!offen && meldung && <Meldung $fehler={meldung.fehler} role={meldung.fehler ? 'alert' : 'status'}>{meldung.text}</Meldung>}
          </div>
        </Flaeche>
      )}

      {importOffen && <AkquiseImport rufeAdminOps={rufeAdminOps} onSchliessen={() => { setImportOffen(false); lade(); }} onNeueAnzeigen={zeigeImport} />}

      {fehler && <Leer role="alert" style={{ color: '#B42318' }}>{fehler}</Leer>}

      <Arbeitsflaeche data-detail={offen ? 'true' : 'false'}>
        <Flaeche data-rolle="liste" style={{ margin: 0, minWidth: 0 }}>
          <Filter>
            <Eingabe placeholder="Betrieb, Ansprechpartner oder E-Mail" value={suche} onChange={(e) => setSuche(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setSucheAktiv(e.target.value.trim()); }} aria-label="Suche" />
            <Feld value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }} aria-label="Statusfilter" data-testid="akquise-filter">
              <option value="alle">Alle Status</option>
              {AKQUISE_STATUS.map((s) => <option key={s} value={s}>{AKQUISE_STATUS_TEXT[s]}</option>)}
            </Feld>
            {importFilter && (
              <Chip $ton="info" data-testid="akquise-importfilter">Nur dieser Import
                <button type="button" onClick={() => setImportFilter(null)} aria-label="Importfilter entfernen" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, marginLeft: 4, color: 'inherit' }}><X size={12} /></button>
              </Chip>
            )}
          </Filter>

          <div data-kompakt={offen ? 'true' : 'false'}>
            <ListenKopf aria-hidden="true"><span>Betrieb</span><span>Kontakt</span><span>Status</span><span>Letzter Versand</span><span>Signale</span><span /></ListenKopf>
            {!laedt && leads.length === 0 && !fehler && <Leer>{importFilter ? 'Keine Leads aus diesem Import.' : 'Noch keine Akquise-Leads. „Lead anlegen" oder „CSV importieren" startet.'}</Leer>}
            <Zeilen>
              {leads.map((l) => (
                <Zeile key={l.id} data-testid="akquise-lead" data-offen={offen === l.id} onClick={() => oeffne(l.id)}>
                  <Name className="spalte-name"><strong>{l.companyName}</strong><span>{[l.city, l.trade].filter(Boolean).join(' · ')}</span></Name>
                  <div className="spalte-status">
                    <Chip $ton={l.blockReason ? 'schlecht' : STATUS_TON[l.acquisitionStatus]} data-testid="akquise-status">{AKQUISE_STATUS_TEXT[l.acquisitionStatus] || l.acquisitionStatus || '—'}</Chip>
                  </div>
                  {l.blockReason && <Warn className="spalte-sperre" data-testid="akquise-gesperrt" style={{ fontSize: '.72rem', margin: 0 }}><AlertTriangle size={12} /> {SPERR_TEXT[l.blockReason] || 'Lead ist für weiteren Mailversand gesperrt.'}</Warn>}
                  <Kontakt className="spalte-kontakt">{l.contactPerson || '—'}<span>{l.email}</span></Kontakt>
                  <Klein className="spalte-versand">
                    {l.lastOutreachAt ? fmtZ(l.lastOutreachAt) : '—'}
                    {l.lastMessage?.deliveryMode === 'test' ? ' (Test)' : ''}
                    {l.lastMessage?.status === 'failed' ? ` · Versandfehler${l.lastMessage.errorCode ? ` (${l.lastMessage.errorCode})` : ''}` : ''}
                  </Klein>
                  <div className="spalte-signale"><Signale lead={l} /></div>
                  <div className="spalte-aktion"><Knopf type="button" className="ghost" onClick={(e) => { e.stopPropagation(); oeffne(l.id); }} aria-label={`${l.companyName} öffnen`}>Öffnen</Knopf></div>
                </Zeile>
              ))}
            </Zeilen>
          </div>
        </Flaeche>

        {offen && (
          <Panel data-testid="akquise-detail" aria-label="Lead-Detail">
            <PanelKopf>
              <div style={{ minWidth: 0 }}>
                <h2>{detail?.lead?.companyName || offenerLead?.companyName || '…'}</h2>
                {detail?.lead && <Chip $ton={detail.lead.blockReason ? 'schlecht' : STATUS_TON[detail.lead.acquisitionStatus]}>{AKQUISE_STATUS_TEXT[detail.lead.acquisitionStatus] || '—'}</Chip>}
              </div>
              <Knopf type="button" className="ghost" onClick={schliesse} aria-label="Detail schließen" data-testid="akquise-detail-schliessen">
                <ArrowLeft size={13} /> Zur Liste
              </Knopf>
            </PanelKopf>

            {!detail ? <Leer>Lädt …</Leer> : (
              <>
                <Abschnitt>
                  <h3>Stammdaten</h3>
                  <LeadForm werte={bearbeiten || LEER_LEAD} setze={setBearbeiten} teil="stamm" />
                </Abschnitt>
                <Abschnitt>
                  <h3>Personalisierung</h3>
                  <LeadForm werte={bearbeiten || LEER_LEAD} setze={setBearbeiten} teil="personal" />
                  <Knopf type="button" onClick={speichereLead} disabled={laeuft} style={{ marginTop: 10 }} data-testid="akquise-speichern">Speichern</Knopf>
                </Abschnitt>

                <Abschnitt>
                  <h3>Vertriebsstatus (manuell)</h3>
                  <Feld value={detail.lead?.acquisitionStatus || 'neu'} onChange={(e) => setzeStatus(e.target.value)} disabled={laeuft} data-testid="akquise-status-feld" aria-label="Vertriebsstatus">
                    {AKQUISE_STATUS.map((s) => <option key={s} value={s}>{AKQUISE_STATUS_TEXT[s]}</option>)}
                  </Feld>
                  <Info>
                    Mail-Ereignisse ändern diesen Status nie. Nur „Ja, Interesse" auf der Interessensseite setzt ihn auf Interesse — und nie zurück.
                    {detail.lead?.leadStatus === 'converted' ? ' Dieser Lead hat sich bereits registriert (Lead-Status converted).' : ''}
                    {' '}Founding Partner setzt du nach dem Gespräch unter Kunden (bestehende Admin-Aktion), sobald der Betrieb registriert ist.
                  </Info>
                </Abschnitt>

                <Abschnitt>
                  <h3>Mail</h3>
                  {detail.lead?.blockReason ? (
                    <Warn data-testid="akquise-versand-gesperrt"><AlertTriangle size={13} /> {SPERR_TEXT[detail.lead.blockReason]}</Warn>
                  ) : (
                    <>
                      {!vorschau && <Knopf type="button" className="ghost" onClick={zeigeVorschau} disabled={laeuft} data-testid="akquise-vorschau"><Mail size={13} /> Mail-Vorschau</Knopf>}
                      {vorschau && (
                        <div data-testid="akquise-vorschau-inhalt">
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '.8rem', color: 'var(--color-text)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
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
                                <Knopf type="button" className="warn" onClick={sende} disabled={laeuft} data-testid="akquise-senden-bestaetigen" style={{ whiteSpace: 'normal' }}><Send size={13} /> {laeuft ? 'Wird gesendet …' : `Ja, jetzt an ${vorschau.deliveryMode === 'test' ? 'den Testempfänger' : vorschau.to} senden`}</Knopf>
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
                </Abschnitt>

                <Abschnitt>
                  <h3>Tracking</h3>
                  {offenerLead ? <Signale lead={offenerLead} /> : null}
                  {(detail.messages || []).length > 0 && (
                    <MetaZeile style={{ marginTop: 8 }}>
                      <span>{detail.messages.length} Versand{detail.messages.length === 1 ? '' : 'e'}</span>
                      <span>zuletzt {detail.messages[0].status === 'queued' ? 'eingereiht' : detail.messages[0].status === 'sent' ? 'gesendet' : 'fehlgeschlagen'}{detail.messages[0].deliveryMode === 'test' ? ' (Test)' : ''}</span>
                    </MetaZeile>
                  )}
                  <Info>„Öffnung erkannt" heißt: ein Tracking-Pixel wurde geladen (auch Apple Mail oder Scanner). Kein Lesebeweis.</Info>
                </Abschnitt>

                <Abschnitt>
                  <h3>Historie</h3>
                  {(detail.events || []).length === 0 ? <Info style={{ margin: 0 }}>Noch keine Ereignisse.</Info> : (
                    <Historie data-testid="akquise-historie">
                      {detail.events.map((e) => (
                        <li key={e.id}><span>{EREIGNIS_TEXT[e.type] || e.type}</span><span>{fmtZ(e.at)}</span></li>
                      ))}
                    </Historie>
                  )}
                </Abschnitt>
              </>
            )}
          </Panel>
        )}
      </Arbeitsflaeche>
    </div>
  );
}

function LeadForm({ werte, setze, teil = 'alles' }) {
  const f = (k) => ({ value: werte[k] ?? '', onChange: (e) => setze({ ...werte, [k]: e.target.value }) });
  const stamm = teil === 'alles' || teil === 'stamm';
  const personal = teil === 'alles' || teil === 'personal';
  return (
    <Form>
      {stamm && (
        <>
          <label>Betrieb *<input {...f('company_name')} data-testid="lead-company" /></label>
          <label>Ansprechpartner<input {...f('contact_person')} data-testid="lead-contact" /></label>
          <label>E-Mail *<input type="email" {...f('email')} data-testid="lead-email" /></label>
          <label>Gewerk<input {...f('trade')} /></label>
          <label>Ort<input {...f('city')} /></label>
          <label>Website<input {...f('website')} placeholder="https://…" /></label>
          <label className="breit">Google-Profil-URL<input {...f('google_profile_url')} placeholder="https://…" /></label>
        </>
      )}
      {personal && (
        <>
          <label className="breit">Personalisierter Satz (von Hand)<textarea {...f('personalized_sentence')} data-testid="lead-satz" placeholder="Bei euch sind aktuell mehrere Bewertungen unbeantwortet — genau solche Dinge würde WERKRUF automatisch auf dem Schirm behalten." /></label>
          <label className="breit">Notiz<textarea {...f('note')} /></label>
        </>
      )}
    </Form>
  );
}
